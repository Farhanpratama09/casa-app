import React from 'react';
import { TodoCardView } from '../../components/views/TodoCardView';
import { useTodoState } from './useTodoState';
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
  const state = propState || todo.todoState;

  if (!state) {
    return null;
  }

  return (
    <TodoCardView
      todos={state.todos || []}
      onToggleTodo={todo.toggleTodo}
      onAddTodo={todo.addTodo}
      onTogglePin={todo.togglePin}
      onDeleteTodo={todo.removeTodo}
    />
  );
};
