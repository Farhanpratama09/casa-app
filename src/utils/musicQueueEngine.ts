/**
 * musicQueueEngine.ts
 * Title-First Track Metadata Normalizer, Identity Keying & Deterministic Smart Queue Engine
 */

import { NativeTrack } from '../services/nativeAudioService';

export type RepeatMode = 'off' | 'all' | 'one';

export interface MusicTrackLike {
  id?: string;
  title?: string;
  name?: string;
  artist?: string;
  duration?: number;
  durationSeconds?: number;
  durationMs?: number;
  thumbnailUrl?: string;
  albumArt?: string;
  artworkUrl?: string;
  streamUrl?: string;
  url?: string;
  path?: string;
  candidates?: string[];
  album?: string;
  albumName?: string;
  albumTitle?: string;
  uri?: string;
  artistId?: string;
  browseId?: string;
  playlistId?: string;
  source?: 'native' | 'spotify' | 'local';
  isLocal?: boolean;
  isRadio?: boolean;
  isSmartQueue?: boolean;
  addedAt?: number;
  playedDuringFocus?: boolean;
}

export interface NormalizedMusicTrack extends NativeTrack {
  normalizedTitle: string;
  normalizedArtist: string;
  trackPairKey: string;
  duration: number;
  durationMs: number;
  url?: string;
  path?: string;
  album?: string;
  uri?: string;
  source: 'native' | 'spotify' | 'local';
  isLocal: boolean;
  isRadio?: boolean;
  isSmartQueue?: boolean;
  addedAt?: number;
  playedDuringFocus?: boolean;
}

const AUDIO_EXTENSION_REGEX = /\.(?:mp3|wav|flac|m4a|ogg|aac|opus|wma|webm)$/i;

// Strips "01 - ", "01. ", "01_ ", "[01] ", "(01) ", "1) " without touching song titles like "21 Guns" or "1979"
const LEADING_TRACK_NUMBER_REGEX =
  /^\s*(?:\[\d{1,3}\]|\(\d{1,3}\)|\d{1,3}(?:[.)]|(?:\s*[-_]\s*)))\s*/;

const VIDEO_NOISE_TAG_REGEX =
  /\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|official\s*lyric\s*video|official\s*mv|audio|mv|lyrics?|lyric\s*video|visualizer|clip\s*officiel|video\s*clip|performance\s*ver(?:\.\d+)?|4k|hd|uhd|hq|full\s*song|color\s*coded\s*lyrics?)[\)\]]/gi;

const VERSION_SUFFIX_REGEX =
  /^(?:radio\s*edit|acoustic(?:\s*version)?|live(?:\s*at\s*.*)?|remix|remaster(?:ed)?(?:\s*\d{4})?|instrumental|demo|sped\s*up|slowed(?:\s*\+\s*reverb)?|explicit|clean|edit|ver\.?|version|ost|from\s+.*)$/i;

const GENERIC_ARTIST_NAMES = new Set([
  '',
  'unknown',
  'unknown artist',
  'local audio',
  'local file',
  'casa player',
  'casa native player',
  'various artists',
  'youtube',
  'no media playing',
  'pilih lagu atau putar media',
]);

