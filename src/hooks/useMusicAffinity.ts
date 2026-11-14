/**
 * useMusicAffinity.ts
 * Adaptive Music Search Recommendations & User Affinity Store (localStorage persisted)
 *
 * - Zero-State Neutral: Time-of-day contextual search chips when history is empty.
 * - Tracks recent searches, qualified playback (> 30s or completed), focus-session plays,
 *   and playlist saves weighted per unique track (ID / normalizedTitle + normalizedArtist).
 * - Computes 7-day rolling top artist score for dynamic Artist Mix smart playlists.
 */

import { create } from 'zustand';
import {
  getTrackIdentityKey,
  isGenericArtistName,
  MusicTrackLike,
  NormalizedMusicTrack,
  normalizeTextForKey,
  normalizeTrackMetadata,
} from '../utils/musicQueueEngine';

const AFFINITY_STORAGE_KEY = 'casa_music_affinity_v1';
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export interface RecentSearchEntry {
  query: string;
  lastSearchedAt: number;
  count: number;
}

export interface AffinityTrackRecord {
  key: string;
  track: NormalizedMusicTrack;
  playCount: number;
  completedCount: number;
  totalListenSeconds: number;
  addedToPlaylistCount: number;
  focusPlayCount: number;
  playedDuringFocus: boolean;
  isLocalUpload: boolean;
  lastPlayedAt: number;
  lastAddedAt: number;
  score: number;
}

export interface ArtistAffinityEvent {
  ts: number;
  weight: number;
}

export interface ArtistAffinityRecord {
  artist: string;
  normalizedArtist: string;
  score: number;
  events: ArtistAffinityEvent[];
}

export interface SearchSuggestionChip {
  label: string;
  query: string;
  kind: 'recent' | 'recommended' | 'neutral';
}

interface PersistedAffinityData {
  recentQueries: RecentSearchEntry[];
  trackRecords: Record<string, AffinityTrackRecord>;
  artistRecords: Record<string, ArtistAffinityRecord>;
}

const CALM_FOCUS_KEYWORDS =
  /\b(lofi|lo-fi|chill|ambient|instrumental|acoustic|piano|focus|study|sleep|calm|jazz|soft|rain)\b/i;

function sanitizeTrackForStorage(track: NormalizedMusicTrack): NormalizedMusicTrack {
  // Never persist volatile session blob: URLs across reloads as permanent playback URLs
  const hasBlob = Boolean(track.streamUrl && track.streamUrl.startsWith('blob:'));
  return {
    ...track,
    streamUrl: hasBlob ? undefined : track.streamUrl,
    candidates: hasBlob ? undefined : track.candidates,
  };
}

function loadPersistedAffinity(): PersistedAffinityData {
  if (typeof window === 'undefined') {
    return { recentQueries: [], trackRecords: {}, artistRecords: {} };
  }
  try {
    const raw = window.localStorage.getItem(AFFINITY_STORAGE_KEY);
    if (!raw) return { recentQueries: [], trackRecords: {}, artistRecords: {} };
    const parsed = JSON.parse(raw);
    return {
      recentQueries: Array.isArray(parsed?.recentQueries) ? parsed.recentQueries : [],
      trackRecords:
        parsed?.trackRecords && typeof parsed.trackRecords === 'object'
          ? parsed.trackRecords
          : {},
      artistRecords:
        parsed?.artistRecords && typeof parsed.artistRecords === 'object'
          ? parsed.artistRecords
          : {},
    };
  } catch {
    return { recentQueries: [], trackRecords: {}, artistRecords: {} };
  }
}

