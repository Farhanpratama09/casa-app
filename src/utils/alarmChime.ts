/**
 * alarmChime.ts
 * Pure Web Audio API Harmonic Chime + Custom 15s Auto-Trimmed IndexedDB Alarm Engine.
 *
 * - Default chime: soft harmonic arpeggio C5 -> E5 -> G5 -> B5 every 3.5s (max ~52s / 15 cycles).
 * - Custom upload: validates (.mp3/.wav/.ogg/.m4a, <= 10 MB), decodes via Web Audio API,
 *   trims to max 15.0s, applies 0.4s linear fade-out, encodes to WAV PCM, and persists in IndexedDB.
 */

import {
  getSettingsSnapshot,
  SETTINGS_STORAGE_KEY,
  updateSettings,
} from '../stores/useSettingsStore';

const CHIME_NOTES_HZ = [523.25, 659.25, 783.99, 987.77]; // C5 -> E5 -> G5 -> B5
const CHIME_INTERVAL_MS = 3500;
const MAX_CHIME_CYCLES = 15;
const SAFETY_MAX_DURATION_MS = 52_000;
export const ALARM_CHIME_PEAK_GAIN = 0.85;

const CUSTOM_ALARM_DB_NAME = 'casa_custom_alarm_db';
const CUSTOM_ALARM_DB_VERSION = 1;
const CUSTOM_ALARM_STORE = 'alarms';
const CUSTOM_ALARM_RECORD_ID = 'active_alarm';

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB
const MAX_TRIM_SECONDS = 15.0;
const FADE_OUT_SECONDS = 0.4;
const ALLOWED_EXTENSIONS = new Set(['mp3', 'wav', 'ogg', 'm4a']);

export interface StoredCustomAlarmRecord {
  id: string;
  fileName: string;
  durationSeconds: number;
  wavBuffer: ArrayBuffer;
  updatedAt: number;
}

let audioCtx: AudioContext | null = null;
let repeatTimer: ReturnType<typeof setInterval> | null = null;
let safetyTimer: ReturnType<typeof setTimeout> | null = null;
let previewStopTimer: ReturnType<typeof setTimeout> | null = null;
let cycleCount = 0;
let activeRunId = 0;
let activeNodes: AudioNode[] = [];
let activeGainNodes: GainNode[] = [];

let cachedCustomBuffer: AudioBuffer | null | undefined = undefined;
let cachedCustomUpdatedAt: number | null | undefined = undefined;
let preloadPromise: Promise<AudioBuffer | null> | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (!audioCtx) {
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;
    try {
      audioCtx = new AudioCtx();
    } catch (err) {
      console.warn('[alarmChime] Failed to construct AudioContext:', err);
      return null;
    }
  }
  return audioCtx;
}

function getVolumeMultiplier(): number {
  const pct = getSettingsSnapshot().alarmVolume;
  return Math.max(0, Math.min(1, pct / 100));
}

function openAlarmDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB tidak tersedia di runtime ini.'));
      return;
    }
    const req = indexedDB.open(CUSTOM_ALARM_DB_NAME, CUSTOM_ALARM_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CUSTOM_ALARM_STORE)) {
        db.createObjectStore(CUSTOM_ALARM_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Gagal membuka IndexedDB alarm.'));
  });
}

async function readStoredCustomAlarm(): Promise<StoredCustomAlarmRecord | null> {
  try {
    const db = await openAlarmDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(CUSTOM_ALARM_STORE, 'readonly');
      const store = tx.objectStore(CUSTOM_ALARM_STORE);
      const req = store.get(CUSTOM_ALARM_RECORD_ID);
      req.onsuccess = () => {
        resolve((req.result as StoredCustomAlarmRecord | undefined) || null);
      };
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => db.close();
      tx.onerror = () => db.close();
    });
  } catch (err) {
    console.warn('[alarmChime] readStoredCustomAlarm failed:', err);
    return null;
  }
}

async function writeStoredCustomAlarm(record: StoredCustomAlarmRecord): Promise<void> {
  const db = await openAlarmDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(CUSTOM_ALARM_STORE, 'readwrite');
    const store = tx.objectStore(CUSTOM_ALARM_STORE);
    store.put(record);
    tx.oncomplete = () => {
      db.close();
      resolve();
    };
    tx.onerror = () => {
      const err = tx.error;
      db.close();
      reject(err || new Error('Gagal menyimpan audio alarm ke IndexedDB.'));
    };
  });
}

