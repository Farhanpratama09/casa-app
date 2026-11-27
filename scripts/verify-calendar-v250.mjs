/**
 * Node.js Unit & Security/Architecture Invariant Tests for CASA v2.5.0 (Calendar & Smart Reminders)
 * Exercises `src/features/calendar/calendarScheduleLogic.ts` directly + source invariants across
 * `calendarStore.ts`, `CalendarExpandedView.tsx`, `Mode6TopNav.tsx`, `Mode6ControlCenterView.tsx`,
 * `CasaCompanionAvatar.tsx`, and `islandLayoutState.ts`.
 */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  doesReminderOccurOnDate,
  evaluateCalendarSnapshot,
  formatAgendaDateHeading,
  formatLocalDateISO,
  getMonthCalendarCells,
  getRemindersForDate,
  isPastDateISO,
  MAX_REMINDER_ITEMS,
  MAX_REMINDER_NOTE_LEN,
  MAX_REMINDER_TITLE_LEN,
  normalizeTimeHHMM,
  pruneFiredReminderMap,
  REMINDER_FIRED_PRUNE_MS,
  REMINDER_HEADS_UP_MINUTES,
  REMINDER_WAKE_GRACE_MS,
  sanitizeReminderList,
  sanitizeReminderText,
} from '../src/features/calendar/calendarScheduleLogic.ts';

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`  [PASS] ${label}`);
}

const rootDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const readRepo = (rel) => readFileSync(resolve(rootDir, rel), 'utf8');

