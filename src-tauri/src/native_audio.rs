use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::path::PathBuf;
use std::sync::atomic::{AtomicU16, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tauri::Manager;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeTrack {
    pub id: String,
    pub title: String,
    pub artist: String,
    pub duration_seconds: u64,
    pub thumbnail_url: String,
    pub album_art: Option<String>,
    pub stream_url: Option<String>,
    pub candidates: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResolvedStreamResponse {
    pub video_id: String,
    pub duration_seconds: Option<u64>,
    pub candidates: Vec<String>,
    pub source_tier: String,
}

#[derive(Debug, Clone)]
struct AudioStreamEntry {
    url: String,
    mime_type: String,
    user_agent: String,
}

static API_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static STREAM_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static VISITOR_DATA_CACHE: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
static STREAM_REGISTRY: OnceLock<Mutex<HashMap<String, Vec<AudioStreamEntry>>>> = OnceLock::new();
static PROXY_PORT: AtomicU16 = AtomicU16::new(0);
static PROXY_INIT_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();
static YTDLP_BOOTSTRAP_LOCK: OnceLock<tokio::sync::Mutex<()>> = OnceLock::new();

const VISIONOS_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";
const ANDROID_VR_UA: &str = "com.google.android.apps.youtube.vr.oculus/1.60.19 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip";

/// Fast JSON API client with 6.5s total request timeout.
fn api_client() -> &'static reqwest::Client {
    API_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(8)
            .timeout(Duration::from_millis(6500))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

/// Long-lived streaming client (connect timeout only, no total body timeout) for audio proxy & binary bootstrap.
fn stream_client() -> &'static reqwest::Client {
    STREAM_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(12)
            .connect_timeout(Duration::from_secs(8))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn stream_registry() -> &'static Mutex<HashMap<String, Vec<AudioStreamEntry>>> {
    STREAM_REGISTRY.get_or_init(|| Mutex::new(HashMap::new()))
}

/// Strictly validates that a YouTube video ID is exactly 11 safe characters `^[a-zA-Z0-9_-]{11}$`.
/// Prevents argument/flag injection (CWE-88) and path traversal.
pub fn is_valid_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

/// Sanitizes a user search query by removing control characters, stripping leading dashes
/// (to prevent CLI flag confusion), and capping maximum length.
pub fn sanitize_search_query(raw: &str) -> String {
    raw.chars()
        .filter(|c| !c.is_control())
        .collect::<String>()
        .trim()
        .trim_start_matches('-')
        .trim()
        .chars()
        .take(120)
        .collect()
}

/// Filters out karaoke, instrumental, backing track, nightcore, and unofficial cover noise.
pub fn is_blacklisted_track(title: &str, artist: &str) -> bool {
    let combined = format!("{} {}", title.to_lowercase(), artist.to_lowercase());
    const BLACKLIST_KEYWORDS: &[&str] = &[
        "karaoke",
        "instrumental",
        "backing track",
        "minus one",
        "cover by",
        "tribute to",
        "parody",
        "mashup",
        "slowed",
        "reverb",
        "nightcore",
        "8d audio",
        "piano cover",
        "guitar cover",
        "drum cover",
        "bass cover",
    ];
    BLACKLIST_KEYWORDS.iter().any(|kw| combined.contains(kw))
}

/// Parses a duration string like "3:27" or "1:02:15" into total seconds.
fn parse_duration_text(text: &str) -> Option<u64> {
    let parts: Vec<&str> = text.trim().split(':').collect();
    match parts.len() {
        2 => {
            let mins = parts[0].parse::<u64>().ok()?;
            let secs = parts[1].parse::<u64>().ok()?;
            Some(mins * 60 + secs)
        }
        3 => {
            let hours = parts[0].parse::<u64>().ok()?;
            let mins = parts[1].parse::<u64>().ok()?;
            let secs = parts[2].parse::<u64>().ok()?;
            Some(hours * 3600 + mins * 60 + secs)
        }
        _ => None,
    }
}

/// Upgrades Google UserContent / YouTube Music square thumbnail URLs to high-resolution 500x500.
fn upgrade_artwork_url(url: &str, video_id: &str) -> String {
    if url.contains("googleusercontent.com") || url.contains("ggpht.com") {
        if let Some(eq_idx) = url.rfind("=w") {
            let prefix = &url[..eq_idx];
            return format!("{}=w500-h500-l90-rj", prefix);
        }
        return url.to_string();
    }
    if !url.is_empty() {
        return url.to_string();
    }
    format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id)
}

/// Cleans raw YouTube video titles into (title, artist) when falling back to general video search.
fn parse_video_title_and_artist(raw_title: &str, raw_author: &str) -> (String, String) {
    let mut clean = raw_title.to_string();
    let noise_tags = [
        "(Official Music Video)",
        "[Official Music Video]",
        "(Official Video)",
        "[Official Video]",
        "(Official Audio)",
        "[Official Audio]",
        "(Official Lyric Video)",
        "[Official Lyric Video]",
        "(Lyric Video)",
        "[Lyric Video]",
        "(Lyrics)",
        "[Lyrics]",
        "(Visualizer)",
        "[Visualizer]",
        "(Audio)",
        "[Audio]",
        "(MV)",
        "[MV]",
        "(HD)",
        "(4K)",
    ];
    for tag in noise_tags {
        if let Some(idx) = clean.to_lowercase().find(&tag.to_lowercase()) {
            clean.replace_range(idx..idx + tag.len(), "");
        }
    }
    let clean = clean.trim();

    if let Some((left, right)) = clean.split_once(" - ") {
        let artist = left.trim().trim_matches('"').trim_matches('\'').trim();
        let title = right.trim().trim_matches('"').trim_matches('\'').trim();
        if !artist.is_empty() && !title.is_empty() {
            return (title.to_string(), artist.to_string());
        }
    }

    let artist = raw_author
        .trim()
        .strip_suffix(" - Topic")
        .or_else(|| raw_author.trim().strip_suffix(" - topic"))
        .unwrap_or(raw_author.trim())
        .trim_matches('"')
        .trim();

    (
        clean.trim_matches('"').trim_matches('\'').trim().to_string(),
        if artist.is_empty() {
            "Unknown Artist".to_string()
        } else {
            artist.to_string()
        },
    )
}

