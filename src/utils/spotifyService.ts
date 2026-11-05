/**
 * Spotify Web API & User OAuth Service
 * Handles Client Credentials & User OAuth 2.0 PKCE/Loopback, Real Queue, and User Playlists.
 * Adheres to CASA Hardware Standards (Zero UI slop, clean error handling).
 */

import {
  startSpotifyLogin,
  refreshSpotifyUserToken,
  isSpotifyRunning,
  launchSpotifyProcessClean,
} from './tauriBridge';

/**
 * Mandatory Track URI Normalizer:
 * Guarantees that any raw Spotify ID or malformed URI is formatted as `spotify:track:<id>`
 * to prevent HTTP 400 Bad Request (Malformed URI) on PUT /v1/me/player/play.
 */
export function normalizeTrackUri(raw?: string): string | undefined {
  if (!raw) return undefined;
  if (raw.startsWith('spotify:track:')) return raw;
  const cleanId = raw.replace(/^spotify:[^:]+:/, '').trim();
  if (!cleanId) return undefined;
  return `spotify:track:${cleanId}`;
}

export interface SpotifyTrackItem {
  id: string;
  title: string;
  artist: string;
  album: string;
  albumArt?: string;
  durationMs: number;
  uri: string;
  albumUri?: string;
  artistUri?: string;
  albumName?: string;
}

export interface SpotifyPlaylistItem {
  id: string;
  name: string;
  description?: string;
  coverArt?: string;
  tracksTotal: number;
  uri: string;
}

// Credentials loaded safely from environment variables (.env)
export const SPOTIFY_CLIENT_ID =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SPOTIFY_CLIENT_ID) ||
  '6d0512b574044ffa8833b4d0c550a4ce';
export const SPOTIFY_CLIENT_SECRET =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SPOTIFY_CLIENT_SECRET) ||
  '';

const STORAGE_KEY_USER_ACCESS = 'casa_spotify_user_access_token';
const STORAGE_KEY_USER_REFRESH = 'casa_spotify_user_refresh_token';
const STORAGE_KEY_USER_EXPIRES = 'casa_spotify_user_expires_at';

// Automatic migration helper: Migrates legacy asaverse_* localStorage keys to casa_* keys
function migrateLegacyStorage() {
  if (typeof window === 'undefined' || !window.localStorage) return;
  const legacyMap: [string, string][] = [
    ['asaverse_spotify_user_access_token', STORAGE_KEY_USER_ACCESS],
    ['asaverse_spotify_user_refresh_token', STORAGE_KEY_USER_REFRESH],
    ['asaverse_spotify_user_expires_at', STORAGE_KEY_USER_EXPIRES],
    ['asaverse_spotify_user_token_expires', STORAGE_KEY_USER_EXPIRES],
  ];
  for (const [legacyKey, newKey] of legacyMap) {
    try {
      const val = localStorage.getItem(legacyKey);
      if (val && !localStorage.getItem(newKey)) {
        localStorage.setItem(newKey, val);
      }
    } catch {}
  }
}
migrateLegacyStorage();

// Client Credentials (guest) token cache
let guestCachedToken: { accessToken: string; expiresAt: number } | null = null;

// In-memory cache for artist top tracks
const artistTracksCache = new Map<string, SpotifyTrackItem[]>();

// In-flight guard & subscriber for cold-start Spotify wake-up
let isWakingSpotify = false;

export function getIsWakingSpotify(): boolean {
  return isWakingSpotify;
}

type WakingSubscriber = (waking: boolean, statusText?: string) => void;
const wakingSubscribers = new Set<WakingSubscriber>();

export function subscribeWakingSpotify(sub: WakingSubscriber): () => void {
  wakingSubscribers.add(sub);
  sub(isWakingSpotify);
  return () => {
    wakingSubscribers.delete(sub);
  };
}

function setWakingState(waking: boolean, statusText?: string) {
  isWakingSpotify = waking;
  wakingSubscribers.forEach((sub) => sub(waking, statusText));
}

/**
 * Pure Passive Mode: Resolves active/registered device without launching external processes.
 */
async function wakeAndAwaitActiveDevice(userToken: string): Promise<string | undefined> {
  return await getQuickDeviceId(userToken);
}

/**
 * Check if the user has connected their Spotify personal account
 */
export function isSpotifyUserConnected(): boolean {
  return typeof window !== 'undefined' && !!localStorage.getItem(STORAGE_KEY_USER_REFRESH);
}

/**
 * Disconnect Spotify user account
 */
export function disconnectSpotifyUser(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(STORAGE_KEY_USER_ACCESS);
  localStorage.removeItem(STORAGE_KEY_USER_REFRESH);
  localStorage.removeItem(STORAGE_KEY_USER_EXPIRES);
}

/**
 * Trigger OAuth 2.0 Login via Rust loopback server on 127.0.0.1:8888
 */
export async function loginSpotifyUser(): Promise<boolean> {
  try {
    const tokens = await startSpotifyLogin(SPOTIFY_CLIENT_ID, SPOTIFY_CLIENT_SECRET);
    if (tokens.access_token) {
      localStorage.setItem(STORAGE_KEY_USER_ACCESS, tokens.access_token);
      if (tokens.refresh_token) {
        localStorage.setItem(STORAGE_KEY_USER_REFRESH, tokens.refresh_token);
      }
      localStorage.setItem(
        STORAGE_KEY_USER_EXPIRES,
        (Date.now() + tokens.expires_in * 1000).toString()
      );
      return true;
    }
  } catch (err) {
    console.error('[SpotifyService] OAuth login failed:', err);
  }
  return false;
}

/**
 * Obtains a valid User Access Token, automatically refreshing if expired
 */
export async function getValidUserAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;

  const refreshToken = localStorage.getItem(STORAGE_KEY_USER_REFRESH);
  if (!refreshToken) return null;

  const currentAccess = localStorage.getItem(STORAGE_KEY_USER_ACCESS);
  const expiresAt = parseInt(localStorage.getItem(STORAGE_KEY_USER_EXPIRES) || '0', 10);

  // Still valid if at least 60 seconds remain
  if (currentAccess && Date.now() < expiresAt - 60000) {
    return currentAccess;
  }

  // Refresh expired user token via Rust backend
  try {
    const refreshed = await refreshSpotifyUserToken(
      refreshToken,
      SPOTIFY_CLIENT_ID,
      SPOTIFY_CLIENT_SECRET
    );
    if (refreshed.access_token) {
      localStorage.setItem(STORAGE_KEY_USER_ACCESS, refreshed.access_token);
      if (refreshed.refresh_token) {
        localStorage.setItem(STORAGE_KEY_USER_REFRESH, refreshed.refresh_token);
      }
      localStorage.setItem(
        STORAGE_KEY_USER_EXPIRES,
        (Date.now() + refreshed.expires_in * 1000).toString()
      );
      return refreshed.access_token;
    }
  } catch (err) {
    console.error('[SpotifyService] Auto-refresh user token failed:', err);
  }

  return null;
}

/**
 * Fallback guest Client Credentials token
 */
