import React, {
  createContext,
  useContext,
  useState,
  useRef,
  useEffect,
  useCallback,
  ReactNode,
} from 'react';
import {
  NativeTrack,
  resolveAudioCandidates,
  prefetchTrackStream,
} from '../services/nativeAudioService';
import {
  fetchLyrics,
  cleanTrackTitleForLyrics,
  LyricResult,
} from '../utils/lyricsService';
import { useSkillStore } from '../skills/store';
import { playChimeCue } from '../utils/tauriBridge';
import { PlaybackSource } from '../components/views/music/constants';

export interface CasaAudioContextType {
  // Instance & Reference
  audioRef: React.RefObject<HTMLAudioElement | null>;

  // Playback State
  playbackSource: PlaybackSource;
  setPlaybackSource: (source: PlaybackSource) => void;
  currentTrack: NativeTrack | null;
  isPlaying: boolean;
  isResolvingAudio: boolean;
  audioError: string | null;
  currentTime: number; // in seconds
  currentTimeMs: number; // in milliseconds
  duration: number; // in seconds
  durationMs: number; // in milliseconds
  volume: number; // 0.0 - 1.0
  isMuted: boolean;
  lyricsData: LyricResult | null;

  // Queue State
  queue: NativeTrack[];
  queueIndex: number;
  addedTrackId: string | null;