// =========================================================================
// VISITOR DATA SESSION MANAGER (Required by VISIONOS / ANDROID_VR for Official Tracks)
// =========================================================================

fn cache_visitor_data(vd: &str) {
    if vd.is_empty() {
        return;
    }
    let lock = VISITOR_DATA_CACHE.get_or_init(|| Mutex::new(None));
    if let Ok(mut guard) = lock.lock() {
        *guard = Some((vd.to_string(), Instant::now()));
    }
}

async fn get_or_fetch_visitor_data(force_refresh: bool) -> Option<String> {
    let lock = VISITOR_DATA_CACHE.get_or_init(|| Mutex::new(None));
    if !force_refresh {
        if let Ok(guard) = lock.lock() {
            if let Some((ref vd, ts)) = *guard {
                if ts.elapsed() < Duration::from_secs(1800) {
                    return Some(vd.clone());
                }
            }
        }
    }

    let payload = json!({
        "context": {
            "client": {
                "clientName": "WEB",
                "clientVersion": "2.20250101.00.00",
                "hl": "en",
                "gl": "US"
            }
        }
    });

    match api_client()
        .post("https://www.youtube.com/youtubei/v1/visitor_id?prettyPrint=false")
        .header("Content-Type", "application/json")
        .json(&payload)
        .send()
        .await
    {
        Ok(res) if res.status().is_success() => {
            if let Ok(data) = res.json::<Value>().await {
                if let Some(vd) = data
                    .pointer("/responseContext/visitorData")
                    .and_then(|v| v.as_str())
                {
                    println!("[NativeAudio] Obtained fresh InnerTube visitorData token");
                    cache_visitor_data(vd);
                    return Some(vd.to_string());
                }
            }
        }
        Ok(res) => {
            eprintln!(
                "[NativeAudio] visitor_id endpoint returned HTTP {}",
                res.status()
            );
        }
        Err(e) => {
            eprintln!("[NativeAudio] visitor_id fetch error: {}", e);
        }
    }

    None
}

// =========================================================================
// LOCAL AUDIO STREAM PROXY (127.0.0.1Loopback Server — Anti-CORS & Anti-Origin Block)
// =========================================================================

async fn ensure_local_stream_proxy() -> Result<u16, String> {
    let existing = PROXY_PORT.load(Ordering::Acquire);
    if existing != 0 {
        return Ok(existing);
    }

    let init_mutex = PROXY_INIT_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = init_mutex.lock().await;

    let existing = PROXY_PORT.load(Ordering::Acquire);
    if existing != 0 {
        return Ok(existing);
    }

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind local audio proxy: {}", e))?;

    let port = listener
        .local_addr()
        .map_err(|e| format!("Failed to get local proxy addr: {}", e))?
        .port();

    PROXY_PORT.store(port, Ordering::Release);
    println!(
        "[NativeAudio] Local Audio Stream Proxy listening on http://127.0.0.1:{}",
        port
    );

    tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((socket, _)) => {
                    tokio::spawn(async move {
                        let _ = socket.set_nodelay(true);
                        if let Err(e) = handle_proxy_connection(socket).await {
                            // Ignore normal client disconnect errors during seek/skip
                            if !e.contains("broken pipe")
                                && !e.contains("forcibly closed")
                                && !e.contains("aborted")
                                && !e.contains("connection reset")
                            {
                                eprintln!("[NativeAudio Proxy Worker] {}", e);
                            }
                        }
                    });
                }
                Err(e) => {
                    eprintln!("[NativeAudio Proxy] Accept error: {}", e);
                    tokio::time::sleep(Duration::from_millis(50)).await;
                }
            }
        }
    });

    Ok(port)
}

