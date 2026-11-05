use std::path::Path;
use std::process::Command;

#[derive(serde::Serialize)]
pub struct FileMetadata {
    pub exists: bool,
    pub size_bytes: u64,
    pub is_dir: bool,
}

#[tauri::command]
pub fn get_file_metadata(path: String) -> Result<FileMetadata, String> {
    let p = Path::new(&path);
    if let Ok(meta) = std::fs::metadata(p) {
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
    #[cfg(windows)]
    {
        let _ = Command::new("rundll32")
            .args(["url.dll,FileProtocolHandler", &url])
            .spawn();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = url;
        Ok(())
    }
}
