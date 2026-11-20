use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{
    menu::{Menu, MenuItem},
    tray::TrayIconBuilder,
    Emitter, Manager,
    Position, Size, LogicalPosition, LogicalSize,
};

mod drop_zone;
mod hitbox;
mod media;
mod native_audio;
mod prayer;
mod spotify_oauth;
mod system_hardware;
mod system_stats;
mod update_monitor;

static SHORTCUT_ALT_SPACE_REGISTERED: AtomicBool = AtomicBool::new(false);

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AppUpdateCheckResult {
    current_version: String,
    available: bool,
    version: Option<String>,
    body: Option<String>,
    date: Option<String>,
    status_kind: String,
    message: String,
}

/// Recalculates and sets the window's position at the top of the active monitor (`left` | `center` | `right`),
/// properly factoring in display DPI scale factor (100%, 125%, 150%, 200%).
/// Uses atomic Win32 SetWindowPos to eliminate intermediate frames and window drift.
fn position_window_top(
    window: &tauri::WebviewWindow,
    target_width: Option<f64>,
    target_height: Option<f64>,
    align: &str,
) {
    let target_w = target_width.unwrap_or(700.0).max(60.0);
    let target_h = target_height.unwrap_or(38.0).max(2.0);

    if let Ok(Some(monitor)) = window.current_monitor() {
        let scale_factor = monitor.scale_factor();
        let monitor_size = monitor.size(); // Physical size
        let monitor_pos = monitor.position(); // Physical position

        let screen_logical_width = monitor_size.width as f64 / scale_factor;
        let monitor_logical_x = monitor_pos.x as f64 / scale_factor;
        let monitor_logical_y = monitor_pos.y as f64 / scale_factor;

        let new_logical_x = match align {
            "left" => monitor_logical_x,
            "right" => (monitor_logical_x + screen_logical_width - target_w).max(monitor_logical_x),
            _ => monitor_logical_x + (screen_logical_width / 2.0) - (target_w / 2.0),
        };

        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::WindowsAndMessaging::{
                GetWindowRect, SetWindowPos, SWP_NOACTIVATE, SWP_NOZORDER,
            };
            use windows_sys::Win32::Foundation::{HWND, RECT};

            if let Ok(hwnd) = window.hwnd() {
                let hwnd_raw = hwnd.0 as HWND;
                let phys_w = (target_w * scale_factor).round() as i32;
                let phys_h = (target_h * scale_factor).round() as i32;
                let new_phys_x = match align {
                    "left" => monitor_pos.x,
                    "right" => (monitor_pos.x + monitor_size.width as i32 - phys_w).max(monitor_pos.x),
                    _ => monitor_pos.x + (monitor_size.width as i32 / 2) - (phys_w / 2),
                };
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

fn center_window_top(window: &tauri::WebviewWindow, target_width: Option<f64>, target_height: Option<f64>) {
    position_window_top(window, target_width, target_height, "center");
}

#[tauri::command]
fn align_window_top(window: tauri::WebviewWindow, align: String) {
    let norm = match align.as_str() {
        "left" => "left",
        "right" => "right",
        _ => "center",
    };
    position_window_top(&window, Some(1100.0), Some(340.0), norm);
}

#[tauri::command]
fn set_window_visibility(window: tauri::WebviewWindow, visible: bool) {
    if visible {
        let _ = window.show();
        apply_win32_window_styles(&window);
        let _ = window.set_always_on_top(true);
    } else {
        let _ = window.hide();
    }
}

#[tauri::command]
fn get_global_shortcut_status() -> bool {
    SHORTCUT_ALT_SPACE_REGISTERED.load(Ordering::Relaxed)
}

#[tauri::command]
fn get_autostart_enabled(app: tauri::AppHandle) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("Gagal membaca status Auto-Start: {e}"))
}

#[tauri::command]
fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<bool, String> {
    use tauri_plugin_autostart::ManagerExt;
    let manager = app.autolaunch();
    if enabled {
        manager
            .enable()
            .map_err(|e| format!("Gagal mengaktifkan Auto-Start: {e}"))?;
    } else {
        manager
            .disable()
            .map_err(|e| format!("Gagal menonaktifkan Auto-Start: {e}"))?;
    }
    manager
        .is_enabled()
        .map_err(|e| format!("Gagal memverifikasi status Auto-Start: {e}"))
}

#[tauri::command]
async fn check_app_update(app: tauri::AppHandle) -> Result<AppUpdateCheckResult, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current_version = app.package_info().version.to_string();
    let updater = match app.updater() {
        Ok(u) => u,
        Err(e) => {
            return Ok(AppUpdateCheckResult {
                current_version,
                available: false,
                version: None,
                body: None,
                date: None,
                status_kind: "error".to_string(),
                message: format!("Updater belum siap: {e}"),
            });
        }
    };

    match updater.check().await {
        Ok(Some(update)) => Ok(AppUpdateCheckResult {
            current_version,
            available: true,
            version: Some(update.version.clone()),
            body: update.body.clone(),
            date: update.date.map(|d| d.to_string()),
            status_kind: "available".to_string(),
            message: format!("Versi baru v{} tersedia", update.version),
        }),
        Ok(None) => Ok(AppUpdateCheckResult {
            current_version,
            available: false,
            version: None,
            body: None,
            date: None,
            status_kind: "up-to-date".to_string(),
            message: "CASA sudah menggunakan versi terbaru.".to_string(),
        }),
        Err(err) => {
            let msg = err.to_string();
            let lower = msg.to_lowercase();
            let (status_kind, friendly) = if lower.contains("404")
                || lower.contains("not found")
                || lower.contains("release")
            {
                (
                    "offline",
                    "Belum ada rilis publik terbaru di GitHub (latest.json belum tersedia).",
                )
            } else if lower.contains("error sending request")
                || lower.contains("dns")
                || lower.contains("timeout")
                || lower.contains("connect")
                || lower.contains("network")
            {
                (
                    "offline",
                    "Offline: tidak dapat menjangkau GitHub Releases saat ini.",
                )
            } else {
                ("error", "Gagal memeriksa pembaruan dari GitHub.")
            };
            Ok(AppUpdateCheckResult {
                current_version,
                available: false,
                version: None,
                body: Some(msg),
                date: None,
                status_kind: status_kind.to_string(),
                message: friendly.to_string(),
            })
        }
    }
}

