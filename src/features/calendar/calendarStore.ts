/**
 * calendarStore.ts
 * Local Calendar & Smart Reminders Engine (CASA v2.5.0).
 *
 * - Idle Zero-Churn: runs 0 timers/intervals when `settings.calendarEnabled === false`
 *   OR enabled reminder count === 0.
 * - Uses 1 precision `setTimeout` aligned to the next threshold (`H-15m` or `T-0`),
 *   and runs a 1s ticker ONLY while an `H-15m` badge or `T-0` alert is actively visible.
 * - Handles midnight crossover, cross-midnight epoch snooze (`5m`), FIFO multi-alert
 *   queueing, auto-dismiss on edit/disable/delete, and 5-minute wake/fullscreen grace.
 */

import { useSyncExternalStore } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  CasaFullscreenBehavior,
  getSettingsSnapshot,
  SETTINGS_STORAGE_KEY,
  SETTINGS_UPDATED_EVENT,
} from '../../stores/useSettingsStore';
import { playChimeCue } from '../../utils/tauriBridge';
import { isPrayerAlertActive } from '../ibadah/prayerStore';
import { startCalendarAlertChime, stopCalendarAlertChime } from './calendarChime';
import {
  CALENDAR_FIRED_STORAGE_KEY,
  CALENDAR_REMINDERS_STORAGE_KEY,
  DueReminderAlert,
  evaluateCalendarSnapshot,
  isPastDateISO,
  isValidDateISO,
  MAX_REMINDER_ITEMS,
  MAX_REMINDER_NOTE_LEN,
  MAX_REMINDER_TITLE_LEN,
  normalizeTimeHHMM,
  pruneFiredReminderMap,
  REMINDER_COLD_BOOT_GRACE_MS,
  REMINDER_SNOOZE_DEFAULT_MINUTES,
  REMINDER_WAKE_GRACE_MS,
  ReminderItem,
  ReminderRepeat,
  sanitizeReminderList,
  sanitizeReminderRepeat,
  sanitizeReminderText,
  UpcomingReminderBadge,
} from './calendarScheduleLogic';

const MAX_PRECISION_TIMEOUT_MS = 60 * 60 * 1000; // Re-anchor every <= 1h against clock sleep drift

export interface CalendarStoreState {
  reminders: ReminderItem[];
  upcomingBadge: UpcomingReminderBadge | null;
  alertQueue: DueReminderAlert[];
  activeAlert: DueReminderAlert | null;
  isSchedulerRunning: boolean;
}

export interface AddReminderInput {
  title: string;
  note?: string;
  dateISO: string;
  timeHHMM: string;
  repeat: ReminderRepeat;
}

export interface ReminderMutationResult {
  ok: boolean;
  error?: string;
  item?: ReminderItem;
}

function loadRemindersFromStorage(): ReminderItem[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(CALENDAR_REMINDERS_STORAGE_KEY);
    if (!raw) return [];
    return sanitizeReminderList(JSON.parse(raw));
  } catch {
    return [];
  }
}

function persistRemindersToStorage(items: ReminderItem[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      CALENDAR_REMINDERS_STORAGE_KEY,
      JSON.stringify(items)
    );
  } catch (err) {
    console.warn('[calendarStore] Failed to persist reminders:', err);
  }
}

function loadFiredMapFromStorage(nowMs: number): Record<string, number> {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CALENDAR_FIRED_STORAGE_KEY);
    if (!raw) return {};
    return pruneFiredReminderMap(JSON.parse(raw), nowMs);
  } catch {
    return {};
  }
}

function persistFiredMapToStorage(map: Record<string, number>): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CALENDAR_FIRED_STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Ignore quota errors on fired dedupe map
  }
}

const INITIAL_STATE: CalendarStoreState = {
  reminders: loadRemindersFromStorage(),
  upcomingBadge: null,
  alertQueue: [],
  activeAlert: null,
  isSchedulerRunning: false,
};

let state: CalendarStoreState = { ...INITIAL_STATE };
const listeners = new Set<() => void>();

let engineOwned = false;
let precisionTimeoutId: ReturnType<typeof setTimeout> | null = null;
let activeTickerId: ReturnType<typeof setInterval> | null = null;
let runtimeIsFullscreen = false;
let runtimeFullscreenBehavior: CasaFullscreenBehavior = 'smart-tuck';
let isColdBootEvaluation = true;

function emit(): void {
  listeners.forEach((fn) => fn());
}

function setState(patch: Partial<CalendarStoreState>): void {
  const nextQueue = patch.alertQueue !== undefined ? patch.alertQueue : state.alertQueue;
  const nextActive = nextQueue[0] ?? null;
  state = {
    ...state,
    ...patch,
    alertQueue: nextQueue,
    activeAlert: nextActive,
  };
  emit();
}

