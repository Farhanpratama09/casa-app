use super::types::{MediaSessionSummary, MediaUpdatePayload};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

/// Pure-Rust RFC 1321 MD5 implementation for deterministic session_id hashing:
/// hash(format!("{}_{}", aumid, title))
pub fn compute_md5_hex(input: &str) -> String {
    const S: [u32; 64] = [
        7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
        5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
        4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
        6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
    ];
    const K: [u32; 64] = [
        0xd76aa478, 0xe8c7b756, 0x242070db, 0xc1bdceee,
        0xf57c0faf, 0x4787c62a, 0xa8304613, 0xfd469501,
        0x698098d8, 0x8b44f7af, 0xffff5bb1, 0x895cd7be,
        0x6b901122, 0xfd987193, 0xa679438e, 0x49b40821,
        0xf61e2562, 0xc040b340, 0x265e5a51, 0xe9b6c7aa,
        0xd62f105d, 0x02441453, 0xd8a1e681, 0xe7d3fbc8,
        0x21e1cde6, 0xc33707d6, 0xf4d50d87, 0x455a14ed,
        0xa9e3e905, 0xfcefa3f8, 0x676f02d9, 0x8d2a4c8a,
        0xfffa3942, 0x8771f681, 0x6d9d6122, 0xfde5380c,
        0xa4beea44, 0x4bdecfa9, 0xf6bb4b60, 0xbebfbc70,
        0x289b7ec6, 0xeaa127fa, 0xd4ef3085, 0x04881d05,
        0xd9d4d039, 0xe6db99e5, 0x1fa27cf8, 0xc4ac5665,
        0xf4292244, 0x432aff97, 0xab9423a7, 0xfc93a039,
        0x655b59c3, 0x8f0ccc92, 0xffeff47d, 0x85845dd1,
        0x6fa87e4f, 0xfe2ce6e0, 0xa3014314, 0x4e0811a1,
        0xf7537e82, 0xbd3af235, 0x2ad7d2bb, 0xeb86d391,
    ];

    let mut msg = input.as_bytes().to_vec();
    let bit_len = (msg.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while (msg.len() % 64) != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bit_len.to_le_bytes());

    let mut a0: u32 = 0x67452301;
    let mut b0: u32 = 0xefcdab89;
    let mut c0: u32 = 0x98badcfe;
    let mut d0: u32 = 0x10325476;

    for chunk in msg.chunks_exact(64) {
        let mut m = [0u32; 16];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            m[i] = u32::from_le_bytes([word[0], word[1], word[2], word[3]]);
        }

        let mut a = a0;
        let mut b = b0;
        let mut c = c0;
        let mut d = d0;

        for i in 0..64 {
            let (f, g) = match i {
                0..=15 => ((b & c) | ((!b) & d), i),
                16..=31 => ((d & b) | ((!d) & c), (5 * i + 1) % 16),
                32..=47 => (b ^ c ^ d, (3 * i + 5) % 16),
                _ => (c ^ (b | (!d)), (7 * i) % 16),
            };
            let temp = d;
            d = c;
            c = b;
            let sum = a.wrapping_add(f).wrapping_add(K[i]).wrapping_add(m[g]);
            b = b.wrapping_add(sum.rotate_left(S[i]));
            a = temp;
        }

        a0 = a0.wrapping_add(a);
        b0 = b0.wrapping_add(b);
        c0 = c0.wrapping_add(c);
        d0 = d0.wrapping_add(d);
    }

    let mut digest = [0u8; 16];
    digest[0..4].copy_from_slice(&a0.to_le_bytes());
    digest[4..8].copy_from_slice(&b0.to_le_bytes());
    digest[8..12].copy_from_slice(&c0.to_le_bytes());
    digest[12..16].copy_from_slice(&d0.to_le_bytes());

    let mut hex = String::with_capacity(32);
    for byte in &digest {
        use std::fmt::Write;
        let _ = write!(&mut hex, "{:02x}", byte);
    }
    hex
}

