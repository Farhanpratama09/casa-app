/**
 * Unit Tests for Pengingat Ibadah T-0 Scheduler & Offset Minute Adjustments
 * Exercises `src/features/ibadah/prayerScheduleLogic.ts` directly in Node.
 */

import assert from 'node:assert/strict';
import {
  buildPrayerFireKey,
  evaluateDuePrayerDecision,
  pruneFiredPrayerMap,
} from '../src/features/ibadah/prayerScheduleLogic.ts';

let passed = 0;
function check(cond, label) {
  assert.ok(cond, label);
  passed++;
  console.log(`  [PASS] ${label}`);
}

const MIN_MS = 60 * 1000;
const DAY_KEY = '2026-11-21';
const t = (h, m, s = 0, ms = 0) => Date.UTC(2026, 10, 21, h - 7, m, s, ms);

function run() {
  console.log('\n[CASA Ibadah T-0 Scheduler & Minute-Offset Unit Tests]\n');

  const firedMap = {};

  // 1. Cold boot 10 min after Subuh (04:08 when clock is 04:18:20) suppresses ONLY 04:08
  const coldSubuhTs = t(4, 8, 0);
  const bootDecision = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'fajr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: coldSubuhTs,
    nowMs: t(4, 18, 20),
    lastTickWallClockMs: null,
    firedMap,
  });
  check(
    bootDecision.action === 'suppress_stale',
    'Cold boot 10m after Subuh (04:08 at 04:18) suppresses stale prayer'
  );
  firedMap[bootDecision.fireKey] = t(4, 18, 20);

  // 2. Shifting Subuh +11m (04:08 -> 04:19:00) MUST trigger cleanly at 04:19:00 even after 04:08 was suppressed
  const shiftedFutureTs = t(4, 19, 0);
  const beforeShifted = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'fajr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: coldSubuhTs,
    nowMs: t(4, 18, 59),
    lastTickWallClockMs: t(4, 18, 58),
    firedMap,
  });
  check(
    beforeShifted.action === 'already_fired',
    'Stale 04:08 remains locked before 04:19 arrives'
  );

  const atShiftedMinute = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'fajr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: shiftedFutureTs,
    nowMs: t(4, 19, 0, 500),
    lastTickWallClockMs: t(4, 18, 59, 500),
    firedMap,
  });
  check(
    atShiftedMinute.action === 'trigger',
    'Shifted Subuh (+11m -> 04:19:00) triggers Adzan cleanly even though 04:08 was suppressed'
  );
  firedMap[atShiftedMinute.fireKey] = t(4, 19, 0, 500);

  // 3. Same minute does NOT re-trigger after Stop / theme change
  const sameMinuteAgain = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'fajr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: shiftedFutureTs,
    nowMs: t(4, 19, 15),
    lastTickWallClockMs: t(4, 19, 14),
    firedMap,
  });
  check(
    sameMinuteAgain.action === 'already_fired',
    'Same scheduled minute (04:19) never double-fires within the same minute'
  );

  // 4. Re-testing same prayer a second time by moving offset +1m forward -> 04:20:00 triggers again
  const retestTs = t(4, 20, 0);
  const retestDecision = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'fajr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: retestTs,
    nowMs: t(4, 20, 0, 800),
    lastTickWallClockMs: t(4, 19, 59, 800),
    firedMap,
  });
  check(
    retestDecision.action === 'trigger',
    'Adjusting offset +1m to 04:20 allows re-testing Adzan Subuh again'
  );
  firedMap[retestDecision.fireKey] = t(4, 20, 0, 800);

  // 5. Adjusting offset directly onto the CURRENT minute (clock 04:22:55, adjusted to 04:22:00)
  // and edge crossing at :59 -> :00.100 (60.1s elapsed <= 65s cold grace)
  const currentMinTs = t(4, 22, 0);
  const directCurrentMin = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'dhuhr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: currentMinTs,
    nowMs: t(4, 23, 0, 100), // 60.1s elapsed after 04:22:00
    lastTickWallClockMs: t(4, 22, 59),
    firedMap,
  });
  check(
    directCurrentMin.action === 'trigger',
    'Setting offset directly onto current minute (04:22:00) triggers within 65s grace window'
  );

  // 6. Overshooting minus offset by 2m past current time then adjusting back forward
  const overshootTs = t(4, 21, 0);
  const overshootDecision = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'asr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: overshootTs,
    nowMs: t(4, 23, 30), // 2m30s late while lastTick was 04:23:29
    lastTickWallClockMs: t(4, 23, 29),
    firedMap,
  });
  check(
    overshootDecision.action === 'suppress_stale',
    'Overshooting minus offset by >65s only marks that past minute (04:21)'
  );
  firedMap[overshootDecision.fireKey] = t(4, 23, 30);

  const recoveredTs = t(4, 24, 0);
  const recoveredDecision = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'asr',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: recoveredTs,
    nowMs: t(4, 24, 0, 200),
    lastTickWallClockMs: t(4, 23, 59),
    firedMap,
  });
  check(
    recoveredDecision.action === 'trigger',
    'Stepping forward after minus overshoot still triggers Asr at 04:24:00'
  );

  // 7. Modern Standby / Sleep-Wake catch-up within 5m vs >5m
  const wakeWithin5m = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'maghrib',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: t(17, 55, 0),
    nowMs: t(17, 59, 30), // 4.5m late
    lastTickWallClockMs: t(17, 54, 0),
    firedMap,
  });
  check(
    wakeWithin5m.action === 'trigger',
    'Sleep/wake catch-up within 5 minutes fires Adzan'
  );

  const wakePast5m = evaluateDuePrayerDecision({
    mostRecentPrayerId: 'isha',
    mostRecentPrayerDateKey: DAY_KEY,
    mostRecentPrayerTimestampMs: t(19, 8, 0),
    nowMs: t(19, 14, 0), // 6m late
    lastTickWallClockMs: t(19, 7, 0),
    firedMap,
  });
  check(
    wakePast5m.action === 'suppress_stale',
    'Sleep/wake past 5 minutes is silently suppressed without blasting late Adzan'
  );

  // 8. Legacy 2-segment keys ("2026-11-21:fajr") in localStorage are pruned automatically
  const nowRef = Date.now();
  const validKey = buildPrayerFireKey(DAY_KEY, 'fajr', t(4, 19, 0));
  const cleaned = pruneFiredPrayerMap(
    {
      '2026-11-21:fajr': nowRef - 5000, // legacy unscoped poisoned key
      [validKey]: nowRef - 5000,
      '2026-11-10:fajr:123456': nowRef - 72 * 3600 * 1000, // expired > 48h
    },
    nowRef
  );
  check(
    cleaned['2026-11-21:fajr'] === undefined &&
      cleaned[validKey] === nowRef - 5000 &&
      cleaned['2026-11-10:fajr:123456'] === undefined,
    'Prunes legacy 2-segment unscoped fired keys and expired entries cleanly'
  );

  console.log(`\n  PRAYER SCHEDULER UNIT TESTS: ${passed} passed, 0 failed\n`);
}

run();
