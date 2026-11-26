import { useState, useEffect, useCallback, useRef } from 'react';
import { CASA_THEME_PALETTES, getSettingsSnapshot } from '../stores/useSettingsStore';

function getActivePalette() {
  return CASA_THEME_PALETTES[getSettingsSnapshot().theme] || CASA_THEME_PALETTES.default;
}
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import {
  scanWifiNetworks,
  connectWifiNetwork,
  openCaptivePortalBrowser,
  openAvailableWifiNetworks,
  listPairedBluetooth,
  toggleBluetoothDevice,
  type WifiNetworkItem,
  type BluetoothDeviceItem,
  type ConnectedBluetoothDevice,
} from '../utils/tauriBridge';

export type AudioDeviceType = 'speaker' | 'headphone_wired' | 'headphone_bluetooth' | 'unknown';
export type AudioOutputKind = 'bluetooth' | 'wired' | 'speaker';

export interface AudioDeviceItem {
  id: string;
  name: string;
  device_type: AudioDeviceType;
  output_kind?: AudioOutputKind;
  battery_percent?: number | null;
  is_default: boolean;
}

export interface SystemTelemetry {
  // Power
  battery_percentage: number;
  is_charging: boolean;
  has_battery: boolean;

  // Keyboard
  is_caps_locked: boolean;

  // Display
  brightness_percent: number;
  is_brightness_supported: boolean;

  // Audio Endpoint
  master_volume: number;
  is_muted: boolean;
  audio_device_name: string;
  audio_device_type: AudioDeviceType;
  audio_output_kind: AudioOutputKind;
  audio_output_battery: number | null;

  // Connectivity & Power Wake Lock
  wifi_enabled: boolean;
  wifi_supported: boolean;
  wifi_ssid: string | null;
  bluetooth_enabled: boolean;
  bluetooth_supported: boolean;
  bluetooth_device_name: string | null;
  connected_bluetooth_devices: ConnectedBluetoothDevice[];
  stay_awake: boolean;
  is_fullscreen_active?: boolean;
}

export type SystemHudKind =
  | 'volume'
  | 'brightness'
  | 'mute'
  | 'charging'
  | 'low_battery'
  | 'caps_lock'
  | 'bluetooth'
  | 'audio_output';

export interface SystemHudAlert {
  id: number;
  kind: SystemHudKind;
  label: string;
  detail?: string;
  percent?: number;
  isActive?: boolean;
  audioOutputKind?: AudioOutputKind;
  accentColor: string;
}

export const DEFAULT_TELEMETRY: SystemTelemetry = {
  battery_percentage: 100,
  is_charging: true,
  has_battery: false,
  is_caps_locked: false,
  brightness_percent: 50,
  is_brightness_supported: false,
  master_volume: 50,
  is_muted: false,
  audio_device_name: 'Default Audio Device',
  audio_device_type: 'speaker',
  audio_output_kind: 'speaker',
  audio_output_battery: null,
  wifi_enabled: false,
  wifi_supported: false,
  wifi_ssid: null,
  bluetooth_enabled: false,
  bluetooth_supported: false,
  bluetooth_device_name: null,
  connected_bluetooth_devices: [],
  stay_awake: false,
  is_fullscreen_active: false,
};

export function formatAudioOutputLabel(
  kind: AudioOutputKind,
  batteryPercent?: number | null
): string {
  switch (kind) {
    case 'bluetooth':
      return typeof batteryPercent === 'number'
        ? `BT Earphone • ${batteryPercent}%`
        : 'BT Earphone';
    case 'wired':
      return 'Wired Earphone';
    case 'speaker':
    default:
      return 'Speaker';
  }
}

const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
const HUD_DURATION_MS = 2500;

// =========================================================================
// Singleton Hardware Telemetry & Transient System HUD Broadcaster
// =========================================================================
let sharedTelemetry: SystemTelemetry = DEFAULT_TELEMETRY;
let sharedHudAlert: SystemHudAlert | null = null;
let sharedBaseline: SystemTelemetry | null = null;
let firstTelemetryAt = 0;
let hudDismissTimer: ReturnType<typeof setTimeout> | null = null;
let hudInteracting = false;
let hudSeq = 0;
let listenerInitialized = false;

