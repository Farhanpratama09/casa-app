import React, { memo } from 'react';
import { Loader2 } from 'lucide-react';
import { MoonRabbitEmblem } from '../../../MoonRabbitEmblem';
import { SpotifyLunarIcon } from '../../../system/CosmicIcons';
import { PlayerHeaderBar } from '../PlayerHeaderBar';

export interface EmptyMediaViewProps {
  playbackSource: 'companion' | 'native';
  activeSubPanel: 'none' | 'lyrics' | 'search' | 'queue' | 'playlist';
  queueLength: number;
  isSpotifySession: boolean;
  isQueueOpen: boolean;
  isRefreshingLyrics: boolean;
  isRefreshingSession: boolean;
  isWakingSpotify?: boolean;
  onSelectSource: (source: 'companion' | 'native') => void;
  onToggleSearch: () => void;
  onToggleQueue: () => void;
  onRefreshLyrics?: () => void;
  onRefreshSession?: () => void;
  onOpenSpotify: () => void;
  onOpenPlaylist?: () => void;
  onQuitSpotify?: (e: React.MouseEvent) => void;
}

export const EmptyMediaView: React.FC<EmptyMediaViewProps> = memo(({
  playbackSource,
  activeSubPanel,
  queueLength,
  isSpotifySession,
  isQueueOpen,
  isRefreshingLyrics,
  isRefreshingSession,
  isWakingSpotify = false,
  onSelectSource,
  onToggleSearch,
  onToggleQueue,
  onRefreshLyrics,
  onRefreshSession,
  onOpenSpotify,
  onQuitSpotify,
}) => {
  return (
    <div className="w-full max-w-[620px] h-[140px] px-6 py-4 select-none flex items-center justify-between overflow-visible relative bg-[#121215] border border-[#222226] rounded-2xl">
      {/* =================================================================== */}
      {/* Left: Artwork Frame (56x56) + Polished Geometric Typography         */}
      {/* =================================================================== */}
      <div className="flex items-center gap-4 min-w-0 relative z-10">
        {/* Artwork Frame: w-14 h-14 */}
        <div
          onContextMenu={onQuitSpotify}
          className="w-14 h-14 rounded-xl border border-[#222226] bg-[#18181c] flex items-center justify-center shrink-0 relative overflow-hidden group cursor-default shadow-none"
          title="CASA Standby Radar (Klik Kanan: Keluar Spotify)"
        >
          {/* Central Moon Rabbit Emblem */}
          <MoonRabbitEmblem
            size={24}
            className="relative z-10 opacity-90 group-hover:scale-105 transition-transform"
          />
        </div>

        {/* Text Area */}
        <div className="flex flex-col gap-0.5 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold tracking-wider uppercase text-zinc-400">
              MEDIA
            </span>
            {isWakingSpotify && (
              <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/25 text-cyan-300 text-[9px] font-mono tracking-wider animate-pulse">
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span>CONNECTING...</span>
              </span>
            )}
          </div>

          <h3 className="text-sm font-medium text-zinc-100 tracking-tight m-0 p-0 leading-snug truncate">
            No Media Playing
          </h3>

          <p className="text-xs text-zinc-400 m-0 p-0 leading-normal truncate">
            Putar audio di Spotify atau browser
          </p>
        </div>
      </div>

      {/* =================================================================== */}
      {/* Right: Solid Matte Launcher "Buka Spotify"                         */}
      {/* =================================================================== */}
      <div className="flex items-center shrink-0 relative z-50 overflow-visible gap-2">
        <PlayerHeaderBar
          playbackSource={playbackSource}
          activeSubPanel={activeSubPanel}
          queueLength={queueLength}
          isCompact={true}
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
          type="button"
          onClick={onOpenSpotify}
          onContextMenu={onQuitSpotify}
          disabled={isWakingSpotify}
          className="px-3.5 py-1.5 rounded-full border border-[#2e2e34] bg-[#18181c] hover:bg-[#222226] hover:border-zinc-700 transition-all duration-100 ease-out flex items-center gap-2 text-xs font-medium text-zinc-300 hover:text-white active:scale-[0.97] cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group shrink-0"
          title="Klik: Buka Spotify | Klik Kanan: Tutup Total"
        >
          {isWakingSpotify ? (
            <Loader2 className="w-[13px] h-[13px] animate-spin text-zinc-400" />
          ) : (
            <SpotifyLunarIcon className="w-[14px] h-[14px] text-emerald-400 group-hover:text-emerald-300 shrink-0 transition-colors" />
          )}
          <span className="tracking-tight">Buka Spotify</span>
        </button>
      </div>
    </div>
  );
});

EmptyMediaView.displayName = 'EmptyMediaView';
