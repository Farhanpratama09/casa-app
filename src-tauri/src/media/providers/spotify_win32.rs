#[cfg(windows)]
#[link(name = "kernel32")]
extern "system" {
    fn GetConsoleWindow() -> windows_sys::Win32::Foundation::HWND;
}

#[cfg(windows)]
unsafe fn is_spotify_hwnd(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::GetWindowThreadProcessId;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
    };
    use windows_sys::Win32::Foundation::CloseHandle;

    let mut pid: u32 = 0;
    GetWindowThreadProcessId(hwnd, &mut pid);
    if pid == 0 || pid == std::process::id() {
        return false;
    }

    let h_process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
    if h_process.is_null() {
        return false;
    }

    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    let res = QueryFullProcessImageNameW(h_process, 0, buf.as_mut_ptr(), &mut size);
    CloseHandle(h_process);

    if res != 0 && size > 0 {
        let path = String::from_utf16_lossy(&buf[..size as usize]);
        let lower = path.to_lowercase();
        // Haramkan terminal / konsol process image
        if lower.ends_with("cmd.exe")
            || lower.ends_with("conhost.exe")
            || lower.ends_with("powershell.exe")
            || lower.ends_with("windowsterminal.exe")
            || lower.ends_with("wt.exe")
        {
            return false;
        }
        lower.ends_with("spotify.exe")
    } else {
        false
    }
}

#[cfg(windows)]
unsafe fn is_spotify_main_window(hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetClassNameW, GetWindowRect, GetParent, GetWindowTextLengthW, GetWindowTextW,
        IsIconic, IsWindowVisible, GetWindowPlacement, WINDOWPLACEMENT,
    };
    use windows_sys::Win32::Foundation::RECT;

    // 1. Blacklist HWND konsol aktif sistem
    let console_hwnd = GetConsoleWindow();
    if !console_hwnd.is_null() && hwnd == console_hwnd {
        return false;
    }

    // 2. Wajib top-level window (tanpa parent)
    let parent = GetParent(hwnd);
    if !parent.is_null() {
        return false;
    }

    // 3. Kunci Status Visibilitas:
    // Jendela yang sah HANYA boleh berupa jendela yang sedang aktif tampil (IsWindowVisible)
    // ATAU jendela yang memang sedang terminimalkan (IsIconic).
    // Tolak keras dummy / helper off-screen window yang tersembunyi.
    let is_visible = IsWindowVisible(hwnd) != 0;
    let is_iconic = IsIconic(hwnd) != 0;
    if !is_visible && !is_iconic {
        return false;
    }

    // 4. Wajibkan Validasi Judul Jendela (Title Length Guard):
    // Jendela utama UI Spotify SELALU memiliki judul teks ("Spotify", "Spotify Premium", "Artis - Judul").
    // Jendela siluman/helper Chromium SELALU memiliki judul KOSONG ("").
    let title_len = GetWindowTextLengthW(hwnd);
    if title_len == 0 {
        return false; // Tolak helper window tanpa judul!
    }

    let mut title_buf = [0u16; 256];
    let actual_len = GetWindowTextW(hwnd, title_buf.as_mut_ptr(), title_buf.len() as i32);
    if actual_len <= 0 {
        return false;
    }
    let title_str = String::from_utf16_lossy(&title_buf[..actual_len as usize]);
    if title_str.trim().is_empty() {
        return false;
    }

    // 5. Blacklist ketat kelas konsol dan terminal
    let mut class_buf = [0u16; 256];
    let class_len = GetClassNameW(hwnd, class_buf.as_mut_ptr(), class_buf.len() as i32);
    let class_name = if class_len > 0 {
        String::from_utf16_lossy(&class_buf[..class_len as usize])
    } else {
        String::new()
    };

    if class_name == "ConsoleWindowClass"
        || class_name == "CASCADIA_HOSTING_WINDOW_CLASS"
        || class_name.contains("Console")
        || class_name.contains("Terminal")
    {
        return false;
    }

    // Whitelist: Spotify desktop UI window menggunakan kelas Chrome_WidgetWin_1, Chrome_WidgetWin_0, atau SpotifyMainWindow
    let is_valid_class = class_name.starts_with("Chrome_WidgetWin_")
        || class_name == "SpotifyMainWindow";
    if !is_valid_class {
        return false;
    }

    // 6. Verifikasi proses pemilik HWND (wajib Spotify.exe)
    if !is_spotify_hwnd(hwnd) {
        return false;
    }

    // 7. Validasi ukuran jendela fisik / normal placement (tolak CEF background helper 0x0)
    let mut placement: WINDOWPLACEMENT = std::mem::zeroed();
    placement.length = std::mem::size_of::<WINDOWPLACEMENT>() as u32;
    let has_placement = GetWindowPlacement(hwnd, &mut placement) != 0;
    let norm_w = if has_placement {
        placement.rcNormalPosition.right - placement.rcNormalPosition.left
    } else {
        0
    };
    let norm_h = if has_placement {
        placement.rcNormalPosition.bottom - placement.rcNormalPosition.top
    } else {
        0
    };

    if is_iconic {
        // Minimized Spotify window dikenali dari ukuran normal saat di-restore
        return norm_w > 300 && norm_h > 300;
    }

    let mut rect: RECT = std::mem::zeroed();
    let has_rect = GetWindowRect(hwnd, &mut rect) != 0;
    let w = if has_rect { rect.right - rect.left } else { 0 };
    let h = if has_rect { rect.bottom - rect.top } else { 0 };

    if (w > 300 && h > 300) || (norm_w > 300 && norm_h > 300) {
        return true;
    }

    false
}