pub fn compute_session_id(aumid: &str, title: &str) -> String {
    compute_md5_hex(&format!("{}_{}", aumid.trim(), title.trim()))
}

pub fn classify_source_app(source_app: &str) -> (String, Option<String>, bool, bool) {
    let aumid_lower = source_app.to_lowercase();
    if aumid_lower.contains("spotify") {
        return ("Spotify".to_string(), None, false, true);
    }
    if aumid_lower.contains("brave") {
        return ("Brave".to_string(), Some("Brave".to_string()), true, false);
    }
    if aumid_lower.contains("msedge") || aumid_lower.contains("edge") {
        return ("Edge".to_string(), Some("Edge".to_string()), true, false);
    }
    if aumid_lower.contains("chrome") {
        return ("Chrome".to_string(), Some("Chrome".to_string()), true, false);
    }
    if aumid_lower.contains("firefox") {
        return ("Firefox".to_string(), Some("Firefox".to_string()), true, false);
    }
    if aumid_lower.contains("opera") {
        return ("Opera".to_string(), Some("Opera".to_string()), true, false);
    }
    if aumid_lower.contains("vivaldi") {
        return ("Vivaldi".to_string(), Some("Vivaldi".to_string()), true, false);
    }

    // Extract clean fallback name from AUMID
    let cleaned = source_app
        .split(['\\', '/', '!'])
        .last()
        .unwrap_or(source_app)
        .trim_end_matches(".exe")
        .trim_end_matches(".EXE")
        .to_string();
    let app_name = if cleaned.is_empty() {
        "Media Player".to_string()
    } else {
        cleaned
    };
    (app_name, None, false, false)
}

#[cfg(windows)]
pub mod windows_media {
    use super::*;
    use base64::Engine;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use windows::Media::Control::{
        GlobalSystemMediaTransportControlsSession,
        GlobalSystemMediaTransportControlsSessionManager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    };
    use windows::Media::MediaPlaybackType;
    use windows::Storage::Streams::DataReader;

    fn get_session_manager() -> Option<GlobalSystemMediaTransportControlsSessionManager> {
        GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .ok()?
            .join()
            .ok()
    }

    fn read_thumbnail_base64(session: &GlobalSystemMediaTransportControlsSession) -> Option<String> {
        let media_props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let thumb_stream_ref = media_props.Thumbnail().ok()?;
        let stream = thumb_stream_ref.OpenReadAsync().ok()?.join().ok()?;
        let size = stream.Size().ok()? as usize;
        if size == 0 {
            return None;
        }

        let reader = DataReader::CreateDataReader(&stream).ok()?;
        reader.LoadAsync(size as u32).ok()?.join().ok()?;
        let mut buffer = vec![0u8; size];
        reader.ReadBytes(&mut buffer).ok()?;

        let b64 = base64::engine::general_purpose::STANDARD.encode(&buffer);
        Some(format!("data:image/jpeg;base64,{}", b64))
    }

