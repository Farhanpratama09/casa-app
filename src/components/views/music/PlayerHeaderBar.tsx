import React, { useState, useRef, useEffect, useCallback, memo } from 'react';
import {
  RotateCw,
  Music,
  Headphones,
  Globe,
  ChevronDown,
  Search,
  ListMusic,
  ChevronLeft,
  ChevronRight,
  X,
} from 'lucide-react';
import { playChimeCue } from '../../../utils/tauriBridge';
import { PlaybackSource, MusicSubPanel, SUB_PANELS } from './constants';

export interface PlayerHeaderBarProps {
  playbackSource: PlaybackSource;
  activeSubPanel?: MusicSubPanel;
  queueLength: number;
  isCompact?: boolean;
  isSpotifySession?: boolean;
  isQueueOpen?: boolean;
  isRefreshingLyrics?: boolean;
  isRefreshingSession?: boolean;
  showRefreshLyrics?: boolean;
  showPagingControls?: boolean;
  onSelectSource: (source: PlaybackSource) => void;
  onToggleSearch: () => void;
  onToggleQueue: () => void;
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
  isQueueOpen = false,
  isRefreshingLyrics = false,
  isRefreshingSession = false,
  showRefreshLyrics = false,
  showPagingControls = false,
  onSelectSource,
  onToggleSearch,
  onToggleQueue,
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
    <div className="flex items-center gap-1.5 shrink-0 relative select-none">
      {/* Refresh Lyrics Button */}
      {showRefreshLyrics && onRefreshLyrics && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRefreshLyrics();
          }}
          disabled={isRefreshingLyrics}
          className="w-[20px] h-[20px] rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/50 hover:text-white flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95"
          title="Refresh Lirik"
          aria-label="Refresh Lirik"
        >
          <RotateCw className={`w-2.5 h-2.5 ${isRefreshingLyrics ? 'animate-spin text-sky-300' : ''}`} />
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
          className="w-[20px] h-[20px] rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/50 hover:text-white flex items-center justify-center transition-all shrink-0 cursor-pointer active:scale-95"
          title="Refresh Sesi Media"
          aria-label="Refresh Sesi Media"
        >
          <RotateCw className={`w-2.5 h-2.5 ${isRefreshingSession ? 'animate-spin text-emerald-400' : ''}`} />
        </button>
      )}

      {/* Source Switcher Pill */}
      <div className="relative shrink-0">
        <button
          onClick={handleTogglePopover}
          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-medium transition-all cursor-pointer select-none border active:scale-95 shrink-0 ${
            playbackSource === 'native'
              ? 'bg-sky-500/15 border-sky-400/30 text-sky-200 hover:bg-sky-500/25 shadow-[0_0_8px_rgba(56,189,248,0.15)]'
              : 'bg-white/[0.04] border-white/[0.08] text-white/70 hover:text-white hover:bg-white/[0.08]'
          }`}
          title="Ganti Sumber Pemutaran (CASA Native vs Windows Media)"
          aria-label="Pilih Sumber Pemutaran"
        >
          {playbackSource === 'native' ? (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse shrink-0" />
              <Music className="w-2.5 h-2.5 text-sky-300 shrink-0" />
              <span className="font-urbanist tracking-tight font-semibold shrink-0">
                {isCompact ? 'CASA' : 'CASA Player'}
              </span>
            </>
          ) : isSpotifySession ? (
            <>
              <Headphones className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
              <span className="font-urbanist tracking-tight shrink-0 font-medium text-emerald-300">
                Spotify
              </span>
            </>
          ) : (
            <>
              <Globe className="w-2.5 h-2.5 text-emerald-400 shrink-0" />
              <span className="font-urbanist tracking-tight shrink-0">
                {isCompact ? 'Media' : 'Windows Media'}
              </span>
            </>
          )}
          <ChevronDown className="w-2.5 h-2.5 text-white/40 ml-0.5 shrink-0" />
        </button>

        {/* Source Dropdown Popover */}
        {isSourcePopoverOpen && (
          <div
            ref={sourcePopoverRef}
            className="absolute right-0 top-full mt-1.5 w-[225px] rounded-xl bg-[#0E121B]/95 border border-white/10 shadow-[0_12px_32px_rgba(0,0,0,0.65)] backdrop-blur-xl p-1 z-50 flex flex-col gap-0.5 animate-in fade-in zoom-in-95 duration-150"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Option 1: CASA Native Player */}
            <button
              onClick={() => handleSourceSelect('native')}
              className={`flex items-start gap-2 p-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                playbackSource === 'native'
                  ? 'bg-sky-500/15 border border-sky-500/30 text-white'
                  : 'hover:bg-white/[0.06] text-white/70 hover:text-white border border-transparent'
              }`}
            >
              <div className="mt-0.5 w-4 h-4 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center shrink-0">
                <Music className="w-2.5 h-2.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-tight text-white font-sans">
                    CASA Native Player
                  </span>
                  {playbackSource === 'native' && (
                    <span className="text-sky-400 text-[10px] font-bold">●</span>
                  )}
                </div>
                <p className="text-[9.5px] text-white/40 leading-tight mt-0.5 font-sans">
                  Putar Musik Mandiri
                </p>
              </div>
            </button>

            {/* Option 2: Windows Media / Companion */}
            <button
              onClick={() => handleSourceSelect('companion')}
              className={`flex items-start gap-2 p-1.5 rounded-lg text-left transition-colors cursor-pointer ${
                playbackSource === 'companion'
                  ? 'bg-emerald-500/15 border border-emerald-500/30 text-white'
                  : 'hover:bg-white/[0.06] text-white/70 hover:text-white border border-transparent'
              }`}
            >
              <div className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 text-emerald-300 flex items-center justify-center shrink-0">
                <Globe className="w-2.5 h-2.5" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold tracking-tight text-white font-sans">
                    Windows Media / Companion
                  </span>
                  {playbackSource === 'companion' && (
                    <span className="text-emerald-400 text-[10px] font-bold">✓</span>
                  )}
                </div>
                <p className="text-[9.5px] text-white/40 leading-tight mt-0.5 font-sans">
                  Media Browser & Spotify
                </p>
              </div>
            </button>
          </div>
        )}
      </div>

      {/* Action Buttons: ONLY in CASA Native Player mode */}
      {playbackSource === 'native' && (
        <>
          {/* Search Button: [ 🔍 Cari Lagu ] */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              onToggleSearch();
            }}
            className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-medium bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/60 hover:text-white transition-all cursor-pointer active:scale-95 shrink-0"
            title="Cari Lagu (CASA Native Player)"
            aria-label="Cari Lagu"
          >
            <Search className="w-2.5 h-2.5 text-sky-300 shrink-0" />
            <span className="font-urbanist tracking-tight shrink-0">
              {isCompact ? 'Cari' : 'Cari Lagu'}
            </span>
          </button>

          {/* Queue Button: [ 📑 Antrean (N) ] */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              onToggleQueue();
            }}
            className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-medium transition-all cursor-pointer active:scale-95 border shrink-0 ${
              isQueueOpen
                ? 'bg-sky-500/20 border-sky-400/40 text-sky-200 shadow-[0_0_8px_rgba(56,189,248,0.2)]'
                : queueLength > 0
                ? 'bg-sky-500/10 border-sky-400/20 text-sky-300 hover:bg-sky-500/15'
                : 'bg-white/[0.04] border-white/[0.08] text-white/50 hover:text-white hover:bg-white/[0.08]'
            }`}
            title="Daftar Antrean Lagu (CASA Native Player)"
            aria-label="Daftar Antrean"
          >
            <ListMusic className="w-2.5 h-2.5 text-sky-300 shrink-0" />
            <span className="font-urbanist tracking-tight shrink-0">
              Antrean {queueLength > 0 ? `(${queueLength})` : ''}
            </span>
          </button>
        </>
      )}

      {/* Paging Controls & Close Button (for side panel view) */}
      {showPagingControls && (
        <div className="flex items-center gap-1 shrink-0 ml-0.5">
          {onPrevPanel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onPrevPanel();
              }}
              className="w-4 h-4 rounded-full hover:bg-white/[0.08] text-white/40 hover:text-white flex items-center justify-center transition-colors active:scale-95 cursor-pointer shrink-0"
              title="Previous Feature (<)"
              aria-label="Previous Feature"
            >
              <ChevronLeft className="w-3 h-3" />
            </button>
          )}

          {onSelectPanel && (
            <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] shrink-0">
              {SUB_PANELS.map((p) => (
                <button
                  key={p}
                  onClick={() => {
                    if (activeSubPanel !== p) {
                      onSelectPanel(p);
                    }
                  }}
                  className={`h-1 rounded-full transition-all cursor-pointer ${
                    activeSubPanel === p
                      ? 'w-2.5 bg-sky-300 shadow-[0_0_6px_rgba(125,211,252,0.6)]'
                      : 'w-1 bg-white/20 hover:bg-white/40'
                  }`}
                  title={`Switch to ${p}`}
                  aria-label={`Switch to ${p}`}
                />
              ))}
            </div>
          )}

          {onNextPanel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onNextPanel();
              }}
              className="w-4 h-4 rounded-full hover:bg-white/[0.08] text-white/40 hover:text-white flex items-center justify-center transition-colors active:scale-95 cursor-pointer shrink-0"
              title="Next Feature (>)"
              aria-label="Next Feature"
            >
              <ChevronRight className="w-3 h-3" />
            </button>
          )}

          {onClosePanel && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                onClosePanel();
              }}
              className="w-4 h-4 ml-0.5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-all active:scale-95 cursor-pointer shrink-0"
              title="Close Side Panel (Return to Unified Player)"
              aria-label="Close Side Panel"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>
      )}
    </div>
  );
});

PlayerHeaderBar.displayName = 'PlayerHeaderBar';
