import { useCallback, useMemo } from 'react';
import { useSkillStore } from '../../skills/store';
import { TodoSkillState, TodoItem } from './types';
import { TimerState } from '../timer/types';
import { computeRemainingSecondsUntil, unlinkTodoFromTimerState } from '../timer/timerUtils';
import { stopAlarmChime } from '../../utils/alarmChime';
import { loadPersistedTodos } from './todoPersistence';

export function useTodoState() {
  const todoState: TodoSkillState = useSkillStore(
    (s) => s.skillStates['core.todo']
  );
  const updateSkillState = useSkillStore((s) => s.updateSkillState);

  const updateState = useCallback(
    (patchOrFn: Partial<TodoSkillState> | ((prev: TodoSkillState) => TodoSkillState)) => {
      updateSkillState('core.todo', patchOrFn);
    },
    [updateSkillState]
  );

  const toggleTodo = useCallback(
    (id: string) => {
      const currentTodos = useSkillStore.getState().skillStates['core.todo']?.todos || [];
      const targetTodo = currentTodos.find((t: TodoItem) => t.id === id);
      const willComplete = targetTodo ? !targetTodo.completed : false;

      updateState((prev) => ({
        ...prev,
        todos: (prev?.todos || []).map((t) =>
          t.id === id
            ? { ...t, completed: willComplete, isPinned: willComplete ? false : t.isPinned }
            : t
        ),
      }));

      if (willComplete) {
        let shouldStopChime = false;
        updateSkillState('core.timer', (prevTimer: TimerState) => {
          const { nextState, stoppedAlarm } = unlinkTodoFromTimerState(prevTimer, id);
          shouldStopChime = stoppedAlarm;
          return nextState;
        });
        if (shouldStopChime) {
          stopAlarmChime();
        }
      }
    },
    [updateState, updateSkillState]
  );

  const togglePin = useCallback(
    (id: string) => {
      const currentTodos = useSkillStore.getState().skillStates['core.todo']?.todos || [];
      const targetTodo = currentTodos.find((t: TodoItem) => t.id === id);
      if (!targetTodo) return;

      // Only active (uncompleted) tasks can be pinned; allow unpinning if somehow still pinned
      if (targetTodo.completed && !targetTodo.isPinned) {
        return;
      }

      const willPin = !targetTodo.isPinned && !targetTodo.completed;

      updateState((prev) => ({
        ...prev,
        todos: (prev?.todos || []).map((t) => {
          if (t.id === id) {
            return { ...t, isPinned: willPin };
          }
          return willPin && t.isPinned ? { ...t, isPinned: false } : t;
        }),
      }));

      updateSkillState('core.timer', (prevTimer: TimerState) => {
        if (!prevTimer) return prevTimer;
        if (willPin) {
          const isRunning = prevTimer.isActive && !prevTimer.isPaused;
          const autoSeconds = targetTodo.scheduledTime
            ? computeRemainingSecondsUntil(targetTodo.scheduledTime)
            : null;
          if (!isRunning && autoSeconds && autoSeconds > 0) {
            return {
              ...prevTimer,
              focusedTaskId: id,
              mode: 'focus',
              totalSeconds: autoSeconds,
              remainingSeconds: autoSeconds,
            };
          }
          return {
            ...prevTimer,
            focusedTaskId: id,
          };
        }

        if (prevTimer.focusedTaskId === id) {
          return {
            ...prevTimer,
            focusedTaskId: null,
          };
        }
        return prevTimer;
      });
    },
    [updateState, updateSkillState]
  );

  const addTodo = useCallback(
    (text: string, scheduledTime?: string) => {
      if (!text.trim()) return;
      const newItem: TodoItem = {
        id: Date.now().toString(),
        text: text.trim(),
        completed: false,
        isPinned: false,
        ...(scheduledTime ? { scheduledTime } : {}),
      };
      updateState((prev) => ({
        ...prev,
        todos: [...(prev.todos || []), newItem],
      }));
    },
    [updateState]
  );

  const setTodoScheduledTime = useCallback(
    (id: string, scheduledTime?: string) => {
      const normalized = scheduledTime?.trim() ? scheduledTime.trim() : undefined;
      updateState((prev) => ({
        ...prev,
        todos: (prev?.todos || []).map((t) =>
          t.id === id ? { ...t, scheduledTime: normalized } : t
        ),
      }));

      if (normalized) {
        const autoSeconds = computeRemainingSecondsUntil(normalized);
        if (autoSeconds !== null && autoSeconds > 0) {
          updateSkillState('core.timer', (prevTimer: TimerState) => {
            if (!prevTimer || prevTimer.focusedTaskId !== id) {
              return prevTimer;
            }
            return {
              ...prevTimer,
              totalSeconds: autoSeconds,
              remainingSeconds: autoSeconds,
            };
          });
        }
      }
    },
    [updateState, updateSkillState]
  );

  const removeTodo = useCallback(
    (id: string) => {
      updateState((prev) => ({
        ...prev,
        todos: (prev?.todos || []).filter((t) => t.id !== id),
      }));
      let shouldStopChime = false;
      updateSkillState('core.timer', (prevTimer: TimerState) => {
        const { nextState, stoppedAlarm } = unlinkTodoFromTimerState(prevTimer, id);
        shouldStopChime = stoppedAlarm;
        return nextState;
      });
      if (shouldStopChime) {
        stopAlarmChime();
      }
    },
    [updateState, updateSkillState]
  );

  const reorderTodos = useCallback(
    (newTodos: TodoItem[]) => {
      updateState((prev) => ({
        ...prev,
        todos: newTodos,
      }));
    },
    [updateState]
  );

  const editTodoText = useCallback(
    (id: string, nextText: string) => {
      const trimmed = nextText.trim();
      if (!trimmed) return;
      updateState((prev) => ({
        ...prev,
        todos: (prev?.todos || []).map((t) =>
          t.id === id ? { ...t, text: trimmed } : t
        ),
      }));
    },
    [updateState]
  );

  const hydratedTodos = useMemo(() => {
    if (Array.isArray(todoState?.todos)) {
      return todoState.todos;
    }
    return loadPersistedTodos();
  }, [todoState?.todos]);

  return {
    todoState,
    todos: hydratedTodos,
    toggleTodo,
    togglePin,
    addTodo,
    editTodoText,
    setTodoScheduledTime,
    removeTodo,
    reorderTodos,
    updateState,
  };
}
