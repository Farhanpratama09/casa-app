import { useCallback } from 'react';
import { useSkillStore } from '../../skills/store';
import { MediaSkillState, MusicSubPanel } from './types';
import {
  mediaPlayPause,
  mediaNextTrack,
  mediaPrevTrack,
  controlMediaSession,
  seekMediaSession,
} from '../../utils/tauriBridge';
import { getActiveLyrics, LyricResult } from '../../utils/lyricsService';
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
          if (sessionId) {
            await controlMediaSession(sessionId, 'toggle');
          } else {
            await mediaPlayPause();
          }
        }
        updateState((prev) => ({
          ...prev,
          song: { ...prev.song, isPlaying: false },
        }));
        return;
      } else {
        markUserInitiatedPlayback();
        const lastPosMs =
          getLastKnownPositionMs() ||
          Math.round((mediaState?.song?.currentTime ?? 0) * 1000);

        const trackUri = (mediaState.song as any)?.uri || normalizeTrackUri((mediaState.song as any)?.id);

        const ok = await resumeSpotifyPlayback({
          positionMs: lastPosMs > 0 ? lastPosMs : undefined,
          trackUri,
        });

        // Fallback to OS media keys / GSMTC if Web API did not respond or lacked active device
        if (!ok) {
          if (sessionId) {
            await controlMediaSession(sessionId, 'toggle');
          } else {
            await mediaPlayPause();
          }
        }

        updateState((prev) => ({
          ...prev,
          song: { ...prev.song, isPlaying: true },
        }));
        return;
      }
    }

    // 2. Generic Browser or non-Spotify session:
    // If initiating playback on a non-Spotify session, ensure Spotify Web is paused
    if (!isPlaying && isSpotifyUserConnected()) {
      await pauseSpotifyPlayback().catch(() => {});
    }

    if (isBrowser && sessionId) {
      await controlMediaSession(sessionId, 'toggle');
      updateState((prev) => ({
        ...prev,
        song: { ...prev.song, isPlaying: !isPlaying },
      }));
      return;
    }

    // 3. Fallback to native GSMTC media keys
    if (mediaState.hasNativeMedia) {
      await mediaPlayPause();
    }

    updateState((prev) => ({
      ...prev,
      song: { ...prev.song, isPlaying: !isPlaying },
    }));
  }, [mediaState, updateState]);

  const nextTrack = useCallback(async () => {
    // Explicit Song Switch: reset position cache and clear play guard window
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    updateState((prev) => ({
      ...prev,
      song: {
        ...prev.song,
        currentTime: 0,
        // Anti-Blank Scrubber Guard: Preserve last valid duration across track actions
        duration: prev.song.duration > 0 ? prev.song.duration : 0,
      },
    }));

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

    if (sessionId) {
      await controlMediaSession(sessionId, 'next');
    } else if (mediaState?.hasNativeMedia) {
      await mediaNextTrack();
    }
  }, [mediaState, updateState]);

  const prevTrack = useCallback(async () => {
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
    const currentPosMs = (mediaState?.song?.currentTime ?? 0) * 1000;

    // 1. Smart Dual-Action Previous: Jika lagu sudah berjalan > 3 detik (> 3000ms),
    // Ulangi lagu saat ini ke detik 0:00 secara riil di browser/pemutar
    if (currentPosMs > 3000) {
      setLastKnownPositionMs(0);
      updateState((prev) => ({
        ...prev,
        song: {
          ...prev.song,
          currentTime: 0,
          // Anti-Blank Scrubber Guard: Preserve last valid duration
          duration: prev.song.duration > 0 ? prev.song.duration : 0,
        },
      }));

      if (isGenuineSpotify && isSpotifyUserConnected()) {
        await seekSpotifyPlayback(0);
      } else if (sessionId) {
        await seekMediaSession(sessionId, 0);
      }
      return;
    }

    // 2. Jika lagu masih di awal (<= 3 detik): Panggil track sebelumnya
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    updateState((prev) => ({
      ...prev,
      song: {
        ...prev.song,
        currentTime: 0,
        // Anti-Blank Scrubber Guard: Preserve last valid duration
        duration: prev.song.duration > 0 ? prev.song.duration : 0,
      },
    }));

    // Prioritize direct Spotify Web API ONLY if current media is genuine Spotify
    if (isGenuineSpotify && isSpotifyUserConnected()) {
      const ok = await prevSpotifyTrack();
      if (ok) return;
    }

    if (sessionId) {
      await controlMediaSession(sessionId, 'prev');
    } else if (mediaState?.hasNativeMedia) {
      await mediaPrevTrack();
    }
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

  const updateLyrics = useCallback((result: LyricResult) => {
    updateState((prev) => {
      const active =
        result.lines && result.lines.length > 0 && result.isSynced
          ? getActiveLyrics(result.lines, prev.song.currentTime, 0.35, result.offsetSeconds || 0)
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

  return {
    mediaState,
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
    ensurePlayerReady: ensureSpotifySessionReady,
    isQueueStale,
    sessionInitTimestamp: getSessionInitTimestamp(),
    queueHydrationTimestamp: getQueueHydrationTimestamp(),
    markSessionInit,
    markQueueHydrated,
  };
}
