import React from 'react';
import { ProductivitySplitView } from '../../components/views/ProductivitySplitView';
import { useTimerState } from './useTimerState';
import { useTodoState } from '../todo/useTodoState';
import { TimerState } from './types';

interface TimerExpandedViewProps {
  state?: TimerState;
  onCollapse?: () => void;
  onUpdateState?: (
    patchOrFn: Partial<TimerState> | ((prev: TimerState) => TimerState)
  ) => void;
}

export const TimerExpandedView: React.FC<TimerExpandedViewProps> = ({
  state: propState,
  onCollapse: _onCollapse,
  onUpdateState: _onUpdateState,
}) => {
  const timer = useTimerState();
  const todo = useTodoState();
  const state = propState || timer.timerState;

  if (!state) {
    return null;
  }

  return (
    <ProductivitySplitView
      timer={state}
      onToggleTimer={timer.toggleTimer}
      onResetTimer={timer.resetTimer}
      onSelectPreset={(minutes, mode) =>
        timer.selectPreset(minutes, mode === 'break' ? 'rest' : mode)
      }
      onAdjustMinutes={timer.adjustMinutes}
      todos={todo.todoState?.todos || []}
      onToggleTodo={todo.toggleTodo}
      onAddTodo={todo.addTodo}
      onTogglePin={todo.togglePin}
      onDeleteTodo={todo.removeTodo}
    />
  );
};