export async function getGuestClientCredentialsToken(): Promise<string | null> {
  if (guestCachedToken && Date.now() < guestCachedToken.expiresAt - 60000) {
    return guestCachedToken.accessToken;
  }

  try {
    const basicAuth = btoa(`${SPOTIFY_CLIENT_ID}:${SPOTIFY_CLIENT_SECRET}`);
    const response = await fetch('https://accounts.spotify.com/api/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Authorization: `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) return null;
    const data = await response.json();
    guestCachedToken = {
      accessToken: data.access_token,
      expiresAt: Date.now() + data.expires_in * 1000,
    };
    return guestCachedToken.accessToken;
  } catch (err) {
    console.error('[SpotifyService] Guest token fetch failed:', err);
    return null;
  }
}

/**
 * Returns the best available access token: User token if connected, otherwise guest token
 */
export async function getEffectiveToken(): Promise<string | null> {
  const userToken = await getValidUserAccessToken();
  if (userToken) return userToken;
  return await getGuestClientCredentialsToken();
}

/**
 * Search tracks on Spotify Web API
 */
export async function searchSpotifyTracks(
  query: string,
  limit = 5
): Promise<SpotifyTrackItem[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const token = await getEffectiveToken();
  if (!token) return [];

  try {
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      trimmed
    )}&type=track&limit=${limit}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return [];
    const json = await res.json();
    const items = json.tracks?.items || [];

    return items.map((t: any) => ({
      id: t.id,
      title: t.name,
      artist: t.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist',
      album: t.album?.name || '',
      albumArt: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url,
      durationMs: t.duration_ms,
      uri: normalizeTrackUri(t.uri || t.id) || `spotify:track:${t.id}`,
      albumUri: t.album?.uri,
      artistUri: t.artists?.[0]?.uri,
      albumName: t.album?.name,
    }));
  } catch (err) {
    console.error('[SpotifyService] Search error:', err);
    return [];
  }
}

/**
 * Retrieves top tracks for an artist (used as dynamic queue fallback)
 */
export async function getArtistTopTracks(
  artistName: string,
  limit = 5
): Promise<SpotifyTrackItem[]> {
  const cleanArtist = artistName.replace(/[&,].*$/, '').trim();
  if (!cleanArtist || cleanArtist.toLowerCase() === 'unknown artist') return [];

  const cacheKey = cleanArtist.toLowerCase();
  if (artistTracksCache.has(cacheKey)) {
    return artistTracksCache.get(cacheKey)!;
  }

  const token = await getEffectiveToken();
  if (!token) return [];

  try {
    const query = `artist:${cleanArtist}`;
    const url = `https://api.spotify.com/v1/search?q=${encodeURIComponent(
      query
    )}&type=track&limit=${limit}`;

    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });

    if (!res.ok) return searchSpotifyTracks(cleanArtist, limit);

    const json = await res.json();
    const items = json.tracks?.items || [];
    if (items.length === 0) return searchSpotifyTracks(cleanArtist, limit);

    const mapped: SpotifyTrackItem[] = items.map((t: any) => ({
      id: t.id,
      title: t.name,
      artist: t.artists?.map((a: any) => a.name).join(', ') || cleanArtist,
      album: t.album?.name || '',
      albumArt: t.album?.images?.[0]?.url || t.album?.images?.[1]?.url,
      durationMs: t.duration_ms,
      uri: normalizeTrackUri(t.uri || t.id) || `spotify:track:${t.id}`,
    }));

    artistTracksCache.set(cacheKey, mapped);
    return mapped;
  } catch (err) {
    console.debug('[SpotifyService] getArtistTopTracks error:', err);
    return [];
  }
}

/**
 * Resolves the target Spotify Connect device ID from available devices.
 * Priority:
 * 1. Active Computer device (active Windows desktop session)
 * 2. Any active device
 * 3. Inactive Computer device
 * 4. First available device
 */
export function resolveTargetDeviceId(devices: any[]): string | undefined {
  if (!Array.isArray(devices) || devices.length === 0) return undefined;

  // 1. Prioritize active computer
  const activeComputer = devices.find(
    (d) => d.is_active && d.type?.toLowerCase() === 'computer'
  );
  if (activeComputer?.id) return activeComputer.id;

  // 2. Prioritize any active device
  const anyActive = devices.find((d) => d.is_active);
  if (anyActive?.id) return anyActive.id;

  // 3. Prioritize computer device (Windows desktop session)
  const computerAny = devices.find((d) => d.type?.toLowerCase() === 'computer');
  if (computerAny?.id) return computerAny.id;

  // 4. Fallback to first available device
  return devices[0]?.id;
}

/**
 * Builds the PUT /v1/me/player/play endpoint URL with mandatory device_id query param when known.
 */
export function buildSpotifyPlayUrl(targetDeviceId?: string): string {
  if (targetDeviceId) {
    return `https://api.spotify.com/v1/me/player/play?device_id=${encodeURIComponent(targetDeviceId)}`;
  }
  return 'https://api.spotify.com/v1/me/player/play';
}

/**
 * Quick check for available Spotify Connect device ID without blocking delay
 */
export async function getQuickDeviceId(userToken: string): Promise<string | undefined> {
  try {
    const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (devRes.ok) {
      const devData = await devRes.json();
      const devices: any[] = devData.devices || [];
      return resolveTargetDeviceId(devices);
    } else {
      console.warn(`[SpotifyService] GET /me/player/devices returned HTTP ${devRes.status}`);
    }
  } catch (err) {
    console.error('[SpotifyService] getQuickDeviceId error querying devices:', err);
  }
  return undefined;
}

let lastUserPlayInitiatedTime = 0;
let lastPlayTriggeredTimestamp = 0;
let lastKnownPlaybackPositionMs = 0;
let lastPlayedTrackUri: string | null = null;

/**
 * Marks that a play command was just dispatched to activate the 800ms cold-start guard buffer.
 */
export function markPlayTriggered(timestamp?: number): void {
  lastPlayTriggeredTimestamp = timestamp || Date.now();
}

/**
 * Clears/bypasses the play guard window immediately (used when a new track starts).
 */
export function clearPlayGuardWindow(): void {
  lastPlayTriggeredTimestamp = 0;
}

/**
 * Records the URI of the last played track to discriminate between resuming and new track selection.
 */
export function setLastPlayedTrackUri(uri?: string | null): void {
  lastPlayedTrackUri = normalizeTrackUri(uri || undefined) || (uri ? uri.trim() : null);
}

/**
 * Retrieves the URI of the last played track.
 */
export function getLastPlayedTrackUri(): string | null {
  return lastPlayedTrackUri;
}

/**
 * Checks if the current time is within the 800ms guard window following a play dispatch.
 * Used to drop stale `progress_ms: 0` responses from Spotify during audio engine buffer initialization.
 */
export function isWithinPlayGuardWindow(thresholdMs = 800): boolean {
  return Date.now() - lastPlayTriggeredTimestamp < thresholdMs;
}

/**
 * Sets and synchronizes the high-watermark last known playback position in milliseconds.
 */
export function setLastKnownPositionMs(posMs: number): void {
  if (typeof posMs === 'number' && !isNaN(posMs) && posMs >= 0) {
    lastKnownPlaybackPositionMs = Math.round(posMs);
  }
}

/**
 * Retrieves the high-watermark last known playback position in milliseconds.
 */
