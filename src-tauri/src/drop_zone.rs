use base64::Engine;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use tauri::Manager;

static STAGED_FILE_COUNTER: AtomicU64 = AtomicU64::new(1);

fn ephemeral_transit_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Gagal menemukan local data directory: {}", e))?
        .join("drop_zone_transit"))
}

pub fn is_windows_reserved_device_name(name: &str) -> bool {
    let trimmed = name.trim();
    if trimmed.is_empty() {
        return false;
    }
    let stem = trimmed
        .split('.')
        .next()
        .unwrap_or(trimmed)
        .trim_end_matches(|c: char| c == ' ' || c == '.');
    let upper = stem.to_ascii_uppercase();
    matches!(
        upper.as_str(),
        "CON"
            | "PRN"
            | "AUX"
            | "NUL"
            | "COM0"
            | "COM1"
            | "COM2"
            | "COM3"
            | "COM4"
            | "COM5"
            | "COM6"
            | "COM7"
            | "COM8"
            | "COM9"
            | "LPT0"
            | "LPT1"
            | "LPT2"
            | "LPT3"
            | "LPT4"
            | "LPT5"
            | "LPT6"
            | "LPT7"
            | "LPT8"
            | "LPT9"
            | "COM\u{00B9}"
            | "COM\u{00B2}"
            | "COM\u{00B3}"
            | "LPT\u{00B9}"
            | "LPT\u{00B2}"
            | "LPT\u{00B3}"
    )
}

pub fn sanitize_transit_filename(raw: &str) -> String {
    let segment = raw
        .split(['/', '\\'])
        .rfind(|s| !s.trim().is_empty())
        .unwrap_or("")
        .trim();

    if segment.is_empty() || segment == "." || segment == ".." {
        return "dropped-file.bin".to_string();
    }
    let reserved_raw = is_windows_reserved_device_name(segment);

    let mut clean: String = segment
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect();

    while clean.contains("..") {
        clean = clean.replace("..", ".");
    }

    let trimmed = clean.trim_matches(|ch: char| ch == '.' || ch.is_whitespace());
    if trimmed.is_empty() {
        return "dropped-file.bin".to_string();
    }

    let mut result = trimmed.to_string();
    if reserved_raw || is_windows_reserved_device_name(&result) {
        result = format!("_{}", result);
    }
    if result.len() > 96 {
        if let Some(dot_idx) = result.rfind('.') {
            let ext = &result[dot_idx..];
            if !ext.is_empty() && ext.len() <= 16 {
                let stem_limit = 96 - ext.len();
                result = format!("{}{}", &result[..stem_limit], ext);
            } else {
                result.truncate(96);
            }
        } else {
            result.truncate(96);
        }
    }

    result
}

pub fn sanitize_directory_name(raw: &str) -> String {
    let segment = raw
        .split(['/', '\\'])
        .rfind(|s| !s.trim().is_empty())
        .unwrap_or("")
        .trim();

    if segment.is_empty() || segment == "." || segment == ".." {
        return "Dropped Folder".to_string();
    }
    let reserved_raw = is_windows_reserved_device_name(segment);

    let mut clean: String = segment
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '-' | '_' | ' ') {
                ch
            } else {
                '_'
            }
        })
        .collect();

    while clean.contains("..") {
        clean = clean.replace("..", ".");
    }

    let trimmed = clean.trim_matches(|ch: char| ch == '.' || ch.is_whitespace());
    if trimmed.is_empty() {
        return "Dropped Folder".to_string();
    }

    let mut result = trimmed.to_string();
    if reserved_raw || is_windows_reserved_device_name(&result) {
        result = format!("_{}", result);
    }
    if result.len() > 80 {
        result.truncate(80);
    }
    result
}

fn reserve_unique_directory_path(base_dir: &Path, raw_name: &str) -> Result<PathBuf, String> {
    std::fs::create_dir_all(base_dir)
        .map_err(|e| format!("Gagal membuat folder dasar CASA Drop: {}", e))?;

    let safe_base = sanitize_directory_name(raw_name);
    for idx in 0..1000u32 {
        let dir_name = if idx == 0 {
            safe_base.clone()
        } else {
            format!("{} ({})", safe_base, idx)
        };
        let candidate = base_dir.join(dir_name);
        match std::fs::create_dir(&candidate) {
            Ok(()) => return Ok(candidate),
            Err(err) if err.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(err) => {
                return Err(format!("Gagal membuat folder transit '{}': {}", candidate.display(), err));
            }
        }
    }

    Err("Terlalu banyak folder dengan nama identik di CASA Drop".to_string())
}

fn sanitize_relative_subpath(relative_path: &str) -> Result<PathBuf, String> {
    let raw_segments: Vec<&str> = relative_path
        .split(['/', '\\'])
        .filter(|s| !s.trim().is_empty() && s.trim() != ".")
        .collect();

    if raw_segments.is_empty() {
        return Err("Jalur relatif berkas di dalam folder kosong".to_string());
    }

    let mut clean_rel = PathBuf::new();
    let last_idx = raw_segments.len() - 1;
    for (idx, seg) in raw_segments.iter().enumerate() {
        let trimmed = seg.trim();
        if trimmed == ".." || trimmed.contains("..") || trimmed.contains(':') {
            return Err("Path traversal pada jalur relatif folder ditolak".to_string());
        }
        let clean_seg = if idx == last_idx {
            sanitize_transit_filename(trimmed)
        } else {
            sanitize_directory_name(trimmed)
        };
        clean_rel.push(clean_seg);
    }

    if clean_rel.as_os_str().is_empty() {
        return Err("Jalur relatif berkas tidak valid".to_string());
    }

    Ok(clean_rel)
}

fn resolve_safe_file_inside_root(
    base_downloads_drop: &Path,
    root_dir: &Path,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let canon_base = std::fs::canonicalize(base_downloads_drop)
        .map_err(|e| format!("Gagal memverifikasi folder dasar CASA Drop: {}", e))?;
    let canon_root = std::fs::canonicalize(root_dir)
        .map_err(|e| format!("Folder tujuan transit tidak ditemukan: {}", e))?;

    if !canon_root.starts_with(&canon_base) || canon_root == canon_base || !canon_root.is_dir() {
        return Err("Folder tujuan harus berada di dalam Downloads\\CASA Drop".to_string());
    }

    let rel_subpath = sanitize_relative_subpath(relative_path)?;
    let target_path = canon_root.join(rel_subpath);
    if !target_path.starts_with(&canon_root) {
        return Err("Path tujuan keluar dari root folder transit".to_string());
    }

    Ok(target_path)
}

pub fn cleanup_ephemeral_transit_dir(app: &tauri::AppHandle) {
    if let Ok(transit_dir) = ephemeral_transit_dir(app) {
        let _ = std::fs::remove_dir_all(transit_dir);
    }
    if let Ok(cache_dir) = app.path().app_cache_dir() {
        let _ = std::fs::remove_dir_all(cache_dir.join("drop_zone_clipboard"));
        let _ = std::fs::remove_dir_all(cache_dir.join("drop_zone_cache"));
    }
}

#[tauri::command]
pub fn cleanup_ephemeral_drop_zone(app: tauri::AppHandle) -> Result<(), String> {
    cleanup_ephemeral_transit_dir(&app);
    Ok(())
}

/// Menampung berkas dari HTML5 DOM drop (`dragDropEnabled: false`) ke direktori transit ephemeral sementara
/// ketika objek DOM `File` dari WebView2 tidak membawa path fisik OS secara langsung.
#[tauri::command]
pub fn stage_dropped_file(
    app: tauri::AppHandle,
    file_name: String,
    data_base64: String,
) -> Result<String, String> {
    const MAX_STAGED_BYTES: usize = 25 * 1024 * 1024;
    const MAX_BASE64_LEN: usize = 35 * 1024 * 1024;

    let trimmed = data_base64.trim();
    if trimmed.is_empty() {
        return Err("Data berkas drop kosong".to_string());
    }
    if trimmed.len() > MAX_BASE64_LEN {
        return Err("Ukuran berkas melebihi batas transit sementara 25 MB".to_string());
    }

    let decoded = base64::engine::general_purpose::STANDARD
        .decode(trimmed)
        .map_err(|e| format!("Gagal mendekode data berkas: {}", e))?;
    if decoded.is_empty() {
        return Err("Data berkas drop kosong".to_string());
    }
    if decoded.len() > MAX_STAGED_BYTES {
        return Err("Ukuran berkas melebihi batas transit sementara 25 MB".to_string());
    }

    let safe_name = sanitize_transit_filename(&file_name);
    let transit_dir = ephemeral_transit_dir(&app)?;
    std::fs::create_dir_all(&transit_dir)
        .map_err(|e| format!("Gagal membuat folder transit ephemeral: {}", e))?;

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let seq = STAGED_FILE_COUNTER.fetch_add(1, Ordering::Relaxed);
    let dest_path = transit_dir.join(format!("{}_{}_{}", millis, seq, safe_name));

    std::fs::write(&dest_path, &decoded)
        .map_err(|e| format!("Gagal menyimpan berkas transit sementara: {}", e))?;

    allow_path_in_asset_scope(&app, &dest_path);
    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn create_drop_transit_directory(
    app: tauri::AppHandle,
    folder_name: String,
) -> Result<String, String> {
    let base_dir = crate::connect_hp::resolve_casa_drop_dir(&app)?;
    let dest_dir = reserve_unique_directory_path(&base_dir, &folder_name)?;
    allow_path_in_asset_scope(&app, &dest_dir);
    Ok(dest_dir.to_string_lossy().to_string())
}

#[tauri::command]
pub fn save_dropped_directory_file(
    app: tauri::AppHandle,
    root_dir: String,
    relative_path: String,
    data_base64: String,
) -> Result<u64, String> {
    const MAX_STAGED_BYTES: usize = 25 * 1024 * 1024;
    const MAX_BASE64_LEN: usize = 35 * 1024 * 1024;

    let trimmed = data_base64.trim();
    if trimmed.len() > MAX_BASE64_LEN {
        return Err("Ukuran berkas melebihi batas transit 25 MB".to_string());
    }

    let decoded = if trimmed.is_empty() {
        Vec::new()
    } else {
        base64::engine::general_purpose::STANDARD
            .decode(trimmed)
            .map_err(|e| format!("Gagal mendekode data berkas folder: {}", e))?
    };

    if decoded.len() > MAX_STAGED_BYTES {
        return Err("Ukuran berkas melebihi batas transit 25 MB".to_string());
    }

    let base_dir = crate::connect_hp::resolve_casa_drop_dir(&app)?;
    let dest_file = resolve_safe_file_inside_root(&base_dir, Path::new(root_dir.trim()), &relative_path)?;
    if let Some(parent) = dest_file.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Gagal membuat subdirektori transit: {}", e))?;
    }

    std::fs::write(&dest_file, &decoded)
        .map_err(|e| format!("Gagal menyimpan berkas folder transit: {}", e))?;

    allow_path_in_asset_scope(&app, &dest_file);
    Ok(decoded.len() as u64)
}

