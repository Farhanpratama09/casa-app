import { useCallback } from 'react';
import { useSkillStore } from '../../skills/store';
import { MediaSkillState, MusicSubPanel } from './types';
import {
  computeInterpolatedPositionMs,
  LYRIC_COMPANION_LEAD_MS,
  reconcilePlaybackClockSnapshot,
  markPlaybackManualSeekLock,
} from './playbackClock';
import {
  mediaPlayPause,
  mediaNextTrack,
  mediaPrevTrack,
  controlMediaSession,
  seekMediaSession,
  markManualMediaStopped,
  clearManualMediaStopped,
} from '../../utils/tauriBridge';
import { getActiveLyrics, LyricResult, setCachedLyrics } from '../../utils/lyricsService';
import {
  ensureSpotifySessionReady,
  isQueueStale,
  getSessionInitTimestamp,
  getQueueHydrationTimestamp,
  markSessionInit,
  markQueueHydrated,
  playQueueTrack,
  SpotifyTrackItem,
  isSpotifyUserConnected,
  getLastKnownPositionMs,
  setLastKnownPositionMs,
  clearPlayGuardWindow,
  resumeSpotifyPlayback,
  pauseSpotifyPlayback,
  nextSpotifyTrack,
  prevSpotifyTrack,
  seekSpotifyPlayback,
  verifyIsBrowserSpotify,
  markUserInitiatedPlayback,
  normalizeTrackUri,
} from '../../utils/spotifyService';

async function executeNativePlaybackFallback(
  command: 'toggle' | 'next' | 'prev',
  sessionId: string,
  hasNativeMedia?: boolean
): Promise<void> {
  if (sessionId) {
    const ok = await controlMediaSession(sessionId, command);
    if (ok) return;
  }
  if (hasNativeMedia || !sessionId) {
    if (command === 'toggle') {
      await mediaPlayPause();
    } else if (command === 'next') {
      await mediaNextTrack();
    } else {
      await mediaPrevTrack();
    }
  }
}

export {
  ensureSpotifySessionReady,
  isQueueStale,
  getSessionInitTimestamp,
  getQueueHydrationTimestamp,
  markSessionInit,
  markQueueHydrated,
  resumeSpotifyPlayback,
  pauseSpotifyPlayback,
  nextSpotifyTrack,
  prevSpotifyTrack,
  getLastKnownPositionMs,
};