async fn handle_proxy_connection(mut socket: TcpStream) -> Result<(), String> {
    let conn_start = Instant::now();
    // 1. Read full HTTP request headers from client until \r\n\r\n
    let mut header_buf = Vec::with_capacity(2048);
    let mut temp = [0u8; 1024];
    loop {
        let n = socket
            .read(&mut temp)
            .await
            .map_err(|e| format!("Socket read error: {}", e))?;
        if n == 0 {
            return Ok(());
        }
        header_buf.extend_from_slice(&temp[..n]);
        if header_buf.windows(4).any(|w| w == b"\r\n\r\n") || header_buf.len() >= 8192 {
            break;
        }
    }

    let req_str = String::from_utf8_lossy(&header_buf);
    let mut lines = req_str.lines();
    let first_line = lines.next().unwrap_or("");
    let mut parts = first_line.split_whitespace();
    let method = parts.next().unwrap_or("GET");
    let path_and_query = parts.next().unwrap_or("/");

    if method.eq_ignore_ascii_case("OPTIONS") {
        println!(
            "[NativeAudio Proxy] Incoming OPTIONS preflight: {}",
            path_and_query
        );
        let resp = "HTTP/1.1 204 No Content\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type, Accept\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type\r\nConnection: close\r\n\r\n";
        let _ = socket.write_all(resp.as_bytes()).await;
        let _ = socket.flush().await;
        return Ok(());
    }

    // Extract Range header from client request (e.g. "Range: bytes=0-" or "Range: bytes=1024-")
    let mut client_range: Option<String> = None;
    for line in lines {
        if line.is_empty() {
            break;
        }
        if let Some((k, v)) = line.split_once(':') {
            if k.trim().eq_ignore_ascii_case("range") {
                client_range = Some(v.trim().to_string());
            }
        }
    }

    // Parse /stream/{video_id}?idx={idx}
    let (path, query) = path_and_query
        .split_once('?')
        .unwrap_or((path_and_query, ""));
    let video_id = path.strip_prefix("/stream/").unwrap_or("").trim();
    let mut idx: usize = 0;
    for pair in query.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "idx" {
                idx = v.parse::<usize>().unwrap_or(0);
            }
        }
    }

    let (entry_opt, total_cached_for_id) = {
        let guard = stream_registry()
            .lock()
            .map_err(|_| "Registry lock poisoned".to_string())?;
        let count = guard.get(video_id).map(|l| l.len()).unwrap_or(0);
        let entry = guard
            .get(video_id)
            .and_then(|list| list.get(idx).cloned().or_else(|| list.first().cloned()));
        (entry, count)
    };

    println!(
        "[NativeAudio Proxy] --> WebView2 Request: method={}, uri='{}', Range={:?}, cache_hit={} (video_id='{}', idx={}/{})",
        method,
        path_and_query,
        client_range,
        entry_opt.is_some(),
        video_id,
        idx,
        total_cached_for_id
    );

    let Some(entry) = entry_opt else {
        eprintln!(
            "[NativeAudio Proxy] <-- 404 Cache Miss! No stream entry in STREAM_REGISTRY for video_id='{}'",
            video_id
        );
        let not_found = "HTTP/1.1 404 Not Found\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n";
        let _ = socket.write_all(not_found.as_bytes()).await;
        let _ = socket.flush().await;
        return Err(format!("No stream entry registered for video_id={}", video_id));
    };

    // Forward request to Google CDN with original User-Agent and Range header
    let effective_range = client_range.as_deref().unwrap_or("bytes=0-");
    let req_builder = stream_client()
        .get(&entry.url)
        .header("User-Agent", &entry.user_agent)
        .header("Range", effective_range);

    let upstream_res = req_builder
        .send()
        .await
        .map_err(|e| format!("Upstream CDN fetch failed for {}: {}", video_id, e))?;

    let status = upstream_res.status();
    let status_code = status.as_u16();
    if !status.is_success() && status_code != 206 {
        eprintln!(
            "[NativeAudio Proxy] <-- Upstream Google CDN ERROR: HTTP {} for video_id='{}' (Range='{}')",
            status, video_id, effective_range
        );
        let err_resp = format!(
            "HTTP/1.1 {} Bad Gateway\r\nAccess-Control-Allow-Origin: *\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
            status_code
        );
        let _ = socket.write_all(err_resp.as_bytes()).await;
        let _ = socket.flush().await;
        return Err(format!(
            "Upstream googlevideo.com returned HTTP {} for video_id={} (Range: {:?})",
            status, video_id, client_range
        ));
    }

    let status_line = if status_code == 206 {
        "HTTP/1.1 206 Partial Content"
    } else {
        "HTTP/1.1 200 OK"
    };

    // Forward CDN Headers Transparently
    let headers = upstream_res.headers();
    let content_type = headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or(&entry.mime_type)
        .to_string();
    let content_length = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let content_range = headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());

    println!(
        "[NativeAudio Proxy] <-- Upstream Google CDN OK: HTTP {}, Content-Type='{}', Content-Length={:?}, Content-Range={:?} ({}ms)",
        status_code,
        content_type,
        content_length,
        content_range,
        conn_start.elapsed().as_millis()
    );

    let mut header_block = format!(
        "{}\r\nContent-Type: {}\r\nAccept-Ranges: bytes\r\nAccess-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, OPTIONS\r\nAccess-Control-Allow-Headers: Range, Content-Type, Accept\r\nAccess-Control-Expose-Headers: Content-Length, Content-Range, Accept-Ranges, Content-Type\r\nConnection: close\r\n",
        status_line, content_type
    );

    if let Some(ref cl) = content_length {
        header_block.push_str(&format!("Content-Length: {}\r\n", cl));
    }

    if let Some(ref cr) = content_range {
        header_block.push_str(&format!("Content-Range: {}\r\n", cr));
    }

    header_block.push_str("\r\n");
    socket
        .write_all(header_block.as_bytes())
        .await
        .map_err(|e| format!("Failed writing proxy headers: {}", e))?;
    socket
        .flush()
        .await
        .map_err(|e| format!("Failed flushing proxy headers: {}", e))?;

    if method.eq_ignore_ascii_case("HEAD") {
        return Ok(());
    }

    // Non-blocking chunk streaming with telemetry
    let mut stream = upstream_res;
    let mut total_bytes: usize = 0;
    let mut chunk_count: usize = 0;
    let mut client_disconnected = false;

    loop {
        match stream.chunk().await {
            Ok(Some(chunk)) => {
                chunk_count += 1;
                let len = chunk.len();
                if chunk_count == 1 {
                    let head_hex: Vec<String> =
                        chunk.iter().take(16).map(|b| format!("{:02x}", b)).collect();
                    let head_ascii: String = chunk
                        .iter()
                        .take(16)
                        .map(|&b| {
                            if b.is_ascii_graphic() || b == b' ' {
                                b as char
                            } else {
                                '.'
                            }
                        })
                        .collect();
                    println!(
                        "[NativeAudio Proxy] [{}] First chunk received ({} bytes at {}ms) magic=[{}] ascii='{}'",
                        video_id,
                        len,
                        conn_start.elapsed().as_millis(),
                        head_hex.join(" "),
                        head_ascii
                    );
                }

                // If client closes connection or stops reading (e.g. seeking/skip/pause), exit cleanly
                if let Err(write_err) = socket.write_all(&chunk).await {
                    println!(
                        "[NativeAudio Proxy] [{}] Socket closed by WebView2 at chunk #{} after {} bytes ({}ms): {}",
                        video_id,
                        chunk_count,
                        total_bytes,
                        conn_start.elapsed().as_millis(),
                        write_err
                    );
                    client_disconnected = true;
                    break;
                }
                total_bytes += len;
            }
            Ok(None) => break,
            Err(chunk_err) => {
                eprintln!(
                    "[NativeAudio Proxy] [{}] Upstream CDN stream error at chunk #{} after {} bytes ({}ms): {}",
                    video_id,
                    chunk_count,
                    total_bytes,
                    conn_start.elapsed().as_millis(),
                    chunk_err
                );
                client_disconnected = true;
                break;
            }
        }
    }

    let _ = socket.flush().await;
    let _ = socket.shutdown().await;

    if !client_disconnected {
        println!(
            "[NativeAudio Proxy] [{}] Stream EOF completed cleanly: {} bytes in {} chunks ({}ms)",
            video_id,
            total_bytes,
            chunk_count,
            conn_start.elapsed().as_millis()
        );
    }

    Ok(())
}