#[derive(serde::Serialize)]
pub struct FileMetadata {
    pub exists: bool,
    pub size_bytes: u64,
    pub is_dir: bool,
    pub file_count: Option<u32>,
}

fn normalize_path_for_policy_check(path: &Path) -> String {
    let resolved = std::fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let s = resolved.to_string_lossy().replace('/', "\\");
    let stripped = if let Some(rest) = s.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{}", rest)
    } else if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s
    };
    stripped.trim_end_matches('\\').to_ascii_lowercase()
}

pub fn is_blocked_asset_scope_path(path: &Path) -> bool {
    let norm = normalize_path_for_policy_check(path);
    if norm.is_empty() || norm.starts_with(r"\\") {
        return true;
    }

    // Reject drive roots (e.g. "c:" or "/")
    let check_path = Path::new(&norm);
    if check_path.parent().is_none() || (norm.len() == 2 && norm.ends_with(':')) {
        return true;
    }

    for env_key in ["USERPROFILE", "APPDATA", "LOCALAPPDATA"] {
        if let Some(val) = std::env::var_os(env_key) {
            let env_norm = normalize_path_for_policy_check(Path::new(&val));
            if !env_norm.is_empty() && norm == env_norm {
                return true;
            }
        }
    }

    for dir_env in ["SystemRoot", "ProgramFiles", "ProgramFiles(x86)"] {
        if let Some(val) = std::env::var_os(dir_env) {
            let env_norm = normalize_path_for_policy_check(Path::new(&val));
            if !env_norm.is_empty()
                && (norm == env_norm || norm.starts_with(&format!("{}\\", env_norm)))
            {
                return true;
            }
        }
    }

    for segment in norm.split('\\') {
        if matches!(
            segment,
            ".ssh" | ".gnupg" | ".aws" | ".kube" | ".git-credentials" | "ntuser.dat"
        ) {
            return true;
        }
    }

    false
}

pub fn is_previewable_asset_file(path: &Path) -> bool {
    if !path.is_file() {
        return false;
    }
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.trim().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "png"
            | "jpg"
            | "jpeg"
            | "gif"
            | "webp"
            | "bmp"
            | "svg"
            | "ico"
            | "avif"
            | "mp3"
            | "wav"
            | "flac"
            | "ogg"
            | "m4a"
            | "aac"
            | "opus"
            | "mp4"
            | "webm"
            | "mov"
    )
}

pub(crate) fn allow_path_in_asset_scope(app: &tauri::AppHandle, path: &Path) {
    if is_blocked_asset_scope_path(path) || !is_previewable_asset_file(path) {
        return;
    }
    let _ = app.asset_protocol_scope().allow_file(path);
}

pub fn count_directory_files(dir: &Path, limit: u32) -> u32 {
    let mut stack = vec![dir.to_path_buf()];
    let mut count: u32 = 0;

    while let Some(curr) = stack.pop() {
        let Ok(entries) = std::fs::read_dir(&curr) else {
            continue;
        };
        for entry in entries.flatten() {
            let Ok(meta) = std::fs::symlink_metadata(entry.path()) else {
                continue;
            };
            if meta.file_type().is_symlink() {
                continue;
            }
            if meta.is_file() {
                count = count.saturating_add(1);
                if count >= limit {
                    return count;
                }
            } else if meta.is_dir() && stack.len() < 512 {
                stack.push(entry.path());
            }
        }
    }

    count
}

#[tauri::command]
pub fn get_file_metadata(app: tauri::AppHandle, path: String) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    if let Ok(meta) = std::fs::metadata(p) {
        if meta.is_file() || meta.is_dir() {
            allow_path_in_asset_scope(&app, p);
        }
        let file_count = if meta.is_dir() {
            Some(count_directory_files(p, 5000))
        } else {
            None
        };
        Ok(FileMetadata {
            exists: true,
            size_bytes: meta.len(),
            is_dir: meta.is_dir(),
            file_count,
        })
    } else {
        Ok(FileMetadata {
            exists: false,
            size_bytes: 0,
            is_dir: false,
            file_count: None,
        })
    }
}

/// Daftarkan ulang daftar path berkas yang diparkir di Drop Zone ke runtime Asset Protocol Scope Tauri.
/// Menjamin thumbnail gambar dan pemutaran audio lokal tetap valid setelah restart aplikasi.
#[tauri::command]
pub fn register_drop_zone_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<Vec<String>, String> {
    let mut allowed = Vec::new();
    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let p = Path::new(trimmed);
        if p.is_file() || p.is_dir() {
            allow_path_in_asset_scope(&app, p);
            allowed.push(trimmed.to_string());
        }
    }
    Ok(allowed)
}

#[cfg(windows)]
struct ClipboardSessionGuard;

#[cfg(windows)]
impl Drop for ClipboardSessionGuard {
    fn drop(&mut self) {
        unsafe {
            let _ = windows::Win32::System::DataExchange::CloseClipboard();
        }
    }
}

#[cfg(windows)]
fn open_clipboard_session() -> Result<ClipboardSessionGuard, String> {
    use windows::Win32::System::DataExchange::OpenClipboard;

    for _ in 0..5 {
        if unsafe { OpenClipboard(None) }.is_ok() {
            return Ok(ClipboardSessionGuard);
        }
        std::thread::sleep(std::time::Duration::from_millis(15));
    }

    Err("Clipboard sedang digunakan oleh aplikasi lain".to_string())
}

/// Membaca teks Unicode (CF_UNICODETEXT) langsung dari Windows Clipboard API tanpa izin browser.
#[tauri::command]
pub fn read_clipboard_text() -> Result<Option<String>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::DataExchange::{
            GetClipboardData, IsClipboardFormatAvailable,
        };
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        use windows::Win32::System::Ole::CF_UNICODETEXT;

        let fmt = CF_UNICODETEXT.0 as u32;
        if unsafe { IsClipboardFormatAvailable(fmt) }.is_err() {
            return Ok(None);
        }

        let _clipboard_guard = open_clipboard_session()?;

        unsafe {
            let Ok(handle) = GetClipboardData(fmt) else {
                return Ok(None);
            };
            if handle.is_invalid() || handle.0.is_null() {
                return Ok(None);
            }

            let hglobal = HGLOBAL(handle.0);
            let byte_size = GlobalSize(hglobal);
            let ptr = GlobalLock(hglobal);
            if ptr.is_null() {
                return Ok(None);
            }

            let max_u16 = if byte_size >= 2 { byte_size / 2 } else { 0 };
            let text = if max_u16 > 0 {
                let slice = std::slice::from_raw_parts(ptr as *const u16, max_u16);
                let nul_pos = slice.iter().position(|&ch| ch == 0).unwrap_or(slice.len());
                String::from_utf16_lossy(&slice[..nul_pos])
            } else {
                String::new()
            };

            let _ = GlobalUnlock(hglobal);

            let trimmed = text.trim();
            if trimmed.is_empty() {
                return Ok(None);
            }
            Ok(Some(text))
        }
    }

    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

/// Menuliskan teks Unicode (CF_UNICODETEXT) ke Windows Clipboard secara eksplisit (reuse `open_clipboard_session` + `build_cf_unicodetext_hglobal`).
pub fn write_clipboard_text(text: &str) -> Result<(), String> {
    if text.is_empty() {
        return Err("Teks clipboard kosong".to_string());
    }

    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{GlobalFree, HANDLE};
        use windows::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
        use windows::Win32::System::Ole::CF_UNICODETEXT;

        let hglobal = build_cf_unicodetext_hglobal(text)?;

        unsafe {
            let Ok(_clipboard_guard) = open_clipboard_session() else {
                let _ = GlobalFree(Some(hglobal));
                return Err("Clipboard sedang digunakan oleh aplikasi lain".to_string());
            };

            let write_res = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| format!("EmptyClipboard gagal: {}", e))?;
                SetClipboardData(CF_UNICODETEXT.0 as u32, Some(HANDLE(hglobal.0)))
                    .map_err(|e| format!("SetClipboardData gagal: {}", e))?;
                Ok(())
            })();

            if let Err(err) = write_res {
                let _ = GlobalFree(Some(hglobal));
                return Err(err);
            }
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = text;
        Err("Penulisan clipboard sistem hanya didukung di Windows".to_string())
    }
}

/// IPC command untuk menyalin teks singkat (mis. hasil kalkulator) ke clipboard Windows via `write_clipboard_text`.
#[tauri::command]
pub fn copy_text_to_clipboard(text: String) -> Result<(), String> {
    if text.is_empty() || text.len() > 64 * 1024 {
        return Err("Teks clipboard tidak valid atau terlalu panjang.".to_string());
    }
    write_clipboard_text(&text)
}

