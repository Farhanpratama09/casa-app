import { useEffect, useSyncExternalStore } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  clearUpdateNotification,
  dismissUpdateBadge,
  getUpdateNotificationStatus,
  triggerBackgroundUpdateCheck,
  type UpdateNotificationStatus,
} from '../utils/tauriBridge';

const DEFAULT_STATUS: UpdateNotificationStatus = {
  currentVersion: '2.0.4',
  latestVersion: null,
  releaseUrl: null,
  updateAvailable: false,
  badgeVisible: false,
};

let currentStatus: UpdateNotificationStatus = DEFAULT_STATUS;
const listeners = new Set<() => void>();
let subscriberCount = 0;
let initialized = false;
let unlistenEvent: UnlistenFn | null = null;
let lastWakeTriggerAtMs = 0;

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

function setStatus(next: UpdateNotificationStatus): void {
  if (
    currentStatus.currentVersion === next.currentVersion &&
    currentStatus.latestVersion === next.latestVersion &&
    currentStatus.releaseUrl === next.releaseUrl &&
    currentStatus.updateAvailable === next.updateAvailable &&
    currentStatus.badgeVisible === next.badgeVisible
  ) {
    return;
  }
  currentStatus = next;
  listeners.forEach((cb) => cb());
}

function triggerDebouncedWakeCheck(): void {
  const now = Date.now();
  if (now - lastWakeTriggerAtMs < 180_000) return;
  lastWakeTriggerAtMs = now;
  void triggerBackgroundUpdateCheck();
}

function handleWindowFocusOrWake(): void {
  if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
  triggerDebouncedWakeCheck();
}

async function ensureSubscribed(): Promise<void> {
  if (initialized || !isTauriRuntime()) return;
  initialized = true;

  try {
    const initial = await getUpdateNotificationStatus();
    setStatus(initial);
  } catch {}

  try {
    unlistenEvent = await listen<UpdateNotificationStatus>('casa://update-status', (event) => {
      if (event.payload) {
        setStatus(event.payload);
      }
    });
  } catch {}

  if (typeof window !== 'undefined') {
    window.addEventListener('focus', handleWindowFocusOrWake);
  }
  if (typeof document !== 'undefined') {
    document.addEventListener('visibilitychange', handleWindowFocusOrWake);
  }
}

function teardownIfUnused(): void {
  if (subscriberCount > 0 || !initialized) return;
  initialized = false;
  if (unlistenEvent) {
    unlistenEvent();
    unlistenEvent = null;
  }
  if (typeof window !== 'undefined') {
    window.removeEventListener('focus', handleWindowFocusOrWake);
  }
  if (typeof document !== 'undefined') {
    document.removeEventListener('visibilitychange', handleWindowFocusOrWake);
  }
}

export function useUpdateNotification() {
  const status = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
    () => currentStatus,
    () => DEFAULT_STATUS
  );

  useEffect(() => {
    subscriberCount += 1;
    void ensureSubscribed();
    return () => {
      subscriberCount = Math.max(0, subscriberCount - 1);
      teardownIfUnused();
    };
  }, []);

  return {
    ...status,
    dismissBadge: async () => {
      const updated = await dismissUpdateBadge();
      if (updated) setStatus(updated);
    },
    clearNotification: async () => {
      const updated = await clearUpdateNotification();
      if (updated) setStatus(updated);
    },
  };
}
