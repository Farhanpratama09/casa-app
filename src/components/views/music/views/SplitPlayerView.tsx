import React, { memo, useState, useEffect } from 'react';
import {
  Loader2,
  Speaker,
} from 'lucide-react';
import { SpotifyLunarIcon } from '../../../system/CosmicIcons';
import { VinylDiscFallback } from './VinylDiscFallback';
import { PlayerHeaderBar } from '../PlayerHeaderBar';
import { PlayerControls } from '../PlayerControls';
import { LyricsPanel } from '../LyricsPanel';
import { SpotifyPanels } from '../SpotifyPanels';
import { NativeQueuePanel, NativeSearchPanel } from '../panels/NativePanels';
import { playChimeCue } from '../../../../utils/tauriBridge';
import type { MusicSubPanel } from '../constants';
import type { LyricLine } from '../../../../utils/lyricsService';
import type { SpotifyTrackItem, SpotifyPlaylistItem } from '../../../../utils/spotifyService';
import type { AudioDeviceType } from '../../../../hooks/useSystemHardware';
import type { NativeTrack } from '../../../../services/nativeAudioService';

export type NativeTab = 'lyrics' | 'queue' | 'search';

export interface SplitPlayerViewProps {
  // Session & Playback
  playbackSource: 'companion' | 'native';
  nativeTrack?: NativeTrack | null;
  nativeQueue?: NativeTrack[];
  nativeQueueIndex?: number;
  activeSubPanel: 'lyrics' | 'search' | 'queue' | 'playlist';
  queueLength: number;
  isEffectivePlaying: boolean;
  hasActiveSession: boolean;
  canAccessSpotifyFeatures: boolean;
  isWakingSpotify: boolean;
  isResolvingAudio?: boolean;
  isSpotifySession: boolean;
  isQueueOpen: boolean;
  isRefreshingLyrics: boolean;
  isRefreshingSession: boolean;

  // Metadata
  currentSessionId?: string | null;
  effectiveArtwork: string | null;
  effectiveTitle: string;
  effectiveArtist: string;

  // Audio output device & System Hardware Telemetry
  audioOutput?: 'headset' | 'speaker';
  audioDeviceType?: AudioDeviceType;
  audioDeviceName?: string;
  masterVolume?: number;
  isMuted?: boolean;
  batteryPercentage?: number;
  isCharging?: boolean;
  hasBattery?: boolean;
  isCapsLocked?: boolean;
  activeAppName?: string;
  sessionCount: number;

  // Scrubber / Transport time
  currentTimeSeconds: number;
  durationSeconds: number;
  isShuffle: boolean;
  isSmartShuffle: boolean;
  isRepeat?: boolean;
  onToggleRepeat?: () => void;

  // Right column contextual title & loaders
  queueContextTitle: string;
  isLoadingPlaylists?: boolean;
  isLoadingPlaylistTracks?: boolean;
  isLoadingQueue?: boolean;
  isSearching?: boolean;

  // Lyrics props
  displayLines: LyricLine[];
  activeLyricIndex: number;
  isSyncedLyrics: boolean;
  lyricsContainerRef: React.RefObject<HTMLDivElement | null>;
  isMidSongInstrumental: boolean;
  audioAdjustedTime: number;

  // Spotify panels props
  isUserConnected: boolean;
  playlists: SpotifyPlaylistItem[];
  selectedPlaylist: SpotifyPlaylistItem | null;
  playlistTracks: SpotifyTrackItem[];
  likedSongsTotal?: number | null;
  queueTracks: SpotifyTrackItem[];
  searchQuery: string;
  searchResults: SpotifyTrackItem[];
  addedQueueId: string | null;
  inputRef: React.RefObject<HTMLInputElement | null>;