/// Membaca daftar path berkas (CF_HDROP) jika pengguna menyalin file via Ctrl+C di File Explorer.
#[tauri::command]
pub fn read_clipboard_files() -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::HGLOBAL;
        use windows::Win32::System::DataExchange::{
            GetClipboardData, IsClipboardFormatAvailable,
        };
        use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
        use windows::Win32::System::Ole::CF_HDROP;
        use windows::Win32::UI::Shell::{DragQueryFileW, HDROP};

        let fmt = CF_HDROP.0 as u32;
        if unsafe { IsClipboardFormatAvailable(fmt) }.is_err() {
            return Ok(Vec::new());
        }

        let _clipboard_guard = open_clipboard_session()?;

        unsafe {
            let Ok(handle) = GetClipboardData(fmt) else {
                return Ok(Vec::new());
            };
            if handle.is_invalid() || handle.0.is_null() {
                return Ok(Vec::new());
            }

            let hglobal = HGLOBAL(handle.0);
            let ptr = GlobalLock(hglobal);
            if ptr.is_null() {
                return Ok(Vec::new());
            }

            let hdrop = HDROP(hglobal.0);
            let count = DragQueryFileW(hdrop, u32::MAX, None);
            let mut paths = Vec::new();

            for i in 0..count {
                let len = DragQueryFileW(hdrop, i, None);
                if len == 0 {
                    continue;
                }
                let mut buf = vec![0u16; (len as usize) + 1];
                let copied = DragQueryFileW(hdrop, i, Some(&mut buf));
                if copied > 0 {
                    let p = String::from_utf16_lossy(&buf[..copied as usize]);
                    if !p.trim().is_empty() && Path::new(&p).exists() {
                        paths.push(p);
                    }
                }
            }

            let _ = GlobalUnlock(hglobal);
            Ok(paths)
        }
    }

    #[cfg(not(windows))]
    {
        Ok(Vec::new())
    }
}

/// Menyimpan gambar/screenshot dari clipboard webview ke direktori cache aplikasi dan mendaftarkannya ke asset scope.
#[tauri::command]
pub fn save_clipboard_image(
    app: tauri::AppHandle,
    bytes: Vec<u8>,
    extension: Option<String>,
) -> Result<String, String> {
    const MAX_CLIPBOARD_IMAGE_BYTES: usize = 25 * 1024 * 1024;
    if bytes.is_empty() {
        return Err("Data gambar clipboard kosong".to_string());
    }
    if bytes.len() > MAX_CLIPBOARD_IMAGE_BYTES {
        return Err("Ukuran gambar clipboard melebihi batas 25 MB".to_string());
    }

    let safe_ext = match extension
        .as_deref()
        .unwrap_or("png")
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        "gif" => "gif",
        "bmp" => "bmp",
        _ => "png",
    };

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| format!("Gagal menemukan cache directory: {}", e))?
        .join("drop_zone_clipboard");
    std::fs::create_dir_all(&cache_dir)
        .map_err(|e| format!("Gagal membuat folder clipboard: {}", e))?;

    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let file_path = cache_dir.join(format!("clip-{}.{}", millis, safe_ext));

    std::fs::write(&file_path, &bytes)
        .map_err(|e| format!("Gagal menulis file gambar clipboard: {}", e))?;

    allow_path_in_asset_scope(&app, &file_path);
    Ok(file_path.to_string_lossy().to_string())
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeDragDropResult {
    pub status: String,
    pub effect: u32,
}

fn normalize_existing_drop_paths(paths: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for raw in paths {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            continue;
        }
        let replaced = trimmed.replace('/', "\\");
        let mut candidate = if let Some(stripped) = replaced.strip_prefix(r"\\?\") {
            if !stripped.starts_with("UNC\\") && stripped.len() < 260 {
                stripped.to_string()
            } else {
                replaced
            }
        } else {
            replaced
        };
        while candidate.len() > 3 && candidate.ends_with('\\') {
            candidate.pop();
        }
        let candidate_path = Path::new(&candidate);
        if (candidate_path.is_file() || candidate_path.is_dir()) && !normalized.contains(&candidate) {
            normalized.push(candidate);
        }
    }
    normalized
}

fn is_accepted_external_drop(
    hr_code: i32,
    drop_s_drop_code: i32,
    effect: u32,
    dropped_on_self: bool,
) -> bool {
    hr_code == drop_s_drop_code && effect != 0 && !dropped_on_self
}

#[cfg(windows)]
fn build_cf_unicodetext_hglobal(
    text: &str,
) -> Result<windows::Win32::Foundation::HGLOBAL, String> {
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    if text.is_empty() {
        return Err("Teks drag-out kosong".to_string());
    }

    let units: Vec<u16> = text.encode_utf16().collect();
    let byte_len = (units.len() + 1) * std::mem::size_of::<u16>();

    unsafe {
        let hglobal: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, byte_len)
            .map_err(|e| format!("GlobalAlloc CF_UNICODETEXT gagal: {}", e))?;

        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hglobal));
            return Err("GlobalLock CF_UNICODETEXT gagal".to_string());
        }

        let dst_u16 = ptr as *mut u16;
        std::ptr::copy_nonoverlapping(units.as_ptr(), dst_u16, units.len());
        *dst_u16.add(units.len()) = 0u16;
        let _ = GlobalUnlock(hglobal);
        Ok(hglobal)
    }
}

#[cfg(windows)]
fn build_cf_text_hglobal(text: &str) -> Result<windows::Win32::Foundation::HGLOBAL, String> {
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    if text.is_empty() {
        return Err("Teks drag-out kosong".to_string());
    }

    let bytes: Vec<u8> = text
        .as_bytes()
        .iter()
        .map(|&b| if b == 0 { b' ' } else { b })
        .collect();
    let byte_len = bytes.len() + 1;

    unsafe {
        let hglobal: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, byte_len)
            .map_err(|e| format!("GlobalAlloc CF_TEXT gagal: {}", e))?;

        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hglobal));
            return Err("GlobalLock CF_TEXT gagal".to_string());
        }

        let dst_u8 = ptr as *mut u8;
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), dst_u8, bytes.len());
        *dst_u8.add(bytes.len()) = 0u8;
        let _ = GlobalUnlock(hglobal);
        Ok(hglobal)
    }
}

#[cfg(windows)]
fn build_cf_locale_hglobal(lcid: u32) -> Result<windows::Win32::Foundation::HGLOBAL, String> {
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };

    unsafe {
        let hglobal: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, std::mem::size_of::<u32>())
            .map_err(|e| format!("GlobalAlloc CF_LOCALE gagal: {}", e))?;

        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hglobal));
            return Err("GlobalLock CF_LOCALE gagal".to_string());
        }

        std::ptr::write(ptr as *mut u32, lcid);
        let _ = GlobalUnlock(hglobal);
        Ok(hglobal)
    }
}

#[cfg(windows)]
fn build_cf_hdrop_hglobal(
    valid_paths: &[String],
) -> Result<windows::Win32::Foundation::HGLOBAL, String> {
    use std::ffi::OsStr;
    use std::os::windows::ffi::OsStrExt;
    use windows::Win32::Foundation::{GlobalFree, HGLOBAL};
    use windows::Win32::System::Memory::{
        GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
    };
    use windows::Win32::UI::Shell::DROPFILES;

    let mut wide_chars: Vec<u16> = Vec::new();
    for p in valid_paths {
        wide_chars.extend(OsStr::new(p).encode_wide());
        wide_chars.push(0);
    }
    wide_chars.push(0); // Double-null terminator

    let dropfiles_size = std::mem::size_of::<DROPFILES>();
    let payload_bytes = wide_chars.len() * std::mem::size_of::<u16>();
    let total_bytes = dropfiles_size + payload_bytes;

    unsafe {
        let hglobal: HGLOBAL = GlobalAlloc(GMEM_MOVEABLE | GMEM_ZEROINIT, total_bytes)
            .map_err(|e| format!("GlobalAlloc gagal: {}", e))?;

        let ptr = GlobalLock(hglobal);
        if ptr.is_null() {
            let _ = GlobalFree(Some(hglobal));
            return Err("GlobalLock gagal".to_string());
        }

        let df = ptr as *mut DROPFILES;
        (*df).pFiles = dropfiles_size as u32;
        (*df).pt.x = 0;
        (*df).pt.y = 0;
        (*df).fNC = false.into();
        (*df).fWide = true.into();

        let data_dst = (ptr as *mut u8).add(dropfiles_size) as *mut u16;
        std::ptr::copy_nonoverlapping(wide_chars.as_ptr(), data_dst, wide_chars.len());
        let _ = GlobalUnlock(hglobal);
        Ok(hglobal)
    }
}

/// Menyalin berkas fisik asli ke clipboard Windows sebagai format CF_HDROP (siap Ctrl+V di Explorer, Browser, Discord, WhatsApp).
#[tauri::command]
pub fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows::Win32::Foundation::{GlobalFree, HANDLE};
        use windows::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
        use windows::Win32::System::Ole::CF_HDROP;

        let valid_paths = normalize_existing_drop_paths(paths);
        if valid_paths.is_empty() {
            return Err("Berkas tidak ditemukan di disk".to_string());
        }

        let hglobal = build_cf_hdrop_hglobal(&valid_paths)?;

        unsafe {
            let Ok(_clipboard_guard) = open_clipboard_session() else {
                let _ = GlobalFree(Some(hglobal));
                return Err("Clipboard sedang digunakan oleh aplikasi lain".to_string());
            };

            let copy_res = (|| -> Result<(), String> {
                EmptyClipboard().map_err(|e| format!("EmptyClipboard gagal: {}", e))?;
                SetClipboardData(CF_HDROP.0 as u32, Some(HANDLE(hglobal.0)))
                    .map_err(|e| format!("SetClipboardData gagal: {}", e))?;
                Ok(())
            })();

            if let Err(err) = copy_res {
                let _ = GlobalFree(Some(hglobal));
                return Err(err);
            }
        }

        Ok(())
    }

    #[cfg(not(windows))]
    {
        let _ = paths;
        Err("Salin file ke clipboard sistem hanya didukung di Windows".to_string())
    }
}

