export interface PlaybackClockSnapshot {
  basePositionMs: number;
  capturedAtMs: number;
  isPlaying: boolean;
  durationMs: number;
}

export const EXTERNAL_SEEK_SNAP_THRESHOLD_MS = 1500;
export const MINOR_DRIFT_CALIBRATION_THRESHOLD_MS = 250;
export const LYRIC_COMPANION_LEAD_MS = 75;
export const LYRIC_HYSTERESIS_MS = 50;
export const LYRIC_INTRO_THRESHOLD_MS = 3000;

let manualSeekLockUntilMs = 0;

/**
 * Sets a short protection window after manual seek/skip so in-flight GSMTC or Spotify API
 * responses with stale pre-seek timestamps do not snap the clock back.
 */
export function markPlaybackManualSeekLock(lockDurationMs: number = 900): void {
  manualSeekLockUntilMs = Math.max(manualSeekLockUntilMs, Date.now() + lockDurationMs);
}

/**
 * Returns true while a manual CASA seek protection window is active.
 */
export function isPlaybackSeekLocked(): boolean {
  return Date.now() < manualSeekLockUntilMs;
}

function clampPositionMs(positionMs: number, durationMs: number): number {
  const safePos = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  return durationMs > 0 ? Math.min(durationMs, safePos) : safePos;
}

/**
 * Deterministically computes the current playback position in milliseconds from a clock snapshot.
 */
export function computeInterpolatedPositionMs(
  clock: PlaybackClockSnapshot | null | undefined,
  nowMs: number = Date.now()
): number {
  if (!clock) return 0;
  const base = Number.isFinite(clock.basePositionMs) ? Math.max(0, clock.basePositionMs) : 0;
  const duration = Number.isFinite(clock.durationMs) ? Math.max(0, clock.durationMs) : 0;
  const elapsed = clock.isPlaying ? Math.max(0, nowMs - clock.capturedAtMs) : 0;
  return clampPositionMs(base + elapsed, duration);
}

export interface ReconcileClockOptions {
  incomingPositionMs: number | null;
  isPlaying: boolean;
  durationMs: number;
  nowMs?: number;
  forceSnap?: boolean;
  isPositionFresh?: boolean;
  calibrateMinorDrift?: boolean;
  playStateChanged?: boolean;
}

/**
 * Reconciles an incoming Spotify Web API or Windows GSMTC state update against the active local
 * clock snapshot. Snaps immediately on external seeks (> 1500ms delta), track switches, or
 * manual seeks, re-anchors on Playing/Paused transitions, and preserves smooth monotonic progress
 * when GSMTC repeats stale positions.
 */
export function reconcilePlaybackClockSnapshot(
  prevClock: PlaybackClockSnapshot | null | undefined,
  options: ReconcileClockOptions
): PlaybackClockSnapshot {
  const nowMs = options.nowMs ?? Date.now();
  const durationMs =
    Number.isFinite(options.durationMs) && options.durationMs > 0
      ? Math.round(options.durationMs)
      : 0;
  const localMs = clampPositionMs(computeInterpolatedPositionMs(prevClock, nowMs), durationMs);

  if (options.incomingPositionMs !== null && Number.isFinite(options.incomingPositionMs)) {
    const incomingMs = clampPositionMs(options.incomingPositionMs, durationMs);
    if (options.forceSnap) {
      return {
        basePositionMs: incomingMs,
        capturedAtMs: nowMs,
        isPlaying: options.isPlaying,
        durationMs,
      };
    }

    const deltaMs = Math.abs(incomingMs - localMs);
    if (options.isPositionFresh) {
      if (
        deltaMs > EXTERNAL_SEEK_SNAP_THRESHOLD_MS ||
        (options.calibrateMinorDrift && deltaMs > MINOR_DRIFT_CALIBRATION_THRESHOLD_MS)
      ) {
        return {
          basePositionMs: incomingMs,
          capturedAtMs: nowMs,
          isPlaying: options.isPlaying,
          durationMs,
        };
      }
    } else if (
      options.playStateChanged &&
      options.calibrateMinorDrift &&
      incomingMs > 0 &&
      deltaMs <= 3500
    ) {
      return {
        basePositionMs: incomingMs,
        capturedAtMs: nowMs,
        isPlaying: options.isPlaying,
        durationMs,
      };
    }
  }

  return {
    basePositionMs: localMs,
    capturedAtMs: nowMs,
    isPlaying: options.isPlaying,
    durationMs,
  };
}

/**
 * Re-anchors an existing clock snapshot to `nowMs` without losing or multiplying accumulated elapsed time.
 */
