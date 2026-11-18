import React, { useState, useEffect, useLayoutEffect, useRef, useCallback, memo } from 'react';
import { RotateCw } from 'lucide-react';
import { motion } from 'framer-motion';
import { LyricLine, parseTimeToSeconds } from '../../../utils/lyricsService';
import { computeUnsyncedScrollProgress } from '../../../features/media/playbackClock';

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
  compactOled?: boolean;
}

export const LyricRowItem = memo(
  React.forwardRef<HTMLDivElement, LyricRowItemProps>(
    ({ line, isActive, isNear, isFar: _isFar, duration: _duration = 0, onSeek, isMidSongInstrumental, isSpotifyActive = false, compactOled = false }, ref) => {
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

      const activeClass = compactOled
        ? 'font-semibold opacity-100 bg-white/[0.08] border-l-2 border-white text-white pl-2 pr-1.5 rounded-r-md'
        : 'font-semibold opacity-100 bg-white/[0.08] border-l-2 border-white text-white pl-2.5 pr-2 rounded-r-md';

      return (
        <React.Fragment>
          <div
            ref={ref}
            onClick={handleClick}
            className={`cursor-pointer transition-[opacity,background-color,color] duration-200 ease-out ${
              compactOled ? 'py-[3px] px-1.5 min-h-[20px] my-[1px]' : 'py-0.5 px-2 min-h-[22px] my-0.5'
            } rounded-[5px] flex items-center shrink-0 ${
              isActive
                ? activeClass
                : isNear
                ? 'opacity-85 hover:opacity-100 pl-2 border-l-2 border-transparent font-medium text-zinc-400 hover:text-zinc-200'
                : 'opacity-55 hover:opacity-85 pl-2 border-l-2 border-transparent font-medium text-zinc-400 hover:text-zinc-200'
            }`}
            title={line.text}
          >
            {isActive ? (
              <MarqueeLyric
                text={line.text}
                className={`${
                  compactOled ? 'text-[12px]' : 'text-[13px]'
                } font-semibold tracking-tight leading-[1.35] py-[1px] text-white antialiased`}
              />
            ) : (
              <p
                className={`truncate leading-[1.35] py-[1px] antialiased ${
                  compactOled ? 'text-[10.5px] text-zinc-400' : 'text-[11.5px] text-zinc-400'
                } font-medium`}
              >
                {line.text}
              </p>
            )}
          </div>

          {/* Mid-song instrumental pause indicator */}
          {isActive && isMidSongInstrumental && (
            <div className="my-1 py-0.5 px-2 mx-1 rounded bg-[#0a0a0a] border border-white/[0.06] flex items-center gap-2 text-zinc-500 text-[9px] animate-pulse shrink-0">
              <span className="tracking-widest font-bold text-zinc-400">• • •</span>
              <span className="tracking-wider uppercase text-[8px] font-mono text-zinc-500">
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
  compactOled?: boolean;
  hasActiveSession?: boolean;
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
  onRefreshLyrics: _onRefreshLyrics,
  isRefreshingLyrics: _isRefreshingLyrics = false,
  isMidSongInstrumental = false,
  audioAdjustedTime = 0,
  emptyTitle,
  emptySubtitle,
  isSpotifyActive = false,
  isSpotifySession = false,
  compactOled = false,
  hasActiveSession = true,
}) => {
  const effectiveSpotifyActive = Boolean(isSpotifyActive || isSpotifySession);
  const internalContainerRef = useRef<HTMLDivElement>(null);
  const containerRef = externalContainerRef || internalContainerRef;
  const activeLineRef = useRef<HTMLDivElement>(null);

  const [targetY, setTargetY] = useState<number>(0);
  const [userOffset, setUserOffset] = useState<number>(0);
  const userScrollTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Proportional auto-scroll state for unsynchronized (plain) lyrics
  const unsyncedScrollRef = useRef<HTMLDivElement>(null);
  const unsyncedManualPauseUntilRef = useRef<number>(0);
  const unsyncedResumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsyncedRafRef = useRef<number | null>(null);
  const [isUnsyncedManualPaused, setIsUnsyncedManualPaused] = useState(false);

  // Reset unsynced scroll to top whenever track lines switch
  useEffect(() => {
    if (isSynced) return;
    unsyncedManualPauseUntilRef.current = 0;
    setIsUnsyncedManualPaused(false);
    if (unsyncedScrollRef.current) {
      unsyncedScrollRef.current.scrollTop = 0;
    }
  }, [isSynced, lines]);

  // Smooth proportional scroll based on current playback ratio with ±9% intro/outro margins
  useEffect(() => {
    if (isSynced || isLoading || isInstrumental || lines.length === 0 || !hasActiveSession) {
      return;
    }
    if (isUnsyncedManualPaused || Date.now() < unsyncedManualPauseUntilRef.current) {
      return;
    }

    const container = unsyncedScrollRef.current;
    if (!container) return;

    const maxScroll = Math.max(0, container.scrollHeight - container.clientHeight);
    if (maxScroll <= 0) return;

    const durationMs = duration > 0 ? duration * 1000 : 0;
    const progressRatio = computeUnsyncedScrollProgress(audioAdjustedTime, durationMs, 0.09, 0.09);
    const targetTop = Math.round(progressRatio * maxScroll);

    if (Math.abs(targetTop - container.scrollTop) < 1.5) return;

    if (unsyncedRafRef.current !== null) {
      cancelAnimationFrame(unsyncedRafRef.current);
      unsyncedRafRef.current = null;
    }

    const stepGlide = () => {
      const el = unsyncedScrollRef.current;
      if (!el || Date.now() < unsyncedManualPauseUntilRef.current) {
        unsyncedRafRef.current = null;
        return;
      }
      const diff = targetTop - el.scrollTop;
      if (Math.abs(diff) <= 0.8) {
        el.scrollTop = targetTop;
        unsyncedRafRef.current = null;
        return;
      }
      el.scrollTop += diff * 0.22;
      unsyncedRafRef.current = requestAnimationFrame(stepGlide);
    };

    unsyncedRafRef.current = requestAnimationFrame(stepGlide);

    return () => {
      if (unsyncedRafRef.current !== null) {
        cancelAnimationFrame(unsyncedRafRef.current);
        unsyncedRafRef.current = null;
      }
    };
  }, [
    isSynced,
    isLoading,
    isInstrumental,
    lines,
    hasActiveSession,
    audioAdjustedTime,
    duration,
    isUnsyncedManualPaused,
  ]);

  useEffect(() => {
    return () => {
      if (userScrollTimeoutRef.current) {
        clearTimeout(userScrollTimeoutRef.current);
      }
      if (unsyncedResumeTimerRef.current) {
        clearTimeout(unsyncedResumeTimerRef.current);
      }
      if (unsyncedRafRef.current !== null) {
        cancelAnimationFrame(unsyncedRafRef.current);
      }
    };
  }, []);

  const handleUnsyncedWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    unsyncedManualPauseUntilRef.current = Date.now() + 4000;
    setIsUnsyncedManualPaused(true);
    if (unsyncedRafRef.current !== null) {
      cancelAnimationFrame(unsyncedRafRef.current);
      unsyncedRafRef.current = null;
    }
    if (unsyncedResumeTimerRef.current) {
      clearTimeout(unsyncedResumeTimerRef.current);
    }
    unsyncedResumeTimerRef.current = setTimeout(() => {
      unsyncedManualPauseUntilRef.current = 0;
      setIsUnsyncedManualPaused(false);
    }, 4000);
  }, []);

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
      // Center aligned view snapped to integer CSS pixel
      const centeredY = Math.round(containerHeight / 2 - (activeTop + activeHeight / 2));
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
        setTargetY(Math.round(containerHeight / 2 - (activeTop + activeHeight / 2)));
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
    setUserOffset((prev) => Math.round(prev - e.deltaY * 0.7));
    if (userScrollTimeoutRef.current) {
      clearTimeout(userScrollTimeoutRef.current);
    }
    userScrollTimeoutRef.current = setTimeout(() => {
      setUserOffset(0);
    }, 2500);
  }, []);

  // Standby / Empty guard: NEVER render loading spinner when !hasActiveSession (No Media Playing)
  if (!hasActiveSession || (!isLoading && (isInstrumental || lines.length === 0))) {
    const resolvedSubtitle = !hasActiveSession
      ? emptySubtitle || 'Instrumental or unsynced playback'
      : emptySubtitle || (isInstrumental ? 'Instrumental playback' : 'Instrumental or unsynced playback');
    return (
      <div
        data-tauri-drag-region="false"
        className="flex-1 min-h-0 flex flex-col items-center justify-center py-1 px-3.5 text-center select-none space-y-1"
      >
        <div className="relative flex items-center justify-center">
          <div className="w-6 h-6 p-1.5 rounded-lg bg-[#0a0a0a] border border-white/[0.06] flex items-center justify-center relative">
            <svg className="w-3 h-3 text-zinc-500" viewBox="0 0 16 16" fill="none">
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
            className="text-[10px] text-zinc-500 m-0 leading-tight max-w-[240px]"
          >
            {resolvedSubtitle}
          </p>
        </div>
      </div>
    );
  }

  // Loading State: Monochrome OLED spinner (only shown while an active media session is syncing)
  if (isLoading) {
    return (
      <div
        data-tauri-drag-region="false"
        className="flex-1 min-h-0 flex flex-col items-center justify-center py-2 px-3.5 text-center select-none space-y-2 animate-in fade-in duration-200"
      >
        <div className="relative flex items-center justify-center">
          <div className="relative w-7 h-7 flex items-center justify-center">
            <div className="absolute inset-0 rounded-full border-2 border-white/75 border-t-transparent animate-spin" />
            <span className="w-1.5 h-1.5 rounded-full bg-white/80 animate-ping" />
          </div>
        </div>

        <div className="flex flex-col items-center gap-0.5">
          <h4 className="text-[11.5px] font-medium text-zinc-200 tracking-tight m-0 leading-tight">
            Menyelaraskan Lirik...
          </h4>
          <p className="text-[9.5px] text-zinc-500 m-0 leading-tight">
            Mengambil lirik tersinkronisasi dari LRCLIB
          </p>
        </div>
      </div>
    );
  }

  // Unsynchronized (plain) lyrics view with proportional smooth auto-scroll
  if (!isSynced) {
    return (
      <div
        ref={unsyncedScrollRef}
        data-tauri-drag-region="false"
        onWheel={handleUnsyncedWheel}
        className="flex-1 min-h-0 overflow-y-auto no-scrollbar pointer-events-auto flex flex-col px-3 pb-5 pt-0 gap-2.5 select-text relative"
      >
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 pt-2.5 pb-1.5 bg-[#000000]/95 backdrop-blur-sm border-b border-white/[0.06]">
          <span className="px-1.5 py-[1px] rounded-full border border-white/[0.14] bg-white/[0.06] text-[8.5px] font-mono uppercase tracking-wider text-white/70">
            Unsynced
          </span>
          <span className="text-[9px] font-mono text-zinc-500">
            {isUnsyncedManualPaused ? 'Manual scroll · 4s' : duration > 0 ? 'Auto-scroll' : 'Plain Lyrics'}
          </span>
        </div>
        {lines.map((line) => (
          <p key={line.id} className="text-[12px] text-zinc-300/90 leading-relaxed font-medium hover:text-white transition-colors antialiased">
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
        maskImage: compactOled
          ? 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)'
          : 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
        WebkitMaskImage: compactOled
          ? 'linear-gradient(to bottom, transparent 0%, black 20%, black 80%, transparent 100%)'
          : 'linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)',
      }}
    >
      <motion.div
        animate={{ y: Math.round(targetY + userOffset) }}
        transition={{
          type: 'spring',
          stiffness: 280,
          damping: 30,
          mass: 0.8,
        }}
        className={`relative flex flex-col ${compactOled ? 'py-8' : 'py-6'}`}
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
              compactOled={compactOled}
            />
          );
        })}
      </motion.div>
    </div>
  );
});

LyricsPanel.displayName = 'LyricsPanel';
