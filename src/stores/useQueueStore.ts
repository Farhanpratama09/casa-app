/**
 * useQueueStore.ts
 * Dual-Tier Smart Queue Store with Anti-Clustering Shuffle & Auto-Radio Lookahead
 * 
 * Manages:
 * 1. `manualQueue`: Explicit user-queued tracks (takes priority).
 * 2. `radioQueue`: Contextual auto-radio recommended tracks (seamless fallback).
 * 3. `history`: Past played tracks (prevents radio loops & duplicate suggestions).
 * 4. `smartShuffle`: Anti-clustering shuffle ensuring artists are separated by 3-4 tracks.
 */

import { create } from 'zustand';
import { fetchAutoRadioRecommendations, RadioTrackItem } from '../services/radioEngine';
import { smartShuffle } from '../utils/smartShuffle';
import { NativeTrack } from '../services/nativeAudioService';
import { SpotifyTrackItem } from '../utils/spotifyService';

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
  isRadio?: boolean;
}

/**
 * Normalizes any incoming track (NativeTrack, SpotifyTrackItem, or SmartQueueTrack)
 * into a standardized SmartQueueTrack object.
 */
export function toSmartQueueTrack(
  track: any,
  source: QueueTrackSource = 'native',
  isRadio = false
): SmartQueueTrack {
  const durationSec =
    typeof track.durationSeconds === 'number'
      ? track.durationSeconds
      : typeof track.durationMs === 'number'
      ? Math.round(track.durationMs / 1000)
      : 180;
  const durationMs = track.durationMs ?? durationSec * 1000;
  const art = track.thumbnailUrl || track.albumArt || track.artworkUrl || '';

  return {
    id: track.id || track.uri || `${track.title}-${track.artist}`,
    title: track.title || track.name || 'Unknown Track',
    artist: track.artist || 'Unknown Artist',
    durationSeconds: durationSec,
    durationMs: durationMs,
    thumbnailUrl: art,
    albumArt: art,
    artworkUrl: art,
    streamUrl: track.streamUrl,
    candidates: track.candidates,
    album: track.album || track.albumName || '',
    uri: track.uri || (source === 'spotify' ? `spotify:track:${track.id}` : undefined),
    source: track.source || source,
    isRadio: Boolean(isRadio || track.isRadio),
  };
}

export interface QueueStoreState {
  // Dual-Tier Queue Data
  manualQueue: SmartQueueTrack[];
  radioQueue: SmartQueueTrack[];
  history: SmartQueueTrack[];
  currentTrack: SmartQueueTrack | null;
  activeSource: QueueTrackSource;
  isShuffle: boolean;
  isFetchingRadio: boolean;
  clearVersion: number;

  // Configuration Actions
  setActiveSource: (source: QueueTrackSource) => void;
  setCurrentTrack: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem | null) => void;

  // Manual Queue Actions
  addToManualQueue: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  removeFromManualQueue: (index: number) => void;
  clearManualQueue: () => void;
  setManualQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem>) => void;

  // Radio Queue Actions
  addToRadioQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem | RadioTrackItem>) => void;
  removeFromRadioQueue: (index: number) => void;
  clearRadioQueue: () => void;
  setRadioQueue: (tracks: Array<SmartQueueTrack | NativeTrack | SpotifyTrackItem | RadioTrackItem>) => void;

  // Unified Actions
  clearAllQueues: () => void;
  recordHistory: (track: SmartQueueTrack | NativeTrack | SpotifyTrackItem) => void;
  toggleShuffle: () => boolean;
  setShuffle: (val: boolean) => void;

  // Playback Progression & Automation
  getNextTrack: () => Promise<SmartQueueTrack | null>;
  triggerAutoRadio: (force?: boolean) => Promise<void>;
}

