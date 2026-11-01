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
      /\s*[\(\[](?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|explicit|clean|studio|deluxe|bonus|radio\s*edit|mono|stereo|ver|version|single|ep|acoustic|album\s*version|performance\s*video|special\s*clip|karaoke|instrumental|backing\s*track|minus\s*one)[^\)\]]*[\)\]]/gi,
      ''
    )
    // 2. Remove trailing suffix separators: "| Lyrics", "// Lyrics", "- Lyrics", "- Lyric Video", "| Official Video"
    .replace(
      /\s*(?:\|\s*|\/\/\s*|\s-\s*)(?:official\s*(?:music\s*)?video|music\s*video|official\s*audio|mv|m\/v|(?:easy\s*)?lyrics?|color\s*coded(?:\s*lyrics?)?|lirik\s*(?:lagu)?|audio|terjemahan).*$/gi,
      ''
    )
    .replace(/\s+\b(?:m\/v|mv)\b$/gi, '')
    // 3. Remove featuring tokens: (feat. ...), [feat. ...], feat. ..., ft. ...
    .replace(/\s*[\(\[](?:feat|ft|featuring|with)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\b(?:feat|ft|featuring|with)\b.*$/gi, '')
    // 4. Remove leftover brackets e.g. [ ... ] or ( ... ) containing video/lyrics noise
    .replace(/\s*\[[^\]]*(?:mv|video|audio|4k|hd|clip|live|lyric|sub|ver)[^\]]*\]/gi, '')
    .replace(/\s*\([^)]*(?:mv|video|audio|4k|hd|clip|live|lyric|sub|ver)[^)]*\)/gi, '')
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
 * Sanitizes artist name for LRCLIB search queries by removing featuring noise
 * and extracting the primary performing artist.
 */
