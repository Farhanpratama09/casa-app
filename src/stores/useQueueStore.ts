/**
 * useQueueStore.ts
 * Unified Dual-Tier Smart Queue Store (v2.1.4)
 *
 * Manages:
 * 1. `manualQueue`: Explicit user-queued tracks or active playlist tail (sequential or Fisher-Yates when shuffled; NO forced loop on repeatMode === 'off').
 * 2. `radioQueue`: Smart Queue auto-filled tracks (up to 5 relevant tracks when manualQueue < 2 and repeatMode === 'off').
 * 3. `sessionSeeds`: Active session seed pool (`videoId` & `artistId`) updated when tracks play or are manually queued, or from active playlist. Never falls back to 30-day personal mix.
 * 4. `history`: Past played tracks in current session (strict deduplication & previous stepping).
 * 5. `repeatMode`: `'off' | 'all' | 'one'`.
 */

import { create } from 'zustand';
import { fetchAutoRadioRecommendations, RadioTrackItem } from '../services/radioEngine';
import { NativeTrack } from '../services/nativeAudioService';
import { SpotifyTrackItem } from '../utils/spotifyService';
import { getSettingsSnapshot } from './useSettingsStore';
import {
  buildOrderedQueue,
  fisherYatesShuffle,
  isSameTrack,
  MusicTrackLike,
  normalizeTrackMetadata,
  RepeatMode,
  shouldTriggerSmartFill,
} from '../utils/musicQueueEngine';

export type QueueTrackSource = 'native' | 'spotify';
export type PlaybackContextKind = 'single' | 'playlist' | 'collection';

export interface SmartQueueTrack {
  id: string;
  title: string;
  artist: string;
  durationSeconds: number;
  durationMs?: number;
  thumbnailUrl: string;
  albumArt?: string;
  artworkUrl?: string;
  streamUrl?: string;
  candidates?: string[];
  album?: string;
  albumTitle?: string;
  artistId?: string;
  browseId?: string;
  playlistId?: string;
  uri?: string;
  source: QueueTrackSource;
  isLocal?: boolean;
  isRadio?: boolean;
  isSmartQueue?: boolean;
}

/**
 * Normalizes any incoming track into a standardized Title-First SmartQueueTrack object.
 */
export function toSmartQueueTrack(
  track: any,
  source: QueueTrackSource = 'native',
  isRadio = false
): SmartQueueTrack {
  const norm = normalizeTrackMetadata(track as MusicTrackLike);
  const resolvedSource: QueueTrackSource =
    norm.source === 'spotify' ? 'spotify' : source === 'spotify' && !norm.isLocal ? 'spotify' : 'native';

  return {
    id: norm.id,
    title: norm.title,
    artist: norm.artist,
    durationSeconds: norm.durationSeconds,
    durationMs: norm.durationMs,
    thumbnailUrl: norm.thumbnailUrl,
    albumArt: norm.albumArt || norm.thumbnailUrl,
    artworkUrl: norm.artworkUrl || norm.thumbnailUrl,
    streamUrl: norm.streamUrl,
    candidates: norm.candidates,
    album: norm.album || '',
    albumTitle: norm.albumTitle || track?.albumTitle || norm.album || '',
    artistId: norm.artistId || track?.artistId,
    browseId: norm.browseId || track?.browseId,
    playlistId: norm.playlistId || track?.playlistId,
    uri: norm.uri || (resolvedSource === 'spotify' ? `spotify:track:${norm.id}` : undefined),
    source: resolvedSource,
    isLocal: norm.isLocal,
    isRadio: Boolean(isRadio || track?.isRadio || track?.isSmartQueue),
    isSmartQueue: Boolean(isRadio || track?.isSmartQueue || track?.isRadio),
  };
}

function mergeSessionSeeds(
  existing: SmartQueueTrack[],
  incoming: SmartQueueTrack[],
  maxSeeds = 8
): SmartQueueTrack[] {
  const result: SmartQueueTrack[] = [];
  for (const cand of [...incoming, ...existing]) {
    if (!cand || (!cand.id && !cand.title)) continue;
    if (result.some((item) => isSameTrack(item, cand))) continue;
    result.push(cand);
    if (result.length >= maxSeeds) break;
  }
  return result;
}