export const useQueueStore = create<QueueStoreState>((set, get) => ({
  manualQueue: [],
  radioQueue: [],
  history: [],
  currentTrack: null,
  activeSource: 'native',
  isShuffle: false,
  isFetchingRadio: false,
  clearVersion: 0,

  setActiveSource: (source: QueueTrackSource) => {
    set({ activeSource: source });
  },

  setCurrentTrack: (track) => {
    if (!track) {
      set({ currentTrack: null });
      return;
    }
    const smart = toSmartQueueTrack(track, get().activeSource);
    set({ currentTrack: smart });
    get().recordHistory(smart);

    // Evict current track from pending queues if present
    set((state) => ({
      manualQueue: state.manualQueue.filter(
        (t) =>
          t.id !== smart.id &&
          !(
            t.title.toLowerCase().trim() === smart.title.toLowerCase().trim() &&
            t.artist.toLowerCase().trim() === smart.artist.toLowerCase().trim()
          )
      ),
      radioQueue: state.radioQueue.filter(
        (t) =>
          t.id !== smart.id &&
          !(
            t.title.toLowerCase().trim() === smart.title.toLowerCase().trim() &&
            t.artist.toLowerCase().trim() === smart.artist.toLowerCase().trim()
          )
      ),
    }));

    // Auto-Radio Lookahead: If radioQueue is low and manualQueue is empty, preload radio
    if (get().radioQueue.length <= 2 && get().manualQueue.length === 0) {
      get().triggerAutoRadio();
    }
  },

  addToManualQueue: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource, false);
    set((state) => ({
      manualQueue: [...state.manualQueue, track],
    }));
  },

  removeFromManualQueue: (index: number) => {
    set((state) => ({
      manualQueue: state.manualQueue.filter((_, i) => i !== index),
    }));
  },

  clearManualQueue: () => {
    set({ manualQueue: [] });
  },

  setManualQueue: (rawTracks) => {
    const source = get().activeSource;
    const tracks = rawTracks.map((t) => toSmartQueueTrack(t, source, false));
    const finalTracks = get().isShuffle ? smartShuffle(tracks) : tracks;
    set({ manualQueue: finalTracks });
  },

  addToRadioQueue: (rawTracks) => {
    const source = get().activeSource;
    const tracks = rawTracks.map((t) => toSmartQueueTrack(t, source, true));
    set((state) => ({
      radioQueue: [...state.radioQueue, ...tracks],
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
    const tracks = rawTracks.map((t) => toSmartQueueTrack(t, source, true));
    const finalTracks = get().isShuffle ? smartShuffle(tracks) : tracks;
    set({ radioQueue: finalTracks });
  },

  clearAllQueues: () => {
    // Only clears pending queues (manualQueue & radioQueue), keeps currentTrack untouched
    set((state) => ({
      manualQueue: [],
      radioQueue: [],
      clearVersion: state.clearVersion + 1,
    }));
  },

  recordHistory: (rawTrack) => {
    const track = toSmartQueueTrack(rawTrack, get().activeSource);
    set((state) => {
      // Keep up to last 40 tracks in history without duplicate adjacent entries
      const filtered = state.history.filter((h) => h.id !== track.id);
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
    set({ isShuffle: val });
    if (val) {
      // Re-order queues using smart anti-clustering shuffle
      const shuffledManual = smartShuffle(get().manualQueue);
      const shuffledRadio = smartShuffle(get().radioQueue);
      set({ manualQueue: shuffledManual, radioQueue: shuffledRadio });
    }
  },

  /**
   * Core Smart Progression:
   * 1. Shift track from manualQueue if available.
   * 2. If manualQueue is empty, shift track from radioQueue.
   * 3. If radioQueue has <= 2 tracks remaining, trigger fetchAutoRadioRecommendations.
   */
  getNextTrack: async () => {
    const { manualQueue, radioQueue } = get();
    let nextTrack: SmartQueueTrack | null = null;

    if (manualQueue.length > 0) {
      const [first, ...rest] = manualQueue;
      nextTrack = first;
      set({ manualQueue: rest });
    } else if (radioQueue.length > 0) {
      const [first, ...rest] = radioQueue;
      nextTrack = first;
      set({ radioQueue: rest });
    }

    if (nextTrack) {
      get().recordHistory(nextTrack);
      set({ currentTrack: nextTrack });
    }

    // Trigger auto radio replenishment if radio queue is running low (<= 2 tracks)
    const remainingRadio = get().radioQueue.length;
    if (remainingRadio <= 2) {
      get().triggerAutoRadio();
    }

    return nextTrack;
  },

  /**
   * Fetches 5 non-duplicate radio recommendations and appends them to radioQueue.
   */
  triggerAutoRadio: async (force = false) => {
    const state = get();
    if (state.isFetchingRadio && !force) return;
    const current = state.currentTrack;
    if (!current) return;

    const versionAtStart = state.clearVersion;
    set({ isFetchingRadio: true });
    try {
      const newItems = await fetchAutoRadioRecommendations(
        current,
        state.activeSource,
        state.history,
        [...state.manualQueue, ...state.radioQueue]
      );

      // Discard results if queue was cleared while network fetch was in-flight
      if (get().clearVersion !== versionAtStart) {
        console.log('[useQueueStore] Auto-radio fetch discarded because queue was cleared');
        return;
      }

      if (newItems.length > 0) {
        const smartItems = newItems.map((item) =>
          toSmartQueueTrack(item, state.activeSource, true)
        );

        // Apply anti-clustering shuffle if shuffle mode is on
        const formattedItems = state.isShuffle ? smartShuffle(smartItems) : smartItems;

        set((s) => ({
          radioQueue: [...s.radioQueue, ...formattedItems],
        }));
      }
    } catch (err) {
      console.error('[useQueueStore] triggerAutoRadio failed:', err);
    } finally {
      set({ isFetchingRadio: false });
    }
  },
}));
