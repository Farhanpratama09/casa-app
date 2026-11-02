import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';

export type AudioDeviceType = 'speaker' | 'headphone_wired' | 'headphone_bluetooth' | 'unknown';

export interface AudioDeviceItem {
  id: string;
  name: string;
  device_type: AudioDeviceType;
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
}

const DEFAULT_TELEMETRY: SystemTelemetry = {
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
};

const isTauriEnv = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

export function useSystemHardware() {
  const [telemetry, setTelemetry] = useState<SystemTelemetry>(DEFAULT_TELEMETRY);
  const [audioDevices, setAudioDevices] = useState<AudioDeviceItem[]>([]);

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

  useEffect(() => {
    if (!isTauriEnv) return;

    let isMounted = true;

    // 1. Initial snapshot fetch
    invoke<SystemTelemetry>('get_system_telemetry')
      .then((data) => {
        if (isMounted && data) {
          console.log('[Hardware Telemetry]', data);
          setTelemetry(data);
        }
      })
      .catch((err) => {
        console.warn('[useSystemHardware] Failed to fetch initial telemetry:', err);
      });

    // 2. Fetch active audio devices
    fetchAudioDevices();

    // 3. Event listener for real-time daemon updates
    const unlistenPromise = listen<SystemTelemetry>('system-telemetry-update', (event) => {
      if (isMounted && event.payload) {
        console.log('[Hardware Telemetry]', event.payload);
        setTelemetry(event.payload);
      }
    });

    return () => {
      isMounted = false;
      unlistenPromise.then((unlisten) => unlisten());
    };
  }, [fetchAudioDevices]);

  const setMasterVolume = useCallback(async (level: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    setTelemetry((prev) => ({ ...prev, master_volume: clamped }));
    if (!isTauriEnv) return;
    try {
      await invoke('set_master_volume', { volume: clamped });
    } catch (err) {
      console.warn('[useSystemHardware] set_master_volume error:', err);
    }
  }, []);

  const setBrightness = useCallback(async (level: number) => {
    const clamped = Math.max(0, Math.min(100, Math.round(level)));
    setTelemetry((prev) => ({ ...prev, brightness_percent: clamped }));
    if (!isTauriEnv) return;
    try {
      await invoke('set_display_brightness', { brightness: clamped });
    } catch (err) {
      console.warn('[useSystemHardware] set_display_brightness error:', err);
    }
  }, []);

  const toggleMute = useCallback(async () => {
    setTelemetry((prev) => ({ ...prev, is_muted: !prev.is_muted }));
    if (!isTauriEnv) return;
    try {
      const newMuted = await invoke<boolean>('toggle_audio_mute');
      setTelemetry((prev) => ({ ...prev, is_muted: newMuted }));
    } catch (err) {
      console.warn('[useSystemHardware] toggle_audio_mute error:', err);
    }
  }, []);

  return {
    telemetry,
    audioDevices,
    fetchAudioDevices,
    selectAudioDevice,
    setMasterVolume,
    setBrightness,
    toggleMute,
  };
}
