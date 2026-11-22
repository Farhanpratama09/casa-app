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
import { useQueueStore, PlaybackContextKind } from '../stores/useQueueStore';
import { useMusicAffinityStore } from '../hooks/useMusicAffinity';
import { isSameTrack, normalizeTrackMetadata, RepeatMode } from '../utils/musicQueueEngine';

export interface CasaAudioContextType {
  // Instance & Reference
  audioRef: React.RefObject<HTMLAudioElement | null>;

  // Playback State
  playbackSource: PlaybackSource;
  activeSource: 'native' | 'spotify' | null;
  setPlaybackSource: (source: PlaybackSource) => void;
  currentTrack: NativeTrack | null;
  isPlaying: boolean;
  isResolvingAudio: boolean;
  audioError: string | null;
  currentTime: number; // in seconds
  currentTimeMs: number; // in milliseconds
  getAccurateTimeMs: () => number;
  duration: number; // in seconds
  durationMs: number; // in milliseconds
  volume: number; // 0.0 - 1.0
  isMuted: boolean;
  repeatMode: RepeatMode;
  lyricsData: LyricResult | null;

  // Queue State
  queue: NativeTrack[];
  manualQueue: NativeTrack[];
  radioQueue: NativeTrack[];
  queueIndex: number;
  addedTrackId: string | null;
  isShuffle: boolean;
  toggleShuffle: () => void;
  toggleRepeat: () => RepeatMode;
  setRepeatMode: (mode: RepeatMode) => void;

  // Primary Controllers
  playTrack: (
    track: NativeTrack,
    customList?: NativeTrack[],
    options?: { contextKind?: PlaybackContextKind }
  ) => Promise<void>;
  playTrackAtIndex: (index: number) => Promise<void>;
  playSmartQueueTrack: (index: number) => Promise<void>;
  removeSmartQueueTrack: (index: number) => void;
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
  addCollectionToQueue: (tracks: NativeTrack[]) => void;
  removeFromQueue: (e: React.MouseEvent | null, index: number) => void;
  clearQueue: (e?: React.MouseEvent) => void;
  setQueueAndPlay: (
    list: NativeTrack[],
    targetIndex: number,
    options?: { contextKind?: PlaybackContextKind }
  ) => void;
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
  const repeatMode = useQueueStore((s) => s.repeatMode);
  const toggleShuffle = useQueueStore((s) => s.toggleShuffle);

  const candidateUrlsRef = useRef<string[]>([]);
  const candidateIndexRef = useRef<number>(0);
  const pastTracksRef = useRef<NativeTrack[]>([]);
  const playRecordedSessionRef = useRef<string | null>(null);
  const playbackSeqRef = useRef<number>(0);
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const playTrackAtIndexRef = useRef<((index: number) => Promise<void>) | null>(null);
  const playTrackRef = useRef<
    ((track: NativeTrack, customList?: NativeTrack[], options?: { contextKind?: PlaybackContextKind }) => Promise<void>) | null
  >(null);
  const playSingleTrackRef = useRef<((track: NativeTrack, options?: { pushPast?: boolean }) => Promise<void>) | null>(null);

  const getIsFocusActive = useCallback(() => {
    try {
      const timerState = useSkillStore.getState().skillStates?.['core.timer'] as any;
      return Boolean(timerState?.isRunning || timerState?.status === 'running' || timerState?.activeMode === 'focus');
    } catch {
      return false;
    }
  }, []);

  // Synchronize unified queue view [currentTrack, ...manualQueue]
  useEffect(() => {
    const nextUnified: NativeTrack[] = currentTrack
      ? [currentTrack, ...manualQueue]
      : [...manualQueue];
    setQueue(nextUnified);
    queueRef.current = nextUnified;
    const nextIdx = currentTrack ? 0 : -1;
    setQueueIndex(nextIdx);
    queueIndexRef.current = nextIdx;
  }, [currentTrack, manualQueue]);

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
    playbackSeqRef.current += 1;
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
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

