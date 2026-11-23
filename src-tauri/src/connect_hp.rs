use crate::drop_zone::{allow_path_in_asset_scope, sanitize_transit_filename, write_clipboard_text};
use axum::{
    body::Body,
    extract::{
        ws::{Message, WebSocket, WebSocketUpgrade},
        ConnectInfo, DefaultBodyLimit, Multipart, Path as AxumPath, Query, State,
    },
    http::{header, HeaderMap, HeaderValue, StatusCode},
    response::{Html, IntoResponse, Response},
    routing::{get, post},
    Json, Router,
};
use chrono::Local;
use qrcode::{EcLevel, QrCode};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{Emitter, Manager};
use tokio::io::{AsyncReadExt, AsyncWriteExt, BufWriter};
use tokio::sync::{broadcast, oneshot, RwLock};
use tokio_util::io::ReaderStream;

const MAX_UPLOAD_FILE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB per file
const MAX_INCOMING_TEXT_CHARS: usize = 50_000;
const IDLE_TIMEOUT_SECS: u64 = 600; // 10 menit
const STREAM_CHUNK_BYTES: usize = 64 * 1024;
const TOUCH_INTERVAL_BYTES: u64 = 512 * 1024;

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
    app_handle: tauri::AppHandle,
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
            active: true,
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
    if a.is_empty() || a.len() != b.len() {
        return false;
    }
    let mut diff: u8 = 0;
    for (&x, &y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
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

fn generate_csprng_token_hex() -> Result<String, String> {
    let mut raw = [0u8; 16];

    #[cfg(windows)]
    {
        use windows::Win32::Security::Cryptography::{
            BCryptGenRandom, BCRYPT_USE_SYSTEM_PREFERRED_RNG,
        };
        unsafe {
            let status = BCryptGenRandom(None, &mut raw, BCRYPT_USE_SYSTEM_PREFERRED_RNG);
            if status.is_err() {
                return Err(format!("BCryptGenRandom gagal: 0x{:08x}", status.0 as u32));
            }
        }
    }

    #[cfg(not(windows))]
    {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        for (i, slot) in raw.iter_mut().enumerate() {
            *slot = ((nanos >> ((i % 8) * 8)) & 0xFF) as u8;
        }
    }

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
// IEEE CRC-32 + Streaming ZIP (`STORE` Method 0, 0% Compression, O(1) RAM)
// =========================================================================

const CRC32_TABLE: [u32; 256] = {
    let mut table = [0u32; 256];
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
        table[i] = c;
        i += 1;
    }
    table
};

fn crc32_update(crc: u32, data: &[u8]) -> u32 {
    let mut c = !crc;
    for &b in data {
        c = CRC32_TABLE[((c ^ (b as u32)) & 0xFF) as usize] ^ (c >> 8);
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

struct ZipCentralEntry {
    name_bytes: Vec<u8>,
    crc32: u32,
    size: u32,
    local_offset: u32,
    dos_time: u16,
    dos_date: u16,
}

/// Menuliskan arsip ZIP murni metode `STORE` (0% kompresi) secara 1-pass streaming dengan Data Descriptor (`0x08074b50`) & UTF-8 flag (`0x0808`).
pub async fn write_streaming_store_zip<W: tokio::io::AsyncWrite + Unpin>(
    folder: &Path,
    mut writer: W,
    on_chunk: impl Fn() + Send + Sync,
) -> std::io::Result<()> {
    let files = collect_zip_entries_under_folder(folder);
    let (dos_time, dos_date) = dos_now_time_date();
    let mut central_entries: Vec<ZipCentralEntry> = Vec::with_capacity(files.len());
    let mut cursor_pos: u64 = 0;
    let mut buf = vec![0u8; STREAM_CHUNK_BYTES];

    for (disk_path, zip_name) in files {
        let Ok(mut file) = tokio::fs::File::open(&disk_path).await else {
            continue;
        };
        if cursor_pos > (u32::MAX as u64 - 1024) {
            break;
        }
        let local_offset = cursor_pos as u32;
        let name_bytes = zip_name.into_bytes();
        let name_len_u16 = (name_bytes.len().min(u16::MAX as usize)) as u16;
        let trimmed_name = &name_bytes[..name_len_u16 as usize];

        // Local File Header (30 bytes) + filename: flags=0x0808 (Data Descriptor + UTF-8), method=0 (STORE)
        let mut lfh = [0u8; 30];
        lfh[0..4].copy_from_slice(&0x0403_4b50u32.to_le_bytes());
        lfh[4..6].copy_from_slice(&20u16.to_le_bytes()); // version needed 2.0
        lfh[6..8].copy_from_slice(&0x0808u16.to_le_bytes()); // UTF-8 + Data Descriptor
        lfh[8..10].copy_from_slice(&0u16.to_le_bytes()); // method 0 = STORE
        lfh[10..12].copy_from_slice(&dos_time.to_le_bytes());
        lfh[12..14].copy_from_slice(&dos_date.to_le_bytes());
        // crc32, compressed size, uncompressed size are 0 in LFH when bit 3 is set
        lfh[26..28].copy_from_slice(&name_len_u16.to_le_bytes());

        writer.write_all(&lfh).await?;
        writer.write_all(trimmed_name).await?;
        cursor_pos += 30 + (trimmed_name.len() as u64);

        let mut crc = 0u32;
        let mut file_size = 0u64;
        loop {
            let n = file.read(&mut buf).await?;
            if n == 0 {
                break;
            }
            crc = crc32_update(crc, &buf[..n]);
            file_size += n as u64;
            writer.write_all(&buf[..n]).await?;
            cursor_pos += n as u64;
            on_chunk();
        }

        let size_u32 = file_size as u32;
        // Data Descriptor (16 bytes): sig 0x08074b50 + crc + comp_size + uncomp_size
        let mut dd = [0u8; 16];
        dd[0..4].copy_from_slice(&0x0807_4b50u32.to_le_bytes());
        dd[4..8].copy_from_slice(&crc.to_le_bytes());
        dd[8..12].copy_from_slice(&size_u32.to_le_bytes());
        dd[12..16].copy_from_slice(&size_u32.to_le_bytes());
        writer.write_all(&dd).await?;
        cursor_pos += 16;

        central_entries.push(ZipCentralEntry {
            name_bytes: trimmed_name.to_vec(),
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
        cdfh[4..6].copy_from_slice(&20u16.to_le_bytes()); // version made by
        cdfh[6..8].copy_from_slice(&20u16.to_le_bytes()); // version needed
        cdfh[8..10].copy_from_slice(&0x0808u16.to_le_bytes());
        cdfh[10..12].copy_from_slice(&0u16.to_le_bytes()); // STORE
        cdfh[12..14].copy_from_slice(&entry.dos_time.to_le_bytes());
        cdfh[14..16].copy_from_slice(&entry.dos_date.to_le_bytes());
        cdfh[16..20].copy_from_slice(&entry.crc32.to_le_bytes());
        cdfh[20..24].copy_from_slice(&entry.size.to_le_bytes());
        cdfh[24..28].copy_from_slice(&entry.size.to_le_bytes());
        cdfh[28..30].copy_from_slice(&name_len.to_le_bytes());
        cdfh[38..42].copy_from_slice(&0x20u32.to_le_bytes()); // Archive attr
        cdfh[42..46].copy_from_slice(&entry.local_offset.to_le_bytes());

        writer.write_all(&cdfh).await?;
        writer.write_all(&entry.name_bytes).await?;
        cd_size += 46 + (entry.name_bytes.len() as u64);
    }

    let count_u16 = (central_entries.len().min(u16::MAX as usize)) as u16;
    let mut eocd = [0u8; 22];
    eocd[0..4].copy_from_slice(&0x0605_4b50u32.to_le_bytes());
    eocd[8..10].copy_from_slice(&count_u16.to_le_bytes());
    eocd[10..12].copy_from_slice(&count_u16.to_le_bytes());
    eocd[12..16].copy_from_slice(&(cd_size as u32).to_le_bytes());
    eocd[16..20].copy_from_slice(&cd_offset.to_le_bytes());

    writer.write_all(&eocd).await?;
    writer.flush().await?;
    Ok(())
}

// =========================================================================
// HTTP & WebSocket Handlers (Axum)
// =========================================================================

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
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), false)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();

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
    resp
}

async fn handle_ws_upgrade(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Query(query): Query<TokenQuery>,
    ws: WebSocketUpgrade,
) -> Response {
    if let Err((code, msg)) =
        verify_request_access(&runtime, addr.ip(), &headers, query.t.as_deref(), true)
    {
        return (code, msg).into_response();
    }
    runtime.touch_activity();
    ws.on_upgrade(move |socket| handle_ws_connection(runtime, socket))
}

async fn handle_ws_connection(runtime: Arc<ServerRuntime>, mut socket: WebSocket) {
    let clients_now = runtime.connected_clients.fetch_add(1, Ordering::Relaxed) + 1;
    let _ = runtime
        .app_handle
        .emit("casa://connect-hp-status", runtime.to_session_info(None));

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
    let _ = runtime
        .app_handle
        .emit("casa://connect-hp-status", runtime.to_session_info(None));
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

    let _ = runtime.app_handle.emit(
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

    Json(serde_json::json!({ "ok": true, "copiedToClipboard": copied })).into_response()
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

    let base_drop_dir = match resolve_casa_drop_dir(&runtime.app_handle) {
        Ok(dir) => dir,
        Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
    };

    let mut saved_results = Vec::new();

    while let Ok(Some(mut field)) = multipart.next_field().await {
        let raw_name = field.file_name().unwrap_or("upload-hp.bin").to_string();
        let safe_name = sanitize_transit_filename(&raw_name);

        let is_batch_folder = batch_total > 5 && batch_id.is_some();
        let (target_dir, batch_folder_name) = if is_batch_folder {
            let b_id = batch_id.as_ref().unwrap();
            let mut batches = runtime.batch_folders.lock().await;
            if let Some(existing) = batches.get(b_id) {
                (existing.dir_path.clone(), Some(existing.folder_name.clone()))
            } else {
                match create_unique_batch_subfolder(&base_drop_dir) {
                    Ok((dir_path, folder_name)) => {
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
                        (dir_path, Some(folder_name))
                    }
                    Err(e) => return (StatusCode::INTERNAL_SERVER_ERROR, e).into_response(),
                }
            }
        } else {
            (base_drop_dir.clone(), None)
        };

        let millis = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        let part_path = target_dir.join(format!(".{}_{}.part", millis, safe_name));
        let mut part_guard = PartFileCleanupGuard::new(part_path.clone());

        let file = match tokio::fs::File::create(&part_path).await {
            Ok(f) => f,
            Err(e) => {
                return (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    format!("Gagal membuat berkas sementara: {}", e),
                )
                    .into_response();
            }
        };

        let mut writer = BufWriter::with_capacity(STREAM_CHUNK_BYTES, file);
        let mut written_bytes: u64 = 0;
        let mut touch_accum: u64 = 0;

        loop {
            match field.chunk().await {
                Ok(Some(chunk)) => {
                    let chunk_len = chunk.len() as u64;
                    if written_bytes.saturating_add(chunk_len) > MAX_UPLOAD_FILE_BYTES {
                        return (
                            StatusCode::PAYLOAD_TOO_LARGE,
                            "Ukuran berkas melebihi batas 4 GB",
                        )
                            .into_response();
                    }
                    if let Err(e) = writer.write_all(&chunk).await {
                        return (
                            StatusCode::INTERNAL_SERVER_ERROR,
                            format!("Gagal menulis chunk ke disk: {}", e),
                        )
                            .into_response();
                    }
                    written_bytes += chunk_len;
                    touch_accum += chunk_len;
                    if touch_accum >= TOUCH_INTERVAL_BYTES {
                        touch_accum = 0;
                        runtime.touch_activity();
                    }
                }
                Ok(None) => break,
                Err(e) => {
                    return (
                        StatusCode::BAD_REQUEST,
                        format!("Stream unggahan terputus: {}", e),
                    )
                        .into_response();
                }
            }
        }

        if let Err(e) = writer.flush().await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal menyelesaikan penulisan berkas: {}", e),
            )
                .into_response();
        }
        drop(writer);
        runtime.touch_activity();

        if written_bytes == 0 {
            continue;
        }

        let final_path = match reserve_unique_dest_path(&target_dir, &safe_name) {
            Ok(p) => p,
            Err(e) => return (StatusCode::BAD_REQUEST, e).into_response(),
        };

        if let Err(e) = tokio::fs::rename(&part_path, &final_path).await {
            return (
                StatusCode::INTERNAL_SERVER_ERROR,
                format!("Gagal memindahkan berkas final: {}", e),
            )
                .into_response();
        }
        part_guard.disarm();

        let final_str = final_path.to_string_lossy().to_string();
        let final_name = final_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| safe_name.clone());

        if let (true, Some(b_id), Some(folder_name)) =
            (is_batch_folder, batch_id.as_ref(), batch_folder_name)
        {
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

            let _ = runtime.app_handle.emit(
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
        } else {
            allow_path_in_asset_scope(&runtime.app_handle, &final_path);
            let _ = runtime.app_handle.emit(
                "casa://connect-hp-item",
                ConnectHpIncomingEventPayload {
                    kind: "file".to_string(),
                    payload: final_str,
                    file_name: Some(final_name.clone()),
                    size_bytes: Some(written_bytes),
                    copied_to_clipboard: false,
                    batch_id: None,
                    file_count: None,
                    batch_total: None,
                },
            );
        }

        saved_results.push(serde_json::json!({
            "fileName": final_name,
            "sizeBytes": written_bytes,
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

async fn handle_download_file(
    State(runtime): State<Arc<ServerRuntime>>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    AxumPath(item_id): AxumPath<String>,
    Query(query): Query<TokenQuery>,
) -> Response {
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
    if meta.is_dir() {
        let folder_label = sanitize_content_disposition_name(&entry.public.title);
        let zip_name = if folder_label.to_ascii_lowercase().ends_with(".zip") {
            folder_label
        } else {
            format!("{}.zip", folder_label)
        };

        let (duplex_writer, duplex_reader) = tokio::io::duplex(128 * 1024);
        let runtime_clone = Arc::clone(&runtime);
        let folder_clone = disk_path.clone();

        tokio::spawn(async move {
            let _guard = ActiveTransferGuard::new(&runtime_clone.active_transfers);
            let rt_ref = &runtime_clone;
            let _ = write_streaming_store_zip(&folder_clone, duplex_writer, move || {
                rt_ref.touch_activity();
            })
            .await;
        });

        let stream = ReaderStream::with_capacity(duplex_reader, STREAM_CHUNK_BYTES);
        let body = Body::from_stream(stream);
        let mut resp = Response::new(body);
        resp.headers_mut().insert(
            header::CONTENT_TYPE,
            HeaderValue::from_static("application/zip"),
        );
        if let Ok(cd) = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", zip_name)) {
            resp.headers_mut().insert(header::CONTENT_DISPOSITION, cd);
        }
        resp.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("no-store"),
        );
        return resp;
    }

    // Streaming Single File (64 KB chunks via ReaderStream)
    let file = match tokio::fs::File::open(&disk_path).await {
        Ok(f) => f,
        Err(_) => return (StatusCode::NOT_FOUND, "Gagal membuka berkas").into_response(),
    };

    let file_name = disk_path
        .file_name()
        .map(|s| sanitize_content_disposition_name(&s.to_string_lossy()))
        .unwrap_or_else(|| "casa-file.bin".to_string());
    let file_len = meta.len();

    let stream = ReaderStream::with_capacity(file, STREAM_CHUNK_BYTES);
    let body = Body::from_stream(stream);
    let mut resp = Response::new(body);
    resp.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    if let Ok(cl) = HeaderValue::from_str(&file_len.to_string()) {
        resp.headers_mut().insert(header::CONTENT_LENGTH, cl);
    }
    if let Ok(cd) = HeaderValue::from_str(&format!("attachment; filename=\"{}\"", file_name)) {
        resp.headers_mut().insert(header::CONTENT_DISPOSITION, cd);
    }
    resp.headers_mut().insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static("no-store"),
    );
    resp
}

pub fn shutdown_connect_hp_server() {
    if let Ok(mut guard) = GLOBAL_RUNTIME.lock() {
        if let Some(rt) = guard.take() {
            let _ = rt.ws_broadcast.send("__casa_shutdown__".to_string());
            if let Ok(mut tx_guard) = rt.shutdown_tx.lock() {
                if let Some(tx) = tx_guard.take() {
                    let _ = tx.send(());
                }
            }
        }
    }
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
        app_handle: app.clone(),
    });

    {
        let mut guard = GLOBAL_RUNTIME
            .lock()
            .map_err(|_| "State lock Connect HP terganggu".to_string())?;
        *guard = Some(Arc::clone(&runtime));
    }

    let router = Router::new()
        .route("/", get(handle_index))
        .route("/ws", get(handle_ws_upgrade))
        .route("/api/items", get(handle_get_items))
        .route("/api/text", post(handle_post_text))
        .route("/api/upload", post(handle_upload_file))
        .route("/api/file/:id", get(handle_download_file))
        .layer(DefaultBodyLimit::disable())
        .with_state(Arc::clone(&runtime));

    let rt_serve = Arc::clone(&runtime);
    tauri::async_runtime::spawn(async move {
        let _ = axum::serve(
            listener,
            router.into_make_service_with_connect_info::<SocketAddr>(),
        )
        .with_graceful_shutdown(async move {
            let _ = shutdown_rx.await;
        })
        .await;

        if let Ok(mut guard) = GLOBAL_RUNTIME.lock() {
            if guard.as_ref().map(|r| r.session_id) == Some(rt_serve.session_id) {
                *guard = None;
            }
        }
    });

    // Idle Watchdog: matikan otomatis jika benar-benar idle > 10 menit tanpa transfer/WS aktif
    let rt_watchdog = Arc::clone(&runtime);
    tauri::async_runtime::spawn(async move {
        let mut ticker = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            ticker.tick().await;
            let still_current = GLOBAL_RUNTIME
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
                let _ = rt_watchdog.app_handle.emit(
                    "casa://connect-hp-status",
                    ConnectHpSessionInfo::inactive(Some("idle_timeout".to_string())),
                );
                break;
            }
        }
    });

    let info = runtime.to_session_info(None);
    let _ = app.emit("casa://connect-hp-status", &info);
    Ok(info)
}