function savePersistedAffinity(data: PersistedAffinityData): void {
  if (typeof window === 'undefined') return;
  try {
    // Keep top 150 track records by recency/score so localStorage remains lean
    const entries = Object.entries(data.trackRecords);
    let trimmedRecords = data.trackRecords;
    if (entries.length > 150) {
      entries.sort(
        (a, b) =>
          Math.max(b[1].lastPlayedAt, b[1].lastAddedAt) -
          Math.max(a[1].lastPlayedAt, a[1].lastAddedAt)
      );
      trimmedRecords = Object.fromEntries(entries.slice(0, 150));
    }

    const sanitizedRecords: Record<string, AffinityTrackRecord> = {};
    for (const [k, rec] of Object.entries(trimmedRecords)) {
      sanitizedRecords[k] = {
        ...rec,
        track: sanitizeTrackForStorage(rec.track),
      };
    }

    window.localStorage.setItem(
      AFFINITY_STORAGE_KEY,
      JSON.stringify({
        recentQueries: data.recentQueries.slice(0, 15),
        trackRecords: sanitizedRecords,
        artistRecords: data.artistRecords,
      })
    );
  } catch (err) {
    console.warn('[useMusicAffinity] Failed to persist affinity:', err);
  }
}

export function getNeutralContextualChips(now: Date = new Date()): SearchSuggestionChip[] {
  const hour = now.getHours();
  if (hour >= 5 && hour < 12) {
    return [
      { label: 'Morning Focus', query: 'Morning Focus', kind: 'neutral' },
      { label: 'Acoustic', query: 'Acoustic', kind: 'neutral' },
      { label: 'Chill & Lo-Fi', query: 'Chill Lo-Fi', kind: 'neutral' },
      { label: 'Instrumental', query: 'Instrumental', kind: 'neutral' },
      { label: 'Ambient', query: 'Ambient', kind: 'neutral' },
    ];
  }
  if (hour >= 12 && hour < 18) {
    return [
      { label: 'Chill & Lo-Fi', query: 'Chill Lo-Fi', kind: 'neutral' },
      { label: 'Instrumental', query: 'Instrumental', kind: 'neutral' },
      { label: 'Focus Beats', query: 'Focus Beats', kind: 'neutral' },
      { label: 'Acoustic', query: 'Acoustic', kind: 'neutral' },
      { label: 'Jazz Coffee', query: 'Jazz', kind: 'neutral' },
    ];
  }
  if (hour >= 18 && hour < 22) {
    return [
      { label: 'Chill & Lo-Fi', query: 'Chill Lo-Fi', kind: 'neutral' },
      { label: 'Acoustic', query: 'Acoustic', kind: 'neutral' },
      { label: 'Late Night', query: 'Late Night Chill', kind: 'neutral' },
      { label: 'Instrumental', query: 'Instrumental', kind: 'neutral' },
      { label: 'Ambient', query: 'Ambient', kind: 'neutral' },
    ];
  }
  return [
    { label: 'Late Night', query: 'Late Night Ambient', kind: 'neutral' },
    { label: 'Ambient', query: 'Ambient', kind: 'neutral' },
    { label: 'Instrumental', query: 'Instrumental Piano', kind: 'neutral' },
    { label: 'Chill & Lo-Fi', query: 'Lo-Fi Chill', kind: 'neutral' },
    { label: 'Acoustic', query: 'Acoustic Calm', kind: 'neutral' },
  ];
}

export interface MusicAffinityState {
  recentQueries: RecentSearchEntry[];
  trackRecords: Record<string, AffinityTrackRecord>;
  artistRecords: Record<string, ArtistAffinityRecord>;
  // Session-only live local blob tracks (keyed by identity key) so local files remain playable in smart mixes
  sessionTrackCache: Record<string, NormalizedMusicTrack>;

  recordSearchQuery: (rawQuery: string) => void;
  recordTrackSeen: (
    rawTrack: MusicTrackLike,
    opts?: { isFocusActive?: boolean; isLocalUpload?: boolean }
  ) => void;
  recordTrackPlayQualified: (
    rawTrack: MusicTrackLike,
    opts: { listenedSeconds: number; completed: boolean; isFocusActive: boolean }
  ) => void;
  recordTrackPlaylistSave: (rawTrack: MusicTrackLike) => void;
  recordLocalUploads: (rawTracks: MusicTrackLike[]) => void;
  clearAffinityHistory: () => void;
  resetAffinity: () => void;
}