// =========================================================================
// SEARCH ENGINE: YOUTUBE MUSIC INNERTUBE + STANDARD YOUTUBE FALLBACK
// =========================================================================

async fn search_yt_music_innertube(query: &str) -> Result<Vec<NativeTrack>, String> {
    let payload = json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20250101.01.00",
                "hl": "en",
                "gl": "US"
            }
        },
        "query": query,
        "params": "EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"
    });

    let res = api_client()
        .post("https://music.youtube.com/youtubei/v1/search?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        )
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/")
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("YT Music search request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("YT Music search HTTP {}", res.status()));
    }

    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("YT Music search JSON parse failed: {}", e))?;

    if let Some(vd) = data
        .pointer("/responseContext/visitorData")
        .and_then(|v| v.as_str())
    {
        cache_visitor_data(vd);
    }

    let mut tracks = Vec::new();
    let mut seen_keys = HashSet::new();

    let tabs = data
        .pointer("/contents/tabbedSearchResultsRenderer/tabs")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for tab in tabs {
        let sections = tab
            .pointer("/tabRenderer/content/sectionListRenderer/contents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for sec in sections {
            let items = sec
                .pointer("/musicShelfRenderer/contents")
                .and_then(|v| v.as_array())
                .cloned()
                .unwrap_or_default();

            for item in items {
                let Some(mrlir) = item.get("musicResponsiveListItemRenderer") else {
                    continue;
                };

                let video_id = mrlir
                    .pointer("/playlistItemData/videoId")
                    .and_then(|v| v.as_str())
                    .or_else(|| {
                        mrlir
                            .pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchEndpoint/videoId")
                            .and_then(|v| v.as_str())
                    })
                    .unwrap_or("");

                if !is_valid_video_id(video_id) {
                    continue;
                }

                let flex_cols = mrlir
                    .get("flexColumns")
                    .and_then(|v| v.as_array())
                    .cloned()
                    .unwrap_or_default();

                if flex_cols.is_empty() {
                    continue;
                }

                let title = flex_cols[0]
                    .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
                    .and_then(|v| v.as_array())
                    .map(|runs| {
                        runs.iter()
                            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<&str>>()
                            .join("")
                    })
                    .unwrap_or_default()
                    .trim()
                    .to_string();

                if title.is_empty() {
                    continue;
                }

                let mut meta_text = String::new();
                for col in flex_cols.iter().skip(1) {
                    if let Some(runs) = col
                        .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
                        .and_then(|v| v.as_array())
                    {
                        let joined = runs
                            .iter()
                            .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                            .collect::<Vec<&str>>()
                            .join("");
                        if !joined.is_empty() {
                            if !meta_text.is_empty() {
                                meta_text.push_str(" • ");
                            }
                            meta_text.push_str(&joined);
                        }
                    }
                }

                let segments: Vec<&str> = meta_text.split(" • ").map(|s| s.trim()).collect();
                let mut artist = String::new();
                let mut duration_seconds = 180u64;

                for (idx, seg) in segments.iter().enumerate() {
                    if let Some(dur) = parse_duration_text(seg) {
                        duration_seconds = dur;
                    } else if idx == 0
                        && !seg.eq_ignore_ascii_case("song")
                        && !seg.eq_ignore_ascii_case("video")
                    {
                        artist = (*seg).to_string();
                    } else if idx == 1 && artist.is_empty() {
                        artist = (*seg).to_string();
                    }
                }

                if artist.is_empty() {
                    artist = "Unknown Artist".to_string();
                }

                if is_blacklisted_track(&title, &artist) {
                    continue;
                }

                let dedup_key = format!("{}|{}", title.to_lowercase(), artist.to_lowercase());
                if seen_keys.contains(&dedup_key) {
                    continue;
                }
                seen_keys.insert(dedup_key);

                let raw_thumb = mrlir
                    .pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|u| u.as_str())
                    .unwrap_or("");

                let high_res_art = upgrade_artwork_url(raw_thumb, video_id);

                tracks.push(NativeTrack {
                    id: video_id.to_string(),
                    title,
                    artist,
                    duration_seconds,
                    thumbnail_url: high_res_art.clone(),
                    album_art: Some(high_res_art),
                    stream_url: None,
                    candidates: None,
                });

                if tracks.len() >= 15 {
                    break;
                }
            }
        }
    }

    Ok(tracks)
}

