use crate::drop_zone::{allow_path_in_asset_scope, sanitize_transit_filename, write_clipboard_text};
use axum::{
    body::{Body, Bytes, HttpBody},
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, Multipart, Path as AxumPath, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, Method, Request as HttpRequest, StatusCode},
    middleware::{from_fn_with_state, Next},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Local;
use qrcode::{EcLevel, QrCode};
use std::collections::HashMap;
use std::io::{Read as _, Write as _};
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::task::{Context, Poll};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncRead, ReadBuf};
use tokio::sync::{broadcast, mpsc, oneshot, RwLock};
use tokio_util::io::ReaderStream;

const MAX_UPLOAD_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB per file
const MAX_DEFAULT_HTTP_BODY_BYTES: usize = 256 * 1024; // 256 KiB cap outside upload routes
const MAX_INCOMING_TEXT_CHARS: usize = 50_000;
const IDLE_TIMEOUT_SECS: u64 = 600; // 10 menit
const UPLOAD_DISK_BUF_BYTES: usize = 1024 * 1024; // 1 MiB sequential disk buffer
const UPLOAD_CHANNEL_CAPACITY: usize = 8; // bounded O(1) async->blocking queue
const DOWNLOAD_CHUNK_BYTES: usize = 512 * 1024; // 512 KiB dedicated blocking read
const DOWNLOAD_CHANNEL_CAPACITY: usize = 4; // max ~2 MiB in-flight download RAM
const ZIP_CHUNK_BYTES: usize = 256 * 1024; // 256 KiB buffered ZIP streaming chunks
const TOUCH_INTERVAL_BYTES: u64 = 1024 * 1024; // throttle touch_activity to every 1 MiB
const MAX_WS_CLIENTS: usize = 8;
const MAX_WS_MESSAGE_BYTES: usize = 4096;
const MAX_BATCH_FOLDERS_PER_SESSION: usize = 32;

static UPLOAD_PART_SEQ: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkInterfaceOption {
    pub ip: String,
    pub label: String,
    pub is_hotspot: bool,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectHpSessionInfo {
    pub active: bool,
    pub ip: String,
    pub port: u16,
    pub url: String,
    pub qr_size: usize,
    pub qr_path: String,
    pub network_category: String,
    pub candidate_interfaces: Vec<NetworkInterfaceOption>,
    pub connected_clients: usize,
    pub auto_copy_clipboard: bool,
    pub idle_timeout_secs: u64,
    pub download_dir: String,
    pub reason: Option<String>,
}

impl ConnectHpSessionInfo {
    fn inactive(reason: Option<String>) -> Self {
        Self {
            active: false,
            ip: String::new(),
            port: 0,
            url: String::new(),
            qr_size: 0,
            qr_path: String::new(),
            network_category: "Unknown".to_string(),
            candidate_interfaces: Vec::new(),
            connected_clients: 0,
            auto_copy_clipboard: true,
            idle_timeout_secs: IDLE_TIMEOUT_SECS,
            download_dir: String::new(),
            reason,
        }
    }
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectHpSyncItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub extension: Option<String>,
    pub size_bytes: Option<u64>,
    pub file_count: Option<u32>,
    pub text_payload: Option<String>,
    pub local_path: Option<String>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectHpPublicItem {
    pub id: String,
    pub item_type: String,
    pub title: String,
    pub extension: Option<String>,
    pub size_bytes: Option<u64>,
    pub file_count: Option<u32>,
    pub text_payload: Option<String>,
}

#[derive(Clone, Debug)]
struct SharedEntry {
    public: ConnectHpPublicItem,
    local_path: Option<PathBuf>,
}

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectHpIncomingEventPayload {
    pub kind: String,
    pub payload: String,
    pub file_name: Option<String>,
    pub size_bytes: Option<u64>,
    pub copied_to_clipboard: bool,
    pub batch_id: Option<String>,
    pub file_count: Option<u32>,
    pub batch_total: Option<u32>,
}

#[derive(Clone, Debug)]
struct BatchFolderState {
    dir_path: PathBuf,
    folder_name: String,
    received_files: u32,
    total_bytes: u64,
    batch_total: u32,
}

#[derive(Clone, Debug, serde::Deserialize)]
struct TokenQuery {
    t: Option<String>,
}

#[derive(Clone, Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct TextUploadBody {
    text: String,
}

struct ServerRuntime {
    session_id: u64,
    token: String,
    port: u16,
    stopped: AtomicBool,
    selected_ip: Mutex<String>,
    candidate_interfaces: Mutex<Vec<NetworkInterfaceOption>>,
    network_category: Mutex<String>,
    download_dir: PathBuf,
    auto_copy_clipboard: AtomicUsize, // 1 = true, 0 = false
    connected_clients: AtomicUsize,
    active_transfers: AtomicUsize,
    last_activity_epoch: AtomicU64,
    shared_items: RwLock<Vec<SharedEntry>>,
    shared_by_id: RwLock<HashMap<String, SharedEntry>>,
    batch_folders: tokio::sync::Mutex<HashMap<String, BatchFolderState>>,
    ws_broadcast: broadcast::Sender<String>,
    shutdown_tx: Mutex<Option<oneshot::Sender<()>>>,
    serve_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    watchdog_task: Mutex<Option<tauri::async_runtime::JoinHandle<()>>>,
    app_handle: Option<tauri::AppHandle>,
}

impl ServerRuntime {
    fn touch_activity(&self) {
        self.last_activity_epoch
            .store(now_epoch_secs(), Ordering::Relaxed);
    }

    fn allowed_ips(&self) -> Vec<String> {
        let mut ips = self
            .candidate_interfaces
            .lock()
            .map(|list| list.iter().map(|i| i.ip.clone()).collect::<Vec<_>>())
            .unwrap_or_default();
        if let Ok(sel) = self.selected_ip.lock() {
            if !sel.is_empty() && !ips.contains(&*sel) {
                ips.push(sel.clone());
            }
        }
        ips
    }

    fn to_session_info(&self, reason: Option<String>) -> ConnectHpSessionInfo {
        let ip = self
            .selected_ip
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "127.0.0.1".to_string());
        let candidates = self
            .candidate_interfaces
            .lock()
            .map(|g| g.clone())
            .unwrap_or_default();
        let net_cat = self
            .network_category
            .lock()
            .map(|g| g.clone())
            .unwrap_or_else(|_| "Unknown".to_string());
        let url = format!("http://{}:{}/?t={}", ip, self.port, self.token);
        let (qr_size, qr_path) = build_qr_svg_path(&url);

        ConnectHpSessionInfo {
            active: !self.stopped.load(Ordering::SeqCst),
            ip,
            port: self.port,
            url,
            qr_size,
            qr_path,
            network_category: net_cat,
            candidate_interfaces: candidates,
            connected_clients: self.connected_clients.load(Ordering::Relaxed),
            auto_copy_clipboard: self.auto_copy_clipboard.load(Ordering::Relaxed) == 1,
            idle_timeout_secs: IDLE_TIMEOUT_SECS,
            download_dir: self.download_dir.to_string_lossy().to_string(),
            reason,
        }
    }
}

static GLOBAL_RUNTIME: LazyLock<Mutex<Option<Arc<ServerRuntime>>>> =
    LazyLock::new(|| Mutex::new(None));
static NEXT_SESSION_ID: AtomicU64 = AtomicU64::new(1);

fn now_epoch_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

/// Perbandingan token constant-time berbasis XOR accumulator untuk mencegah timing side-channel.
pub fn ct_token_eq(a: &[u8], b: &[u8]) -> bool {
    crate::security_utils::ct_eq(a, b)
}

/// Hanya mengizinkan IPv4 privat RFC 1918 dan loopback lokal (termasuk IPv4-mapped IPv6).
pub fn is_allowed_lan_ip(ip: IpAddr) -> bool {
    let v4 = match ip {
        IpAddr::V4(v4) => v4,
        IpAddr::V6(v6) => match v6.to_ipv4_mapped() {
            Some(mapped) => mapped,
            None => return v6.is_loopback(),
        },
    };
    v4.is_loopback() || v4.is_private()
}

/// Memvalidasi header `Host` terhadap daftar IP lokal laptop pada port aktif (proteksi DNS rebinding).
pub fn is_allowed_host(host: Option<&str>, allowed_ips: &[String], port: u16) -> bool {
    let Some(raw) = host else {
        return false;
    };
    let trimmed = raw.trim().to_ascii_lowercase();
    if trimmed.is_empty() {
        return false;
    }
    if trimmed == format!("127.0.0.1:{}", port) || trimmed == format!("localhost:{}", port) {
        return true;
    }
    allowed_ips
        .iter()
        .any(|ip| trimmed == format!("{}:{}", ip.trim().to_ascii_lowercase(), port))
}

/// Memvalidasi header `Origin` browser terhadap daftar IP lokal laptop pada port aktif (proteksi CSWSH/CSRF).
pub fn is_allowed_origin(origin: Option<&str>, allowed_ips: &[String], port: u16) -> bool {
    let Some(raw) = origin else {
        return true;
    };
    let trimmed = raw.trim().trim_end_matches('/').to_ascii_lowercase();
    if trimmed.is_empty() || trimmed == "null" {
        return false;
    }
    if trimmed == format!("http://127.0.0.1:{}", port)
        || trimmed == format!("http://localhost:{}", port)
    {
        return true;
    }
    allowed_ips
        .iter()
        .any(|ip| trimmed == format!("http://{}:{}", ip.to_ascii_lowercase(), port))
}

/// Generates a 128-bit session token using OS CSPRNG (`BCryptGenRandom` on Windows).
fn generate_csprng_token_hex() -> Result<String, String> {
    let raw = crate::security_utils::random_bytes::<16>()?;
    let mut hex = String::with_capacity(32);
    for b in raw {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", b);
    }
    Ok(hex)
}

pub fn build_qr_svg_path(url: &str) -> (usize, String) {
    let Ok(code) = QrCode::with_error_correction_level(url.as_bytes(), EcLevel::M) else {
        return (0, String::new());
    };
    let width = code.width();
    let colors = code.to_colors();
    let quiet = 2usize;
    let total_size = width + quiet * 2;
    let mut path = String::with_capacity(width * width * 6);

    for y in 0..width {
        let mut x = 0usize;
        while x < width {
            if colors[y * width + x] == qrcode::Color::Dark {
                let start_x = x;
                while x < width && colors[y * width + x] == qrcode::Color::Dark {
                    x += 1;
                }
                let run_w = x - start_x;
                use std::fmt::Write;
                let _ = write!(
                    &mut path,
                    "M{} {}h{}v1h-{}z",
                    start_x + quiet,
                    y + quiet,
                    run_w,
                    run_w
                );
            } else {
                x += 1;
            }
        }
    }

    (total_size, path)
}

fn is_ignored_virtual_adapter(desc_lower: &str, name_lower: &str, ipv4: Ipv4Addr) -> bool {
    if ipv4 == Ipv4Addr::new(192, 168, 137, 1) {
        return false;
    }
    if desc_lower.contains("wi-fi direct virtual adapter")
        || desc_lower.contains("microsoft hosted network")
    {
        return false;
    }
    const VIRTUAL_KEYWORDS: &[&str] = &[
        "virtual",
        "vethernet",
        "wsl",
        "hyper-v",
        "vmware",
        "virtualbox",
        "vbox",
        "docker",
        "tailscale",
        "zerotier",
        "wireguard",
        "loopback",
        "hamachi",
        "radmin",
        "nordlynx",
        "tun",
        "tap-windows",
    ];
    VIRTUAL_KEYWORDS
        .iter()
        .any(|kw| desc_lower.contains(kw) || name_lower.contains(kw))
}

fn enumerate_lan_interfaces() -> Vec<NetworkInterfaceOption> {
    let mut found: Vec<(u8, NetworkInterfaceOption)> = Vec::new();

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{ERROR_BUFFER_OVERFLOW, NO_ERROR};
        use windows::Win32::NetworkManagement::IpHelper::{
            GetAdaptersAddresses, GAA_FLAG_SKIP_ANYCAST, GAA_FLAG_SKIP_DNS_SERVER,
            GAA_FLAG_SKIP_MULTICAST, IP_ADAPTER_ADDRESSES_LH,
        };
        use windows::Win32::NetworkManagement::Ndis::IfOperStatusUp;
        use windows::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN};

        unsafe {
            let flags = GAA_FLAG_SKIP_ANYCAST | GAA_FLAG_SKIP_MULTICAST | GAA_FLAG_SKIP_DNS_SERVER;
            let mut buf_len: u32 = 16 * 1024;
            let mut buffer = vec![0u8; buf_len as usize];

            let mut ret = GetAdaptersAddresses(
                AF_INET.0 as u32,
                flags,
                None,
                Some(buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH),
                &mut buf_len,
            );
            if ret == ERROR_BUFFER_OVERFLOW.0 && buf_len > 0 && buf_len <= 1024 * 1024 {
                buffer.resize(buf_len as usize, 0);
                ret = GetAdaptersAddresses(
                    AF_INET.0 as u32,
                    flags,
                    None,
                    Some(buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH),
                    &mut buf_len,
                );
            }

            if ret == NO_ERROR.0 {
                let mut adapter_ptr = buffer.as_ptr() as *const IP_ADAPTER_ADDRESSES_LH;
                while !adapter_ptr.is_null() {
                    let adapter = &*adapter_ptr;
                    if adapter.OperStatus == IfOperStatusUp {
                        let friendly = if !adapter.FriendlyName.is_null() {
                            adapter.FriendlyName.to_string().unwrap_or_default()
                        } else {
                            String::new()
                        };
                        let desc = if !adapter.Description.is_null() {
                            adapter.Description.to_string().unwrap_or_default()
                        } else {
                            String::new()
                        };
                        let name_lower = friendly.to_ascii_lowercase();
                        let desc_lower = desc.to_ascii_lowercase();

                        let mut unicast = adapter.FirstUnicastAddress;
                        while !unicast.is_null() {
                            let u = &*unicast;
                            let sa = u.Address.lpSockaddr;
                            if !sa.is_null() && (*sa).sa_family == AF_INET {
                                let sin = &*(sa as *const SOCKADDR_IN);
                                let octets = sin.sin_addr.S_un.S_addr.to_ne_bytes();
                                let ip = Ipv4Addr::new(octets[0], octets[1], octets[2], octets[3]);

                                if ip.is_private()
                                    && !ip.is_loopback()
                                    && !is_ignored_virtual_adapter(&desc_lower, &name_lower, ip)
                                {
                                    let is_hotspot = ip == Ipv4Addr::new(192, 168, 137, 1)
                                        || desc_lower.contains("wi-fi direct");
                                    let is_wifi = !is_hotspot
                                        && (adapter.IfType == 71
                                            || name_lower.contains("wi-fi")
                                            || name_lower.contains("wifi")
                                            || desc_lower.contains("wireless")
                                            || desc_lower.contains("wi-fi")
                                            || desc_lower.contains("wlan"));

                                    let priority = if is_wifi {
                                        0
                                    } else if is_hotspot {
                                        1
                                    } else {
                                        2
                                    };

                                    let short_name = if is_hotspot {
                                        "Mobile Hotspot".to_string()
                                    } else if !friendly.trim().is_empty() {
                                        friendly.trim().to_string()
                                    } else if is_wifi {
                                        "Wi-Fi".to_string()
                                    } else {
                                        "LAN".to_string()
                                    };

                                    let ip_str = ip.to_string();
                                    if !found.iter().any(|(_, existing)| existing.ip == ip_str) {
                                        found.push((
                                            priority,
                                            NetworkInterfaceOption {
                                                ip: ip_str.clone(),
                                                label: format!("{} · {}", short_name, ip_str),
                                                is_hotspot,
                                            },
                                        ));
                                    }
                                }
                            }
                            unicast = (*unicast).Next;
                        }
                    }
                    adapter_ptr = adapter.Next;
                }
            }
        }
    }

    found.sort_by_key(|(prio, _)| *prio);
    let mut out: Vec<NetworkInterfaceOption> = found.into_iter().map(|(_, item)| item).collect();
    if out.is_empty() {
        out.push(NetworkInterfaceOption {
            ip: "127.0.0.1".to_string(),
            label: "Localhost (Offline) · 127.0.0.1".to_string(),
            is_hotspot: false,
        });
    }
    out
}