function run() {
  console.log('\n[CASA v2.5.0 Calendar & Smart Reminders Tests]\n');

  // 1. Input Sanitization (HTML/Script stripping, bidi/control removal, length caps)
  const cleanTitle = sanitizeReminderText(
    '<script>alert(1)</script>Standup\u202E \u0007Tim   Pagi',
    MAX_REMINDER_TITLE_LEN
  );
  check(
    cleanTitle === 'alert(1) Standup Tim Pagi' && !/[<>]/.test(cleanTitle),
    'sanitizeReminderText strips HTML tags, control chars & bidi overrides cleanly'
  );

  const longTitle = sanitizeReminderText('A'.repeat(120), MAX_REMINDER_TITLE_LEN);
  const longNote = sanitizeReminderText('B'.repeat(200), MAX_REMINDER_NOTE_LEN);
  check(
    longTitle.length === MAX_REMINDER_TITLE_LEN &&
      longNote.length === MAX_REMINDER_NOTE_LEN,
    `Length caps enforce title <= ${MAX_REMINDER_TITLE_LEN} & note <= ${MAX_REMINDER_NOTE_LEN}`
  );

  check(
    normalizeTimeHHMM('9:05') === '09:05' &&
      normalizeTimeHHMM('23:59') === '23:59' &&
      normalizeTimeHHMM('24:00') === null &&
      normalizeTimeHHMM('12:75') === null,
    'normalizeTimeHHMM validates and zero-pads HH:MM strictly'
  );

  // 2. MAX_REMINDER_ITEMS = 50 cap & item sanitization
  const rawOverflow = Array.from({ length: 65 }, (_, i) => ({
    id: `rem_${i}`,
    title: `Agenda <b>${i}</b>`,
    note: '',
    dateISO: '2026-11-27',
    timeHHMM: '09:00',
    repeat: i % 2 === 0 ? 'once' : 'daily',
    enabled: true,
    snoozedUntilMs: null,
    createdAtMs: 1000 + i,
    updatedAtMs: 1000 + i,
  }));
  const sanitizedList = sanitizeReminderList(rawOverflow);
  check(
    sanitizedList.length === MAX_REMINDER_ITEMS &&
      sanitizedList[0].title === 'Agenda 0',
    `sanitizeReminderList caps persisted items at MAX_REMINDER_ITEMS=${MAX_REMINDER_ITEMS}`
  );

  // 3. Full Monthly Grid (1..31) & Past Date detection
  const novCells = getMonthCalendarCells(2026, 10, [], new Date(2026, 10, 26, 12, 0, 0));
  const decCells = getMonthCalendarCells(2026, 11, [], new Date(2026, 10, 26, 12, 0, 0));
  const novInMonthDays = novCells.filter((c) => c.inCurrentMonth).map((c) => c.day);
  const decInMonthDays = decCells.filter((c) => c.inCurrentMonth).map((c) => c.day);
  check(
    novInMonthDays.length === 30 &&
      novInMonthDays[0] === 1 &&
      novInMonthDays[29] === 30 &&
      decInMonthDays.length === 31 &&
      decInMonthDays[30] === 31 &&
      isPastDateISO('2026-11-25', new Date(2026, 10, 26, 12, 0, 0)) === true &&
      isPastDateISO('2026-11-26', new Date(2026, 10, 26, 12, 0, 0)) === false,
    'Monthly calendar grid covers full 1..30 / 1..31 days & past-date check works'
  );

  // 4. Repeat rules: once, daily, weekdays (Mon-Fri only)
  const weekdayItem = {
    id: 'w1',
    title: 'Standup',
    note: '',
    dateISO: '2026-11-26', // Thursday
    timeHHMM: '09:00',
    repeat: 'weekdays',
    enabled: true,
    snoozedUntilMs: null,
    createdAtMs: 1000,
    updatedAtMs: 1000,
  };
  check(
    doesReminderOccurOnDate(weekdayItem, '2026-11-27') === true && // Friday
      doesReminderOccurOnDate(weekdayItem, '2026-11-28') === false && // Saturday
      doesReminderOccurOnDate(weekdayItem, '2026-11-29') === false && // Sunday
      doesReminderOccurOnDate(weekdayItem, '2026-11-30') === true, // Monday
    'Repeat weekdays filters Mon-Fri and excludes Sat/Sun accurately'
  );

  // 5. Midnight Crossover (23:55 -> 00:05 suppressed because >5m, 00:01 -> 00:05 shows <=5m badge, 00:05 fires T-0)
  const midnightDaily = {
    id: 'm1',
    title: 'Backup Malam',
    note: '',
    dateISO: '2026-11-26',
    timeHHMM: '00:05',
    repeat: 'daily',
    enabled: true,
    snoozedUntilMs: null,
    createdAtMs: 1000,
    updatedAtMs: 1000,
  };
  const at2355 = new Date(2026, 10, 26, 23, 55, 0, 0).getTime();
  const eval2355 = evaluateCalendarSnapshot([midnightDaily], { nowMs: at2355 });
  const at0000 = new Date(2026, 10, 27, 0, 0, 0, 0).getTime();
  const eval0000 = evaluateCalendarSnapshot([midnightDaily], { nowMs: at0000 });
  check(
    REMINDER_HEADS_UP_MINUTES === 5 &&
      eval2355.upcomingBadge === null &&
      eval2355.newlyDueAlerts.length === 0 &&
      eval0000.upcomingBadge !== null &&
      eval0000.upcomingBadge.remainingMinutes === 5,
    'Heads-up threshold (REMINDER_HEADS_UP_MINUTES=5) hides >5m (23:55->00:05) and shows <=5m (00:00->00:05)'
  );

  const at0005 = new Date(2026, 10, 27, 0, 5, 0, 0).getTime();
  const eval0005 = evaluateCalendarSnapshot([midnightDaily], { nowMs: at0005 });
  check(
    eval0005.newlyDueAlerts.length === 1 &&
      eval0005.newlyDueAlerts[0].title === 'Backup Malam',
    'Midnight crossover at 00:05 triggers T-0 alert cleanly'
  );

  // 6. Cross-Midnight Snooze 5 minutes (23:58 -> 00:03)
  const at2358 = new Date(2026, 10, 26, 23, 58, 0, 0).getTime();
  const snoozeTarget = at2358 + 5 * 60 * 1000; // 2026-11-27 00:03:00
  const snoozedOnce = {
    id: 's1',
    title: 'Obat Malam',
    note: '',
    dateISO: '2026-11-26',
    timeHHMM: '23:58',
    repeat: 'once',
    enabled: true,
    snoozedUntilMs: snoozeTarget,
    createdAtMs: 1000,
    updatedAtMs: at2358,
  };
  const eval0001 = evaluateCalendarSnapshot([snoozedOnce], {
    nowMs: new Date(2026, 10, 27, 0, 1, 0, 0).getTime(),
  });
  const eval0003 = evaluateCalendarSnapshot([snoozedOnce], {
    nowMs: snoozeTarget,
  });
  check(
    eval0001.upcomingBadge?.isSnoozed === true &&
      eval0001.upcomingBadge?.remainingMinutes === 2 &&
      eval0003.newlyDueAlerts.length === 1 &&
      eval0003.newlyDueAlerts[0].isSnoozed === true &&
      getRemindersForDate([snoozedOnce], '2026-11-27').length === 1,
    'Cross-midnight Snooze 5m (23:58 -> 00:03) counts down & fires via epoch timestamp'
  );

  // 7. FIFO multi-alert same minute & 5-minute Sleep/Hibernate wake grace window
  const fifoA = {
    id: 'a1',
    title: 'Pertama',
    note: '',
    dateISO: '2026-11-27',
    timeHHMM: '09:00',
    repeat: 'once',
    enabled: true,
    snoozedUntilMs: null,
    createdAtMs: 1000,
    updatedAtMs: 1000,
  };
  const fifoB = {
    id: 'b2',
    title: 'Kedua',
    note: '',
    dateISO: '2026-11-27',
    timeHHMM: '09:00',
    repeat: 'once',
    enabled: true,
    snoozedUntilMs: null,
    createdAtMs: 2000,
    updatedAtMs: 2000,
  };
  const at0903 = new Date(2026, 10, 27, 9, 3, 0, 0).getTime(); // 3m late (within 5m grace)
  const evalFifo = evaluateCalendarSnapshot([fifoB, fifoA], {
    nowMs: at0903,
    wakeGraceMs: REMINDER_WAKE_GRACE_MS,
  });
  check(
    evalFifo.newlyDueAlerts.length === 2 &&
      evalFifo.newlyDueAlerts[0].title === 'Pertama' &&
      evalFifo.newlyDueAlerts[1].title === 'Kedua',
    'Same-minute alerts queue strictly FIFO and trigger within 5-minute wake grace window'
  );

  const at0912 = new Date(2026, 10, 27, 9, 12, 0, 0).getTime(); // 12m late (> 5m grace)
  const evalStale = evaluateCalendarSnapshot([fifoA], {
    nowMs: at0912,
    wakeGraceMs: REMINDER_WAKE_GRACE_MS,
  });
  check(
    evalStale.newlyDueAlerts.length === 0 &&
      Object.keys(evalStale.prunedFiredKeys).length === 1,
    'Stale missed alerts (> 5m after Sleep/Hibernate) are silently suppressed & marked fired'
  );

  // 8. Dedupe pruning (> 48h) & heading formatting
  const baseNow = Date.now();
  const prunedMap = pruneFiredReminderMap(
    {
      old: baseNow - REMINDER_FIRED_PRUNE_MS - 10_000,
      fresh: baseNow - 60_000,
    },
    baseNow
  );
  const heading = formatAgendaDateHeading('2026-11-26', new Date(2026, 10, 26, 12, 0, 0));
  check(
    prunedMap.old === undefined &&
      prunedMap.fresh !== undefined &&
      heading.isToday &&
      heading.label.includes('26 Nov 2026') &&
      formatLocalDateISO(new Date(2026, 10, 26, 23, 59, 0)) === '2026-11-26',
    'Fired dedupe map prunes > 48h keys & local date heading formats cleanly'
  );

  // 9. Source-Level Invariants (Zero-Churn, 7-Tab Order, Monochrome Zero Color-Leak, Canvas Dimensions)
  console.log('\n[CASA v2.5.0 Architecture & Monochrome Invariants]\n');
  const calendarStoreTs = readRepo('src/features/calendar/calendarStore.ts');
  const calendarViewTsx = readRepo('src/features/calendar/CalendarExpandedView.tsx');
  const topNavTsx = readRepo('src/components/views/Mode6TopNav.tsx');
  const controlCenterTsx = readRepo('src/components/views/mode6/Mode6ControlCenterView.tsx');
  const avatarTsx = readRepo('src/components/companion/CasaCompanionAvatar.tsx');
  const layoutTs = readRepo('src/utils/islandLayoutState.ts');

  check(
    calendarStoreTs.includes('if (!settings.calendarEnabled || enabledCount === 0)') &&
      calendarStoreTs.includes('clearAllTimers()') &&
      calendarStoreTs.includes('const needsLiveTicker = result.upcomingBadge !== null || nextQueue.length > 0'),
    'calendarStore.ts enforces Idle Zero-Churn (0 timers when disabled or empty; 1s ticker only when H-15m/T-0 active)'
  );

  const controlIdx = topNavTsx.indexOf('CONTROL_NAV_TAB');
  const calcIdx = topNavTsx.indexOf('CALCULATOR_NAV_TAB');
  const calIdx = topNavTsx.indexOf('CALENDAR_NAV_TAB');
  const navStart = topNavTsx.indexOf('const navTabs: NavTabSpec[] =');
  const navOrderBlock = topNavTsx.slice(
    navStart,
    topNavTsx.indexOf('return (', navStart)
  );
  check(
    calcIdx > 0 &&
      calIdx > calcIdx &&
      controlIdx > calIdx &&
      navOrderBlock.includes('CALENDAR_NAV_TAB') &&
      navOrderBlock.lastIndexOf('CONTROL_NAV_TAB') > navOrderBlock.lastIndexOf('CALENDAR_NAV_TAB') &&
      topNavTsx.includes("activeIconColor: '#FB7185'") &&
      topNavTsx.includes("isMonochrome ? '#FFFFFF' : tab.activeIconColor"),
    'Mode6TopNav.tsx locks 7-tab order with Jadwal (#FB7185) before Kontrol & monochrome #FFFFFF override'
  );

  const staticColorLeakRe = /(text|bg|border)-(rose|emerald|green|amber|sky|violet|indigo)-(300|400|500|600)/;
  check(
    !staticColorLeakRe.test(calendarViewTsx) &&
      !staticColorLeakRe.test(controlCenterTsx) &&
      calendarViewTsx.includes("settings.theme === 'monochrome'") &&
      controlCenterTsx.includes('data-quick-module-toggle="calendar"'),
    'CalendarExpandedView & Mode6ControlCenterView obey Monochrome Zero Color-Leak rule'
  );

  const resolverBody = avatarTsx.slice(
    avatarTsx.indexOf('export function resolveCompanionExpression'),
    avatarTsx.indexOf('export interface CasaCompanionAvatarProps')
  );
  check(
    resolverBody.indexOf("return 'alarm'") > 0 &&
      resolverBody.indexOf("return 'reminder_t0'") > resolverBody.indexOf("return 'alarm'") &&
      resolverBody.indexOf("return 'dual_active'") > resolverBody.indexOf("return 'reminder_t0'"),
    'CasaCompanionAvatar.tsx ranks reminder_t0 (◉ ♥) strictly below alarm and above dual_active'
  );

  check(
    layoutTs.includes('EXPANDED_CALENDAR_WIDTH: 560') &&
      layoutTs.includes('EXPANDED_CALENDAR_HEIGHT: 216') &&
      layoutTs.includes('REMINDER_BANNER_WIDTH: 296') &&
      layoutTs.includes('REMINDER_SATELLITE_MAX_WIDTH: 168') &&
      layoutTs.includes('REMINDER_SATELLITE_HEIGHT: 36') &&
      layoutTs.includes('computeReminderSatelliteBounds') &&
      !/\binnerHTML\b|\beval\s*\(|new\s+Function\s*\(/.test(calendarStoreTs + calendarViewTsx),
    'islandLayoutState.ts defines 560x216 Calendar + 36x168 detached satellite bounds with zero unsafe DOM/eval'
  );

  // 10. Smart Audio Arbitration + <=5m Satellite/Header Chip + UX Polish Invariants
  const idlePillTsx = readRepo('src/components/views/IdlePillView.tsx');
  const casaIslandTsx = readRepo('src/components/CasaIsland.tsx');
  const prayerStoreTs = readRepo('src/features/ibadah/prayerStore.ts');

  check(
    !idlePillTsx.includes('reminderH15Badge') &&
      casaIslandTsx.includes('data-reminder-satellite="true"') &&
      casaIslandTsx.includes('computeReminderSatelliteBounds') &&
      topNavTsx.includes('data-header-reminder-chip="true"'),
    'Idle mode moves <=5m badge to detached right satellite pill (Clean IdlePillView) & Expanded mode uses header chip'
  );

  check(
    calendarViewTsx.includes('showTodayShortcut') &&
      calendarViewTsx.includes("label: 'Sen–Jum'") &&
      controlCenterTsx.includes("color: '#10B981'") &&
      controlCenterTsx.includes("color: '#FB923C'") &&
      controlCenterTsx.includes("color: '#FB7185'"),
    'UX Polishes: Contextual Hari Ini button, Sen-Jum weekday option & aligned #10B981/#FB923C/#FB7185 Control Center chips'
  );

  const calendarChimeTs = readRepo('src/features/calendar/calendarChime.ts');
  const alarmChimeTs = readRepo('src/utils/alarmChime.ts');
  const tauriConfJson = readRepo('src-tauri/tauri.conf.json');

  check(
    prayerStoreTs.includes('pausedByAdzan') &&
      prayerStoreTs.includes('pauseSmtcForAdzan') &&
      prayerStoreTs.includes('resumeSmtcAfterAdzan') &&
      calendarStoreTs.includes('stopCalendarAlertChime') &&
      calendarStoreTs.includes('isPrayerAlertActive()') &&
      casaIslandTsx.includes("useSkillStore((s) => Boolean(s.skillStates['core.timer']?.isAlarmRinging))") &&
      casaIslandTsx.includes('shouldDuckBackgroundAudio') &&
      casaIslandTsx.includes('setBackgroundAudioDucking(shouldDuckBackgroundAudio)') &&
      tauriConfJson.includes('--autoplay-policy=no-user-gesture-required') &&
      calendarChimeTs.includes('CALENDAR_CHIME_PEAK_GAIN = 0.85') &&
      calendarChimeTs.includes('playCalendarChimeNative') &&
      calendarChimeTs.includes('await ctx.resume()') &&
      alarmChimeTs.includes('ALARM_CHIME_PEAK_GAIN = 0.85') &&
      alarmChimeTs.includes('await ctx.resume()'),
    'Smart Audio: Adzan SMTC pause/resume, autoplay bypass, 0.85 gain native/WebAudio chime & store-driven Core Audio ducking'
  );

  console.log(`\n  CALENDAR v2.5.0 TESTS: ${passed} passed, 0 failed\n`);
}

run();
