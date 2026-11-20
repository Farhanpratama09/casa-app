/**
 * useSettingsStore.ts
 * Centralized Singleton Store for CASA Phase 8.0 Settings.
 *
 * Uses React `useSyncExternalStore` + `localStorage` (`casa_settings_v1`) so
 * theme CSS variables, placement, interaction rules, audio, and system toggles
 * apply instantaneously in real-time across all components without reload.
 */

import { useCallback, useSyncExternalStore } from 'react';

export const SETTINGS_STORAGE_KEY = 'casa_settings_v1';

export type CasaThemeId = 'default' | 'monochrome' | 'colorblind';
export type CasaPlacementMode = 'docked' | 'floating';
export type CasaHorizontalAlign = 'left' | 'center' | 'right';
export type CasaHoverDelayMs = 0 | 300 | -1;
export type CasaIdlePillStyle = 'eyes' | 'clock';
export type CasaFullscreenBehavior = 'smart-tuck' | 'total-hide' | 'always-visible';

export interface CustomAlarmMetadata {
  fileName: string;
  durationSeconds: number;
  updatedAt: number;
}

export type IbadahLocationMode = 'auto' | 'manual';
export type IbadahCalculationMethod =
  | 'auto'
  | 'kemenag'
  | 'jakim'
  | 'muis'
  | 'umm_al_qura'
  | 'mwl'
  | 'isna'
  | 'egyptian'
  | 'karachi';
export type IbadahMadhab = 'shafi' | 'hanafi';
export type IbadahAudioMode = 'adzan' | 'chime' | 'visual';

export interface IbadahOffsets {
  fajr: number;
  dhuhr: number;
  asr: number;
  maghrib: number;
  isha: number;
}

export interface IbadahSettings {
  enabled: boolean;
  locationMode: IbadahLocationMode;
  city: string;
  region: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  method: IbadahCalculationMethod;
  madhab: IbadahMadhab;
  offsets: IbadahOffsets;
  audioMode: IbadahAudioMode;
}

export interface CasaSettings {
  theme: CasaThemeId;
  placementMode: CasaPlacementMode;
  horizontalAlign: CasaHorizontalAlign;
  idlePillStyle: CasaIdlePillStyle;
  hoverDelayMs: CasaHoverDelayMs;
  autoTuckIdle: boolean;
  fullscreenBehavior: CasaFullscreenBehavior;
  alarmVolume: number;
  autoStartNextCycle: boolean;
  customAlarmMeta: CustomAlarmMetadata | null;
  launchAtStartup: boolean;
  ibadah: IbadahSettings;
}

export interface CasaThemePalette {
  timer: string;
  timerGlow: string;
  rest: string;
  volume: string;
  brightness: string;
  cpu: string;
  ram: string;
  awake: string;
  awakeGlow: string;
  danger: string;
  dangerGlow: string;
  wifi: string;
  bluetooth: string;
  ibadah: string;
  ibadahGlow: string;
}

export const CASA_THEME_PALETTES: Record<CasaThemeId, CasaThemePalette> = {
  default: {
    timer: '#F59E0B',
    timerGlow: 'rgba(245, 158, 11, 0.35)',
    rest: '#10B981',
    volume: '#38BDF8',
    brightness: '#FACC15',
    cpu: '#E879F9',
    ram: '#A855F7',
    awake: '#F59E0B',
    awakeGlow: 'rgba(245, 158, 11, 0.16)',
    danger: '#F43F5E',
    dangerGlow: 'rgba(244, 63, 94, 0.16)',
    wifi: '#2DD4BF',
    bluetooth: '#6366F1',
    ibadah: '#E4E4E7',
    ibadahGlow: 'rgba(255, 255, 255, 0.18)',
  },
  monochrome: {
    timer: '#FFFFFF',
    timerGlow: 'rgba(255, 255, 255, 0.28)',
    rest: '#D4D4D8',
    volume: '#E4E4E7',
    brightness: '#D4D4D8',
    cpu: '#FFFFFF',
    ram: '#A1A1AA',
    awake: '#FFFFFF',
    awakeGlow: 'rgba(255, 255, 255, 0.14)',
    danger: '#F4F4F5',
    dangerGlow: 'rgba(244, 244, 245, 0.18)',
    wifi: '#FFFFFF',
    bluetooth: '#D4D4D8',
    ibadah: '#FFFFFF',
    ibadahGlow: 'rgba(255, 255, 255, 0.24)',
  },
  colorblind: {
    timer: '#38BDF8',
    timerGlow: 'rgba(56, 189, 248, 0.35)',
    rest: '#0284C7',
    volume: '#0284C7',
    brightness: '#FDE047',
    cpu: '#38BDF8',
    ram: '#1D4ED8',
    awake: '#F59E0B',
    awakeGlow: 'rgba(245, 158, 11, 0.18)',
    danger: '#EA580C',
    dangerGlow: 'rgba(234, 88, 12, 0.20)',
    wifi: '#38BDF8',
    bluetooth: '#1D4ED8',
    ibadah: '#38BDF8',
    ibadahGlow: 'rgba(56, 189, 248, 0.24)',
  },
};

