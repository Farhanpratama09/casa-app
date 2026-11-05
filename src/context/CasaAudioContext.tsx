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
  parseTimeToSeconds,
} from '../utils/lyricsService';
import { useSkillStore } from '../skills/store';
import { playChimeCue, controlMediaSession } from '../utils/tauriBridge';
import { pauseSpotifyPlayback } from '../utils/spotifyService';
import { PlaybackSource } from '../components/views/music/constants';
import { useQueueStore, SmartQueueTrack } from '../stores/useQueueStore';

export interface CasaAudioContextType {
  // Instance & Reference
  audioRef: React.RefObject<HTMLAudioElement | null>;

  // Playback State
  playbackSource: PlaybackSource;
  activeSource: 'native' | 'spotify' | 'idle';
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
  manualQueue: NativeTrack[];
  radioQueue: NativeTrack[];
  queueIndex: number;
  addedTrackId: string | null;
  isShuffle: boolean;
  toggleShuffle: () => void;

  // Primary Controllers
  playTrack: (track: NativeTrack, customList?: NativeTrack[]) => Promise<void>;
  playTrackAtIndex: (index: number) => Promise<void>;
  togglePlay: () => Promise<void>;
  play: () => Promise<void>;
  pause: () => void;
  seekToSeconds: (targetSeconds: number) => void;
  seek: (targetSeconds: number) => void;
  setVolume: (val: number) => void;
  toggleMute: () => void;
  nextTrack: () => void;
  prevTrack: (currentProgressSeconds?: number) => void;
  addToQueue: (e: React.MouseEvent | null, track: NativeTrack) => void;
  removeFromQueue: (e: React.MouseEvent | null, index: number) => void;
  clearQueue: (e?: React.MouseEvent) => void;
  setQueueAndPlay: (list: NativeTrack[], targetIndex: number) => void;
  stopInstantly: () => void;
  ejectNativeTrack: () => void;

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
  handlePrevTrack: (currentProgressSeconds?: number) => void;
  handleSeekNative: (targetSeconds: number) => void;
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
  const lyricsDataRef = useRef<LyricResult | null>(null);