  // Primary Controllers
  playTrack: (track: NativeTrack, customList?: NativeTrack[]) => Promise<void>;
  playTrackAtIndex: (index: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seek: (targetSecondsOrMs: number) => void;
  setVolume: (val: number) => void;
  toggleMute: () => void;
  nextTrack: () => void;
  prevTrack: (currentProgressMs?: number) => void;
  addToQueue: (e: React.MouseEvent | null, track: NativeTrack) => void;
  removeFromQueue: (e: React.MouseEvent | null, index: number) => void;
  clearQueue: (e?: React.MouseEvent) => void;
  setQueueAndPlay: (list: NativeTrack[], targetIndex: number) => void;
  stopInstantly: () => void;

  // Legacy mappings for drop-in compatibility with useNativeAudioPlayer consumers
  nativeTrack: NativeTrack | null;
  setNativeTrack: React.Dispatch<React.SetStateAction<NativeTrack | null>>;
  isNativePlaying: boolean;
  setIsNativePlaying: React.Dispatch<React.SetStateAction<boolean>>;
  nativeQueue: NativeTrack[];
  setNativeQueue: React.Dispatch<React.SetStateAction<NativeTrack[]>>;
  currentTrackIndex: number;
  setNativeQueueIndex: React.Dispatch<React.SetStateAction<number>>;
  nativeAudioError: string | null;
  addedNativeTrackId: string | null;
  handleNextTrack: () => void;
  handlePrevTrack: (currentProgressMs?: number) => void;
  handleSeekNative: (targetMs: number) => void;
  toggleNativePlay: () => Promise<void>;
  stopNativeAudioInstantly: () => void;
}

const CasaAudioContext = createContext<CasaAudioContextType | null>(null);

export interface CasaAudioProviderProps {
  children: ReactNode;
}

export const CasaAudioProvider: React.FC<CasaAudioProviderProps> = ({ children }) => {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Playback Source: default to 'companion', but persists globally across views
  const [playbackSource, setPlaybackSourceState] = useState<PlaybackSource>('companion');
  const playbackSourceRef = useRef<PlaybackSource>(playbackSource);
  playbackSourceRef.current = playbackSource;

  const [currentTrack, setCurrentTrack] = useState<NativeTrack | null>(null);
  const currentTrackRef = useRef<NativeTrack | null>(currentTrack);
  currentTrackRef.current = currentTrack;

  const [queue, setQueue] = useState<NativeTrack[]>([]);
  const queueRef = useRef<NativeTrack[]>(queue);
  queueRef.current = queue;

  const [queueIndex, setQueueIndex] = useState<number>(-1);
  const queueIndexRef = useRef<number>(-1);
  queueIndexRef.current = queueIndex;

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const isPlayingRef = useRef<boolean>(false);
  isPlayingRef.current = isPlaying;

  const [isResolvingAudio, setIsResolvingAudio] = useState<boolean>(false);
  const isResolvingAudioRef = useRef<boolean>(false);
  isResolvingAudioRef.current = isResolvingAudio;

  const [audioError, setAudioError] = useState<string | null>(null);
  const [addedTrackId, setAddedTrackId] = useState<string | null>(null);
  const [lyricsData, setLyricsData] = useState<LyricResult | null>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  const candidateUrlsRef = useRef<string[]>([]);
  const candidateIndexRef = useRef<number>(0);
  const playTrackAtIndexRef = useRef<((index: number) => Promise<void>) | null>(null);

  // Synchronize playback state to Central Skill Store ('core.media')
  useEffect(() => {
    useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        playbackSource,
        nativeTrack: currentTrack,
        isNativePlaying: isPlaying,
      };
    });
  }, [playbackSource, currentTrack, isPlaying]);

  // Instant Teardown & Cutoff
  const stopInstantly = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    setIsPlaying(false);
    isResolvingAudioRef.current = false;
    setIsResolvingAudio(false);
    useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        isNativePlaying: false,
      };
    });
  }, []);

  const setPlaybackSource = useCallback(
    (source: PlaybackSource) => {
      setPlaybackSourceState(source);
      if (source === 'companion' && isPlayingRef.current) {
        stopInstantly();
      }
    },
    [stopInstantly]
  );

  // Core execution logic for playing a track at queue index
  const playTrackAtIndex = useCallback(async (index: number) => {
    const q = queueRef.current;
    if (index < 0 || index >= q.length) {
      console.warn(`[CasaAudioContext] Invalid queue index ${index}, length: ${q.length}`);
      return;
    }

    const track = q[index];
    setPlaybackSourceState('native');
    setQueueIndex(index);
    queueIndexRef.current = index;
    setCurrentTrack(track);
    currentTrackRef.current = track;
    setAudioError(null);
    setIsResolvingAudio(true);
    isResolvingAudioRef.current = true;

    // Reset progress timers
    setCurrentTime(0);
    setCurrentTimeMs(0);
    if (track.durationSeconds) {
      setDuration(track.durationSeconds);
      setDurationMs(track.durationSeconds * 1000);
    }

    // Synchronously prime the HTMLAudioElement
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.autoplay = true;
      audioRef.current.muted = false;
      audioRef.current.volume = volume;
    }

    // Trigger LRCLIB lyrics fetch in parallel
    const cleanTitle = cleanTrackTitleForLyrics(track.title);
    const cleanArtist = track.artist;
    if (cleanTitle && cleanTitle !== 'CASA Native Player') {
      fetchLyrics(cleanTitle, cleanArtist, track.durationSeconds, false)
        .then((res) => {
          if (res && res.lines && res.lines.length > 0) {
            setLyricsData(res);
            useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
              if (!prev) return prev;
              return { ...prev, lyricsData: res };
            });
          }
        })
        .catch((err) => console.warn('[CasaAudioContext] Direct fetchLyrics error:', err));
    }

    try {
      const candidates = await resolveAudioCandidates(track);
      if (!candidates || candidates.length === 0) {
        throw new Error('Tidak ada kandidat stream audio');
      }

      setCurrentTrack({ ...track });
      currentTrackRef.current = { ...track };

      candidateUrlsRef.current = candidates;
      candidateIndexRef.current = 0;

      // Queue Lookahead Prefetching: silently pre-resolve next track after 1.5s
      if (index + 1 < q.length) {
        const nextTrack = q[index + 1];
        setTimeout(() => {
          prefetchTrackStream(nextTrack);
        }, 1500);
      }

      if (audioRef.current) {
        const audio = audioRef.current;
        audio.autoplay = true;
        audio.src = candidates[0];
        console.log(
          `[CasaAudioContext] Assigned src=${candidates[0]} | readyState=${audio.readyState}`
        );

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log('[CasaAudioContext] audio.play() RESOLVED successfully');
              setIsPlaying(true);
            })
            .catch((err: any) => {
              console.error('[CasaAudioContext] audio.play() REJECTED:', err);
              if (err?.name !== 'AbortError') {
                setIsPlaying(false);
              }
            });
        }
      }
    } catch (err: any) {
      console.error('[CasaAudioContext] Failed to stream audio at index', index, err);
      setAudioError('STREAM ERROR');
      setIsPlaying(false);
    } finally {
      setIsResolvingAudio(false);
      isResolvingAudioRef.current = false;
    }
  }, [volume]);

  playTrackAtIndexRef.current = playTrackAtIndex;

  // Initialize and bind HTML5 Audio Element ONCE at Root Level
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.autoplay = true;
    audioRef.current = audio;

    const handlePlay = () => {
      console.log('[CasaAudioContext] audio event: play');
      setIsPlaying(true);
    };

    const handlePlaying = () => {
      console.log('[CasaAudioContext] audio event: playing');
      setIsPlaying(true);
      setAudioError(null);
    };

    const handlePause = () => {
      if (!isResolvingAudioRef.current) {
        console.log('[CasaAudioContext] audio event: pause');
        setIsPlaying(false);
      }
    };

    const handleTimeUpdate = () => {
      const cur = audio.currentTime;
      setCurrentTime(cur);
      setCurrentTimeMs(cur * 1000);
    };

    const handleLoadedMetadata = () => {
      const dur = audio.duration;
      if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
        setDuration(dur);
        setDurationMs(dur * 1000);
        setCurrentTrack((prev) => (prev ? { ...prev, durationSeconds: Math.round(dur) } : null));
      }
    };

    const handleEnded = () => {
      const curIdx = queueIndexRef.current;
      const q = queueRef.current;
      if (curIdx + 1 < q.length) {
        console.log(`[CasaAudioContext] Track ended. Advancing to ${curIdx + 1}/${q.length}`);
        playTrackAtIndexRef.current?.(curIdx + 1);
      } else {
        console.log('[CasaAudioContext] Queue ended.');
        setIsPlaying(false);
      }
    };

    const handleError = async () => {
      const currentIdx = candidateIndexRef.current;
      const candidates = candidateUrlsRef.current;
      const nextIdx = currentIdx + 1;

      console.error('[CasaAudioContext] Audio error on candidate index', currentIdx);

      if (nextIdx < candidates.length) {
        console.log(`[CasaAudioContext] Attempting fallback candidate #${nextIdx}`);
        candidateIndexRef.current = nextIdx;
        audio.autoplay = true;
        audio.src = candidates[nextIdx];
        try {
          await audio.play();
          setAudioError(null);
          setIsPlaying(true);
          return;
        } catch (retryErr) {
          console.warn('[CasaAudioContext] Fallback candidate rejected:', retryErr);
          return;
        }
      }

      console.error('[CasaAudioContext] All stream candidates failed.');
      setAudioError('STREAM ERROR');
      setIsResolvingAudio(false);
      setIsPlaying(false);
    };

    audio.addEventListener('play', handlePlay);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('timeupdate', handleTimeUpdate);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('error', handleError);

    // Root-level teardown only fires when entire app closes
    return () => {
      audio.pause();
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('timeupdate', handleTimeUpdate);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  // Transport Controls
  const togglePlay = useCallback(async () => {
    playChimeCue('tap');
    if (!audioRef.current) return;

    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
        setIsPlaying(true);
      } catch (err: any) {
        if (err?.name !== 'AbortError') {
          console.error('[CasaAudioContext] togglePlay error:', err);
        }
      }
    } else {
      audioRef.current.pause();
      setIsPlaying(false);
    }
  }, []);

  const play = useCallback(async () => {
    if (!audioRef.current) return;
    try {
      await audioRef.current.play();
      setIsPlaying(true);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[CasaAudioContext] play error:', err);
      }
    }
  }, []);

  const pause = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    setIsPlaying(false);
  }, []);

  const seek = useCallback((targetSecondsOrMs: number) => {
    if (!audioRef.current) return;
    const targetSeconds =
      targetSecondsOrMs > 1000 ? targetSecondsOrMs / 1000 : targetSecondsOrMs;
    audioRef.current.currentTime = targetSeconds;
    setCurrentTime(targetSeconds);
    setCurrentTimeMs(targetSeconds * 1000);
  }, []);

  const setVolume = useCallback((val: number) => {
    const clamped = Math.max(0, Math.min(1, val));
    if (audioRef.current) {
      audioRef.current.volume = clamped;
    }
    setVolumeState(clamped);
  }, []);

  const toggleMute = useCallback(() => {
    if (!audioRef.current) return;
    const nextMuted = !audioRef.current.muted;
    audioRef.current.muted = nextMuted;
    setIsMuted(nextMuted);
  }, []);

  const nextTrack = useCallback(() => {
    playChimeCue('tap');
    const curIdx = queueIndexRef.current;
    const q = queueRef.current;
    if (curIdx + 1 < q.length) {
      playTrackAtIndex(curIdx + 1);
    } else if (q.length > 0) {
      playTrackAtIndex(0); // loop back
    }
  }, [playTrackAtIndex]);

  const prevTrack = useCallback(
    (currentProgressMs?: number) => {
      playChimeCue('tap');
      const posMs =
        currentProgressMs !== undefined
          ? currentProgressMs
          : audioRef.current
          ? audioRef.current.currentTime * 1000
          : 0;

      if (posMs > 3000 && audioRef.current) {
        audioRef.current.currentTime = 0;
        setCurrentTime(0);
        setCurrentTimeMs(0);
        return;
      }
      const curIdx = queueIndexRef.current;
      if (curIdx - 1 >= 0) {
        playTrackAtIndex(curIdx - 1);
      } else if (queueRef.current.length > 0) {
        playTrackAtIndex(queueRef.current.length - 1);
      }
    },
    [playTrackAtIndex]
  );

  const addToQueue = useCallback((e: React.MouseEvent | null, track: NativeTrack) => {
    if (e) e.stopPropagation();
    playChimeCue('tap');
    setQueue((prev) => {
      const updated = [...prev, track];
      queueRef.current = updated;
      if (updated.length - 1 === queueIndexRef.current + 1) {
        prefetchTrackStream(track);
      }
      return updated;
    });
    setAddedTrackId(track.id);
    setTimeout(() => setAddedTrackId(null), 1500);
  }, []);

  const removeFromQueue = useCallback(
    (e: React.MouseEvent | null, indexToRemove: number) => {
      if (e) e.stopPropagation();
      playChimeCue('tap');
      const updated = queueRef.current.filter((_, idx) => idx !== indexToRemove);
      queueRef.current = updated;
      setQueue(updated);

      if (updated.length === 0) {
        setQueueIndex(-1);
        queueIndexRef.current = -1;
        stopInstantly();
        setCurrentTrack(null);
        currentTrackRef.current = null;
        setLyricsData(null);
      } else if (indexToRemove === queueIndexRef.current) {
        const nextIdx = indexToRemove < updated.length ? indexToRemove : updated.length - 1;
        playTrackAtIndex(nextIdx);
      } else if (indexToRemove < queueIndexRef.current) {
        const newIdx = queueIndexRef.current - 1;
        setQueueIndex(newIdx);
        queueIndexRef.current = newIdx;
      }
    },
    [playTrackAtIndex, stopInstantly]
  );

  const clearQueue = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      playChimeCue('tap');
      setQueue([]);
      queueRef.current = [];
      setQueueIndex(-1);
      queueIndexRef.current = -1;
      stopInstantly();
      setCurrentTrack(null);
      currentTrackRef.current = null;
      setLyricsData(null);
    },
    [stopInstantly]
  );

  const setQueueAndPlay = useCallback(
    (list: NativeTrack[], targetIndex: number) => {
      setQueue(list);
      queueRef.current = list;
      playTrackAtIndex(targetIndex);
    },
    [playTrackAtIndex]
  );

  const playTrack = useCallback(
    async (track: NativeTrack, customList?: NativeTrack[]) => {
      const baseList = customList || [track];
      let idx = baseList.findIndex((t) => t.id === track.id);
      if (idx === -1) {
        baseList.unshift(track);
        idx = 0;
      }
      setQueueAndPlay(baseList, idx);
    },
    [setQueueAndPlay]
  );

  const contextValue: CasaAudioContextType = {
    audioRef,
    playbackSource,
    setPlaybackSource,
    currentTrack,
    isPlaying,
    isResolvingAudio,
    audioError,
    currentTime,
    currentTimeMs,
    duration,
    durationMs,
    volume,
    isMuted,
    lyricsData,
    queue,
    queueIndex,
    addedTrackId,
    playTrack,
    playTrackAtIndex,
    togglePlay,
    play,
    pause,
    seek,
    setVolume,
    toggleMute,
    nextTrack,
    prevTrack,
    addToQueue,
    removeFromQueue,
    clearQueue,
    setQueueAndPlay,
    stopInstantly,

    // Legacy aliases
    nativeTrack: currentTrack,
    setNativeTrack: setCurrentTrack,
    isNativePlaying: isPlaying,
    setIsNativePlaying: setIsPlaying,
    nativeQueue: queue,
    setNativeQueue: setQueue,
    currentTrackIndex: queueIndex,
    setNativeQueueIndex: setQueueIndex,
    nativeAudioError: audioError,
    addedNativeTrackId: addedTrackId,
    handleNextTrack: nextTrack,
    handlePrevTrack: prevTrack,
    handleSeekNative: seek,
    toggleNativePlay: togglePlay,
    stopNativeAudioInstantly: stopInstantly,
  };

  return (
    <CasaAudioContext.Provider value={contextValue}>
      {children}
    </CasaAudioContext.Provider>
  );
};

export const useCasaAudio = (): CasaAudioContextType => {
  const context = useContext(CasaAudioContext);
  if (!context) {
    throw new Error('useCasaAudio must be used within a CasaAudioProvider');
  }
  return context;
};
