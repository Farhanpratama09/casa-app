/**
 * prayerAudio.ts
 * Lazy-loaded Dual-Path Adzan audio engine with strict 0 MB idle RAM footprint.
 *
 * - Never preloads or decodes audio buffers at startup or during idle.
 * - Subuh (`prayerId === 'fajr'` / `variant === 'subuh'`):
 *     lazy loads `/audio/adzan-subuh.ogg` -> graceful fallback to `/audio/adzan.ogg` -> `playChimeCue`.
 * - Dzuhur, Ashar, Maghrib, Isya (`regular`):
 *     lazy loads `/audio/adzan.ogg` -> graceful fallback to `playChimeCue`.
 * - Releases the `HTMLAudioElement` completely on every fallback, error, `ended`, or `stopPrayerAudio()`.
 */

import {
  getSettingsSnapshot,
  IbadahAudioMode,
  SETTINGS_STORAGE_KEY,
} from '../../stores/useSettingsStore';
import { playChimeCue } from '../../utils/tauriBridge';

export const ADZAN_REGULAR_ASSET_URL = '/audio/adzan.ogg';
export const ADZAN_SUBUH_ASSET_URL = '/audio/adzan-subuh.ogg';

export type AdzanAudioVariant = 'regular' | 'subuh';

let activeAudio: HTMLAudioElement | null = null;
let chimeFollowupTimer: ReturnType<typeof setTimeout> | null = null;
let activePlayToken = 0;

function readVolumeScalar(): number {
  const pct = getSettingsSnapshot().alarmVolume;
  if (typeof pct !== 'number' || Number.isNaN(pct)) return 0.8;
  return Math.max(0, Math.min(1, pct / 100));
}

function clearChimeFollowup(): void {
  if (chimeFollowupTimer) {
    clearTimeout(chimeFollowupTimer);
    chimeFollowupTimer = null;
  }
}

function releaseAudioElement(el: HTMLAudioElement | null): void {
  if (!el) return;
  try {
    el.onended = null;
    el.onerror = null;
    el.pause();
    el.removeAttribute('src');
    el.src = '';
    el.load();
  } catch {
    // Non-fatal media teardown
  }
}

function releaseActiveAudioElement(): void {
  if (!activeAudio) return;
  const el = activeAudio;
  activeAudio = null;
  releaseAudioElement(el);
}

export function isPrayerAudioPlaying(): boolean {
  return activeAudio !== null || chimeFollowupTimer !== null;
}

export function syncActivePrayerAudioVolume(volumePercent: number): void {
  if (!activeAudio) return;
  try {
    activeAudio.volume = Math.max(0, Math.min(1, volumePercent / 100));
  } catch {
    // Ignore transient WebView audio error
  }
}

export function stopPrayerAudio(): void {
  activePlayToken += 1;
  clearChimeFollowup();
  releaseActiveAudioElement();
}

function triggerGracefulChimeSequence(token: number, onComplete?: () => void): void {
  if (token !== activePlayToken) return;
  try {
    playChimeCue('ding');
  } catch {
    // Non-fatal
  }
  chimeFollowupTimer = setTimeout(() => {
    chimeFollowupTimer = null;
    if (token !== activePlayToken) return;
    try {
      playChimeCue('ding');
    } catch {
      // Non-fatal
    }
    onComplete?.();
  }, 1350);
}

function attemptLazyAudioUrl(
  url: string,
  token: number,
  onEnded?: () => void
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    if (token !== activePlayToken) {
      resolve(false);
      return;
    }

    let settled = false;
    let audio: HTMLAudioElement | null = null;

    const failAndCleanup = () => {
      if (audio && activeAudio === audio) {
        activeAudio = null;
      }
      releaseAudioElement(audio);
      audio = null;
      if (!settled) {
        settled = true;
        resolve(false);
      }
    };

    try {
      audio = new Audio();
      audio.preload = 'none';
      audio.volume = readVolumeScalar();
      activeAudio = audio;

      audio.onended = () => {
        if (audio && activeAudio === audio) {
          activeAudio = null;
        }
        releaseAudioElement(audio);
        audio = null;
        if (token === activePlayToken) {
          onEnded?.();
        }
      };

      audio.onerror = () => {
        if (!settled) {
          failAndCleanup();
        } else {
          if (audio && activeAudio === audio) {
            activeAudio = null;
          }
          releaseAudioElement(audio);
          audio = null;
          if (token === activePlayToken) {
            onEnded?.();
          }
        }
      };

      audio.src = url;
      const playPromise = audio.play();

      if (playPromise && typeof playPromise.then === 'function') {
        playPromise
          .then(() => {
            if (token !== activePlayToken) {
              failAndCleanup();
              return;
            }
            if (!settled) {
              settled = true;
              resolve(true);
            }
          })
          .catch(() => {
            failAndCleanup();
          });
      } else if (!settled) {
        settled = true;
        resolve(true);
      }
    } catch {
      failAndCleanup();
    }
  });
}

