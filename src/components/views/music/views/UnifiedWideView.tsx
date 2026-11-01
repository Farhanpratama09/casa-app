import React, { memo } from 'react';
import { Loader2, Headphones, Speaker } from 'lucide-react';
import { VinylDiscFallback } from './VinylDiscFallback';
import { PlayerHeaderBar } from '../PlayerHeaderBar';
import { PlayerControls } from '../PlayerControls';
import type { MusicSubPanel } from '../constants';

export interface UnifiedWideViewProps {
  // Playback & Session status
  playbackSource: 'companion' | 'native';
  activeSubPanel: MusicSubPanel;
  queueLength: number;
  isEffectivePlaying: boolean;
  hasActiveSession: boolean;
  canAccessSpotifyFeatures: boolean;
  isWakingSpotify: boolean;
  isResolvingAudio?: boolean;
  nativeAudioError?: string | null;
  isSpotifySession: boolean;
  isQueueOpen: boolean;
  isRefreshingLyrics: boolean;
  isRefreshingSession: boolean;

  // Metadata
  currentSessionId?: string | null;
  effectiveArtwork: string | null;
  effectiveTitle: string;
  effectiveArtist: string;

  // Scrubber / Transport time
  currentTimeSeconds: number;
  durationSeconds: number;
  isShuffle: boolean;
  isSmartShuffle: boolean;

  // Audio output device status
  audioOutput: 'headset' | 'speaker';
  activeAppName?: string;
  sessionCount: number;

  // Handlers
  onOpenSpotify: () => void;
  onQuitSpotify: (e: React.MouseEvent) => void;
  onCoverImageLoad?: () => void;
  onCoverImageError?: () => void;
  onSelectSource: (source: 'companion' | 'native') => void;
  onToggleSearch: () => void;
  onToggleQueue: () => void;
  onRefreshLyrics?: () => void;
  onRefreshSession?: () => void;
  onToggleAudioOutput: () => void;
  onContextMenuAudioOutput?: (e: React.MouseEvent) => void;
  onSeek: (seconds: number) => void;
  onToggleShuffle: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onSwitchSubPanel: (panel: MusicSubPanel) => void;
}

export const UnifiedWideView: React.FC<UnifiedWideViewProps> = memo(({
  playbackSource,
  activeSubPanel,
  queueLength,
  isEffectivePlaying,
  hasActiveSession,
  canAccessSpotifyFeatures,
  isWakingSpotify,
  isResolvingAudio,
  nativeAudioError,
  isSpotifySession,
  isQueueOpen,
  isRefreshingLyrics,
  isRefreshingSession,
  currentSessionId,
  effectiveArtwork,
  effectiveTitle,
  effectiveArtist,
  currentTimeSeconds,
  durationSeconds,
  isShuffle,
  isSmartShuffle,
  audioOutput,
  activeAppName,
  sessionCount,
  onOpenSpotify,
  onQuitSpotify,
  onCoverImageLoad,
  onCoverImageError,
  onSelectSource,
  onToggleSearch,
  onToggleQueue,
  onRefreshLyrics,
  onRefreshSession,
  onToggleAudioOutput,
  onContextMenuAudioOutput,
  onSeek,
  onToggleShuffle,
  onPrev,
  onTogglePlay,
  onNext,
  onSwitchSubPanel,
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

      <div className="relative z-10 w-full max-w-[620px] px-5 py-1.5 select-none flex flex-col justify-between h-[140px]">
        {/* Top Header Row: 46x46 Cover Art + Title/Artist + Quick Action Badges */}
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-3 min-w-0 flex-1">
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

            <div className="flex flex-col min-w-0 flex-1 justify-center">
              <div className="flex items-center gap-2">
                <h2
                  className="text-[14px] font-semibold text-white/95 truncate tracking-tight leading-snug font-sans"
                  title={effectiveTitle}
                >
                  {effectiveTitle}
                </h2>
                {isWakingSpotify && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-[#98BBD6]/15 border border-[#98BBD6]/30 text-[#98BBD6] text-[9px] font-mono shrink-0 animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>CONNECTING...</span>
                  </span>
                )}
                {isResolvingAudio && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-400/15 border border-sky-400/30 text-sky-300 text-[9px] font-mono shrink-0 animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>STREAMING...</span>
                  </span>
                )}
                {nativeAudioError && (
                  <span
                    className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-rose-500/15 border border-rose-500/30 text-rose-300 text-[8.5px] font-mono shrink-0"
                    title={nativeAudioError}
                  >
                    <span>STREAM ERROR</span>
                  </span>
                )}
              </div>
              <p
                className="text-[11px] font-medium text-white/40 truncate mt-0.5 font-sans"
                title={effectiveArtist}
              >
                {effectiveArtist}
              </p>
            </div>
          </div>

          {/* Quick Action Badges */}
          <div className="flex items-center gap-2 shrink-0 pl-3">
            <PlayerHeaderBar
              playbackSource={playbackSource}
              activeSubPanel={activeSubPanel}
              queueLength={queueLength}
              isCompact={false}
              isSpotifySession={isSpotifySession}
              isQueueOpen={isQueueOpen}
              isRefreshingLyrics={isRefreshingLyrics}
              isRefreshingSession={isRefreshingSession}
              onSelectSource={onSelectSource}
              onToggleSearch={onToggleSearch}
              onToggleQueue={onToggleQueue}
              onRefreshLyrics={onRefreshLyrics}
              onRefreshSession={onRefreshSession}
            />

            <button
              onClick={onOpenSpotify}
              onContextMenu={onQuitSpotify}
              className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-white/40 hover:text-[#1DB954] hover:bg-white/10 transition-all border border-transparent hover:border-[#1DB954]/30"
              title="Klik: Buka/Sembunyi | Klik Kanan: Keluar Total (Quit)"
              aria-label="Spotify Desktop (Klik: Buka/Sembunyi | Klik Kanan: Keluar Total)"
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.435-5.308-1.76-8.792-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.808-.87 7.076-.496 9.721 1.115.294.18.387.562.207.855zm1.226-2.724c-.227.368-.711.485-1.08.258-2.69-1.653-6.79-2.134-9.97-1.168-.413.125-.852-.108-.977-.52-.125-.413.108-.852.52-.977 3.633-1.103 8.147-.568 11.249 1.328.368.226.485.71.258 1.079zm.106-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.495.15-1.022-.13-1.172-.625-.15-.496.13-1.022.626-1.172 3.535-1.073 9.404-.866 13.115 1.338.445.264.59.838.327 1.282-.264.444-.838.59-1.281.327z" />
              </svg>
            </button>

            <button
              onClick={onToggleAudioOutput}
              onContextMenu={onContextMenuAudioOutput}
              className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-island-blue bg-island-blue/10 hover:bg-island-blue/20 transition-all border border-island-blue/20"
              title={`Output: ${audioOutput === 'headset' ? 'Headset/TWS' : 'Laptop Speaker'}${
                activeAppName ? ` • Sesi: ${activeAppName}` : ''
              }${sessionCount > 1 ? ' (Klik kanan kelola sesi)' : ''}`}
              aria-label="Audio Output Switcher"
            >
              {audioOutput === 'headset' ? (
                <Headphones className="w-3.5 h-3.5 shrink-0" />
              ) : (
                <Speaker className="w-3.5 h-3.5 shrink-0" />
              )}
            </button>
          </div>
        </div>

        {/* Player Controls (Scrubber & Transport) */}
        <PlayerControls
          isCompact={false}
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
    </div>
  );
});

UnifiedWideView.displayName = 'UnifiedWideView';