async fn detect_windows_network_category() -> String {
    #[cfg(windows)]
    {
        let res = tauri::async_runtime::spawn_blocking(|| -> String {
            use windows::Win32::Networking::NetworkListManager::{
                INetwork, INetworkListManager, NetworkListManager, NLM_ENUM_NETWORK_CONNECTED,
                NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED, NLM_NETWORK_CATEGORY_PRIVATE,
                NLM_NETWORK_CATEGORY_PUBLIC,
            };
            use windows::Win32::System::Com::{
                CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL,
                COINIT_MULTITHREADED,
            };

            struct ComGuard(bool);
            impl Drop for ComGuard {
                fn drop(&mut self) {
                    if self.0 {
                        unsafe { CoUninitialize() };
                    }
                }
            }

            unsafe {
                let hr = CoInitializeEx(None, COINIT_MULTITHREADED);
                let guard = ComGuard(hr.is_ok());
                let _ = &guard;

                let Ok(mgr): Result<INetworkListManager, _> =
                    CoCreateInstance(&NetworkListManager, None, CLSCTX_ALL)
                else {
                    return "Unknown".to_string();
                };

                let Ok(enum_nets) = mgr.GetNetworks(NLM_ENUM_NETWORK_CONNECTED) else {
                    return "Unknown".to_string();
                };

                let mut saw_public = false;
                let mut saw_private = false;
                let mut saw_domain = false;

                loop {
                    let mut fetched = 0u32;
                    let mut raw_net: [Option<INetwork>; 1] = [None];
                    if enum_nets.Next(&mut raw_net, Some(&mut fetched)).is_err() || fetched == 0 {
                        break;
                    }
                    if let Some(net) = &raw_net[0] {
                        if let Ok(cat) = net.GetCategory() {
                            if cat == NLM_NETWORK_CATEGORY_PUBLIC {
                                saw_public = true;
                            } else if cat == NLM_NETWORK_CATEGORY_PRIVATE {
                                saw_private = true;
                            } else if cat == NLM_NETWORK_CATEGORY_DOMAIN_AUTHENTICATED {
                                saw_domain = true;
                            }
                        }
                    }
                }

                if saw_public {
                    "Public".to_string()
                } else if saw_private {
                    "Private".to_string()
                } else if saw_domain {
                    "Domain".to_string()
                } else {
                    "Unknown".to_string()
                }
            }
        })
        .await;

        res.unwrap_or_else(|_| "Unknown".to_string())
    }

    #[cfg(not(windows))]
    {
        "Private".to_string()
    }
}

pub(crate) fn resolve_casa_drop_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let base_downloads = match app.path().download_dir() {
        Ok(p) => p,
        Err(e) => std::env::var_os("USERPROFILE")
            .map(|p| PathBuf::from(p).join("Downloads"))
            .ok_or_else(|| format!("Gagal menentukan folder Downloads: {}", e))?,
    };

    let target = base_downloads.join("CASA Drop");
    std::fs::create_dir_all(&target)
        .map_err(|e| format!("Gagal membuat folder Downloads\\CASA Drop: {}", e))?;
    Ok(target)
}

fn split_stem_and_ext(file_name: &str) -> (&str, &str) {
    if let Some(dot) = file_name.rfind('.') {
        if dot > 0 && dot + 1 < file_name.len() {
            return (&file_name[..dot], &file_name[dot..]);
        }
    }
    (file_name, "")
}

fn reserve_unique_dest_path(dir: &Path, safe_file_name: &str) -> Result<PathBuf, String> {
    let (stem, ext) = split_stem_and_ext(safe_file_name);
    for idx in 0u32..1000 {
        let candidate_name = if idx == 0 {
            safe_file_name.to_string()
        } else {
            format!("{} ({}){}", stem, idx, ext)
        };
        let candidate = dir.join(&candidate_name);
        if !candidate.starts_with(dir) {
            return Err("Path traversal diblokir".to_string());
        }
        if !candidate.exists() {
            return Ok(candidate);
        }
    }
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    Ok(dir.join(format!("{}_{}{}", stem, millis, ext)))
}

fn create_unique_batch_subfolder(base_dir: &Path) -> Result<(PathBuf, String), String> {
    let prefix = Local::now().format("Batch-%H%M").to_string();
    for idx in 0u32..500 {
        let folder_name = if idx == 0 {
            prefix.clone()
        } else {
            format!("{} ({})", prefix, idx)
        };
        let dir_path = base_dir.join(&folder_name);
        if !dir_path.exists() {
            std::fs::create_dir_all(&dir_path)
                .map_err(|e| format!("Gagal membuat folder batch: {}", e))?;
            return Ok((dir_path, folder_name));
        }
    }
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let folder_name = format!("{}-{}", prefix, millis);
    let dir_path = base_dir.join(&folder_name);
    std::fs::create_dir_all(&dir_path)
        .map_err(|e| format!("Gagal membuat folder batch: {}", e))?;
    Ok((dir_path, folder_name))
}

fn sanitize_batch_id(raw: Option<&str>) -> Option<String> {
    let trimmed = raw?.trim();
    if trimmed.len() < 4 || trimmed.len() > 64 {
        return None;
    }
    if trimmed
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_'))
    {
        Some(trimmed.to_string())
    } else {
        None
    }
}

struct PartFileCleanupGuard {
    path: PathBuf,
    disarmed: bool,
}

impl PartFileCleanupGuard {
    fn new(path: PathBuf) -> Self {
        Self {
            path,
            disarmed: false,
        }
    }

    fn disarm(&mut self) {
        self.disarmed = true;
    }
}

impl Drop for PartFileCleanupGuard {
    fn drop(&mut self) {
        if !self.disarmed {
            let _ = std::fs::remove_file(&self.path);
        }
    }
}

struct ActiveTransferGuard<'a> {
    counter: &'a AtomicUsize,
}

impl<'a> ActiveTransferGuard<'a> {
    fn new(counter: &'a AtomicUsize) -> Self {
        counter.fetch_add(1, Ordering::Relaxed);
        Self { counter }
    }
}

impl Drop for ActiveTransferGuard<'_> {
    fn drop(&mut self) {
        self.counter.fetch_sub(1, Ordering::Relaxed);
    }
}

// =========================================================================
// Zero-Crate Channel Stream Adapters & Slice-by-4 IEEE CRC-32 + Streaming ZIP
// =========================================================================

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}

pub fn percent_decode_utf8(raw: &str) -> String {
    let bytes = raw.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0usize;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(hi), Some(lo)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push((hi << 4) | lo);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

struct ChannelAsyncRead {
    rx: mpsc::Receiver<std::io::Result<Bytes>>,
    current: Bytes,
    offset: usize,
}

impl ChannelAsyncRead {
    fn new(rx: mpsc::Receiver<std::io::Result<Bytes>>) -> Self {
        Self {
            rx,
            current: Bytes::new(),
            offset: 0,
        }
    }
}

impl AsyncRead for ChannelAsyncRead {
    fn poll_read(
        mut self: Pin<&mut Self>,
        cx: &mut Context<'_>,
        buf: &mut ReadBuf<'_>,
    ) -> Poll<std::io::Result<()>> {
        if buf.remaining() == 0 {
            return Poll::Ready(Ok(()));
        }

        loop {
            if self.offset < self.current.len() {
                let avail = &self.current[self.offset..];
                let to_copy = avail.len().min(buf.remaining());
                buf.put_slice(&avail[..to_copy]);
                self.offset += to_copy;
                if self.offset >= self.current.len() {
                    self.current = Bytes::new();
                    self.offset = 0;
                }
                return Poll::Ready(Ok(()));
            }

            match self.rx.poll_recv(cx) {
                Poll::Ready(Some(Ok(chunk))) => {
                    if chunk.is_empty() {
                        continue;
                    }
                    self.current = chunk;
                    self.offset = 0;
                }
                Poll::Ready(Some(Err(e))) => return Poll::Ready(Err(e)),
                Poll::Ready(None) => return Poll::Ready(Ok(())),
                Poll::Pending => return Poll::Pending,
            }
        }
    }
}

struct ChannelSyncWriter<F: FnMut(u64)> {
    tx: mpsc::Sender<std::io::Result<Bytes>>,
    on_bytes: F,
}

impl<F: FnMut(u64)> ChannelSyncWriter<F> {
    fn new(tx: mpsc::Sender<std::io::Result<Bytes>>, on_bytes: F) -> Self {
        Self { tx, on_bytes }
    }
}

impl<F: FnMut(u64)> std::io::Write for ChannelSyncWriter<F> {
    fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
        if buf.is_empty() {
            return Ok(0);
        }
        let chunk = Bytes::copy_from_slice(buf);
        self.tx.blocking_send(Ok(chunk)).map_err(|_| {
            std::io::Error::new(
                std::io::ErrorKind::BrokenPipe,
                "Client closed download stream",
            )
        })?;
        (self.on_bytes)(buf.len() as u64);
        Ok(buf.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

const CRC32_TABLES: [[u32; 256]; 4] = {
    let mut tables = [[0u32; 256]; 4];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut j = 0;
        while j < 8 {
            if c & 1 != 0 {
                c = 0xEDB8_8320 ^ (c >> 1);
            } else {
                c >>= 1;
            }
            j += 1;
        }
        tables[0][i] = c;
        i += 1;
    }
    let mut t = 1;
    while t < 4 {
        let mut k = 0;
        while k < 256 {
            let prev = tables[t - 1][k];
            tables[t][k] = (prev >> 8) ^ tables[0][(prev & 0xFF) as usize];
            k += 1;
        }
        t += 1;
    }
    tables
};

fn crc32_update(crc: u32, data: &[u8]) -> u32 {
    let mut c = !crc;
    let mut chunks = data.chunks_exact(4);
    for chunk in chunks.by_ref() {
        c ^= u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]);
        c = CRC32_TABLES[3][(c & 0xFF) as usize]
            ^ CRC32_TABLES[2][((c >> 8) & 0xFF) as usize]
            ^ CRC32_TABLES[1][((c >> 16) & 0xFF) as usize]
            ^ CRC32_TABLES[0][(c >> 24) as usize];
    }
    for &b in chunks.remainder() {
        c = CRC32_TABLES[0][((c ^ (b as u32)) & 0xFF) as usize] ^ (c >> 8);
    }
    !c
}

fn dos_now_time_date() -> (u16, u16) {
    use chrono::{Datelike, Timelike};
    let now = Local::now();
    let dos_time = ((now.hour() as u16) << 11)
        | ((now.minute() as u16) << 5)
        | ((now.second() as u16) / 2);
    let year = now.year().clamp(1980, 2107) as u16 - 1980;
    let dos_date = (year << 9) | ((now.month() as u16) << 5) | (now.day() as u16);
    (dos_time, dos_date)
}

fn collect_zip_entries_under_folder(root: &Path) -> Vec<(PathBuf, String)> {
    let root_name = root
        .file_name()
        .map(|s| sanitize_transit_filename(&s.to_string_lossy()))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "folder".to_string());

    let mut result = Vec::new();
    let mut stack: Vec<(PathBuf, String)> = vec![(root.to_path_buf(), root_name)];

    while let Some((dir_path, rel_prefix)) = stack.pop() {
        let Ok(read_dir) = std::fs::read_dir(&dir_path) else {
            continue;
        };
        let mut entries: Vec<_> = read_dir.flatten().collect();
        entries.sort_by_key(|e| e.file_name());

        for entry in entries {
            let p = entry.path();
            let Ok(meta) = std::fs::symlink_metadata(&p) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().into_owned();
            if name.is_empty() || name.ends_with(".part") {
                continue;
            }
            let zip_rel = format!("{}/{}", rel_prefix, name);
            if meta.is_file() {
                if meta.len() < (u32::MAX as u64) {
                    result.push((p, zip_rel));
                }
            } else if meta.is_dir() && stack.len() < 1024 {
                stack.push((p, zip_rel));
            }
        }
    }

    result
}

#[derive(Clone, Debug)]
pub struct ZipPlanEntry {
    pub disk_path: PathBuf,
    pub name_bytes: Vec<u8>,
    pub expected_size: u32,
}

#[derive(Clone, Debug)]
pub struct PreparedZipPlan {
    pub entries: Vec<ZipPlanEntry>,
    pub total_zip_bytes: u64,
}

fn truncate_utf8_bytes(s: &str, max_bytes: usize) -> Vec<u8> {
    if s.len() <= max_bytes {
        return s.as_bytes().to_vec();
    }
    let mut end = max_bytes;
    while end > 0 && !s.is_char_boundary(end) {
        end -= 1;
    }
    s.as_bytes()[..end].to_vec()
}

/// Menghitung manifest & ukuran total arsip ZIP metode `STORE` secara deterministik sebelum streaming,
/// sehingga header HTTP `Content-Length` selalu tepat hingga satuan byte (chrome mobile menampilkan total MB).
pub fn prepare_store_zip_plan(folder: &Path) -> Result<PreparedZipPlan, String> {
    if !folder.is_dir() {
        return Err("Folder tidak ditemukan di disk".to_string());
    }
    let raw_files = collect_zip_entries_under_folder(folder);
    let mut entries = Vec::with_capacity(raw_files.len());
    let mut local_cursor: u64 = 0;
    let mut cd_bytes: u64 = 0;

    for (disk_path, zip_name) in raw_files {
        if entries.len() >= u16::MAX as usize {
            break;
        }
        let Ok(meta) = std::fs::metadata(&disk_path) else {
            continue;
        };
        if !meta.is_file() || meta.len() >= (u32::MAX as u64) {
            continue;
        }

        let name_bytes = truncate_utf8_bytes(&zip_name, u16::MAX as usize);
        let name_len = name_bytes.len() as u64;
        let expected_size = meta.len() as u32;
        let entry_local_bytes = 30u64 + name_len + (expected_size as u64) + 16u64;

        if local_cursor.saturating_add(entry_local_bytes) > (u32::MAX as u64 - 1024) {
            break;
        }

        local_cursor += entry_local_bytes;
        cd_bytes += 46u64 + name_len;
        entries.push(ZipPlanEntry {
            disk_path,
            name_bytes,
            expected_size,
        });
    }

    let total_zip_bytes = local_cursor.saturating_add(cd_bytes).saturating_add(22);
    Ok(PreparedZipPlan {
        entries,
        total_zip_bytes,
    })
}

struct ZipCentralEntry {
    name_bytes: Vec<u8>,
    crc32: u32,
    size: u32,
    local_offset: u32,
    dos_time: u16,
    dos_date: u16,
}

/// Menuliskan arsip ZIP murni metode `STORE` sesuai `PreparedZipPlan` secara 1-pass streaming sinkron
/// di dalam dedicated `spawn_blocking` thread (buffer 256 KiB, strict exact-byte length).
pub fn write_streaming_store_zip_from_plan_sync<W: std::io::Write>(
    plan: &PreparedZipPlan,
    mut writer: W,
    mut on_touch: impl FnMut(),
) -> std::io::Result<()> {
    let (dos_time, dos_date) = dos_now_time_date();
    let mut central_entries: Vec<ZipCentralEntry> = Vec::with_capacity(plan.entries.len());
    let mut cursor_pos: u64 = 0;
    let mut touch_accum: u64 = 0;
    let mut buf = vec![0u8; ZIP_CHUNK_BYTES];
    let zero_pad = vec![0u8; ZIP_CHUNK_BYTES];

    for planned in &plan.entries {
        let local_offset = cursor_pos as u32;
        let trimmed_name = &planned.name_bytes;
        let name_len_u16 = trimmed_name.len() as u16;

        // Local File Header (30 bytes) + filename: flags=0x0808 (Data Descriptor + UTF-8), method=0 (STORE)
        let mut lfh = [0u8; 30];
        lfh[0..4].copy_from_slice(&0x0403_4b50u32.to_le_bytes());
        lfh[4..6].copy_from_slice(&20u16.to_le_bytes());
        lfh[6..8].copy_from_slice(&0x0808u16.to_le_bytes());
        lfh[8..10].copy_from_slice(&0u16.to_le_bytes());
        lfh[10..12].copy_from_slice(&dos_time.to_le_bytes());
        lfh[12..14].copy_from_slice(&dos_date.to_le_bytes());
        lfh[26..28].copy_from_slice(&name_len_u16.to_le_bytes());

        writer.write_all(&lfh)?;
        writer.write_all(trimmed_name)?;
        cursor_pos += 30 + (trimmed_name.len() as u64);

        let mut crc = 0u32;
        let mut remaining = planned.expected_size as usize;

        if let Ok(mut file) = std::fs::File::open(&planned.disk_path) {
            while remaining > 0 {
                let to_read = remaining.min(buf.len());
                let n = file.read(&mut buf[..to_read])?;
                if n == 0 {
                    break;
                }
                crc = crc32_update(crc, &buf[..n]);
                writer.write_all(&buf[..n])?;
                cursor_pos += n as u64;
                remaining -= n;
                touch_accum += n as u64;
                if touch_accum >= TOUCH_INTERVAL_BYTES {
                    touch_accum = 0;
                    on_touch();
                }
            }
        }

        // Pad any unexpected file shrinkage/unavailability so streamed length matches Content-Length byte-for-byte
        while remaining > 0 {
            let chunk_len = remaining.min(zero_pad.len());
            let slice = &zero_pad[..chunk_len];
            crc = crc32_update(crc, slice);
            writer.write_all(slice)?;
            cursor_pos += chunk_len as u64;
            remaining -= chunk_len;
        }

        let size_u32 = planned.expected_size;
        let mut dd = [0u8; 16];
        dd[0..4].copy_from_slice(&0x0807_4b50u32.to_le_bytes());
        dd[4..8].copy_from_slice(&crc.to_le_bytes());
        dd[8..12].copy_from_slice(&size_u32.to_le_bytes());
        dd[12..16].copy_from_slice(&size_u32.to_le_bytes());
        writer.write_all(&dd)?;
        cursor_pos += 16;

        central_entries.push(ZipCentralEntry {
            name_bytes: trimmed_name.clone(),
            crc32: crc,
            size: size_u32,
            local_offset,
            dos_time,
            dos_date,
        });
    }

    let cd_offset = cursor_pos as u32;
    let mut cd_size: u64 = 0;

    for entry in &central_entries {
        let name_len = entry.name_bytes.len() as u16;
        let mut cdfh = [0u8; 46];
        cdfh[0..4].copy_from_slice(&0x0201_4b50u32.to_le_bytes());
        cdfh[4..6].copy_from_slice(&20u16.to_le_bytes());
        cdfh[6..8].copy_from_slice(&20u16.to_le_bytes());
        cdfh[8..10].copy_from_slice(&0x0808u16.to_le_bytes());
        cdfh[10..12].copy_from_slice(&0u16.to_le_bytes());
        cdfh[12..14].copy_from_slice(&entry.dos_time.to_le_bytes());
        cdfh[14..16].copy_from_slice(&entry.dos_date.to_le_bytes());
        cdfh[16..20].copy_from_slice(&entry.crc32.to_le_bytes());
        cdfh[20..24].copy_from_slice(&entry.size.to_le_bytes());
        cdfh[24..28].copy_from_slice(&entry.size.to_le_bytes());
        cdfh[28..30].copy_from_slice(&name_len.to_le_bytes());
        cdfh[38..42].copy_from_slice(&0x20u32.to_le_bytes());
        cdfh[42..46].copy_from_slice(&entry.local_offset.to_le_bytes());

        writer.write_all(&cdfh)?;
        writer.write_all(&entry.name_bytes)?;
        cd_size += 46 + (entry.name_bytes.len() as u64);
    }

    let count_u16 = (central_entries.len().min(u16::MAX as usize)) as u16;
    let mut eocd = [0u8; 22];
    eocd[0..4].copy_from_slice(&0x0605_4b50u32.to_le_bytes());
    eocd[8..10].copy_from_slice(&count_u16.to_le_bytes());
    eocd[10..12].copy_from_slice(&count_u16.to_le_bytes());
    eocd[12..16].copy_from_slice(&(cd_size as u32).to_le_bytes());
    eocd[16..20].copy_from_slice(&cd_offset.to_le_bytes());

    writer.write_all(&eocd)?;
    writer.flush()?;
    Ok(())
}