export const DEFAULT_IBADAH_SETTINGS: IbadahSettings = {
  enabled: false,
  locationMode: 'auto',
  city: 'Jakarta',
  region: 'DKI Jakarta',
  countryCode: 'ID',
  latitude: -6.2088,
  longitude: 106.8456,
  method: 'auto',
  madhab: 'shafi',
  offsets: {
    fajr: 0,
    dhuhr: 0,
    asr: 0,
    maghrib: 0,
    isha: 0,
  },
  audioMode: 'adzan',
};

export const DEFAULT_CASA_SETTINGS: CasaSettings = {
  theme: 'default',
  placementMode: 'docked',
  horizontalAlign: 'center',
  idlePillStyle: 'eyes',
  hoverDelayMs: 0,
  autoTuckIdle: false,
  fullscreenBehavior: 'smart-tuck',
  alarmVolume: 80,
  autoStartNextCycle: false,
  customAlarmMeta: null,
  launchAtStartup: false,
  ibadah: DEFAULT_IBADAH_SETTINGS,
};

const VALID_IBADAH_METHODS = new Set<IbadahCalculationMethod>([
  'auto',
  'kemenag',
  'jakim',
  'muis',
  'umm_al_qura',
  'mwl',
  'isna',
  'egyptian',
  'karachi',
]);

function clampPrayerOffset(val: unknown): number {
  if (typeof val !== 'number' || !Number.isFinite(val)) return 0;
  return Math.max(-60, Math.min(60, Math.round(val)));
}

function sanitizeIbadahSettings(raw: unknown): IbadahSettings {
  const input = raw && typeof raw === 'object' ? (raw as Partial<IbadahSettings>) : {};
  const rawOffsets =
    input.offsets && typeof input.offsets === 'object'
      ? (input.offsets as Partial<IbadahOffsets>)
      : {};

  const locationMode: IbadahLocationMode =
    input.locationMode === 'manual' || input.locationMode === 'auto'
      ? input.locationMode
      : DEFAULT_IBADAH_SETTINGS.locationMode;

  const method: IbadahCalculationMethod =
    typeof input.method === 'string' &&
    VALID_IBADAH_METHODS.has(input.method as IbadahCalculationMethod)
      ? (input.method as IbadahCalculationMethod)
      : DEFAULT_IBADAH_SETTINGS.method;

  const madhab: IbadahMadhab =
    input.madhab === 'hanafi' || input.madhab === 'shafi'
      ? input.madhab
      : DEFAULT_IBADAH_SETTINGS.madhab;

  const audioMode: IbadahAudioMode =
    input.audioMode === 'adzan' || input.audioMode === 'chime' || input.audioMode === 'visual'
      ? input.audioMode
      : DEFAULT_IBADAH_SETTINGS.audioMode;

  const latitude =
    typeof input.latitude === 'number' &&
    Number.isFinite(input.latitude) &&
    input.latitude >= -90 &&
    input.latitude <= 90
      ? input.latitude
      : DEFAULT_IBADAH_SETTINGS.latitude;

  const longitude =
    typeof input.longitude === 'number' &&
    Number.isFinite(input.longitude) &&
    input.longitude >= -180 &&
    input.longitude <= 180
      ? input.longitude
      : DEFAULT_IBADAH_SETTINGS.longitude;

  const city =
    typeof input.city === 'string' && input.city.trim().length > 0
      ? input.city.trim().slice(0, 80)
      : DEFAULT_IBADAH_SETTINGS.city;

  const region =
    typeof input.region === 'string' ? input.region.trim().slice(0, 80) : DEFAULT_IBADAH_SETTINGS.region;

  const countryCode =
    typeof input.countryCode === 'string' && input.countryCode.trim().length > 0
      ? input.countryCode.trim().toUpperCase().slice(0, 4)
      : DEFAULT_IBADAH_SETTINGS.countryCode;

  return {
    enabled:
      typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_IBADAH_SETTINGS.enabled,
    locationMode,
    city,
    region,
    countryCode,
    latitude,
    longitude,
    method,
    madhab,
    offsets: {
      fajr: clampPrayerOffset(rawOffsets.fajr),
      dhuhr: clampPrayerOffset(rawOffsets.dhuhr),
      asr: clampPrayerOffset(rawOffsets.asr),
      maghrib: clampPrayerOffset(rawOffsets.maghrib),
      isha: clampPrayerOffset(rawOffsets.isha),
    },
    audioMode,
  };
}

