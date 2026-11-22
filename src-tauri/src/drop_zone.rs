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
        let candidate = if let Some(stripped) = replaced.strip_prefix(r"\\?\") {
            if !stripped.starts_with("UNC\\") && stripped.len() < 260 {
                stripped.to_string()
            } else {
                replaced
            }
        } else {
            replaced
        };
        if Path::new(&candidate).exists() && !normalized.contains(&candidate) {
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
    use super::{build_cf_hdrop_hglobal, is_accepted_external_drop, NativeDragDropResult};
    use std::mem::ManuallyDrop;
    use windows::Win32::Foundation::{
        DRAGDROP_S_CANCEL, DRAGDROP_S_DROP, DRAGDROP_S_USEDEFAULTCURSORS, DV_E_FORMATETC,
        E_NOTIMPL, E_OUTOFMEMORY, HWND, OLE_E_ADVISENOTSUPPORTED, POINT, S_OK,
    };
    use windows::Win32::System::Com::{
        IAdviseSink, IDataObject, IDataObject_Impl, IEnumFORMATETC, IEnumSTATDATA, DATADIR_GET,
        DVASPECT_CONTENT, FORMATETC, STGMEDIUM, STGMEDIUM_0, TYMED_HGLOBAL,
    };
    use windows::Win32::System::Ole::{
        DoDragDrop, IDropSource, IDropSource_Impl, OleInitialize, OleUninitialize, CF_HDROP,
        DROPEFFECT, DROPEFFECT_COPY, DROPEFFECT_NONE,
    };
    use windows::Win32::System::SystemServices::{MK_LBUTTON, MODIFIERKEYS_FLAGS};
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_LBUTTON, VK_RBUTTON,
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
            } else if (grfkeystate & MK_LBUTTON) == MODIFIERKEYS_FLAGS(0) {
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

    pub fn execute_drag_drop_on_sta(
        valid_paths: Vec<String>,
        main_hwnd: Option<HWND>,
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

        let data_object: IDataObject = CasaFileDataObject::new(valid_paths).into();
        let drop_source: IDropSource = CasaDropSource.into();
        let mut out_effect = DROPEFFECT_NONE;

        let hr = unsafe { DoDragDrop(&data_object, &drop_source, DROPEFFECT_COPY, &mut out_effect) };

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
            return Err("Berkas tidak ditemukan di disk atau sudah dipindahkan.".to_string());
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
}