/// Menuliskan arsip ZIP murni metode `STORE` (0% kompresi) secara 1-pass streaming dengan Data Descriptor (`0x08074b50`) & UTF-8 flag (`0x0808`).
#[cfg(test)]
pub async fn write_streaming_store_zip(
    folder: &Path,
    writer: &mut Vec<u8>,
    on_chunk: impl FnMut(),
) -> std::io::Result<()> {
    let plan = prepare_store_zip_plan(folder)
        .map_err(|msg| std::io::Error::new(std::io::ErrorKind::NotFound, msg))?;
    write_streaming_store_zip_from_plan_sync(&plan, writer, on_chunk)
}

// =========================================================================
// HTTP & WebSocket Handlers (Axum)
// =========================================================================

fn attach_security_headers(resp: &mut Response) {
    let h = resp.headers_mut();
    h.insert(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY"));
    h.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    if !h.contains_key(header::CACHE_CONTROL) {
        h.insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store, max-age=0"),
        );
    }
}

fn security_error_response(status: StatusCode, msg: &'static str) -> Response {
    let mut resp = (status, msg).into_response();
    attach_security_headers(&mut resp);
    resp
}

fn extract_query_param_t(query: Option<&str>) -> Option<String> {
    let q = query?;
    for pair in q.split('&') {
        if let Some((k, v)) = pair.split_once('=') {
            if k == "t" {
                let trimmed = v.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

async fn connect_hp_security_middleware(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    req: HttpRequest<Body>,
    next: Next,
) -> Response {
    if !is_allowed_lan_ip(addr.ip()) {
        return security_error_response(StatusCode::FORBIDDEN, "LAN IP only");
    }

    let allowed_ips = runtime.allowed_ips();
    let host_hdr = req.headers().get(header::HOST).and_then(|v| v.to_str().ok());
    if !is_allowed_host(host_hdr, &allowed_ips, runtime.port) {
        return security_error_response(StatusCode::FORBIDDEN, "Invalid host header");
    }

    if runtime.stopped.load(Ordering::SeqCst) {
        return security_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Connect HP session closed",
        );
    }

    let path = req.uri().path();
    let query_t = extract_query_param_t(req.uri().query());
    let header_t = req
        .headers()
        .get("x-casa-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(|s| s.to_string());
    let provided_t = query_t.as_deref().or(header_t.as_deref());

    if path == "/" {
        if let Some(tok) = provided_t {
            if !ct_token_eq(tok.as_bytes(), runtime.token.as_bytes()) {
                return security_error_response(StatusCode::UNAUTHORIZED, "Invalid session token");
            }
            runtime.touch_activity();
        }
    } else {
        let enforce_origin = matches!(path, "/ws" | "/api/text" | "/api/upload" | "/api/upload-raw")
            || !matches!(*req.method(), Method::GET | Method::HEAD);
        if let Err((code, msg)) = verify_request_access(
            &runtime,
            addr.ip(),
            req.headers(),
            query_t.as_deref(),
            enforce_origin,
        ) {
            return security_error_response(code, msg);
        }
        runtime.touch_activity();
    }

    let mut resp = next.run(req).await;
    attach_security_headers(&mut resp);
    resp
}

fn verify_request_access(
    runtime: &ServerRuntime,
    peer_ip: IpAddr,
    headers: &HeaderMap,
    query_token: Option<&str>,
    enforce_origin: bool,
) -> Result<(), (StatusCode, &'static str)> {
    if !is_allowed_lan_ip(peer_ip) {
        return Err((StatusCode::FORBIDDEN, "LAN IP only"));
    }

    if enforce_origin {
        let origin_str = headers.get(header::ORIGIN).and_then(|v| v.to_str().ok());
        let allowed = runtime.allowed_ips();
        if !is_allowed_origin(origin_str, &allowed, runtime.port) {
            return Err((StatusCode::FORBIDDEN, "Invalid origin"));
        }
    }

    let header_token = headers.get("x-casa-token").and_then(|v| v.to_str().ok());
    let provided = query_token.or(header_token).unwrap_or("");
    if !ct_token_eq(provided.as_bytes(), runtime.token.as_bytes()) {
        return Err((StatusCode::UNAUTHORIZED, "Invalid session token"));
    }

    Ok(())
}

async fn handle_index(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Response {
    if !is_allowed_lan_ip(addr.ip()) {
        return security_error_response(StatusCode::FORBIDDEN, "LAN IP only");
    }
    if runtime.stopped.load(Ordering::SeqCst) {
        return security_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Connect HP session closed",
        );
    }

    // Jika `?t=` disertakan (scan QR / buka ulang URL QR), wajib valid;
    // jika kosong (reload `/` pasca history.replaceState di Chrome Android), sajikan shell HTML statis
    // agar JS dapat memulihkan token dari sessionStorage lalu memverifikasi /ws & /api/items.
    let provided_query_token = query
        .t
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let header_token = headers
        .get("x-casa-token")
        .and_then(|v| v.to_str().ok())
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if let Some(tok) = provided_query_token.or(header_token) {
        if !ct_token_eq(tok.as_bytes(), runtime.token.as_bytes()) {
            return security_error_response(StatusCode::UNAUTHORIZED, "Invalid session token");
        }
        runtime.touch_activity();
    }

    let mut resp = Html(MOBILE_WEB_UI_HTML).into_response();
    let headers_mut = resp.headers_mut();
    headers_mut.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store, max-age=0"),
    );
    headers_mut.insert(
        header::CONTENT_SECURITY_POLICY,
        HeaderValue::from_static(
            "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none'; frame-ancestors 'none';",
        ),
    );
    attach_security_headers(&mut resp);
    resp
}

async fn handle_ws_upgrade(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if runtime.stopped.load(Ordering::SeqCst) {
        return security_error_response(
            StatusCode::SERVICE_UNAVAILABLE,
            "Connect HP session closed",
        );
    }
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), true)
    {
        return security_error_response(code, msg);
    }
    if runtime.connected_clients.load(Ordering::Acquire) >= MAX_WS_CLIENTS {
        return security_error_response(
            StatusCode::TOO_MANY_REQUESTS,
            "Batas koneksi WebSocket aktif tercapai",
        );
    }
    runtime.touch_activity();
    ws.max_message_size(MAX_WS_MESSAGE_BYTES)
        .max_frame_size(MAX_WS_MESSAGE_BYTES)
        .on_upgrade(move |socket| handle_ws_connection(runtime, socket))
}

async fn handle_ws_connection(runtime: Arc<ServerRuntime>, mut socket: WebSocket) {
    if runtime.stopped.load(Ordering::SeqCst) {
        let _ = socket.close().await;
        return;
    }

    let Ok(prev_clients) = runtime.connected_clients.try_update(
        Ordering::SeqCst,
        Ordering::SeqCst,
        |cur| if cur < MAX_WS_CLIENTS { Some(cur + 1) } else { None },
    ) else {
        let _ = socket.close().await;
        return;
    };
    let clients_now = prev_clients + 1;
    if let Some(ref app) = runtime.app_handle {
        let _ = app.emit("casa://connect-hp-status", runtime.to_session_info(None));
    }

    // Push initial allowlist items (WITHOUT any local_path) immediately on connect
    {
        let initial_public: Vec<ConnectHpPublicItem> = runtime
            .shared_items
            .read()
            .await
            .iter()
            .map(|e| e.public.clone())
            .collect();
        if let Ok(json) = serde_json::to_string(&serde_json::json!({
            "type": "items",
            "items": initial_public,
            "connectedClients": clients_now,
        })) {
            let _ = socket.send(Message::Text(json)).await;
        }
    }

    let mut rx = runtime.ws_broadcast.subscribe();

    loop {
        if runtime.stopped.load(Ordering::SeqCst) {
            let _ = socket.close().await;
            break;
        }
        tokio::select! {
            ws_msg = socket.recv() => {
                match ws_msg {
                    Some(Ok(Message::Text(txt))) => {
                        runtime.touch_activity();
                        if txt == "ping" {
                            let _ = socket.send(Message::Text("{\"type\":\"pong\"}".to_string())).await;
                        }
                    }
                    Some(Ok(Message::Ping(p))) => {
                        runtime.touch_activity();
                        let _ = socket.send(Message::Pong(p)).await;
                    }
                    Some(Ok(Message::Close(_))) | None => break,
                    Some(Ok(_)) => {
                        runtime.touch_activity();
                    }
                    Some(Err(_)) => break,
                }
            }
            bcast = rx.recv() => {
                match bcast {
                    Ok(payload) => {
                        if payload == "__casa_shutdown__" {
                            let _ = socket.close().await;
                            break;
                        }
                        if socket.send(Message::Text(payload)).await.is_err() {
                            break;
                        }
                    }
                    Err(broadcast::error::RecvError::Lagged(_)) => continue,
                    Err(broadcast::error::RecvError::Closed) => break,
                }
            }
        }
    }

    runtime.connected_clients.fetch_sub(1, Ordering::Relaxed);
    let still_active_current = !runtime.stopped.load(Ordering::SeqCst)
        && GLOBAL_RUNTIME
            .lock()
            .ok()
            .and_then(|g| g.as_ref().map(|r| r.session_id == runtime.session_id))
            .unwrap_or(false);
    if still_active_current {
        if let Some(ref app) = runtime.app_handle {
            let _ = app.emit("casa://connect-hp-status", runtime.to_session_info(None));
        }
    }
}

async fn handle_get_items(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
) -> Response {
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), false)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();

    let items: Vec<ConnectHpPublicItem> = runtime
        .shared_items
        .read()
        .await
        .iter()
        .map(|e| e.public.clone())
        .collect();
    Json(serde_json::json!({ "items": items })).into_response()
}

async fn handle_post_text(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    Json(body): Json<TextUploadBody>,
) -> Response {
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), true)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();

    let trimmed = body.text.trim();
    if trimmed.is_empty() {
        return (StatusCode::BAD_REQUEST, "Teks kosong").into_response();
    }

    let safe_text: String = if trimmed.chars().count() > MAX_INCOMING_TEXT_CHARS {
        trimmed.chars().take(MAX_INCOMING_TEXT_CHARS).collect()
    } else {
        trimmed.to_string()
    };

    let auto_copy = runtime.auto_copy_clipboard.load(Ordering::Relaxed) == 1;
    let mut copied = false;
    if auto_copy {
        let clip_text = safe_text.clone();
        if let Ok(Ok(())) =
            tauri::async_runtime::spawn_blocking(move || write_clipboard_text(&clip_text)).await
        {
            copied = true;
        }
    }

    if let Some(ref app) = runtime.app_handle {
        let _ = app.emit(
            "casa://connect-hp-item",
            ConnectHpIncomingEventPayload {
                kind: "text".to_string(),
                payload: safe_text,
                file_name: None,
                size_bytes: None,
                copied_to_clipboard: copied,
                batch_id: None,
                file_count: None,
                batch_total: None,
            },
        );
    }

    Json(serde_json::json!({ "ok": true, "copiedToClipboard": copied })).into_response()
}

#[cfg(windows)]
fn write_mark_of_the_web(path: &Path) {
    let ads_path = format!("{}:Zone.Identifier", path.display());
    let _ = std::fs::write(ads_path, b"[ZoneTransfer]\r\nZoneId=3\r\n");
}

#[cfg(not(windows))]
fn write_mark_of_the_web(_path: &Path) {}

struct BlockingUploadResult {
    final_path: PathBuf,
    final_name: String,
    written_bytes: u64,
}

async fn resolve_or_create_upload_target_dir(
    runtime: &ServerRuntime,
    base_drop_dir: &Path,
    wants_batch_folder: bool,
    batch_id: Option<&String>,
    batch_total: u32,
) -> Result<(PathBuf, bool, Option<String>), (StatusCode, String)> {
    if !wants_batch_folder {
        return Ok((base_drop_dir.to_path_buf(), false, None));
    }
    let Some(b_id) = batch_id else {
        return Ok((base_drop_dir.to_path_buf(), false, None));
    };

    let mut batches = runtime.batch_folders.lock().await;
    if let Some(existing) = batches.get(b_id) {
        return Ok((
            existing.dir_path.clone(),
            true,
            Some(existing.folder_name.clone()),
        ));
    }
    if batches.len() >= MAX_BATCH_FOLDERS_PER_SESSION {
        return Err((
            StatusCode::TOO_MANY_REQUESTS,
            "Batas folder batch per sesi Connect HP (32) tercapai".to_string(),
        ));
    }

    let base_clone = base_drop_dir.to_path_buf();
    let (dir_path, folder_name) = tokio::task::spawn_blocking(move || {
        create_unique_batch_subfolder(&base_clone)
    })
    .await
    .map_err(|e| {
        (
            StatusCode::INTERNAL_SERVER_ERROR,
            format!("Gagal menjadwalkan folder batch: {}", e),
        )
    })?
    .map_err(|e| (StatusCode::INTERNAL_SERVER_ERROR, e))?;

    batches.insert(
        b_id.clone(),
        BatchFolderState {
            dir_path: dir_path.clone(),
            folder_name: folder_name.clone(),
            received_files: 0,
            total_bytes: 0,
            batch_total,
        },
    );
    Ok((dir_path, true, Some(folder_name)))
}

