/**
 * radioEngine.ts
 * Auto-Radio / Smart Queue Recommendation Engine (v2.1.4)
 *
 * Generates continuous contextual recommendations:
 * - Native Source: Official InnerTube `youtubei/v1/next` (Up Next / Watch Playlist) by `videoId`,
 *   with fallback to official `artistId` browse Top Songs, supporting multi-seed active session blending.
 * - Spotify Source: Spotify /v1/recommendations -> Artist Top Tracks -> clean fallback.
 * - Deduplication: Prevents repeating tracks present in active session history, manual queue, or current playback.
 */

import {
  getUpNextTracks,
  NativeTrack,
  searchTracks,
} from './nativeAudioService';
import { CasaPlayerRegion, getSettingsSnapshot } from '../stores/useSettingsStore';
import {
  getEffectiveToken,
  searchSpotifyTracks,
  SpotifyTrackItem,
} from '../utils/spotifyService';

export interface RadioTrackItem {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  durationMs: number;
  thumbnailUrl: string;
  albumArt?: string;
  artworkUrl?: string;
  streamUrl?: string;
  candidates?: string[];
  album?: string;
  albumTitle?: string;
  artistId?: string;
  uri?: string;
  source: 'native' | 'spotify';
  isRadio: true;
}

export interface AutoRadioSeed {
  id?: string;
  artistId?: string;
  title: string;
  artist: string;
  uri?: string;
  albumTitle?: string;
  isLocal?: boolean;
  source?: string;
}

export interface AutoRadioOptions {
  sessionSeeds?: AutoRadioSeed[];
  region?: CasaPlayerRegion;
  signal?: AbortSignal;
}

/**
 * Checks whether a track candidate is already in the exclusion list
 * (matches either exact ID or normalized title + artist combination).
 */
export function isDuplicateTrack(
  track: { id?: string; title: string; artist: string; uri?: string },
  exclusionList: Array<{ id?: string; title: string; artist: string; uri?: string }>
): boolean {
  if (!track || !track.title) return true;

  const normTitle = track.title
    .toLowerCase()
    .replace(/[\(\[\{].*?[\)\]\}]/g, '')
    .trim();
  const normArtist = (track.artist || '')
    .toLowerCase()
    .replace(/\s+(?:feat\.?|ft\.?|&|x)\s+.*$/i, '')
    .trim();

  return exclusionList.some((item) => {
    if (!item) return false;

    // Direct ID or URI match
    if (track.id && item.id && track.id === item.id) return true;
    if (track.uri && item.uri && track.uri === item.uri) return true;

    // Substring / Normalized text match
    const itemTitle = (item.title || '')
      .toLowerCase()
      .replace(/[\(\[\{].*?[\)\]\}]/g, '')
      .trim();
    const itemArtist = (item.artist || '')
      .toLowerCase()
      .replace(/\s+(?:feat\.?|ft\.?|&|x)\s+.*$/i, '')
      .trim();

    if (normTitle && itemTitle && normTitle === itemTitle) {
      if (!normArtist || !itemArtist || normArtist === itemArtist) {
        return true;
      }
    }

    return false;
  });
}

const YT_VIDEO_ID_RE = /^[a-zA-Z0-9_-]{11}$/;
const YT_ARTIST_ID_RE = /^UC[a-zA-Z0-9_-]{4,}$/;

function isCleanArtistName(artist?: string): boolean {
  const clean = (artist || '').trim().toLowerCase();
  return (
    Boolean(clean) &&
    clean !== 'unknown' &&
    clean !== 'unknown artist' &&
    clean !== 'local audio' &&
    clean !== 'casa native player' &&
    clean !== 'various artists' &&
    clean.length >= 2
  );
}

/**
 * Fetches auto-radio tracks for CASA Native using official InnerTube `Up Next / Watch Playlist`
 * (`videoId`) with official `artistId` browse fallback and active session multi-seed blending.
 */
