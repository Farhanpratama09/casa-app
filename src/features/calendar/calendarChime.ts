/**
 * calendarChime.ts
 * Soft Web Audio API repeating chime for Calendar T-0 reminders.
 * Independent module to prevent circular imports between `prayerStore.ts` and `calendarStore.ts`.
 */

import { getSettingsSnapshot } from '../../stores/useSettingsStore';
import { playCalendarChimeNative, stopCalendarChimeNative } from '../../utils/tauriBridge';

const CHIME_INTERVAL_MS = 4000;
const CHIME_SAFETY_CAP_MS = 48_000;
export const CALENDAR_CHIME_PEAK_GAIN = 0.85;

let audioCtx: AudioContext | null = null;
let repeatInterval: ReturnType<typeof setInterval> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let activeNodes: AudioNode[] = [];
let activeRunId = 0;
let hasRegisteredGestureUnlock = false;

function getAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      audioCtx = new AudioCtx();
    } catch {
      return null;
    }
  }
  return audioCtx;
}

export function unlockCalendarChimeAudio(): void {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  try {
    const silentGain = ctx.createGain();
    silentGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    silentGain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(587.33, ctx.currentTime);
    osc.connect(silentGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.015);
  } catch {
    // Non-fatal unlock attempt
  }
}

if (typeof window !== 'undefined' && !hasRegisteredGestureUnlock) {
  hasRegisteredGestureUnlock = true;
  const handleFirstGesture = () => {
    unlockCalendarChimeAudio();
    if (audioCtx && audioCtx.state === 'running') {
      window.removeEventListener('pointerdown', handleFirstGesture, true);
      window.removeEventListener('keydown', handleFirstGesture, true);
    }
  };
  window.addEventListener('pointerdown', handleFirstGesture, { capture: true, passive: true });
  window.addEventListener('keydown', handleFirstGesture, { capture: true, passive: true });
}

function getVolumeGain(): number {
  const pct = getSettingsSnapshot().alarmVolume;
  if (typeof pct !== 'number' || Number.isNaN(pct)) return 0.7;
  if (pct <= 0) return 0;
  return Math.max(0.05, Math.min(1, pct / 100));
}

function clearTimersOnly(): void {
  if (repeatInterval) {
    clearInterval(repeatInterval);
    repeatInterval = null;
  }
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
}

function stopActiveNodes(): void {
  for (const node of activeNodes) {
    try {
      node.disconnect();
    } catch {
      // ignore
    }
  }
  activeNodes = [];
}

async function triggerSoftBellCycle(runId: number): Promise<void> {
  if (runId !== activeRunId) return;
  const vol = getVolumeGain();
  if (vol <= 0.001) return;

  // Prefer native Win32 PlaySoundW memory WAV on desktop so OS autoplay rules can never silence T-0 alerts.
  const playedNative = await playCalendarChimeNative();
  if (playedNative || runId !== activeRunId) return;

  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
  if (runId !== activeRunId) return;

  const baseTime = ctx.currentTime + 0.01;
  // Soft two-note chime: D5 -> A5
  const notes = [
    { freq: 587.33, offset: 0, dur: 0.42 },
    { freq: 880.0, offset: 0.14, dur: 0.56 },
  ];

  for (const n of notes) {
    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(n.freq, baseTime + n.offset);

      gain.gain.setValueAtTime(0.0001, baseTime + n.offset);
      gain.gain.linearRampToValueAtTime(
        CALENDAR_CHIME_PEAK_GAIN * vol,
        baseTime + n.offset + 0.025
      );
      gain.gain.exponentialRampToValueAtTime(0.0001, baseTime + n.offset + n.dur);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(baseTime + n.offset);
      osc.stop(baseTime + n.offset + n.dur + 0.04);
      activeNodes.push(osc, gain);
    } catch {
      // Non-fatal audio scheduling failure
    }
  }
}

export function startCalendarAlertChime(shouldContinue?: () => boolean): void {
  stopCalendarAlertChime();
  const myRun = ++activeRunId;
  void triggerSoftBellCycle(myRun);

  repeatInterval = setInterval(() => {
    if (myRun !== activeRunId) return;
    if (shouldContinue && !shouldContinue()) {
      stopCalendarAlertChime();
      return;
    }
    void triggerSoftBellCycle(myRun);
  }, CHIME_INTERVAL_MS);

  safetyTimer = setTimeout(() => {
    if (myRun !== activeRunId) return;
    clearTimersOnly();
    stopActiveNodes();
    void stopCalendarChimeNative();
  }, CHIME_SAFETY_CAP_MS);
}

export function stopCalendarAlertChime(): void {
  activeRunId += 1;
  clearTimersOnly();
  stopActiveNodes();
  void stopCalendarChimeNative();
}
