import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';

export type BatteryStatus = 'charging' | 'plugged_in' | 'low' | 'normal';

export interface BatteryTelemetry {
  has_battery: boolean;
  percent: number;
  is_plugged_in: boolean;
  is_charging: boolean;
  status: BatteryStatus;
}

export interface SystemTelemetryStats {
  cpu_usage_percent: number;
  ram_used_gb: number;
  ram_total_gb: number;
  ram_percent: number;
  battery: BatteryTelemetry;
}

export const DEFAULT_SYSTEM_TELEMETRY: SystemTelemetryStats = {
  cpu_usage_percent: 0,
  ram_used_gb: 0,
  ram_total_gb: 0,
  ram_percent: 0,
  battery: {
    has_battery: false,
    percent: 100,
    is_plugged_in: true,
    is_charging: false,
    status: 'normal',
  },
};

const isTauriRuntime =
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const FOREGROUND_POLL_MS = 2000;
const BACKGROUND_POLL_MS = 6000;

let sharedStats: SystemTelemetryStats = DEFAULT_SYSTEM_TELEMETRY;
let hasFetchedOnce = false;
let inFlightPromise: Promise<void> | null = null;
let pollTimerId: ReturnType<typeof setInterval> | null = null;
let currentIntervalMs: number | null = null;

const subscribers = new Set<(stats: SystemTelemetryStats) => void>();
const controlCenterTokens = new Set<symbol>();

function notifyAll(next: SystemTelemetryStats) {
  subscribers.forEach((cb) => cb(next));
}

async function fetchStatsOnce(): Promise<void> {
  if (!isTauriRuntime) return;
  if (inFlightPromise) return inFlightPromise;

  inFlightPromise = invoke<SystemTelemetryStats>('get_system_telemetry')
    .then((data) => {
      if (data && typeof data.cpu_usage_percent === 'number') {
        sharedStats = data;
        hasFetchedOnce = true;
        notifyAll(data);
      }
    })
    .catch((err) => {
      console.warn('[useSystemTelemetry] get_system_telemetry error:', err);
    })
    .finally(() => {
      inFlightPromise = null;
    });

  return inFlightPromise;
}

function syncPollingScheduler() {
  if (!isTauriRuntime || subscribers.size === 0) {
    if (pollTimerId !== null) {
      clearInterval(pollTimerId);
      pollTimerId = null;
    }
    currentIntervalMs = null;
    return;
  }

  const desiredMs =
    controlCenterTokens.size > 0 ? FOREGROUND_POLL_MS : BACKGROUND_POLL_MS;

  if (pollTimerId !== null && currentIntervalMs === desiredMs) {
    return;
  }

  if (pollTimerId !== null) {
    clearInterval(pollTimerId);
  }
  currentIntervalMs = desiredMs;
  pollTimerId = setInterval(() => {
    void fetchStatsOnce();
  }, desiredMs);
}

/**
 * Adaptive hardware telemetry hook powered by native Rust `sysinfo` + Win32 `GetSystemPowerStatus`.
 * Shares a single background scheduler: 2000ms when Control Center is open, 6000ms in background.
 */
export function useSystemTelemetry(isControlCenterOpen = false) {
  const [stats, setStats] = useState<SystemTelemetryStats>(sharedStats);
  const [isLoaded, setIsLoaded] = useState<boolean>(hasFetchedOnce);

  useEffect(() => {
    const listener = (next: SystemTelemetryStats) => {
      setStats(next);
      setIsLoaded(true);
    };
    subscribers.add(listener);

    if (!hasFetchedOnce) {
      void fetchStatsOnce();
    } else {
      setStats(sharedStats);
      setIsLoaded(true);
    }

    syncPollingScheduler();

    return () => {
      subscribers.delete(listener);
      syncPollingScheduler();
    };
  }, []);

  useEffect(() => {
    const token = Symbol('cc-telemetry');
    if (isControlCenterOpen) {
      controlCenterTokens.add(token);
      void fetchStatsOnce();
    }
    syncPollingScheduler();

    return () => {
      controlCenterTokens.delete(token);
      syncPollingScheduler();
    };
  }, [isControlCenterOpen]);

  const refresh = useCallback(async () => {
    await fetchStatsOnce();
  }, []);

  return {
    stats,
    isLoaded,
    refresh,
  };
}
