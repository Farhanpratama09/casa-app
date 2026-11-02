use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
    Position, Size, LogicalPosition, LogicalSize,
};

mod hitbox;
mod media;
mod native_audio;
mod spotify_oauth;
mod system_hardware;

/// Recalculates and sets the window's position to be precisely centered at top of the active monitor,
/// properly factoring in display DPI scale factor (100%, 125%, 150%, 200%).
/// Uses atomic Win32 SetWindowPos to eliminate intermediate frames and window center drift.
fn center_window_top(window: &tauri::WebviewWindow, target_width: Option<f64>, target_height: Option<f64>) {
    let target_w = target_width.unwrap_or(700.0).max(60.0);
    let target_h = target_height.unwrap_or(38.0).max(2.0);

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale_factor = monitor.scale_factor();
        let monitor_size = monitor.size(); // Physical size
        let monitor_pos = monitor.position(); // Physical position

        let screen_logical_width = monitor_size.width as f64 / scale_factor;
        let monitor_logical_x = monitor_pos.x as f64 / scale_factor;
        let monitor_logical_y = monitor_pos.y as f64 / scale_factor;

        let monitor_center_logical_x = monitor_logical_x + (screen_logical_width / 2.0);
        let new_logical_x = monitor_center_logical_x - (target_w / 2.0);

        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
            };
            use windows_sys::Win32::Foundation::{HWND, RECT};

            if let Ok(hwnd) = window.hwnd() {
                let hwnd_raw = hwnd.0 as HWND;
                let monitor_center_phys_x = monitor_pos.x + (monitor_size.width as i32 / 2);
                let phys_w = (target_w * scale_factor).round() as i32;
                let phys_h = (target_h * scale_factor).round() as i32;
                let new_phys_x = monitor_center_phys_x - (phys_w / 2);
                let new_phys_y = monitor_pos.y;

                unsafe {
                    let mut current_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
                    GetWindowRect(hwnd_raw, &mut current_rect);
                    if current_rect.left == new_phys_x
                        && current_rect.top == new_phys_y
                        && (current_rect.right - current_rect.left) == phys_w
                        && (current_rect.bottom - current_rect.top) == phys_h
                    {
                        return;
                    }

                    SetWindowPos(
                        hwnd_raw,
                        std::ptr::null_mut(),
                        new_phys_x,
                        new_phys_y,
                        phys_w,
                        phys_h,
                        SWP_NOACTIVATE | SWP_NOZORDER,
                    );
                }
                return;
            }
        }

        let _ = window.set_position(Position::Logical(LogicalPosition::new(new_logical_x, monitor_logical_y)));
        let _ = window.set_size(Size::Logical(LogicalSize::new(target_w, target_h)));
    } else {
        let _ = window.set_size(Size::Logical(LogicalSize::new(target_w, target_h)));
    }
}

/// Explicitly grants OS foreground keyboard focus to CASA WebView window
#[tauri::command]
fn focus_island_window(window: tauri::WebviewWindow) -> Result<(), String> {
    let _ = window.set_focus();

    #[cfg(windows)]
    {
        use windows_sys::Win32::Foundation::HWND;
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            BringWindowToTop, SetForegroundWindow,
        };

        if let Ok(hwnd) = window.hwnd() {
            let hwnd_raw = hwnd.0 as HWND;
            unsafe {
                BringWindowToTop(hwnd_raw);
                SetForegroundWindow(hwnd_raw);
            }
        }
    }

    Ok(())
}

/// Command to set ignore cursor events for smart click-through
#[tauri::command]
fn set_ignore_cursor_events(window: tauri::WebviewWindow, ignore: bool) -> Result<(), String> {
    window.set_ignore_cursor_events(ignore).map_err(|e| e.to_string())
}

/// Dynamically adjusts the native Win32 window size to accommodate expanded card widths and heights smoothly without flicker,
/// while keeping the window perfectly centered with DPI awareness.
#[tauri::command]
fn adjust_window_size(window: tauri::WebviewWindow, width: u32, height: u32) -> Result<(), String> {
    center_window_top(&window, Some(width as f64), Some(height as f64));
    Ok(())
}

/// Command to get telemetry and status
#[tauri::command]
fn get_system_metrics() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "platform": "windows",
        "cpu_usage": 0.0,
        "ram_mb": 42.5,
        "battery_pct": 88,
        "is_charging": true,
        "gaming_mode": false
    }))
}

