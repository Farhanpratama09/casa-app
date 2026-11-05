import React from 'react';
import { Music } from 'lucide-react';
import { listen } from '@tauri-apps/api/event';
import { CasaSkill, SkillPriorityTier } from '../types';
import { SongMetadata, AudioOutputDevice, MediaSessionItem } from '../../types/island';
import { MusicCardView, MusicSubPanel } from '../../components/views/MusicCardView';
import { fetchLyrics, LyricResult } from '../../utils/lyricsService';
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
} from '../../utils/tauriBridge';
import {
  markSessionInit,
  getCurrentlyPlayingTrackDetails,
  setLastKnownPositionMs,
  setLastPlayedTrackUri,
  clearPlayGuardWindow,
} from '../../utils/spotifyService';

import type { NativeTrack } from '../../services/nativeAudioService';

export interface MediaSkillState {
  song: SongMetadata;
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
}

const advancePlaybackSecond = (prev: MediaSkillState): MediaSkillState => {
  if (!prev.song.isPlaying) return prev;
  const maxDur = prev.song.duration;
  const nextTime =
    maxDur > 0 ? Math.min(prev.song.currentTime + 1, maxDur) : prev.song.currentTime + 1;

  return {
    ...prev,
    song: {
      ...prev.song,
      currentTime: nextTime,
    },
  };
};

export const isValidTrackMetadata = (title?: string, artist?: string): boolean => {
  if (!title) return false;
  const t = title.trim();
  if (
    !t ||
    t === 'No Media Playing' ||
    t === 'No Media Active' ||
    t.toLowerCase() === 'spotify' ||
    t.toLowerCase() === 'spotify free' ||
    t.toLowerCase() === 'spotify premium'
  ) {
    return false;
  }
  // If title contains an "Artist - Title" separator, it's valid even if artist is omitted/unknown
  if (t.includes(' - ') || t.includes(' – ') || t.includes(' — ') || t.includes(' : ')) {
    return true;
  }
  if (!artist) return false;
  const a = artist.trim().toLowerCase();
  if (!a || a === 'unknown' || a === 'unknown artist') {
    return false;
  }
  return true;
};

