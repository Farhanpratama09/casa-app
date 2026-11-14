/**
 * useQueueStore.ts
 * Unified Dual-Tier Smart Queue Store
 *
 * Manages:
 * 1. `manualQueue`: Explicit user-queued tracks (deterministic sequential or pure Fisher-Yates up-next when shuffled).
 * 2. `radioQueue`: Smart Queue auto-filled tracks (up to 5 relevant tracks when manualQueue < 2 and !isRepeat).
 * 3. `history`: Past played tracks (prevents radio loops & supports previous-track stepping).
 * 4. Title-First Identity: Matches strictly via `id` and `(normalizedTitle + normalizedArtist)` — never artist-only.
 */

import { create } from 'zustand';
import { fetchAutoRadioRecommendations, RadioTrackItem } from '../services/radioEngine';
import { NativeTrack } from '../services/nativeAudioService';
import { SpotifyTrackItem } from '../utils/spotifyService';
import {
  buildOrderedQueue,
  fisherYatesShuffle,
  isSameTrack,
  MusicTrackLike,
  normalizeTrackMetadata,
  selectSmartFillCandidates,
  shouldTriggerSmartFill,
} from '../utils/musicQueueEngine';
import { useMusicAffinityStore } from '../hooks/useMusicAffinity';
import { usePlaylistStore } from './usePlaylistStore';

export type QueueTrackSource = 'native' | 'spotify';

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
    uri: norm.uri || (resolvedSource === 'spotify' ? `spotify:track:${norm.id}` : undefined),
    source: resolvedSource,
    isLocal: norm.isLocal,
    isRadio: Boolean(isRadio || track?.isRadio || track?.isSmartQueue),
    isSmartQueue: Boolean(isRadio || track?.isSmartQueue || track?.isRadio),
  };
}

export interface QueueStoreState {
  manualQueue: SmartQueueTrack[];
  unshuffledManualQueue: SmartQueueTrack[];
  radioQueue: SmartQueueTrack[];
  history: SmartQueueTrack[];
  currentTrack: SmartQueueTrack | null;
  activeSource: QueueTrackSource;
  isShuffle: boolean;
  isRepeat: boolean;
  isFetchingRadio: boolean;
  suppressAutoFill: boolean;
  clearVersion: number;

  // Configuration Actions
  setActiveSource: (source: QueueTrackSource) => void;
  setRepeat: (val: boolean) => void;
  setCurrentTrack: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem | null) => void;

  // Manual Queue Actions
  addToManualQueue: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  prependToManualQueue: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  removeFromManualQueue: (index: number) => void;
  clearManualQueue: () => void;
  setManualQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem>) => void;
  setOrderedPlaylistQueue: (
    tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem>,
    clickedIndexOrTrack: number | SmartQueueTrack | NativeTrack | SpotifyTrackItem
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
  getNextTrack: () => Promise<SmartQueueTrack | null>;
  triggerAutoRadio: (force?: boolean) => Promise<void>;
}

