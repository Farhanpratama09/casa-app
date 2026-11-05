import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  RotateCw,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  X,
  FolderOpen,
} from 'lucide-react';
import {
  CosmicSearchIcon,
  QueueOrbitIcon,
  SpotifyLunarIcon,
} from '../../system/CosmicIcons';
import { playChimeCue } from '../../../utils/tauriBridge';
import { PlaybackSource, MusicSubPanel, SUB_PANELS } from './constants';
export const BunnyMusicLogo = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className={`text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.6)] shrink-0 ${className}`}
  >
    {/* Siluet Bulan Sabit yang Menyilang Membentuk Telinga Kelinci */}
    <path d="M12 3c-1.2 0-2.4.3-3.5.9 1 .8 1.8 2 2.1 3.4.4 1.8-.2 3.6-1.5 4.8-1.3 1.2-3.1 1.7-4.8 1.3-.8-.2-1.5-.6-2.1-1.1.2 4.4 3.8 8 8.3 8 4.6 0 8.4-3.8 8.4-8.4 0-4.6-3.7-8.3-8.4-8.3" />
    {/* Telinga Kelinci Kembar Cyber Ramping */}
    <path d="M16 2.5c.8 1.2.6 3-.4 4.2M19.5 5c.4 1.5-.2 3.2-1.5 4" />
  </svg>
);

export const CompanionRadarIcon = ({ className = "w-4 h-4" }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
    <path d="M4 10a8 8 0 0 1 16 0" />
    <path d="M7 13a4 4 0 0 1 10 0" />
    <circle cx="12" cy="15" r="1.5" fill="currentColor" />
    <path d="M12 16.5V20" />
    <path d="M9 20h6" />
  </svg>
);

export interface PlayerHeaderBarProps {
  playbackSource: PlaybackSource;
  activeSubPanel?: MusicSubPanel;
  queueLength: number;
  isCompact?: boolean;
  isSpotifySession?: boolean;
  hasActiveSession?: boolean;
  isQueueOpen?: boolean;
  isRefreshingLyrics?: boolean;
  isRefreshingSession?: boolean;
  showRefreshLyrics?: boolean;
  showPagingControls?: boolean;
  onSelectSource: (source: PlaybackSource) => void;
  onToggleSearch: () => void;
  onToggleQueue: () => void;
  onOpenLocalFile?: () => void;
  onRefreshLyrics?: () => void;
  onRefreshSession?: () => void;
  onPrevPanel?: () => void;
  onNextPanel?: () => void;
  onSelectPanel?: (panel: MusicSubPanel) => void;
  onClosePanel?: () => void;
}

