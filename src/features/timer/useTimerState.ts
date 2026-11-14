import { useCallback } from 'react';
import { useSkillStore } from '../../skills/store';
import { TimerState, TimerMode } from './types';
import { TodoItem } from '../../types/island';
import {
  computeRemainingSecondsUntil,
  MAX_TIMER_MINUTES,
  stopAndResetTimerState,
} from './timerUtils';
import { stopAlarmChime, unlockAlarmAudio } from '../../utils/alarmChime';

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
    const current = useSkillStore.getState().skillStates['core.timer'] as TimerState | undefined;
    if (!current || current.isPaused || !current.isActive) {
      unlockAlarmAudio();
    }
    if (current?.isAlarmRinging) {
      stopAlarmChime();
    }
    updateState((prev) => {
      const nextPaused = prev.isAlarmRinging ? false : !prev.isPaused;
      const basePreset = prev.presetTotalSeconds || prev.totalSeconds || 25 * 60;
      const nextRemaining =
        prev.remainingSeconds <= 0 ? basePreset : prev.remainingSeconds;
      const nextTotal = prev.totalSeconds <= 0 ? basePreset : prev.totalSeconds;
      return {
        ...prev,
        isActive: true,
        isPaused: nextPaused,
        isAlarmRinging: false,
        totalSeconds: nextTotal,
        remainingSeconds: nextRemaining,
        presetTotalSeconds: basePreset,
      };
    });
  }, [updateState]);

  const resetTimer = useCallback(() => {
    stopAlarmChime();
    updateState((prev) => {
      const resetSecs = prev.presetTotalSeconds || prev.totalSeconds || 25 * 60;
      return {
        ...prev,
        isActive: false,
        isPaused: true,
        isAlarmRinging: false,
        totalSeconds: resetSecs,
        remainingSeconds: resetSecs,
      };
    });
  }, [updateState]);

  const selectPreset = useCallback(
    (minutes: number, presetMode: TimerMode) => {
      unlockAlarmAudio();
      stopAlarmChime();
      const secs = minutes * 60;
      updateState((prev) => ({
        ...prev,
        isActive: true,
        isPaused: false,
        isAlarmRinging: false,
        totalSeconds: secs,
        remainingSeconds: secs,
        presetTotalSeconds: secs,
        currentCycle: 1,
        mode: presetMode,
      }));
    },
    [updateState]
  );

  const addFiveMinutes = useCallback(() => {
    unlockAlarmAudio();
    stopAlarmChime();
    updateState((prev) => {
      const basePreset = prev.presetTotalSeconds || prev.totalSeconds || 25 * 60;
      const nextRemaining = (prev.remainingSeconds > 0 ? prev.remainingSeconds : 0) + 300;
      const nextTotal = prev.remainingSeconds <= 0 ? 300 : prev.totalSeconds + 300;
      return {
        ...prev,
        isActive: true,
        isPaused: false,
        isAlarmRinging: false,
        totalSeconds: nextTotal,
        remainingSeconds: nextRemaining,
        presetTotalSeconds: basePreset,
      };
    });
  }, [updateState]);

  const dismissAlarm = useCallback(() => {
    stopAlarmChime();
    updateState((prev) => {
      const resetSecs = prev.presetTotalSeconds || prev.totalSeconds || 25 * 60;
      return {
        ...prev,
        isActive: false,
        isPaused: true,
        isAlarmRinging: false,
        totalSeconds: resetSecs,
        remainingSeconds: resetSecs,
      };
    });
  }, [updateState]);

  const setFocusedTaskId = useCallback(
    (taskId: string | null) => {
      updateState((prev) => ({
        ...prev,
        focusedTaskId: taskId,
      }));
    },
    [updateState]
  );

  const toggleFocusTask = useCallback(
    (taskId: string, scheduledTime?: string) => {
      unlockAlarmAudio();
      stopAlarmChime();
      updateState((prev) => {
        const isAlreadyFocused = prev.focusedTaskId === taskId;
        if (isAlreadyFocused) {
          return {
            ...prev,
            focusedTaskId: null,
          };
        }

        const resolvedSchedule =
          scheduledTime ??
          useSkillStore
            .getState()
            .skillStates['core.todo']?.todos?.find((t: TodoItem) => t.id === taskId)?.scheduledTime;
        const autoSeconds = computeRemainingSecondsUntil(resolvedSchedule);

        if (autoSeconds !== null && autoSeconds > 0) {
          return {
            ...prev,
            focusedTaskId: taskId,
            isActive: true,
            isPaused: false,
            mode: 'focus',
            totalSeconds: autoSeconds,
            remainingSeconds: autoSeconds,
          };
        }

        return {
          ...prev,
          focusedTaskId: taskId,
          isActive: true,
          isPaused: false,
          remainingSeconds: prev.remainingSeconds > 0 ? prev.remainingSeconds : prev.totalSeconds,
        };
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

  const stopTimerSession = useCallback(() => {
    stopAlarmChime();
    updateState((prev) => ({
      ...stopAndResetTimerState(prev),
      isAlarmRinging: false,
    }));
  }, [updateState]);

  const setCustomMinutes = useCallback(
    (minutes: number) => {
      stopAlarmChime();
      const clampedMins = Math.max(1, Math.min(MAX_TIMER_MINUTES, Math.round(minutes)));
      const secs = clampedMins * 60;
      updateState((prev) => ({
        ...prev,
        isActive: false,
        isPaused: true,
        isAlarmRinging: false,
        totalSeconds: secs,
        remainingSeconds: secs,
        presetTotalSeconds: secs,
        mode: clampedMins <= 10 ? 'rest' : 'focus',
      }));
    },
    [updateState]
  );

  return {
    timerState,
    isActive: timerState?.isActive ?? false,
    isPaused: timerState?.isPaused ?? true,
    isAlarmRinging: timerState?.isAlarmRinging ?? false,
    totalSeconds: timerState?.totalSeconds ?? 25 * 60,
    remainingSeconds: timerState?.remainingSeconds ?? 25 * 60,
    currentCycle: timerState?.currentCycle ?? 1,
    mode: timerState?.mode ?? 'focus',
    focusedTaskId: timerState?.focusedTaskId ?? null,
    toggleTimer,
    resetTimer,
    stopTimerSession,
    selectPreset,
    addFiveMinutes,
    dismissAlarm,
    setFocusedTaskId,
    toggleFocusTask,
    adjustMinutes,
    setCustomMinutes,
    updateState,
  };
}