const telemetrySubscribers = new Set<(t: SystemTelemetry) => void>();
const hudSubscribers = new Set<(h: SystemHudAlert | null) => void>();

function notifyTelemetrySubscribers(t: SystemTelemetry) {
  sharedTelemetry = t;
  telemetrySubscribers.forEach((fn) => fn(t));
}

function notifyHudSubscribers(h: SystemHudAlert | null) {
  sharedHudAlert = h;
  hudSubscribers.forEach((fn) => fn(h));
}

function clearHudTimer() {
  if (hudDismissTimer !== null) {
    clearTimeout(hudDismissTimer);
    hudDismissTimer = null;
  }
}

function scheduleHudDismiss() {
  clearHudTimer();
  if (hudInteracting) return;
  hudDismissTimer = setTimeout(() => {
    hudDismissTimer = null;
    if (!hudInteracting) {
      notifyHudSubscribers(null);
    }
  }, HUD_DURATION_MS);
}

export function triggerSystemHud(alert: Omit<SystemHudAlert, 'id'>) {
  const nextId =
    sharedHudAlert && sharedHudAlert.kind === alert.kind ? sharedHudAlert.id : ++hudSeq;
  notifyHudSubscribers({ ...alert, id: nextId });
  scheduleHudDismiss();
}

export function dismissSystemHud() {
  clearHudTimer();
  hudInteracting = false;
  notifyHudSubscribers(null);
}

export function setSystemHudInteracting(interacting: boolean) {
  hudInteracting = interacting;
  if (interacting) {
    clearHudTimer();
  } else if (sharedHudAlert) {
    scheduleHudDismiss();
  }
}

function normalizeTelemetryPayload(raw: Partial<SystemTelemetry>): SystemTelemetry {
  const audioDeviceType: AudioDeviceType = raw.audio_device_type ?? 'speaker';
  const derivedKind: AudioOutputKind =
    raw.audio_output_kind === 'bluetooth' ||
    raw.audio_output_kind === 'wired' ||
    raw.audio_output_kind === 'speaker'
      ? raw.audio_output_kind
      : audioDeviceType === 'headphone_bluetooth'
      ? 'bluetooth'
      : audioDeviceType === 'headphone_wired'
      ? 'wired'
      : 'speaker';

  return {
    ...DEFAULT_TELEMETRY,
    ...raw,
    audio_device_type: audioDeviceType,
    audio_output_kind: derivedKind,
    audio_output_battery:
      typeof raw.audio_output_battery === 'number' ? raw.audio_output_battery : null,
    connected_bluetooth_devices: Array.isArray(raw.connected_bluetooth_devices)
      ? raw.connected_bluetooth_devices
      : [],
  };
}

function btDeviceKey(dev: ConnectedBluetoothDevice): string {
  const addr = dev.address?.trim().toLowerCase();
  if (addr) return `mac:${addr}`;
  return `name:${dev.name.trim().toLowerCase()}`;
}

function shortenAudioDeviceName(name: string): string {
  const trimmed = name.trim();
  const parenMatch = trimmed.match(/\(([^()]+)\)$/);
  const inner = parenMatch ? parenMatch[1].trim() : trimmed;
  return inner.length > 26 ? `${inner.slice(0, 24)}…` : inner;
}

