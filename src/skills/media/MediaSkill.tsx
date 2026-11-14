import React from 'react';
import { Music } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { CasaSkill, SkillPriorityTier } from '../types';
import { SongMetadata, AudioOutputDevice, MediaSessionItem } from '../../types/island';
import { MusicCardView, MusicSubPanel } from '../../components/views/MusicCardView';
import {
  buildGlobalLyricsCacheKey,
  fetchLyrics,
  getCachedLyrics,
  LyricResult,
  setCachedLyrics,
} from '../../utils/lyricsService';
import { MediaExpandedView } from '../../features/media/MediaExpandedView';
import { MediaPillSlot } from '../../features/media/MediaPillSlot';
import {
  mediaPlayPause,
  mediaNextTrack,
  mediaPrevTrack,
  controlMediaSession,
  seekMediaSession,
  getCurrentMedia,
  NativeMediaPayload,
  isSpotifyRunning,
  getLastManualTargetSessionId,
  clearLastManualTargetSessionId,
  shouldSuppressStoppedMediaUpdate,
} from '../../utils/tauriBridge';
import {
  markSessionInit,
  getCurrentlyPlayingTrackDetails,
  getSpotifyPlaybackSnapshot,
  setLastKnownPositionMs,
  setLastPlayedTrackUri,
  clearPlayGuardWindow,
  isSpotifyUserConnected,
  nextSpotifyTrack,
  prevSpotifyTrack,
  seekSpotifyPlayback,
  verifyIsBrowserSpotify,
} from '../../utils/spotifyService';
import {
  PlaybackClockSnapshot,
  computeInterpolatedPositionMs,
  reconcilePlaybackClockSnapshot,
  isPlaybackSeekLocked,
} from '../../features/media/playbackClock';

import type { NativeTrack } from '../../services/nativeAudioService';

export interface MediaSkillState {
  song: SongMetadata;
  playbackClock?: PlaybackClockSnapshot;
  hasNativeMedia: boolean;
  isShuffle: boolean;
  activeSubPanel: MusicSubPanel;
  audioOutput: AudioOutputDevice;
  lyricsData: LyricResult;
  isSpotifyRunning: boolean;
  is_browser?: boolean;
  session_id?: string;
  active_sessions?: MediaSessionItem[];
  playbackSource?: 'companion' | 'native';
  nativeTrack?: NativeTrack | null;
  isNativePlaying?: boolean;
  showIdleLyrics?: boolean;
}

const interpolateClockTick = (prev: MediaSkillState): MediaSkillState => {
  if (!prev.song.isPlaying && !prev.playbackClock?.isPlaying) return prev;
  const nowMs = Date.now();
  const clock: PlaybackClockSnapshot = prev.playbackClock || {
    basePositionMs: Math.max(0, (prev.song.currentTime || 0) * 1000),
    capturedAtMs: nowMs,
    isPlaying: prev.song.isPlaying,
    durationMs: prev.song.duration > 0 ? Math.round(prev.song.duration * 1000) : 0,
  };
  const nextMs = computeInterpolatedPositionMs(clock, nowMs);
  const nextSec = nextMs / 1000;
  if (Math.abs(nextSec - prev.song.currentTime) < 0.04) {
    return prev;
  }

  return {
    ...prev,
    playbackClock: clock,
    song: {
      ...prev.song,
      currentTime: nextSec,
    },
  };
};

export const isValidTrackMetadata = (title?: string, _artist?: string): boolean => {
  if (!title) return false;
  const t = title.trim();
  const lower = t.toLowerCase();
  if (
    !t ||
    t === 'No Media Playing' ||
    t === 'No Media Active' ||
    lower === 'spotify' ||
    lower === 'spotify free' ||
    lower === 'spotify premium' ||
    lower === 'casa player' ||
    lower === 'casa native player' ||
    lower === 'advertisement' ||
    lower === 'sponsored'
  ) {
    return false;
  }
  // Allow title-based lookup even when GSMTC artist is empty or a browser/channel placeholder
  return t.length >= 2;
};

const getInitialSubPanel = (): MusicSubPanel => {
  return 'none';
};

const getInitialShowIdleLyrics = (): boolean => {
  try {
    return localStorage.getItem('casa_show_idle_lyrics') === 'true';
  } catch {
    return false;
  }
};

