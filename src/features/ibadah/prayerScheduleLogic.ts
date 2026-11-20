/**
 * prayerScheduleLogic.ts
 * Pure, framework-agnostic decision helpers for prayer T-0 triggering & deduplication.
 */

export const PRAYER_WAKE_GRACE_MS = 5 * 60 * 1000; // 5 minutes for live tick / sleep-wake catch-up
export const PRAYER_COLD_BOOT_GRACE_MS = 65 * 1000; // Full current minute (60s) + IPC margin

export function buildPrayerFireKey(
  dateKey: string,
  prayerId: string,
  scheduledTimestampMs: number
): string {
  const scheduledMinuteEpoch = Math.floor(scheduledTimestampMs / 60_000);
  return `${dateKey}:${prayerId}:${scheduledMinuteEpoch}`;
}

export function isScopedPrayerFireKey(key: string): boolean {
  const parts = key.split(':');
  return parts.length === 3 && /^\d+$/.test(parts[2]);
}

export function pruneFiredPrayerMap(
  raw: unknown,
  nowMs: number,
  retentionMs = 48 * 3600 * 1000
): Record<string, number> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  const cutoff = nowMs - retentionMs;
  const pruned: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw as Record<string, unknown>)) {
    if (
      isScopedPrayerFireKey(key) &&
      typeof val === 'number' &&
      Number.isFinite(val) &&
      val >= cutoff
    ) {
      pruned[key] = val;
    }
  }
  return pruned;
}

export interface DuePrayerDecisionInput {
  mostRecentPrayerId: string;
  mostRecentPrayerDateKey: string;
  mostRecentPrayerTimestampMs: number;
  nowMs: number;
  lastTickWallClockMs: number | null;
  firedMap: Record<string, number>;
}

export type DuePrayerAction = 'future' | 'already_fired' | 'trigger' | 'suppress_stale';

export interface DuePrayerDecision {
  action: DuePrayerAction;
  fireKey: string;
  elapsedMs: number;
  allowedGraceMs: number;
}

export function evaluateDuePrayerDecision(
  input: DuePrayerDecisionInput
): DuePrayerDecision {
  const recentTs = input.mostRecentPrayerTimestampMs;
  const fireKey = buildPrayerFireKey(
    input.mostRecentPrayerDateKey,
    input.mostRecentPrayerId,
    recentTs
  );
  const elapsedMs = input.nowMs - recentTs;

  if (elapsedMs < 0) {
    return {
      action: 'future',
      fireKey,
      elapsedMs,
      allowedGraceMs: 0,
    };
  }

  if (typeof input.firedMap[fireKey] === 'number') {
    return {
      action: 'already_fired',
      fireKey,
      elapsedMs,
      allowedGraceMs: 0,
    };
  }

  const crossedWhileRunning =
    input.lastTickWallClockMs !== null && input.lastTickWallClockMs <= recentTs + 1500;
  const allowedGraceMs = crossedWhileRunning
    ? PRAYER_WAKE_GRACE_MS
    : PRAYER_COLD_BOOT_GRACE_MS;

  if (elapsedMs <= allowedGraceMs) {
    return {
      action: 'trigger',
      fireKey,
      elapsedMs,
      allowedGraceMs,
    };
  }

  return {
    action: 'suppress_stale',
    fireKey,
    elapsedMs,
    allowedGraceMs,
  };
}
