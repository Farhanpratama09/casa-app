import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { LyricLine, parseTimeToSeconds } from '../../../../utils/lyricsService';
import { PlaybackSource } from '../constants';
import {
  PlaybackClockSnapshot,
  computeInterpolatedPositionMs,
  computeLyricAdjustedTimeMs,
  computeSyncedLyricIndex,
  EXTERNAL_SEEK_SNAP_THRESHOLD_MS,
} from '../../../../features/media/playbackClock';
import {
  isWithinPlayGuardWindow,
  markUserInitiatedPlayback,
  setLastKnownPositionMs,
  getSpotifyPlaybackProgressMs,
  seekSpotifyPlayback,
} from '../../../../utils/spotifyService';
import { getCurrentMedia, seekMediaSession } from '../../../../utils/tauriBridge';

export interface UseLyricsSyncParams {
  audioRef: React.RefObject<HTMLAudioElement | null>;
  isPlaying: boolean;
  playbackSource: PlaybackSource;
  playbackClock?: PlaybackClockSnapshot;
  currentTrackId?: string | null;
  displayLines: Array<{
    id: string;
    timeMs: number;
    text: string;
    time?: number;
    seconds?: number;
    timeSeconds?: number;
  }>;
  durationMs?: number;
  durationSeconds?: number;
  currentTimeSeconds?: number;
  lyricOffsetSeconds?: number;
  isSyncedLyrics?: boolean;
  hasActiveSession?: boolean;
  // External Media Session (GSMTC / Spotify) params for baseline sync
  externalCurrentTimeSeconds?: number;
  externalTitle?: string;
  isBrowser?: boolean;
  isBrowserSpotify?: boolean;
  isDesktopSpotify?: boolean;
  isUserConnected?: boolean;
  currentSessionId?: string;
  onSeekExternal?: (targetMs: number) => Promise<boolean | void> | boolean | void;
}