function applyIncomingTelemetry(rawNext: SystemTelemetry) {
  const next = normalizeTelemetryPayload(rawNext);
  if (!sharedBaseline) {
    sharedBaseline = next;
    firstTelemetryAt = Date.now();
    notifyTelemetrySubscribers(next);
    return;
  }

  const prev = sharedBaseline;
  sharedBaseline = next;
  notifyTelemetrySubscribers(next);

  // Ignore initial ~1.2s daemon warm-up diffs (initial brightness / battery / radio reads)
  if (Date.now() - firstTelemetryAt < 1200) {
    return;
  }

  // Detect Bluetooth device connection / disconnection diffs cleanly
  const prevBtMap = new Map(prev.connected_bluetooth_devices.map((d) => [btDeviceKey(d), d]));
  const nextBtMap = new Map(next.connected_bluetooth_devices.map((d) => [btDeviceKey(d), d]));

  const newlyConnectedBt = next.connected_bluetooth_devices.find(
    (d) => !prevBtMap.has(btDeviceKey(d))
  );
  const newlyDisconnectedBt = prev.connected_bluetooth_devices.find(
    (d) => !nextBtMap.has(btDeviceKey(d))
  );

  const audioOutputSwitched =
    next.audio_output_kind !== prev.audio_output_kind ||
    next.audio_device_name !== prev.audio_device_name;

  // Prioritize acute changes cleanly into single transient HUD notification
  const palette = getActivePalette();

  if (newlyConnectedBt) {
    triggerSystemHud({
      kind: 'bluetooth',
      label: `Connected • ${newlyConnectedBt.name}`,
      detail:
        typeof newlyConnectedBt.battery_percent === 'number'
          ? `${newlyConnectedBt.battery_percent}%`
          : undefined,
      isActive: true,
      accentColor: palette.bluetooth,
    });
  } else if (newlyDisconnectedBt) {
    triggerSystemHud({
      kind: 'bluetooth',
      label: `Disconnected • ${newlyDisconnectedBt.name}`,
      isActive: false,
      accentColor: '#71717A',
    });
  } else if (audioOutputSwitched) {
    const kindLabel =
      next.audio_output_kind === 'bluetooth'
        ? 'BT Earphone'
        : next.audio_output_kind === 'wired'
        ? 'Wired Earphone'
        : 'Speaker';
    const detailText =
      next.audio_output_kind === 'bluetooth' && typeof next.audio_output_battery === 'number'
        ? `${next.audio_output_battery}%`
        : shortenAudioDeviceName(next.audio_device_name);

    triggerSystemHud({
      kind: 'audio_output',
      label: kindLabel,
      detail: detailText || undefined,
      isActive: true,
      audioOutputKind: next.audio_output_kind,
      accentColor:
        next.audio_output_kind === 'bluetooth'
          ? palette.bluetooth
          : palette.volume,
    });
  } else if (next.is_muted !== prev.is_muted) {
    triggerSystemHud({
      kind: 'mute',
      label: next.is_muted ? 'Muted' : 'Unmuted',
      detail: next.is_muted ? '0%' : `${next.master_volume}%`,
      percent: next.is_muted ? 0 : next.master_volume,
      isActive: next.is_muted,
      accentColor: next.is_muted ? palette.danger : palette.volume,
    });
  } else if (next.master_volume !== prev.master_volume) {
    triggerSystemHud({
      kind: 'volume',
      label: 'Volume',
      detail: `${next.master_volume}%`,
      percent: next.master_volume,
      isActive: !next.is_muted,
      accentColor: next.is_muted ? palette.danger : palette.volume,
    });
  } else if (next.is_brightness_supported && next.brightness_percent !== prev.brightness_percent) {
    triggerSystemHud({
      kind: 'brightness',
      label: 'Brightness',
      detail: `${next.brightness_percent}%`,
      percent: next.brightness_percent,
      isActive: true,
      accentColor: palette.brightness,
    });
  } else if (next.has_battery && next.is_charging !== prev.is_charging) {
    const unpluggedColor =
      next.battery_percentage <= 10
        ? '#ef4444'
        : next.battery_percentage <= 20
        ? '#f59e0b'
        : '#22c55e';
    triggerSystemHud({
      kind: 'charging',
      label: next.is_charging ? 'Charging' : 'On Battery',
      detail: `${next.battery_percentage}%`,
      percent: next.battery_percentage,
      isActive: next.is_charging,
      accentColor: next.is_charging ? '#22c55e' : unpluggedColor,
    });
  } else if (
    next.has_battery &&
    !next.is_charging &&
    next.battery_percentage <= 20 &&
    prev.battery_percentage > 20
  ) {
    triggerSystemHud({
      kind: 'low_battery',
      label: 'Low Battery',
      detail: `${next.battery_percentage}%`,
      percent: next.battery_percentage,
      isActive: false,
      accentColor: next.battery_percentage <= 10 ? '#ef4444' : '#f59e0b',
    });
  } else if (next.is_caps_locked !== prev.is_caps_locked) {
    triggerSystemHud({
      kind: 'caps_lock',
      label: next.is_caps_locked ? 'Caps Lock ON' : 'Caps Lock OFF',
      isActive: next.is_caps_locked,
      accentColor: next.is_caps_locked ? palette.volume : 'rgba(255,255,255,0.65)',
    });
  }
}