export function sanitizeArtistNameForSearch(artist: string): string {
  if (!artist) return '';
  return artist
    .replace(/\s*[\(\[](?:feat|ft|featuring|with)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\b(?:feat|ft|featuring|with)\b.*$/gi, '')
    .split(',')[0]
    .replace(/[-–—]\s*topic$/i, '')
    .trim();
}

/**
 * Extracts clean song title and performing artist from combined YouTube metadata.
 * Handles "Artist - Title", "Artist : Title", "Artist 'Song'", and strips generic "YouTube" channel placeholders.
 */
export function parseTrackAndArtist(
  rawTitle: string,
  rawArtist: string
): { title: string; artist: string } {
  const cleanedTitle = cleanTrackTitleForLyrics(rawTitle);
  const cleanArtist = sanitizeArtistNameForSearch(rawArtist);

  const isGenericArtist =
    !cleanArtist ||
    cleanArtist.toLowerCase() === 'youtube' ||
    cleanArtist.toLowerCase() === 'unknown' ||
    cleanArtist.toLowerCase() === 'unknown artist' ||
    cleanArtist.toLowerCase().includes('vevo') ||
    cleanArtist.toLowerCase().endsWith('- topic');

  // Look for "Artist - Title" or "Artist : Title"
  const separatorMatch = cleanedTitle.match(/^([^-–—:|]+)\s*[-–—:|]\s*(.+)$/);
  if (separatorMatch) {
    const leftPart = separatorMatch[1].trim();
    const rightPart = separatorMatch[2].trim();

    if (leftPart && rightPart) {
      if (isGenericArtist) {
        return {
          title: cleanTrackTitleForLyrics(rightPart),
          artist: sanitizeArtistNameForSearch(leftPart),
        };
      }

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

      return {
        title: cleanTrackTitleForLyrics(rightPart),
        artist: cleanArtist || sanitizeArtistNameForSearch(leftPart),
      };
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
    .replace(/[^a-z0-9\s]/g, ' ') // keep alphanumeric
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
 * Flushes all in-memory and local storage lyrics cache.
 */
export function flushLyricsCache(): void {
  lyricsCache.clear();
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
  requestedArtistName: string
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
  let artistSim = 1.0;
  if (
    cleanReqArtist &&
    cleanReqArtist.toLowerCase() !== 'unknown' &&
    cleanReqArtist.toLowerCase() !== 'unknown artist' &&
    cleanReqArtist.toLowerCase() !== 'youtube'
  ) {
    artistSim = calculateMetadataSimilarity(cleanReqArtist, candidate.artistName || '');
    if (artistSim < 0.45) {
      // Disqualify candidates from different artists
      return -999999;
    }
  }

  // 2. Strict Title Disqualification (token overlap / similarity >= 45%)
  const titleSim = calculateMetadataSimilarity(requestedTrackName || '', candidate.trackName || '');
  if (titleSim < 0.45) {
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
 * Fetches lyrics from LRCLIB via /api/search with full-text & line-count candidate scoring.
 * Never short-circuits on /api/get so truncated default entries are bypassed in favor of complete LRC versions with ad-libs.
 */
export async function fetchLyrics(
  trackName: string,
  artistName: string,
  durationSeconds?: number,
  forceRefreshOrOptions: boolean | { signal?: AbortSignal } = false,
  maybeOptions?: { signal?: AbortSignal }
): Promise<LyricResult> {
  const forceRefresh = typeof forceRefreshOrOptions === 'boolean' ? forceRefreshOrOptions : false;
  const options = typeof forceRefreshOrOptions === 'object' ? forceRefreshOrOptions : maybeOptions;
  const externalSignal = options?.signal;

  try {
    if (externalSignal?.aborted) {
      return { lines: [], isSynced: false, syncType: 'none', isInstrumental: false };
    }

    const rawTrack = (trackName || '').trim();
    const rawArtist = (artistName || '').trim();

    if (!rawTrack) {
      return { lines: [], isSynced: false, syncType: 'none', isInstrumental: false };
    }

    const { title: cleanTitle, artist: cleanArtist } = parseTrackAndArtist(rawTrack, rawArtist);

    // Normalize duration to seconds (if duration was passed in milliseconds e.g. > 1000)
    const normDuration =
      typeof durationSeconds === 'number' && durationSeconds > 0
        ? durationSeconds > 1000
          ? durationSeconds / 1000
          : durationSeconds
        : 0;
    const roundedDuration = normDuration > 0 ? Math.round(normDuration * 10) / 10 : 0;
    const cacheKey = `v7|${cleanTitle.toLowerCase()}|${cleanArtist.toLowerCase()}|${roundedDuration}`;

    if (!forceRefresh && lyricsCache.has(cacheKey)) {
      return lyricsCache.get(cacheKey)!;
    }
    if (forceRefresh) {
      lyricsCache.delete(cacheKey);
    }

    let candidates: LrclibCandidate[] = [];

    try {
      const candidateMap = new Map<number, LrclibCandidate>();

      const fetchWithTimeout = async (url: string): Promise<LrclibCandidate[]> => {
        if (externalSignal?.aborted) return [];
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        const onExternalAbort = () => controller.abort();
        if (externalSignal) {
          externalSignal.addEventListener('abort', onExternalAbort, { once: true });
        }
        try {
          const res = await fetch(url, { signal: controller.signal });
          clearTimeout(timeoutId);
          if (externalSignal) {
            externalSignal.removeEventListener('abort', onExternalAbort);
          }
          if (res.ok) {
            const data = await res.json();
            return Array.isArray(data) ? data : [];
          }
        } catch {
          clearTimeout(timeoutId);
          if (externalSignal) {
            externalSignal.removeEventListener('abort', onExternalAbort);
          }
        }
        return [];
      };

      // 1. Primary Search by clean track_name + artist_name (or just track_name if artist not present)
      const searchUrl1 = cleanArtist
        ? `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`
        : `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`;

      // 2. Secondary search with raw track name if title sanitization altered the string
      const searchUrl2 =
        cleanTitle.toLowerCase() !== rawTrack.toLowerCase() && cleanArtist
          ? `https://lrclib.net/api/search?track_name=${encodeURIComponent(rawTrack)}&artist_name=${encodeURIComponent(cleanArtist)}`
          : null;

      const fetchPromises: Promise<LrclibCandidate[]>[] = [fetchWithTimeout(searchUrl1)];
      if (searchUrl2) {
        fetchPromises.push(fetchWithTimeout(searchUrl2));
      }

      const searchResults = await Promise.all(fetchPromises);

      for (const list of searchResults) {
        if (Array.isArray(list)) {
          for (const c of list) {
            if (c && typeof c.id === 'number' && !candidateMap.has(c.id)) {
              candidateMap.set(c.id, c);
            }
          }
        }
      }

      candidates = Array.from(candidateMap.values());

      // Helper to evaluate and score synced candidates
      const evaluateSynced = (cList: LrclibCandidate[]) => {
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
            score: computeCandidateScore(c, roundedDuration, cleanTitle, cleanArtist),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);
        return scored.length > 0 ? scored[0] : null;
      };

      let bestSyncedItem = evaluateSynced(candidates);

      // 3. Fallback Flexible Search: if primary queries failed to find a valid synced candidate
      if (!bestSyncedItem) {
        const fallbackUrls: string[] = [];
        if (cleanArtist) {
          fallbackUrls.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}`);
        }
        fallbackUrls.push(
          `https://lrclib.net/api/search?q=${encodeURIComponent(`${cleanTitle} ${cleanArtist}`.trim())}`
        );

        const fallbackResults = await Promise.all(fallbackUrls.map((u) => fetchWithTimeout(u)));
        for (const list of fallbackResults) {
          if (Array.isArray(list)) {
            for (const c of list) {
              if (c && typeof c.id === 'number' && !candidateMap.has(c.id)) {
                candidateMap.set(c.id, c);
              }
            }
          }
        }
        candidates = Array.from(candidateMap.values());
        bestSyncedItem = evaluateSynced(candidates);
      }

      // 4. Stage 4 Fuzzy Search Fallback: For non-official YouTube uploads, fan lyric videos, slowed/reverb
      if (!bestSyncedItem) {
        const noiseWordsRegex = /\b(lyrics?|video|audio|official|slowed|reverb|sped|speed|remix|tiktok|sub|indo|eng|mv|hd|4k|color|coded|easy|lirik|lagu|version|ver)\b/gi;
        const rawNoPunct = `${cleanTitle} ${cleanArtist}`
          .replace(/[()[\]{}|_\\/~!@#$%^&*+=:;"'<>,.?]/g, ' ')
          .replace(noiseWordsRegex, '')
          .replace(/\s+/g, ' ')
          .trim();

        if (rawNoPunct.length >= 3) {
          console.log(`[CASA Lyrics] Stage 4 Fuzzy Fallback Query: "${rawNoPunct}"`);
          const fuzzyResults = await fetchWithTimeout(
            `https://lrclib.net/api/search?q=${encodeURIComponent(rawNoPunct)}`
          );
          if (Array.isArray(fuzzyResults)) {
            for (const c of fuzzyResults) {
              if (c && typeof c.id === 'number' && !candidateMap.has(c.id)) {
                candidateMap.set(c.id, c);
              }
            }
          }
          candidates = Array.from(candidateMap.values());
          bestSyncedItem = evaluateSynced(candidates);
        }
      }

      // Structured candidate audit logging
      console.log(`[CASA Lyrics] Found ${candidates.length} candidates for: ${cleanTitle} - ${cleanArtist}`);
      candidates.forEach((c, idx) => {
        if (!c) return;
        const lineCount = c.syncedLyrics ? c.syncedLyrics.split('\n').length : 0;
        const hasParentheses = Boolean(c.syncedLyrics && c.syncedLyrics.includes('('));
        console.log(
          `[CASA Candidate #${idx}] ID: ${c.id} | Artist: "${c.artistName}" | Title: "${c.trackName}" | Lines: ${lineCount} | Adlibs: ${hasParentheses} | Duration: ${c.duration}s`
        );
      });

      if (bestSyncedItem && bestSyncedItem.candidate.syncedLyrics) {
        const best = bestSyncedItem.candidate;
        console.log(`[CASA Lyrics] Selected Synced Candidate #${best.id} with score: ${bestSyncedItem.score}`);
        const parsed = parseLrc(best.syncedLyrics!);
        if (parsed.length > 0) {
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

          const result: LyricResult = {
            lines: parsed,
            isSynced: true,
            syncType: 'synced',
            isInstrumental: false,
            trackDuration: candDurationSec,
            offsetSeconds: computedOffsetSec,
          };
          lyricsCache.set(cacheKey, result);
          return result;
        }
      }

      // Fallback to plain lyrics if no synced candidate succeeded
      if (candidates.length > 0) {
        const plainCandidates = candidates
          .filter((c) => {
            if (!c || !c.plainLyrics || typeof c.plainLyrics !== 'string' || c.plainLyrics.trim().length === 0 || c.instrumental) return false;
            const titleSim = calculateMetadataSimilarity(cleanTitle, c.trackName || '');
            if (cleanArtist) {
              const artSim = calculateMetadataSimilarity(cleanArtist, c.artistName || '');
              return artSim >= 0.45 && titleSim >= 0.45;
            }
            return titleSim >= 0.45;
          })
          .map((c) => ({
            candidate: c,
            score: computeCandidateScore(c, roundedDuration, cleanTitle, cleanArtist),
          }))
          .filter((item) => item.score > 0)
          .sort((a, b) => b.score - a.score);

        if (plainCandidates.length > 0 && plainCandidates[0].candidate.plainLyrics) {
          const bestPlain = plainCandidates[0].candidate;
          console.log(`[CASA Lyrics] Selected Fallback Plain Candidate #${bestPlain.id} with score: ${plainCandidates[0].score}`);
          const plainLines: LyricLine[] = bestPlain.plainLyrics!
            .split('\n')
            .map((l) => l.trim())
            .filter((l) => l.length > 0)
            .map((text, idx) => ({
              id: `plain-${idx}`,
              time: 0,
              timeMs: 0,
              text,
            }));
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
          return result;
        }
      }
    } catch (innerError) {
      console.debug('[LyricsService] candidate evaluation error:', innerError);
    }

    const isInstrumentalCandidate =
      candidates.some((c) => Boolean(c && c.instrumental)) ||
      /\b(instrumental|karaoke|backing track|minus one)\b/i.test(rawTrack);

    const emptyResult: LyricResult = {
      lines: [],
      isSynced: false,
      syncType: 'none',
      isInstrumental: Boolean(isInstrumentalCandidate),
    };
    lyricsCache.set(cacheKey, emptyResult);
    return emptyResult;
  } catch (outerError) {
    console.debug('[LyricsService] unexpected outer fetchLyrics error:', outerError);
    return {
      lines: [],
      isSynced: false,
      syncType: 'none',
      isInstrumental: false,
    };
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