    fn extract_session_summary(
        session: &GlobalSystemMediaTransportControlsSession,
        is_spotify_alive: bool,
    ) -> Option<(MediaSessionSummary, String, bool, bool)> {
        let source_app = session
            .SourceAppUserModelId()
            .ok()
            .map(|s| s.to_string())
            .unwrap_or_default();

        // Self-Exclusion Guard: Ignore CASA's own WebView2 HTML5 <audio> session so Native Player
        // never triggers external GSMTC takeover or wipes native lyrics.
        let src_lower = source_app.to_lowercase();
        if src_lower.contains("casa")
            || src_lower.contains("com.crimson")
            || src_lower.contains("webview2")
        {
            return None;
        }

        let (app_name, browser_type, is_browser, is_spotify) = classify_source_app(&source_app);
        if is_spotify && !is_spotify_alive {
            return None;
        }

        let playback_info = session.GetPlaybackInfo().ok()?;
        let status = playback_info.PlaybackStatus().ok()?;
        
        // 1. Validasi Status Playback:
        // Loloskan sesi media jika statusnya Playing ATAU Paused (dengan metadata audio valid).
        // Abaikan sesi yang Stopped, Closed, atau tanpa audio stream aktif.
        let is_playing = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing;
        let is_paused = status == GlobalSystemMediaTransportControlsSessionPlaybackStatus::Paused;
        if !is_playing && !is_paused {
            return None;
        }

        // 2. Filter Browser: Untuk proses browser (Chrome, Edge, Firefox, Brave, dll.),
        // pastikan media memiliki metadata audio valid (PlaybackType::Music atau PlaybackType::Video)
        // dan sedang aktif berbunyi. Jangan pernah gunakan window title tab dokumen/web biasa sebagai track audio.
        if is_browser {
            let playback_type = playback_info.PlaybackType().ok().and_then(|r| r.Value().ok());
            let is_valid_audio_video = matches!(
                playback_type,
                Some(MediaPlaybackType::Music) | Some(MediaPlaybackType::Video)
            );
            if !is_valid_audio_video {
                return None;
            }
        }

        let media_props = session.TryGetMediaPropertiesAsync().ok()?.join().ok()?;
        let title = media_props.Title().ok().map(|s| s.to_string()).unwrap_or_default();
        let artist = media_props.Artist().ok().map(|s| s.to_string()).unwrap_or_default();

        if title.trim().is_empty() && artist.trim().is_empty() {
            return None;
        }
        if title.trim().eq_ignore_ascii_case("casa") && artist.trim().is_empty() {
            return None;
        }

        // Filter Web Tab: Abaikan jika judul dokumen web biasa (mengandung URL atau domain tanpa artist)
        if is_browser {
            let trimmed_title = title.trim();
            if artist.trim().is_empty() || artist.trim().eq_ignore_ascii_case("unknown artist") {
                let lower = trimmed_title.to_lowercase();
                if lower.contains("http://")
                    || lower.contains("https://")
                    || lower.ends_with(".com")
                    || lower.ends_with(".org")
                    || lower.ends_with(".net")
                    || lower.ends_with(".io")
                {
                    return None;
                }
            }
        }

        let session_id = compute_session_id(&source_app, &title);
        let summary = MediaSessionSummary {
            session_id,
            app_name,
            browser_type,
            title,
            artist,
            is_playing,
        };

        Some((summary, source_app, is_browser, is_spotify))
    }

    #[derive(Clone, Debug)]
    struct StickySessionState {
        session_id: String,
        source_app: String,
        app_name: String,
    }

    static STICKY_SESSION: std::sync::Mutex<Option<StickySessionState>> =
        std::sync::Mutex::new(None);