function sanitizeSettings(raw: unknown): CasaSettings {
  const input = raw && typeof raw === 'object' ? (raw as Partial<CasaSettings>) : {};

  const theme: CasaThemeId =
    input.theme === 'monochrome' || input.theme === 'colorblind' || input.theme === 'default'
      ? input.theme
      : DEFAULT_CASA_SETTINGS.theme;

  const placementMode: CasaPlacementMode =
    input.placementMode === 'floating' || input.placementMode === 'docked'
      ? input.placementMode
      : DEFAULT_CASA_SETTINGS.placementMode;

  const horizontalAlign: CasaHorizontalAlign =
    input.horizontalAlign === 'left' ||
    input.horizontalAlign === 'right' ||
    input.horizontalAlign === 'center'
      ? input.horizontalAlign
      : DEFAULT_CASA_SETTINGS.horizontalAlign;

  const idlePillStyle: CasaIdlePillStyle =
    input.idlePillStyle === 'clock' || input.idlePillStyle === 'eyes'
      ? input.idlePillStyle
      : DEFAULT_CASA_SETTINGS.idlePillStyle;

  const hoverDelayMs: CasaHoverDelayMs =
    input.hoverDelayMs === 0 || input.hoverDelayMs === 300 || input.hoverDelayMs === -1
      ? input.hoverDelayMs
      : DEFAULT_CASA_SETTINGS.hoverDelayMs;

  const fullscreenBehavior: CasaFullscreenBehavior =
    input.fullscreenBehavior === 'smart-tuck' ||
    input.fullscreenBehavior === 'total-hide' ||
    input.fullscreenBehavior === 'always-visible'
      ? input.fullscreenBehavior
      : DEFAULT_CASA_SETTINGS.fullscreenBehavior;

  const alarmVolume =
    typeof input.alarmVolume === 'number' && !Number.isNaN(input.alarmVolume)
      ? Math.max(0, Math.min(100, Math.round(input.alarmVolume)))
      : DEFAULT_CASA_SETTINGS.alarmVolume;

  const customAlarmMeta =
    input.customAlarmMeta &&
    typeof input.customAlarmMeta === 'object' &&
    typeof input.customAlarmMeta.fileName === 'string' &&
    typeof input.customAlarmMeta.durationSeconds === 'number'
      ? {
          fileName: input.customAlarmMeta.fileName,
          durationSeconds: Math.max(0.1, Math.min(15, input.customAlarmMeta.durationSeconds)),
          updatedAt:
            typeof input.customAlarmMeta.updatedAt === 'number'
              ? input.customAlarmMeta.updatedAt
              : Date.now(),
        }
      : null;

  return {
    theme,
    placementMode,
    horizontalAlign,
    idlePillStyle,
    hoverDelayMs,
    autoTuckIdle:
      typeof input.autoTuckIdle === 'boolean'
        ? input.autoTuckIdle
        : DEFAULT_CASA_SETTINGS.autoTuckIdle,
    fullscreenBehavior,
    alarmVolume,
    autoStartNextCycle:
      typeof input.autoStartNextCycle === 'boolean'
        ? input.autoStartNextCycle
        : DEFAULT_CASA_SETTINGS.autoStartNextCycle,
    customAlarmMeta,
    launchAtStartup:
      typeof input.launchAtStartup === 'boolean'
        ? input.launchAtStartup
        : DEFAULT_CASA_SETTINGS.launchAtStartup,
    ibadah: sanitizeIbadahSettings(input.ibadah),
  };
}

