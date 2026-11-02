import React, { memo } from 'react';
import {
  Loader2,
  Headphones,
  Speaker,
  Bluetooth,
  VolumeX,
} from 'lucide-react';
import { VinylDiscFallback } from './VinylDiscFallback';
import { PlayerHeaderBar } from '../PlayerHeaderBar';
import { PlayerControls } from '../PlayerControls';
import { LyricsPanel } from '../LyricsPanel';
import { SpotifyPanels } from '../SpotifyPanels';
import type { MusicSubPanel } from '../constants';
import type { LyricLine } from '../../../../utils/lyricsService';
import type { SpotifyTrackItem, SpotifyPlaylistItem } from '../../../../utils/spotifyService';
import type { AudioDeviceType } from '../../../../hooks/useSystemHardware';

export interface SplitPlayerViewProps {
  // Session & Playback
  playbackSource: 'companion' | 'native';
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
}

export const SplitPlayerView: React.FC<SplitPlayerViewProps> = memo(({
  playbackSource,
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
}) => {
  return (
    <div className="relative w-full max-w-[620px] h-[140px] overflow-hidden">
      {/* =================================================================== */}
      {/* Ambient Cosmic Background Texture Layers                            */}
      {/* =================================================================== */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {/* Ambient Glow: Bottom-Left Radial Gradient */}
        <div
          className="absolute inset-0 pointer-events-none blur-2xl opacity-80"
          style={{
            background:
              'radial-gradient(circle at bottom left, rgba(14, 165, 233, 0.15) 0%, rgba(30, 27, 75, 0.10) 45%, transparent 70%)',
          }}
        />

        {/* Secondary soft glow at top-right for active side panel */}
        <div
          className="absolute top-0 right-0 w-[280px] h-[140px] pointer-events-none blur-xl opacity-60"
          style={{
            background:
              'radial-gradient(circle at top right, rgba(255, 255, 255, 0.03) 0%, rgba(125, 211, 252, 0.03) 40%, transparent 70%)',
          }}
        />

        {/* Subtle Cosmic Dust Layer + Cosmic Orbit Arc (SVG Passive Nodes) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-20"
          xmlns="http://www.w3.org/2000/svg"
        >
          {/* Cosmic Orbit Curve */}
          <path
            d="M -20,120 Q 280,30 640,65"
            fill="none"
            stroke="white"
            strokeWidth="1"
            strokeOpacity="0.04"
            strokeDasharray="4 6"
          />
          {/* Stardust Micro Nodes (1px–1.5px, #7DD3FC / #E0F2FE) */}
          <circle cx="270" cy="22" r="1.2" fill="#7DD3FC" opacity="0.18" />
          <circle cx="385" cy="115" r="1.5" fill="#E0F2FE" opacity="0.15" />
          <circle cx="450" cy="32" r="1.0" fill="#7DD3FC" opacity="0.14" />
          <circle cx="530" cy="98" r="1.4" fill="#E0F2FE" opacity="0.16" />
          <circle cx="595" cy="45" r="1.2" fill="#7DD3FC" opacity="0.15" />
        </svg>
      </div>

      <div className="relative z-10 w-full max-w-[620px] px-3.5 py-1.5 select-none group/card flex flex-col justify-between h-[140px]">
        <div className="flex items-stretch gap-3 w-full h-[132px]">
          {/* Left Column (230px): Audio Deck */}
          <div className="flex flex-col justify-between w-[230px] shrink-0 border-r border-white/[0.04] pr-2.5 h-[132px]">
            {/* Cover Art + Track Metadata & Like Button */}
            <div className="flex items-center gap-2">
              <button
                onClick={onOpenSpotify}
                onContextMenu={onQuitSpotify}
                className="relative w-[46px] h-[46px] aspect-square rounded-xl overflow-hidden shrink-0 bg-[#0D0E12] border border-white/[0.06] shadow-sm cursor-pointer hover:border-[#98BBD6]/40 hover:scale-[1.02] active:scale-95 transition-all text-left flex-shrink-0"
                title="Klik: Buka/Sembunyi | Klik Kanan: Keluar Total (Quit)"
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
              </button>

              <div className="flex items-center justify-between min-w-0 flex-1">
                <div className="flex flex-col min-w-0 flex-1 justify-center mr-1">
                  <div className="flex items-center gap-1.5">
                    <span
                      className="text-[13px] font-semibold text-white/95 truncate tracking-tight leading-tight font-sans"
                      title={effectiveTitle}
                    >
                      {effectiveTitle}
                    </span>
                    {isResolvingAudio && (
                      <Loader2 className="w-2.5 h-2.5 animate-spin text-sky-300 shrink-0" />
                    )}
                  </div>
                  <span
                    className="text-[11px] font-medium text-white/40 truncate mt-0.5 font-sans"
                    title={effectiveArtist}
                  >
                    {effectiveArtist}
                  </span>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  {/* Audio Endpoint Switcher with dynamic Hardware Telemetry */}
                  <button
                    onClick={onToggleMute || onToggleAudioOutput}
                    onContextMenu={onContextMenuAudioOutput}
                    className={`w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all border ${
                      isMuted
                        ? 'text-rose-400 bg-rose-500/15 border-rose-500/30 shadow-[0_0_6px_rgba(244,63,94,0.2)]'
                        : audioDeviceType === 'headphone_bluetooth'
                        ? 'text-sky-300 bg-sky-500/15 border-sky-400/30 shadow-[0_0_6px_rgba(56,189,248,0.2)]'
                        : audioDeviceType === 'headphone_wired' || audioOutput === 'headset'
                        ? 'text-indigo-300 bg-indigo-500/15 border-indigo-400/30'
                        : 'text-island-blue bg-island-blue/10 border-island-blue/20 hover:bg-island-blue/20'
                    }`}
                    title={`${audioDeviceName || (audioOutput === 'headset' ? 'Headphones' : 'Speakers')} (${
                      audioDeviceType === 'headphone_bluetooth'
                        ? 'Bluetooth'
                        : audioDeviceType === 'headphone_wired'
                        ? 'Kabel / Wired'
                        : 'Speaker'
                    }) • Vol: ${masterVolume ?? 100}%${isMuted ? ' [MUTED - Klik Unmute]' : ' [Klik Mute]'}${
                      activeAppName ? ` • Sesi: ${activeAppName}` : ''
                    }${sessionCount > 1 ? ' (Klik kanan kelola sesi)' : ''}`}
                    aria-label="Audio Output Switcher"
                  >
                    {isMuted ? (
                      <VolumeX className="w-2.5 h-2.5 shrink-0 text-rose-400" />
                    ) : audioDeviceType === 'headphone_bluetooth' ? (
                      <Bluetooth className="w-2.5 h-2.5 shrink-0" />
                    ) : audioDeviceType === 'headphone_wired' || audioOutput === 'headset' ? (
                      <Headphones className="w-2.5 h-2.5 shrink-0" />
                    ) : (
                      <Speaker className="w-2.5 h-2.5 shrink-0" />
                    )}
                  </button>

                  <button
                    onClick={onOpenSpotify}
                    onContextMenu={onQuitSpotify}
                    className="w-[20px] h-[20px] rounded-full flex items-center justify-center text-white/30 hover:text-[#1DB954] hover:bg-white/10 transition-colors"
                    title="Klik: Buka/Sembunyi | Klik Kanan: Keluar Total (Quit)"
                    aria-label="Spotify Desktop (Klik: Buka/Sembunyi | Klik Kanan: Keluar Total)"
                  >
                    <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.435-5.308-1.76-8.792-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.808-.87 7.076-.496 9.721 1.115.294.18.387.562.207.855zm1.226-2.724c-.227.368-.711.485-1.08.258-2.69-1.653-6.79-2.134-9.97-1.168-.413.125-.852-.108-.977-.52-.125-.413.108-.852.52-.977 3.633-1.103 8.147-.568 11.249 1.328.368.226.485.71.258 1.079zm.106-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.495.15-1.022-.13-1.172-.625-.15-.496.13-1.022.626-1.172 3.535-1.073 9.404-.866 13.115 1.338.445.264.59.838.327 1.282-.264.444-.838.59-1.281.327z" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>

            {/* Player Controls (Compact Scrubber & Transport) */}
            <PlayerControls
              isCompact={true}
              isEffectivePlaying={isEffectivePlaying}
              hasActiveSession={hasActiveSession}
              canAccessSpotifyFeatures={canAccessSpotifyFeatures}
              isWakingSpotify={isWakingSpotify}
              currentTimeSeconds={currentTimeSeconds}
              durationSeconds={durationSeconds}
              onSeek={onSeek}
              isShuffle={isShuffle}
              isSmartShuffle={isSmartShuffle}
              onToggleShuffle={onToggleShuffle}
              onPrev={onPrev}
              onTogglePlay={onTogglePlay}
              onNext={onNext}
              activeSubPanel={activeSubPanel}
              onSwitchSubPanel={onSwitchSubPanel}
            />
          </div>

          {/* Right Column: Dynamic Feature Panel with Paging & Close X */}
          <div className="flex flex-col justify-between flex-1 min-w-0 h-[147px]">
            {/* Header Bar: Title + Paging Chevron Navigation + Indicator Dots + Close X Button */}
            <div className="flex items-center justify-between shrink-0 border-b border-white/[0.04] pb-1 mb-1 gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <span
                  className="text-[10px] tracking-[0.2em] font-semibold text-sky-300/80 uppercase truncate font-urbanist"
                  style={{ fontFamily: "'Urbanist', sans-serif" }}
                >
                  {activeSubPanel === 'lyrics' && 'SYNCED LYRICS'}
                  {activeSubPanel === 'playlist' &&
                    (selectedPlaylist ? selectedPlaylist.name.toUpperCase() : 'SPOTIFY LIBRARY')}
                  {activeSubPanel === 'queue' && queueContextTitle.toUpperCase()}
                  {activeSubPanel === 'search' && 'QUICK SEARCH'}
                </span>

                {isWakingSpotify ? (
                  <span
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-400/15 border border-sky-400/30 text-sky-300 text-[8.5px] font-urbanist font-medium shrink-0 animate-pulse"
                    style={{ fontFamily: "'Urbanist', sans-serif" }}
                  >
                    <Loader2 className="w-2 h-2 animate-spin" />
                    <span>Connecting Spotify...</span>
                  </span>
                ) : (
                  ((activeSubPanel === 'playlist' &&
                    (isLoadingPlaylists || isLoadingPlaylistTracks)) ||
                    (activeSubPanel === 'queue' && isLoadingQueue) ||
                    (activeSubPanel === 'search' && isSearching)) && (
                    <Loader2 className="w-2.5 h-2.5 text-white/50 animate-spin shrink-0" />
                  )
                )}
              </div>

              {/* Right side: Source Switcher, Search & Paging Controls */}
              <PlayerHeaderBar
                playbackSource={playbackSource}
                activeSubPanel={activeSubPanel}
                queueLength={queueLength}
                isCompact={true}
                isSpotifySession={isSpotifySession}
                isQueueOpen={isQueueOpen}
                isRefreshingLyrics={isRefreshingLyrics}
                isRefreshingSession={isRefreshingSession}
                showRefreshLyrics={activeSubPanel === 'lyrics'}
                showPagingControls={true}
                onSelectSource={onSelectSource}
                onToggleSearch={onToggleSearch}
                onToggleQueue={onToggleQueue}
                onRefreshLyrics={onRefreshLyrics}
                onRefreshSession={onRefreshSession}
                onPrevPanel={onPrevPanel}
                onNextPanel={onNextPanel}
                onSelectPanel={(p) => onSwitchSubPanel(p as any)}
                onClosePanel={() => onSwitchSubPanel(activeSubPanel)}
              />
            </div>

            {/* Body Area: Scrollable Content Containers with Wheel Scroll Protection */}
            <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
              {/* 1. Synced or Plain Lyrics */}
              {activeSubPanel === 'lyrics' && (
                <LyricsPanel
                  lines={displayLines}
                  activeLyricIndex={activeLyricIndex}
                  onSeekLine={(targetMs) => onLyricLineSeek(targetMs / 1000)}
                  isSynced={isSyncedLyrics}
                  containerRef={lyricsContainerRef}
                  onRefreshLyrics={onRefreshLyrics}
                  isRefreshingLyrics={isRefreshingLyrics}
                  isMidSongInstrumental={isMidSongInstrumental}
                  audioAdjustedTime={audioAdjustedTime}
                />
              )}

              {/* 2. Spotify Ecosystem Panels (Playlists, Queue, Quick Search) */}
              {activeSubPanel !== 'lyrics' && (
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
