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
): Promise<boolean> {
  if (isTauriEnv) {
    try {
      await invoke('control_media_session', { sessionId, action });
      return true;
    } catch (err) {
      console.warn('[CASA GSMTC] control_media_session failed:', err);
      return false;
    }
  }
  return true;
}

let lastManualTargetSessionId: string | null = null;
let manualStoppedMedia: { sessionId: string; title: string } | null = null;

export function markManualMediaStopped(sessionId?: string, title?: string): void {
  manualStoppedMedia = {
    sessionId: sessionId || '',
    title: (title || '').trim().toLowerCase(),
  };
}

export function clearManualMediaStopped(): void {
  manualStoppedMedia = null;
}

export function shouldSuppressStoppedMediaUpdate(
  sessionId?: string,
  title?: string,
  isPlaying?: boolean
): boolean {
  if (!manualStoppedMedia) return false;
  const cleanTitle = (title || '').trim().toLowerCase();
  const sameTitle = Boolean(manualStoppedMedia.title && cleanTitle === manualStoppedMedia.title);
  const sameSession = Boolean(manualStoppedMedia.sessionId && sessionId === manualStoppedMedia.sessionId);

  if (isPlaying || (cleanTitle && !sameTitle && !sameSession)) {
    manualStoppedMedia = null;
    return false;
  }
  return !isPlaying;
}

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

export async function seekMediaSession(sessionId: string, positionMs: number): Promise<boolean> {
  if (isTauriEnv) {
    try {
      await invoke('seek_media_session', { sessionId, positionMs: Math.round(positionMs) });
      return true;
    } catch (err) {
      console.warn('[CASA GSMTC] seek_media_session failed:', err);
      return false;
    }
  }
  return true;
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

export interface StoredSpotifyTokens {
  accessToken: string;
  refreshToken?: string | null;
  expiresAtMs: number;
  scope?: string | null;
}

/**
 * Launch Spotify User OAuth 2.0 PKCE + state loopback flow on 127.0.0.1:8888
 */
export async function startSpotifyLogin(clientId: string): Promise<SpotifyTokens> {
  if (isTauriEnv) {
    return await invoke<SpotifyTokens>('start_spotify_login', {
      clientId,
    });
  }
  throw new Error('Spotify OAuth loopback requires Tauri desktop runtime');
}

/**
 * Refresh expired user token via Spotify PKCE token endpoint (persists to DPAPI)
 */
export async function refreshSpotifyUserToken(
  clientId: string,
  refreshToken?: string
): Promise<SpotifyTokens> {
  if (isTauriEnv) {
    return await invoke<SpotifyTokens>('refresh_spotify_user_token', {
      clientId,
      refreshToken: refreshToken ?? null,
    });
  }
  throw new Error('Spotify OAuth refresh requires Tauri desktop runtime');
}

export async function loadSpotifyUserTokens(): Promise<StoredSpotifyTokens | null> {
  if (!isTauriEnv) return null;
  try {
    return await invoke<StoredSpotifyTokens | null>('load_spotify_user_tokens');
  } catch {
    return null;
  }
}

export async function saveSpotifyUserTokens(tokens: StoredSpotifyTokens): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('save_spotify_user_tokens', { tokens });
  } catch (err) {
    console.warn('[CASA Auth] save_spotify_user_tokens failed:', err);
  }
}

export async function clearSpotifyUserTokens(): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('clear_spotify_user_tokens');
  } catch (err) {
    console.warn('[CASA Auth] clear_spotify_user_tokens failed:', err);
  }
}

export interface HitRect {
  center_offset_x: number;
  top_offset: number;
  width: number;
  height: number;
}

let lastHitboxKey = '';

function serializeHitRects(rects: HitRect[]): string {
  return rects
    .map(
      (r) =>
        `${Math.round(r.center_offset_x)}:${Math.round(r.top_offset)}:${Math.round(r.width)}x${Math.round(r.height)}`
    )
    .join('|');
}