export const mediaSkill: CasaSkill<MediaSkillState> = {
  manifest: {
    id: 'core.media',
    name: 'Music & Spotify',
    version: '1.0.0',
    description: 'Windows GSMTC and Spotify Desktop integration with dynamic lyrics & queue',
    icon: Music,
    category: 'media',
  },

  dimensions: {
    expanded: {
      width: 700,
      height: 162,
    },
  },

  initialState: {
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
      lyrics: {
        prev: '',
        current: '',
        next: '',
      },
      queue: [],
    },
    playbackClock: {
      basePositionMs: 0,
      capturedAtMs: Date.now(),
      isPlaying: false,
      durationMs: 0,
    },
    hasNativeMedia: false,
    isShuffle: false,
    activeSubPanel: getInitialSubPanel(),
    audioOutput: 'headset',
    lyricsData: {
      lines: [],
      isSynced: false,
      syncType: 'none',
      isInstrumental: false,
    },
    isSpotifyRunning: true,
    is_browser: false,
    session_id: '',
    active_sessions: [],
    playbackSource: 'companion',
    nativeTrack: null,
    isNativePlaying: false,
    showIdleLyrics: getInitialShowIdleLyrics(),
  },

  getPriority: (state: MediaSkillState): SkillPriorityTier => {
    if (state.playbackSource === 'native') {
      return state.isNativePlaying && state.nativeTrack ? 'ambient' : 'idle';
    }
    if (state.song.isPlaying && state.song.title && state.song.title.trim() !== '') {
      return 'ambient';
    }
    return 'idle';
  },

  onMount: (getState, setState) => {
    let isMounted = true;
    const lastSourceAppRef = { current: '' };
    const lastNativePositionRef = { current: -1 };
    const lastFetchedLyricsKeyRef = { current: '' };
    const lyricsAbortControllerRef = { current: null as AbortController | null };
    let unlistenMediaUpdate: (() => void) | undefined;
    let unlistenMediaClosed: (() => void) | undefined;
    let unlistenSpotifyClosed: (() => void) | undefined;
    let unlistenSpotifyOpened: (() => void) | undefined;

    // 1. Polling Spotify process status to detect hard closures
    const checkSpotifyProcess = async () => {
      try {
        const running = await isSpotifyRunning();
        if (!isMounted) return;
        setState((prev) => {
          const forcePaused =
            !running && !prev.is_browser && !prev.song.is_browser && prev.song.isPlaying;
          if (!forcePaused && prev.isSpotifyRunning === running) return prev;
          const nowMs = Date.now();
          const frozenClock = forcePaused
            ? reconcilePlaybackClockSnapshot(prev.playbackClock, {
                incomingPositionMs: null,
                isPlaying: false,
                durationMs:
                  prev.playbackClock?.durationMs ||
                  (prev.song.duration > 0 ? Math.round(prev.song.duration * 1000) : 0),
                nowMs,
              })
            : prev.playbackClock;
          return {
            ...prev,
            isSpotifyRunning: running,
            playbackClock: frozenClock,
            song: forcePaused ? { ...prev.song, isPlaying: false } : prev.song,
          };
        });
      } catch (err) {
        console.debug('[MediaSkill] checkSpotify error:', err);
      }
    };
    checkSpotifyProcess();
    const spotifyInterval = setInterval(checkSpotifyProcess, 2000);

    // Background authoritative Spotify Web API clock sync (active both in Idle and Mode 6)
    const syncSpotifyClockSnapshot = async () => {
      if (!isMounted || isPlaybackSeekLocked() || !isSpotifyUserConnected()) return;
      const current = getState();
      if (
        !current ||
        current.playbackSource === 'native' ||
        !current.hasNativeMedia ||
        !current.song?.is_spotify
      ) {
        return;
      }

      const snap = await getSpotifyPlaybackSnapshot();
      if (!isMounted || !snap || isPlaybackSeekLocked()) return;

      setState((s) => {
        if (s.playbackSource === 'native' || !s.hasNativeMedia || !s.song.is_spotify) return s;

        if (snap.title && s.song.title) {
          const expected = s.song.title.trim().toLowerCase();
          const incoming = snap.title.trim().toLowerCase();
          const titleMatches =
            expected === incoming ||
            (expected.length > 2 && incoming.includes(expected)) ||
            (incoming.length > 2 && expected.includes(incoming));
          if (!titleMatches) return s;
        }

        const resolvedDurMs =
          snap.durationMs > 0
            ? snap.durationMs
            : s.song.duration > 0
            ? Math.round(s.song.duration * 1000)
            : s.playbackClock?.durationMs || 0;
        const nowMs = Date.now();
        const prevClock: PlaybackClockSnapshot = s.playbackClock || {
          basePositionMs: Math.max(0, (s.song.currentTime || 0) * 1000),
          capturedAtMs: nowMs,
          isPlaying: s.song.isPlaying,
          durationMs: resolvedDurMs,
        };

        const localMsAtCapture = computeInterpolatedPositionMs(prevClock, snap.capturedAtMs);
        const deltaMs = Math.abs(snap.progressMs - localMsAtCapture);
        const shouldSnapOrCalibrate = deltaMs > 1500 || deltaMs > 250;

        if (!shouldSnapOrCalibrate && resolvedDurMs === prevClock.durationMs) {
          return s;
        }

        const nextClock = reconcilePlaybackClockSnapshot(prevClock, {
          incomingPositionMs: snap.progressMs,
          isPlaying: s.song.isPlaying,
          durationMs: resolvedDurMs,
          nowMs: snap.capturedAtMs,
          isPositionFresh: true,
          calibrateMinorDrift: true,
        });
        const interpolatedSec = computeInterpolatedPositionMs(nextClock, nowMs) / 1000;
        const durationSec = resolvedDurMs > 0 ? Math.round(resolvedDurMs / 1000) : s.song.duration;

        return {
          ...s,
          playbackClock: nextClock,
          song: {
            ...s.song,
            duration: durationSec,
            currentTime: interpolatedSec,
          },
        };
      });
    };

    const spotifyClockSyncInterval = setInterval(() => {
      const current = getState();
      if (
        current?.playbackSource !== 'native' &&
        current?.hasNativeMedia &&
        current?.song?.is_spotify &&
        current?.song?.isPlaying
      ) {
        void syncSpotifyClockSnapshot();
      }
    }, 1800);

    // Lightweight 250ms deterministic interpolation ticker: computes elapsed from timestamp anchor with zero drift
    const playbackTickerInterval = setInterval(() => {
      if (!isMounted) return;
      const current = getState();
      if (
        current?.playbackSource === 'native' ||
        !current?.song?.isPlaying ||
        !current?.hasNativeMedia ||
        !isValidTrackMetadata(current?.song?.title, current?.song?.artist)
      ) {
        return;
      }
      setState(interpolateClockTick);
      if (current.playbackClock) {
        setLastKnownPositionMs(computeInterpolatedPositionMs(current.playbackClock, Date.now()));
      }
    }, 250);

    // 2. Initial Media Session Query
    getCurrentMedia()
      .then((initial) => {
        if (!isMounted || !initial || !initial.title || (initial.is_browser && !initial.is_playing)) return;

        let cleanTitle = initial.title.trim();
        if (initial.is_browser) {
          cleanTitle = cleanTitle.replace(/\s*-\s*YouTube(?:\s+Music)?$/i, '').trim();
        }
        if (initial.source_app) {
          lastSourceAppRef.current = initial.source_app;
        }
        lastNativePositionRef.current = initial.position;
        const initialPosMs =
          typeof initial.position === 'number' && initial.position > 0
            ? Math.round(initial.position * 1000)
            : 0;
        if (initialPosMs > 0) {
          setLastKnownPositionMs(initialPosMs);
        }
        if ((initial as any).uri || (initial as any).track_id) {
          setLastPlayedTrackUri((initial as any).uri || (initial as any).track_id);
        }

        const initialDurMs = initial.duration > 0 ? Math.round(initial.duration * 1000) : 0;
        const initNowMs = Date.now();
        setState((prev) => ({
          ...prev,
          hasNativeMedia: true,
          is_browser: Boolean(initial.is_browser),
          session_id: initial.session_id || '',
          active_sessions: initial.active_sessions || [],
          activeSubPanel: prev.activeSubPanel,
          playbackClock: {
            basePositionMs: initialPosMs,
            capturedAtMs: initNowMs,
            isPlaying: initial.is_playing,
            durationMs: initialDurMs,
          },
          song: {
            ...prev.song,
            session_id: initial.session_id || '',
            title: cleanTitle,
            artist: initial.artist || 'Unknown Artist',
            isPlaying: initial.is_playing,
            is_browser: Boolean(initial.is_browser),
            is_spotify: Boolean(initial.is_spotify),
            source_app: initial.source_app || '',
            active_sessions: initial.active_sessions || [],
            duration: initial.duration > 0 ? Math.round(initial.duration) : 0,
            currentTime: initialPosMs / 1000,
            albumArtUrl: initial.album_art || undefined,
            albumArt: initial.album_art || undefined,
          },
        }));

        if (initial.is_spotify && isSpotifyUserConnected()) {
          void syncSpotifyClockSnapshot();
        }

        // Cold-start guard: Only query lyrics once valid non-generic track metadata is present
        if (isValidTrackMetadata(cleanTitle, initial.artist)) {
          const initLyricsKey = buildGlobalLyricsCacheKey(cleanTitle, initial.artist);
          const cachedInitLyrics = getCachedLyrics(cleanTitle, initial.artist);
          if (cachedInitLyrics) {
            lastFetchedLyricsKeyRef.current = initLyricsKey;
            setState((prev) => ({ ...prev, lyricsData: cachedInitLyrics }));
          } else {
            lastFetchedLyricsKeyRef.current = initLyricsKey;
            fetchLyrics(cleanTitle, initial.artist, initial.duration)
              .then((lyrics) => {
                setCachedLyrics(cleanTitle, initial.artist, lyrics);
                if (!isMounted) return;
                setState((prev) => {
                  const activeKey = buildGlobalLyricsCacheKey(prev.song.title, prev.song.artist);
                  if (prev.playbackSource === 'native' || (activeKey && initLyricsKey && activeKey !== initLyricsKey)) {
                    return prev;
                  }
                  return { ...prev, lyricsData: lyrics };
                });
              })
              .catch(() => {});
          }
        }

        // Presisi Durasi Spotify Web API saat inisialisasi awal
        if (!initial.is_browser && initial.is_spotify) {
          getCurrentlyPlayingTrackDetails()
            .then((details) => {
              if (!isMounted || !details || !details.durationMs) return;
              const durationSec = Math.round(details.durationMs / 1000);
              if (durationSec > 0) {
                setState((prev) => {
                  const currentTitle = prev.song.title.toLowerCase().trim();
                  const detailsTitle = details.title.toLowerCase().trim();
                  if (
                    currentTitle === detailsTitle ||
                    (currentTitle.length > 2 && detailsTitle.includes(currentTitle)) ||
                    (detailsTitle.length > 2 && currentTitle.includes(detailsTitle))
                  ) {
                    return {
                      ...prev,
                      song: {
                        ...prev.song,
                        duration: durationSec,
                      },
                    };
                  }
                  return prev;
                });
              }
            })
            .catch(() => {});
        }
      })
      .catch((err) => console.debug('[MediaSkill] getCurrentMedia initial:', err));

    // 3. Attach Tauri Event Listeners
    const setupListeners = async () => {
      try {
        unlistenMediaUpdate = await listen<NativeMediaPayload>('media-update', (event) => {
          if (!isMounted) return;
          const payload = event.payload;
          if (!payload) return;

          // Tangani payload kosong
          if (!payload.title || payload.title.trim() === '') {
            lyricsAbortControllerRef.current?.abort();
            lastNativePositionRef.current = -1;
            setState((prev) => ({
              ...prev,
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
              lyricsData:
                prev.playbackSource === 'native'
                  ? prev.lyricsData
                  : { lines: [], isSynced: false, syncType: 'none', isInstrumental: false },
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
            return;
          }

          // Sanitasi & Filter Browser
          if (payload.is_browser && !payload.is_playing) {
            // Tab browser yang tidak sedang aktif memutar audio DILARANG memicu mode musik
            return;
          }

          let cleanTitle = payload.title.trim();
          if (payload.is_browser) {
            const isAd = /advertisement|sponsored|^iklan\b/i.test(cleanTitle);
            if (isAd) {
              // Abaikan update iklan browser sepenuhnya agar tidak merusak UI & cache
              return;
            }
            // Bersihkan akhiran tab YouTube dan YouTube Music
            cleanTitle = cleanTitle.replace(/\s*-\s*YouTube(?:\s+Music)?$/i, '').trim();
          }

          // Guard pasca-Stop manual: Abaikan echo GSMTC status paused dari lagu yang baru saja di-Stop user
          if (shouldSuppressStoppedMediaUpdate(payload.session_id, cleanTitle, payload.is_playing)) {
            return;
          }

          // Deteksi Pergantian Sumber Aplikasi
          const currentSource = payload.source_app || '';
          const isSourceSwitched = Boolean(
            lastSourceAppRef.current &&
            currentSource &&
            lastSourceAppRef.current !== currentSource
          );
          lastSourceAppRef.current = currentSource;

          // Evaluasi perubahan posisi native dari GSMTC (Anti Rubber-Banding / Frozen GSMTC Guard)
          const nativePosChanged =
            lastNativePositionRef.current < 0 ||
            Math.abs(payload.position - lastNativePositionRef.current) > 0.25;
          lastNativePositionRef.current = payload.position;
          if (nativePosChanged && typeof payload.position === 'number' && payload.position > 0 && !isPlaybackSeekLocked()) {
            setLastKnownPositionMs(payload.position * 1000);
          }

          const prev = getState();
          const incomingSessions = payload.active_sessions || [];

          // State Hierarchy (Active Playback Precedence + Session Stickiness):
          if (
            prev?.session_id &&
            payload.session_id &&
            prev.session_id !== payload.session_id
          ) {
            const stickyStillAlive = incomingSessions.find(
              (s) => s.session_id === prev.session_id
            );
            const manualTargetId = getLastManualTargetSessionId();
            const isIncomingTakingOverPlayback =
              payload.is_playing && (!stickyStillAlive || !stickyStillAlive.is_playing);

            if (
              stickyStillAlive &&
              manualTargetId !== payload.session_id &&
              !isIncomingTakingOverPlayback
            ) {
              lastSourceAppRef.current = prev.song.source_app || currentSource;
              setState((s) => {
                const nowMs = Date.now();
                const stickyClock = reconcilePlaybackClockSnapshot(s.playbackClock, {
                  incomingPositionMs: null,
                  isPlaying: stickyStillAlive.is_playing,
                  durationMs:
                    s.playbackClock?.durationMs ||
                    (s.song.duration > 0 ? Math.round(s.song.duration * 1000) : 0),
                  nowMs,
                });
                return {
                  ...s,
                  active_sessions: incomingSessions,
                  playbackClock: stickyClock,
                  song: {
                    ...s.song,
                    isPlaying: stickyStillAlive.is_playing,
                    currentTime: computeInterpolatedPositionMs(stickyClock, nowMs) / 1000,
                    active_sessions: incomingSessions,
                  },
                };
              });
              return;
            }

            if (manualTargetId && manualTargetId === payload.session_id) {
              clearLastManualTargetSessionId();
            }
          }

          const isSessionSwitched = Boolean(
            prev?.session_id &&
            payload.session_id &&
            prev.session_id !== payload.session_id
          );
          const trackChanged = Boolean(
            isSourceSwitched ||
            isSessionSwitched ||
            prev?.song.title !== cleanTitle ||
            prev?.song.artist !== payload.artist
          );

          const isNativeMode = prev?.playbackSource === 'native';
          const lyricsTrackKey = buildGlobalLyricsCacheKey(cleanTitle, payload.artist);
          const validLyricsMeta = isValidTrackMetadata(cleanTitle, payload.artist);
          const cachedLyrics =
            !isNativeMode && validLyricsMeta
              ? getCachedLyrics(cleanTitle, payload.artist)
              : null;

          if (trackChanged && cleanTitle && !isNativeMode) {
            setLastKnownPositionMs(0);
            clearPlayGuardWindow();
            if ((payload as any).uri || (payload as any).track_id) {
              setLastPlayedTrackUri((payload as any).uri || (payload as any).track_id);
            }

            if (payload.is_spotify && isSpotifyUserConnected()) {
              setTimeout(() => {
                if (isMounted) void syncSpotifyClockSnapshot();
              }, 350);
            }

            // Presisi Durasi Spotify Web API: sinkronkan duration_ms jika tersedia
            if (!payload.is_browser && payload.is_spotify) {
              getCurrentlyPlayingTrackDetails()
                .then((details) => {
                  if (!isMounted || !details || !details.durationMs) return;
                  const durationSec = Math.round(details.durationMs / 1000);
                  if (durationSec > 0) {
                    setState((s) => {
                      const currentTitle = s.song.title.toLowerCase().trim();
                      const detailsTitle = details.title.toLowerCase().trim();
                      if (
                        currentTitle === detailsTitle ||
                        (currentTitle.length > 2 && detailsTitle.includes(currentTitle)) ||
                        (detailsTitle.length > 2 && currentTitle.includes(detailsTitle))
                      ) {
                        const nowMs = Date.now();
                        const nextDurMs = Math.round(details.durationMs);
                        const updatedClock = reconcilePlaybackClockSnapshot(s.playbackClock, {
                          incomingPositionMs: null,
                          isPlaying: s.song.isPlaying,
                          durationMs: nextDurMs,
                          nowMs,
                        });
                        return {
                          ...s,
                          playbackClock: updatedClock,
                          song: {
                            ...s.song,
                            duration: durationSec,
                            currentTime: computeInterpolatedPositionMs(updatedClock, nowMs) / 1000,
                          },
                        };
                      }
                      return s;
                    });
                  }
                })
                .catch(() => {});
            }
          }

          setState((s) => {
            const sNative = s.playbackSource === 'native';
            const nowMs = Date.now();

            // Presisi Durasi Spotify & Anti-Blank Scrubber Guard:
            const incomingDurationSec =
              typeof payload.duration === 'number' && !isNaN(payload.duration) && payload.duration > 0
                ? Math.round(payload.duration)
                : 0;

            const resolvedDuration =
              incomingDurationSec > 0
                ? incomingDurationSec
                : trackChanged
                ? 0
                : s.song.duration > 0
                ? s.song.duration
                : 0;

            const prevDurMs = resolvedDuration > 0 ? Math.round(resolvedDuration * 1000) : 0;
            const prevLocalMs = computeInterpolatedPositionMs(s.playbackClock, nowMs);
            const isBrowserStaleZero = Boolean(
              !trackChanged && payload.is_browser && payload.position === 0 && prevLocalMs > 2000
            );
            const incomingPosMs =
              isPlaybackSeekLocked() || isBrowserStaleZero
                ? null
                : typeof payload.position === 'number' && !isNaN(payload.position) && payload.position >= 0
                ? Math.round(payload.position * 1000)
                : null;

            const nextClock = reconcilePlaybackClockSnapshot(s.playbackClock, {
              incomingPositionMs: incomingPosMs,
              isPlaying: payload.is_playing,
              durationMs: prevDurMs,
              nowMs,
              forceSnap: trackChanged && !isPlaybackSeekLocked(),
              isPositionFresh: Boolean(trackChanged || (nativePosChanged && !isBrowserStaleZero)),
              calibrateMinorDrift: Boolean(!payload.is_browser && nativePosChanged),
            });

            const syncedCurrentTime = computeInterpolatedPositionMs(nextClock, nowMs) / 1000;

            const nextLyricsData = sNative
              ? s.lyricsData
              : trackChanged || isSourceSwitched || isSessionSwitched
              ? cachedLyrics || { lines: [], isSynced: false, syncType: 'none', isInstrumental: false }
              : cachedLyrics && s.lyricsData.lines.length === 0 && !s.lyricsData.isInstrumental
              ? cachedLyrics
              : s.lyricsData;

            return {
              ...s,
              hasNativeMedia: true,
              is_browser: Boolean(payload.is_browser),
              session_id: payload.session_id || s.session_id || '',
              active_sessions: incomingSessions,
              activeSubPanel: s.activeSubPanel,
              playbackClock: nextClock,
              lyricsData: nextLyricsData,
              isShuffle:
                typeof payload.is_shuffle === 'boolean' ? payload.is_shuffle : s.isShuffle,
              song: {
                ...s.song,
                session_id: payload.session_id || s.song.session_id || '',
                title: cleanTitle || (trackChanged ? '' : s.song.title),
                artist: trackChanged ? (payload.artist || '') : (payload.artist || s.song.artist),
                isPlaying: payload.is_playing,
                is_browser: Boolean(payload.is_browser),
                is_spotify: Boolean(payload.is_spotify),
                source_app: payload.source_app || '',
                active_sessions: incomingSessions,
                duration: resolvedDuration,
                currentTime: syncedCurrentTime,
                albumArtUrl: trackChanged
                  ? payload.album_art || undefined
                  : payload.album_art || s.song.albumArtUrl,
                albumArt: trackChanged
                  ? payload.album_art || undefined
                  : payload.album_art || s.song.albumArt,
                lyrics: trackChanged && !cachedLyrics ? { prev: '', current: '', next: '' } : s.song.lyrics,
              },
            };
          });

          const needsLyricsFetch =
            !isNativeMode &&
            validLyricsMeta &&
            !cachedLyrics &&
            (trackChanged ||
              (lyricsTrackKey !== lastFetchedLyricsKeyRef.current &&
                prev.lyricsData.lines.length === 0 &&
                !prev.lyricsData.isInstrumental));

          if (needsLyricsFetch) {
            lyricsAbortControllerRef.current?.abort();
            const controller = new AbortController();
            lyricsAbortControllerRef.current = controller;
            lastFetchedLyricsKeyRef.current = lyricsTrackKey;

            fetchLyrics(cleanTitle, payload.artist || '', payload.duration, {
              signal: controller.signal,
              allowTitleOnlyFallback: Boolean(payload.is_browser),
            })
              .then((lyrics) => {
                if (lyrics.lines.length > 0) {
                  setCachedLyrics(cleanTitle, payload.artist || '', lyrics);
                }
                if (!isMounted || controller.signal.aborted) return;
                if (lyrics.lines.length === 0 && !lyrics.isInstrumental && lastFetchedLyricsKeyRef.current === lyricsTrackKey) {
                  lastFetchedLyricsKeyRef.current = '';
                }
                setState((s) => {
                  const activeKey = buildGlobalLyricsCacheKey(s.song.title, s.song.artist);
                  if (s.playbackSource === 'native' || (activeKey && lyricsTrackKey && activeKey !== lyricsTrackKey)) {
                    return s;
                  }
                  return { ...s, lyricsData: lyrics };
                });
              })
              .catch(() => {
                if (lastFetchedLyricsKeyRef.current === lyricsTrackKey) {
                  lastFetchedLyricsKeyRef.current = '';
                }
              });
          } else if (cachedLyrics) {
            lastFetchedLyricsKeyRef.current = lyricsTrackKey;
          }
        });
      } catch (e) {
        console.debug('[MediaSkill] listen media-update:', e);
      }

      try {
        unlistenMediaClosed = await listen('media-session-closed', () => {
          if (!isMounted) return;
          lyricsAbortControllerRef.current?.abort();
          lastNativePositionRef.current = -1;
          setState((prev) => ({
            ...prev,
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
            lyricsData:
              prev.playbackSource === 'native'
                ? prev.lyricsData
                : { lines: [], isSynced: false, syncType: 'none', isInstrumental: false },
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
        });
      } catch (e) {
        console.debug('[MediaSkill] listen media-session-closed:', e);
      }

      try {
        unlistenSpotifyClosed = await listen('spotify-closed', () => {
          if (!isMounted) return;
          setState((prev) => {
            if (prev.is_browser || prev.song.is_browser) {
              return { ...prev, isSpotifyRunning: false };
            }
            lyricsAbortControllerRef.current?.abort();
            return {
              ...prev,
              isSpotifyRunning: false,
              hasNativeMedia: false,
              playbackClock: reconcilePlaybackClockSnapshot(prev.playbackClock, {
                incomingPositionMs: null,
                isPlaying: false,
                durationMs: Math.round((prev.song.duration || 0) * 1000),
                forceSnap: true,
              }),
              song: { ...prev.song, isPlaying: false },
            };
          });
        });
        unlistenSpotifyOpened = await listen<{ running: boolean; timestamp?: number }>('spotify-opened', (event) => {
          if (!isMounted) return;
          const ts = event.payload?.timestamp || Date.now();
          markSessionInit(ts);
          setState((prev) => ({ ...prev, isSpotifyRunning: true }));
        });
      } catch (e) {
        console.debug('[MediaSkill] listen spotify events:', e);
      }
    };

    setupListeners();

    return () => {
      isMounted = false;
      lyricsAbortControllerRef.current?.abort();
      clearInterval(spotifyInterval);
      clearInterval(spotifyClockSyncInterval);
      clearInterval(playbackTickerInterval);
      if (unlistenMediaUpdate) unlistenMediaUpdate();
      if (unlistenMediaClosed) unlistenMediaClosed();
      if (unlistenSpotifyClosed) unlistenSpotifyClosed();
      if (unlistenSpotifyOpened) unlistenSpotifyOpened();
    };
  },

  slots: {
    ExpandedCard: ({ state, onCollapse, onUpdateState }) => {
      const currentSessionId = state.session_id || state.song.session_id || '';
      const isBrowser = Boolean(state.is_browser || state.song?.is_browser);
      const isDesktopSpotify = Boolean(
        state.song?.is_spotify || state.song?.source_app?.toLowerCase().includes('spotify')
      );

      const resolveIsGenuineSpotify = async (): Promise<boolean> => {
        if (isDesktopSpotify) return true;
        if (isBrowser && isSpotifyUserConnected()) {
          return verifyIsBrowserSpotify(state.song?.title, state.song?.artist);
        }
        return false;
      };

      const handleNext = async () => {
        if ((await resolveIsGenuineSpotify()) && isSpotifyUserConnected()) {
          const ok = await nextSpotifyTrack();
          if (ok) return;
        }
        if (currentSessionId) {
          const ok = await controlMediaSession(currentSessionId, 'next');
          if (ok) return;
        }
        await mediaNextTrack();
      };

      const handlePrevious = async () => {
        const posMs = (state.song?.currentTime ?? 0) * 1000;
        if (posMs > 3000) {
          if ((await resolveIsGenuineSpotify()) && isSpotifyUserConnected()) {
            const ok = await seekSpotifyPlayback(0);
            if (ok) return;
          }
          if (currentSessionId) {
            const seekOk = await seekMediaSession(currentSessionId, 0);
            if (seekOk) return;
            const prevOk = await controlMediaSession(currentSessionId, 'prev');
            if (prevOk) return;
          }
          await mediaPrevTrack();
          return;
        }

        if ((await resolveIsGenuineSpotify()) && isSpotifyUserConnected()) {
          const ok = await prevSpotifyTrack();
          if (ok) return;
        }
        if (currentSessionId) {
          const ok = await controlMediaSession(currentSessionId, 'prev');
          if (ok) return;
        }
        await mediaPrevTrack();
      };

      return (
        <MediaExpandedView
          state={state}
          onCollapse={onCollapse}
          onUpdateState={onUpdateState}
          onNext={handleNext}
          onPrev={handlePrevious}
        />
      );
    },

    PillTeaser: ({ state, onClick }) => {
      return <MediaPillSlot state={state} onClick={onClick} />;
    },

    BubbleTeaser: ({ state, onClick }) => {
      const { song } = state;
      return (
        <div
          onClick={onClick}
          className="w-[36px] h-[36px] rounded-full bg-[#09090b] border border-[#27272a] flex items-center justify-center cursor-pointer hover:border-zinc-700 active:scale-[0.97] transition-all duration-100 ease-out shadow-[0_4px_16px_rgba(0,0,0,0.85)]"
          title={`Playing: ${song.title} - ${song.artist}`}
          role="button"
          aria-label="Active Music Bubble"
        >
          <div className="w-[18px] h-[18px] rounded-full overflow-hidden border border-white/20 shadow-sm animate-[spin_6s_linear_infinite] shrink-0">
            {song.albumArt ? (
              <img
                src={song.albumArt}
                alt="Mini Art"
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="w-full h-full bg-emerald-500/20 flex items-center justify-center">
                <Music className="w-2.5 h-2.5 text-emerald-400" />
              </div>
            )}
          </div>
        </div>
      );
    },
  },
};