const NEXT_REPEAT_MODE: Record<RepeatMode, RepeatMode> = {
  off: 'all',
  all: 'one',
  one: 'off',
};

let activeRadioAbort: AbortController | null = null;
let activeRadioPromise: Promise<void> | null = null;
let activeRadioEpoch = -1;

function cancelInFlightRadio(): void {
  if (activeRadioAbort) {
    try {
      activeRadioAbort.abort();
    } catch {}
    activeRadioAbort = null;
  }
}

export interface QueueStoreState {
  manualQueue: SmartQueueTrack[];
  unshuffledManualQueue: SmartQueueTrack[];
  radioQueue: SmartQueueTrack[];
  history: SmartQueueTrack[];
  sessionSeeds: SmartQueueTrack[];
  activeCollectionTracks: SmartQueueTrack[];
  playbackContextKind: PlaybackContextKind;
  currentTrack: SmartQueueTrack | null;
  activeSource: QueueTrackSource;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  isFetchingRadio: boolean;
  suppressAutoFill: boolean;
  clearVersion: number;
  radioEpoch: number;

  // Configuration Actions
  setActiveSource: (source: QueueTrackSource) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  toggleRepeat: () => RepeatMode;
  setCurrentTrack: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem | null) => void;

  // Manual Queue Actions
  addToManualQueue: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  prependToManualQueue: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  removeFromManualQueue: (index: number) => void;
  clearManualQueue: () => void;
  setManualQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem>) => void;
  setOrderedPlaylistQueue: (
    tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem>,
    clickedIndexOrTrack: number | SmartQueueTrack | NativeTrack | SpotifyTrackItem,
    options?: { contextKind?: PlaybackContextKind }
  ) => { currentTrack: SmartQueueTrack | null; upNext: SmartQueueTrack[] };

  // Smart Queue / Auto-Fill Actions
  addToRadioQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem | RadioTrackItem>) => void;
  removeFromRadioQueue: (index: number) => void;
  clearRadioQueue: () => void;
  setRadioQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem | RadioTrackItem>) => void;

  // Unified Actions
  clearAllQueues: () => void;
  recordHistory: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  toggleShuffle: () => boolean;
  setShuffle: (val: boolean) => void;

  // Playback Progression & Smart Auto-Fill
  getNextTrack: (options?: { awaitSmartFill?: boolean }) => Promise<SmartQueueTrack | null>;
  triggerAutoRadio: (force?: boolean) => Promise<void>;
}

