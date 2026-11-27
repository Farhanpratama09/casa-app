/**
 * calendarScheduleLogic.ts
 * Pure scheduling, sanitization, monthly grid & reminder evaluation logic for CASA v2.5.0.
 * Zero DOM / React / Tauri runtime dependencies so both browser runtime and Node unit tests import it directly.
 */

export const CALENDAR_REMINDERS_STORAGE_KEY = 'casa_reminders_v1';
export const CALENDAR_FIRED_STORAGE_KEY = 'casa_reminder_fired_v1';

export const MAX_REMINDER_ITEMS = 50;
export const MAX_REMINDER_TITLE_LEN = 80;
export const MAX_REMINDER_NOTE_LEN = 140;

export const REMINDER_HEADS_UP_MINUTES = 5;
export const REMINDER_LEAD_MS = REMINDER_HEADS_UP_MINUTES * 60 * 1000; // <= 5 minutes satellite pill / header chip
export const REMINDER_SNOOZE_DEFAULT_MINUTES = 5;
export const REMINDER_WAKE_GRACE_MS = 5 * 60 * 1000; // 5 minutes post-wake / post-fullscreen grace
export const REMINDER_COLD_BOOT_GRACE_MS = 65 * 1000;
export const REMINDER_FIRED_PRUNE_MS = 48 * 60 * 60 * 1000; // 48 hours

export type ReminderRepeat = 'once' | 'daily' | 'weekdays';

