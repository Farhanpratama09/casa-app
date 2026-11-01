import { invoke } from '@tauri-apps/api/core';

let lastIgnoreState: boolean | null = null;
const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

/**
 * Set ignore cursor events with state caching to prevent IPC spam.
 *
 * PHASE 1 FIX:
 * To eliminate the "Click-Through Deadlock", calls with ignore=true are disabled.
 * The window is kept in ignore=false mode so that all interactive elements
 * (Pill, Expanded Cards, controls, and bottom DevTriggerBar) can receive mouse events 100%.
 */
export async function setSmartIgnoreCursorEvents(ignore: boolean): Promise<void> {
  // Disable ignore=true during Phase 1 to guarantee responsive mouse interaction
  if (ignore) {
    return;
  }

  if (lastIgnoreState === false) {
    return;
  }
  lastIgnoreState = false;

  if (isTauriEnv) {
    try {
      await invoke('set_ignore_cursor_events', { ignore: false });
    } catch (err) {
      console.warn('[CASA IPC] set_ignore_cursor_events failed:', err);
    }
  }
}

/**
 * Toggle Gaming Mode via Rust backend
 */
export async function toggleGamingMode(enabled: boolean): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('toggle_gaming_mode', { enabled });
    } catch (err) {
      console.warn('[CASA IPC] toggle_gaming_mode failed:', err);
    }
  }
  return enabled;
}

/**
 * Windows GSMTC Media Transport Controls (Phase 2)
 */
export interface MediaSessionSummary {
  session_id: string;
  app_name: string;
  browser_type?: string | null;
  title: string;
  artist: string;
  is_playing: boolean;
}

export interface NativeMediaPayload {
  session_id?: string;
  title: string;
  artist: string;
  is_playing: boolean;
  position: number;
  duration: number;
  album_art?: string | null;
  is_shuffle?: boolean | null;
  source_app?: string;
  is_browser?: boolean;
  is_spotify?: boolean;
  active_sessions?: MediaSessionSummary[];
}

export async function controlMediaSession(
  sessionId: string,
  action:
    | 'play'
    | 'pause'
    | 'stop'
    | 'toggle'
    | 'next'
    | 'skip_next'
    | 'prev'
    | 'previous'
    | 'skip_previous'
): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('control_media_session', { sessionId, action });
    } catch (err) {
      console.warn('[CASA GSMTC] control_media_session failed:', err);
    }
  }
}

let lastManualTargetSessionId: string | null = null;

export function getLastManualTargetSessionId(): string | null {
  return lastManualTargetSessionId;
}

export function clearLastManualTargetSessionId(): void {
  lastManualTargetSessionId = null;
}

export async function quickSwapSession(
  targetSessionId: string,
  pauseCurrent: boolean = true
): Promise<void> {
  lastManualTargetSessionId = targetSessionId;
  if (isTauriEnv) {
    try {
      await invoke('quick_swap_session', { targetSessionId, pauseCurrent });
    } catch (err) {
      console.warn('[CASA GSMTC] quick_swap_session failed:', err);
    }
  }
}

export async function seekMediaSession(sessionId: string, positionMs: number): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('seek_media_session', { sessionId, positionMs: Math.round(positionMs) });
    } catch (err) {
      console.warn('[CASA GSMTC] seek_media_session failed:', err);
    }
  }
}

export async function mediaPlayPause(): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('media_play_pause');
    } catch (err) {
      console.warn('[CASA GSMTC] media_play_pause failed:', err);
    }
  }
}

export async function mediaNextTrack(): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('media_next_track');
    } catch (err) {
      console.warn('[CASA GSMTC] media_next_track failed:', err);
    }
  }
}

export async function mediaPrevTrack(): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('media_prev_track');
    } catch (err) {
      console.warn('[CASA GSMTC] media_prev_track failed:', err);
    }
  }
}

export async function getCurrentMedia(): Promise<NativeMediaPayload | null> {
  if (isTauriEnv) {
    try {
      return await invoke<NativeMediaPayload | null>('get_current_media');
    } catch (err) {
      console.warn('[CASA GSMTC] get_current_media failed:', err);
    }
  }
  return null;
}

/**
 * Direct Spotify Playback via Windows URI (Phase 2 + Web API)
 */
export async function spotifyPlayTrack(trackId: string): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('spotify_play_track', { trackId });
    } catch (err) {
      console.warn('[CASA Spotify] spotify_play_track failed:', err);
    }
  } else {
    console.debug('[Web Mock] Playing Spotify track:', trackId);
  }
}

/**
 * Check if Spotify.exe is actively running in the OS process list in real-time
 */
export async function isSpotifyRunning(): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('is_spotify_running');
    } catch (err) {
      console.warn('[CASA Spotify] is_spotify_running failed:', err);
      return false;
    }
  }
  return true;
}

/**
 * Silently wake up Spotify in the background if not currently running (zero popup).
 */
export async function ensureSpotifyRunningSilent(): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('ensure_spotify_running_silent');
    } catch (err) {
      console.warn('[CASA Spotify] ensure_spotify_running_silent failed:', err);
      return false;
    }
  }
  return true;
}

/**
 * Force minimize any Spotify desktop window that attempted to pop up
 */
