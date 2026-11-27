/**
 * prayerStore.ts
 * Centralized Prayer Schedule & Alert Engine (CASA v2.1.0).
 *
 * - Runs ZERO background timers/work when `settings.ibadah.enabled === false`.
 * - Evaluates against wall-clock epoch (resilient to Modern Standby / Hibernate sleep).
 * - Implements 5-minute wake grace window, stale-wake suppression, and deduplication.
 * - Handles post-Isha rollover to tomorrow's Fajr via Rust `get_prayer_times`.
 * - Enforces Adzan > Timer audio priority (silently halts Timer chime while preserving
 *   Timer `isAlarmRinging` & linked To-Do actions).
 * - Enforces Fullscreen `total-hide` Option (B): audio-only when Adzan/Chime,
 *   deferred visual alert (max 5 min grace) when Visual Saja.
 */

import { useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  getSettingsSnapshot,
  IbadahAudioMode,
  IbadahSettings,
  SETTINGS_STORAGE_KEY,
  SETTINGS_UPDATED_EVENT,
} from '../../stores/useSettingsStore';
import {
  getPrayerTimesNative,
  pauseSmtcForAdzan,
  PrayerScheduleResponse,
  resumeSmtcAfterAdzan,
  setBackgroundAudioDucking,
} from '../../utils/tauriBridge';
import { stopAlarmChime } from '../../utils/alarmChime';
import { stopCalendarAlertChime } from '../calendar/calendarChime';
import { playPrayerAudio, stopPrayerAudio } from './prayerAudio';
import {
  evaluateDuePrayerDecision,
  PRAYER_WAKE_GRACE_MS,
  pruneFiredPrayerMap,
} from './prayerScheduleLogic';

const FIRED_STORAGE_KEY = 'casa_prayer_fired_v1';
const GRACE_WINDOW_MS = PRAYER_WAKE_GRACE_MS; // 5 minutes
const CHIME_VISUAL_AUTO_DISMISS_MS = 20_000; // 20 seconds
const ADZAN_SAFETY_MAX_MS = 6 * 60 * 1000; // 6 minutes safety cap

export interface ActivePrayerAlert {
  fireKey: string;
  prayerId: string;
  prayerLabel: string;
  city: string;
  timeLabel: string;
  audioMode: IbadahAudioMode;
  triggeredAtMs: number;
  suppressVisual: boolean;
  usedAudioFallback: boolean;
}

export interface DeferredPrayerVisualAlert {
  fireKey: string;
  prayerId: string;
  prayerLabel: string;
  city: string;
  timeLabel: string;
  triggeredAtMs: number;
}

export interface PrayerRuntimeState {
  schedule: PrayerScheduleResponse | null;
  isLoading: boolean;
  error: string | null;
  countdownMs: number;
  activeAlert: ActivePrayerAlert | null;
  deferredVisualAlert: DeferredPrayerVisualAlert | null;
  lastSyncedAtMs: number | null;
}

const INITIAL_STATE: PrayerRuntimeState = {
  schedule: null,
  isLoading: false,
  error: null,
  countdownMs: 0,
  activeAlert: null,
  deferredVisualAlert: null,
  lastSyncedAtMs: null,
};

let state: PrayerRuntimeState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();

let engineOwned = false;
let tickInterval: ReturnType<typeof setInterval> | null = null;
let autoDismissTimer: ReturnType<typeof setTimeout> | null = null;
let lastConfigKey = '';
let lastTzOffsetMin: number | null = null;
let lastTickWallClockMs: number | null = null;
let runtimeIsFullscreenActive = false;
let refreshInFlight = false;
let pendingRefreshRequested = false;
let pausedByAdzan = false;
let pausedByAdzanSessionId: string | null = null;
let adzanMediaFlowToken = 0;

function resumeMediaIfPausedByAdzan(): void {
  adzanMediaFlowToken += 1;
  if (!pausedByAdzan) {
    pausedByAdzanSessionId = null;
    return;
  }
  const sessionId = pausedByAdzanSessionId ?? '';
  pausedByAdzan = false;
  pausedByAdzanSessionId = null;
  if (sessionId) {
    void resumeSmtcAfterAdzan(sessionId);
  }
}

