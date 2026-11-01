import React, { useState, useRef, useCallback, memo } from 'react';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Shuffle,
  Mic2,
  Search,
  ListMusic,
  Library,
  Loader2,
} from 'lucide-react';
import { playChimeCue } from '../../../utils/tauriBridge';
import { MusicSubPanel } from './constants';

export interface PlayerControlsProps {
  isCompact?: boolean;
  isEffectivePlaying: boolean;
  hasActiveSession: boolean;
  canAccessSpotifyFeatures: boolean;
  isWakingSpotify?: boolean;
  currentTimeSeconds: number;
  durationSeconds: number;
  onSeek: (targetMs: number) => void;
  // Transport actions
  isShuffle?: boolean;
  isSmartShuffle?: boolean;
  onToggleShuffle?: () => void;
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
  isWakingSpotify = false,
  currentTimeSeconds,
  durationSeconds,
  onSeek,
  isShuffle = false,
  isSmartShuffle = false,
  onToggleShuffle,
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
    return Math.round(ratio * durationSeconds);
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

    const targetMs = Math.round(scrubPosition * 1000);
    setIsScrubbing(false);
    onSeek(targetMs);
  }, [isScrubbing, scrubPosition, onSeek]);

  const displayTime = isScrubbing ? scrubPosition : currentTimeSeconds;
  const remainingSeconds = Math.max(0, durationSeconds - displayTime);
  const progressPercent =
    durationSeconds > 0
      ? Math.min(100, Math.max(0, (displayTime / durationSeconds) * 100))
      : 0;

  return (
    <div className="w-full flex flex-col select-none">
      {/* Scrubber Slider Row with Real-time Dragging */}
      <div className="w-full my-0.5">
        <div
          ref={scrubberRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          className="w-full h-2 py-0.5 relative cursor-pointer group select-none touch-none flex items-center"
          title="Geser atau klik untuk seek lagu"
        >
          <div className="w-full h-[2px] group-hover:h-[3px] bg-white/[0.08] rounded-full relative transition-all">
            <div
              className={`h-full bg-[#98BBD6] rounded-full shadow-[0_0_8px_rgba(152,187,214,0.45)] ${
                isScrubbing || isEffectivePlaying ? '' : 'transition-all duration-100'
              }`}
              style={{ width: `${progressPercent}%` }}
            />
            {/* Interactive Dot Handle */}
            <div
              className="absolute top-1/2 -translate-y-1/2 w-2 h-2 rounded-full bg-[#98BBD6] shadow-[0_0_8px_rgba(152,187,214,0.7)] opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none -ml-1"
              style={{ left: `${progressPercent}%` }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] font-mono tracking-tight text-white/50 tabular-nums px-0.5">
          <span>{formatTime(displayTime)}</span>
          <span className="text-white/20">//</span>
          <span>-{formatTime(remainingSeconds)}</span>
        </div>
      </div>

      {/* Controls Row: Full Mode vs Compact Mode */}
      {!isCompact ? (
        /* Full Mode: Centered Playback Controls + Feature Panels */
        <div className={`flex items-center justify-center ${canAccessSpotifyFeatures ? 'gap-3' : 'gap-4'} w-full`}>
          {/* Shuffle Button */}
          {canAccessSpotifyFeatures && (
            <button
              onClick={onToggleShuffle}
              disabled={!hasActiveSession}
              className={`relative w-[24px] h-[24px] rounded-full flex items-center justify-center transition-all ${
                isShuffle
                  ? isSmartShuffle
                    ? 'text-emerald-400 bg-emerald-500/20 shadow-[0_0_8px_rgba(16,185,129,0.3)]'
                    : 'text-white bg-white/20 shadow-[0_0_8px_rgba(255,255,255,0.2)]'
                  : 'text-white/40 hover:text-white'
              } disabled:opacity-30 disabled:cursor-not-allowed`}
              title={
                isShuffle
                  ? isSmartShuffle
                    ? 'Smart Shuffle Active ✨'
                    : 'Shuffle Active'
                  : 'Shuffle Off'
              }
              aria-label="Toggle Shuffle"
            >
              <Shuffle className="w-3 h-3 shrink-0" />
              {isShuffle && isSmartShuffle && (
                <span className="absolute -top-0.5 -right-0.5 w-1 h-1 rounded-full bg-emerald-400 ring-1 ring-black animate-pulse" />
              )}
            </button>
          )}

          {/* Prev Track */}
          <button
            onClick={onPrev}
            disabled={!hasActiveSession && !canAccessSpotifyFeatures}
            className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            title="Previous Track"
            aria-label="Previous Track"
          >
            <SkipBack className="w-3.5 h-3.5 shrink-0 fill-current" />
          </button>

          {/* Play / Pause Tactile 28px Button */}
          <button
            onClick={onTogglePlay}
            disabled={!hasActiveSession && !isWakingSpotify}
            className="w-[28px] h-[28px] rounded-full bg-[#98BBD6] text-[#0D0E12] flex items-center justify-center hover:bg-[#98BBD6]/90 active:scale-95 transition-all shadow-[0_0_10px_rgba(152,187,214,0.4)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
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
              <Loader2 className="w-3.5 h-3.5 shrink-0 animate-spin text-[#0D0E12]" />
            ) : isEffectivePlaying ? (
              <Pause className="w-3.5 h-3.5 shrink-0 fill-current text-[#0D0E12]" />
            ) : (
              <Play className="w-3.5 h-3.5 shrink-0 fill-current text-[#0D0E12] ml-0.5" />
            )}
          </button>

          {/* Next Track */}
          <button
            onClick={onNext}
            disabled={!hasActiveSession && !canAccessSpotifyFeatures}
            className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
            title="Next Track"
            aria-label="Next Track"
          >
            <SkipForward className="w-3.5 h-3.5 shrink-0 fill-current" />
          </button>

          {/* Vertical Divider */}
          {canAccessSpotifyFeatures && <div className="h-3.5 w-[1px] bg-white/10 mx-0.5" />}

          {/* Lyrics Toggle */}
          <button
            onClick={() => onSwitchSubPanel?.('lyrics')}
            className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-white/40 hover:text-[#98BBD6] hover:bg-white/10 transition-all cursor-pointer"
            title="Open Synced Lyrics"
            aria-label="Open Synced Lyrics"
          >
            <Mic2 className="w-3 h-3 shrink-0" />
          </button>

          {/* Search Toggle */}
          {canAccessSpotifyFeatures && (
            <button
              onClick={() => onSwitchSubPanel?.('search')}
              className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-white/40 hover:text-[#98BBD6] hover:bg-white/10 transition-all cursor-pointer"
              title="Quick Search Spotify"
              aria-label="Quick Search Spotify"
            >
              <Search className="w-3 h-3 shrink-0" />
            </button>
          )}

          {/* Queue Toggle */}
          {canAccessSpotifyFeatures && (
            <button
              onClick={() => onSwitchSubPanel?.('queue')}
              className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-white/40 hover:text-[#98BBD6] hover:bg-white/10 transition-all cursor-pointer"
              title="Upcoming Queue"
              aria-label="Upcoming Queue"
            >
              <ListMusic className="w-3 h-3 shrink-0" />
            </button>
          )}

          {/* Playlists Toggle */}
          {canAccessSpotifyFeatures && (
            <button
              onClick={() => onSwitchSubPanel?.('playlist')}
              className="w-[24px] h-[24px] rounded-full flex items-center justify-center text-white/40 hover:text-[#98BBD6] hover:bg-white/10 transition-all cursor-pointer"
              title="Spotify Library"
              aria-label="Spotify Library"
            >
              <Library className="w-3 h-3 shrink-0" />
            </button>
          )}
        </div>
      ) : (
        /* Compact Mode: Split View Layout with Tight Spacing & Active Highlights */
        <div className={`flex items-center ${canAccessSpotifyFeatures ? 'justify-between' : 'justify-center gap-2.5'} w-full pt-0.5`}>
          {/* Playback Group (Shuffle, Prev, Play/Pause, Next) */}
          <div className="flex items-center gap-1">
            {canAccessSpotifyFeatures && (
              <button
                onClick={onToggleShuffle}
                disabled={!hasActiveSession}
                className={`relative w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all ${
                  isShuffle
                    ? isSmartShuffle
                      ? 'text-emerald-400 bg-emerald-500/20 shadow-[0_0_6px_rgba(16,185,129,0.3)]'
                      : 'text-white bg-white/20 shadow-[0_0_8px_rgba(255,255,255,0.2)]'
                    : 'text-white/40 hover:text-white'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
                title={
                  isShuffle
                    ? isSmartShuffle
                      ? 'Smart Shuffle Active ✨'
                      : 'Shuffle Active'
                    : 'Shuffle Off'
                }
                aria-label="Toggle Shuffle"
              >
                <Shuffle className="w-2.5 h-2.5 shrink-0" />
                {isShuffle && isSmartShuffle && (
                  <span className="absolute -top-0.5 -right-0.5 w-1 h-1 rounded-full bg-emerald-400 ring-1 ring-black animate-pulse" />
                )}
              </button>
            )}

            {/* Prev */}
            <button
              onClick={onPrev}
              disabled={!hasActiveSession && !canAccessSpotifyFeatures}
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Previous Track"
              aria-label="Previous Track"
            >
              <SkipBack className="w-3 h-3 shrink-0 fill-current" />
            </button>

            {/* Play / Pause Tactile 28px Button */}
            <button
              onClick={onTogglePlay}
              disabled={!hasActiveSession && !isWakingSpotify}
              className="w-[28px] h-[28px] rounded-full bg-[#98BBD6] text-[#0D0E12] flex items-center justify-center hover:bg-[#98BBD6]/90 active:scale-95 transition-all shadow-[0_0_10px_rgba(152,187,214,0.4)] disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
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
                <Loader2 className="w-3 h-3 shrink-0 animate-spin text-[#0D0E12]" />
              ) : isEffectivePlaying ? (
                <Pause className="w-3.5 h-3.5 shrink-0 fill-current text-[#0D0E12]" />
              ) : (
                <Play className="w-3.5 h-3.5 shrink-0 fill-current text-[#0D0E12] ml-0.5" />
              )}
            </button>

            {/* Next */}
            <button
              onClick={onNext}
              disabled={!hasActiveSession && !canAccessSpotifyFeatures}
              className="w-[22px] h-[22px] rounded-full flex items-center justify-center text-island-secondary hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
              title="Next Track"
              aria-label="Next Track"
            >
              <SkipForward className="w-3 h-3 shrink-0 fill-current" />
            </button>
          </div>

          {/* Subtle Divider */}
          {canAccessSpotifyFeatures && <div className="h-3.5 w-[1px] bg-white/[0.08]" />}

          {/* Feature Panel Toggles: Lyrics, Search, Queue, Library */}
          <div className="flex items-center gap-1">
            {/* Lyrics Toggle */}
            <button
              onClick={() => onSwitchSubPanel?.('lyrics')}
              className={`w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all ${
                activeSubPanel === 'lyrics'
                  ? 'text-[#98BBD6] bg-[#98BBD6]/20 shadow-[0_0_8px_rgba(152,187,214,0.3)] ring-1 ring-[#98BBD6]/40'
                  : 'text-white/40 hover:text-[#98BBD6]'
              }`}
              title="Toggle Lyrics"
              aria-label="Toggle Lyrics"
            >
              <Mic2 className="w-2.5 h-2.5 shrink-0" />
            </button>

            {/* Search Toggle */}
            {canAccessSpotifyFeatures && (
              <button
                onClick={() => onSwitchSubPanel?.('search')}
                className={`w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all ${
                  activeSubPanel === 'search'
                    ? 'text-[#98BBD6] bg-[#98BBD6]/20 shadow-[0_0_8px_rgba(152,187,214,0.3)] ring-1 ring-[#98BBD6]/40'
                    : 'text-white/40 hover:text-[#98BBD6]'
                }`}
                title="Search Spotify"
                aria-label="Search Spotify"
              >
                <Search className="w-2.5 h-2.5 shrink-0" />
              </button>
            )}

            {/* Queue Toggle */}
            {canAccessSpotifyFeatures && (
              <button
                onClick={() => onSwitchSubPanel?.('queue')}
                className={`w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all ${
                  activeSubPanel === 'queue'
                    ? 'text-[#98BBD6] bg-[#98BBD6]/20 shadow-[0_0_8px_rgba(152,187,214,0.3)] ring-1 ring-[#98BBD6]/40'
                    : 'text-white/40 hover:text-[#98BBD6]'
                }`}
                title="View Queue"
                aria-label="View Queue"
              >
                <ListMusic className="w-2.5 h-2.5 shrink-0" />
              </button>
            )}

            {/* Playlists Toggle */}
            {canAccessSpotifyFeatures && (
              <button
                onClick={() => onSwitchSubPanel?.('playlist')}
                className={`w-[20px] h-[20px] rounded-full flex items-center justify-center transition-all ${
                  activeSubPanel === 'playlist'
                    ? 'text-[#98BBD6] bg-[#98BBD6]/20 shadow-[0_0_8px_rgba(152,187,214,0.3)] ring-1 ring-[#98BBD6]/40'
                    : 'text-white/40 hover:text-[#98BBD6]'
                }`}
                title="View Playlists"
                aria-label="View Playlists"
              >
                <Library className="w-2.5 h-2.5 shrink-0" />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
});

PlayerControls.displayName = 'PlayerControls';