fn spawn_blocking_upload_writer(
    part_path: PathBuf,
    target_dir: PathBuf,
    safe_name: String,
    mut rx: mpsc::Receiver<Bytes>,
    commit_ok: Arc<AtomicBool>,
) -> tokio::task::JoinHandle<Result<BlockingUploadResult, (StatusCode, String)>> {
    tokio::task::spawn_blocking(move || {
        let mut part_guard = PartFileCleanupGuard::new(part_path.clone());
        let file = std::fs::File::create(&part_path).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal membuat berkas sementara: {}", e),
            )
        })?;
        let mut writer = std::io::BufWriter::with_capacity(UPLOAD_DISK_BUF_BYTES, file);
        let mut written_bytes: u64 = 0;

        while let Some(chunk) = rx.blocking_recv() {
            writer.write_all(&chunk).map_err(|e| {
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal menulis chunk ke disk: {}", e),
                )
            })?;
            written_bytes = written_bytes.saturating_add(chunk.len() as u64);
        }

        if !commit_ok.load(Ordering::Acquire) || written_bytes == 0 {
            drop(writer);
            return Ok(BlockingUploadResult {
                final_path: part_path,
                final_name: safe_name,
                written_bytes: 0,
            });
        }

        writer.flush().map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal menyelesaikan penulisan berkas: {}", e),
            )
        })?;
        drop(writer);

        let final_path = reserve_unique_dest_path(&target_dir, &safe_name)
            .map_err(|e| (StatusCode::BAD_REQUEST, e))?;
        std::fs::rename(&part_path, &final_path).map_err(|e| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal memindahkan berkas final: {}", e),
            )
        })?;
        part_guard.disarm();
        write_mark_of_the_web(&final_path);

        let final_name = final_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or(safe_name);

        Ok(BlockingUploadResult {
            final_path,
            final_name,
            written_bytes,
        })
    })
}

async fn emit_uploaded_file_event(
    runtime: &ServerRuntime,
    target_dir: &Path,
    final_path: &Path,
    final_name: &str,
    written_bytes: u64,
    is_batch_folder: bool,
    batch_id: Option<&String>,
    batch_folder_name: Option<String>,
    batch_total: u32,
) {
    if let (true, Some(b_id), Some(folder_name)) = (is_batch_folder, batch_id, batch_folder_name) {
        let (recv_count, sum_bytes, total_expected) = {
            let mut batches = runtime.batch_folders.lock().await;
            if let Some(st) = batches.get_mut(b_id) {
                st.received_files = st.received_files.saturating_add(1);
                st.total_bytes = st.total_bytes.saturating_add(written_bytes);
                (st.received_files, st.total_bytes, st.batch_total)
            } else {
                (1, written_bytes, batch_total)
            }
        };

        if let Some(ref app) = runtime.app_handle {
            let _ = app.emit(
                "casa://connect-hp-item",
                ConnectHpIncomingEventPayload {
                    kind: "batch_folder".to_string(),
                    payload: target_dir.to_string_lossy().to_string(),
                    file_name: Some(folder_name),
                    size_bytes: Some(sum_bytes),
                    copied_to_clipboard: false,
                    batch_id: Some(b_id.clone()),
                    file_count: Some(recv_count),
                    batch_total: Some(total_expected),
                },
            );
        }
    } else if let Some(ref app) = runtime.app_handle {
        allow_path_in_asset_scope(app, final_path);
        let _ = app.emit(
            "casa://connect-hp-item",
            ConnectHpIncomingEventPayload {
                kind: "file".to_string(),
                payload: final_path.to_string_lossy().to_string(),
                file_name: Some(final_name.to_string()),
                size_bytes: Some(written_bytes),
                copied_to_clipboard: false,
                batch_id: None,
                file_count: None,
                batch_total: None,
            },
        );
    }
}

async fn handle_upload_raw(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(query): Query<TokenQuery>,
    req: HttpRequest<Body>,
) -> Response {
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), req.headers(), query.t.as_deref(), true)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();
    let _transfer_guard = ActiveTransferGuard::new(&runtime.active_transfers);

    if let Some(declared_len) = req
        .headers()
        .get(header::CONTENT_LENGTH)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u64>().ok())
    {
        if declared_len > MAX_UPLOAD_FILE_BYTES {
            return (
                StatusCode::PAYLOAD_TOO_LARGE,
                "Ukuran berkas melebihi batas 4 GB",
            )
                .into_response();
        }
    }

    let raw_name = req
        .headers()
        .get("x-casa-file-name")
        .and_then(|v| v.to_str().ok())
        .map(percent_decode_utf8)
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "upload-hp.bin".to_string());
    let safe_name = sanitize_transit_filename(&raw_name);

    let batch_id = sanitize_batch_id(
        req.headers()
            .get("x-casa-batch-id")
            .and_then(|v| v.to_str().ok()),
    );
    let batch_total: u32 = req
        .headers()
        .get("x-casa-batch-total")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(1)
        .max(1);
    let wants_batch_folder = batch_total > 5 && batch_id.is_some();

    let base_drop_dir = match runtime.app_handle.as_ref() {
        Some(app) => match resolve_casa_drop_dir(app) {
            Ok(dir) => dir,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
        },
        None => runtime.download_dir.clone(),
    };

    let mut data_stream = req.into_body().into_data_stream();
    let mut received_bytes: u64 = 0;
    let mut touch_accum: u64 = 0;

    let mut active_writer: Option<(
        mpsc::Sender<Bytes>,
        Arc<AtomicBool>,
        tokio::task::JoinHandle<Result<BlockingUploadResult, (StatusCode, String)>>,
        PathBuf,
        bool,
        Option<String>,
    )> = None;

    while let Some(frame_res) =
        std::future::poll_fn(|cx| Pin::new(&mut data_stream).poll_frame(cx)).await
    {
        match frame_res {
            Ok(frame) => {
                let Ok(chunk) = frame.into_data() else {
                    continue;
                };
                if chunk.is_empty() {
                    continue;
                }
                let chunk_len = chunk.len() as u64;
                if received_bytes.saturating_add(chunk_len) > MAX_UPLOAD_FILE_BYTES {
                    drop(active_writer);
                    return (
                        StatusCode::PAYLOAD_TOO_LARGE,
                        "Ukuran berkas melebihi batas 4 GB",
                    )
                        .into_response();
                }

                if active_writer.is_none() {
                    let (target_dir, is_batch_folder, batch_folder_name) =
                        match resolve_or_create_upload_target_dir(
                            &runtime,
                            &base_drop_dir,
                            wants_batch_folder,
                            batch_id.as_ref(),
                            batch_total,
                        )
                        .await
                        {
                            Ok(v) => v,
                            Err((code, msg)) => return (code, msg).into_response(),
                        };

                    let millis = SystemTime::now()
                        .duration_since(UNIX_EPOCH)
                        .unwrap_or_default()
                        .as_millis();
                    let seq = UPLOAD_PART_SEQ.fetch_add(1, Ordering::Relaxed);
                    let part_path =
                        base_drop_dir.join(format!(".{}_{}_{}.part", millis, seq, safe_name));
                    let (tx, rx) = mpsc::channel::<Bytes>(UPLOAD_CHANNEL_CAPACITY);
                    let commit_ok = Arc::new(AtomicBool::new(false));
                    let handle = spawn_blocking_upload_writer(
                        part_path,
                        target_dir.clone(),
                        safe_name.clone(),
                        rx,
                        Arc::clone(&commit_ok),
                    );
                    active_writer = Some((
                        tx,
                        commit_ok,
                        handle,
                        target_dir,
                        is_batch_folder,
                        batch_folder_name,
                    ));
                }

                let tx_ref = &active_writer.as_ref().unwrap().0;
                if tx_ref.send(chunk).await.is_err() {
                    if let Some((tx, _, handle, _, _, _)) = active_writer.take() {
                        drop(tx);
                        if let Ok(Err((code, msg))) = handle.await {
                            return (code, msg).into_response();
                        }
                    }
                    return (
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "Writer disk terhenti saat menerima berkas",
                    )
                        .into_response();
                }

                received_bytes += chunk_len;
                touch_accum += chunk_len;
                if touch_accum >= TOUCH_INTERVAL_BYTES {
                    touch_accum = 0;
                    runtime.touch_activity();
                }
            }
            Err(e) => {
                drop(active_writer);
                return (
                    StatusCode::BAD_REQUEST,
                    format!("Stream unggahan terputus: {}", e),
                )
                    .into_response();
            }
        }
    }

    let Some((tx, commit_ok, handle, target_dir, is_batch_folder, batch_folder_name)) =
        active_writer
    else {
        return (StatusCode::BAD_REQUEST, "Tidak ada berkas yang valid").into_response();
    };

    commit_ok.store(true, Ordering::Release);
    drop(tx);

    let saved = match handle.await {
        Ok(Ok(res)) => res,
        Ok(Err((code, msg))) => return (code, msg).into_response(),
        Err(e) => {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Task penulisan berkas gagal: {}", e),
            )
                .into_response()
        }
    };
    runtime.touch_activity();

    if saved.written_bytes == 0 {
        return (StatusCode::BAD_REQUEST, "Tidak ada berkas yang valid").into_response();
    }

    emit_uploaded_file_event(
        &runtime,
        &target_dir,
        &saved.final_path,
        &saved.final_name,
        saved.written_bytes,
        is_batch_folder,
        batch_id.as_ref(),
        batch_folder_name,
        batch_total,
    )
    .await;

    Json(serde_json::json!({
        "ok": true,
        "saved": [{
            "fileName": saved.final_name,
            "sizeBytes": saved.written_bytes,
            "batchFolder": is_batch_folder,
        }],
    }))
    .into_response()
}

async fn handle_upload_file(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    mut multipart: Multipart,
) -> Response {
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), true)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();
    let _transfer_guard = ActiveTransferGuard::new(&runtime.active_transfers);

    let batch_id = sanitize_batch_id(
        headers
            .get("x-casa-batch-id")
            .and_then(|v| v.to_str().ok()),
    );
    let batch_total: u32 = headers
        .get("x-casa-batch-total")
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.trim().parse::<u32>().ok())
        .unwrap_or(1)
        .max(1);

    let base_drop_dir = match runtime.app_handle.as_ref() {
        Some(app) => match resolve_casa_drop_dir(app) {
            Ok(dir) => dir,
            Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
        },
        None => runtime.download_dir.clone(),
    };

    let mut saved_results = Vec::new();

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let raw_name = field.file_name().unwrap_or("upload-hp.bin").to_string();
        let safe_name = sanitize_transit_filename(&raw_name);
        let wants_batch_folder = batch_total > 5 && batch_id.is_some();

        let mut received_bytes: u64 = 0;
        let mut touch_accum: u64 = 0;
        let mut active_writer: Option<(
            mpsc::Sender<Bytes>,
            Arc<AtomicBool>,
            tokio::task::JoinHandle<Result<BlockingUploadResult, (StatusCode, String)>>,
            PathBuf,
            bool,
            Option<String>,
        )> = None;

        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    if chunk.is_empty() {
                        continue;
                    }
                    let chunk_len = chunk.len() as u64;
                    if received_bytes.saturating_add(chunk_len) > MAX_UPLOAD_FILE_BYTES {
                        drop(active_writer);
                        return (
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "Ukuran berkas melebihi batas 4 GB",
                        )
                            .into_response();
                    }

                    if active_writer.is_none() {
                        let (target_dir, is_batch_folder, batch_folder_name) =
                            match resolve_or_create_upload_target_dir(
                                &runtime,
                                &base_drop_dir,
                                wants_batch_folder,
                                batch_id.as_ref(),
                                batch_total,
                            )
                            .await
                            {
                                Ok(v) => v,
                                Err((code, msg)) => return (code, msg).into_response(),
                            };

                        let millis = SystemTime::now()
                            .duration_since(UNIX_EPOCH)
                            .unwrap_or_default()
                            .as_millis();
                        let seq = UPLOAD_PART_SEQ.fetch_add(1, Ordering::Relaxed);
                        let part_path =
                            base_drop_dir.join(format!(".{}_{}_{}.part", millis, seq, safe_name));
                        let (tx, rx) = mpsc::channel::<Bytes>(UPLOAD_CHANNEL_CAPACITY);
                        let commit_ok = Arc::new(AtomicBool::new(false));
                        let handle = spawn_blocking_upload_writer(
                            part_path,
                            target_dir.clone(),
                            safe_name.clone(),
                            rx,
                            Arc::clone(&commit_ok),
                        );
                        active_writer = Some((
                            tx,
                            commit_ok,
                            handle,
                            target_dir,
                            is_batch_folder,
                            batch_folder_name,
                        ));
                    }

                    let tx_ref = &active_writer.as_ref().unwrap().0;
                    if tx_ref.send(chunk).await.is_err() {
                        if let Some((tx, _, handle, _, _, _)) = active_writer.take() {
                            drop(tx);
                            if let Ok(Err((code, msg))) = handle.await {
                                return (code, msg).into_response();
                            }
                        }
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            "Writer disk terhenti saat menerima berkas",
                        )
                            .into_response();
                    }

                    received_bytes += chunk_len;
                    touch_accum += chunk_len;
                    if touch_accum >= TOUCH_INTERVAL_BYTES {
                        touch_accum = 0;
                        runtime.touch_activity();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    drop(active_writer);
                    return (
                        StatusCode::BAD_REQUEST,
                        format!("Stream unggahan terputus: {}", e),
                    )
                        .into_response();
                }
            }
        }

        let Some((tx, commit_ok, handle, target_dir, is_batch_folder, batch_folder_name)) =
            active_writer
        else {
            continue;
        };

        commit_ok.store(true, Ordering::Release);
        drop(tx);

        let saved = match handle.await {
            Ok(Ok(res)) => res,
            Ok(Err((code, msg))) => return (code, msg).into_response(),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Task penulisan berkas gagal: {}", e),
                )
                    .into_response()
            }
        };
        runtime.touch_activity();

        if saved.written_bytes == 0 {
            continue;
        }

        emit_uploaded_file_event(
            &runtime,
            &target_dir,
            &saved.final_path,
            &saved.final_name,
            saved.written_bytes,
            is_batch_folder,
            batch_id.as_ref(),
            batch_folder_name,
            batch_total,
        )
        .await;

        saved_results.push(serde_json::json!({
            "fileName": saved.final_name,
            "sizeBytes": saved.written_bytes,
            "batchFolder": is_batch_folder,
        }));
    }

    if saved_results.is_empty() {
        return (StatusCode::BAD_REQUEST, "Tidak ada berkas yang valid").into_response();
    }

    Json(serde_json::json!({ "ok": true, "saved": saved_results })).into_response()
}

fn sanitize_content_disposition_name(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c.is_ascii_graphic() && !matches!(c, '"' | '\\' | '/' | ':' | ';' | '<' | '>') {
                c
            } else if c == ' ' {
                ' '
            } else {
                '_'
            }
        })
        .collect();
    let trimmed = cleaned.trim();
    if trimmed.is_empty() {
        "casa-download.bin".to_string()
    } else {
        trimmed.to_string()
    }
}

pub fn guess_download_mime_type(file_name: &str) -> &'static str {
    let ext = file_name
        .rsplit('.')
        .next()
        .unwrap_or("")
        .trim()
        .to_ascii_lowercase();
    match ext.as_str() {
        "zip" => "application/zip",
        "pdf" => "application/pdf",
        "txt" | "log" | "md" => "text/plain; charset=utf-8",
        "csv" => "text/csv; charset=utf-8",
        "json" => "application/json; charset=utf-8",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        "mp3" => "audio/mpeg",
        "wav" => "audio/wav",
        "ogg" | "opus" => "audio/ogg",
        "m4a" => "audio/mp4",
        "flac" => "audio/flac",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mov" => "video/quicktime",
        "mkv" => "video/x-matroska",
        _ => "application/octet-stream",
    }
}

fn encode_rfc5987_utf8(input: &str) -> String {
    use std::fmt::Write;
    let mut out = String::with_capacity(input.len());
    for &b in input.as_bytes() {
        let unreserved = b.is_ascii_alphanumeric()
            || matches!(
                b,
                b'!' | b'#' | b'$' | b'&' | b'+' | b'-' | b'.' | b'^' | b'_' | b'`' | b'|' | b'~'
            );
        if unreserved {
            out.push(b as char);
        } else {
            let _ = write!(&mut out, "%{:02X}", b);
        }
    }
    out
}

pub fn build_content_disposition_attachment(raw_name: &str) -> String {
    let utf8_name = raw_name
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '"' | '\\' | '/' | ':' | ';' | '<' | '>') {
                '_'
            } else {
                c
            }
        })
        .collect::<String>()
        .trim()
        .to_string();
    let clean_utf8 = if utf8_name.is_empty() {
        "casa-download.bin".to_string()
    } else {
        utf8_name
    };
    let ascii_fallback = sanitize_content_disposition_name(&clean_utf8);
    let encoded_utf8 = encode_rfc5987_utf8(&clean_utf8);
    format!(
        "attachment; filename=\"{}\"; filename*=UTF-8''{}",
        ascii_fallback, encoded_utf8
    )
}

