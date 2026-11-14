use std::path::Path;
use std::process::Command;
use tauri::Manager;

#[derive(serde::Serialize)]
pub struct FileMetadata {
    pub exists: bool,
    pub size_bytes: u64,
    pub is_dir: bool,
}

fn allow_path_in_asset_scope(app: &tauri::AppHandle, path: &Path) {
    if path.is_file() {
        let _ = app.asset_protocol_scope().allow_file(path);
    }
}

#[tauri::command]
pub fn get_file_metadata(app: tauri::AppHandle, path: String) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    if let Ok(meta) = std::fs::metadata(p) {
        if meta.is_file() {
            allow_path_in_asset_scope(&app, p);
        }
        Ok(FileMetadata {
            exists: true,
            size_bytes: meta.len(),
            is_dir: meta.is_dir(),
        })
    } else {
        Ok(FileMetadata {
            exists: false,
            size_bytes: 0,
            is_dir: false,
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
        if p.is_file() {
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

/// Menyalin berkas fisik asli ke clipboard Windows sebagai format CF_HDROP (siap Ctrl+V di Explorer, Browser, Discord, WhatsApp).
#[tauri::command]
pub fn copy_files_to_clipboard(paths: Vec<String>) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows::Win32::Foundation::{GlobalFree, HANDLE, HGLOBAL};
        use windows::Win32::System::DataExchange::{EmptyClipboard, SetClipboardData};
        use windows::Win32::System::Memory::{
            GlobalAlloc, GlobalLock, GlobalUnlock, GMEM_MOVEABLE, GMEM_ZEROINIT,
        };
        use windows::Win32::System::Ole::CF_HDROP;
        use windows::Win32::UI::Shell::DROPFILES;

        let valid_paths: Vec<String> = paths
            .into_iter()
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty() && Path::new(p).exists())
            .collect();

        if valid_paths.is_empty() {
            return Err("Berkas tidak ditemukan di disk".to_string());
        }

        let mut wide_chars: Vec<u16> = Vec::new();
        for p in &valid_paths {
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

/// Membuka dialog pilih file native Windows (multi-select) tanpa memblokir event loop UI utama.
#[tauri::command]
pub async fn pick_drop_zone_files(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    #[cfg(windows)]
    {
        let app_clone = app.clone();
        let res = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<String>, String> {
            use windows::Win32::Foundation::ERROR_CANCELLED;
            use windows::Win32::System::Com::{
                CoCreateInstance, CoInitializeEx, CoTaskMemFree, CoUninitialize,
                CLSCTX_ALL, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
            };
            use windows::Win32::UI::Shell::{
                FileOpenDialog, IFileOpenDialog, FOS_ALLOWMULTISELECT, FOS_FILEMUSTEXIST,
                FOS_PATHMUSTEXIST, SIGDN_FILESYSPATH,
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
                        .map_err(|e| format!("Gagal membuat dialog file: {}", e))?;

                if let Ok(opts) = dialog.GetOptions() {
                    let _ = dialog.SetOptions(
                        opts | FOS_ALLOWMULTISELECT | FOS_FILEMUSTEXIST | FOS_PATHMUSTEXIST,
                    );
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
                    .map_err(|e| format!("Gagal membaca pilihan berkas: {}", e))?;
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
        .map_err(|e| format!("Task dialog file gagal: {}", e))?;

        res
    }

    #[cfg(not(windows))]
    {
        let _ = app;
        Ok(Vec::new())
    }
}

/// Meluncurkan / membuka berkas langsung dengan ShellExecuteW tanpa melalui cmd.exe
/// Mencegah dialog peringatan Windows Photos ("Is this file from a trusted source?")
#[tauri::command]
pub fn launch_file_item(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::ffi::OsStr;
        use std::os::windows::ffi::OsStrExt;
        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide_path: Vec<u16> = OsStr::new(&path).encode_wide().chain(std::iter::once(0)).collect();
        let wide_open: Vec<u16> = OsStr::new("open").encode_wide().chain(std::iter::once(0)).collect();

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

/// Membuka folder dan menyorot berkas di Windows Explorer (/select,"...")
#[tauri::command]
pub fn reveal_in_folder(path: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;

        Command::new("explorer")
            .raw_arg(format!("/select,\"{}\"", path))
            .spawn()
            .map_err(|e| format!("Gagal membuka folder: {}", e))?;

        Ok(())
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
    if !trimmed.starts_with("https://") && !trimmed.starts_with("http://") {
        return Err("Only http:// or https:// URLs are allowed.".to_string());
    }
    #[cfg(windows)]
    {
        Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", trimmed])
            .spawn()
            .map_err(|e| format!("Failed to open URL: {e}"))?;
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = trimmed;
        Ok(())
    }
}