#[cfg(windows)]
mod win32_drag {
    use super::{
        build_cf_hdrop_hglobal, build_cf_locale_hglobal, build_cf_text_hglobal,
        build_cf_unicodetext_hglobal, is_accepted_external_drop, NativeDragDropResult,
    };
    use std::mem::{ManuallyDrop, MaybeUninit};
    use std::sync::atomic::{AtomicUsize, Ordering};
    use windows::Win32::Foundation::{
        DATA_S_SAMEFORMATETC, DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS,
        DV_E_FORMATETC, E_INVALIDARG, E_NOTIMPL, E_OUTOFMEMORY, HWND, OLE_E_ADVISENOTSUPPORTED,
        POINT, S_FALSE, S_OK,
    };
    use windows::Win32::System::Com::{
        IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumFORMATETC_Impl,
        IEnumSTATDATA, DATADIR_GET, DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0,
        TYMED_HGLOBAL,
    };
    use windows::Win32::System::Ole::{
        DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize, CF_HDROP,
        CF_LOCALE, CF_OEMTEXT, CF_TEXT, CF_UNICODETEXT, DROPEFFECT, DROPEFFECT_COPY,
        DROPEFFECT_MOVE, DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::{MK_LBUTTON, MK_RBUTTON, MODIFIERKEYS_FLAGS};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, ReleaseCapture, VK_LBUTTON, VK_RBUTTON,
    };
    use windows::Win32::UI::Shell::{SHCreateDataObject, SHCreateStdEnumFmtEtc};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetAncestor, GetCursorPos, GetSystemMetrics, WindowFromPoint, GA_ROOT, SM_SWAPBUTTON,
    };
    use windows_core::{implement, Error, HRESULT, Ref, Result as WinResult, BOOL};

    struct OleInitGuard(bool);

    impl OleInitGuard {
        fn acquire() -> Result<Self, String> {
            unsafe {
                OleInitialize(None)
                    .map(|_| Self(true))
                    .map_err(|e| format!("OleInitialize STA gagal: {}", e))
            }
        }
    }

    impl Drop for OleInitGuard {
        fn drop(&mut self) {
            if self.0 {
                unsafe {
                    OleUninitialize();
                }
            }
        }
    }

    struct InternalDragOutGuard;

    impl InternalDragOutGuard {
        fn enter() -> Self {
            crate::hitbox::set_internal_drag_out(true);
            Self
        }
    }

    impl Drop for InternalDragOutGuard {
        fn drop(&mut self) {
            crate::hitbox::set_internal_drag_out(false);
        }
    }

    #[implement(IDropSource)]
    struct CasaDropSource;

    #[allow(non_snake_case)]
    impl IDropSource_Impl for CasaDropSource_Impl {
        fn QueryContinueDrag(&self, fescapepressed: BOOL, grfkeystate: MODIFIERKEYS_FLAGS) -> HRESULT {
            if fescapepressed.as_bool() {
                DRAGDROP_S_CANCEL
            } else if (grfkeystate & (MK_LBUTTON | MK_RBUTTON)) == MODIFIERKEYS_FLAGS(0) {
                DRAGDROP_S_DROP
            } else {
                S_OK
            }
        }

        fn GiveFeedback(&self, _dweffect: DROPEFFECT) -> HRESULT {
            DRAGDROP_S_USEDEFAULTCURSORS
        }
    }

    #[implement(IDataObject)]
    struct CasaFileDataObject {
        paths: Vec<String>,
        inner: Option<IDataObject>,
    }

    impl CasaFileDataObject {
        fn new(paths: Vec<String>) -> Self {
            let inner = unsafe { SHCreateDataObject(None, None, None::<&IDataObject>) }.ok();
            Self { paths, inner }
        }

        fn cf_hdrop_formatetc() -> FORMATETC {
            FORMATETC {
                cfFormat: CF_HDROP.0,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            }
        }

        fn is_cf_hdrop(pformatetc: *const FORMATETC) -> bool {
            let Some(fmt) = (unsafe { pformatetc.as_ref() }) else {
                return false;
            };
            fmt.cfFormat == CF_HDROP.0
                && (fmt.dwAspect & DVASPECT_CONTENT.0) != 0
                && (fmt.tymed & (TYMED_HGLOBAL.0 as u32)) != 0
                && (fmt.lindex == -1 || fmt.lindex == 0)
        }
    }

    #[allow(non_snake_case)]
    impl IDataObject_Impl for CasaFileDataObject_Impl {
        fn GetData(&self, pformatetcin: *const FORMATETC) -> WinResult<STGMEDIUM> {
            if CasaFileDataObject::is_cf_hdrop(pformatetcin) {
                let hglobal = build_cf_hdrop_hglobal(&self.paths)
                    .map_err(|_| Error::from(E_OUTOFMEMORY))?;
                Ok(STGMEDIUM {
                    tymed: TYMED_HGLOBAL.0 as u32,
                    u: STGMEDIUM_0 { hGlobal: hglobal },
                    pUnkForRelease: ManuallyDrop::new(None),
                })
            } else if let Some(inner) = &self.inner {
                unsafe { inner.GetData(pformatetcin) }
            } else {
                Err(Error::from(DV_E_FORMATETC))
            }
        }

        fn GetDataHere(&self, _pformatetc: *const FORMATETC, _pmedium: *mut STGMEDIUM) -> WinResult<()> {
            Err(Error::from(DV_E_FORMATETC))
        }

        fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
            if CasaFileDataObject::is_cf_hdrop(pformatetc) {
                S_OK
            } else if let Some(inner) = &self.inner {
                unsafe { inner.QueryGetData(pformatetc) }
            } else {
                DV_E_FORMATETC
            }
        }

        fn GetCanonicalFormatEtc(
            &self,
            _pformatectin: *const FORMATETC,
            pformatetcout: *mut FORMATETC,
        ) -> HRESULT {
            if !pformatetcout.is_null() {
                unsafe {
                    (*pformatetcout).ptd = std::ptr::null_mut();
                }
            }
            E_NOTIMPL
        }

        fn SetData(
            &self,
            pformatetc: *const FORMATETC,
            pmedium: *const STGMEDIUM,
            frelease: BOOL,
        ) -> WinResult<()> {
            if let Some(inner) = &self.inner {
                unsafe { inner.SetData(pformatetc, pmedium, frelease.as_bool()) }
            } else {
                Err(Error::from(E_NOTIMPL))
            }
        }

        fn EnumFormatEtc(&self, dwdirection: u32) -> WinResult<IEnumFORMATETC> {
            if dwdirection == DATADIR_GET.0 as u32 {
                let fmts = [CasaFileDataObject::cf_hdrop_formatetc()];
                unsafe { SHCreateStdEnumFmtEtc(&fmts) }
            } else {
                Err(Error::from(E_NOTIMPL))
            }
        }

        fn DAdvise(
            &self,
            _pformatetc: *const FORMATETC,
            _advf: u32,
            _padvsink: Ref<IAdviseSink>,
        ) -> WinResult<u32> {
            Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _dwconnection: u32) -> WinResult<()> {
            Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> WinResult<IEnumSTATDATA> {
            Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    #[implement(IEnumFORMATETC)]
    struct CasaEnumFormatEtc {
        formats: Vec<FORMATETC>,
        index: AtomicUsize,
    }

    impl CasaEnumFormatEtc {
        fn new(formats: Vec<FORMATETC>) -> Self {
            Self {
                formats,
                index: AtomicUsize::new(0),
            }
        }
    }

    #[allow(non_snake_case)]
    impl IEnumFORMATETC_Impl for CasaEnumFormatEtc_Impl {
        fn Next(
            &self,
            celt: u32,
            rgelt: *mut FORMATETC,
            pceltfetched: *mut u32,
        ) -> HRESULT {
            if rgelt.is_null() {
                return E_INVALIDARG;
            }
            if celt > 1 && pceltfetched.is_null() {
                return E_INVALIDARG;
            }
            if celt == 0 {
                if !pceltfetched.is_null() {
                    unsafe {
                        std::ptr::write(pceltfetched, 0);
                    }
                }
                return S_OK;
            }

            let pos = self.index.load(Ordering::SeqCst);
            let available = self.formats.len().saturating_sub(pos);
            let to_copy = available.min(celt as usize);

            for i in 0..to_copy {
                unsafe {
                    std::ptr::write(rgelt.add(i), self.formats[pos + i]);
                }
            }

            self.index.store(pos + to_copy, Ordering::SeqCst);

            if !pceltfetched.is_null() {
                unsafe {
                    std::ptr::write(pceltfetched, to_copy as u32);
                }
            }

            if to_copy == celt as usize {
                S_OK
            } else {
                S_FALSE
            }
        }

        fn Skip(&self, celt: u32) -> WinResult<()> {
            let pos = self.index.load(Ordering::SeqCst);
            let target = pos.saturating_add(celt as usize);
            if target <= self.formats.len() {
                self.index.store(target, Ordering::SeqCst);
                Ok(())
            } else {
                self.index.store(self.formats.len(), Ordering::SeqCst);
                Err(Error::from(S_FALSE))
            }
        }

        fn Reset(&self) -> WinResult<()> {
            self.index.store(0, Ordering::SeqCst);
            Ok(())
        }

        fn Clone(&self) -> WinResult<IEnumFORMATETC> {
            Ok(CasaEnumFormatEtc {
                formats: self.formats.clone(),
                index: AtomicUsize::new(self.index.load(Ordering::SeqCst)),
            }
            .into())
        }
    }

    #[implement(IDataObject)]
    struct CasaTextDataObject {
        text: String,
    }

    impl CasaTextDataObject {
        fn new(text: String) -> Self {
            Self { text }
        }

        fn formatetc_hglobal(cf: u16) -> FORMATETC {
            FORMATETC {
                cfFormat: cf,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: TYMED_HGLOBAL.0 as u32,
            }
        }

        fn matches_chromium_format(pformatetc: *const FORMATETC, target_cf: u16) -> bool {
            let Some(fmt) = (unsafe { pformatetc.as_ref() }) else {
                return false;
            };
            fmt.cfFormat == target_cf
                && (fmt.dwAspect == DVASPECT_CONTENT.0 || fmt.dwAspect == 0)
                && (fmt.tymed & (TYMED_HGLOBAL.0 as u32)) != 0
                && (fmt.lindex == -1 || fmt.lindex == 0)
        }

        fn supports_format(&self, pformatetc: *const FORMATETC) -> bool {
            Self::matches_chromium_format(pformatetc, CF_UNICODETEXT.0)
                || Self::matches_chromium_format(pformatetc, CF_TEXT.0)
                || Self::matches_chromium_format(pformatetc, CF_OEMTEXT.0)
                || Self::matches_chromium_format(pformatetc, CF_LOCALE.0)
        }

        fn write_hglobal_to_pmedium(
            pmedium: *mut STGMEDIUM,
            hglobal: windows::Win32::Foundation::HGLOBAL,
        ) -> WinResult<()> {
            if pmedium.is_null() {
                return Err(Error::from(E_INVALIDARG));
            }
            unsafe {
                std::ptr::write(
                    pmedium,
                    STGMEDIUM {
                        tymed: TYMED_HGLOBAL.0 as u32,
                        u: STGMEDIUM_0 { hGlobal: hglobal },
                        pUnkForRelease: ManuallyDrop::new(None),
                    },
                );
            }
            Ok(())
        }
    }

    #[allow(non_snake_case)]
    impl IDataObject_Impl for CasaTextDataObject_Impl {
        fn GetData(&self, pformatetcin: *const FORMATETC) -> WinResult<STGMEDIUM> {
            let hglobal = if CasaTextDataObject::matches_chromium_format(
                pformatetcin,
                CF_UNICODETEXT.0,
            ) {
                build_cf_unicodetext_hglobal(&self.text)
                    .map_err(|_| Error::from(E_OUTOFMEMORY))?
            } else if CasaTextDataObject::matches_chromium_format(pformatetcin, CF_TEXT.0)
                || CasaTextDataObject::matches_chromium_format(pformatetcin, CF_OEMTEXT.0)
            {
                build_cf_text_hglobal(&self.text).map_err(|_| Error::from(E_OUTOFMEMORY))?
            } else if CasaTextDataObject::matches_chromium_format(pformatetcin, CF_LOCALE.0) {
                build_cf_locale_hglobal(0x0409).map_err(|_| Error::from(E_OUTOFMEMORY))?
            } else {
                return Err(Error::from(DV_E_FORMATETC));
            };

            let mut medium = MaybeUninit::<STGMEDIUM>::uninit();
            CasaTextDataObject::write_hglobal_to_pmedium(medium.as_mut_ptr(), hglobal)?;
            Ok(unsafe { medium.assume_init() })
        }

        fn GetDataHere(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *mut STGMEDIUM,
        ) -> WinResult<()> {
            Err(Error::from(DV_E_FORMATETC))
        }

        fn QueryGetData(&self, pformatetc: *const FORMATETC) -> HRESULT {
            if self.supports_format(pformatetc) {
                S_OK
            } else {
                DV_E_FORMATETC
            }
        }

        fn GetCanonicalFormatEtc(
            &self,
            pformatectin: *const FORMATETC,
            pformatetcout: *mut FORMATETC,
        ) -> HRESULT {
            if pformatetcout.is_null() {
                return E_INVALIDARG;
            }
            if pformatectin.is_null() {
                unsafe {
                    std::ptr::write(pformatetcout, FORMATETC::default());
                }
                return E_INVALIDARG;
            }
            unsafe {
                let mut canon = std::ptr::read(pformatectin);
                canon.ptd = std::ptr::null_mut();
                std::ptr::write(pformatetcout, canon);
            }
            DATA_S_SAMEFORMATETC
        }

        fn SetData(
            &self,
            _pformatetc: *const FORMATETC,
            _pmedium: *const STGMEDIUM,
            _frelease: BOOL,
        ) -> WinResult<()> {
            Err(Error::from(E_NOTIMPL))
        }

        fn EnumFormatEtc(&self, dwdirection: u32) -> WinResult<IEnumFORMATETC> {
            if dwdirection == DATADIR_GET.0 as u32 {
                let fmts = vec![
                    CasaTextDataObject::formatetc_hglobal(CF_UNICODETEXT.0),
                    CasaTextDataObject::formatetc_hglobal(CF_TEXT.0),
                    CasaTextDataObject::formatetc_hglobal(CF_OEMTEXT.0),
                    CasaTextDataObject::formatetc_hglobal(CF_LOCALE.0),
                ];
                Ok(CasaEnumFormatEtc::new(fmts).into())
            } else {
                Err(Error::from(E_NOTIMPL))
            }
        }

        fn DAdvise(
            &self,
            _pformatetc: *const FORMATETC,
            _advf: u32,
            _padvsink: Ref<IAdviseSink>,
        ) -> WinResult<u32> {
            Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
        }

        fn DUnadvise(&self, _dwconnection: u32) -> WinResult<()> {
            Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
        }

        fn EnumDAdvise(&self) -> WinResult<IEnumSTATDATA> {
            Err(Error::from(OLE_E_ADVISENOTSUPPORTED))
        }
    }

    fn run_drag_drop_on_sta(
        data_object: IDataObject,
        main_hwnd: Option<HWND>,
        allowed_effects: DROPEFFECT,
    ) -> Result<NativeDragDropResult, String> {
        let _ole_guard = OleInitGuard::acquire()?;
        let _drag_out_guard = InternalDragOutGuard::enter();

        // Guard jika tombol mouse utama sudah terlepas sebelum DoDragDrop mulai berjalan
        let primary_vk = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
            VK_RBUTTON
        } else {
            VK_LBUTTON
        };
        if (unsafe { GetAsyncKeyState(primary_vk.0 as i32) } as u16 & 0x8000) == 0 {
            return Ok(NativeDragDropResult {
                status: "cancelled".to_string(),
                effect: 0,
            });
        }

        // Bebaskan mouse capture sisa WebView2 sebelum memasuki modal loop OLE DoDragDrop
        unsafe {
            let _ = ReleaseCapture();
        }

        let drop_source: IDropSource = CasaDropSource.into();
        let mut out_effect = DROPEFFECT_NONE;

        let hr = unsafe { DoDragDrop(&data_object, &drop_source, allowed_effects, &mut out_effect) };

        let mut dropped_on_self = false;
        if hr == DRAGDROP_S_DROP && out_effect != DROPEFFECT_NONE {
            if let Some(root_hwnd) = main_hwnd {
                let mut end_pt = POINT { x: 0, y: 0 };
                if unsafe { GetCursorPos(&mut end_pt) }.is_ok() {
                    let target_hwnd = unsafe { WindowFromPoint(end_pt) };
                    if !target_hwnd.0.is_null() {
                        let target_root = unsafe { GetAncestor(target_hwnd, GA_ROOT) };
                        dropped_on_self = target_hwnd == root_hwnd || target_root == root_hwnd;
                    }
                }
            }
        }

        let accepted = is_accepted_external_drop(
            hr.0,
            DRAGDROP_S_DROP.0,
            out_effect.0,
            dropped_on_self,
        );

        Ok(NativeDragDropResult {
            status: if accepted {
                "dropped".to_string()
            } else {
                "cancelled".to_string()
            },
            effect: out_effect.0,
        })
    }

    pub fn execute_drag_drop_on_sta(
        valid_paths: Vec<String>,
        main_hwnd: Option<HWND>,
    ) -> Result<NativeDragDropResult, String> {
        let data_object: IDataObject = CasaFileDataObject::new(valid_paths).into();
        run_drag_drop_on_sta(data_object, main_hwnd, DROPEFFECT_COPY)
    }

    pub fn execute_text_drag_drop_on_sta(
        text: String,
        main_hwnd: Option<HWND>,
    ) -> Result<NativeDragDropResult, String> {
        let data_object: IDataObject = CasaTextDataObject::new(text).into();
        run_drag_drop_on_sta(data_object, main_hwnd, DROPEFFECT_COPY | DROPEFFECT_MOVE)
    }

    #[cfg(test)]
    pub fn create_text_data_object(text: String) -> IDataObject {
        CasaTextDataObject::new(text).into()
    }
}