function clearPrecisionTimeout(): void {
  if (precisionTimeoutId !== null) {
    clearTimeout(precisionTimeoutId);
    precisionTimeoutId = null;
  }
}

function clearActiveTicker(): void {
  if (activeTickerId !== null) {
    clearInterval(activeTickerId);
    activeTickerId = null;
  }
}

function clearAllTimers(): void {
  clearPrecisionTimeout();
  clearActiveTicker();
}

function createReminderId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `rem_${crypto.randomUUID().replace(/-/g, '').slice(0, 12)}`;
  }
  return `rem_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function reconcileScheduler(reason: string = 'tick'): void {
  const settings = getSettingsSnapshot();
  const enabledCount = state.reminders.filter((r) => r.enabled).length;

  // Hard Idle Zero-Churn guarantee: 0 timers & 0 intervals when disabled or empty
  if (!settings.calendarEnabled || enabledCount === 0) {
    clearAllTimers();
    stopCalendarAlertChime();
    if (
      state.upcomingBadge !== null ||
      state.alertQueue.length > 0 ||
      state.isSchedulerRunning
    ) {
      setState({
        upcomingBadge: null,
        alertQueue: [],
        isSchedulerRunning: false,
      });
    }
    return;
  }

  if (!engineOwned) {
    return;
  }

  const nowMs = Date.now();
  const firedMap = loadFiredMapFromStorage(nowMs);
  const wakeGraceMs =
    isColdBootEvaluation && reason === 'boot'
      ? REMINDER_COLD_BOOT_GRACE_MS
      : REMINDER_WAKE_GRACE_MS;
  isColdBootEvaluation = false;

  const result = evaluateCalendarSnapshot(state.reminders, {
    nowMs,
    firedKeys: firedMap,
    wakeGraceMs,
  });

  const isFullscreenTotalHide =
    runtimeIsFullscreen && runtimeFullscreenBehavior === 'total-hide';

  let updatedReminders = state.reminders;
  let remindersDirty = false;
  if (result.hadSnoozeClearIds.length > 0) {
    const clearSet = new Set(result.hadSnoozeClearIds);
    updatedReminders = updatedReminders.map((item) =>
      clearSet.has(item.id) ? { ...item, snoozedUntilMs: null } : item
    );
    remindersDirty = true;
  }

  let nextQueue = state.alertQueue.slice();
  const prevActiveFireKey = state.activeAlert?.fireKey ?? null;
  let didAddNewAlert = false;

  if (!isFullscreenTotalHide && result.newlyDueAlerts.length > 0) {
    const existingKeys = new Set(nextQueue.map((a) => a.fireKey));
    const snoozedFiredIds = new Set<string>();

    for (const alert of result.newlyDueAlerts) {
      result.prunedFiredKeys[alert.fireKey] = nowMs;
      if (alert.isSnoozed) {
        snoozedFiredIds.add(alert.reminderId);
      }
      if (!existingKeys.has(alert.fireKey)) {
        nextQueue.push(alert);
        existingKeys.add(alert.fireKey);
        didAddNewAlert = true;
      }
    }

    if (snoozedFiredIds.size > 0) {
      updatedReminders = updatedReminders.map((item) =>
        snoozedFiredIds.has(item.id)
          ? { ...item, snoozedUntilMs: null, updatedAtMs: nowMs }
          : item
      );
      remindersDirty = true;
    }
  }

  persistFiredMapToStorage(result.prunedFiredKeys);
  if (remindersDirty) {
    persistRemindersToStorage(updatedReminders);
  }

  setState({
    reminders: updatedReminders,
    upcomingBadge: result.upcomingBadge,
    alertQueue: nextQueue,
    isSchedulerRunning: true,
  });

  if (didAddNewAlert && nextQueue[0] && nextQueue[0].fireKey !== prevActiveFireKey) {
    if (!isPrayerAlertActive()) {
      startCalendarAlertChime(() => !isPrayerAlertActive() && state.alertQueue.length > 0);
    }
  } else if (nextQueue.length === 0) {
    stopCalendarAlertChime();
  }

  // Schedule exactly 1 precision wakeup for next H-15m / T-0 boundary
  clearPrecisionTimeout();
  if (result.nextWakeAtMs !== null) {
    const rawDelay = Math.max(250, result.nextWakeAtMs - Date.now());
    const clampedDelay = Math.min(rawDelay, MAX_PRECISION_TIMEOUT_MS);
    precisionTimeoutId = setTimeout(() => {
      precisionTimeoutId = null;
      reconcileScheduler('precision-wakeup');
    }, clampedDelay);
  }

  // Activate lightweight 1s ticker ONLY while H-15m countdown badge or T-0 alert is visible
  const needsLiveTicker = result.upcomingBadge !== null || nextQueue.length > 0;
  if (needsLiveTicker) {
    if (activeTickerId === null) {
      activeTickerId = setInterval(() => {
        reconcileScheduler('active-tick');
      }, 1000);
    }
  } else {
    clearActiveTicker();
  }
}

export function addReminder(input: AddReminderInput): ReminderMutationResult {
  const title = sanitizeReminderText(input.title, MAX_REMINDER_TITLE_LEN);
  const note = sanitizeReminderText(input.note ?? '', MAX_REMINDER_NOTE_LEN);
  const timeHHMM = normalizeTimeHHMM(input.timeHHMM);
  const repeat = sanitizeReminderRepeat(input.repeat);

  if (!title) {
    return { ok: false, error: 'Judul agenda wajib diisi.' };
  }
  if (!isValidDateISO(input.dateISO)) {
    return { ok: false, error: 'Tanggal agenda tidak valid.' };
  }
  if (!timeHHMM) {
    return { ok: false, error: 'Format jam harus HH:MM.' };
  }
  if (repeat === 'once' && isPastDateISO(input.dateISO)) {
    return { ok: false, error: 'Mode Sekali tidak berlaku untuk tanggal yang sudah lewat.' };
  }
  if (state.reminders.length >= MAX_REMINDER_ITEMS) {
    return { ok: false, error: `Maksimal ${MAX_REMINDER_ITEMS} agenda tercapai.` };
  }

  const nowMs = Date.now();
  const item: ReminderItem = {
    id: createReminderId(),
    title,
    note,
    dateISO: input.dateISO,
    timeHHMM,
    repeat,
    enabled: true,
    snoozedUntilMs: null,
    createdAtMs: nowMs,
    updatedAtMs: nowMs,
  };

  const nextReminders = [...state.reminders, item];
  persistRemindersToStorage(nextReminders);
  setState({ reminders: nextReminders });
  reconcileScheduler('add');
  return { ok: true, item };
}

export function updateReminder(
  id: string,
  patch: Partial<Pick<ReminderItem, 'title' | 'note' | 'dateISO' | 'timeHHMM' | 'repeat' | 'enabled'>>
): ReminderMutationResult {
  const idx = state.reminders.findIndex((r) => r.id === id);
  if (idx < 0) return { ok: false, error: 'Agenda tidak ditemukan.' };
  const existing = state.reminders[idx];

  const nextTitle =
    patch.title !== undefined
      ? sanitizeReminderText(patch.title, MAX_REMINDER_TITLE_LEN)
      : existing.title;
  if (!nextTitle) return { ok: false, error: 'Judul agenda wajib diisi.' };

  const nextNote =
    patch.note !== undefined
      ? sanitizeReminderText(patch.note, MAX_REMINDER_NOTE_LEN)
      : existing.note;

  const nextDateISO =
    patch.dateISO !== undefined ? patch.dateISO : existing.dateISO;
  if (!isValidDateISO(nextDateISO)) {
    return { ok: false, error: 'Tanggal agenda tidak valid.' };
  }

  const nextTime =
    patch.timeHHMM !== undefined
      ? normalizeTimeHHMM(patch.timeHHMM)
      : existing.timeHHMM;
  if (!nextTime) return { ok: false, error: 'Format jam harus HH:MM.' };

  const nextRepeat =
    patch.repeat !== undefined ? sanitizeReminderRepeat(patch.repeat) : existing.repeat;
  if (nextRepeat === 'once' && isPastDateISO(nextDateISO)) {
    return { ok: false, error: 'Mode Sekali tidak berlaku untuk tanggal lewat.' };
  }

  const nextEnabled =
    typeof patch.enabled === 'boolean' ? patch.enabled : existing.enabled;

  const updated: ReminderItem = {
    ...existing,
    title: nextTitle,
    note: nextNote,
    dateISO: nextDateISO,
    timeHHMM: nextTime,
    repeat: nextRepeat,
    enabled: nextEnabled,
    snoozedUntilMs: null,
    updatedAtMs: Date.now(),
  };

  const nextReminders = state.reminders.map((r) => (r.id === id ? updated : r));
  // Auto-dismiss any active/queued alert whose reminder was edited/disabled
  const nextQueue = state.alertQueue.filter((a) => a.reminderId !== id);
  if (nextQueue.length === 0 || state.activeAlert?.reminderId === id) {
    stopCalendarAlertChime();
  }

  persistRemindersToStorage(nextReminders);
  setState({ reminders: nextReminders, alertQueue: nextQueue });
  reconcileScheduler('update');
  return { ok: true, item: updated };
}

export function toggleReminderEnabled(id: string): void {
  const target = state.reminders.find((r) => r.id === id);
  if (!target) return;
  const nextEnabled = !target.enabled;
  const nextReminders = state.reminders.map((r) =>
    r.id === id
      ? {
          ...r,
          enabled: nextEnabled,
          snoozedUntilMs: nextEnabled ? r.snoozedUntilMs : null,
          updatedAtMs: Date.now(),
        }
      : r
  );
  // Auto-dismiss active alert if toggled off
  const nextQueue = nextEnabled
    ? state.alertQueue
    : state.alertQueue.filter((a) => a.reminderId !== id);
  if (!nextEnabled && state.activeAlert?.reminderId === id) {
    stopCalendarAlertChime();
  }

  persistRemindersToStorage(nextReminders);
  setState({ reminders: nextReminders, alertQueue: nextQueue });
  reconcileScheduler('toggle');
}

export function removeReminder(id: string): void {
  const nextReminders = state.reminders.filter((r) => r.id !== id);
  const nextQueue = state.alertQueue.filter((a) => a.reminderId !== id);
  if (state.activeAlert?.reminderId === id || nextQueue.length === 0) {
    stopCalendarAlertChime();
  }
  persistRemindersToStorage(nextReminders);
  setState({ reminders: nextReminders, alertQueue: nextQueue });
  reconcileScheduler('remove');
}

export function snoozeActiveReminder(
  minutes: number = REMINDER_SNOOZE_DEFAULT_MINUTES
): void {
  const current = state.alertQueue[0];
  if (!current) return;
  const clampedMin = Math.max(1, Math.min(60, Math.round(minutes)));
  const snoozedUntilMs = Date.now() + clampedMin * 60_000;

  const nextReminders = state.reminders.map((item) =>
    item.id === current.reminderId
      ? { ...item, snoozedUntilMs, updatedAtMs: Date.now() }
      : item
  );
  const nextQueue = state.alertQueue.slice(1);

  stopCalendarAlertChime();
  playChimeCue('tap');
  persistRemindersToStorage(nextReminders);
  setState({ reminders: nextReminders, alertQueue: nextQueue });
  reconcileScheduler('snooze');
}

export function dismissActiveReminder(): void {
  if (state.alertQueue.length === 0) return;
  const nextQueue = state.alertQueue.slice(1);
  stopCalendarAlertChime();
  playChimeCue('tap');
  setState({ alertQueue: nextQueue });
  reconcileScheduler('dismiss');
}

export { stopCalendarAlertChime };

export function setCalendarRuntimeFullscreenState(
  isFullscreen: boolean,
  behavior?: CasaFullscreenBehavior
): void {
  const prevTotalHide = runtimeIsFullscreen && runtimeFullscreenBehavior === 'total-hide';
  runtimeIsFullscreen = isFullscreen;
  if (behavior) {
    runtimeFullscreenBehavior = behavior;
  } else {
    runtimeFullscreenBehavior = getSettingsSnapshot().fullscreenBehavior;
  }
  const nextTotalHide = runtimeIsFullscreen && runtimeFullscreenBehavior === 'total-hide';
  if (prevTotalHide && !nextTotalHide) {
    reconcileScheduler('fullscreen-exit');
  }
}

export function notifyCalendarSettingsChanged(): void {
  runtimeFullscreenBehavior = getSettingsSnapshot().fullscreenBehavior;
  reconcileScheduler('settings-changed');
}

export function startCalendarSchedulerEngine(): () => void {
  if (engineOwned) {
    reconcileScheduler('rebind');
    return () => {};
  }
  engineOwned = true;
  isColdBootEvaluation = true;
  runtimeFullscreenBehavior = getSettingsSnapshot().fullscreenBehavior;
  reconcileScheduler('boot');

  const onStorage = (event: StorageEvent) => {
    if (
      event.key !== null &&
      event.key !== SETTINGS_STORAGE_KEY &&
      event.key !== CALENDAR_REMINDERS_STORAGE_KEY
    ) {
      return;
    }
    if (event.key === CALENDAR_REMINDERS_STORAGE_KEY || event.key === null) {
      setState({ reminders: loadRemindersFromStorage() });
    }
    reconcileScheduler('storage');
  };

  const onWake = () => {
    const settings = getSettingsSnapshot();
    if (!settings.calendarEnabled || state.reminders.every((r) => !r.enabled)) {
      return;
    }
    reconcileScheduler('wake');
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
        reconcileScheduler('tauri-settings');
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
    clearAllTimers();
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

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): CalendarStoreState {
  return state;
}

export function useCalendarStore(): CalendarStoreState {
  return useSyncExternalStore(subscribe, getSnapshot, () => INITIAL_STATE);
}