async function fetchNativeRadioTracks(
  currentTrack: AutoRadioSeed,
  exclusionList: Array<{ id?: string; title: string; artist: string; uri?: string }>,
  options?: AutoRadioOptions
): Promise<RadioTrackItem[]> {
  if (options?.signal?.aborted) return [];

  const effectiveRegion =
    options?.region ??
    (() => {
      try {
        return getSettingsSnapshot().playerRegion || 'auto';
      } catch {
        return 'auto';
      }
    })();

  // Build ordered unique seed list starting with currentTrack, followed by active session seeds
  const rawSeeds: AutoRadioSeed[] = [currentTrack, ...(options?.sessionSeeds || [])];
  const orderedSeeds: AutoRadioSeed[] = [];
  for (const seed of rawSeeds) {
    if (!seed || (!seed.id && !seed.title && !seed.artist)) continue;
    if (
      orderedSeeds.some(
        (existing) =>
          (existing.id && seed.id && existing.id === seed.id) ||
          isDuplicateTrack(seed, [existing])
      )
    ) {
      continue;
    }
    orderedSeeds.push(seed);
    if (orderedSeeds.length >= 4) break;
  }

  const rawCandidates: NativeTrack[] = [];

  for (let idx = 0; idx < orderedSeeds.length; idx++) {
    if (options?.signal?.aborted) return [];
    const seed = orderedSeeds[idx];

    let videoId = seed.id && YT_VIDEO_ID_RE.test(seed.id) ? seed.id : undefined;
    let artistId = seed.artistId && YT_ARTIST_ID_RE.test(seed.artistId) ? seed.artistId : undefined;
    const artistName = isCleanArtistName(seed.artist) ? seed.artist.trim() : undefined;

    // For local audio / non-YT tracks without videoId/artistId, resolve canonical song metadata first
    if (!videoId && !artistId && seed.title) {
      const lookup = artistName ? `${artistName} ${seed.title}` : seed.title;
      const cleanLookup = lookup.replace(/[\(\[\{].*?[\)\]\}]/g, ' ').replace(/\s+/g, ' ').trim();
      if (cleanLookup.length >= 4) {
        try {
          const resolved = await searchTracks(cleanLookup, effectiveRegion);
          if (options?.signal?.aborted) return [];
          const best = resolved.find((t) => YT_VIDEO_ID_RE.test(t.id));
          if (best) {
            videoId = best.id;
            artistId = best.artistId || artistId;
          }
        } catch (err) {
          console.warn('[radioEngine] Seed videoId lookup warning:', err);
        }
      }
    }

    if (!videoId && !artistId && !artistName) {
      continue;
    }

    try {
      const related = await getUpNextTracks({
        videoId,
        artistId,
        artistName,
        region: effectiveRegion,
        limit: 12,
      });
      if (options?.signal?.aborted) return [];
      if (related.length > 0) {
        rawCandidates.push(...related);
      }
    } catch (err) {
      console.warn('[radioEngine] Native getUpNextTracks warning:', err);
    }

    // Once we have plenty of diverse candidates and already inspected up to 2 session seeds, stop early
    if (rawCandidates.length >= 12 && idx >= 1) {
      break;
    }
  }

  const filtered: RadioTrackItem[] = [];
  const seenIds = new Set<string>();
  const BAD_PATTERNS = [
    /\b(?:podcast|compilation|full\s*album|1\s*hour|10\s*hours|marathon|loop|asmr|soundtrack\s*suite|ost\s*full)\b/i,
  ];

  for (const t of rawCandidates) {
    if (!t || !t.title) continue;

    const dur = t.durationSeconds || 0;
    if (dur > 480 || (dur > 0 && dur < 30)) {
      continue;
    }

    if (BAD_PATTERNS.some((p) => p.test(t.title))) {
      continue;
    }

    if (seenIds.has(t.id)) continue;
    if (isDuplicateTrack(t, exclusionList)) continue;
    if (isDuplicateTrack(t, filtered)) continue;

    seenIds.add(t.id);
    const durationSec = dur || 180;

    filtered.push({
      id: t.id,
      title: t.title,
      artist: t.artist || currentTrack.artist || 'Unknown Artist',
      durationSeconds: durationSec,
      durationMs: durationSec * 1000,
      thumbnailUrl: t.thumbnailUrl || t.albumArt || '',
      albumArt: t.albumArt || t.thumbnailUrl || '',
      artworkUrl: t.artworkUrl || t.thumbnailUrl || '',
      streamUrl: t.streamUrl,
      candidates: t.candidates,
      album: t.albumTitle || '',
      albumTitle: t.albumTitle,
      artistId: t.artistId,
      source: 'native',
      isRadio: true,
    });

    if (filtered.length >= 5) break;
  }

  return filtered;
}

/**
 * Fetches auto-radio tracks for Spotify (via Spotify Recommendations API with search fallback)
 */