const getInitialSubPanel = (): MusicSubPanel => {
  return 'none';
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
        setState((prev) => ({
          ...prev,
          isSpotifyRunning: running,
          song:
            !running && !prev.is_browser && !prev.song.is_browser && prev.song.isPlaying
              ? { ...prev.song, isPlaying: false }
              : prev.song,
        }));
      } catch (err) {
        console.debug('[MediaSkill] checkSpotify error:', err);
      }
    };
    checkSpotifyProcess();
    const spotifyInterval = setInterval(checkSpotifyProcess, 2000);

    // Single stable 1000ms playback ticker: runs continuously ONLY when media is confirmed playing
    // Anti-Optimistic Drift: Guard against running while Spotify is still buffering, paused, or without valid song metadata
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
      setState(advancePlaybackSecond);
      setLastKnownPositionMs((current.song.currentTime + 1) * 1000);
    }, 1000);

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
        if (typeof initial.position === 'number' && initial.position > 0) {
          setLastKnownPositionMs(initial.position * 1000);
        }
        if ((initial as any).uri || (initial as any).track_id) {
          setLastPlayedTrackUri((initial as any).uri || (initial as any).track_id);
        }

        setState((prev) => ({
          ...prev,
          hasNativeMedia: true,
          is_browser: Boolean(initial.is_browser),
          session_id: initial.session_id || '',
          active_sessions: initial.active_sessions || [],
          activeSubPanel: prev.activeSubPanel,
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
            currentTime: initial.position,
            albumArtUrl: initial.album_art || undefined,
            albumArt: initial.album_art || undefined,
          },
        }));

        // Cold-start guard: Only query lyrics once valid non-generic track metadata is present
        if (isValidTrackMetadata(cleanTitle, initial.artist)) {
          fetchLyrics(cleanTitle, initial.artist, initial.duration)
            .then((lyrics) => {
              if (!isMounted) return;
              setState((prev) => ({ ...prev, lyricsData: lyrics }));
            })
            .catch(() => {});
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

          // Deteksi Pergantian Sumber Aplikasi
          const currentSource = payload.source_app || '';
          const isSourceSwitched = Boolean(
            lastSourceAppRef.current &&
            currentSource &&
            lastSourceAppRef.current !== currentSource
          );
          lastSourceAppRef.current = currentSource;

          // Evaluasi perubahan posisi native dari GSMTC (Anti 5-Second Rubber-Banding)
          const nativePosChanged =
            lastNativePositionRef.current >= 0 &&
            Math.abs(payload.position - lastNativePositionRef.current) > 0.5;
          lastNativePositionRef.current = payload.position;
          if (typeof payload.position === 'number' && payload.position > 0) {
            setLastKnownPositionMs(payload.position * 1000);
          }

          setState((prev) => {
            const incomingSessions = payload.active_sessions || [];

            // State Hierarchy (Active Playback Precedence + Session Stickiness):
            // 1. Jika sesi incoming berstatus PLAYING (payload.is_playing === true) sementara sesi saat ini PAUSED,
            //    SELALU izinkan beralih ke sesi yang sedang PLAYING tersebut.
            // 2. Stickiness HANYA menahan perpindahan jika sesi saat ini di-pause DAN tidak ada sesi lain yang sedang PLAYING
            //    (atau bukan hasil klik manual user).
            if (
              prev.session_id &&
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
                return {
                  ...prev,
                  active_sessions: incomingSessions,
                  song: {
                    ...prev.song,
                    isPlaying: stickyStillAlive.is_playing,
                    active_sessions: incomingSessions,
                  },
                };
              }

              if (manualTargetId && manualTargetId === payload.session_id) {
                clearLastManualTargetSessionId();
              }
            }

            const isSessionSwitched = Boolean(
              prev.session_id &&
              payload.session_id &&
              prev.session_id !== payload.session_id
            );
            const trackChanged =
              isSourceSwitched ||
              isSessionSwitched ||
              prev.song.title !== cleanTitle ||
              prev.song.artist !== payload.artist;

            const isNativeMode = prev.playbackSource === 'native';
            if (trackChanged && cleanTitle && !isNativeMode) {
              setLastKnownPositionMs(0);
              clearPlayGuardWindow();
              if ((payload as any).uri || (payload as any).track_id) {
                setLastPlayedTrackUri((payload as any).uri || (payload as any).track_id);
              }

              // Batalkan request lirik sebelumnya yang masih berjalan
              lyricsAbortControllerRef.current?.abort();

              // Atomik Flush: Langsung kosongkan lirik lagu lama seketika agar tidak tertinggal
              setState((s) =>
                s.playbackSource === 'native'
                  ? s
                  : {
                      ...s,
                      lyricsData: { lines: [], isSynced: false, syncType: 'none', isInstrumental: false },
                    }
              );

              // Hanya fetch lirik jika bukan mode native dan status playback benar-benar Playing
              if (
                payload.is_playing &&
                isValidTrackMetadata(cleanTitle, payload.artist)
              ) {
                const controller = new AbortController();
                lyricsAbortControllerRef.current = controller;

                fetchLyrics(cleanTitle, payload.artist, payload.duration, { signal: controller.signal })
                  .then((lyrics) => {
                    if (isMounted && !controller.signal.aborted) {
                      setState((s) =>
                        s.playbackSource === 'native' ? s : { ...s, lyricsData: lyrics }
                      );
                    }
                  })
                  .catch(() => {});
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
                          return {
                            ...s,
                            song: {
                              ...s.song,
                              duration: durationSec,
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

            // Sinkronisasi currentTime (Isolasi Ketat Browser vs Non-Browser / Spotify):
            // 1. Browser: Chromium tidak memperbarui TimelineProperties saat video berjalan normal.
            //    Hanya overwrite jika trackChanged ATAU (nativePosChanged && delta > 2s && position > 0).
            // 2. Non-Browser / Spotify: Selalu sinkronkan currentTime jika ada selisih >= 0.5s
            //    agar waktu Casa mengunci presisi 1:1 tanpa tertinggal ticker lokal.
            let syncedCurrentTime: number;
            if (payload.is_browser) {
              if (trackChanged) {
                syncedCurrentTime = payload.position;
                lastNativePositionRef.current = payload.position;
              } else if (
                nativePosChanged &&
                Math.abs(payload.position - prev.song.currentTime) > 2 &&
                payload.position > 0
              ) {
                syncedCurrentTime = payload.position;
              } else {
                syncedCurrentTime = prev.song.currentTime;
              }
            } else {
              // Mode Non-Browser / Spotify
              if (
                trackChanged ||
                Math.abs(payload.position - prev.song.currentTime) >= 0.5
              ) {
                syncedCurrentTime = payload.position;
                lastNativePositionRef.current = payload.position;
              } else {
                syncedCurrentTime = prev.song.currentTime;
              }
            }

            // Presisi Durasi Spotify & Anti-Blank Scrubber Guard:
            // Pertahankan durasi valid sebelumnya jika payload SMTC mengirimkan durasi 0, null, atau NaN
            const incomingDurationSec =
              typeof payload.duration === 'number' && !isNaN(payload.duration) && payload.duration > 0
                ? Math.round(payload.duration)
                : 0;

            const resolvedDuration = incomingDurationSec > 0
              ? incomingDurationSec
              : (prev.song.duration > 0 ? prev.song.duration : 0);

            return {
              ...prev,
              hasNativeMedia: true,
              is_browser: Boolean(payload.is_browser),
              session_id: payload.session_id || prev.session_id || '',
              active_sessions: incomingSessions,
              activeSubPanel: prev.activeSubPanel,
              lyricsData:
                prev.playbackSource === 'native'
                  ? prev.lyricsData
                  : isSourceSwitched || isSessionSwitched
                  ? { lines: [], isSynced: false, syncType: 'none', isInstrumental: false }
                  : prev.lyricsData,
              isShuffle:
                typeof payload.is_shuffle === 'boolean' ? payload.is_shuffle : prev.isShuffle,
              song: {
                ...prev.song,
                session_id: payload.session_id || prev.song.session_id || '',
                title: cleanTitle || prev.song.title,
                artist: payload.artist || prev.song.artist,
                isPlaying: payload.is_playing,
                is_browser: Boolean(payload.is_browser),
                is_spotify: Boolean(payload.is_spotify),
                source_app: payload.source_app || '',
                active_sessions: incomingSessions,
                duration: resolvedDuration,
                currentTime: syncedCurrentTime,
                albumArtUrl: trackChanged
                  ? payload.album_art || undefined
                  : payload.album_art || prev.song.albumArtUrl,
                albumArt: trackChanged
                  ? payload.album_art || undefined
                  : payload.album_art || prev.song.albumArt,
                lyrics: trackChanged ? { prev: '', current: '', next: '' } : prev.song.lyrics,
              },
            };
          });
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
            return {
              ...prev,
              isSpotifyRunning: false,
              hasNativeMedia: false,
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

      const handleNext = async () => {
        if (currentSessionId) {
          await controlMediaSession(currentSessionId, 'next');
        } else {
          await mediaNextTrack();
        }
      };

      const handlePrevious = async () => {
        const posMs = (state.song?.currentTime ?? 0) * 1000;
        if (posMs > 3000) {
          if (currentSessionId) {
            await seekMediaSession(currentSessionId, 0);
          }
          return;
        }
        if (currentSessionId) {
          await controlMediaSession(currentSessionId, 'prev');
        } else {
          await mediaPrevTrack();
        }
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
