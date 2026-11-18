import React from 'react';
import { ProductivitySplitView } from '../../components/views/ProductivitySplitView';
import { useTodoState } from './useTodoState';
import { useTimerState } from '../timer/useTimerState';
import { TodoSkillState } from './types';

interface TodoExpandedViewProps {
  state?: TodoSkillState;
  onCollapse?: () => void;
  onOpenMusic?: () => void;
  onUpdateState?: (
    patchOrFn: Partial<TodoSkillState> | ((prev: TodoSkillState) => TodoSkillState)
  ) => void;
}

export const TodoExpandedView: React.FC<TodoExpandedViewProps> = ({
  state: propState,
  onCollapse: _onCollapse,
  onOpenMusic,
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
      onSetCustomMinutes={timer.setCustomMinutes}
      onAddFiveMinutes={timer.addFiveMinutes}
      onDismissAlarm={timer.dismissAlarm}
      onCompleteFocusedTodo={timer.completeFocusedTodoAndDismiss}
      focusedTaskId={timer.focusedTaskId}
      onFocusTask={timer.toggleFocusTask}
      todos={state.todos || []}
      onToggleTodo={todo.toggleTodo}
      onAddTodo={todo.addTodo}
      onSetTodoTime={todo.setTodoScheduledTime}
      onTogglePin={todo.togglePin}
      onDeleteTodo={todo.removeTodo}
      onOpenMusic={onOpenMusic}
    />
  );
};