/**
 * Update the active island capsule hitbox in the Rust backend
 * for 50Hz dynamic click-through pass-through (single center rect helper)
 */
export async function updateIslandHitbox(width: number, height: number): Promise<void> {
  await updateIslandHitboxes([
    {
      center_offset_x: 0,
      top_offset: 0,
      width: Math.round(width),
      height: Math.round(height),
    },
  ]);
}

/**
 * Update composite multi-rect hitboxes in the Rust backend (center card + detached pods + overlays).
 * Transparent gaps between rects remain 100% click-through.
 */
export async function updateIslandHitboxes(rects: HitRect[]): Promise<void> {
  const rounded = rects.map((r) => ({
    center_offset_x: Math.round(r.center_offset_x),
    top_offset: Math.max(0, Math.round(r.top_offset)),
    width: Math.max(10, Math.round(r.width)),
    height: Math.max(10, Math.round(r.height)),
  }));
  const key = serializeHitRects(rounded);
  if (key === lastHitboxKey) {
    return;
  }
  lastHitboxKey = key;

  if (isTauriEnv) {
    try {
      await invoke('update_island_hitboxes', { rects: rounded });
    } catch (err) {
      console.warn('[CASA IPC] update_island_hitboxes failed:', err);
    }
  }
}

export async function setIslandPinned(pinned: boolean): Promise<void> {
  if (isTauriEnv) {
    try {
      await invoke('set_island_pinned', { pinned });
    } catch (err) {
      console.warn('[CASA IPC] set_island_pinned failed:', err);
    }
  }
}

export async function setStayAwakeNative(enabled: boolean): Promise<boolean> {
  if (isTauriEnv) {
    try {
      return await invoke<boolean>('set_stay_awake', { enabled });
    } catch (err) {
      console.warn('[CASA IPC] set_stay_awake failed:', err);
    }
  }
  return enabled;
}

export interface WifiNetworkItem {
  ssid: string;
  signal_quality: number;
  is_secured: boolean;
  is_connected: boolean;
  has_profile: boolean;
  auth_label: string;
  cipher_label: string;
  is_enterprise: boolean;
  is_captive_portal: boolean;
  internet_connectivity: string;
}

export interface ExchangeRatesResponse {
  base: string;
  rates: Record<string, number>;
  updated_at: string;
  source: string;
}

export interface ConnectedBluetoothDevice {
  name: string;
  address: string;
  battery_percent?: number | null;
}

export interface BluetoothDeviceItem {
  id: string;
  name: string;
  address: string;
  is_connected: boolean;
  device_type: string;
  battery_percent?: number | null;
}

export async function openExternalUrl(url: string): Promise<void> {
  if (!isTauriEnv) {
    if (typeof window !== 'undefined' && url.startsWith('https://')) {
      window.open(url, '_blank', 'noopener,noreferrer');
    }
    return;
  }
  await invoke('open_url_item', { url });
}

export async function toggleWifiNative(enabled?: boolean): Promise<boolean> {
  if (isTauriEnv) {
    return await invoke<boolean>('toggle_wifi', { enabled: enabled ?? null });
  }
  return false;
}

export async function toggleBluetoothNative(enabled?: boolean): Promise<boolean> {
  if (isTauriEnv) {
    return await invoke<boolean>('toggle_bluetooth', { enabled: enabled ?? null });
  }
  return false;
}

export async function scanWifiNetworks(): Promise<WifiNetworkItem[]> {
  if (isTauriEnv) {
    return await invoke<WifiNetworkItem[]>('scan_wifi_networks');
  }
  return [];
}

export async function connectWifiNetwork(ssid: string, password?: string): Promise<void> {
  if (isTauriEnv) {
    await invoke('connect_wifi_network', { ssid, password: password ?? null });
  }
}

export async function openCaptivePortalBrowser(): Promise<void> {
  if (isTauriEnv) {
    await invoke('open_captive_portal_browser');
  }
}

export async function openAvailableWifiNetworks(): Promise<void> {
  if (isTauriEnv) {
    await invoke('open_available_wifi_networks');
  }
}

