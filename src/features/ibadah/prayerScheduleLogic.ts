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

export interface PrayerVisualTheme {
  accent: string;
  stroke: string;
  glow: string;
  outerShadow: string;
  bannerBorder: string;
  bannerTint: string;
}

const MONOCHROME_PRAYER_THEME: PrayerVisualTheme = {
  accent: '#FFFFFF',
  stroke: '#FFFFFF',
  glow: 'rgba(255, 255, 255, 0.36)',
  outerShadow: 'rgba(255, 255, 255, 0.28)',
  bannerBorder: 'rgba(255, 255, 255, 0.16)',
  bannerTint: 'rgba(255, 255, 255, 0.04)',
};

const PRAYER_SKY_THEMES: Record<string, PrayerVisualTheme> = {
  // Subuh / Fajr: fajar perak -> emas pagi lembut (#FDE68A)
  fajr: {
    accent: '#FDE68A',
    stroke: '#FDE68A',
    glow: 'rgba(253, 230, 138, 0.42)',
    outerShadow: 'rgba(253, 230, 138, 0.30)',
    bannerBorder: 'rgba(253, 230, 138, 0.28)',
    bannerTint: 'rgba(253, 230, 138, 0.08)',
  },
  // Dzuhur / Dhuhr: putih surya cerah (#FFFBEB)
  dhuhr: {
    accent: '#FFFBEB',
    stroke: '#FFFBEB',
    glow: 'rgba(255, 251, 235, 0.44)',
    outerShadow: 'rgba(255, 251, 235, 0.30)',
    bannerBorder: 'rgba(255, 251, 235, 0.28)',
    bannerTint: 'rgba(255, 251, 235, 0.07)',
  },
  // Ashar / Asr: kuning madu sore hangat (#FCD34D)
  asr: {
    accent: '#FCD34D',
    stroke: '#FCD34D',
    glow: 'rgba(252, 211, 77, 0.44)',
    outerShadow: 'rgba(252, 211, 77, 0.32)',
    bannerBorder: 'rgba(252, 211, 77, 0.28)',
    bannerTint: 'rgba(252, 211, 77, 0.08)',
  },
  // Maghrib: jingga senja (#FB923C)
  maghrib: {
    accent: '#FB923C',
    stroke: '#FB923C',
    glow: 'rgba(251, 146, 60, 0.48)',
    outerShadow: 'rgba(251, 146, 60, 0.36)',
    bannerBorder: 'rgba(251, 146, 60, 0.32)',
    bannerTint: 'rgba(251, 146, 60, 0.09)',
  },
  // Isya / Isha: biru-perak bulan adem (#93C5FD)
  isha: {
    accent: '#93C5FD',
    stroke: '#93C5FD',
    glow: 'rgba(147, 197, 253, 0.44)',
    outerShadow: 'rgba(147, 197, 253, 0.32)',
    bannerBorder: 'rgba(147, 197, 253, 0.30)',
    bannerTint: 'rgba(147, 197, 253, 0.08)',
  },
};

export function resolvePrayerVisualTheme(
  prayerId: string | null | undefined,
  isMonochrome: boolean
): PrayerVisualTheme {
  if (isMonochrome) {
    return MONOCHROME_PRAYER_THEME;
  }
  const normalized = (prayerId ?? '').trim().toLowerCase();
  if (normalized === 'fajr' || normalized === 'subuh') return PRAYER_SKY_THEMES.fajr;
  if (normalized === 'dhuhr' || normalized === 'dzuhur') return PRAYER_SKY_THEMES.dhuhr;
  if (normalized === 'asr' || normalized === 'ashar') return PRAYER_SKY_THEMES.asr;
  if (normalized === 'maghrib') return PRAYER_SKY_THEMES.maghrib;
  if (normalized === 'isha' || normalized === 'isya') return PRAYER_SKY_THEMES.isha;
  return MONOCHROME_PRAYER_THEME;
}