export const PlayerHeaderBar: React.FC<PlayerHeaderBarProps> = memo(({
  playbackSource,
  activeSubPanel = 'none',
  queueLength,
  isCompact = false,
  isSpotifySession = false,
  hasActiveSession = false,
  isQueueOpen = false,
  isRefreshingLyrics = false,
  isRefreshingSession = false,
  showRefreshLyrics = false,
  showPagingControls = false,
  onSelectSource,
  onToggleSearch,
  onToggleQueue,
  onOpenLocalFile,
  onRefreshLyrics,
  onRefreshSession,
  onPrevPanel,
  onNextPanel,
  onSelectPanel,
  onClosePanel,
}) => {
  const [isSourcePopoverOpen, setIsSourcePopoverOpen] = useState(false);
  const sourcePopoverRef = useRef<HTMLDivElement>(null);

  // Close source popover on outside click
  useEffect(() => {
    if (!isSourcePopoverOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (sourcePopoverRef.current && !sourcePopoverRef.current.contains(e.target as Node)) {
        setIsSourcePopoverOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClickOutside);
    return () => window.removeEventListener('mousedown', handleClickOutside);
  }, [isSourcePopoverOpen]);

  const handleSourceSelect = (source: PlaybackSource) => {
    playChimeCue('tap');
    setIsSourcePopoverOpen(false);
    onSelectSource(source);
  };

  const handleTogglePopover = (e: React.MouseEvent) => {
    e.stopPropagation();
    playChimeCue('tap');
    setIsSourcePopoverOpen((prev) => !prev);
  };

  return (
    <div className="flex items-center gap-1.5 shrink-0 relative select-none overflow-visible z-50">
      {/* Refresh Lyrics Button */}
      {showRefreshLyrics && onRefreshLyrics && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefreshLyrics();
          }}
          disabled={isRefreshingLyrics}
          className="w-[20px] h-[20px] rounded-full bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-zinc-100 flex items-center justify-center active:scale-[0.97] transition-all duration-100 ease-out shrink-0 cursor-pointer"
          title="Refresh Lirik"
          aria-label="Refresh Lirik"
        >
          <RotateCw className={`w-2.5 h-2.5 ${isRefreshingLyrics ? (isSpotifySession ? 'animate-spin text-emerald-400' : 'animate-spin text-cyan-400') : ''}`} />
        </button>
      )}

      {/* Refresh Media Session Button (Companion Mode) */}
      {playbackSource !== 'native' && !showRefreshLyrics && onRefreshSession && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefreshSession();
          }}
          disabled={isRefreshingSession}
          className="w-[20px] h-[20px] rounded-full bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-zinc-100 flex items-center justify-center active:scale-[0.97] transition-all duration-100 ease-out shrink-0 cursor-pointer"
          title="Refresh Sesi Media"
          aria-label="Refresh Sesi Media"
        >
          <RotateCw className={`w-2.5 h-2.5 ${isRefreshingSession ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      )}

      {/* Source Switcher Pill (Isolated strictly to Spotify/Companion mode - never visible in Native mode) */}
      {playbackSource !== 'native' && (
        <div className="relative shrink-0 overflow-visible z-50">
          <button
            onClick={handleTogglePopover}
            className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] transition-all duration-100 ease-out shrink-0 cursor-pointer active:scale-[0.97] select-none"
            title="Pilih Sumber Pemutaran"
            aria-label="Pilih Sumber Pemutaran"
          >
            {isSpotifySession ? (
              <SpotifyLunarIcon className="w-4 h-4 text-emerald-400" />
            ) : (
              <CompanionRadarIcon className="w-4 h-4 text-emerald-400" />
            )}
            <ChevronDown className="w-3 h-3 text-zinc-400" />
          </button>

          {/* Source Dropdown Popover */}
          {isSourcePopoverOpen && (
            <div
              ref={sourcePopoverRef}
              className="absolute right-0 top-[calc(100%+4px)] w-56 min-w-[220px] bg-[#0e0e11] border border-[#2e2e34] rounded-xl p-1.5 shadow-[0_16px_36px_rgba(0,0,0,0.95)] z-[9999] overflow-hidden flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Option 1: CASA Native Player */}
              <button
                onClick={() => handleSourceSelect('native')}
                className="w-full flex items-start gap-2 p-1.5 rounded-lg text-left transition-colors cursor-pointer active:scale-[0.97] duration-100 ease-out hover:bg-[#18181c] text-zinc-400 hover:text-zinc-200 border border-transparent"
              >
                <div className="mt-0.5 w-4 h-4 rounded-full bg-cyan-500/10 text-cyan-400 flex items-center justify-center shrink-0 border border-cyan-500/20">
                  <BunnyMusicLogo className="w-3.5 h-3.5 text-cyan-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold tracking-tight text-zinc-100 truncate">
                      CASA Native Player
                    </span>
                  </div>
                  <p className="text-[9.5px] font-semibold tracking-wider uppercase text-zinc-400 leading-tight mt-0.5 truncate">
                    PUTAR MUSIK MANDIRI
                  </p>
                </div>
              </button>

              {/* Option 2: Windows Media / Companion */}
              <button
                onClick={() => handleSourceSelect('companion')}
                className="w-full flex items-start gap-2 p-1.5 rounded-lg text-left transition-colors cursor-pointer active:scale-[0.97] duration-100 ease-out bg-emerald-500/10 border border-emerald-500/30 text-zinc-100"
              >
                <div className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/10 text-emerald-400 flex items-center justify-center shrink-0 border border-emerald-500/20">
                  <SpotifyLunarIcon className="w-3.5 h-3.5 text-emerald-400" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <span className="text-[11px] font-semibold tracking-tight text-zinc-100 truncate">
                      Windows Media / Companion
                    </span>
                    <span className="text-emerald-400 text-[10px] font-bold shrink-0">●</span>
                  </div>
                  <p className="text-[9.5px] font-semibold tracking-wider uppercase text-zinc-400 leading-tight mt-0.5 truncate">
                    MEDIA BROWSER & SPOTIFY
                  </p>
                </div>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Action Buttons: ONLY in CASA Native Player mode & ONLY in Unified Wide Mode when NO active track is playing (Standby) */}
      {playbackSource === 'native' && !isCompact && !hasActiveSession && (
        <>
          {/* Search Button: [🔍 Cari Musik Online] */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              onToggleSearch();
            }}
            className="flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9.5px] font-medium bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-300 hover:text-cyan-300 transition-all duration-100 ease-out cursor-pointer active:scale-[0.97] min-w-0"
            title="Cari Musik Online via InnerTube"
            aria-label="Cari Musik Online"
          >
            <CosmicSearchIcon className="w-3 h-3 text-cyan-400 shrink-0" />
            <span className="tracking-tight truncate font-medium">
              Cari Musik Online
            </span>
          </button>

          {/* Queue Button: Constellation Stack + Satellite Badge */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              onToggleQueue();
            }}
            className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[9.5px] font-medium transition-all duration-100 ease-out cursor-pointer active:scale-[0.97] border min-w-0 ${
              isQueueOpen
                ? 'bg-cyan-500/15 border-cyan-500/30 text-cyan-300'
                : queueLength > 0
                ? 'bg-cyan-500/10 border-cyan-500/25 text-cyan-300 hover:bg-cyan-500/15'
                : 'bg-[#18181c] hover:bg-[#222226] border-[#2e2e34] text-zinc-400 hover:text-zinc-200'
            }`}
            title="Daftar Antrean Lagu (CASA Native Player)"
            aria-label="Daftar Antrean"
          >
            <QueueOrbitIcon className="w-3.5 h-3.5 text-cyan-400 shrink-0" count={isCompact ? queueLength : undefined} />
            <span className="tracking-tight truncate font-medium">
              Antrean ({queueLength})
            </span>
          </button>
        </>
      )}

      {/* Close Button (if active) */}
      {showPagingControls && onClosePanel && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            playChimeCue('tap');
            onClosePanel();
          }}
          className="w-4 h-4 ml-0.5 rounded-full bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-zinc-100 flex items-center justify-center active:scale-[0.97] transition-all duration-100 ease-out cursor-pointer shrink-0"
          title="Tutup Panel Samping"
          aria-label="Tutup Panel Samping"
        >
          <X className="w-2.5 h-2.5" />
        </button>
      )}
    </div>
  );
});

PlayerHeaderBar.displayName = 'PlayerHeaderBar';
