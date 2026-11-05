import React, { useState } from 'react';
import { Play, Pause, RotateCcw, Check, Plus, X } from 'lucide-react';
import { TimerState, TodoItem } from '../../types/island';
import { playChimeCue } from '../../utils/tauriBridge';
import { CosmicCarrotPin } from '../CosmicCarrotPin';

export interface ProductivitySplitViewProps {
  timer: TimerState;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onSelectPreset: (minutes: number, mode: 'focus' | 'rest' | 'break') => void;
  onAdjustMinutes?: (delta: number) => void;
  todos: TodoItem[];
  onToggleTodo: (id: string) => void;
  onAddTodo: (text: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteTodo?: (id: string) => void;
}

export const ProductivitySplitView: React.FC<ProductivitySplitViewProps> = ({
  timer,
  onToggleTimer,
  onResetTimer,
  onSelectPreset,
  todos,
  onToggleTodo,
  onAddTodo,
  onTogglePin,
  onDeleteTodo,
}) => {
  const [todoInput, setTodoInput] = useState('');

  // 1. Timer calculations
  const mins = Math.floor(timer.remainingSeconds / 60);
  const secs = Math.floor(timer.remainingSeconds % 60);
  const minsStr = mins < 10 ? `0${mins}` : `${mins}`;
  const secsStr = secs < 10 ? `0${secs}` : `${secs}`;

  const isRunning = timer.isActive && !timer.isPaused;
  const isFinished = timer.totalSeconds > 0 && timer.remainingSeconds === 0;

  // Geometry: Dial Orbit (Radius = 38px, Center = 48px, Canvas = 96px)
  const radius = 38;
  const circumference = 2 * Math.PI * radius;
  const progressPercent =
    timer.totalSeconds > 0
      ? Math.min(
          100,
          Math.max(
            0,
            ((timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds) * 100
          )
        )
      : 0;
  const strokeDashoffset = circumference - (progressPercent / 100) * circumference;

  const fraction =
    timer.totalSeconds > 0
      ? (timer.totalSeconds - timer.remainingSeconds) / timer.totalSeconds
      : 0;
  const angle = -Math.PI / 2 + fraction * (2 * Math.PI);
  const nodeX = 48 + radius * Math.cos(angle);
  const nodeY = 48 + radius * Math.sin(angle);

  // 2. To-Do state & auto-sort (pinned tasks float to top)
  const sortedTodos = [...todos].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return 0;
  });
  const completedCount = todos.filter((t) => t.completed).length;