async fn search_yt_standard_innertube(query: &str) -> Result<Vec<NativeTrack>, String> {
    let payload = json!({
        "context": {
            "client": {
                "clientName": "ANDROID_VR",
                "clientVersion": "1.60.19",
                "deviceMake": "Oculus",
                "deviceModel": "Quest 3",
                "osName": "Android",
                "osVersion": "12L",
                "androidSdkVersion": 32,
                "hl": "en",
                "gl": "US"
            }
        },
        "query": format!("{} Official Audio", query)
    });

    let res = api_client()
        .post("https://www.youtube.com/youtubei/v1/search?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header("User-Agent", ANDROID_VR_UA)
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("YT standard search failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("YT standard search HTTP {}", res.status()));
    }

    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("YT standard search JSON parse error: {}", e))?;

    let mut tracks = Vec::new();
    let sections = data
        .pointer("/contents/sectionListRenderer/contents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for sec in sections {
        let items = sec
            .pointer("/itemSectionRenderer/contents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for item in items {
            let Some(vr) = item
                .get("videoWithContextRenderer")
                .or_else(|| item.get("compactVideoRenderer"))
                .or_else(|| item.get("videoRenderer"))
            else {
                continue;
            };

            let video_id = vr.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
            if !is_valid_video_id(video_id) {
                continue;
            }

            let raw_title = vr
                .pointer("/headline/runs/0/text")
                .or_else(|| vr.pointer("/title/runs/0/text"))
                .or_else(|| vr.pointer("/title/simpleText"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            let raw_author = vr
                .pointer("/shortBylineText/runs/0/text")
                .or_else(|| vr.pointer("/longBylineText/runs/0/text"))
                .or_else(|| vr.pointer("/ownerText/runs/0/text"))
                .and_then(|v| v.as_str())
                .unwrap_or("");

            if raw_title.is_empty() || is_blacklisted_track(raw_title, raw_author) {
                continue;
            }

            let (title, artist) = parse_video_title_and_artist(raw_title, raw_author);
            if is_blacklisted_track(&title, &artist) {
                continue;
            }

            let length_str = vr
                .pointer("/lengthText/runs/0/text")
                .or_else(|| vr.pointer("/lengthText/simpleText"))
                .and_then(|v| v.as_str())
                .unwrap_or("3:00");
            let duration_seconds = parse_duration_text(length_str).unwrap_or(180);

            let thumb = format!("https://i.ytimg.com/vi/{}/hqdefault.jpg", video_id);
            tracks.push(NativeTrack {
                id: video_id.to_string(),
                title,
                artist,
                duration_seconds,
                thumbnail_url: thumb.clone(),
                album_art: Some(thumb),
                stream_url: None,
                candidates: None,
            });

            if tracks.len() >= 10 {
                break;
            }
        }
    }

    Ok(tracks)
}

// =========================================================================
// TIER 1: INNERTUBE PLAYER EXTRACTORS (VISIONOS -> ANDROID_VR) + STREAM PROBE
// =========================================================================

fn extract_audio_entries_from_player(
    client_label: &str,
    video_id: &str,
    data: &Value,
    user_agent: &str,
) -> Result<(Vec<AudioStreamEntry>, Option<u64>), String> {
    let playability_status = data
        .pointer("/playabilityStatus/status")
        .and_then(|v| v.as_str())
        .unwrap_or("UNKNOWN");
    let playability_reason = data
        .pointer("/playabilityStatus/reason")
        .and_then(|v| v.as_str())
        .unwrap_or("");

    let duration_seconds = data
        .pointer("/videoDetails/lengthSeconds")
        .and_then(|v| v.as_str())
        .and_then(|s| s.parse::<u64>().ok())
        .filter(|&d| d > 0);

    let Some(formats) = data
        .pointer("/streamingData/adaptiveFormats")
        .and_then(|v| v.as_array())
    else {
        return Err(format!(
            "[{}] video_id={} playabilityStatus={} ({}) — no adaptiveFormats in response",
            client_label, video_id, playability_status, playability_reason
        ));
    };

    let mut scored_entries: Vec<(i32, AudioStreamEntry)> = Vec::new();
    let mut cipher_count = 0usize;

    for fmt in formats {
        let mime_full = fmt.get("mimeType").and_then(|v| v.as_str()).unwrap_or("");
        if !mime_full.starts_with("audio/") {
            continue;
        }

        if fmt.get("signatureCipher").is_some() || fmt.get("cipher").is_some() {
            cipher_count += 1;
        }

        let Some(url) = fmt.get("url").and_then(|v| v.as_str()) else {
            continue;
        };

        if !url.starts_with("https://") {
            continue;
        }

        let itag = fmt.get("itag").and_then(|v| v.as_i64()).unwrap_or(0);
        // Prioritize WebM/Opus (itag 251/250/249) for Chromium WebView2:
        // Chromium decodes WebM/Opus in-process via built-in WebMStreamParser + libopus without
        // relying on Windows Media Foundation (WMF), which can stall at HAVE_METADATA (0:00) on
        // YouTube's fragmented MPEG-DASH (ftypdash) mp4 streams.
        let priority = match itag {
            251 => 100, // audio/webm Opus 160kbps (Primary — native Chromium in-process decoder)
            250 => 95,  // audio/webm Opus 70kbps
            249 => 90,  // audio/webm Opus 50kbps
            140 => 85,  // audio/mp4 AAC 128kbps (Fallback)
            139 => 70,  // audio/mp4 AAC 48kbps
            _ if mime_full.starts_with("audio/webm") => 80,
            _ if mime_full.starts_with("audio/mp4") => 60,
            _ => 50,
        };

        let clean_mime = mime_full
            .split(';')
            .next()
            .unwrap_or("audio/mp4")
            .trim()
            .to_string();

        println!(
            "[NativeAudio] [{}] candidate fmt: itag={}, mime='{}', priority={}",
            client_label, itag, mime_full, priority
        );

        scored_entries.push((
            priority,
            AudioStreamEntry {
                url: url.to_string(),
                mime_type: clean_mime,
                user_agent: user_agent.to_string(),
            },
        ));
    }

    println!(
        "[NativeAudio] [{}] video_id={} -> playability={}, direct_audio={}, cipher_locked={}",
        client_label,
        video_id,
        playability_status,
        scored_entries.len(),
        cipher_count
    );

    if scored_entries.is_empty() {
        return Err(format!(
            "[{}] video_id={} returned 0 direct URLs (playability={}, cipher_locked={})",
            client_label, video_id, playability_status, cipher_count
        ));
    }

    scored_entries.sort_by(|a, b| b.0.cmp(&a.0));
    let mut entries = Vec::new();
    let mut seen_urls = HashSet::new();
    for (_, entry) in scored_entries {
        if seen_urls.insert(entry.url.clone()) {
            entries.push(entry);
        }
    }

    Ok((entries, duration_seconds))
}

/// Verifies that the primary extracted `googlevideo.com` URL accepts open-ended `Range: bytes=0-` (HTTP 206/200)
/// and does not suffer from `svpuc=1` PoToken 403 rejection.
async fn verify_stream_entry_playable(entry: &AudioStreamEntry, video_id: &str) -> bool {
    match api_client()
        .get(&entry.url)
        .header("User-Agent", &entry.user_agent)
        .header("Range", "bytes=0-")
        .send()
        .await
    {
        Ok(res) => {
            let code = res.status().as_u16();
            let ok = code == 206 || code == 200;
            println!(
                "[NativeAudio] Stream probe for {} -> HTTP {} (playable={})",
                video_id, code, ok
            );
            ok
        }
        Err(e) => {
            eprintln!("[NativeAudio] Stream probe failed for {}: {}", video_id, e);
            false
        }
    }
}

/// Tier 1A: `VISIONOS` InnerTube Player API with `visitorData` token.
/// Empirically verified to resolve copyrighted studio tracks (e.g. BABYMONSTER - DRIP) with full HTTP 206 OpenRange support.
async fn resolve_tier1_visionos(
    video_id: &str,
    visitor_data: Option<&str>,
) -> Result<(Vec<AudioStreamEntry>, Option<u64>), String> {
    let mut client_obj = json!({
        "clientName": "VISIONOS",
        "clientVersion": "0.1",
        "deviceMake": "Apple",
        "deviceModel": "RealityDevice14,1",
        "osName": "visionOS",
        "osVersion": "1.3.21O771",
        "hl": "en",
        "gl": "US"
    });

    if let Some(vd) = visitor_data {
        client_obj["visitorData"] = json!(vd);
    }

    let payload = json!({
        "context": { "client": client_obj },
        "videoId": video_id,
        "contentCheckOk": true,
        "racyCheckOk": true
    });

    let mut req = api_client()
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header("User-Agent", VISIONOS_UA);

    if let Some(vd) = visitor_data {
        req = req.header("X-Goog-Visitor-Id", vd);
    }

    let res = req
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Tier 1A (VISIONOS) HTTP error: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Tier 1A (VISIONOS) HTTP status {}: {}", status, err_body));
    }

    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("Tier 1A (VISIONOS) JSON parse error: {}", e))?;

    let (entries, duration) =
        extract_audio_entries_from_player("Tier 1A: VISIONOS", video_id, &data, VISIONOS_UA)?;

    if let Some(first) = entries.first() {
        if !verify_stream_entry_playable(first, video_id).await {
            return Err(format!(
                "Tier 1A (VISIONOS) stream probe rejected with HTTP 403 for {}",
                video_id
            ));
        }
    }

    Ok((entries, duration))
}