export function useMediaPlayback() {
  const mediaState: MediaSkillState = useSkillStore(
    (s) => s.skillStates['core.media']
  );
  const updateSkillState = useSkillStore((s) => s.updateSkillState);

  const updateState = useCallback(
    (patchOrFn: Partial<MediaSkillState> | ((prev: MediaSkillState) => MediaSkillState)) => {
      updateSkillState('core.media', patchOrFn);
    },
    [updateSkillState]
  );

  const togglePlay = useCallback(async () => {
    if (!mediaState) return;
    clearManualMediaStopped();
    const isBrowser = Boolean(mediaState?.is_browser || mediaState?.song?.is_browser);
    const sessionId = mediaState?.session_id || mediaState?.song?.session_id || '';
    const isPlaying = mediaState?.song?.isPlaying ?? false;
    const activeSessions = mediaState?.active_sessions || mediaState?.song?.active_sessions || [];

    const isDesktopSpotify = Boolean(
      mediaState?.song?.is_spotify ||
      mediaState?.song?.source_app?.toLowerCase().includes('spotify')
    );

    let isBrowserSpotify = false;
    if (isBrowser && isSpotifyUserConnected()) {
      isBrowserSpotify = await verifyIsBrowserSpotify(
        mediaState?.song?.title,
        mediaState?.song?.artist
      );
    }

    const isGenuineSpotify = isDesktopSpotify || isBrowserSpotify;

    // Auto-pause passive sessions whenever initiating playback (!isPlaying)
    if (!isPlaying) {
      const otherPlaying = activeSessions.filter(
        (s) => s.session_id !== sessionId && s.is_playing
      );
      for (const s of otherPlaying) {
        await controlMediaSession(s.session_id, 'pause').catch(() => {});
      }
    }

    // 1. Direct Spotify Web API priority (Bypasses Chrome/browser playback locks and tab hibernation)
    if (isGenuineSpotify && isSpotifyUserConnected()) {
      if (isPlaying) {
        const ok = await pauseSpotifyPlayback();
        if (!ok) {
          await executeNativePlaybackFallback('toggle', sessionId, mediaState.hasNativeMedia);
        }
        updateState((prev) => {
          const durationMs = Math.round((prev.song?.duration || 0) * 1000);
          const frozenClock = reconcilePlaybackClockSnapshot(prev.playbackClock, {
            incomingPositionMs: prev.playbackClock ? null : Math.round((prev.song?.currentTime || 0) * 1000),
            isPlaying: false,
            durationMs,
            forceSnap: true,
          });
          return {
            ...prev,
            playbackClock: frozenClock,
            song: {
              ...prev.song,
              isPlaying: false,
              currentTime: frozenClock.basePositionMs / 1000,
            },
          };
        });
        return;
      } else {
        markUserInitiatedPlayback();
        const lastPosMs =
          (mediaState?.playbackClock
            ? computeInterpolatedPositionMs(mediaState.playbackClock)
            : 0) ||
          getLastKnownPositionMs() ||
          Math.round((mediaState?.song?.currentTime ?? 0) * 1000);

        const trackUri = (mediaState.song as any)?.uri || normalizeTrackUri((mediaState.song as any)?.id);

        const ok = await resumeSpotifyPlayback({
          positionMs: lastPosMs > 0 ? lastPosMs : undefined,
          trackUri,
        });

        // Fallback to OS media keys / GSMTC if Web API did not respond or returned 403 (Free tier)
        if (!ok) {
          await executeNativePlaybackFallback('toggle', sessionId, mediaState.hasNativeMedia);
        }

        updateState((prev) => {
          const durationMs = Math.round((prev.song?.duration || 0) * 1000);
          const currentClockPosMs = prev.playbackClock
            ? computeInterpolatedPositionMs(prev.playbackClock)
            : Math.round((prev.song?.currentTime || 0) * 1000);
          const resumedClock = reconcilePlaybackClockSnapshot(prev.playbackClock, {
            incomingPositionMs: lastPosMs > 0 ? lastPosMs : currentClockPosMs,
            isPlaying: true,
            durationMs,
            forceSnap: true,
          });
          return {
            ...prev,
            playbackClock: resumedClock,
            song: {
              ...prev.song,
              isPlaying: true,
              currentTime: resumedClock.basePositionMs / 1000,
            },
          };
        });
        return;
      }
    }

    // 2. Generic Browser or non-Spotify session:
    // If initiating playback on a non-Spotify session, ensure Spotify Web is paused
    if (!isPlaying && isSpotifyUserConnected()) {
      await pauseSpotifyPlayback().catch(() => {});
    }

    if (isBrowser && sessionId) {
      const ok = await controlMediaSession(sessionId, 'toggle');
      if (!ok && mediaState.hasNativeMedia) {
        await mediaPlayPause();
      }
      updateState((prev) => {
        const durationMs = Math.round((prev.song?.duration || 0) * 1000);
        const currentPosMs = prev.playbackClock
          ? computeInterpolatedPositionMs(prev.playbackClock)
          : Math.round((prev.song?.currentTime || 0) * 1000);
        const toggledClock = reconcilePlaybackClockSnapshot(prev.playbackClock, {
          incomingPositionMs: currentPosMs,
          isPlaying: !isPlaying,
          durationMs,
          forceSnap: true,
        });
        return {
          ...prev,
          playbackClock: toggledClock,
          song: {
            ...prev.song,
            isPlaying: !isPlaying,
            currentTime: toggledClock.basePositionMs / 1000,
          },
        };
      });
      return;
    }

    // 3. Fallback to native GSMTC media keys
    await executeNativePlaybackFallback('toggle', sessionId, mediaState.hasNativeMedia);

    updateState((prev) => {
      const durationMs = Math.round((prev.song?.duration || 0) * 1000);
      const currentPosMs = prev.playbackClock
        ? computeInterpolatedPositionMs(prev.playbackClock)
        : Math.round((prev.song?.currentTime || 0) * 1000);
      const toggledClock = reconcilePlaybackClockSnapshot(prev.playbackClock, {
        incomingPositionMs: currentPosMs,
        isPlaying: !isPlaying,
        durationMs,
        forceSnap: true,
      });
      return {
        ...prev,
        playbackClock: toggledClock,
        song: {
          ...prev.song,
          isPlaying: !isPlaying,
          currentTime: toggledClock.basePositionMs / 1000,
        },
      };
    });
  }, [mediaState, updateState]);

  const nextTrack = useCallback(async () => {
    clearManualMediaStopped();
    // Explicit Song Switch: reset position cache, lock stale external polls, and clear play guard window
    markPlaybackManualSeekLock(850);
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    const nowMs = Date.now();
    updateState((prev) => {
      const preservedDuration = prev.song.duration > 0 ? prev.song.duration : 0;
      return {
        ...prev,
        playbackClock: {
          basePositionMs: 0,
          capturedAtMs: nowMs,
          isPlaying: prev.song.isPlaying,
          durationMs: Math.round(preservedDuration * 1000),
        },
        song: {
          ...prev.song,
          currentTime: 0,
          // Anti-Blank Scrubber Guard: Preserve last valid duration across track actions
          duration: preservedDuration,
        },
      };
    });

    const isBrowser = Boolean(mediaState?.is_browser || mediaState?.song?.is_browser);
    const sessionId = mediaState?.session_id || mediaState?.song?.session_id || '';
    const isDesktopSpotify = Boolean(
      mediaState?.song?.is_spotify ||
      mediaState?.song?.source_app?.toLowerCase().includes('spotify')
    );

    let isBrowserSpotify = false;
    if (isBrowser && isSpotifyUserConnected()) {
      isBrowserSpotify = await verifyIsBrowserSpotify(
        mediaState?.song?.title,
        mediaState?.song?.artist
      );
    }

    const isGenuineSpotify = isDesktopSpotify || isBrowserSpotify;

    // Prioritize direct Spotify Web API ONLY if current media is genuine Spotify
    if (isGenuineSpotify && isSpotifyUserConnected()) {
      const ok = await nextSpotifyTrack();
      if (ok) return;
    }

    await executeNativePlaybackFallback('next', sessionId, mediaState?.hasNativeMedia);
  }, [mediaState, updateState]);

  const prevTrack = useCallback(async () => {
    clearManualMediaStopped();
    const isBrowser = Boolean(mediaState?.is_browser || mediaState?.song?.is_browser);
    const sessionId = mediaState?.session_id || mediaState?.song?.session_id || '';
    const isDesktopSpotify = Boolean(
      mediaState?.song?.is_spotify ||
      mediaState?.song?.source_app?.toLowerCase().includes('spotify')
    );

    let isBrowserSpotify = false;
    if (isBrowser && isSpotifyUserConnected()) {
      isBrowserSpotify = await verifyIsBrowserSpotify(
        mediaState?.song?.title,
        mediaState?.song?.artist
      );
    }

    const isGenuineSpotify = isDesktopSpotify || isBrowserSpotify;
    const currentPosMs = mediaState?.playbackClock
      ? computeInterpolatedPositionMs(mediaState.playbackClock)
      : (mediaState?.song?.currentTime ?? 0) * 1000;

    // 1. Smart Dual-Action Previous: Jika lagu sudah berjalan > 3 detik (> 3000ms),
    // Ulangi lagu saat ini ke detik 0:00 secara riil di browser/pemutar (dengan fallback GSMTC/MediaPrev untuk Spotify Free)
    if (currentPosMs > 3000) {
      markPlaybackManualSeekLock(850);
      setLastKnownPositionMs(0);
      const nowMs = Date.now();
      updateState((prev) => {
        const preservedDuration = prev.song.duration > 0 ? prev.song.duration : 0;
        return {
          ...prev,
          playbackClock: {
            basePositionMs: 0,
            capturedAtMs: nowMs,
            isPlaying: prev.song.isPlaying,
            durationMs: Math.round(preservedDuration * 1000),
          },
          song: {
            ...prev.song,
            currentTime: 0,
            // Anti-Blank Scrubber Guard: Preserve last valid duration
            duration: preservedDuration,
          },
        };
      });

      if (isGenuineSpotify && isSpotifyUserConnected()) {
        const spotifySeekOk = await seekSpotifyPlayback(0);
        if (spotifySeekOk) return;
      }
      if (sessionId) {
        const gsmtcSeekOk = await seekMediaSession(sessionId, 0);
        if (gsmtcSeekOk) return;
      }
      await executeNativePlaybackFallback('prev', sessionId, mediaState?.hasNativeMedia);
      return;
    }

    // 2. Jika lagu masih di awal (<= 3 detik): Panggil track sebelumnya
    markPlaybackManualSeekLock(850);
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    const nowMs = Date.now();
    updateState((prev) => {
      const preservedDuration = prev.song.duration > 0 ? prev.song.duration : 0;
      return {
        ...prev,
        playbackClock: {
          basePositionMs: 0,
          capturedAtMs: nowMs,
          isPlaying: prev.song.isPlaying,
          durationMs: Math.round(preservedDuration * 1000),
        },
        song: {
          ...prev.song,
          currentTime: 0,
          // Anti-Blank Scrubber Guard: Preserve last valid duration
          duration: preservedDuration,
        },
      };
    });

    // Prioritize direct Spotify Web API ONLY if current media is genuine Spotify
    if (isGenuineSpotify && isSpotifyUserConnected()) {
      const ok = await prevSpotifyTrack();
      if (ok) return;
    }

    await executeNativePlaybackFallback('prev', sessionId, mediaState?.hasNativeMedia);
  }, [mediaState, updateState]);

  const toggleShuffle = useCallback(() => {
    updateState((prev) => ({ ...prev, isShuffle: !prev.isShuffle }));
  }, [updateState]);

  const setShuffle = useCallback((val: boolean) => {
    updateState((prev) => ({ ...prev, isShuffle: val }));
  }, [updateState]);

  const setSubPanel = useCallback((panel: MusicSubPanel) => {
    updateState((prev) => ({ ...prev, activeSubPanel: panel }));
    try {
      localStorage.setItem('casa_active_subpanel', panel);
    } catch {}
  }, [updateState]);

  const toggleAudioOutput = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      audioOutput: prev.audioOutput === 'headset' ? 'speaker' : 'headset',
    }));
  }, [updateState]);

  const setShowIdleLyrics = useCallback(
    (enabled: boolean) => {
      updateState((prev) => ({ ...prev, showIdleLyrics: enabled }));
      try {
        localStorage.setItem('casa_show_idle_lyrics', enabled ? 'true' : 'false');
      } catch {}
    },
    [updateState]
  );

  const toggleIdleLyrics = useCallback(() => {
    updateState((prev) => {
      const next = !prev.showIdleLyrics;
      try {
        localStorage.setItem('casa_show_idle_lyrics', next ? 'true' : 'false');
      } catch {}
      return { ...prev, showIdleLyrics: next };
    });
  }, [updateState]);

  const stopPlayback = useCallback(async () => {
    const sessionId = mediaState?.session_id || mediaState?.song?.session_id || '';
    const songTitle = mediaState?.song?.title || '';
    const activeSessions = mediaState?.active_sessions || mediaState?.song?.active_sessions || [];

    markManualMediaStopped(sessionId, songTitle);
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();

    // Pause Spotify Web API & all active playing GSMTC sessions so OS stops playing
    if (isSpotifyUserConnected()) {
      pauseSpotifyPlayback().catch(() => {});
    }
    for (const s of activeSessions) {
      if (s.is_playing) {
        controlMediaSession(s.session_id, 'pause').catch(() => {});
      }
    }
    if (sessionId) {
      controlMediaSession(sessionId, 'pause').catch(() => {});
    } else if (mediaState?.hasNativeMedia && mediaState?.song?.isPlaying) {
      mediaPlayPause().catch(() => {});
    }

    updateState((prev) => ({
      ...prev,
      playbackSource: 'companion',
      playbackClock: {
        basePositionMs: 0,
        capturedAtMs: Date.now(),
        isPlaying: false,
        durationMs: 0,
      },
      hasNativeMedia: false,
      is_browser: false,
      session_id: '',
      active_sessions: [],
      isNativePlaying: false,
      nativeTrack: null,
      lyricsData: { lines: [], isSynced: false, syncType: 'none', isInstrumental: false },
      song: {
        session_id: '',
        title: '',
        artist: '',
        albumArt: undefined,
        albumArtUrl: undefined,
        duration: 0,
        currentTime: 0,
        isPlaying: false,
        is_browser: false,
        is_spotify: false,
        source_app: '',
        active_sessions: [],
        lyrics: { prev: '', current: '', next: '' },
        queue: [],
      },
    }));
  }, [mediaState, updateState]);

  const updateLyrics = useCallback((result: LyricResult) => {
    const activeMedia = useSkillStore.getState().skillStates['core.media'] as MediaSkillState | undefined;
    if (activeMedia?.song) {
      const activeTitle =
        activeMedia.playbackSource === 'native' && activeMedia.nativeTrack
          ? activeMedia.nativeTrack.title
          : activeMedia.song.title;
      const activeArtist =
        activeMedia.playbackSource === 'native' && activeMedia.nativeTrack
          ? activeMedia.nativeTrack.artist
          : activeMedia.song.artist;
      setCachedLyrics(activeTitle || '', activeArtist || '', result);
    }

    updateState((prev) => {
      const leadOffsetSec = prev.playbackSource === 'native' ? 0 : LYRIC_COMPANION_LEAD_MS / 1000;
      const liveSec = prev.playbackClock
        ? computeInterpolatedPositionMs(prev.playbackClock) / 1000
        : prev.song.currentTime;
      const active =
        result.lines && result.lines.length > 0 && result.isSynced
          ? getActiveLyrics(result.lines, liveSec, leadOffsetSec, result.offsetSeconds || 0)
          : { prev: '', current: '', next: '' };

      return {
        ...prev,
        lyricsData: result,
        song: {
          ...prev.song,
          lyrics: {
            prev: active.prev,
            current: active.current || undefined,
            next: active.next,
          },
        },
      };
    });
  }, [updateState]);

  const commitManualSeekClock = useCallback((targetMs: number) => {
    const safeTargetMs = Math.max(0, Math.round(Number.isFinite(targetMs) ? targetMs : 0));
    markPlaybackManualSeekLock(850);
    setLastKnownPositionMs(safeTargetMs);
    const nowMs = Date.now();
    updateState((prev) => {
      const durationMs = Math.round((prev.song?.duration || 0) * 1000);
      const clampedMs = durationMs > 0 ? Math.min(durationMs, safeTargetMs) : safeTargetMs;
      return {
        ...prev,
        playbackClock: {
          basePositionMs: clampedMs,
          capturedAtMs: nowMs,
          isPlaying: prev.song?.isPlaying ?? false,
          durationMs,
        },
        song: {
          ...prev.song,
          currentTime: clampedMs / 1000,
        },
      };
    });
  }, [updateState]);

  return {
    mediaState,
    playbackClock: mediaState?.playbackClock,
    song: mediaState?.song,
    isPlaying: mediaState?.song?.isPlaying ?? false,
    hasNativeMedia: mediaState?.hasNativeMedia ?? false,
    isShuffle: mediaState?.isShuffle ?? false,
    activeSubPanel: mediaState?.activeSubPanel ?? 'none',
    audioOutput: mediaState?.audioOutput ?? 'headset',
    lyricsData: mediaState?.lyricsData,
    isSpotifyRunning: mediaState?.isSpotifyRunning ?? true,
    togglePlay,
    nextTrack,
    prevTrack,
    toggleShuffle,
    setShuffle,
    setSubPanel,
    toggleAudioOutput,
    updateLyrics,
    updateState,
    commitManualSeekClock,
    stopPlayback,
    showIdleLyrics: mediaState?.showIdleLyrics ?? false,
    setShowIdleLyrics,
    toggleIdleLyrics,
    ensurePlayerReady: ensureSpotifySessionReady,
    isQueueStale,
    sessionInitTimestamp: getSessionInitTimestamp(),
    queueHydrationTimestamp: getQueueHydrationTimestamp(),
    markSessionInit,
    markQueueHydrated,
  };
}