const initialPersisted = loadPersistedAffinity();

export const useMusicAffinityStore = create<MusicAffinityState>((set, get) => ({
  recentQueries: initialPersisted.recentQueries,
  trackRecords: initialPersisted.trackRecords,
  artistRecords: initialPersisted.artistRecords,
  sessionTrackCache: {},

  recordSearchQuery: (rawQuery: string) => {
    const cleaned = rawQuery.trim().replace(/\s+/g, ' ');
    if (cleaned.length < 2) return;
    const now = Date.now();
    const normLower = cleaned.toLowerCase();

    set((state) => {
      const existing = state.recentQueries.find(
        (q) => q.query.toLowerCase() === normLower
      );
      const filtered = state.recentQueries.filter(
        (q) => q.query.toLowerCase() !== normLower
      );
      const nextQueries: RecentSearchEntry[] = [
        {
          query: cleaned,
          lastSearchedAt: now,
          count: (existing?.count || 0) + 1,
        },
        ...filtered,
      ].slice(0, 15);

      const persisted: PersistedAffinityData = {
        recentQueries: nextQueries,
        trackRecords: state.trackRecords,
        artistRecords: state.artistRecords,
      };
      savePersistedAffinity(persisted);
      return { recentQueries: nextQueries };
    });
  },

  recordTrackSeen: (rawTrack, opts) => {
    if (!rawTrack) return;
    const norm = normalizeTrackMetadata(rawTrack);
    if (!norm.title || norm.title === 'No Media Playing') return;

    const key = getTrackIdentityKey(norm);
    const now = Date.now();

    set((state) => {
      const prevRec = state.trackRecords[key];
      const isFocus = Boolean(opts?.isFocusActive || norm.playedDuringFocus);
      const nextRec: AffinityTrackRecord = {
        key,
        track: { ...norm, addedAt: prevRec?.lastAddedAt || norm.addedAt || now },
        playCount: prevRec?.playCount || 0,
        completedCount: prevRec?.completedCount || 0,
        totalListenSeconds: prevRec?.totalListenSeconds || 0,
        addedToPlaylistCount: prevRec?.addedToPlaylistCount || 0,
        focusPlayCount: (prevRec?.focusPlayCount || 0) + (isFocus ? 1 : 0),
        playedDuringFocus: Boolean(prevRec?.playedDuringFocus || isFocus),
        isLocalUpload: Boolean(prevRec?.isLocalUpload || opts?.isLocalUpload || norm.isLocal),
        lastPlayedAt: now,
        lastAddedAt: opts?.isLocalUpload ? now : prevRec?.lastAddedAt || now,
        score: prevRec?.score || 0.5,
      };

      const nextRecords = { ...state.trackRecords, [key]: nextRec };
      const nextSessionCache =
        norm.streamUrl && norm.streamUrl.startsWith('blob:')
          ? { ...state.sessionTrackCache, [key]: norm }
          : state.sessionTrackCache;

      savePersistedAffinity({
        recentQueries: state.recentQueries,
        trackRecords: nextRecords,
        artistRecords: state.artistRecords,
      });

      return { trackRecords: nextRecords, sessionTrackCache: nextSessionCache };
    });
  },

  recordTrackPlayQualified: (rawTrack, opts) => {
    if (!rawTrack) return;
    const norm = normalizeTrackMetadata(rawTrack);
    if (!norm.title || norm.title === 'No Media Playing') return;

    const key = getTrackIdentityKey(norm);
    const now = Date.now();
    const weight = (opts.completed ? 5 : opts.listenedSeconds > 30 ? 3 : 1) + (opts.isFocusActive ? 1 : 0);

    set((state) => {
      const prevRec = state.trackRecords[key];
      const nextRec: AffinityTrackRecord = {
        key,
        track: { ...norm, addedAt: prevRec?.lastAddedAt || norm.addedAt || now },
        playCount: (prevRec?.playCount || 0) + 1,
        completedCount: (prevRec?.completedCount || 0) + (opts.completed ? 1 : 0),
        totalListenSeconds: (prevRec?.totalListenSeconds || 0) + Math.max(0, Math.round(opts.listenedSeconds)),
        addedToPlaylistCount: prevRec?.addedToPlaylistCount || 0,
        focusPlayCount: (prevRec?.focusPlayCount || 0) + (opts.isFocusActive ? 1 : 0),
        playedDuringFocus: Boolean(prevRec?.playedDuringFocus || opts.isFocusActive),
        isLocalUpload: Boolean(prevRec?.isLocalUpload || norm.isLocal),
        lastPlayedAt: now,
        lastAddedAt: prevRec?.lastAddedAt || now,
        score: (prevRec?.score || 0) + weight,
      };

      const nextRecords = { ...state.trackRecords, [key]: nextRec };
      const nextArtists = { ...state.artistRecords };

      if (!isGenericArtistName(norm.artist) && norm.normalizedArtist) {
        const prevArt = nextArtists[norm.normalizedArtist];
        const cutoff = now - THIRTY_DAYS_MS;
        const freshEvents = [...(prevArt?.events || []).filter((e) => e.ts >= cutoff), { ts: now, weight }].slice(
          -100
        );
        nextArtists[norm.normalizedArtist] = {
          artist: norm.artist,
          normalizedArtist: norm.normalizedArtist,
          score: (prevArt?.score || 0) + weight,
          events: freshEvents,
        };
      }

      const nextSessionCache =
        norm.streamUrl && norm.streamUrl.startsWith('blob:')
          ? { ...state.sessionTrackCache, [key]: norm }
          : state.sessionTrackCache;

      savePersistedAffinity({
        recentQueries: state.recentQueries,
        trackRecords: nextRecords,
        artistRecords: nextArtists,
      });

      return {
        trackRecords: nextRecords,
        artistRecords: nextArtists,
        sessionTrackCache: nextSessionCache,
      };
    });
  },

  recordTrackPlaylistSave: (rawTrack) => {
    if (!rawTrack) return;
    const norm = normalizeTrackMetadata(rawTrack);
    if (!norm.title || norm.title === 'No Media Playing') return;

    const key = getTrackIdentityKey(norm);
    const now = Date.now();
    const weight = 4;

    set((state) => {
      const prevRec = state.trackRecords[key];
      const nextRec: AffinityTrackRecord = {
        key,
        track: { ...norm, addedAt: prevRec?.lastAddedAt || norm.addedAt || now },
        playCount: prevRec?.playCount || 0,
        completedCount: prevRec?.completedCount || 0,
        totalListenSeconds: prevRec?.totalListenSeconds || 0,
        addedToPlaylistCount: (prevRec?.addedToPlaylistCount || 0) + 1,
        focusPlayCount: prevRec?.focusPlayCount || 0,
        playedDuringFocus: Boolean(prevRec?.playedDuringFocus),
        isLocalUpload: Boolean(prevRec?.isLocalUpload || norm.isLocal),
        lastPlayedAt: prevRec?.lastPlayedAt || now,
        lastAddedAt: now,
        score: (prevRec?.score || 0) + weight,
      };

      const nextRecords = { ...state.trackRecords, [key]: nextRec };
      const nextArtists = { ...state.artistRecords };

      if (!isGenericArtistName(norm.artist) && norm.normalizedArtist) {
        const prevArt = nextArtists[norm.normalizedArtist];
        const cutoff = now - THIRTY_DAYS_MS;
        const freshEvents = [...(prevArt?.events || []).filter((e) => e.ts >= cutoff), { ts: now, weight }].slice(
          -100
        );
        nextArtists[norm.normalizedArtist] = {
          artist: norm.artist,
          normalizedArtist: norm.normalizedArtist,
          score: (prevArt?.score || 0) + weight,
          events: freshEvents,
        };
      }

      const nextSessionCache =
        norm.streamUrl && norm.streamUrl.startsWith('blob:')
          ? { ...state.sessionTrackCache, [key]: norm }
          : state.sessionTrackCache;

      savePersistedAffinity({
        recentQueries: state.recentQueries,
        trackRecords: nextRecords,
        artistRecords: nextArtists,
      });

      return {
        trackRecords: nextRecords,
        artistRecords: nextArtists,
        sessionTrackCache: nextSessionCache,
      };
    });
  },

  recordLocalUploads: (rawTracks) => {
    if (!rawTracks || rawTracks.length === 0) return;
    const now = Date.now();

    set((state) => {
      const nextRecords = { ...state.trackRecords };
      const nextSessionCache = { ...state.sessionTrackCache };

      rawTracks.forEach((raw, idx) => {
        const norm = normalizeTrackMetadata(raw, { isLocal: true });
        const key = getTrackIdentityKey(norm);
        const prevRec = nextRecords[key];
        const ts = now + idx;

        nextRecords[key] = {
          key,
          track: { ...norm, addedAt: ts },
          playCount: prevRec?.playCount || 0,
          completedCount: prevRec?.completedCount || 0,
          totalListenSeconds: prevRec?.totalListenSeconds || 0,
          addedToPlaylistCount: prevRec?.addedToPlaylistCount || 0,
          focusPlayCount: prevRec?.focusPlayCount || 0,
          playedDuringFocus: Boolean(prevRec?.playedDuringFocus),
          isLocalUpload: true,
          lastPlayedAt: prevRec?.lastPlayedAt || 0,
          lastAddedAt: ts,
          score: (prevRec?.score || 0) + 1,
        };

        if (norm.streamUrl && norm.streamUrl.startsWith('blob:')) {
          nextSessionCache[key] = norm;
        }
      });

      savePersistedAffinity({
        recentQueries: state.recentQueries,
        trackRecords: nextRecords,
        artistRecords: state.artistRecords,
      });

      return { trackRecords: nextRecords, sessionTrackCache: nextSessionCache };
    });
  },

  clearAffinityHistory: () => {
    const empty: PersistedAffinityData = {
      recentQueries: [],
      trackRecords: {},
      artistRecords: {},
    };
    savePersistedAffinity(empty);
    set({ ...empty, sessionTrackCache: {} });
  },
  resetAffinity: () => {
    const empty: PersistedAffinityData = {
      recentQueries: [],
      trackRecords: {},
      artistRecords: {},
    };
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(AFFINITY_STORAGE_KEY);
      } catch {}
    }
    set({ ...empty, sessionTrackCache: {} });
  },
}));