export async function fetchExchangeRates(): Promise<ExchangeRatesResponse> {
  if (!isTauriEnv) {
    throw new Error('Refresh kurs langsung hanya tersedia pada aplikasi desktop CASA.');
  }
  return await invoke<ExchangeRatesResponse>('fetch_exchange_rates');
}

export async function writeClipboardText(text: string): Promise<boolean> {
  if (!text) return false;
  if (isTauriEnv) {
    try {
      await invoke('copy_text_to_clipboard', { text });
      return true;
    } catch {
      // Fall through to Web Clipboard API if available
    }
  }
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export async function listPairedBluetooth(): Promise<BluetoothDeviceItem[]> {
  if (isTauriEnv) {
    return await invoke<BluetoothDeviceItem[]>('list_paired_bluetooth');
  }
  return [];
}

export async function toggleBluetoothDevice(address: string, connect: boolean): Promise<boolean> {
  if (isTauriEnv) {
    return await invoke<boolean>('toggle_bluetooth_device', { address, connect });
  }
  return connect;
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


export interface AppUpdateCheckResult {
  currentVersion: string;
  available: boolean;
  version: string | null;
  body: string | null;
  date: string | null;
  statusKind: 'up-to-date' | 'available' | 'offline' | 'error';
  message: string;
}

export interface UpdateNotificationStatus {
  currentVersion: string;
  latestVersion: string | null;
  releaseUrl: string | null;
  releaseNotes?: string | null;
  publishedAt?: string | null;
  updateAvailable: boolean;
  badgeVisible: boolean;
}

export async function alignWindowTop(align: 'left' | 'center' | 'right'): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('align_window_top', { align });
  } catch (err) {
    console.warn('[CASA IPC] align_window_top failed:', err);
  }
}

export async function setWindowVisibility(visible: boolean): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('set_window_visibility', { visible });
  } catch (err) {
    console.warn('[CASA IPC] set_window_visibility failed:', err);
  }
}

export async function getGlobalShortcutStatus(): Promise<boolean> {
  if (!isTauriEnv) return false;
  try {
    return await invoke<boolean>('get_global_shortcut_status');
  } catch (err) {
    console.warn('[CASA IPC] get_global_shortcut_status failed:', err);
    return false;
  }
}

export async function getAutostartEnabled(): Promise<boolean> {
  if (!isTauriEnv) return false;
  try {
    return await invoke<boolean>('get_autostart_enabled');
  } catch (err) {
    console.warn('[CASA IPC] get_autostart_enabled failed:', err);
    return false;
  }
}

export async function setAutostartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauriEnv) return false;
  return await invoke<boolean>('set_autostart_enabled', { enabled });
}

export async function checkAppUpdate(): Promise<AppUpdateCheckResult> {
  if (!isTauriEnv) {
    return {
      currentVersion: '2.5.0',
      available: false,
      version: null,
      body: null,
      date: null,
      statusKind: 'offline',
      message: 'Pemeriksaan pembaruan hanya tersedia di aplikasi desktop CASA.',
    };
  }
  return await invoke<AppUpdateCheckResult>('check_app_update');
}

export async function getUpdateNotificationStatus(): Promise<UpdateNotificationStatus> {
  if (!isTauriEnv) {
    return {
      currentVersion: '2.5.0',
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      updateAvailable: false,
      badgeVisible: false,
    };
  }
  try {
    return await invoke<UpdateNotificationStatus>('get_update_notification_status');
  } catch {
    return {
      currentVersion: '2.5.0',
      latestVersion: null,
      releaseUrl: null,
      releaseNotes: null,
      publishedAt: null,
      updateAvailable: false,
      badgeVisible: false,
    };
  }
}

export async function triggerBackgroundUpdateCheck(force = false): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('trigger_background_update_check', { force });
  } catch {
    // Silent swallow for offline or transient errors
  }
}

