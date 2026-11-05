/**
 * radioEngine.ts
 * Auto-Radio Recommendation Engine
 * 
 * Generates continuous contextual recommendations to keep playback active:
 * - Native Source: Invokes Rust/InnerTube search with contextual queries (`${artist} similar tracks`)
 * - Spotify Source: Invokes Spotify /v1/recommendations endpoint with fallback search
 * - Deduplication: Prevents repeating tracks present in history, manual queue, or current playback.
 */

import { searchTracks, NativeTrack } from './nativeAudioService';
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
  uri?: string;
  source: 'native' | 'spotify';
  isRadio: true;
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

/**
 * Fetches auto-radio tracks for CASA Native (via Rust InnerTube backend)
 */
async function fetchNativeRadioTracks(
  currentTrack: { id?: string; title: string; artist: string },
  exclusionList: Array<{ id?: string; title: string; artist: string }>
): Promise<RadioTrackItem[]> {
  const artistName = (currentTrack.artist || '').trim();
  const rawTitle = (currentTrack.title || '').trim();
  // Strip parentheses and brackets for a cleaner search query (e.g. "XXL (Official Video)" -> "XXL")
  const cleanTitle = rawTitle.replace(/[\(\[\{].*?[\)\]\}]/g, '').trim();

  const queries: string[] = [];

  const isValidArtist =
    artistName &&
    artistName.toLowerCase() !== 'unknown artist' &&
    artistName.toLowerCase() !== 'unknown' &&
    artistName.toLowerCase() !== 'casa native player' &&
    artistName.length >= 2;

  if (isValidArtist) {
    // Format Kueri Utama: "${currentTrack.artist} popular songs official audio"
    queries.push(`${artistName} popular songs official audio`);
    // Format Kueri Alternatif: "${currentTrack.artist} best tracks"
    queries.push(`${artistName} best tracks`);
  } else {
    // DILARANG melakukan pencarian hanya dengan string ${currentTrack.title} jika panjang kata < 4 karakter atau tanpa nama artis!
    if (cleanTitle.length >= 4) {
      queries.push(`${cleanTitle} official audio`);
    } else {
      console.warn(`[radioEngine] Rejected raw short title query "${cleanTitle}" without valid artist`);
      return [];
    }
  }

  let rawCandidates: NativeTrack[] = [];

  for (const q of queries) {
    if (!q) continue;
    try {
      const results = await searchTracks(q);
      if (Array.isArray(results) && results.length > 0) {
        rawCandidates = [...rawCandidates, ...results];
        if (rawCandidates.length >= 15) break;
      }
    } catch (err) {
      console.warn(`[radioEngine] Native search failed for query "${q}":`, err);
    }
  }

  // Prioritas utama: Urutkan kandidat yang artis atau judulnya mengandung nama penyanyi aktif
  if (isValidArtist) {
    const targetArtistLower = artistName.toLowerCase();
    rawCandidates.sort((a, b) => {
      const aArtistMatch = (a.artist || '').toLowerCase().includes(targetArtistLower);
      const aTitleMatch = (a.title || '').toLowerCase().includes(targetArtistLower);
      const bArtistMatch = (b.artist || '').toLowerCase().includes(targetArtistLower);
      const bTitleMatch = (b.title || '').toLowerCase().includes(targetArtistLower);

      const aScore = (aArtistMatch ? 2 : 0) + (aTitleMatch ? 1 : 0);
      const bScore = (bArtistMatch ? 2 : 0) + (bTitleMatch ? 1 : 0);
      return bScore - aScore;
    });
  }

  const filtered: RadioTrackItem[] = [];
  const seenIds = new Set<string>();

  // Filter video kompilasi/podcast/panjang > 8 menit (480s)
  const BAD_PATTERNS = [
    /\b(?:podcast|compilation|full\s*album|1\s*hour|10\s*hours|marathon|loop|asmr|soundtrack\s*suite|ost\s*full)\b/i,
  ];

  for (const t of rawCandidates) {
    if (!t || !t.title) continue;

    // Filter durasi: Buang video berdurasi > 8 menit (480 detik) atau < 30 detik
    const dur = t.durationSeconds || 0;
    if (dur > 480 || (dur > 0 && dur < 30)) {
      continue;
    }

    // Filter pola video kompilasi/podcast
    if (BAD_PATTERNS.some((p) => p.test(t.title))) {
      continue;
    }

    // Relevansi nama: cegah judul pendek mencocokkan nama band acak (misal judul "XXL" mencocokkan "Banda XXI")
    if (isValidArtist && cleanTitle.length <= 4) {
      const normTargetArtist = artistName.toLowerCase();
      const normTrackArtist = (t.artist || '').toLowerCase();
      const normTrackTitle = (t.title || '').toLowerCase();

      if (
        !normTrackArtist.includes(normTargetArtist) &&
        !normTrackTitle.includes(normTargetArtist) &&
        normTrackArtist.includes(cleanTitle.toLowerCase())
      ) {
        continue;
      }
    }

    if (seenIds.has(t.id)) continue;
    if (isDuplicateTrack(t, exclusionList)) continue;
    if (isDuplicateTrack(t, filtered)) continue;

    seenIds.add(t.id);
    const durationSec = dur || 180;

    filtered.push({
      id: t.id,
      title: t.title,
      artist: t.artist || artistName || 'Unknown Artist',
      durationSeconds: durationSec,
      durationMs: durationSec * 1000,
      thumbnailUrl: t.thumbnailUrl || t.albumArt || '',
      albumArt: t.albumArt || t.thumbnailUrl || '',
      artworkUrl: t.artworkUrl || t.thumbnailUrl || '',
      streamUrl: t.streamUrl,
      candidates: t.candidates,
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
  currentTrack: { id?: string; title: string; artist: string; uri?: string } | null,
  source: 'native' | 'spotify',
  history: Array<{ id?: string; title: string; artist: string; uri?: string }> = [],
  existingQueue: Array<{ id?: string; title: string; artist: string; uri?: string }> = []
): Promise<RadioTrackItem[]> {
  if (!currentTrack || (!currentTrack.title && !currentTrack.artist)) {
    return [];
  }

  const exclusionList = [currentTrack, ...history, ...existingQueue];

  try {
    if (source === 'native') {
      return await fetchNativeRadioTracks(currentTrack, exclusionList);
    } else {
      return await fetchSpotifyRadioTracks(currentTrack, exclusionList);
    }
  } catch (err) {
    console.error('[radioEngine] fetchAutoRadioRecommendations error:', err);
    return [];
  }
}
