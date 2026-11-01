/**
 * Native Audio Resolver & Search Service (CASA Hybrid Rust InnerTube + Sidecar Architecture)
 * Delegates track search and direct stream extraction to the local Tauri Rust backend:
 *  - Search: Direct YouTube Music InnerTube (`search_tracks_native`) in <250ms
 *  - Stream Tier 1: Direct InnerTube Player API (`IOS` / `ANDROID_VR`) in Rust (`resolve_track_stream`)
 *  - Stream Tier 2: Managed `yt-dlp` sidecar fallback in `%LOCALAPPDATA%`
 */

import { invoke } from '@tauri-apps/api/core';

export interface NativeTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  thumbnailUrl: string;
  albumArt?: string;
  artworkUrl?: string;
  streamUrl?: string;
  candidates?: string[];
}

interface ResolvedStreamResponse {
  videoId: string;
  durationSeconds?: number | null;
  candidates: string[];
  sourceTier: string;
}

// In-memory stream candidate cache (valid for 45 minutes) to enable 0-ms Queue Lookahead Prefetching
const streamCache = new Map<
  string,
  { candidates: string[]; durationSeconds?: number; expiresAt: number }
>();

// Tracks in-flight prefetch requests to avoid duplicate concurrent network calls
const inFlightPrefetches = new Set<string>();

/**
 * Blacklist patterns to filter out user-generated karaoke, instrumental, and unofficial covers.
 */
const BLACKLIST_PATTERNS = [
  /\bkaraoke\b/i,
  /\binstrumental\b/i,
  /\bbacking\s*track\b/i,
  /\bminus\s*one\b/i,
  /\bcover\s*by\b/i,
  /\btribute\b/i,
  /\bparody\b/i,
  /\bmashup\b/i,
  /\bslowed\b/i,
  /\breverb\b/i,
  /\bnightcore\b/i,
  /\b8d\s*audio\b/i,
  /\bpiano\s*cover\b/i,
  /\bguitar\s*cover\b/i,
];

/**
 * Checks if a track title or author contains blacklisted keywords.
 */
export function isBlacklistedTitle(title: string, author?: string): boolean {
  const combined = `${title} ${author || ''}`;
  return BLACKLIST_PATTERNS.some((pattern) => pattern.test(combined));
}

/**
 * Helper to identify and reject 30-90s preview/snippet streams (e.g. Apple AudioPreview).
 */
export function isPreviewAudioUrl(url?: string | null): boolean {
  if (!url) return false;
  return (
    url.includes('AudioPreview') ||
    url.includes('itunes.apple.com') ||
    url.includes('mzstatic.com') ||
    url.includes('preview')
  );
}

/**
 * Sanitizes and extracts clean song title and artist from raw YouTube/video titles.
 */
