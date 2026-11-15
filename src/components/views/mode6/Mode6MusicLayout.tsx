import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Play,
  Pause,
  Square,
  SkipBack,
  SkipForward,
  Search,
  ListMusic,
  AlignLeft,
  X,
  Plus,
  Check,
  Loader2,
  Music,
  FolderOpen,
  RotateCw,
  Trash2,
  Shuffle,
  Repeat,
  Volume2,
  Bluetooth,
  Headphones,
} from 'lucide-react';
import { useSystemHardware, formatAudioOutputLabel } from '../../../hooks/useSystemHardware';
import { LyricsPanel } from '../music/LyricsPanel';
import { AddToPlaylistPopover } from '../music/AddToPlaylistPopover';
import { MusicPlaylistView } from '../music/MusicPlaylistView';
import { MusicQueueView } from '../music/MusicQueueView';
import { formatDuration } from '../music/constants';
import { LyricLine } from '../../../utils/lyricsService';
import { SpotifyTrackItem } from '../../../utils/spotifyService';
import { NativeTrack, searchTracks } from '../../../services/nativeAudioService';
import { playChimeCue, focusIslandWindow } from '../../../utils/tauriBridge';
import { useMusicAffinity } from '../../../hooks/useMusicAffinity';
import { useQueueStore } from '../../../stores/useQueueStore';
import { setSearchDrawerExtraHeight } from '../../../utils/islandLayoutState';
import {
  normalizeTrackForPlaylist,
  normalizeTrackMetadata,
} from '../../../utils/musicQueueEngine';

const SpotifyCornerLogo: React.FC<{ className?: string }> = ({ className = 'w-3 h-3' }) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
    <path d="M12 0C5.4 0 0 5.4 0 12s5.4 12 12 12 12-5.4 12-12S18.66 0 12 0zm5.521 17.34c-.24.359-.66.48-1.021.24-2.82-1.74-6.36-2.101-10.561-1.141-.418.122-.779-.179-.899-.539-.12-.421.18-.78.54-.9 4.56-1.021 8.52-.6 11.64 1.32.42.18.479.659.301 1.02zm1.44-3.3c-.301.42-.841.6-1.262.3-3.239-1.98-8.159-2.58-11.939-1.38-.479.12-1.02-.12-1.14-.6-.12-.48.12-1.021.6-1.141C9.6 9.9 15 10.561 18.72 12.84c.361.181.54.78.241 1.2zm.12-3.36C15.24 8.4 8.82 8.16 5.16 9.301c-.6.179-1.2-.181-1.38-.721-.18-.601.18-1.2.72-1.381 4.26-1.26 11.28-1.02 15.72 1.621.539.3.719 1.02.419 1.56-.299.421-1.02.599-1.559.3z" />
  </svg>
);

export interface Mode6MusicLayoutProps {
  playbackSource: 'companion' | 'native';
  onSelectSource: (source: 'companion' | 'native') => void;
  hasActiveSession: boolean;
  isSpotifySession: boolean;
  isUserConnected: boolean;
  canUseSpotifyPremium?: boolean;
  onConnectSpotify: () => void;
  activeAppName?: string;
  sessionCount?: number;
  onOpenSessionPopover?: () => void;

  // Track Display & Controls
  effectiveArtwork: string | null;
  effectiveTitle: string;
  effectiveArtist: string;
  isEffectivePlaying: boolean;
  isResolvingAudio?: boolean;
  nativeAudioError?: string | null;
  currentTimeSeconds: number;
  durationSeconds: number;
  onSeek: (targetSeconds: number) => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onStopMedia: () => void;
  onCoverImageLoad?: () => void;
  onCoverImageError?: () => void;

  // On-Demand Lyrics & Idle Lyrics
  mainBoxWidth?: number;
  isLyricsOpen: boolean;
  onToggleLyrics: () => void;
  isIdleLyricsEnabled: boolean;
  onToggleIdleLyrics: () => void;
  displayLines: LyricLine[];
  activeLyricIndex: number;
  isSyncedLyrics: boolean;
  isInstrumental: boolean;
  lyricsContainerRef: React.RefObject<HTMLDivElement | null>;
  isMidSongInstrumental: boolean;
  audioAdjustedTime: number;
  isLoadingLyrics?: boolean;
  onRefreshLyrics: () => void;
  onLyricLineSeek: (targetSeconds: number) => void;

  // Detached Satellite Pods
  podHostEl?: HTMLDivElement | null;
  isSearchPodOpen: boolean;
  isQueuePodOpen: boolean;
  onToggleSearchPod: () => void;
  onToggleQueuePod: () => void;
  onCloseSearchPod: () => void;
  onCloseQueuePod: () => void;
  onInteractionLock?: () => void;

  // Spotify Search & Queue
  spotifySearchQuery: string;
  onSpotifySearchQueryChange: (q: string) => void;
  spotifySearchResults: SpotifyTrackItem[];
  isSearchingSpotify: boolean;
  onPlaySpotifyTrack: (track: SpotifyTrackItem) => void;
  onAddSpotifyToQueue: (track: SpotifyTrackItem) => void;
  addedSpotifyQueueId: string | null;
  spotifyQueueTracks: SpotifyTrackItem[];
  spotifyQueueContextTitle: string;
  isLoadingSpotifyQueue: boolean;
  onPlaySpotifyQueueTrack: (track: SpotifyTrackItem, idx: number) => void;

  // Native Search & Queue
  nativeTrack: NativeTrack | null;
  nativeQueue: NativeTrack[];
  nativeQueueIndex: number;
  onPlayNativeSearchTrack: (track: NativeTrack, currentList: NativeTrack[]) => void;
  onAddToNativeQueue: (e: React.MouseEvent | null, track: NativeTrack) => void;
  addedNativeTrackId: string | null;
  onSelectNativeQueueTrack: (index: number) => void;
  onRemoveNativeQueueTrack: (e: React.MouseEvent, index: number) => void;
  onClearNativeQueue: (e: React.MouseEvent) => void;
  onOpenLocalFile: () => void;

  // Phase 6.0 Unified Transport, Playlist & Smart Queue Controls
  isShuffle?: boolean;
  onToggleShuffle?: () => void;
  isRepeat?: boolean;
  onToggleRepeat?: () => void;
  onPlaySmartQueueTrack?: (index: number) => void;
  onRemoveSmartQueueTrack?: (index: number) => void;
}