export function getLastKnownPositionMs(): number {
  return lastKnownPlaybackPositionMs;
}

/**
 * Resolves and locks onto the active or registered Spotify Desktop device.
 * Guarantees that playback routing never hits a null sink or unintended remote device.
 */
export async function getTargetDesktopDeviceId(userToken: string): Promise<string | undefined> {
  return await getQuickDeviceId(userToken);
}

/**
 * Builds an endpoint URL with mandatory device_id query param when known.
 */
export function buildSpotifyUrlWithDevice(baseUrl: string, targetDeviceId?: string): string {
  if (targetDeviceId) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}device_id=${encodeURIComponent(targetDeviceId)}`;
  }
  return baseUrl;
}

/**
 * Session Lifecycle & Queue Hydration Timestamps
 * Tracks the authoritative cold-start session initialization vs last queue fetch
 * to strictly prevent executing stale queues and mismatched track URIs.
 */
let lastSessionInitTimestamp = 0;
let lastQueueHydrationTimestamp = 0;

export function getSessionInitTimestamp(): number {
  return lastSessionInitTimestamp;
}

export function getQueueHydrationTimestamp(): number {
  return lastQueueHydrationTimestamp;
}

export function markSessionInit(timestamp?: number): void {
  lastSessionInitTimestamp = timestamp || Date.now();
}

export function markQueueHydrated(timestamp?: number): void {
  lastQueueHydrationTimestamp = timestamp || Date.now();
}

export function isQueueStale(): boolean {
  return lastSessionInitTimestamp > 0 && lastQueueHydrationTimestamp < lastSessionInitTimestamp;
}

export interface SpotifySessionStatus {
  isReady: boolean;
  deviceId?: string;
}

/**
 * Validates that Spotify Connect has an active playback session / device ready.
 * If Spotify was just opened (cold start), polls devices and coordinates
 * handshake confirmation before allowing playback commands to fire.
 */
export async function ensureSpotifySessionReady(
  timeoutMs = 4000,
  providedToken?: string
): Promise<SpotifySessionStatus> {
  const userToken = providedToken || (await getValidUserAccessToken());
  if (!userToken) return { isReady: false };

  const startTime = Date.now();
  const pollIntervalMs = 250;

  while (Date.now() - startTime < timeoutMs) {
    try {
      const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
        headers: { Authorization: `Bearer ${userToken}` },
      });

      if (devRes.ok) {
        const data = await devRes.json();
        const devices: any[] = data.devices || [];

        // 1. Is there an active device already?
        const activeDevice = devices.find((d) => d.is_active);
        if (activeDevice?.id) {
          return { isReady: true, deviceId: activeDevice.id };
        }

        // 2. Inactive devices exist: transfer playback to activate
        const targetDeviceId = resolveTargetDeviceId(devices);
        if (targetDeviceId) {
          const currentPlayback = await getPlaybackStateSafe(userToken);
          const shouldPlay = isRecentUserPlayInitiated() || Boolean(currentPlayback?.is_playing);
          await transferPlaybackToDevice(userToken, targetDeviceId, shouldPlay);
          await new Promise((r) => setTimeout(r, 200));

          // Confirm handshake
          const verifyRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
            headers: { Authorization: `Bearer ${userToken}` },
          });
          if (verifyRes.ok) {
            const verifyData = await verifyRes.json();
            const recheck: any[] = verifyData.devices || [];
            const recheckActive = recheck.find((d) => d.is_active);
            if (recheckActive?.id) {
              return { isReady: true, deviceId: recheckActive.id };
            }
          }
        }
      }
    } catch (err) {
      console.debug('[SpotifyService] ensureSpotifySessionReady error:', err);
    }

    const elapsed = Date.now() - startTime;
    if (elapsed + pollIntervalMs >= timeoutMs) break;
    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  return { isReady: false };
}

/**
 * Marks that playback was deliberately initiated by the user (or playback is active),
 * immediately aborting any in-flight silent device activations with play: false.
 */
export function markUserInitiatedPlayback(): void {
  lastUserPlayInitiatedTime = Date.now();
  markPlayTriggered();
}

/**
 * Checks if user recently initiated playback within threshold (default 3500ms)
 */
export function isRecentUserPlayInitiated(thresholdMs = 3500): boolean {
  return Date.now() - lastUserPlayInitiatedTime < thresholdMs;
}

export interface CurrentlyPlayingDetails {
  id?: string;
  title: string;
  artist: string;
  album: string;
  albumArt?: string;
  durationMs: number;
  isPlaying: boolean;
}

/**
 * Queries Spotify Web API /v1/me/player/currently-playing to fetch high-res CDN album art and track metadata
 */
export async function getCurrentlyPlayingTrackDetails(
  providedToken?: string
): Promise<CurrentlyPlayingDetails | null> {
  const userToken = providedToken || (await getValidUserAccessToken());
  if (!userToken) return null;
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/currently-playing', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.ok && res.status !== 204) {
      const data = await res.json();
      const item = data?.item;
      if (item) {
        const albumArt =
          item.album?.images?.[0]?.url ||
          item.album?.images?.[1]?.url ||
          undefined;
        const artist =
          item.artists?.map((a: any) => a.name).join(', ') || 'Unknown Artist';
        return {
          id: item.id,
          title: item.name || '',
          artist,
          album: item.album?.name || '',
          albumArt,
          durationMs: item.duration_ms || 0,
          isPlaying: Boolean(data?.is_playing),
        };
      }
    }
  } catch (err) {
    console.debug('[SpotifyService] getCurrentlyPlayingTrackDetails error:', err);
  }
  return null;
}

export interface SpotifyPlaybackState {
  is_playing: boolean;
  device?: {
    id?: string;
    name?: string;
    type?: string;
    is_active?: boolean;
  };
  item?: {
    id?: string;
    name?: string;
    artists?: { name: string }[];
    duration_ms?: number;
  };
}

/**
 * Safely queries Spotify Web API /v1/me/player to inspect current playback state
 */
export async function getPlaybackStateSafe(
  providedToken?: string
): Promise<SpotifyPlaybackState | null> {
  const userToken = providedToken || (await getValidUserAccessToken());
  if (!userToken) return null;
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.ok && res.status !== 204) {
      const data = await res.json();
      return {
        is_playing: Boolean(data?.is_playing),
        device: data?.device,
        item: data?.item,
      };
    }
  } catch (err) {
    console.debug('[SpotifyService] getPlaybackStateSafe error:', err);
  }
  return null;
}

export interface SpotifyDeviceItem {
  id: string;
  is_active: boolean;
  is_private_session?: boolean;
  is_restricted?: boolean;
  name: string;
  type: string;
  volume_percent?: number;
}

/**
 * Fetches available Spotify Connect devices via GET /v1/me/player/devices.
 */
export async function getSpotifyDevices(
  providedToken?: string
): Promise<{ devices: SpotifyDeviceItem[] }> {
  const userToken = providedToken || (await getValidUserAccessToken());
  if (!userToken) return { devices: [] };
  try {
    const res = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.ok) {
      const data = await res.json();
      return { devices: data.devices || [] };
    }
  } catch (err) {
    console.debug('[SpotifyService] getSpotifyDevices error:', err);
  }
  return { devices: [] };
}

/**
 * Helper to identify whether a device is a browser Web Player
 */
export function isWebPlayerDevice(device: SpotifyDeviceItem): boolean {
  if (!device) return false;
  const name = (device.name || '').toLowerCase();
  const type = (device.type || '').toLowerCase();
  return (
    name.includes('web') ||
    name.includes('chrome') ||
    name.includes('edge') ||
    name.includes('brave') ||
    name.includes('firefox') ||
    name.includes('opera') ||
    (type === 'computer' && !name.startsWith('desktop-') && !name.startsWith('laptop-'))
  );
}

/**
 * Checks if there is an active Web Player device on Spotify Connect.
 */
export async function checkHasActiveWebPlayer(providedToken?: string): Promise<boolean> {
  try {
    const res = await getSpotifyDevices(providedToken);
    return res.devices.some(
      (d) => d.is_active && (isWebPlayerDevice(d) || (d.type && d.type.toLowerCase() === 'computer'))
    );
  } catch {
    return false;
  }
}

/**
 * Normalizes a media title or artist for resilient fuzzy matching.
 * Strips punctuation, special symbols, extra spaces, and converts to lowercase.
 */
export function normalizeMediaString(str?: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Verifies if the active browser session is genuinely playing Spotify Web
 * using active Web Player device detection and relaxed fuzzy matching.
 */
export async function verifyIsBrowserSpotify(
  smtcTitle?: string,
  smtcArtist?: string
): Promise<boolean> {
  if (!isSpotifyUserConnected()) return false;

  const rawTitle = (smtcTitle || '').trim();
  const lowerTitle = rawTitle.toLowerCase();

  // 1. Strict Negative Guard: Immediately reject known non-Spotify media
  if (
    lowerTitle.includes('youtube') ||
    lowerTitle.includes('youtu.be') ||
    lowerTitle.includes('twitch') ||
    lowerTitle.includes('netflix') ||
    lowerTitle.includes('bilibili') ||
    lowerTitle.includes('soundcloud')
  ) {
    return false;
  }

  try {
    // 2. Parallel inspection of Connect devices and playback state
    const [hasActiveWeb, state] = await Promise.all([
      checkHasActiveWebPlayer(),
      getPlaybackStateSafe(),
    ]);

    // 3. Positive Condition A: Device check - an active Web Player is playing
    if (hasActiveWeb && state?.is_playing) {
      return true;
    }

    // 4. Positive Condition B: Fuzzy Title & Artist Matching
    if (state?.item?.name && rawTitle) {
      const normSmtc = normalizeMediaString(`${rawTitle} ${smtcArtist || ''}`);
      const normApiTitle = normalizeMediaString(state.item.name);
      const normApiArtists = (state.item.artists || [])
        .map((a) => normalizeMediaString(a.name))
        .filter(Boolean);

      if (normApiTitle.length > 0) {
        // Direct inclusion
        if (normSmtc.includes(normApiTitle) || normApiTitle.includes(normSmtc)) {
          return true;
        }

        // Distinctive word matching for formatted/decorated titles
        const titleWords = normApiTitle.split(' ').filter((w) => w.length >= 3);
        if (titleWords.length > 0 && titleWords.some((w) => normSmtc.includes(w))) {
          return true;
        }
      }

      // Artist matching
      if (normApiArtists.some((art) => art.length > 2 && normSmtc.includes(art))) {
        return true;
      }
    }

    // 5. Positive Condition C: Active Web Player device confirmed (handles cloud state propagation latency)
    if (hasActiveWeb && (!state || state.device?.is_active)) {
      return true;
    }
  } catch (err) {
    console.debug('[SpotifyService] verifyIsBrowserSpotify error:', err);
  }

  return false;
}

/**
 * Transfers playback to a target device without starting auto-play.
 * Supports both signatures:
 * - transferPlaybackToDevice(targetDeviceId, false)
 * - transferPlaybackToDevice(userToken, targetDeviceId, false)
 */
export async function transferPlaybackToDevice(
  arg1: string,
  arg2?: string | boolean,
  arg3?: boolean
): Promise<boolean> {
  let userToken: string | null = null;
  let deviceId: string;
  let play = false;

  if (typeof arg2 === 'string') {
    userToken = arg1;
    deviceId = arg2;
    play = typeof arg3 === 'boolean' ? arg3 : false;
  } else {
    deviceId = arg1;
    play = typeof arg2 === 'boolean' ? arg2 : false;
    userToken = await getValidUserAccessToken();
  }

  if (!userToken || !deviceId) return false;

  // In-Flight Play State Adjustment: If user initiated playback, ensure device activates with play: true!
  if (!play && isRecentUserPlayInitiated()) {
    console.info('[SpotifyService] Upgrading transferPlaybackToDevice to play: true due to recent user playback.');
    play = true;
  }

  try {
    const res = await fetch('https://api.spotify.com/v1/me/player', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify({ device_ids: [deviceId], play }),
    });
    if (res.status === 204 || res.status === 200 || res.ok) {
      return true;
    }
    console.warn(`[SpotifyService] Transfer playback to device ${deviceId} returned HTTP ${res.status}`);
  } catch (err) {
    console.error('[SpotifyService] Failed to transfer playback to device:', err);
  }
  return false;
}

/**
 * Safe Device Wake-up: Checks Spotify Connect devices.
 * If NO device is active (is_active === true):
 * - If user recently initiated playback or player is already active, activates device with play: true.
 * - Otherwise (paused cold boot), silently activates device with play: false.
 * Waits 150ms for Spotify desktop to upload local queue to cloud.
 */
export async function ensureActiveDeviceSilent(providedToken?: string): Promise<boolean> {
  const userToken = providedToken || (await getValidUserAccessToken());
  if (!userToken) return false;

  try {
    const devRes = await fetch('https://api.spotify.com/v1/me/player/devices', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (!devRes.ok) return false;

    const devData = await devRes.json();
    const devices: any[] = devData.devices || [];
    if (devices.length === 0) return false;

    const hasActive = devices.some((d) => d.is_active);
    if (!hasActive) {
      const targetDevice =
        devices.find((d) => d.type && d.type.toLowerCase() === 'computer') || devices[0];
      if (targetDevice?.id) {
        // Dynamic Play-State & In-Flight Guard:
        // If user pressed play or playback is already running, activate with play: true.
        // Otherwise activate silently with play: false without auto-playing music.
        const currentPlayback = await getPlaybackStateSafe(userToken);
        const shouldPlay = isRecentUserPlayInitiated() || Boolean(currentPlayback?.is_playing);

        console.info(
          `[SpotifyService] Activating device ${targetDevice.name || targetDevice.id} (play: ${shouldPlay})`
        );
        await transferPlaybackToDevice(userToken, targetDevice.id, shouldPlay);
        // Optimized latency: 150ms for swift responsive queue hydration
        await new Promise((resolve) => setTimeout(resolve, 150));
        return true;
      }
    }
    return true;
  } catch (err) {
    console.debug('[SpotifyService] ensureActiveDeviceSilent error:', err);
    return false;
  }
}

export interface SpotifyRealQueueResult {
  contextTitle: string;
  contextUri: string | null;
  currentlyPlaying?: SpotifyTrackItem;
  tracks: SpotifyTrackItem[];
  isShuffle?: boolean;
  smartShuffle?: boolean;
}

const contextNameCache = new Map<string, string>();

/**
 * Parses raw Spotify /v1/me/player/queue payload into sanitized SpotifyTrackItem array
 */
export function parseSpotifyQueuePayload(
  queueData: any,
  playerData?: any
): {
  currentlyPlaying?: SpotifyTrackItem;
  tracks: SpotifyTrackItem[];
} {
  const mapTrack = (t: any): SpotifyTrackItem => {
    const resolvedId =
      t.id || (typeof t.uri === 'string' ? t.uri.replace('spotify:track:', '') : '');
    return {
      id: resolvedId,
      title: t.name || 'Unknown Track',
      artist:
        t.artists?.map((a: any) => a.name).filter(Boolean).join(', ') ||
        t.show?.publisher ||
        'Unknown Artist',
      album: t.album?.name || t.show?.name || '',
      albumArt:
        t.album?.images?.[0]?.url ||
        t.album?.images?.[1]?.url ||
        t.images?.[0]?.url,
      durationMs: t.duration_ms || 0,
      uri: normalizeTrackUri(t.uri || resolvedId) || `spotify:track:${resolvedId}`,
      albumUri: t.album?.uri,
      artistUri: t.artists?.[0]?.uri,
      albumName: t.album?.name || t.show?.name,
    };
  };

  const currentlyPlaying = queueData?.currently_playing
    ? mapTrack(queueData.currently_playing)
    : playerData?.item
    ? mapTrack(playerData.item)
    : undefined;

  const rawQueue = Array.isArray(queueData?.queue) ? queueData.queue : [];
  const tracks = rawQueue
    .filter((t: any) => t && (t.id || t.uri) && t.name)
    .slice(0, 20)
    .map(mapTrack);

  return { currentlyPlaying, tracks };
}

/**
 * Fetch the user's real upcoming playback queue and active context from Spotify Web API.
 * Dynamically resolves contextTitle ("Next from: <Name>" or "Next up").
 */
export async function getRealSpotifyQueue(): Promise<SpotifyRealQueueResult | null> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return null;

  const headers = { Authorization: `Bearer ${userToken}` };

  try {
    // 1. Silent Device Wake-up Sebelum Fetch Queue jika belum ada active device
    await ensureActiveDeviceSilent(userToken);

    const [playerRes, queueRes] = await Promise.all([
      fetch('https://api.spotify.com/v1/me/player', { headers }),
      fetch('https://api.spotify.com/v1/me/player/queue', { headers }),
    ]);

    let contextTitle = 'Next up';
    let contextUri: string | null = null;
    let playerData: any = null;

    if (playerRes.ok && playerRes.status !== 204) {
      try {
        playerData = await playerRes.json();
      } catch {
        playerData = null;
      }
    }

    if (playerData?.context) {
      const cType = playerData.context.type;
      const cUri = playerData.context.uri;
      contextUri = cUri || null;

      if (cType === 'playlist' && cUri) {
        if (contextNameCache.has(cUri)) {
          contextTitle = `Next from: ${contextNameCache.get(cUri)}`;
        } else {
          const cleanId = cUri.replace('spotify:playlist:', '');
          try {
            const plRes = await fetch(
              `https://api.spotify.com/v1/playlists/${cleanId}?fields=name`,
              { headers }
            );
            if (plRes.ok) {
              const plData = await plRes.json();
              if (plData.name) {
                contextNameCache.set(cUri, plData.name);
                contextTitle = `Next from: ${plData.name}`;
              } else {
                contextTitle = 'Next from: Playlist';
              }
            } else {
              contextTitle = 'Next from: Playlist';
            }
          } catch {
            contextTitle = 'Next from: Playlist';
          }
        }
      } else if (cType === 'collection' || (cUri && cUri.includes(':collection'))) {
        contextTitle = 'Next from: Liked Songs';
      } else if (cType === 'artist') {
        const artistName =
          playerData.item?.artists?.[0]?.name || 'Artist';
        contextTitle = `Next from: ${artistName}`;
      } else if (cType === 'album') {
        const albumName = playerData.item?.album?.name || 'Album';
        contextTitle = `Next from: ${albumName}`;
      } else {
        contextTitle = 'Next up';
      }
    } else {
      contextTitle = 'Next up';
    }

    let finalQueueRes = queueRes;
    if ((!finalQueueRes.ok || finalQueueRes.status === 204) && queueRes.status === 404) {
      // Sesi perangkat baru dibangun: jeda 150ms dan retry antrean 1 kali
      await new Promise((r) => setTimeout(r, 150));
      finalQueueRes = await fetch('https://api.spotify.com/v1/me/player/queue', { headers });
    }

    if (!finalQueueRes.ok || finalQueueRes.status === 204) {
      console.warn(`[SpotifyService] GET /me/player/queue returned HTTP ${finalQueueRes.status}`);
      return null;
    }
    const queueData = await finalQueueRes.json();

    const { currentlyPlaying, tracks } = parseSpotifyQueuePayload(queueData, playerData);
    const isShuffle = typeof playerData?.shuffle_state === 'boolean' ? playerData.shuffle_state : undefined;
    const smartShuffle = typeof playerData?.smart_shuffle === 'boolean' ? playerData.smart_shuffle : false;

    markQueueHydrated();

    return {
      contextTitle,
      contextUri,
      currentlyPlaying,
      tracks,
      isShuffle,
      smartShuffle,
    };
  } catch (err) {
    console.error('[SpotifyService] getRealSpotifyQueue error:', err);
    return null;
  }
}