export interface PlayPrayerAudioOptions {
  prayerId?: string;
  variant?: AdzanAudioVariant;
  onEnded?: () => void;
  onFallback?: (reason: string) => void;
}

export interface PlayPrayerAudioResult {
  usedFallback: boolean;
  isStreamingAdzan: boolean;
  resolvedUrl: string | null;
}

export function resolveAdzanVariant(
  prayerId?: string,
  explicitVariant?: AdzanAudioVariant
): AdzanAudioVariant {
  if (explicitVariant) return explicitVariant;
  return prayerId?.trim().toLowerCase() === 'fajr' ? 'subuh' : 'regular';
}

/**
 * Plays prayer notification audio according to mode ('adzan' | 'chime' | 'visual')
 * and prayer variant ('subuh' vs 'regular'). Never throws unhandled errors.
 */
export async function playPrayerAudio(
  mode: IbadahAudioMode,
  options?: PlayPrayerAudioOptions
): Promise<PlayPrayerAudioResult> {
  stopPrayerAudio();
  const token = ++activePlayToken;

  if (mode === 'visual') {
    return { usedFallback: false, isStreamingAdzan: false, resolvedUrl: null };
  }

  if (mode === 'chime') {
    triggerGracefulChimeSequence(token);
    return { usedFallback: false, isStreamingAdzan: false, resolvedUrl: null };
  }

  // Mode: 'adzan' -> Lazy instantiate HTMLAudioElement strictly on demand
  if (typeof window === 'undefined' || typeof Audio === 'undefined') {
    triggerGracefulChimeSequence(token);
    options?.onFallback?.('Playback audio HTML5 tidak tersedia; menggunakan chime lembut.');
    return { usedFallback: true, isStreamingAdzan: false, resolvedUrl: null };
  }

  const variant = resolveAdzanVariant(options?.prayerId, options?.variant);
  const candidates =
    variant === 'subuh'
      ? [ADZAN_SUBUH_ASSET_URL, ADZAN_REGULAR_ASSET_URL]
      : [ADZAN_REGULAR_ASSET_URL];

  for (let i = 0; i < candidates.length; i++) {
    if (token !== activePlayToken) {
      return { usedFallback: false, isStreamingAdzan: false, resolvedUrl: null };
    }
    const url = candidates[i];
    const ok = await attemptLazyAudioUrl(url, token, options?.onEnded);
    if (ok) {
      if (variant === 'subuh' && url === ADZAN_REGULAR_ASSET_URL) {
        options?.onFallback?.(
          'File /audio/adzan-subuh.ogg belum tersedia; dialihkan otomatis ke /audio/adzan.ogg.'
        );
      }
      return {
        usedFallback: false,
        isStreamingAdzan: true,
        resolvedUrl: url,
      };
    }
  }

  // All audio files missing or unplayable -> graceful fallback to playChimeCue
  if (token === activePlayToken) {
    triggerGracefulChimeSequence(token);
    options?.onFallback?.(
      variant === 'subuh'
        ? 'File /audio/adzan-subuh.ogg dan /audio/adzan.ogg belum tersedia; dialihkan otomatis ke chime.'
        : 'File /audio/adzan.ogg belum tersedia; dialihkan otomatis ke chime.'
    );
  }
  return { usedFallback: true, isStreamingAdzan: false, resolvedUrl: null };
}

// Live cross-window alarmVolume sync while Adzan audio is playing
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) return;
    try {
      const raw =
        event.key === null
          ? window.localStorage.getItem(SETTINGS_STORAGE_KEY)
          : event.newValue;
      const parsed = raw ? JSON.parse(raw) : null;
      if (typeof parsed?.alarmVolume === 'number') {
        syncActivePrayerAudioVolume(parsed.alarmVolume);
      }
    } catch {
      // Ignore malformed storage snapshot
    }
  });
}