/// Menyeret teks atau link DropZone keluar ke editor, browser, atau aplikasi chat lewat Win32 OLE `DoDragDrop`
/// (`CF_UNICODETEXT` + `CF_TEXT`) pada thread STA utama dengan validasi ganda `DRAGDROP_S_DROP` + `DROPEFFECT`.
#[tauri::command]
pub async fn native_drag_drop_text(
    app: tauri::AppHandle,
    text: String,
) -> Result<NativeDragDropResult, String> {
    #[cfg(windows)]
    {
        if text.trim().is_empty() {
            return Err("Konten teks atau tautan kosong.".to_string());
        }
        if text.chars().count() > 200_000 {
            return Err("Konten teks melebihi batas drag-out 200.000 karakter.".to_string());
        }

        let main_hwnd_raw = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize);

        let (tx, rx) = tokio::sync::oneshot::channel::<Result<NativeDragDropResult, String>>();

        app.run_on_main_thread(move || {
            let main_hwnd =
                main_hwnd_raw.map(|raw| windows::Win32::Foundation::HWND(raw as *mut _));
            let res = win32_drag::execute_text_drag_drop_on_sta(text, main_hwnd);
            let _ = tx.send(res);
        })
        .map_err(|e| format!("Gagal menjadwalkan drag-out teks di UI thread: {}", e))?;

        rx.await
            .map_err(|_| "Channel hasil DoDragDrop teks tertutup sebelum selesai".to_string())?
    }

    #[cfg(not(windows))]
    {
        let _ = (app, text);
        Err("Native CF_UNICODETEXT drag-out hanya didukung di Windows".to_string())
    }
}