  // Eject / Reset Native Session: Stops audio, clears track & queue, resets playbackSource to standby
  const ejectNativeTrack = useCallback(() => {
    stopInstantly();
    pastTracksRef.current = [];
    playRecordedSessionRef.current = null;
    setCurrentTrack(null);
    currentTrackRef.current = null;
    setQueue([]);
    queueRef.current = [];
    setQueueIndex(-1);
    queueIndexRef.current = -1;
    candidateUrlsRef.current = [];
    candidateIndexRef.current = 0;
    setAudioError(null);
    setPlaybackSourceState('companion');
    playbackSourceRef.current = 'companion';
    setLyricsData(null);
    lyricsDataRef.current = null;
    setCurrentTime(0);
    setCurrentTimeMs(0);
    setDuration(0);
    setDurationMs(0);
    useQueueStore.getState().setCurrentTrack(null);
    useQueueStore.getState().clearAllQueues();
    useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        playbackSource: 'companion',
        nativeTrack: null,
        isNativePlaying: false,
        lyricsData: { lines: [], isSynced: false, syncType: 'none', isInstrumental: false },
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

  // Core execution logic for playing a single normalized track
  const playSingleTrackInternal = useCallback(
    async (rawTrack: NativeTrack, options?: { pushPast?: boolean }) => {
      const mySeq = ++playbackSeqRef.current;
      if (prefetchTimerRef.current) {
        clearTimeout(prefetchTimerRef.current);
        prefetchTimerRef.current = null;
      }

      const norm = normalizeTrackMetadata(rawTrack as any);
      const track: NativeTrack = {
        ...rawTrack,
        id: norm.id,
        title: norm.title,
        artist: norm.artist,
        durationSeconds: norm.durationSeconds || rawTrack.durationSeconds || 0,
        thumbnailUrl: norm.thumbnailUrl || rawTrack.thumbnailUrl || '',
        albumArt: rawTrack.albumArt || norm.albumArt || norm.thumbnailUrl || '',
        streamUrl: norm.streamUrl || rawTrack.streamUrl,
        candidates: norm.candidates || rawTrack.candidates,
        isLocal: norm.isLocal ?? rawTrack.isLocal,
        artistId: rawTrack.artistId || norm.artistId,
        albumTitle: rawTrack.albumTitle || norm.albumTitle,
      };

      const prevTrackObj = currentTrackRef.current;
      if (
        options?.pushPast !== false &&
        prevTrackObj &&
        !isSameTrack(prevTrackObj as any, track as any)
      ) {
        const lastPast = pastTracksRef.current[pastTracksRef.current.length - 1];
        if (!lastPast || !isSameTrack(lastPast as any, prevTrackObj as any)) {
          pastTracksRef.current = [...pastTracksRef.current, prevTrackObj].slice(-40);
        }
      }

      setPlaybackSourceState('native');
      setCurrentTrack(track);
      currentTrackRef.current = track;
      playRecordedSessionRef.current = null;
      setAudioError(null);
      setIsResolvingAudio(true);
      isResolvingAudioRef.current = true;

      // Sync to Universal Queue Store & Affinity Store
      useQueueStore.getState().setActiveSource('native');
      useQueueStore.getState().setCurrentTrack(track);
      useMusicAffinityStore.getState().recordTrackSeen(norm, {
        isFocusActive: getIsFocusActive(),
      });

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
        audioRef.current.loop = useQueueStore.getState().repeatMode === 'one';
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

      // Trigger LRCLIB lyrics fetch in parallel using clean song title (non-blocking if absent)
      const cleanTitle = cleanTrackTitleForLyrics(track.title);
      const cleanArtist = track.artist;
      if (cleanTitle && cleanTitle !== 'CASA Native Player' && cleanTitle !== 'CASA PLAYER') {
        fetchLyrics(cleanTitle, cleanArtist, track.durationSeconds, false)
          .then((res) => {
            if (playbackSeqRef.current !== mySeq || currentTrackRef.current?.id !== track.id) return;
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
        if (playbackSeqRef.current !== mySeq || currentTrackRef.current?.id !== track.id) return;
        if (!candidates || candidates.length === 0) {
          throw new Error('Tidak ada kandidat stream audio');
        }

        setCurrentTrack({ ...track });
        currentTrackRef.current = { ...track };

        candidateUrlsRef.current = candidates;
        candidateIndexRef.current = 0;

        // Queue Lookahead Prefetching: silently pre-resolve upcoming track after 1.5s
        const upcoming = useQueueStore.getState().manualQueue[0] || useQueueStore.getState().radioQueue[0];
        if (upcoming) {
          prefetchTimerRef.current = setTimeout(() => {
            if (playbackSeqRef.current === mySeq) {
              prefetchTrackStream(upcoming as unknown as NativeTrack);
            }
          }, 1500);
        }

        if (audioRef.current && playbackSeqRef.current === mySeq) {
          const audio = audioRef.current;
          audio.autoplay = true;
          audio.loop = useQueueStore.getState().repeatMode === 'one';
          audio.src = candidates[0];
          console.log(
            `[CasaAudioContext] Assigned src=${candidates[0]} | readyState=${audio.readyState}`
          );

          const playPromise = audio.play();
          if (playPromise !== undefined) {
            playPromise
              .then(() => {
                if (playbackSeqRef.current !== mySeq) return;
                console.log('[CasaAudioContext] audio.play() RESOLVED successfully');
                setIsPlaying(true);
              })
              .catch((err: any) => {
                if (playbackSeqRef.current !== mySeq) return;
                console.error('[CasaAudioContext] audio.play() REJECTED:', err);
                if (err?.name !== 'AbortError') {
                  setIsPlaying(false);
                }
              });
          }
        }
      } catch (err: any) {
        if (playbackSeqRef.current !== mySeq) return;
        console.error('[CasaAudioContext] Failed to stream audio for track', track.title, err);
        setAudioError('STREAM ERROR');
        setIsPlaying(false);
      } finally {
        if (playbackSeqRef.current === mySeq) {
          setIsResolvingAudio(false);
          isResolvingAudioRef.current = false;
        }
      }
    },
    [volume, getIsFocusActive]
  );

  playSingleTrackRef.current = playSingleTrackInternal;

  const playTrackAtIndex = useCallback(
    async (index: number) => {
      if (index === 0 && currentTrackRef.current) {
        await playSingleTrackInternal(currentTrackRef.current, { pushPast: false });
        return;
      }

      const manualIdx = currentTrackRef.current ? index - 1 : index;
      const qStore = useQueueStore.getState();
      if (manualIdx >= 0 && manualIdx < qStore.manualQueue.length) {
        const picked = qStore.manualQueue[manualIdx] as unknown as NativeTrack;
        qStore.removeFromManualQueue(manualIdx);
        await playSingleTrackInternal(picked);
        return;
      }

      const q = queueRef.current;
      if (index >= 0 && index < q.length) {
        await playSingleTrackInternal(q[index]);
      } else {
        console.warn(`[CasaAudioContext] Invalid queue index ${index}, length: ${q.length}`);
      }
    },
    [playSingleTrackInternal]
  );

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

        const activeTrack = currentTrackRef.current;
        const sessionKey = activeTrack ? `${activeTrack.id}::${activeTrack.title}` : null;
        if (cur > 30 && activeTrack && sessionKey && playRecordedSessionRef.current !== sessionKey) {
          playRecordedSessionRef.current = sessionKey;
          useMusicAffinityStore.getState().recordTrackPlayQualified(activeTrack as any, {
            listenedSeconds: Math.round(cur),
            completed: false,
            isFocusActive: getIsFocusActive(),
          });
        }

        // Smart Queue Lookahead Trigger:
        // When track is within 15 seconds of ending, repeatMode === 'off', and manual queue has < 2 tracks,
        // auto-fill up to 5 relevant tracks to ensure 0-gap continuous playback.
        const isNearEnd = dur > 20 && cur >= dur - 15;
        if (isNearEnd) {
          const qStore = useQueueStore.getState();
          if (
            qStore.repeatMode === 'off' &&
            !qStore.suppressAutoFill &&
            qStore.manualQueue.length < 2 &&
            qStore.radioQueue.length < 5 &&
            !qStore.isFetchingRadio
          ) {
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
      const activeTrack = currentTrackRef.current;
      const sessionKey = activeTrack ? `${activeTrack.id}::${activeTrack.title}` : null;
      if (activeTrack && sessionKey && playRecordedSessionRef.current !== sessionKey) {
        playRecordedSessionRef.current = sessionKey;
        const listenedSec =
          audioRef.current && isFinite(audioRef.current.duration || audioRef.current.currentTime)
            ? Math.round(audioRef.current.duration || audioRef.current.currentTime || 0)
            : 0;
        useMusicAffinityStore.getState().recordTrackPlayQualified(activeTrack as any, {
          listenedSeconds: listenedSec,
          completed: true,
          isFocusActive: getIsFocusActive(),
        });
      }

      const qStore = useQueueStore.getState();
      if (qStore.repeatMode === 'one' && audioRef.current) {
        playRecordedSessionRef.current = null;
        audioRef.current.currentTime = 0;
        audioRef.current.play().catch(() => {});
        return;
      }

      const seqBeforeNext = playbackSeqRef.current;
      // Query next track from Unified Queue Store (manualQueue -> repeatAll loop -> radioQueue/Smart Queue)
      console.log('[CasaAudioContext] Track ended. Querying Smart Queue...');
      const nextSmartTrack = await qStore.getNextTrack({ awaitSmartFill: true });
      if (playbackSeqRef.current !== seqBeforeNext) return;
      if (nextSmartTrack) {
        console.log('[CasaAudioContext] Smart Queue advancing to:', nextSmartTrack.title);
        playSingleTrackRef.current?.(nextSmartTrack as unknown as NativeTrack);
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

  const setRepeatMode = useCallback((mode: RepeatMode) => {
    if (audioRef.current) {
      audioRef.current.loop = mode === 'one';
    }
    useQueueStore.getState().setRepeatMode(mode);
  }, []);

  const toggleRepeat = useCallback(() => {
    const next = useQueueStore.getState().toggleRepeat();
    if (audioRef.current) {
      audioRef.current.loop = next === 'one';
    }
    return next;
  }, []);

  const nextTrack = useCallback(async () => {
    playChimeCue('tap');
    const seqBefore = ++playbackSeqRef.current;
    const next = await useQueueStore.getState().getNextTrack({ awaitSmartFill: true });
    if (playbackSeqRef.current !== seqBefore) return;
    if (next) {
      await playSingleTrackInternal(next as unknown as NativeTrack);
    } else if (currentTrackRef.current && audioRef.current) {
      seekToSeconds(0);
    }
  }, [playSingleTrackInternal, seekToSeconds]);

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

      const prevFromStack = pastTracksRef.current.pop();
      if (prevFromStack) {
        if (currentTrackRef.current) {
          useQueueStore.getState().prependToManualQueue(currentTrackRef.current);
        }
        playSingleTrackInternal(prevFromStack, { pushPast: false });
        return;
      }

      const storeHistory = useQueueStore.getState().history;
      const current = currentTrackRef.current;
      const prevHist = storeHistory.find((h) => !current || !isSameTrack(h as any, current as any));
      if (prevHist) {
        if (current) {
          useQueueStore.getState().prependToManualQueue(current);
        }
        playSingleTrackInternal(prevHist as unknown as NativeTrack, { pushPast: false });
      } else {
        seekToSeconds(0);
      }
    },
    [playSingleTrackInternal, seekToSeconds]
  );

  const addToQueue = useCallback((e: React.MouseEvent | null, track: NativeTrack) => {
    if (e) e.stopPropagation();
    playChimeCue('tap');
    const norm = normalizeTrackMetadata(track as any);
    const normalizedTrack: NativeTrack = {
      ...track,
      title: norm.title,
      artist: norm.artist,
      artistId: track.artistId || norm.artistId,
      albumTitle: track.albumTitle || norm.albumTitle,
    };
    useQueueStore.getState().addToManualQueue(normalizedTrack);
    if (useQueueStore.getState().manualQueue.length === 1) {
      prefetchTrackStream(normalizedTrack);
    }
    setAddedTrackId(track.id);
    setTimeout(() => setAddedTrackId(null), 1500);
  }, []);

  const addCollectionToQueue = useCallback((tracks: NativeTrack[]) => {
    if (!tracks || tracks.length === 0) return;
    playChimeCue('tap');
    const qStore = useQueueStore.getState();
    for (const raw of tracks) {
      const norm = normalizeTrackMetadata(raw as any);
      const normalizedTrack: NativeTrack = {
        ...raw,
        title: norm.title,
        artist: norm.artist,
        artistId: raw.artistId || norm.artistId,
        albumTitle: raw.albumTitle || norm.albumTitle,
      };
      qStore.addToManualQueue(normalizedTrack);
    }
    const firstManual = useQueueStore.getState().manualQueue[0];
    if (firstManual) {
      prefetchTrackStream(firstManual as unknown as NativeTrack);
    }
  }, []);

  const removeFromQueue = useCallback(
    (e: React.MouseEvent | null, indexToRemove: number) => {
      if (e) e.stopPropagation();
      playChimeCue('tap');

      if (indexToRemove === 0 && currentTrackRef.current) {
        useQueueStore.getState().getNextTrack().then((next) => {
          if (next) {
            playSingleTrackInternal(next as unknown as NativeTrack, { pushPast: false });
          } else {
            stopInstantly();
            setCurrentTrack(null);
            currentTrackRef.current = null;
            setLyricsData(null);
            lyricsDataRef.current = null;
          }
        });
        return;
      }

      const manualIdx = currentTrackRef.current ? indexToRemove - 1 : indexToRemove;
      if (manualIdx >= 0) {
        useQueueStore.getState().removeFromManualQueue(manualIdx);
      }
    },
    [playSingleTrackInternal, stopInstantly]
  );

  const playSmartQueueTrack = useCallback(
    async (radioIdx: number) => {
      playChimeCue('tap');
      const qStore = useQueueStore.getState();
      if (radioIdx < 0 || radioIdx >= qStore.radioQueue.length) return;
      const picked = qStore.radioQueue[radioIdx] as unknown as NativeTrack;
      qStore.removeFromRadioQueue(radioIdx);
      await playSingleTrackInternal(picked);
    },
    [playSingleTrackInternal]
  );

  const removeSmartQueueTrack = useCallback((radioIdx: number) => {
    playChimeCue('tap');
    useQueueStore.getState().removeFromRadioQueue(radioIdx);
  }, []);

  const clearQueue = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    playChimeCue('tap');
    // Kosongkan HANYA membersihkan daftar lagu tunggu (manualQueue & radioQueue)!
    // DILARANG memanggil stopInstantly, pauseAudio, atau mereset currentTrack ke null!
    useQueueStore.getState().clearAllQueues();
  }, []);

  const setQueueAndPlay = useCallback(
    (
      list: NativeTrack[],
      targetIndex: number,
      options?: { contextKind?: PlaybackContextKind }
    ) => {
      if (!list || list.length === 0) return;
      const safeIdx = Math.max(0, Math.min(targetIndex, list.length - 1));
      const inferredContext: PlaybackContextKind =
        options?.contextKind ?? (list.length > 1 ? 'playlist' : 'single');
      const { currentTrack: chosen } = useQueueStore
        .getState()
        .setOrderedPlaylistQueue(list, safeIdx, { contextKind: inferredContext });
      if (chosen) {
        playSingleTrackInternal(chosen as unknown as NativeTrack);
      }
    },
    [playSingleTrackInternal]
  );

  const playTrack = useCallback(
    async (
      track: NativeTrack,
      customList?: NativeTrack[],
      options?: { contextKind?: PlaybackContextKind }
    ) => {
      setCurrentTime(0);
      setCurrentTimeMs(0);
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      const normTrack = normalizeTrackMetadata(track as any);
      const baseList = customList && customList.length > 0 ? [...customList] : [track];
      let idx = baseList.findIndex(
        (t) => t.id === track.id || isSameTrack(t as any, normTrack)
      );
      if (idx === -1) {
        baseList.unshift(track);
        idx = 0;
      }
      setQueueAndPlay(baseList, idx, options);
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

  const activeSource: 'native' | 'spotify' | null =
    playbackSource === 'native' && (effectiveIsPlaying || Boolean(currentTrack))
      ? 'native'
      : effectiveIsPlaying
      ? 'native'
      : isExternalPlaying
      ? 'spotify'
      : null;

  const getAccurateTimeMs = useCallback(() => {
    if (audioRef.current && !isResolvingAudioRef.current) {
      const rawMs = audioRef.current.currentTime * 1000;
      if (Number.isFinite(rawMs) && rawMs >= 0) {
        return rawMs;
      }
    }
    return currentTimeMs;
  }, [currentTimeMs]);

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
    getAccurateTimeMs,
    duration,
    durationMs,
    volume,
    isMuted,
    repeatMode,
    lyricsData,
    queue,
    manualQueue,
    radioQueue,
    isShuffle,
    toggleShuffle,
    toggleRepeat,
    setRepeatMode,
    queueIndex,
    addedTrackId,
    playTrack,
    playTrackAtIndex,
    playSmartQueueTrack,
    removeSmartQueueTrack,
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
    addCollectionToQueue,
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