export function parseTrackTitleAndArtist(
  rawTitle: string,
  rawAuthor: string
): { title: string; artist: string } {
  const clean = rawTitle
    .replace(
      /\s*[\(\[](official\s*(music\s*)?video|audio|mv|official\s*audio|lyrics?|lyric\s*video|visualizer|clip\s*officiel|video\s*clip|performance\s*ver(\.\d+)?|4k|hd|remaster(?:ed)?|color\s*coded\s*lyrics?|karaoke|instrumental|backing\s*track|full\s*song)[\)\]]/gi,
      ''
    )
    .trim();

  if (clean.includes(' - ')) {
    const parts = clean.split(' - ');
    const possibleArtist = parts[0].trim();
    const possibleTitle = parts.slice(1).join(' - ').trim();
    if (possibleArtist && possibleTitle) {
      return {
        title: possibleTitle.replace(/^["']|["']$/g, '').trim(),
        artist: possibleArtist.replace(/^["']|["']$/g, '').trim(),
      };
    }
  }

  return {
    title: clean.replace(/^["']|["']$/g, '').trim() || rawTitle,
    artist:
      rawAuthor
        .replace(/\s*-\s*Topic$/i, '')
        .replace(/^["']|["']$/g, '')
        .trim() || 'Unknown Artist',
  };
}

/**
 * Searches official music tracks via the local Rust InnerTube backend (`search_tracks_native`).
 * Zero dependency on public Invidious/Piped servers; completes in <250ms with 500x500 square covers.
 */
export async function searchTracks(query: string): Promise<NativeTrack[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const tracks = await invoke<NativeTrack[]>('search_tracks_native', {
      query: trimmed,
    });

    if (Array.isArray(tracks) && tracks.length > 0) {
      return tracks
        .filter((t) => !isBlacklistedTitle(t.title, t.artist))
        .map((t) => ({
          ...t,
          artworkUrl: t.artworkUrl || t.thumbnailUrl,
        }));
    }
  } catch (err) {
    console.error('[NativeAudio] Rust search_tracks_native failed:', err);
  }

  return [];
}

/**
 * Resolves an ordered list of viable full-audio stream URLs (`itag=140` m4a / `itag=251` opus)
 * directly from the Rust Dual-Tier Resolver (`resolve_track_stream`).
 */
export async function resolveAudioCandidates(track: NativeTrack): Promise<string[]> {
  // 1. Check in-memory cache first (instant 0ms hit if pre-fetched by Queue Lookahead)
  const cached = streamCache.get(track.id);
  if (cached && cached.expiresAt > Date.now() && cached.candidates.length > 0) {
    if (cached.durationSeconds && cached.durationSeconds > 0) {
      track.durationSeconds = cached.durationSeconds;
    }
    return cached.candidates;
  }

  // 2. Invoke Rust Dual-Tier Resolver (Tier 1: InnerTube IOS/ANDROID_VR -> Tier 2: yt-dlp sidecar)
  const response = await invoke<ResolvedStreamResponse>('resolve_track_stream', {
    videoId: track.id,
    title: track.title,
    artist: track.artist,
  });

  const validCandidates = (response.candidates || []).filter(
    (url) =>
      (url.startsWith('http://127.0.0.1:') || url.startsWith('https://')) &&
      !isPreviewAudioUrl(url)
  );

  if (validCandidates.length === 0) {
    throw new Error(`Tidak ada stream audio valid untuk lagu: ${track.title}`);
  }

  if (response.durationSeconds && response.durationSeconds > 0) {
    track.durationSeconds = response.durationSeconds;
  }

  const cacheEntry = {
    candidates: validCandidates,
    durationSeconds: response.durationSeconds ?? undefined,
    expiresAt: Date.now() + 45 * 60 * 1000,
  };

  streamCache.set(track.id, cacheEntry);
  if (response.videoId && response.videoId !== track.id) {
    streamCache.set(response.videoId, cacheEntry);
    track.id = response.videoId;
  }

  console.log(
    `[NativeAudio] Resolved ${validCandidates.length} stream(s) for "${track.title}" via [${response.sourceTier}]`
  );

  return validCandidates;
}

/**
 * Resolves the primary direct audio stream URL (.m4a / .opus) for a given track.
 */
export async function resolveAudioStreamUrl(track: NativeTrack): Promise<string> {
  const candidates = await resolveAudioCandidates(track);
  return candidates[0];
}

/**
 * Queue Lookahead Prefetcher:
 * Silently pre-resolves and caches the stream URLs for the next track in the queue
 * so track transitions occur with 0-ms latency.
 */
export async function prefetchTrackStream(track?: NativeTrack | null): Promise<void> {
  if (!track || !track.id) return;

  const cached = streamCache.get(track.id);
  if (cached && cached.expiresAt > Date.now()) {
    return; // Already cached and fresh
  }

  if (inFlightPrefetches.has(track.id)) {
    return; // Already being prefetched
  }

  inFlightPrefetches.add(track.id);
  try {
    await resolveAudioCandidates(track);
    console.log(`[NativeAudio] Prefetched next queue track: "${track.title}" - ${track.artist}`);
  } catch (err) {
    console.warn(`[NativeAudio] Prefetch warning for "${track.title}":`, err);
  } finally {
    inFlightPrefetches.delete(track.id);
  }
}