export const useQueueStore = create<QueueStoreState>((set, get) => ({
  manualQueue: [],
  unshuffledManualQueue: [],
  radioQueue: [],
  history: [],
  currentTrack: null,
  activeSource: 'native',
  isShuffle: false,
  isRepeat: false,
  isFetchingRadio: false,
  suppressAutoFill: false,
  clearVersion: 0,

  setActiveSource: (source: QueueTrackSource) => {
    set({ activeSource: source });
  },

  setRepeat: (val: boolean) => {
    set({ isRepeat: val });
    if (!val) {
      const s = get();
      if (
        !s.suppressAutoFill &&
        shouldTriggerSmartFill({
          currentTrack: s.currentTrack,
          manualQueueLength: s.manualQueue.length,
          smartQueueLength: s.radioQueue.length,
          isRepeat: false,
        })
      ) {
        void get().triggerAutoRadio();
      }
    }
  },

  setCurrentTrack: (track) => {
    if (!track) {
      set({ currentTrack: null });
      return;
    }
    const smart = toSmartQueueTrack(track, get().activeSource);
    set((state) => ({
      currentTrack: smart,
      suppressAutoFill: false,
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
        isRepeat: updated.isRepeat,
      })
    ) {
      void get().triggerAutoRadio();
    }
  },

  addToManualQueue: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource, false);
    set((state) => ({
      suppressAutoFill: false,
      manualQueue: [...state.manualQueue, track],
      unshuffledManualQueue: [...state.unshuffledManualQueue, track],
    }));
  },

  prependToManualQueue: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource, false);
    set((state) => ({
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
        isRepeat: s.isRepeat,
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
    set({
      suppressAutoFill: false,
      manualQueue: finalTracks,
      unshuffledManualQueue: sequential,
    });

    const s = get();
    if (
      shouldTriggerSmartFill({
        currentTrack: s.currentTrack,
        manualQueueLength: s.manualQueue.length,
        smartQueueLength: s.radioQueue.length,
        isRepeat: s.isRepeat,
      })
    ) {
      void get().triggerAutoRadio();
    }
  },

  setOrderedPlaylistQueue: (rawTracks, clickedIndexOrTrack) => {
    const source = get().activeSource;
    const ordered = buildOrderedQueue(rawTracks, clickedIndexOrTrack, false);
    if (!ordered.currentTrack) {
      return { currentTrack: null, upNext: [] };
    }

    const currentSmart = toSmartQueueTrack(ordered.currentTrack, source, false);
    const sequentialUpNext = ordered.upNext.map((t) => toSmartQueueTrack(t, source, false));
    const activeUpNext = get().isShuffle
      ? fisherYatesShuffle(sequentialUpNext)
      : sequentialUpNext;

    set((state) => ({
      currentTrack: currentSmart,
      suppressAutoFill: false,
      manualQueue: activeUpNext,
      unshuffledManualQueue: sequentialUpNext,
      radioQueue: state.radioQueue.filter(
        (r) =>
          !isSameTrack(r, currentSmart) &&
          !activeUpNext.some((m) => isSameTrack(m, r))
      ),
    }));
    get().recordHistory(currentSmart);

    const updated = get();
    if (
      shouldTriggerSmartFill({
        currentTrack: updated.currentTrack,
        manualQueueLength: updated.manualQueue.length,
        smartQueueLength: updated.radioQueue.length,
        isRepeat: updated.isRepeat,
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
    set({ radioQueue: [] });
  },

  setRadioQueue: (rawTracks) => {
    const source = get().activeSource;
    const tracks = rawTracks.map((t) => toSmartQueueTrack(t, source, true)).slice(0, 5);
    const finalTracks = get().isShuffle ? fisherYatesShuffle(tracks) : tracks;
    set({ radioQueue: finalTracks });
  },

  clearAllQueues: () => {
    set((state) => ({
      manualQueue: [],
      unshuffledManualQueue: [],
      radioQueue: [],
      suppressAutoFill: true,
      clearVersion: state.clearVersion + 1,
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
        // Pure Fisher-Yates ONLY on upcoming tracks; currentTrack remains untouched
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
        // Restore sequential order for remaining tracks still present in manualQueue
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

  getNextTrack: async () => {
    const { manualQueue, radioQueue } = get();
    let nextTrack: SmartQueueTrack | null = null;

    if (manualQueue.length > 0) {
      const [first, ...rest] = manualQueue;
      nextTrack = first;
      set((state) => ({
        manualQueue: rest,
        unshuffledManualQueue: state.unshuffledManualQueue.filter(
          (t) => !isSameTrack(t, first)
        ),
      }));
    } else if (radioQueue.length > 0) {
      const [first, ...rest] = radioQueue;
      nextTrack = first;
      set({ radioQueue: rest });
    }

    if (nextTrack) {
      get().recordHistory(nextTrack);
      set({ currentTrack: nextTrack, suppressAutoFill: false });
    }

    const after = get();
    if (
      !after.suppressAutoFill &&
      shouldTriggerSmartFill({
        currentTrack: after.currentTrack,
        manualQueueLength: after.manualQueue.length,
        smartQueueLength: after.radioQueue.length,
        isRepeat: after.isRepeat,
      })
    ) {
      void get().triggerAutoRadio();
    }

    return nextTrack;
  },

  /**
   * Smart Auto-Fill (`Up Next` < 2 & !isRepeat):
   * Fills up to 5 relevant tracks from local library/playlists/affinity history first,
   * then tops up online recommendations when available.
   */
  triggerAutoRadio: async (force = false) => {
    const state = get();
    if (state.isFetchingRadio && !force) return;
    if (!force && state.suppressAutoFill) return;
    if (
      !force &&
      !shouldTriggerSmartFill({
        currentTrack: state.currentTrack,
        manualQueueLength: state.manualQueue.length,
        smartQueueLength: state.radioQueue.length,
        isRepeat: state.isRepeat,
      })
    ) {
      return;
    }

    const current = state.currentTrack;
    if (!current) return;

    const needed = Math.max(0, 5 - state.radioQueue.length);
    if (needed === 0) return;

    const versionAtStart = state.clearVersion;
    set({ isFetchingRadio: true });

    try {
      const affinityState = useMusicAffinityStore.getState();
      const playlistState = usePlaylistStore.getState();

      // Build candidate pool from local uploads, custom playlists, and affinity history
      const pool: Array<MusicTrackLike & { score?: number; playCount?: number }> = [];
      for (const rec of Object.values(affinityState.trackRecords)) {
        const liveTrack = affinityState.sessionTrackCache[rec.key] || rec.track;
        pool.push({
          ...liveTrack,
          score: rec.score,
          playCount: rec.playCount,
        });
      }
      for (const pl of playlistState.customPlaylists) {
        for (const t of pl.tracks) {
          pool.push(t);
        }
      }

      const exclusion = [current, ...state.manualQueue, ...state.radioQueue, ...state.history.slice(0, 8)];

      const localCandidates = selectSmartFillCandidates({
        seedTrack: current,
        candidatePool: pool,
        exclusionList: exclusion,
        maxCount: needed,
      }).map((t) => toSmartQueueTrack(t, state.activeSource, true));

      let filled = [...localCandidates];

      // Top up remaining slots via online search/recommendations when below 5
      if (filled.length < needed && (typeof navigator === 'undefined' || navigator.onLine !== false)) {
        const remoteNeeded = needed - filled.length;
        const remoteItems = await fetchAutoRadioRecommendations(
          current,
          state.activeSource,
          [...state.history, ...filled],
          [...state.manualQueue, ...state.radioQueue, ...filled]
        );
        for (const item of remoteItems.slice(0, remoteNeeded)) {
          const mapped = toSmartQueueTrack(item, state.activeSource, true);
          if (
            !isSameTrack(mapped, current) &&
            !exclusion.some((e) => isSameTrack(e, mapped)) &&
            !filled.some((f) => isSameTrack(f, mapped))
          ) {
            filled.push(mapped);
          }
        }
      }

      if (get().clearVersion !== versionAtStart) {
        return;
      }

      if (filled.length > 0) {
        const formattedItems = get().isShuffle ? fisherYatesShuffle(filled) : filled;
        set((s) => ({
          radioQueue: [...s.radioQueue, ...formattedItems].slice(0, 5),
        }));
      }
    } catch (err) {
      console.error('[useQueueStore] triggerAutoRadio failed:', err);
    } finally {
      set({ isFetchingRadio: false });
    }
  },
}));