export async function dismissUpdateBadge(): Promise<UpdateNotificationStatus | null> {
  if (!isTauriEnv) return null;
  try {
    return await invoke<UpdateNotificationStatus>('dismiss_update_badge');
  } catch {
    return null;
  }
}

export async function clearUpdateNotification(): Promise<UpdateNotificationStatus | null> {
  if (!isTauriEnv) return null;
  try {
    return await invoke<UpdateNotificationStatus>('clear_update_notification');
  } catch {
    return null;
  }
}

export async function installAppUpdate(): Promise<void> {
  if (!isTauriEnv) {
    throw new Error('Instalasi pembaruan hanya tersedia di aplikasi desktop CASA.');
  }
  await invoke('install_app_update');
}

export async function quitCasaApp(): Promise<void> {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem('casa_drop_zone_shelf_items_v1', '[]');
    }
  } catch {
    // ignore storage errors on exit
  }
  if (!isTauriEnv) return;
  try {
    await invoke('quit_app');
  } catch (err) {
    console.warn('[CASA IPC] quit_app failed:', err);
  }
}

export interface PrayerOffsetsPayload {
  fajr: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
}

export interface PrayerScheduleRequestPayload {
  latitude: number;
  longitude: number;
  countryCode?: string | null;
  method: string;
  madhab: string;
  offsets: PrayerOffsetsPayload;
}

export interface PrayerEntryItem {
  id: 'fajr' | 'dhuhr' | 'asr' | 'maghrib' | 'isha' | string;
  label: string;
  timestampMs: number;
  timeLabel: string;
  isPassed: boolean;
  isNext: boolean;
}

export interface PrayerScheduleResponse {
  dateKey: string;
  timezoneLabel: string;
  resolvedMethod: string;
  resolvedMethodLabel: string;
  madhabLabel: string;
  prayers: PrayerEntryItem[];
  nextPrayerId: string;
  nextPrayerLabel: string;
  nextPrayerTimestampMs: number;
  nextPrayerTimeLabel: string;
  nextPrayerDateKey: string;
  nextPrayerIsTomorrow: boolean;
  mostRecentPrayerId: string;
  mostRecentPrayerLabel: string;
  mostRecentPrayerTimestampMs: number;
  mostRecentPrayerDateKey: string;
}

export interface DetectedLocationResult {
  status: 'ok' | 'permission_denied' | 'service_disabled' | 'timeout' | 'unsupported' | 'error';
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  region: string | null;
  countryCode: string | null;
  accuracyMeters: number | null;
  message: string;
}

export interface CitySearchItem {
  name: string;
  region: string | null;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}

export async function getPrayerTimesNative(
  request: PrayerScheduleRequestPayload
): Promise<PrayerScheduleResponse | null> {
  if (!isTauriEnv) {
    return null;
  }
  return await invoke<PrayerScheduleResponse>('get_prayer_times', { request });
}

export async function detectWindowsLocation(): Promise<DetectedLocationResult> {
  if (!isTauriEnv) {
    return {
      status: 'unsupported',
      latitude: null,
      longitude: null,
      city: null,
      region: null,
      countryCode: null,
      accuracyMeters: null,
      message: 'Deteksi lokasi Windows hanya tersedia di aplikasi desktop CASA.',
    };
  }
  return await invoke<DetectedLocationResult>('detect_windows_location');
}

export async function searchPrayerCity(query: string): Promise<CitySearchItem[]> {
  if (!isTauriEnv) {
    return [];
  }
  return await invoke<CitySearchItem[]>('search_prayer_city', { query });
}

export async function openWindowsLocationSettings(): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('open_windows_location_settings');
  } catch (err) {
    console.warn('[CASA IPC] open_windows_location_settings failed:', err);
  }
}

export interface NativeDragDropResult {
  status: 'dropped' | 'cancelled';
  effect: number;
}

/**
 * Initiates a Win32 OLE CF_HDROP drag-out on the main STA thread.
 * Resolves with `status: 'dropped'` ONLY when OS returns DRAGDROP_S_DROP and a non-zero drop effect
 * outside CASA's own window.
 */