  // Handlers
  onOpenSpotify: () => void;
  onQuitSpotify: (e: React.MouseEvent) => void;
  onCoverImageLoad?: () => void;
  onCoverImageError?: () => void;
  onToggleAudioOutput: () => void;
  onContextMenuAudioOutput?: (e: React.MouseEvent) => void;
  onToggleMute?: () => void;
  onSeek: (seconds: number) => void;
  onToggleShuffle: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onSwitchSubPanel: (panel: MusicSubPanel) => void;
  onSelectSource: (source: 'companion' | 'native') => void;
  onToggleSearch: () => void;
  onToggleQueue: () => void;
  onRefreshLyrics?: () => void;
  onRefreshSession?: () => void;
  onPrevPanel: () => void;
  onNextPanel: () => void;
  onLyricLineSeek: (targetSeconds: number) => void;
  onSelectPlaylist: (playlist: SpotifyPlaylistItem | null) => void;
  onPlayPlaylistTrack: (track: SpotifyTrackItem) => void;
  onPlayAllInPlaylist: () => void;
  onConnectSpotify: () => void;
  onPlayQueueTrack: (track: SpotifyTrackItem) => void;
  onSearchQueryChange: (query: string) => void;
  onPlaySearchTrack: (track: SpotifyTrackItem) => void;
  onAddToQueue: (track: SpotifyTrackItem) => void;
  onFocusInput: () => void;
  setIsSearchFocused: (focused: boolean) => void;
  onEjectNative?: () => void;
  isLoadingLyrics?: boolean;
  onSelectNativeTrack?: (index: number) => void;
  onRemoveNativeTrack?: (e: React.MouseEvent, index: number) => void;
  onClearNativeQueue?: (e: React.MouseEvent) => void;
  onPlayNativeSearchTrack?: (track: NativeTrack, currentList: NativeTrack[]) => void;
  onAddToNativeQueue?: (e: React.MouseEvent, track: NativeTrack) => void;
  addedNativeTrackId?: string | null;
  onOpenLocalFile?: () => void;
  onFilesDropped?: (files: FileList) => void;
}

