import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
import { RotateCw } from 'lucide-react';
import { LyricLine } from '../../../utils/lyricsService';

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
  line: { id: string; timeMs: number; text: string; time?: number };
  isActive: boolean;
  isNear: boolean;
  isFar: boolean;
  onSeek: (timeMs: number) => void;
  isMidSongInstrumental?: boolean;
}

export const LyricRowItem = memo(
  React.forwardRef<HTMLDivElement, LyricRowItemProps>(
    ({ line, isActive, isNear, isFar, onSeek, isMidSongInstrumental }, ref) => {
      const handleClick = useCallback(() => {
        const targetMs = line.timeMs > 0 ? line.timeMs : (line.time ? line.time * 1000 : 0);
        if (targetMs > 0) {
          onSeek(targetMs);
        }
      }, [line.timeMs, line.time, onSeek]);

      return (
        <React.Fragment>
          <div
            ref={ref}
            onClick={handleClick}
            className={`cursor-pointer transition-[background-color,border-color,opacity] duration-200 ease-out py-0.5 px-2 rounded-[5px] flex items-center shrink-0 min-h-[22px] my-0.5 ${
              isActive
                ? 'bg-[#98BBD6]/10 border-l-2 border-[#98BBD6] pl-2.5 pr-2 rounded-r-md shadow-[inset_0_0_12px_rgba(152,187,214,0.15)]'
                : isNear
                ? 'opacity-70 hover:opacity-100 pl-2.5 border-l-2 border-transparent'
                : isFar
                ? 'opacity-40 hover:opacity-70 pl-2.5 border-l-2 border-transparent'
                : 'opacity-25 hover:opacity-50 pl-2.5 border-l-2 border-transparent'
            }`}
            title={line.text}
          >
            {isActive ? (
              <MarqueeLyric
                text={line.text}
                className="text-[13px] font-semibold text-white tracking-wide leading-snug font-sans [text-shadow:0_0_8px_rgba(255,255,255,0.25)]"
              />
            ) : (
              <p className="truncate leading-tight text-[11.5px] text-white/35 font-normal font-sans">
                {line.text}
              </p>
            )}
          </div>

          {/* Mid-song instrumental pause indicator */}
          {isActive && isMidSongInstrumental && (
            <div className="my-1 py-0.5 px-2 mx-1 rounded bg-white/[0.03] border border-white/[0.06] flex items-center gap-2 text-white/40 text-[9px] animate-pulse shrink-0">
              <span className="tracking-widest font-bold text-white/60">• • •</span>
              <span className="tracking-wider uppercase text-[8px] font-mono text-white/50">
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
  lines: Array<{ id: string; timeMs: number; text: string; time?: number }>;
  activeLyricIndex: number;
  onSeekLine: (timeMs: number) => void;
  isLoading?: boolean;
  isInstrumental?: boolean;
  isSynced?: boolean;
  containerRef?: React.RefObject<HTMLDivElement | null>;
  onRefreshLyrics?: () => void;
  isRefreshingLyrics?: boolean;
  isMidSongInstrumental?: boolean;
  audioAdjustedTime?: number;
}

export const LyricsPanel: React.FC<LyricsPanelProps> = memo(({
  lines,
  activeLyricIndex,
  onSeekLine,
  isLoading = false,
  isInstrumental = false,
  isSynced = true,
  containerRef: externalContainerRef,
  onRefreshLyrics,
  isRefreshingLyrics = false,
  isMidSongInstrumental = false,
  audioAdjustedTime = 0,
}) => {
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const activeLineRef = useRef<HTMLDivElement>(null);
  const prevActiveIndexRef = useRef<number>(-1);

  // Smooth auto-centering active lyric line - guarded against redundant scroll calls
  useEffect(() => {
    if (!isSynced) return;
    if (activeLyricIndex === prevActiveIndexRef.current) return;
    prevActiveIndexRef.current = activeLyricIndex;

    if (activeLyricIndex <= 0) {
      containerRef.current?.scrollTo({
        top: 0,
        behavior: 'smooth',
      });
      return;
    }

    if (activeLineRef.current && containerRef.current) {
      const container = containerRef.current;
      const activeEl = activeLineRef.current;
      const targetScroll = activeEl.offsetTop - container.clientHeight / 2 + activeEl.clientHeight / 2;
      container.scrollTo({
        top: targetScroll,
        behavior: 'smooth',
      });
    }
  }, [activeLyricIndex, isSynced, containerRef]);

  // Empty state: No lines, loading, or explicitly marked instrumental
  if (isLoading || isInstrumental || lines.length === 0) {
    return (
      <div
        data-tauri-drag-region="false"
        className="flex-1 min-h-0 flex flex-col items-center justify-center p-4 text-center select-none"
      >
        {/* Static Micro Audio Soundwave with Soft Glow */}
        <div className="relative mb-2 flex items-center justify-center">
          <div
            className="absolute w-12 h-12 rounded-full opacity-30 pointer-events-none blur-md"
            style={{ background: 'radial-gradient(circle, rgba(125, 211, 252, 0.4) 0%, transparent 70%)' }}
          />
          <div className="w-8 h-8 rounded-xl bg-white/[0.03] border border-white/[0.08] flex items-center justify-center relative shadow-inner">
            <svg className="w-4 h-4 text-sky-300/80" viewBox="0 0 16 16" fill="none">
              <line x1="2.5" y1="6" x2="2.5" y2="10" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="5.5" y1="4" x2="5.5" y2="12" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="8" y1="2" x2="8" y2="14" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="10.5" y1="5" x2="10.5" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
              <line x1="13.5" y1="7" x2="13.5" y2="9" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
            </svg>
          </div>
        </div>

        <h4
          className="text-[12.5px] font-medium text-white/80 tracking-wide font-urbanist m-0 leading-tight"
          style={{ fontFamily: "'Urbanist', sans-serif" }}
        >
          No Lyrics Available
        </h4>
        <p
          className="text-xs text-white/40 font-urbanist mt-1 mb-2.5 leading-normal"
          style={{ fontFamily: "'Urbanist', sans-serif" }}
        >
          Instrumental or unsynced playback
        </p>
        {onRefreshLyrics && (
          <button
            onClick={onRefreshLyrics}
            disabled={isRefreshingLyrics}
            className="px-3 py-1 rounded-full bg-white/[0.04] hover:bg-white/[0.08] border border-white/[0.08] text-white/60 hover:text-white text-[10px] font-urbanist font-medium transition-all flex items-center gap-1.5 active:scale-95 cursor-pointer disabled:opacity-40"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
            title="Refresh lyrics"
          >
            <RotateCw className={`w-2.5 h-2.5 ${isRefreshingLyrics ? 'animate-spin text-sky-300' : ''}`} />
            <span>Refresh</span>
          </button>
        )}
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
        <div className="flex items-center gap-1.5 pb-1 border-b border-white/[0.04] text-[#98BBD6]/70 text-[9.5px] uppercase font-semibold tracking-wider">
          <span>Plain Lyrics (Unsynchronized)</span>
        </div>
        {lines.map((line) => (
          <p key={line.id} className="text-[12px] text-white/80 leading-relaxed font-normal hover:text-[#98BBD6] transition-colors">
            {line.text}
          </p>
        ))}
      </div>
    );
  }

  // Synchronized Karaoke view
  return (
    <div
      ref={containerRef}
      data-tauri-drag-region="false"
      onWheel={(e) => e.stopPropagation()}
      className="flex-1 min-h-0 overflow-y-auto no-scrollbar pointer-events-auto mask-lyrics-vertical flex flex-col scroll-smooth relative"
      style={{
        maskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
        WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
        paddingTop: '24px',
        paddingBottom: '24px',
      }}
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
        const isFar = activeLyricIndex >= 0 && Math.abs(dist) === 2;

        return (
          <LyricRowItem
            key={line.id}
            ref={isActive ? activeLineRef : undefined}
            line={line}
            isActive={isActive}
            isNear={isNear}
            isFar={isFar}
            onSeek={onSeekLine}
            isMidSongInstrumental={isMidSongInstrumental}
          />
        );
      })}
    </div>
  );
});

LyricsPanel.displayName = 'LyricsPanel';