#[tauri::command]
async fn install_app_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|e| format!("Updater belum siap: {e}"))?;
    let Some(update) = updater
        .check()
        .await
        .map_err(|e| format!("Gagal mengecek rilis pembaruan: {e}"))?
    else {
        return Err("Tidak ada pembaruan yang tersedia saat ini.".to_string());
    };

    let app_for_progress = app.clone();
    let app_for_finish = app.clone();
    update
        .download_and_install(
            move |chunk_length, content_length| {
                let _ = app_for_progress.emit(
                    "casa://updater-progress",
                    serde_json::json!({
                        "chunkLength": chunk_length,
                        "contentLength": content_length,
                    }),
                );
            },
            move || {
                let _ = app_for_finish.emit("casa://updater-finished", ());
            },
        )
        .await
        .map_err(|e| format!("Gagal mengunduh/memasang pembaruan: {e}"))?;

    Ok(())
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

/// Command to cleanly terminate the application and unregister global shortcuts
#[tauri::command]
fn quit_app(app: tauri::AppHandle) {
    #[cfg(desktop)]
    {
        use tauri_plugin_global_shortcut::GlobalShortcutExt;
        let _ = app.global_shortcut().unregister_all();
    }
    app.exit(0);
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
        .manage(system_stats::SystemStatsState::new())
        .manage(update_monitor::UpdateMonitorState::default())
        .plugin(tauri_plugin_drag::init())
        .plugin(tauri_plugin_process::init())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::Focused(true) = event {
                let app_handle = window.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    update_monitor::run_silent_update_check(&app_handle, false).await;
                });
            }
        })
        .setup(|app| {
            if let Some(window) = app.get_webview_window("main") {
                // Apply Win32 NOACTIVATE and TOOLWINDOW styles, stripping WS_EX_TRANSPARENT
                apply_win32_window_styles(&window);

                // Lock native window at 1100x340 permanently with DPI awareness
                // Accommodates 640px Mode 6 + detached Left/Right Floating Satellite Pods (204px each) without clipping
                // Eliminates DWM swapchain ResizeBuffers hitch completely
                center_window_top(&window, Some(1100.0), Some(340.0));

                let _ = window.set_ignore_cursor_events(false);
                let _ = window.set_background_color(Some(tauri::webview::Color(0, 0, 0, 0)));

                // Start 50Hz Hitbox Poller to dynamically toggle WS_EX_TRANSPARENT on wings
                hitbox::start_hitbox_poller(window.clone());
            }

            // Initialize Windows Auto-Start & GitHub Updater plugins safely without panicking
            #[cfg(desktop)]
            {
                if let Err(err) = app.handle().plugin(tauri_plugin_autostart::init(
                    tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                    None,
                )) {
                    eprintln!("[CASA WARN] Failed to initialize autostart plugin: {}", err);
                }
                if let Err(err) = app.handle().plugin(tauri_plugin_updater::Builder::new().build()) {
                    eprintln!("[CASA WARN] Failed to initialize updater plugin: {}", err);
                }
            }

            // Register Global Shortcut Alt+Space safely (warn without panicking on third-party conflict)
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };
                let alt_space = Shortcut::new(Some(Modifiers::ALT), Code::Space);
                match app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app_handle, shortcut, event| {
                            if event.state == ShortcutState::Pressed && shortcut == &alt_space {
                                if let Some(main_win) = app_handle.get_webview_window("main") {
                                    let _ = main_win.emit("casa://toggle-island", ());
                                } else {
                                    let _ = app_handle.emit("casa://toggle-island", ());
                                }
                            }
                        })
                        .build(),
                ) {
                    Ok(()) => match app.global_shortcut().register(alt_space) {
                        Ok(()) => {
                            SHORTCUT_ALT_SPACE_REGISTERED.store(true, Ordering::Relaxed);
                            println!("[CASA] Global shortcut Alt+Space registered successfully");
                        }
                        Err(err) => {
                            SHORTCUT_ALT_SPACE_REGISTERED.store(false, Ordering::Relaxed);
                            eprintln!(
                                "[CASA WARN] Failed to register Alt+Space global shortcut (possible conflict): {}",
                                err
                            );
                        }
                    },
                    Err(err) => {
                        SHORTCUT_ALT_SPACE_REGISTERED.store(false, Ordering::Relaxed);
                        eprintln!(
                            "[CASA WARN] Failed to initialize global-shortcut plugin: {}",
                            err
                        );
                    }
                }
            }

            // Create System Tray Companion
            let show_hide = MenuItem::with_id(app, "toggle_visibility", "Show / Hide CASA", true, None::<&str>)?;
            let toggle_gaming = MenuItem::with_id(app, "toggle_gaming", "Gaming Mode: Auto", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Quit CASA", true, None::<&str>)?;
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
                            #[cfg(desktop)]
                            {
                                use tauri_plugin_global_shortcut::GlobalShortcutExt;
                                let _ = app.global_shortcut().unregister_all();
                            }
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

            // Start Lightweight ETag Background Update Notifier (5s after launch, focus/wake, and 45m interval)
            update_monitor::spawn_background_update_monitor(app.handle().clone());

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            hitbox::update_island_hitbox,
            hitbox::update_island_hitboxes,
            hitbox::set_island_pinned,
            set_ignore_cursor_events,
            get_system_metrics,
            toggle_gaming_mode,
            quit_app,
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
            system_stats::get_system_telemetry,
            system_hardware::get_hardware_telemetry,
            system_hardware::set_master_volume,
            system_hardware::toggle_audio_mute,
            system_hardware::set_display_brightness,
            system_hardware::set_stay_awake,
            system_hardware::get_stay_awake,
            system_hardware::get_radio_states,
            system_hardware::toggle_wifi,
            system_hardware::toggle_bluetooth,
            system_hardware::scan_wifi_networks,
            system_hardware::connect_wifi_network,
            system_hardware::list_paired_bluetooth,
            system_hardware::toggle_bluetooth_device,
            system_hardware::get_audio_output_devices,
            system_hardware::set_default_audio_endpoint,
            drop_zone::get_file_metadata,
            drop_zone::register_drop_zone_files,
            drop_zone::read_clipboard_text,
            drop_zone::read_clipboard_files,
            drop_zone::save_clipboard_image,
            drop_zone::copy_files_to_clipboard,
            drop_zone::pick_drop_zone_files,
            drop_zone::launch_file_item,
            drop_zone::reveal_in_folder,
            drop_zone::open_file_item,
            drop_zone::open_url_item,
            align_window_top,
            set_window_visibility,
            get_global_shortcut_status,
            get_autostart_enabled,
            set_autostart_enabled,
            check_app_update,
            install_app_update,
            update_monitor::get_update_notification_status,
            update_monitor::trigger_background_update_check,
            update_monitor::dismiss_update_badge,
            update_monitor::clear_update_notification,
            prayer::get_prayer_times,
            prayer::detect_windows_location,
            prayer::search_prayer_city,
            prayer::open_windows_location_settings,
        ])
        .run(tauri::generate_context!())
        .expect("error while running CASA application");
}