async fn handle_download_file(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxumPath(item_id): AxumPath<String>,
    Query(query): Query<TokenQuery>,
) -> Response {
    if runtime.stopped.load(Ordering::SeqCst) {
        return (StatusCode::SERVICE_UNAVAILABLE, "Connect HP session closed").into_response();
    }
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), false)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();

    let entry_opt = {
        let map = runtime.shared_by_id.read().await;
        map.get(&item_id).cloned()
    };

    let Some(entry) = entry_opt else {
        return (StatusCode::NOT_FOUND, "Item tidak ditemukan di Dropzone").into_response();
    };

    let Some(disk_path) = entry.local_path else {
        return (StatusCode::BAD_REQUEST, "Item tidak memiliki berkas fisik").into_response();
    };

    let Ok(meta) = tokio::fs::metadata(&disk_path).await else {
        return (StatusCode::NOT_FOUND, "Berkas sudah tidak ada di disk").into_response();
    };

    // Streaming Folder sebagai ZIP STORE (0% kompresi, 1-pass Data Descriptor, O(1) RAM)
    // disertai header Content-Length eksak sebelum streaming agar Chrome Android menampilkan progres ukuran penuh.
    if meta.is_dir() {
        let folder_label = entry.public.title.trim().to_string();
        let raw_zip_name = if folder_label.is_empty() {
            "casa-folder.zip".to_string()
        } else if folder_label.to_ascii_lowercase().ends_with(".zip") {
            folder_label
        } else {
            format!("{}.zip", folder_label)
        };

        let folder_for_plan = disk_path.clone();
        let plan = match tauri::async_runtime::spawn_blocking(move || {
            prepare_store_zip_plan(&folder_for_plan)
        })
        .await
        {
            Ok(Ok(p)) => p,
            Ok(Err(e)) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal menghitung ukuran arsip ZIP: {}", e),
                )
                    .into_response()
            }
        };

        let total_zip_bytes = plan.total_zip_bytes;
        let (tx, rx) = mpsc::channel::<std::io::Result<Bytes>>(DOWNLOAD_CHANNEL_CAPACITY);
        let runtime_clone = Arc::clone(&runtime);

        tokio::task::spawn_blocking(move || {
            let _guard = ActiveTransferGuard::new(&runtime_clone.active_transfers);
            let rt_ref = Arc::clone(&runtime_clone);
            let mut touch_accum: u64 = 0;
            let channel_writer = ChannelSyncWriter::new(tx.clone(), move |n| {
                touch_accum = touch_accum.saturating_add(n);
                if touch_accum >= TOUCH_INTERVAL_BYTES {
                    touch_accum = 0;
                    rt_ref.touch_activity();
                }
            });
            let mut buffered_writer =
                std::io::BufWriter::with_capacity(ZIP_CHUNK_BYTES, channel_writer);
            let rt_touch = Arc::clone(&runtime_clone);
            if let Err(e) =
                write_streaming_store_zip_from_plan_sync(&plan, &mut buffered_writer, move || {
                    rt_touch.touch_activity();
                })
            {
                let _ = tx.blocking_send(Err(e));
            }
        });

        let stream = ReaderStream::with_capacity(ChannelAsyncRead::new(rx), ZIP_CHUNK_BYTES);
        let body = Body::from_stream(stream);
        let mut resp = Response::new(body);
        resp.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/zip"),
        );
        if let Ok(cl) = HeaderValue::from_str(&total_zip_bytes.to_string()) {
            resp.headers_mut().insert(header::CONTENT_LENGTH, cl);
        }
        if let Ok(cd) = HeaderValue::from_str(&build_content_disposition_attachment(&raw_zip_name)) {
            resp.headers_mut().insert(header::CONTENT_DISPOSITION, cd);
        }
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
        resp.headers_mut().insert(
            header::X_CONTENT_TYPE_OPTIONS,
            HeaderValue::from_static("nosniff"),
        );
        return resp;
    }

    // Streaming Single File (dedicated spawn_blocking 512 KiB reader -> bounded mpsc(4) -> Body::from_stream)
    let file_for_read = match tokio::fs::File::open(&disk_path).await {
        Ok(f) => f.into_std().await,
        Err(_) => return (StatusCode::NOT_FOUND, "Gagal membuka berkas").into_response(),
    };

    let raw_file_name = disk_path
        .file_name()
        .map(|s| s.to_string_lossy().into_owned())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "casa-file.bin".to_string());
    let mime_type = guess_download_mime_type(&raw_file_name);
    let file_len = meta.len();

    let (tx, rx) = mpsc::channel::<std::io::Result<Bytes>>(DOWNLOAD_CHANNEL_CAPACITY);
    let runtime_clone = Arc::clone(&runtime);
    tokio::task::spawn_blocking(move || {
        let _guard = ActiveTransferGuard::new(&runtime_clone.active_transfers);
        let mut file = file_for_read;
        let mut touch_accum: u64 = 0;
        loop {
            let mut chunk_buf = vec![0u8; DOWNLOAD_CHUNK_BYTES];
            match file.read(&mut chunk_buf) {
                Ok(0) => break,
                Ok(n) => {
                    chunk_buf.truncate(n);
                    touch_accum = touch_accum.saturating_add(n as u64);
                    if touch_accum >= TOUCH_INTERVAL_BYTES {
                        touch_accum = 0;
                        runtime_clone.touch_activity();
                    }
                    if tx.blocking_send(Ok(Bytes::from(chunk_buf))).is_err() {
                        break;
                    }
                }
                Err(e) => {
                    let _ = tx.blocking_send(Err(e));
                    break;
                }
            }
        }
    });

    let stream = ReaderStream::with_capacity(ChannelAsyncRead::new(rx), DOWNLOAD_CHUNK_BYTES);
    let body = Body::from_stream(stream);
    let mut resp = Response::new(body);
    resp.headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static(mime_type));
    if let Ok(cl) = HeaderValue::from_str(&file_len.to_string()) {
        resp.headers_mut().insert(header::CONTENT_LENGTH, cl);
    }
    if let Ok(cd) = HeaderValue::from_str(&build_content_disposition_attachment(&raw_file_name)) {
        resp.headers_mut().insert(header::CONTENT_DISPOSITION, cd);
    }
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    resp.headers_mut().insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    resp
}

pub fn shutdown_connect_hp_server() {
    if let Ok(mut guard) = GLOBAL_RUNTIME.lock() {
        if let Some(rt) = guard.take() {
            rt.stopped.store(true, Ordering::SeqCst);
            let _ = rt.ws_broadcast.send("__casa_shutdown__".to_string());
            if let Ok(mut tx_guard) = rt.shutdown_tx.lock() {
                if let Some(tx) = tx_guard.take() {
                    let _ = tx.send(());
                }
            }
            if let Ok(mut wd) = rt.watchdog_task.lock() {
                if let Some(handle) = wd.take() {
                    handle.abort();
                }
            }
            if let Ok(mut st) = rt.serve_task.lock() {
                if let Some(handle) = st.take() {
                    handle.abort();
                }
            }
        }
    }
}

pub async fn shutdown_connect_hp_server_async() {
    let rt_opt = GLOBAL_RUNTIME.lock().ok().and_then(|mut guard| guard.take());
    let Some(rt) = rt_opt else {
        return;
    };

    rt.stopped.store(true, Ordering::SeqCst);
    let _ = rt.ws_broadcast.send("__casa_shutdown__".to_string());
    if let Ok(mut tx_guard) = rt.shutdown_tx.lock() {
        if let Some(tx) = tx_guard.take() {
            let _ = tx.send(());
        }
    }
    if let Ok(mut wd) = rt.watchdog_task.lock() {
        if let Some(handle) = wd.take() {
            handle.abort();
        }
    }
    let serve_handle_opt = rt.serve_task.lock().ok().and_then(|mut st| st.take());
    if let Some(mut handle) = serve_handle_opt {
        if tokio::time::timeout(std::time::Duration::from_millis(120), &mut handle)
            .await
            .is_err()
        {
            handle.abort();
            let _ = handle.await;
        }
    }
}

fn build_connect_hp_router(runtime: Arc<ServerRuntime>) -> Router {
    Router::new()
        .route("/", get(handle_index))
        .route("/ws", get(handle_ws_upgrade))
        .route("/api/items", get(handle_get_items))
        .route("/api/text", post(handle_post_text))
        .route(
            "/api/upload-raw",
            post(handle_upload_raw).layer(DefaultBodyLimit::disable()),
        )
        .route(
            "/api/upload",
            post(handle_upload_file).layer(DefaultBodyLimit::disable()),
        )
        .route("/api/file/:id", get(handle_download_file))
        .layer(DefaultBodyLimit::max(MAX_DEFAULT_HTTP_BODY_BYTES))
        .layer(from_fn_with_state(
            Arc::clone(&runtime),
            connect_hp_security_middleware,
        ))
        .with_state(runtime)
}

#[tauri::command]
pub async fn start_connect_hp(
    app: tauri::AppHandle,
    preferred_ip: Option<String>,
    auto_copy_clipboard: Option<bool>,
) -> Result<ConnectHpSessionInfo, String> {
    let candidates = enumerate_lan_interfaces();
    let net_category = detect_windows_network_category().await;
    let download_dir = resolve_casa_drop_dir(&app)?;

    if let Ok(existing_opt) = GLOBAL_RUNTIME.lock().map(|g| g.clone()) {
        if let Some(rt) = existing_opt {
            if !rt.stopped.load(Ordering::SeqCst) {
                if let Some(pref) = preferred_ip.as_deref() {
                    if candidates.iter().any(|c| c.ip == pref) {
                        if let Ok(mut sel) = rt.selected_ip.lock() {
                            *sel = pref.to_string();
                        }
                    }
                }
                if let Ok(mut cand_guard) = rt.candidate_interfaces.lock() {
                    *cand_guard = candidates;
                }
                if let Ok(mut cat_guard) = rt.network_category.lock() {
                    *cat_guard = net_category;
                }
                if let Some(ac) = auto_copy_clipboard {
                    rt.auto_copy_clipboard
                        .store(if ac { 1 } else { 0 }, Ordering::Relaxed);
                }
                rt.touch_activity();
                let info = rt.to_session_info(None);
                let _ = app.emit("casa://connect-hp-status", &info);
                return Ok(info);
            }
        }
    }

    let chosen_ip = preferred_ip
        .filter(|p| candidates.iter().any(|c| &c.ip == p))
        .unwrap_or_else(|| candidates[0].ip.clone());

    let token = generate_csprng_token_hex()?;
    let listener = tokio::net::TcpListener::bind("0.0.0.0:0")
        .await
        .map_err(|e| format!("Gagal membuka listener LAN lokal: {}", e))?;
    let port = listener
        .local_addr()
        .map_err(|e| format!("Gagal membaca port lokal: {}", e))?
        .port();

    let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
    let (ws_broadcast, _) = broadcast::channel::<String>(32);
    let session_id = NEXT_SESSION_ID.fetch_add(1, Ordering::Relaxed);

    let runtime = Arc::new(ServerRuntime {
        session_id,
        token,
        port,
        stopped: AtomicBool::new(false),
        selected_ip: Mutex::new(chosen_ip),
        candidate_interfaces: Mutex::new(candidates),
        network_category: Mutex::new(net_category),
        download_dir,
        auto_copy_clipboard: AtomicUsize::new(if auto_copy_clipboard.unwrap_or(true) { 1 } else { 0 }),
        connected_clients: AtomicUsize::new(0),
        active_transfers: AtomicUsize::new(0),
        last_activity_epoch: AtomicU64::new(now_epoch_secs()),
        shared_items: RwLock::new(Vec::new()),
        shared_by_id: RwLock::new(HashMap::new()),
        batch_folders: tokio::sync::Mutex::new(HashMap::new()),
        ws_broadcast,
        shutdown_tx: Mutex::new(Some(shutdown_tx)),
        serve_task: Mutex::new(None),
        watchdog_task: Mutex::new(None),
        app_handle: Some(app.clone()),
    });

    {
        let mut guard = GLOBAL_RUNTIME
            .lock()
            .map_err(|_| "State lock Connect HP terganggu".to_string())?;
        *guard = Some(Arc::clone(&runtime));
    }

    let router = build_connect_hp_router(Arc::clone(&runtime));

    let rt_serve = Arc::clone(&runtime);
    let serve_handle = tauri::async_runtime::spawn(async move {
        let _ = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .tcp_nodelay(true)
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await;

        rt_serve.stopped.store(true, Ordering::SeqCst);
        if let Ok(mut guard) = GLOBAL_RUNTIME.lock() {
            if guard.as_ref().map(|r| r.session_id) == Some(rt_serve.session_id) {
                *guard = None;
            }
        }
    });
    if let Ok(mut guard) = runtime.serve_task.lock() {
        *guard = Some(serve_handle);
    }

    // Idle Watchdog: matikan otomatis jika benar-benar idle > 10 menit tanpa transfer/WS aktif
    let rt_watchdog = Arc::clone(&runtime);
    let watchdog_handle = tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            ticker.tick().await;
            let still_current = !rt_watchdog.stopped.load(Ordering::SeqCst)
                && GLOBAL_RUNTIME
                    .lock()
                    .ok()
                    .and_then(|g| g.as_ref().map(|r| r.session_id == rt_watchdog.session_id))
                    .unwrap_or(false);
            if !still_current {
                break;
            }
            if rt_watchdog.active_transfers.load(Ordering::Relaxed) > 0 {
                rt_watchdog.touch_activity();
                continue;
            }
            let elapsed = now_epoch_secs().saturating_sub(
                rt_watchdog.last_activity_epoch.load(Ordering::Relaxed),
            );
            if elapsed >= IDLE_TIMEOUT_SECS {
                rt_watchdog.stopped.store(true, Ordering::SeqCst);
                let _ = rt_watchdog
                    .ws_broadcast
                    .send("__casa_shutdown__".to_string());
                if let Ok(mut guard) = GLOBAL_RUNTIME.lock() {
                    if guard.as_ref().map(|r| r.session_id) == Some(rt_watchdog.session_id) {
                        *guard = None;
                    }
                }
                if let Ok(mut tx_guard) = rt_watchdog.shutdown_tx.lock() {
                    if let Some(tx) = tx_guard.take() {
                        let _ = tx.send(());
                    }
                }
                if let Some(ref app) = rt_watchdog.app_handle {
                    let _ = app.emit(
                        "casa://connect-hp-status",
                        ConnectHpSessionInfo::inactive(Some("idle_timeout".to_string())),
                    );
                }
                break;
            }
        }
    });
    if let Ok(mut guard) = runtime.watchdog_task.lock() {
        *guard = Some(watchdog_handle);
    }

    let info = runtime.to_session_info(None);
    let _ = app.emit("casa://connect-hp-status", &info);
    Ok(info)
}

#[tauri::command]
pub async fn stop_connect_hp(app: tauri::AppHandle) -> Result<(), String> {
    shutdown_connect_hp_server_async().await;
    let _ = app.emit(
        "casa://connect-hp-status",
        ConnectHpSessionInfo::inactive(Some("manual_stop".to_string())),
    );
    Ok(())
}

#[tauri::command]
pub fn get_connect_hp_status() -> ConnectHpSessionInfo {
    if let Ok(guard) = GLOBAL_RUNTIME.lock() {
        if let Some(rt) = guard.as_ref() {
            return rt.to_session_info(None);
        }
    }
    ConnectHpSessionInfo::inactive(None)
}

#[tauri::command]
pub async fn select_connect_hp_interface(
    app: tauri::AppHandle,
    preferred_ip: String,
) -> Result<ConnectHpSessionInfo, String> {
    let candidates = enumerate_lan_interfaces();
    let net_category = detect_windows_network_category().await;
    let rt_opt = GLOBAL_RUNTIME.lock().ok().and_then(|g| g.clone());
    let Some(rt) = rt_opt else {
        return Err("Sesi Connect HP belum aktif".to_string());
    };

    if let Ok(mut cand_guard) = rt.candidate_interfaces.lock() {
        *cand_guard = candidates.clone();
    }
    if let Ok(mut cat_guard) = rt.network_category.lock() {
        *cat_guard = net_category;
    }
    if candidates.iter().any(|c| c.ip == preferred_ip) {
        if let Ok(mut sel) = rt.selected_ip.lock() {
            *sel = preferred_ip;
        }
    }
    rt.touch_activity();
    let info = rt.to_session_info(None);
    let _ = app.emit("casa://connect-hp-status", &info);
    Ok(info)
}

#[tauri::command]
pub fn set_connect_hp_auto_copy(
    app: tauri::AppHandle,
    enabled: bool,
) -> Result<ConnectHpSessionInfo, String> {
    let rt_opt = GLOBAL_RUNTIME.lock().ok().and_then(|g| g.clone());
    let Some(rt) = rt_opt else {
        return Ok(ConnectHpSessionInfo {
            auto_copy_clipboard: enabled,
            ..ConnectHpSessionInfo::inactive(None)
        });
    };
    rt.auto_copy_clipboard
        .store(if enabled { 1 } else { 0 }, Ordering::Relaxed);
    let info = rt.to_session_info(None);
    let _ = app.emit("casa://connect-hp-status", &info);
    Ok(info)
}