async function deleteStoredCustomAlarm(): Promise<void> {
  try {
    const db = await openAlarmDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(CUSTOM_ALARM_STORE, 'readwrite');
      const store = tx.objectStore(CUSTOM_ALARM_STORE);
      store.delete(CUSTOM_ALARM_RECORD_ID);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        const err = tx.error;
        db.close();
        reject(err || new Error('Gagal menghapus audio alarm kustom.'));
      };
    });
  } catch (err) {
    console.warn('[alarmChime] deleteStoredCustomAlarm failed:', err);
  }
}

function encodeAudioBufferToWav(buffer: AudioBuffer): ArrayBuffer {
  const numChannels = Math.min(2, Math.max(1, buffer.numberOfChannels));
  const sampleRate = buffer.sampleRate;
  const numFrames = buffer.length;
  const bitsPerSample = 16;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const totalBytes = 44 + dataSize;

  const wavBuffer = new ArrayBuffer(totalBytes);
  const view = new DataView(wavBuffer);

  const writeString = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) {
      view.setUint8(offset + i, text.charCodeAt(i));
    }
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true); // PCM subchunk size
  view.setUint16(20, 1, true); // PCM format
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const channelData: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channelData.push(buffer.getChannelData(ch));
  }

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, channelData[ch][i] || 0));
      const int16 = sample < 0 ? Math.round(sample * 0x8000) : Math.round(sample * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return wavBuffer;
}

export async function preloadCustomAlarmBuffer(): Promise<AudioBuffer | null> {
  if (cachedCustomBuffer !== undefined) {
    return cachedCustomBuffer;
  }
  if (preloadPromise) {
    return preloadPromise;
  }

  preloadPromise = (async () => {
    try {
      const record = await readStoredCustomAlarm();
      if (!record || !record.wavBuffer) {
        cachedCustomBuffer = null;
        cachedCustomUpdatedAt = null;
        return null;
      }
      const ctx = getOrCreateAudioContext();
      if (!ctx) return null;
      const decoded = await ctx.decodeAudioData(record.wavBuffer.slice(0));
      cachedCustomBuffer = decoded;
      cachedCustomUpdatedAt = record.updatedAt;
      const currentMeta = getSettingsSnapshot().customAlarmMeta;
      if (!currentMeta || currentMeta.updatedAt !== record.updatedAt) {
        updateSettings({
          customAlarmMeta: {
            fileName: record.fileName,
            durationSeconds: record.durationSeconds,
            updatedAt: record.updatedAt,
          },
        });
      }
      return decoded;
    } catch (err) {
      console.warn('[alarmChime] Failed to preload custom alarm buffer:', err);
      cachedCustomBuffer = null;
      return null;
    } finally {
      preloadPromise = null;
    }
  })();

  return preloadPromise;
}

// Kick off quiet background preload on desktop runtime + cross-window cache invalidation
if (typeof window !== 'undefined') {
  void preloadCustomAlarmBuffer();
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
    try {
      const raw =
        event.key === null
          ? window.localStorage.getItem(SETTINGS_STORAGE_KEY)
          : event.newValue;
      const parsed = raw ? JSON.parse(raw) : null;
      if (typeof parsed?.alarmVolume === 'number') {
        syncActiveAlarmVolume(parsed.alarmVolume);
      }
      const nextUpdatedAt: number | null =
        typeof parsed?.customAlarmMeta?.updatedAt === 'number'
          ? parsed.customAlarmMeta.updatedAt
          : null;
      if (nextUpdatedAt === null) {
        cachedCustomBuffer = null;
        cachedCustomUpdatedAt = null;
      } else if (nextUpdatedAt !== cachedCustomUpdatedAt) {
        cachedCustomBuffer = undefined;
        cachedCustomUpdatedAt = undefined;
        void preloadCustomAlarmBuffer();
      }
    } catch {}
  });
}

/**
 * Validates (.mp3, .wav, .ogg, .m4a | max 10MB), decodes, trims to first 15s,
 * applies linear fade-out on the last 0.4s, serializes to WAV PCM, and persists in IndexedDB.
 */
