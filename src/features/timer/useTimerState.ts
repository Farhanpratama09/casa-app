import { useCallback } from 'react';
import { useSkillStore } from '../../skills/store';
import { TimerState, TimerMode } from './types';

export function useTimerState() {
  const timerState: TimerState = useSkillStore(
    (s) => s.skillStates['core.timer']
  );
  const updateSkillState = useSkillStore((s) => s.updateSkillState);

  const updateState = useCallback(
    (patchOrFn: Partial<TimerState> | ((prev: TimerState) => TimerState)) => {
      updateSkillState('core.timer', patchOrFn);
    },
    [updateSkillState]
  );

  const toggleTimer = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      isActive: true,
      isPaused: !prev.isPaused,
    }));
  }, [updateState]);

  const resetTimer = useCallback(() => {
    updateState((prev) => ({
      ...prev,
      isActive: false,
      isPaused: true,
      remainingSeconds: prev.totalSeconds,
    }));
  }, [updateState]);

  const selectPreset = useCallback(
    (minutes: number, presetMode: TimerMode) => {
      updateState({
        isActive: true,
        isPaused: false,
        totalSeconds: minutes * 60,
        remainingSeconds: minutes * 60,
        currentCycle: 1,
        mode: presetMode,
      });
    },
    [updateState]
  );

  const adjustMinutes = useCallback(
    (delta: number) => {
      updateState((prev) => {
        const newTotal = Math.max(60, prev.totalSeconds + delta * 60);
        const newRem = Math.max(0, prev.remainingSeconds + delta * 60);
        return { ...prev, totalSeconds: newTotal, remainingSeconds: newRem };
      });
    },
    [updateState]
  );

  return {
    timerState,
    isActive: timerState?.isActive ?? false,
    isPaused: timerState?.isPaused ?? true,
    totalSeconds: timerState?.totalSeconds ?? 25 * 60,
    remainingSeconds: timerState?.remainingSeconds ?? 25 * 60,
    currentCycle: timerState?.currentCycle ?? 1,
    mode: timerState?.mode ?? 'focus',
    toggleTimer,
    resetTimer,
    selectPreset,
    adjustMinutes,
    updateState,
  };
}