export function normalizeTextForKey(raw?: string | null): string {
  return (raw || '')
    .toLowerCase()
    .replace(AUDIO_EXTENSION_REGEX, '')
    .replace(/[\(\[\{].*?[\)\]\}]/g, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isGenericArtistName(raw?: string | null): boolean {
  return GENERIC_ARTIST_NAMES.has((raw || '').trim().toLowerCase());
}

/**
 * Strips audio extension, leading track numbers, and redundant video noise tags.
 */
export function stripFilenameNoise(raw: string): string {
  let clean = (raw || '').trim();
  clean = clean.replace(AUDIO_EXTENSION_REGEX, '').trim();
  // Strip underscores used instead of spaces only when no normal spaces exist
  if (!clean.includes(' ') && clean.includes('_')) {
    clean = clean.replace(/_/g, ' ').trim();
  }
  // Iteratively strip leading track number (e.g. "01 - 02. Song" or "01 - Song")
  for (let pass = 0; pass < 2; pass++) {
    const stripped = clean.replace(LEADING_TRACK_NUMBER_REGEX, '').trim();
    if (!stripped || stripped === clean) break;
    clean = stripped;
  }
  clean = clean.replace(VIDEO_NOISE_TAG_REGEX, '').trim();
  return clean.replace(/^["']|["']$/g, '').trim();
}

/**
 * Normalizes any track (local audio file, search result, playlist track, Spotify item)
 * guaranteeing Title-First semantics (`title` = actual song title, never raw filename or artist).
 */
export function normalizeTrackMetadata(
  raw: MusicTrackLike,
  options?: { isLocal?: boolean }
): NormalizedMusicTrack {
  const isLocal = Boolean(
    options?.isLocal ||
      raw.isLocal ||
      raw.source === 'local' ||
      Boolean(raw.path) ||
      (raw.id && raw.id.startsWith('local-')) ||
      (raw.streamUrl && (raw.streamUrl.startsWith('blob:') || raw.streamUrl.startsWith('file://'))) ||
      (raw.url && (raw.url.startsWith('blob:') || raw.url.startsWith('file://')))
  );

  const rawTitleInput = (raw.title || raw.name || 'Untitled Track').trim();
  let artistCandidate = (raw.artist || '')
    .replace(/\s*-\s*Topic$/i, '')
    .replace(/^["']|["']$/g, '')
    .trim();

  if (isLocal && !artistCandidate) {
    artistCandidate = 'Local Audio';
  }

  let cleanTitle = stripFilenameNoise(rawTitleInput);

  // Split "Artist - Title" / "Artist — Title" pattern when applicable
  const sepMatch = cleanTitle.match(/^(.+?)\s+[-—–]\s+(.+)$/);
  if (sepMatch) {
    const leftPart = sepMatch[1].trim();
    const rightPart = sepMatch[2].trim();

    if (leftPart && rightPart && !VERSION_SUFFIX_REGEX.test(rightPart)) {
      // If left side matches known artist OR current artist is missing/generic (typical local file / YouTube title),
      // leftPart is the Artist and rightPart is the real Song Title.
      const leftNorm = normalizeTextForKey(leftPart);
      const artistNorm = normalizeTextForKey(artistCandidate);

      if (isGenericArtistName(artistCandidate)) {
        artistCandidate = leftPart;
        cleanTitle = stripFilenameNoise(rightPart) || rightPart;
      } else if (artistNorm && leftNorm === artistNorm) {
        cleanTitle = stripFilenameNoise(rightPart) || rightPart;
      } else if (isLocal) {
        artistCandidate = leftPart;
        cleanTitle = stripFilenameNoise(rightPart) || rightPart;
      }
    }
  }

  // Secondary guard: if title accidentally starts with "Artist: Title"
  if (!isGenericArtistName(artistCandidate)) {
    const escaped = artistCandidate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const prefixRegex = new RegExp(`^${escaped}\\s*[:\\-]\\s+`, 'i');
    const withoutPrefix = cleanTitle.replace(prefixRegex, '').trim();
    if (withoutPrefix) {
      cleanTitle = withoutPrefix;
    }
  }

  const finalTitle = cleanTitle || stripFilenameNoise(rawTitleInput) || 'Untitled Track';
  const finalArtist =
    artistCandidate || (isLocal ? 'Local Audio' : 'Unknown Artist');

  const normalizedTitle = normalizeTextForKey(finalTitle);
  const normalizedArtist = isGenericArtistName(finalArtist)
    ? ''
    : normalizeTextForKey(finalArtist);

  const trackPairKey = normalizedArtist
    ? `${normalizedTitle}::${normalizedArtist}`
    : normalizedTitle;

  const durationSec =
    typeof raw.durationSeconds === 'number' && Number.isFinite(raw.durationSeconds)
      ? Math.max(0, Math.round(raw.durationSeconds))
      : typeof raw.duration === 'number' && Number.isFinite(raw.duration)
      ? Math.max(0, Math.round(raw.duration))
      : typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs)
      ? Math.max(0, Math.round(raw.durationMs / 1000))
      : 0;

  const durationMs =
    typeof raw.durationMs === 'number' && Number.isFinite(raw.durationMs) && raw.durationMs > 0
      ? raw.durationMs
      : durationSec * 1000;

  const art = raw.thumbnailUrl || raw.albumArt || raw.artworkUrl || '';
  const source: 'native' | 'spotify' | 'local' = isLocal
    ? 'local'
    : raw.source || 'native';
  const resolvedStreamUrl = raw.streamUrl || raw.url || raw.path || undefined;
  const resolvedUrl = raw.url || raw.streamUrl || raw.path || raw.uri || undefined;

  const id =
    (raw.id && raw.id.trim()) ||
    raw.uri ||
    raw.path ||
    `${isLocal ? 'local' : 'trk'}-${trackPairKey || Date.now().toString(36)}`;

  return {
    id,
    title: finalTitle,
    artist: finalArtist,
    normalizedTitle,
    normalizedArtist,
    trackPairKey,
    duration: durationSec,
    durationSeconds: durationSec,
    durationMs,
    thumbnailUrl: art,
    albumArt: art,
    artworkUrl: art,
    streamUrl: resolvedStreamUrl,
    url: resolvedUrl,
    path: raw.path,
    candidates: raw.candidates,
    album: raw.album || raw.albumName || raw.albumTitle || '',
    albumTitle: raw.albumTitle || raw.album || raw.albumName || undefined,
    artistId: raw.artistId,
    browseId: raw.browseId,
    playlistId: raw.playlistId,
    uri: raw.uri,
    source,
    isLocal,
    isRadio: Boolean(raw.isRadio || raw.isSmartQueue),
    isSmartQueue: Boolean(raw.isSmartQueue || raw.isRadio),
    addedAt: raw.addedAt,
    playedDuringFocus: raw.playedDuringFocus,
  };
}

/**
 * Normalizes any track candidate (local audio, InnerTube native search result, or Spotify track)
 * into a unified payload guaranteed to carry consistent `id`, `title`, `artist`, `duration`, and `url`.
 */
export function normalizeTrackForPlaylist(
  raw: MusicTrackLike,
  options?: { isLocal?: boolean; addedAt?: number }
): NormalizedMusicTrack {
  const norm = normalizeTrackMetadata(raw, options);
  return {
    ...norm,
    addedAt: options?.addedAt ?? norm.addedAt ?? Date.now(),
  };
}

/**
 * Generates unique track identity key (`id` or `normalizedTitle::normalizedArtist`).
 * Never keys solely on artist so multiple songs by the same artist stay distinct.
 */
export function getTrackIdentityKey(track: MusicTrackLike): string {
  const norm = normalizeTrackMetadata(track);
  if (norm.id && !norm.id.startsWith('local-')) {
    return `id:${norm.id}`;
  }
  return `meta:${norm.trackPairKey || norm.id}`;
}

/**
 * Checks whether two tracks refer to the exact same song using `id` and `(normalizedTitle + normalizedArtist)`.
 * Never matches two different songs just because they share an artist.
 */
export function isSameTrack(
  a?: MusicTrackLike | null,
  b?: MusicTrackLike | null
): boolean {
  if (!a || !b) return false;
  if (a.id && b.id && a.id === b.id) return true;
  if (a.uri && b.uri && a.uri === b.uri) return true;

  const normA = normalizeTrackMetadata(a);
  const normB = normalizeTrackMetadata(b);

  if (!normA.normalizedTitle || !normB.normalizedTitle) return false;
  if (normA.normalizedTitle !== normB.normalizedTitle) return false;

  // Same title: require artist match when both have valid non-generic artists
  if (normA.normalizedArtist && normB.normalizedArtist) {
    return normA.normalizedArtist === normB.normalizedArtist;
  }

  // If one/both are local files with identical normalized title & missing artist metadata
  return normA.normalizedArtist === normB.normalizedArtist;
}

/**
 * Pure Fisher-Yates shuffle algorithm.
 */
export function fisherYatesShuffle<T>(items: T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

export interface OrderedQueueResult {
  currentTrack: NormalizedMusicTrack | null;
  upNext: NormalizedMusicTrack[];
  fullQueue: NormalizedMusicTrack[];
}

/**
 * Builds deterministic queue ordering when clicking a track in a playlist, local batch, or single track:
 * - Clicked track always becomes the first active track.
 * - Remaining tracks preserve sequential order (`after`, and only wraps `before` when `wrapAround: true`).
 * - When Shuffle is enabled, applies Fisher-Yates ONLY to `upNext`, keeping `currentTrack` untouched.
 */
export function buildOrderedQueue(
  tracks: MusicTrackLike[],
  clickedIndexOrTrack: number | MusicTrackLike,
  isShuffle: boolean = false,
  options?: { wrapAround?: boolean }
): OrderedQueueResult {
  if (!tracks || tracks.length === 0) {
    return { currentTrack: null, upNext: [], fullQueue: [] };
  }

  const normalized = tracks.map((t) => normalizeTrackMetadata(t));
  let startIndex = 0;

  if (typeof clickedIndexOrTrack === 'number') {
    if (clickedIndexOrTrack >= 0 && clickedIndexOrTrack < normalized.length) {
      startIndex = clickedIndexOrTrack;
    }
  } else {
    const foundIdx = normalized.findIndex((t) => isSameTrack(t, clickedIndexOrTrack));
    if (foundIdx >= 0) {
      startIndex = foundIdx;
    } else {
      const target = normalizeTrackMetadata(clickedIndexOrTrack);
      const rest = normalized.filter((t) => !isSameTrack(t, target));
      const upNext = isShuffle ? fisherYatesShuffle(rest) : rest;
      return {
        currentTrack: target,
        upNext,
        fullQueue: [target, ...upNext],
      };
    }
  }

  const currentTrack = normalized[startIndex];
  const shouldWrap = Boolean(options?.wrapAround);
  const sequentialCandidates = shouldWrap
    ? [...normalized.slice(startIndex + 1), ...normalized.slice(0, startIndex)]
    : normalized.slice(startIndex + 1);

  // Deduplicate remaining tracks while preserving exact sequential order
  const sequentialRest: NormalizedMusicTrack[] = [];
  for (const candidate of sequentialCandidates) {
    if (isSameTrack(candidate, currentTrack)) continue;
    if (sequentialRest.some((existing) => isSameTrack(existing, candidate))) continue;
    sequentialRest.push(candidate);
  }

  const upNext = isShuffle ? fisherYatesShuffle(sequentialRest) : sequentialRest;
  return {
    currentTrack,
    upNext,
    fullQueue: [currentTrack, ...upNext],
  };
}

export function shouldTriggerSmartFill(params: {
  currentTrack: MusicTrackLike | null;
  manualQueueLength: number;
  smartQueueLength: number;
  repeatMode: RepeatMode;
}): boolean {
  return (
    Boolean(params.currentTrack) &&
    params.repeatMode === 'off' &&
    params.manualQueueLength < 2 &&
    params.smartQueueLength < 5
  );
}

const CALM_FOCUS_VIBE_REGEX =
  /\b(lofi|lo-fi|chill|ambient|instrumental|acoustic|piano|focus|study|sleep|rain|jazz|calm|soft)\b/i;

export function selectSmartFillCandidates(params: {
  seedTrack: MusicTrackLike;
  candidatePool: Array<MusicTrackLike & { score?: number; playCount?: number }>;
  exclusionList: MusicTrackLike[];
  maxCount?: number;
}): NormalizedMusicTrack[] {
  const { seedTrack, candidatePool, exclusionList, maxCount = 5 } = params;
  if (!seedTrack || maxCount <= 0 || !candidatePool.length) return [];

  const seedNorm = normalizeTrackMetadata(seedTrack);
  const seedIsCalm = CALM_FOCUS_VIBE_REGEX.test(`${seedNorm.title} ${seedNorm.artist}`);

  const scored: Array<{ track: NormalizedMusicTrack; rank: number }> = [];

  for (const rawCandidate of candidatePool) {
    const candidate = normalizeTrackMetadata(rawCandidate);
    if (isSameTrack(candidate, seedNorm)) continue;
    if (exclusionList.some((ex) => isSameTrack(candidate, ex))) continue;
    if (scored.some((item) => isSameTrack(item.track, candidate))) continue;

    // Avoid resurrecting expired/unplayable blob local files unless same session streamUrl exists or online fallback
    let rank = 0;
    if (
      seedNorm.normalizedArtist &&
      candidate.normalizedArtist &&
      seedNorm.normalizedArtist === candidate.normalizedArtist
    ) {
      rank += 12;
    }

    const candIsCalm = CALM_FOCUS_VIBE_REGEX.test(`${candidate.title} ${candidate.artist}`);
    if (seedIsCalm && candIsCalm) {
      rank += 5;
    }

    if (typeof rawCandidate.score === 'number') {
      rank += Math.min(6, rawCandidate.score);
    }
    if (typeof rawCandidate.playCount === 'number') {
      rank += Math.min(4, rawCandidate.playCount);
    }
    if (!candidate.isLocal || Boolean(candidate.streamUrl)) {
      rank += 2;
    }

    scored.push({
      track: {
        ...candidate,
        isRadio: true,
        isSmartQueue: true,
      },
      rank,
    });
  }

  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, maxCount).map((item) => item.track);
}