// Cross-window real-time sync so Reset Rekomendasi Musik in "settings" window updates "main" immediately
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== AFFINITY_STORAGE_KEY) return;
    useMusicAffinityStore.setState({
      ...loadPersistedAffinity(),
      sessionTrackCache: {},
    });
  });
}

/**
 * Resolves the top-scoring artist in the rolling 7-day window.
 * Returns null if there is no 7-day artist history yet.
 */
export function getTopArtistLast7Days(
  artistRecords: Record<string, ArtistAffinityRecord>,
  now: number = Date.now()
): { artist: string; normalizedArtist: string; score: number } | null {
  const cutoff = now - SEVEN_DAYS_MS;
  let best: { artist: string; normalizedArtist: string; score: number } | null = null;

  for (const rec of Object.values(artistRecords)) {
    if (!rec || isGenericArtistName(rec.artist)) continue;
    const weekScore = (rec.events || [])
      .filter((ev) => ev.ts >= cutoff)
      .reduce((sum, ev) => sum + ev.weight, 0);

    if (weekScore > 0 && (!best || weekScore > best.score)) {
      best = {
        artist: rec.artist,
        normalizedArtist: rec.normalizedArtist,
        score: weekScore,
      };
    }
  }

  return best;
}

/**
 * Generates adaptive chips (`[Recent Search]` + `[Top Artist / Vibe]`) or zero-state neutral chips.
 */