export interface ReminderItem {
  id: string;
  title: string;
  note: string;
  dateISO: string; // YYYY-MM-DD (local date anchor)
  timeHHMM: string; // HH:MM (24-hour local)
  repeat: ReminderRepeat;
  enabled: boolean;
  snoozedUntilMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface UpcomingReminderBadge {
  reminderId: string;
  title: string;
  targetMs: number;
  remainingMs: number;
  remainingMinutes: number;
  formattedLabel: string;
  isSnoozed: boolean;
}

export interface DueReminderAlert {
  fireKey: string;
  reminderId: string;
  title: string;
  note: string;
  scheduledTimeHHMM: string;
  targetMs: number;
  isSnoozed: boolean;
}

export interface MonthCalendarCell {
  dateISO: string;
  day: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  isPast: boolean;
  isWeekend: boolean;
  onceCount: number;
  hasRecurring: boolean;
}

export interface CalendarEvaluationOptions {
  nowMs: number;
  firedKeys?: Record<string, number>;
  wakeGraceMs?: number;
}

export interface CalendarEvaluationResult {
  upcomingBadge: UpcomingReminderBadge | null;
  newlyDueAlerts: DueReminderAlert[];
  prunedFiredKeys: Record<string, number>;
  nextWakeAtMs: number | null;
  hadSnoozeClearIds: string[];
}

const CONTROL_AND_BIDI_RE =
  /[\u0000-\u001F\u007F\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g;
const HTML_TAG_RE = /<[^>]*>/g;

/**
 * Strips HTML tags, ASCII control chars & Unicode bidi overrides, collapses whitespace, and enforces max length.
 */
export function sanitizeReminderText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string') return '';
  let cleaned = raw.replace(HTML_TAG_RE, ' ');
  cleaned = cleaned.replace(CONTROL_AND_BIDI_RE, ' ');
  cleaned = cleaned.replace(/\s+/g, ' ').trim();
  if (cleaned.length > maxLen) {
    cleaned = cleaned.slice(0, maxLen).trim();
  }
  return cleaned;
}

export function normalizeTimeHHMM(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  const match = /^(\d{1,2}):(\d{2})$/.exec(trimmed);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (
    !Number.isInteger(hours) ||
    !Number.isInteger(minutes) ||
    hours < 0 ||
    hours > 23 ||
    minutes < 0 ||
    minutes > 59
  ) {
    return null;
  }
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

export function formatLocalDateISO(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function isValidDateISO(raw: unknown): raw is string {
  if (typeof raw !== 'string') return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1970 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) {
    return false;
  }
  const check = new Date(year, month - 1, day, 12, 0, 0, 0);
  return (
    check.getFullYear() === year &&
    check.getMonth() === month - 1 &&
    check.getDate() === day
  );
}

export function shiftLocalDateISO(dateISO: string, deltaDays: number): string {
  if (!isValidDateISO(dateISO)) return formatLocalDateISO(new Date());
  const [y, m, d] = dateISO.split('-').map(Number);
  const shifted = new Date(y, m - 1, d + deltaDays, 12, 0, 0, 0);
  return formatLocalDateISO(shifted);
}

export function parseLocalDateTimeMs(dateISO: string, timeHHMM: string): number | null {
  if (!isValidDateISO(dateISO)) return null;
  const normalizedTime = normalizeTimeHHMM(timeHHMM);
  if (!normalizedTime) return null;
  const [y, m, d] = dateISO.split('-').map(Number);
  const [hh, mm] = normalizedTime.split(':').map(Number);
  const dt = new Date(y, m - 1, d, hh, mm, 0, 0);
  const ms = dt.getTime();
  return Number.isFinite(ms) ? ms : null;
}

export function isPastDateISO(dateISO: string, now: Date = new Date()): boolean {
  if (!isValidDateISO(dateISO)) return true;
  return dateISO < formatLocalDateISO(now);
}

export function getDayOfWeekFromDateISO(dateISO: string): number {
  const [y, m, d] = dateISO.split('-').map(Number);
  return new Date(y, m - 1, d, 12, 0, 0, 0).getDay(); // 0=Sun..6=Sat
}

export function sanitizeReminderRepeat(raw: unknown): ReminderRepeat {
  if (raw === 'daily' || raw === 'weekdays' || raw === 'once') {
    return raw;
  }
  return 'once';
}

export function sanitizeReminderItem(raw: unknown): ReminderItem | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const id = sanitizeReminderText(obj.id, 64).replace(/[^a-zA-Z0-9_-]/g, '');
  const title = sanitizeReminderText(obj.title, MAX_REMINDER_TITLE_LEN);
  const note = sanitizeReminderText(obj.note, MAX_REMINDER_NOTE_LEN);
  const timeHHMM = normalizeTimeHHMM(obj.timeHHMM);
  if (!id || !title || !timeHHMM || !isValidDateISO(obj.dateISO)) {
    return null;
  }
  const repeat = sanitizeReminderRepeat(obj.repeat);
  const enabled = typeof obj.enabled === 'boolean' ? obj.enabled : true;
  const snoozedUntilMs =
    typeof obj.snoozedUntilMs === 'number' &&
    Number.isFinite(obj.snoozedUntilMs) &&
    obj.snoozedUntilMs > 0
      ? Math.floor(obj.snoozedUntilMs)
      : null;
  const createdAtMs =
    typeof obj.createdAtMs === 'number' && Number.isFinite(obj.createdAtMs)
      ? Math.floor(obj.createdAtMs)
      : Date.now();
  const updatedAtMs =
    typeof obj.updatedAtMs === 'number' && Number.isFinite(obj.updatedAtMs)
      ? Math.floor(obj.updatedAtMs)
      : createdAtMs;

  return {
    id,
    title,
    note,
    dateISO: obj.dateISO,
    timeHHMM,
    repeat,
    enabled,
    snoozedUntilMs,
    createdAtMs,
    updatedAtMs,
  };
}

export function sanitizeReminderList(raw: unknown): ReminderItem[] {
  if (!Array.isArray(raw)) return [];
  const seenIds = new Set<string>();
  const result: ReminderItem[] = [];
  for (const entry of raw) {
    if (result.length >= MAX_REMINDER_ITEMS) break;
    const clean = sanitizeReminderItem(entry);
    if (!clean || seenIds.has(clean.id)) continue;
    seenIds.add(clean.id);
    result.push(clean);
  }
  return result;
}

export function pruneFiredReminderMap(
  raw: unknown,
  nowMs: number = Date.now()
): Record<string, number> {
  if (!raw || typeof raw !== 'object') return {};
  const input = raw as Record<string, unknown>;
  const pruned: Record<string, number> = {};
  for (const [key, val] of Object.entries(input)) {
    if (typeof key !== 'string' || key.length === 0 || key.length > 160) continue;
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    if (nowMs - val <= REMINDER_FIRED_PRUNE_MS && val <= nowMs + 60_000) {
      pruned[key] = val;
    }
  }
  return pruned;
}

export function doesReminderOccurOnDate(item: ReminderItem, dateISO: string): boolean {
  if (!isValidDateISO(dateISO)) return false;

  if (item.snoozedUntilMs !== null && Number.isFinite(item.snoozedUntilMs)) {
    const snoozeDateISO = formatLocalDateISO(new Date(item.snoozedUntilMs));
    if (snoozeDateISO === dateISO) return true;
  }

  if (item.repeat === 'once') {
    return item.dateISO === dateISO;
  }

  if (dateISO < item.dateISO) {
    return false;
  }

  if (item.repeat === 'daily') {
    return true;
  }

  // 'weekdays': Mon (1) .. Fri (5)
  const dow = getDayOfWeekFromDateISO(dateISO);
  return dow >= 1 && dow <= 5;
}

export function getRemindersForDate(
  reminders: ReminderItem[],
  dateISO: string
): ReminderItem[] {
  return reminders
    .filter((item) => doesReminderOccurOnDate(item, dateISO))
    .slice()
    .sort((a, b) => {
      if (a.timeHHMM !== b.timeHHMM) {
        return a.timeHHMM < b.timeHHMM ? -1 : 1;
      }
      if (a.createdAtMs !== b.createdAtMs) {
        return a.createdAtMs - b.createdAtMs;
      }
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    });
}

/**
 * Builds Monday-first monthly calendar grid cells containing full 1..31 days of the viewed month.
 */
export function getMonthCalendarCells(
  year: number,
  monthIndex0: number,
  reminders: ReminderItem[],
  now: Date = new Date()
): MonthCalendarCell[] {
  const firstOfMonth = new Date(year, monthIndex0, 1, 12, 0, 0, 0);
  const actualYear = firstOfMonth.getFullYear();
  const actualMonth = firstOfMonth.getMonth();
  const daysInMonth = new Date(actualYear, actualMonth + 1, 0, 12, 0, 0, 0).getDate();

  // Monday = 0, Tuesday = 1, ..., Sunday = 6
  const firstDowMon0 = (firstOfMonth.getDay() + 6) % 7;
  const totalNeeded = firstDowMon0 + daysInMonth;
  const totalCells = totalNeeded > 35 ? 42 : 35;
  const todayISO = formatLocalDateISO(now);

  const onceCountByDate = new Map<string, number>();
  let anyActiveRecurring = false;
  for (const item of reminders) {
    if (!item.enabled) continue;
    if (item.repeat === 'once') {
      onceCountByDate.set(item.dateISO, (onceCountByDate.get(item.dateISO) ?? 0) + 1);
    } else {
      anyActiveRecurring = true;
    }
  }

  const cells: MonthCalendarCell[] = [];
  for (let i = 0; i < totalCells; i++) {
    const cellDate = new Date(actualYear, actualMonth, 1 - firstDowMon0 + i, 12, 0, 0, 0);
    const dateISO = formatLocalDateISO(cellDate);
    const dow = cellDate.getDay();
    const isWeekend = dow === 0 || dow === 6;
    const hasRecurring =
      anyActiveRecurring &&
      reminders.some(
        (item) =>
          item.enabled && item.repeat !== 'once' && doesReminderOccurOnDate(item, dateISO)
      );

    cells.push({
      dateISO,
      day: cellDate.getDate(),
      inCurrentMonth: cellDate.getMonth() === actualMonth,
      isToday: dateISO === todayISO,
      isPast: dateISO < todayISO,
      isWeekend,
      onceCount: onceCountByDate.get(dateISO) ?? 0,
      hasRecurring,
    });
  }

  return cells;
}

interface CandidateOccurrence {
  reminder: ReminderItem;
  fireKey: string;
  targetMs: number;
  scheduledTimeHHMM: string;
  isSnoozed: boolean;
}

function collectCandidateOccurrences(
  item: ReminderItem,
  nowMs: number
): CandidateOccurrence[] {
  if (!item.enabled) return [];

  if (item.snoozedUntilMs !== null && Number.isFinite(item.snoozedUntilMs)) {
    const targetMs = item.snoozedUntilMs;
    const snoozeDt = new Date(targetMs);
    const hh = String(snoozeDt.getHours()).padStart(2, '0');
    const mm = String(snoozeDt.getMinutes()).padStart(2, '0');
    return [
      {
        reminder: item,
        fireKey: `snooze:${item.id}:${Math.floor(targetMs / 1000)}`,
        targetMs,
        scheduledTimeHHMM: `${hh}:${mm}`,
        isSnoozed: true,
      },
    ];
  }

  if (item.repeat === 'once') {
    const targetMs = parseLocalDateTimeMs(item.dateISO, item.timeHHMM);
    if (targetMs === null) return [];
    return [
      {
        reminder: item,
        fireKey: `once:${item.dateISO}:${item.id}:${item.timeHHMM}`,
        targetMs,
        scheduledTimeHHMM: item.timeHHMM,
        isSnoozed: false,
      },
    ];
  }

  const todayISO = formatLocalDateISO(new Date(nowMs));
  const candidateDates = [
    shiftLocalDateISO(todayISO, -1),
    todayISO,
    shiftLocalDateISO(todayISO, 1),
  ];

  const out: CandidateOccurrence[] = [];
  for (const dateISO of candidateDates) {
    if (dateISO < item.dateISO) continue;
    if (item.repeat === 'weekdays') {
      const dow = getDayOfWeekFromDateISO(dateISO);
      if (dow === 0 || dow === 6) continue;
    }
    const targetMs = parseLocalDateTimeMs(dateISO, item.timeHHMM);
    if (targetMs === null) continue;
    out.push({
      reminder: item,
      fireKey: `${item.repeat}:${dateISO}:${item.id}:${item.timeHHMM}`,
      targetMs,
      scheduledTimeHHMM: item.timeHHMM,
      isSnoozed: false,
    });
  }
  return out;
}

/**
 * Evaluates all enabled reminders against wall-clock `nowMs`:
 * - Collects due alerts (`T-0`) within `wakeGraceMs` (5m) in strict FIFO order.
 * - Suppresses stale missed alerts older than `wakeGraceMs` (Sleep/Hibernate protection).
 * - Selects earliest `H-15m` countdown badge (handles midnight crossover `23:55 -> 00:05`).
 * - Computes exact `nextWakeAtMs` for single-shot precision scheduling (Idle Zero-Churn).
 */
export function evaluateCalendarSnapshot(
  reminders: ReminderItem[],
  options: CalendarEvaluationOptions
): CalendarEvaluationResult {
  const nowMs = options.nowMs;
  const wakeGraceMs = options.wakeGraceMs ?? REMINDER_WAKE_GRACE_MS;
  const prunedFiredKeys = pruneFiredReminderMap(options.firedKeys ?? {}, nowMs);

  const dueCandidates: { alert: DueReminderAlert; createdAtMs: number }[] = [];
  let bestUpcoming: UpcomingReminderBadge | null = null;
  let nextWakeAtMs: number | null = null;
  const hadSnoozeClearIds: string[] = [];

  const registerWake = (ts: number) => {
    if (!Number.isFinite(ts) || ts <= nowMs) return;
    if (nextWakeAtMs === null || ts < nextWakeAtMs) {
      nextWakeAtMs = ts;
    }
  };

  for (const item of reminders) {
    if (!item.enabled) continue;
    const candidates = collectCandidateOccurrences(item, nowMs);

    for (const cand of candidates) {
      if (prunedFiredKeys[cand.fireKey] !== undefined) {
        continue;
      }

      const diffPastMs = nowMs - cand.targetMs;
      if (diffPastMs >= 0) {
        if (diffPastMs <= wakeGraceMs) {
          dueCandidates.push({
            alert: {
              fireKey: cand.fireKey,
              reminderId: item.id,
              title: item.title,
              note: item.note,
              scheduledTimeHHMM: cand.scheduledTimeHHMM,
              targetMs: cand.targetMs,
              isSnoozed: cand.isSnoozed,
            },
            createdAtMs: item.createdAtMs,
          });
        } else {
          // Stale missed reminder (> 5m past): mark fired silently to prevent burst after Sleep/Hibernate
          prunedFiredKeys[cand.fireKey] = nowMs;
          if (cand.isSnoozed) {
            hadSnoozeClearIds.push(item.id);
          }
        }
        continue;
      }

      const remainingMs = cand.targetMs - nowMs;
      const leadStartMs = cand.targetMs - REMINDER_LEAD_MS;
      if (leadStartMs > nowMs) {
        registerWake(leadStartMs);
      }
      registerWake(cand.targetMs);

      if (remainingMs <= REMINDER_LEAD_MS) {
        const remainingMinutes = Math.max(1, Math.ceil(remainingMs / 60_000));
        if (
          bestUpcoming === null ||
          cand.targetMs < bestUpcoming.targetMs ||
          (cand.targetMs === bestUpcoming.targetMs &&
            cand.reminder.createdAtMs <
              (reminders.find((r) => r.id === bestUpcoming?.reminderId)?.createdAtMs ?? 0))
        ) {
          bestUpcoming = {
            reminderId: item.id,
            title: item.title,
            targetMs: cand.targetMs,
            remainingMs,
            remainingMinutes,
            formattedLabel: `${remainingMinutes}m · ${item.title}`,
            isSnoozed: cand.isSnoozed,
          };
        }
      }
    }
  }

  dueCandidates.sort((a, b) => {
    if (a.alert.targetMs !== b.alert.targetMs) {
      return a.alert.targetMs - b.alert.targetMs;
    }
    if (a.createdAtMs !== b.createdAtMs) {
      return a.createdAtMs - b.createdAtMs;
    }
    return a.alert.reminderId < b.alert.reminderId
      ? -1
      : a.alert.reminderId > b.alert.reminderId
      ? 1
      : 0;
  });

  return {
    upcomingBadge: bestUpcoming,
    newlyDueAlerts: dueCandidates.map((c) => c.alert),
    prunedFiredKeys,
    nextWakeAtMs,
    hadSnoozeClearIds,
  };
}

const ID_WEEKDAYS = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
const ID_MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'Mei',
  'Jun',
  'Jul',
  'Agu',
  'Sep',
  'Okt',
  'Nov',
  'Des',
];
export const ID_MONTHS_FULL = [
  'Januari',
  'Februari',
  'Maret',
  'April',
  'Mei',
  'Juni',
  'Juli',
  'Agustus',
  'September',
  'Oktober',
  'November',
  'Desember',
];

export function formatAgendaDateHeading(
  dateISO: string,
  now: Date = new Date()
): { label: string; isToday: boolean; isPast: boolean } {
  if (!isValidDateISO(dateISO)) {
    return { label: dateISO, isToday: false, isPast: false };
  }
  const [y, m, d] = dateISO.split('-').map(Number);
  const dt = new Date(y, m - 1, d, 12, 0, 0, 0);
  const todayISO = formatLocalDateISO(now);
  const weekday = ID_WEEKDAYS[dt.getDay()] ?? '';
  const monthShort = ID_MONTHS_SHORT[dt.getMonth()] ?? '';
  return {
    label: `${weekday}, ${d} ${monthShort} ${y}`,
    isToday: dateISO === todayISO,
    isPast: dateISO < todayISO,
  };
}
