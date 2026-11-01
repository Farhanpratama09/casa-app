pub mod types;
pub mod gsmtc;
pub mod providers;

pub use types::*;
pub use gsmtc as windows_media;

#[allow(unused_imports)]
pub use providers::spotify_win32::{
    is_spotify_process_running_native,
    kill_all_spotify_processes_native,
    find_all_spotify_hwnds,
    find_all_spotify_hwnd_ids,
    get_real_spotify_binary,
    get_spotify_executable_path,
};

#[allow(dead_code)]
pub fn is_spotify_process_running() -> bool {
    is_spotify_process_running_native()
}

#[allow(dead_code)]
pub fn trigger_cold_start_minimizer() {}

// =========================================================================
// TAURI IPC COMMAND ROUTERS (Zero Breaking Changes)
// =========================================================================

#[tauri::command]
pub async fn media_play_pause() -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(800),
            tokio::task::spawn_blocking(gsmtc::control_play_pause),
        ).await {
            Ok(res) => res.unwrap_or(Ok(())),
            Err(_) => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        gsmtc::control_play_pause()
    }
}

#[tauri::command]
pub async fn media_next_track() -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(800),
            tokio::task::spawn_blocking(gsmtc::control_next),
        ).await {
            Ok(res) => res.unwrap_or(Ok(())),
            Err(_) => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        gsmtc::control_next()
    }
}

#[tauri::command]
pub async fn media_prev_track() -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(800),
            tokio::task::spawn_blocking(gsmtc::control_prev),
        ).await {
            Ok(res) => res.unwrap_or(Ok(())),
            Err(_) => Ok(()),
        }
    }
    #[cfg(not(windows))]
    {
        gsmtc::control_prev()
    }
}

#[tauri::command]
pub async fn control_media_session(session_id: String, action: String) -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(800),
            tokio::task::spawn_blocking(move || gsmtc::control_media_session_sync(&session_id, &action)),
        ).await {
            Ok(Ok(res)) => res,
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => Err("Timeout controlling media session".to_string()),
        }
    }
    #[cfg(not(windows))]
    {
        gsmtc::control_media_session_sync(&session_id, &action)
    }
}

#[tauri::command]
pub async fn quick_swap_session(target_session_id: String, pause_current: bool) -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(1200),
            tokio::task::spawn_blocking(move || gsmtc::quick_swap_session_sync(&target_session_id, pause_current)),
        ).await {
            Ok(Ok(res)) => res,
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => Err("Timeout swapping media session".to_string()),
        }
    }
    #[cfg(not(windows))]
    {
        gsmtc::quick_swap_session_sync(&target_session_id, pause_current)
    }
}

#[tauri::command]
pub async fn seek_media_session(session_id: String, position_ms: i64) -> Result<(), String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(800),
            tokio::task::spawn_blocking(move || gsmtc::seek_media_session_sync(&session_id, position_ms)),
        ).await {
            Ok(Ok(res)) => res,
            Ok(Err(e)) => Err(e.to_string()),
            Err(_) => Err("Timeout seeking media session".to_string()),
        }
    }
    #[cfg(not(windows))]
    {
        gsmtc::seek_media_session_sync(&session_id, position_ms)
    }
}

#[tauri::command]
pub async fn get_current_media() -> Result<Option<MediaUpdatePayload>, String> {
    #[cfg(windows)]
    {
        match tokio::time::timeout(
            std::time::Duration::from_millis(800),
            tokio::task::spawn_blocking(gsmtc::fetch_current_media_state),
        ).await {
            Ok(Ok(Some(state))) => {
                let is_spotify_alive = providers::spotify_win32::is_spotify_process_running_native();
                if state.is_spotify && !is_spotify_alive && !state.is_playing {
                    Ok(None)
                } else {
                    Ok(Some(state))
                }
            }
            _ => Ok(None),
        }
    }
    #[cfg(not(windows))]
    {
        Ok(None)
    }
}

#[tauri::command]
pub async fn is_spotify_running() -> Result<bool, String> {
    let running = tokio::task::spawn_blocking(providers::spotify_win32::is_spotify_process_running_native)
        .await
        .unwrap_or(false);
    Ok(running)
}

#[tauri::command]
pub async fn spotify_play_track(track_id: String) -> Result<(), String> {
    providers::spotify_win32::spotify_play_track(track_id).await
}

#[tauri::command]
pub async fn spotify_play_uri_stealth(uri: String) -> Result<(), String> {
    providers::spotify_win32::spotify_play_uri_stealth(uri).await
}

#[tauri::command]
pub fn minimize_spotify_stealth() -> Result<(), String> {
    providers::spotify_win32::minimize_spotify_stealth()
}

#[tauri::command]
pub async fn ensure_spotify_running_silent() -> Result<bool, String> {
    providers::spotify_win32::ensure_spotify_running_silent().await
}

#[tauri::command]
pub async fn focus_spotify_window() -> Result<bool, String> {
    providers::spotify_win32::focus_spotify_window().await
}

#[tauri::command]
pub async fn launch_spotify_process_clean(minimized: Option<bool>) -> Result<bool, String> {
    providers::spotify_win32::launch_spotify_process_clean(minimized).await
}

#[tauri::command]
pub async fn quit_spotify_app() -> Result<bool, String> {
    providers::spotify_win32::quit_spotify_app().await
}
