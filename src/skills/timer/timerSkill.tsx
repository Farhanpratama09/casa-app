import React from 'react';
import { LunarBunnyGlyph } from '../../components/LunarBunnyGlyph';
import { CasaSkill, SkillPriorityTier } from '../types';
import { TimerState } from '../../types/island';
import { TimerCardView } from '../../components/views/TimerCardView';
import { playAlarmNoticeOnce, startAlarmChime } from '../../utils/alarmChime';
import { getSettingsSnapshot } from '../../stores/useSettingsStore';
import { useSkillStore } from '../store';
import { TimerExpandedView } from '../../features/timer/TimerExpandedView';
import { TimerPillSlot } from '../../features/timer/TimerPillSlot';
import { formatDurationClock } from '../../features/timer/timerUtils';
import {
  loadPersistedFocusedTaskId,
  loadPersistedTodos,
  reconcileTimerFocusedTaskId,
} from '../../features/todo/todoPersistence';

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

  get initialState(): TimerState {
    const hydratedTodos = loadPersistedTodos();
    return {
      isActive: false,
      isPaused: true,
      totalSeconds: 25 * 60,
      remainingSeconds: 25 * 60,
      presetTotalSeconds: 25 * 60,
      currentCycle: 1,
      mode: 'focus',
      focusedTaskId: loadPersistedFocusedTaskId(hydratedTodos),
      isAlarmRinging: false,
    };
  },

  getPriority: (state: TimerState): SkillPriorityTier => {
    if (state.isAlarmRinging) return 'alert';
    if (!state.isActive) return 'idle';
    if (state.remainingSeconds <= 1) return 'alert';
    if (!state.isPaused) return 'active';
    return 'ambient';
  },

  onMount: (getState, setState) => {
    // Re-validate initial focusedTaskId against hydrated To-Do list on startup
    const bootTodos = useSkillStore.getState().skillStates['core.todo']?.todos;
    const hydratedTodos = Array.isArray(bootTodos) ? bootTodos : loadPersistedTodos();
    const initialTimer = getState();
    if (initialTimer?.focusedTaskId) {
      const validFocusId = reconcileTimerFocusedTaskId(initialTimer.focusedTaskId, hydratedTodos);
      if (validFocusId !== initialTimer.focusedTaskId) {
        setState((prev: TimerState) => ({
          ...prev,
          focusedTaskId: validFocusId,
        }));
      }
    }

    const interval = setInterval(() => {
      const state = getState();
      if (!state.isActive || state.isPaused || state.isAlarmRinging) return;

      const resolveValidFocusedTaskId = (focusedId?: string | null): string | null => {
        if (!focusedId) return null;
        const todos = useSkillStore.getState().skillStates['core.todo']?.todos;
        if (!Array.isArray(todos)) return null;
        return todos.some((t: { id: string; completed: boolean }) => t.id === focusedId && !t.completed)
          ? focusedId
          : null;
      };

      if (state.remainingSeconds <= 1) {
        if (getSettingsSnapshot().autoStartNextCycle) {
          playAlarmNoticeOnce();
          setState((prev: TimerState) => {
            const nextMode = prev.mode === 'focus' ? 'rest' : 'focus';
            const focusPreset =
              prev.presetTotalSeconds && prev.presetTotalSeconds >= 60
                ? prev.presetTotalSeconds
                : 25 * 60;
            const nextTotal = nextMode === 'rest' ? 5 * 60 : focusPreset;
            return {
              ...prev,
              mode: nextMode,
              totalSeconds: nextTotal,
              remainingSeconds: nextTotal,
              presetTotalSeconds: focusPreset,
              currentCycle:
                nextMode === 'focus' ? prev.currentCycle + 1 : prev.currentCycle,
              focusedTaskId: resolveValidFocusedTaskId(prev.focusedTaskId),
              isActive: true,
              isPaused: false,
              isAlarmRinging: false,
            };
          });
        } else {
          startAlarmChime();
          setState((prev: TimerState) => ({
            ...prev,
            remainingSeconds: 0,
            isPaused: true,
            isAlarmRinging: true,
            focusedTaskId: resolveValidFocusedTaskId(prev.focusedTaskId),
            presetTotalSeconds: prev.presetTotalSeconds || prev.totalSeconds || 25 * 60,
          }));
        }
      } else {
        setState((prev: TimerState) => ({
          ...prev,
          remainingSeconds: Math.max(0, prev.remainingSeconds - 1),
          focusedTaskId: prev.focusedTaskId ? resolveValidFocusedTaskId(prev.focusedTaskId) : null,
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
          className="w-[36px] h-[36px] rounded-full bg-[#09090b] border border-[#27272a] flex items-center justify-center cursor-pointer hover:border-zinc-700 active:scale-[0.97] transition-all duration-100 ease-out shadow-[0_4px_16px_rgba(0,0,0,0.85)]"
          title={`Active Timer: ${formatDurationClock(state.remainingSeconds)}`}
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
