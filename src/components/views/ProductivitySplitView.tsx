import React, { useState, useRef, useMemo } from 'react';
import { Play, Pause, RotateCcw, Check, Plus, X, Pin, Clock, BellRing } from 'lucide-react';
import { TimerState, TodoItem } from '../../types/island';
import { playChimeCue, focusIslandWindow } from '../../utils/tauriBridge';
import { unlockAlarmAudio } from '../../utils/alarmChime';
import { useTimerState } from '../../features/timer/useTimerState';
import {
  computeRemainingSecondsUntil,
  formatDurationClock,
  formatDurationEstimate,
  MAX_TIMER_MINUTES,
} from '../../features/timer/timerUtils';

export interface ProductivitySplitViewProps {
  timer: TimerState;
  onToggleTimer: () => void;
  onResetTimer: () => void;
  onSelectPreset: (minutes: number, mode: 'focus' | 'rest' | 'break') => void;
  onAdjustMinutes?: (delta: number) => void;
  onSetCustomMinutes?: (minutes: number) => void;
  onAddFiveMinutes?: () => void;
  onDismissAlarm?: () => void;
  focusedTaskId?: string | null;
  onFocusTask?: (id: string, scheduledTime?: string) => void;
  todos: TodoItem[];
  onToggleTodo: (id: string) => void;
  onAddTodo: (text: string, scheduledTime?: string) => void;
  onSetTodoTime?: (id: string, scheduledTime?: string) => void;
  onTogglePin: (id: string) => void;
  onDeleteTodo?: (id: string) => void;
  onOpenMusic?: () => void;
}

function normalizeTimeInput(raw: string): string | undefined {
  const cleaned = raw.trim().replace(/[^0-9:]/g, '');
  if (!cleaned) return undefined;

  let hh = 0;
  let mm = 0;

  if (cleaned.includes(':')) {
    const [hStr, mStr = '0'] = cleaned.split(':');
    hh = parseInt(hStr || '0', 10);
    mm = parseInt(mStr.slice(0, 2) || '0', 10);
  } else if (cleaned.length <= 2) {
    hh = parseInt(cleaned, 10);
    mm = 0;
  } else if (cleaned.length === 3) {
    hh = parseInt(cleaned.slice(0, 1), 10);
    mm = parseInt(cleaned.slice(1, 3), 10);
  } else {
    hh = parseInt(cleaned.slice(0, 2), 10);
    mm = parseInt(cleaned.slice(2, 4), 10);
  }

  if (Number.isNaN(hh) || Number.isNaN(mm)) return undefined;
  hh = Math.max(0, Math.min(23, hh));
  mm = Math.max(0, Math.min(59, mm));
  return `${hh.toString().padStart(2, '0')}:${mm.toString().padStart(2, '0')}`;
}