/// Tier 1B: `ANDROID_VR` InnerTube Player API.
async fn resolve_tier1_android_vr(
    video_id: &str,
    visitor_data: Option<&str>,
) -> Result<(Vec<AudioStreamEntry>, Option<u64>), String> {
    let mut client_obj = json!({
        "clientName": "ANDROID_VR",
        "clientVersion": "1.60.19",
        "deviceMake": "Oculus",
        "deviceModel": "Quest 3",
        "osName": "Android",
        "osVersion": "12L",
        "androidSdkVersion": 32,
        "hl": "en",
        "gl": "US"
    });

    if let Some(vd) = visitor_data {
        client_obj["visitorData"] = json!(vd);
    }

    let payload = json!({
        "context": { "client": client_obj },
        "videoId": video_id,
        "contentCheckOk": true,
        "racyCheckOk": true
    });

    let mut req = api_client()
        .post("https://www.youtube.com/youtubei/v1/player?prettyPrint=false")
        .header("Content-Type", "application/json")
        .header("User-Agent", ANDROID_VR_UA);

    if let Some(vd) = visitor_data {
        req = req.header("X-Goog-Visitor-Id", vd);
    }

    let res = req
        .json(&payload)
        .send()
        .await
        .map_err(|e| format!("Tier 1B (ANDROID_VR) HTTP error: {}", e))?;

    let status = res.status();
    if !status.is_success() {
        let err_body = res.text().await.unwrap_or_default();
        return Err(format!("Tier 1B (ANDROID_VR) HTTP status {}: {}", status, err_body));
    }

    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("Tier 1B (ANDROID_VR) JSON parse error: {}", e))?;

    let (entries, duration) =
        extract_audio_entries_from_player("Tier 1B: ANDROID_VR", video_id, &data, ANDROID_VR_UA)?;

    if let Some(first) = entries.first() {
        if !verify_stream_entry_playable(first, video_id).await {
            return Err(format!(
                "Tier 1B (ANDROID_VR) stream probe rejected with HTTP 403 for {}",
                video_id
            ));
        }
    }

    Ok((entries, duration))
}

// =========================================================================
// TIER 2: AUTO-BOOTSTRAPPED YT-DLP SIDECAR IN %LOCALAPPDATA%
// =========================================================================