export const SplitPlayerView: React.FC<SplitPlayerViewProps> = memo(({
  playbackSource,
  nativeTrack,
  nativeQueue,
  nativeQueueIndex,
  activeSubPanel,
  queueLength,
  isEffectivePlaying,
  hasActiveSession,
  canAccessSpotifyFeatures,
  isWakingSpotify,
  isResolvingAudio,
  isSpotifySession,
  isQueueOpen,
  isRefreshingLyrics,
  isRefreshingSession,
  currentSessionId,
  effectiveArtwork,
  effectiveTitle,
  effectiveArtist,
  audioOutput = 'speaker',
  audioDeviceType = 'speaker',
  audioDeviceName,
  masterVolume,
  isMuted = false,
  batteryPercentage,
  isCharging = false,
  hasBattery = false,
  isCapsLocked = false,
  activeAppName,
  sessionCount,
  currentTimeSeconds,
  durationSeconds,
  isShuffle,
  isSmartShuffle,
  isRepeat = false,
  onToggleRepeat,
  queueContextTitle,
  isLoadingPlaylists,
  isLoadingPlaylistTracks,
  isLoadingQueue,
  isSearching,
  displayLines,
  activeLyricIndex,
  isSyncedLyrics,
  lyricsContainerRef,
  isMidSongInstrumental,
  audioAdjustedTime,
  isUserConnected,
  playlists,
  selectedPlaylist,
  playlistTracks,
  likedSongsTotal,
  queueTracks,
  searchQuery,
  searchResults,
  addedQueueId,
  inputRef,
  onOpenSpotify,
  onQuitSpotify,
  onCoverImageLoad,
  onCoverImageError,
  onToggleAudioOutput,
  onContextMenuAudioOutput,
  onToggleMute,
  onSeek,
  onToggleShuffle,
  onPrev,
  onTogglePlay,
  onNext,
  onSwitchSubPanel,
  onSelectSource,
  onToggleSearch,
  onToggleQueue,
  onRefreshLyrics,
  onRefreshSession,
  onPrevPanel,
  onNextPanel,
  onLyricLineSeek,
  onSelectPlaylist,
  onPlayPlaylistTrack,
  onPlayAllInPlaylist,
  onConnectSpotify,
  onPlayQueueTrack,
  onSearchQueryChange,
  onPlaySearchTrack,
  onAddToQueue,
  onFocusInput,
  setIsSearchFocused,
  onEjectNative,
  isLoadingLyrics = false,
  onSelectNativeTrack,
  onRemoveNativeTrack,
  onClearNativeQueue,
  onPlayNativeSearchTrack,
  onAddToNativeQueue,
  addedNativeTrackId,
  onOpenLocalFile,
  onFilesDropped,
}) => {
  const [activeNativeTab, setActiveNativeTab] = useState<NativeTab>(() => {
    if (activeSubPanel === 'search' || activeSubPanel === 'queue') return activeSubPanel;
    return 'lyrics';
  });

  useEffect(() => {
    if (activeSubPanel === 'search' || activeSubPanel === 'queue' || activeSubPanel === 'lyrics') {
      setActiveNativeTab(activeSubPanel);
    }
  }, [activeSubPanel]);

  const handleNativeTabSelect = (tab: NativeTab) => {
    playChimeCue('tap');
    setActiveNativeTab(tab);
    if (activeSubPanel !== tab) {
      onSwitchSubPanel(tab);
    }
  };

  return (
    <div
      className="relative w-full max-w-[620px] h-full min-h-0 bg-[#121215] border border-[#222226] rounded-2xl overflow-visible"
    >
      <div className="relative z-10 w-full max-w-[620px] h-full min-h-0 px-3.5 py-1.5 select-none group/card flex flex-col justify-between overflow-visible">
        <div className="grid grid-cols-[236px_minmax(0,1fr)] gap-3 w-full h-full min-h-0 items-stretch overflow-visible">
          {/* Left Column (236px): Audio Deck */}
          <div className="flex flex-col justify-between w-[236px] h-full min-h-0 shrink-0 border-r border-[#222226] pr-2">
            {/* Cover Art (Non-Interaktif: pointer-events-none) + Track Metadata & Spotify Action */}
            <div className="flex items-center gap-2">
              {/* Cover Art Wrapper with Dynamic Ambient Glow */}
              <div className="relative w-[46px] h-[46px] aspect-square rounded-xl shrink-0 pointer-events-none cursor-default select-none text-left flex-shrink-0">
                {/* Dynamic Ambient Glow Layer */}
                {effectiveArtwork ? (
                  <img
                    key={`ambient-${currentSessionId}-${effectiveArtwork || effectiveTitle}`}
                    src={effectiveArtwork}
                    alt=""
                    aria-hidden="true"
                    className="absolute -inset-1.5 -z-10 rounded-2xl blur-xl opacity-25 scale-105 pointer-events-none select-none transition-all duration-700 ease-out object-cover"
                  />
                ) : (
                  <div
                    className="absolute -inset-1.5 -z-10 rounded-2xl blur-xl opacity-25 scale-105 pointer-events-none select-none transition-all duration-700 ease-out bg-cyan-400/20 shadow-[0_0_24px_rgba(34,211,238,0.2)]"
                  />
                )}

                {/* Primary Foreground Cover */}
                <div
                  className={`relative w-full h-full aspect-square rounded-xl overflow-hidden bg-[#09090b] border border-[#222226] select-none flex-shrink-0 ${
                    !effectiveArtwork ? 'shadow-[0_0_24px_rgba(34,211,238,0.2)]' : 'shadow-sm'
                  }`}
                >
                  {effectiveArtwork ? (
                    <img
                      key={`${currentSessionId}-${effectiveArtwork || effectiveTitle}`}
                      src={effectiveArtwork}
                      alt={effectiveTitle}
                      className="w-full h-full aspect-square object-cover select-none pointer-events-none transition-opacity duration-300 flex-shrink-0"
                      onLoad={onCoverImageLoad}
                      onError={onCoverImageError}
                    />
                  ) : (
                    <VinylDiscFallback isPlaying={isEffectivePlaying} />
                  )}
                </div>
              </div>

              <div className="flex items-center justify-between min-w-0 flex-1">
                <div className="flex flex-col min-w-0 flex-1 justify-center mr-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="font-sans font-semibold text-[13px] text-zinc-100 truncate tracking-tight leading-tight"
                      title={effectiveTitle}
                    >
                      {effectiveTitle}
                    </span>
                    {isResolvingAudio && (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-cyan-400 shrink-0" />
                    )}
                  </div>
                  <span
                    className="font-sans text-[10.5px] font-medium text-zinc-400 truncate mt-0.5 tracking-tight max-w-[150px]"
                    title={effectiveArtist}
                  >
                    {effectiveArtist}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {playbackSource === 'native' ? (
                    nativeTrack && onEjectNative ? (
                      <button
                        onClick={onEjectNative}
                        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-zinc-400 hover:text-cyan-400 hover:bg-cyan-950/30 border border-transparent hover:border-cyan-500/30 transition-all duration-100 ease-out active:scale-[0.97] cursor-pointer"
                        title="Tutup Sesi / Eject (Kembali ke Standby)"
                        aria-label="Tutup Sesi / Eject"
                      >
                        <span className="text-[12px] font-sans font-bold leading-none select-none text-zinc-400 hover:text-cyan-400">⏏</span>
                      </button>
                    ) : (
                      <button
                        onClick={() => onSelectSource?.('companion')}
                        className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-zinc-500 hover:text-emerald-400 hover:bg-[#18181c] border border-transparent hover:border-[#2e2e34] transition-all duration-100 ease-out active:scale-[0.97] cursor-pointer"
                        title="Beralih ke Windows Media / Spotify"
                        aria-label="Beralih ke Windows Media / Spotify"
                      >
                        <SpotifyLunarIcon className="w-3.5 h-3.5 text-zinc-500 hover:text-emerald-400 transition-colors" />
                      </button>
                    )
                  ) : (
                    <button
                      onClick={onOpenSpotify}
                      onContextMenu={onQuitSpotify}
                      className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-[#18181c] border border-transparent hover:border-[#2e2e34] transition-all duration-100 ease-out active:scale-[0.97] cursor-pointer"
                      title="Klik: Buka/Sembunyi | Klik Kanan: Keluar Total (Quit)"
                      aria-label="Spotify Desktop (Klik: Buka/Sembunyi | Klik Kanan: Keluar Total)"
                    >
                      <SpotifyLunarIcon className="w-3.5 h-3.5 text-emerald-400/80 hover:text-emerald-400 transition-colors" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Player Controls (Compact Scrubber & Transport) */}
            <PlayerControls
              isCompact={true}
              isEffectivePlaying={isEffectivePlaying}
              hasActiveSession={hasActiveSession}
              canAccessSpotifyFeatures={canAccessSpotifyFeatures}
              isSpotifySession={isSpotifySession}
              isWakingSpotify={isWakingSpotify}
              currentTimeSeconds={currentTimeSeconds}
              durationSeconds={durationSeconds}
              onSeek={onSeek}
              isShuffle={isShuffle}
              isSmartShuffle={isSmartShuffle}
              onToggleShuffle={onToggleShuffle}
              isRepeat={isRepeat}
              onToggleRepeat={onToggleRepeat}
              onPrev={onPrev}
              onTogglePlay={onTogglePlay}
              onNext={onNext}
              activeSubPanel={playbackSource === 'native' ? activeNativeTab : activeSubPanel}
              onSwitchSubPanel={(panel) => {
                if (panel === 'none') {
                  onSwitchSubPanel('none');
                  return;
                }
                if (panel === 'lyrics') {
                  if (activeNativeTab === 'lyrics') {
                    onSwitchSubPanel('none');
                  } else {
                    handleNativeTabSelect('lyrics');
                  }
                  return;
                }
                if (playbackSource === 'native' && (panel === 'queue' || panel === 'search')) {
                  handleNativeTabSelect(panel as NativeTab);
                  return;
                }
                onSwitchSubPanel(panel);
              }}
            />
          </div>

          {/* Right Column: Dynamic Feature Panel with Segmented Pill Nav */}
          <div className="flex flex-col justify-between flex-1 min-w-0 min-h-0 h-full overflow-visible relative">
            {/* Header Bar: Segmented Pill Nav [Lirik | Antrean | Cari | Library] + Source Switcher */}
            <div className="flex items-center justify-between shrink-0 border-b border-[#222226] pb-1 mb-1 gap-1.5 w-full min-w-0 px-1">
              {/* Segmented Pill Navigation Tabs */}
              <div className="flex items-center gap-1 min-w-0">
                {(playbackSource === 'native'
                  ? [
                      { id: 'lyrics' as const, label: 'Lirik' },
                      { id: 'queue' as const, label: 'Antrean' },
                      { id: 'search' as const, label: 'Cari Musik' },
                    ]
                  : [
                      { id: 'lyrics' as const, label: 'Lirik' },
                      { id: 'queue' as const, label: 'Antrean' },
                      { id: 'search' as const, label: 'Cari' },
                      { id: 'playlist' as const, label: 'Library' },
                    ]
                ).map((tab) => {
                  const isActive =
                    playbackSource === 'native'
                      ? activeNativeTab === tab.id
                      : activeSubPanel === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => {
                        if (playbackSource === 'native') {
                          handleNativeTabSelect(tab.id as NativeTab);
                        } else {
                          playChimeCue('tap');
                          onSwitchSubPanel(tab.id);
                        }
                      }}
                      className={`font-sans text-[10.5px] font-medium tracking-tight transition-all cursor-pointer ${
                        isActive
                          ? isSpotifySession
                            ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 px-2.5 py-0.5 rounded-lg shadow-sm'
                            : 'bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-lg shadow-sm'
                          : 'text-zinc-400 hover:text-zinc-200 px-2.5 py-0.5 border border-transparent transition-colors'
                      }`}
                    >
                      {tab.label}
                    </button>
                  );
                })}

                {/* Loading indicator */}
                {isWakingSpotify ? (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[8.5px] font-sans font-medium shrink-0 animate-pulse ml-1">
                    <Loader2 className="w-2 h-2 animate-spin" />
                    <span>CONNECTING...</span>
                  </span>
                ) : (
                  ((activeSubPanel === 'playlist' &&
                    (isLoadingPlaylists || isLoadingPlaylistTracks)) ||
                    (activeSubPanel === 'queue' && isLoadingQueue) ||
                    (activeSubPanel === 'search' && isSearching)) && (
                    <Loader2 className={`w-2.5 h-2.5 ${playbackSource === 'native' ? 'text-cyan-400' : 'text-emerald-400/80'} animate-spin shrink-0 ml-1`} />
                  )
                )}
              </div>

              {/* Right side: Source Switcher, Search & Paging Controls */}
              <PlayerHeaderBar
                playbackSource={playbackSource}
                activeSubPanel={playbackSource === 'native' ? activeNativeTab : activeSubPanel}
                queueLength={queueLength}
                isCompact={true}
                isSpotifySession={isSpotifySession}
                isQueueOpen={isQueueOpen}
                isRefreshingLyrics={isRefreshingLyrics}
                isRefreshingSession={isRefreshingSession}
                showRefreshLyrics={
                  playbackSource === 'native'
                    ? activeNativeTab === 'lyrics'
                    : activeSubPanel === 'lyrics'
                }
                showPagingControls={false}
                onSelectSource={onSelectSource}
                onToggleSearch={onToggleSearch}
                onToggleQueue={onToggleQueue}
                onOpenLocalFile={onOpenLocalFile}
                onRefreshLyrics={onRefreshLyrics}
                onRefreshSession={onRefreshSession}
                onPrevPanel={onPrevPanel}
                onNextPanel={onNextPanel}
                onSelectPanel={(p) => {
                  if (playbackSource === 'native' && (p === 'lyrics' || p === 'queue' || p === 'search')) {
                    handleNativeTabSelect(p as NativeTab);
                  } else {
                    onSwitchSubPanel(p as any);
                  }
                }}
                onClosePanel={() => onSwitchSubPanel(activeSubPanel)}
              />
            </div>

            {/* Body Area: Scrollable Content Containers with Wheel Scroll Protection */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* 1. Synced or Plain Lyrics */}
              {((playbackSource === 'native' && activeNativeTab === 'lyrics') ||
                (playbackSource !== 'native' && activeSubPanel === 'lyrics')) && (
                <LyricsPanel
                  lines={displayLines}
                  activeLyricIndex={activeLyricIndex}
                  onSeekLine={(targetSeconds) => onLyricLineSeek(targetSeconds)}
                  duration={durationSeconds}
                  isSynced={isSyncedLyrics}
                  isLoading={isLoadingLyrics || isRefreshingLyrics}
                  containerRef={lyricsContainerRef}
                  onRefreshLyrics={onRefreshLyrics}
                  isRefreshingLyrics={isRefreshingLyrics}
                  isMidSongInstrumental={isMidSongInstrumental}
                  audioAdjustedTime={audioAdjustedTime}
                  isSpotifyActive={isSpotifySession}
                  emptyTitle={
                    playbackSource === 'native' && !isEffectivePlaying && displayLines.length === 0
                      ? 'Lirik Musik'
                      : undefined
                  }
                  emptySubtitle={
                    playbackSource === 'native' && !isEffectivePlaying && displayLines.length === 0
                      ? 'Pilih lagu dari antrean untuk mulai memutar lirik'
                      : undefined
                  }
                />
              )}

              {/* 2. CASA Native Panels (Zero Spotify Leakage) */}
              {playbackSource === 'native' && activeNativeTab === 'queue' && (
                <NativeQueuePanel
                  currentTrack={nativeTrack}
                  queue={nativeQueue || []}
                  currentIndex={nativeQueueIndex ?? -1}
                  isPlaying={isEffectivePlaying}
                  onSelectTrack={(idx) => onSelectNativeTrack?.(idx)}
                  onRemoveTrack={onRemoveNativeTrack}
                  onClearQueue={onClearNativeQueue}
                  onOpenSearch={() => handleNativeTabSelect('search')}
                  onOpenLocalFile={onOpenLocalFile}
                  onPlayTrackDirect={(track) => onPlayNativeSearchTrack?.(track, [track])}
                />
              )}

              {playbackSource === 'native' && activeNativeTab === 'search' && (
                <NativeSearchPanel
                  onPlayTrack={(track, list) => onPlayNativeSearchTrack?.(track, list)}
                  onAddToQueue={(e, track) => onAddToNativeQueue?.(e, track)}
                  currentTrackId={nativeTrack?.id}
                  addedTrackId={addedNativeTrackId}
                  isResolvingAudio={isResolvingAudio}
                  onOpenLocalFile={onOpenLocalFile}
                  onFilesDropped={onFilesDropped}
                />
              )}

              {/* 3. Spotify Ecosystem Panels (Playlists, Queue, Quick Search) - Strictly Companion Mode */}
              {playbackSource !== 'native' && activeSubPanel !== 'lyrics' && (
                <SpotifyPanels
                  activeSubPanel={activeSubPanel}
                  isUserConnected={isUserConnected}
                  playlists={playlists}
                  isLoadingPlaylists={isLoadingPlaylists}
                  selectedPlaylist={selectedPlaylist}
                  onSelectPlaylist={onSelectPlaylist}
                  playlistTracks={playlistTracks}
                  isLoadingPlaylistTracks={isLoadingPlaylistTracks}
                  likedSongsTotal={likedSongsTotal}
                  onPlayPlaylistTrack={onPlayPlaylistTrack}
                  onPlayAllInPlaylist={onPlayAllInPlaylist}
                  onConnectSpotify={onConnectSpotify}
                  queueTracks={queueTracks}
                  isLoadingQueue={isLoadingQueue}
                  queueContextTitle={queueContextTitle}
                  onPlayQueueTrack={onPlayQueueTrack}
                  searchQuery={searchQuery}
                  onSearchQueryChange={onSearchQueryChange}
                  searchResults={searchResults}
                  isSearching={isSearching}
                  addedQueueId={addedQueueId}
                  onPlaySearchTrack={onPlaySearchTrack}
                  onAddToQueue={onAddToQueue}
                  inputRef={inputRef}
                  onFocusInput={onFocusInput}
                  setIsSearchFocused={setIsSearchFocused}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
});

SplitPlayerView.displayName = 'SplitPlayerView';