export async function processAndSaveCustomAlarm(file: File): Promise<{
  fileName: string;
  durationSeconds: number;
}> {
  const ext = file.name.split('.').pop()?.toLowerCase() || '';
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new Error('Format file tidak didukung. Gunakan .mp3, .wav, .ogg, atau .m4a.');
  }
  if (file.size <= 0) {
    throw new Error('File audio kosong atau rusak.');
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    throw new Error('Ukuran file melebihi batas maksimal 10 MB.');
  }

  const ctx = getOrCreateAudioContext();
  if (!ctx) {
    throw new Error('Web Audio API tidak tersedia di sistem ini.');
  }
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }

  const rawBuffer = await file.arrayBuffer();
  let decoded: AudioBuffer;
  try {
    decoded = await ctx.decodeAudioData(rawBuffer.slice(0));
  } catch {
    throw new Error('Gagal mendekode audio. Pastikan file audio valid dan tidak korup.');
  }

  if (!decoded || decoded.length === 0 || decoded.duration <= 0) {
    throw new Error('Durasi audio tidak valid.');
  }

  const trimmedDuration = Math.min(decoded.duration, MAX_TRIM_SECONDS);
  const sampleRate = decoded.sampleRate;
  const frameCount = Math.max(1, Math.min(decoded.length, Math.floor(trimmedDuration * sampleRate)));
  const numChannels = Math.min(2, Math.max(1, decoded.numberOfChannels));
  const trimmedBuffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  const fadeFrames = Math.min(frameCount, Math.max(1, Math.round(FADE_OUT_SECONDS * sampleRate)));
  const fadeStartFrame = frameCount - fadeFrames;

  for (let ch = 0; ch < numChannels; ch++) {
    const src = decoded.getChannelData(ch);
    const dst = trimmedBuffer.getChannelData(ch);
    for (let i = 0; i < frameCount; i++) {
      let sample = src[i] || 0;
      if (i >= fadeStartFrame) {
        const remainingRatio =
          fadeFrames > 1 ? (frameCount - 1 - i) / (fadeFrames - 1) : 0;
        sample *= Math.max(0, Math.min(1, remainingRatio));
      }
      dst[i] = sample;
    }
  }

  const wavBuffer = encodeAudioBufferToWav(trimmedBuffer);
  const roundedDuration = Math.round((frameCount / sampleRate) * 10) / 10;
  const updatedAt = Date.now();

  await writeStoredCustomAlarm({
    id: CUSTOM_ALARM_RECORD_ID,
    fileName: file.name,
    durationSeconds: roundedDuration,
    wavBuffer,
    updatedAt,
  });

  cachedCustomBuffer = trimmedBuffer;
  cachedCustomUpdatedAt = updatedAt;
  updateSettings({
    customAlarmMeta: {
      fileName: file.name,
      durationSeconds: roundedDuration,
      updatedAt,
    },
  });

  return {
    fileName: file.name,
    durationSeconds: roundedDuration,
  };
}

export async function resetCustomAlarm(): Promise<void> {
  stopAlarmChime();
  await deleteStoredCustomAlarm();
  cachedCustomBuffer = null;
  cachedCustomUpdatedAt = null;
  updateSettings({ customAlarmMeta: null });
}

/**
 * Unlocks WebView2 AudioContext on user gesture (e.g. Start button click or first click/key)
 * so the alarm is never blocked by autoplay policy when the timer finishes later.
 */
export function unlockAlarmAudio(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  if (ctx.state === 'suspended') {
    void ctx.resume().catch(() => {});
  }

  try {
    const silentGain = ctx.createGain();
    silentGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    silentGain.connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(440, ctx.currentTime);
    osc.connect(silentGain);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.02);
  } catch {
    // Non-fatal unlock attempt
  }
}

async function ensureAudioContextRunning(ctx: AudioContext): Promise<void> {
  if (ctx.state === 'suspended') {
    await ctx.resume().catch(() => {});
  }
}

if (typeof window !== 'undefined') {
  const handleFirstGestureUnlock = () => {
    unlockAlarmAudio();
    if (audioCtx && audioCtx.state === 'running') {
      window.removeEventListener('pointerdown', handleFirstGestureUnlock, true);
      window.removeEventListener('keydown', handleFirstGestureUnlock, true);
    }
  };
  window.addEventListener('pointerdown', handleFirstGestureUnlock, {
    capture: true,
    passive: true,
  });
  window.addEventListener('keydown', handleFirstGestureUnlock, {
    capture: true,
    passive: true,
  });
}

