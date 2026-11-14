export interface PlaybackClockSnapshot {
  basePositionMs: number;
  capturedAtMs: number;
  isPlaying: boolean;
  durationMs: number;
}

export const EXTERNAL_SEEK_SNAP_THRESHOLD_MS = 1500;
export const MINOR_DRIFT_CALIBRATION_THRESHOLD_MS = 250;

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
}

/**
 * Reconciles an incoming Spotify Web API or Windows GSMTC state update against the active local
 * clock snapshot. Snaps immediately on external seeks (> 1500ms delta), track switches, or
 * manual seeks, while preserving smooth monotonic progress when GSMTC repeats stale positions.
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

    if (options.isPositionFresh) {
      const deltaMs = Math.abs(incomingMs - localMs);
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
    }
  }

  return {
    basePositionMs: localMs,
    capturedAtMs: nowMs,
    isPlaying: options.isPlaying,
    durationMs,
  };
}