/**
 * Retrieves high-precision progress_ms directly from Spotify Web API
 * to calibrate local playback interpolation and synchronized lyrics.
 */
export async function getSpotifyPlaybackProgressMs(): Promise<number | null> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return null;

  try {
    const res = await fetch('https://api.spotify.com/v1/me/player', {
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.ok && res.status !== 204) {
      const data = await res.json();
      if (typeof data?.progress_ms === 'number') {
        // Guard buffer: Ignore payload progress_ms: 0 within 800ms of play trigger
        if (data.progress_ms === 0 && isWithinPlayGuardWindow(800)) {
          console.debug('[SpotifyService] Guard buffer: ignoring cold-start progress_ms: 0 within 800ms window');
          return null;
        }
        setLastKnownPositionMs(data.progress_ms);
        return data.progress_ms;
      }
    }
  } catch (err) {
    console.debug('[SpotifyService] getSpotifyPlaybackProgressMs error:', err);
  }
  return null;
}

/**
 * Fetch the user's real upcoming playback queue from Spotify Web API (wrapper)
 */
export async function getSpotifyUserQueue(): Promise<{
  currentlyPlaying?: SpotifyTrackItem;
  queue: SpotifyTrackItem[];
} | null> {
  const res = await getRealSpotifyQueue();
  if (res) {
    return {
      currentlyPlaying: res.currentlyPlaying,
      queue: res.tracks,
    };
  }
  return null;
}