export function buildAdaptiveSearchChips(
  recentQueries: RecentSearchEntry[],
  trackRecords: Record<string, AffinityTrackRecord>,
  artistRecords: Record<string, ArtistAffinityRecord>,
  now: Date = new Date()
): SearchSuggestionChip[] {
  const hasHistory =
    recentQueries.length > 0 ||
    Object.values(trackRecords).some((r) => r.playCount > 0 || r.addedToPlaylistCount > 0);

  if (!hasHistory) {
    return getNeutralContextualChips(now);
  }

  const chips: SearchSuggestionChip[] = [];
  const seen = new Set<string>();

  const pushUnique = (chip: SearchSuggestionChip) => {
    const key = normalizeTextForKey(chip.query);
    if (!key || seen.has(key)) return;
    seen.add(key);
    chips.push(chip);
  };

  // 1. Recent Searches (up to 3)
  const sortedQueries = [...recentQueries].sort(
    (a, b) => b.lastSearchedAt - a.lastSearchedAt
  );
  for (const entry of sortedQueries.slice(0, 3)) {
    pushUnique({
      label: entry.query,
      query: entry.query,
      kind: 'recent',
    });
  }

  // 2. Top Affinity Artists (7-day weighted or overall)
  const topArtists = Object.values(artistRecords)
    .filter((a) => a && !isGenericArtistName(a.artist) && a.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);

  for (const art of topArtists) {
    pushUnique({
      label: art.artist,
      query: art.artist,
      kind: 'recommended',
    });
  }

  // 3. Top Vibe (if user listens to Focus / Calm tracks)
  const hasFocusAffinity = Object.values(trackRecords).some(
    (r) =>
      r.focusPlayCount > 0 ||
      CALM_FOCUS_KEYWORDS.test(`${r.track.title} ${r.track.artist}`)
  );
  if (hasFocusAffinity && chips.length < 5) {
    pushUnique({
      label: 'Focus & Chill',
      query: 'Focus & Chill',
      kind: 'recommended',
    });
  }

  // Fill up to 4 chips cleanly with neutral contextual chips if affinity is still sparse
  if (chips.length < 4) {
    for (const neutral of getNeutralContextualChips(now)) {
      if (chips.length >= 5) break;
      pushUnique(neutral);
    }
  }

  return chips.slice(0, 6);
}