export async function nativeDragDropFiles(paths: string[]): Promise<NativeDragDropResult> {
  if (!isTauriEnv) {
    return { status: 'cancelled', effect: 0 };
  }
  return await invoke<NativeDragDropResult>('native_drag_drop_files', { paths });
}

/**
 * Initiates a Win32 OLE CF_UNICODETEXT (+ CF_TEXT) drag-out on the main STA thread.
 * Resolves with `status: 'dropped'` ONLY when OS returns DRAGDROP_S_DROP and a non-zero drop effect
 * outside CASA's own window.
 */
export async function nativeDragDropText(text: string): Promise<NativeDragDropResult> {
  if (!isTauriEnv) {
    return { status: 'cancelled', effect: 0 };
  }
  return await invoke<NativeDragDropResult>('native_drag_drop_text', { text });
}

/**
 * Stages raw HTML5 File bytes into CASA's ephemeral transit directory when WebView2 DOM drops
 * do not expose a native filesystem `.path`.
 */
export async function stageDroppedFile(
  fileName: string,
  dataBase64: string
): Promise<string | null> {
  if (!isTauriEnv) {
    return null;
  }
  return await invoke<string>('stage_dropped_file', { fileName, dataBase64 });
}

/**
 * Creates a uniquely named transit directory inside %USERPROFILE%\Downloads\CASA Drop
 * for folders dragged from Windows Explorer when dragDropEnabled=false.
 */
export async function createDropTransitDirectory(folderName: string): Promise<string | null> {
  if (!isTauriEnv) {
    return null;
  }
  return await invoke<string>('create_drop_transit_directory', { folderName });
}

/**
 * Writes a single file inside a previously created drop transit folder using a validated relative path.
 */
export async function saveDroppedDirectoryFile(
  rootDir: string,
  relativePath: string,
  dataBase64: string
): Promise<number> {
  if (!isTauriEnv) {
    return 0;
  }
  return await invoke<number>('save_dropped_directory_file', {
    rootDir,
    relativePath,
    dataBase64,
  });
}

/**
 * Purges ephemeral Drop Zone transit files and temporary clipboard image caches.
 */
export async function cleanupEphemeralDropZone(): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('cleanup_ephemeral_drop_zone');
  } catch (err) {
    console.warn('[CASA IPC] cleanup_ephemeral_drop_zone failed:', err);
  }
}

export async function pickDropZoneFilesNative(): Promise<string[]> {
  if (!isTauriEnv) return [];
  return await invoke<string[]>('pick_drop_zone_files');
}

export async function pickDropZoneFolderNative(): Promise<string[]> {
  if (!isTauriEnv) return [];
  return await invoke<string[]>('pick_drop_zone_folder');
}

export interface NetworkInterfaceOption {
  ip: string;
  label: string;
  isHotspot: boolean;
}

export type WindowsNetworkCategory = 'Private' | 'Public' | 'Domain' | 'Hotspot' | 'Unknown';

export interface ConnectHpSessionInfo {
  active: boolean;
  ip: string;
  port: number;
  url: string;
  qrSize: number;
  qrPath: string;
  networkCategory: WindowsNetworkCategory;
  candidateInterfaces: NetworkInterfaceOption[];
  connectedClients: number;
  autoCopyClipboard: boolean;
  idleTimeoutSecs: number;
  downloadDir: string;
  reason?: string | null;
}

export interface ConnectHpSyncItem {
  id: string;
  itemType: 'file' | 'image' | 'folder' | 'text' | 'link';
  title: string;
  extension?: string;
  sizeBytes?: number;
  fileCount?: number;
  textPayload?: string;
  localPath?: string;
}

export interface ConnectHpIncomingItemEvent {
  kind: 'text' | 'file' | 'batch_folder';
  payload: string;
  fileName?: string | null;
  sizeBytes?: number | null;
  copiedToClipboard: boolean;
  batchId?: string | null;
  fileCount?: number | null;
  batchTotal?: number | null;
}