/**
 * Play a track selected from the Queue.
 * If activeContextUri is a playlist or album (:playlist: or :album:), plays via PUT /me/player/play with offset.
 * If activeContextUri is non-playlist (e.g. null, :artist:, or search/random), FORBID sending context_uri with offset!
 * Instead, sends { uris: [clickedTrackUri, ...remainingQueueUris] }!
 */
export async function playQueueTrack(
  track: SpotifyTrackItem,
  activeContextUri?: string | null,
  remainingQueueUris?: string[],
  isBrowser?: boolean
): Promise<boolean> {
  // Fast Session Readiness Check (Up to 1000ms without stalling playback)
  const session = await ensureSpotifySessionReady(1000);

  const isPlaylistOrAlbum = Boolean(
    activeContextUri &&
      (activeContextUri.startsWith('spotify:playlist:') ||
        activeContextUri.startsWith('spotify:album:'))
  );

  const clickedUri =
    track.uri || (track.id.startsWith('spotify:track:') ? track.id : `spotify:track:${track.id}`);

  if (isPlaylistOrAlbum && activeContextUri) {
    return executeSpotifyPlay({
      trackUri: clickedUri,
      contextUri: activeContextUri,
      deviceId: session?.deviceId,
      isNewTrack: true,
      isBrowser,
    });
  }

  // Non-Playlist Context (Random / Search / Artist / Null):
  // Send { uris: [clickedUri, ...remainingQueueUris] } without context_uri
  const subsequent = (remainingQueueUris || [])
    .map(normalizeTrackUri)
    .filter((u): u is string => Boolean(u) && u !== clickedUri);

  const uris = [clickedUri, ...subsequent];
  return executeSpotifyPlay({
    uris,
    deviceId: session?.deviceId,
    isNewTrack: true,
    isBrowser,
  });
}