export async function minimizeSpotifyStealth(): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('minimize_spotify_stealth');
    } catch (err) {
      console.warn('[CASA Win32] minimize_spotify_stealth failed:', err);
    }
  }
}

/**
 * Brings the native Spotify desktop window to foreground, or toggles minimize if already active.
 */
export async function focusSpotifyWindow(): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('focus_spotify_window');
    } catch (err) {
      console.warn('[CASA Win32] focus_spotify_window failed:', err);
      return false;
    }
  }
  return false;
}

/**
 * Cleanly launches the native Spotify desktop client without CMD or conhost shells.
 * EXCLUSIVELY used for deliberate user actions (e.g. clicking Play or 'Buka Spotify' when closed).
 */
export async function launchSpotifyProcessClean(minimized: boolean = false): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('launch_spotify_process_clean', { minimized });
    } catch (err) {
      console.warn('[CASA Win32] launch_spotify_process_clean failed:', err);
      return false;
    }
  }
  return false;
}

/**
 * Quits all running instances of Spotify desktop client cleanly and silently.
 * Triggered on right-click of the Spotify toggle button.
 */
export async function quitSpotifyApp(): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('quit_spotify_app');
    } catch (err) {
      console.warn('[CASA Win32] quit_spotify_app failed:', err);
      return false;
    }
  }
  return false;
}

/**
 * Explicitly focus the island overlay window and pull OS keyboard foreground focus
 */
export async function focusIslandWindow(): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('focus_island_window');
    } catch (err) {
      console.warn('[CASA Win32] focus_island_window failed:', err);
    }
  }
}

export interface SpotifyTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
}

/**
 * Launch Spotify User OAuth 2.0 loopback flow on 127.0.0.1:8888
 */
export async function startSpotifyLogin(clientId: string, clientSecret: string): Promise<SpotifyTokens> {
  if (isTauriEnv) {
    return await invoke<SpotifyTokens>('start_spotify_login', {
      clientId,
      clientSecret,
    });
  }
  throw new Error('Spotify OAuth loopback requires Tauri desktop runtime');
}

/**
 * Refresh expired user token via Spotify token endpoint
 */
export async function refreshSpotifyUserToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<SpotifyTokens> {
  if (isTauriEnv) {
    return await invoke<SpotifyTokens>('refresh_spotify_user_token', {
      refreshToken,
      clientId,
      clientSecret,
    });
  }
  throw new Error('Spotify OAuth refresh requires Tauri desktop runtime');
}

let lastHitboxSize = { width: 0, height: 0 };

/**
 * Update the active island capsule hitbox in the Rust backend
 * for 50Hz dynamic click-through pass-through (Option B: Fixed 620px canvas)
 */
export async function updateIslandHitbox(width: number, height: number): Promise<void> {
  const roundedW = Math.round(width);
  const roundedH = Math.round(height);

  if (lastHitboxSize.width === roundedW && lastHitboxSize.height === roundedH) {
    return;
  }
  lastHitboxSize = { width: roundedW, height: roundedH };

  if (isTauriEnv) {
    try {
      await invoke('update_island_hitbox', {
        width: roundedW,
        height: roundedH,
      });
    } catch (err) {
      console.warn('[CASA IPC] update_island_hitbox failed:', err);
    }
  }
}

let lastAdjustedSize = { width: 0, height: 0 };

/**
 * Adjust native Win32 window size smoothly without flicker
 */
export async function adjustWindowSize(width: number, height: number): Promise<void> {
  const roundedW = Math.round(width);
  const roundedH = Math.round(height);

  // Cegah pemanggilan resize berulang jika ukuran target sama dengan ukuran aktif saat ini
  if (lastAdjustedSize.width === roundedW && lastAdjustedSize.height === roundedH) {
    return;
  }
  lastAdjustedSize = { width: roundedW, height: roundedH };

  if (typeof window !== 'undefined' && (window as any).__TAURI_RESIZE_WINDOW__) {
    try {
      await (window as any).__TAURI_RESIZE_WINDOW__(roundedW, roundedH);
    } catch (e) {}
  }

  if (isTauriEnv) {
    try {
      // Pemanggilan IPC atomik tunggal: backend Rust center_window_top mengkalkulasi koordinat X
      // dan ukuran secara serentak dalam 1 syscall Win32 SetWindowPos tanpa jeda pemisahan move/size.
      await invoke('adjust_window_size', {
        width: roundedW,
        height: roundedH,
      });
    } catch (err) {
      console.warn('[CASA IPC] adjust_window_size failed:', err);
    }
  }
}

/**
 * Play subtle audio chime / Asa vocal cue
 */
export function playChimeCue(type: 'ding' | 'whisper' | 'tap' = 'ding'): void {
  try {
    const audioCtx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    if (type === 'ding') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(880, audioCtx.currentTime); // A5
      osc.frequency.exponentialRampToValueAtTime(1760, audioCtx.currentTime + 0.15); // A6
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.45);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.5);
    } else if (type === 'tap') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(320, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.05, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.08);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.09);
    } else {
      // whisper cue
      osc.type = 'sine';
      osc.frequency.setValueAtTime(540, audioCtx.currentTime);
      gain.gain.setValueAtTime(0.03, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.35);
    }
  } catch (e) {
    console.debug('Audio cue unavailable:', e);
  }
}