export function applyThemeCssVariables(theme: CasaThemeId): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  const palette = CASA_THEME_PALETTES[theme] || CASA_THEME_PALETTES.default;
  root.setAttribute('data-casa-theme', theme);
  root.style.setProperty('--casa-timer', palette.timer);
  root.style.setProperty('--casa-timer-glow', palette.timerGlow);
  root.style.setProperty('--casa-rest', palette.rest);
  root.style.setProperty('--casa-volume', palette.volume);
  root.style.setProperty('--casa-brightness', palette.brightness);
  root.style.setProperty('--casa-cpu', palette.cpu);
  root.style.setProperty('--casa-ram', palette.ram);
  root.style.setProperty('--casa-awake', palette.awake);
  root.style.setProperty('--casa-awake-glow', palette.awakeGlow);
  root.style.setProperty('--casa-danger', palette.danger);
  root.style.setProperty('--casa-danger-glow', palette.dangerGlow);
  root.style.setProperty('--casa-wifi', palette.wifi);
  root.style.setProperty('--casa-bluetooth', palette.bluetooth);
  root.style.setProperty('--casa-ibadah', palette.ibadah);
  root.style.setProperty('--casa-ibadah-glow', palette.ibadahGlow);
}

function parseSettingsJson(raw: string | null): CasaSettings {
  if (!raw) {
    return DEFAULT_CASA_SETTINGS;
  }
  try {
    return sanitizeSettings(JSON.parse(raw));
  } catch {
    return DEFAULT_CASA_SETTINGS;
  }
}

function loadInitialSettings(): CasaSettings {
  if (typeof window === 'undefined') {
    return DEFAULT_CASA_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(SETTINGS_STORAGE_KEY);
    const parsed = parseSettingsJson(raw);
    applyThemeCssVariables(parsed.theme);
    return parsed;
  } catch {
    applyThemeCssVariables(DEFAULT_CASA_SETTINGS.theme);
    return DEFAULT_CASA_SETTINGS;
  }
}

let currentSettings: CasaSettings = loadInitialSettings();
const listeners = new Set<() => void>();

// Cross-window real-time sync: when "settings" window updates localStorage,
// WebView2 fires `storage` event on "main" window so theme CSS vars, layout & hitboxes update instantaneously.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event: StorageEvent) => {
    if (event.key !== null && event.key !== SETTINGS_STORAGE_KEY) {
      return;
    }
    const raw =
      event.key === null
        ? window.localStorage.getItem(SETTINGS_STORAGE_KEY)
        : event.newValue;
    const next = parseSettingsJson(raw);
    currentSettings = next;
    applyThemeCssVariables(next.theme);
    listeners.forEach((fn) => fn());
  });
}

function persistAndNotify(next: CasaSettings): void {
  currentSettings = next;
  applyThemeCssVariables(next.theme);
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(next));
    } catch (err) {
      console.warn('[useSettingsStore] Failed to persist settings:', err);
    }
  }
  listeners.forEach((fn) => fn());
}

export function getSettingsSnapshot(): CasaSettings {
  return currentSettings;
}

export function updateSettings(
  patchOrFn: Partial<CasaSettings> | ((prev: CasaSettings) => CasaSettings)
): CasaSettings {
  const nextRaw =
    typeof patchOrFn === 'function'
      ? patchOrFn(currentSettings)
      : { ...currentSettings, ...patchOrFn };
  const sanitized = sanitizeSettings(nextRaw);
  persistAndNotify(sanitized);
  return sanitized;
}

export function resetAllSettings(preserveCustomAlarmMeta = true): CasaSettings {
  const next = sanitizeSettings({
    ...DEFAULT_CASA_SETTINGS,
    customAlarmMeta: preserveCustomAlarmMeta ? currentSettings.customAlarmMeta : null,
  });
  persistAndNotify(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSettingsStore() {
  const settings = useSyncExternalStore(
    subscribe,
    getSettingsSnapshot,
    () => DEFAULT_CASA_SETTINGS
  );

  const setSettings = useCallback(
    (patchOrFn: Partial<CasaSettings> | ((prev: CasaSettings) => CasaSettings)) => {
      return updateSettings(patchOrFn);
    },
    []
  );

  const resetSettings = useCallback((preserveCustomAlarmMeta = true) => {
    return resetAllSettings(preserveCustomAlarmMeta);
  }, []);

  return {
    settings,
    palette: CASA_THEME_PALETTES[settings.theme] || CASA_THEME_PALETTES.default,
    updateSettings: setSettings,
    resetSettings,
  };
}
