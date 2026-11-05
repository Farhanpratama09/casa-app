import React from 'react';
import { ProductivitySplitView } from '../../components/views/ProductivitySplitView';
import { useTodoState } from './useTodoState';
import { useTimerState } from '../timer/useTimerState';
import { TodoSkillState } from './types';

interface TodoExpandedViewProps {
  state?: TodoSkillState;
  onCollapse?: () => void;
  onUpdateState?: (
    patchOrFn: Partial<TodoSkillState> | ((prev: TodoSkillState) => TodoSkillState)
  ) => void;
}

export const TodoExpandedView: React.FC<TodoExpandedViewProps> = ({
  state: propState,
  onCollapse: _onCollapse,
  onUpdateState: _onUpdateState,
}) => {
  const todo = useTodoState();
  const timer = useTimerState();
  const state = propState || todo.todoState;

  if (!state || !timer.timerState) {
    return null;
  }

  return (
    <ProductivitySplitView
      timer={timer.timerState}
      onToggleTimer={timer.toggleTimer}
      onResetTimer={timer.resetTimer}
      onSelectPreset={(minutes, mode) =>
        timer.selectPreset(minutes, mode === 'break' ? 'rest' : mode)
      }
      onAdjustMinutes={timer.adjustMinutes}
      todos={state.todos || []}
      onToggleTodo={todo.toggleTodo}
      onAddTodo={todo.addTodo}
      onTogglePin={todo.togglePin}
      onDeleteTodo={todo.removeTodo}
    />
  );
};
