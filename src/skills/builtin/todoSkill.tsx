import React from 'react';
import { CheckSquare } from 'lucide-react';
import { CasaSkill, SkillPriorityTier } from '../types';
import { TodoItem } from '../../types/island';
import { TodoCardView } from '../../components/views/TodoCardView';
import { TodoExpandedView } from '../../features/todo/TodoExpandedView';
import { TodoPillSlot } from '../../features/todo/TodoPillSlot';

export interface TodoSkillState {
  todos: TodoItem[];
}

export const todoSkill: CasaSkill<TodoSkillState> = {
  manifest: {
    id: 'core.todo',
    name: 'To-Do Tasks',
    version: '1.0.0',
    description: 'Minimalist checklist for priority daily engineering tasks',
    icon: CheckSquare,
    category: 'productivity',
  },

  dimensions: {
    expanded: {
      width: 700,
      height: 162,
    },
  },

  initialState: {
    todos: [
      { id: '1', text: 'Review CASA Top-Bezel Notch styling', completed: true, isPinned: true },
      { id: '2', text: 'Fine-tune 2-column split-card music & timer', completed: false, isPinned: false },
      { id: '3', text: 'Configure Win32 WS_EX_NOACTIVATE focus lock', completed: false, isPinned: false },
      { id: '4', text: 'Verify Micro-Status Header clock and wave', completed: false, isPinned: false },
    ],
  },

  getPriority: (_state: TodoSkillState): SkillPriorityTier => {
    // Todos are generally passive unless the user actively selects them
    return 'idle';
  },

  slots: {
    PillTeaser: ({ state, onClick }) => {
      return <TodoPillSlot state={state} onClick={onClick} />;
    },

    BubbleTeaser: ({ state, onClick }) => {
      const pendingCount = state.todos.filter((t) => !t.completed).length;
      return (
        <div
          onClick={onClick}
          className="w-[36px] h-[36px] rounded-full bg-neutral-950/80 backdrop-blur-2xl border border-white/[0.12] flex items-center justify-center cursor-pointer hover:border-indigo-400/50 transition-colors shadow-2xl"
          title={`Tasks: ${pendingCount} pending`}
          role="button"
          aria-label="Active Tasks Bubble"
        >
          <div className="flex flex-col items-center justify-center">
            <CheckSquare className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
            <span
              className="text-[8.5px] font-semibold text-indigo-300 tabular-nums leading-none mt-0.5 font-urbanist"
              style={{ fontFamily: "'Urbanist', sans-serif" }}
            >
              {pendingCount}
            </span>
          </div>
        </div>
      );
    },

    ExpandedCard: ({ state, onCollapse, onUpdateState }) => {
      return (
        <TodoExpandedView
          state={state}
          onCollapse={onCollapse}
          onUpdateState={onUpdateState}
        />
      );
    },
  },
};
