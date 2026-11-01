import React from 'react';
import { LunarBunnyGlyph } from '../../components/LunarBunnyGlyph';
import { useTimerState } from './useTimerState';
import { TimerState } from './types';

interface TimerPillSlotProps {
  state?: TimerState;
  onClick?: () => void;
}

export const TimerPillSlot: React.FC<TimerPillSlotProps> = ({ state: propState, onClick }) => {
  const timer = useTimerState();
  const state = propState || timer.timerState;

  if (!state) return null;

  if (!state.isActive) {
    return (
      <div
        onClick={(e) => {
          e.stopPropagation();
          if (onClick) onClick();
        }}
        className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none px-2 py-0.5 rounded-full transition-colors hover:bg-white/5 text-white/40 hover:text-white/70"
        title="Focus Timer: 25:00"
        role="button"
        aria-label="Inactive Timer Teaser"
      >
        <div className="relative w-[13px] h-[13px] flex items-center justify-center shrink-0">
          <LunarBunnyGlyph className="w-3.5 h-3.5 text-white/40 shrink-0" />
        </div>
        <span
          className="text-[11px] font-medium tracking-tight tabular-nums text-white/50 font-urbanist"
          style={{ fontFamily: "'Urbanist', sans-serif" }}
        >
          25:00
        </span>
      </div>
    );
  }

  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins < 10 ? '0' : ''}${mins}:${secs < 10 ? '0' : ''}${secs}`;
  };

  const isAlert = state.remainingSeconds <= 1;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick();
      }}
      className={`flex items-center gap-1.5 shrink-0 cursor-pointer select-none px-2 py-0.5 rounded-full transition-colors hover:bg-white/5 ${
        isAlert ? 'animate-pulse' : ''
      }`}
      title={`Pomodoro Timer: ${formatTime(state.remainingSeconds)} (${state.mode})`}
      role="button"
      aria-label="Active Timer Teaser"
    >
      <div className="relative w-[13px] h-[13px] flex items-center justify-center shrink-0">
        <LunarBunnyGlyph
          className={`w-3.5 h-3.5 ${
            isAlert
              ? 'text-red-400 animate-spin'
              : state.isPaused
              ? 'text-white/40'
              : 'text-[#7DD3FC] animate-pulse'
          }`}
          style={{
            filter: !state.isPaused && !isAlert ? 'drop-shadow(0 0 4px rgba(125, 211, 252, 0.35))' : undefined,
          }}
        />
      </div>
      <span
        className={`text-[11px] font-semibold tracking-tight tabular-nums font-urbanist ${
          isAlert
            ? 'text-red-400'
            : state.isPaused
            ? 'text-white/40'
            : 'text-[#F8FAFC]'
        }`}
        style={{
          fontFamily: "'Urbanist', sans-serif",
          filter: !state.isPaused && !isAlert ? 'drop-shadow(0 0 6px rgba(125, 211, 252, 0.25))' : undefined,
        }}
      >
        {formatTime(state.remainingSeconds)}
      </span>
    </div>
  );
};