/**
 * Add a track to the user's active Spotify playback queue
 */
export async function addTrackToSpotifyQueue(trackUri: string): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  const normalized = normalizeTrackUri(trackUri);
  if (!userToken || !normalized) return false;

  try {
    const url = `https://api.spotify.com/v1/me/player/queue?uri=${encodeURIComponent(normalized)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    return res.status === 204 || res.ok;
  } catch (err) {
    console.warn('[SpotifyService] addTrackToSpotifyQueue error:', err);
    return false;
  }
}

/**
 * Fetch personal playlists saved in the user's Spotify account.
 * Fixes total count parsing across various Spotify playlist structures.
 */
export async function getSpotifyUserPlaylists(limit = 20): Promise<SpotifyPlaylistItem[]> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return [];

  try {
    const url = `https://api.spotify.com/v1/me/playlists?limit=${limit}`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    if (!res.ok) return [];
    const json = await res.json();
    const items = json.items || [];

    return items.map((p: any) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      coverArt: p.images?.[0]?.url,
      tracksTotal: p.tracks?.total ?? p.items?.total ?? (p.tracks as any)?.count ?? 0,
      uri: p.uri || `spotify:playlist:${p.id}`,
    }));
  } catch (err) {
    console.debug('[SpotifyService] getSpotifyUserPlaylists error:', err);
    return [];
  }
}

/**
 * Flexible parser for Spotify playlist/library track entries.
 * Supports both legacy `entry.track` and migrated `entry.item` / direct track schemas.
 */
export function parsePlaylistTrackEntries(entries: any[]): SpotifyTrackItem[] {
  if (!Array.isArray(entries)) return [];

  return entries
    .map((entry: any) => entry?.track ?? entry?.item ?? entry)
    .filter((rawTrack: any) => rawTrack && (rawTrack.id || rawTrack.uri) && rawTrack.name)
    .map((t: any) => {
      const resolvedId =
        t.id || (typeof t.uri === 'string' ? t.uri.replace('spotify:track:', '') : '');
      return {
        id: resolvedId,
        title: t.name,
        artist:
          t.artists?.map((a: any) => a.name).filter(Boolean).join(', ') ||
          t.show?.publisher ||
          'Unknown Artist',
        album: t.album?.name || t.show?.name || '',
        albumArt:
          t.album?.images?.[0]?.url ||
          t.album?.images?.[1]?.url ||
          t.images?.[0]?.url,
        durationMs: t.duration_ms || 0,
        uri: normalizeTrackUri(t.uri || resolvedId) || `spotify:track:${resolvedId}`,
        albumUri: t.album?.uri,
        artistUri: t.artists?.[0]?.uri,
        albumName: t.album?.name || t.show?.name,
      };
    });
}

/**
 * Fetch tracks inside a specific playlist (Drill-down view) with auto-paging loop.
 * Automatically iterates through `next` URL (limit=50 per page) until all tracks are fetched.
 */
export async function getPlaylistTracks(
  playlistId: string,
  maxTracks = 250
): Promise<SpotifyTrackItem[]> {
  const token = (await getValidUserAccessToken()) ?? (await getEffectiveToken());
  if (!token) return [];

  const cleanId = playlistId.replace('spotify:playlist:', '').trim();
  const headers = { Authorization: `Bearer ${token}` };

  const allTracks: SpotifyTrackItem[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/playlists/${cleanId}/tracks?limit=50`;
  let pageCount = 0;
  const maxPages = Math.ceil(maxTracks / 50);

  while (nextUrl && pageCount < maxPages) {
    pageCount++;
    try {
      const res: Response = await fetch(nextUrl, { headers });
      if (!res.ok) {
        // Fallback on first page if /tracks fails: try /items
        if (pageCount === 1) {
          const fallbackRes: Response = await fetch(
            `https://api.spotify.com/v1/playlists/${cleanId}/items?limit=50`,
            { headers }
          );
          if (fallbackRes.ok) {
            const fallbackJson: any = await fallbackRes.json();
            const rawList =
              fallbackJson.items ?? fallbackJson.tracks?.items ?? (Array.isArray(fallbackJson) ? fallbackJson : []);
            allTracks.push(...parsePlaylistTrackEntries(rawList));
            nextUrl = fallbackJson.next || null;
            continue;
          }
        }
        console.warn(`[SpotifyService] getPlaylistTracks page ${pageCount} returned ${res.status}`);
        break;
      }

      const json: any = await res.json();
      const rawList = json.items ?? json.tracks?.items ?? (Array.isArray(json) ? json : []);
      allTracks.push(...parsePlaylistTrackEntries(rawList));

      nextUrl = json.next || null;
      if (allTracks.length >= maxTracks) break;
    } catch (err) {
      console.error(`[SpotifyService] getPlaylistTracks page ${pageCount} error:`, err);
      break;
    }
  }

  // Fallback to root playlist object `/playlists/{id}` if still empty
  if (allTracks.length === 0) {
    try {
      const rootUrl = `https://api.spotify.com/v1/playlists/${cleanId}`;
      const res3 = await fetch(rootUrl, { headers });
      if (res3.ok) {
        const data = await res3.json();
        const rawList3 =
          data.items?.items ??
          data.tracks?.items ??
          (Array.isArray(data.items) ? data.items : []) ??
          [];
        const parsed3 = parsePlaylistTrackEntries(rawList3);
        if (parsed3.length > 0) return parsed3;
      }
    } catch (err) {
      console.error('[SpotifyService] getPlaylistTracks root fallback error:', err);
    }
  }

  return allTracks;
}

/**
 * Fetch user's saved Liked Songs (Favorites collection) with auto-paging loop.
 */
