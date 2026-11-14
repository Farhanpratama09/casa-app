/**
 * LRCLIB Synced Lyrics Service (CASA Edition)
 * Fetches time-synced lyrics from public LRCLIB API with local in-memory caching.
 * Adheres to CASA Hardware Standards (Zero UI slop, pure zero-offset synchronization).
 */

export interface LyricLine {
  id: string;
  time: number; // in seconds
  timeMs: number; // in milliseconds for 60FPS high precision
  text: string;
}

export interface LyricResult {
  lines: LyricLine[];
  isSynced: boolean;
  syncType?: 'synced' | 'plain' | 'none';
  isInstrumental?: boolean;
  trackDuration?: number;
  offsetSeconds?: number;
}

export interface ActiveLyrics {
  prev?: string;
  current?: string;
  next?: string;
}

// In-memory cache for fetched songs to eliminate redundant network roundtrips
const lyricsCache = new Map<string, LyricResult>();
const globalLyricsByTrackCache = new Map<string, LyricResult>();
const inFlightLyricsRequests = new Map<string, Promise<LyricResult>>();

/**
 * Sanitizes YouTube / Web Audio title strings by removing video artifacts, tags, and MV noise:
 * - Video/Audio descriptors: (Official Audio), (Official Video), (Lyric Video), [Visualizer], etc.
 * - Version/Edition tags: (Explicit Ver.), (Clean Ver.), (Remastered), (2021 Remaster), (Single), (EP), etc.
 * - Suffix tags: - Single, - EP, - Single Version, - Remastered, - Official Audio, etc.
 * - MV tokens: [MV], [Official MV], M/V, etc.
 */
