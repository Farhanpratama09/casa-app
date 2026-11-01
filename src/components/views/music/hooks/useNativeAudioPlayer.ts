import { useState, useRef, useEffect, useCallback } from 'react';
import {
  NativeTrack,
  resolveAudioCandidates,
  prefetchTrackStream,
} from '../../../../services/nativeAudioService';
import {
  fetchLyrics,
  cleanTrackTitleForLyrics,
  LyricResult,
} from '../../../../utils/lyricsService';
import { useSkillStore } from '../../../../skills/store';
import { playChimeCue } from '../../../../utils/tauriBridge';
import { PlaybackSource } from '../constants';

export interface UseNativeAudioPlayerOptions {
  playbackSource?: PlaybackSource;
  onTrackChange?: (track: NativeTrack | null) => void;
  onLyricsUpdated?: (result: LyricResult) => void;
  onQueueUpdated?: (queue: NativeTrack[]) => void;
}

export function useNativeAudioPlayer(options: UseNativeAudioPlayerOptions = {}) {
  const {
    playbackSource = 'native',
    onTrackChange,
    onLyricsUpdated,
    onQueueUpdated,
  } = options;

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const playbackSourceRef = useRef<PlaybackSource>(playbackSource);
  playbackSourceRef.current = playbackSource;

  const [nativeTrack, setNativeTrack] = useState<NativeTrack | null>(null);
  const nativeTrackRef = useRef<NativeTrack | null>(nativeTrack);
  useEffect(() => {
    nativeTrackRef.current = nativeTrack;
    onTrackChange?.(nativeTrack);
  }, [nativeTrack, onTrackChange]);

  const [nativeQueue, setNativeQueue] = useState<NativeTrack[]>([]);
  const nativeQueueRef = useRef<NativeTrack[]>([]);
  useEffect(() => {
    nativeQueueRef.current = nativeQueue;
    onQueueUpdated?.(nativeQueue);
  }, [nativeQueue, onQueueUpdated]);

  const [nativeQueueIndex, setNativeQueueIndex] = useState<number>(-1);
  const nativeQueueIndexRef = useRef<number>(-1);
  useEffect(() => {
    nativeQueueIndexRef.current = nativeQueueIndex;
  }, [nativeQueueIndex]);

  const [isNativePlaying, setIsNativePlaying] = useState<boolean>(false);
  const [isResolvingAudio, setIsResolvingAudio] = useState<boolean>(false);
  const isResolvingAudioRef = useRef<boolean>(false);
  const [nativeAudioError, setNativeAudioError] = useState<string | null>(null);
  const [addedNativeTrackId, setAddedNativeTrackId] = useState<string | null>(null);

  const candidateUrlsRef = useRef<string[]>([]);
  const candidateIndexRef = useRef<number>(0);
  const playTrackAtIndexRef = useRef<((index: number) => Promise<void>) | null>(null);

  // Synchronize Native Player playback state to Central Skill Store ('core.media')
  useEffect(() => {
    useSkillStore.getState().updateSkillState('core.media', (prev: any) => {
      if (!prev) return prev;
      return {
        ...prev,
        playbackSource,
        nativeTrack,
        isNativePlaying,
      };
    });
  }, [playbackSource, nativeTrack, isNativePlaying]);

  // Instant Teardown & Cutoff for Native Audio (Zero-Delay Audio Cutoff)
  const stopNativeAudioInstantly = useCallback(() => {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load();
    }
    setIsNativePlaying(false);
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

  // Main track execution logic
  const playTrackAtIndex = useCallback(async (index: number) => {
    const q = nativeQueueRef.current;
    if (index < 0 || index >= q.length) {
      console.warn(`[NativeAudio] Invalid queue index ${index}, queue length: ${q.length}`);
      return;
    }

    const track = q[index];
    setNativeQueueIndex(index);
    nativeQueueIndexRef.current = index;
    setNativeTrack(track);
    nativeTrackRef.current = track;
    setNativeAudioError(null);
    setIsResolvingAudio(true);
    isResolvingAudioRef.current = true;

    // Synchronously unlock & prime the HTMLAudioElement within the active user gesture call stack
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.autoplay = true;
      audioRef.current.muted = false;
      audioRef.current.volume = 1.0;
    }

    // Explicitly trigger LRCLIB lyrics fetch immediately in parallel
    const cleanTitle = cleanTrackTitleForLyrics(track.title);
    const cleanArtist = track.artist;
    if (cleanTitle && cleanTitle !== 'CASA Native Player') {
      fetchLyrics(cleanTitle, cleanArtist, track.durationSeconds, false)
        .then((res) => {
          if (res && res.lines && res.lines.length > 0) {
            onLyricsUpdated?.(res);
          }
        })
        .catch((err) => console.warn('[NativeAudio] Direct fetchLyrics error:', err));
    }

    try {
      const candidates = await resolveAudioCandidates(track);
      if (!candidates || candidates.length === 0) {
        throw new Error('Tidak ada kandidat stream audio');
      }

      // Sync updated durationSeconds from Rust InnerTube resolver
      setNativeTrack({ ...track });
      nativeTrackRef.current = { ...track };

      candidateUrlsRef.current = candidates;
      candidateIndexRef.current = 0;

      // Queue Lookahead Prefetching: silently pre-resolve the next track in queue after 1.5s
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
          `[NativeAudio Telemetry] Assigned src=${candidates[0]} | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise
            .then(() => {
              console.log(
                `[NativeAudio Telemetry] audio.play() RESOLVED | currentTime=${audio.currentTime} | paused=${audio.paused} | readyState=${audio.readyState} | networkState=${audio.networkState}`
              );
              setIsNativePlaying(true);
            })
            .catch((err: any) => {
              console.error(
                `[NativeAudio Telemetry] audio.play() REJECTED: name=${err?.name}, message=${err?.message} | readyState=${audio.readyState} | networkState=${audio.networkState}`,
                err
              );
              if (err?.name !== 'AbortError') {
                setIsNativePlaying(false);
              }
            });
        }
      }
    } catch (err: any) {
      console.error('[NativeAudio] Failed to stream audio at index', index, err);
      setNativeAudioError('STREAM ERROR');
      setIsNativePlaying(false);
    } finally {
      setIsResolvingAudio(false);
      isResolvingAudioRef.current = false;
    }
  }, [onLyricsUpdated]);

  playTrackAtIndexRef.current = playTrackAtIndex;

  // Initialize and bind HTML5 Audio Element for CASA Native Player ONCE on mount
  useEffect(() => {
    const audio = new Audio();
    audio.preload = 'auto';
    audio.autoplay = true;
    audioRef.current = audio;

    const handleLoadStart = () => {
      if (playbackSourceRef.current === 'native') {
        console.log(
          `[NativeAudio Telemetry] loadstart | readyState=${audio.readyState} | networkState=${audio.networkState} | src=${audio.currentSrc || audio.src}`
        );
      }
    };

    const handleLoadedData = () => {
      if (playbackSourceRef.current === 'native') {
        console.log(
          `[NativeAudio Telemetry] loadeddata (HAVE_CURRENT_DATA) | readyState=${audio.readyState} | networkState=${audio.networkState} | paused=${audio.paused}`
        );
      }
    };

    const handlePlay = () => {
      if (playbackSourceRef.current === 'native') {
        console.log(
          `[NativeAudio Telemetry] play event | currentTime=${audio.currentTime} | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );
        setIsNativePlaying(true);
      }
    };

    const handlePlaying = () => {
      if (playbackSourceRef.current === 'native') {
        console.log(
          `[NativeAudio Telemetry] playing event (audio actively outputting frames!) | currentTime=${audio.currentTime} | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );
        setIsNativePlaying(true);
        setNativeAudioError(null);
      }
    };

    const handleWaiting = () => {
      if (playbackSourceRef.current === 'native') {
        console.warn(
          `[NativeAudio Telemetry] waiting/buffering | currentTime=${audio.currentTime} | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );
      }
    };

    const handleStalled = () => {
      if (playbackSourceRef.current === 'native') {
        console.warn(
          `[NativeAudio Telemetry] stalled (buffer starvation) | currentTime=${audio.currentTime} | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );
      }
    };

    const handleCanPlay = () => {
      if (playbackSourceRef.current === 'native') {
        console.log(
          `[NativeAudio Telemetry] canplay (HAVE_FUTURE_DATA) | readyState=${audio.readyState} | networkState=${audio.networkState} | paused=${audio.paused}`
        );
      }
    };

    const handleCanPlayThrough = () => {
      if (playbackSourceRef.current === 'native') {
        console.log(
          `[NativeAudio Telemetry] canplaythrough (HAVE_ENOUGH_DATA) | readyState=${audio.readyState} | networkState=${audio.networkState} | paused=${audio.paused}`
        );
      }
    };

    const handlePause = () => {
      if (playbackSourceRef.current === 'native' && !isResolvingAudioRef.current) {
        console.log(
          `[NativeAudio Telemetry] pause event | currentTime=${audio.currentTime} | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );
        setIsNativePlaying(false);
      }
    };

    const handleEnded = () => {
      if (playbackSourceRef.current === 'native') {
        const curIdx = nativeQueueIndexRef.current;
        const q = nativeQueueRef.current;
        if (curIdx + 1 < q.length) {
          console.log(`[NativeAudio] Track ended. Auto-playing next track: ${curIdx + 1}/${q.length}`);
          playTrackAtIndexRef.current?.(curIdx + 1);
        } else {
          console.log('[NativeAudio] Track ended. Reached end of native queue.');
          setIsNativePlaying(false);
        }
      }
    };

    const handleLoadedMetadata = () => {
      if (playbackSourceRef.current === 'native') {
        const dur = audio.duration;
        const currentTrack = nativeTrackRef.current;
        console.log(
          `[NativeAudio Telemetry] loadedmetadata (HAVE_METADATA) | duration=${dur}s | expected=${currentTrack?.durationSeconds}s | readyState=${audio.readyState} | networkState=${audio.networkState}`
        );

        if (dur && dur < 90 && (currentTrack?.durationSeconds || 0) > 100) {
          console.warn(`[NativeAudio] Stream duration (${dur}s) is too short for full song (${currentTrack?.durationSeconds}s). Rejecting preview clip!`);
          handleError();
          return;
        }

        if (dur && !isNaN(dur) && isFinite(dur) && dur > 0) {
          setNativeTrack((prev) => (prev ? { ...prev, durationSeconds: Math.round(dur) } : null));
        }
      }
    };

    const handleError = async () => {
      if (playbackSourceRef.current === 'native') {
        const currentIdx = candidateIndexRef.current;
        const candidates = candidateUrlsRef.current;
        const nextIdx = currentIdx + 1;

        console.error('[NativeAudio Telemetry] Audio element ERROR:', {
          candidateIndex: currentIdx,
          code: audio.error?.code,
          message: audio.error?.message,
          currentSrc: audio.currentSrc || audio.src,
          readyState: audio.readyState,
          networkState: audio.networkState,
        });

        if (nextIdx < candidates.length) {
          console.log(`[NativeAudio] Attempting fallback candidate #${nextIdx}:`, candidates[nextIdx]);
          candidateIndexRef.current = nextIdx;
          audio.autoplay = true;
          audio.src = candidates[nextIdx];
          try {
            await audio.play();
            setNativeAudioError(null);
            setIsNativePlaying(true);
            return;
          } catch (retryErr: any) {
            console.warn(
              `[NativeAudio Telemetry] Fallback candidate #${nextIdx} play() rejected: name=${retryErr?.name}, message=${retryErr?.message}`,
              retryErr
            );
            return;
          }
        }

        console.error('[NativeAudio] All stream candidates failed for native track:', audio.error);
        setNativeAudioError('STREAM ERROR');
        setIsResolvingAudio(false);
        setIsNativePlaying(false);
      }
    };

    audio.addEventListener('loadstart', handleLoadStart);
    audio.addEventListener('loadeddata', handleLoadedData);
    audio.addEventListener('play', handlePlay);
    audio.addEventListener('playing', handlePlaying);
    audio.addEventListener('waiting', handleWaiting);
    audio.addEventListener('stalled', handleStalled);
    audio.addEventListener('canplay', handleCanPlay);
    audio.addEventListener('canplaythrough', handleCanPlayThrough);
    audio.addEventListener('pause', handlePause);
    audio.addEventListener('ended', handleEnded);
    audio.addEventListener('loadedmetadata', handleLoadedMetadata);
    audio.addEventListener('error', handleError);

    return () => {
      audio.pause();
      audio.removeEventListener('loadstart', handleLoadStart);
      audio.removeEventListener('loadeddata', handleLoadedData);
      audio.removeEventListener('play', handlePlay);
      audio.removeEventListener('playing', handlePlaying);
      audio.removeEventListener('waiting', handleWaiting);
      audio.removeEventListener('stalled', handleStalled);
      audio.removeEventListener('canplay', handleCanPlay);
      audio.removeEventListener('canplaythrough', handleCanPlayThrough);
      audio.removeEventListener('pause', handlePause);
      audio.removeEventListener('ended', handleEnded);
      audio.removeEventListener('loadedmetadata', handleLoadedMetadata);
      audio.removeEventListener('error', handleError);
    };
  }, []);

  // Transport Controls
  const toggleNativePlay = useCallback(async () => {
    playChimeCue('tap');
    if (!audioRef.current) return;

    console.info('[NativeAudio Telemetry] toggleNativePlay invoked:', {
      paused: audioRef.current.paused,
      currentTime: audioRef.current.currentTime,
      readyState: audioRef.current.readyState,
      networkState: audioRef.current.networkState,
      src: audioRef.current.src,
    });

    if (!audioRef.current.src && nativeTrackRef.current && nativeQueueIndexRef.current >= 0) {
      await playTrackAtIndex(nativeQueueIndexRef.current);
      return;
    }

    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
        setIsNativePlaying(true);
      } catch (err: any) {
        console.error('[NativeAudio Telemetry] toggleNativePlay play() rejected:', {
          errorName: err?.name,
          errorMessage: err?.message,
          readyState: audioRef.current.readyState,
          networkState: audioRef.current.networkState,
        });
        setIsNativePlaying(false);
      }
    } else {
      audioRef.current.pause();
      setIsNativePlaying(false);
    }
  }, [playTrackAtIndex]);

  const handleNextTrack = useCallback(() => {
    playChimeCue('tap');
    const q = nativeQueueRef.current;
    const curIdx = nativeQueueIndexRef.current;
    if (curIdx + 1 < q.length) {
      playTrackAtIndex(curIdx + 1);
    } else {
      console.log('[NativeAudio] Reached end of native queue');
    }
  }, [playTrackAtIndex]);

  const handlePrevTrack = useCallback((currentTimeMs: number = 0) => {
    playChimeCue('tap');
    if (currentTimeMs > 3000) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
      }
      return;
    }
    const curIdx = nativeQueueIndexRef.current;
    if (curIdx > 0) {
      playTrackAtIndex(curIdx - 1);
    } else if (audioRef.current) {
      audioRef.current.currentTime = 0;
    }
  }, [playTrackAtIndex]);

  const handleSeekNative = useCallback((targetMs: number) => {
    if (audioRef.current && typeof targetMs === 'number' && !isNaN(targetMs)) {
      audioRef.current.currentTime = targetMs / 1000;
    }
  }, []);

  const addToQueue = useCallback((e: React.MouseEvent | null, track: NativeTrack) => {
    if (e) e.stopPropagation();
    playChimeCue('tap');
    setNativeQueue((prev) => {
      const updated = [...prev, track];
      nativeQueueRef.current = updated;
      if (updated.length - 1 === nativeQueueIndexRef.current + 1) {
        prefetchTrackStream(track);
      }
      return updated;
    });
    setAddedNativeTrackId(track.id);
    setTimeout(() => setAddedNativeTrackId(null), 1500);
  }, []);

  const removeFromQueue = useCallback((e: React.MouseEvent | null, indexToRemove: number) => {
    if (e) e.stopPropagation();
    playChimeCue('tap');
    const updated = nativeQueueRef.current.filter((_, idx) => idx !== indexToRemove);
    nativeQueueRef.current = updated;
    setNativeQueue(updated);

    if (updated.length === 0) {
      setNativeQueueIndex(-1);
      nativeQueueIndexRef.current = -1;
      stopNativeAudioInstantly();
      setNativeTrack(null);
      nativeTrackRef.current = null;
      onLyricsUpdated?.({ lines: [], isSynced: false, syncType: 'none', isInstrumental: false });
    } else if (indexToRemove === nativeQueueIndexRef.current) {
      const nextIdx = indexToRemove < updated.length ? indexToRemove : updated.length - 1;
      playTrackAtIndex(nextIdx);
    } else if (indexToRemove < nativeQueueIndexRef.current) {
      const newIdx = nativeQueueIndexRef.current - 1;
      setNativeQueueIndex(newIdx);
      nativeQueueIndexRef.current = newIdx;
    }
  }, [playTrackAtIndex, stopNativeAudioInstantly, onLyricsUpdated]);

  const clearQueue = useCallback((e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    playChimeCue('tap');
    setNativeQueue([]);
    nativeQueueRef.current = [];
    setNativeQueueIndex(-1);
    nativeQueueIndexRef.current = -1;
    stopNativeAudioInstantly();
    setNativeTrack(null);
    nativeTrackRef.current = null;
    onLyricsUpdated?.({ lines: [], isSynced: false, syncType: 'none', isInstrumental: false });
  }, [stopNativeAudioInstantly, onLyricsUpdated]);

  const setQueueAndPlay = useCallback((list: NativeTrack[], targetIndex: number) => {
    setNativeQueue(list);
    nativeQueueRef.current = list;
    playTrackAtIndex(targetIndex);
  }, [playTrackAtIndex]);

  return {
    audioRef,
    nativeTrack,
    setNativeTrack,
    isNativePlaying,
    setIsNativePlaying,
    isResolvingAudio,
    nativeAudioError,
    nativeQueue,
    setNativeQueue,
    currentTrackIndex: nativeQueueIndex,
    setNativeQueueIndex,
    addedNativeTrackId,
    playTrackAtIndex,
    toggleNativePlay,
    stopNativeAudioInstantly,
    handleNextTrack,
    handlePrevTrack,
    handleSeekNative,
    addToQueue,
    removeFromQueue,
    clearQueue,
    setQueueAndPlay,
  };
}