export async function getLikedSongs(
  maxTracks = 250
): Promise<{ total: number; tracks: SpotifyTrackItem[] }> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return { total: 0, tracks: [] };

  const headers = { Authorization: `Bearer ${userToken}` };
  const allTracks: SpotifyTrackItem[] = [];
  let nextUrl: string | null = `https://api.spotify.com/v1/me/tracks?limit=50`;
  let reportedTotal = 0;
  let pageCount = 0;
  const maxPages = Math.ceil(maxTracks / 50);

  while (nextUrl && pageCount < maxPages) {
    pageCount++;
    try {
      const res: Response = await fetch(nextUrl, { headers });
      if (!res.ok) break;

      const json: any = await res.json();
      reportedTotal = json.total || reportedTotal;
      const items = json.items || [];
      allTracks.push(...parsePlaylistTrackEntries(items));

      nextUrl = json.next || null;
      if (allTracks.length >= maxTracks) break;
    } catch (err) {
      console.error(`[SpotifyService] getLikedSongs page ${pageCount} error:`, err);
      break;
    }
  }

  return { total: reportedTotal || allTracks.length, tracks: allTracks };
}

/**
 * Check if a track is saved in user's Liked Songs library
 */
export async function checkTrackLiked(trackId: string): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken || !trackId) return false;

  const cleanId = trackId.replace('spotify:track:', '');

  try {
    const url = `https://api.spotify.com/v1/me/tracks/contains?ids=${encodeURIComponent(cleanId)}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${userToken}` },
    });

    if (!res.ok) return false;
    const json = await res.json();
    return Array.isArray(json) && json[0] === true;
  } catch (err) {
    console.debug('[SpotifyService] checkTrackLiked error:', err);
    return false;
  }
}

/**
 * Save or remove a track from user's Liked Songs library
 */
export async function toggleTrackLiked(trackId: string, currentlyLiked: boolean): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken || !trackId) return currentlyLiked;

  const cleanId = trackId.replace('spotify:track:', '');

  try {
    const method = currentlyLiked ? 'DELETE' : 'PUT';
    const url = `https://api.spotify.com/v1/me/tracks?ids=${encodeURIComponent(cleanId)}`;
    const res = await fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${userToken}`,
      },
    });

    if (res.status === 200 || res.status === 201 || res.status === 204 || res.ok) {
      return !currentlyLiked;
    }
  } catch (err) {
    console.error('[SpotifyService] toggleTrackLiked error:', err);
  }
  return currentlyLiked;
}

export interface ExecuteSpotifyPlayOptions {
  trackUri?: string;
  contextUri?: string | null;
  uris?: string[];
  positionMs?: number;
  deviceId?: string;
  isNewTrack?: boolean;
  isBrowser?: boolean;
}

/**
 * Unified 100% Web API Spotify Playback Engine.
 * - Explicit Device Locking: Prioritizes active Spotify Connect devices (Web Player, Phone, etc.)
 *   before considering desktop app launch.
 * - Avoids forcing Spotify Desktop launch when playing within browser sessions.
 * - Track Discrimination: Strictly differentiates between "Resuming the Same Track" vs "Playing a New Track".
 * - Normalizes all track IDs/URIs to `spotify:track:<id>` via `normalizeTrackUri`.
 */
export async function executeSpotifyPlay(options: ExecuteSpotifyPlayOptions): Promise<boolean> {
  markUserInitiatedPlayback();

  function normalizeTrackUriLocal(raw?: string): string | undefined {
    if (!raw) return undefined;
    if (raw.startsWith('spotify:track:')) return raw;
    const cleanId = raw.replace(/^spotify:[^:]+:/, '').trim();
    return cleanId ? `spotify:track:${cleanId}` : undefined;
  }

  const { trackUri, contextUri, uris, positionMs, isNewTrack: explicitIsNewTrack } = options;
  const normalizedTrackUri = normalizeTrackUriLocal(trackUri);
  const normalizedUris = uris
    ?.map((u) => normalizeTrackUriLocal(u))
    .filter((u): u is string => Boolean(u));

  const targetUri = normalizedTrackUri || (normalizedUris && normalizedUris[0]) || undefined;

  // Track Discrimination: Determine if this play request is switching to a new/different track
  const isNewTrack = Boolean(
    explicitIsNewTrack ||
    (targetUri && lastPlayedTrackUri && targetUri !== lastPlayedTrackUri) ||
    (targetUri && !lastPlayedTrackUri && positionMs === undefined)
  );

  let resolvedPositionMs: number | undefined;

  if (isNewTrack) {
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    if (targetUri) {
      setLastPlayedTrackUri(targetUri);
    }
    resolvedPositionMs =
      typeof positionMs === 'number' && positionMs > 0 ? Math.round(positionMs) : undefined;
  } else {
    markPlayTriggered();
    if (targetUri) {
      setLastPlayedTrackUri(targetUri);
    }
    resolvedPositionMs =
      typeof positionMs === 'number' && positionMs >= 0
        ? Math.round(positionMs)
        : getLastKnownPositionMs() > 0
        ? getLastKnownPositionMs()
        : undefined;
  }

  const userToken = await getValidUserAccessToken();
  if (!userToken) {
    console.warn('[SpotifyService] executeSpotifyPlay: User OAuth token unavailable');
    return false;
  }

  let body: Record<string, any>;
  if (contextUri && contextUri.startsWith('spotify:')) {
    body = {
      context_uri: contextUri,
      ...(normalizedTrackUri ? { offset: { uri: normalizedTrackUri } } : {}),
      ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
    };
  } else if (normalizedUris && normalizedUris.length > 0) {
    body = {
      uris: normalizedUris,
      ...(normalizedTrackUri && normalizedUris[0] !== normalizedTrackUri
        ? { offset: { uri: normalizedTrackUri } }
        : {}),
      ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
    };
  } else if (normalizedTrackUri) {
    body = {
      uris: [normalizedTrackUri],
      ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
    };
  } else if (resolvedPositionMs !== undefined) {
    body = {
      position_ms: resolvedPositionMs,
    };
  } else {
    body = {};
  }

  const sendPlayRequest = async (targetDeviceId?: string): Promise<Response> => {
    const playUrl = buildSpotifyPlayUrl(targetDeviceId);

    const res = await fetch(playUrl, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify(body),
    });

    if (res.status === 400 && body.context_uri && normalizedTrackUri) {
      console.warn('[SpotifyService] Play with context returned 400. Retrying with direct track URI...');
      body = {
        uris: [normalizedTrackUri],
        ...(resolvedPositionMs !== undefined ? { position_ms: resolvedPositionMs } : {}),
      };
      return await fetch(playUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${userToken}`,
        },
        body: JSON.stringify(body),
      });
    }

    return res;
  };

  // STEP 1: Explicit Device Resolution & Locking
  // Check if a target deviceId was passed, or resolve from existing Spotify Connect devices (active Web Player, Desktop, Phone, etc.)
  let deviceId = options.deviceId || (await getTargetDesktopDeviceId(userToken));

  if (!deviceId) {
    const session = await ensureSpotifySessionReady(1000, userToken);
    deviceId = session.deviceId;
  }

  // STEP 2: Cold-Start Desktop App Launch ONLY if NO device exists anywhere, user is NOT in browser mode, and Spotify.exe is closed
  if (!deviceId && !options.isBrowser) {
    const osRunning = await isSpotifyRunning();
    if (!osRunning) {
      console.info('[SpotifyService] No active Spotify Connect device found and Spotify desktop is closed. Launching cleanly...');
      const launched = await launchSpotifyProcessClean(false);
      if (launched) {
        await new Promise((r) => setTimeout(r, 2000));
        const session = await ensureSpotifySessionReady(2000, userToken);
        deviceId = session.deviceId;
      }
    }
  }

  try {
    // Initial play attempt with resolved and locked deviceId
    let res = await sendPlayRequest(deviceId);
    if (res.status === 204 || res.status === 200 || res.ok) {
      return true;
    }

    // AUTO-RECOVERY ON 404 (Device inactive / sleeping in background / no active device)
    if (res.status === 404) {
      console.warn('[SpotifyService] Play returned 404 (No Active Device). Checking existing devices...');
      await new Promise((r) => setTimeout(r, 250));
      deviceId = await getTargetDesktopDeviceId(userToken);
      if (deviceId) {
        await transferPlaybackToDevice(userToken, deviceId, true);
        await new Promise((r) => setTimeout(r, 150));
        res = await sendPlayRequest(deviceId);
        if (res.status === 204 || res.status === 200 || res.ok) {
          console.info('[SpotifyService] Play recovery succeeded with active device');
          return true;
        }
        console.error(`[SpotifyService] Play retry failed with status: ${res.status}`);
      } else {
        console.error('[SpotifyService] Play recovery failed: No active device found');
      }
    }

    // RETRY LOOP FOR 502 / 503 (Transient Spotify Web API gateway errors)
    if (res.status === 502 || res.status === 503) {
      const maxRetries = 3;
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        console.warn(`[SpotifyService] Transient ${res.status} error, retry attempt ${attempt}/${maxRetries}...`);
        await new Promise((r) => setTimeout(r, 500));
        deviceId = await getTargetDesktopDeviceId(userToken);
        res = await sendPlayRequest(deviceId);
        if (res.status === 204 || res.status === 200 || res.ok) {
          return true;
        }
      }
    }

    console.error(`[SpotifyService] executeSpotifyPlay failed with final HTTP status: ${res.status}`);
    return false;
  } catch (err) {
    console.error('[SpotifyService] executeSpotifyPlay unexpected error:', err);
    return false;
  }
}