function emit(): void {
  listeners.forEach((fn) => fn());
}

function setState(patch: Partial<PrayerRuntimeState>): void {
  state = { ...state, ...patch };
  emit();
}

function buildConfigKey(ibadah: IbadahSettings): string {
  return [
    ibadah.enabled ? '1' : '0',
    ibadah.latitude.toFixed(4),
    ibadah.longitude.toFixed(4),
    ibadah.countryCode,
    ibadah.method,
    ibadah.madhab,
    ibadah.offsets.fajr,
    ibadah.offsets.dhuhr,
    ibadah.offsets.asr,
    ibadah.offsets.maghrib,
    ibadah.offsets.isha,
  ].join('|');
}

function readFiredMap(): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(FIRED_STORAGE_KEY);
    if (!raw) return {};
    return pruneFiredPrayerMap(JSON.parse(raw), Date.now());
  } catch {
    return {};
  }
}

function markFiredKey(fireKey: string): void {
  if (typeof window === 'undefined') return;
  try {
    const map = readFiredMap();
    map[fireKey] = Date.now();
    window.localStorage.setItem(FIRED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Non-fatal localStorage write
  }
}

function clearAutoDismissTimer(): void {
  if (autoDismissTimer) {
    clearTimeout(autoDismissTimer);
    autoDismissTimer = null;
  }
}

function scheduleAutoDismiss(delayMs: number, expectedFireKey: string): void {
  clearAutoDismissTimer();
  autoDismissTimer = setTimeout(() => {
    autoDismissTimer = null;
    if (state.activeAlert?.fireKey === expectedFireKey) {
      stopPrayerAlert();
    }
  }, delayMs);
}

/**
 * Lightweight browser preview fallback when running outside Tauri desktop runtime.
 */
export function buildBrowserPreviewSchedule(ibadah: IbadahSettings): PrayerScheduleResponse {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  const d = now.getDate();
  const pad = (n: number) => String(n).padStart(2, '0');
  const dateKey = `${y}-${pad(m + 1)}-${pad(d)}`;
  const tomorrow = new Date(y, m, d + 1);
  const tomorrowKey = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;

  const rawSlots: Array<{ id: string; label: string; h: number; min: number; offset: number }> = [
    { id: 'fajr', label: 'Subuh', h: 4, min: 35, offset: ibadah.offsets.fajr },
    { id: 'dhuhr', label: 'Dzuhur', h: 11, min: 55, offset: ibadah.offsets.dhuhr },
    { id: 'asr', label: 'Ashar', h: 15, min: 15, offset: ibadah.offsets.asr },
    { id: 'maghrib', label: 'Maghrib', h: 17, min: 55, offset: ibadah.offsets.maghrib },
    { id: 'isha', label: 'Isya', h: 19, min: 8, offset: ibadah.offsets.isha },
  ];

  const nowMs = now.getTime();
  const entries = rawSlots.map((slot) => {
    const dt = new Date(y, m, d, slot.h, slot.min + slot.offset, 0, 0);
    return {
      id: slot.id,
      label: slot.label,
      timestampMs: dt.getTime(),
      timeLabel: `${pad(dt.getHours())}:${pad(dt.getMinutes())}`,
      isPassed: dt.getTime() <= nowMs,
      isNext: false,
    };
  });

  let nextIdx = entries.findIndex((e) => e.timestampMs > nowMs);
  if (nextIdx >= 0) {
    entries[nextIdx].isNext = true;
  }

  const tomorrowFajr = new Date(y, m, d + 1, 4, 35 + ibadah.offsets.fajr, 0, 0);
  const nextEntry =
    nextIdx >= 0
      ? {
          id: entries[nextIdx].id,
          label: entries[nextIdx].label,
          ts: entries[nextIdx].timestampMs,
          timeLabel: entries[nextIdx].timeLabel,
          dateKey,
          isTomorrow: false,
        }
      : {
          id: 'fajr',
          label: 'Subuh',
          ts: tomorrowFajr.getTime(),
          timeLabel: `${pad(tomorrowFajr.getHours())}:${pad(tomorrowFajr.getMinutes())}`,
          dateKey: tomorrowKey,
          isTomorrow: true,
        };

  const yesterdayIsha = new Date(y, m, d - 1, 19, 8 + ibadah.offsets.isha, 0, 0);
  const yesterdayKey = `${yesterdayIsha.getFullYear()}-${pad(yesterdayIsha.getMonth() + 1)}-${pad(yesterdayIsha.getDate())}`;
  const mostRecent =
    nextIdx === 0
      ? { id: 'isha', label: 'Isya', ts: yesterdayIsha.getTime(), dateKey: yesterdayKey }
      : nextIdx > 0
      ? {
          id: entries[nextIdx - 1].id,
          label: entries[nextIdx - 1].label,
          ts: entries[nextIdx - 1].timestampMs,
          dateKey,
        }
      : {
          id: entries[4].id,
          label: entries[4].label,
          ts: entries[4].timestampMs,
          dateKey,
        };

  const methodLabelMap: Record<string, string> = {
    kemenag: 'Kemenag RI',
    jakim: 'JAKIM Malaysia',
    muis: 'MUIS Singapura',
    umm_al_qura: 'Umm al-Qura',
    mwl: 'MWL',
    isna: 'ISNA',
    egyptian: 'Egyptian',
    karachi: 'Karachi',
  };
  const resolvedMethod =
    ibadah.method === 'auto'
      ? ibadah.countryCode === 'ID'
        ? 'kemenag'
        : ibadah.countryCode === 'MY'
        ? 'jakim'
        : ibadah.countryCode === 'SG'
        ? 'muis'
        : ibadah.countryCode === 'SA' || ibadah.countryCode === 'AE'
        ? 'umm_al_qura'
        : 'mwl'
      : ibadah.method;

  const tzOffsetMin = -now.getTimezoneOffset();
  const sign = tzOffsetMin >= 0 ? '+' : '-';
  const absMin = Math.abs(tzOffsetMin);
  const tzLabel = `UTC${sign}${pad(Math.floor(absMin / 60))}:${pad(absMin % 60)}`;

  return {
    dateKey,
    timezoneLabel: tzLabel,
    resolvedMethod,
    resolvedMethodLabel: methodLabelMap[resolvedMethod] || 'Kemenag RI',
    madhabLabel: ibadah.madhab === 'hanafi' ? 'Hanafi' : "Syafi'i",
    prayers: entries,
    nextPrayerId: nextEntry.id,
    nextPrayerLabel: nextEntry.label,
    nextPrayerTimestampMs: nextEntry.ts,
    nextPrayerTimeLabel: nextEntry.timeLabel,
    nextPrayerDateKey: nextEntry.dateKey,
    nextPrayerIsTomorrow: nextEntry.isTomorrow,
    mostRecentPrayerId: mostRecent.id,
    mostRecentPrayerLabel: mostRecent.label,
    mostRecentPrayerTimestampMs: mostRecent.ts,
    mostRecentPrayerDateKey: mostRecent.dateKey,
  };
}

function triggerPrayerAlert(payload: {
  fireKey: string;
  prayerId: string;
  prayerLabel: string;
  timeLabel: string;
  triggeredAtMs: number;
}): void {
  const settings = getSettingsSnapshot();
  if (!settings.ibadah.enabled) return;

  const audioMode = settings.ibadah.audioMode;
  const city = settings.ibadah.city || 'Lokasi Anda';
  const isTotalHideFullscreen =
    runtimeIsFullscreenActive && settings.fullscreenBehavior === 'total-hide';

  // Conflict arbitration (Adzan > Timer & Calendar):
  // - Silently halt Timer & Calendar chimes while preserving Timer `isAlarmRinging` & linked To-Do.
  // - Release persistent ducking so Adzan takes full audio stage and auto-pauses active SMTC media.
  stopAlarmChime();
  stopCalendarAlertChime();
  if (audioMode !== 'visual') {
    void setBackgroundAudioDucking(false);
  }

  // Fullscreen `total-hide` Option (B):
  // - If Visual Saja: hold notification until exiting fullscreen (max 5-min grace).
  // - If Adzan / Chime: keep screen completely hidden (`suppressVisual: true`) and play audio only.
  if (isTotalHideFullscreen && audioMode === 'visual') {
    setState({
      deferredVisualAlert: {
        fireKey: payload.fireKey,
        prayerId: payload.prayerId,
        prayerLabel: payload.prayerLabel,
        city,
        timeLabel: payload.timeLabel,
        triggeredAtMs: payload.triggeredAtMs,
      },
    });
    return;
  }

  const suppressVisual = isTotalHideFullscreen;

  clearAutoDismissTimer();
  setState({
    deferredVisualAlert: null,
    activeAlert: {
      fireKey: payload.fireKey,
      prayerId: payload.prayerId,
      prayerLabel: payload.prayerLabel,
      city,
      timeLabel: payload.timeLabel,
      audioMode,
      triggeredAtMs: payload.triggeredAtMs,
      suppressVisual,
      usedAudioFallback: false,
    },
  });

  if (audioMode === 'visual') {
    scheduleAutoDismiss(CHIME_VISUAL_AUTO_DISMISS_MS, payload.fireKey);
    return;
  }

  const flowToken = ++adzanMediaFlowToken;
  void pauseSmtcForAdzan().then((pausedSessionId) => {
    if (!pausedSessionId) return;
    if (adzanMediaFlowToken !== flowToken || state.activeAlert?.fireKey !== payload.fireKey) {
      // Adzan already ended/dismissed while pause IPC was in flight -> restore immediately
      void resumeSmtcAfterAdzan(pausedSessionId);
      return;
    }
    pausedByAdzan = true;
    pausedByAdzanSessionId = pausedSessionId;
  });

  void playPrayerAudio(audioMode, {
    prayerId: payload.prayerId,
    onEnded: () => {
      if (state.activeAlert?.fireKey === payload.fireKey) {
        stopPrayerAlert();
      }
    },
  }).then((res) => {
    if (state.activeAlert?.fireKey !== payload.fireKey) return;

    if (res.usedFallback) {
      setState({
        activeAlert: {
          ...state.activeAlert,
          usedAudioFallback: true,
        },
      });
    }

    if (res.isStreamingAdzan) {
      // Wait for real audio `ended` event, with generous safety ceiling
      scheduleAutoDismiss(ADZAN_SAFETY_MAX_MS, payload.fireKey);
    } else {
      // Chime mode or fallback chime -> auto-return after 20 seconds
      scheduleAutoDismiss(CHIME_VISUAL_AUTO_DISMISS_MS, payload.fireKey);
    }
  });
}

function evaluateDuePrayer(
  schedule: PrayerScheduleResponse,
  nowMs: number,
  prevTickWallClockMs: number | null
): void {
  const recentTs = schedule.mostRecentPrayerTimestampMs;
  const decision = evaluateDuePrayerDecision({
    mostRecentPrayerId: schedule.mostRecentPrayerId,
    mostRecentPrayerDateKey: schedule.mostRecentPrayerDateKey,
    mostRecentPrayerTimestampMs: recentTs,
    nowMs,
    lastTickWallClockMs: prevTickWallClockMs,
    firedMap: readFiredMap(),
  });

  if (decision.action === 'future' || decision.action === 'already_fired') {
    return;
  }

  if (decision.action === 'trigger') {
    markFiredKey(decision.fireKey);
    const matchingToday = schedule.prayers.find((p) => p.id === schedule.mostRecentPrayerId);
    const fallbackDt = new Date(recentTs);
    const formattedFallbackTime = `${String(fallbackDt.getHours()).padStart(2, '0')}:${String(
      fallbackDt.getMinutes()
    ).padStart(2, '0')}`;
    triggerPrayerAlert({
      fireKey: decision.fireKey,
      prayerId: schedule.mostRecentPrayerId,
      prayerLabel: schedule.mostRecentPrayerLabel,
      timeLabel: matchingToday?.timeLabel || formattedFallbackTime,
      triggeredAtMs: recentTs,
    });
  } else {
    // Suppress stale scheduled minute silently (only locks that exact HH:MM so offset edits still fire)
    markFiredKey(decision.fireKey);
  }
}

export async function refreshPrayerSchedule(): Promise<void> {
  const settings = getSettingsSnapshot();
  if (!settings.ibadah.enabled) {
    return;
  }

  if (refreshInFlight) {
    pendingRefreshRequested = true;
    return;
  }

  refreshInFlight = true;
  if (!state.schedule) {
    setState({ isLoading: true, error: null });
  }

  try {
    const req = {
      latitude: settings.ibadah.latitude,
      longitude: settings.ibadah.longitude,
      countryCode: settings.ibadah.countryCode,
      method: settings.ibadah.method,
      madhab: settings.ibadah.madhab,
      offsets: settings.ibadah.offsets,
    };

    const nativeSchedule = await getPrayerTimesNative(req);
    const resolved = nativeSchedule ?? buildBrowserPreviewSchedule(settings.ibadah);
    const nowMs = Date.now();
    const prevTickMs = lastTickWallClockMs;
    lastConfigKey = buildConfigKey(settings.ibadah);
    lastTzOffsetMin = new Date(nowMs).getTimezoneOffset();

    setState({
      schedule: resolved,
      isLoading: false,
      error: null,
      countdownMs: Math.max(0, resolved.nextPrayerTimestampMs - nowMs),
      lastSyncedAtMs: nowMs,
    });

    if (engineOwned) {
      evaluateDuePrayer(resolved, nowMs, prevTickMs);
      lastTickWallClockMs = nowMs;
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setState({
      isLoading: false,
      error: msg || 'Gagal menghitung jadwal sholat.',
    });
  } finally {
    refreshInFlight = false;
    if (pendingRefreshRequested) {
      pendingRefreshRequested = false;
      void refreshPrayerSchedule();
    }
  }
}

function handleTick(): void {
  const settings = getSettingsSnapshot();
  if (!settings.ibadah.enabled) {
    teardownActiveScheduler();
    return;
  }

  const nowMs = Date.now();
  const tzOffsetMin = new Date(nowMs).getTimezoneOffset();
  const configKey = buildConfigKey(settings.ibadah);

  const needsRecalc =
    !state.schedule ||
    configKey !== lastConfigKey ||
    (lastTzOffsetMin !== null && tzOffsetMin !== lastTzOffsetMin) ||
    nowMs >= state.schedule.nextPrayerTimestampMs;

  if (needsRecalc) {
    void refreshPrayerSchedule();
    return;
  }

  // Detect sleep/hibernate wake jump (> 15s gap between 1s ticks) -> force fresh schedule check
  if (lastTickWallClockMs !== null && nowMs - lastTickWallClockMs > 15_000) {
    void refreshPrayerSchedule();
    return;
  }

  lastTickWallClockMs = nowMs;

  // Expire deferred visual alert if fullscreen lasted beyond 5-minute grace window
  if (
    state.deferredVisualAlert &&
    nowMs - state.deferredVisualAlert.triggeredAtMs > GRACE_WINDOW_MS
  ) {
    setState({ deferredVisualAlert: null });
  }

  if (state.schedule) {
    const nextCountdown = Math.max(0, state.schedule.nextPrayerTimestampMs - nowMs);
    if (Math.floor(nextCountdown / 1000) !== Math.floor(state.countdownMs / 1000)) {
      setState({ countdownMs: nextCountdown });
    }
  }
}

function teardownActiveScheduler(): void {
  if (tickInterval) {
    clearInterval(tickInterval);
    tickInterval = null;
  }
  clearAutoDismissTimer();
  stopPrayerAudio();
  resumeMediaIfPausedByAdzan();
  lastTickWallClockMs = null;
  lastConfigKey = '';
  if (
    state.activeAlert !== null ||
    state.deferredVisualAlert !== null ||
    state.schedule !== null
  ) {
    setState({ ...INITIAL_STATE });
  }
}

export function stopPrayerAlert(): void {
  clearAutoDismissTimer();
  stopPrayerAudio();
  resumeMediaIfPausedByAdzan();
  if (state.activeAlert !== null || state.deferredVisualAlert !== null) {
    setState({
      activeAlert: null,
      deferredVisualAlert: null,
    });
  }
}

export function isPrayerAlertActive(): boolean {
  return state.activeAlert !== null;
}

export function isVisiblePrayerAlertActive(): boolean {
  return state.activeAlert !== null && !state.activeAlert.suppressVisual;
}

export function setPrayerRuntimeFullscreenState(isFullscreen: boolean): void {
  const wasFullscreen = runtimeIsFullscreenActive;
  runtimeIsFullscreenActive = isFullscreen;

  // When exiting fullscreen `total-hide`, promote deferred visual alert if still within 5-min grace
  if (wasFullscreen && !isFullscreen && state.deferredVisualAlert) {
    const deferred = state.deferredVisualAlert;
    const nowMs = Date.now();
    if (nowMs - deferred.triggeredAtMs <= GRACE_WINDOW_MS) {
      clearAutoDismissTimer();
      setState({
        deferredVisualAlert: null,
        activeAlert: {
          fireKey: deferred.fireKey,
          prayerId: deferred.prayerId,
          prayerLabel: deferred.prayerLabel,
          city: deferred.city,
          timeLabel: deferred.timeLabel,
          audioMode: 'visual',
          triggeredAtMs: deferred.triggeredAtMs,
          suppressVisual: false,
          usedAudioFallback: false,
        },
      });
      scheduleAutoDismiss(CHIME_VISUAL_AUTO_DISMISS_MS, deferred.fireKey);
    } else {
      setState({ deferredVisualAlert: null });
    }
  }
}

function syncSchedulerLifecycle(): void {
  if (!engineOwned) return;
  const settings = getSettingsSnapshot();

  if (!settings.ibadah.enabled) {
    teardownActiveScheduler();
    return;
  }

  const nextKey = buildConfigKey(settings.ibadah);
  if (!tickInterval) {
    tickInterval = setInterval(handleTick, 1000);
  }
  if (nextKey !== lastConfigKey || !state.schedule) {
    void refreshPrayerSchedule();
  }
}

/**
 * Starts the single prayer scheduler lifecycle (must be called ONLY from the main island window).
 */
export function startPrayerSchedulerEngine(): () => void {
  if (engineOwned) {
    syncSchedulerLifecycle();
    return () => {};
  }
  engineOwned = true;
  syncSchedulerLifecycle();

  const onStorage = (event: StorageEvent) => {
    if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
    syncSchedulerLifecycle();
  };

  const onWake = () => {
    if (!getSettingsSnapshot().ibadah.enabled) return;
    void refreshPrayerSchedule();
  };

  const onVisibility = () => {
    if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
      onWake();
    }
  };

  let unlistenSettingsUpdated: (() => void) | undefined;
  let isActive = true;

  if (typeof window !== 'undefined') {
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', onWake);
    document.addEventListener('visibilitychange', onVisibility);

    if ('__TAURI_INTERNALS__' in window) {
      listen(SETTINGS_UPDATED_EVENT, () => {
        if (!isActive) return;
        syncSchedulerLifecycle();
      })
        .then((unlisten) => {
          if (!isActive) {
            unlisten();
          } else {
            unlistenSettingsUpdated = unlisten;
          }
        })
        .catch(() => {});
    }
  }

  return () => {
    isActive = false;
    engineOwned = false;
    teardownActiveScheduler();
    if (unlistenSettingsUpdated) {
      unlistenSettingsUpdated();
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', onWake);
      document.removeEventListener('visibilitychange', onVisibility);
    }
  };
}

/**
 * Notifies the scheduler immediately when settings change in the SAME window.
 */
export function notifyPrayerSettingsChanged(): void {
  syncSchedulerLifecycle();
}

export function formatPrayerCountdown(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(hours)}:${pad(mins)}:${pad(secs)}`;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): PrayerRuntimeState {
  return state;
}

export function usePrayerStore(): PrayerRuntimeState {
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE);
}
