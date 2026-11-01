import React from 'react';
import { CheckSquare } from 'lucide-react';
import { useTodoState } from './useTodoState';
import { TodoSkillState } from './types';

interface TodoPillSlotProps {
  state?: TodoSkillState;
  onClick?: () => void;
}

export const TodoPillSlot: React.FC<TodoPillSlotProps> = ({ state: propState, onClick }) => {
  const todo = useTodoState();
  const state = propState || todo.todoState;

  if (!state || !state.todos) return null;

  const pendingCount = state.todos.filter((t) => !t.completed).length;

  return (
    <div
      onClick={(e) => {
        e.stopPropagation();
        if (onClick) onClick();
      }}
      className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none px-2 py-0.5 rounded-full transition-colors hover:bg-white/5 text-white/60 hover:text-white/90"
      title={`To-Do Tasks: ${pendingCount} pending`}
      role="button"
      aria-label="To-Do Tasks Teaser"
    >
      <span
        className="text-[11px] font-semibold tracking-wide tabular-nums text-indigo-300 font-urbanist"
        style={{ fontFamily: "'Urbanist', sans-serif" }}
      >
        {pendingCount} task{pendingCount !== 1 ? 's' : ''}
      </span>
      <CheckSquare className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
    </div>
  );
};