#[cfg(windows)]
unsafe extern "system" fn enum_windows_callback(
    hwnd: windows_sys::Win32::Foundation::HWND,
    lparam: windows_sys::Win32::Foundation::LPARAM,
) -> windows_sys::Win32::Foundation::BOOL {
    let list = &mut *(lparam as *mut Vec<windows_sys::Win32::Foundation::HWND>);
    if is_spotify_main_window(hwnd) {
        list.push(hwnd);
    }
    1
}

#[cfg(windows)]
pub fn find_all_spotify_hwnds() -> Vec<windows_sys::Win32::Foundation::HWND> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{EnumWindows, GetWindowRect};
    use windows_sys::Win32::Foundation::RECT;

    let mut hwnds: Vec<windows_sys::Win32::Foundation::HWND> = Vec::new();
    unsafe {
        EnumWindows(Some(enum_windows_callback), &mut hwnds as *mut _ as isize);
    }

    // Sort by visible/placed area descending so the primary UI window is strictly at index 0
    hwnds.sort_by(|&a, &b| unsafe {
        let mut ra: RECT = std::mem::zeroed();
        let mut rb: RECT = std::mem::zeroed();
        let _ = GetWindowRect(a, &mut ra);
        let _ = GetWindowRect(b, &mut rb);
        let area_a = (ra.right - ra.left).max(0) * (ra.bottom - ra.top).max(0);
        let area_b = (rb.right - rb.left).max(0) * (rb.bottom - rb.top).max(0);
        area_b.cmp(&area_a)
    });

    hwnds
}

#[cfg(windows)]
pub fn find_all_spotify_hwnd_ids() -> Vec<isize> {
    find_all_spotify_hwnds().into_iter().map(|h| h as isize).collect()
}

#[cfg(not(windows))]
pub fn find_all_spotify_hwnds() -> Vec<isize> {
    Vec::new()
}

#[cfg(not(windows))]
pub fn find_all_spotify_hwnd_ids() -> Vec<isize> {
    Vec::new()
}

/// Ultra-fast native Win32 process check via CreateToolhelp32Snapshot (< 1ms, zero CLI spawn)
#[cfg(windows)]
pub fn is_spotify_process_running_native() -> bool {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
        PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
            return false;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut found = false;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if exe_name.eq_ignore_ascii_case("spotify.exe") {
                    found = true;
                    break;
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
        found
    }
}