async function fetchSpotifyRadioTracks(
  currentTrack: { id?: string; title: string; artist: string; uri?: string },
  exclusionList: Array<{ id?: string; title: string; artist: string }>
): Promise<RadioTrackItem[]> {
  const token = await getEffectiveToken();
  let rawCandidates: any[] = [];

  if (token) {
    try {
      let trackId = currentTrack.id || '';
      if (trackId.includes(':')) {
        trackId = trackId.split(':').pop() || '';
      }

      const params = new URLSearchParams();
      params.set('limit', '8');

      // Only attach seed_tracks if it looks like a valid 22-char base62 Spotify ID
      if (trackId && /^[a-zA-Z0-9]{22}$/.test(trackId)) {
        params.set('seed_tracks', trackId);
      }

      if (params.has('seed_tracks')) {
        const url = `https://api.spotify.com/v1/recommendations?${params.toString()}`;
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` },
        });

        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.tracks) && data.tracks.length > 0) {
            rawCandidates = data.tracks;
          }
        }
      }
    } catch (err) {
      console.warn('[radioEngine] Spotify recommendations API failed, proceeding to fallback:', err);
    }
  }

  // Fallback: search Spotify tracks for artist recommendations
  if (rawCandidates.length === 0) {
    try {
      const artist = currentTrack.artist || '';
      const fallbackQuery = artist ? `${artist} similar` : currentTrack.title || 'Pop';
      const searchRes: SpotifyTrackItem[] = await searchSpotifyTracks(fallbackQuery, 8);
      rawCandidates = searchRes.map((t) => ({
        id: t.id,
        name: t.title,
        artists: [{ name: t.artist }],
        album: { name: t.album, images: [{ url: t.albumArt }] },
        duration_ms: t.durationMs,
        uri: t.uri,
      }));
    } catch (err) {
      console.warn('[radioEngine] Spotify fallback search failed:', err);
    }
  }

  const filtered: RadioTrackItem[] = [];
  const seenIds = new Set<string>();

  for (const t of rawCandidates) {
    const artistName = Array.isArray(t.artists)
      ? t.artists.map((a: any) => a.name).join(', ')
      : t.artist || 'Unknown Artist';

    const trackId = t.id || t.uri;
    const durationMs = t.duration_ms || t.durationMs || 180000;
    const albumArt = t.album?.images?.[0]?.url || t.albumArt || '';

    const trackItem: RadioTrackItem = {
      id: trackId,
      title: t.name || t.title || 'Unknown Track',
      artist: artistName,
      album: t.album?.name || t.album || '',
      albumArt,
      thumbnailUrl: albumArt,
      artworkUrl: albumArt,
      durationMs,
      durationSeconds: Math.round(durationMs / 1000),
      uri: t.uri || `spotify:track:${t.id}`,
      source: 'spotify',
      isRadio: true,
    };

    if (seenIds.has(trackItem.id)) continue;
    if (isDuplicateTrack(trackItem, exclusionList)) continue;
    if (isDuplicateTrack(trackItem, filtered)) continue;

    seenIds.add(trackItem.id);
    filtered.push(trackItem);

    if (filtered.length >= 5) break;
  }

  return filtered;
}

/**
 * Main Auto-Radio Recommendation Entry Point
 * 
 * @param currentTrack The currently playing track as seed
 * @param source Active audio engine source ('native' | 'spotify')
 * @param history Recent playback history to avoid repetitions
 * @param existingQueue Existing queues to avoid queuing duplicates
 */
export async function fetchAutoRadioRecommendations(
  currentTrack: AutoRadioSeed | null,
  source: 'native' | 'spotify',
  history: Array<{ id?: string; title: string; artist: string; uri?: string }> = [],
  existingQueue: Array<{ id?: string; title: string; artist: string; uri?: string }> = [],
  options?: AutoRadioOptions
): Promise<RadioTrackItem[]> {
  if (!currentTrack || (!currentTrack.title && !currentTrack.artist)) {
    return [];
  }

  const exclusionList = [currentTrack, ...history, ...existingQueue];

  try {
    if (source === 'native') {
      return await fetchNativeRadioTracks(currentTrack, exclusionList, options);
    } else {
      return await fetchSpotifyRadioTracks(currentTrack, exclusionList);
    }
  } catch (err) {
    console.error('[radioEngine] fetchAutoRadioRecommendations error:', err);
    return [];
  }
}