/// Ensures `yt-dlp.exe` is present in `%LOCALAPPDATA%\com.crimson.casa\bin\yt-dlp.exe`.
/// Performs a one-time silent atomic download from the official yt-dlp GitHub release if missing.
async fn ensure_yt_dlp_bootstrapped(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let bin_name = if cfg!(windows) {
        "yt-dlp.exe"
    } else {
        "yt-dlp"
    };

    let local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Cannot resolve app_local_data_dir: {}", e))?;
    let bin_dir = local_data.join("bin");
    let target_bin = bin_dir.join(bin_name);

    if target_bin.is_file() {
        return Ok(target_bin);
    }

    let bootstrap_mutex = YTDLP_BOOTSTRAP_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = bootstrap_mutex.lock().await;

    if target_bin.is_file() {
        return Ok(target_bin);
    }

    std::fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Failed creating bin directory {:?}: {}", bin_dir, e))?;

    let download_url = if cfg!(windows) {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe"
    } else if cfg!(target_os = "macos") {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos"
    } else {
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp"
    };

    println!(
        "[NativeAudio] Bootstrapping official {} to {:?}...",
        bin_name, target_bin
    );

    let res = stream_client()
        .get(download_url)
        .header("User-Agent", "CASA-Desktop-Audio-Engine/0.1")
        .send()
        .await
        .map_err(|e| format!("Failed downloading yt-dlp binary: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "GitHub release download returned HTTP {}",
            res.status()
        ));
    }

    let bytes = res
        .bytes()
        .await
        .map_err(|e| format!("Failed reading yt-dlp binary bytes: {}", e))?;

    let tmp_path = bin_dir.join(format!("{}.part", bin_name));
    std::fs::write(&tmp_path, &bytes)
        .map_err(|e| format!("Failed writing temp binary {:?}: {}", tmp_path, e))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(&tmp_path) {
            let mut perms = meta.permissions();
            perms.set_mode(0o755);
            let _ = std::fs::set_permissions(&tmp_path, perms);
        }
    }

    std::fs::rename(&tmp_path, &target_bin)
        .map_err(|e| format!("Failed renaming {:?} to {:?}: {}", tmp_path, target_bin, e))?;

    println!(
        "[NativeAudio] Successfully bootstrapped {} ({:.2} MB)",
        bin_name,
        bytes.len() as f64 / (1024.0 * 1024.0)
    );

    Ok(target_bin)
}