export function snapPlaybackClockAnchor(
  clock: PlaybackClockSnapshot | null | undefined,
  nowMs: number = Date.now(),
  isPlayingOverride?: boolean
): PlaybackClockSnapshot | undefined {
  if (!clock) return undefined;
  return {
    basePositionMs: computeInterpolatedPositionMs(clock, nowMs),
    capturedAtMs: nowMs,
    isPlaying: isPlayingOverride ?? clock.isPlaying,
    durationMs: clock.durationMs,
  };
}

/**
 * Single Source of Truth position resolver shared by Mode 6 (`useLyricsSync`) and Mode Idle (`IdlePillView`).
 */
export function resolvePlaybackPositionMs(params: {
  playbackSource: 'companion' | 'native';
  playbackClock?: PlaybackClockSnapshot | null;
  nativePositionMs?: number;
  fallbackPositionSec?: number;
  nowMs?: number;
}): number {
  if (params.playbackSource === 'native') {
    const nativeMs =
      typeof params.nativePositionMs === 'number' && Number.isFinite(params.nativePositionMs)
        ? params.nativePositionMs
        : 0;
    return Math.max(0, nativeMs);
  }
  if (params.playbackClock) {
    return computeInterpolatedPositionMs(params.playbackClock, params.nowMs ?? Date.now());
  }
  const fallbackSec =
    typeof params.fallbackPositionSec === 'number' && Number.isFinite(params.fallbackPositionSec)
      ? params.fallbackPositionSec
      : 0;
  return Math.max(0, fallbackSec * 1000);
}

/**
 * Applies uniform offset and perception lead so expanded and idle lyrics advance identically.
 */
export function computeLyricAdjustedTimeMs(
  positionMs: number,
  options?: {
    playbackSource?: 'companion' | 'native';
    offsetSeconds?: number;
    ignoreLeadTime?: boolean;
  }
): number {
  const safePosMs = Number.isFinite(positionMs) ? Math.max(0, positionMs) : 0;
  if (options?.playbackSource === 'native') {
    return safePosMs;
  }
  const offsetMs = Math.max(0, (options?.offsetSeconds || 0) * 1000);
  const leadMs = options?.ignoreLeadTime ? 0 : LYRIC_COMPANION_LEAD_MS;
  return safePosMs - offsetMs + leadMs;
}

export interface TimedLyricLike {
  id: string;
  text: string;
  timeMs?: number;
  time?: number;
  seconds?: number;
  timeSeconds?: number;
}

function getLineTimeMs(line: TimedLyricLike): number {
  if (typeof line.timeMs === 'number' && Number.isFinite(line.timeMs)) {
    return line.timeMs;
  }
  const sec = line.timeSeconds ?? line.seconds ?? line.time ?? 0;
  return Number.isFinite(sec) ? sec * 1000 : 0;
}

/**
 * Deterministic synced lyric line index with uniform 50ms hysteresis and intro threshold (> 3s).
 */
export function computeSyncedLyricIndex(
  lines: TimedLyricLike[],
  adjustedTimeMs: number
): number {
  if (!Array.isArray(lines) || lines.length === 0) return -1;
  const firstLineMs = getLineTimeMs(lines[0]);
  if (adjustedTimeMs < firstLineMs && firstLineMs > LYRIC_INTRO_THRESHOLD_MS) {
    return -1;
  }

  let activeIdx = 0;
  for (let i = 1; i < lines.length; i++) {
    if (adjustedTimeMs >= getLineTimeMs(lines[i]) + LYRIC_HYSTERESIS_MS) {
      activeIdx = i;
    } else {
      break;
    }
  }
  return activeIdx;
}

/**
 * Maps current playback progress into a proportional scroll fraction [0..1] for unsynced plain lyrics,
 * reserving symmetric intro and outro margins (~8-10%, default 9%) so text glides cleanly.
 */
export function computeUnsyncedScrollProgress(
  positionMs: number,
  durationMs: number,
  introMarginRatio: number = 0.09,
  outroMarginRatio: number = 0.09
): number {
  if (
    !Number.isFinite(durationMs) ||
    durationMs <= 0 ||
    !Number.isFinite(positionMs) ||
    positionMs <= 0
  ) {
    return 0;
  }
  const rawRatio = Math.max(0, Math.min(1, positionMs / durationMs));
  const safeIntro = Math.max(0, Math.min(0.25, introMarginRatio));
  const safeOutro = Math.max(0, Math.min(0.25, outroMarginRatio));
  const activeSpan = Math.max(0.1, 1 - safeIntro - safeOutro);

  if (rawRatio <= safeIntro) return 0;
  if (rawRatio >= 1 - safeOutro) return 1;
  return (rawRatio - safeIntro) / activeSpan;
}