export function cleanTrackTitleForLyrics(rawTitle: string): string {
  if (!rawTitle) return '';
  const title = rawTitle
    // 1. Remove video/lyric descriptors in parentheses / brackets
    .replace(
      /\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|official\s*mv|music\s*video|official\s*lyric\s*video|official\s*lyrics\s*video|lyric\s*video|lyrics\s*video|visualizer|audio|hd|4k(?:\s*remaster(?:ed)?)?)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*[\(\[](?:(?:easy\s*)?lyrics?|color\s*coded(?:\s*lyrics?)?|with\s*lyrics?|lirik\s*(?:lagu)?|eng\s*sub(?:titles?)?|indo\s*sub|sub\s*(?:indo|eng|esp|spa)|terjemahan|lyrics?\/[^\)\]]+|han\/rom\/eng|han\/rom\/ina)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*[\(\[](?:slowed\s*(?:\+|&|and)?\s*reverb|slowed|reverb|sped\s*up|speed\s*up(?:\s*version)?|tiktok(?:\s*version)?|viral\s*tiktok|nightcore|8d\s*audio|3d\s*audio|bass\s*boosted)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*[\(\[](?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|explicit|clean|studio|deluxe(?:\s*edition)?|bonus(?:\s*track)?|radio\s*edit|mono|stereo|ver|version|single|ep|acoustic|album\s*version|performance\s*video|special\s*clip|karaoke|instrumental|backing\s*track|minus\s*one|live(?:\s+at[^\)\]]*)?)[^\)\]]*[\)\]]/gi,
      ''
    )
    // 2. Remove trailing suffix separators: "| Lyrics", "// Lyrics", "- Lyrics", "- Lyric Video", "| Official Video", "- Remastered", "- Live", etc.
    .replace(
      /\s*(?:\|\s*|\/\/\s*|\s-\s*)(?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|deluxe(?:\s*edition)?|bonus(?:\s*track)?|official\s*(?:music\s*)?video|music\s*video|official\s*audio|mv|m\/v|(?:easy\s*)?lyrics?|color\s*coded(?:\s*lyrics?)?|lirik\s*(?:lagu)?|audio|terjemahan|live(?:\s+at[^-–—|]+)?).*$/gi,
      ''
    )
    .replace(/\s+\b(?:m\/v|mv)\b$/gi, '')
    // 3. Remove featuring tokens: (feat. ...), [feat. ...], feat. ..., ft. ...
    .replace(/\s*[\(\[](?:feat|ft|featuring|with)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\b(?:feat|ft|featuring|with)\b.*$/gi, '')
    // 4. Remove leftover brackets e.g. [ ... ] or ( ... ) containing video/lyrics noise
    .replace(/\s*\[[^\]]*(?:mv|video|audio|4k|hd|clip|live|lyric|sub|ver|remaster)[^\]]*\]/gi, '')
    .replace(/\s*\([^)]*(?:mv|video|audio|4k|hd|clip|live|lyric|sub|ver|remaster)[^)]*\)/gi, '')
    // 5. Clean Japanese / Korean quotation brackets e.g. 「Title」 or 『Title』
    .replace(/^[「『](.+)[」』]$/g, '$1')
    .replace(/^[“"'](.+)["”']$/g, '$1')
    // 6. Collapse spaces and trim
    .replace(/\s+/g, ' ')
    .trim();

  return title || rawTitle.trim();
}

/**
 * Legacy alias for cleanTrackTitleForLyrics
 */
export function sanitizeTrackTitleForSearch(title: string): string {
  return cleanTrackTitleForLyrics(title);
}

/**
 * Helper parser waktu lirik:
 * Menjamin timestamp yang dikonversi selalu berupa detik numerik murni (float).
 * Menangani string "mm:ss.xx", "hh:mm:ss", atau angka detik float murni (tanpa heuristik > 1000).
 */
export function parseTimeToSeconds(rawTime: string | number | undefined | null): number {
  if (rawTime === undefined || rawTime === null) return 0;

  if (typeof rawTime === 'number') {
    if (isNaN(rawTime) || !isFinite(rawTime) || rawTime < 0) return 0;
    return rawTime;
  }

  if (typeof rawTime === 'string') {
    const trimmed = rawTime.trim();
    if (!trimmed) return 0;

    const parts = trimmed.split(':');
    if (parts.length === 2) {
      const minutes = parseFloat(parts[0]);
      const seconds = parseFloat(parts[1]);
      if (!isNaN(minutes) && !isNaN(seconds)) {
        return Math.max(0, minutes * 60 + seconds);
      }
    } else if (parts.length === 3) {
      const hours = parseFloat(parts[0]);
      const minutes = parseFloat(parts[1]);
      const seconds = parseFloat(parts[2]);
      if (!isNaN(hours) && !isNaN(minutes) && !isNaN(seconds)) {
        return Math.max(0, hours * 3600 + minutes * 60 + seconds);
      }
    }

    const parsedNum = parseFloat(trimmed);
    if (!isNaN(parsedNum) && isFinite(parsedNum) && parsedNum >= 0) {
      return parsedNum;
    }
  }

  return 0;
}

/**
 * Extracts the primary performing artist by stripping featuring credits,
 * "- Topic" suffixes, and multi-artist separators (comma, &, +, ;, feat., ft., x).
 */
export function extractPrimaryArtistName(artist: string): string {
  if (!artist) return '';
  return artist
    .replace(/\s*[\(\[](?:feat\.?|ft\.?|featuring|with)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\b(?:feat\.?|ft\.?|featuring|with)\b.*$/gi, '')
    .replace(/[-–—]\s*topic$/i, '')
    .split(/\s*(?:,|&|;|\+|\sx\s|×)\s*/i)[0]
    .trim();
}

/**
 * Sanitizes artist name for LRCLIB search queries by removing featuring noise
 * and extracting the primary performing artist.
 */
export function sanitizeArtistNameForSearch(artist: string): string {
  return extractPrimaryArtistName(artist);
}

const GENERIC_ARTIST_NAMES = new Set([
  'unknown',
  'unknown artist',
  'pilih lagu atau putar media',
  'no media playing',
  'no media active',
  'youtube',
  'youtube music',
  'chrome',
  'google chrome',
  'edge',
  'microsoft edge',
  'msedge',
  'firefox',
  'mozilla firefox',
  'brave',
  'opera',
  'vivaldi',
  'arc',
  'safari',
  'browser',
  'spotify',
  'spotify free',
  'spotify premium',
  'casa player',
  'casa native player',
]);

export function isGenericArtistPlaceholder(name?: string | null): boolean {
  const lower = (name || '').trim().toLowerCase();
  if (!lower) return true;
  if (GENERIC_ARTIST_NAMES.has(lower)) return true;
  return lower.includes('vevo') || lower.endsWith('- topic');
}

/**
 * Extracts clean song title and performing artist from combined YouTube metadata.
 * Handles "Artist - Title", "Artist : Title", "Artist 'Song'", and strips generic channel/browser placeholders.
 */
export function parseTrackAndArtist(
  rawTitle: string,
  rawArtist: string
): { title: string; artist: string } {
  const cleanedTitle = cleanTrackTitleForLyrics(rawTitle);
  const cleanArtist = sanitizeArtistNameForSearch(rawArtist);

  const isGenericArtist = isGenericArtistPlaceholder(cleanArtist);

  // Look for "Artist - Title" or "Artist : Title"
  const separatorMatch = cleanedTitle.match(/^([^-–—:|]+)\s*[-–—:|]\s*(.+)$/);
  if (separatorMatch) {
    const leftPart = separatorMatch[1].trim();
    const rightPart = separatorMatch[2].trim();
    const hasSpacedOrStrongSep = /\s[-–—:|]|[-–—:|]\s|[–—:|]/.test(cleanedTitle);

    if (leftPart && rightPart) {
      if (isGenericArtist) {
        if (hasSpacedOrStrongSep) {
          return {
            title: cleanTrackTitleForLyrics(rightPart),
            artist: sanitizeArtistNameForSearch(leftPart),
          };
        }
      } else {
        const leftSim = calculateMetadataSimilarity(leftPart, cleanArtist);
        const rightSim = calculateMetadataSimilarity(rightPart, cleanArtist);

        if (
          leftSim >= 0.5 ||
          cleanArtist.toLowerCase().includes(leftPart.toLowerCase()) ||
          leftPart.toLowerCase().includes(cleanArtist.toLowerCase())
        ) {
          return {
            title: cleanTrackTitleForLyrics(rightPart),
            artist: sanitizeArtistNameForSearch(leftPart),
          };
        } else if (rightSim >= 0.5) {
          return {
            title: cleanTrackTitleForLyrics(leftPart),
            artist: sanitizeArtistNameForSearch(rightPart),
          };
        }
      }
    }
  }

  // Handle Korean / Japanese title patterns: e.g. "ILLIT (아일릿) 'Magnetic'"
  const quoteMatch = cleanedTitle.match(/^(.+?)\s*['"「『](.+?)['"」』]/);
  if (quoteMatch && isGenericArtist) {
    const group = quoteMatch[1].trim();
    const songName = quoteMatch[2].trim();
    if (group && songName) {
      return {
        title: cleanTrackTitleForLyrics(songName),
        artist: sanitizeArtistNameForSearch(group),
      };
    }
  }

  return {
    title: cleanedTitle,
    artist: isGenericArtist ? '' : cleanArtist,
  };
}

/**
 * Normalizes text for robust metadata comparison:
 * - Lowercase
 * - Normalizes unicode (NFD) and strips diacritics
 * - Removes bracketed/parenthetical text e.g. (...), [...], {...}
 * - Removes featuring/producer clauses (feat, ft, with, prod, etc.)
 * - Strips common studio/version noise: remastered, live, clean, explicit, studio version, original mix, radio edit, bonus track, etc.
 * - Strips all punctuation and special characters
 * - Collapses consecutive spaces and trims
 */
export function normalizeMetadataString(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/\([^)]*\)/g, ' ') // remove ( ... )
    .replace(/\[[^\]]*\]/g, ' ') // remove [ ... ]
    .replace(/\{[^}]*\}/g, ' ') // remove { ... }
    .replace(/\b(feat|featuring|ft|with|prod|produced by)\b.*$/gi, ' ') // strip feat/prod
    .replace(/\b(official\s*(?:audio|video|music\s*video|lyric\s*video)|lyric\s*video|visualizer|single|ep|remastered|remaster|live|clean|explicit|studio\s*version|original\s*mix|radio\s*edit|bonus\s*track|deluxe|version|edition|album\s*version)\b.*$/gi, ' ')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ') // keep Unicode letters & numbers
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Calculates string similarity ratio between 0.0 and 1.0 using:
 * - Exact normalized match (1.0)
 * - Whitespace-collapsed dense match (1.0)
 * - Token-based Dice coefficient
 */
export function calculateMetadataSimilarity(strA: string, strB: string): number {
  const normA = normalizeMetadataString(strA);
  const normB = normalizeMetadataString(strB);

  if (!normA || !normB) return 0;
  if (normA === normB) return 1.0;

  // Dense string comparison (handles spacing variances like "BABY MONSTER" vs "BABYMONSTER")
  const denseA = normA.replace(/\s+/g, '');
  const denseB = normB.replace(/\s+/g, '');
  if (denseA === denseB) return 1.0;

  // Token-based Dice coefficient
  const tokensA = new Set(normA.split(/\s+/).filter((t) => t.length > 0));
  const tokensB = new Set(normB.split(/\s+/).filter((t) => t.length > 0));

  if (tokensA.size === 0 || tokensB.size === 0) return 0;

  let intersectionCount = 0;
  for (const t of tokensA) {
    if (tokensB.has(t)) {
      intersectionCount++;
    }
  }

  if (intersectionCount === 0) return 0;

  const dice = (2 * intersectionCount) / (tokensA.size + tokensB.size);
  return dice;
}

/**
 * Builds a normalized global cache key from (artist, track) so cached lyrics survive component remounts.
 */
export function buildGlobalLyricsCacheKey(trackName: string, artistName: string): string {
  const parsed = parseTrackAndArtist(trackName || '', artistName || '');
  const normTitle =
    normalizeMetadataString(parsed.title || trackName || '') ||
    cleanTrackTitleForLyrics(trackName || '').toLowerCase();
  const safeArtist = parsed.artist || (isGenericArtistPlaceholder(artistName) ? '' : sanitizeArtistNameForSearch(artistName || ''));
  const normArtist = safeArtist
    ? normalizeMetadataString(safeArtist) || safeArtist.toLowerCase()
    : '';
  return `${normArtist}::${normTitle}`;
}

export function getCachedLyrics(trackName: string, artistName: string): LyricResult | null {
  const key = buildGlobalLyricsCacheKey(trackName, artistName);
  if (!key || key === '::') return null;
  const hit = globalLyricsByTrackCache.get(key) ?? null;
  if (!hit || !Array.isArray(hit.lines) || hit.lines.length === 0) {
    return null;
  }
  return hit;
}

export function setCachedLyrics(
  trackName: string,
  artistName: string,
  result: LyricResult
): void {
  const key = buildGlobalLyricsCacheKey(trackName, artistName);
  if (!key || key === '::') return;
  // Anti-Empty-Cache: only store valid results that contain actual lyric lines
  if (result && Array.isArray(result.lines) && result.lines.length > 0) {
    globalLyricsByTrackCache.set(key, result);
  }
}

/**
 * Flushes in-memory and local storage lyrics cache (all entries, or a single track when specified).
 */
export function flushLyricsCache(trackName?: string, artistName?: string): void {
  if (trackName !== undefined) {
    const targetGlobalKey = buildGlobalLyricsCacheKey(trackName, artistName || '');
    globalLyricsByTrackCache.delete(targetGlobalKey);
    inFlightLyricsRequests.delete(targetGlobalKey);
    const parsed = parseTrackAndArtist(trackName, artistName || '');
    const titleOnlyGlobalKey = buildGlobalLyricsCacheKey(parsed.title || trackName, '');
    if (titleOnlyGlobalKey && titleOnlyGlobalKey !== '::') {
      globalLyricsByTrackCache.delete(titleOnlyGlobalKey);
      inFlightLyricsRequests.delete(titleOnlyGlobalKey);
    }
    const prefix = `v8|${parsed.title.toLowerCase()}|`;
    for (const key of lyricsCache.keys()) {
      if (key.startsWith(prefix)) {
        lyricsCache.delete(key);
      }
    }
    for (const key of inFlightLyricsRequests.keys()) {
      if (key.startsWith(prefix)) {
        inFlightLyricsRequests.delete(key);
      }
    }
    return;
  }

  lyricsCache.clear();
  globalLyricsByTrackCache.clear();
  inFlightLyricsRequests.clear();
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('casa_lyrics_') || key.startsWith('lrclib_') || key.startsWith('v1|') || key.startsWith('v2|') || key.startsWith('v3|') || key.startsWith('v4|') || key.startsWith('v5|') || key.startsWith('v6|'))) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach((k) => localStorage.removeItem(k));
  } catch {}
  console.log('[CASA Lyrics] Cache successfully flushed.');
}