/**
 * Convenience React hook for adaptive recommendations & affinity tracking.
 */
export function useMusicAffinity() {
  const recentQueries = useMusicAffinityStore((s) => s.recentQueries);
  const trackRecords = useMusicAffinityStore((s) => s.trackRecords);
  const artistRecords = useMusicAffinityStore((s) => s.artistRecords);
  const sessionTrackCache = useMusicAffinityStore((s) => s.sessionTrackCache);
  const recordSearchQuery = useMusicAffinityStore((s) => s.recordSearchQuery);
  const recordTrackSeen = useMusicAffinityStore((s) => s.recordTrackSeen);
  const recordTrackPlayQualified = useMusicAffinityStore(
    (s) => s.recordTrackPlayQualified
  );
  const recordTrackPlaylistSave = useMusicAffinityStore(
    (s) => s.recordTrackPlaylistSave
  );
  const recordLocalUploads = useMusicAffinityStore((s) => s.recordLocalUploads);

  const suggestionChips = buildAdaptiveSearchChips(
    recentQueries,
    trackRecords,
    artistRecords
  );

  // Returns recent/high-affinity playable tracks (for Search zero-state library shortcuts)
  const affinityTracks = Object.values(trackRecords)
    .sort((a, b) => b.score - a.score || b.lastPlayedAt - a.lastPlayedAt)
    .slice(0, 8)
    .map((rec) => sessionTrackCache[rec.key] || rec.track);

  return {
    recentQueries,
    trackRecords,
    artistRecords,
    suggestionChips,
    affinityTracks,
    topArtist7Days: getTopArtistLast7Days(artistRecords),
    recordSearchQuery,
    recordTrackSeen,
    recordTrackPlayQualified,
    recordTrackPlaylistSave,
    recordLocalUploads,
  };
}