/// Menyeret berkas DropZone keluar ke aplikasi eksternal (Explorer, Desktop, WhatsApp Desktop)
/// lewat Win32 OLE `DoDragDrop` (`CF_HDROP`) pada thread STA utama dengan validasi ganda `DRAGDROP_S_DROP` + `DROPEFFECT`.
#[tauri::command]
pub async fn native_drag_drop_files(
    app: tauri::AppHandle,
    paths: Vec<String>,
) -> Result<NativeDragDropResult, String> {
    #[cfg(windows)]
    {
        let valid_paths = normalize_existing_drop_paths(paths);
        if valid_paths.is_empty() {
            return Err("Berkas atau folder tidak ditemukan di disk atau sudah dipindahkan.".to_string());
        }
        for valid_path in &valid_paths {
            let p = Path::new(valid_path);
            if p.is_dir() || p.is_file() {
                allow_path_in_asset_scope(&app, p);
            }
        }

        let main_hwnd_raw = app
            .get_webview_window("main")
            .and_then(|w| w.hwnd().ok())
            .map(|h| h.0 as isize);

        let (tx, rx) = tokio::sync::oneshot::channel::<Result<NativeDragDropResult, String>>();

        app.run_on_main_thread(move || {
            let main_hwnd =
                main_hwnd_raw.map(|raw| windows::Win32::Foundation::HWND(raw as *mut _));
            let res = win32_drag::execute_drag_drop_on_sta(valid_paths, main_hwnd);
            let _ = tx.send(res);
        })
        .map_err(|e| format!("Gagal menjadwalkan drag-out di UI thread: {}", e))?;

        rx.await
            .map_err(|_| "Channel hasil DoDragDrop tertutup sebelum selesai".to_string())?
    }

    #[cfg(not(windows))]
    {
        let _ = (app, paths);
        Err("Native CF_HDROP drag-out hanya didukung di Windows".to_string())
    }
}

#[cfg(windows)]
async fn run_native_open_dialog(
    app: tauri::AppHandle,
    pick_folders: bool,
) -> Result<Vec<String>, String> {
    let app_clone = app.clone();
    let res = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
        use windows::Win32::Foundation::ERROR_CANCELLED;
        use windows::Win32::System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
            CLSCTX_ALL, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
        };
        use windows::Win32::UI::Shell::{
            FileOpenDialog, IFileOpenDialog, FOS_ALLOWMULTISELECT, FOS_FILEMUSTEXIST,
            FOS_PATHMUSTEXIST, FOS_PICKFOLDERS, SIGDN_FILESYSPATH,
        };

        struct ComGuard;
        impl Drop for ComGuard {
            fn drop(&mut self) {
                unsafe { CoUninitialize() };
            }
        }

        unsafe {
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
            if hr.is_err() {
                return Err(format!("CoInitializeEx gagal: {:?}", hr));
            }
            let _com_guard = ComGuard;

            let dialog: IFileOpenDialog =
                CoCreateInstance(&FileOpenDialog, None, CLSCTX_ALL)
                    .map_err(|e| format!("Gagal membuat dialog pemilih: {}", e))?;

            if let Ok(opts) = dialog.GetOptions() {
                let extra = if pick_folders {
                    FOS_PICKFOLDERS | FOS_ALLOWMULTISELECT | FOS_PATHMUSTEXIST
                } else {
                    FOS_ALLOWMULTISELECT | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST
                };
                let _ = dialog.SetOptions(opts | extra);
            }

            if let Err(err) = dialog.Show(None) {
                let cancelled = windows::core::HRESULT::from_win32(ERROR_CANCELLED.0);
                if err.code() == cancelled {
                    return Ok(Vec::new());
                }
                return Err(format!("Dialog dibatalkan atau gagal: {}", err));
            }

            let results = dialog
                .GetResults()
                .map_err(|e| format!("Gagal membaca pilihan item: {}", e))?;
            let count = results.GetCount().unwrap_or(0);
            let mut picked = Vec::with_capacity(count as usize);

            for idx in 0..count {
                if let Ok(item) = results.GetItemAt(idx) {
                    if let Ok(pwstr) = item.GetDisplayName(SIGDN_FILESYSPATH) {
                        let path_str = pwstr.to_string().unwrap_or_default();
                        CoTaskMemFree(Some(pwstr.0 as *const _));
                        if !path_str.is_empty() {
                            allow_path_in_asset_scope(&app_clone, Path::new(&path_str));
                            picked.push(path_str);
                        }
                    }
                }
            }

            Ok(picked)
        }
    })
    .await
    .map_err(|e| format!("Task dialog pemilih gagal: {}", e))?;

    res
}

/// Membuka dialog pilih file native Windows (multi-select) tanpa memblokir event loop UI utama.
#[tauri::command]
pub async fn pick_drop_zone_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        run_native_open_dialog(app, false).await
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Membuka dialog pilih folder native Windows (FOS_PICKFOLDERS, mendukung path disk langsung tanpa batas 25 MB WebView).
#[tauri::command]
pub async fn pick_drop_zone_folder(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        run_native_open_dialog(app, true).await
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

fn resolve_verified_local_path(raw: &str) -> Result<(PathBuf, String), String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Jalur berkas kosong".to_string());
    }
    let canon = std::fs::canonicalize(Path::new(trimmed))
        .map_err(|_| "Berkas atau folder tidak ditemukan di disk".to_string())?;
    let s = canon.to_string_lossy().to_string();
    if s.starts_with(r"\\?\UNC\") || s.starts_with(r"\\") && !s.starts_with(r"\\?\") {
        return Err("Membuka jalur jaringan UNC diblokir demi keamanan".to_string());
    }
    let clean = if let Some(rest) = s.strip_prefix(r"\\?\") {
        rest.to_string()
    } else {
        s
    };
    Ok((canon, clean))
}

pub fn is_dangerous_executable_extension(path: &Path) -> bool {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.trim().to_ascii_lowercase())
        .unwrap_or_default();
    matches!(
        ext.as_str(),
        "exe"
            | "msi"
            | "msp"
            | "bat"
            | "cmd"
            | "ps1"
            | "psm1"
            | "vbs"
            | "vbe"
            | "js"
            | "jse"
            | "wsf"
            | "wsh"
            | "hta"
            | "lnk"
            | "url"
            | "scr"
            | "com"
            | "pif"
            | "reg"
            | "msc"
            | "cpl"
            | "jar"
            | "inf"
            | "scf"
            | "sh"
    )
}

/// Membuka berkas lokal yang aman melalui ShellExecuteW tanpa CMD/conhost.
/// Berkas eksekusi/skrip berbahaya dialihkan ke Reveal in Explorer (tidak dieksekusi langsung).
#[tauri::command]
pub fn launch_file_item(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let (canon, clean_path) = resolve_verified_local_path(&path)?;
        if is_dangerous_executable_extension(&canon) {
            return reveal_in_folder(clean_path);
        }

        let wide_path: Vec<u16> = OsStr::new(&clean_path)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_open: Vec<u16> = OsStr::new("open")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let res = ShellExecuteW(
                std::ptr::null_mut(),
                wide_open.as_ptr(),
                wide_path.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL as i32,
            );
            if (res as usize) <= 32 {
                return Err(format!("ShellExecute error code: {}", res as usize));
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}

/// Membuka folder dan menyorot berkas di Windows Explorer secara in-process lewat Win32 Shell API
/// (`ILCreateFromPathW` + `SHOpenFolderAndSelectItems`), bebas injeksi argumen CLI.
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::UI::Shell::{ILCreateFromPathW, ILFree, SHOpenFolderAndSelectItems};

        let (_, clean_path) = resolve_verified_local_path(&path)?;
        let handle = std::thread::spawn(move || -> Result<(), String> {
            let _com = crate::security_utils::ComGuard::init_sta()?;
            let wide_path: Vec<u16> = OsStr::new(&clean_path)
                .encode_wide()
                .chain(std::iter::once(0))
                .collect();

            unsafe {
                let pidl = ILCreateFromPathW(PCWSTR(wide_path.as_ptr()));
                if pidl.is_null() {
                    return Err("Gagal membuat PIDL Windows Shell untuk path tersebut".to_string());
                }
                let res = SHOpenFolderAndSelectItems(pidl, None, 0);
                ILFree(Some(pidl));
                res.map_err(|e| format!("Gagal membuka Windows Explorer: {}", e))?;
            }
            Ok(())
        });

        handle
            .join()
            .map_err(|_| "Thread Windows Explorer berhenti tak terduga".to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = path;
        Ok(())
    }
}

/// Legacy / alias compatibility command
#[tauri::command]
pub fn open_file_item(path: String) -> Result<(), String> {
    reveal_in_folder(path)
}