// Auto-purge legacy cached entries to prevent stale/incorrect lyric resurrection
try {
  if (typeof localStorage !== 'undefined') {
    let hasLegacy = false;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('casa_lyrics_') || key.startsWith('lrclib_') || key.startsWith('v1|') || key.startsWith('v2|') || key.startsWith('v3|') || key.startsWith('v4|') || key.startsWith('v5|'))) {
        hasLegacy = true;
        break;
      }
    }
    if (hasLegacy) {
      flushLyricsCache();
    }
  }
} catch {}

/**
 * Parses raw LRC string ([mm:ss.xx] text) into a sorted array of LyricLine.
 * Extracts [offset: +/-ms] tag and applies global offset to all line timestamps.
 * Sanitizes word-by-word Enhanced LRC (<00:12.34>) without touching words, parentheses, or ad-libs.
 * Robust multi-timestamp extractor handling repeated lines (e.g., [00:12.10][00:14.50]Chorus).
 */
export function parseLrc(lrcText: string): LyricLine[] {
  if (!lrcText || typeof lrcText !== 'string') return [];

  // Extract global [offset: +/-ms] tag if present in header
  const offsetMatch = lrcText.match(/\[offset:\s*([+-]?\d+)\s*\]/i);
  const globalOffsetMs = offsetMatch ? parseInt(offsetMatch[1], 10) : 0;

  const lines = lrcText.split('\n');
  const rawItems: { time: number; timeMs: number; text: string }[] = [];
  const timeRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

  for (const rawLine of lines) {
    let line = (rawLine || '').trim();
    if (!line) continue;

    // Ignore metadata header tags e.g. [ar:...], [ti:...], [al:...], [by:...], [offset:...]
    if (/^\[(ti|ar|al|by|offset|length|re|ve):/i.test(line)) {
      continue;
    }

    // 1. Sanitize word-by-word Enhanced LRC timestamps (<00:12.34>) without touching words or parentheses
    line = line.replace(/<[0-9:.]+>/g, '');

    const matches = [...line.matchAll(timeRegex)];
    if (matches.length === 0) continue;

    // 2. Strip leading timestamp tags using explicit regex (NEVER .split(']').pop())
    // and strip any remaining inline [mm:ss.xx] timestamp tags while preserving 100% of ad-libs (...) and text!
    const text = line
      .replace(/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '')
      .replace(timeRegex, '')
      .replace(/[ \t]+/g, ' ')
      .trim();
    if (!text) continue;

    for (const match of matches) {
      const mins = parseInt(match[1], 10);
      const secs = parseInt(match[2], 10);
      const millisStr = match[3];

      let millisVal = 0;
      if (millisStr) {
        if (millisStr.length === 1) {
          millisVal = parseInt(millisStr, 10) * 100;
        } else if (millisStr.length === 2) {
          millisVal = parseInt(millisStr, 10) * 10;
        } else {
          millisVal = parseInt(millisStr.slice(0, 3), 10);
        }
      }

      const rawTimeMs = mins * 60000 + secs * 1000 + millisVal;
      const timeMs = Math.max(0, rawTimeMs + globalOffsetMs);
      const totalSeconds = timeMs / 1000;

      rawItems.push({ time: totalSeconds, timeMs, text });
    }
  }

  // Sort chronologically ascending
  rawItems.sort((a, b) => a.timeMs - b.timeMs);

  // Assign deterministic, unique IDs
  return rawItems.map((item, idx) => ({
    id: `line-${idx}-${item.timeMs}`,
    time: item.time,
    timeMs: item.timeMs,
    text: item.text,
  }));
}

export interface LrclibCandidate {
  id: number;
  trackName?: string;
  artistName?: string;
  duration?: number;
  instrumental?: boolean;
  syncedLyrics?: string;
  plainLyrics?: string;
}

/**
 * Computes universal candidate score using strict metadata validation,
 * token overlap, fuzzy duration matching (±4000ms), and absolute priority for synced lyrics (+50,000 points).
 * Formula: score = (validLinesCount * 25) + (totalTextChars * 2) + durationBonus + syncedBonus + adlibBonus + mvPenalty + metaBonus
 * Returns -999999 for disqualified candidates (artist/title mismatch, unwanted remix, etc.)
 */
export function computeCandidateScore(
  candidate: LrclibCandidate,
  targetDuration: number,
  requestedTrackName: string,
  requestedArtistName: string,
  options?: { minTitleSimilarity?: number }
): number {
  if (!candidate || candidate.instrumental) {
    return -1;
  }

  const hasSynced = Boolean(
    candidate.syncedLyrics &&
    typeof candidate.syncedLyrics === 'string' &&
    candidate.syncedLyrics.trim().length > 20
  );

  const hasPlain = Boolean(
    candidate.plainLyrics &&
    typeof candidate.plainLyrics === 'string' &&
    candidate.plainLyrics.trim().length > 0
  );

  if (!hasSynced && !hasPlain) {
    return -1;
  }

  // 1. Strict Artist Disqualification (token overlap / similarity >= 45%)
  const cleanReqArtist = (requestedArtistName || '').trim();
  const primaryReqArtist = extractPrimaryArtistName(cleanReqArtist);
  let artistSim = 1.0;
  if (!isGenericArtistPlaceholder(cleanReqArtist)) {
    const fullSim = calculateMetadataSimilarity(cleanReqArtist, candidate.artistName || '');
    const primarySim = primaryReqArtist
      ? calculateMetadataSimilarity(primaryReqArtist, candidate.artistName || '')
      : 0;
    const candPrimary = extractPrimaryArtistName(candidate.artistName || '');
    const candPrimarySim =
      primaryReqArtist && candPrimary
        ? calculateMetadataSimilarity(primaryReqArtist, candPrimary)
        : 0;
    artistSim = Math.max(fullSim, primarySim, candPrimarySim);
    if (artistSim < 0.45) {
      // Disqualify candidates from different artists
      return -999999;
    }
  }

  // 2. Strict Title Disqualification (token overlap / similarity >= threshold)
  const minTitleSimilarity = options?.minTitleSimilarity ?? 0.45;
  const titleSim = calculateMetadataSimilarity(requestedTrackName || '', candidate.trackName || '');
  if (titleSim < minTitleSimilarity) {
    // Disqualify completely different song titles
    return -999999;
  }

  // 3. Filter out unwanted remix/live/instrumental/karaoke variants unless explicitly requested
  const reqLower = (requestedTrackName || '').toLowerCase();
  const candLower = (candidate.trackName || '').toLowerCase();
  const unwantedKeywords = ['remix', 'live', 'instrumental', 'karaoke', 'sped up', 'slowed', 'acoustic', 'ver.', 'japanese ver'];
  for (const kw of unwantedKeywords) {
    if (candLower.includes(kw) && !reqLower.includes(kw)) {
      return -999999;
    }
  }

  let validLinesCount = 0;
  let totalTextChars = 0;
  let firstVocalSec = 0;

  if (hasSynced && candidate.syncedLyrics) {
    const timeTagRegex = /\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/g;
    const rawLines = candidate.syncedLyrics.split('\n');

    for (const rawLine of rawLines) {
      if (!rawLine) continue;
      if (/\[\d{1,3}:\d{2}/.test(rawLine)) {
        const stripped = rawLine
          .replace(/<[0-9:.]+>/g, '')
          .replace(/^\s*(?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]\s*)+/, '')
          .replace(timeTagRegex, '')
          .trim();
        if (stripped.length > 0) {
          validLinesCount++;
          totalTextChars += stripped.length;
          if (firstVocalSec === 0) {
            const match = rawLine.match(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/);
            if (match) {
              const mins = parseInt(match[1], 10);
              const secs = parseInt(match[2], 10);
              firstVocalSec = mins * 60 + secs;
            }
          }
        }
      }
    }
  } else if (hasPlain && candidate.plainLyrics) {
    const plainLines = candidate.plainLyrics
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    validLinesCount = plainLines.length;
    totalTextChars = plainLines.reduce((acc, l) => acc + l.length, 0);
  }

  if (validLinesCount === 0 || totalTextChars === 0) {
    return -1;
  }

  // Convert and normalize target duration
  const targetSec = targetDuration > 1000 ? targetDuration / 1000 : targetDuration;

  // Detect YouTube MV rip: if requested track does not ask for MV/video/film,
  // but candidate's first vocal starts extremely late (> 28s) compared to studio track
  let mvPenalty = 0;
  if (hasSynced && !reqLower.includes('mv') && !reqLower.includes('music video') && !reqLower.includes('film')) {
    if (firstVocalSec > 28) {
      mvPenalty = -30000;
    }
  }

  // Fuzzy Duration Matching: ±4000ms tolerance window, with video intro offset tolerance (up to 35s)
  let durationBonus = 0;
  if (targetSec > 0 && typeof candidate.duration === 'number' && candidate.duration > 0) {
    const candSec = candidate.duration > 1000 ? candidate.duration / 1000 : candidate.duration;
    const delta = Math.abs(candSec - targetSec);
    if (delta <= 1.5) {
      durationBonus = 15000;
    } else if (delta <= 3.0) {
      durationBonus = 10000;
    } else if (delta <= 4.0) {
      // ±4000ms fuzzy duration tolerance window (rewarded, never disqualified)
      durationBonus = 5000;
    } else if (delta <= 6.0) {
      durationBonus = -2000;
    } else if (delta <= 10.0) {
      durationBonus = -5000;
    } else if (targetSec > candSec && targetSec - candSec <= 35.0) {
      // Supported music video intro offset (video is longer than studio track)
      durationBonus = 2000;
    } else {
      durationBonus = -20000;
    }
  }

  // Absolute Priority for Synced Lyrics (+50,000 points)
  // Guarantees synced lyrics vastly outscore plain lyrics candidates
  const syncedBonus = hasSynced ? 50000 : 0;

  // Universal bonus for candidates containing ad-libs or backing vocals in parentheses
  const adlibCount = hasSynced && candidate.syncedLyrics
    ? (candidate.syncedLyrics.match(/\([A-Za-z0-9\s'.,!?]+\)/g) || []).length
    : 0;
  const adlibBonus = adlibCount * 30;

  // Metadata similarity bonus (scales up candidates with exact title & artist matches)
  const metaBonus = Math.round(artistSim * 5000 + titleSim * 5000);

  const score =
    validLinesCount * 25 +
    totalTextChars * 2 +
    durationBonus +
    syncedBonus +
    adlibBonus +
    mvPenalty +
    metaBonus;

  return score;
}

/**
 * Fetches lyrics from LRCLIB via a 3-stage pipeline:
 * 1. Exact Original `/api/get` lookup (raw track_name + raw artist_name).
 * 2. Primary Artist + Cleaned Title `/api/get` lookup.
 * 3. `/api/search` multi-query fallback with candidate scoring (prioritizing syncedLyrics, falling back to plainLyrics).
 * Never caches empty (`lines: []`) results so retries remain possible on metadata/UI updates.
 */
export async function fetchLyrics(
  trackName: string,
  artistName: string,
  durationSeconds?: number,
  forceRefreshOrOptions: boolean | { signal?: AbortSignal; allowTitleOnlyFallback?: boolean } = false,
  maybeOptions?: { signal?: AbortSignal; allowTitleOnlyFallback?: boolean }
): Promise<LyricResult> {
  const forceRefresh = typeof forceRefreshOrOptions === 'boolean' ? forceRefreshOrOptions : false;
  const options = typeof forceRefreshOrOptions === 'object' ? forceRefreshOrOptions : maybeOptions;
  const externalSignal = options?.signal;
  const allowTitleOnlyFallback = Boolean(options?.allowTitleOnlyFallback);

  const EMPTY_RESULT: LyricResult = {
    lines: [],
    isSynced: false,
    syncType: 'none',
    isInstrumental: false,
  };

  try {
    if (externalSignal?.aborted) {
      return EMPTY_RESULT;
    }

    const rawTrack = (trackName || '').trim();
    const rawArtistInput = (artistName || '').trim();
    const rawArtist = isGenericArtistPlaceholder(rawArtistInput) ? '' : rawArtistInput;
    const lowerRawTrack = rawTrack.toLowerCase();

    if (
      !rawTrack ||
      lowerRawTrack === 'no media playing' ||
      lowerRawTrack === 'no media active' ||
      lowerRawTrack === 'pilih lagu atau putar media' ||
      lowerRawTrack === 'casa native player' ||
      lowerRawTrack === 'casa player' ||
      lowerRawTrack === 'spotify free' ||
      lowerRawTrack === 'spotify premium' ||
      lowerRawTrack === 'advertisement' ||
      lowerRawTrack === 'sponsored'
    ) {
      return EMPTY_RESULT;
    }

    const { title: cleanTitle, artist: parsedArtist } = parseTrackAndArtist(rawTrack, rawArtist);
    const primaryArtist = extractPrimaryArtistName(parsedArtist || rawArtist);
    const isGenericArtistName = (name: string) => isGenericArtistPlaceholder(name);

    // Normalize duration to seconds (if duration was passed in milliseconds e.g. > 1000)
    const normDuration =
      typeof durationSeconds === 'number' && durationSeconds > 0
        ? durationSeconds > 1000
          ? durationSeconds / 1000
          : durationSeconds
        : 0;
    const roundedDuration = normDuration > 0 ? Math.round(normDuration * 10) / 10 : 0;
    const cacheKey = `v8|${cleanTitle.toLowerCase()}|${primaryArtist.toLowerCase()}|${roundedDuration}|${allowTitleOnlyFallback ? 'b' : 's'}`;
    const globalKey = buildGlobalLyricsCacheKey(rawTrack, rawArtist);
    const inFlightKey = globalKey && globalKey !== '::' ? globalKey : cacheKey;

    if (!forceRefresh) {
      if (lyricsCache.has(cacheKey)) {
        const hit = lyricsCache.get(cacheKey)!;
        if (hit && Array.isArray(hit.lines) && hit.lines.length > 0) {
          setCachedLyrics(rawTrack, rawArtist, hit);
          return hit;
        }
        lyricsCache.delete(cacheKey);
      }
      const globalHit = getCachedLyrics(rawTrack, rawArtist);
      if (globalHit && globalHit.lines.length > 0) {
        lyricsCache.set(cacheKey, globalHit);
        return globalHit;
      }
      const existingInFlight = inFlightLyricsRequests.get(inFlightKey);
      if (existingInFlight) {
        return existingInFlight;
      }
    } else {
      lyricsCache.delete(cacheKey);
      flushLyricsCache(rawTrack, rawArtist);
      inFlightLyricsRequests.delete(inFlightKey);
    }

    const requestPromise = (async (): Promise<LyricResult> => {
      let candidates: LrclibCandidate[] = [];

      const buildSyncedResultFromCandidate = (best: LrclibCandidate): LyricResult | null => {
        if (!best || !best.syncedLyrics || best.instrumental) return null;
        const parsed = parseLrc(best.syncedLyrics);
        if (parsed.length === 0) return null;

        const candDurationSec =
          best.duration && best.duration > 0
            ? best.duration > 1000
              ? best.duration / 1000
              : best.duration
            : 0;

        // Dynamic Duration Offset calculation (compensating for YouTube MV intro delay)
        let computedOffsetSec = 0;
        if (roundedDuration > 0 && candDurationSec > 0) {
          const diff = roundedDuration - candDurationSec;
          if (diff >= 1.5 && diff <= 35) {
            computedOffsetSec = Math.round(diff * 100) / 100;
            console.log(
              `[CASA Lyrics] Applied Dynamic Duration Offset: +${computedOffsetSec}s for video intro.`
            );
          }
        }

        return {
          lines: parsed,
          isSynced: true,
          syncType: 'synced',
          isInstrumental: false,
          trackDuration: candDurationSec,
          offsetSeconds: computedOffsetSec,
        };
      };

      const LRCLIB_REQUEST_TIMEOUT_MS = 8000;

      const fetchJsonWithTimeout = async (url: string): Promise<unknown | null> => {
        if (externalSignal?.aborted) return null;
        const controller = new AbortController();
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        let resolveAbortRace: ((val: null) => void) | null = null;

        const onExternalAbort = () => {
          controller.abort();
          resolveAbortRace?.(null);
        };
        externalSignal?.addEventListener('abort', onExternalAbort, { once: true });

        try {
          const fetchPromise = (async (): Promise<unknown | null> => {
            try {
              const res = await fetch(url, { signal: controller.signal });
              if (!res.ok) return null;
              return await res.json();
            } catch {
              return null;
            }
          })();

          const timeoutPromise = new Promise<null>((resolve) => {
            timeoutId = setTimeout(() => {
              controller.abort();
              resolve(null);
            }, LRCLIB_REQUEST_TIMEOUT_MS);
          });

          const races: Promise<unknown | null>[] = [fetchPromise, timeoutPromise];
          if (externalSignal) {
            races.push(
              new Promise<null>((resolve) => {
                resolveAbortRace = resolve;
              })
            );
          }

          return await Promise.race(races);
        } finally {
          if (timeoutId !== null) {
            clearTimeout(timeoutId);
          }
          externalSignal?.removeEventListener('abort', onExternalAbort);
          resolveAbortRace = null;
        }
      };

      try {
        const candidateMap = new Map<number, LrclibCandidate>();

        const fetchExactCandidate = async (track: string, artist: string): Promise<LrclibCandidate | null> => {
          if (!track || isGenericArtistName(artist) || externalSignal?.aborted) return null;
          const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(track)}&artist_name=${encodeURIComponent(artist)}`;
          const data = await fetchJsonWithTimeout(url);
          if (data && !Array.isArray(data) && typeof (data as LrclibCandidate).id === 'number') {
            return data as LrclibCandidate;
          }
          return null;
        };

        const fetchSearchList = async (url: string): Promise<LrclibCandidate[]> => {
          if (externalSignal?.aborted) return [];
          const data = await fetchJsonWithTimeout(url);
          return Array.isArray(data) ? (data as LrclibCandidate[]) : [];
        };

        // Stage 1: Exact Original `/api/get` (no aggressive sanitization)
        if (!isGenericArtistName(rawArtist)) {
          const stage1Candidate = await fetchExactCandidate(rawTrack, rawArtist);
          if (externalSignal?.aborted) return EMPTY_RESULT;
          if (stage1Candidate) {
            candidateMap.set(stage1Candidate.id, stage1Candidate);
            const stage1Synced = buildSyncedResultFromCandidate(stage1Candidate);
            if (stage1Synced) {
              console.log(`[CASA Lyrics] Stage 1 (/api/get exact) Hit #${stage1Candidate.id}`);
              lyricsCache.set(cacheKey, stage1Synced);
              setCachedLyrics(rawTrack, rawArtist, stage1Synced);
              return stage1Synced;
            }
          }
        }

        // Stage 2: Primary Artist (split comma/&/feat./ft.) + Clean Title `/api/get`
        const isStage2Distinct =
          Boolean(primaryArtist) &&
          (cleanTitle.toLowerCase() !== rawTrack.toLowerCase() ||
            primaryArtist.toLowerCase() !== rawArtist.toLowerCase());

        if (isStage2Distinct && !externalSignal?.aborted) {
          const stage2Candidate = await fetchExactCandidate(cleanTitle, primaryArtist);
          if (externalSignal?.aborted) return EMPTY_RESULT;
          if (stage2Candidate) {
            candidateMap.set(stage2Candidate.id, stage2Candidate);
            const stage2Synced = buildSyncedResultFromCandidate(stage2Candidate);
            if (stage2Synced) {
              console.log(`[CASA Lyrics] Stage 2 (/api/get primary+clean) Hit #${stage2Candidate.id}`);
              lyricsCache.set(cacheKey, stage2Synced);
              setCachedLyrics(rawTrack, rawArtist, stage2Synced);
              return stage2Synced;
            }
          }
        }

        if (externalSignal?.aborted) return EMPTY_RESULT;

        // Stage 3: `/api/search` Fallback (q + structured field searches)
        const stage3Queries: Promise<LrclibCandidate[]>[] = [
          fetchSearchList(
            `https://lrclib.net/api/search?q=${encodeURIComponent(
              !isGenericArtistName(primaryArtist) ? `${primaryArtist} ${cleanTitle}` : cleanTitle
            )}`
          ),
        ];

        if (!isGenericArtistName(primaryArtist)) {
          stage3Queries.push(
            fetchSearchList(
              `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(primaryArtist)}`
            )
          );
          if (parsedArtist && parsedArtist.toLowerCase() !== primaryArtist.toLowerCase()) {
            stage3Queries.push(
              fetchSearchList(
                `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(parsedArtist)}`
              )
            );
          }
          if (allowTitleOnlyFallback) {
            stage3Queries.push(
              fetchSearchList(
                `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`
              )
            );
          }
        } else {
          stage3Queries.push(
            fetchSearchList(
              `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`
            )
          );
        }

        const searchResults = await Promise.all(stage3Queries);
        if (externalSignal?.aborted) return EMPTY_RESULT;
        for (const list of searchResults) {
          for (const c of list) {
            if (c && typeof c.id === 'number' && !candidateMap.has(c.id)) {
              candidateMap.set(c.id, c);
            }
          }
        }

        candidates = Array.from(candidateMap.values());
        const effectiveScoreArtist = !isGenericArtistName(parsedArtist)
          ? parsedArtist
          : !isGenericArtistName(primaryArtist)
          ? primaryArtist
          : '';

        const evaluateSynced = (
          cList: LrclibCandidate[],
          scoreTitle: string,
          scoreArtist: string,
          minTitleSimilarity = 0.45
        ) => {
          const synced = cList.filter(
            (c) =>
              Boolean(
                c &&
                c.syncedLyrics &&
                typeof c.syncedLyrics === 'string' &&
                c.syncedLyrics.trim().length > 20 &&
                !c.instrumental
              )
          );
          if (synced.length === 0) return null;
          const scored = synced
            .map((c) => ({
              candidate: c,
              score: computeCandidateScore(c, roundedDuration, scoreTitle, scoreArtist, {
                minTitleSimilarity,
              }),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
          return scored.length > 0 ? scored[0] : null;
        };

        const evaluatePlain = (
          cList: LrclibCandidate[],
          scoreTitle: string,
          scoreArtist: string,
          minTitleSimilarity = 0.45
        ) => {
          const plainCandidates = cList
            .filter((c) => {
              if (
                !c ||
                !c.plainLyrics ||
                typeof c.plainLyrics !== 'string' ||
                c.plainLyrics.trim().length === 0 ||
                c.instrumental
              ) {
                return false;
              }
              const titleSim = Math.max(
                calculateMetadataSimilarity(scoreTitle, c.trackName || ''),
                calculateMetadataSimilarity(rawTrack, c.trackName || '')
              );
              if (!isGenericArtistName(scoreArtist)) {
                const artSim = Math.max(
                  calculateMetadataSimilarity(scoreArtist, c.artistName || ''),
                  primaryArtist ? calculateMetadataSimilarity(primaryArtist, c.artistName || '') : 0
                );
                return artSim >= 0.45 && titleSim >= minTitleSimilarity;
              }
              return titleSim >= minTitleSimilarity;
            })
            .map((c) => ({
              candidate: c,
              score: computeCandidateScore(c, roundedDuration, scoreTitle, scoreArtist, {
                minTitleSimilarity,
              }),
            }))
            .filter((item) => item.score > 0)
            .sort((a, b) => b.score - a.score);
          return plainCandidates.length > 0 ? plainCandidates[0] : null;
        };

        let bestSyncedItem = evaluateSynced(candidates, cleanTitle, effectiveScoreArtist);
        let resolvedTitle = cleanTitle;
        let resolvedScoreArtist = effectiveScoreArtist;

        // Detect unparsed "Artist - Title" when GSMTC artist was a channel uploader
        const unparsedSepMatch = cleanTitle.match(/^([^-–—:|]+)\s*[-–—:|]\s*(.+)$/);
        const sepArtist = unparsedSepMatch ? sanitizeArtistNameForSearch(unparsedSepMatch[1]) : '';
        const sepTitle = unparsedSepMatch ? cleanTrackTitleForLyrics(unparsedSepMatch[2]) : '';

        // Additional flexible/title-only fallback if Stage 3 initial queries didn't yield synced
        if (!bestSyncedItem && !externalSignal?.aborted) {
          const fallbackUrls: string[] = [];
          if (!isGenericArtistName(primaryArtist) && !allowTitleOnlyFallback) {
            fallbackUrls.push(
              `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`
            );
          }
          if (sepArtist && sepTitle) {
            fallbackUrls.push(
              `https://lrclib.net/api/search?track_name=${encodeURIComponent(sepTitle)}&artist_name=${encodeURIComponent(sepArtist)}`,
              `https://lrclib.net/api/search?track_name=${encodeURIComponent(sepTitle)}`
            );
          }
          const noiseWordsRegex =
            /\b(lyrics?|video|audio|official|slowed|reverb|sped|speed|remix|tiktok|sub|indo|eng|mv|hd|4k|color|coded|easy|lirik|lagu|version|ver)\b/gi;
          const rawNoPunct = (sepTitle || cleanTitle)
            .replace(/[()[\]{}|_\\/~!@#$%^&*+=:;"'<>,.?]/g, ' ')
            .replace(noiseWordsRegex, '')
            .replace(/\s+/g, ' ')
            .trim();
          if (rawNoPunct.length >= 3) {
            fallbackUrls.push(
              `https://lrclib.net/api/search?q=${encodeURIComponent(rawNoPunct)}`
            );
          }

          if (fallbackUrls.length > 0) {
            const extraResults = await Promise.all(fallbackUrls.map((u) => fetchSearchList(u)));
            if (externalSignal?.aborted) return EMPTY_RESULT;
            for (const list of extraResults) {
              for (const c of list) {
                if (c && typeof c.id === 'number' && !candidateMap.has(c.id)) {
                  candidateMap.set(c.id, c);
                }
              }
            }
            candidates = Array.from(candidateMap.values());
            bestSyncedItem = evaluateSynced(candidates, cleanTitle, effectiveScoreArtist);
          }
        }

        // If strict channel/artist matching found nothing and video title contains "Artist - Title"
        if (!bestSyncedItem && sepArtist && sepTitle && !evaluatePlain(candidates, cleanTitle, effectiveScoreArtist)) {
          const sepSynced = evaluateSynced(candidates, sepTitle, sepArtist);
          if (sepSynced) {
            bestSyncedItem = sepSynced;
            resolvedTitle = sepTitle;
            resolvedScoreArtist = sepArtist;
          }
        }

        // Browser GSMTC / missing-artist title-only fallback (when strict artist lookup found zero synced & zero plain hits)
        if (
          !bestSyncedItem &&
          !evaluatePlain(candidates, resolvedTitle, resolvedScoreArtist) &&
          (allowTitleOnlyFallback || !effectiveScoreArtist)
        ) {
          const titleOnlySynced = evaluateSynced(candidates, sepTitle || cleanTitle, '', 0.65);
          if (titleOnlySynced) {
            bestSyncedItem = titleOnlySynced;
            resolvedTitle = sepTitle || cleanTitle;
            resolvedScoreArtist = '';
          }
        }

        // Structured candidate audit logging
        console.log(`[CASA Lyrics] Found ${candidates.length} candidates for: ${resolvedTitle} - ${primaryArtist || rawArtist || 'title-only'}`);

        if (bestSyncedItem && bestSyncedItem.candidate.syncedLyrics) {
          const best = bestSyncedItem.candidate;
          console.log(`[CASA Lyrics] Selected Synced Candidate #${best.id} with score: ${bestSyncedItem.score}`);
          const syncedResult = buildSyncedResultFromCandidate(best);
          if (syncedResult) {
            lyricsCache.set(cacheKey, syncedResult);
            setCachedLyrics(rawTrack, rawArtist, syncedResult);
            return syncedResult;
          }
        }

        // Fallback to plain lyrics if no synced candidate succeeded
        if (candidates.length > 0) {
          let bestPlainItem = evaluatePlain(candidates, resolvedTitle, resolvedScoreArtist);
          if (!bestPlainItem && sepArtist && sepTitle) {
            bestPlainItem = evaluatePlain(candidates, sepTitle, sepArtist);
          }
          if (!bestPlainItem && (allowTitleOnlyFallback || !effectiveScoreArtist)) {
            bestPlainItem = evaluatePlain(candidates, sepTitle || cleanTitle, '', 0.68);
          }

          const bestPlain = bestPlainItem?.candidate;
          const bestPlainText = bestPlain?.plainLyrics;
          if (bestPlain && bestPlainItem && bestPlainText) {
            console.log(`[CASA Lyrics] Selected Fallback Plain Candidate #${bestPlain.id} with score: ${bestPlainItem.score}`);
            const plainLines: LyricLine[] = bestPlainText
              .split('\n')
              .map((l) => l.trim())
              .filter((l) => l.length > 0)
              .map((text, idx) => ({
                id: `plain-${idx}`,
                time: 0,
                timeMs: 0,
                text,
              }));
            if (plainLines.length > 0) {
              const candDurationSec =
                bestPlain.duration && bestPlain.duration > 0
                  ? bestPlain.duration > 1000
                    ? bestPlain.duration / 1000
                    : bestPlain.duration
                  : 0;
              const result: LyricResult = {
                lines: plainLines,
                isSynced: false,
                syncType: 'plain',
                isInstrumental: false,
                trackDuration: candDurationSec,
                offsetSeconds: 0,
              };
              lyricsCache.set(cacheKey, result);
              setCachedLyrics(rawTrack, rawArtist, result);
              return result;
            }
          }
        }
      } catch (innerError) {
        console.debug('[LyricsService] candidate evaluation error:', innerError);
      }

      const isInstrumentalCandidate =
        candidates.some((c) => Boolean(c && c.instrumental)) ||
        /\b(instrumental|karaoke|backing track|minus one)\b/i.test(rawTrack);

      // Anti-Empty-Cache: NEVER write empty `lines: []` into lyricsCache or globalLyricsByTrackCache
      return {
        lines: [],
        isSynced: false,
        syncType: 'none',
        isInstrumental: Boolean(isInstrumentalCandidate),
      };
    })().finally(() => {
      if (inFlightLyricsRequests.get(inFlightKey) === requestPromise) {
        inFlightLyricsRequests.delete(inFlightKey);
      }
    });

    inFlightLyricsRequests.set(inFlightKey, requestPromise);
    try {
      return await requestPromise;
    } finally {
      if (inFlightLyricsRequests.get(inFlightKey) === requestPromise) {
        inFlightLyricsRequests.delete(inFlightKey);
      }
    }
  } catch (outerError) {
    console.debug('[LyricsService] unexpected outer fetchLyrics error:', outerError);
    return EMPTY_RESULT;
  }
}

/**
 * Computes active prev, current, next lyric lines based on currentTime with optional lead time compensation (default: +350ms).
 * Strictly honors intro phase (returns undefined current when currentTime < lines[0].time).
 */
export function getActiveLyrics(
  lines: LyricLine[],
  currentTime: number,
  leadOffsetSeconds: number = 0.35,
  introOffsetSeconds: number = 0
): ActiveLyrics {
  if (!lines || !Array.isArray(lines) || lines.length === 0) {
    return {
      prev: undefined,
      current: undefined,
      next: undefined,
    };
  }

  const adjustedTime = currentTime - introOffsetSeconds + leadOffsetSeconds;

  // Find index of the latest line where time <= adjustedTime
  let activeIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].time <= adjustedTime) {
      activeIndex = i;
    } else {
      break;
    }
  }

  // Intro phase: singer has not started yet
  if (activeIndex === -1) {
    return {
      prev: undefined,
      current: undefined,
      next: lines[0]?.text,
    };
  }

  return {
    prev: activeIndex > 0 ? lines[activeIndex - 1].text : undefined,
    current: lines[activeIndex]?.text,
    next: activeIndex < lines.length - 1 ? lines[activeIndex + 1].text : undefined,
  };
}
