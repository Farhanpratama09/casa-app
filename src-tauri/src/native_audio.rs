use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet, VecDeque};
use std::path::{Path, PathBuf};
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
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub album_title: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub browse_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playlist_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result_kind: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchCollectionItem {
    pub id: String,
    pub title: String,
    pub subtitle: String,
    pub kind: String,
    pub browse_id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub playlist_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub artist_id: Option<String>,
    pub thumbnail_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchResponse {
    pub query: String,
    pub gl: String,
    pub hl: String,
    pub top_songs: Vec<NativeTrack>,
    pub songs: Vec<NativeTrack>,
    pub albums: Vec<SearchCollectionItem>,
    pub playlists: Vec<SearchCollectionItem>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_artist_name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub top_artist_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegionLocaleInfo {
    pub gl: String,
    pub hl: String,
    pub detected_gl: String,
    pub detected_hl: String,
}

const YT_MUSIC_UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

fn is_valid_innertube_id(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
}

fn default_hl_for_gl(gl: &str) -> &'static str {
    match gl {
        "ID" => "id",
        "KR" => "ko",
        "JP" => "ja",
        _ => "en",
    }
}

pub fn normalize_region_pair(
    region_override: Option<&str>,
    detected_gl: &str,
    detected_hl: &str,
) -> (String, String) {
    let trimmed = region_override.unwrap_or("auto").trim().to_ascii_uppercase();
    match trimmed.as_str() {
        "ID" => ("ID".to_string(), "id".to_string()),
        "US" => ("US".to_string(), "en".to_string()),
        "KR" => ("KR".to_string(), "ko".to_string()),
        "JP" => ("JP".to_string(), "ja".to_string()),
        _ => {
            let gl = if detected_gl.len() == 2
                && detected_gl.chars().all(|c| c.is_ascii_alphabetic())
            {
                detected_gl.to_ascii_uppercase()
            } else {
                "US".to_string()
            };
            let primary_lang = detected_hl
                .split(['-', '_', '.'])
                .next()
                .unwrap_or("")
                .trim()
                .to_ascii_lowercase();
            let hl = if matches!(primary_lang.len(), 2 | 3)
                && primary_lang.chars().all(|c| c.is_ascii_alphabetic())
            {
                primary_lang
            } else {
                default_hl_for_gl(&gl).to_string()
            };
            (gl, hl)
        }
    }
}

#[cfg(target_os = "windows")]
pub fn detect_os_gl_hl() -> (String, String) {
    use windows::Win32::Globalization::{GetUserDefaultGeoName, GetUserDefaultLocaleName};

    let mut geo_buf = [0u16; 16];
    let geo_len = unsafe { GetUserDefaultGeoName(&mut geo_buf) };
    let geo = if geo_len > 1 {
        String::from_utf16_lossy(&geo_buf[..(geo_len as usize - 1)])
            .trim()
            .to_ascii_uppercase()
    } else {
        String::new()
    };

    let mut loc_buf = [0u16; 96];
    let loc_len = unsafe { GetUserDefaultLocaleName(&mut loc_buf) };
    let locale = if loc_len > 1 {
        String::from_utf16_lossy(&loc_buf[..(loc_len as usize - 1)])
            .trim()
            .to_string()
    } else {
        String::new()
    };

    let mut gl = if geo.len() == 2 && geo.chars().all(|c| c.is_ascii_alphabetic()) {
        geo
    } else {
        String::new()
    };

    let mut parts = locale.split(['-', '_']);
    let lang_subtag = parts.next().unwrap_or("").trim().to_ascii_lowercase();
    let region_subtag = parts.next().unwrap_or("").trim().to_ascii_uppercase();

    if gl.is_empty() && region_subtag.len() == 2 && region_subtag.chars().all(|c| c.is_ascii_alphabetic()) {
        gl = region_subtag;
    }
    if gl.is_empty() {
        gl = "US".to_string();
    }

    let hl = if matches!(lang_subtag.len(), 2 | 3)
        && lang_subtag.chars().all(|c| c.is_ascii_alphabetic())
    {
        lang_subtag
    } else {
        default_hl_for_gl(&gl).to_string()
    };

    (gl, hl)
}

#[cfg(not(target_os = "windows"))]
pub fn detect_os_gl_hl() -> (String, String) {
    let raw = std::env::var("LC_ALL")
        .or_else(|_| std::env::var("LANG"))
        .unwrap_or_else(|_| "en_US".to_string());
    let base = raw.split('.').next().unwrap_or("en_US");
    let mut parts = base.split(['_', '-']);
    let lang = parts.next().unwrap_or("en").to_ascii_lowercase();
    let region = parts.next().unwrap_or("US").to_ascii_uppercase();
    let gl = if region.len() == 2 && region.chars().all(|c| c.is_ascii_alphabetic()) {
        region
    } else {
        "US".to_string()
    };
    let hl = if matches!(lang.len(), 2 | 3) && lang.chars().all(|c| c.is_ascii_alphabetic()) {
        lang
    } else {
        default_hl_for_gl(&gl).to_string()
    };
    (gl, hl)
}

pub fn resolve_region_locale(region_override: Option<&str>) -> (String, String) {
    let (detected_gl, detected_hl) = detect_os_gl_hl();
    normalize_region_pair(region_override, &detected_gl, &detected_hl)
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

const MAX_STREAM_REGISTRY_ENTRIES: usize = 64;

#[derive(Default)]
struct StreamRegistryCache {
    map: HashMap<String, Vec<AudioStreamEntry>>,
    order: VecDeque<String>,
}

impl StreamRegistryCache {
    fn insert(&mut self, video_id: String, entries: Vec<AudioStreamEntry>) {
        if let Some(pos) = self.order.iter().position(|id| id == &video_id) {
            self.order.remove(pos);
        }
        while self.order.len() >= MAX_STREAM_REGISTRY_ENTRIES {
            if let Some(oldest) = self.order.pop_front() {
                self.map.remove(&oldest);
            } else {
                break;
            }
        }
        self.order.push_back(video_id.clone());
        self.map.insert(video_id, entries);
    }

    fn get(&self, video_id: &str) -> Option<&Vec<AudioStreamEntry>> {
        self.map.get(video_id)
    }
}

static API_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static STREAM_CLIENT: OnceLock<reqwest::Client> = OnceLock::new();
static VISITOR_DATA_CACHE: OnceLock<Mutex<Option<(String, Instant)>>> = OnceLock::new();
static STREAM_REGISTRY: OnceLock<Mutex<StreamRegistryCache>> = OnceLock::new();
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

/// Long-lived streaming client (connect timeout only, no total body timeout) for audio proxy.
fn stream_client() -> &'static reqwest::Client {
    STREAM_CLIENT.get_or_init(|| {
        reqwest::Client::builder()
            .pool_max_idle_per_host(12)
            .connect_timeout(Duration::from_secs(8))
            .build()
            .unwrap_or_else(|_| reqwest::Client::new())
    })
}

fn stream_registry() -> &'static Mutex<StreamRegistryCache> {
    STREAM_REGISTRY.get_or_init(|| Mutex::new(StreamRegistryCache::default()))
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

async fn get_or_fetch_visitor_data_for(force_refresh: bool, gl: &str, hl: &str) -> Option<String> {
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
                "hl": hl,
                "gl": gl
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

async fn get_or_fetch_visitor_data(force_refresh: bool) -> Option<String> {
    let (gl, hl) = resolve_region_locale(None);
    get_or_fetch_visitor_data_for(force_refresh, &gl, &hl).await
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

fn sanitize_header_value(raw: &str) -> String {
    raw.chars()
        .filter(|&c| c != '\r' && c != '\n' && !c.is_control())
        .collect()
}

async fn handle_proxy_connection(mut socket: TcpStream) -> Result<(), String> {
    let conn_start = Instant::now();
    // 1. Read full HTTP request headers from client until \r\n\r\n with bounded timeout (5s)
    let mut header_buf = Vec::with_capacity(2048);
    let mut temp = [0u8; 1024];
    let read_res = tokio::time::timeout(Duration::from_secs(5), async {
        loop {
            let n = socket
                .read(&mut temp)
                .await
                .map_err(|e| format!("Socket read error: {}", e))?;
            if n == 0 {
                return Ok::<bool, String>(false);
            }
            header_buf.extend_from_slice(&temp[..n]);
            if header_buf.windows(4).any(|w| w == b"\r\n\r\n") || header_buf.len() >= 8192 {
                return Ok(true);
            }
        }
    })
    .await
    .map_err(|_| "Local proxy header read timed out after 5s".to_string())??;
    if !read_res {
        return Ok(());
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

    // Forward CDN Headers Transparently (strict CR/LF/control sanitization against header injection)
    let headers = upstream_res.headers();
    let content_type = sanitize_header_value(
        headers
            .get(reqwest::header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .unwrap_or(&entry.mime_type),
    );
    let content_type = if content_type.is_empty() {
        "audio/mp4".to_string()
    } else {
        content_type
    };
    let content_length = headers
        .get(reqwest::header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .map(sanitize_header_value)
        .filter(|s| !s.is_empty());
    let content_range = headers
        .get(reqwest::header::CONTENT_RANGE)
        .and_then(|v| v.to_str().ok())
        .map(sanitize_header_value)
        .filter(|s| !s.is_empty());

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
// SEARCH ENGINE, INNERTUBE PARSERS, UP-NEXT & COLLECTION BROWSE
// =========================================================================

fn extract_runs_text(val: &Value) -> String {
    val.as_array()
        .map(|runs| {
            runs.iter()
                .filter_map(|r| r.get("text").and_then(|t| t.as_str()))
                .collect::<Vec<&str>>()
                .join("")
        })
        .unwrap_or_default()
        .trim()
        .to_string()
}

fn extract_page_type(browse_ep: &Value) -> &str {
    browse_ep
        .pointer("/browseEndpointContextSupportedConfigs/browseEndpointContextMusicConfig/pageType")
        .and_then(|v| v.as_str())
        .unwrap_or("")
}

fn upgrade_collection_thumb(raw: &str) -> String {
    if raw.is_empty() {
        return String::new();
    }
    if let Some((base, _)) = raw.split_once("=w") {
        if raw.contains("googleusercontent.com") {
            return format!("{}=w544-h544-l90-rj", base);
        }
    }
    if raw.starts_with("//") {
        return format!("https:{}", raw);
    }
    raw.to_string()
}

fn is_meta_noise_segment(seg: &str) -> bool {
    matches!(
        seg.trim().to_ascii_lowercase().as_str(),
        "song"
            | "lagu"
            | "video"
            | "album"
            | "single"
            | "ep"
            | "playlist"
            | "artist"
            | "artis"
            | "community playlist"
    )
}

fn extract_mrlir_track(
    mrlir: &Value,
    default_artist: Option<&str>,
    default_artist_id: Option<&str>,
    default_album: Option<&str>,
    default_thumb: Option<&str>,
    result_kind: Option<&str>,
) -> Option<NativeTrack> {
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
        return None;
    }

    let flex_cols = mrlir
        .get("flexColumns")
        .and_then(|v| v.as_array())?;
    if flex_cols.is_empty() {
        return None;
    }

    let title = extract_runs_text(
        flex_cols[0]
            .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
            .unwrap_or(&Value::Null),
    );
    if title.is_empty() {
        return None;
    }

    let mut artist_parts: Vec<String> = Vec::new();
    let mut artist_id: Option<String> = None;
    let mut album_title: Option<String> = None;
    let mut duration_seconds: u64 = 0;

    for col in flex_cols.iter().skip(1) {
        let Some(runs) = col
            .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
            .and_then(|v| v.as_array())
        else {
            continue;
        };

        let mut col_text = String::new();
        for run in runs {
            let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("");
            col_text.push_str(text);

            if let Some(bep) = run.pointer("/navigationEndpoint/browseEndpoint") {
                let bid = bep.get("browseId").and_then(|v| v.as_str()).unwrap_or("");
                let page_type = extract_page_type(bep);
                if (page_type == "MUSIC_PAGE_TYPE_ARTIST"
                    || page_type == "MUSIC_PAGE_TYPE_USER_CHANNEL"
                    || bid.starts_with("UC"))
                    && is_valid_innertube_id(bid)
                {
                    if artist_id.is_none() {
                        artist_id = Some(bid.to_string());
                    }
                    let clean_name = text.trim();
                    if !clean_name.is_empty() && !artist_parts.iter().any(|p| p == clean_name) {
                        artist_parts.push(clean_name.to_string());
                    }
                } else if (page_type == "MUSIC_PAGE_TYPE_ALBUM" || bid.starts_with("MPREb_"))
                    && album_title.is_none()
                    && !text.trim().is_empty()
                {
                    album_title = Some(text.trim().to_string());
                }
            }
        }

        for seg in col_text.split(" • ").map(|s| s.trim()).filter(|s| !s.is_empty()) {
            if let Some(dur) = parse_duration_text(seg) {
                if duration_seconds == 0 {
                    duration_seconds = dur;
                }
            } else if artist_parts.is_empty()
                && !is_meta_noise_segment(seg)
                && !seg.ends_with("plays")
                && !seg.ends_with("views")
                && !seg.ends_with("x diputar")
            {
                artist_parts.push(seg.to_string());
            }
        }
    }

    // Fixed column duration fallback (common in album/playlist browse rows)
    if duration_seconds == 0 {
        if let Some(fixed_cols) = mrlir.get("fixedColumns").and_then(|v| v.as_array()) {
            for col in fixed_cols {
                let dur_str = extract_runs_text(
                    col.pointer("/musicResponsiveListItemFixedColumnRenderer/text/runs")
                        .unwrap_or(&Value::Null),
                );
                if let Some(dur) = parse_duration_text(&dur_str) {
                    duration_seconds = dur;
                    break;
                }
            }
        }
    }
    if duration_seconds == 0 {
        duration_seconds = 180;
    }

    let artist = if !artist_parts.is_empty() {
        artist_parts.join(", ")
    } else if let Some(def_a) = default_artist {
        if !def_a.is_empty() {
            def_a.to_string()
        } else {
            "Unknown Artist".to_string()
        }
    } else {
        "Unknown Artist".to_string()
    };

    if artist_id.is_none() {
        artist_id = default_artist_id.map(|s| s.to_string());
    }
    if album_title.is_none() {
        album_title = default_album.map(|s| s.to_string());
    }

    if is_blacklisted_track(&title, &artist) {
        return None;
    }

    let raw_thumb = mrlir
        .pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .or(default_thumb)
        .unwrap_or("");

    let high_res_art = upgrade_artwork_url(raw_thumb, video_id);

    Some(NativeTrack {
        id: video_id.to_string(),
        title,
        artist,
        duration_seconds,
        thumbnail_url: high_res_art.clone(),
        album_art: Some(high_res_art),
        stream_url: None,
        candidates: None,
        artist_id,
        album_title,
        browse_id: None,
        playlist_id: None,
        result_kind: result_kind.map(|s| s.to_string()),
    })
}

fn extract_mrlir_collection(mrlir: &Value) -> Option<SearchCollectionItem> {
    let bep = mrlir.pointer("/navigationEndpoint/browseEndpoint")?;
    let browse_id = bep.get("browseId").and_then(|v| v.as_str()).unwrap_or("");
    if !is_valid_innertube_id(browse_id) {
        return None;
    }

    let page_type = extract_page_type(bep);
    let kind = if page_type == "MUSIC_PAGE_TYPE_ALBUM" || browse_id.starts_with("MPREb_") {
        "album"
    } else if page_type == "MUSIC_PAGE_TYPE_PLAYLIST"
        || browse_id.starts_with("VL")
        || browse_id.starts_with("RDCLAK")
    {
        "playlist"
    } else {
        return None;
    };

    let flex_cols = mrlir.get("flexColumns").and_then(|v| v.as_array())?;
    if flex_cols.is_empty() {
        return None;
    }

    let title = extract_runs_text(
        flex_cols[0]
            .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
            .unwrap_or(&Value::Null),
    );
    if title.is_empty() {
        return None;
    }

    let mut subtitle_parts: Vec<String> = Vec::new();
    let mut artist_id: Option<String> = None;
    for col in flex_cols.iter().skip(1) {
        if let Some(runs) = col
            .pointer("/musicResponsiveListItemFlexColumnRenderer/text/runs")
            .and_then(|v| v.as_array())
        {
            for run in runs {
                if artist_id.is_none() {
                    if let Some(abep) = run.pointer("/navigationEndpoint/browseEndpoint") {
                        let abid = abep.get("browseId").and_then(|v| v.as_str()).unwrap_or("");
                        let apt = extract_page_type(abep);
                        if (apt == "MUSIC_PAGE_TYPE_ARTIST" || abid.starts_with("UC"))
                            && is_valid_innertube_id(abid)
                        {
                            artist_id = Some(abid.to_string());
                        }
                    }
                }
            }
            let text = extract_runs_text(&Value::Array(runs.clone()));
            if !text.is_empty() {
                subtitle_parts.push(text);
            }
        }
    }

    let playlist_id = mrlir
        .pointer("/overlay/musicItemThumbnailOverlayRenderer/content/musicPlayButtonRenderer/playNavigationEndpoint/watchPlaylistEndpoint/playlistId")
        .and_then(|v| v.as_str())
        .filter(|id| is_valid_innertube_id(id))
        .map(|s| s.to_string())
        .or_else(|| {
            if kind == "playlist" && browse_id.starts_with("VL") && browse_id.len() > 2 {
                Some(browse_id[2..].to_string())
            } else {
                None
            }
        });

    let raw_thumb = mrlir
        .pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str())
        .unwrap_or("");

    Some(SearchCollectionItem {
        id: browse_id.to_string(),
        title,
        subtitle: subtitle_parts.join(" • "),
        kind: kind.to_string(),
        browse_id: browse_id.to_string(),
        playlist_id,
        artist_id,
        thumbnail_url: upgrade_collection_thumb(raw_thumb),
    })
}

fn is_top_songs_section_title(title: &str) -> bool {
    let low = title.trim().to_ascii_lowercase();
    low.contains("top song")
        || low.contains("lagu teratas")
        || low.contains("lagu populer")
        || low.contains("popular")
}

pub fn parse_yt_music_catalog_response(
    query: &str,
    gl: &str,
    hl: &str,
    unfiltered: Option<&Value>,
    songs_only: Option<&Value>,
) -> CatalogSearchResponse {
    let mut top_songs: Vec<NativeTrack> = Vec::new();
    let mut songs: Vec<NativeTrack> = Vec::new();
    let mut albums: Vec<SearchCollectionItem> = Vec::new();
    let mut playlists: Vec<SearchCollectionItem> = Vec::new();
    let mut seen_top_ids: HashSet<String> = HashSet::new();
    let mut seen_song_keys: HashSet<String> = HashSet::new();
    let mut seen_album_ids: HashSet<String> = HashSet::new();
    let mut seen_playlist_ids: HashSet<String> = HashSet::new();
    let mut top_artist_name: Option<String> = None;
    let mut top_artist_id: Option<String> = None;

    if let Some(data) = unfiltered {
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
                // Top result card (`musicCardShelfRenderer`)
                if let Some(card) = sec.get("musicCardShelfRenderer") {
                    let card_title = extract_runs_text(
                        card.pointer("/title/runs").unwrap_or(&Value::Null),
                    );
                    if let Some(bep) = card.pointer("/title/runs/0/navigationEndpoint/browseEndpoint") {
                        let bid = bep.get("browseId").and_then(|v| v.as_str()).unwrap_or("");
                        let pt = extract_page_type(bep);
                        if (pt == "MUSIC_PAGE_TYPE_ARTIST" || bid.starts_with("UC"))
                            && is_valid_innertube_id(bid)
                        {
                            top_artist_name = if card_title.is_empty() {
                                None
                            } else {
                                Some(card_title.clone())
                            };
                            top_artist_id = Some(bid.to_string());
                        } else if (pt == "MUSIC_PAGE_TYPE_ALBUM" || bid.starts_with("MPREb_"))
                            && is_valid_innertube_id(bid)
                            && seen_album_ids.insert(bid.to_string())
                        {
                            let subtitle = extract_runs_text(
                                card.pointer("/subtitle/runs").unwrap_or(&Value::Null),
                            );
                            let raw_thumb = card
                                .pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
                                .and_then(|v| v.as_array())
                                .and_then(|arr| arr.last())
                                .and_then(|t| t.get("url"))
                                .and_then(|u| u.as_str())
                                .unwrap_or("");
                            let playlist_id = card
                                .pointer("/buttons/0/buttonRenderer/navigationEndpoint/watchPlaylistEndpoint/playlistId")
                                .or_else(|| card.pointer("/onTap/watchPlaylistEndpoint/playlistId"))
                                .and_then(|v| v.as_str())
                                .filter(|id| is_valid_innertube_id(id))
                                .map(|s| s.to_string());
                            albums.push(SearchCollectionItem {
                                id: bid.to_string(),
                                title: card_title.clone(),
                                subtitle,
                                kind: "album".to_string(),
                                browse_id: bid.to_string(),
                                playlist_id,
                                artist_id: None,
                                thumbnail_url: upgrade_collection_thumb(raw_thumb),
                            });
                        }
                    }

                    if let Some(contents) = card.get("contents").and_then(|v| v.as_array()) {
                        for item in contents {
                            if let Some(mrlir) = item.get("musicResponsiveListItemRenderer") {
                                if let Some(track) = extract_mrlir_track(
                                    mrlir,
                                    top_artist_name.as_deref(),
                                    top_artist_id.as_deref(),
                                    None,
                                    None,
                                    Some("top_song"),
                                ) {
                                    if seen_top_ids.insert(track.id.clone()) {
                                        top_songs.push(track);
                                    }
                                } else if let Some(coll) = extract_mrlir_collection(mrlir) {
                                    if coll.kind == "album" {
                                        if seen_album_ids.insert(coll.browse_id.clone()) {
                                            albums.push(coll);
                                        }
                                    } else if seen_playlist_ids.insert(coll.browse_id.clone()) {
                                        playlists.push(coll);
                                    }
                                }
                            }
                        }
                    }
                }

                // Shelf sections (`musicShelfRenderer`)
                if let Some(shelf) = sec.get("musicShelfRenderer") {
                    let shelf_title = extract_runs_text(
                        shelf.pointer("/title/runs").unwrap_or(&Value::Null),
                    );
                    let is_top_shelf = is_top_songs_section_title(&shelf_title);
                    if let Some(items) = shelf.get("contents").and_then(|v| v.as_array()) {
                        for item in items {
                            let Some(mrlir) = item.get("musicResponsiveListItemRenderer") else {
                                continue;
                            };
                            if let Some(coll) = extract_mrlir_collection(mrlir) {
                                if coll.kind == "album" {
                                    if seen_album_ids.insert(coll.browse_id.clone()) && albums.len() < 8 {
                                        albums.push(coll);
                                    }
                                } else if seen_playlist_ids.insert(coll.browse_id.clone()) && playlists.len() < 8 {
                                    playlists.push(coll);
                                }
                                continue;
                            }
                            if let Some(track) = extract_mrlir_track(
                                mrlir,
                                None,
                                None,
                                None,
                                None,
                                Some(if is_top_shelf { "top_song" } else { "song" }),
                            ) {
                                if is_top_shelf {
                                    if seen_top_ids.insert(track.id.clone()) && top_songs.len() < 8 {
                                        top_songs.push(track);
                                    }
                                } else {
                                    let dedup_key = format!(
                                        "{}|{}",
                                        track.title.to_lowercase(),
                                        track.artist.to_lowercase()
                                    );
                                    if seen_song_keys.insert(dedup_key) && songs.len() < 15 {
                                        songs.push(track);
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if let Some(data) = songs_only {
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
                    if let Some(track) =
                        extract_mrlir_track(mrlir, None, None, None, None, Some("song"))
                    {
                        let dedup_key = format!(
                            "{}|{}",
                            track.title.to_lowercase(),
                            track.artist.to_lowercase()
                        );
                        if seen_song_keys.insert(dedup_key) && songs.len() < 15 {
                            songs.push(track);
                        }
                    }
                }
            }
        }
    }

    CatalogSearchResponse {
        query: query.to_string(),
        gl: gl.to_string(),
        hl: hl.to_string(),
        top_songs,
        songs,
        albums,
        playlists,
        top_artist_name,
        top_artist_id,
    }
}

pub fn parse_up_next_response(seed_video_id: &str, data: &Value) -> (Vec<NativeTrack>, Option<String>) {
    let mut tracks = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut automix_playlist_id: Option<String> = None;

    let contents = data
        .pointer("/contents/singleColumnMusicWatchNextResultsRenderer/tabbedRenderer/watchNextTabbedResultsRenderer/tabs/0/tabRenderer/content/musicQueueRenderer/content/playlistPanelRenderer/contents")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();

    for entry in contents {
        if let Some(automix_pid) = entry
            .pointer("/automixPreviewVideoRenderer/content/automixPlaylistVideoRenderer/navigationEndpoint/watchPlaylistEndpoint/playlistId")
            .and_then(|v| v.as_str())
        {
            if is_valid_innertube_id(automix_pid) && automix_playlist_id.is_none() {
                automix_playlist_id = Some(automix_pid.to_string());
            }
        }

        let Some(pvr) = entry
            .get("playlistPanelVideoRenderer")
            .or_else(|| entry.pointer("/playlistPanelVideoWrapperRenderer/primaryRenderer/playlistPanelVideoRenderer"))
        else {
            continue;
        };

        let video_id = pvr.get("videoId").and_then(|v| v.as_str()).unwrap_or("");
        if !is_valid_video_id(video_id) || (!seed_video_id.is_empty() && video_id == seed_video_id) {
            continue;
        }
        if pvr.get("selected").and_then(|v| v.as_bool()) == Some(true) {
            continue;
        }

        let title = extract_runs_text(
            pvr.pointer("/title/runs").unwrap_or(&Value::Null),
        );
        if title.is_empty() {
            continue;
        }

        let mut artist_parts: Vec<String> = Vec::new();
        let mut artist_id: Option<String> = None;
        let mut album_title: Option<String> = None;

        for byline_ptr in ["/longBylineText/runs", "/shortBylineText/runs"] {
            if let Some(runs) = pvr.pointer(byline_ptr).and_then(|v| v.as_array()) {
                for run in runs {
                    let text = run.get("text").and_then(|t| t.as_str()).unwrap_or("").trim();
                    if let Some(bep) = run.pointer("/navigationEndpoint/browseEndpoint") {
                        let bid = bep.get("browseId").and_then(|v| v.as_str()).unwrap_or("");
                        let pt = extract_page_type(bep);
                        if (pt == "MUSIC_PAGE_TYPE_ARTIST"
                            || pt == "MUSIC_PAGE_TYPE_USER_CHANNEL"
                            || bid.starts_with("UC"))
                            && is_valid_innertube_id(bid)
                        {
                            if artist_id.is_none() {
                                artist_id = Some(bid.to_string());
                            }
                            if !text.is_empty() && !artist_parts.iter().any(|p| p == text) {
                                artist_parts.push(text.to_string());
                            }
                        } else if (pt == "MUSIC_PAGE_TYPE_ALBUM" || bid.starts_with("MPREb_"))
                            && album_title.is_none()
                            && !text.is_empty()
                        {
                            album_title = Some(text.to_string());
                        }
                    }
                }
                if artist_parts.is_empty() {
                    let full_byline = extract_runs_text(&Value::Array(runs.clone()));
                    for seg in full_byline.split(" • ").map(|s| s.trim()).filter(|s| !s.is_empty()) {
                        if !is_meta_noise_segment(seg) && parse_duration_text(seg).is_none() && seg.parse::<u16>().is_err() {
                            artist_parts.push(seg.to_string());
                            break;
                        }
                    }
                }
                if !artist_parts.is_empty() {
                    break;
                }
            }
        }

        let artist = if artist_parts.is_empty() {
            "Unknown Artist".to_string()
        } else {
            artist_parts.join(", ")
        };

        if is_blacklisted_track(&title, &artist) {
            continue;
        }

        let len_str = extract_runs_text(pvr.pointer("/lengthText/runs").unwrap_or(&Value::Null));
        let duration_seconds = parse_duration_text(&len_str).unwrap_or(180);
        if duration_seconds > 600 || duration_seconds < 30 {
            continue;
        }

        let raw_thumb = pvr
            .pointer("/thumbnail/thumbnails")
            .and_then(|v| v.as_array())
            .and_then(|arr| arr.last())
            .and_then(|t| t.get("url"))
            .and_then(|u| u.as_str())
            .unwrap_or("");
        let high_res_art = upgrade_artwork_url(raw_thumb, video_id);

        if seen_ids.insert(video_id.to_string()) {
            tracks.push(NativeTrack {
                id: video_id.to_string(),
                title,
                artist,
                duration_seconds,
                thumbnail_url: high_res_art.clone(),
                album_art: Some(high_res_art),
                stream_url: None,
                candidates: None,
                artist_id,
                album_title,
                browse_id: None,
                playlist_id: None,
                result_kind: Some("song".to_string()),
            });
        }
    }

    (tracks, automix_playlist_id)
}

pub fn parse_browse_tracks_response(browse_id: &str, data: &Value) -> (Vec<NativeTrack>, Option<String>) {
    let header_node = data
        .pointer("/contents/twoColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicResponsiveHeaderRenderer")
        .or_else(|| data.pointer("/contents/twoColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents/0/musicEditablePlaylistDetailHeaderRenderer/header/musicResponsiveHeaderRenderer"))
        .or_else(|| data.pointer("/header/musicDetailHeaderRenderer"))
        .or_else(|| data.pointer("/header/musicImmersiveHeaderRenderer"))
        .or_else(|| data.pointer("/header/musicVisualHeaderRenderer"))
        .or_else(|| data.pointer("/header/musicEditablePlaylistDetailHeaderRenderer/header/musicDetailHeaderRenderer"));

    let header_title = header_node
        .and_then(|h| h.pointer("/title/runs"))
        .map(extract_runs_text)
        .filter(|s| !s.is_empty());

    let header_artist = if browse_id.starts_with("UC") {
        header_title.clone()
    } else {
        header_node
            .and_then(|h| {
                h.pointer("/straplineTextOne/runs")
                    .or_else(|| h.pointer("/subtitle/runs"))
            })
            .and_then(|v| v.as_array())
            .and_then(|runs| {
                runs.iter()
                    .find(|r| {
                        r.pointer("/navigationEndpoint/browseEndpoint").is_some()
                    })
                    .or_else(|| runs.first())
                    .and_then(|r| r.get("text"))
                    .and_then(|t| t.as_str())
                    .map(|s| s.trim().to_string())
            })
            .filter(|s| !s.is_empty() && !is_meta_noise_segment(s))
    };

    let header_artist_id = if browse_id.starts_with("UC") && is_valid_innertube_id(browse_id) {
        Some(browse_id.to_string())
    } else {
        header_node
            .and_then(|h| {
                h.pointer("/straplineTextOne/runs/0/navigationEndpoint/browseEndpoint/browseId")
                    .or_else(|| h.pointer("/subtitle/runs/0/navigationEndpoint/browseEndpoint/browseId"))
            })
            .and_then(|v| v.as_str())
            .filter(|s| is_valid_innertube_id(s))
            .map(|s| s.to_string())
    };

    let header_thumb = header_node
        .and_then(|h| {
            h.pointer("/thumbnail/musicThumbnailRenderer/thumbnail/thumbnails")
                .or_else(|| h.pointer("/thumbnail/croppedSquareThumbnailRenderer/thumbnail/thumbnails"))
                .or_else(|| h.pointer("/foregroundThumbnail/musicThumbnailRenderer/thumbnail/thumbnails"))
        })
        .and_then(|v| v.as_array())
        .and_then(|arr| arr.last())
        .and_then(|t| t.get("url"))
        .and_then(|u| u.as_str());

    let default_album = if browse_id.starts_with("MPREb_") {
        header_title.as_deref()
    } else {
        None
    };

    let mut sections: Vec<Value> = Vec::new();
    for path in [
        "/contents/twoColumnBrowseResultsRenderer/secondaryContents/sectionListRenderer/contents",
        "/contents/singleColumnBrowseResultsRenderer/tabs/0/tabRenderer/content/sectionListRenderer/contents",
    ] {
        if let Some(arr) = data.pointer(path).and_then(|v| v.as_array()) {
            sections.extend(arr.iter().cloned());
        }
    }

    let mut tracks: Vec<NativeTrack> = Vec::new();
    let mut seen_ids: HashSet<String> = HashSet::new();
    let mut more_songs_browse_id: Option<String> = None;

    for sec in sections {
        let shelf_opt = sec
            .get("musicShelfRenderer")
            .or_else(|| sec.get("musicPlaylistShelfRenderer"));
        let Some(shelf) = shelf_opt else {
            continue;
        };

        if more_songs_browse_id.is_none() {
            if let Some(bottom_bid) = shelf
                .pointer("/bottomEndpoint/browseEndpoint/browseId")
                .and_then(|v| v.as_str())
            {
                if is_valid_innertube_id(bottom_bid) {
                    more_songs_browse_id = Some(bottom_bid.to_string());
                }
            }
        }

        let items = shelf
            .get("contents")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();

        for item in items {
            let Some(mrlir) = item.get("musicResponsiveListItemRenderer") else {
                continue;
            };
            if let Some(track) = extract_mrlir_track(
                mrlir,
                header_artist.as_deref(),
                header_artist_id.as_deref(),
                default_album,
                header_thumb,
                Some(if browse_id.starts_with("UC") { "top_song" } else { "song" }),
            ) {
                if seen_ids.insert(track.id.clone()) && tracks.len() < 50 {
                    tracks.push(track);
                }
            }
        }
    }

    (tracks, more_songs_browse_id)
}

async fn yt_music_post(endpoint: &str, body: Value) -> Result<Value, String> {
    let url = format!("https://music.youtube.com/youtubei/v1/{}?prettyPrint=false", endpoint);
    let res = api_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .header("User-Agent", YT_MUSIC_UA)
        .header("Origin", "https://music.youtube.com")
        .header("Referer", "https://music.youtube.com/")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("YT Music {} request failed: {}", endpoint, e))?;

    if !res.status().is_success() {
        return Err(format!("YT Music {} HTTP {}", endpoint, res.status()));
    }

    let data: Value = res
        .json()
        .await
        .map_err(|e| format!("YT Music {} JSON parse failed: {}", endpoint, e))?;

    if let Some(vd) = data
        .pointer("/responseContext/visitorData")
        .and_then(|v| v.as_str())
    {
        cache_visitor_data(vd);
    }

    Ok(data)
}

async fn search_yt_music_innertube_raw(
    query: &str,
    gl: &str,
    hl: &str,
    params: Option<&str>,
) -> Result<Value, String> {
    let mut payload = json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20250101.01.00",
                "hl": hl,
                "gl": gl
            }
        },
        "query": query
    });
    if let Some(p) = params {
        payload["params"] = json!(p);
    }
    yt_music_post("search", payload).await
}

async fn search_yt_music_innertube(
    query: &str,
    gl: &str,
    hl: &str,
) -> Result<Vec<NativeTrack>, String> {
    let data = search_yt_music_innertube_raw(
        query,
        gl,
        hl,
        Some("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
    )
    .await?;
    let parsed = parse_yt_music_catalog_response(query, gl, hl, None, Some(&data));
    Ok(parsed.songs)
}

async fn search_yt_standard_innertube(
    query: &str,
    gl: &str,
    hl: &str,
) -> Result<Vec<NativeTrack>, String> {
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
                "hl": hl,
                "gl": gl
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
                artist_id: None,
                album_title: None,
                browse_id: None,
                playlist_id: None,
                result_kind: Some("song".to_string()),
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
    let (gl, hl) = resolve_region_locale(None);
    let mut client_obj = json!({
        "clientName": "VISIONOS",
        "clientVersion": "0.1",
        "deviceMake": "Apple",
        "deviceModel": "RealityDevice14,1",
        "osName": "visionOS",
        "osVersion": "1.3.21O771",
        "hl": hl,
        "gl": gl
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
    let (gl, hl) = resolve_region_locale(None);
    let mut client_obj = json!({
        "clientName": "ANDROID_VR",
        "clientVersion": "1.60.19",
        "deviceMake": "Oculus",
        "deviceModel": "Quest 3",
        "osName": "Android",
        "osVersion": "12L",
        "androidSdkVersion": 32,
        "hl": hl,
        "gl": gl
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
// TIER 2: PINNED & SHA-256 VERIFIED YT-DLP SIDECAR IN %LOCALAPPDATA%
// =========================================================================

const YTDLP_PINNED_TAG: &str = "2026.11.23";
const YTDLP_WIN_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp.exe";
const YTDLP_WIN_SHA256: &str =
    "622ed48023cac1daa52a3bf3a6ac38f03514de214b5f0fa069389fd0f6d17e5c";
const YTDLP_MACOS_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp_macos";
const YTDLP_MACOS_SHA256: &str =
    "57654854886d0398a798895aadf5173e2749fbb5e249b9f3728022ab376e11fb";
const YTDLP_LINUX_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/download/2026.11.23/yt-dlp";
const YTDLP_LINUX_SHA256: &str =
    "e8665ed64d6b9172773e812f891fb707a0cb1ee8d9ef4fc1acb00cabee4c5256";
const YTDLP_MAX_BINARY_BYTES: usize = 35 * 1024 * 1024;
const YTDLP_DOWNLOAD_TIMEOUT_SECS: u64 = 30;

fn pinned_ytdlp_release() -> (&'static str, &'static str, &'static str) {
    if cfg!(windows) {
        ("yt-dlp.exe", YTDLP_WIN_URL, YTDLP_WIN_SHA256)
    } else if cfg!(target_os = "macos") {
        ("yt-dlp_macos", YTDLP_MACOS_URL, YTDLP_MACOS_SHA256)
    } else {
        ("yt-dlp", YTDLP_LINUX_URL, YTDLP_LINUX_SHA256)
    }
}

pub fn verify_ytdlp_binary_sha256(path: &Path, expected_hex: &str) -> Result<(), String> {
    if !path.is_file() {
        return Err("Biner sidecar tidak ditemukan untuk verifikasi SHA-256".to_string());
    }
    let meta = std::fs::metadata(path)
        .map_err(|e| format!("Gagal membaca metadata biner sidecar: {}", e))?;
    if meta.len() == 0 || meta.len() > YTDLP_MAX_BINARY_BYTES as u64 {
        let _ = std::fs::remove_file(path);
        return Err("Ukuran biner yt-dlp berada di luar batas wajar (berkas dihapus)".to_string());
    }
    let actual = crate::security_utils::sha256_file_hex(path)?;
    if !crate::security_utils::ct_eq(
        actual.as_bytes(),
        expected_hex.to_ascii_lowercase().as_bytes(),
    ) {
        let _ = std::fs::remove_file(path);
        return Err(format!(
            "Verifikasi SHA-256 biner yt-dlp gagal (actual={actual}) — berkas dihapus"
        ));
    }
    Ok(())
}

/// Ensures pinned `yt-dlp.exe` (`2026.11.23`) is present in `%LOCALAPPDATA%\...\bin\yt-dlp.exe`
/// and matches its pinned SHA-256 checksum before execution.
async fn ensure_yt_dlp_bootstrapped(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let (bin_name, download_url, expected_sha256) = pinned_ytdlp_release();

    let local_data = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Cannot resolve app_local_data_dir: {}", e))?;
    let bin_dir = local_data.join("bin");
    let target_bin = bin_dir.join(bin_name);

    if target_bin.is_file() && verify_ytdlp_binary_sha256(&target_bin, expected_sha256).is_ok() {
        return Ok(target_bin);
    }

    let bootstrap_mutex = YTDLP_BOOTSTRAP_LOCK.get_or_init(|| tokio::sync::Mutex::new(()));
    let _guard = bootstrap_mutex.lock().await;

    if target_bin.is_file() && verify_ytdlp_binary_sha256(&target_bin, expected_sha256).is_ok() {
        return Ok(target_bin);
    }

    std::fs::create_dir_all(&bin_dir)
        .map_err(|e| format!("Failed creating bin directory {:?}: {}", bin_dir, e))?;

    println!(
        "[NativeAudio] Bootstrapping pinned {} ({}) to {:?}...",
        bin_name, YTDLP_PINNED_TAG, target_bin
    );

    let download_client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(YTDLP_DOWNLOAD_TIMEOUT_SECS))
        .build()
        .map_err(|e| format!("Failed building yt-dlp download HTTP client: {}", e))?;

    let mut res = download_client
        .get(download_url)
        .header("User-Agent", "CASA-Desktop-Audio-Engine/2.3.2")
        .send()
        .await
        .map_err(|e| format!("Failed downloading yt-dlp binary: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "GitHub release download returned HTTP {}",
            res.status()
        ));
    }

    if let Some(cl) = res.content_length() {
        if cl > YTDLP_MAX_BINARY_BYTES as u64 {
            return Err(format!(
                "Ukuran unduhan yt-dlp ({} bytes) melebihi batas 35 MiB",
                cl
            ));
        }
    }

    let mut bytes = Vec::new();
    while let Some(chunk) = res
        .chunk()
        .await
        .map_err(|e| format!("Failed reading yt-dlp binary chunk: {}", e))?
    {
        if bytes.len().saturating_add(chunk.len()) > YTDLP_MAX_BINARY_BYTES {
            return Err("Ukuran stream unduhan yt-dlp melebihi batas 35 MiB".to_string());
        }
        bytes.extend_from_slice(&chunk);
    }

    let digest_hex = crate::security_utils::sha256_hex(&bytes);
    if !crate::security_utils::ct_eq(
        digest_hex.as_bytes(),
        expected_sha256.to_ascii_lowercase().as_bytes(),
    ) {
        return Err(format!(
            "Hash SHA-256 unduhan yt-dlp ({}) tidak cocok dengan rilis tepercaya ({})",
            digest_hex, YTDLP_PINNED_TAG
        ));
    }

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

    verify_ytdlp_binary_sha256(&target_bin, expected_sha256)?;

    println!(
        "[NativeAudio] Verified & bootstrapped {} ({:.2} MB, SHA-256 ok)",
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
    let (_, _, expected_sha256) = pinned_ytdlp_release();
    verify_ytdlp_binary_sha256(&bin_path, expected_sha256)?;
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
// INNERTUBE NETWORK ORCHESTRATION (UP-NEXT, ARTIST FALLBACK, COLLECTION BROWSE)
// =========================================================================

async fn post_yt_music_next(
    video_id: Option<&str>,
    playlist_id: Option<&str>,
    gl: &str,
    hl: &str,
) -> Result<Value, String> {
    let mut payload = json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20250101.01.00",
                "hl": hl,
                "gl": gl
            }
        },
        "isAudioOnly": true,
        "enablePersistentPlaylistPanel": true,
        "tunerSettingValue": "AUTOMIX_SETTING_NORMAL"
    });
    if let Some(vid) = video_id.filter(|v| is_valid_video_id(v)) {
        payload["videoId"] = json!(vid);
    }
    if let Some(pid) = playlist_id.filter(|p| is_valid_innertube_id(p)) {
        payload["playlistId"] = json!(pid);
    }
    yt_music_post("next", payload).await
}

async fn post_yt_music_browse(browse_id: &str, gl: &str, hl: &str) -> Result<Value, String> {
    let payload = json!({
        "context": {
            "client": {
                "clientName": "WEB_REMIX",
                "clientVersion": "1.20250101.01.00",
                "hl": hl,
                "gl": gl
            }
        },
        "browseId": browse_id
    });
    yt_music_post("browse", payload).await
}

async fn fetch_up_next_innertube(
    video_id: Option<&str>,
    playlist_id: Option<&str>,
    gl: &str,
    hl: &str,
) -> Result<Vec<NativeTrack>, String> {
    let seed_vid = video_id.filter(|v| is_valid_video_id(v));
    let explicit_pid = playlist_id.filter(|p| is_valid_innertube_id(p));

    if seed_vid.is_none() && explicit_pid.is_none() {
        return Ok(Vec::new());
    }

    let radio_pid_buf;
    let first_pid = if let Some(pid) = explicit_pid {
        Some(pid)
    } else if let Some(vid) = seed_vid {
        radio_pid_buf = format!("RDAMVM{}", vid);
        Some(radio_pid_buf.as_str())
    } else {
        None
    };

    let seed_str = seed_vid.unwrap_or("");
    let data = post_yt_music_next(seed_vid, first_pid, gl, hl).await?;
    let (mut tracks, automix_pid) = parse_up_next_response(seed_str, &data);

    // Follow automix playlist pointer once if initial panel returned empty
    if tracks.is_empty() {
        if let Some(ref apid) = automix_pid {
            if Some(apid.as_str()) != first_pid {
                if let Ok(follow) = post_yt_music_next(seed_vid, Some(apid.as_str()), gl, hl).await {
                    let (follow_tracks, _) = parse_up_next_response(seed_str, &follow);
                    tracks = follow_tracks;
                }
            }
        }
    }

    // Retry once without synthetic RDAMVM prefix if still empty
    if tracks.is_empty() && explicit_pid.is_none() && seed_vid.is_some() {
        if let Ok(plain) = post_yt_music_next(seed_vid, None, gl, hl).await {
            let (plain_tracks, plain_automix) = parse_up_next_response(seed_str, &plain);
            tracks = plain_tracks;
            if tracks.is_empty() {
                if let Some(ref apid) = plain_automix {
                    if let Ok(follow) =
                        post_yt_music_next(seed_vid, Some(apid.as_str()), gl, hl).await
                    {
                        let (follow_tracks, _) = parse_up_next_response(seed_str, &follow);
                        tracks = follow_tracks;
                    }
                }
            }
        }
    }

    Ok(tracks)
}

async fn resolve_artist_id_by_name(
    artist_name: &str,
    gl: &str,
    hl: &str,
) -> Option<String> {
    let clean = sanitize_search_query(artist_name);
    if clean.is_empty() {
        return None;
    }

    // Search YT Music official Artists tab first (`EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D`)
    if let Ok(data) = search_yt_music_innertube_raw(
        &clean,
        gl,
        hl,
        Some("EgWKAQIgAWoKEAkQBRAKEAMQBA%3D%3D"),
    )
    .await
    {
        if let Some(tabs) = data
            .pointer("/contents/tabbedSearchResultsRenderer/tabs")
            .and_then(|v| v.as_array())
        {
            for tab in tabs {
                if let Some(sections) = tab
                    .pointer("/tabRenderer/content/sectionListRenderer/contents")
                    .and_then(|v| v.as_array())
                {
                    for sec in sections {
                        if let Some(items) = sec
                            .pointer("/musicShelfRenderer/contents")
                            .and_then(|v| v.as_array())
                        {
                            for item in items {
                                if let Some(bid) = item
                                    .pointer("/musicResponsiveListItemRenderer/navigationEndpoint/browseEndpoint/browseId")
                                    .and_then(|v| v.as_str())
                                {
                                    if is_valid_innertube_id(bid) && bid.starts_with("UC") {
                                        return Some(bid.to_string());
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    None
}

async fn fetch_artist_top_songs(
    artist_id: &str,
    gl: &str,
    hl: &str,
) -> Result<Vec<NativeTrack>, String> {
    if !is_valid_innertube_id(artist_id) {
        return Ok(Vec::new());
    }

    let data = post_yt_music_browse(artist_id, gl, hl).await?;
    let (mut tracks, more_bid) = parse_browse_tracks_response(artist_id, &data);

    // If artist browse has a "See all songs" playlist/browse ID and shelf only inline-capped at 5, expand gently
    if tracks.len() <= 5 {
        if let Some(more_id) = more_bid {
            if more_id != artist_id {
                if let Ok(more_data) = post_yt_music_browse(&more_id, gl, hl).await {
                    let (more_tracks, _) = parse_browse_tracks_response(&more_id, &more_data);
                    if more_tracks.len() > tracks.len() {
                        tracks = more_tracks;
                    }
                }
            }
        }
    }

    Ok(tracks)
}

async fn fetch_browse_collection_tracks(
    browse_id: Option<&str>,
    playlist_id: Option<&str>,
    gl: &str,
    hl: &str,
) -> Result<Vec<NativeTrack>, String> {
    let valid_bid = browse_id.map(|s| s.trim()).filter(|s| is_valid_innertube_id(s));
    let valid_pid = playlist_id.map(|s| s.trim()).filter(|s| is_valid_innertube_id(s));

    if let Some(bid) = valid_bid {
        if bid.starts_with("UC") {
            let artist_tracks = fetch_artist_top_songs(bid, gl, hl).await?;
            if !artist_tracks.is_empty() {
                return Ok(artist_tracks);
            }
        } else {
            let normalized_bid = if !bid.starts_with("MPREb_")
                && !bid.starts_with("VL")
                && !bid.starts_with("OLAK5uy_")
                && (bid.starts_with("PL") || bid.starts_with("RD"))
            {
                format!("VL{}", bid)
            } else {
                bid.to_string()
            };

            if let Ok(data) = post_yt_music_browse(&normalized_bid, gl, hl).await {
                let (tracks, more_bid) = parse_browse_tracks_response(&normalized_bid, &data);
                if !tracks.is_empty() {
                    return Ok(tracks);
                }
                if let Some(mbid) = more_bid {
                    if let Ok(more_data) = post_yt_music_browse(&mbid, gl, hl).await {
                        let (more_tracks, _) = parse_browse_tracks_response(&mbid, &more_data);
                        if !more_tracks.is_empty() {
                            return Ok(more_tracks);
                        }
                    }
                }
            }
        }
    }

    if let Some(pid) = valid_pid {
        // Fallback: browse as VL<pid> then watch playlist via /next
        let vl_id = if pid.starts_with("VL") {
            pid.to_string()
        } else {
            format!("VL{}", pid)
        };
        if let Ok(data) = post_yt_music_browse(&vl_id, gl, hl).await {
            let (tracks, _) = parse_browse_tracks_response(&vl_id, &data);
            if !tracks.is_empty() {
                return Ok(tracks);
            }
        }
        let next_tracks = fetch_up_next_innertube(None, Some(pid), gl, hl).await?;
        if !next_tracks.is_empty() {
            return Ok(next_tracks);
        }
    }

    Ok(Vec::new())
}

// =========================================================================
// TAURI IPC COMMANDS
// =========================================================================

#[tauri::command]
pub fn get_player_region_info(region: Option<String>) -> RegionLocaleInfo {
    let (detected_gl, detected_hl) = detect_os_gl_hl();
    let (gl, hl) = normalize_region_pair(region.as_deref(), &detected_gl, &detected_hl);
    RegionLocaleInfo {
        gl,
        hl,
        detected_gl,
        detected_hl,
    }
}

#[tauri::command]
pub async fn search_tracks_native(
    query: String,
    region: Option<String>,
) -> Result<Vec<NativeTrack>, String> {
    let clean_query = sanitize_search_query(&query);
    if clean_query.is_empty() {
        return Ok(Vec::new());
    }

    let (gl, hl) = resolve_region_locale(region.as_deref());

    let mut results = match search_yt_music_innertube(&clean_query, &gl, &hl).await {
        Ok(list) => list,
        Err(err) => {
            eprintln!("[NativeAudio] YT Music InnerTube search warning: {}", err);
            Vec::new()
        }
    };

    if results.len() < 3 {
        if let Ok(fallback_list) = search_yt_standard_innertube(&clean_query, &gl, &hl).await {
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
pub async fn search_catalog_native(
    query: String,
    region: Option<String>,
) -> Result<CatalogSearchResponse, String> {
    let clean_query = sanitize_search_query(&query);
    let (gl, hl) = resolve_region_locale(region.as_deref());
    if clean_query.is_empty() {
        return Ok(CatalogSearchResponse {
            query: clean_query,
            gl,
            hl,
            top_songs: Vec::new(),
            songs: Vec::new(),
            albums: Vec::new(),
            playlists: Vec::new(),
            top_artist_name: None,
            top_artist_id: None,
        });
    }

    let q_unfiltered = clean_query.clone();
    let gl_unfiltered = gl.clone();
    let hl_unfiltered = hl.clone();
    let unfiltered_handle = tokio::spawn(async move {
        search_yt_music_innertube_raw(&q_unfiltered, &gl_unfiltered, &hl_unfiltered, None).await
    });

    let songs_val = search_yt_music_innertube_raw(
        &clean_query,
        &gl,
        &hl,
        Some("EgWKAQIIAWoKEAkQBRAKEAMQBA%3D%3D"),
    )
    .await
    .ok();

    let unfiltered_val = unfiltered_handle.await.ok().and_then(|res| res.ok());

    let mut catalog = parse_yt_music_catalog_response(
        &clean_query,
        &gl,
        &hl,
        unfiltered_val.as_ref(),
        songs_val.as_ref(),
    );

    // If Top Result matched an Artist (`UC...`) without inline top songs, hydrate top_songs cleanly
    if catalog.top_songs.is_empty() {
        if let Some(ref artist_id) = catalog.top_artist_id {
            if let Ok(artist_tracks) = fetch_artist_top_songs(artist_id, &gl, &hl).await {
                catalog.top_songs = artist_tracks.into_iter().take(8).collect();
            }
        }
    }

    // Fallback to standard YouTube if songs shelf was empty
    if catalog.songs.len() < 3 {
        if let Ok(fallback_list) = search_yt_standard_innertube(&clean_query, &gl, &hl).await {
            let existing_ids: HashSet<String> = catalog.songs.iter().map(|t| t.id.clone()).collect();
            for item in fallback_list {
                if !existing_ids.contains(&item.id) {
                    catalog.songs.push(item);
                    if catalog.songs.len() >= 15 {
                        break;
                    }
                }
            }
        }
    }

    Ok(catalog)
}

#[tauri::command]
pub async fn get_up_next_native(
    video_id: Option<String>,
    artist_id: Option<String>,
    artist_name: Option<String>,
    playlist_id: Option<String>,
    region: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<NativeTrack>, String> {
    let (gl, hl) = resolve_region_locale(region.as_deref());
    let max_items = limit.unwrap_or(15).clamp(1, 30);

    let vid_ref = video_id.as_deref().map(str::trim).filter(|s| !s.is_empty());
    let pid_ref = playlist_id.as_deref().map(str::trim).filter(|s| !s.is_empty());

    let mut results = match fetch_up_next_innertube(vid_ref, pid_ref, &gl, &hl).await {
        Ok(list) => list,
        Err(err) => {
            eprintln!("[NativeAudio] InnerTube /next warning: {}", err);
            Vec::new()
        }
    };

    // Fallback to official `artistId` browse Top Songs when /next yielded nothing or video_id wasn't available
    if results.is_empty() {
        let resolved_aid = if let Some(aid) = artist_id
            .as_deref()
            .map(str::trim)
            .filter(|id| is_valid_innertube_id(id) && id.starts_with("UC"))
        {
            Some(aid.to_string())
        } else if let Some(aname) = artist_name.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
            resolve_artist_id_by_name(aname, &gl, &hl).await
        } else {
            None
        };

        if let Some(aid) = resolved_aid {
            if let Ok(artist_tracks) = fetch_artist_top_songs(&aid, &gl, &hl).await {
                for tr in artist_tracks {
                    if Some(tr.id.as_str()) != vid_ref {
                        results.push(tr);
                    }
                }
            }
        }
    }

    results.truncate(max_items);
    Ok(results)
}

#[tauri::command]
pub async fn browse_collection_tracks_native(
    browse_id: Option<String>,
    playlist_id: Option<String>,
    region: Option<String>,
) -> Result<Vec<NativeTrack>, String> {
    let (gl, hl) = resolve_region_locale(region.as_deref());
    fetch_browse_collection_tracks(
        browse_id.as_deref(),
        playlist_id.as_deref(),
        &gl,
        &hl,
    )
    .await
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
        let found = search_tracks_native(lookup_query, None).await?;
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
    fn test_normalize_region_pair_dynamic_and_manual() {
        assert_eq!(
            normalize_region_pair(Some("ID"), "US", "en-US"),
            ("ID".to_string(), "id".to_string())
        );
        assert_eq!(
            normalize_region_pair(Some("jp"), "ID", "id-ID"),
            ("JP".to_string(), "ja".to_string())
        );
        assert_eq!(
            normalize_region_pair(Some("kr"), "ID", "id-ID"),
            ("KR".to_string(), "ko".to_string())
        );
        assert_eq!(
            normalize_region_pair(Some("auto"), "ID", "id-ID"),
            ("ID".to_string(), "id".to_string())
        );
        assert_eq!(
            normalize_region_pair(None, "US", "en-US"),
            ("US".to_string(), "en".to_string())
        );
        assert_eq!(
            normalize_region_pair(Some("auto"), "", ""),
            ("US".to_string(), "en".to_string())
        );
    }

    #[test]
    fn test_parse_yt_music_catalog_response_categories() {
        let unfiltered = json!({
            "contents": {
                "tabbedSearchResultsRenderer": {
                    "tabs": [{
                        "tabRenderer": {
                            "content": {
                                "sectionListRenderer": {
                                    "contents": [
                                        {
                                            "musicCardShelfRenderer": {
                                                "title": {
                                                    "runs": [{
                                                        "text": "Hindia",
                                                        "navigationEndpoint": {
                                                            "browseEndpoint": {
                                                                "browseId": "UC1234567890abcdefg",
                                                                "browseEndpointContextSupportedConfigs": {
                                                                    "browseEndpointContextMusicConfig": {
                                                                        "pageType": "MUSIC_PAGE_TYPE_ARTIST"
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    }]
                                                },
                                                "contents": [{
                                                    "musicResponsiveListItemRenderer": {
                                                        "playlistItemData": { "videoId": "aaaaaaaaaaa" },
                                                        "flexColumns": [
                                                            { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Secukupnya" }] } } },
                                                            { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                                                                { "text": "Hindia", "navigationEndpoint": { "browseEndpoint": { "browseId": "UC1234567890abcdefg", "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ARTIST" } } } } },
                                                                { "text": " • " },
                                                                { "text": "3:25" }
                                                            ] } } }
                                                        ]
                                                    }
                                                }]
                                            }
                                        },
                                        {
                                            "musicShelfRenderer": {
                                                "title": { "runs": [{ "text": "Albums" }] },
                                                "contents": [{
                                                    "musicResponsiveListItemRenderer": {
                                                        "navigationEndpoint": {
                                                            "browseEndpoint": {
                                                                "browseId": "MPREb_12345678",
                                                                "browseEndpointContextSupportedConfigs": {
                                                                    "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ALBUM" }
                                                                }
                                                            }
                                                        },
                                                        "flexColumns": [
                                                            { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Menari Dengan Bayangan" }] } } },
                                                            { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Album • Hindia • 2019" }] } } }
                                                        ]
                                                    }
                                                }]
                                            }
                                        },
                                        {
                                            "musicShelfRenderer": {
                                                "title": { "runs": [{ "text": "Community playlists" }] },
                                                "contents": [{
                                                    "musicResponsiveListItemRenderer": {
                                                        "navigationEndpoint": {
                                                            "browseEndpoint": {
                                                                "browseId": "VLPLabcdef123456",
                                                                "browseEndpointContextSupportedConfigs": {
                                                                    "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_PLAYLIST" }
                                                                }
                                                            }
                                                        },
                                                        "flexColumns": [
                                                            { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Indo Indie Essentials" }] } } },
                                                            { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Playlist • Curated • 40 songs" }] } } }
                                                        ]
                                                    }
                                                }]
                                            }
                                        }
                                    ]
                                }
                            }
                        }
                    }]
                }
            }
        });

        let songs_only = json!({
            "contents": {
                "tabbedSearchResultsRenderer": {
                    "tabs": [{
                        "tabRenderer": {
                            "content": {
                                "sectionListRenderer": {
                                    "contents": [{
                                        "musicShelfRenderer": {
                                            "contents": [{
                                                "musicResponsiveListItemRenderer": {
                                                    "playlistItemData": { "videoId": "bbbbbbbbbbb" },
                                                    "flexColumns": [
                                                        { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Evaluasi" }] } } },
                                                        { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [
                                                            { "text": "Hindia", "navigationEndpoint": { "browseEndpoint": { "browseId": "UC1234567890abcdefg", "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ARTIST" } } } } },
                                                            { "text": " • " },
                                                            { "text": "Menari Dengan Bayangan", "navigationEndpoint": { "browseEndpoint": { "browseId": "MPREb_12345678", "browseEndpointContextSupportedConfigs": { "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ALBUM" } } } } },
                                                            { "text": " • " },
                                                            { "text": "3:14" }
                                                        ] } } }
                                                    ]
                                                }
                                            }]
                                        }
                                    }]
                                }
                            }
                        }
                    }]
                }
            }
        });

        let catalog = parse_yt_music_catalog_response(
            "Hindia",
            "ID",
            "id",
            Some(&unfiltered),
            Some(&songs_only),
        );

        assert_eq!(catalog.gl, "ID");
        assert_eq!(catalog.hl, "id");
        assert_eq!(catalog.top_artist_name.as_deref(), Some("Hindia"));
        assert_eq!(catalog.top_artist_id.as_deref(), Some("UC1234567890abcdefg"));
        assert_eq!(catalog.top_songs.len(), 1);
        assert_eq!(catalog.top_songs[0].title, "Secukupnya");
        assert_eq!(catalog.top_songs[0].artist_id.as_deref(), Some("UC1234567890abcdefg"));
        assert_eq!(catalog.albums.len(), 1);
        assert_eq!(catalog.albums[0].browse_id, "MPREb_12345678");
        assert_eq!(catalog.playlists.len(), 1);
        assert_eq!(catalog.playlists[0].playlist_id.as_deref(), Some("PLabcdef123456"));
        assert_eq!(catalog.songs.len(), 1);
        assert_eq!(catalog.songs[0].album_title.as_deref(), Some("Menari Dengan Bayangan"));
    }

    #[test]
    fn test_parse_up_next_response_skips_seed_and_preserves_artist_id() {
        let up_next_json = json!({
            "contents": {
                "singleColumnMusicWatchNextResultsRenderer": {
                    "tabbedRenderer": {
                        "watchNextTabbedResultsRenderer": {
                            "tabs": [{
                                "tabRenderer": {
                                    "content": {
                                        "musicQueueRenderer": {
                                            "content": {
                                                "playlistPanelRenderer": {
                                                    "contents": [
                                                        {
                                                            "playlistPanelVideoRenderer": {
                                                                "videoId": "seed1111111",
                                                                "selected": true,
                                                                "title": { "runs": [{ "text": "Current Seed" }] },
                                                                "longBylineText": { "runs": [{ "text": "Artist A" }] },
                                                                "lengthText": { "runs": [{ "text": "3:10" }] }
                                                            }
                                                        },
                                                        {
                                                            "playlistPanelVideoRenderer": {
                                                                "videoId": "next2222222",
                                                                "selected": false,
                                                                "title": { "runs": [{ "text": "Rumah Ke Rumah" }] },
                                                                "longBylineText": {
                                                                    "runs": [
                                                                        {
                                                                            "text": "Hindia",
                                                                            "navigationEndpoint": {
                                                                                "browseEndpoint": {
                                                                                    "browseId": "UC1234567890abcdefg",
                                                                                    "browseEndpointContextSupportedConfigs": {
                                                                                        "browseEndpointContextMusicConfig": { "pageType": "MUSIC_PAGE_TYPE_ARTIST" }
                                                                                    }
                                                                                }
                                                                            }
                                                                        },
                                                                        { "text": " • " },
                                                                        { "text": "4:37" }
                                                                    ]
                                                                },
                                                                "lengthText": { "runs": [{ "text": "4:37" }] }
                                                            }
                                                        },
                                                        {
                                                            "automixPreviewVideoRenderer": {
                                                                "content": {
                                                                    "automixPlaylistVideoRenderer": {
                                                                        "navigationEndpoint": {
                                                                            "watchPlaylistEndpoint": { "playlistId": "RDAMVMseed1111111" }
                                                                        }
                                                                    }
                                                                }
                                                            }
                                                        }
                                                    ]
                                                }
                                            }
                                        }
                                    }
                                }
                            }]
                        }
                    }
                }
            }
        });

        let (tracks, automix_pid) = parse_up_next_response("seed1111111", &up_next_json);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].id, "next2222222");
        assert_eq!(tracks[0].title, "Rumah Ke Rumah");
        assert_eq!(tracks[0].artist, "Hindia");
        assert_eq!(tracks[0].artist_id.as_deref(), Some("UC1234567890abcdefg"));
        assert_eq!(tracks[0].duration_seconds, 277);
        assert_eq!(automix_pid.as_deref(), Some("RDAMVMseed1111111"));
    }

    #[test]
    fn test_parse_browse_album_two_column_inherits_header_metadata() {
        let browse_json = json!({
            "contents": {
                "twoColumnBrowseResultsRenderer": {
                    "tabs": [{
                        "tabRenderer": {
                            "content": {
                                "sectionListRenderer": {
                                    "contents": [{
                                        "musicResponsiveHeaderRenderer": {
                                            "title": { "runs": [{ "text": "Nicole" }] },
                                            "straplineTextOne": {
                                                "runs": [{
                                                    "text": "NIKI",
                                                    "navigationEndpoint": {
                                                        "browseEndpoint": { "browseId": "UCNIKIofficial12345" }
                                                    }
                                                }]
                                            },
                                            "thumbnail": {
                                                "musicThumbnailRenderer": {
                                                    "thumbnail": {
                                                        "thumbnails": [{ "url": "https://lh3.googleusercontent.com/cover=w226-h226-l90-rj" }]
                                                    }
                                                }
                                            }
                                        }
                                    }]
                                }
                            }
                        }
                    }],
                    "secondaryContents": {
                        "sectionListRenderer": {
                            "contents": [{
                                "musicShelfRenderer": {
                                    "contents": [{
                                        "musicResponsiveListItemRenderer": {
                                            "playlistItemData": { "videoId": "nicole11111" },
                                            "flexColumns": [
                                                { "musicResponsiveListItemFlexColumnRenderer": { "text": { "runs": [{ "text": "Backburner" }] } } }
                                            ],
                                            "fixedColumns": [
                                                { "musicResponsiveListItemFixedColumnRenderer": { "text": { "runs": [{ "text": "3:56" }] } } }
                                            ]
                                        }
                                    }]
                                }
                            }]
                        }
                    }
                }
            }
        });

        let (tracks, _) = parse_browse_tracks_response("MPREb_nicolealbum", &browse_json);
        assert_eq!(tracks.len(), 1);
        assert_eq!(tracks[0].title, "Backburner");
        assert_eq!(tracks[0].artist, "NIKI");
        assert_eq!(tracks[0].artist_id.as_deref(), Some("UCNIKIofficial12345"));
        assert_eq!(tracks[0].album_title.as_deref(), Some("Nicole"));
        assert_eq!(tracks[0].duration_seconds, 236);
        assert!(tracks[0].thumbnail_url.contains("w500-h500"));
    }

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

    #[test]
    fn verifies_and_removes_tampered_ytdlp_binary_and_caps_stream_registry() {
        let tmp = std::env::temp_dir().join(format!(
            "casa_ytdlp_verify_test_{}.bin",
            std::process::id()
        ));
        let payload = b"clean yt-dlp binary mock bytes";
        let good_sha = crate::security_utils::sha256_hex(payload);

        std::fs::write(&tmp, payload).unwrap();
        assert!(verify_ytdlp_binary_sha256(&tmp, &good_sha).is_ok());
        assert!(tmp.exists());

        // Corrupt bytes -> must reject AND delete binary from disk
        std::fs::write(&tmp, b"tampered bytes!").unwrap();
        assert!(verify_ytdlp_binary_sha256(&tmp, &good_sha).is_err());
        assert!(!tmp.exists(), "Tampered binary must be deleted immediately");

        // Header injection guard
        assert_eq!(
            sanitize_header_value("audio/webm\r\nX-Injected: evil\n"),
            "audio/webmX-Injected: evil"
        );

        // Bounded LRU cache cap
        let mut cache = StreamRegistryCache::default();
        for i in 0..70 {
            cache.insert(format!("vid_{i}"), vec![]);
        }
        assert_eq!(cache.map.len(), MAX_STREAM_REGISTRY_ENTRIES);
        assert!(cache.get("vid_0").is_none());
        assert!(cache.get("vid_69").is_some());
    }
}