#[tauri::command]
pub fn open_url_item(url: String) -> Result<(), String> {
    let trimmed = url.trim();
    if (!trimmed.starts_with("https://") && !trimmed.starts_with("http://"))
        || trimmed.chars().any(|c| c.is_control() || c.is_whitespace())
    {
        return Err("Only clean http:// or https:// URLs are allowed.".to_string());
    }
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide_url: Vec<u16> = OsStr::new(trimmed)
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();
        let wide_open: Vec<u16> = OsStr::new("open")
            .encode_wide()
            .chain(std::iter::once(0))
            .collect();

        unsafe {
            let res = ShellExecuteW(
                std::ptr::null_mut(),
                wide_open.as_ptr(),
                wide_url.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWNORMAL as i32,
            );
            if (res as usize) <= 32 {
                return Err(format!("Failed to open URL (code={})", res as usize));
            }
        }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = trimmed;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_nonexistent_paths_without_panicking() {
        let missing = format!(
            "{}\\casa_definitely_missing_{}.tmp",
            std::env::temp_dir().display(),
            std::process::id()
        );
        let res = normalize_existing_drop_paths(vec![
            "".to_string(),
            "   ".to_string(),
            missing,
        ]);
        assert!(res.is_empty());
    }

    #[test]
    fn normalizes_and_deduplicates_existing_paths() {
        let temp_file = std::env::temp_dir().join(format!(
            "casa_drop_zone_test_{}.txt",
            std::process::id()
        ));
        std::fs::write(&temp_file, b"casa").expect("write temp file");
        let raw = temp_file.to_string_lossy().to_string();
        let slash_variant = raw.replace('\\', "/");
        let verbatim_variant = format!(r"\\?\{}", raw);

        let res = normalize_existing_drop_paths(vec![raw.clone(), slash_variant, verbatim_variant]);
        let _ = std::fs::remove_file(&temp_file);

        assert_eq!(res.len(), 1);
        assert_eq!(res[0], raw);
        assert!(!res[0].starts_with(r"\\?\"));
    }

    #[test]
    fn validates_drop_outcome_strictly_with_effect_and_self_drop_guard() {
        const S_DROP: i32 = 0x00040100;
        const S_CANCEL: i32 = 0x00040101;
        const EFF_NONE: u32 = 0;
        const EFF_COPY: u32 = 1;

        assert!(is_accepted_external_drop(S_DROP, S_DROP, EFF_COPY, false));
        assert!(!is_accepted_external_drop(S_DROP, S_DROP, EFF_NONE, false));
        assert!(!is_accepted_external_drop(S_CANCEL, S_DROP, EFF_COPY, false));
        assert!(!is_accepted_external_drop(S_DROP, S_DROP, EFF_COPY, true));
    }

    #[cfg(windows)]
    #[test]
    fn builds_valid_utf16_double_null_cf_hdrop_hglobal() {
        use windows::Win32::Foundation::GlobalFree;
        use windows::Win32::System::Memory::{GlobalLock, GlobalSize, GlobalUnlock};
        use windows::Win32::UI::Shell::DROPFILES;

        let sample = vec![r"C:\Temp\alpha.png".to_string(), r"C:\Temp\beta.pdf".to_string()];
        let hglobal = build_cf_hdrop_hglobal(&sample).expect("allocate cf_hdrop");

        unsafe {
            let total_size = GlobalSize(hglobal);
            assert!(total_size > std::mem::size_of::<DROPFILES>());
            let ptr = GlobalLock(hglobal) as *const u8;
            assert!(!ptr.is_null());

            let df = &*(ptr as *const DROPFILES);
            let p_files = df.pFiles as usize;
            let f_wide = df.fWide.as_bool();
            assert_eq!(p_files, std::mem::size_of::<DROPFILES>());
            assert!(f_wide);

            let u16_len = (total_size - p_files) / 2;
            let slice = std::slice::from_raw_parts(ptr.add(p_files) as *const u16, u16_len);
            let decoded = String::from_utf16_lossy(slice);
            assert!(decoded.starts_with("C:\\Temp\\alpha.png\0C:\\Temp\\beta.pdf\0\0"));

            let _ = GlobalUnlock(hglobal);
            let _ = GlobalFree(Some(hglobal));
        }
    }

    #[cfg(windows)]
    const GMEM_INVALID_HANDLE: u32 = 0x8000;

    #[cfg(windows)]
    #[test]
    fn builds_valid_utf16_cf_unicodetext_hglobal() {
        use windows::Win32::Foundation::GlobalFree;
        use windows::Win32::System::Memory::{GlobalFlags, GlobalLock, GlobalSize, GlobalUnlock};

        let sample = "Halo CASA \u{1F680} https://example.com/path?a=1&b=2";
        let hglobal = build_cf_unicodetext_hglobal(sample).expect("allocate cf_unicodetext");

        unsafe {
            let flags = GlobalFlags(hglobal);
            assert_eq!(flags & GMEM_INVALID_HANDLE, 0, "HGLOBAL must be valid GMEM_MOVEABLE handle");

            let byte_size = GlobalSize(hglobal);
            let units: Vec<u16> = sample.encode_utf16().collect();
            let expected_byte_len = (units.len() + 1) * std::mem::size_of::<u16>();
            assert!(byte_size >= expected_byte_len);

            let ptr = GlobalLock(hglobal) as *const u16;
            assert!(!ptr.is_null());

            let expected_u16: Vec<u16> = sample.encode_utf16().chain(std::iter::once(0u16)).collect();
            let slice = std::slice::from_raw_parts(ptr, expected_u16.len());
            assert_eq!(slice, expected_u16.as_slice());
            assert_eq!(slice.last().copied(), Some(0u16));

            let _ = GlobalUnlock(hglobal);
            let _ = GlobalFree(Some(hglobal));
        }
    }

    #[cfg(windows)]
    #[test]
    fn rejects_empty_cf_unicodetext_hglobal() {
        assert!(build_cf_unicodetext_hglobal("").is_err());
    }

    #[test]
    fn sanitizes_transit_filename_and_blocks_traversal() {
        let sanitized = sanitize_transit_filename(r"../../evil\..\secret<1>.pdf");
        assert!(!sanitized.contains(".."));
        assert!(!sanitized.contains('/'));
        assert!(!sanitized.contains('\\'));
        assert_eq!(sanitized, "secret_1_.pdf");

        assert_eq!(sanitize_transit_filename("../../.."), "dropped-file.bin");
        assert_eq!(sanitize_transit_filename("   "), "dropped-file.bin");
    }

    #[cfg(windows)]
    #[test]
    fn chromium_text_data_object_supports_bitmask_tymed_and_triple_getdata_lifecycle() {
        use windows::Win32::Foundation::{DATA_S_SAMEFORMATETC, DV_E_FORMATETC, E_INVALIDARG, S_OK};
        use windows::Win32::System::Com::{
            DVASPECT_CONTENT, DVASPECT_THUMBNAIL, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM,
        };
        use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
        use windows::Win32::System::Memory::{GlobalFlags, GlobalLock, GlobalSize, GlobalUnlock};
        use windows::Win32::System::Ole::{
            ReleaseStgMedium, CF_LOCALE, CF_OEMTEXT, CF_TEXT, CF_UNICODETEXT,
        };
        use windows_core::w;

        let sample = "Halo WhatsApp & Chrome \u{1F680}";
        let data_obj = win32_drag::create_text_data_object(sample.to_string());
        let bitmask_tymed = (TYMED_HGLOBAL.0 | TYMED_ISTREAM.0) as u32;

        let make_fmt = |cf: u16, lindex: i32, tymed: u32, dw_aspect: u32| FORMATETC {
            cfFormat: cf,
            ptd: std::ptr::null_mut(),
            dwAspect: dw_aspect,
            lindex,
            tymed,
        };

        unsafe {
            // QueryGetData must accept Chromium's TYMED_HGLOBAL | TYMED_ISTREAM bitmask for CF_UNICODETEXT, CF_TEXT, CF_OEMTEXT, CF_LOCALE
            for &cf in &[CF_UNICODETEXT.0, CF_TEXT.0, CF_OEMTEXT.0, CF_LOCALE.0] {
                for &lindex in &[-1, 0] {
                    let fmt = make_fmt(cf, lindex, bitmask_tymed, DVASPECT_CONTENT.0);
                    assert_eq!(data_obj.QueryGetData(&fmt), S_OK);
                }
            }

            // GetCanonicalFormatEtc validation (null checks + ptd zeroing)
            let in_fmt = make_fmt(CF_UNICODETEXT.0, -1, TYMED_HGLOBAL.0 as u32, DVASPECT_CONTENT.0);
            let mut out_fmt = FORMATETC {
                ptd: 0x1 as *mut _,
                ..Default::default()
            };
            assert_eq!(
                data_obj.GetCanonicalFormatEtc(&in_fmt, std::ptr::null_mut()),
                E_INVALIDARG
            );
            assert_eq!(
                data_obj.GetCanonicalFormatEtc(std::ptr::null(), &mut out_fmt),
                E_INVALIDARG
            );
            assert_eq!(
                data_obj.GetCanonicalFormatEtc(&in_fmt, &mut out_fmt),
                DATA_S_SAMEFORMATETC
            );
            assert!(out_fmt.ptd.is_null());
            assert_eq!(out_fmt.cfFormat, CF_UNICODETEXT.0);

            // Plain text should not advertise UniformResourceLocatorW
            let url_cf = RegisterClipboardFormatW(w!("UniformResourceLocatorW")) as u16;
            if url_cf != 0 {
                let url_fmt = make_fmt(url_cf, -1, bitmask_tymed, DVASPECT_CONTENT.0);
                assert_eq!(data_obj.QueryGetData(&url_fmt), DV_E_FORMATETC);
            }

            // Reject non-content aspect and stream-only tymed
            assert_eq!(
                data_obj.QueryGetData(&make_fmt(
                    CF_UNICODETEXT.0,
                    -1,
                    bitmask_tymed,
                    DVASPECT_THUMBNAIL.0
                )),
                DV_E_FORMATETC
            );
            assert_eq!(
                data_obj.QueryGetData(&make_fmt(
                    CF_UNICODETEXT.0,
                    -1,
                    TYMED_ISTREAM.0 as u32,
                    DVASPECT_CONTENT.0
                )),
                DV_E_FORMATETC
            );

            // Call GetData 3 consecutive times (simulating DragEnter -> DragOver -> Drop) with ReleaseStgMedium each round
            let unicode_fmt = make_fmt(CF_UNICODETEXT.0, -1, bitmask_tymed, DVASPECT_CONTENT.0);
            let expected_u16: Vec<u16> = sample.encode_utf16().chain(std::iter::once(0u16)).collect();

            for cycle in 0..3 {
                let mut medium = data_obj
                    .GetData(&unicode_fmt)
                    .unwrap_or_else(|e| panic!("CF_UNICODETEXT GetData cycle {cycle} failed: {e}"));
                assert_eq!(medium.tymed, TYMED_HGLOBAL.0 as u32);
                let hglobal = medium.u.hGlobal;
                assert_eq!(GlobalFlags(hglobal) & GMEM_INVALID_HANDLE, 0);
                assert!(GlobalSize(hglobal) >= expected_u16.len() * 2);

                let ptr = GlobalLock(hglobal) as *const u16;
                assert!(!ptr.is_null(), "GlobalLock failed on cycle {cycle}");
                let slice = std::slice::from_raw_parts(ptr, expected_u16.len());
                assert_eq!(slice, expected_u16.as_slice(), "corrupted UTF-16 on cycle {cycle}");
                let _ = GlobalUnlock(hglobal);

                ReleaseStgMedium(&mut medium);
            }

            // Verify CF_TEXT and CF_OEMTEXT serve UTF-8 + NUL across calls
            let mut expected_utf8 = sample.as_bytes().to_vec();
            expected_utf8.push(0u8);
            for &cf_byte_fmt in &[CF_TEXT.0, CF_OEMTEXT.0] {
                let byte_fmt = make_fmt(cf_byte_fmt, 0, bitmask_tymed, DVASPECT_CONTENT.0);
                let mut byte_medium = data_obj.GetData(&byte_fmt).expect("CF_TEXT/CF_OEMTEXT GetData failed");
                assert_eq!(GlobalFlags(byte_medium.u.hGlobal) & GMEM_INVALID_HANDLE, 0);
                let byte_ptr = GlobalLock(byte_medium.u.hGlobal) as *const u8;
                assert!(!byte_ptr.is_null());
                let byte_slice = std::slice::from_raw_parts(byte_ptr, expected_utf8.len());
                assert_eq!(byte_slice, expected_utf8.as_slice());
                let _ = GlobalUnlock(byte_medium.u.hGlobal);
                ReleaseStgMedium(&mut byte_medium);
            }

            // Verify CF_LOCALE serves DWORD 0x0409
            let locale_fmt = make_fmt(CF_LOCALE.0, -1, bitmask_tymed, DVASPECT_CONTENT.0);
            let mut locale_medium = data_obj.GetData(&locale_fmt).expect("CF_LOCALE GetData failed");
            assert!(GlobalSize(locale_medium.u.hGlobal) >= std::mem::size_of::<u32>());
            let locale_ptr = GlobalLock(locale_medium.u.hGlobal) as *const u32;
            assert!(!locale_ptr.is_null());
            assert_eq!(*locale_ptr, 0x0409u32);
            let _ = GlobalUnlock(locale_medium.u.hGlobal);
            ReleaseStgMedium(&mut locale_medium);
        }
    }

    #[cfg(windows)]
    #[test]
    fn chromium_link_data_object_exposes_pure_text_formats_and_null_pceltfetched_enum() {
        use windows::Win32::Foundation::{DV_E_FORMATETC, E_INVALIDARG, S_FALSE, S_OK};
        use windows::Win32::System::Com::{
            DATADIR_GET, DVASPECT_CONTENT, FORMATETC, TYMED_HGLOBAL, TYMED_ISTREAM,
        };
        use windows::Win32::System::DataExchange::RegisterClipboardFormatW;
        use windows::Win32::System::Memory::{GlobalLock, GlobalUnlock};
        use windows::Win32::System::Ole::{
            ReleaseStgMedium, CF_LOCALE, CF_OEMTEXT, CF_TEXT, CF_UNICODETEXT,
        };
        use windows_core::w;

        let url = "https://casa-app.dev/drop?ref=wa";
        let data_obj = win32_drag::create_text_data_object(url.to_string());
        let bitmask_tymed = (TYMED_HGLOBAL.0 | TYMED_ISTREAM.0) as u32;

        unsafe {
            // Link payload MUST NOT expose URL/shortcut formats so Chromium/WhatsApp accept it as editable text
            for url_fmt_name in [
                w!("UniformResourceLocatorW"),
                w!("UniformResourceLocator"),
                w!("text/x-moz-url"),
            ] {
                let url_cf = RegisterClipboardFormatW(url_fmt_name) as u16;
                if url_cf != 0 {
                    let url_fmt = FORMATETC {
                        cfFormat: url_cf,
                        ptd: std::ptr::null_mut(),
                        dwAspect: DVASPECT_CONTENT.0,
                        lindex: -1,
                        tymed: bitmask_tymed,
                    };
                    assert_eq!(data_obj.QueryGetData(&url_fmt), DV_E_FORMATETC);
                    assert!(data_obj.GetData(&url_fmt).is_err());
                }
            }

            // EnumFormatEtc(DATADIR_GET) must support Next(1, &fmt, null) (Chromium pattern) without E_INVALIDARG
            let enum_fmt = data_obj
                .EnumFormatEtc(DATADIR_GET.0 as u32)
                .expect("EnumFormatEtc failed");

            let mut collected_cfs = Vec::new();
            // Calls COM vtable Next(1, &mut single, nullptr) via None
            for expected_hr in [S_OK, S_OK, S_OK, S_OK, S_FALSE] {
                let mut single = [FORMATETC::default(); 1];
                let hr = enum_fmt.Next(&mut single, None);
                assert_eq!(hr, expected_hr);
                if hr == S_OK {
                    collected_cfs.push(single[0].cfFormat);
                }
            }
            assert_eq!(
                collected_cfs,
                vec![CF_UNICODETEXT.0, CF_TEXT.0, CF_OEMTEXT.0, CF_LOCALE.0]
            );

            // Multi-element Next with null pceltFetched MUST return E_INVALIDARG per COM spec
            enum_fmt.Reset().expect("Reset failed");
            let mut two = [FORMATETC::default(); 2];
            assert_eq!(enum_fmt.Next(&mut two, None), E_INVALIDARG);

            // Clone starts at same cursor position (index 0 after Reset) and yields all 4 with pceltFetched = Some
            let cloned = enum_fmt.Clone().expect("Clone failed");
            let mut listed = [FORMATETC::default(); 6];
            let mut fetched = 0u32;
            assert_eq!(cloned.Next(&mut listed, Some(&mut fetched)), S_FALSE);
            assert_eq!(fetched, 4);

            // Verify 3 consecutive GetData(CF_UNICODETEXT) + ReleaseStgMedium cycles preserve URL intact
            let unicode_fmt = FORMATETC {
                cfFormat: CF_UNICODETEXT.0,
                ptd: std::ptr::null_mut(),
                dwAspect: DVASPECT_CONTENT.0,
                lindex: -1,
                tymed: bitmask_tymed,
            };
            let expected_u16: Vec<u16> = url.encode_utf16().chain(std::iter::once(0u16)).collect();
            for cycle in 0..3 {
                let mut medium = data_obj
                    .GetData(&unicode_fmt)
                    .unwrap_or_else(|e| panic!("URL CF_UNICODETEXT GetData cycle {cycle} failed: {e}"));
                let ptr = GlobalLock(medium.u.hGlobal) as *const u16;
                assert!(!ptr.is_null());
                let slice = std::slice::from_raw_parts(ptr, expected_u16.len());
                assert_eq!(slice, expected_u16.as_slice());
                let _ = GlobalUnlock(medium.u.hGlobal);
                ReleaseStgMedium(&mut medium);
            }
        }
    }

    #[test]
    fn reserves_unique_directory_paths_with_collision_suffix() {
        let base_dir = std::env::temp_dir().join(format!(
            "casa_drop_dir_res_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let d1 = reserve_unique_directory_path(&base_dir, "Project../Assets").expect("d1");
        let d2 = reserve_unique_directory_path(&base_dir, "Project../Assets").expect("d2");
        assert!(d1.is_dir());
        assert!(d2.is_dir());
        assert_ne!(d1, d2);
        assert!(d2.file_name().unwrap().to_string_lossy().ends_with(" (1)"));
        let _ = std::fs::remove_dir_all(&base_dir);
    }

    #[test]
    fn blocks_traversal_and_writes_safe_nested_relative_paths() {
        let temp_root = std::env::temp_dir().join(format!(
            "casa_drop_dir_safe_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        let base_drop = temp_root.join("CASA Drop");
        let target_folder = reserve_unique_directory_path(&base_drop, "TripPhotos").expect("folder");

        let safe_file =
            resolve_safe_file_inside_root(&base_drop, &target_folder, "day1/sub/note.txt")
                .expect("safe nested relative path");
        assert!(safe_file.starts_with(std::fs::canonicalize(&target_folder).unwrap()));
        assert!(safe_file.ends_with("note.txt"));

        assert!(
            resolve_safe_file_inside_root(&base_drop, &target_folder, "../escape.txt").is_err()
        );
        assert!(
            resolve_safe_file_inside_root(&base_drop, &target_folder, "C:\\Windows\\win.ini")
                .is_err()
        );
        assert!(
            resolve_safe_file_inside_root(&base_drop, &temp_root, "outside.txt").is_err()
        );

        let _ = std::fs::remove_dir_all(&temp_root);
    }

    #[test]
    fn normalize_existing_drop_paths_allows_directories_and_strips_trailing_slash() {
        let dir = std::env::temp_dir().join(format!(
            "casa_drop_dir_norm_{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        ));
        std::fs::create_dir_all(&dir).expect("create temp dir");
        let raw = dir.to_string_lossy().to_string();
        let with_trailing = format!("{}\\", raw);
        let slash_variant = with_trailing.replace('\\', "/");

        let res = normalize_existing_drop_paths(vec![with_trailing, slash_variant]);
        let _ = std::fs::remove_dir_all(&dir);

        assert_eq!(res.len(), 1);
        assert_eq!(res[0], raw);
        assert!(!res[0].ends_with('\\'));
    }

    #[test]
    fn blocks_windows_reserved_device_names_dangerous_execs_and_sensitive_asset_scopes() {
        assert_eq!(sanitize_transit_filename("CON"), "_CON");
        assert_eq!(sanitize_transit_filename("con.txt"), "_con.txt");
        assert_eq!(sanitize_transit_filename("NUL.pdf"), "_NUL.pdf");
        assert_eq!(sanitize_transit_filename("COM1.bin"), "_COM1.bin");
        assert_eq!(sanitize_transit_filename("lpt9.jpg"), "_lpt9.jpg");
        assert_eq!(sanitize_directory_name("AUX"), "_AUX");
        assert_eq!(sanitize_directory_name("COM3"), "_COM3");

        assert!(is_dangerous_executable_extension(Path::new("installer.exe")));
        assert!(is_dangerous_executable_extension(Path::new("script.ps1")));
        assert!(is_dangerous_executable_extension(Path::new("shortcut.lnk")));
        assert!(!is_dangerous_executable_extension(Path::new("photo.png")));
        assert!(!is_dangerous_executable_extension(Path::new("report.pdf")));

        assert!(is_blocked_asset_scope_path(Path::new(r"C:\")));
        assert!(is_blocked_asset_scope_path(Path::new(
            r"C:\Users\Developer\.ssh\id_rsa"
        )));
        assert!(is_blocked_asset_scope_path(Path::new(
            r"\\evil-server\share\test.png"
        )));
    }
}
