import React from 'react';
import { LunarBunnyGlyph } from '../../components/LunarBunnyGlyph';
import { CasaSkill, SkillPriorityTier } from '../types';
import { TimerState } from '../../types/island';
import { TimerCardView } from '../../components/views/TimerCardView';
import { playChimeCue } from '../../utils/tauriBridge';
import { TimerExpandedView } from '../../features/timer/TimerExpandedView';
import { TimerPillSlot } from '../../features/timer/TimerPillSlot';

export const timerSkill: CasaSkill<TimerState> = {
  manifest: {
    id: 'core.timer',
    name: 'Focus Timer',
    version: '1.0.0',
    description: 'Pomodoro focus timer with circular progress and multi-phase cycles',
    icon: LunarBunnyGlyph,
    category: 'productivity',
  },

  dimensions: {
    expanded: {
      width: 700,
      height: 162,
    },
  },

  initialState: {
    isActive: false,
    isPaused: true,
    totalSeconds: 25 * 60,
    remainingSeconds: 25 * 60,
    currentCycle: 1,
    mode: 'focus',
  },

  getPriority: (state: TimerState): SkillPriorityTier => {
    if (!state.isActive) return 'idle';
    if (state.remainingSeconds <= 1) return 'alert';
    if (!state.isPaused) return 'active';
    return 'ambient';
  },

  onMount: (getState, setState) => {
    const interval = setInterval(() => {
      const state = getState();
      if (!state.isActive || state.isPaused) return;

      if (state.remainingSeconds <= 1) {
        playChimeCue('ding');
        const nextMode = state.mode === 'focus' ? 'rest' : 'focus';
        const nextTotal = nextMode === 'focus' ? 25 * 60 : 5 * 60;
        const nextCycle =
          nextMode === 'focus' ? Math.min(4, state.currentCycle + 1) : state.currentCycle;

        setState({
          mode: nextMode,
          totalSeconds: nextTotal,
          remainingSeconds: nextTotal,
          currentCycle: nextCycle,
          isPaused: false,
        });
      } else {
        setState((prev: TimerState) => ({
          ...prev,
          remainingSeconds: Math.max(0, prev.remainingSeconds - 1),
        }));
      }
    }, 1000);

    return () => clearInterval(interval);
  },

  slots: {
    PillTeaser: ({ state, onClick }) => {
      return <TimerPillSlot state={state} onClick={onClick} />;
    },

    ExpandedCard: ({ state, onCollapse, onUpdateState }) => {
      return (
        <TimerExpandedView
          state={state}
          onCollapse={onCollapse}
          onUpdateState={onUpdateState}
        />
      );
    },

    BubbleTeaser: ({ state, onClick }) => {
      const formatTimerShort = (sec: number) => {
        const m = Math.ceil(sec / 60);
        return `${m}m`;
      };

      const isAlert = state.remainingSeconds <= 1;

      return (
        <div
          onClick={onClick}
          className="w-[36px] h-[36px] rounded-full bg-[#0D0E12]/95 backdrop-blur-md flex items-center justify-center border border-white/[0.12] cursor-pointer hover:border-[#7DD3FC]/40 transition-colors shadow-ambient"
          title={`Active Timer: ${Math.floor(state.remainingSeconds / 60)}:${(state.remainingSeconds % 60).toString().padStart(2, '0')}`}
          role="button"
          aria-label="Active Timer Bubble"
        >
          <div className="flex flex-col items-center justify-center">
            <LunarBunnyGlyph
              className={`w-3.5 h-3.5 shrink-0 ${
                isAlert ? 'text-red-400 animate-spin' : state.isPaused ? 'text-white/40' : 'text-[#7DD3FC] animate-pulse'
              }`}
              style={{
                filter: !state.isPaused && !isAlert ? 'drop-shadow(0 0 3px rgba(125, 211, 252, 0.35))' : undefined,
              }}
            />
            <span
              className={`text-[8.5px] font-semibold tabular-nums leading-none mt-0.5 font-urbanist ${
                isAlert ? 'text-red-400' : state.isPaused ? 'text-white/40' : 'text-[#F8FAFC]'
              }`}
              style={{ fontFamily: "'Urbanist', sans-serif" }}
            >
              {formatTimerShort(state.remainingSeconds)}
            </span>
          </div>
        </div>
      );
    },
  },
};
