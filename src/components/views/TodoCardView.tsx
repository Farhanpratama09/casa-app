import React, { useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { TodoItem } from '../../types/island';
import { playChimeCue } from '../../utils/tauriBridge';
import { CosmicCarrotPin } from '../CosmicCarrotPin';

interface TodoCardViewProps {
  todos: TodoItem[];
  onToggleTodo: (id: string) => void;
  onAddTodo: (text: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteTodo?: (id: string) => void;
}

export const TodoCardView: React.FC<TodoCardViewProps> = ({
  todos,
  onToggleTodo,
  onAddTodo,
  onTogglePin,
  onDeleteTodo,
}) => {
  const [inputVal, setInputVal] = useState('');

  const handleSubmit = () => {
    if (inputVal.trim()) {
      onAddTodo(inputVal.trim());
      setInputVal('');
      playChimeCue('tap');
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSubmit();
    }
  };

  const completedCount = todos.filter((t) => t.completed).length;

  // Auto-sort: Yang di-pin selalu meluncur naik ke atas, yang tidak di-pin tetap di bawah
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });

  return (
    <div className="w-full max-w-[620px] h-[140px] px-5 py-2 select-none flex flex-col justify-between overflow-hidden relative">
      {/* =================================================================== */}
      {/* Background Cosmic Veil: Starlight Frost & Celestial Indigo          */}
      {/* =================================================================== */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        {/* Radial Nebula Veil di Sudut Kanan Bawah */}
        <div
          className="absolute -bottom-10 -right-10 w-[280px] h-[170px] rounded-full opacity-25 blur-3xl pointer-events-none"
          style={{
            background: 'radial-gradient(ellipse at bottom right, rgba(99, 102, 241, 0.12) 0%, rgba(129, 140, 248, 0.05) 50%, transparent 80%)',
          }}
        />

        {/* Subtle Cosmic Dust (SVG Layer: 4-5 micro starlight points) */}
        <svg className="absolute inset-0 w-full h-full opacity-15 pointer-events-none" xmlns="http://www.w3.org/2000/svg">
          <circle cx="390" cy="26" r="1.2" fill="#818CF8" />
          <circle cx="470" cy="72" r="1.5" fill="#A5B4FC" />
          <circle cx="535" cy="38" r="1.0" fill="#E0F2FE" />
          <circle cx="590" cy="85" r="1.3" fill="#818CF8" />
          <circle cx="515" cy="118" r="1.1" fill="#A5B4FC" />
        </svg>
      </div>

      {/* =================================================================== */}
      {/* 1. Fixed Top Header: TASKS & Celestial Counter                      */}
      {/* =================================================================== */}
      <div className="flex items-center justify-between w-full h-[24px] pb-1 border-b border-white/[0.06] shrink-0 relative z-10">
        <div className="flex items-center gap-2">
          <span
            className="text-[11px] font-bold tracking-[0.22em] uppercase text-white/60 font-urbanist"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
          >
            TASKS
          </span>
          <span
            className="text-[10px] font-urbanist text-white/40 px-1.5 py-0.5 rounded bg-white/[0.03] border border-white/[0.06] tabular-nums"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
          >
            [<span className="text-indigo-300 font-semibold">{String(completedCount).padStart(2, '0')}</span>/{String(todos.length).padStart(2, '0')}]
          </span>
        </div>

        {/* Celestial Indigo Stardust Dot di pojok kanan atas (status siap) */}
        <div className="flex items-center justify-end" title="System Ready">
          <span className="w-1 h-1 rounded-full bg-indigo-400 shadow-[0_0_6px_rgba(129,140,248,0.7)] animate-pulse" />
        </div>
      </div>

      {/* =================================================================== */}
      {/* 2. Scrollable Tasks List (Priority Float, Max-H 72px, 2px Scroll)   */}
      {/* =================================================================== */}
      <div
        className="flex-1 overflow-y-auto max-h-[72px] pr-3 mr-1 my-1 cosmic-tasks-scrollbar [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-indigo-400/30 [&::-webkit-scrollbar-thumb]:rounded-full hover:[&::-webkit-scrollbar-thumb]:bg-indigo-400/60 relative z-10"
        onWheel={(e) => {
          // Hentikan propagasi agar kontainer induk notch tidak menangkap sinyal ganti modul
          e.stopPropagation();
        }}
      >
        {sortedTodos.length === 0 ? (
          <div
            className="text-center py-3 text-white/30 text-[11px] font-urbanist"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
          >
            No tasks active
          </div>
        ) : (
          sortedTodos.map((item, idx, arr) => (
            <div
              key={item.id}
              className={`relative flex items-center justify-between gap-2 py-1.5 px-2 transition-all group ${
                idx < arr.length - 1 ? 'border-b border-white/[0.04]' : ''
              } ${
                item.isPinned
                  ? 'border-l-2 border-indigo-400/80 shadow-[0_0_8px_rgba(129,140,248,0.35)] bg-white/[0.02]'
                  : 'border-l-2 border-transparent hover:bg-white/[0.015]'
              }`}
            >
              {/* Aksen Titik Pusat Pendaran Indigo pada Divider */}
              {idx < arr.length - 1 && (
                <div className="absolute -bottom-[1px] left-1/2 -translate-x-1/2 w-16 h-[1px] bg-gradient-to-r from-transparent via-indigo-400/25 to-transparent pointer-events-none" />
              )}

              {/* Checkbox & Task Text */}
              <div
                onClick={() => {
                  onToggleTodo(item.id);
                  if (!item.completed) {
                    playChimeCue('ding');
                  } else {
                    playChimeCue('tap');
                  }
                }}
                className="flex items-center gap-2.5 min-w-0 flex-1 cursor-pointer"
              >
                {/* Technical Monospace Index: [01], [02], ... */}
                <span className="text-[10px] font-mono text-white/30 shrink-0 tabular-nums">
                  [{String(idx + 1).padStart(2, '0')}]
                </span>

                {/* Minimalist Circle Checkbox (Diameter 15px) */}
                <div
                  className={`w-[15px] h-[15px] rounded-full flex items-center justify-center shrink-0 transition-all ${
                    item.completed
                      ? 'bg-indigo-500/20 border border-indigo-400/60 shadow-[0_0_6px_rgba(129,140,248,0.3)]'
                      : 'border border-white/20 hover:border-indigo-300/50 bg-white/[0.02]'
                  }`}
                >
                  {item.completed && <Check className="w-2.5 h-2.5 stroke-[2.5] text-indigo-200" />}
                </div>

                {/* Task Text (Urbanist Font) */}
                <span
                  className={`text-[12px] font-urbanist truncate transition-all ${
                    item.completed
                      ? 'opacity-35 line-through text-white/40'
                      : 'text-white/90 group-hover:text-white font-medium'
                  }`}
                  style={{ fontFamily: "'Urbanist', sans-serif" }}
                >
                  {item.text}
                </span>
              </div>

              {/* Action Buttons: Cosmic Carrot Pin + Tactical Delete Button */}
              <div className="flex items-center gap-0.5 shrink-0">
                {/* Prismatic Cosmic Carrot Pin (Celestial Indigo Glow) */}
                <CosmicCarrotPin
                  isPinned={Boolean(item.isPinned)}
                  onClick={() => {
                    onTogglePin(item.id);
                    playChimeCue('tap');
                  }}
                />

                {/* Tombol Hapus Taktikal (Hover Reveal) */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (onDeleteTodo) {
                      onDeleteTodo(item.id);
                      playChimeCue('tap');
                    }
                  }}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-white/[0.06] text-white/30 hover:text-red-400 transition-all duration-150 cursor-pointer shrink-0"
                  title="Delete task"
                  aria-label="Delete task"
                >
                  <svg
                    className="w-3 h-3 shrink-0"
                    viewBox="0 0 12 12"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <line x1="2.5" y1="2.5" x2="9.5" y2="9.5" />
                    <line x1="9.5" y1="2.5" x2="2.5" y2="9.5" />
                  </svg>
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* =================================================================== */}
      {/* 3. Fixed Bottom Quick Input Row: Add new task...                    */}
      {/* =================================================================== */}
      <div className="flex items-center gap-2 w-full h-[28px] pt-1 border-t border-white/[0.06] shrink-0 relative z-10">
        {/* Tombol + Aktif */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!inputVal.trim()}
          className="p-1 rounded hover:bg-white/[0.08] active:scale-95 transition-all cursor-pointer text-indigo-300/70 hover:text-indigo-200 disabled:opacity-40 disabled:hover:bg-transparent shrink-0"
          title="Add task"
          aria-label="Add task"
        >
          <Plus className="w-3.5 h-3.5 shrink-0" />
        </button>

        {/* Input Text Transparan */}
        <input
          type="text"
          value={inputVal}
          onChange={(e) => setInputVal(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add new task..."
          className="bg-transparent outline-none text-white text-xs font-urbanist placeholder-white/30 flex-1 min-w-0 tracking-wide"
          style={{ fontFamily: "'Urbanist', sans-serif" }}
        />

        {/* Tombol ↵ Aktif */}
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!inputVal.trim()}
          className="text-[9px] font-mono text-white/40 hover:text-indigo-200 px-1.5 py-0.5 rounded border border-white/10 hover:border-indigo-400/40 bg-white/[0.02] hover:bg-indigo-500/10 active:scale-95 transition-all cursor-pointer shrink-0 disabled:opacity-30 disabled:hover:border-white/10 disabled:hover:bg-white/[0.02]"
          title="Submit task"
          aria-label="Submit task"
        >
          ↵
        </button>
      </div>
    </div>
  );
};
