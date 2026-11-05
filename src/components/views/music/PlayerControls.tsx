import React, { useState, useRef, useCallback, memo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Repeat,
  Library,
  Loader2,
} from 'lucide-react';
import {
  LunarLyricIcon,
  CosmicSearchIcon,
  QueueOrbitIcon,
} from '../../system/CosmicIcons';
import { playChimeCue } from '../../../utils/tauriBridge';
import { MusicSubPanel } from './constants';

export interface PlayerControlsProps {
  isCompact?: boolean;
  isEffectivePlaying: boolean;
  hasActiveSession: boolean;
  canAccessSpotifyFeatures: boolean;
  isSpotifySession?: boolean;
  isWakingSpotify?: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  onSeek: (targetSeconds: number) => void;
  // Transport actions
  isShuffle?: boolean;
  isSmartShuffle?: boolean;
  onToggleShuffle?: () => void;
  isRepeat?: boolean;
  onToggleRepeat?: () => void;
  onPrev: () => void;
  onTogglePlay: () => void;
  onNext: () => void;
  // Sub-panel toggles
  activeSubPanel?: MusicSubPanel;
  onSwitchSubPanel?: (panel: MusicSubPanel) => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

export const PlayerControls: React.FC<PlayerControlsProps> = memo(({
  isCompact = false,
  isEffectivePlaying,
  hasActiveSession,
  canAccessSpotifyFeatures,
  isSpotifySession = false,
  isWakingSpotify = false,
  currentTimeSeconds,
  durationSeconds,
  onSeek,
  isShuffle = false,
  isSmartShuffle = false,
  onToggleShuffle,
  isRepeat = false,
  onToggleRepeat,
  onPrev,
  onTogglePlay,
  onNext,
  activeSubPanel = 'none',
  onSwitchSubPanel,
}) => {
  const [isScrubbing, setIsScrubbing] = useState(false);
  const [scrubPosition, setScrubPosition] = useState(0);
  const scrubberRef = useRef<HTMLDivElement>(null);

  const calcScrubSeconds = useCallback((clientX: number, targetEl: HTMLDivElement) => {
    if (!durationSeconds || durationSeconds <= 0) return 0;
    const rect = targetEl.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    return ratio * durationSeconds;
  }, [durationSeconds]);

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();
    if (!durationSeconds || durationSeconds <= 0) return;

    const targetEl = scrubberRef.current;
    if (!targetEl) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {}

    const seconds = calcScrubSeconds(e.clientX, targetEl);
    setIsScrubbing(true);
    setScrubPosition(seconds);
    playChimeCue('tap');
  }, [durationSeconds, calcScrubSeconds]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    e.preventDefault();
    e.stopPropagation();

    const targetEl = scrubberRef.current;
    if (!targetEl) return;

    const seconds = calcScrubSeconds(e.clientX, targetEl);
    setScrubPosition(seconds);
  }, [isScrubbing, calcScrubSeconds]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!isScrubbing) return;
    e.preventDefault();
    e.stopPropagation();

    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}

    setIsScrubbing(false);
    onSeek(scrubPosition);
  }, [isScrubbing, scrubPosition, onSeek]);

  const displayTime = isScrubbing ? scrubPosition : currentTimeSeconds;
  const remainingSeconds = Math.max(0, durationSeconds - displayTime);
  const progressPercent =
    durationSeconds > 0
      ? Math.min(100, Math.max(0, (displayTime / durationSeconds) * 100))
      : 0;

  const handleLyricsToggle = useCallback(() => {
    playChimeCue('tap');
    if (activeSubPanel === 'lyrics') {
      onSwitchSubPanel?.('none');
    } else {
      onSwitchSubPanel?.('lyrics');
    }
  }, [activeSubPanel, onSwitchSubPanel]);

  return (
    <div className="w-full flex flex-col select-none">
      {/* Scrubber Slider Row with Real-time Dragging & Meteor Trail Seekbar */}
      <div className="w-full my-0.5">
        <div
          ref={scrubberRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-2.5 py-1 relative cursor-pointer group select-none touch-none flex items-center"
          title="Geser atau klik untuk seek lagu"
        >
          {/* Garis orbit dasar 2px */}
          <div className="w-full h-[2px] bg-zinc-800/80 rounded-full relative">
            {/* Ekor meteor: gradasi halus dari transparan via emerald/cyan ke emerald/cyan-400 */}
            <div
              className={`h-full rounded-full ${
                isSpotifySession
                  ? 'bg-gradient-to-r from-transparent via-emerald-500/30 to-emerald-400'
                  : 'bg-gradient-to-r from-transparent via-cyan-500/30 to-cyan-400'
              } ${isScrubbing || isEffectivePlaying ? '' : 'transition-all duration-100'}`}
              style={{
                width: `${progressPercent}%`,
              }}
            />
            {/* Head thumb: titik bintang putih bersinar tepat di ujung durasi lagu yang berjalan */}
            {progressPercent > 0 && (
              <div
                className={`absolute top-1/2 -translate-y-1/2 w-2 h-2 -ml-1 rounded-full bg-white pointer-events-none transition-transform ${
                  isSpotifySession
                    ? 'shadow-[0_0_8px_#10b981,0_0_16px_rgba(16,185,129,0.6)]'
                    : 'shadow-[0_0_8px_#22d3ee,0_0_16px_rgba(34,211,238,0.6)]'
                }`}
                style={{ left: `${progressPercent}%` }}
              />
            )}
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono tabular-nums text-zinc-400 px-0.5 mt-0.5">
          <span>{formatTime(displayTime)}</span>
          <span>-{formatTime(remainingSeconds)}</span>
        </div>
      </div>

      {/* Controls Row: Full Mode vs Compact Mode */}
      {!isCompact ? (
        /* Full Mode: Centered Playback Controls [Shuffle Prev Play Next Repeat | Lyrics] */
        <div className="flex items-center justify-center gap-3 w-full">
          {/* 1. Shuffle Button */}
          <button
            onClick={onToggleShuffle}
            disabled={!hasActiveSession}
            className={`relative w-[24px] h-[24px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isShuffle
                ? isSpotifySession
                  ? 'text-[#10b981] drop-shadow-[0_0_6px_rgba(16,185,129,0.5)] bg-emerald-950/40 border border-emerald-500/30'
                  : 'text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)] bg-cyan-950/40 border border-cyan-500/30'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-transparent'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isShuffle ? 'Shuffle Aktif' : 'Shuffle Mati'}
            aria-label="Toggle Shuffle"
          >
            <Shuffle className="w-3.5 h-3.5 shrink-0" />
          </button>

          {/* 2. Prev Track */}
          <button
            onClick={onPrev}
            disabled={!hasActiveSession}
            className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Previous Track"
            aria-label="Previous Track"
          >
            <SkipBack className="w-3.5 h-3.5 shrink-0 fill-current" />
          </button>

          {/* 3. Play / Pause Tactile 28px Button */}
          <button
            onClick={onTogglePlay}
            disabled={!hasActiveSession && !isWakingSpotify}
            className={`w-[28px] h-[28px] rounded-full text-black flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${
              isSpotifySession
                ? 'bg-emerald-400 hover:bg-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                : 'bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.4)]'
            }`}
            title={
              !hasActiveSession
                ? 'Tidak ada media aktif'
                : isWakingSpotify
                ? 'Menghubungkan Spotify...'
                : isEffectivePlaying
                ? 'Pause'
                : 'Play'
            }
            aria-label={isEffectivePlaying ? 'Pause' : 'Play'}
          >
            {isWakingSpotify ? (
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-black" />
            ) : isEffectivePlaying ? (
              <Pause className="w-3.5 h-3.5 shrink-0 fill-current text-black" />
            ) : (
              <Play className="w-3.5 h-3.5 shrink-0 fill-current text-black ml-0.5" />
            )}
          </button>

          {/* 4. Next Track */}
          <button
            onClick={onNext}
            disabled={!hasActiveSession}
            className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Next Track"
            aria-label="Next Track"
          >
            <SkipForward className="w-3.5 h-3.5 shrink-0 fill-current" />
          </button>

          {/* 5. Repeat Button */}
          <button
            onClick={onToggleRepeat}
            disabled={!hasActiveSession || !onToggleRepeat}
            className={`relative w-[24px] h-[24px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isRepeat
                ? isSpotifySession
                  ? 'text-[#10b981] drop-shadow-[0_0_6px_rgba(16,185,129,0.5)] bg-emerald-950/40 border border-emerald-500/30'
                  : 'text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)] bg-cyan-950/40 border border-cyan-500/30'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-transparent'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isRepeat ? 'Repeat Aktif' : 'Repeat Mati'}
            aria-label="Toggle Repeat"
          >
            <Repeat className="w-3.5 h-3.5 shrink-0" />
          </button>

          {/* 6. Vertical Divider */}
          <div className="h-3.5 w-[1px] bg-white/[0.08] mx-0.5 shrink-0" />

          {/* 7. Lyrics Toggle */}
          <button
            onClick={handleLyricsToggle}
            className={`w-[24px] h-[24px] rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0 ${
              activeSubPanel === 'lyrics'
                ? isSpotifySession
                  ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.3)]'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border border-transparent'
            }`}
            title={activeSubPanel === 'lyrics' ? 'Tutup Lirik (Mode Pemutar Penuh)' : 'Buka Lirik'}
            aria-label="Toggle Lirik"
          >
            <LunarLyricIcon className="w-3.5 h-3.5 shrink-0" />
          </button>
        </div>
      ) : (
        /* Compact Mode: Unified Centered Cluster [Shuffle Prev Play Next Repeat | Lyrics] */
        <div className="flex items-center justify-center gap-2.5 w-full pt-0.5">
          {/* 1. Shuffle Button */}
          <button
            onClick={onToggleShuffle}
            disabled={!hasActiveSession}
            className={`relative w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isShuffle
                ? isSpotifySession
                  ? 'text-[#10b981] drop-shadow-[0_0_6px_rgba(16,185,129,0.5)] bg-emerald-950/40 border border-emerald-500/30'
                  : 'text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)] bg-cyan-950/40 border border-cyan-500/30'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-transparent'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isShuffle ? 'Shuffle Aktif' : 'Shuffle Mati'}
            aria-label="Toggle Shuffle"
          >
            <Shuffle className="w-2.5 h-2.5 shrink-0" />
          </button>

          {/* 2. Prev Button */}
          <button
            onClick={onPrev}
            disabled={!hasActiveSession}
            className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Previous Track"
            aria-label="Previous Track"
          >
            <SkipBack className="w-3 h-3 shrink-0 fill-current" />
          </button>

          {/* 3. Play / Pause Tactile 28px Button */}
          <button
            onClick={onTogglePlay}
            disabled={!hasActiveSession && !isWakingSpotify}
            className={`w-[28px] h-[28px] rounded-full text-black flex items-center justify-center active:scale-95 transition-all disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer ${
              isSpotifySession
                ? 'bg-emerald-400 hover:bg-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.4)]'
                : 'bg-cyan-400 hover:bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.4)]'
            }`}
            title={
              !hasActiveSession
                ? 'Tidak ada media aktif'
                : isWakingSpotify
                ? 'Menghubungkan Spotify...'
                : isEffectivePlaying
                ? 'Pause'
                : 'Play'
            }
            aria-label={isEffectivePlaying ? 'Pause' : 'Play'}
          >
            {isWakingSpotify ? (
              <Loader2 className="w-3 h-3 shrink-0 animate-spin text-black" />
            ) : isEffectivePlaying ? (
              <Pause className="w-3.5 h-3.5 shrink-0 fill-current text-black" />
            ) : (
              <Play className="w-3.5 h-3.5 shrink-0 fill-current text-black ml-0.5" />
            )}
          </button>

          {/* 4. Next Button */}
          <button
            onClick={onNext}
            disabled={!hasActiveSession}
            className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Next Track"
            aria-label="Next Track"
          >
            <SkipForward className="w-3 h-3 shrink-0 fill-current" />
          </button>

          {/* 5. Repeat Button */}
          <button
            onClick={onToggleRepeat}
            disabled={!hasActiveSession || !onToggleRepeat}
            className={`relative w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all cursor-pointer ${
              isRepeat
                ? isSpotifySession
                  ? 'text-[#10b981] drop-shadow-[0_0_6px_rgba(16,185,129,0.5)] bg-emerald-950/40 border border-emerald-500/30'
                  : 'text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.5)] bg-cyan-950/40 border border-cyan-500/30'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border-transparent'
            } disabled:opacity-30 disabled:cursor-not-allowed`}
            title={isRepeat ? 'Repeat Aktif' : 'Repeat Mati'}
            aria-label="Toggle Repeat"
          >
            <Repeat className="w-2.5 h-2.5 shrink-0" />
          </button>

          {/* 6. Micro Divider */}
          <div className="h-3.5 w-[1px] bg-white/[0.08] mx-0.5 shrink-0" />

          {/* 7. Round Lyrics Toggle Button */}
          <button
            onClick={handleLyricsToggle}
            className={`w-[22px] h-[22px] rounded-full flex items-center justify-center transition-all cursor-pointer shrink-0 ${
              activeSubPanel === 'lyrics'
                ? isSpotifySession
                  ? 'bg-emerald-950/40 text-emerald-300 border border-emerald-500/30 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                  : 'bg-cyan-950/40 text-cyan-300 border border-cyan-500/30 shadow-[0_0_8px_rgba(34,211,238,0.3)]'
                : 'text-zinc-500 hover:text-zinc-300 bg-transparent border border-transparent'
            }`}
            title={activeSubPanel === 'lyrics' ? 'Tutup Lirik (Mode Pemutar Penuh)' : 'Buka Lirik'}
            aria-label="Toggle Lirik"
          >
            <LunarLyricIcon className="w-3 h-3 shrink-0" />
          </button>
        </div>
      )}
    </div>
  );
});

PlayerControls.displayName = 'PlayerControls';
