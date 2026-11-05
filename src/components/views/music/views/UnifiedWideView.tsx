import React, { memo } from 'react';
import {
  Loader2,
} from 'lucide-react';
import { SpotifyLunarIcon } from '../../../system/CosmicIcons';
import { VinylDiscFallback } from './VinylDiscFallback';
import { PlayerHeaderBar } from '../PlayerHeaderBar';
import { PlayerControls } from '../PlayerControls';
import type { MusicSubPanel } from '../constants';
import type { AudioDeviceType } from '../../../../hooks/useSystemHardware';
import type { NativeTrack } from '../../../../services/nativeAudioService';

export interface UnifiedWideViewProps {
  // Playback & Session status
  playbackSource: 'companion' | 'native';
  nativeTrack?: NativeTrack | null;
  onOpenLocalFile?: () => void;
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
  isRepeat?: boolean;
  onToggleRepeat?: () => void;

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
  onToggleMute?: () => void;
  onSeek: (seconds: number) => void;
  onToggleShuffle: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  onSwitchSubPanel: (panel: MusicSubPanel) => void;
  onEjectNative?: () => void;
}

export const UnifiedWideView: React.FC<UnifiedWideViewProps> = memo(({
  playbackSource,
  nativeTrack,
  onOpenLocalFile,
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
  isRepeat = false,
  onToggleRepeat,
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
  onToggleMute,
  onSeek,
  onToggleShuffle,
  onPrev,
  onTogglePlay,
  onNext,
  onSwitchSubPanel,
  onEjectNative,
}) => {
  return (
    <div
      className="relative w-full max-w-[620px] h-full min-h-0 bg-[#121215] border border-[#222226] rounded-2xl overflow-visible"
    >
      <div className="relative z-10 w-full max-w-[620px] h-full min-h-0 px-5 py-1.5 select-none flex flex-col justify-between overflow-visible">
        {/* Top Header Row: 46x46 Cover Art + Title/Artist + Quick Action Badges */}
        <div className="flex items-center justify-between w-full overflow-visible relative z-50">
          <div className="flex items-center gap-3 min-w-0 flex-1">
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

            <div className="flex flex-col min-w-0 flex-1 justify-center">
              <div className="flex items-center gap-2">
                <h2
                  className="font-sans font-semibold text-[13px] text-zinc-100 truncate tracking-tight leading-snug"
                  title={effectiveTitle}
                >
                  {effectiveTitle}
                </h2>
                {isWakingSpotify && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-emerald-500/10 border border-emerald-500/25 text-emerald-300 text-[9px] font-mono shrink-0 animate-pulse">
                    <Loader2 className="w-2.5 h-2.5 animate-spin" />
                    <span>CONNECTING...</span>
                  </span>
                )}
                {isResolvingAudio && (
                  <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[9px] font-mono shrink-0 animate-pulse">
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
                className="font-sans font-medium text-[11px] text-zinc-400 truncate mt-0.5 tracking-wide"
                title={effectiveArtist}
              >
                {effectiveArtist}
              </p>
            </div>
          </div>

          {/* Quick Action Badges */}
          <div className="flex items-center gap-2 shrink-0 pl-3 overflow-visible relative z-50">
            <PlayerHeaderBar
              playbackSource={playbackSource}
              activeSubPanel={activeSubPanel}
              queueLength={queueLength}
              isCompact={false}
              isSpotifySession={isSpotifySession}
              hasActiveSession={hasActiveSession}
              isQueueOpen={isQueueOpen}
              isRefreshingLyrics={isRefreshingLyrics}
              isRefreshingSession={isRefreshingSession}
              onSelectSource={onSelectSource}
              onToggleSearch={onToggleSearch}
              onToggleQueue={onToggleQueue}
              onOpenLocalFile={onOpenLocalFile}
              onRefreshLyrics={onRefreshLyrics}
              onRefreshSession={onRefreshSession}
            />

            {playbackSource === 'native' ? (
              <div className="flex items-center gap-1.5">
                {nativeTrack && onEjectNative ? (
                  <button
                    onClick={onEjectNative}
                    className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-zinc-400 hover:text-cyan-400 hover:bg-cyan-950/30 border border-transparent hover:border-cyan-500/30 transition-all duration-100 ease-out active:scale-[0.97] cursor-pointer"
                    title="Tutup Sesi / Eject (Kembali ke Standby)"
                    aria-label="Tutup Sesi / Eject"
                  >
                    <span className="text-[13px] font-sans font-bold leading-none select-none text-zinc-400 hover:text-cyan-400">⏏</span>
                  </button>
                ) : (
                  <button
                    onClick={() => onSelectSource?.('companion')}
                    className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-zinc-500 hover:text-emerald-400 hover:bg-[#18181c] border border-transparent hover:border-[#2e2e34] transition-all duration-100 ease-out active:scale-[0.97] cursor-pointer"
                    title="Beralih ke Windows Media / Spotify"
                    aria-label="Beralih ke Windows Media / Spotify"
                  >
                    <SpotifyLunarIcon className="w-3.5 h-3.5 text-zinc-500 hover:text-emerald-400 transition-colors" />
                  </button>
                )}
              </div>
            ) : (
              <button
                onClick={onOpenSpotify}
                onContextMenu={onQuitSpotify}
                className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-[#18181c] transition-all duration-100 ease-out border border-transparent hover:border-[#2e2e34] active:scale-[0.97] cursor-pointer"
                title="Klik: Buka/Sembunyi | Klik Kanan: Keluar Total (Quit)"
                aria-label="Spotify Desktop (Klik: Buka/Sembunyi | Klik Kanan: Keluar Total)"
              >
                <SpotifyLunarIcon className="w-3.5 h-3.5 text-emerald-400/80 hover:text-emerald-400 transition-colors" />
              </button>
            )}
          </div>
        </div>

        {/* Player Controls (Scrubber & Transport) */}
        <PlayerControls
          isCompact={false}
          isSpotifySession={isSpotifySession}
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
          isRepeat={isRepeat}
          onToggleRepeat={onToggleRepeat}
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
