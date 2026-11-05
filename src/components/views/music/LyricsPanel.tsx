import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
import { RotateCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { LyricLine, parseTimeToSeconds } from '../../../utils/lyricsService';

/**
 * Hardware-grade Auto-scrolling Lyrics Marquee
 * Eliminates text truncation (...) with seamless dual-span loop & 2s initial pause.
 * Uses useLayoutEffect to measure layout synchronously before paint, eliminating visual pop/flicker.
 */
interface MarqueeLyricProps {
  text: string;
  className?: string;
}

export const MarqueeLyric: React.FC<MarqueeLyricProps> = memo(({ text, className = '' }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  useLayoutEffect(() => {
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth + 2);
      }
    };
    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [text]);

  if (!text || text.trim() === '' || text === '\u00A0') {
    return <p className={`truncate ${className}`}>{'\u00A0'}</p>;
  }

  return (
    <div
      ref={containerRef}
      className={`overflow-hidden whitespace-nowrap relative ${
        isOverflowing ? 'mask-marquee' : ''
      } ${className}`}
    >
      {isOverflowing ? (
        <div className="inline-flex animate-lyrics-marquee">
          <span ref={textRef} className="pr-6 inline-block">
            {text}
          </span>
          <span className="pr-6 inline-block">{text}</span>
        </div>
      ) : (
        <span ref={textRef} className="block truncate">
          {text}
        </span>
      )}
    </div>
  );
});
MarqueeLyric.displayName = 'MarqueeLyric';

/**
 * Memoized Stable Lyric Row Item
 * Prevents DOM re-creation and layout thrashing across 60FPS RAF interpolation ticks.
 * Confines CSS transitions to non-geometric properties to prevent Chromium layout churn.
 */
export interface LyricRowItemProps {
  line: {
    id: string;
    timeMs: number;
    text: string;
    time?: number;
    seconds?: number;
    timeSeconds?: number;
  };
  isActive: boolean;
  isNear: boolean;
  isFar: boolean;
  duration?: number;
  onSeek: (targetSeconds: number) => void;
  isMidSongInstrumental?: boolean;
  isSpotifyActive?: boolean;
}

export const LyricRowItem = memo(
  React.forwardRef<HTMLDivElement, LyricRowItemProps>(
    ({ line, isActive, isNear, isFar, duration = 0, onSeek, isMidSongInstrumental, isSpotifyActive = false }, ref) => {
      const handleClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        const rawTime =
          line.seconds ??
          line.timeSeconds ??
          line.time ??
          (typeof line.timeMs === 'number' ? line.timeMs / 1000 : 0);
        const targetSeconds = parseTimeToSeconds(rawTime);
        if (!isNaN(targetSeconds) && targetSeconds >= 0) {
          onSeek(targetSeconds);
        }
      };

      return (
        <React.Fragment>
          <div
            ref={ref}
            onClick={handleClick}
            className={`cursor-pointer transition-all duration-300 ease-out origin-left py-0.5 px-2 rounded-[5px] flex items-center shrink-0 min-h-[22px] my-0.5 ${
              isActive
                ? isSpotifyActive
                  ? 'scale-[1.02] font-semibold opacity-100 border-emerald-500/40 bg-emerald-950/25 text-emerald-100 border-l-2 pl-2.5 pr-2 rounded-r-md shadow-sm'
                  : 'scale-[1.02] font-semibold opacity-100 border-cyan-500/40 bg-cyan-950/25 text-cyan-100 border-l-2 pl-2.5 pr-2 rounded-r-md shadow-sm'
                : isNear
                ? 'opacity-40 scale-100 hover:opacity-80 pl-2.5 border-l-2 border-transparent text-zinc-300 font-normal'
                : 'opacity-15 scale-100 hover:opacity-50 pl-2.5 border-l-2 border-transparent text-zinc-400 font-normal'
            }`}
            title={line.text}
          >
            {isActive ? (
              <MarqueeLyric
                text={line.text}
                className={`text-[13px] font-semibold tracking-tight leading-snug ${
                  isSpotifyActive ? 'text-emerald-100' : 'text-zinc-100'
                }`}
              />
            ) : (
              <p className="truncate leading-tight text-[11.5px] text-zinc-400 font-normal">
                {line.text}
              </p>
            )}
          </div>

          {/* Mid-song instrumental pause indicator */}
          {isActive && isMidSongInstrumental && (
            <div className="my-1 py-0.5 px-2 mx-1 rounded bg-[#18181c] border border-[#2e2e34] flex items-center gap-2 text-zinc-400 text-[9px] animate-pulse shrink-0">
              <span className="tracking-widest font-bold text-zinc-300">• • •</span>
              <span className="tracking-wider uppercase text-[8px] font-mono text-zinc-400">
                Instrumental Interlude
              </span>
            </div>
          )}
        </React.Fragment>
      );
    }
  )
);
LyricRowItem.displayName = 'LyricRowItem';