  const [currentTime, setCurrentTime] = useState<number>(0);
  const [currentTimeMs, setCurrentTimeMs] = useState<number>(0);
  const [duration, setDuration] = useState<number>(0);
  const [durationMs, setDurationMs] = useState<number>(0);
  const [volume, setVolumeState] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);

  // Dual-Tier Smart Queue Hooks
  const manualQueue = useQueueStore((s) => s.manualQueue) as unknown as NativeTrack[];
  const radioQueue = useQueueStore((s) => s.radioQueue) as unknown as NativeTrack[];
  const isShuffle = useQueueStore((s) => s.isShuffle);
  const toggleShuffle = useQueueStore((s) => s.toggleShuffle);

  const candidateUrlsRef = useRef<string[]>([]);
  const candidateIndexRef = useRef<number>(0);
  const playTrackAtIndexRef = useRef<((index: number) => Promise<void>) | null>(null);
  const playTrackRef = useRef<((track: NativeTrack, customList?: NativeTrack[]) => Promise<void>) | null>(null);

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

  // Eject / Close Native Session: Stops audio, clears local file, resets clock & lyrics to standby
  const ejectNativeTrack = useCallback(() => {
    stopInstantly();
    setCurrentTrack(null);
    currentTrackRef.current = null;
    setLyricsData(null);
    lyricsDataRef.current = null;
    setCurrentTime(0);
    setCurrentTimeMs(0);
    setDuration(0);
    setDurationMs(0);
    useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        nativeTrack: null,
        isNativePlaying: false,
        lyricsData: null,
      };
    });
  }, [stopInstantly]);

  const setPlaybackSource = useCallback(
    (source: PlaybackSource) => {
      if (source === playbackSourceRef.current) return;
      if (source === 'companion') {
        // Strict Manual Source Authority: Pause native player (do not teardown/destroy src)
        if (audioRef.current && !audioRef.current.paused) {
          audioRef.current.pause();
        }
        setIsPlaying(false);
        useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
          if (!prev) return prev;
          return {
            ...prev,
            isNativePlaying: false,
          };
        });
      } else if (source === 'native') {
        // Return control and restore native lyrics to skill store
        if (lyricsDataRef.current) {
          useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
            if (!prev) return prev;
            return {
              ...prev,
              lyricsData: lyricsDataRef.current,
            };
          });
        }
      }
      setPlaybackSourceState(source);
    },
    []
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

    // Sync to Universal Queue Store
    useQueueStore.getState().setActiveSource('native');
    useQueueStore.getState().setCurrentTrack(track);

    // Mutual Exclusion: Auto-pause Spotify and external GSMTC media sessions
    pauseSpotifyPlayback().catch(() => {});
    try {
      const mediaState = useSkillStore.getState().skillStates['core.media'];
      if (mediaState?.active_sessions) {
        for (const s of mediaState.active_sessions) {
          if (s.is_playing) {
            controlMediaSession(s.session_id, 'pause').catch(() => {});
          }
        }
      } else if (mediaState?.session_id && mediaState?.song?.isPlaying) {
        controlMediaSession(mediaState.session_id, 'pause').catch(() => {});
      }
    } catch {}

    // Reset progress timers synchronously before loading new track
    setCurrentTime(0);
    setCurrentTimeMs(0);
    if (track.durationSeconds) {
      setDuration(track.durationSeconds);
      setDurationMs(track.durationSeconds * 1000);
    } else {
      setDuration(0);
      setDurationMs(0);
    }

    // Synchronously prime & reset the HTMLAudioElement clock to prevent stale timeupdate leaks
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.autoplay = true;
      audioRef.current.muted = false;
      audioRef.current.volume = volume;
    }

    // Clear stale lyrics immediately on track switch before fetching new LRCLIB lyrics
    setLyricsData(null);
    lyricsDataRef.current = null;
    useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
      if (!prev) return prev;
      return { ...prev, lyricsData: null };
    });

    // Trigger LRCLIB lyrics fetch in parallel
    const cleanTitle = cleanTrackTitleForLyrics(track.title);
    const cleanArtist = track.artist;
    if (cleanTitle && cleanTitle !== 'CASA Native Player') {
      fetchLyrics(cleanTitle, cleanArtist, track.durationSeconds, false)
        .then((res) => {
          // Guard against out-of-order resolution if track changed again
          if (currentTrackRef.current?.id !== track.id) return;
          if (res && res.lines && res.lines.length > 0) {
            setLyricsData(res);
            lyricsDataRef.current = res;
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
      if (isResolvingAudioRef.current) {
        setCurrentTime(0);
        setCurrentTimeMs(0);
        return;
      }
      const cur = audio.currentTime;
      setCurrentTime(cur);
      setCurrentTimeMs(cur * 1000);
      const dur = audio.duration;
      if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
        setDuration(dur);
        setDurationMs(dur * 1000);

        // Auto-Radio Lookahead Trigger:
        // When track is within 15 seconds of ending and remaining manual queue is <= 1,
        // pre-fetch recommendations to ensure 0-gap continuous playback.
        const curIdx = queueIndexRef.current;
        const q = queueRef.current;
        const isNearEnd = dur > 20 && cur >= dur - 15;
        if (isNearEnd && curIdx >= q.length - 1) {
          const qStore = useQueueStore.getState();
          if (qStore.radioQueue.length <= 2 && !qStore.isFetchingRadio) {
            qStore.triggerAutoRadio();
          }
        }
      }
    };

    const handleLoadedMetadata = () => {
      const dur = audio.duration;
      if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
        setDuration(dur);
        setDurationMs(dur * 1000);
        setCurrentTrack((prev) => (prev ? { ...prev, durationSeconds: Math.round(dur) } : null));
      }
    };

    const handleEnded = async () => {
      const curIdx = queueIndexRef.current;
      const q = queueRef.current;
      if (curIdx + 1 < q.length) {
        console.log(`[CasaAudioContext] Track ended. Advancing to ${curIdx + 1}/${q.length}`);
        playTrackAtIndexRef.current?.(curIdx + 1);
      } else {
        // Query next track from Smart Queue (manualQueue -> radioQueue -> auto-radio fallback)
        console.log('[CasaAudioContext] Manual queue ended. Querying Smart Queue...');
        const nextSmartTrack = await useQueueStore.getState().getNextTrack();
        if (nextSmartTrack) {
          console.log('[CasaAudioContext] Smart Queue auto-advancing to:', nextSmartTrack.title);
          playTrackRef.current?.(nextSmartTrack as unknown as NativeTrack);
        } else {
          console.log('[CasaAudioContext] Queue ended.');
          setIsPlaying(false);
        }
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
      // Mutual exclusion: pause Spotify and GSMTC when resuming native
      pauseSpotifyPlayback().catch(() => {});
      try {
        const mediaState = useSkillStore.getState().skillStates['core.media'];
        if (mediaState?.active_sessions) {
          for (const s of mediaState.active_sessions) {
            if (s.is_playing) {
              controlMediaSession(s.session_id, 'pause').catch(() => {});
            }
          }
        }
      } catch {}

      // If audio has no valid source but an active track is available, resolve and play it
      const activeTrack =
        currentTrackRef.current ||
        (useQueueStore.getState().currentTrack as unknown as NativeTrack | null);

      if (
        (!audioRef.current.src ||
          audioRef.current.src === '' ||
          audioRef.current.src === window.location.href) &&
        activeTrack
      ) {
        console.log('[CasaAudioContext] Unprimed source on togglePlay, resolving:', activeTrack.title);
        await playTrackRef.current?.(activeTrack);
        return;
      }

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
    // Mutual exclusion: pause Spotify and GSMTC when playing native
    pauseSpotifyPlayback().catch(() => {});
    try {
      const mediaState = useSkillStore.getState().skillStates['core.media'];
      if (mediaState?.active_sessions) {
        for (const s of mediaState.active_sessions) {
          if (s.is_playing) {
            controlMediaSession(s.session_id, 'pause').catch(() => {});
          }
        }
      }
    } catch {}

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

  const seekToSeconds = useCallback((rawTargetSeconds: number) => {
    if (!audioRef.current) return;
    const targetSeconds = parseTimeToSeconds(rawTargetSeconds);
    audioRef.current.currentTime = targetSeconds;
    setCurrentTime(targetSeconds);
    setCurrentTimeMs(targetSeconds * 1000);
  }, []);

  const seek = seekToSeconds;

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

  const nextTrack = useCallback(async () => {
    playChimeCue('tap');
    const curIdx = queueIndexRef.current;
    const q = queueRef.current;
    if (curIdx + 1 < q.length) {
      playTrackAtIndex(curIdx + 1);
    } else {
      const next = await useQueueStore.getState().getNextTrack();
      if (next) {
        playTrackRef.current?.(next as unknown as NativeTrack);
      } else if (q.length > 0) {
        playTrackAtIndex(0); // loop back
      }
    }
  }, [playTrackAtIndex]);

  const prevTrack = useCallback(
    (currentProgressSeconds?: number) => {
      playChimeCue('tap');
      const posSec =
        currentProgressSeconds !== undefined
          ? currentProgressSeconds
          : audioRef.current
          ? audioRef.current.currentTime
          : 0;

      if (posSec > 3 && audioRef.current) {
        seekToSeconds(0);
        return;
      }
      const curIdx = queueIndexRef.current;
      if (curIdx - 1 >= 0) {
        playTrackAtIndex(curIdx - 1);
      } else if (queueRef.current.length > 0) {
        playTrackAtIndex(queueRef.current.length - 1);
      }
    },
    [playTrackAtIndex, seekToSeconds]
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
    useQueueStore.getState().addToManualQueue(track);
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
      useQueueStore.getState().removeFromManualQueue(indexToRemove);

      if (updated.length === 0) {
        setQueueIndex(-1);
        queueIndexRef.current = -1;
        stopInstantly();
        setCurrentTrack(null);
        currentTrackRef.current = null;
        setLyricsData(null);
        lyricsDataRef.current = null;
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
      // Kosongkan HANYA membersihkan daftar lagu tunggu (manualQueue & radioQueue)!
      // DILARANG memanggil stopInstantly, pauseAudio, atau mereset currentTrack ke null!
      const cur =
        currentTrackRef.current ||
        (useQueueStore.getState().currentTrack as unknown as NativeTrack | null);

      if (cur) {
        setQueue([cur]);
        queueRef.current = [cur];
        setQueueIndex(0);
        queueIndexRef.current = 0;
      } else {
        setQueue([]);
        queueRef.current = [];
        setQueueIndex(-1);
        queueIndexRef.current = -1;
      }

      useQueueStore.getState().clearAllQueues();
    },
    []
  );

  const setQueueAndPlay = useCallback(
    (list: NativeTrack[], targetIndex: number) => {
      setQueue(list);
      queueRef.current = list;
      const remaining = list.slice(targetIndex + 1);
      useQueueStore.getState().setManualQueue(remaining);
      playTrackAtIndex(targetIndex);
    },
    [playTrackAtIndex]
  );

  const playTrack = useCallback(
    async (track: NativeTrack, customList?: NativeTrack[]) => {
      setCurrentTime(0);
      setCurrentTimeMs(0);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
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

  playTrackRef.current = playTrack;

  const effectiveIsPlaying = Boolean(audioRef.current ? !audioRef.current.paused : isPlaying);

  const mediaSkill = useSkillStore((s) => s.skillStates['core.media']);
  const isExternalPlaying = Boolean(
    playbackSource !== 'native' &&
    mediaSkill?.song?.isPlaying &&
    mediaSkill?.song?.title &&
    mediaSkill?.song?.title.trim() !== ''
  );

  const activeSource: 'native' | 'spotify' | 'idle' =
    playbackSource === 'native' && effectiveIsPlaying
      ? 'native'
      : effectiveIsPlaying
      ? 'native'
      : isExternalPlaying
      ? 'spotify'
      : 'idle';

  const contextValue: CasaAudioContextType = {
    audioRef,
    playbackSource,
    activeSource,
    setPlaybackSource,
    currentTrack,
    isPlaying: effectiveIsPlaying,
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
    manualQueue,
    radioQueue,
    isShuffle,
    toggleShuffle,
    queueIndex,
    addedTrackId,
    playTrack,
    playTrackAtIndex,
    togglePlay,
    play,
    pause,
    seekToSeconds,
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
    ejectNativeTrack,

    // Legacy aliases
    nativeTrack: currentTrack,
    setNativeTrack: setCurrentTrack,
    isNativePlaying: effectiveIsPlaying,
    setIsNativePlaying: setIsPlaying,
    nativeQueue: queue,
    setNativeQueue: setQueue,
    currentTrackIndex: queueIndex,
    setNativeQueueIndex: setQueueIndex,
    nativeAudioError: audioError,
    addedNativeTrackId: addedTrackId,
    handleNextTrack: nextTrack,
    handlePrevTrack: prevTrack,
    handleSeekNative: seekToSeconds,
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