export const ProductivitySplitView: React.FC<ProductivitySplitViewProps> = ({
  timer,
  onToggleTimer,
  onResetTimer,
  onSelectPreset,
  onAdjustMinutes,
  onSetCustomMinutes,
  onAddFiveMinutes,
  onDismissAlarm,
  focusedTaskId: propFocusedTaskId,
  onFocusTask,
  todos,
  onToggleTodo,
  onAddTodo,
  onSetTodoTime,
  onTogglePin,
  onDeleteTodo,
}) => {
  const { addFiveMinutes: storeAddFiveMinutes, dismissAlarm: storeDismissAlarm } =
    useTimerState();
  const handleAddFiveMinutes = onAddFiveMinutes ?? storeAddFiveMinutes;
  const handleDismissAlarm = onDismissAlarm ?? storeDismissAlarm;
  const isAlarmRinging = Boolean(timer.isAlarmRinging);
  const effectiveFocusedTaskId =
    propFocusedTaskId !== undefined ? propFocusedTaskId : timer.focusedTaskId ?? null;
  const [todoInput, setTodoInput] = useState('');
  const [newTaskTime, setNewTaskTime] = useState('');
  const [editingTimeId, setEditingTimeId] = useState<string | null>(null);
  const [editingTimeVal, setEditingTimeVal] = useState('');

  const [isEditingMinutes, setIsEditingMinutes] = useState(false);
  const [customMinsInput, setCustomMinsInput] = useState('');
  const [hoverNowMs, setHoverNowMs] = useState<number>(() => Date.now());
  const minsInputRef = useRef<HTMLInputElement>(null);

  const formattedRemaining = formatDurationClock(timer.remainingSeconds);
  const isLongDuration = timer.remainingSeconds >= 3600;
  const isRunning = timer.isActive && !timer.isPaused;
  const isFinished = timer.totalSeconds > 0 && timer.remainingSeconds === 0;
  const elapsedSeconds = Math.max(0, timer.totalSeconds - timer.remainingSeconds);
  const showProgressPercent = isRunning || elapsedSeconds > 0;

  // Compact Progress Ring Geometry (74x74)
  const size = 74;
  const center = size / 2;
  const radius = 30;
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

  const endClockLabel = useMemo(() => {
    const endDate = new Date(Date.now() + Math.max(0, timer.remainingSeconds) * 1000);
    return `${endDate.getHours().toString().padStart(2, '0')}:${endDate
      .getMinutes()
      .toString()
      .padStart(2, '0')}`;
  }, [timer.remainingSeconds]);

  const activeFocusTask = useMemo(() => {
    if (effectiveFocusedTaskId) {
      const byFocus = todos.find((t) => !t.completed && t.id === effectiveFocusedTaskId);
      if (byFocus) return byFocus;
    }
    return todos.find((t) => !t.completed && t.isPinned) || null;
  }, [todos, effectiveFocusedTaskId]);

  const openCustomMinutesEditor = (e: React.MouseEvent) => {
    e.stopPropagation();
    playChimeCue('tap');
    const currentTotalMins = Math.max(1, Math.round(timer.totalSeconds / 60));
    setCustomMinsInput(String(currentTotalMins));
    setIsEditingMinutes(true);
    setTimeout(() => {
      void focusIslandWindow();
      minsInputRef.current?.focus();
      minsInputRef.current?.select();
    }, 25);
  };

  const commitCustomMinutes = () => {
    const parsed = parseInt(customMinsInput.trim(), 10);
    if (!isNaN(parsed) && parsed > 0 && onSetCustomMinutes) {
      onSetCustomMinutes(parsed);
      playChimeCue('ding');
    }
    setIsEditingMinutes(false);
  };

  // Sort: incomplete pinned -> incomplete timed -> incomplete regular -> completed bottom
  const sortedTodos = useMemo(() => {
    return [...todos].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1;
      if (a.isPinned && !b.isPinned) return -1;
      if (!a.isPinned && b.isPinned) return 1;
      if (a.scheduledTime && b.scheduledTime) {
        return a.scheduledTime.localeCompare(b.scheduledTime);
      }
      if (a.scheduledTime && !b.scheduledTime) return -1;
      if (!a.scheduledTime && b.scheduledTime) return 1;
      return 0;
    });
  }, [todos]);

  const completedCount = todos.filter((t) => t.completed).length;

  const handleAddSubmit = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!todoInput.trim()) return;
    const normalizedTime = normalizeTimeInput(newTaskTime);
    onAddTodo(todoInput.trim(), normalizedTime);
    setTodoInput('');
    setNewTaskTime('');
    playChimeCue('tap');
  };

  const openTaskTimeEditor = (todo: TodoItem, e: React.MouseEvent) => {
    e.stopPropagation();
    playChimeCue('tap');
    setEditingTimeId(todo.id);
    setEditingTimeVal(todo.scheduledTime || '');
    setTimeout(() => {
      void focusIslandWindow();
    }, 20);
  };

  const commitTaskTime = (id: string) => {
    if (onSetTodoTime) {
      const normalized = normalizeTimeInput(editingTimeVal);
      onSetTodoTime(id, normalized);
    }
    setEditingTimeId(null);
  };

  return (
    <div
      data-tauri-drag-region="false"
      className="w-full h-full min-h-0 bg-[#000000] px-4 pt-1.5 pb-2.5 select-none grid grid-cols-2 grid-rows-[minmax(0,1fr)] gap-4 items-stretch relative overflow-hidden"
    >
      {/* SISI KIRI (274px × 135px): HORIZONTAL COMPACT INTERACTIVE TIMER */}
      <div className="flex flex-col justify-between h-full min-h-0 min-w-0 border-r border-white/[0.08] pr-4">
        {/* Top Row: Pure Timer vs Explicitly Focused Task + Finish Time */}
        <div className="flex items-center justify-between gap-2 h-4 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0">
            <span
              style={{
                backgroundColor:
                  timer.mode === 'rest'
                    ? 'var(--casa-rest, #10B981)'
                    : 'var(--casa-timer, #F59E0B)',
                boxShadow: isRunning
                  ? '0 0 6px var(--casa-timer-glow, rgba(245,158,11,0.65))'
                  : undefined,
                opacity: isRunning ? 1 : timer.isActive ? 0.85 : 0.7,
              }}
              className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                isRunning ? 'animate-pulse' : ''
              }`}
            />
            <span className="text-[10px] font-medium text-white/65 truncate">
              {activeFocusTask
                ? activeFocusTask.text
                : timer.mode === 'focus'
                ? 'Focus Timer'
                : 'Break Timer'}
            </span>
            {activeFocusTask && (activeFocusTask.isPinned || onFocusTask) && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playChimeCue('tap');
                  if (activeFocusTask.isPinned) {
                    onTogglePin(activeFocusTask.id);
                  } else {
                    onFocusTask?.(activeFocusTask.id);
                  }
                }}
                title="Lepas sematan tugas (kembali ke timer murni)"
                className="text-white/40 hover:text-white cursor-pointer shrink-0"
              >
                <X className="w-2.5 h-2.5" />
              </button>
            )}
          </div>
          {showProgressPercent && (
            <span
              style={{
                color:
                  timer.mode === 'rest'
                    ? 'var(--casa-rest, #10B981)'
                    : 'var(--casa-timer, #F59E0B)',
              }}
              className="text-[9px] font-mono tabular-nums shrink-0 opacity-85"
            >
              {timer.isActive
                ? `${Math.round(progressPercent)}% · ends ${endClockLabel}`
                : `${Math.round(progressPercent)}%`}
            </span>
          )}
        </div>

        {/* Main Horizontal Split inside Timer Pane or Time's Up Alarm Banner */}
        {isAlarmRinging ? (
          <div
            style={{
              borderColor: 'var(--casa-timer, #F59E0B)',
              boxShadow: '0 0 18px var(--casa-timer-glow, rgba(245,158,11,0.3))',
            }}
            className="my-auto flex flex-col justify-between gap-2 rounded-xl bg-[#000000] border px-3 py-2.5"
          >
            <div className="flex items-center gap-2 min-w-0">
              <BellRing
                className="w-4 h-4 animate-pulse shrink-0"
                style={{ color: 'var(--casa-timer, #F59E0B)' }}
              />
              <div className="min-w-0 flex-1">
                <div
                  className="text-[11.5px] font-bold leading-tight"
                  style={{ color: 'var(--casa-timer, #F59E0B)' }}
                >
                  Time&apos;s Up!
                </div>
                <div className="text-[10px] font-medium text-white/85 truncate leading-tight mt-0.5">
                  {activeFocusTask ? activeFocusTask.text : 'Focus Session Complete'}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  unlockAlarmAudio();
                  handleAddFiveMinutes();
                }}
                style={{ backgroundColor: 'var(--casa-timer, #F59E0B)' }}
                className="flex-1 h-[24px] px-2.5 rounded-full hover:brightness-110 text-black text-[10px] font-bold transition-all cursor-pointer active:scale-95"
              >
                +5m
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDismissAlarm();
                }}
                className="flex-1 h-[24px] px-2.5 rounded-full bg-white/[0.10] hover:bg-white/[0.20] border border-white/15 text-white text-[10px] font-semibold transition-colors cursor-pointer active:scale-95"
              >
                Dismiss
              </button>
            </div>
          </div>
        ) : (
        <div className="flex items-center gap-3.5 my-auto">
          {/* Interactive Progress Ring Left */}
          <div
            onWheel={(e) => {
              if (!timer.isActive && onAdjustMinutes) {
                e.stopPropagation();
                onAdjustMinutes(e.deltaY < 0 ? 1 : -1);
              }
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (!isRunning) unlockAlarmAudio();
              playChimeCue('tap');
              onToggleTimer();
            }}
            title={
              timer.isActive
                ? 'Klik cincin untuk Pause/Resume'
                : 'Klik cincin untuk mulai · Scroll ±1m'
            }
            className="relative w-[74px] h-[74px] shrink-0 flex items-center justify-center cursor-pointer group"
          >
            <svg
              className="w-full h-full -rotate-90 pointer-events-none"
              viewBox={`0 0 ${size} ${size}`}
              aria-hidden="true"
            >
              <circle
                cx={center}
                cy={center}
                r={radius}
                stroke="rgba(255,255,255,0.10)"
                strokeWidth="4.5"
                fill="none"
              />
              <circle
                cx={center}
                cy={center}
                r={radius}
                stroke={
                  timer.mode === 'focus'
                    ? 'var(--casa-timer, #F59E0B)'
                    : 'var(--casa-rest, #10B981)'
                }
                strokeWidth="4.5"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="none"
                className="transition-all duration-300 ease-out"
              />
            </svg>

            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              {showProgressPercent && (
                <span
                  style={{
                    color:
                      timer.mode === 'rest'
                        ? 'var(--casa-rest, #10B981)'
                        : 'var(--casa-timer, #F59E0B)',
                  }}
                  className="text-[11px] font-bold tabular-nums group-hover:scale-105 transition-transform"
                >
                  {Math.round(progressPercent)}%
                </span>
              )}
              <span
                className={`${
                  showProgressPercent ? 'text-[8px]' : 'text-[9.5px]'
                } uppercase tracking-widest text-white/50 font-semibold`}
              >
                {timer.mode === 'focus' ? 'Focus' : 'Rest'}
              </span>
            </div>
          </div>

          {/* Right Side: Clickable Custom Duration + Presets + Compact Controls */}
          <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
            {/* Clickable Time Readout -> Inline Custom Minute Editor */}
            {isEditingMinutes ? (
              <div
                className="flex items-center gap-1.5"
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  ref={minsInputRef}
                  type="number"
                  min={1}
                  max={MAX_TIMER_MINUTES}
                  value={customMinsInput}
                  onChange={(e) => setCustomMinsInput(e.target.value)}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitCustomMinutes();
                    } else if (e.key === 'Escape') {
                      e.preventDefault();
                      setIsEditingMinutes(false);
                    }
                  }}
                  onBlur={commitCustomMinutes}
                  aria-label="Custom focus minutes"
                  className="w-16 h-7 text-[20px] font-bold font-sans tracking-tight tabular-nums text-center text-white bg-white/[0.10] border border-white/25 rounded-lg outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                />
                <span className="text-[11px] text-white/55 font-medium">min</span>
              </div>
            ) : (
              <button
                type="button"
                onClick={openCustomMinutesEditor}
                title={`Klik angka untuk atur durasi menit bebas (1–${MAX_TIMER_MINUTES} menit)`}
                className="text-left w-fit px-1.5 -mx-1.5 rounded-md hover:bg-white/[0.08] transition-colors cursor-text group"
              >
                <span
                  style={isFinished ? { color: 'var(--casa-rest, #10B981)' } : undefined}
                  className={`font-sans leading-none font-bold tracking-tight tabular-nums ${
                    isLongDuration ? 'text-[21px]' : 'text-[24px]'
                  } ${isFinished ? 'animate-pulse' : 'text-white'}`}
                >
                  {formattedRemaining}
                </span>
              </button>
            )}

            {/* Compact Preset Chips (5m / 25m / 50m) */}
            <div className="flex items-center gap-1">
              {[
                { label: '5m', mins: 5, mode: 'rest' as const },
                { label: '25m', mins: 25, mode: 'focus' as const },
                { label: '50m', mins: 50, mode: 'focus' as const },
              ].map((preset) => {
                const isSelected =
                  Math.round(timer.totalSeconds / 60) === preset.mins &&
                  timer.mode === preset.mode;
                return (
                  <button
                    key={preset.label}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      unlockAlarmAudio();
                      playChimeCue('tap');
                      onSelectPreset(preset.mins, preset.mode);
                    }}
                    className={`h-[19px] px-2 rounded-full text-[9.5px] font-medium tabular-nums transition-all cursor-pointer active:scale-95 border ${
                      isSelected
                        ? 'bg-white/[0.16] border-white/25 text-white'
                        : 'bg-[#0d0d10] border-white/[0.08] text-white/55 hover:text-white hover:bg-white/[0.08]'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Compact Icon+Label Action Row (No Giant White Block) */}
            <div className="flex items-center gap-1.5 pt-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (!isRunning) unlockAlarmAudio();
                  playChimeCue('tap');
                  onToggleTimer();
                }}
                className={`h-[25px] px-2.5 rounded-full text-[10px] font-semibold inline-flex items-center gap-1.5 transition-all cursor-pointer active:scale-95 border ${
                  isRunning
                    ? 'bg-white/[0.14] border-white/20 text-white hover:bg-white/[0.20]'
                    : 'bg-white text-black border-white hover:bg-white/90'
                }`}
              >
                {isRunning ? (
                  <>
                    <Pause className="w-2.5 h-2.5 fill-current" />
                    <span>Pause</span>
                  </>
                ) : (
                  <>
                    <Play className="w-2.5 h-2.5 fill-current" />
                    <span>{timer.isActive ? 'Resume' : 'Start'}</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playChimeCue('tap');
                  onResetTimer();
                }}
                className="h-[25px] px-2.5 rounded-full bg-[#0d0d10] hover:bg-white/[0.10] border border-white/[0.10] text-white/65 hover:text-white text-[10px] font-medium inline-flex items-center gap-1 transition-all cursor-pointer active:scale-95"
                title="Reset Timer"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Reset</span>
              </button>
            </div>
          </div>
        </div>
        )}
      </div>

      {/* SISI KANAN (274px × 135px): TIME-BLOCKING PLANNER & CHECKLIST */}
      <div className="flex flex-col h-full min-h-0 min-w-0 justify-between">
        {/* Top Row: Time-Block Header */}
        <div className="flex items-center justify-between h-4 mb-1 shrink-0">
          <span className="text-[10px] font-semibold text-white/75 tracking-tight">
            Time-Blocking &amp; Tasks
          </span>
          <span className="text-[9px] font-mono tabular-nums px-1.5 py-[1px] rounded-full bg-white/[0.08] text-white/60">
            {completedCount}/{todos.length}
          </span>
        </div>

        {/* Scrollable Tasks Container (isolated wheel scroll + clean space above rounded-b-[22px]) */}
        <div
          onWheel={(e) => e.stopPropagation()}
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain pr-1 space-y-1 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-white/25 [&::-webkit-scrollbar-thumb]:rounded-full"
        >
          {sortedTodos.length === 0 ? (
            <div className="h-full flex items-center justify-center text-[10px] text-white/35">
              Belum ada tugas fokus
            </div>
          ) : (
            sortedTodos.map((todo) => {
              const isEditingThisTime = editingTimeId === todo.id;
              const isPinnedActive =
                !todo.completed && (Boolean(todo.isPinned) || effectiveFocusedTaskId === todo.id);
              const autoDurationSecs =
                !todo.completed && todo.scheduledTime
                  ? computeRemainingSecondsUntil(todo.scheduledTime, new Date(hoverNowMs))
                  : null;
              const pinButtonTitle = todo.isPinned
                ? 'Lepas sematan tugas'
                : autoDurationSecs !== null
                ? `Sematkan & fokus hingga ${todo.scheduledTime} (${formatDurationEstimate(autoDurationSecs)})`
                : 'Sematkan tugas ini ke timer';
              return (
                <div
                  key={todo.id}
                  onMouseEnter={() => {
                    if (todo.scheduledTime) {
                      setHoverNowMs(Date.now());
                    }
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleTodo(todo.id);
                    playChimeCue('tap');
                  }}
                  style={
                    !todo.completed && isPinnedActive
                      ? { borderColor: 'var(--casa-timer, #F59E0B)' }
                      : undefined
                  }
                  className={`group h-[23px] px-1.5 rounded-lg flex items-center gap-1.5 cursor-pointer transition-colors ${
                    todo.completed
                      ? 'bg-transparent opacity-45 hover:opacity-70'
                      : isPinnedActive
                      ? 'bg-white/[0.08] border'
                      : 'bg-white/[0.03] border border-transparent hover:bg-white/[0.07]'
                  }`}
                >
                  {/* Round Check */}
                  <span
                    className={`w-3.5 h-3.5 rounded-full flex items-center justify-center shrink-0 border transition-colors ${
                      todo.completed
                        ? 'bg-white border-white text-black'
                        : 'border-white/30 group-hover:border-white/60'
                    }`}
                  >
                    {todo.completed && <Check className="w-2.5 h-2.5 stroke-[3]" />}
                  </span>

                  {/* Time-Block Badge / Inline Time Editor */}
                  {isEditingThisTime ? (
                    <input
                      type="text"
                      maxLength={5}
                      autoFocus
                      placeholder="23:00"
                      title="Target Selesai (Until HH:MM) — contoh: 23:00"
                      value={editingTimeVal}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => setEditingTimeVal(e.target.value)}
                      onBlur={() => commitTaskTime(todo.id)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          commitTaskTime(todo.id);
                        } else if (e.key === 'Escape') {
                          e.preventDefault();
                          setEditingTimeId(null);
                        }
                      }}
                      className="w-[38px] h-[16px] px-1 rounded text-[9px] font-mono tabular-nums bg-white/[0.15] border border-white/30 text-white outline-none shrink-0"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => openTaskTimeEditor(todo, e)}
                      title={
                        todo.scheduledTime
                          ? `Target Selesai: Until ${todo.scheduledTime} (klik untuk ubah)`
                          : 'Atur Target Selesai (Until HH:MM)'
                      }
                      className={`h-[16px] px-1 rounded text-[8.5px] font-mono tabular-nums inline-flex items-center gap-0.5 shrink-0 transition-all cursor-pointer ${
                        todo.scheduledTime
                          ? 'bg-white/[0.10] text-white/80 hover:bg-white/[0.18]'
                          : 'text-white/25 hover:text-white/75 opacity-0 group-hover:opacity-100'
                      }`}
                    >
                      {todo.scheduledTime ? (
                        <>
                          <span className="font-sans text-[7.5px] text-white/45">until</span>
                          <span>{todo.scheduledTime}</span>
                        </>
                      ) : (
                        <Clock className="w-2.5 h-2.5" />
                      )}
                    </button>
                  )}

                  {/* Task Text */}
                  <span
                    className={`flex-1 min-w-0 truncate text-[10.5px] leading-none tracking-tight ${
                      todo.completed ? 'line-through text-white/45' : 'text-white/90'
                    }`}
                    title={todo.text}
                  >
                    {todo.text}
                  </span>

                  {/* Pin & Delete Micro Buttons */}
                  <div
                    className={`flex items-center gap-0.5 shrink-0 transition-opacity ${
                      isPinnedActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                    }`}
                  >
                    {!todo.completed && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onTogglePin(todo.id);
                          playChimeCue('tap');
                        }}
                        title={pinButtonTitle}
                        style={
                          isPinnedActive
                            ? {
                                color: 'var(--casa-timer, #F59E0B)',
                                borderColor: 'var(--casa-timer, #F59E0B)',
                                backgroundColor: 'var(--casa-timer-glow, rgba(245,158,11,0.15))',
                              }
                            : undefined
                        }
                        className={`p-0.5 rounded border cursor-pointer transition-colors ${
                          isPinnedActive
                            ? ''
                            : 'border-transparent text-white/45 hover:text-white hover:bg-white/[0.10]'
                        }`}
                      >
                        <Pin className="w-2.5 h-2.5" />
                      </button>
                    )}
                    {onDeleteTodo && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onDeleteTodo(todo.id);
                          playChimeCue('tap');
                        }}
                        title="Hapus tugas"
                        className="p-0.5 rounded text-white/40 hover:text-[var(--casa-danger)] hover:bg-white/[0.10] cursor-pointer"
                      >
                        <X className="w-2.5 h-2.5" />
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Sticky Bottom Add Task Bar + Optional Quick Schedule Time (Safely Clear of rounded-b-[22px]) */}
        <form
          onSubmit={handleAddSubmit}
          onClick={(e) => e.stopPropagation()}
          className="h-[25px] shrink-0 mt-1 px-2 rounded-lg bg-[#0d0d10] border border-white/[0.10] focus-within:border-white/25 flex items-center gap-1.5"
        >
          <input
            type="text"
            value={todoInput}
            onFocus={() => {
              void focusIslandWindow();
            }}
            onChange={(e) => setTodoInput(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="+ Add a task..."
            className="flex-1 min-w-0 bg-transparent text-[10.5px] text-white placeholder-white/35 outline-none"
          />
          <input
            type="text"
            maxLength={5}
            value={newTaskTime}
            onFocus={() => {
              void focusIslandWindow();
            }}
            onChange={(e) => setNewTaskTime(e.target.value)}
            onKeyDown={(e) => e.stopPropagation()}
            placeholder="HH:MM"
            title="Target Selesai (Until HH:MM) — contoh: 23:00. Durasi fokus otomatis dihitung hingga jam ini."
            className="w-[38px] bg-white/[0.05] focus:bg-white/[0.10] rounded px-1 py-0.5 text-[9px] font-mono tabular-nums text-white/80 placeholder-white/25 text-center outline-none shrink-0"
          />
          <button
            type="submit"
            disabled={!todoInput.trim()}
            aria-label="Tambah tugas"
            className={`w-4 h-4 rounded-md flex items-center justify-center shrink-0 transition-all ${
              todoInput.trim()
                ? 'bg-white text-black hover:bg-white/90 cursor-pointer active:scale-90'
                : 'bg-white/[0.08] text-white/25 cursor-not-allowed'
            }`}
          >
            <Plus className="w-2.5 h-2.5 stroke-[2.5]" />
          </button>
        </form>
      </div>
    </div>
  );
};