export const useQueueStore = create<QueueStoreState>((set, get) => ({
  manualQueue: [],
  unshuffledManualQueue: [],
  radioQueue: [],
  history: [],
  sessionSeeds: [],
  activeCollectionTracks: [],
  playbackContextKind: 'single',
  currentTrack: null,
  activeSource: 'native',
  isShuffle: false,
  repeatMode: 'off',
  isFetchingRadio: false,
  suppressAutoFill: false,
  clearVersion: 0,
  radioEpoch: 0,

  setActiveSource: (source: QueueTrackSource) => {
    set({ activeSource: source });
  },

  setRepeatMode: (mode: RepeatMode) => {
    const nextEpoch = get().radioEpoch + 1;
    if (mode !== 'off') {
      cancelInFlightRadio();
    }
    set((state) => ({
      repeatMode: mode,
      radioEpoch: mode !== 'off' ? nextEpoch : state.radioEpoch,
      isFetchingRadio: mode !== 'off' ? false : state.isFetchingRadio,
    }));

    if (mode === 'off') {
      const s = get();
      if (
        !s.suppressAutoFill &&
        shouldTriggerSmartFill({
          currentTrack: s.currentTrack,
          manualQueueLength: s.manualQueue.length,
          smartQueueLength: s.radioQueue.length,
          repeatMode: 'off',
        })
      ) {
        void get().triggerAutoRadio();
      }
    }
  },

  toggleRepeat: () => {
    const next = NEXT_REPEAT_MODE[get().repeatMode] || 'off';
    get().setRepeatMode(next);
    return next;
  },

  setCurrentTrack: (track) => {
    if (!track) {
      cancelInFlightRadio();
      set((state) => ({
        currentTrack: null,
        radioEpoch: state.radioEpoch + 1,
        isFetchingRadio: false,
      }));
      return;
    }
    const smart = toSmartQueueTrack(track, get().activeSource);
    const sameAsCurrent = isSameTrack(get().currentTrack, smart);
    if (!sameAsCurrent) {
      cancelInFlightRadio();
    }
    set((state) => ({
      currentTrack: smart,
      suppressAutoFill: false,
      radioEpoch: sameAsCurrent ? state.radioEpoch : state.radioEpoch + 1,
      isFetchingRadio: sameAsCurrent ? state.isFetchingRadio : false,
      sessionSeeds: mergeSessionSeeds(state.sessionSeeds, [smart]),
      manualQueue: state.manualQueue.filter((t) => !isSameTrack(t, smart)),
      unshuffledManualQueue: state.unshuffledManualQueue.filter(
        (t) => !isSameTrack(t, smart)
      ),
      radioQueue: state.radioQueue.filter((t) => !isSameTrack(t, smart)),
    }));
    get().recordHistory(smart);

    const updated = get();
    if (
      shouldTriggerSmartFill({
        currentTrack: updated.currentTrack,
        manualQueueLength: updated.manualQueue.length,
        smartQueueLength: updated.radioQueue.length,
        repeatMode: updated.repeatMode,
      })
    ) {
      void get().triggerAutoRadio();
    }
  },

  addToManualQueue: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource, false);
    set((state) => ({
      suppressAutoFill: false,
      sessionSeeds: mergeSessionSeeds(state.sessionSeeds, [track]),
      manualQueue: [...state.manualQueue, track],
      unshuffledManualQueue: [...state.unshuffledManualQueue, track],
    }));
  },

  prependToManualQueue: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource, false);
    set((state) => ({
      suppressAutoFill: false,
      sessionSeeds: mergeSessionSeeds(state.sessionSeeds, [track]),
      manualQueue: [
        track,
        ...state.manualQueue.filter((t) => !isSameTrack(t, track)),
      ],
      unshuffledManualQueue: [
        track,
        ...state.unshuffledManualQueue.filter((t) => !isSameTrack(t, track)),
      ],
    }));
  },

  removeFromManualQueue: (index: number) => {
    set((state) => {
      const removed = state.manualQueue[index];
      return {
        manualQueue: state.manualQueue.filter((_, i) => i !== index),
        unshuffledManualQueue: removed
          ? state.unshuffledManualQueue.filter((t) => !isSameTrack(t, removed))
          : state.unshuffledManualQueue,
      };
    });

    const s = get();
    if (
      !s.suppressAutoFill &&
      shouldTriggerSmartFill({
        currentTrack: s.currentTrack,
        manualQueueLength: s.manualQueue.length,
        smartQueueLength: s.radioQueue.length,
        repeatMode: s.repeatMode,
      })
    ) {
      void get().triggerAutoRadio();
    }
  },

  clearManualQueue: () => {
    set({ manualQueue: [], unshuffledManualQueue: [] });
  },

  setManualQueue: (rawTracks) => {
    const source = get().activeSource;
    const sequential = rawTracks.map((t) => toSmartQueueTrack(t, source, false));
    const finalTracks = get().isShuffle ? fisherYatesShuffle(sequential) : sequential;
    set((state) => ({
      suppressAutoFill: false,
      sessionSeeds: mergeSessionSeeds(state.sessionSeeds, sequential.slice(0, 6)),
      manualQueue: finalTracks,
      unshuffledManualQueue: sequential,
    }));

    const s = get();
    if (
      shouldTriggerSmartFill({
        currentTrack: s.currentTrack,
        manualQueueLength: s.manualQueue.length,
        smartQueueLength: s.radioQueue.length,
        repeatMode: s.repeatMode,
      })
    ) {
      void get().triggerAutoRadio();
    }
  },

  setOrderedPlaylistQueue: (rawTracks, clickedIndexOrTrack, options) => {
    const source = get().activeSource;
    const contextKind: PlaybackContextKind =
      options?.contextKind ?? (rawTracks.length > 1 ? 'playlist' : 'single');

    // Never wrap [0..startIndex-1] into manualQueue: Repeat All loops at queue exhaustion cleanly,
    // while Repeat Off finishes forward and transitions into Smart Queue seeded from playlist tracks.
    const ordered = buildOrderedQueue(rawTracks, clickedIndexOrTrack, false, {
      wrapAround: false,
    });
    if (!ordered.currentTrack) {
      return { currentTrack: null, upNext: [] };
    }

    cancelInFlightRadio();

    const currentSmart = toSmartQueueTrack(ordered.currentTrack, source, false);
    const sequentialUpNext = ordered.upNext.map((t) => toSmartQueueTrack(t, source, false));
    const activeUpNext = get().isShuffle
      ? fisherYatesShuffle(sequentialUpNext)
      : sequentialUpNext;

    const fullCollection =
      contextKind !== 'single' && rawTracks.length > 0
        ? rawTracks.map((t) => toSmartQueueTrack(t, source, false))
        : [currentSmart];

    const seedBatch =
      contextKind !== 'single'
        ? [currentSmart, ...fullCollection.filter((t) => !isSameTrack(t, currentSmart)).slice(0, 4)]
        : [currentSmart];

    set((state) => ({
      currentTrack: currentSmart,
      suppressAutoFill: false,
      playbackContextKind: contextKind,
      activeCollectionTracks: fullCollection,
      sessionSeeds:
        contextKind !== 'single'
          ? seedBatch.slice(0, 8)
          : mergeSessionSeeds(state.sessionSeeds, seedBatch),
      manualQueue: activeUpNext,
      unshuffledManualQueue: sequentialUpNext,
      radioQueue: [],
      radioEpoch: state.radioEpoch + 1,
      isFetchingRadio: false,
    }));
    get().recordHistory(currentSmart);

    const updated = get();
    if (
      shouldTriggerSmartFill({
        currentTrack: updated.currentTrack,
        manualQueueLength: updated.manualQueue.length,
        smartQueueLength: updated.radioQueue.length,
        repeatMode: updated.repeatMode,
      })
    ) {
      void get().triggerAutoRadio();
    }

    return { currentTrack: currentSmart, upNext: activeUpNext };
  },

  addToRadioQueue: (rawTracks) => {
    const source = get().activeSource;
    const tracks = rawTracks.map((t) => toSmartQueueTrack(t, source, true));
    set((state) => ({
      radioQueue: [...state.radioQueue, ...tracks].slice(0, 5),
    }));
  },

  removeFromRadioQueue: (index: number) => {
    set((state) => ({
      radioQueue: state.radioQueue.filter((_, i) => i !== index),
    }));
  },

  clearRadioQueue: () => {
    cancelInFlightRadio();
    set((state) => ({
      radioQueue: [],
      radioEpoch: state.radioEpoch + 1,
      isFetchingRadio: false,
    }));
  },

  setRadioQueue: (rawTracks) => {
    const source = get().activeSource;
    const tracks = rawTracks.map((t) => toSmartQueueTrack(t, source, true)).slice(0, 5);
    const finalTracks = get().isShuffle ? fisherYatesShuffle(tracks) : tracks;
    set({ radioQueue: finalTracks });
  },

  clearAllQueues: () => {
    cancelInFlightRadio();
    set((state) => ({
      manualQueue: [],
      unshuffledManualQueue: [],
      radioQueue: [],
      activeCollectionTracks: state.currentTrack ? [state.currentTrack] : [],
      playbackContextKind: 'single',
      sessionSeeds: state.currentTrack ? [state.currentTrack] : [],
      suppressAutoFill: true,
      clearVersion: state.clearVersion + 1,
      radioEpoch: state.radioEpoch + 1,
      isFetchingRadio: false,
    }));
  },

  recordHistory: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource);
    set((state) => {
      const filtered = state.history.filter((h) => !isSameTrack(h, track));
      return {
        history: [track, ...filtered].slice(0, 40),
      };
    });
  },

  toggleShuffle: () => {
    const nextVal = !get().isShuffle;
    get().setShuffle(nextVal);
    return nextVal;
  },

  setShuffle: (val: boolean) => {
    set((state) => {
      if (val) {
        const baseSequential =
          state.unshuffledManualQueue.length > 0
            ? state.unshuffledManualQueue
            : state.manualQueue;
        const shuffledManual = fisherYatesShuffle(state.manualQueue);
        const shuffledSmart = fisherYatesShuffle(state.radioQueue);
        return {
          isShuffle: true,
          unshuffledManualQueue: baseSequential,
          manualQueue: shuffledManual,
          radioQueue: shuffledSmart,
        };
      } else {
        const restoredManual =
          state.unshuffledManualQueue.length > 0
            ? state.unshuffledManualQueue.filter((t) =>
                state.manualQueue.some((m) => isSameTrack(m, t))
              )
            : state.manualQueue;
        return {
          isShuffle: false,
          manualQueue: restoredManual,
        };
      }
    });
  },

  getNextTrack: async (options) => {
    const {
      manualQueue,
      radioQueue,
      repeatMode,
      activeCollectionTracks,
      currentTrack,
      isShuffle,
      suppressAutoFill,
    } = get();
    let nextTrack: SmartQueueTrack | null = null;

    if (manualQueue.length > 0) {
      const [first, ...rest] = manualQueue;
      nextTrack = first;
      cancelInFlightRadio();
      set((state) => ({
        manualQueue: rest,
        unshuffledManualQueue: state.unshuffledManualQueue.filter(
          (t) => !isSameTrack(t, first)
        ),
        radioEpoch: state.radioEpoch + 1,
        isFetchingRadio: false,
      }));
    } else if (repeatMode === 'all') {
      const loopPool =
        activeCollectionTracks.length > 0
          ? activeCollectionTracks
          : currentTrack
          ? [currentTrack]
          : [];
      if (loopPool.length > 0) {
        const orderedLoop = isShuffle ? fisherYatesShuffle(loopPool) : [...loopPool];
        const [first, ...rest] = orderedLoop;
        nextTrack = first;
        set({
          manualQueue: rest,
          unshuffledManualQueue: loopPool.slice(1),
        });
      }
    } else if (radioQueue.length > 0) {
      const [first, ...rest] = radioQueue;
      nextTrack = first;
      set({ radioQueue: rest });
    } else if (options?.awaitSmartFill && repeatMode === 'off' && !suppressAutoFill && currentTrack) {
      const epochBeforeAwait = get().radioEpoch;
      await get().triggerAutoRadio(true);
      const afterWait = get();
      if (afterWait.radioEpoch === epochBeforeAwait && afterWait.manualQueue.length === 0 && afterWait.radioQueue.length > 0) {
        const [first, ...rest] = afterWait.radioQueue;
        nextTrack = first;
        set({ radioQueue: rest });
      }
    }

    if (nextTrack) {
      get().recordHistory(nextTrack);
      set((state) => ({
        currentTrack: nextTrack,
        suppressAutoFill: false,
        sessionSeeds: mergeSessionSeeds(state.sessionSeeds, [nextTrack!]),
      }));
    }

    const after = get();
    if (
      !after.suppressAutoFill &&
      shouldTriggerSmartFill({
        currentTrack: after.currentTrack,
        manualQueueLength: after.manualQueue.length,
        smartQueueLength: after.radioQueue.length,
        repeatMode: after.repeatMode,
      })
    ) {
      void get().triggerAutoRadio();
    }

    return nextTrack;
  },

  /**
   * Session-Seeded Smart Auto-Fill (`Up Next` < 2 & repeatMode === 'off'):
   * Draws recommendations exclusively via official `Up Next / Watch Playlist` (`videoId`) and
   * official `artistId` fallback using active session seeds (`sessionSeeds` / `activeCollectionTracks`).
   * Never falls back to 30-day personal history (`trackRecords`).
   */
  triggerAutoRadio: async (force = false) => {
    const state = get();
    if (state.isFetchingRadio && activeRadioEpoch === state.radioEpoch && activeRadioPromise) {
      if (force) {
        return activeRadioPromise;
      }
      return;
    }
    if (!force && state.suppressAutoFill) return;
    if (
      !shouldTriggerSmartFill({
        currentTrack: state.currentTrack,
        manualQueueLength: state.manualQueue.length,
        smartQueueLength: state.radioQueue.length,
        repeatMode: state.repeatMode,
      })
    ) {
      return;
    }

    const current = state.currentTrack;
    if (!current) return;

    const needed = Math.max(0, 5 - state.radioQueue.length);
    if (needed === 0) return;

    const epochAtStart = state.radioEpoch;
    const clearVersionAtStart = state.clearVersion;

    cancelInFlightRadio();
    const controller = new AbortController();
    activeRadioAbort = controller;
    activeRadioEpoch = epochAtStart;

    set({ isFetchingRadio: true });

    const runPromise = (async () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.onLine === false) {
          return;
        }

        // Session seeds: prioritize active playlist/collection tracks and active session tracks only
        const seedCandidates = mergeSessionSeeds(
          state.activeCollectionTracks,
          [current, ...state.sessionSeeds],
          6
        ).filter((s) => !isSameTrack(s, current));

        let region: 'auto' | 'ID' | 'US' | 'KR' | 'JP' = 'auto';
        try {
          region = getSettingsSnapshot().playerRegion || 'auto';
        } catch {
          region = 'auto';
        }

        const existingAll = [
          current,
          ...state.manualQueue,
          ...state.radioQueue,
          ...state.history,
        ];

        const remoteItems = await fetchAutoRadioRecommendations(
          current,
          state.activeSource,
          state.history,
          [...state.manualQueue, ...state.radioQueue],
          {
            sessionSeeds: seedCandidates,
            region,
            signal: controller.signal,
          }
        );

        // Cancel cleanly if queue/track/clear epoch shifted while awaiting network response
        if (
          controller.signal.aborted ||
          get().radioEpoch !== epochAtStart ||
          get().clearVersion !== clearVersionAtStart
        ) {
          return;
        }

        const latest = get();
        const latestExclusions = [
          latest.currentTrack || current,
          ...latest.manualQueue,
          ...latest.radioQueue,
          ...latest.history,
          ...existingAll,
        ];

        const picked: SmartQueueTrack[] = [];
        for (const item of remoteItems) {
          if (picked.length >= needed) break;
          const mapped = toSmartQueueTrack(item, latest.activeSource, true);
          if (
            latestExclusions.some((ex) => isSameTrack(ex, mapped)) ||
            picked.some((p) => isSameTrack(p, mapped))
          ) {
            continue;
          }
          picked.push(mapped);
        }

        if (picked.length > 0) {
          const formattedItems = latest.isShuffle ? fisherYatesShuffle(picked) : picked;
          set((s) => {
            if (s.radioEpoch !== epochAtStart || s.clearVersion !== clearVersionAtStart) {
              return s;
            }
            return {
              radioQueue: [...s.radioQueue, ...formattedItems].slice(0, 5),
            };
          });
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('[useQueueStore] triggerAutoRadio failed:', err);
        }
      } finally {
        if (activeRadioAbort === controller) {
          activeRadioAbort = null;
          activeRadioPromise = null;
        }
        if (get().radioEpoch === epochAtStart && get().clearVersion === clearVersionAtStart) {
          set({ isFetchingRadio: false });
        }
      }
    })();

    activeRadioPromise = runPromise;
    return runPromise;
  },
}));
