import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from 'react';
import {
  Play,
  Pause,
  Shuffle,
  Search,
  Check,
} from 'lucide-react';
import { AudioOutputDevice, SongMetadata, MediaSessionItem } from '../../types/island';

import { useSkillStore } from '../../skills/store';
import { useSystemHardware } from '../../hooks/useSystemHardware';
import { useCasaAudio } from '../../context/CasaAudioContext';
import { useQueueStore } from '../../stores/useQueueStore';
import { listen } from '@tauri-apps/api/event';
import {
  NativeSearchDrawer,
  NativeQueueDrawer,
  MOCK_NATIVE_SEARCH_TRACKS,
  LyricsPanel,
  LyricRowItem,
  MarqueeLyric,
  PlayerHeaderBar,
  PlayerControls,
  SpotifyPanels,
  EmptyMediaView,
  UnifiedWideView,
  SplitPlayerView,
  SUB_PANELS,
  useNativeAudioPlayer,
  useLyricsSync,
} from './music';
export {
  MarqueeLyric,
  LyricRowItem,
  LyricsPanel,
  PlayerHeaderBar,
  PlayerControls,
  SpotifyPanels,
  EmptyMediaView,
  UnifiedWideView,
  SplitPlayerView,
  SUB_PANELS,
  useNativeAudioPlayer,
  useLyricsSync,
};
import {
  searchTracks,
  resolveAudioStreamUrl,
  resolveAudioCandidates,
  prefetchTrackStream,
  NativeTrack,
} from '../../services/nativeAudioService';
import {
  LyricLine,
  LyricResult,
  fetchLyrics,
  flushLyricsCache,
  cleanTrackTitleForLyrics,
  parseTimeToSeconds,
} from '../../utils/lyricsService';
import {
  playChimeCue,
  focusIslandWindow,
  ensureSpotifyRunningSilent,
  isSpotifyRunning,
  focusSpotifyWindow,
  launchSpotifyProcessClean,
  quitSpotifyApp,
  controlMediaSession,
  quickSwapSession,
  seekMediaSession,
  getCurrentMedia,
} from '../../utils/tauriBridge';
import {
  searchSpotifyTracks,
  getSpotifyUserQueue,
  getRealSpotifyQueue,
  playQueueTrack,
  addTrackToSpotifyQueue,
  getSpotifyUserPlaylists,
  playSpotifyPlaylist,
  isSpotifyUserConnected,
  loginSpotifyUser,
  getPlaylistTracks,
  getLikedSongs,
  seekSpotifyPlayback,
  setShufflePlayback,
  playTrackWithContext,
  executeSpotifyPlay,
  subscribeWakingSpotify,
  SpotifyTrackItem,
  SpotifyPlaylistItem,
  getSpotifyPlaybackProgressMs,
  markUserInitiatedPlayback,
  getCurrentlyPlayingTrackDetails,
  ensureSpotifySessionReady,
  isQueueStale,
  markSessionInit,
  setLastKnownPositionMs,
  isWithinPlayGuardWindow,
  clearPlayGuardWindow,
  setLastPlayedTrackUri,
  verifyIsBrowserSpotify,
  pauseSpotifyPlayback,
} from '../../utils/spotifyService';

// Two-Tier Resilient Memory Cache: maps trackId and title::artist to CDN / GSMTC artwork URLs
export const trackArtworkCache = new Map<string, string>();

export function getCachedArtwork(title: string, artist: string, _trackId?: string): string | null {
  const cleanTitle = title.trim().toLowerCase();
  const cleanArtist = artist.trim().toLowerCase();
  if (!cleanTitle) return null;
  const key = `${cleanTitle}::${cleanArtist}`;
  return trackArtworkCache.get(key) || null;
}

export function setCachedArtwork(title: string, artist: string, url: string, trackId?: string) {
  if (!url) return;
  if (trackId) {
    trackArtworkCache.set(trackId, url);
  }
  const cleanTitle = title.trim().toLowerCase();
  const cleanArtist = artist.trim().toLowerCase();
  if (cleanTitle) {
    const key = `${cleanTitle}::${cleanArtist}`;
    trackArtworkCache.set(key, url);
  }
}

export function clearTrackArtworkCache() {
  trackArtworkCache.clear();
}

export type PlaybackSource = 'companion' | 'native';
export type { NativeTrack };

export { MOCK_NATIVE_SEARCH_TRACKS };

export type MusicSubPanel = 'none' | 'lyrics' | 'search' | 'queue' | 'playlist';

interface MusicCardViewProps {
  playbackSource?: PlaybackSource;
  onPlaybackSourceChange?: (source: PlaybackSource) => void;
  song: SongMetadata;
  onTogglePlay: () => void;
  onNext: () => void;
  onPrev: () => void;
  isShuffle: boolean;
  onToggleShuffle: () => void;
  onSetShuffle?: (val: boolean) => void;
  activeSubPanel?: MusicSubPanel;
  onSubPanelChange?: (panel: MusicSubPanel) => void;
  showLyrics?: boolean;
  onToggleLyrics?: () => void;
  audioOutput: AudioOutputDevice;
  onToggleAudioOutput: () => void;
  currentPanelIndex?: number;
  onPanelIndexChange?: (index: number) => void;
  lyricLines?: LyricLine[];
  isSyncedLyrics?: boolean;
  syncType?: 'synced' | 'plain' | 'none';
  isInstrumental?: boolean;
  lyricOffsetSeconds?: number;
  onLyricsUpdated?: (result: LyricResult) => void;
  isSpotifyRunning?: boolean;
  is_browser?: boolean;
  sessionId?: string;
  activeSessions?: MediaSessionItem[];
}

/**
 * Elegant Hardware Vinyl Disc Fallback
 * Rendered when dynamic cover art is absent, offline, or fails to load.
 */