export function useLyricsSync(params: UseLyricsSyncParams) {
  const {
    audioRef,
    isPlaying,
    playbackSource,
    playbackClock,
    currentTrackId = null,
    displayLines,
    durationMs = 0,
    durationSeconds = 0,
    currentTimeSeconds = 0,
    lyricOffsetSeconds = 0,
    isSyncedLyrics = false,
    hasActiveSession = true,
    externalCurrentTimeSeconds = 0,
    externalTitle = '',
    isBrowser = false,
    isBrowserSpotify = false,
    isDesktopSpotify = false,
    isUserConnected = false,
    currentSessionId = '',
    onSeekExternal,
  } = params;

  const initialTimeMs =
    playbackSource !== 'native' && hasActiveSession
      ? playbackClock
        ? computeInterpolatedPositionMs(playbackClock)
        : Math.round(Math.max(0, currentTimeSeconds || externalCurrentTimeSeconds || 0) * 1000)
      : 0;

  const [activeLyricIndex, setActiveLyricIndex] = useState<number>(-1);
  const [preciseTimeMs, setPreciseTimeMs] = useState<number>(initialTimeMs);
  const [nativeProgressMs, setNativeProgressMs] = useState<number>(0);

  // Monotonic progress & hysteresis locks
  const playbackClockRef = useRef<PlaybackClockSnapshot | undefined>(playbackClock);
  playbackClockRef.current = playbackClock;
  const hasPlaybackClock = playbackClock !== undefined;
  const lastActiveIndexRef = useRef<number>(-1);
  const lastSeekTimeRef = useRef<number>(0);
  const lastSyncLocalTime = useRef<number>(performance.now());
  const lastReportedTimeMs = useRef<number>(initialTimeMs);
  const preciseTimeMsRef = useRef<number>(initialTimeMs);
  const durationLimitMsRef = useRef<number>(
    durationMs > 0 ? durationMs : durationSeconds > 0 ? Math.round(durationSeconds * 1000) : 0
  );
  const isSeekingRef = useRef<boolean>(false);
  const seekLockTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastSongTitleRef = useRef<string>(externalTitle);
  const prevIsPlayingSyncRef = useRef<boolean>(isPlaying);
  const prevTrackIdRef = useRef<string | null | undefined>(currentTrackId);
  const prevSourceRef = useRef<PlaybackSource>(playbackSource);
  const isTrackChangingRef = useRef<boolean>(false);

  useEffect(() => {
    preciseTimeMsRef.current = preciseTimeMs;
  }, [preciseTimeMs]);

  useEffect(() => {
    durationLimitMsRef.current =
      durationMs > 0 ? durationMs : durationSeconds > 0 ? Math.round(durationSeconds * 1000) : 0;
  }, [durationMs, durationSeconds]);

  // Stale Clock Guard on Track Change or Source Switch: Immediately flush activeLyricIndex to -1
  useEffect(() => {
    if (prevTrackIdRef.current !== currentTrackId || prevSourceRef.current !== playbackSource) {
      prevTrackIdRef.current = currentTrackId;
      prevSourceRef.current = playbackSource;
      isTrackChangingRef.current = true;
      lastActiveIndexRef.current = -1;
      setActiveLyricIndex(-1);
      setNativeProgressMs(0);
      setPreciseTimeMs(0);
      lastReportedTimeMs.current = 0;
      lastSyncLocalTime.current = performance.now();
    }
  }, [currentTrackId, playbackSource]);

  useEffect(() => {
    return () => {
      if (seekLockTimeoutRef.current) {
        clearTimeout(seekLockTimeoutRef.current);
      }
    };
  }, []);

  const lyricOffsetMs =
    playbackSource === 'native'
      ? 0
      : Math.max(0, (lyricOffsetSeconds || 0) * 1000);

  const getLyricAdjustedTime = useCallback(
    (timeMs: number, ignoreLeadTime: boolean = false): number => {
      return computeLyricAdjustedTimeMs(timeMs, {
        playbackSource,
        offsetSeconds: lyricOffsetSeconds,
        ignoreLeadTime: ignoreLeadTime || isSeekingRef.current,
      });
    },
    [playbackSource, lyricOffsetSeconds]
  );

  const computeRawLyricIndex = useCallback(
    (lines: Array<{ id: string; timeMs: number; text: string; time?: number }>, timeMs: number): number => {
      return computeSyncedLyricIndex(lines, timeMs);
    },
    []
  );

  // Central Monotonic Progress Guard & Single-Source Clock Interpolator
  const applyProgressUpdate = useCallback(
    (newMs: number, isForceSeekOrTrackChange: boolean = false) => {
      // Complete Isolation: In Native mode, never allow external GSMTC/parent clocks to mutate progress or lyrics!
      if (playbackSource === 'native') {
        return;
      }

      // Guard buffer: Ignore payload progress_ms: 0 within 800ms of play trigger
      if (newMs === 0 && isWithinPlayGuardWindow(800)) {
        return;
      }
      setLastKnownPositionMs(newMs);

      const now = performance.now();
      const currentLocalMs =
        lastReportedTimeMs.current +
        (isPlaying ? Math.max(0, now - lastSyncLocalTime.current) : 0);
      const backwardDiff = currentLocalMs - newMs;
      const forwardDiff = newMs - currentLocalMs;

      // 1. Force Seek or Track Change: Apply immediately
      if (isForceSeekOrTrackChange) {
        lastReportedTimeMs.current = newMs;
        lastSyncLocalTime.current = now;
        setPreciseTimeMs(newMs);
        lastSeekTimeRef.current = now;

        const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(newMs, true));
        lastActiveIndexRef.current = newIdx;
        setActiveLyricIndex(newIdx);
        return;
      }

      // 2. Monotonic Progress Guard with Soft Backward Drift Correction:
      if (backwardDiff > 0) {
        // Large backward jump (> 1500ms): Deliberate user seek backwards
        if (backwardDiff > 1500) {
          lastReportedTimeMs.current = newMs;
          lastSyncLocalTime.current = now;
          setPreciseTimeMs(newMs);
          lastSeekTimeRef.current = now;

          const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(newMs));
          lastActiveIndexRef.current = newIdx;
          setActiveLyricIndex(newIdx);
          return;
        }

        // Soft backward adjustment (100ms - 1500ms):
        // Smoothly blend 30% of backward delta so clock gently catches up with true GSMTC time without abrupt visual snapping
        if (backwardDiff > 100) {
          const nudged = currentLocalMs - backwardDiff * 0.3;
          lastReportedTimeMs.current = nudged;
          lastSyncLocalTime.current = now;
          setPreciseTimeMs(nudged);
        }
        return;
      }

      // 3. Forward Progress:
      // Large forward jump (> 1500ms): Deliberate user seek forwards
      if (forwardDiff > 1500) {
        lastReportedTimeMs.current = newMs;
        lastSyncLocalTime.current = now;
        setPreciseTimeMs(newMs);
        lastSeekTimeRef.current = now;

        const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(newMs));
        lastActiveIndexRef.current = newIdx;
        setActiveLyricIndex(newIdx);
        return;
      }

      // Soft nudge for forward drift (100ms - 1500ms):
      // Smoothly blend 30% of forward delta to catch up drift without visual snapping
      if (forwardDiff > 100) {
        const nudged = currentLocalMs + forwardDiff * 0.3;
        lastReportedTimeMs.current = nudged;
        lastSyncLocalTime.current = now;
        setPreciseTimeMs(nudged);
      }
    },
    [playbackSource, isPlaying, displayLines, computeRawLyricIndex, getLyricAdjustedTime]
  );

  // Quick Post-Seek Resync: once seek-lock window expires, queries real position to gently correct any sub-second drift
  const triggerPostSeekResync = useCallback(async () => {
    if (playbackSource === 'native') {
      return;
    }

    try {
      const canAccessSpotify = isUserConnected && (isDesktopSpotify || isBrowserSpotify);
      if (canAccessSpotify) {
        const progMs = await getSpotifyPlaybackProgressMs();
        if (typeof progMs === 'number' && progMs > 0) {
          if (isBrowserSpotify) {
            lastReportedTimeMs.current = progMs;
            lastSyncLocalTime.current = performance.now();
            setPreciseTimeMs(progMs);
            const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(progMs));
            lastActiveIndexRef.current = newIdx;
            setActiveLyricIndex(newIdx);
          } else {
            applyProgressUpdate(progMs, false);
          }
        }
      } else {
        const media = await getCurrentMedia();
        if (media && typeof media.position === 'number' && media.position > 0) {
          const posMs = Math.round(media.position * 1000);
          applyProgressUpdate(posMs, false);
        }
      }
    } catch {}
  }, [
    playbackSource,
    isUserConnected,
    isDesktopSpotify,
    isBrowserSpotify,
    displayLines,
    computeRawLyricIndex,
    getLyricAdjustedTime,
    applyProgressUpdate,
  ]);

  // Handle manual seek from lyric row or scrubber (Pure Float Seconds Contract)
  const handleLyricLineSeek = useCallback(
    async (rawTargetSeconds: number): Promise<boolean> => {
      const targetSeconds = parseTimeToSeconds(rawTargetSeconds);
      if (targetSeconds < 0) return false;
      const targetMs = Math.round(targetSeconds * 1000);
      isTrackChangingRef.current = false;

      // 1. Activate Seek Lock to reject incoming stale GSMTC updates (anti-rubber-banding)
      isSeekingRef.current = true;
      if (seekLockTimeoutRef.current) {
        clearTimeout(seekLockTimeoutRef.current);
      }
      seekLockTimeoutRef.current = setTimeout(() => {
        isSeekingRef.current = false;
        triggerPostSeekResync();
      }, 750);

      // 2. Immediate Optimistic Update & Buffer Delay Compensation
      setLastKnownPositionMs(targetMs);
      lastReportedTimeMs.current = targetMs;
      // Shift sync baseline by +120ms so local ticker doesn't run ahead while browser buffers audio
      lastSyncLocalTime.current = performance.now() + 120;
      preciseTimeMsRef.current = targetMs;
      setPreciseTimeMs(targetMs);
      applyProgressUpdate(targetMs, true);

      // 3. Dispatch seek to Native Audio, Spotify Web API, or Windows GSMTC Session
      if (playbackSource === 'native') {
        if (audioRef.current) {
          audioRef.current.currentTime = targetSeconds;
          setNativeProgressMs(targetMs);
          preciseTimeMsRef.current = targetMs;
          setPreciseTimeMs(targetMs);
          lastSeekTimeRef.current = performance.now();
          const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(targetMs, true));
          lastActiveIndexRef.current = newIdx;
          setActiveLyricIndex(newIdx);
          return true;
        }
        return false;
      }

      if (onSeekExternal) {
        const res = await onSeekExternal(targetMs);
        return res !== false;
      }

      const canAccessSpotify = isUserConnected && (isDesktopSpotify || isBrowserSpotify);
      if (canAccessSpotify) {
        const spotifyOk = await seekSpotifyPlayback(targetMs);
        if (spotifyOk) return true;
      }
      if (currentSessionId) {
        const gsmtcOk = await seekMediaSession(currentSessionId, targetMs);
        if (gsmtcOk) return true;
      }
      return await seekMediaSession('', targetMs);
    },
    [
      playbackSource,
      audioRef,
      displayLines,
      computeRawLyricIndex,
      getLyricAdjustedTime,
      applyProgressUpdate,
      triggerPostSeekResync,
      onSeekExternal,
      isUserConnected,
      isDesktopSpotify,
      isBrowserSpotify,
      currentSessionId,
    ]
  );

  // Single Source of Truth Clock Sync: follow interpolated MediaSkill playbackClock & snap on external seeks (>1500ms)
  useEffect(() => {
    playbackClockRef.current = playbackClock;
    if (playbackSource === 'native' || !playbackClock) return;
    if (isSeekingRef.current) return;

    const interpolatedMs = computeInterpolatedPositionMs(playbackClock, Date.now());
    const prevMs = preciseTimeMsRef.current;

    if (Math.abs(interpolatedMs - prevMs) > EXTERNAL_SEEK_SNAP_THRESHOLD_MS) {
      lastSeekTimeRef.current = performance.now();
    }

    lastReportedTimeMs.current = interpolatedMs;
    lastSyncLocalTime.current = performance.now();
    preciseTimeMsRef.current = interpolatedMs;
    setPreciseTimeMs(interpolatedMs);
    setLastKnownPositionMs(interpolatedMs);

    const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(interpolatedMs));
    if (newIdx !== lastActiveIndexRef.current) {
      lastActiveIndexRef.current = newIdx;
      setActiveLyricIndex(newIdx);
    }
  }, [playbackSource, playbackClock, displayLines, computeRawLyricIndex, getLyricAdjustedTime]);

  // Sync baseline whenever GSMTC/Spotify emits an update or track/play state changes
  useEffect(() => {
    // Complete Isolation: In Native mode, ignore all external GSMTC/Spotify baseline syncs!
    if (playbackSource === 'native') return;
    if (hasPlaybackClock) return;

    // Anti-Rubber-Banding: Reject incoming stale GSMTC updates during active seek lock window
    if (isSeekingRef.current) return;

    const currentTitle = externalTitle || '';
    const isTrackChange = currentTitle !== lastSongTitleRef.current;
    const playStateChanged = prevIsPlayingSyncRef.current !== isPlaying;
    prevIsPlayingSyncRef.current = isPlaying;

    if (isTrackChange) {
      lastSongTitleRef.current = currentTitle;
      if (isBrowserSpotify) {
        lastReportedTimeMs.current = 0;
        lastSyncLocalTime.current = performance.now();
        preciseTimeMsRef.current = 0;
        setPreciseTimeMs(0);
        applyProgressUpdate(0, true);
      } else {
        applyProgressUpdate(externalCurrentTimeSeconds * 1000, true);
      }
    } else if (playStateChanged) {
      if (!isPlaying) {
        lastReportedTimeMs.current = preciseTimeMsRef.current;
        lastSyncLocalTime.current = performance.now();
      } else {
        lastSyncLocalTime.current = performance.now();
        markUserInitiatedPlayback();
      }
    } else {
      if (isBrowserSpotify) {
        return;
      }
      if (isBrowser && externalCurrentTimeSeconds === 0 && preciseTimeMsRef.current > 2000) {
        return;
      }
      applyProgressUpdate(externalCurrentTimeSeconds * 1000, false);
    }
  }, [
    playbackSource,
    hasPlaybackClock,
    externalCurrentTimeSeconds,
    isPlaying,
    externalTitle,
    applyProgressUpdate,
    isBrowser,
    isBrowserSpotify,
  ]);

  // Lightweight 250ms Single-Source Clock Ticker while playing (synced time labels, progress bar, & lyrics)
  useEffect(() => {
    const isPlayingNow =
      playbackSource === 'native'
        ? isPlaying
        : (isPlaying && hasActiveSession);

    if (!isPlayingNow) return;

    const tick = () => {
      let currentMs: number;
      if (playbackSource === 'native') {
        // Direct hardware HTML5 audio clock without GSMTC latency or extrapolation
        currentMs = audioRef.current ? audioRef.current.currentTime * 1000 : 0;
        setNativeProgressMs(currentMs);
        preciseTimeMsRef.current = currentMs;
        setPreciseTimeMs(currentMs);
      } else {
        currentMs = playbackClockRef.current
          ? computeInterpolatedPositionMs(playbackClockRef.current, Date.now())
          : (() => {
              const elapsed = Math.max(0, performance.now() - lastSyncLocalTime.current);
              const rawMs = lastReportedTimeMs.current + elapsed;
              const limitMs = durationLimitMsRef.current;
              return limitMs > 0 ? Math.min(limitMs, rawMs) : rawMs;
            })();
        preciseTimeMsRef.current = currentMs;
        setPreciseTimeMs(currentMs);
      }

      // Stale Clock Guard on Track Change: hold activeLyricIndex at -1 until audio clock confirms <= 1s
      if (isTrackChangingRef.current) {
        if (currentMs <= 1000) {
          isTrackChangingRef.current = false;
        } else {
          if (lastActiveIndexRef.current !== -1) {
            lastActiveIndexRef.current = -1;
            setActiveLyricIndex(-1);
          }
          return;
        }
      }

      // Monotonic lyric advancement (+75ms perception offset)
      const adjustedTime = getLyricAdjustedTime(currentMs);
      const rawIdx = computeRawLyricIndex(displayLines, adjustedTime);

      // Only advance forward during continuous playback (hysteresis & monotonic lock)
      if (rawIdx >= lastActiveIndexRef.current) {
        if (rawIdx !== lastActiveIndexRef.current) {
          lastActiveIndexRef.current = rawIdx;
          setActiveLyricIndex(rawIdx);
        }
      } else {
        // Rollback is permitted within 800ms of explicit user manual seek or external Spotify seek snap
        if (performance.now() - lastSeekTimeRef.current < 800) {
          lastActiveIndexRef.current = rawIdx;
          setActiveLyricIndex(rawIdx);
        }
      }
    };

    tick();
    const intervalMs = playbackSource === 'native' ? 150 : 250;
    const timer = setInterval(tick, intervalMs);
    return () => clearInterval(timer);
  }, [
    playbackSource,
    isPlaying,
    hasActiveSession,
    displayLines,
    computeRawLyricIndex,
    getLyricAdjustedTime,
    audioRef,
  ]);

  // Calibrate preciseTimeMs with genuine Spotify Web API progress_ms (fallback only when playbackClock is not provided)
  useEffect(() => {
    // Complete Isolation: In Native mode, or when global MediaSkill playbackClock handles polling, skip duplicate polling!
    if (playbackSource === 'native' || hasPlaybackClock) return;

    let isMounted = true;
    if (isUserConnected && isPlaying && (isDesktopSpotify || isBrowserSpotify)) {
      const syncProgress = async () => {
        try {
          const progMs = await getSpotifyPlaybackProgressMs();
          if (isMounted && typeof progMs === 'number' && progMs >= 0) {
            if (isSeekingRef.current) return;
            if (progMs === 0 && isWithinPlayGuardWindow(800)) {
              return;
            }
            if (isBrowserSpotify) {
              lastReportedTimeMs.current = progMs;
              lastSyncLocalTime.current = performance.now();
              setPreciseTimeMs(progMs);
              const newIdx = computeRawLyricIndex(displayLines, getLyricAdjustedTime(progMs));
              lastActiveIndexRef.current = newIdx;
              setActiveLyricIndex(newIdx);
            } else {
              applyProgressUpdate(progMs, false);
            }
          }
        } catch {}
      };

      const interval = setInterval(syncProgress, 2000);
      return () => {
        isMounted = false;
        clearInterval(interval);
      };
    }
  }, [
    playbackSource,
    isUserConnected,
    isPlaying,
    isDesktopSpotify,
    isBrowserSpotify,
    displayLines,
    computeRawLyricIndex,
    getLyricAdjustedTime,
    applyProgressUpdate,
  ]);

  // Reaktivitas Auto-Sync: Tangani Asynchronous Lyrics Arrival & Sinkronisasi Posisi Aktif (Single Formula)
  useEffect(() => {
    if (!displayLines || displayLines.length === 0) return;

    const currentMs =
      playbackSource === 'native'
        ? currentTimeSeconds > 0
          ? currentTimeSeconds * 1000
          : audioRef.current
          ? audioRef.current.currentTime * 1000
          : 0
        : playbackClockRef.current
        ? computeInterpolatedPositionMs(playbackClockRef.current, Date.now())
        : preciseTimeMs > 0
        ? preciseTimeMs
        : externalCurrentTimeSeconds * 1000;

    // Stale Clock Guard on Track Change: tahan kalkulasi baris aktif di -1 sampai waktu <= 1 detik
    if (isTrackChangingRef.current) {
      if (currentMs <= 1000) {
        isTrackChangingRef.current = false;
      } else {
        if (activeLyricIndex !== -1) {
          lastActiveIndexRef.current = -1;
          setActiveLyricIndex(-1);
        }
        return;
      }
    }

    const currentIndex = computeRawLyricIndex(displayLines, getLyricAdjustedTime(currentMs));
    if (currentIndex !== activeLyricIndex) {
      lastActiveIndexRef.current = currentIndex;
      setActiveLyricIndex(currentIndex);
    }
  }, [
    displayLines,
    currentTimeSeconds,
    playbackSource,
    externalCurrentTimeSeconds,
    preciseTimeMs,
    activeLyricIndex,
    audioRef,
    computeRawLyricIndex,
    getLyricAdjustedTime,
  ]);

  const calibrateExternalTime = useCallback((timeMs: number, shiftSyncBaseline: boolean = false) => {
    if (playbackSource === 'native') return;
    if (isSeekingRef.current) return;
    lastReportedTimeMs.current = timeMs;
    lastSyncLocalTime.current = performance.now() + (shiftSyncBaseline ? 120 : 0);
    setPreciseTimeMs(timeMs);
  }, [playbackSource]);

  const resetLyricsSync = useCallback(() => {
    setNativeProgressMs(0);
    setPreciseTimeMs(0);
    lastActiveIndexRef.current = -1;
    setActiveLyricIndex(-1);
    lastSeekTimeRef.current = performance.now();
    lastReportedTimeMs.current = 0;
    lastSyncLocalTime.current = performance.now();
  }, []);

  const audioAdjustedTime =
    playbackSource === 'native'
      ? nativeProgressMs
      : getLyricAdjustedTime(preciseTimeMs);

  // Mid-song instrumental gap detection (> 12s gap and > 6s elapsed since current line)
  const isMidSongInstrumental = useMemo(() => {
    if (!isSyncedLyrics || activeLyricIndex < 0 || activeLyricIndex >= displayLines.length - 1) {
      return false;
    }
    const currentLine = displayLines[activeLyricIndex];
    const nextLine = displayLines[activeLyricIndex + 1];
    const gapMs = nextLine.timeMs - currentLine.timeMs;
    const elapsedSinceLine = audioAdjustedTime - currentLine.timeMs;
    return gapMs > 12000 && elapsedSinceLine > 6000 && audioAdjustedTime < nextLine.timeMs;
  }, [isSyncedLyrics, activeLyricIndex, displayLines, audioAdjustedTime]);

  return {
    activeLyricIndex,
    setActiveLyricIndex,
    preciseTimeMs,
    setPreciseTimeMs,
    nativeProgressMs,
    setNativeProgressMs,
    audioAdjustedTime,
    isMidSongInstrumental,
    applyProgressUpdate,
    handleLyricLineSeek,
    calibrateExternalTime,
    resetLyricsSync,
    computeRawLyricIndex,
    getLyricAdjustedTime,
    triggerPostSeekResync,
    lastActiveIndexRef,
    lastSeekTimeRef,
    lastSyncLocalTime,
    lastReportedTimeMs,
    isSeekingRef,
  };
}