export interface LyricsPanelProps {
  lines: Array<{
    id: string;
    timeMs: number;
    text: string;
    time?: number;
    seconds?: number;
    timeSeconds?: number;
  }>;
  activeLyricIndex: number;
  onSeekLine: (targetSeconds: number) => void;
  duration?: number;
  isLoading?: boolean;
  isInstrumental?: boolean;
  isSynced?: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onRefreshLyrics?: () => void;
  isRefreshingLyrics?: boolean;
  isMidSongInstrumental?: boolean;
  audioAdjustedTime?: number;
  emptyTitle?: string;
  emptySubtitle?: string;
  isSpotifyActive?: boolean;
  isSpotifySession?: boolean;
}

export const LyricsPanel: React.FC<LyricsPanelProps> = memo(({
  lines,
  activeLyricIndex,
  onSeekLine,
  duration = 0,
  isLoading = false,
  isInstrumental = false,
  isSynced = true,
  containerRef: externalContainerRef,
  onRefreshLyrics,
  isRefreshingLyrics = false,
  isMidSongInstrumental = false,
  audioAdjustedTime = 0,
  emptyTitle,
  emptySubtitle,
  isSpotifyActive = false,
  isSpotifySession = false,
}) => {
  const effectiveSpotifyActive = Boolean(isSpotifyActive || isSpotifySession);
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const activeLineRef = useRef<HTMLDivElement>(null);

  const [targetY, setTargetY] = useState<number>(0);
  const [userOffset, setUserOffset] = useState<number>(0);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Spring Physics Auto-centering: Calculates exact center position for active lyric line
  useLayoutEffect(() => {
    if (!isSynced) return;
    if (activeLyricIndex < 0) {
      setTargetY(0);
      return;
    }

    const container = containerRef.current;
    const activeEl = activeLineRef.current;
    if (container && activeEl) {
      const containerHeight = container.clientHeight;
      const activeTop = activeEl.offsetTop;
      const activeHeight = activeEl.offsetHeight || activeEl.clientHeight;
      // Center aligned view
      const centeredY = containerHeight / 2 - (activeTop + activeHeight / 2);
      setTargetY(centeredY);
    }
  }, [activeLyricIndex, isSynced, lines]);

  // Recalculate centering on container/window resize
  useEffect(() => {
    const handleResize = () => {
      const container = containerRef.current;
      const activeEl = activeLineRef.current;
      if (container && activeEl && activeLyricIndex >= 0) {
        const containerHeight = container.clientHeight;
        const activeTop = activeEl.offsetTop;
        const activeHeight = activeEl.offsetHeight || activeEl.clientHeight;
        setTargetY(containerHeight / 2 - (activeTop + activeHeight / 2));
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [activeLyricIndex, containerRef]);

  // Reset user manual scroll offset when lyric line advances
  useEffect(() => {
    setUserOffset(0);
  }, [activeLyricIndex]);

  // Wheel interaction: Allow temporary manual peek, auto-realigning to active lyric with spring physics
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    setUserOffset((prev) => prev - e.deltaY * 0.7);
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      setUserOffset(0);
    }, 2500);
  }, []);

  // Loading Stardust State: Displayed while LRCLIB / Spotify API fetches lyrics
  if (isLoading) {
    return (
      <div
        data-tauri-drag-region="false"
        className="flex-1 min-h-0 flex flex-col items-center justify-center py-2 px-3.5 text-center select-none space-y-2 animate-in fade-in duration-200"
      >
        <div className="relative flex items-center justify-center">
          <div className="relative w-7 h-7 flex items-center justify-center">
            {/* Spinning Stardust Arc */}
            <div
              className={`absolute inset-0 rounded-full border-2 border-t-transparent animate-spin ${
                effectiveSpotifyActive
                  ? 'border-emerald-400 drop-shadow-[0_0_8px_rgba(16,185,129,0.5)]'
                  : 'border-cyan-400 drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]'
              }`}
            />
            {/* Core Stardust Dot */}
            <span
              className={`w-1.5 h-1.5 rounded-full ${
                effectiveSpotifyActive ? 'bg-emerald-300' : 'bg-cyan-300'
              } animate-ping`}
            />
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <h4 className="text-[11.5px] font-medium text-zinc-200 tracking-tight m-0 leading-tight">
            Menyelaraskan Lirik Kosmik...
          </h4>
          <p className="text-[9.5px] text-zinc-400 m-0 leading-tight">
            Mengambil stardust lirik dari LRCLIB
          </p>
        </div>
      </div>
    );
  }

  // Empty state: No lines or explicitly marked instrumental
  if (isInstrumental || lines.length === 0) {
    return (
      <div
        data-tauri-drag-region="false"
        className="flex-1 min-h-0 flex flex-col items-center justify-center py-1 px-3.5 text-center select-none space-y-1"
      >
        <div className="relative flex items-center justify-center">
          <div className="w-6 h-6 p-1.5 rounded-lg bg-[#18181c] border border-[#2e2e34] flex items-center justify-center relative shadow-sm">
            <svg className={`w-3 h-3 ${effectiveSpotifyActive ? 'text-emerald-400' : 'text-cyan-400'}`} viewBox="0 0 16 16" fill="none">
              <line x1="2.5" y1="6" x2="2.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="5.5" y1="4" x2="5.5" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="10.5" y1="5" x2="10.5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="13.5" y1="7" x2="13.5" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5 my-1">
          <h4
            className="text-xs font-medium text-zinc-300 tracking-tight m-0 leading-tight"
          >
            {emptyTitle || 'No Lyrics Available'}
          </h4>
          <p
            className="text-[10px] text-zinc-400 m-0 leading-tight max-w-[240px]"
          >
            {emptySubtitle || (isInstrumental ? 'Instrumental playback' : 'Instrumental or unsynced playback')}
          </p>
        </div>
      </div>
    );
  }

  // Unsynchronized (plain) lyrics view
  if (!isSynced) {
    return (
      <div
        data-tauri-drag-region="false"
        onWheel={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar pointer-events-auto flex flex-col p-3 gap-2.5 select-text"
      >
        <div className="flex items-center gap-1.5 pb-1 border-b border-[#222226] text-zinc-400 text-[9.5px] uppercase font-semibold tracking-wider">
          <span>Plain Lyrics (Unsynchronized)</span>
        </div>
        {lines.map((line) => (
          <p key={line.id} className={`text-[12px] text-zinc-300 leading-relaxed font-normal ${effectiveSpotifyActive ? 'hover:text-emerald-400' : 'hover:text-cyan-400'} transition-colors`}>
            {line.text}
          </p>
        ))}
      </div>
    );
  }

  // Synchronized Karaoke view with Spring Physics Auto-Scroll
  return (
    <div
      ref={containerRef}
      data-tauri-drag-region="false"
      onWheel={handleWheel}
      className="flex-1 min-h-0 overflow-hidden no-scrollbar pointer-events-auto mask-lyrics-vertical flex flex-col relative select-none"
      style={{
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
      }}
    >
      <motion.div
        animate={{ y: targetY + userOffset }}
        transition={{
          type: 'spring',
          stiffness: 280,
          damping: 30,
          mass: 0.8,
        }}
        className="relative flex flex-col will-change-transform py-6"
      >
        {/* Intro Gate Indicator: singer hasn't started yet and has genuine intro (> 3s) */}
        {activeLyricIndex === -1 && lines.length > 0 && lines[0].timeMs > 3000 && audioAdjustedTime < lines[0].timeMs && (
          <div className="py-1.5 px-2.5 mb-1.5 mx-1 rounded-lg bg-white/[0.04] border border-white/[0.08] flex items-center justify-center gap-2 text-white/50 animate-pulse shrink-0">
            <span className="tracking-widest font-bold text-white/70 text-[10px]">• • •</span>
            <span className="tracking-wider uppercase text-[8.5px] font-mono text-white/60">
              Intro / Instrumental
            </span>
          </div>
        )}

        {lines.map((line, idx) => {
          const dist = idx - activeLyricIndex;
          const isActive = activeLyricIndex >= 0 && dist === 0;
          const isNear = activeLyricIndex >= 0 && Math.abs(dist) === 1;
          const isFar = activeLyricIndex >= 0 && Math.abs(dist) >= 2;

          return (
            <LyricRowItem
              key={line.id}
              ref={isActive ? activeLineRef : undefined}
              line={line}
              isActive={isActive}
              isNear={isNear}
              isFar={isFar}
              duration={duration}
              onSeek={onSeekLine}
              isMidSongInstrumental={isMidSongInstrumental}
              isSpotifyActive={effectiveSpotifyActive}
            />
          );
        })}
      </motion.div>
    </div>
  );
});

LyricsPanel.displayName = 'LyricsPanel';