const VinylDiscFallback: React.FC<{ isPlaying?: boolean }> = ({ isPlaying = false }) => (
  <div
    className="relative w-full h-full rounded-[10px] bg-[#111111] overflow-hidden flex items-center justify-center border border-white/10 shadow-inner select-none"
    title="Vinyl Record"
  >
    {/* Concentric vinyl groove rings */}
    <div
      className={`absolute inset-1 rounded-full border border-white/[0.07] ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    />
    <div
      className={`absolute inset-2.5 rounded-full border border-white/[0.05] ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    />
    <div
      className={`absolute inset-4 rounded-full border border-white/[0.04] ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    />

    {/* Center vinyl label (Monochromatic luxury hardware disc) */}
    <div
      className={`relative w-[20px] h-[20px] rounded-full bg-gradient-to-tr from-white/20 via-white/10 to-white/5 border border-white/20 flex items-center justify-center shadow-md ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    >
      {/* Center spindle hole */}
      <div className="w-[5px] h-[5px] rounded-full bg-black border border-white/40" />
    </div>
  </div>
);

export const MusicCardView: React.FC<MusicCardViewProps> = ({
  playbackSource: propPlaybackSource,
  onPlaybackSourceChange,
  song,
  onTogglePlay,
  onNext,
  onPrev,
  isShuffle,
  onToggleShuffle,
  onSetShuffle,
  activeSubPanel: propActiveSubPanel,
  onSubPanelChange,
  showLyrics,
  onToggleLyrics,
  audioOutput,
  onToggleAudioOutput,
  currentPanelIndex: propCurrentPanelIndex,
  onPanelIndexChange,
  lyricLines = [],
  isSyncedLyrics = false,
  syncType = 'none',
  isInstrumental = false,
  lyricOffsetSeconds = 0,
  onLyricsUpdated,
  isSpotifyRunning: propIsSpotifyRunning,
  is_browser: propIsBrowser,
  sessionId: propSessionId,
  activeSessions: propActiveSessions,
}) => {
  const isBrowser = Boolean(propIsBrowser ?? song.is_browser);
  const currentSessionId = propSessionId || song.session_id || '';
  const activeSessions: MediaSessionItem[] = propActiveSessions || song.active_sessions || [];
  const activeSession = activeSessions.find((s) => s.session_id === currentSessionId) || activeSessions[0];
  const { telemetry: systemTelemetry, toggleMute: toggleSystemMute } = useSystemHardware();
  const [isSessionPopoverOpen, setIsSessionPopoverOpen] = useState(false);

  // CASA Persistent Global Audio Engine (Context-Driven, Unmount-Immune)
  const {
    audioRef,
    playbackSource: globalPlaybackSource,
    setPlaybackSource: setGlobalPlaybackSource,
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
    currentTime: nativeCurrentTime,
    duration: nativeDuration,
    seek: seekNativeAudio,
    playTrackAtIndex,
    toggleNativePlay: toggleNativePlayPause,
    stopNativeAudioInstantly: stopNativeAudioHook,
    ejectNativeTrack,
    handleNextTrack: handleNextNativeTrack,
    handlePrevTrack: handlePrevNativeTrack,
    handleSeekNative,
    addToQueue: handleAddToNativeQueue,
    removeFromQueue: handleRemoveFromNativeQueue,
    clearQueue: handleClearNativeQueue,
    setQueueAndPlay,
  } = useCasaAudio();

  const handleEjectNative = useCallback(() => {
    playChimeCue('tap');
    ejectNativeTrack();
    resetLyricsSyncRef.current?.();
    setDisplayedArtwork(null);
    setSecondaryArtwork(null);
    onLyricsUpdated?.({ lines: [], isSynced: false, syncType: 'none', isInstrumental: false });
  }, [ejectNativeTrack, onLyricsUpdated]);

  // Local Audio File Picker & Drop Pipeline (0ms latency, pure offline playback)
  const localFileInputRef = useRef<HTMLInputElement>(null);

  const handleOpenLocalFiles = useCallback(() => {
    localFileInputRef.current?.click();
  }, []);

  const handleProcessAudioFiles = useCallback(
    (files: FileList | File[]) => {
      if (!files || files.length === 0) return;

      const newTracks: NativeTrack[] = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (
          !file.type.startsWith('audio/') &&
          !/\.(mp3|flac|wav|ogg|m4a|aac|opus)$/i.test(file.name)
        ) {
          continue;
        }
        const url = URL.createObjectURL(file);
        const cleanName = file.name.replace(/\.[^/.]+$/, '');
        let artist = 'Local Audio';
        let title = cleanName;
        if (cleanName.includes(' - ')) {
          const parts = cleanName.split(' - ');
          artist = parts[0].trim();
          title = parts.slice(1).join(' - ').trim();
        }
        newTracks.push({
          id: `local-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
          title,
          artist,
          durationSeconds: 0,
          thumbnailUrl: '',
          streamUrl: url,
          candidates: [url],
        });
      }

      if (newTracks.length > 0) {
        playChimeCue('tap');
        setGlobalPlaybackSource('native');
        if (nativeQueue.length === 0) {
          setQueueAndPlay(newTracks, 0);
        } else {
          const combined = [...nativeQueue, ...newTracks];
          setQueueAndPlay(combined, nativeQueueIndex >= 0 ? nativeQueueIndex : 0);
        }
      }
    },
    [nativeQueue, nativeQueueIndex, setQueueAndPlay, setGlobalPlaybackSource]
  );

  const handleLocalFilesSelected = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) {
        handleProcessAudioFiles(e.target.files);
      }
      e.target.value = '';
    },
    [handleProcessAudioFiles]
  );

  const handleFilesDropped = useCallback(
    (files: FileList) => {
      handleProcessAudioFiles(files);
    },
    [handleProcessAudioFiles]
  );

  const playbackSource = propPlaybackSource !== undefined ? propPlaybackSource : globalPlaybackSource;
  const setPlaybackSource = useCallback(
    (src: PlaybackSource) => {
      setGlobalPlaybackSource(src);
      onPlaybackSourceChange?.(src);
    },
    [setGlobalPlaybackSource, onPlaybackSourceChange]
  );

  // Unified Single Source of Truth for SubPanels:
  // 'none' = Unified Wide Player (Default, 700px wide symmetrical)
  // 'lyrics' | 'queue' | 'search' | 'playlist' = Split Mode (Left Player + Right Side Panel)
  // Cold-Start Rule: Always default to 'none' on mount unless actively passed via props
  const [internalSubPanel, setInternalSubPanel] = useState<MusicSubPanel>(
    propActiveSubPanel ?? 'none'
  );

  // Strict Sync: Keep internal state in sync with propActiveSubPanel
  useEffect(() => {
    if (propActiveSubPanel !== undefined && propActiveSubPanel !== internalSubPanel) {
      setInternalSubPanel(propActiveSubPanel);
    }
  }, [propActiveSubPanel, internalSubPanel]);

  const activeSubPanel = propActiveSubPanel !== undefined ? propActiveSubPanel : internalSubPanel;

  const [isNativeSearchOpen, setIsNativeSearchOpen] = useState<boolean>(false);
  const [isNativeQueueOpen, setIsNativeQueueOpen] = useState<boolean>(false);
  const [isRefreshingSession, setIsRefreshingSession] = useState<boolean>(false);
  const resetLyricsSyncRef = useRef<(() => void) | null>(null);

  const stopNativeAudioInstantly = useCallback(() => {
    stopNativeAudioHook();
    resetLyricsSyncRef.current?.();
  }, [stopNativeAudioHook]);

  // Source Transition Safeguard: Pause native audio when switching from native to companion
  const prevPlaybackSourceRef = useRef<PlaybackSource>(playbackSource);
  useEffect(() => {
    if (prevPlaybackSourceRef.current === 'native' && playbackSource === 'companion') {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      setIsNativePlaying(false);
      setIsNativeSearchOpen(false);
      setIsNativeQueueOpen(false);
      if (activeSubPanel === 'search' || activeSubPanel === 'queue') {
        setInternalSubPanel('lyrics');
        onSubPanelChange?.('lyrics');
      }
    }
    prevPlaybackSourceRef.current = playbackSource;
  }, [playbackSource, activeSubPanel, onSubPanelChange, audioRef, setIsNativePlaying]);

  // Atomik Flush Lifecycle:
  // Saat currentTrackId atau activeSource / playbackSource berganti,
  // seketika kosongkan array lirik dan reset activeLineIndex ke -1
  const prevTrackKeyRef = useRef<string>('');
  const currentTrackKey = `${playbackSource}::${
    playbackSource === 'native' ? (nativeTrack?.id || '') : (song.title || '')
  }`;

  useEffect(() => {
    if (prevTrackKeyRef.current !== currentTrackKey) {
      prevTrackKeyRef.current = currentTrackKey;
      onLyricsUpdated?.({ lines: [], isSynced: false, syncType: 'none', isInstrumental: false });
      resetLyricsSyncRef.current?.();
    }
  }, [currentTrackKey, onLyricsUpdated]);

  // Single-Master Mutual Exclusion Watcher:
  // If external playback (Spotify/GSMTC) is confirmed playing while in companion mode,
  // instantly halt CASA native audio so two engines never tick together!
  useEffect(() => {
    if (playbackSource !== 'native' && song.isPlaying && isNativePlaying) {
      stopNativeAudioInstantly();
      setIsNativePlaying(false);
    }
  }, [playbackSource, song.isPlaying, isNativePlaying, stopNativeAudioInstantly, setIsNativePlaying]);

  // Sebaliknya: Jika mode native sedang memutar lagu dan Spotify masih bermain, jeda Spotify
  useEffect(() => {
    if (playbackSource === 'native' && isNativePlaying && song.isPlaying) {
      pauseSpotifyPlayback().catch(() => {});
    }
  }, [playbackSource, isNativePlaying, song.isPlaying]);

  // Strict Manual Playback Source Selection: CASA Native cannot be hijacked by external OS media
  const handleSelectSource = (source: PlaybackSource) => {
    if (source === playbackSource) return;
    playChimeCue('tap');

    // Jika pindah DARI native KE eksternal:
    if (playbackSource === 'native' && source !== 'native') {
      // Jeda pemutar lokal agar audio tidak bertabrakan (jangan teardown/hapus src)
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause();
      }
      setIsNativePlaying(false);
      setIsNativeSearchOpen(false);
      setIsNativeQueueOpen(false);
      if (activeSubPanel === 'search' || activeSubPanel === 'queue') {
        setInternalSubPanel('lyrics');
        onSubPanelChange?.('lyrics');
      }
    }

    // Jika pindah DARI eksternal KE native:
    if (playbackSource !== 'native' && source === 'native') {
      // Jaga stabilitas layout split mode: jika user sedang di mode split (activeSubPanel !== 'none'),
      // pertahankan mode split dengan tetap berada di subpanel 'lyrics' (jangan kolaps ke 'none')!
      if (activeSubPanel !== 'none') {
        setInternalSubPanel('lyrics');
        onSubPanelChange?.('lyrics');
      }
    }

    setPlaybackSource(source);
  };

  const handleSelectNativeTrack = (track: NativeTrack, customList?: NativeTrack[]) => {
    playChimeCue('tap');
    setIsNativeSearchOpen(false);

    const baseList = customList || MOCK_NATIVE_SEARCH_TRACKS;
    const listToUse = [...baseList];
    let idx = listToUse.findIndex((t) => t.id === track.id);
    if (idx === -1) {
      listToUse.unshift(track);
      idx = 0;
    }

    setPlaybackSource('native');
    setQueueAndPlay(listToUse, idx);
  };

  useEffect(() => {
    if (activeSessions.length < 2 && isSessionPopoverOpen) {
      setIsSessionPopoverOpen(false);
    }
  }, [activeSessions.length, isSessionPopoverOpen]);

  // Real-time Spotify process presence tracking
  const [internalSpotifyRunning, setInternalSpotifyRunning] = useState<boolean>(true);

  useEffect(() => {
    let isMounted = true;
    let unlistenClosed: (() => void) | null = null;
    let unlistenOpened: (() => void) | null = null;

    listen('spotify-closed', () => {
      if (isMounted) setInternalSpotifyRunning(false);
    }).then((un) => {
      unlistenClosed = un;
    });

    listen<{ running: boolean; timestamp?: number }>('spotify-opened', (event) => {
      const ts = event.payload?.timestamp || Date.now();
      markSessionInit(ts);
      if (isMounted) setInternalSpotifyRunning(true);
    }).then((un) => {
      unlistenOpened = un;
    });

    isSpotifyRunning().then((running) => {
      if (isMounted) setInternalSpotifyRunning(running);
    });

    return () => {
      isMounted = false;
      if (unlistenClosed) unlistenClosed();
      if (unlistenOpened) unlistenOpened();
    };
  }, []);

  const effectiveSpotifyRunning =
    propIsSpotifyRunning !== undefined ? propIsSpotifyRunning : internalSpotifyRunning;

  const [isUserConnected, setIsUserConnected] = useState(isSpotifyUserConnected());
  const [currentTrackId, setCurrentTrackId] = useState<string | null>(null);

  // Anti-Blank Scrubber Guard: Preserve last known valid duration across single-video next/prev actions
  const lastValidDurationRef = useRef<number>(
    typeof song.duration === 'number' && !isNaN(song.duration) && song.duration > 0
      ? song.duration
      : 0
  );

  useEffect(() => {
    if (typeof song.duration === 'number' && !isNaN(song.duration) && song.duration > 0) {
      lastValidDurationRef.current = song.duration;
    }
  }, [song.duration]);

  const effectiveDuration =
    playbackSource === 'native'
      ? (nativeDuration > 0 ? nativeDuration : (nativeTrack?.durationSeconds || 0))
      : typeof song.duration === 'number' && !isNaN(song.duration) && song.duration > 0
      ? song.duration
      : lastValidDurationRef.current;

  // Artwork state with auto-reset on song changes
  const [imgFailed, setImgFailed] = useState(false);
  const [isWakingSpotify, setIsWakingSpotify] = useState(false);
  const [isRefreshingLyrics, setIsRefreshingLyrics] = useState(false);

  const handleRefreshLyrics = async () => {
    if (!effectiveTitle) return;
    setIsRefreshingLyrics(true);
    playChimeCue('tap');
    try {
      flushLyricsCache();
      const result = await fetchLyrics(effectiveTitle, effectiveArtist, effectiveDuration, true);
      onLyricsUpdated?.(result);
    } catch (err) {
      console.warn('[MusicCardView] handleRefreshLyrics error:', err);
    } finally {
      setIsRefreshingLyrics(false);
    }
  };

  const handleRefreshSession = async () => {
    playChimeCue('tap');
    setIsRefreshingSession(true);
    try {
      await getCurrentMedia();
    } catch {}
    setTimeout(() => setIsRefreshingSession(false), 500);
  };

  // Auto-fetch synced lyrics when native track changes or on initial play
  useEffect(() => {
    if (playbackSource !== 'native' || !nativeTrack) return;
    const cleanTitle = cleanTrackTitleForLyrics(nativeTrack.title);
    const cleanArtist = nativeTrack.artist;
    if (!cleanTitle || cleanTitle === 'CASA Native Player') return;

    let isSubscribed = true;
    const controller = new AbortController();

    fetchLyrics(cleanTitle, cleanArtist, nativeTrack.durationSeconds, false, { signal: controller.signal })
      .then((res) => {
        if (!isSubscribed) return;
        onLyricsUpdated?.(res);
      })
      .catch((err) => {
        if (!isSubscribed) return;
        console.warn('[NativeAudio] Auto fetchLyrics failed:', cleanTitle, err);
      });

    return () => {
      isSubscribed = false;
      controller.abort();
    };
  }, [playbackSource, nativeTrack?.id, nativeTrack?.title, nativeTrack?.artist, onLyricsUpdated]);

  const handleQuitSpotify = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    playChimeCue('tap');
    try {
      setInternalSpotifyRunning(false);
      await quitSpotifyApp();
    } catch (err) {
      console.warn('[MusicCardView] handleQuitSpotify error:', err);
    }
  };

  // Optimistic track state: instantly reflects clicked song from search/queue/playlist
  // preventing flash of "Tidak ada sesi aktif" while Spotify & GSMTC sync.
  const [optimisticTrack, setOptimisticTrack] = useState<{
    title: string;
    artist: string;
    albumArt?: string;
    albumArtUrl?: string;
  } | null>(null);

  useEffect(() => {
    return subscribeWakingSpotify((waking) => {
      setIsWakingSpotify(waking);
    });
  }, []);

  useEffect(() => {
    if (song.title && song.title !== 'No Media Playing' && song.title !== 'No Media Active') {
      setOptimisticTrack(null);
    } else {
      // Empty media state / Spotify closed: reset optimistic state
      setOptimisticTrack(null);
    }
  }, [song.title, song.artist]);

  const effectiveTitle =
    playbackSource === 'native'
      ? (nativeTrack?.title || 'CASA Native Player')
      : song.title && song.title !== 'No Media Playing' && song.title !== 'No Media Active'
      ? song.title
      : (optimisticTrack?.title || song.title || '');

  const effectiveArtist =
    playbackSource === 'native'
      ? (nativeTrack?.artist || 'Pilih lagu untuk putar')
      : song.artist && song.artist !== 'Unknown'
      ? song.artist
      : (optimisticTrack?.artist || song.artist || '');

  const hasActiveSession = Boolean(
    playbackSource === 'native'
      ? true
      : optimisticTrack || (
          song.title &&
          song.title.trim() !== '' &&
          song.title !== 'No Media Playing' &&
          song.title !== 'No Media Active'
        )
  );

  // Smart Detection: Spotify Desktop native vs Spotify Web in browser vs generic browser (YouTube)
  const isDesktopSpotify = Boolean(
    song.is_spotify ||
    activeSession?.app_name?.toLowerCase().includes('spotify') ||
    song.source_app?.toLowerCase().includes('spotify')
  );

  const [isBrowserSpotify, setIsBrowserSpotify] = useState(false);

  const isSpotifySession = Boolean(isDesktopSpotify || isBrowserSpotify);

  useEffect(() => {
    let isMounted = true;
    let timer1: NodeJS.Timeout | null = null;
    let timer2: NodeJS.Timeout | null = null;

    if (!isBrowser || !isUserConnected || !effectiveTitle) {
      setIsBrowserSpotify(false);
      return;
    }

    const checkVerification = async () => {
      const verified = await verifyIsBrowserSpotify(effectiveTitle, effectiveArtist);
      if (isMounted && verified) {
        setIsBrowserSpotify(true);
        return true;
      }
      return verified;
    };

    // 1. Immediate check (t = 0ms)
    checkVerification().then((ok) => {
      if (!ok && isMounted) {
        // 2. Tolerance retry after 500ms (waiting for cloud propagation)
        timer1 = setTimeout(async () => {
          const ok2 = await checkVerification();
          if (!ok2 && isMounted) {
            // 3. Final tolerance retry after 1200ms
            timer2 = setTimeout(async () => {
              const ok3 = await checkVerification();
              if (!ok3 && isMounted) {
                setIsBrowserSpotify(false);
              }
            }, 700);
          }
        }, 500);
      }
    });

    return () => {
      isMounted = false;
      if (timer1) clearTimeout(timer1);
      if (timer2) clearTimeout(timer2);
    };
  }, [isBrowser, isUserConnected, effectiveTitle, effectiveArtist, currentSessionId]);

  const canAccessSpotifyFeatures = isUserConnected && (isDesktopSpotify || isBrowserSpotify);

  // Two-Tier Resilient Artwork Pipeline with Anti-Flicker / Sticky Buffer:
  // - displayedArtwork holds the active visible image.
  // - secondaryArtwork holds the alternative fallback image (e.g. GSMTC blob if primary is CDN URL).
  // - Upon track change, displayedArtwork is NOT immediately wiped to null, eliminating white/black flicker!
  const [displayedArtwork, setDisplayedArtwork] = useState<string | null>(null);
  const [secondaryArtwork, setSecondaryArtwork] = useState<string | null>(null);
  const prevSessionIdRef = useRef(currentSessionId);
  const prevTrackTitleRef = useRef(effectiveTitle);

  useEffect(() => {
    // If no active session and no media, clear displayed artwork so idle vinyl card shows cleanly
    if (!hasActiveSession && !optimisticTrack) {
      setDisplayedArtwork(null);
      setSecondaryArtwork(null);
      setImgFailed(false);
      return;
    }

    const currentTitle = effectiveTitle;
    const currentArtist = effectiveArtist;
    if (!currentTitle) return;

    // Track or Session Transition Guard:
    // If session switched or track title changed, immediately flush displayedArtwork to prevent stale image desync!
    if (
      prevSessionIdRef.current !== currentSessionId ||
      prevTrackTitleRef.current !== currentTitle
    ) {
      prevSessionIdRef.current = currentSessionId;
      prevTrackTitleRef.current = currentTitle;
      setDisplayedArtwork(null);
      setSecondaryArtwork(null);
      setImgFailed(false);
    }

    // 1. Identify Candidate Sources:
    // Priority 1: Optimistic track / High-Res CDN URL (starts with http)
    const optimisticArt = optimisticTrack?.albumArtUrl || optimisticTrack?.albumArt;
    const directUrl = song.albumArtUrl || song.albumArt || (song as any)?.thumbnail;
    const activeTrackId = currentTrackId || (song as any)?.id;
    const cachedArt = getCachedArtwork(currentTitle, currentArtist, activeTrackId);

    // Warm cache immediately if we have a direct CDN URL
    if (directUrl && directUrl.startsWith('http')) {
      setCachedArtwork(currentTitle, currentArtist, directUrl, activeTrackId);
    }
    if (optimisticArt && optimisticArt.startsWith('http')) {
      setCachedArtwork(currentTitle, currentArtist, optimisticArt, activeTrackId);
    }

    let primaryCandidate: string | null = null;
    let fallbackCandidate: string | null = null;

    const hasActiveMediaTrack = Boolean(
      song.title && song.title !== 'No Media Playing' && song.title !== 'No Media Active'
    );

    if (optimisticArt && optimisticArt.startsWith('http') && !hasActiveMediaTrack) {
      primaryCandidate = optimisticArt;
    } else if (cachedArt && cachedArt.startsWith('http')) {
      primaryCandidate = cachedArt;
    } else if (directUrl && directUrl.startsWith('http')) {
      primaryCandidate = directUrl;
    }

    // Secondary / Fallback: GSMTC thumbnail blob or non-http cached art
    if (directUrl && !directUrl.startsWith('http')) {
      fallbackCandidate = directUrl;
    } else if (cachedArt && !cachedArt.startsWith('http')) {
      fallbackCandidate = cachedArt;
    }

    // If no CDN candidate found yet, promote fallbackCandidate to primaryCandidate
    if (!primaryCandidate && fallbackCandidate) {
      primaryCandidate = fallbackCandidate;
      fallbackCandidate = null;
    }

    // Synchronize artwork directly with current track candidates:
    // 1. If primaryCandidate is found, show it immediately.
    // 2. If only fallbackCandidate is found, show fallback.
    // 3. If neither is available for this track, reset displayedArtwork to null so
    //    the VinylDiscFallback renders instead of getting stuck on the previous track's art!
    if (primaryCandidate) {
      setDisplayedArtwork(primaryCandidate);
      setSecondaryArtwork(fallbackCandidate);
      setImgFailed(false);
    } else if (fallbackCandidate) {
      setDisplayedArtwork(fallbackCandidate);
      setSecondaryArtwork(null);
      setImgFailed(false);
    } else {
      setDisplayedArtwork(null);
      setSecondaryArtwork(null);
      setImgFailed(false);
    }

    // Asynchronous Web API query (Tier 1 Priority check):
    // Only query Spotify Web API for artwork if active session is genuinely Spotify!
    if (canAccessSpotifyFeatures && (!primaryCandidate || !primaryCandidate.startsWith('http'))) {
      let isSubscribed = true;
      getCurrentlyPlayingTrackDetails().then((details) => {
        if (!isSubscribed || !details) return;

        // Strict Anti-Poisoning Filter:
        // Cloud API propagation latency (1-2s) often returns the previous track (e.g. "Hot Sauce" while "I LIKE IT" plays).
        // Only accept artwork if the Web API title genuinely matches the current active song!
        const detailsTitle = details.title.toLowerCase().trim();
        const expectedTitle = currentTitle.toLowerCase().trim();
        const isTitleMatch =
          detailsTitle === expectedTitle ||
          (detailsTitle.length > 2 && expectedTitle.includes(detailsTitle)) ||
          (expectedTitle.length > 2 && detailsTitle.includes(expectedTitle));

        if (isTitleMatch && details.albumArt) {
          setCachedArtwork(currentTitle, currentArtist, details.albumArt, details.id);
          setDisplayedArtwork(details.albumArt);
          setImgFailed(false);
        } else {
          console.debug(
            `[MusicCardView] Ignored stale cloud artwork: "${details.title}" does not match active song "${currentTitle}"`
          );
        }
      });
      return () => {
        isSubscribed = false;
      };
    }
  }, [
    song.title,
    song.artist,
    song.albumArtUrl,
    song.albumArt,
    optimisticTrack,
    hasActiveSession,
    isUserConnected,
    canAccessSpotifyFeatures,
    effectiveTitle,
    effectiveArtist,
    currentSessionId,
  ]);

  const handleCoverImageError = () => {
    // If primary failed but we have a secondary fallback (e.g. GSMTC thumbnail blob), try it!
    if (secondaryArtwork && displayedArtwork !== secondaryArtwork) {
      setDisplayedArtwork(secondaryArtwork);
      setSecondaryArtwork(null);
    } else {
      setImgFailed(true);
    }
  };

  const handleCoverImageLoad = () => {
    setImgFailed(false);
  };

  const effectiveArtwork =
    playbackSource === 'native'
      ? (nativeTrack?.albumArt || null)
      : (!imgFailed ? displayedArtwork : null);

  const isEffectivePlaying =
    playbackSource === 'native'
      ? Boolean(audioRef.current ? !audioRef.current.paused : isNativePlaying)
      : song.isPlaying;

  // Jika user sedang membuka sub-panel Spotify (Queue, Search, Playlist) di mode Companion lalu media berpindah ke sumber non-Spotify,
  // jangan kolaps ke UnifiedWideView ('none'), melainkan arahkan ke 'lyrics' agar layout SplitPlayerView tetap stabil!
  useEffect(() => {
    if (playbackSource === 'companion' && !canAccessSpotifyFeatures && (activeSubPanel === 'queue' || activeSubPanel === 'search' || activeSubPanel === 'playlist')) {
      setInternalSubPanel('lyrics');
      try {
        localStorage.setItem('casa_active_subpanel', 'lyrics');
      } catch {}
      onSubPanelChange?.('lyrics');
    }
  }, [playbackSource, canAccessSpotifyFeatures, activeSubPanel, onSubPanelChange]);

  const switchSubPanel = (target: MusicSubPanel) => {
    playChimeCue('tap');
    const next = activeSubPanel === target ? 'none' : target;
    setInternalSubPanel(next);
    try {
      localStorage.setItem('casa_active_subpanel', next);
    } catch {}
    onSubPanelChange?.(next);
  };

  const [isRepeat, setIsRepeat] = useState<boolean>(false);
  const handleToggleRepeat = () => {
    playChimeCue('tap');
    setIsRepeat((prev) => {
      const next = !prev;
      if (audioRef.current) {
        audioRef.current.loop = next;
      }
      return next;
    });
  };

  const [isSearchFocused, setIsSearchFocused] = useState<boolean>(false);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SpotifyTrackItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [addedQueueId, setAddedQueueId] = useState<string | null>(null);

  // Queue State
  const [queueTracks, setQueueTracks] = useState<SpotifyTrackItem[]>([]);
  const [queueContextTitle, setQueueContextTitle] = useState('Next up');
  const [activeContextUri, setActiveContextUri] = useState<string | null>(null);
  const [isLoadingQueue, setIsLoadingQueue] = useState(false);
  const [isSmartShuffle, setIsSmartShuffle] = useState(false);

  // Playlists & Drill-down State
  const [playlists, setPlaylists] = useState<SpotifyPlaylistItem[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [selectedPlaylist, setSelectedPlaylist] = useState<SpotifyPlaylistItem | null>(null);
  const [playlistTracks, setPlaylistTracks] = useState<SpotifyTrackItem[]>([]);
  const [isLoadingPlaylistTracks, setIsLoadingPlaylistTracks] = useState(false);
  const [likedSongsTotal, setLikedSongsTotal] = useState<number | null>(null);

  // Lyrics Auto-Centering & Karaoke Scrolling Refs
  const lyricsContainerRef = useRef<HTMLDivElement>(null);

  const effectiveIsInstrumental = useMemo(() => {
    return (
      isInstrumental ||
      Boolean(song.title && /\b(instrumental|karaoke|backing track|minus one)\b/i.test(song.title))
    );
  }, [isInstrumental, song.title]);

  const displayLines = useMemo(() => {
    return Array.isArray(lyricLines) ? lyricLines : [];
  }, [lyricLines]);

  const {
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
  } = useLyricsSync({
    audioRef,
    isPlaying: playbackSource === 'native' ? isNativePlaying : (song.isPlaying && hasActiveSession),
    playbackSource,
    currentTrackId: playbackSource === 'native' ? (nativeTrack?.id || null) : (song.title || null),
    displayLines,
    durationMs: effectiveDuration * 1000,
    durationSeconds: effectiveDuration,
    currentTimeSeconds: playbackSource === 'native' ? nativeCurrentTime : song.currentTime,
    lyricOffsetSeconds,
    isSyncedLyrics,
    hasActiveSession,
    externalCurrentTimeSeconds: playbackSource === 'native' ? nativeCurrentTime : song.currentTime,
    externalTitle: playbackSource === 'native' ? (nativeTrack?.title || '') : song.title,
    isBrowser,
    isBrowserSpotify,
    isDesktopSpotify,
    isUserConnected,
    currentSessionId,
    onSeekExternal: async (targetMs) => {
      if (canAccessSpotifyFeatures && (isDesktopSpotify || isBrowserSpotify)) {
        await seekSpotifyPlayback(targetMs);
      } else if (currentSessionId) {
        await seekMediaSession(currentSessionId, targetMs);
      } else {
        await seekMediaSession('', targetMs);
      }
    },
  });

  resetLyricsSyncRef.current = resetLyricsSync;

  const handleQuickSwap = async (targetSessionId: string) => {
    if (!targetSessionId) return;
    playChimeCue('tap');
    setDisplayedArtwork(null);
    setSecondaryArtwork(null);
    setImgFailed(false);
    lastSyncLocalTime.current = performance.now();
    setLastKnownPositionMs(0);
    applyProgressUpdate(0, true);

    // Auto-pause passive sessions to prevent concurrent playback
    const others = activeSessions.filter(
      (s) => s.session_id !== targetSessionId && s.is_playing
    );
    for (const s of others) {
      await controlMediaSession(s.session_id, 'pause').catch(() => {});
    }

    await quickSwapSession(targetSessionId, true);
  };

  const handleToggleSessionPlayPause = async (session: MediaSessionItem) => {
    if (!session.session_id) return;
    playChimeCue('tap');
    const willPause = session.is_playing;
    if (session.session_id === currentSessionId) {
      if (willPause) {
        calibrateExternalTime(preciseTimeMs);
      } else {
        lastSyncLocalTime.current = performance.now();
      }
    }

    // Auto-pause other playing sessions when initiating playback
    if (!willPause) {
      const others = activeSessions.filter(
        (s) => s.session_id !== session.session_id && s.is_playing
      );
      for (const s of others) {
        await controlMediaSession(s.session_id, 'pause').catch(() => {});
      }
      // If newly played session is non-Spotify, pause Spotify Web API
      if (!session.app_name?.toLowerCase().includes('spotify') && isSpotifyUserConnected()) {
        pauseSpotifyPlayback().catch(() => {});
      }
    }

    await controlMediaSession(session.session_id, willPause ? 'pause' : 'play');
  };

  const handlePauseOtherSessions = async () => {
    playChimeCue('tap');
    const others = activeSessions.filter(
      (s) => s.session_id !== currentSessionId && s.is_playing
    );
    for (const s of others) {
      await controlMediaSession(s.session_id, 'pause');
    }
    setIsSessionPopoverOpen(false);
  };

  const renderSessionSwitcher = (compact: boolean = false) => {
    if (activeSessions.length <= 1) return null;

    if (activeSessions.length === 2) {
      const otherSession =
        activeSessions.find((s) => s.session_id !== currentSessionId) || activeSessions[1];
      if (!otherSession) return null;
      return (
        <button
          onClick={() => handleQuickSwap(otherSession.session_id)}
          className={
            compact
              ? 'px-2 py-0.5 rounded-full flex items-center gap-1 text-[10px] font-medium text-[#98BBD6] bg-[#98BBD6]/15 hover:bg-[#98BBD6]/25 border border-[#98BBD6]/30 transition-all shrink-0'
              : 'px-2.5 h-[28px] rounded-full flex items-center gap-1.5 text-[11px] font-medium text-[#98BBD6] bg-[#98BBD6]/15 hover:bg-[#98BBD6]/25 border border-[#98BBD6]/30 transition-all shrink-0'
          }
          title={`Kontrol ${otherSession.app_name}: ${otherSession.title}`}
        >
          <span>⇄</span>
          <span className="truncate max-w-[110px]">
            {compact ? `Kontrol ${otherSession.app_name}` : `Kontrol ${otherSession.app_name}`}
          </span>
        </button>
      );
    }

    const extraCount = activeSessions.length - 1;
    return (
      <button
        onClick={() => {
          playChimeCue('tap');
          setIsSessionPopoverOpen((prev) => !prev);
        }}
        className={
          compact
            ? `px-2 py-0.5 rounded-full flex items-center gap-1 text-[10px] font-semibold transition-all border shrink-0 ${
                isSessionPopoverOpen
                  ? 'text-white bg-[#98BBD6]/30 border-[#98BBD6]/50'
                  : 'text-[#98BBD6] bg-[#98BBD6]/15 hover:bg-[#98BBD6]/25 border-[#98BBD6]/30'
              }`
            : `px-2.5 h-[28px] rounded-full flex items-center gap-1 text-[11px] font-semibold transition-all border shrink-0 ${
                isSessionPopoverOpen
                  ? 'text-white bg-[#98BBD6]/30 border-[#98BBD6]/50'
                  : 'text-[#98BBD6] bg-[#98BBD6]/15 hover:bg-[#98BBD6]/25 border-[#98BBD6]/30'
              }`
        }
        title="Kelola Multi-Sesi Media Aktif"
      >
        <span>⇄</span>
        <span>+{extraCount}</span>
      </button>
    );
  };

  const renderSessionPopover = () => {
    if (!isSessionPopoverOpen || activeSessions.length < 2) return null;

    return (
      <div
        onWheel={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        onContextMenu={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        className="absolute inset-y-1.5 right-1.5 w-[310px] bg-[#0e0e11] border border-[#2e2e34] rounded-2xl p-2.5 flex flex-col z-50 shadow-[0_16px_36px_rgba(0,0,0,0.95)] select-none"
      >
        <div className="flex items-center justify-between pb-1.5 border-b border-[#222226] flex-shrink-0">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
            Sesi Media Aktif ({activeSessions.length})
          </span>
          <button
            onClick={() => setIsSessionPopoverOpen(false)}
            className="w-4 h-4 rounded-full bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-zinc-100 flex items-center justify-center text-[10px] active:scale-[0.97]"
          >
            ✕
          </button>
        </div>

        <div
          onWheel={(e) => e.stopPropagation()}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain space-y-1 my-1 pr-1 pb-2.5 [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-white/40"
        >
          {activeSessions.map((sess) => {
            const isCurrent = sess.session_id === currentSessionId;
            return (
              <div
                key={sess.session_id}
                className={`flex items-center justify-between py-1 px-2.5 gap-1.5 rounded-lg border text-xs transition-colors ${
                  isCurrent
                    ? 'bg-[#98BBD6]/15 border-[#98BBD6]/30'
                    : 'bg-white/[0.03] border-white/5 hover:bg-white/[0.07]'
                }`}
              >
                <button
                  onClick={() => {
                    if (!isCurrent) {
                      handleQuickSwap(sess.session_id);
                      setIsSessionPopoverOpen(false);
                    }
                  }}
                  className="flex items-center gap-1.5 min-w-0 flex-1 text-left"
                  title={`${sess.app_name} — ${sess.title}`}
                >
                  <span className="text-[10px] font-semibold text-[#98BBD6] shrink-0">
                    {sess.app_name}
                  </span>
                  <span className="text-[11px] font-medium text-white truncate max-w-[170px]">
                    {sess.title}
                  </span>
                </button>
                <button
                  onClick={() => handleToggleSessionPlayPause(sess)}
                  className="w-5 h-5 rounded-full flex items-center justify-center bg-white/10 hover:bg-white/20 text-white shrink-0 transition-colors"
                  title={sess.is_playing ? 'Pause sesi ini' : 'Play sesi ini'}
                >
                  {sess.is_playing ? (
                    <Pause className="w-2.5 h-2.5 fill-current" />
                  ) : (
                    <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                  )}
                </button>
              </div>
            );
          })}
        </div>

        <button
          onClick={handlePauseOtherSessions}
          className="w-full py-1 rounded-lg bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 text-rose-300 text-[10px] font-semibold tracking-wide transition-colors text-center flex-shrink-0"
        >
          Pause Sesi Lainnya
        </button>
      </div>
    );
  };

  const inputRef = useRef<HTMLInputElement>(null);

  const handlePrevPanel = () => {
    playChimeCue('tap');
    if (activeSubPanel === 'none') {
      return;
    }
    const curIdx = SUB_PANELS.indexOf(activeSubPanel);
    if (curIdx === -1) return;
    const newIdx = (curIdx - 1 + SUB_PANELS.length) % SUB_PANELS.length;
    switchSubPanel(SUB_PANELS[newIdx]);
  };

  const handleNextPanel = () => {
    playChimeCue('tap');
    if (activeSubPanel === 'none') {
      return;
    }
    const curIdx = SUB_PANELS.indexOf(activeSubPanel);
    if (curIdx === -1) return;
    const newIdx = (curIdx + 1) % SUB_PANELS.length;
    switchSubPanel(SUB_PANELS[newIdx]);
  };

  // Keyboard Navigation: Escape closes active subpanel back to 'none'
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (isSearchFocused || document.activeElement?.tagName === 'INPUT') {
        return;
      }
      if (e.key === 'Escape' && activeSubPanel !== 'none') {
        e.preventDefault();
        switchSubPanel(activeSubPanel);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isSearchFocused, activeSubPanel]);

  // Win32 Focus fix: auto-focus input when search panel opens
  useEffect(() => {
    if (activeSubPanel === 'search') {
      const timer = setTimeout(async () => {
        await focusIslandWindow();
        if (inputRef.current) {
          inputRef.current.focus();
          inputRef.current.select();
        }
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [activeSubPanel]);

  // Load Queue (Real Spotify Queue if user connected, otherwise artist top tracks)
  // Protected with Lamport sequence ID ordering: never discards valid fresh data unless a newer request already applied
  // Employs Stale-While-Revalidate (SWR): never blanks out queue to empty array during fetch
  const queueRequestIdRef = useRef<number>(0);
  const lastAppliedReqIdRef = useRef<number>(0);

  const refreshQueue = async (clearExisting: boolean = false) => {
    const reqId = ++queueRequestIdRef.current;
    setIsLoadingQueue(true);
    if (clearExisting) {
      setQueueTracks([]);
    }

    if (isUserConnected) {
      try {
        const realData = await getRealSpotifyQueue();
        // Do not discard if reqId is newer than or equal to last applied request
        if (reqId < lastAppliedReqIdRef.current) return;

        if (realData) {
          lastAppliedReqIdRef.current = reqId;
          setQueueTracks(realData.tracks);
          setQueueContextTitle(realData.contextTitle || 'Next up');
          setActiveContextUri(realData.contextUri);
          if (typeof realData.isShuffle === 'boolean') {
            onSetShuffle?.(realData.isShuffle);
          }
          if (typeof realData.smartShuffle === 'boolean') {
            setIsSmartShuffle(realData.smartShuffle);
          }
          if (realData.currentlyPlaying?.id && realData.currentlyPlaying.id !== currentTrackId) {
            setCurrentTrackId(realData.currentlyPlaying.id);
          }
          if (realData.currentlyPlaying?.albumArt) {
            setCachedArtwork(
              realData.currentlyPlaying.title,
              realData.currentlyPlaying.artist,
              realData.currentlyPlaying.albumArt,
              realData.currentlyPlaying.id
            );
          }
          realData.tracks.forEach((t) => {
            if (t.albumArt) {
              setCachedArtwork(t.title, t.artist, t.albumArt, t.id);
            }
          });
          setIsLoadingQueue(false);
          return;
        }
      } catch (err) {
        console.debug('[MusicCardView] Failed to fetch real user queue:', err);
        setIsLoadingQueue(false);
        return;
      }
    }

    if (reqId < lastAppliedReqIdRef.current) return;
    lastAppliedReqIdRef.current = reqId;

    // Truthful queue state: NEVER inject fake artist top tracks!
    if (!isUserConnected || clearExisting) {
      setQueueTracks([]);
      setQueueContextTitle('Next up');
      setActiveContextUri(null);
    }

    if (reqId >= lastAppliedReqIdRef.current) {
      setIsLoadingQueue(false);
    }
  };

  // Load queue immediately when user opens queue panel or connects to Spotify
  useEffect(() => {
    if (activeSubPanel === 'queue') {
      refreshQueue(false);
    }
  }, [activeSubPanel, isUserConnected]);

  // Reactive Queue Auto-Refresh on Track Change (Anti-Regression & Anti-Double-Slice)
  useEffect(() => {
    if (activeSubPanel !== 'queue' || !currentTrackId) return;

    // 1. Optimistic removal: buang track aktif saat ini dari antrean lokal seketika (0ms)
    setQueueTracks((prev) => prev.filter((t) => t.id !== currentTrackId));

    // 2. Debounced background sync ke endpoint Spotify
    const debounceTimer = setTimeout(() => {
      refreshQueue(false);
    }, 800);

    return () => clearTimeout(debounceTimer);
  }, [currentTrackId, activeSubPanel]);

  // Auto-Retry Polling on Empty Queue (Cold-Start Cloud Propagation Latency Fix)
  // Does NOT block paused sessions (isPlaying: false) as long as a valid song/track is detected
  useEffect(() => {
    if (activeSubPanel !== 'queue' || !isUserConnected || queueTracks.length > 0) return;
    const hasValidSong = Boolean(
      currentTrackId ||
      (song?.title && song.title !== 'No Media Playing' && song.title !== 'No Media Active')
    );
    if (!hasValidSong) return;

    let attempts = 0;
    const maxAttempts = 3;

    const retryInterval = setInterval(() => {
      attempts += 1;
      refreshQueue(false);

      if (attempts >= maxAttempts) {
        clearInterval(retryInterval);
      }
    }, 1500);

    return () => clearInterval(retryInterval);
  }, [activeSubPanel, isUserConnected, queueTracks.length, currentTrackId, song?.title]);

  // Wake-Up Re-sync: Saat status isPlaying beralih dari false ke true dan antrean masih kosong
  const prevIsPlayingRef = useRef<boolean>(song.isPlaying);

  useEffect(() => {
    const wasPaused = !prevIsPlayingRef.current;
    const isNowPlaying = song.isPlaying;
    prevIsPlayingRef.current = song.isPlaying;

    if (wasPaused && isNowPlaying && activeSubPanel === 'queue' && isUserConnected && queueTracks.length === 0) {
      const wakeTimer = setTimeout(() => {
        refreshQueue(false);
      }, 1000);
      return () => clearTimeout(wakeTimer);
    }
  }, [song.isPlaying, activeSubPanel, isUserConnected, queueTracks.length]);

  // Adaptive Gentle Queue & Shuffle Poller (Safe: 1 request / 6s = 10 req/min)
  // Strictly active ONLY when user has the queue subpanel visually open
  useEffect(() => {
    if (activeSubPanel !== 'queue' || !isUserConnected) return;

    const pollerInterval = setInterval(() => {
      refreshQueue(false);
    }, 6000);

    return () => clearInterval(pollerInterval);
  }, [activeSubPanel, isUserConnected]);

  // Cold-Start Queue Hydration Re-sync:
  // When Spotify desktop opens / wakes up, immediately mark session init timestamp
  // and trigger a fresh fetch of the queue 1 time.
  const prevSpotifyRunningRef = useRef(effectiveSpotifyRunning);
  useEffect(() => {
    const wasRunning = prevSpotifyRunningRef.current;
    prevSpotifyRunningRef.current = effectiveSpotifyRunning;

    if (!wasRunning && effectiveSpotifyRunning && isUserConnected) {
      markSessionInit();
      if (activeSubPanel === 'queue') {
        refreshQueue(true);
      }
    }
  }, [effectiveSpotifyRunning, isUserConnected, activeSubPanel]);

  // Reactive Queue Re-sync on Shuffle Change while viewing Queue
  useEffect(() => {
    if (activeSubPanel === 'queue' && isUserConnected) {
      const timer = setTimeout(() => {
        refreshQueue(false);
      }, 400);
      return () => clearTimeout(timer);
    }
  }, [isShuffle, activeSubPanel, isUserConnected]);

  // Load Playlists & Liked Songs count when playlists panel opens
  useEffect(() => {
    if (activeSubPanel === 'playlist' && isUserConnected) {
      setIsLoadingPlaylists(true);
      Promise.all([
        getSpotifyUserPlaylists(20),
        getLikedSongs(1),
      ])
        .then(([items, likedRes]) => {
          if (items && items.length > 0) {
            setPlaylists(items);
          } else if (playlists.length === 0) {
            setPlaylists(items || []);
          }
          setLikedSongsTotal(likedRes.total);
          setIsLoadingPlaylists(false);
        })
        .catch(() => setIsLoadingPlaylists(false));
    }
  }, [activeSubPanel, isUserConnected]);

  // Load tracks when a playlist is selected for drill-down (auto-paging up to 250 tracks)
  useEffect(() => {
    if (!selectedPlaylist) {
      setPlaylistTracks([]);
      return;
    }

    setIsLoadingPlaylistTracks(true);
    if (selectedPlaylist.id === 'liked-songs') {
      getLikedSongs(250)
        .then((res) => {
          setPlaylistTracks(res.tracks);
          res.tracks.forEach((t) => {
            if (t.albumArt) setCachedArtwork(t.title, t.artist, t.albumArt, t.id);
          });
          setLikedSongsTotal(res.total);
          setIsLoadingPlaylistTracks(false);
        })
        .catch(() => setIsLoadingPlaylistTracks(false));
    } else {
      getPlaylistTracks(selectedPlaylist.id, 250)
        .then((tracks) => {
          setPlaylistTracks(tracks);
          tracks.forEach((t) => {
            if (t.albumArt) setCachedArtwork(t.title, t.artist, t.albumArt, t.id);
          });
          setIsLoadingPlaylistTracks(false);
        })
        .catch(() => setIsLoadingPlaylistTracks(false));
    }
  }, [selectedPlaylist]);

  // Auto-detect active track ID and liked status when song changes (delayed 1200ms to avoid API collision during playback)
  useEffect(() => {
    let isMounted = true;
    if (!isUserConnected) return;

    // Fast-path: Check if new song matches an item in current queueTracks immediately (0ms)
    if (song.title && song.title !== 'No Media Playing' && song.title !== 'No Media Active') {
      const match = queueTracks.find(
        (t) =>
          t.title.toLowerCase() === song.title.toLowerCase() ||
          (song.title.toLowerCase().includes(t.title.toLowerCase()) && t.title.length > 3)
      );
      if (match && match.id && match.id !== currentTrackId) {
        setCurrentTrackId(match.id);
      }
    }

    const timer = setTimeout(async () => {
      let trackId = currentTrackId;

      try {
        const queueData = await getSpotifyUserQueue();
        if (queueData?.currentlyPlaying?.id) {
          const qTitle = queueData.currentlyPlaying.title?.toLowerCase().trim() || '';
          const sTitle = song.title?.toLowerCase().trim() || '';
          if (qTitle && sTitle && (qTitle === sTitle || qTitle.includes(sTitle) || sTitle.includes(qTitle))) {
            trackId = queueData.currentlyPlaying.id;
            if (isMounted) setCurrentTrackId(trackId);
          }
        }
      } catch (e) {
        console.debug('Error getting current track from queue:', e);
      }

      if (!trackId && song.title && song.title !== 'No Media Active') {
        try {
          const results = await searchSpotifyTracks(`${song.title} ${song.artist}`, 1);
          if (results.length > 0 && results[0].id) {
            trackId = results[0].id;
            if (isMounted) setCurrentTrackId(trackId);
          }
        } catch (e) {
          console.debug('Error searching current track ID:', e);
        }
      }
    }, 1200);

    return () => {
      isMounted = false;
      clearTimeout(timer);
    };
  }, [song.title, song.artist, isUserConnected]);

  // Debounced search on Spotify Web API
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchSpotifyTracks(searchQuery, 4);
        results.forEach((t) => {
          if (t.albumArt) setCachedArtwork(t.title, t.artist, t.albumArt, t.id);
        });
        setSearchResults(results);
      } catch (err) {
        console.debug('[MusicCardView] Search error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const handleFocusInput = async () => {
    await focusIslandWindow();
    inputRef.current?.focus();
  };

  const handleConnectSpotify = async () => {
    playChimeCue('tap');
    const success = await loginSpotifyUser();
    if (success) {
      playChimeCue('ding');
      setIsUserConnected(true);
      refreshQueue();
    }
  };

  const handlePlaySpotifyTrack = async (track: SpotifyTrackItem) => {
    markUserInitiatedPlayback();
    playChimeCue('tap');

    // Mutual Exclusion: Hentikan CASA Native audio seketika jika sedang berputar
    if (audioRef.current && !audioRef.current.paused) {
      stopNativeAudioInstantly();
    }
    setIsNativePlaying(false);

    // Auto-pause passive non-Spotify sessions (e.g. YouTube in browser)
    const nonSpotifyPlaying = activeSessions.filter(
      (s) => s.is_playing && !s.app_name?.toLowerCase().includes('spotify')
    );
    for (const s of nonSpotifyPlaying) {
      controlMediaSession(s.session_id, 'pause').catch(() => {});
    }

    // Explicit New Track Selection: reset local progress immediately
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    applyProgressUpdate(0, true);
    if (isBrowser) setIsBrowserSpotify(true);

    if (track.albumArt) {
      setCachedArtwork(track.title, track.artist, track.albumArt, track.id);
    }
    setOptimisticTrack({
      title: track.title,
      artist: track.artist,
      albumArt: track.albumArt,
      albumArtUrl: track.albumArt,
    });
    try {
      // Tahap 1 (0ms - Fokus Putar Lagu):
      const normalizedTrackUri = track.uri || `spotify:track:${track.id}`;
      if (track.albumUri) {
        await playTrackWithContext(normalizedTrackUri, track.albumUri, undefined, isBrowser);
      } else {
        await executeSpotifyPlay({ trackUri: normalizedTrackUri, isNewTrack: true, isBrowser });
      }
      setCurrentTrackId(track.id);
      setTimeout(async () => {
        try {
          if (isUserConnected) {
            const prog = await getSpotifyPlaybackProgressMs();
            if (typeof prog === 'number' && prog >= 0) {
              applyProgressUpdate(prog, false);
            }
          }
        } catch {}
      }, 1000);

      // Tahap 2 (Jeda 1200ms - Sinkronisasi Konteks & Queue di Latar Belakang):
      setTimeout(async () => {
        try {
          if (isUserConnected) {
            await refreshQueue();
            const prog = await getSpotifyPlaybackProgressMs();
            if (typeof prog === 'number' && prog >= 0) {
              applyProgressUpdate(prog, false);
            }
          }
        } catch (queueErr) {
          console.debug('[MusicCardView] Background queue sync error:', queueErr);
        }
      }, 1200);
    } catch (err) {
      console.warn('[MusicCardView] failed to play track:', err);
    }
  };

  const handlePlayQueueTrack = async (track: SpotifyTrackItem, trackIdx?: number) => {
    markUserInitiatedPlayback();
    playChimeCue('tap');

    // Mutual Exclusion: Hentikan CASA Native audio seketika jika sedang berputar
    if (audioRef.current && !audioRef.current.paused) {
      stopNativeAudioInstantly();
    }
    setIsNativePlaying(false);

    // Auto-pause passive non-Spotify sessions (e.g. YouTube in browser)
    const nonSpotifyPlaying = activeSessions.filter(
      (s) => s.is_playing && !s.app_name?.toLowerCase().includes('spotify')
    );
    for (const s of nonSpotifyPlaying) {
      controlMediaSession(s.session_id, 'pause').catch(() => {});
    }

    // Explicit New Track Selection: reset local progress immediately
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    applyProgressUpdate(0, true);
    if (isBrowser) setIsBrowserSpotify(true);

    const effectiveQueue = queueTracks;
    const targetTrack = track;
    const idx = typeof trackIdx === 'number' ? trackIdx : effectiveQueue.findIndex((t) => t.id === track.id);

    // 1. Optimistic UI update (0ms Perceived Latency):
    setOptimisticTrack({
      title: targetTrack.title,
      artist: targetTrack.artist,
    });
    if (idx >= 0) {
      setQueueTracks(effectiveQueue.slice(idx + 1));
    }
    setCurrentTrackId(targetTrack.id);

    // 2. Non-blocking Playback Dispatch:
    // Fire playQueueTrack immediately and synchronize queue in the background asynchronously
    try {
      const remainingUris = idx >= 0 ? effectiveQueue.slice(idx + 1).map((t) => t.uri || `spotify:track:${t.id}`) : [];

      playQueueTrack(targetTrack, activeContextUri, remainingUris, isBrowser)
        .then((playOk) => {
          if (!playOk) {
            console.warn('[MusicCardView] playQueueTrack failed, refreshing queue...');
          }
          // Asynchronous background queue revalidation
          refreshQueue(false);
        })
        .catch((err) => {
          console.error('[MusicCardView] playQueueTrack error:', err);
          refreshQueue(false);
        });
    } catch (err) {
      console.error('[MusicCardView] failed to dispatch queue track:', err);
      refreshQueue(false);
    }
  };

  const handlePlayPlaylistTrack = async (track: SpotifyTrackItem) => {
    markUserInitiatedPlayback();
    playChimeCue('tap');

    // Mutual Exclusion: Hentikan CASA Native audio seketika jika sedang berputar
    if (audioRef.current && !audioRef.current.paused) {
      stopNativeAudioInstantly();
    }
    setIsNativePlaying(false);

    // Auto-pause passive non-Spotify sessions (e.g. YouTube in browser)
    const nonSpotifyPlaying = activeSessions.filter(
      (s) => s.is_playing && !s.app_name?.toLowerCase().includes('spotify')
    );
    for (const s of nonSpotifyPlaying) {
      controlMediaSession(s.session_id, 'pause').catch(() => {});
    }

    // Explicit New Track Selection: reset local progress immediately
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    applyProgressUpdate(0, true);
    if (isBrowser) setIsBrowserSpotify(true);

    if (track.albumArt) {
      setCachedArtwork(track.title, track.artist, track.albumArt, track.id);
    }
    setOptimisticTrack({
      title: track.title,
      artist: track.artist,
      albumArt: track.albumArt,
      albumArtUrl: track.albumArt,
    });
    try {
      if (!selectedPlaylist) return;
      if (selectedPlaylist.id === 'liked-songs') {
        await executeSpotifyPlay({
          trackUri: track.uri || `spotify:track:${track.id}`,
          uris: playlistTracks.map((t) => t.uri || `spotify:track:${t.id}`),
          isNewTrack: true,
          isBrowser,
        });
      } else {
        await executeSpotifyPlay({
          trackUri: track.uri || `spotify:track:${track.id}`,
          contextUri: selectedPlaylist.uri,
          isNewTrack: true,
          isBrowser,
        });
      }
      setCurrentTrackId(track.id);
      setTimeout(async () => {
        try {
          if (isUserConnected) {
            const prog = await getSpotifyPlaybackProgressMs();
            if (typeof prog === 'number' && prog >= 0) {
              applyProgressUpdate(prog, false);
            }
          }
        } catch {}
      }, 1000);
    } catch (err) {
      console.warn('[MusicCardView] failed to play playlist track:', err);
    }
  };

  const handlePlayAllInPlaylist = async () => {
    if (!selectedPlaylist) return;
    playChimeCue('tap');
    // Auto-pause passive non-Spotify sessions (e.g. YouTube in browser)
    const nonSpotifyPlaying = activeSessions.filter(
      (s) => s.is_playing && !s.app_name?.toLowerCase().includes('spotify')
    );
    for (const s of nonSpotifyPlaying) {
      controlMediaSession(s.session_id, 'pause').catch(() => {});
    }

    // Explicit New Track Selection: reset local progress immediately
    setLastKnownPositionMs(0);
    clearPlayGuardWindow();
    applyProgressUpdate(0, true);
    if (isBrowser) setIsBrowserSpotify(true);

    const first = playlistTracks[0];
    if (first) {
      setOptimisticTrack({
        title: first.title,
        artist: first.artist,
        albumArt: first.albumArt,
        albumArtUrl: first.albumArt,
      });
    }
    try {
      if (selectedPlaylist.id === 'liked-songs') {
        if (playlistTracks.length > 0) {
          await executeSpotifyPlay({
            trackUri: playlistTracks[0].uri || `spotify:track:${playlistTracks[0].id}`,
            uris: playlistTracks.map((t) => t.uri || `spotify:track:${t.id}`),
            isNewTrack: true,
            isBrowser,
          });
          setCurrentTrackId(playlistTracks[0].id);
        }
      } else {
        await executeSpotifyPlay({
          contextUri: selectedPlaylist.uri,
          trackUri: playlistTracks[0] ? (playlistTracks[0].uri || `spotify:track:${playlistTracks[0].id}`) : undefined,
          isNewTrack: true,
          isBrowser,
        });
        if (playlistTracks[0]?.id) {
          setCurrentTrackId(playlistTracks[0].id);
        }
      }
    } catch (err) {
      console.warn('[MusicCardView] failed to play all in playlist:', err);
    }
  };

  const handlePlayerSeek = useCallback(
    (targetSeconds: number) => {
      const validSeconds = parseTimeToSeconds(targetSeconds);
      if (playbackSource === 'native') {
        handleSeekNative(validSeconds);
        handleLyricLineSeek(validSeconds);
      } else {
        handleLyricLineSeek(validSeconds);
      }
    },
    [playbackSource, handleSeekNative, handleLyricLineSeek]
  );

  const handleMainTogglePlay = useCallback(() => {
    if (!hasActiveSession) return;
    playChimeCue('tap');
    if (playbackSource === 'native') {
      toggleNativePlayPause();
      return;
    }
    // Mutual Exclusion: Saat memulai pemutaran Spotify, hentikan CASA Native audio
    if (!song.isPlaying) {
      if (audioRef.current && !audioRef.current.paused) {
        stopNativeAudioInstantly();
      }
      setIsNativePlaying(false);
      markUserInitiatedPlayback();
    }
    onTogglePlay();
  }, [hasActiveSession, playbackSource, toggleNativePlayPause, song.isPlaying, onTogglePlay, stopNativeAudioInstantly, setIsNativePlaying]);

  const handleAddToQueue = async (track: SpotifyTrackItem) => {
    playChimeCue('tap');
    setAddedQueueId(track.id);
    setTimeout(() => setAddedQueueId(null), 1500);

    useQueueStore.getState().addToManualQueue(track);

    if (isUserConnected) {
      await addTrackToSpotifyQueue(track.uri || `spotify:track:${track.id}`);
    }
  };

  const handleShuffleToggle = async () => {
    playChimeCue('tap');
    const previousState = isShuffle;
    onToggleShuffle();
    useQueueStore.getState().toggleShuffle();

    if (isUserConnected) {
      const ok = await setShufflePlayback(!previousState);
      if (!ok) {
        onToggleShuffle();
      } else {
        setTimeout(() => refreshQueue(false), 400);
      }
    }
  };

  // Smart Dual-Action Previous:
  // 1. If song position > 3s: rewinds current track to 0:00 in reality.
  // 2. If song position <= 3s: calls true previous track (onPrev).
  const handlePrevious = async () => {
    playChimeCue('tap');

    if (playbackSource === 'native') {
      if (nativeCurrentTime > 3) {
        handleSeekNative(0);
        handleLyricLineSeek(0);
      } else {
        handlePrevNativeTrack(nativeCurrentTime);
      }
      return;
    }

    if (preciseTimeMs > 3000) {
      handleLyricLineSeek(0);
      return;
    }

    if (onPrev) {
      onPrev();
    }
  };

  const handleNext = () => {
    playChimeCue('tap');

    if (playbackSource === 'native') {
      handleNextNativeTrack();
      return;
    }

    if (onNext) {
      onNext();
    }
  };

  // CASA Native Drawers (Modularized Sub-components)
  const renderNativeDrawers = () => (
    <>
      <NativeSearchDrawer
        isOpen={isNativeSearchOpen && playbackSource === 'native'}
        onClose={() => setIsNativeSearchOpen(false)}
        onPlayTrack={handleSelectNativeTrack}
        onAddToQueue={handleAddToNativeQueue}
        currentTrackId={nativeTrack?.id}
        isResolvingAudio={isResolvingAudio}
        addedTrackId={addedNativeTrackId}
      />
      <NativeQueueDrawer
        isOpen={isNativeQueueOpen && playbackSource === 'native'}
        onClose={() => setIsNativeQueueOpen(false)}
        queue={nativeQueue}
        currentIndex={nativeQueueIndex}
        onSelectTrack={playTrackAtIndex}
        onRemoveTrack={handleRemoveFromNativeQueue}
        onClearQueue={handleClearNativeQueue}
        onOpenSearch={() => setIsNativeSearchOpen(true)}
        isPlaying={isNativePlaying}
        isResolvingAudio={isResolvingAudio}
      />
    </>
  );

  // Active media session verification (hasActiveSession declared above for resilient artwork pipeline)

  const effectiveQueueLength =
    playbackSource === 'native' ? nativeQueue.length : queueTracks.length;

  const isCompanionEmpty =
    playbackSource === 'companion' &&
    !hasActiveSession &&
    (activeSubPanel === 'none' || activeSubPanel === 'lyrics' || activeSubPanel === 'queue');

  return (
    <div
      className="relative w-full max-w-[620px] h-full min-h-0 overflow-visible"
    >
      {isCompanionEmpty ? (
        <EmptyMediaView
          playbackSource={playbackSource}
          activeSubPanel={activeSubPanel}
          queueLength={effectiveQueueLength}
          isSpotifySession={isSpotifySession}
          isQueueOpen={isNativeQueueOpen}
          isRefreshingLyrics={isRefreshingLyrics}
          isRefreshingSession={isRefreshingSession}
          isWakingSpotify={isWakingSpotify}
          onSelectSource={handleSelectSource}
          onToggleSearch={() => {
            setIsNativeSearchOpen(true);
            setIsNativeQueueOpen(false);
          }}
          onToggleQueue={() => {
            setIsNativeQueueOpen((prev) => !prev);
            setIsNativeSearchOpen(false);
          }}
          onRefreshLyrics={handleRefreshLyrics}
          onRefreshSession={handleRefreshSession}
          onOpenSpotify={async () => {
            playChimeCue('tap');
            await focusSpotifyWindow();
            if (isUserConnected) {
              refreshQueue();
            }
          }}
          onOpenPlaylist={() => switchSubPanel('playlist')}
          onQuitSpotify={handleQuitSpotify}
        />
      ) : activeSubPanel === 'none' ? (
        <UnifiedWideView
          playbackSource={playbackSource}
          nativeTrack={nativeTrack}
          onOpenLocalFile={handleOpenLocalFiles}
          activeSubPanel={activeSubPanel}
          queueLength={effectiveQueueLength}
          isEffectivePlaying={isEffectivePlaying}
          hasActiveSession={hasActiveSession}
          canAccessSpotifyFeatures={canAccessSpotifyFeatures}
          isWakingSpotify={isWakingSpotify}
          isResolvingAudio={isResolvingAudio}
          nativeAudioError={nativeAudioError}
          isSpotifySession={isSpotifySession}
          isQueueOpen={isNativeQueueOpen}
          isRefreshingLyrics={isRefreshingLyrics}
          isRefreshingSession={isRefreshingSession}
          currentSessionId={currentSessionId}
          effectiveArtwork={effectiveArtwork}
          effectiveTitle={effectiveTitle}
          effectiveArtist={effectiveArtist}
          currentTimeSeconds={playbackSource === 'native' ? nativeCurrentTime : preciseTimeMs / 1000}
          durationSeconds={effectiveDuration}
          isShuffle={isShuffle}
          isSmartShuffle={isSmartShuffle}
          isRepeat={isRepeat}
          onToggleRepeat={handleToggleRepeat}
          audioOutput={audioOutput}
          audioDeviceType={systemTelemetry.audio_device_type}
          audioDeviceName={systemTelemetry.audio_device_name}
          masterVolume={systemTelemetry.master_volume}
          isMuted={systemTelemetry.is_muted}
          batteryPercentage={systemTelemetry.battery_percentage}
          isCharging={systemTelemetry.is_charging}
          hasBattery={systemTelemetry.has_battery}
          isCapsLocked={systemTelemetry.is_caps_locked}
          onToggleMute={toggleSystemMute}
          activeAppName={activeSession?.app_name}
          sessionCount={activeSessions.length}
          onOpenSpotify={async () => {
            playChimeCue('tap');
            await focusSpotifyWindow();
          }}
          onQuitSpotify={handleQuitSpotify}
          onCoverImageLoad={handleCoverImageLoad}
          onCoverImageError={handleCoverImageError}
          onSelectSource={handleSelectSource}
          onToggleSearch={() => {
            if (playbackSource === 'native') {
              playChimeCue('tap');
              setInternalSubPanel('search');
              try {
                localStorage.setItem('casa_active_subpanel', 'search');
              } catch {}
              onSubPanelChange?.('search');
            } else {
              setIsNativeSearchOpen(true);
              setIsNativeQueueOpen(false);
            }
          }}
          onToggleQueue={() => {
            if (playbackSource === 'native') {
              playChimeCue('tap');
              setInternalSubPanel('queue');
              try {
                localStorage.setItem('casa_active_subpanel', 'queue');
              } catch {}
              onSubPanelChange?.('queue');
            } else {
              setIsNativeQueueOpen((prev) => !prev);
              setIsNativeSearchOpen(false);
            }
          }}
          onRefreshLyrics={handleRefreshLyrics}
          onRefreshSession={handleRefreshSession}
          onToggleAudioOutput={() => {
            playChimeCue('tap');
            onToggleAudioOutput();
          }}
          onContextMenuAudioOutput={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (activeSessions.length > 1) {
              setIsSessionPopoverOpen((prev) => !prev);
            }
          }}
          onSeek={handlePlayerSeek}
          onToggleShuffle={handleShuffleToggle}
          onPrev={handlePrevious}
          onTogglePlay={handleMainTogglePlay}
          onNext={handleNext}
          onSwitchSubPanel={switchSubPanel}
          onEjectNative={handleEjectNative}
        />
      ) : (
        <SplitPlayerView
          playbackSource={playbackSource}
          nativeTrack={nativeTrack}
          nativeQueue={nativeQueue}
          nativeQueueIndex={nativeQueueIndex}
          onSelectNativeTrack={playTrackAtIndex}
          onRemoveNativeTrack={handleRemoveFromNativeQueue}
          onClearNativeQueue={handleClearNativeQueue}
          onPlayNativeSearchTrack={handleSelectNativeTrack}
          onAddToNativeQueue={handleAddToNativeQueue}
          addedNativeTrackId={addedNativeTrackId}
          onOpenLocalFile={handleOpenLocalFiles}
          onFilesDropped={handleFilesDropped}
          activeSubPanel={activeSubPanel}
          queueLength={effectiveQueueLength}
          isEffectivePlaying={isEffectivePlaying}
          hasActiveSession={hasActiveSession}
          canAccessSpotifyFeatures={canAccessSpotifyFeatures}
          isWakingSpotify={isWakingSpotify}
          isResolvingAudio={isResolvingAudio}
          isSpotifySession={isSpotifySession}
          isQueueOpen={isNativeQueueOpen}
          isRefreshingLyrics={isRefreshingLyrics}
          isRefreshingSession={isRefreshingSession}
          currentSessionId={currentSessionId}
          effectiveArtwork={effectiveArtwork}
          effectiveTitle={effectiveTitle}
          effectiveArtist={effectiveArtist}
          audioOutput={audioOutput}
          audioDeviceType={systemTelemetry.audio_device_type}
          audioDeviceName={systemTelemetry.audio_device_name}
          masterVolume={systemTelemetry.master_volume}
          isMuted={systemTelemetry.is_muted}
          batteryPercentage={systemTelemetry.battery_percentage}
          isCharging={systemTelemetry.is_charging}
          hasBattery={systemTelemetry.has_battery}
          isCapsLocked={systemTelemetry.is_caps_locked}
          onToggleMute={toggleSystemMute}
          activeAppName={activeSession?.app_name}
          sessionCount={activeSessions.length}
          currentTimeSeconds={playbackSource === 'native' ? nativeCurrentTime : preciseTimeMs / 1000}
          durationSeconds={effectiveDuration}
          isShuffle={isShuffle}
          isSmartShuffle={isSmartShuffle}
          isRepeat={isRepeat}
          onToggleRepeat={handleToggleRepeat}
          queueContextTitle={queueContextTitle}
          isLoadingPlaylists={isLoadingPlaylists}
          isLoadingPlaylistTracks={isLoadingPlaylistTracks}
          isLoadingQueue={isLoadingQueue}
          isSearching={isSearching}
          displayLines={displayLines}
          activeLyricIndex={activeLyricIndex}
          isSyncedLyrics={isSyncedLyrics}
          lyricsContainerRef={lyricsContainerRef}
          isMidSongInstrumental={isMidSongInstrumental}
          audioAdjustedTime={audioAdjustedTime}
          isUserConnected={isUserConnected}
          playlists={playlists}
          selectedPlaylist={selectedPlaylist}
          playlistTracks={playlistTracks}
          likedSongsTotal={likedSongsTotal}
          queueTracks={queueTracks}
          searchQuery={searchQuery}
          searchResults={searchResults}
          addedQueueId={addedQueueId}
          inputRef={inputRef}
          onOpenSpotify={async () => {
            playChimeCue('tap');
            await focusSpotifyWindow();
          }}
          onQuitSpotify={handleQuitSpotify}
          onCoverImageLoad={handleCoverImageLoad}
          onCoverImageError={handleCoverImageError}
          onToggleAudioOutput={() => {
            playChimeCue('tap');
            onToggleAudioOutput();
          }}
          onContextMenuAudioOutput={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (activeSessions.length > 1) {
              setIsSessionPopoverOpen((prev) => !prev);
            }
          }}
          onSeek={handlePlayerSeek}
          onToggleShuffle={handleShuffleToggle}
          onPrev={handlePrevious}
          onTogglePlay={handleMainTogglePlay}
          onNext={handleNext}
          onSwitchSubPanel={switchSubPanel}
          onSelectSource={handleSelectSource}
          onToggleSearch={() => {
            setIsNativeSearchOpen(true);
            setIsNativeQueueOpen(false);
          }}
          onToggleQueue={() => {
            setIsNativeQueueOpen((prev) => !prev);
            setIsNativeSearchOpen(false);
          }}
          onRefreshLyrics={handleRefreshLyrics}
          onRefreshSession={handleRefreshSession}
          onPrevPanel={handlePrevPanel}
          onNextPanel={handleNextPanel}
          onLyricLineSeek={handlePlayerSeek}
          onSelectPlaylist={setSelectedPlaylist}
          onPlayPlaylistTrack={handlePlayPlaylistTrack}
          onPlayAllInPlaylist={handlePlayAllInPlaylist}
          onConnectSpotify={handleConnectSpotify}
          onPlayQueueTrack={handlePlayQueueTrack}
          onSearchQueryChange={setSearchQuery}
          onPlaySearchTrack={handlePlaySpotifyTrack}
          onAddToQueue={handleAddToQueue}
          onFocusInput={handleFocusInput}
          setIsSearchFocused={setIsSearchFocused}
          onEjectNative={handleEjectNative}
          isLoadingLyrics={isRefreshingLyrics}
        />
      )}
      {renderSessionPopover()}
      {renderNativeDrawers()}
      <input
        ref={localFileInputRef}
        type="file"
        accept="audio/*,.mp3,.flac,.wav,.ogg,.m4a,.aac,.opus"
        multiple
        className="hidden"
        onChange={handleLocalFilesSelected}
      />
    </div>
  );
};