export function syncActiveAlarmVolume(volumePercent: number): void {
  const vol = Math.max(0, Math.min(1, volumePercent / 100));
  for (const g of activeGainNodes) {
    try {
      if (audioCtx) {
        g.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.02);
      }
    } catch {}
  }
}

function playSingleHarmonicCycle(ctx: AudioContext): number {
  const now = ctx.currentTime;
  const vol = getVolumeMultiplier();
  if (vol <= 0.001) return 1.5;

  const masterGain = ctx.createGain();
  masterGain.gain.setValueAtTime(vol, now);

  let outputNode: AudioNode = ctx.destination;
  if (typeof ctx.createDynamicsCompressor === 'function') {
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.setValueAtTime(-3, now);
    compressor.knee.setValueAtTime(6, now);
    compressor.ratio.setValueAtTime(8, now);
    compressor.attack.setValueAtTime(0.003, now);
    compressor.release.setValueAtTime(0.15, now);
    compressor.connect(ctx.destination);
    activeNodes.push(compressor);
    outputNode = compressor;
  }

  masterGain.connect(outputNode);
  activeNodes.push(masterGain);
  activeGainNodes.push(masterGain);

  CHIME_NOTES_HZ.forEach((freq, idx) => {
    const noteStart = now + idx * 0.14;
    const noteDuration = idx === CHIME_NOTES_HZ.length - 1 ? 1.15 : 0.78;

    try {
      const oscMain = ctx.createOscillator();
      oscMain.type = 'sine';
      oscMain.frequency.setValueAtTime(freq, noteStart);

      const oscHarmonic = ctx.createOscillator();
      oscHarmonic.type = 'triangle';
      oscHarmonic.frequency.setValueAtTime(freq * 2, noteStart);

      const mainGain = ctx.createGain();
      mainGain.gain.setValueAtTime(0.0001, noteStart);
      mainGain.gain.linearRampToValueAtTime(ALARM_CHIME_PEAK_GAIN, noteStart + 0.02);
      mainGain.gain.exponentialRampToValueAtTime(0.0008, noteStart + noteDuration);

      const harmonicGain = ctx.createGain();
      harmonicGain.gain.setValueAtTime(0.0001, noteStart);
      harmonicGain.gain.linearRampToValueAtTime(0.12, noteStart + 0.015);
      harmonicGain.gain.exponentialRampToValueAtTime(0.0005, noteStart + noteDuration * 0.65);

      oscMain.connect(mainGain);
      mainGain.connect(masterGain);

      oscHarmonic.connect(harmonicGain);
      harmonicGain.connect(masterGain);

      oscMain.start(noteStart);
      oscMain.stop(noteStart + noteDuration + 0.03);
      oscHarmonic.start(noteStart);
      oscHarmonic.stop(noteStart + noteDuration + 0.03);

      activeNodes.push(oscMain, oscHarmonic, mainGain, harmonicGain);
      oscMain.onended = () => {
        try {
          oscMain.disconnect();
          mainGain.disconnect();
          oscHarmonic.disconnect();
          harmonicGain.disconnect();
        } catch {}
      };
    } catch {
      // Ignore WebAudio scheduling hiccup
    }
  });

  return 1.65;
}

function playSingleCustomCycle(ctx: AudioContext, buffer: AudioBuffer): number {
  const vol = getVolumeMultiplier();
  if (vol <= 0.001) return Math.min(MAX_TRIM_SECONDS, buffer.duration);

  try {
    const source = ctx.createBufferSource();
    source.buffer = buffer;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, ctx.currentTime);

    source.connect(gain);
    gain.connect(ctx.destination);

    source.start(ctx.currentTime);
    activeNodes.push(source, gain);
    activeGainNodes.push(gain);

    source.onended = () => {
      try {
        source.disconnect();
        gain.disconnect();
      } catch {}
    };
  } catch (err) {
    console.warn('[alarmChime] Custom cycle playback failed:', err);
  }

  return Math.min(MAX_TRIM_SECONDS, buffer.duration || 3.5);
}

function playResolvedCycle(ctx: AudioContext, customBuf: AudioBuffer | null): number {
  if (customBuf) {
    return playSingleCustomCycle(ctx, customBuf);
  }
  return playSingleHarmonicCycle(ctx);
}