export const Mode6MusicLayout: React.FC<Mode6MusicLayoutProps> = ({
  playbackSource,
  onSelectSource: _onSelectSource,
  hasActiveSession,
  isSpotifySession,
  isUserConnected,
  canUseSpotifyPremium = true,
  onConnectSpotify: _onConnectSpotify,
  activeAppName: _activeAppName,
  sessionCount = 0,
  onOpenSessionPopover,
  effectiveArtwork,
  effectiveTitle,
  effectiveArtist,
  isEffectivePlaying,
  isResolvingAudio = false,
  nativeAudioError = null,
  currentTimeSeconds,
  durationSeconds,
  onSeek,
  onPrev,
  onTogglePlay,
  onNext,
  onStopMedia,
  onCoverImageLoad,
  onCoverImageError,
  mainBoxWidth,
  isLyricsOpen,
  onToggleLyrics,
  isIdleLyricsEnabled,
  onToggleIdleLyrics,
  displayLines,
  activeLyricIndex,
  isSyncedLyrics,
  isInstrumental,
  lyricsContainerRef,
  isMidSongInstrumental,
  audioAdjustedTime,
  isLoadingLyrics = false,
  onRefreshLyrics,
  onLyricLineSeek,
  podHostEl,
  isSearchPodOpen,
  isQueuePodOpen,
  onToggleSearchPod,
  onToggleQueuePod,
  onCloseSearchPod,
  onCloseQueuePod,
  onInteractionLock,
  spotifySearchQuery,
  onSpotifySearchQueryChange,
  spotifySearchResults,
  isSearchingSpotify,
  onPlaySpotifyTrack,
  onAddSpotifyToQueue,
  addedSpotifyQueueId,
  spotifyQueueTracks,
  spotifyQueueContextTitle,
  isLoadingSpotifyQueue,
  onPlaySpotifyQueueTrack,
  nativeTrack,
  nativeQueue,
  nativeQueueIndex,
  onPlayNativeSearchTrack,
  onAddToNativeQueue,
  addedNativeTrackId,
  onSelectNativeQueueTrack,
  onRemoveNativeQueueTrack,
  onClearNativeQueue,
  onOpenLocalFile,
  isShuffle,
  onToggleShuffle,
  isRepeat,
  onToggleRepeat,
  onPlaySmartQueueTrack,
  onRemoveSmartQueueTrack,
}) => {
  // Interactive scrub bar state
  const { telemetry: hardwareTelemetry } = useSystemHardware();
  const musicAudioOutputLabel = formatAudioOutputLabel(
    hardwareTelemetry.audio_output_kind,
    hardwareTelemetry.audio_output_battery
  );
  const progressRef = useRef<HTMLDivElement>(null);
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPercent, setScrubPercent] = useState<number | null>(null);

  const effectiveLoadingLyrics = Boolean(hasActiveSession && isLoadingLyrics);
  const effectiveDisplayLines = hasActiveSession ? displayLines : [];
  const effectiveIsInstrumental = hasActiveSession ? isInstrumental : false;

  const syncStartedAtRef = useRef<number | null>(null);
  const [canForceResync, setCanForceResync] = useState(false);
  const [syncAttemptTick, setSyncAttemptTick] = useState(0);

  useEffect(() => {
    if (!hasActiveSession) {
      setIsScrubbing(false);
      setScrubPercent(null);
      syncStartedAtRef.current = null;
      setCanForceResync(false);
    }
  }, [hasActiveSession]);

  useEffect(() => {
    if (!effectiveLoadingLyrics) {
      syncStartedAtRef.current = null;
      setCanForceResync(false);
      return;
    }
    if (syncStartedAtRef.current === null) {
      syncStartedAtRef.current = Date.now();
    }
    setCanForceResync(false);
    const timer = setTimeout(() => {
      setCanForceResync(true);
    }, 3000);
    return () => clearTimeout(timer);
  }, [effectiveLoadingLyrics, effectiveTitle, effectiveArtist, syncAttemptTick]);

  // Standby (No Media Playing) & CASA Player langsung diarahkan ke perpustakaan dan antrean CASA Player
  const isCasaLibraryMode = playbackSource === 'native' || !hasActiveSession;
  // Spotify Search & Queue hanya tersedia bila media Spotify aktif dengan sesi Web API Premium
  const isSpotifyPremiumPodsActive = Boolean(
    !isCasaLibraryMode && isSpotifySession && isUserConnected && canUseSpotifyPremium
  );
  // Sembunyikan Search & Queue saat memutar media GSMTC non-Spotify (browser/YouTube) atau Spotify Free
  const canShowSearchAndQueue = isCasaLibraryMode || isSpotifyPremiumPodsActive;
  const showSpotifyCornerBadge = Boolean(
    hasActiveSession && playbackSource !== 'native' && isSpotifySession
  );

  // Auto-close left/right satellite pods immediately if Search & Queue are unavailable
  useEffect(() => {
    if (!canShowSearchAndQueue) {
      if (isSearchPodOpen) onCloseSearchPod();
      if (isQueuePodOpen) onCloseQueuePod();
    }
  }, [canShowSearchAndQueue, isSearchPodOpen, isQueuePodOpen, onCloseSearchPod, onCloseQueuePod]);

  // Adaptive Music Affinity & Unified Queue Stores
  const { suggestionChips, affinityTracks, recordSearchQuery } = useMusicAffinity();
  const storeManualQueue = useQueueStore((s) => s.manualQueue) as unknown as NativeTrack[];
  const storeSmartQueue = useQueueStore((s) => s.radioQueue) as unknown as NativeTrack[];
  const storeIsShuffle = useQueueStore((s) => s.isShuffle);
  const storeToggleShuffle = useQueueStore((s) => s.toggleShuffle);
  const storeIsRepeat = useQueueStore((s) => s.isRepeat);
  const storeIsFetchingSmart = useQueueStore((s) => s.isFetchingRadio);
  const storeRemoveManualTrack = useQueueStore((s) => s.removeFromManualQueue);
  const storeRemoveSmartTrack = useQueueStore((s) => s.removeFromRadioQueue);

  // Mode 6 compact sub-navigation: Player | Playlists | Queue
  const [musicSubTab, setMusicSubTab] = useState<'player' | 'playlists' | 'queue'>('player');

  // Native Search state scoped inside Search Pod when in CASA Player / Standby
  const [nativeQuery, setNativeQuery] = useState('');
  const [nativeResults, setNativeResults] = useState<NativeTrack[]>([]);
  const [isSearchingNative, setIsSearchingNative] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const leftSearchPodRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!isSearchPodOpen || !canShowSearchAndQueue) {
      setSearchDrawerExtraHeight(0);
    }
    return () => {
      setSearchDrawerExtraHeight(0);
    };
  }, [isSearchPodOpen, canShowSearchAndQueue]);

  // Auto-focus search input & Win32 window when Search Pod opens
  useEffect(() => {
    if (isSearchPodOpen && canShowSearchAndQueue) {
      const t = setTimeout(() => {
        void focusIslandWindow();
        searchInputRef.current?.focus();
      }, 60);
      return () => clearTimeout(t);
    }
  }, [isSearchPodOpen, canShowSearchAndQueue]);

  // Clear CASA Player search query only when external companion playback overrides CASA Library mode
  useEffect(() => {
    if (!isCasaLibraryMode) {
      setNativeQuery('');
      setNativeResults([]);
      setIsSearchingNative(false);
    }
  }, [isCasaLibraryMode]);

  // Debounced InnerTube Search when Search Pod is open in CASA Player or Standby
  useEffect(() => {
    if (!isSearchPodOpen || !canShowSearchAndQueue || !isCasaLibraryMode) return;
    const q = nativeQuery.trim();
    if (!q) {
      setNativeResults([]);
      setIsSearchingNative(false);
      return;
    }

    setIsSearchingNative(true);
    const timer = setTimeout(async () => {
      try {
        const res = await searchTracks(q);
        setNativeResults(res);
      } catch (err) {
        console.warn('[Mode6MusicLayout] native searchTracks error:', err);
      } finally {
        setIsSearchingNative(false);
      }
    }, 320);

    return () => clearTimeout(timer);
  }, [nativeQuery, isSearchPodOpen, canShowSearchAndQueue, isCasaLibraryMode]);

  useEffect(() => {
    setIsScrubbing(false);
    setScrubPercent(null);
  }, [effectiveTitle, playbackSource, hasActiveSession]);

  const displayDurationSec =
    typeof durationSeconds === 'number' && Number.isFinite(durationSeconds) && durationSeconds > 0
      ? durationSeconds
      : 0;
  const rawElapsedSec =
    displayDurationSec > 0
      ? Math.min(
          displayDurationSec,
          Math.max(0, Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : 0)
        )
      : Math.max(0, Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : 0);
  const displayElapsedSec =
    isScrubbing && scrubPercent !== null && displayDurationSec > 0
      ? Math.min(displayDurationSec, Math.max(0, (scrubPercent / 100) * displayDurationSec))
      : rawElapsedSec;
  const progressPercent =
    displayDurationSec > 0
      ? Math.min(100, Math.max(0, (displayElapsedSec / displayDurationSec) * 100))
      : 0;

  const computeRatioFromClientX = (clientX: number) => {
    const rect = progressRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return 0;
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  };

  const handleScrubDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (displayDurationSec <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsScrubbing(true);
    const ratio = computeRatioFromClientX(e.clientX);
    setScrubPercent(ratio * 100);
  };

  const handleScrubMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing || displayDurationSec <= 0) return;
    e.stopPropagation();
    const ratio = computeRatioFromClientX(e.clientX);
    setScrubPercent(ratio * 100);
  };

  const handleScrubUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    const ratio = computeRatioFromClientX(e.clientX);
    setIsScrubbing(false);
    setScrubPercent(null);
    if (displayDurationSec > 0) {
      playChimeCue('tap');
      onSeek(ratio * displayDurationSec);
    }
  };

  const displayedTitle = hasActiveSession
    ? effectiveTitle
    : 'No Media Playing';

  const displayedArtist = hasActiveSession
    ? effectiveArtist
    : 'Pilih lagu atau putar media';

  const effectiveShuffle = isShuffle ?? storeIsShuffle;
  const effectiveRepeat = isRepeat ?? storeIsRepeat;
  const handleShuffleAction = () => {
    playChimeCue('tap');
    if (onToggleShuffle) {
      onToggleShuffle();
    } else {
      storeToggleShuffle();
    }
  };
  const handleRepeatAction = () => {
    playChimeCue('tap');
    if (onToggleRepeat) {
      onToggleRepeat();
    } else {
      useQueueStore.getState().setRepeat(!storeIsRepeat);
    }
  };

  const activeTrackPayload = hasActiveSession
    ? normalizeTrackForPlaylist({
        id: nativeTrack?.id || `${effectiveTitle}-${effectiveArtist}`,
        title: effectiveTitle,
        artist: effectiveArtist,
        durationSeconds: durationSeconds || nativeTrack?.durationSeconds || 0,
        thumbnailUrl: effectiveArtwork || nativeTrack?.thumbnailUrl || '',
        albumArt: effectiveArtwork || nativeTrack?.albumArt || '',
        streamUrl: nativeTrack?.streamUrl,
        candidates: nativeTrack?.candidates,
        isLocal: nativeTrack?.isLocal,
        source: isCasaLibraryMode ? 'native' : 'spotify',
      })
    : null;

  const affinityAsNativeTracks: NativeTrack[] = affinityTracks.map((t) => ({
    id: t.id,
    title: t.title,
    artist: t.artist,
    durationSeconds: t.durationSeconds,
    thumbnailUrl: t.thumbnailUrl,
    albumArt: t.albumArt,
    streamUrl: t.streamUrl,
    candidates: t.candidates,
    isLocal: t.isLocal,
    source: t.source,
  }));

  const displayedNativeList = nativeQuery.trim() ? nativeResults : affinityAsNativeTracks;
  const resolvedMainWidth = mainBoxWidth ?? (isLyricsOpen ? 640 : 480);
  const podHeight = isLyricsOpen ? 177 : 171;
  const POD_WIDTH = 204;
  const leftPodX = Math.round(550 - resolvedMainWidth / 2 - 10 - POD_WIDTH);
  const rightPodX = Math.round(550 + resolvedMainWidth / 2 + 10);

  const podsMarkup = (
    <div
      className="pointer-events-none w-[1100px] min-h-[196px] overflow-visible relative select-none"
      data-tauri-drag-region="false"
    >
      {/* LEFT SATELLITE POD: SEARCH (10px gap left of adaptive Mode 6 box) */}
      <AnimatePresence>
        {canShowSearchAndQueue && isSearchPodOpen && (
          <motion.aside
            ref={leftSearchPodRef}
            key="left-search-pod"
            data-pod="left"
            data-satellite-pod="true"
            initial={{ opacity: 0, x: 14, scale: 0.96, left: leftPodX, height: podHeight }}
            animate={{ opacity: 1, x: 0, scale: 1, left: leftPodX, height: podHeight }}
            exit={{ opacity: 0, x: 10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            onPointerDown={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onWheel={(e) => e.stopPropagation()}
            style={{
              top: 15,
              width: POD_WIDTH,
            }}
            className="pointer-events-auto absolute bg-[#000000] border border-white/[0.12] rounded-2xl p-2.5 flex flex-col gap-2 shadow-[0_12px_32px_rgba(0,0,0,0.9)] overflow-visible"
          >
            {/* Search Input Header */}
            <div className="flex items-center gap-1.5 shrink-0">
              <div className="flex items-center gap-1.5 flex-1 min-w-0 h-[26px] px-2 rounded-lg bg-[#0d0d10] border border-white/[0.12] focus-within:border-white/40 transition-colors">
                {(isCasaLibraryMode ? isSearchingNative : isSearchingSpotify) ? (
                  <Loader2 className="w-3 h-3 text-white/70 animate-spin shrink-0" />
                ) : (
                  <Search className="w-3 h-3 text-white/45 shrink-0" />
                )}
                <input
                  ref={searchInputRef}
                  type="text"
                  value={isCasaLibraryMode ? nativeQuery : spotifySearchQuery}
                  onFocus={() => {
                    void focusIslandWindow();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    void focusIslandWindow();
                  }}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (isCasaLibraryMode) {
                      setNativeQuery(val);
                    } else {
                      onSpotifySearchQueryChange(val);
                    }
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      const activeQ = isCasaLibraryMode ? nativeQuery : spotifySearchQuery;
                      if (activeQ.trim()) recordSearchQuery(activeQ);
                    }
                  }}
                  placeholder={isCasaLibraryMode ? 'Search CASA Player...' : 'Search Spotify...'}
                  className="flex-1 min-w-0 bg-transparent text-[10.5px] text-white placeholder-white/35 focus:outline-none"
                />
                {(isCasaLibraryMode ? nativeQuery : spotifySearchQuery) && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (isCasaLibraryMode) setNativeQuery('');
                      else onSpotifySearchQueryChange('');
                    }}
                    className="text-white/40 hover:text-white cursor-pointer shrink-0"
                    aria-label="Hapus query"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>

              {isCasaLibraryMode && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onOpenLocalFile();
                  }}
                  className="w-[26px] h-[26px] rounded-lg bg-[#0d0d10] hover:bg-white/[0.12] border border-white/[0.12] text-white/65 hover:text-white flex items-center justify-center shrink-0 cursor-pointer"
                  title="Buka File Audio Lokal"
                  aria-label="Buka File Lokal"
                >
                  <FolderOpen className="w-3 h-3" />
                </button>
              )}

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playChimeCue('tap');
                  onCloseSearchPod();
                }}
                className="w-[22px] h-[26px] rounded-lg text-white/45 hover:text-white hover:bg-white/[0.08] flex items-center justify-center shrink-0 cursor-pointer"
                title="Tutup Search Pod"
                aria-label="Tutup Search Pod"
              >
                <X className="w-3 h-3" />
              </button>
            </div>

            {/* Search Results List */}
            <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden pr-0.5 space-y-1 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              {!isCasaLibraryMode ? (
                !spotifySearchQuery.trim() ? (
                  <div className="h-full flex flex-col justify-start gap-1.5 px-1 py-1">
                    <span className="text-[8.5px] font-mono uppercase tracking-wider text-zinc-500">
                      Suggestions
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {suggestionChips.map((chip) => (
                        <button
                          key={`${chip.kind}-${chip.label}`}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            recordSearchQuery(chip.query);
                            onSpotifySearchQueryChange(chip.query);
                          }}
                          className="px-2 py-0.5 rounded-full bg-[#0d0d10] hover:bg-white/15 border border-white/15 text-[9.5px] text-zinc-300 hover:text-white transition-colors cursor-pointer"
                        >
                          {chip.kind === 'recent' ? `↺ ${chip.label}` : chip.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : spotifySearchResults.length === 0 && !isSearchingSpotify ? (
                  <div className="h-full flex items-center justify-center text-[10px] text-white/35">
                    Tidak ada hasil ditemukan
                  </div>
                ) : (
                  spotifySearchResults.map((track) => {
                    const isAdded = addedSpotifyQueueId === track.id;
                    return (
                      <div
                        key={track.id}
                        className="flex items-center justify-between gap-1 p-1 rounded-lg hover:bg-white/[0.07] transition-colors group"
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            if (spotifySearchQuery.trim()) {
                              recordSearchQuery(spotifySearchQuery);
                            }
                            onPlaySpotifyTrack(track);
                          }}
                          className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="w-7 h-7 rounded-md bg-[#121215] border border-white/[0.10] overflow-hidden shrink-0 flex items-center justify-center">
                            {track.albumArt ? (
                              <img src={track.albumArt} alt={track.title} className="w-full h-full object-cover" />
                            ) : (
                              <Music className="w-3 h-3 text-white/35" />
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-[10.5px] font-medium text-white truncate leading-tight">
                              {track.title}
                            </div>
                            <div className="text-[9px] text-white/45 truncate leading-tight">
                              {track.artist}
                            </div>
                          </div>
                        </button>
                        <AddToPlaylistPopover
                          track={normalizeTrackForPlaylist({ ...track, source: 'spotify' })}
                          containerRef={leftSearchPodRef}
                          containedInCard
                          reportSearchDrawerHitbox
                          compact
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddSpotifyToQueue(track);
                          }}
                          className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                            isAdded
                              ? 'bg-white text-black'
                              : 'bg-white/[0.06] text-white/55 hover:bg-white/[0.16] hover:text-white'
                          }`}
                          title="Tambah ke Queue"
                          aria-label="Tambah ke Queue"
                        >
                          {isAdded ? <Check className="w-2.5 h-2.5" /> : <Plus className="w-3 h-3" />}
                        </button>
                      </div>
                    );
                  })
                )
              ) : !nativeQuery.trim() ? (
                <div className="flex flex-col gap-1.5 py-0.5">
                  <div className="flex flex-wrap gap-1 px-0.5">
                    {suggestionChips.map((chip) => (
                      <button
                        key={`${chip.kind}-${chip.label}`}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          recordSearchQuery(chip.query);
                          setNativeQuery(chip.query);
                        }}
                        className="px-2 py-0.5 rounded-full bg-[#0d0d10] hover:bg-white/15 border border-white/15 text-[9px] text-zinc-300 hover:text-white transition-colors cursor-pointer"
                      >
                        {chip.kind === 'recent' ? `↺ ${chip.label}` : chip.label}
                      </button>
                    ))}
                  </div>
                  {displayedNativeList.slice(0, 6).map((track) => {
                    const isCurrent = nativeTrack?.id === track.id;
                    return (
                      <div
                        key={`affinity-${track.id}`}
                        className={`flex items-center justify-between gap-1 p-1 rounded-lg transition-colors ${
                          isCurrent ? 'bg-white/[0.12]' : 'hover:bg-white/[0.07]'
                        }`}
                      >
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            playChimeCue('tap');
                            onPlayNativeSearchTrack(track, displayedNativeList);
                          }}
                          className="flex items-center gap-1.5 min-w-0 flex-1 text-left cursor-pointer"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-[10px] font-medium text-white truncate leading-tight">
                              {track.title}
                            </div>
                            <div className="text-[8.5px] text-zinc-400 truncate leading-tight">
                              {track.artist}
                            </div>
                          </div>
                        </button>
                        <AddToPlaylistPopover
                          track={normalizeTrackForPlaylist(track)}
                          containerRef={leftSearchPodRef}
                          containedInCard
                          reportSearchDrawerHitbox
                          compact
                        />
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            onAddToNativeQueue(e, track);
                          }}
                          className="w-5 h-5 rounded-md bg-white/[0.06] text-white/55 hover:bg-white/[0.16] hover:text-white flex items-center justify-center shrink-0 cursor-pointer"
                          title="Tambah ke Antrean"
                        >
                          <Plus className="w-3 h-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              ) : displayedNativeList.length === 0 && !isSearchingNative ? (
                <div className="h-full flex items-center justify-center text-[10px] text-white/35">
                  Tidak ada hasil ditemukan
                </div>
              ) : (
                displayedNativeList.map((track) => {
                  const isCurrent = nativeTrack?.id === track.id;
                  const isAdded = addedNativeTrackId === track.id;
                  return (
                    <div
                      key={track.id}
                      className={`flex items-center justify-between gap-1 p-1 rounded-lg transition-colors ${
                        isCurrent ? 'bg-white/[0.12]' : 'hover:bg-white/[0.07]'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playChimeCue('tap');
                          if (nativeQuery.trim()) {
                            recordSearchQuery(nativeQuery);
                          }
                          onPlayNativeSearchTrack(track, displayedNativeList);
                        }}
                        className="flex items-center gap-2 min-w-0 flex-1 text-left cursor-pointer"
                      >
                        <div className="w-7 h-7 rounded-md bg-[#121215] border border-white/[0.10] overflow-hidden shrink-0 flex items-center justify-center">
                          {track.thumbnailUrl ? (
                            <img src={track.thumbnailUrl} alt={track.title} className="w-full h-full object-cover" />
                          ) : (
                            <Music className="w-3 h-3 text-white/35" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[10.5px] font-medium text-white truncate leading-tight">
                            {track.title}
                          </div>
                          <div className="text-[9px] text-white/45 truncate leading-tight">
                            {track.artist}
                            {track.durationSeconds > 0 ? ` · ${formatDuration(track.durationSeconds)}` : ''}
                          </div>
                        </div>
                      </button>

                      <AddToPlaylistPopover
                        track={normalizeTrackForPlaylist(track)}
                        containerRef={leftSearchPodRef}
                        containedInCard
                        reportSearchDrawerHitbox
                        compact
                      />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onAddToNativeQueue(e, track);
                        }}
                        className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 transition-colors cursor-pointer ${
                          isAdded
                            ? 'bg-white text-black'
                            : 'bg-white/[0.06] text-white/55 hover:bg-white/[0.16] hover:text-white'
                        }`}
                        title="Tambah ke Antrean"
                        aria-label="Tambah ke Antrean"
                      >
                        {isAdded ? <Check className="w-2.5 h-2.5" /> : <Plus className="w-3 h-3" />}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* RIGHT SATELLITE POD: QUEUE (10px gap right of adaptive Mode 6 box) */}
      <AnimatePresence>
        {canShowSearchAndQueue && isQueuePodOpen && (
          <motion.aside
            key="right-queue-pod"
            data-pod="right"
            data-satellite-pod="true"
            initial={{ opacity: 0, x: -14, scale: 0.96, left: rightPodX, height: podHeight }}
            animate={{ opacity: 1, x: 0, scale: 1, left: rightPodX, height: podHeight }}
            exit={{ opacity: 0, x: -10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onWheel={(e) => e.stopPropagation()}
            style={{
              top: 15,
              width: POD_WIDTH,
            }}
            className="pointer-events-auto absolute bg-[#000000] border border-white/[0.12] rounded-2xl p-2.5 flex flex-col gap-2 shadow-[0_12px_32px_rgba(0,0,0,0.9)] overflow-hidden"
          >
            {/* Queue Pod Header */}
            <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <ListMusic className="w-3.5 h-3.5 text-white/75 shrink-0" />
                <span className="text-[10.5px] font-semibold text-white truncate">
                  {isCasaLibraryMode
                    ? 'CASA PLAYER Queue'
                    : spotifyQueueContextTitle || 'Queue'}
                </span>
                <span className="text-[9px] font-mono text-white/55 bg-white/[0.08] px-1.5 py-[1px] rounded-full tabular-nums">
                  {isCasaLibraryMode ? nativeQueue.length : spotifyQueueTracks.length}
                </span>
              </div>

              <div className="flex items-center gap-1 shrink-0">
                {isCasaLibraryMode && nativeQueue.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      onClearNativeQueue(e);
                    }}
                    className="w-5 h-5 rounded-md text-white/45 hover:text-rose-400 hover:bg-rose-500/15 flex items-center justify-center cursor-pointer"
                    title="Kosongkan Antrean"
                    aria-label="Kosongkan Antrean"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                )}

                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onCloseQueuePod();
                  }}
                  className="w-5 h-5 rounded-md text-white/45 hover:text-white hover:bg-white/[0.08] flex items-center justify-center cursor-pointer"
                  title="Tutup Queue Pod"
                  aria-label="Tutup Queue Pod"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            </div>

            {/* Queue Items List */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-1 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              {!isCasaLibraryMode ? (
                isLoadingSpotifyQueue && spotifyQueueTracks.length === 0 ? (
                  <div className="h-full flex items-center justify-center gap-1.5 text-[10px] text-white/45">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Memuat antrean...</span>
                  </div>
                ) : spotifyQueueTracks.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center gap-1.5 px-2">
                    <span className="text-[10px] text-white/40">
                      Antrean Spotify masih kosong
                    </span>
                  </div>
                ) : (
                  spotifyQueueTracks.map((track, idx) => (
                    <button
                      key={`${track.id}-${idx}`}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onPlaySpotifyQueueTrack(track, idx);
                      }}
                      className="w-full flex items-center gap-2 p-1 rounded-lg hover:bg-white/[0.07] text-left transition-colors cursor-pointer"
                    >
                      <div className="w-7 h-7 rounded-md bg-[#121215] border border-white/[0.10] overflow-hidden shrink-0 flex items-center justify-center">
                        {track.albumArt ? (
                          <img src={track.albumArt} alt={track.title} className="w-full h-full object-cover" />
                        ) : (
                          <Music className="w-3 h-3 text-white/35" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-[10.5px] font-medium text-white truncate leading-tight">
                          {track.title}
                        </div>
                        <div className="text-[9px] text-white/45 truncate leading-tight">
                          {track.artist}
                        </div>
                      </div>
                    </button>
                  ))
                )
              ) : (
                <MusicQueueView
                  compact
                  currentTrack={nativeTrack}
                  manualQueue={storeManualQueue}
                  smartQueue={storeSmartQueue}
                  isPlaying={isEffectivePlaying}
                  isResolving={isResolvingAudio}
                  isShuffle={effectiveShuffle}
                  isRepeat={effectiveRepeat}
                  isFetchingSmart={storeIsFetchingSmart}
                  onToggleShuffle={handleShuffleAction}
                  onToggleRepeat={handleRepeatAction}
                  onSelectManualTrack={(manualIdx) =>
                    onSelectNativeQueueTrack(nativeTrack ? manualIdx + 1 : manualIdx)
                  }
                  onRemoveManualTrack={(manualIdx) => storeRemoveManualTrack(manualIdx)}
                  onSelectSmartTrack={(smartIdx) => onPlaySmartQueueTrack?.(smartIdx)}
                  onRemoveSmartTrack={(smartIdx) =>
                    onRemoveSmartQueueTrack ? onRemoveSmartQueueTrack(smartIdx) : storeRemoveSmartTrack(smartIdx)
                  }
                  onClearQueue={(e) => onClearNativeQueue(e as any)}
                />
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {/* ADAPTIVE MAIN BOX (480px COMPACT SINGLE COLUMN <-> 640px WITH ON-DEMAND LYRICS) */}
      <div
        data-tauri-drag-region="false"
        className={`w-full h-full bg-[#000000] px-3.5 pt-1 pb-2 grid items-stretch select-none overflow-hidden ${
          isLyricsOpen ? 'grid-cols-2 gap-3' : 'grid-cols-1'
        }`}
      >
        {/* SISI KIRI: COMPACT SUB-NAV + (PLAYER | PLAYLISTS | QUEUE) */}
        <div
          className={`flex flex-col min-w-0 min-h-0 h-full overflow-hidden ${
            isLyricsOpen ? 'pr-3 border-r border-white/[0.08]' : ''
          }`}
        >
          {/* Compact Sub-Nav Strip: Player | Playlists | Queue + Shuffle / Repeat */}
          <div className="flex items-center justify-between gap-2 mb-1 shrink-0 h-[18px]">
            <div className="flex items-center gap-1 bg-[#0a0a0a] border border-white/10 rounded-full p-[2px]">
              {(
                [
                  { id: 'player', label: 'Player' },
                  { id: 'playlists', label: 'Playlists' },
                  { id: 'queue', label: 'Queue' },
                ] as const
              ).map((tab) => {
                const active = musicSubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      setMusicSubTab(tab.id);
                    }}
                    className={`h-[14px] px-2 rounded-full text-[8.5px] font-semibold tracking-wide transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-black'
                        : 'text-zinc-400 hover:text-white'
                    }`}
                  >
                    {tab.label}
                  </button>
                );
              })}
            </div>

            <div className="flex items-center gap-1 shrink-0 min-w-0">
              <span
                className="inline-flex items-center gap-1 px-1.5 h-[18px] rounded-full bg-[#0a0a0a] border border-white/10 text-[8.5px] font-medium text-zinc-300 leading-none max-w-[118px] shrink-0"
                title={`Audio Output: ${hardwareTelemetry.audio_device_name}`}
              >
                {hardwareTelemetry.audio_output_kind === 'bluetooth' ? (
                  <Bluetooth className="w-2.5 h-2.5 text-sky-400 shrink-0" />
                ) : hardwareTelemetry.audio_output_kind === 'wired' ? (
                  <Headphones className="w-2.5 h-2.5 text-indigo-300 shrink-0" />
                ) : (
                  <Volume2 className="w-2.5 h-2.5 text-zinc-400 shrink-0" />
                )}
                <span className="truncate tabular-nums">{musicAudioOutputLabel}</span>
              </span>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleShuffleAction();
                }}
                className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                  effectiveShuffle
                    ? 'bg-white text-black border-white'
                    : 'bg-[#0a0a0a] text-zinc-400 border-white/10 hover:text-white'
                }`}
                title={effectiveShuffle ? 'Shuffle: ON (Up Next)' : 'Shuffle: OFF'}
              >
                <Shuffle className="w-2.5 h-2.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleRepeatAction();
                }}
                className={`w-[18px] h-[18px] rounded-full border flex items-center justify-center transition-colors cursor-pointer ${
                  effectiveRepeat
                    ? 'bg-white text-black border-white'
                    : 'bg-[#0a0a0a] text-zinc-400 border-white/10 hover:text-white'
                }`}
                title={effectiveRepeat ? 'Repeat: ON' : 'Repeat: OFF'}
              >
                <Repeat className="w-2.5 h-2.5" />
              </button>
            </div>
          </div>

          {musicSubTab === 'playlists' ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              <MusicPlaylistView
                compact
                currentTrack={activeTrackPayload}
                onPlayPlaylistTrack={(track, list) => {
                  onPlayNativeSearchTrack(track, list);
                  setMusicSubTab('player');
                }}
                onAddToQueue={onAddToNativeQueue}
              />
            </div>
          ) : musicSubTab === 'queue' ? (
            <div className="flex-1 min-h-0 overflow-hidden">
              {isCasaLibraryMode ? (
                <MusicQueueView
                  compact
                  currentTrack={nativeTrack}
                  manualQueue={storeManualQueue}
                  smartQueue={storeSmartQueue}
                  isPlaying={isEffectivePlaying}
                  isResolving={isResolvingAudio}
                  isShuffle={effectiveShuffle}
                  isRepeat={effectiveRepeat}
                  isFetchingSmart={storeIsFetchingSmart}
                  onToggleShuffle={handleShuffleAction}
                  onToggleRepeat={handleRepeatAction}
                  onSelectManualTrack={(manualIdx) =>
                    onSelectNativeQueueTrack(nativeTrack ? manualIdx + 1 : manualIdx)
                  }
                  onRemoveManualTrack={(manualIdx) => storeRemoveManualTrack(manualIdx)}
                  onSelectSmartTrack={(smartIdx) => onPlaySmartQueueTrack?.(smartIdx)}
                  onRemoveSmartTrack={(smartIdx) =>
                    onRemoveSmartQueueTrack ? onRemoveSmartQueueTrack(smartIdx) : storeRemoveSmartTrack(smartIdx)
                  }
                  onClearQueue={(e) => onClearNativeQueue(e as any)}
                />
              ) : (
                <div className="h-full overflow-y-auto scrollbar-none space-y-1">
                  {spotifyQueueTracks.length === 0 ? (
                    <div className="h-full flex items-center justify-center text-[10px] text-zinc-500">
                      Antrean Spotify kosong
                    </div>
                  ) : (
                    spotifyQueueTracks.map((track, idx) => (
                      <button
                        key={`${track.id}-${idx}`}
                        type="button"
                        onClick={() => onPlaySpotifyQueueTrack(track, idx)}
                        className="w-full flex items-center gap-2 p-1 rounded-lg hover:bg-white/[0.07] text-left cursor-pointer"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="text-[10.5px] font-medium text-white truncate">
                            {track.title}
                          </div>
                          <div className="text-[9px] text-zinc-400 truncate">
                            {track.artist}
                          </div>
                        </div>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="flex-1 min-h-0 flex flex-col justify-between">
              {/* Row 1: Track Info (Kiri) + Save / Lyrics / Search / Queue (Kanan) */}
              <div className="flex items-center justify-between gap-2.5 min-w-0">
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  <div className="relative w-[42px] h-[42px] shrink-0">
                    <div className="w-full h-full rounded-xl bg-[#0b0b0d] border border-white/[0.10] overflow-hidden flex items-center justify-center">
                      {effectiveArtwork && hasActiveSession ? (
                        <img
                          src={effectiveArtwork}
                          alt={displayedTitle}
                          onLoad={onCoverImageLoad}
                          onError={onCoverImageError}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <Music className="w-4 h-4 text-white/35" />
                      )}

                      {isResolvingAudio && (
                        <div className="absolute inset-0 bg-black/70 flex items-center justify-center">
                          <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
                        </div>
                      )}
                    </div>

                    {showSpotifyCornerBadge && (
                      <span
                        className="absolute -bottom-1 -right-1 w-[16px] h-[16px] rounded-full bg-[#0a0a0a] ring-2 ring-black flex items-center justify-center pointer-events-none"
                        title="Spotify"
                        aria-label="Spotify"
                      >
                        <SpotifyCornerLogo className="w-[10px] h-[10px] text-[#1DB954]" />
                      </span>
                    )}
                  </div>

                  <div className="min-w-0 flex-1 flex flex-col justify-center">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <h3 className="text-[12px] font-semibold text-white truncate leading-tight">
                        {displayedTitle}
                      </h3>

                      {playbackSource === 'companion' && sessionCount > 1 && onOpenSessionPopover && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            playChimeCue('tap');
                            onOpenSessionPopover();
                          }}
                          className="text-[8.5px] font-mono text-white/45 hover:text-white cursor-pointer leading-none shrink-0"
                          title="Pilih sesi media aktif"
                        >
                          {sessionCount} apps
                        </button>
                      )}
                    </div>

                    <p className="text-[10px] text-zinc-400 truncate leading-tight mt-0.5">
                      {nativeAudioError && playbackSource === 'native' ? nativeAudioError : displayedArtist}
                    </p>
                  </div>
                </div>

                {/* Action Toggles: Save to Playlist + On-Demand Lyrics + Conditional Search Pod & Queue Pod */}
                <div className="flex items-center gap-1 shrink-0">
                  {activeTrackPayload && (
                    <AddToPlaylistPopover track={activeTrackPayload} compact />
                  )}

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      onToggleLyrics();
                    }}
                    className={`w-7 h-7 rounded-full border flex items-center justify-center transition-all active:scale-90 cursor-pointer ${
                      isLyricsOpen
                        ? 'bg-white text-black border-white'
                        : 'bg-[#0d0d10] text-white/65 border-white/[0.10] hover:bg-white/[0.10] hover:text-white'
                    }`}
                    title={isLyricsOpen ? 'Sembunyikan Lirik (480px)' : 'Tampilkan Lirik (640px)'}
                    aria-label="Toggle Lyrics"
                  >
                    <AlignLeft className="w-3 h-3" />
                  </button>

                  {canShowSearchAndQueue && (
                    <>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playChimeCue('tap');
                          onToggleSearchPod();
                        }}
                        className={`w-7 h-7 rounded-full border flex items-center justify-center transition-all active:scale-90 cursor-pointer ${
                          isSearchPodOpen
                            ? 'bg-white text-black border-white'
                            : 'bg-[#0d0d10] text-white/65 border-white/[0.10] hover:bg-white/[0.10] hover:text-white'
                        }`}
                        title={isCasaLibraryMode ? 'Search CASA Player' : 'Search Spotify'}
                        aria-label="Toggle Search Pod"
                      >
                        <Search className="w-3 h-3" />
                      </button>

                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          playChimeCue('tap');
                          onToggleQueuePod();
                        }}
                        className={`w-7 h-7 rounded-full border flex items-center justify-center transition-all active:scale-90 cursor-pointer ${
                          isQueuePodOpen
                            ? 'bg-white text-black border-white'
                            : 'bg-[#0d0d10] text-white/65 border-white/[0.10] hover:bg-white/[0.10] hover:text-white'
                        }`}
                        title={isCasaLibraryMode ? 'Antrean CASA Player' : 'Antrean Spotify'}
                        aria-label="Toggle Queue Pod"
                      >
                        <ListMusic className="w-3 h-3" />
                      </button>
                    </>
                  )}
                </div>
              </div>

              {/* Row 2: Inline Tactile Scrubber (0:28 [━━━●───] 3:26) */}
              <div className="flex items-center gap-2.5 w-full">
                <span className="tabular-nums font-mono text-[10.5px] text-zinc-400 w-9 text-left shrink-0 leading-none">
                  {formatDuration(displayElapsedSec)}
                </span>

                <div
                  ref={progressRef}
                  onPointerDown={handleScrubDown}
                  onPointerMove={handleScrubMove}
                  onPointerUp={handleScrubUp}
                  onPointerCancel={handleScrubUp}
                  className={`flex-1 py-1 flex items-center group touch-none ${
                    displayDurationSec > 0 ? 'cursor-pointer' : 'cursor-default'
                  }`}
                  title={displayDurationSec > 0 ? 'Klik atau geser untuk seek' : undefined}
                >
                  <div className="relative w-full h-[4px] group-hover:h-[6px] bg-white/[0.14] rounded-full transition-[height] duration-100">
                    <div
                      className={`h-full bg-white rounded-full ${
                        isScrubbing || isEffectivePlaying
                          ? 'transition-none'
                          : 'transition-[width] duration-150 ease-linear'
                      }`}
                      style={{ width: `${progressPercent}%` }}
                    />

                    {hasActiveSession && displayDurationSec > 0 && (
                      <div
                        className={`pointer-events-none absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-2.5 h-2.5 rounded-full bg-white shadow-sm transition-all duration-150 ${
                          isScrubbing
                            ? 'opacity-100 scale-110'
                            : 'opacity-0 scale-75 group-hover:opacity-100 group-hover:scale-100'
                        }`}
                        style={{ left: `${progressPercent}%` }}
                      />
                    )}
                  </div>
                </div>

                <span className="tabular-nums font-mono text-[10.5px] text-zinc-400 w-9 text-right shrink-0 leading-none">
                  {displayDurationSec > 0 ? formatDuration(displayDurationSec) : '--:--'}
                </span>
              </div>

              {/* Row 3: Centered Transport (Prev · Play/Pause · Next) + Conditional Stop */}
              <div className="flex items-center justify-center w-full">
                <div className="relative flex items-center justify-center gap-5">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onPrev();
                    }}
                    disabled={!hasActiveSession}
                    className="w-7 h-7 rounded-full hover:bg-white/[0.10] text-white/80 hover:text-white disabled:opacity-30 flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                    title="Sebelumnya"
                    aria-label="Sebelumnya"
                  >
                    <SkipBack className="w-3.5 h-3.5 fill-current" />
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onTogglePlay();
                    }}
                    disabled={!hasActiveSession}
                    className="w-9 h-9 rounded-full bg-white hover:bg-white/90 text-black disabled:opacity-30 flex items-center justify-center transition-all active:scale-90 cursor-pointer shadow-sm"
                    title={isEffectivePlaying ? 'Jeda' : 'Putar'}
                    aria-label={isEffectivePlaying ? 'Jeda' : 'Putar'}
                  >
                    {isEffectivePlaying ? (
                      <Pause className="w-3.5 h-3.5 fill-current" />
                    ) : (
                      <Play className="w-3.5 h-3.5 fill-current ml-0.5" />
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onNext();
                    }}
                    disabled={!hasActiveSession}
                    className="w-7 h-7 rounded-full hover:bg-white/[0.10] text-white/80 hover:text-white disabled:opacity-30 flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                    title="Berikutnya"
                    aria-label="Berikutnya"
                  >
                    <SkipForward className="w-3.5 h-3.5 fill-current" />
                  </button>

                  {hasActiveSession && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onStopMedia();
                      }}
                      className="absolute left-full ml-3 w-6 h-6 rounded-full border border-white/[0.08] text-zinc-400 hover:text-white hover:bg-white/[0.08] flex items-center justify-center transition-all active:scale-90 cursor-pointer"
                      title="Stop & Kembali ke Mode Awal"
                      aria-label="Stop Media"
                    >
                      <Square className="w-2.5 h-2.5 fill-current" />
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* SISI KANAN 50%: ON-DEMAND LIVE LYRICS + IDLE LYRICS TOGGLE (520px ONLY) */}
        {isLyricsOpen && (
          <div className="relative flex flex-col justify-between min-w-0 h-full overflow-hidden">
            {/* Compact Header: Lyrics label + Idle Lyrics Toggle + Refresh */}
            <div className="flex items-center justify-between gap-1.5 pb-1 border-b border-white/[0.08] shrink-0">
              <span className="text-[9px] font-mono uppercase tracking-wider text-white/45">
                Lyrics
              </span>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onToggleIdleLyrics();
                  }}
                  title="Tampilkan lirik berjalan di Mode 3 (Idle Capsule) saat popup ditutup"
                  className={`flex items-center gap-1 px-1.5 py-[2px] rounded-full border text-[8.5px] font-medium transition-colors cursor-pointer ${
                    isIdleLyricsEnabled
                      ? 'bg-white text-black border-white'
                      : 'bg-[#0d0d10] text-white/60 border-white/[0.10] hover:text-white'
                  }`}
                >
                  <span>Idle Lyrics</span>
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      isIdleLyricsEnabled ? 'bg-black' : 'bg-white/30'
                    }`}
                  />
                </button>

                <button
                  type="button"
                  disabled={!hasActiveSession}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (!hasActiveSession) return;
                    const elapsedMs = syncStartedAtRef.current !== null ? Date.now() - syncStartedAtRef.current : 0;
                    // Ignore duplicate accidental taps within first 3s; allow force abort + restart if stuck > 3s
                    if (effectiveLoadingLyrics && elapsedMs <= 3000) {
                      return;
                    }
                    syncStartedAtRef.current = Date.now();
                    setCanForceResync(false);
                    setSyncAttemptTick((t) => t + 1);
                    playChimeCue('tap');
                    onRefreshLyrics();
                  }}
                  className={`w-5 h-5 rounded-full bg-[#0d0d10] border border-white/[0.10] flex items-center justify-center transition-colors ${
                    !hasActiveSession
                      ? 'text-white/25 cursor-not-allowed opacity-50'
                      : effectiveLoadingLyrics && canForceResync
                      ? 'text-white border-white/30 cursor-pointer'
                      : 'text-white/55 hover:text-white cursor-pointer'
                  }`}
                  title={
                    !hasActiveSession
                      ? 'Putar lagu terlebih dahulu'
                      : effectiveLoadingLyrics && canForceResync
                      ? 'Sinkronisasi tersangkut — klik untuk membatalkan & muat ulang paksa'
                      : 'Segarkan Lirik (LRCLIB)'
                  }
                  aria-label="Segarkan Lirik"
                >
                  <RotateCw className={`w-2.5 h-2.5 ${effectiveLoadingLyrics ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col justify-center overflow-hidden pt-1">
              <LyricsPanel
                lines={effectiveDisplayLines}
                activeLyricIndex={activeLyricIndex}
                onSeekLine={onLyricLineSeek}
                duration={displayDurationSec}
                isLoading={effectiveLoadingLyrics}
                isInstrumental={effectiveIsInstrumental}
                isSynced={isSyncedLyrics}
                containerRef={lyricsContainerRef}
                onRefreshLyrics={onRefreshLyrics}
                isRefreshingLyrics={effectiveLoadingLyrics}
                isMidSongInstrumental={isMidSongInstrumental}
                audioAdjustedTime={audioAdjustedTime}
                isSpotifySession={isSpotifySession}
                hasActiveSession={hasActiveSession}
                compactOled
              />
            </div>
          </div>
        )}
      </div>

      {/* DETACHED FLOATING SATELLITE PODS PORTAL */}
      {podHostEl ? createPortal(podsMarkup, podHostEl) : null}
    </>
  );
};
