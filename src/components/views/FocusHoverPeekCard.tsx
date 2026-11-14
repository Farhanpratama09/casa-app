import React, { useMemo } from 'react';
import { Check, Pause, Play, Clock } from 'lucide-react';
import { TimerState, TodoItem } from '../../types/island';
import { playChimeCue } from '../../utils/tauriBridge';
import { formatCompactRingDuration, formatDurationClock } from '../../features/timer/timerUtils';

export interface FocusHoverPeekCardProps {
  timer: TimerState;
  todos: TodoItem[];
  onToggleTimer: () => void;
  onCompleteTask: (todoId: string) => void;
  onStopTimer?: () => void;
  onLockExpanded: () => void;
}

function formatFinishClock(remainingSeconds: number): string {
  const endDate = new Date(Date.now() + Math.max(0, remainingSeconds) * 1000);
  const hh = endDate.getHours().toString().padStart(2, '0');
  const mm = endDate.getMinutes().toString().padStart(2, '0');
  return `${hh}:${mm}`;
}

export const FocusHoverPeekCard: React.FC<FocusHoverPeekCardProps> = ({
  timer,
  todos,
  onToggleTimer,
  onCompleteTask,
  onStopTimer,
  onLockExpanded,
}) => {
  const { activeTask, nextScheduledTask } = useMemo(() => {
    const pending = todos.filter((t) => !t.completed);
    const active =
      (timer.focusedTaskId
        ? pending.find((t) => t.id === timer.focusedTaskId) || null
        : null) ||
      pending.find((t) => t.isPinned) ||
      null;
    const remaining = pending.filter((t) => t.id !== active?.id);
    const withSchedule = remaining
      .filter((t) => !!t.scheduledTime)
      .sort((a, b) => (a.scheduledTime || '').localeCompare(b.scheduledTime || ''));
    const next = withSchedule[0] || remaining[0] || null;
    return { activeTask: active, nextScheduledTask: next };
  }, [todos, timer.focusedTaskId]);

  const progress =
    timer.totalSeconds > 0
      ? Math.max(0, Math.min(1, 1 - timer.remainingSeconds / timer.totalSeconds))
      : 0;
  const radius = 14;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - progress);
  const finishClock = formatFinishClock(timer.remainingSeconds);

  return (
    <div
      data-focus-peek-card="true"
      onClick={(e) => {
        e.stopPropagation();
        onLockExpanded();
      }}
      className="w-full h-full px-3.5 py-2.5 flex items-center justify-between gap-3 bg-[#000000] text-white select-none cursor-pointer"
    >
      {/* Left: Micro Ring + Active Focus Task + Ends HH:MM + Next Task */}
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div className="relative w-9 h-9 flex items-center justify-center shrink-0">
          <svg className="w-9 h-9 -rotate-90" viewBox="0 0 36 36">
            <circle
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              stroke="rgba(255,255,255,0.12)"
              strokeWidth="2.5"
            />
            <circle
              cx="18"
              cy="18"
              r={radius}
              fill="none"
              stroke={
                timer.mode === 'focus'
                  ? 'var(--casa-timer, #F59E0B)'
                  : 'var(--casa-rest, #10B981)'
              }
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={strokeDashoffset}
              className="transition-all duration-300"
            />
          </svg>
          <span className="text-[9px] font-semibold tabular-nums text-white/85">
            {formatCompactRingDuration(timer.remainingSeconds)}
          </span>
        </div>

        <div className="min-w-0 flex-1 flex flex-col justify-center">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-[12px] font-semibold tracking-tight text-white truncate">
              {activeTask ? activeTask.text : timer.mode === 'focus' ? 'Deep Focus' : 'Short Break'}
            </span>
            <span className="text-[11px] font-medium tabular-nums text-white/90 shrink-0">
              {formatDurationClock(timer.remainingSeconds)}
            </span>
          </div>

          <div className="flex items-center gap-2 mt-0.5 text-[10px] text-white/55 min-w-0">
            <span className="inline-flex items-center gap-1 shrink-0 text-white/75">
              <Clock className="w-2.5 h-2.5 text-white/60" />
              ends {finishClock}
            </span>
            {nextScheduledTask && (
              <>
                <span className="text-white/25">·</span>
                <span className="truncate">
                  Next:{' '}
                  {nextScheduledTask.scheduledTime ? `${nextScheduledTask.scheduledTime} ` : ''}
                  {nextScheduledTask.text}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Right: Quick Pause & Done Action Pills */}
      <div
        className="flex items-center gap-1.5 shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => {
            playChimeCue('tap');
            onToggleTimer();
          }}
          className="h-7 px-2.5 rounded-full bg-white/[0.10] hover:bg-white/[0.18] border border-white/[0.12] text-white text-[10.5px] font-medium inline-flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
          title={timer.isPaused ? 'Lanjutkan fokus' : 'Jeda fokus'}
        >
          {timer.isPaused ? (
            <>
              <Play className="w-2.5 h-2.5 fill-current" />
              <span>Resume</span>
            </>
          ) : (
            <>
              <Pause className="w-2.5 h-2.5 fill-current" />
              <span>Pause</span>
            </>
          )}
        </button>

        {activeTask && (
          <button
            type="button"
            onClick={() => {
              playChimeCue('ding');
              onCompleteTask(activeTask.id);
              onStopTimer?.();
            }}
            className="h-7 px-2.5 rounded-full bg-white text-black hover:bg-white/90 text-[10.5px] font-semibold inline-flex items-center gap-1 transition-all active:scale-95 cursor-pointer"
            title="Tandai tugas aktif selesai & reset timer"
          >
            <Check className="w-2.5 h-2.5 stroke-[2.5]" />
            <span>Done</span>
          </button>
        )}
      </div>
    </div>
  );
};