/// Command to toggle gaming mode
#[tauri::command]
fn toggle_gaming_mode(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    let _ = app.emit("gaming-mode-changed", enabled);
    Ok(enabled)
}

#[cfg(windows)]
fn apply_win32_window_styles(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SetWindowLongPtrW, GWL_EXSTYLE, WS_EX_NOACTIVATE, WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
    };
    use windows_sys::Win32::Foundation::HWND;

    if let Ok(hwnd) = window.hwnd() {
        let hwnd_raw = hwnd.0 as HWND;
        unsafe {
            let current_ex_style = GetWindowLongPtrW(hwnd_raw, GWL_EXSTYLE);
            // CRITICAL FIX: Explicitly remove WS_EX_TRANSPARENT if present.
            // WS_EX_TRANSPARENT causes all mouse clicks to fall through and causes click deadlock.
            // WS_EX_NOACTIVATE ensures clicking the floating island does NOT steal focus.
            // WS_EX_TOOLWINDOW prevents appearing in Alt+Tab dialog.
            let stripped_style = current_ex_style & !(WS_EX_TRANSPARENT as isize);
            let new_ex_style = stripped_style | (WS_EX_NOACTIVATE as isize) | (WS_EX_TOOLWINDOW as isize);
            SetWindowLongPtrW(hwnd_raw, GWL_EXSTYLE, new_ex_style);
        }
    }
}

#[cfg(not(windows))]
fn apply_win32_window_styles(_window: &tauri::WebviewWindow) {}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Apply Win32 NOACTIVATE and TOOLWINDOW styles, stripping WS_EX_TRANSPARENT
                apply_win32_window_styles(&window);

                // Option B: Lock native window at 620x250 permanently with DPI awareness
                // Eliminates DWM swapchain ResizeBuffers hitch completely
                center_window_top(&window, Some(620.0), Some(250.0));

                let _ = window.set_ignore_cursor_events(false);
                let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));

                // Start 50Hz Hitbox Poller to dynamically toggle WS_EX_TRANSPARENT on wings
                hitbox::start_hitbox_poller(window.clone());
            }

            // Create System Tray Companion
            let show_hide = MenuItem::with_id(app, "toggle_visibility", "Tampilkan / Sembunyikan CASA", true, None::<&str>)?;
            let toggle_gaming = MenuItem::with_id(app, "toggle_gaming", "Mode Gaming: Otomatis", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Keluar", true, None::<&str>)?;
            let tray_menu = Menu::with_items(app, &[&show_hide, &toggle_gaming, &quit])?;

            let mut tray_builder = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("CASA Floating Island")
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "toggle_visibility" => {
                            if let Some(window) = app.get_webview_window("main") {
                                if window.is_visible().unwrap_or(false) {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                }
                            }
                        }
                        "toggle_gaming" => {
                            let _ = app.emit("tray-toggle-gaming", ());
                        }
                        "quit" => {
                            app.exit(0);
                        }
                        _ => {}
                    }
                });

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            let _ = tray_builder.build(app)?;

            // Start Windows GSMTC Media Telemetry Daemon
            media::windows_media::start_telemetry_daemon(app.handle().clone());

            // Start Windows Hardware Telemetry Daemon (Power, Display, CapsLock, WASAPI)
            system_hardware::start_hardware_telemetry_daemon(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hitbox::update_island_hitbox,
            set_ignore_cursor_events,
            get_system_metrics,
            toggle_gaming_mode,
            focus_island_window,
            adjust_window_size,
            media::media_play_pause,
            media::media_next_track,
            media::media_prev_track,
            media::control_media_session,
            media::quick_swap_session,
            media::seek_media_session,
            media::get_current_media,
            media::spotify_play_track,
            media::spotify_play_uri_stealth,
            media::minimize_spotify_stealth,
            media::is_spotify_running,
            media::ensure_spotify_running_silent,
            media::focus_spotify_window,
            media::launch_spotify_process_clean,
            media::quit_spotify_app,
            spotify_oauth::start_spotify_login,
            spotify_oauth::refresh_spotify_user_token,
            native_audio::search_tracks_native,
            native_audio::resolve_track_stream,
            system_hardware::get_system_telemetry,
            system_hardware::set_master_volume,
            system_hardware::toggle_audio_mute,
            system_hardware::set_display_brightness,
            system_hardware::get_audio_output_devices,
            system_hardware::set_default_audio_endpoint,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CASA application");
}