    fn select_primary_session(
        manager: &GlobalSystemMediaTransportControlsSessionManager,
        is_spotify_alive: bool,
    ) -> Option<GlobalSystemMediaTransportControlsSession> {
        let mut valid_entries: Vec<(
            GlobalSystemMediaTransportControlsSession,
            MediaSessionSummary,
            String,
        )> = Vec::new();

        if let Ok(sessions) = manager.GetSessions() {
            let count = sessions.Size().unwrap_or(0);
            for i in 0..count {
                if let Ok(sess) = sessions.GetAt(i) {
                    if let Some((summary, source_app, _, _)) =
                        extract_session_summary(&sess, is_spotify_alive)
                    {
                        valid_entries.push((sess, summary, source_app));
                    }
                }
            }
        }

        // 1. State Hierarchy (Active Playback Precedence + Session Stickiness):
        // - If STICKY_SESSION is PLAYING, keep it locked.
        // - If STICKY_SESSION is PAUSED and another session is PLAYING, release lock and switch to the PLAYING session.
        // - If STICKY_SESSION is PAUSED and NO other session is PLAYING, keep STICKY_SESSION locked (anti-snap on pause).
        let sticky_opt = STICKY_SESSION.lock().ok().and_then(|g| g.clone());
        if let Some(sticky) = sticky_opt {
            // Find current state of the sticky session (exact session_id or same browser/app track change)
            let exact_match = valid_entries
                .iter()
                .find(|(_, sum, _)| sum.session_id == sticky.session_id);

            let same_app_match = if exact_match.is_none() {
                let playing = valid_entries.iter().find(|(_, sum, src)| {
                    *src == sticky.source_app && sum.app_name == sticky.app_name && sum.is_playing
                });
                let any = valid_entries.iter().find(|(_, sum, src)| {
                    *src == sticky.source_app && sum.app_name == sticky.app_name
                });
                playing.or(any)
            } else {
                None
            };

            if let Some((sticky_sess, sticky_sum, sticky_src)) = exact_match.or(same_app_match) {
                if sticky_sum.is_playing {
                    // Sticky session is actively playing -> keep it locked (update session_id if track changed in same app)
                    if sticky_sum.session_id != sticky.session_id {
                        if let Ok(mut guard) = STICKY_SESSION.lock() {
                            *guard = Some(StickySessionState {
                                session_id: sticky_sum.session_id.clone(),
                                source_app: sticky_src.clone(),
                                app_name: sticky_sum.app_name.clone(),
                            });
                        }
                    }
                    return Some(sticky_sess.clone());
                } else {
                    // Sticky session is PAUSED -> Check Active Playback Precedence!
                    // Does another session have is_playing == true?
                    if let Some((other_playing_sess, other_sum, other_src)) = valid_entries
                        .iter()
                        .find(|(_, sum, _)| sum.session_id != sticky_sum.session_id && sum.is_playing)
                    {
                        // Release old lock and switch focus to the newly playing session
                        if let Ok(mut guard) = STICKY_SESSION.lock() {
                            *guard = Some(StickySessionState {
                                session_id: other_sum.session_id.clone(),
                                source_app: other_src.clone(),
                                app_name: other_sum.app_name.clone(),
                            });
                        }
                        return Some(other_playing_sess.clone());
                    }

                    // No other session is playing -> Maintain Session Stickiness on this paused session
                    if sticky_sum.session_id != sticky.session_id {
                        if let Ok(mut guard) = STICKY_SESSION.lock() {
                            *guard = Some(StickySessionState {
                                session_id: sticky_sum.session_id.clone(),
                                source_app: sticky_src.clone(),
                                app_name: sticky_sum.app_name.clone(),
                            });
                        }
                    }
                    return Some(sticky_sess.clone());
                }
            }

            // Session no longer exists in OS -> clear sticky state and allow fallback
            if let Ok(mut guard) = STICKY_SESSION.lock() {
                *guard = None;
            }
        }

        // 2. Initial selection or fallback after OS session termination
        if let Some((sess, sum, src)) = valid_entries.iter().find(|(_, sum, _)| sum.is_playing) {
            if let Ok(mut guard) = STICKY_SESSION.lock() {
                *guard = Some(StickySessionState {
                    session_id: sum.session_id.clone(),
                    source_app: src.clone(),
                    app_name: sum.app_name.clone(),
                });
            }
            return Some(sess.clone());
        }

        if let Some(current_sess) = manager.GetCurrentSession().ok() {
            if let Some((sum, src, _, _)) =
                extract_session_summary(&current_sess, is_spotify_alive)
            {
                if let Ok(mut guard) = STICKY_SESSION.lock() {
                    *guard = Some(StickySessionState {
                        session_id: sum.session_id,
                        source_app: src,
                        app_name: sum.app_name,
                    });
                }
                return Some(current_sess);
            }
        }

        if let Some((sess, sum, src)) = valid_entries.into_iter().next() {
            if let Ok(mut guard) = STICKY_SESSION.lock() {
                *guard = Some(StickySessionState {
                    session_id: sum.session_id,
                    source_app: src,
                    app_name: sum.app_name,
                });
            }
            return Some(sess);
        }

        None
    }