/// Menyinkronkan daftar kartu Dropzone secara aman ke memori server LAN:
/// path disk lokal TIDAK PERNAH dikirim ke WebSocket atau HTTP response HP.
async fn apply_sync_items_to_runtime(
    runtime: &ServerRuntime,
    items: Vec<ConnectHpSyncItem>,
) -> usize {
    let mut entries = Vec::with_capacity(items.len());
    let mut id_map = HashMap::with_capacity(items.len());
    let mut public_list = Vec::with_capacity(items.len());

    for item in items {
        let is_text_or_link = item.item_type == "text" || item.item_type == "link";
        let local_path = if !is_text_or_link {
            item.local_path
                .as_deref()
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(PathBuf::from)
        } else {
            None
        };

        let resolved_size_bytes = if item.item_type == "folder" && item.size_bytes.is_none() {
            if let Some(dir_path) = local_path.as_ref().filter(|p| p.is_dir()).cloned() {
                tauri::async_runtime::spawn_blocking(move || {
                    prepare_store_zip_plan(&dir_path)
                        .ok()
                        .map(|p| p.total_zip_bytes)
                })
                .await
                .ok()
                .flatten()
            } else {
                None
            }
        } else {
            item.size_bytes
        };

        let public_item = ConnectHpPublicItem {
            id: item.id.clone(),
            item_type: item.item_type,
            title: item.title,
            extension: item.extension,
            size_bytes: resolved_size_bytes,
            file_count: item.file_count,
            text_payload: if is_text_or_link {
                item.text_payload
            } else {
                None
            },
        };

        let entry = SharedEntry {
            public: public_item.clone(),
            local_path,
        };
        id_map.insert(item.id, entry.clone());
        entries.push(entry);
        public_list.push(public_item);
    }

    let synced_len = entries.len();
    {
        let mut w_list = runtime.shared_items.write().await;
        *w_list = entries;
    }
    {
        let mut w_map = runtime.shared_by_id.write().await;
        *w_map = id_map;
    }

    if let Ok(msg) = serde_json::to_string(&serde_json::json!({
        "type": "items",
        "items": public_list,
        "connectedClients": runtime.connected_clients.load(Ordering::Relaxed),
    })) {
        let _ = runtime.ws_broadcast.send(msg);
    }

    synced_len
}

#[tauri::command]
pub async fn sync_connect_hp_items(items: Vec<ConnectHpSyncItem>) -> Result<(), String> {
    let rt_opt = GLOBAL_RUNTIME.lock().ok().and_then(|g| g.clone());
    let Some(rt) = rt_opt else {
        return Ok(());
    };
    let _ = apply_sync_items_to_runtime(&rt, items).await;
    Ok(())
}

#[tauri::command]
pub fn open_windows_network_settings(target: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let uri = match target.as_str() {
            "hotspot" => "ms-settings:network-mobilehotspot",
            "firewall" => "ms-settings:windowsdefender",
            _ => "ms-settings:network-status",
        };
        let wide_uri: Vec<u16> = OsStr::new(uri).encode_wide().chain(std::iter::once(0)).collect();
        let wide_open: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();

        unsafe {
            let res = ShellExecuteW(
                std::ptr::null_mut(),
                wide_open.as_ptr(),
                wide_uri.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL,
            );
            if (res as isize) <= 32 {
                return Err(format!("Gagal membuka pengaturan jaringan Windows ({})", uri));
            }
        }
        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = target;
        Ok(())
    }
}