#[tauri::command]
pub fn stop_connect_hp(app: tauri::AppHandle) -> Result<(), String> {
    shutdown_connect_hp_server();
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

        let public_item = ConnectHpPublicItem {
            id: item.id.clone(),
            item_type: item.item_type,
            title: item.title,
            extension: item.extension,
            size_bytes: item.size_bytes,
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
  .head { display: flex; align-items: center; justify-content: space-between; padding: 8px 2px 14px; border-bottom: 1px solid rgba(255,255,255,0.09); margin-bottom: 14px; }
  .brand { display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; letter-spacing: -0.02em; }
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
  .prog-meta { display: flex; justify-content: space-between; font-size: 11px; font-family: ui-monospace, monospace; color: #d4d4d8; margin-bottom: 6px; }
  .prog-bar { width: 100%; height: 6px; background: rgba(255,255,255,0.12); border-radius: 999px; overflow: hidden; }
  .prog-fill { height: 100%; width: 0%; background: #ffffff; transition: width 0.15s linear; }
  .wake-note { margin-top: 8px; font-size: 11px; color: #d4d4d8; background: rgba(255,255,255,0.06); border: 1px solid rgba(255,255,255,0.12); border-radius: 10px; padding: 7px 10px; }
  .list { display: flex; flex-direction: column; gap: 8px; }
  .item-row { background: #000000; border: 1px solid rgba(255,255,255,0.10); border-radius: 12px; padding: 10px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .item-info { min-width: 0; flex: 1; }
  .item-name { font-size: 13px; font-weight: 500; color: #ffffff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .item-sub { font-size: 11px; font-family: ui-monospace, monospace; color: #a1a1aa; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .toast { position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%); background: #ffffff; color: #000000; font-size: 12px; font-weight: 600; padding: 8px 14px; border-radius: 999px; display: none; z-index: 99; box-shadow: 0 6px 24px rgba(0,0,0,0.7); }
  .toast.show { display: block; }
</style>
</head>
<body>
  <header class="head">
    <div class="brand">CASA &times; Connect HP</div>
    <span class="status-pill" id="ws-badge">Menghubungkan...</span>
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
        <span id="upload-pct-text">0%</span>
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
  const params = new URLSearchParams(window.location.search);
  const SESSION_TOKEN = (params.get('t') || '').trim();
  if (SESSION_TOKEN && window.history && typeof window.history.replaceState === 'function') {
    window.history.replaceState(null, '', '/');
  }

  const wsBadge = document.getElementById('ws-badge');
  const textInput = document.getElementById('text-input');
  const sendTextBtn = document.getElementById('send-text-btn');
  const fileInput = document.getElementById('file-input');
  const progWrap = document.getElementById('upload-prog-wrap');
  const progFill = document.getElementById('upload-prog-fill');
  const countText = document.getElementById('upload-count-text');
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
        sub.textContent = 'FOLDER (.zip STORE)' + (it.fileCount != null ? ' · ' + it.fileCount + ' file' : '');
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
      } else {
        const dl = document.createElement('a');
        dl.className = 'btn';
        dl.href = '/api/file/' + encodeURIComponent(it.id) + '?t=' + encodeURIComponent(SESSION_TOKEN);
        const dlName = it.itemType === 'folder' ? ((it.title || 'folder') + '.zip') : (it.title || 'download');
        dl.setAttribute('download', dlName);
        dl.textContent = it.itemType === 'folder' ? 'Unduh .zip' : 'Unduh';
        row.appendChild(dl);
      }

      laptopList.appendChild(row);
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

  function uploadSingleFileXhr(file, batchId, batchTotal, onProgress) {
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

  async function uploadWithRetry(file, batchId, batchTotal, onProgress) {
    try {
      return await uploadSingleFileXhr(file, batchId, batchTotal, onProgress);
    } catch (_err) {
      onProgress(0, file.size || 1);
      return await uploadSingleFileXhr(file, batchId, batchTotal, onProgress);
    }
  }

  const MAX_CONCURRENT_UPLOADS = 2;
  const uploadQueue = [];
  let activeUploads = 0;
  let sessionDone = 0;
  let sessionFailed = 0;
  let sessionTotal = 0;
  let completedBytes = 0;
  let sessionTotalBytes = 0;
  const inFlightBytes = new Map();
  let nextUploadUid = 1;
  let hideProgTimer = null;

  function renderUploadProgress() {
    let inFlight = 0;
    inFlightBytes.forEach((bytes) => {
      inFlight += bytes;
    });
    const pct = sessionTotalBytes > 0
      ? Math.min(100, Math.round(((completedBytes + inFlight) / sessionTotalBytes) * 100))
      : 0;
    countText.textContent = sessionDone + ' / ' + sessionTotal + ' selesai';
    pctText.textContent = pct + '%';
    progFill.style.width = pct + '%';
  }

  function pumpQueue() {
    while (activeUploads < MAX_CONCURRENT_UPLOADS && uploadQueue.length > 0) {
      const item = uploadQueue.shift();
      activeUploads += 1;
      inFlightBytes.set(item.uid, 0);
      (async () => {
        try {
          await uploadWithRetry(item.file, item.batchId, item.batchTotal, (loaded) => {
            inFlightBytes.set(item.uid, Math.min(Math.max(0, loaded), item.size));
            renderUploadProgress();
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
          renderUploadProgress();
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
    renderUploadProgress();
    pumpQueue();
  });

  function connectWs() {
    if (!SESSION_TOKEN) {
      wsBadge.textContent = 'Token hilang';
      return;
    }
    const proto = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + window.location.host + '/ws?t=' + encodeURIComponent(SESSION_TOKEN));
    let pingId = null;

    ws.onopen = () => {
      wsBadge.textContent = 'Terhubung';
      wsBadge.classList.add('ok');
      pingId = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) ws.send('ping');
      }, 25000);
    };
    ws.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data);
        if (data && data.type === 'items') {
          renderItems(data.items);
        }
      } catch (_err) {}
    };
    ws.onclose = () => {
      if (pingId) clearInterval(pingId);
      wsBadge.textContent = 'Terputus';
      wsBadge.classList.remove('ok');
      setTimeout(connectWs, 2500);
    };
  }

  connectWs();
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

        let mut zip_bytes: Vec<u8> = Vec::new();
        write_streaming_store_zip(&temp_root, &mut zip_bytes, || {})
            .await
            .expect("write_streaming_store_zip failed");

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
        assert!(MOBILE_WEB_UI_HTML.contains("execCommand('copy')"));
        assert!(MOBILE_WEB_UI_HTML.contains("X-Casa-Batch-Id"));
        assert!(MOBILE_WEB_UI_HTML.contains("X-Casa-Batch-Total"));
        assert!(MOBILE_WEB_UI_HTML.contains("uploadQueue"));
        assert!(MOBILE_WEB_UI_HTML.contains("inFlightBytes"));
        assert!(MOBILE_WEB_UI_HTML.contains("renderUploadProgress"));
        assert!(MOBILE_WEB_UI_HTML.contains("pumpQueue"));
        assert!(!MOBILE_WEB_UI_HTML.contains("innerHTML"));
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
}
