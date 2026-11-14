/**
 * Shared timer formatting and time-blocking duration calculation helpers.
 */

export const MAX_TIMER_MINUTES = 1440; // 24 jam batas maksimal input durasi timer kustom & time-blocking

export function stopAndResetTimerState<
  T extends {
    isActive: boolean;
    isPaused: boolean;
    totalSeconds: number;
    remainingSeconds: number;
    focusedTaskId?: string | null;
  }
>(prev: T): T {
  return {
    ...prev,
    isActive: false,
    isPaused: false,
    focusedTaskId: null,
    remainingSeconds: prev.totalSeconds,
  };
}

export function formatDurationClock(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const hours = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;

  if (hours > 0) {
    return `${hours}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function formatDurationEstimate(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  if (safe < 60) {
    return `${safe}s`;
  }
  const totalMinutes = Math.max(1, Math.round(safe / 60));
  if (totalMinutes >= 60) {
    const hrs = Math.floor(totalMinutes / 60);
    const remMins = totalMinutes % 60;
    return remMins > 0 ? `${hrs}h ${remMins}m` : `${hrs}h`;
  }
  return `${totalMinutes}m`;
}

export function formatCompactRingDuration(remainingSeconds: number): string {
  const safe = Math.max(0, Math.floor(remainingSeconds));
  const totalMinutes = Math.ceil(safe / 60);
  if (totalMinutes >= 60) {
    const hours = totalMinutes / 60;
    return Number.isInteger(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  return `${totalMinutes}m`;
}

/**
 * Computes positive remaining seconds from `now` until the next occurrence of `HH:MM`.
 * If `HH:MM` on today's date has already passed (`diffMs <= 0`), rolls over +1 day (+86,400,000 ms)
 * so any valid `HH:MM` always yields the duration to its nearest upcoming occurrence (up to 24h).
 */
export function computeRemainingSecondsUntil(
  scheduledTime?: string | null,
  now: Date = new Date()
): number | null {
  if (!scheduledTime) return null;
  const match = scheduledTime.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;

  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (
    Number.isNaN(hours) ||
    Number.isNaN(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }

  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);

  let diffMs = target.getTime() - now.getTime();
  if (diffMs <= 0) {
    diffMs += 86_400_000;
  }

  const diffSeconds = Math.ceil(diffMs / 1000);
  return diffSeconds > 0 ? diffSeconds : null;
}