/// Native Win32 termination of all Spotify.exe processes directly in-process.
/// Completely silent, zero CLI subprocess, zero conhost.
#[cfg(windows)]
pub fn kill_all_spotify_processes_native() -> bool {
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW,
        PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::System::Threading::{OpenProcess, TerminateProcess, PROCESS_TERMINATE};
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};

    unsafe {
        let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if snapshot == INVALID_HANDLE_VALUE || snapshot.is_null() {
            return false;
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

        let mut any_killed = false;
        if Process32FirstW(snapshot, &mut entry) != 0 {
            loop {
                let len = entry.szExeFile.iter().position(|&c| c == 0).unwrap_or(entry.szExeFile.len());
                let exe_name = String::from_utf16_lossy(&entry.szExeFile[..len]);
                if exe_name.eq_ignore_ascii_case("spotify.exe") {
                    let h_proc = OpenProcess(PROCESS_TERMINATE, 0, entry.th32ProcessID);
                    if !h_proc.is_null() {
                        if TerminateProcess(h_proc, 1) != 0 {
                            any_killed = true;
                        }
                        CloseHandle(h_proc);
                    }
                }
                if Process32NextW(snapshot, &mut entry) == 0 {
                    break;
                }
            }
        }

        CloseHandle(snapshot);
        any_killed
    }
}

#[cfg(not(windows))]
pub fn kill_all_spotify_processes_native() -> bool {
    false
}

#[cfg(not(windows))]
pub fn is_spotify_process_running_native() -> bool {
    false
}

#[cfg(windows)]
pub fn get_real_spotify_binary() -> Option<std::path::PathBuf> {
    let check = |p: std::path::PathBuf| -> Option<std::path::PathBuf> {
        if p.exists() {
            if let Ok(meta) = std::fs::metadata(&p) {
                if meta.len() > 0 {
                    return Some(p);
                }
            }
        }
        None
    };

    if let Ok(appdata) = std::env::var("APPDATA") {
        if let Some(p) = check(std::path::PathBuf::from(appdata).join("Spotify").join("Spotify.exe")) {
            return Some(p);
        }
    }
    if let Ok(localappdata) = std::env::var("LOCALAPPDATA") {
        if let Some(p) = check(std::path::PathBuf::from(&localappdata).join("Spotify").join("Spotify.exe")) {
            return Some(p);
        }
    }
    if let Ok(progfiles) = std::env::var("ProgramFiles") {
        if let Some(p) = check(std::path::PathBuf::from(progfiles).join("Spotify").join("Spotify.exe")) {
            return Some(p);
        }
    }
    if let Ok(progfiles_x86) = std::env::var("ProgramFiles(x86)") {
        if let Some(p) = check(std::path::PathBuf::from(progfiles_x86).join("Spotify").join("Spotify.exe")) {
            return Some(p);
        }
    }
    if let Ok(path_var) = std::env::var("PATH") {
        for entry in std::env::split_paths(&path_var) {
            let candidate = entry.join("Spotify.exe");
            if let Some(p) = check(candidate) {
                return Some(p);
            }
        }
    }
    None
}

#[cfg(windows)]
#[allow(dead_code)]
pub fn get_spotify_executable_path() -> std::path::PathBuf {
    if let Some(real_bin) = get_real_spotify_binary() {
        return real_bin;
    }
    std::path::PathBuf::from("Spotify.exe")
}

#[cfg(windows)]
#[allow(dead_code)]
unsafe fn is_spotify_frontmost(target_hwnd: windows_sys::Win32::Foundation::HWND) -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetTopWindow, GetWindow, IsWindowVisible, IsIconic,
        GW_HWNDNEXT, GetWindowThreadProcessId, GetWindowRect,
    };
    use windows_sys::Win32::Foundation::RECT;

    // Jendela yang sedang terminimalkan atau tidak terlihat tidak pernah berstatus aktif di depan
    if IsIconic(target_hwnd) != 0 || IsWindowVisible(target_hwnd) == 0 {
        return false;
    }

    let foreground = GetForegroundWindow();
    if foreground == target_hwnd {
        return true;
    }

    // When CASA Island is clicked, CASA's process or child WebView2 may become foreground.
    // In that case, check if Spotify is the top visible non-CASA application window in the Z-order.
    let mut fg_pid: u32 = 0;
    GetWindowThreadProcessId(foreground, &mut fg_pid);
    let current_pid = std::process::id();

    // If another non-CASA application (e.g. Chrome, VS Code) has foreground focus,
    // then Spotify is not the frontmost window.
    if fg_pid != current_pid && foreground != target_hwnd {
        return false;
    }

    // Traverse top-level windows in Z-order
    let mut curr = GetTopWindow(std::ptr::null_mut());
    while !curr.is_null() {
        if curr == target_hwnd {
            return true;
        }

        let mut win_pid: u32 = 0;
        GetWindowThreadProcessId(curr, &mut win_pid);

        // Skip CASA process windows
        if win_pid == current_pid {
            curr = GetWindow(curr, GW_HWNDNEXT);
            continue;
        }

        // Check if this window is a visible, non-minimized top-level desktop window
        if IsWindowVisible(curr) != 0 && IsIconic(curr) == 0 {
            let mut rect: RECT = std::mem::zeroed();
            if GetWindowRect(curr, &mut rect) != 0 {
                let w = rect.right - rect.left;
                let h = rect.bottom - rect.top;
                // Exclude tiny overlays, tooltip windows, and shell tray (< 150x150)
                if w > 150 && h > 150 {
                    // Another normal window is above Spotify in the Z-order
                    return false;
                }
            }
        }

        curr = GetWindow(curr, GW_HWNDNEXT);
    }

    false
}