async function beginAlarmLoop(
  runId: number,
  ctx: AudioContext,
  customBuf: AudioBuffer | null,
  onAutoStop?: () => void
): Promise<void> {
  if (runId !== activeRunId) return;

  await ensureAudioContextRunning(ctx);
  if (runId !== activeRunId) return;

  cycleCount = 1;
  playResolvedCycle(ctx, customBuf);

  const repeatMs = customBuf
    ? Math.max(CHIME_INTERVAL_MS, Math.round(customBuf.duration * 1000) + 500)
    : CHIME_INTERVAL_MS;

  repeatTimer = setInterval(() => {
    void (async () => {
      if (runId !== activeRunId || cycleCount >= MAX_CHIME_CYCLES) {
        stopAlarmChime();
        onAutoStop?.();
        return;
      }

      cycleCount += 1;
      const currentCtx = getOrCreateAudioContext();
      if (!currentCtx) {
        stopAlarmChime();
        return;
      }
      await ensureAudioContextRunning(currentCtx);
      if (runId !== activeRunId) return;
      playResolvedCycle(currentCtx, customBuf);
    })();
  }, repeatMs);

  safetyTimer = setTimeout(() => {
    if (runId === activeRunId) {
      stopAlarmChime();
      onAutoStop?.();
    }
  }, SAFETY_MAX_DURATION_MS);
}

/**
 * Starts the repeating Focus Timer alarm (custom 15s IndexedDB audio if present,
 * otherwise harmonic arpeggio C5->E5->G5->B5), capped safely at ~52s / 15 cycles.
 */
export function startAlarmChime(onAutoStop?: () => void): void {
  stopAlarmChime();

  const ctx = getOrCreateAudioContext();
  if (!ctx) return;

  const runId = ++activeRunId;
  const hasCustomSetting = Boolean(getSettingsSnapshot().customAlarmMeta);

  if (cachedCustomBuffer !== undefined) {
    void beginAlarmLoop(runId, ctx, cachedCustomBuffer, onAutoStop);
    return;
  }

  if (!hasCustomSetting) {
    void beginAlarmLoop(runId, ctx, null, onAutoStop);
    return;
  }

  void preloadCustomAlarmBuffer().then((buf) => {
    if (runId !== activeRunId) return;
    void beginAlarmLoop(runId, ctx, buf, onAutoStop);
  });
}

/**
 * Plays one short non-blocking notice chime (used when auto-starting next Rest/Focus cycle).
 */
export function playAlarmNoticeOnce(): void {
  const ctx = getOrCreateAudioContext();
  if (!ctx) return;
  void ensureAudioContextRunning(ctx).then(() => {
    if (cachedCustomBuffer) {
      playSingleCustomCycle(ctx, cachedCustomBuffer);
    } else {
      playSingleHarmonicCycle(ctx);
    }
  });
}

/**
 * Plays a single test preview of the active alarm sound (custom or default) at current alarmVolume.
 */
export function previewAlarmChime(onEnded?: () => void): void {
  stopAlarmChime();
  const ctx = getOrCreateAudioContext();
  if (!ctx) {
    onEnded?.();
    return;
  }

  const runId = ++activeRunId;

  const trigger = async (buf: AudioBuffer | null) => {
    if (runId !== activeRunId) return;
    await ensureAudioContextRunning(ctx);
    if (runId !== activeRunId) return;
    const durationSec = playResolvedCycle(ctx, buf);
    previewStopTimer = setTimeout(() => {
      if (runId === activeRunId) {
        stopAlarmChime();
        onEnded?.();
      }
    }, Math.round(durationSec * 1000) + 180);
  };

  if (cachedCustomBuffer !== undefined) {
    void trigger(cachedCustomBuffer);
  } else {
    void preloadCustomAlarmBuffer().then((buf) => {
      void trigger(buf);
    });
  }
}

/**
 * Immediately halts all repeating alarm chimes and disconnects active audio nodes.
 */
export function stopAlarmChime(): void {
  activeRunId += 1;
  if (repeatTimer) {
    clearInterval(repeatTimer);
    repeatTimer = null;
  }
  if (safetyTimer) {
    clearTimeout(safetyTimer);
    safetyTimer = null;
  }
  if (previewStopTimer) {
    clearTimeout(previewStopTimer);
    previewStopTimer = null;
  }
  cycleCount = 0;

  for (const node of activeNodes) {
    try {
      if ('stop' in node && typeof (node as AudioBufferSourceNode).stop === 'function') {
        (node as AudioBufferSourceNode).stop();
      }
      node.disconnect();
    } catch {}
  }
  activeNodes = [];
  activeGainNodes = [];
}