  const handleAddSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (todoInput.trim()) {
      onAddTodo(todoInput.trim());
      setTodoInput('');
      playChimeCue('tap');
    }
  };

  return (
    <div className="w-full max-w-[660px] h-[140px] px-4 py-2.5 select-none grid grid-cols-[330px_minmax(0,1fr)] gap-3.5 items-center relative overflow-hidden bg-[#121215] border border-[#222226] rounded-2xl">
      {/* =================================================================== */}
      {/* SISI KIRI: FOCUS DIAL (~330px)                                      */}
      {/* =================================================================== */}
      <div className="flex items-center gap-3 w-full h-full border-r border-[#222226] pr-3.5 relative">
        {/* Dial Orbit Canvas (96x96) */}
        <div className="relative w-[96px] h-[96px] shrink-0 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90 overflow-visible" viewBox="0 0 96 96">
            <defs>
              <linearGradient id="orbitGrad" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#6366f1" />
                <stop offset="60%" stopColor="#818cf8" />
                <stop offset="100%" stopColor="#a5b4fc" />
              </linearGradient>
            </defs>

            {/* Base Track */}
            <circle
              cx="48"
              cy="48"
              r={radius}
              stroke="#27272a"
              strokeWidth="2.5"
              fill="none"
            />

            {/* Glowing Progress Arc */}
            <circle
              cx="48"
              cy="48"
              r={radius}
              stroke="url(#orbitGrad)"
              strokeWidth="2.5"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              strokeLinecap="round"
              fill="none"
              className="transition-all duration-300"
            />

            {/* Stardust Orbital Node */}
            {timer.totalSeconds > 0 && (
              <circle
                cx={nodeX}
                cy={nodeY}
                r="3"
                fill="#FFFFFF"
                stroke="#818cf8"
                strokeWidth="1.2"
                style={{
                  filter: 'drop-shadow(0 0 6px #818cf8)',
                }}
              />
            )}
          </svg>

          {/* Dial Center: Digital Numbers MM:SS */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <div
              className={`text-[16px] font-mono font-bold tracking-tight leading-none text-zinc-100 flex items-center tabular-nums ${
                isFinished ? 'text-indigo-300 animate-pulse' : ''
              }`}
            >
              <span>{minsStr}</span>
              <span
                className={`mx-0.5 transition-opacity ${
                  isRunning ? 'animate-pulse text-indigo-400' : 'text-zinc-500'
                }`}
              >
                :
              </span>
              <span>{secsStr}</span>
            </div>

            {/* Orbit percentage */}
            <span className="text-[8px] font-mono text-zinc-500 mt-1 tabular-nums">
              {Math.round(progressPercent)}%
            </span>
          </div>
        </div>

        {/* Controls Deck (Presets + Action Buttons) */}
        <div className="flex flex-col justify-between flex-1 min-w-0 h-full py-0.5">
          {/* Header Label: Focus Dial */}
          <div className="flex items-center justify-between w-full">
            <span className="text-[10px] font-semibold text-zinc-400 tracking-wider uppercase">
              FOCUS DIAL
            </span>
            <span className="text-[9px] font-mono text-indigo-400 uppercase tracking-tight">
              {timer.mode === 'rest' ? 'Rest Break' : 'Deep Focus'}
            </span>
          </div>

          {/* Preset Buttons (3 Columns) */}
          <div className="grid grid-cols-3 gap-1.5 w-full my-auto">
            <button
              onClick={() => {
                playChimeCue('tap');
                onSelectPreset(5, 'rest');
              }}
              className={`py-1 px-1 rounded-lg text-[10px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer border active:scale-95 ${
                timer.totalSeconds === 5 * 60 && timer.mode === 'rest'
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30 font-semibold shadow-[0_0_8px_rgba(129,140,248,0.25)]'
                  : 'bg-[#18181c] text-zinc-400 border-[#2e2e34] hover:bg-[#222226] hover:text-zinc-200'
              }`}
              title="5m Hop (Istirahat Pendek)"
            >
              <span>5m Hop</span>
            </button>

            <button
              onClick={() => {
                playChimeCue('tap');
                onSelectPreset(25, 'focus');
              }}
              className={`py-1 px-1 rounded-lg text-[10px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer border active:scale-95 ${
                timer.totalSeconds === 25 * 60 && timer.mode === 'focus'
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30 font-semibold shadow-[0_0_8px_rgba(129,140,248,0.25)]'
                  : 'bg-[#18181c] text-zinc-400 border-[#2e2e34] hover:bg-[#222226] hover:text-zinc-200'
              }`}
              title="25m Focus (Pomodoro Utama)"
            >
              <span>25m Focus</span>
            </button>

            <button
              onClick={() => {
                playChimeCue('tap');
                onSelectPreset(50, 'focus');
              }}
              className={`py-1 px-1 rounded-lg text-[10px] font-medium flex items-center justify-center gap-1 transition-all cursor-pointer border active:scale-95 ${
                timer.totalSeconds === 50 * 60 && timer.mode === 'focus'
                  ? 'bg-indigo-500/15 text-indigo-300 border-indigo-500/30 font-semibold shadow-[0_0_8px_rgba(129,140,248,0.25)]'
                  : 'bg-[#18181c] text-zinc-400 border-[#2e2e34] hover:bg-[#222226] hover:text-zinc-200'
              }`}
              title="50m Orbit (Sesi Fokus Panjang)"
            >
              <span>50m Orbit</span>
            </button>
          </div>

          {/* Action Row: Play/Pause & Reset */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                playChimeCue('tap');
                onToggleTimer();
              }}
              className="flex-1 h-7 rounded-lg bg-[#818cf8] hover:bg-[#a5b4fc] text-black font-semibold text-[11px] flex items-center justify-center gap-1.5 active:scale-95 transition-all cursor-pointer shadow-none"
              title={isRunning ? 'Jeda Orbit' : 'Mulai Orbit'}
            >
              {isRunning ? (
                <>
                  <Pause className="w-3 h-3 fill-current" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-3 h-3 fill-current ml-0.5" />
                  <span>Start</span>
                </>
              )}
            </button>

            <button
              onClick={() => {
                playChimeCue('tap');
                onResetTimer();
              }}
              className="w-7 h-7 rounded-lg bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-indigo-400 flex items-center justify-center active:scale-95 transition-all cursor-pointer shrink-0"
              title="Reset Orbit"
            >
              <RotateCcw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </div>

      {/* =================================================================== */}
      {/* SISI KANAN: TASK POCKET (minmax(0, 1fr))                           */}
      {/* =================================================================== */}
      <div className="flex flex-col justify-between w-full h-full min-w-0 py-0.5">
        {/* Task Header Bar */}
        <div className="flex items-center justify-between w-full h-[20px] pb-1 border-b border-[#222226] shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-semibold text-zinc-400 tracking-wider uppercase">
              TASKS
            </span>
            <span className="text-[9.5px] font-sans font-medium text-[#818cf8] bg-[#818cf8]/15 border border-[#818cf8]/30 px-1.5 py-0.2 rounded-full tabular-nums">
              {String(completedCount).padStart(2, '0')}/{String(todos.length).padStart(2, '0')}
            </span>
          </div>
        </div>

        {/* Scrollable Tasks List */}
        <div
          className="flex-1 overflow-y-auto max-h-[66px] my-1 pr-1.5 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-zinc-700 [&::-webkit-scrollbar-thumb]:rounded-full"
          onWheel={(e) => e.stopPropagation()}
        >
          {sortedTodos.length === 0 ? (
            <div className="text-center py-2.5 text-zinc-500 text-[10.5px]">
              Belum ada tugas aktif. Tambahkan di bawah.
            </div>
          ) : (
            sortedTodos.map((item) => (
              <div
                key={item.id}
                className={`flex items-center justify-between gap-2 py-1 px-1.5 rounded-lg transition-all group ${
                  item.isPinned
                    ? 'bg-[#818cf8]/10 border-l-2 border-[#818cf8]'
                    : 'hover:bg-[#18181c] border-l-2 border-transparent'
                }`}
              >
                {/* Checkbox & Task Text */}
                <div
                  onClick={() => {
                    onToggleTodo(item.id);
                    playChimeCue(item.completed ? 'tap' : 'ding');
                  }}
                  className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                >
                  <div
                    className={`w-4 h-4 rounded-full flex items-center justify-center shrink-0 transition-all ${
                      item.completed
                        ? 'bg-[#818cf8] border border-[#818cf8] text-[#09090b]'
                        : 'border border-zinc-600 group-hover:border-zinc-400 bg-[#18181c]'
                    }`}
                  >
                    {item.completed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </div>

                  <span
                    className={`font-sans text-xs truncate transition-all ${
                      item.completed
                        ? 'line-through text-zinc-500'
                        : 'text-zinc-200 group-hover:text-white font-medium'
                    }`}
                  >
                    {item.text}
                  </span>
                </div>

                {/* Pin & Dismiss Actions */}
                <div className="flex items-center gap-1 shrink-0">
                  <CosmicCarrotPin
                    isPinned={Boolean(item.isPinned)}
                    onClick={() => {
                      onTogglePin(item.id);
                      playChimeCue('tap');
                    }}
                  />

                  {onDeleteTodo && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onDeleteTodo(item.id);
                        playChimeCue('tap');
                      }}
                      className="w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-rose-400 hover:bg-rose-500/15 opacity-0 group-hover:opacity-100 transition-all cursor-pointer"
                      title="Hapus Tugas"
                      aria-label="Hapus Tugas"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Quick Add Task Input Bar */}
        <form onSubmit={handleAddSubmit} className="flex items-center gap-1.5 w-full mt-auto">
          <input
            type="text"
            value={todoInput}
            onChange={(e) => setTodoInput(e.target.value)}
            placeholder="Tambah tugas baru... (Enter)"
            className="flex-1 h-[22px] px-2 rounded-lg bg-[#18181c] border border-[#2e2e34] focus:border-[#818cf8] focus:outline-none text-[10.5px] text-zinc-200 placeholder-zinc-500"
          />
          <button
            type="submit"
            className="w-[22px] h-[22px] rounded-lg bg-[#18181c] hover:bg-[#818cf8]/15 border border-[#2e2e34] hover:border-[#818cf8]/30 text-zinc-400 hover:text-[#818cf8] flex items-center justify-center active:scale-95 transition-all cursor-pointer shrink-0"
            title="Tambah Tugas"
          >
            <Plus className="w-3 h-3" />
          </button>
        </form>
      </div>
    </div>
  );
};