function ensureGlobalTelemetryListener() {
  if (!isTauriEnv || listenerInitialized) return;
  listenerInitialized = true;

  invoke<SystemTelemetry>('get_hardware_telemetry')
    .then((data) => {
      if (data) {
        applyIncomingTelemetry(data);
      }
    })
    .catch((err) => {
      console.warn('[useSystemHardware] Failed to fetch initial telemetry:', err);
    });

  void listen<SystemTelemetry>('system-telemetry-update', (event) => {
    if (event.payload) {
      applyIncomingTelemetry(event.payload);
    }
  });
}

export function useSystemHardware() {
  const [telemetry, setTelemetry] = useState<SystemTelemetry>(sharedTelemetry);
  const [hudAlert, setHudAlert] = useState<SystemHudAlert | null>(sharedHudAlert);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceItem[]>([]);

  const [wifiNetworks, setWifiNetworks] = useState<WifiNetworkItem[]>([]);
  const [wifiScanning, setWifiScanning] = useState(false);
  const [wifiError, setWifiError] = useState<string | null>(null);

  const [bluetoothDevices, setBluetoothDevices] = useState<BluetoothDeviceItem[]>([]);
  const [bluetoothScanning, setBluetoothScanning] = useState(false);
  const [bluetoothError, setBluetoothError] = useState<string | null>(null);

  const telemetryRef = useRef<SystemTelemetry>(telemetry);
  telemetryRef.current = telemetry;

  const fetchAudioDevices = useCallback(async () => {
    if (!isTauriEnv) return [];
    try {
      const devices = await invoke<AudioDeviceItem[]>('get_audio_output_devices');
      setAudioDevices(devices);
      return devices;
    } catch (err) {
      console.warn('[useSystemHardware] get_audio_output_devices error:', err);
      return [];
    }
  }, []);

  const selectAudioDevice = useCallback(
    async (deviceId: string) => {
      if (!isTauriEnv) return;
      try {
        await invoke('set_default_audio_endpoint', { deviceId });
        setAudioDevices((prev) =>
          prev.map((d) => ({
            ...d,
            is_default: d.id === deviceId,
          }))
        );
        await fetchAudioDevices();
      } catch (err) {
        console.warn('[useSystemHardware] set_default_audio_endpoint error:', err);
      }
    },
    [fetchAudioDevices]
  );

  const fetchWifiNetworks = useCallback(async () => {
    if (!isTauriEnv) return [];
    setWifiScanning(true);
    setWifiError(null);
    try {
      const nets = await scanWifiNetworks();
      setWifiNetworks(nets);
      return nets;
    } catch (err) {
      const msg = typeof err === 'string' ? err : 'Gagal memindai Wi-Fi.';
      setWifiError(msg);
      return [];
    } finally {
      setWifiScanning(false);
    }
  }, []);

  const connectWifi = useCallback(
    async (ssid: string, password?: string) => {
      if (!isTauriEnv) return false;
      setWifiError(null);
      try {
        await connectWifiNetwork(ssid, password);
        await fetchWifiNetworks();
        window.setTimeout(() => {
          void fetchWifiNetworks();
        }, 1800);
        return true;
      } catch (err) {
        const msg = typeof err === 'string' ? err : 'Gagal menghubungkan ke Wi-Fi.';
        setWifiError(msg);
        return false;
      }
    },
    [fetchWifiNetworks]
  );

  const fetchBluetoothDevices = useCallback(async () => {
    if (!isTauriEnv) return [];
    setBluetoothScanning(true);
    setBluetoothError(null);
    try {
      const devs = await listPairedBluetooth();
      setBluetoothDevices(devs);
      return devs;
    } catch (err) {
      const msg = typeof err === 'string' ? err : 'Gagal memuat perangkat Bluetooth.';
      setBluetoothError(msg);
      return [];
    } finally {
      setBluetoothScanning(false);
    }
  }, []);

  const toggleBluetoothConnection = useCallback(
    async (address: string, connect: boolean) => {
      if (!isTauriEnv) return false;
      setBluetoothError(null);
      try {
        await toggleBluetoothDevice(address, connect);
        await fetchBluetoothDevices();
        window.setTimeout(() => {
          void fetchBluetoothDevices();
        }, 1600);
        return true;
      } catch (err) {
        const msg = typeof err === 'string' ? err : 'Gagal mengubah koneksi Bluetooth.';
        setBluetoothError(msg);
        return false;
      }
    },
    [fetchBluetoothDevices]
  );

  useEffect(() => {
    ensureGlobalTelemetryListener();
    telemetrySubscribers.add(setTelemetry);
    hudSubscribers.add(setHudAlert);
    setTelemetry(sharedTelemetry);
    setHudAlert(sharedHudAlert);

    if (isTauriEnv) {
      fetchAudioDevices();
    }

    return () => {
      telemetrySubscribers.delete(setTelemetry);
      hudSubscribers.delete(setHudAlert);
    };
  }, [fetchAudioDevices]);

  const setMasterVolume = useCallback(async (level: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const nextSnapshot = { ...telemetryRef.current, master_volume: clamped };
    sharedBaseline = nextSnapshot;
    notifyTelemetrySubscribers(nextSnapshot);
    triggerSystemHud({
      kind: 'volume',
      label: 'Volume',
      detail: `${clamped}%`,
      percent: clamped,
      isActive: !nextSnapshot.is_muted,
      accentColor: nextSnapshot.is_muted ? getActivePalette().danger : getActivePalette().volume,
    });
    if (!isTauriEnv) return;
    try {
      await invoke('set_master_volume', { volume: clamped });
    } catch (err) {
      console.warn('[useSystemHardware] set_master_volume error:', err);
    }
  }, []);

  const setBrightness = useCallback(async (level: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    const nextSnapshot = { ...telemetryRef.current, brightness_percent: clamped };
    sharedBaseline = nextSnapshot;
    notifyTelemetrySubscribers(nextSnapshot);
    if (nextSnapshot.is_brightness_supported) {
      triggerSystemHud({
        kind: 'brightness',
        label: 'Brightness',
        detail: `${clamped}%`,
        percent: clamped,
        isActive: true,
        accentColor: getActivePalette().brightness,
      });
    }
    if (!isTauriEnv) return;
    try {
      await invoke('set_display_brightness', { brightness: clamped });
    } catch (err) {
      console.warn('[useSystemHardware] set_display_brightness error:', err);
    }
  }, []);

  const toggleMute = useCallback(async () => {
    const optimisticMuted = !telemetryRef.current.is_muted;
    const optimistic = { ...telemetryRef.current, is_muted: optimisticMuted };
    sharedBaseline = optimistic;
    notifyTelemetrySubscribers(optimistic);
    triggerSystemHud({
      kind: 'mute',
      label: optimisticMuted ? 'Muted' : 'Unmuted',
      detail: optimisticMuted ? '0%' : `${optimistic.master_volume}%`,
      percent: optimisticMuted ? 0 : optimistic.master_volume,
      isActive: optimisticMuted,
      accentColor: optimisticMuted ? getActivePalette().danger : getActivePalette().volume,
    });
    if (!isTauriEnv) return;
    try {
      const newMuted = await invoke<boolean>('toggle_audio_mute');
      const confirmed = { ...telemetryRef.current, is_muted: newMuted };
      sharedBaseline = confirmed;
      notifyTelemetrySubscribers(confirmed);
    } catch (err) {
      console.warn('[useSystemHardware] toggle_audio_mute error:', err);
    }
  }, []);

  const toggleStayAwake = useCallback(async () => {
    const targetState = !telemetryRef.current.stay_awake;
    const optimistic = { ...telemetryRef.current, stay_awake: targetState };
    sharedBaseline = optimistic;
    notifyTelemetrySubscribers(optimistic);
    if (!isTauriEnv) return;
    try {
      const actual = await invoke<boolean>('set_stay_awake', { enabled: targetState });
      const confirmed = { ...telemetryRef.current, stay_awake: actual };
      sharedBaseline = confirmed;
      notifyTelemetrySubscribers(confirmed);
    } catch (err) {
      console.warn('[useSystemHardware] set_stay_awake error:', err);
    }
  }, []);

  const toggleWifi = useCallback(async () => {
    const optimisticNext = !telemetryRef.current.wifi_enabled;
    const optimistic = { ...telemetryRef.current, wifi_enabled: optimisticNext };
    sharedBaseline = optimistic;
    notifyTelemetrySubscribers(optimistic);
    if (!isTauriEnv) return;
    try {
      const actual = await invoke<boolean>('toggle_wifi', { enabled: optimisticNext });
      const confirmed = {
        ...telemetryRef.current,
        wifi_enabled: actual,
        wifi_supported: true,
        wifi_ssid: actual ? telemetryRef.current.wifi_ssid : null,
      };
      sharedBaseline = confirmed;
      notifyTelemetrySubscribers(confirmed);
    } catch (err) {
      console.warn('[useSystemHardware] toggle_wifi error:', err);
      try {
        const latest = await invoke<SystemTelemetry>('get_hardware_telemetry');
        sharedBaseline = latest;
        notifyTelemetrySubscribers(latest);
      } catch {
        // ignore
      }
    }
  }, []);

  const toggleBluetooth = useCallback(async () => {
    const optimisticNext = !telemetryRef.current.bluetooth_enabled;
    const optimistic = { ...telemetryRef.current, bluetooth_enabled: optimisticNext };
    sharedBaseline = optimistic;
    notifyTelemetrySubscribers(optimistic);
    if (!isTauriEnv) return;
    try {
      const actual = await invoke<boolean>('toggle_bluetooth', { enabled: optimisticNext });
      const confirmed = normalizeTelemetryPayload({
        ...telemetryRef.current,
        bluetooth_enabled: actual,
        bluetooth_supported: true,
        bluetooth_device_name: actual ? telemetryRef.current.bluetooth_device_name : null,
        connected_bluetooth_devices: actual
          ? telemetryRef.current.connected_bluetooth_devices
          : [],
      });
      sharedBaseline = confirmed;
      notifyTelemetrySubscribers(confirmed);
    } catch (err) {
      console.warn('[useSystemHardware] toggle_bluetooth error:', err);
      try {
        const latest = normalizeTelemetryPayload(
          await invoke<SystemTelemetry>('get_hardware_telemetry')
        );
        sharedBaseline = latest;
        notifyTelemetrySubscribers(latest);
      } catch {
        // ignore
      }
    }
  }, []);

  const openCaptivePortal = useCallback(async () => {
    if (!isTauriEnv) return false;
    try {
      await openCaptivePortalBrowser();
      return true;
    } catch (err) {
      const msg = typeof err === 'string' ? err : 'Gagal membuka halaman login portal Wi-Fi.';
      setWifiError(msg);
      return false;
    }
  }, []);

  const openEnterpriseWifiDialog = useCallback(async () => {
    if (!isTauriEnv) return false;
    try {
      await openAvailableWifiNetworks();
      return true;
    } catch (err) {
      const msg = typeof err === 'string' ? err : 'Gagal membuka dialog jaringan Windows.';
      setWifiError(msg);
      return false;
    }
  }, []);

  const captivePortalSsid =
    wifiNetworks.find((n) => n.is_connected && n.is_captive_portal)?.ssid ?? null;

  return {
    telemetry,
    hudAlert,
    dismissHudAlert: dismissSystemHud,
    setHudInteracting: setSystemHudInteracting,
    audioDevices,
    fetchAudioDevices,
    selectAudioDevice,
    wifiNetworks,
    wifiScanning,
    wifiError,
    captivePortalSsid,
    fetchWifiNetworks,
    connectWifi,
    openCaptivePortal,
    openEnterpriseWifiDialog,
    bluetoothDevices,
    bluetoothScanning,
    bluetoothError,
    fetchBluetoothDevices,
    toggleBluetoothConnection,
    setMasterVolume,
    setBrightness,
    toggleMute,
    toggleStayAwake,
    toggleWifi,
    toggleBluetooth,
  };
}