/**
 * Resumes Spotify playback with explicit position_ms and device locking.
 * Prevents Spotify from resetting to 00:00 on cold start and prevents routing to null sinks.
 */
export async function resumeSpotifyPlayback(options?: {
  positionMs?: number;
  deviceId?: string;
  trackUri?: string;
  contextUri?: string | null;
}): Promise<boolean> {
  const positionMs =
    options?.positionMs !== undefined
      ? options.positionMs
      : getLastKnownPositionMs();

  return executeSpotifyPlay({
    trackUri: options?.trackUri,
    contextUri: options?.contextUri,
    positionMs: positionMs > 0 ? positionMs : undefined,
    deviceId: options?.deviceId,
    isNewTrack: false,
  });
}

/**
 * Pauses active Spotify playback via Web API with explicit device locking.
 */
export async function pauseSpotifyPlayback(targetDeviceId?: string): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return false;

  try {
    const deviceId = targetDeviceId || (await getTargetDesktopDeviceId(userToken));
    const url = buildSpotifyUrlWithDevice('https://api.spotify.com/v1/me/player/pause', deviceId);

    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    return res.status === 204 || res.status === 200 || res.ok;
  } catch (err) {
    console.debug('[SpotifyService] pauseSpotifyPlayback error:', err);
    return false;
  }
}

/**
 * Skips to next track via Spotify Web API with explicit device locking.
 */
export async function nextSpotifyTrack(targetDeviceId?: string): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return false;

  try {
    const deviceId = targetDeviceId || (await getTargetDesktopDeviceId(userToken));
    const url = buildSpotifyUrlWithDevice('https://api.spotify.com/v1/me/player/next', deviceId);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    return res.status === 204 || res.status === 200 || res.ok;
  } catch (err) {
    console.debug('[SpotifyService] nextSpotifyTrack error:', err);
    return false;
  }
}

/**
 * Skips to previous track via Spotify Web API with explicit device locking.
 */
export async function prevSpotifyTrack(targetDeviceId?: string): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return false;

  try {
    const deviceId = targetDeviceId || (await getTargetDesktopDeviceId(userToken));
    const url = buildSpotifyUrlWithDevice('https://api.spotify.com/v1/me/player/previous', deviceId);

    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    return res.status === 204 || res.status === 200 || res.ok;
  } catch (err) {
    console.debug('[SpotifyService] prevSpotifyTrack error:', err);
    return false;
  }
}

/**
 * Smart Hybrid Context-Aware Playback.
 * Routes directly to executeSpotifyPlay for unified payload handling and cold-start wake-up.
 */
export async function playTrackWithContext(
  trackUri: string,
  contextPlaylistUri?: string,
  allTrackUris?: string[],
  isBrowser?: boolean
): Promise<boolean> {
  return executeSpotifyPlay({
    trackUri,
    contextUri: contextPlaylistUri,
    uris: allTrackUris,
    isNewTrack: true,
    isBrowser,
  });
}

/**
 * Play a single track via Smart Hybrid Playback
 */
export async function playSpotifyTrack(trackIdOrUri: string): Promise<boolean> {
  return executeSpotifyPlay({ trackUri: trackIdOrUri, isNewTrack: true });
}

/**
 * Play an entire playlist via Smart Hybrid Playback with Cold-Start Polling
 */
export async function playSpotifyPlaylist(
  playlistUri: string,
  firstTrackUri?: string
): Promise<boolean> {
  return executeSpotifyPlay({
    contextUri: playlistUri,
    trackUri: firstTrackUri,
    isNewTrack: true,
  });
}

/**
 * Seek active playback to specific position in milliseconds
 */
export async function seekSpotifyPlayback(positionMs: number): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return false;

  try {
    const url = `https://api.spotify.com/v1/me/player/seek?position_ms=${Math.max(0, Math.round(positionMs))}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.status === 403) {
      console.warn('[SpotifyService] seekSpotifyPlayback failed (403): Spotify Premium required to control playback via Web API.');
      return false;
    }
    return res.status === 204 || res.ok;
  } catch (err) {
    console.debug('[SpotifyService] seekSpotifyPlayback error:', err);
    return false;
  }
}

/**
 * Set shuffle state on Spotify playback
 */
export async function setShufflePlayback(state: boolean): Promise<boolean> {
  const userToken = await getValidUserAccessToken();
  if (!userToken) return false;

  try {
    const url = `https://api.spotify.com/v1/me/player/shuffle?state=${state}`;
    const res = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${userToken}` },
    });
    if (res.status === 403) {
      console.warn('[SpotifyService] setShufflePlayback failed (403): Spotify Premium required to control playback via Web API.');
      return false;
    }
    return res.status === 204 || res.ok;
  } catch (err) {
    console.debug('[SpotifyService] setShufflePlayback error:', err);
    return false;
  }
}
