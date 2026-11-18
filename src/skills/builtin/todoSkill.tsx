import React from 'react';
import { CheckSquare } from 'lucide-react';
import { CasaSkill, SkillPriorityTier } from '../types';
import { TodoItem } from '../../types/island';
import { TodoCardView } from '../../components/views/TodoCardView';
import { TodoExpandedView } from '../../features/todo/TodoExpandedView';
import { TodoPillSlot } from '../../features/todo/TodoPillSlot';
import { loadPersistedTodos } from '../../features/todo/todoPersistence';

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

  get initialState(): TodoSkillState {
    return {
      todos: loadPersistedTodos(),
    };
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
          className="w-[36px] h-[36px] rounded-full bg-[#09090b] border border-[#27272a] flex items-center justify-center cursor-pointer hover:border-zinc-700 active:scale-[0.97] transition-all duration-100 ease-out shadow-[0_4px_16px_rgba(0,0,0,0.85)]"
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