async fn resolve_tier2_yt_dlp(
    app: &tauri::AppHandle,
    video_id: &str,
) -> Result<Vec<AudioStreamEntry>, String> {
    if !is_valid_video_id(video_id) {
        return Err("Invalid videoId rejected by security guard".to_string());
    }

    let bin_path = ensure_yt_dlp_bootstrapped(app).await?;
    let safe_url = format!("https://www.youtube.com/watch?v={}", video_id);

    println!(
        "[NativeAudio] [Tier 2: yt-dlp] Executing {:?} for video_id={}",
        bin_path, video_id
    );

    let output = tokio::time::timeout(
        Duration::from_secs(15),
        tokio::task::spawn_blocking(move || {
            let mut cmd = std::process::Command::new(&bin_path);
            #[cfg(windows)]
            {
                use std::os::windows::process::CommandExt;
                const CREATE_NO_WINDOW: u32 = 0x08000000;
                cmd.creation_flags(CREATE_NO_WINDOW);
            }
            cmd.args([
                "--ignore-config",
                "--no-exec",
                "--no-playlist",
                "--no-warnings",
                "--allowed-extractors",
                "youtube,youtube:tab",
                "-f",
                "251/250/140/bestaudio[ext=webm]/bestaudio[ext=m4a]/bestaudio",
                "--get-url",
                "--",
                &safe_url,
            ])
            .output()
        }),
    )
    .await
    .map_err(|_| "Tier 2 (yt-dlp) timed out after 15s".to_string())?
    .map_err(|e| format!("Tier 2 (yt-dlp) join error: {}", e))?
    .map_err(|e| format!("Tier 2 (yt-dlp) spawn failed: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        eprintln!("[NativeAudio] [Tier 2: yt-dlp] Error: {}", stderr.trim());
        return Err(format!(
            "Tier 2 (yt-dlp) exited with error: {}",
            stderr.trim()
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout);
    let entries: Vec<AudioStreamEntry> = stdout
        .lines()
        .map(|l| l.trim())
        .filter(|l| l.starts_with("https://"))
        .map(|url| {
            let mime = if url.contains("mime=audio%2Fwebm") || url.contains("mime=audio/webm") {
                "audio/webm".to_string()
            } else {
                "audio/mp4".to_string()
            };
            AudioStreamEntry {
                url: url.to_string(),
                mime_type: mime,
                user_agent: VISIONOS_UA.to_string(),
            }
        })
        .collect();

    if entries.is_empty() {
        return Err("Tier 2 (yt-dlp) returned 0 valid stream URLs".to_string());
    }

    println!(
        "[NativeAudio] [Tier 2: yt-dlp] Successfully extracted {} stream URL(s) for {}",
        entries.len(),
        video_id
    );

    Ok(entries)
}

/// Registers resolved upstream URLs in the local proxy registry and builds `http://127.0.0.1:{port}/stream/{id}?idx={i}` candidates.
async fn build_proxied_candidates(
    video_id: &str,
    entries: Vec<AudioStreamEntry>,
) -> Vec<String> {
    let direct_urls: Vec<String> = entries.iter().map(|e| e.url.clone()).collect();

    if let Ok(mut guard) = stream_registry().lock() {
        guard.insert(video_id.to_string(), entries.clone());
    }

    match ensure_local_stream_proxy().await {
        Ok(port) => {
            let mut candidates: Vec<String> = (0..entries.len())
                .map(|idx| format!("http://127.0.0.1:{}/stream/{}?idx={}", port, video_id, idx))
                .collect();
            // Append raw upstream URLs as fallback candidates behind the local proxy
            for u in direct_urls {
                if !candidates.contains(&u) {
                    candidates.push(u);
                }
            }
            candidates
        }
        Err(e) => {
            eprintln!("[NativeAudio] Local proxy fallback to direct URLs: {}", e);
            direct_urls
        }
    }
}

// =========================================================================
// TAURI IPC COMMANDS
// =========================================================================

#[tauri::command]
pub async fn search_tracks_native(query: String) -> Result<Vec<NativeTrack>, String> {
    let clean_query = sanitize_search_query(&query);
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    let mut results = match search_yt_music_innertube(&clean_query).await {
        Ok(list) => list,
        Err(err) => {
            eprintln!("[NativeAudio] YT Music InnerTube search warning: {}", err);
            Vec::new()
        }
    };

    if results.len() < 3 {
        if let Ok(fallback_list) = search_yt_standard_innertube(&clean_query).await {
            let existing_ids: HashSet<String> = results.iter().map(|t| t.id.clone()).collect();
            for item in fallback_list {
                if !existing_ids.contains(&item.id) {
                    results.push(item);
                    if results.len() >= 15 {
                        break;
                    }
                }
            }
        }
    }

    Ok(results)
}

#[tauri::command]
pub async fn resolve_track_stream(
    app: tauri::AppHandle,
    video_id: String,
    title: Option<String>,
    artist: Option<String>,
) -> Result<ResolvedStreamResponse, String> {
    let mut target_id = video_id.trim().to_string();
    println!(
        "\n[NativeAudio] === Resolving track stream: id='{}', title='{:?}', artist='{:?}' ===",
        target_id, title, artist
    );

    if !is_valid_video_id(&target_id) {
        let lookup_query = format!(
            "{} {}",
            artist.unwrap_or_default(),
            title.unwrap_or_default()
        );
        let found = search_tracks_native(lookup_query).await?;
        if let Some(first) = found.first() {
            println!(
                "[NativeAudio] Resolved non-YouTube ID '{}' -> '{}'",
                target_id, first.id
            );
            target_id = first.id.clone();
        } else {
            return Err(
                "Tidak dapat menemukan videoId YouTube yang valid untuk lagu ini".to_string(),
            );
        }
    }

    // Obtain cached or fresh visitorData token for InnerTube authentication
    let mut visitor_data = get_or_fetch_visitor_data(false).await;

    // Tier 1A: Fast Native InnerTube VISIONOS Extractor (with visitorData)
    match resolve_tier1_visionos(&target_id, visitor_data.as_deref()).await {
        Ok((entries, duration_seconds)) => {
            let candidates = build_proxied_candidates(&target_id, entries).await;
            println!(
                "[NativeAudio] Resolved {} via [innertube_visionos_proxied] ({} candidates)",
                target_id,
                candidates.len()
            );
            return Ok(ResolvedStreamResponse {
                video_id: target_id,
                duration_seconds,
                candidates,
                source_tier: "innertube_visionos_proxied".to_string(),
            });
        }
        Err(e) => {
            eprintln!("[NativeAudio] {}", e);
            // Retry once with a force-refreshed visitorData token if cached token expired
            visitor_data = get_or_fetch_visitor_data(true).await;
            if let Ok((entries, duration_seconds)) =
                resolve_tier1_visionos(&target_id, visitor_data.as_deref()).await
            {
                let candidates = build_proxied_candidates(&target_id, entries).await;
                println!(
                    "[NativeAudio] Resolved {} via [innertube_visionos_refreshed] ({} candidates)",
                    target_id,
                    candidates.len()
                );
                return Ok(ResolvedStreamResponse {
                    video_id: target_id,
                    duration_seconds,
                    candidates,
                    source_tier: "innertube_visionos_proxied".to_string(),
                });
            }
        }
    }

    // Tier 1B: Fast Native InnerTube ANDROID_VR Extractor
    match resolve_tier1_android_vr(&target_id, visitor_data.as_deref()).await {
        Ok((entries, duration_seconds)) => {
            let candidates = build_proxied_candidates(&target_id, entries).await;
            println!(
                "[NativeAudio] Resolved {} via [innertube_android_vr_proxied] ({} candidates)",
                target_id,
                candidates.len()
            );
            return Ok(ResolvedStreamResponse {
                video_id: target_id,
                duration_seconds,
                candidates,
                source_tier: "innertube_android_vr_proxied".to_string(),
            });
        }
        Err(e) => {
            eprintln!("[NativeAudio] {}", e);
        }
    }

    // Tier 2: Auto-Bootstrapped yt-dlp Sidecar in %LOCALAPPDATA%
    match resolve_tier2_yt_dlp(&app, &target_id).await {
        Ok(entries) => {
            let candidates = build_proxied_candidates(&target_id, entries).await;
            println!(
                "[NativeAudio] Resolved {} via [yt_dlp_sidecar_proxied] ({} candidates)",
                target_id,
                candidates.len()
            );
            Ok(ResolvedStreamResponse {
                video_id: target_id,
                duration_seconds: None,
                candidates,
                source_tier: "yt_dlp_sidecar_proxied".to_string(),
            })
        }
        Err(e) => Err(format!(
            "Semua tier ekstraksi gagal untuk {} (Tier 2: {})",
            target_id, e
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_drip_babymonster_visionos_and_local_proxy() {
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .expect("Failed building tokio runtime");

        rt.block_on(async {
            let vd = get_or_fetch_visitor_data(false).await;
            assert!(vd.is_some(), "Should obtain InnerTube visitorData");

            for video_id in ["HkiaLCniIj8", "cXvi0qdC6FU"] {
                let (entries, dur) = resolve_tier1_visionos(video_id, vd.as_deref())
                    .await
                    .expect("VISIONOS should resolve DRIP - BABYMONSTER");
                assert!(!entries.is_empty(), "Should have audio stream entries");
                assert!(dur.unwrap_or(0) > 150, "Duration should be > 150s");

                let candidates = build_proxied_candidates(video_id, entries).await;
                assert!(
                    candidates[0].starts_with("http://127.0.0.1:"),
                    "First candidate must be Local Audio Stream Proxy URL"
                );

                // Test fetching through the Local Audio Stream Proxy with open-ended Range: bytes=0- (exact WebView2 behavior)
                let t0 = Instant::now();
                let mut proxy_res = stream_client()
                    .get(&candidates[0])
                    .header("Range", "bytes=0-")
                    .send()
                    .await
                    .expect("Local proxy should respond");

                assert_eq!(proxy_res.status().as_u16(), 206);
                let mut received = 0usize;
                while let Ok(Some(chunk)) = proxy_res.chunk().await {
                    received += chunk.len();
                    if received >= 524_288 {
                        break;
                    }
                }
                println!(
                    "[Test Telemetry] Downloaded {} bytes via open-ended Range: bytes=0- in {}ms",
                    received,
                    t0.elapsed().as_millis()
                );
                assert!(received >= 524_288);
            }
        });
    }
}