/// Brings the Spotify desktop window to the foreground, or closes it to system tray if already open on screen.
/// If Spotify is not running or no HWND found, cleanly auto-revives Spotify.
pub async fn focus_spotify_window() -> Result<bool, String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            ShowWindow, SetForegroundWindow, BringWindowToTop,
            PostMessageW, SW_MINIMIZE, SW_RESTORE, WM_SYSCOMMAND, WM_CLOSE,
            IsWindowVisible, IsIconic,
            GetWindowThreadProcessId,
        };
        use windows_sys::Win32::System::Threading::GetCurrentThreadId;

        #[link(name = "user32")]
        extern "system" {
            fn AttachThreadInput(id_attach: u32, id_attach_to: u32, f_attach: i32) -> i32;
        }

        // 1. Process validation: If Spotify is not running, cleanly auto-revive it!
        let is_running = tokio::task::spawn_blocking(is_spotify_process_running_native)
            .await
            .unwrap_or(false);

        if !is_running {
            return launch_spotify_process_clean(Some(false)).await;
        }

        // 2. Locate Spotify primary UI HWND
        let hwnd_ids = tokio::task::spawn_blocking(find_all_spotify_hwnd_ids)
            .await
            .unwrap_or_default();

        let target_hwnd_id: isize = if !hwnd_ids.is_empty() {
            hwnd_ids[0]
        } else {
            0
        };

        let target_hwnd = target_hwnd_id as windows_sys::Win32::Foundation::HWND;

        // Periksa apakah jendela utama Spotify sedang tampil nyata di layar
        let is_open_on_screen = unsafe {
            target_hwnd_id != 0
                && IsWindowVisible(target_hwnd) != 0
                && IsIconic(target_hwnd) == 0
        };

        if is_open_on_screen {
            // 1. Jika Spotify sedang terbuka di layar:
            // Kirim WM_CLOSE dan SC_CLOSE agar Spotify sembunyi ke system tray sesuai preferensi user
            unsafe {
                const SC_CLOSE: usize = 0xF060;
                PostMessageW(target_hwnd, WM_SYSCOMMAND, SC_CLOSE, 0);
                PostMessageW(target_hwnd, WM_CLOSE, 0, 0);
            }
            std::thread::sleep(std::time::Duration::from_millis(50));
            unsafe {
                // Jaminan 100% tertutup: fallback SW_MINIMIZE jika setelah 50ms jendela masih terlihat di layar
                if IsWindowVisible(target_hwnd) != 0 && IsIconic(target_hwnd) == 0 {
                    ShowWindow(target_hwnd, SW_MINIMIZE);
                }
            }
        } else {
            // 2. Jika Spotify sedang di tray / diminimalkan / di belakang:
            // Bangunkan dan bawa kembali ke depan
            if !target_hwnd.is_null() && unsafe { IsWindowVisible(target_hwnd) != 0 } {
                unsafe {
                    let current_thread_id = GetCurrentThreadId();
                    let target_thread_id = GetWindowThreadProcessId(target_hwnd, std::ptr::null_mut());
                    let attached = if current_thread_id != target_thread_id {
                        AttachThreadInput(current_thread_id, target_thread_id, 1) != 0
                    } else {
                        false
                    };

                    // Asynchronously awaken Chromium / CEF message loop via SC_RESTORE
                    const SC_RESTORE: usize = 0xF120;
                    PostMessageW(target_hwnd, WM_SYSCOMMAND, SC_RESTORE, 0);

                    ShowWindow(target_hwnd, SW_RESTORE);
                    BringWindowToTop(target_hwnd);
                    SetForegroundWindow(target_hwnd);

                    if attached {
                        AttachThreadInput(current_thread_id, target_thread_id, 0);
                    }
                }
            } else {
                // Jika jendela disembunyikan total ke tray oleh Spotify atau belum ada HWND valid,
                // trigger via protokol shell
                return launch_spotify_process_clean(Some(false)).await;
            }
        }

        Ok(true)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// Cleanly launches the Spotify desktop client directly via Win32 ShellExecuteW with URI "spotify:".
