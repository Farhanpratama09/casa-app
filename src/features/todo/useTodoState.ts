import { useCallback } from 'react';
import { useSkillStore } from '../../skills/store';
import { TodoSkillState, TodoItem } from './types';

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
      updateState((prev) => ({
        ...prev,
        todos: prev.todos.map((t) =>
          t.id === id ? { ...t, completed: !t.completed } : t
        ),
      }));
    },
    [updateState]
  );

  const togglePin = useCallback(
    (id: string) => {
      updateState((prev) => ({
        ...prev,
        todos: prev.todos.map((t) =>
          t.id === id ? { ...t, isPinned: !t.isPinned } : t
        ),
      }));
    },
    [updateState]
  );

  const addTodo = useCallback(
    (text: string) => {
      if (!text.trim()) return;
      const newItem: TodoItem = {
        id: Date.now().toString(),
        text: text.trim(),
        completed: false,
        isPinned: false,
      };
      updateState((prev) => ({
        ...prev,
        todos: [...(prev.todos || []), newItem],
      }));
    },
    [updateState]
  );

  const removeTodo = useCallback(
    (id: string) => {
      updateState((prev) => ({
        ...prev,
        todos: prev.todos.filter((t) => t.id !== id),
      }));
    },
    [updateState]
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

  return {
    todoState,
    todos: todoState?.todos || [],
    toggleTodo,
    togglePin,
    addTodo,
    removeTodo,
    reorderTodos,
    updateState,
  };
}