    pub fn fetch_current_media_state() -> Option<MediaUpdatePayload> {
        let manager = get_session_manager()?;
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let session = select_primary_session(&manager, is_spotify_alive)?;

        let (primary_summary, source_app, is_browser, is_spotify) =
            extract_session_summary(&session, is_spotify_alive)?;

        let playback_info = session.GetPlaybackInfo().ok()?;
        let is_shuffle = playback_info.IsShuffleActive().ok().and_then(|r| r.Value().ok());

        let timeline = session.GetTimelineProperties().ok();
        let (position, duration) = if let Some(t) = timeline {
            let pos_raw = t.Position().map(|ts| ts.Duration).unwrap_or(0);
            let end_raw = t.EndTime().map(|ts| ts.Duration).unwrap_or(0);
            (pos_raw as f64 / 10_000_000.0, end_raw as f64 / 10_000_000.0)
        } else {
            (0.0, 0.0)
        };

        let album_art = read_thumbnail_base64(&session);

        // Collect all active / paused sessions across the OS
        let mut active_sessions: Vec<MediaSessionSummary> = Vec::new();
        active_sessions.push(primary_summary.clone());

        if let Ok(sessions) = manager.GetSessions() {
            let count = sessions.Size().unwrap_or(0);
            for i in 0..count {
                if let Ok(sess) = sessions.GetAt(i) {
                    if let Some((summary, _, _, _)) = extract_session_summary(&sess, is_spotify_alive) {
                        if !active_sessions.iter().any(|s| s.session_id == summary.session_id) {
                            active_sessions.push(summary);
                        }
                    }
                }
            }
        }

        Some(MediaUpdatePayload {
            session_id: primary_summary.session_id,
            title: primary_summary.title,
            artist: primary_summary.artist,
            is_playing: primary_summary.is_playing,
            position,
            duration,
            album_art,
            is_shuffle,
            source_app,
            is_browser,
            is_spotify,
            active_sessions,
        })
    }

    #[cfg(windows)]
    pub fn simulate_virtual_media_key(vk: u8) {
        use windows_sys::Win32::UI::Input::KeyboardAndMouse::{
            keybd_event, KEYEVENTF_KEYUP,
        };
        unsafe {
            keybd_event(vk, 0, 0, 0);
            keybd_event(vk, 0, KEYEVENTF_KEYUP, 0);
        }
    }

    pub fn control_play_pause() -> Result<(), String> {
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let session = get_session_manager().and_then(|m| select_primary_session(&m, is_spotify_alive));

        if let Some(sess) = session {
            if let Ok(async_op) = sess.TryTogglePlayPauseAsync() {
                if async_op.join().is_ok() {
                    return Ok(());
                }
            }
        }

        // Virtual Media Fallback: Pure Win32 API in-process (keybd_event)
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_PLAY_PAUSE;
            simulate_virtual_media_key(VK_MEDIA_PLAY_PAUSE as u8);
            return Ok(());
        }