/// Completely silent, zero child processes, zero CMD / conhost windows.
pub async fn launch_spotify_process_clean(minimized: Option<bool>) -> Result<bool, String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(move || {
            use windows_sys::Win32::UI::Shell::ShellExecuteW;
            use windows_sys::Win32::UI::WindowsAndMessaging::{SW_SHOWMINNOACTIVE, SW_SHOWNORMAL};

            unsafe {
                let op: Vec<u16> = "open\0".encode_utf16().collect();
                let file: Vec<u16> = "spotify:\0".encode_utf16().collect();
                let show_cmd = if minimized.unwrap_or(false) {
                    SW_SHOWMINNOACTIVE
                } else {
                    SW_SHOWNORMAL
                };
                let res = ShellExecuteW(
                    std::ptr::null_mut(),
                    op.as_ptr(),
                    file.as_ptr(),
                    std::ptr::null(),
                    std::ptr::null(),
                    show_cmd,
                );
                if res as usize > 32 {
                    Ok(true)
                } else {
                    Err(format!("ShellExecuteW failed to open spotify: with error code: {}", res as usize))
                }
            }
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        let _ = minimized;
        Ok(false)
    }
}

/// Quits all running instances of the Spotify desktop app completely and cleanly via Win32 API.
pub async fn quit_spotify_app() -> Result<bool, String> {
    #[cfg(windows)]
    {
        tokio::task::spawn_blocking(|| {
            let killed = kill_all_spotify_processes_native();
            Ok(killed)
        })
        .await
        .map_err(|e| e.to_string())?
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

/// Plays track via Spotify URI directly via Win32 ShellExecuteW without spawning conhost or cmd.
pub async fn spotify_play_track(track_id: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        let is_running = tokio::task::spawn_blocking(is_spotify_process_running_native)
            .await
            .unwrap_or(false);

        if !is_running {
            return Ok(());
        }

        let uri = if track_id.starts_with("spotify:") {
            track_id
        } else {
            format!("spotify:track:{}", track_id)
        };

        use windows_sys::Win32::UI::Shell::ShellExecuteW;
        use windows_sys::Win32::UI::WindowsAndMessaging::SW_SHOWMINNOACTIVE;

        unsafe {
            let op: Vec<u16> = "open\0".encode_utf16().collect();
            let file: Vec<u16> = format!("{}\0", uri).encode_utf16().collect();
            ShellExecuteW(
                std::ptr::null_mut(),
                op.as_ptr(),
                file.as_ptr(),
                std::ptr::null(),
                std::ptr::null(),
                SW_SHOWMINNOACTIVE,
            );
        }

        let _ = minimize_spotify_stealth();
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = track_id;
        Ok(())
    }
}

pub async fn spotify_play_uri_stealth(uri: String) -> Result<(), String> {
    spotify_play_track(uri).await
}

pub fn minimize_spotify_stealth() -> Result<(), String> {
    #[cfg(windows)]
    {
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            ShowWindow, SW_SHOWMINNOACTIVE,
        };
        let hwnds = find_all_spotify_hwnds();
        for hwnd in hwnds {
            unsafe {
                ShowWindow(hwnd, SW_SHOWMINNOACTIVE);
            }
        }
    }
    Ok(())
}

pub async fn ensure_spotify_running_silent() -> Result<bool, String> {
    #[cfg(windows)]
    {
        let is_running = tokio::task::spawn_blocking(is_spotify_process_running_native)
            .await
            .unwrap_or(false);
        Ok(is_running)
    }
    #[cfg(not(windows))]
    {
        Ok(false)
    }
}