export async function startConnectHp(
  preferredIp?: string,
  autoCopyClipboard = true
): Promise<ConnectHpSessionInfo> {
  if (!isTauriEnv) {
    return {
      active: false,
      ip: '',
      port: 0,
      url: '',
      qrSize: 0,
      qrPath: '',
      networkCategory: 'Unknown',
      candidateInterfaces: [],
      connectedClients: 0,
      autoCopyClipboard,
      idleTimeoutSecs: 600,
      downloadDir: '',
      reason: 'desktop_only',
    };
  }
  return await invoke<ConnectHpSessionInfo>('start_connect_hp', {
    preferredIp: preferredIp ?? null,
    autoCopyClipboard,
  });
}

export async function stopConnectHp(): Promise<void> {
  if (!isTauriEnv) return;
  await invoke('stop_connect_hp');
}

export async function getConnectHpStatus(): Promise<ConnectHpSessionInfo | null> {
  if (!isTauriEnv) return null;
  try {
    return await invoke<ConnectHpSessionInfo>('get_connect_hp_status');
  } catch {
    return null;
  }
}

export async function selectConnectHpInterface(
  preferredIp: string
): Promise<ConnectHpSessionInfo> {
  if (!isTauriEnv) {
    throw new Error('Desktop only');
  }
  return await invoke<ConnectHpSessionInfo>('select_connect_hp_interface', { preferredIp });
}

export async function setConnectHpAutoCopy(
  enabled: boolean
): Promise<ConnectHpSessionInfo | null> {
  if (!isTauriEnv) return null;
  return await invoke<ConnectHpSessionInfo>('set_connect_hp_auto_copy', { enabled });
}

export async function syncConnectHpItems(items: ConnectHpSyncItem[]): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('sync_connect_hp_items', { items });
  } catch (err) {
    console.warn('[CASA IPC] sync_connect_hp_items failed:', err);
  }
}

export async function openWindowsNetworkSettings(
  target: 'network' | 'hotspot' | 'firewall'
): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke('open_windows_network_settings', { target });
  } catch (err) {
    console.warn('[CASA IPC] open_windows_network_settings failed:', err);
  }
}

let lastDuckingRequested: boolean | null = null;

export async function setBackgroundAudioDucking(ducked: boolean): Promise<boolean> {
  if (!isTauriEnv) {
    lastDuckingRequested = ducked;
    return ducked;
  }
  if (lastDuckingRequested === ducked) {
    return ducked;
  }
  lastDuckingRequested = ducked;
  try {
    return await invoke<boolean>('set_background_audio_ducking', { ducked });
  } catch (err) {
    lastDuckingRequested = null;
    console.warn('[CASA Audio] set_background_audio_ducking failed:', err);
    return false;
  }
}

export async function pauseSmtcForAdzan(): Promise<string | null> {
  if (!isTauriEnv) return null;
  try {
    return await invoke<string | null>('pause_smtc_for_adzan');
  } catch (err) {
    console.warn('[CASA Audio] pause_smtc_for_adzan failed:', err);
    return null;
  }
}

export async function resumeSmtcAfterAdzan(sessionId: string): Promise<boolean> {
  if (!isTauriEnv || !sessionId) return false;
  try {
    return await invoke<boolean>('resume_smtc_after_adzan', { sessionId });
  } catch (err) {
    console.warn('[CASA Audio] resume_smtc_after_adzan failed:', err);
    return false;
  }
}

export async function playCalendarChimeNative(): Promise<boolean> {
  if (!isTauriEnv) return false;
  try {
    return await invoke<boolean>('play_calendar_chime');
  } catch (err) {
    console.warn('[CASA Audio] play_calendar_chime failed:', err);
    return false;
  }
}

export async function stopCalendarChimeNative(): Promise<void> {
  if (!isTauriEnv) return;
  try {
    await invoke<boolean>('stop_calendar_chime');
  } catch (err) {
    console.warn('[CASA Audio] stop_calendar_chime failed:', err);
  }
}