        #[cfg(not(windows))]
        Err("No active media session".to_string())
    }

    pub fn control_next() -> Result<(), String> {
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let session = get_session_manager().and_then(|m| select_primary_session(&m, is_spotify_alive));

        if let Some(sess) = session {
            if let Ok(async_op) = sess.TrySkipNextAsync() {
                if async_op.join().is_ok() {
                    return Ok(());
                }
            }
        }

        // Virtual Media Fallback: Pure Win32 API in-process (keybd_event)
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_NEXT_TRACK;
            simulate_virtual_media_key(VK_MEDIA_NEXT_TRACK as u8);
            return Ok(());
        }

        #[cfg(not(windows))]
        Err("No active media session".to_string())
    }

    pub fn control_prev() -> Result<(), String> {
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let session = get_session_manager().and_then(|m| select_primary_session(&m, is_spotify_alive));

        if let Some(sess) = session {
            if let Ok(async_op) = sess.TrySkipPreviousAsync() {
                if async_op.join().is_ok() {
                    return Ok(());
                }
            }
        }

        // Virtual Media Fallback: Pure Win32 API in-process (keybd_event)
        #[cfg(windows)]
        {
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::VK_MEDIA_PREV_TRACK;
            simulate_virtual_media_key(VK_MEDIA_PREV_TRACK as u8);
            return Ok(());
        }

        #[cfg(not(windows))]
        Err("No active media session".to_string())
    }

    pub fn control_media_session_sync(session_id: &str, action: &str) -> Result<(), String> {
        let manager = get_session_manager().ok_or("No session manager")?;
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
        let count = sessions.Size().unwrap_or(0);

        let mut target_sess: Option<GlobalSystemMediaTransportControlsSession> = None;
        let mut matched_meta: Option<(String, String, String)> = None;

        if !session_id.is_empty() {
            for i in 0..count {
                if let Ok(sess) = sessions.GetAt(i) {
                    if let Some((summary, source_app, _, _)) = extract_session_summary(&sess, is_spotify_alive) {
                        if summary.session_id == session_id {
                            matched_meta = Some((summary.session_id, source_app, summary.app_name));
                            target_sess = Some(sess);
                            break;
                        }
                    }
                }
            }
        }

        let sess = match target_sess {
            Some(s) => s,
            None => select_primary_session(&manager, is_spotify_alive)
                .ok_or_else(|| format!("Media session {} not found", session_id))?,
        };

        let action_lower = action.to_lowercase();
        if action_lower == "play" {
            if let Some((sid, src, app_name)) = matched_meta {
                if let Ok(mut guard) = STICKY_SESSION.lock() {
                    *guard = Some(StickySessionState {
                        session_id: sid,
                        source_app: src,
                        app_name,
                    });
                }
            }
        }

        match action_lower.as_str() {
            "pause" => {
                sess.TryPauseAsync()
                    .map_err(|e| e.to_string())?
                    .join()
                    .map_err(|e| e.to_string())?;
            }
            "play" => {
                sess.TryPlayAsync()
                    .map_err(|e| e.to_string())?
                    .join()
                    .map_err(|e| e.to_string())?;
            }
            "stop" => {
                sess.TryStopAsync()
                    .map_err(|e| e.to_string())?
                    .join()
                    .map_err(|e| e.to_string())?;
            }
            "next" | "skip_next" => {
                sess.TrySkipNextAsync()
                    .map_err(|e| e.to_string())?
                    .join()
                    .map_err(|e| e.to_string())?;
            }
            "prev" | "previous" | "skip_previous" => {
                sess.TrySkipPreviousAsync()
                    .map_err(|e| e.to_string())?
                    .join()
                    .map_err(|e| e.to_string())?;
            }
            _ => {
                sess.TryTogglePlayPauseAsync()
                    .map_err(|e| e.to_string())?
                    .join()
                    .map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn quick_swap_session_sync(target_session_id: &str, pause_current: bool) -> Result<(), String> {
        let manager = get_session_manager().ok_or("No session manager")?;
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
        let count = sessions.Size().unwrap_or(0);

        let mut target_session: Option<GlobalSystemMediaTransportControlsSession> = None;

        // Step 1: Sequentially pause all other playing sessions if requested and lock sticky session
        for i in 0..count {
            if let Ok(sess) = sessions.GetAt(i) {
                if let Some((summary, source_app, _, _)) = extract_session_summary(&sess, is_spotify_alive) {
                    if summary.session_id == target_session_id {
                        if let Ok(mut guard) = STICKY_SESSION.lock() {
                            *guard = Some(StickySessionState {
                                session_id: summary.session_id.clone(),
                                source_app,
                                app_name: summary.app_name.clone(),
                            });
                        }
                        target_session = Some(sess);
                    } else if pause_current && summary.is_playing {
                        if let Ok(op) = sess.TryPauseAsync() {
                            let _ = op.join();
                        }
                    }
                }
            }
        }

        // Step 2: Start playback on the target session
        if let Some(target) = target_session {
            target
                .TryPlayAsync()
                .map_err(|e| e.to_string())?
                .join()
                .map_err(|e| e.to_string())?;
            Ok(())
        } else {
            Err(format!("Target media session {} not found", target_session_id))
        }
    }

    pub fn seek_media_session_sync(session_id: &str, position_ms: i64) -> Result<(), String> {
        let manager = get_session_manager().ok_or("No session manager")?;
        let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
        let sessions = manager.GetSessions().map_err(|e| e.to_string())?;
        let count = sessions.Size().unwrap_or(0);

        let mut target_sess: Option<GlobalSystemMediaTransportControlsSession> = None;

        if !session_id.is_empty() {
            for i in 0..count {
                if let Ok(sess) = sessions.GetAt(i) {
                    if let Some((summary, _, _, _)) = extract_session_summary(&sess, is_spotify_alive) {
                        if summary.session_id == session_id {
                            target_sess = Some(sess);
                            break;
                        }
                    }
                }
            }
        }

        let sess = match target_sess {
            Some(s) => s,
            None => select_primary_session(&manager, is_spotify_alive)
                .ok_or_else(|| format!("Media session {} not found", session_id))?,
        };

        // 1 ms = 10,000 hundred-nanosecond intervals (ticks)
        let ticks = position_ms.saturating_mul(10_000);
        sess.TryChangePlaybackPositionAsync(ticks)
            .map_err(|e| e.to_string())?
            .join()
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn start_telemetry_daemon(app: AppHandle) {
        let running = Arc::new(AtomicBool::new(true));

        tauri::async_runtime::spawn(async move {
            let mut last_payload: Option<MediaUpdatePayload> = None;
            let mut last_position_check = std::time::Instant::now();
            let mut had_session = false;
            let mut closed_since: Option<std::time::Instant> = None;
            let mut last_spotify_running = crate::media::providers::spotify_win32::is_spotify_process_running_native();

            while running.load(Ordering::Relaxed) {
                // Poll every 500ms
                tokio::time::sleep(Duration::from_millis(500)).await;

                // Ultra-fast Win32 Toolhelp process snapshot (< 1ms)
                let is_spotify_alive = crate::media::providers::spotify_win32::is_spotify_process_running_native();
                if is_spotify_alive != last_spotify_running {
                    last_spotify_running = is_spotify_alive;
                    if !is_spotify_alive {
                        let _ = app.emit("spotify-closed", serde_json::json!({ "running": false }));
                    } else {
                        let now_ms = std::time::SystemTime::now()
                            .duration_since(std::time::UNIX_EPOCH)
                            .map(|d| d.as_millis() as i64)
                            .unwrap_or(0);
                        let _ = app.emit("spotify-opened", serde_json::json!({ "running": true, "timestamp": now_ms }));
                    }
                }

                // If Spotify process is dead and active session was Spotify, immediately stop playback and emit empty payload
                if !is_spotify_alive {
                    if had_session && last_payload.as_ref().map_or(false, |p| p.is_spotify) {
                        let empty_payload = MediaUpdatePayload {
                            session_id: String::new(),
                            title: String::new(),
                            artist: String::new(),
                            is_playing: false,
                            position: 0.0,
                            duration: 0.0,
                            album_art: None,
                            is_shuffle: None,
                            source_app: String::new(),
                            is_browser: false,
                            is_spotify: false,
                            active_sessions: Vec::new(),
                        };
                        let _ = app.emit("media-update", &empty_payload);
                        let _ = app.emit("media-session-closed", serde_json::json!({}));
                        let _ = app.emit("spotify-closed", serde_json::json!({ "running": false }));
                        had_session = false;
                        last_payload = None;
                        closed_since = None;
                    }
                }

                // Offload Windows COM calls to blocking thread with strict 800ms timeout to prevent UI freeze
                let current_state = match tokio::time::timeout(
                    Duration::from_millis(800),
                    tokio::task::spawn_blocking(fetch_current_media_state),
                ).await {
                    Ok(Ok(state)) => state,
                    _ => None,
                };

                if let Some(mut state) = current_state {
                    had_session = true;
                    closed_since = None;

                    // Clean track transition synchronization
                    if let Some(prev) = &last_payload {
                        if prev.title != state.title || prev.artist != state.artist {
                            if state.album_art == prev.album_art {
                                state.album_art = None;
                            }
                        }
                    }

                    let should_emit = match &last_payload {
                        None => true,
                        Some(prev) => {
                            let meta_changed = prev.session_id != state.session_id
                                || prev.title != state.title
                                || prev.artist != state.artist
                                || prev.is_playing != state.is_playing
                                || prev.album_art != state.album_art
                                || prev.is_shuffle != state.is_shuffle
                                || prev.source_app != state.source_app
                                || prev.active_sessions != state.active_sessions;

                            let time_drift = (prev.position - state.position).abs() > 3.0;
                            let heartbeat = last_position_check.elapsed() >= Duration::from_secs(5);

                            meta_changed || time_drift || heartbeat
                        }
                    };

                    if should_emit {
                        last_position_check = std::time::Instant::now();
                        let _ = app.emit("media-update", &state);
                        last_payload = Some(state);
                    }
                } else if had_session {
                    let now = std::time::Instant::now();
                    let elapsed = match closed_since {
                        Some(t) => now.duration_since(t),
                        None => {
                            closed_since = Some(now);
                            Duration::from_millis(0)
                        }
                    };

                    // Only verify process after grace period (2500ms debounce)
                    if elapsed >= Duration::from_millis(2500) {
                        let is_spotify_active = last_payload.as_ref().map_or(false, |p| p.is_spotify);
                        let is_running = if is_spotify_active {
                            tokio::task::spawn_blocking(crate::media::providers::spotify_win32::is_spotify_process_running_native)
                                .await
                                .unwrap_or(false)
                        } else {
                            false
                        };

                        if !is_running {
                            had_session = false;
                            last_payload = None;
                            closed_since = None;
                            let empty_payload = MediaUpdatePayload {
                                session_id: String::new(),
                                title: String::new(),
                                artist: String::new(),
                                is_playing: false,
                                position: 0.0,
                                duration: 0.0,
                                album_art: None,
                                is_shuffle: None,
                                source_app: String::new(),
                                is_browser: false,
                                is_spotify: false,
                                active_sessions: Vec::new(),
                            };
                            let _ = app.emit("media-update", &empty_payload);
                            let _ = app.emit("media-session-closed", serde_json::json!({}));
                        }
                    }
                }
            }
        });
    }
}

#[cfg(not(windows))]
pub mod windows_media {
    use super::*;
    pub fn control_play_pause() -> Result<(), String> { Ok(()) }
    pub fn control_next() -> Result<(), String> { Ok(()) }
    pub fn control_prev() -> Result<(), String> { Ok(()) }
    pub fn control_media_session_sync(_session_id: &str, _action: &str) -> Result<(), String> { Ok(()) }
    pub fn quick_swap_session_sync(_target_session_id: &str, _pause_current: bool) -> Result<(), String> { Ok(()) }
    pub fn seek_media_session_sync(_session_id: &str, _position_ms: i64) -> Result<(), String> { Ok(()) }
    pub fn start_telemetry_daemon(_app: AppHandle) {}
}

pub use windows_media::*;