// Self-contained Pure Monochrome OLED Mobile Web UI (0 CDN, URL Scrub, HTTP-Safe Copy, Batch <=2 Parallel + 1x Retry)
pub const MOBILE_WEB_UI_HTML: &str = r##"<!DOCTYPE html>
<html lang="id">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,viewport-fit=cover" />
<meta name="theme-color" content="#000000" />
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; object-src 'none'; base-uri 'none';" />
<title>CASA · Connect HP</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  html, body { margin: 0; padding: 0; background: #000000; color: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; min-height: 100%; }
  body { padding: 14px 14px 36px; max-width: 540px; margin: 0 auto; }
  .head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 2px 14px; border-bottom: 1px solid rgba(255,255,255,0.09); margin-bottom: 14px; }
  .head-actions { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; letter-spacing: -0.02em; }
  .reconnect-btn { border: 1px solid rgba(255,255,255,0.22); background: rgba(255,255,255,0.12); color: #ffffff; border-radius: 999px; padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: pointer; }
  [hidden] { display: none !important; }
  .status-pill { font-family: ui-monospace, SFMono-Regular, monospace; font-size: 11px; padding: 4px 10px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.06); color: #e4e4e7; }
  .status-pill.ok { background: #ffffff; color: #000000; border-color: #ffffff; font-weight: 600; }
  .card { background: #09090b; border: 1px solid rgba(255,255,255,0.10); border-radius: 16px; padding: 14px; margin-bottom: 14px; }
  .card-title { font-size: 12px; font-weight: 600; color: #ffffff; margin: 0 0 10px; display: flex; align-items: center; justify-content: space-between; }
  .muted { font-size: 11px; color: #a1a1aa; line-height: 1.45; }
  textarea { width: 100%; min-height: 74px; background: #000000; color: #ffffff; border: 1px solid rgba(255,255,255,0.14); border-radius: 12px; padding: 10px; font-size: 14px; resize: vertical; outline: none; font-family: inherit; }
  textarea:focus { border-color: rgba(255,255,255,0.45); }
  .row { display: flex; gap: 8px; margin-top: 10px; align-items: center; }
  .btn { border: 1px solid rgba(255,255,255,0.16); background: rgba(255,255,255,0.08); color: #ffffff; border-radius: 999px; padding: 10px 14px; font-size: 13px; font-weight: 600; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; gap: 6px; text-decoration: none; }
  .btn.primary { background: #ffffff; color: #000000; border-color: #ffffff; flex: 1; }
  .btn:disabled { opacity: 0.45; }
  .pick-label { width: 100%; text-align: center; display: flex; align-items: center; justify-content: center; gap: 8px; padding: 14px; border: 1px dashed rgba(255,255,255,0.25); border-radius: 12px; background: rgba(255,255,255,0.03); color: #ffffff; font-size: 13px; font-weight: 600; cursor: pointer; }
  .pick-input { display: none; }
  .prog-wrap { margin-top: 12px; display: none; }
  .prog-wrap.active { display: block; }
  .prog-meta { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-size: 11px; font-family: ui-monospace, monospace; color: #d4d4d8; margin-bottom: 6px; }
  .prog-right { display: inline-flex; align-items: center; gap: 8px; }
  .prog-speed { color: #a1a1aa; font-size: 10.5px; }
  .prog-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.12); border-radius: 999px; overflow: hidden; }
  .prog-fill { height: 100%; width: 100%; background: #ffffff; transform-origin: left center; transform: scaleX(0); transition: transform 0.1s linear; will-change: transform; }
  .wake-note { margin-top: 8px; font-size: 11px; color: #d4d4d8; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 7px 10px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .item-block { display: flex; flex-direction: column; gap: 4px; }
  .item-row { background: #000000; border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .item-info { min-width: 0; flex: 1; }
  .item-name { font-size: 13px; font-weight: 500; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-sub { font-size: 11px; font-family: ui-monospace, monospace; color: #a1a1aa; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .zip-note { font-size: 10.5px; color: #a1a1aa; padding: 0 6px; line-height: 1.35; }
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #ffffff; color: #000000; font-size: 12px; font-weight: 600; padding: 8px 14px; border-radius: 999px; display: none; z-index: 99; box-shadow: 0 6px 24px rgba(0,0,0,0.7); }
  .toast.show { display: block; }
</style>
</head>
<body>
  <header class="head">
    <div class="brand">CASA &times; Connect HP</div>
    <div class="head-actions">
      <button type="button" class="reconnect-btn" id="reconnect-btn" hidden>Hubungkan Ulang</button>
      <span class="status-pill" id="ws-badge">Menghubungkan...</span>
    </div>
  </header>

  <section class="card">
    <div class="card-title"><span>Kirim Teks / Tautan ke Laptop</span></div>
    <textarea id="text-input" placeholder="Tempel teks, catatan, atau tautan http(s)..."></textarea>
    <div class="row">
      <button type="button" class="btn primary" id="send-text-btn">Kirim &amp; Salin di Laptop</button>
    </div>
  </section>

  <section class="card">
    <div class="card-title">
      <span>Kirim Foto / File ke Laptop</span>
      <span class="muted">Direct Stream</span>
    </div>
    <label class="pick-label" for="file-input">
      <span>+ Pilih File atau Banyak Foto (&gt;5 file otomatis 1 folder)</span>
    </label>
    <input class="pick-input" id="file-input" type="file" multiple />
    <div class="prog-wrap" id="upload-prog-wrap">
      <div class="prog-meta">
        <span id="upload-count-text">0 / 0 selesai</span>
        <span class="prog-right">
          <span id="upload-speed-text" class="prog-speed"></span>
          <span id="upload-pct-text">0%</span>
        </span>
      </div>
      <div class="prog-bar"><div class="prog-fill" id="upload-prog-fill"></div></div>
      <div class="wake-note">Jangan kunci layar atau pindah aplikasi selama transfer berlangsung.</div>
    </div>
  </section>

  <section class="card">
    <div class="card-title">
      <span>Dari Dropzone Laptop</span>
      <span class="muted" id="laptop-count">0 item</span>
    </div>
    <div class="list" id="laptop-list">
      <div class="muted">Belum ada item yang diparkir di Dropzone laptop.</div>
    </div>
  </section>

  <div class="toast" id="toast-box"></div>

<script>
(() => {
  'use strict';
  const TOKEN_STORAGE_KEY = 'casa_hp_token';
  const params = new URLSearchParams(window.location.search);
  const urlToken = (params.get('t') || '').trim();
  if (urlToken) {
    try {
      window.sessionStorage.setItem(TOKEN_STORAGE_KEY, urlToken);
    } catch (_err) {}
    if (window.history && typeof window.history.replaceState === 'function') {
      window.history.replaceState(null, '', '/');
    }
  }
  let storedToken = '';
  try {
    storedToken = (window.sessionStorage.getItem(TOKEN_STORAGE_KEY) || '').trim();
  } catch (_err) {}
  const SESSION_TOKEN = urlToken || storedToken;

  const wsBadge = document.getElementById('ws-badge');
  const reconnectBtn = document.getElementById('reconnect-btn');
  const textInput = document.getElementById('text-input');
  const sendTextBtn = document.getElementById('send-text-btn');
  const fileInput = document.getElementById('file-input');
  const progWrap = document.getElementById('upload-prog-wrap');
  const progFill = document.getElementById('upload-prog-fill');
  const countText = document.getElementById('upload-count-text');
  const speedText = document.getElementById('upload-speed-text');
  const pctText = document.getElementById('upload-pct-text');
  const laptopList = document.getElementById('laptop-list');
  const laptopCount = document.getElementById('laptop-count');
  const toastBox = document.getElementById('toast-box');
  let toastTimer = null;

  function showToast(msg) {
    toastBox.textContent = msg;
    toastBox.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastBox.classList.remove('show'), 2200);
  }

  // HTTP LAN http://192.168.x.x bukan Secure Context; wajib pakai textarea + execCommand('copy')
  function copyTextHttpSafe(str) {
    if (!str) return false;
    try {
      const ta = document.createElement('textarea');
      ta.value = str;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.top = '-9999px';
      ta.style.left = '-9999px';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, str.length);
      const ok = document.execCommand('copy');
      document.body.removeChild(ta);
      if (ok) return true;
    } catch (_err) {}
    if (window.isSecureContext && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(str).catch(() => {});
      return true;
    }
    return false;
  }

  function formatSize(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '';
    if (bytes < 1024) return bytes + ' B';
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    if (mb < 1024) return mb.toFixed(1) + ' MB';
    return (mb / 1024).toFixed(2) + ' GB';
  }

  function clearEl(node) {
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  function renderItems(items) {
    clearEl(laptopList);
    const arr = Array.isArray(items) ? items : [];
    laptopCount.textContent = arr.length + ' item';
    if (arr.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'muted';
      empty.textContent = 'Belum ada item yang diparkir di Dropzone laptop.';
      laptopList.appendChild(empty);
      return;
    }

    arr.forEach((it) => {
      const row = document.createElement('div');
      row.className = 'item-row';

      const info = document.createElement('div');
      info.className = 'item-info';

      const name = document.createElement('div');
      name.className = 'item-name';
      name.textContent = it.title || 'Item';

      const sub = document.createElement('div');
      sub.className = 'item-sub';
      if (it.itemType === 'text' || it.itemType === 'link') {
        sub.textContent = it.textPayload || '';
      } else if (it.itemType === 'folder') {
        sub.textContent =
          'FOLDER (.zip STORE)' +
          (it.fileCount != null ? ' · ' + it.fileCount + ' file' : '') +
          (it.sizeBytes ? ' · ' + formatSize(it.sizeBytes) : '');
      } else {
        sub.textContent = (it.extension ? it.extension.toUpperCase() : 'FILE') + (it.sizeBytes ? ' · ' + formatSize(it.sizeBytes) : '');
      }

      info.appendChild(name);
      info.appendChild(sub);
      row.appendChild(info);

      if (it.itemType === 'text' || it.itemType === 'link') {
        const cp = document.createElement('button');
        cp.type = 'button';
        cp.className = 'btn';
        cp.textContent = 'Salin';
        cp.addEventListener('click', () => {
          const ok = copyTextHttpSafe(it.textPayload || '');
          showToast(ok ? 'Tersalin ke clipboard HP' : 'Gagal menyalin teks');
        });
        row.appendChild(cp);
        laptopList.appendChild(row);
      } else {
        const dl = document.createElement('a');
        dl.className = 'btn';
        dl.href = '/api/file/' + encodeURIComponent(it.id) + '?t=' + encodeURIComponent(SESSION_TOKEN);
        const dlName = it.itemType === 'folder' ? ((it.title || 'folder') + '.zip') : (it.title || 'download');
        dl.setAttribute('download', dlName);
        dl.textContent = it.itemType === 'folder' ? 'Unduh .zip' : 'Unduh';
        row.appendChild(dl);

        if (it.itemType === 'folder') {
          const block = document.createElement('div');
          block.className = 'item-block';
          block.appendChild(row);
          const zipNote = document.createElement('div');
          zipNote.className = 'zip-note';
          zipNote.textContent = 'Jika Chrome menampilkan peringatan HTTP lokal, pilih Tetap simpan';
          block.appendChild(zipNote);
          laptopList.appendChild(block);
        } else {
          laptopList.appendChild(row);
        }
      }
    });
  }

  sendTextBtn.addEventListener('click', async () => {
    const val = (textInput.value || '').trim();
    if (!val) {
      showToast('Ketik teks atau tautan dulu');
      return;
    }
    sendTextBtn.disabled = true;
    try {
      const resp = await fetch('/api/text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Casa-Token': SESSION_TOKEN
        },
        body: JSON.stringify({ text: val })
      });
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      textInput.value = '';
      showToast('Terkirim ke Dropzone & Clipboard laptop');
    } catch (_err) {
      showToast('Gagal mengirim ke laptop');
    } finally {
      sendTextBtn.disabled = false;
    }
  });

  function uploadSingleFileRawXhr(file, batchId, batchTotal, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload-raw');
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.setRequestHeader('X-Casa-Token', SESSION_TOKEN);
      xhr.setRequestHeader('X-Casa-File-Name', encodeURIComponent(file.name || 'file.bin'));
      xhr.setRequestHeader('X-Casa-Batch-Id', batchId);
      xhr.setRequestHeader('X-Casa-Batch-Total', String(batchTotal));
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(true);
        } else {
          const err = new Error('HTTP ' + xhr.status);
          err.httpStatus = xhr.status;
          reject(err);
        }
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Aborted'));
      xhr.send(file);
    });
  }

  function uploadSingleFileMultipartXhr(file, batchId, batchTotal, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/api/upload');
      xhr.setRequestHeader('X-Casa-Token', SESSION_TOKEN);
      xhr.setRequestHeader('X-Casa-Batch-Id', batchId);
      xhr.setRequestHeader('X-Casa-Batch-Total', String(batchTotal));
      xhr.upload.onprogress = (ev) => {
        if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
      };
      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) resolve(true);
        else reject(new Error('HTTP ' + xhr.status));
      };
      xhr.onerror = () => reject(new Error('Network error'));
      xhr.onabort = () => reject(new Error('Aborted'));
      const fd = new FormData();
      fd.append('file', file, file.name || 'file.bin');
      xhr.send(fd);
    });
  }

  let preferMultipartFallback = false;

  async function uploadSingleFileXhr(file, batchId, batchTotal, onProgress) {
    if (preferMultipartFallback) {
      return await uploadSingleFileMultipartXhr(file, batchId, batchTotal, onProgress);
    }
    try {
      return await uploadSingleFileRawXhr(file, batchId, batchTotal, onProgress);
    } catch (err) {
      if (err && (err.httpStatus === 404 || err.httpStatus === 405 || err.httpStatus === 415)) {
        preferMultipartFallback = true;
        onProgress(0, file.size || 1);
        return await uploadSingleFileMultipartXhr(file, batchId, batchTotal, onProgress);
      }
      throw err;
    }
  }

  async function uploadWithRetry(file, batchId, batchTotal, onProgress) {
    try {
      return await uploadSingleFileXhr(file, batchId, batchTotal, onProgress);
    } catch (_err) {
      onProgress(0, file.size || 1);
      try {
        return await uploadSingleFileXhr(file, batchId, batchTotal, onProgress);
      } catch (_rawErr) {
        if (!preferMultipartFallback) {
          onProgress(0, file.size || 1);
          return await uploadSingleFileMultipartXhr(file, batchId, batchTotal, onProgress);
        }
        throw _rawErr;
      }
    }
  }

  const MAX_CONCURRENT_UPLOADS = 2;
  const LARGE_FILE_EXCLUSIVE_BYTES = 16 * 1024 * 1024;
  const PROGRESS_THROTTLE_MS = 100;
  const uploadQueue = [];
  let activeUploads = 0;
  let activeLargeUploads = 0;
  let sessionDone = 0;
  let sessionFailed = 0;
  let sessionTotal = 0;
  let completedBytes = 0;
  let sessionTotalBytes = 0;
  const inFlightBytes = new Map();
  let nextUploadUid = 1;
  let hideProgTimer = null;
  let lastProgressRenderAt = 0;
  let progressThrottleTimer = null;
  let progressRafId = null;
  let lastSpeedSampleAt = 0;
  let lastSpeedSampleBytes = 0;
  let smoothedSpeedBps = 0;

  function formatSpeed(bps) {
    if (!Number.isFinite(bps) || bps <= 0) return '';
    const mbps = bps / (1024 * 1024);
    if (mbps >= 0.1) return mbps.toFixed(1) + ' MB/s';
    const kbps = bps / 1024;
    if (kbps >= 1) return Math.round(kbps) + ' KB/s';
    return '';
  }

  function paintUploadProgressNow() {
    lastProgressRenderAt = Date.now();
    let inFlight = 0;
    inFlightBytes.forEach((bytes) => {
      inFlight += bytes;
    });
    const transferredBytes = completedBytes + inFlight;
    const pct = sessionTotalBytes > 0
      ? Math.min(100, Math.round((transferredBytes / sessionTotalBytes) * 100))
      : 0;

    if (activeUploads > 0 && lastSpeedSampleAt > 0) {
      const dtMs = lastProgressRenderAt - lastSpeedSampleAt;
      if (dtMs >= 200) {
        const deltaBytes = transferredBytes - lastSpeedSampleBytes;
        if (deltaBytes > 0) {
          const instantBps = (deltaBytes * 1000) / dtMs;
          smoothedSpeedBps = smoothedSpeedBps > 0
            ? (smoothedSpeedBps * 0.65 + instantBps * 0.35)
            : instantBps;
        }
        lastSpeedSampleAt = lastProgressRenderAt;
        lastSpeedSampleBytes = transferredBytes;
      }
    } else if (activeUploads > 0 && lastSpeedSampleAt === 0) {
      lastSpeedSampleAt = lastProgressRenderAt;
      lastSpeedSampleBytes = transferredBytes;
    } else if (activeUploads === 0 && uploadQueue.length === 0) {
      smoothedSpeedBps = 0;
      lastSpeedSampleAt = 0;
      lastSpeedSampleBytes = 0;
    }

    countText.textContent = sessionDone + ' / ' + sessionTotal + ' selesai';
    pctText.textContent = pct + '%';
    if (speedText) {
      speedText.textContent = activeUploads > 0 ? formatSpeed(smoothedSpeedBps) : '';
    }
    progFill.style.transform = 'scaleX(' + (pct / 100) + ')';
  }

  function renderUploadProgress(force) {
    if (force) {
      if (progressThrottleTimer) {
        clearTimeout(progressThrottleTimer);
        progressThrottleTimer = null;
      }
      if (progressRafId !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(progressRafId);
        progressRafId = null;
      }
      paintUploadProgressNow();
      return;
    }

    const now = Date.now();
    const elapsed = now - lastProgressRenderAt;
    const scheduleRaf = () => {
      if (progressRafId !== null) return;
      if (typeof requestAnimationFrame === 'function') {
        progressRafId = requestAnimationFrame(() => {
          progressRafId = null;
          paintUploadProgressNow();
        });
      } else {
        paintUploadProgressNow();
      }
    };

    if (elapsed >= PROGRESS_THROTTLE_MS) {
      if (progressThrottleTimer) {
        clearTimeout(progressThrottleTimer);
        progressThrottleTimer = null;
      }
      scheduleRaf();
    } else if (!progressThrottleTimer) {
      progressThrottleTimer = setTimeout(() => {
        progressThrottleTimer = null;
        scheduleRaf();
      }, Math.max(16, PROGRESS_THROTTLE_MS - elapsed));
    }
  }

  function pumpQueue() {
    while (uploadQueue.length > 0) {
      if (activeLargeUploads > 0) break;
      const nextItem = uploadQueue[0];
      const nextIsLarge = nextItem.size >= LARGE_FILE_EXCLUSIVE_BYTES;
      if (nextIsLarge) {
        if (activeUploads > 0) break;
      } else if (activeUploads >= MAX_CONCURRENT_UPLOADS) {
        break;
      }

      const item = uploadQueue.shift();
      const isLarge = item.size >= LARGE_FILE_EXCLUSIVE_BYTES;
      activeUploads += 1;
      if (isLarge) activeLargeUploads += 1;
      inFlightBytes.set(item.uid, 0);
      (async () => {
        try {
          await uploadWithRetry(item.file, item.batchId, item.batchTotal, (loaded) => {
            inFlightBytes.set(item.uid, Math.min(Math.max(0, loaded), item.size));
            renderUploadProgress(false);
          });
          inFlightBytes.delete(item.uid);
          completedBytes += item.size;
          sessionDone += 1;
        } catch (_err) {
          inFlightBytes.delete(item.uid);
          completedBytes += item.size;
          sessionFailed += 1;
        } finally {
          activeUploads -= 1;
          if (isLarge) activeLargeUploads = Math.max(0, activeLargeUploads - 1);
          renderUploadProgress(true);
          if (uploadQueue.length > 0) {
            pumpQueue();
          } else if (activeUploads === 0) {
            showToast(
              sessionFailed === 0
                ? (sessionTotal > 5 ? sessionTotal + ' file masuk ke folder Downloads\\CASA Drop' : sessionTotal + ' file terkirim')
                : (sessionDone + ' selesai, ' + sessionFailed + ' gagal')
            );
            if (hideProgTimer) {
              clearTimeout(hideProgTimer);
            }
            hideProgTimer = setTimeout(() => {
              hideProgTimer = null;
              if (activeUploads === 0 && uploadQueue.length === 0) {
                progWrap.classList.remove('active');
              }
            }, 2500);
          }
        }
      })();
    }
  }

  fileInput.addEventListener('change', () => {
    const files = Array.from(fileInput.files || []);
    fileInput.value = '';
    if (files.length === 0) return;

    if (hideProgTimer) {
      clearTimeout(hideProgTimer);
      hideProgTimer = null;
    }

    if (activeUploads === 0 && uploadQueue.length === 0) {
      sessionDone = 0;
      sessionFailed = 0;
      sessionTotal = 0;
      completedBytes = 0;
      sessionTotalBytes = 0;
      smoothedSpeedBps = 0;
      lastSpeedSampleAt = Date.now();
      lastSpeedSampleBytes = 0;
      inFlightBytes.clear();
    }

    const batchId = 'b-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    const batchTotal = files.length;
    let addedBytes = 0;
    files.forEach((f) => {
      const size = Math.max(1, f.size || 1);
      addedBytes += size;
      uploadQueue.push({
        uid: nextUploadUid++,
        file: f,
        size,
        batchId,
        batchTotal,
      });
    });

    sessionTotal += files.length;
    sessionTotalBytes += addedBytes;

    progWrap.classList.add('active');
    renderUploadProgress(true);
    pumpQueue();
  });

  let currentWs = null;
  let wsPingTimer = null;
  let wsReconnectTimer = null;
  let sessionExpired = false;

  async function refreshItemsHttp() {
    if (!SESSION_TOKEN) return;
    try {
      const resp = await fetch('/api/items', {
        headers: { 'X-Casa-Token': SESSION_TOKEN },
        cache: 'no-store'
      });
      if (resp.status === 401 || resp.status === 503) {
        sessionExpired = true;
        if (wsReconnectTimer) {
          clearTimeout(wsReconnectTimer);
          wsReconnectTimer = null;
        }
        wsBadge.textContent = 'Sesi berakhir · Scan QR';
        wsBadge.classList.remove('ok');
        if (reconnectBtn) reconnectBtn.hidden = false;
        showToast('Sesi Connect HP di laptop berakhir · silakan scan QR baru');
        return;
      }
      if (resp.ok) {
        const data = await resp.json();
        if (data && Array.isArray(data.items)) {
          renderItems(data.items);
        }
      }
    } catch (_err) {}
  }

  function connectWs(force) {
    if (!SESSION_TOKEN) {
      wsBadge.textContent = 'Token hilang';
      if (reconnectBtn) reconnectBtn.hidden = true;
      return;
    }
    if (force) {
      sessionExpired = false;
    }
    if (sessionExpired) return;
    if (wsReconnectTimer) {
      clearTimeout(wsReconnectTimer);
      wsReconnectTimer = null;
    }
    if (currentWs) {
      if (!force && (currentWs.readyState === WebSocket.OPEN || currentWs.readyState === WebSocket.CONNECTING)) {
        return;
      }
      try {
        currentWs.onopen = null;
        currentWs.onmessage = null;
        currentWs.onerror = null;
        currentWs.onclose = null;
        currentWs.close();
      } catch (_err) {}
      currentWs = null;
    }
    if (wsPingTimer) {
      clearInterval(wsPingTimer);
      wsPingTimer = null;
    }

    wsBadge.textContent = 'Menghubungkan...';
    wsBadge.classList.remove('ok');

    const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + window.location.host + '/ws?t=' + encodeURIComponent(SESSION_TOKEN));
    currentWs = ws;

    ws.onopen = () => {
      if (currentWs !== ws) return;
      sessionExpired = false;
      wsBadge.textContent = 'Terhubung';
      wsBadge.classList.add('ok');
      if (reconnectBtn) reconnectBtn.hidden = true;
      wsPingTimer = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
    };
    ws.onmessage = (ev) => {
      if (currentWs !== ws) return;
      try {
        const data = JSON.parse(ev.data);
        if (data && data.type === 'items') {
          renderItems(data.items);
        }
      } catch (_err) {}
    };
    ws.onclose = () => {
      if (currentWs !== ws) return;
      currentWs = null;
      if (wsPingTimer) {
        clearInterval(wsPingTimer);
        wsPingTimer = null;
      }
      wsBadge.textContent = sessionExpired ? 'Sesi berakhir · Scan QR' : 'Terputus';
      wsBadge.classList.remove('ok');
      if (reconnectBtn) reconnectBtn.hidden = false;
      void refreshItemsHttp();
      if (!sessionExpired) {
        wsReconnectTimer = setTimeout(() => {
          connectWs(false);
        }, 2500);
      }
    };
  }

  if (reconnectBtn) {
    reconnectBtn.addEventListener('click', () => {
      connectWs(true);
      void refreshItemsHttp();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      connectWs(false);
      void refreshItemsHttp();
    }
  });

  window.addEventListener('online', () => {
    connectWs(true);
    void refreshItemsHttp();
  });

  connectWs(false);
  void refreshItemsHttp();
})();
</script>
</body>
</html>
"##;

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Read};
    use std::net::Ipv6Addr;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[test]
    fn validates_constant_time_token_comparison() {
        assert!(ct_token_eq(b"0123456789abcdef0123456789abcdef", b"0123456789abcdef0123456789abcdef"));
        assert!(!ct_token_eq(b"0123456789abcdef0123456789abcdef", b"0123456789abcdef0123456789abcdee"));
        assert!(!ct_token_eq(b"short", b"longer"));
        assert!(!ct_token_eq(b"", b""));
    }

    #[test]
    fn enforces_rfc1918_lan_ip_and_origin_cswsh_guards() {
        assert!(is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 1, 24))));
        assert!(is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(192, 168, 137, 1))));
        assert!(is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(10, 0, 0, 5))));
        assert!(is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(172, 16, 4, 2))));
        assert!(is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(127, 0, 0, 1))));
        assert!(is_allowed_lan_ip(IpAddr::V6(
            Ipv4Addr::new(192, 168, 1, 20).to_ipv6_mapped()
        )));

        assert!(!is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(8, 8, 8, 8))));
        assert!(!is_allowed_lan_ip(IpAddr::V4(Ipv4Addr::new(172, 32, 0, 1))));
        assert!(!is_allowed_lan_ip(IpAddr::V6(Ipv6Addr::new(0x2001, 0xdb8, 0, 0, 0, 0, 0, 1))));

        let allowed = vec!["192.168.1.5".to_string(), "192.168.137.1".to_string()];
        assert!(is_allowed_origin(Some("http://192.168.1.5:51234"), &allowed, 51234));
        assert!(is_allowed_origin(Some("http://192.168.137.1:51234"), &allowed, 51234));
        assert!(is_allowed_origin(Some("http://127.0.0.1:51234"), &allowed, 51234));
        assert!(!is_allowed_origin(Some("http://evil.com:51234"), &allowed, 51234));
        assert!(!is_allowed_origin(Some("http://192.168.1.5:9999"), &allowed, 51234));
        assert!(!is_allowed_origin(Some("null"), &allowed, 51234));
    }

    #[test]
    fn generates_valid_qr_svg_path_without_unsafe_html() {
        let (size, path) = build_qr_svg_path("http://192.168.1.5:41234/?t=deadbeef");
        assert!(size >= 25);
        assert!(path.starts_with('M'));
        assert!(!path.contains('<'));
    }

    #[tokio::test]
    async fn streams_folder_zip_store_mode_with_crc32_and_data_descriptors() {
        let temp_root = std::env::temp_dir().join(format!(
            "casa_zip_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        let sub = temp_root.join("nested");
        std::fs::create_dir_all(&sub).unwrap();
        let f1_bytes = b"Hello CASA Connect HP STORE ZIP!";
        let f2_bytes = b"Nested payload 1234567890";
        std::fs::write(temp_root.join("note.txt"), f1_bytes).unwrap();
        std::fs::write(sub.join("sub.txt"), f2_bytes).unwrap();

        let plan = prepare_store_zip_plan(&temp_root).expect("prepare_store_zip_plan failed");
        let mut zip_bytes: Vec<u8> = Vec::new();
        write_streaming_store_zip(&temp_root, &mut zip_bytes, || {})
            .await
            .expect("write_streaming_store_zip failed");

        assert_eq!(plan.total_zip_bytes, zip_bytes.len() as u64);
        assert_eq!(guess_download_mime_type("album.zip"), "application/zip");
        let cd = build_content_disposition_attachment("Trip Folder.zip");
        assert!(cd.contains("attachment; filename=\"Trip Folder.zip\""));
        assert!(cd.contains("filename*=UTF-8''"));

        // Verify signatures: LFH (0x04034b50), DD (0x08074b50), CDFH (0x02014b50), EOCD (0x06054b50)
        assert_eq!(&zip_bytes[0..4], &0x0403_4b50u32.to_le_bytes());
        assert_eq!(&zip_bytes[6..8], &0x0808u16.to_le_bytes()); // Bit 3 DD + Bit 11 UTF-8
        assert_eq!(&zip_bytes[8..10], &0u16.to_le_bytes()); // Method 0 = STORE

        // Find Data Descriptor and EOCD
        assert!(zip_bytes.windows(4).any(|w| w == 0x0807_4b50u32.to_le_bytes()));
        assert!(zip_bytes.windows(4).any(|w| w == 0x0201_4b50u32.to_le_bytes()));
        let eocd_start = zip_bytes.len() - 22;
        assert_eq!(&zip_bytes[eocd_start..eocd_start + 4], &0x0605_4b50u32.to_le_bytes());
        let entry_count = u16::from_le_bytes([zip_bytes[eocd_start + 8], zip_bytes[eocd_start + 9]]);
        assert_eq!(entry_count, 2);

        // Exact raw file bytes appear uncompressed (STORE) with matching IEEE CRC-32
        assert!(zip_bytes.windows(f1_bytes.len()).any(|w| w == f1_bytes));
        assert!(zip_bytes.windows(f2_bytes.len()).any(|w| w == f2_bytes));
        let expected_crc1 = crc32_update(0, f1_bytes);
        assert!(zip_bytes.windows(4).any(|w| w == expected_crc1.to_le_bytes()));

        let _ = std::fs::remove_dir_all(&temp_root);
        let mut cursor = Cursor::new(&zip_bytes[0..4]);
        let mut sig = [0u8; 4];
        Read::read_exact(&mut cursor, &mut sig).unwrap();
        assert_eq!(sig, 0x0403_4b50u32.to_le_bytes());
    }

    #[test]
    fn validates_batch_subfolder_unique_paths_and_part_cleanup_guard() {
        let temp_base = std::env::temp_dir().join(format!(
            "casa_batch_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&temp_base).unwrap();

        assert_eq!(sanitize_batch_id(Some("b-1234-ab")), Some("b-1234-ab".to_string()));
        assert!(sanitize_batch_id(Some("../evil")).is_none());
        assert!(sanitize_batch_id(Some("ab")).is_none());

        let (batch_dir, batch_name) = create_unique_batch_subfolder(&temp_base).unwrap();
        assert!(batch_dir.starts_with(&temp_base));
        assert!(batch_name.starts_with("Batch-"));

        let p1 = reserve_unique_dest_path(&batch_dir, "photo.jpg").unwrap();
        std::fs::write(&p1, b"1").unwrap();
        let p2 = reserve_unique_dest_path(&batch_dir, "photo.jpg").unwrap();
        assert_ne!(p1, p2);
        assert!(p2.to_string_lossy().contains("photo (1).jpg"));

        let part_file = batch_dir.join(".partial.part");
        std::fs::write(&part_file, b"unfinished").unwrap();
        {
            let _guard = PartFileCleanupGuard::new(part_file.clone());
        }
        assert!(!part_file.exists());

        let _ = std::fs::remove_dir_all(&temp_base);
    }

    #[test]
    fn mobile_ui_uses_history_scrub_exec_command_and_zero_inner_html() {
        assert!(MOBILE_WEB_UI_HTML.contains("history.replaceState"));
        assert!(MOBILE_WEB_UI_HTML.contains("sessionStorage"));
        assert!(MOBILE_WEB_UI_HTML.contains("visibilitychange"));
        assert!(MOBILE_WEB_UI_HTML.contains("Hubungkan Ulang"));
        assert!(MOBILE_WEB_UI_HTML.contains("Jika Chrome menampilkan peringatan HTTP lokal, pilih Tetap simpan"));
        assert!(MOBILE_WEB_UI_HTML.contains("execCommand('copy')"));
        assert!(MOBILE_WEB_UI_HTML.contains("X-Casa-Batch-Id"));
        assert!(MOBILE_WEB_UI_HTML.contains("X-Casa-Batch-Total"));
        assert!(MOBILE_WEB_UI_HTML.contains("/api/upload-raw"));
        assert!(MOBILE_WEB_UI_HTML.contains("X-Casa-File-Name"));
        assert!(MOBILE_WEB_UI_HTML.contains("scaleX("));
        assert!(MOBILE_WEB_UI_HTML.contains("LARGE_FILE_EXCLUSIVE_BYTES"));
        assert!(MOBILE_WEB_UI_HTML.contains("uploadQueue"));
        assert!(MOBILE_WEB_UI_HTML.contains("inFlightBytes"));
        assert!(MOBILE_WEB_UI_HTML.contains("renderUploadProgress"));
        assert!(MOBILE_WEB_UI_HTML.contains("pumpQueue"));
        assert!(!MOBILE_WEB_UI_HTML.contains("innerHTML"));
    }

    #[test]
    fn crc32_slice4_matches_ieee_vector_and_bytewise_reference() {
        fn crc32_bytewise(crc: u32, data: &[u8]) -> u32 {
            let mut c = !crc;
            for &b in data {
                c = CRC32_TABLES[0][((c ^ (b as u32)) & 0xFF) as usize] ^ (c >> 8);
            }
            !c
        }

        assert_eq!(crc32_update(0, b"123456789"), 0xCBF4_3926);
        for len in [0usize, 1, 2, 3, 4, 5, 7, 15, 16, 17, 63, 257, 4099] {
            let data: Vec<u8> = (0..len).map(|i| ((i * 73 + 19) & 0xFF) as u8).collect();
            assert_eq!(
                crc32_update(0, &data),
                crc32_bytewise(0, &data),
                "slice-by-4 CRC32 mismatch at len={len}"
            );
            // Incremental multi-chunk equivalence
            if len > 5 {
                let split = len / 3;
                let partial = crc32_update(0, &data[..split]);
                assert_eq!(crc32_update(partial, &data[split..]), crc32_bytewise(0, &data));
            }
        }
    }

    #[tokio::test]
    async fn raw_upload_endpoint_streams_file_enforces_auth_and_decodes_filename() {
        assert_eq!(
            percent_decode_utf8("Video%20Liburan%20%231.mp4"),
            "Video Liburan #1.mp4"
        );

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let temp_dir = std::env::temp_dir().join(format!(
            "casa_raw_upload_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let (ws_broadcast, _) = broadcast::channel::<String>(8);
        let token = "fedcba9876543210fedcba9876543210".to_string();
        let runtime = Arc::new(ServerRuntime {
            session_id: 9998,
            token: token.clone(),
            port,
            stopped: AtomicBool::new(false),
            selected_ip: Mutex::new("127.0.0.1".to_string()),
            candidate_interfaces: Mutex::new(vec![NetworkInterfaceOption {
                ip: "127.0.0.1".to_string(),
                label: "Loopback".to_string(),
                is_hotspot: false,
            }]),
            network_category: Mutex::new("Private".to_string()),
            download_dir: temp_dir.clone(),
            auto_copy_clipboard: AtomicUsize::new(0),
            connected_clients: AtomicUsize::new(0),
            active_transfers: AtomicUsize::new(0),
            last_activity_epoch: AtomicU64::new(100),
            shared_items: RwLock::new(Vec::new()),
            shared_by_id: RwLock::new(HashMap::new()),
            batch_folders: tokio::sync::Mutex::new(HashMap::new()),
            ws_broadcast,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            serve_task: Mutex::new(None),
            watchdog_task: Mutex::new(None),
            app_handle: None,
        });

        let router = build_connect_hp_router(Arc::clone(&runtime));
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .tcp_nodelay(true)
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
        });

        // 1. Unauthenticated /api/upload-raw -> rejected 401 before body
        {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let req = format!(
                "POST /api/upload-raw HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/octet-stream\r\nContent-Length: 4\r\nConnection: close\r\n\r\ntest"
            );
            stream.write_all(req.as_bytes()).await.unwrap();
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf).await;
            let resp = String::from_utf8_lossy(&buf);
            assert!(resp.starts_with("HTTP/1.1 401"), "expected 401, got: {}", &resp[..resp.len().min(100)]);
        }

        // 2. Authenticated /api/upload-raw with >4GiB declared Content-Length -> rejected 413 upfront
        {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let too_big = MAX_UPLOAD_FILE_BYTES + 1;
            let req = format!(
                "POST /api/upload-raw HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nX-Casa-Token: {token}\r\nX-Casa-File-Name: huge.bin\r\nContent-Type: application/octet-stream\r\nContent-Length: {too_big}\r\nConnection: close\r\n\r\n"
            );
            stream.write_all(req.as_bytes()).await.unwrap();
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf).await;
            let resp = String::from_utf8_lossy(&buf);
            assert!(resp.starts_with("HTTP/1.1 413"), "expected 413, got: {}", &resp[..resp.len().min(100)]);
        }

        // 3. Authenticated /api/upload-raw streams >256KiB payload cleanly & URL-decodes filename
        let payload: Vec<u8> = (0..(320 * 1024)).map(|i| ((i * 31 + 7) & 0xFF) as u8).collect();
        {
            let mut stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let req_head = format!(
                "POST /api/upload-raw HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nX-Casa-Token: {token}\r\nX-Casa-File-Name: Clip%20Final%2001.mp4\r\nX-Casa-Batch-Id: b-raw-test1\r\nX-Casa-Batch-Total: 1\r\nContent-Type: application/octet-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                payload.len()
            );
            stream.write_all(req_head.as_bytes()).await.unwrap();
            stream.write_all(&payload).await.unwrap();
            let mut buf = Vec::new();
            let _ = stream.read_to_end(&mut buf).await;
            let resp = String::from_utf8_lossy(&buf);
            assert!(resp.starts_with("HTTP/1.1 200"), "expected 200, got: {}", &resp[..resp.len().min(180)]);
            assert!(resp.contains("Clip Final 01.mp4"));
        }

        let saved_file = temp_dir.join("Clip Final 01.mp4");
        assert!(saved_file.exists(), "Raw uploaded file must exist on disk");
        assert_eq!(std::fs::read(&saved_file).unwrap(), payload);
        let leftover_parts: Vec<_> = std::fs::read_dir(&temp_dir)
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().ends_with(".part"))
            .collect();
        assert!(leftover_parts.is_empty(), "No .part temp files should remain");

        if let Ok(mut tx) = runtime.shutdown_tx.lock() {
            if let Some(s) = tx.take() {
                let _ = s.send(());
            }
        }
        let _ = server_task.await;
        let _ = std::fs::remove_dir_all(&temp_dir);
    }

    #[test]
    fn public_ws_dto_never_exposes_local_disk_path_for_files() {
        let secret_path = r"C:\Users\Developer\Documents\secret.pdf";
        let sync_item = ConnectHpSyncItem {
            id: "id-1".to_string(),
            item_type: "file".to_string(),
            title: "secret.pdf".to_string(),
            extension: Some("pdf".to_string()),
            size_bytes: Some(2048),
            file_count: None,
            text_payload: Some(secret_path.to_string()), // Should be stripped for file!
            local_path: Some(secret_path.to_string()),
        };

        let is_text_or_link = sync_item.item_type == "text" || sync_item.item_type == "link";
        let public_dto = ConnectHpPublicItem {
            id: sync_item.id,
            item_type: sync_item.item_type,
            title: sync_item.title,
            extension: sync_item.extension,
            size_bytes: sync_item.size_bytes,
            file_count: sync_item.file_count,
            text_payload: if is_text_or_link {
                sync_item.text_payload
            } else {
                None
            },
        };

        let json = serde_json::to_string(&public_dto).unwrap();
        assert!(!json.contains("Developer"));
        assert!(!json.contains("localPath"));
        assert!(public_dto.text_payload.is_none());
    }

    #[test]
    fn enforces_host_header_anti_dns_rebinding() {
        let allowed = vec!["192.168.1.5".to_string(), "192.168.137.1".to_string()];
        assert!(is_allowed_host(Some("192.168.1.5:51234"), &allowed, 51234));
        assert!(is_allowed_host(Some("192.168.137.1:51234"), &allowed, 51234));
        assert!(is_allowed_host(Some("127.0.0.1:51234"), &allowed, 51234));
        assert!(is_allowed_host(Some("localhost:51234"), &allowed, 51234));

        assert!(!is_allowed_host(None, &allowed, 51234));
        assert!(!is_allowed_host(Some(""), &allowed, 51234));
        assert!(!is_allowed_host(Some("evil.com:51234"), &allowed, 51234));
        assert!(!is_allowed_host(Some("192.168.1.5:9999"), &allowed, 51234));
        assert!(!is_allowed_host(Some("192.168.1.5"), &allowed, 51234));
    }

    #[tokio::test]
    async fn middleware_blocks_bad_host_unauth_large_text_and_sets_security_headers() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let temp_dir = std::env::temp_dir().join(format!(
            "casa_mw_test_{}",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&temp_dir).unwrap();

        let (shutdown_tx, shutdown_rx) = oneshot::channel::<()>();
        let (ws_broadcast, _) = broadcast::channel::<String>(8);
        let token = "0123456789abcdef0123456789abcdef".to_string();
        let runtime = Arc::new(ServerRuntime {
            session_id: 9999,
            token: token.clone(),
            port,
            stopped: AtomicBool::new(false),
            selected_ip: Mutex::new("127.0.0.1".to_string()),
            candidate_interfaces: Mutex::new(vec![NetworkInterfaceOption {
                ip: "127.0.0.1".to_string(),
                label: "Loopback".to_string(),
                is_hotspot: false,
            }]),
            network_category: Mutex::new("Private".to_string()),
            download_dir: temp_dir.clone(),
            auto_copy_clipboard: AtomicUsize::new(0),
            connected_clients: AtomicUsize::new(0),
            active_transfers: AtomicUsize::new(0),
            last_activity_epoch: AtomicU64::new(100),
            shared_items: RwLock::new(Vec::new()),
            shared_by_id: RwLock::new(HashMap::new()),
            batch_folders: tokio::sync::Mutex::new(HashMap::new()),
            ws_broadcast,
            shutdown_tx: Mutex::new(Some(shutdown_tx)),
            serve_task: Mutex::new(None),
            watchdog_task: Mutex::new(None),
            app_handle: None,
        });

        let router = build_connect_hp_router(Arc::clone(&runtime));
        let server_task = tokio::spawn(async move {
            let _ = axum::serve(
                listener,
                router.into_make_service_with_connect_info::<SocketAddr>(),
            )
            .with_graceful_shutdown(async move {
                let _ = shutdown_rx.await;
            })
            .await;
        });

        let send_raw = |headers: String, body: Vec<u8>| async move {
            let stream = tokio::net::TcpStream::connect(("127.0.0.1", port)).await.unwrap();
            let (mut reader, mut writer) = stream.into_split();
            let read_task = tokio::spawn(async move {
                let mut buf = Vec::new();
                let mut tmp = [0u8; 4096];
                while let Ok(n) = reader.read(&mut tmp).await {
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                }
                buf
            });
            writer.write_all(headers.as_bytes()).await.unwrap();
            let write_task = tokio::spawn(async move {
                if !body.is_empty() {
                    tokio::time::sleep(std::time::Duration::from_millis(15)).await;
                    for chunk in body.chunks(16 * 1024) {
                        if writer.write_all(chunk).await.is_err() {
                            break;
                        }
                    }
                }
                std::future::pending::<()>().await;
            });
            let buf = tokio::time::timeout(std::time::Duration::from_secs(5), read_task)
                .await
                .expect("timed out waiting for HTTP response")
                .unwrap_or_default();
            write_task.abort();
            let _ = write_task.await;
            String::from_utf8_lossy(&buf).into_owned()
        };

        // 1. Bad Host (DNS rebinding) -> 403 Forbidden + security headers
        let res_host = send_raw(
            format!(
                "GET /api/items HTTP/1.1\r\nHost: attacker.evil:{port}\r\nX-Casa-Token: {token}\r\nConnection: close\r\n\r\n"
            ),
            Vec::new(),
        )
        .await;
        assert!(res_host.starts_with("HTTP/1.1 403"), "bad Host got: {}", &res_host[..res_host.len().min(80)]);
        assert!(res_host.to_ascii_lowercase().contains("x-frame-options: deny"));
        assert!(res_host.to_ascii_lowercase().contains("x-content-type-options: nosniff"));

        // 2. GET / without token -> 200 OK with security headers, WITHOUT touching last_activity_epoch
        let res_idx = send_raw(
            format!("GET / HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\n\r\n"),
            Vec::new(),
        )
        .await;
        assert!(res_idx.starts_with("HTTP/1.1 200"));
        assert_eq!(runtime.last_activity_epoch.load(Ordering::Relaxed), 100);
        assert!(res_idx.to_ascii_lowercase().contains("x-frame-options: deny"));

        // 3. Unauthenticated POST /api/text declaring >256 KiB payload -> rejected BEFORE body (401)
        let big_pad = "A".repeat(300 * 1024);
        let big_json = format!("{{\"text\":\"{}\"}}", big_pad);
        let res_unauth_big = send_raw(
            format!(
                "POST /api/text HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                big_json.len(),
            ),
            Vec::new(),
        )
        .await;
        assert!(
            res_unauth_big.starts_with("HTTP/1.1 401"),
            "expected 401 before reading body, got: {}",
            &res_unauth_big[..res_unauth_big.len().min(120)]
        );
        assert_eq!(runtime.last_activity_epoch.load(Ordering::Relaxed), 100);

        // 4. Authenticated POST /api/text with >256 KiB payload -> 413 Payload Too Large (DefaultBodyLimit::max)
        let res_auth_big = send_raw(
            format!(
                "POST /api/text HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nOrigin: http://127.0.0.1:{port}\r\nX-Casa-Token: {token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                big_json.len(),
            ),
            big_json.into_bytes(),
        )
        .await;
        assert!(
            res_auth_big.starts_with("HTTP/1.1 413"),
            "expected 413 on >256 KiB /api/text, got: {}",
            &res_auth_big[..res_auth_big.len().min(120)]
        );

        let _ = runtime.shutdown_tx.lock().unwrap().take().map(|tx| tx.send(()));
        let _ = server_task.await;
        let _ = std::fs::remove_dir_all(&temp_dir);
    }
}
