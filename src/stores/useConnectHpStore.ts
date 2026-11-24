import { create } from 'zustand';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  type ConnectHpIncomingItemEvent,
  type ConnectHpSessionInfo,
  type ConnectHpSyncItem,
  type NetworkInterfaceOption,
  type WindowsNetworkCategory,
  getConnectHpStatus,
  openWindowsNetworkSettings,
  selectConnectHpInterface,
  setConnectHpAutoCopy,
  startConnectHp,
  stopConnectHp,
  syncConnectHpItems,
} from '../utils/tauriBridge';
import { type DropItem, useDropZoneStore } from './useDropZoneStore';
import { playChimeCue } from '../utils/tauriBridge';

export interface ConnectHpStoreState {
  active: boolean;
  ip: string;
  port: number;
  url: string;
  qrSize: number;
  qrPath: string;
  networkCategory: WindowsNetworkCategory;
  candidateInterfaces: NetworkInterfaceOption[];
  connectedClients: number;
  autoCopyClipboard: boolean;
  idleTimeoutSecs: number;
  downloadDir: string;
  reason: string | null;
  isLoading: boolean;
  error: string | null;
  lastTransferNotice: string | null;
  initListeners: () => void;
  startSession: (preferredIp?: string) => Promise<void>;
  stopSession: () => Promise<void>;
  selectInterface: (ip: string) => Promise<void>;
  toggleAutoCopy: (enabled?: boolean) => Promise<void>;
  openNetworkSettings: (target: 'network' | 'hotspot' | 'firewall') => Promise<void>;
  pushItemsToBackend: (items?: DropItem[]) => Promise<void>;
}

export function mapDropItemsForHpSync(items: DropItem[]): ConnectHpSyncItem[] {
  return items.map((it) => {
    const isTextOrLink = it.type === 'text' || it.type === 'link';
    return {
      id: it.id,
      itemType: it.type,
      title: it.title,
      extension: it.extension,
      sizeBytes: it.sizeBytes,
      fileCount: it.fileCount,
      textPayload: isTextOrLink ? it.payload : undefined,
      localPath: !isTextOrLink ? it.payload : undefined,
    };
  });
}

let initializedListeners = false;
let unlistenStatus: UnlistenFn | null = null;
let unlistenIncoming: UnlistenFn | null = null;
let unsubscribeDropStore: (() => void) | null = null;
let transferNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let sessionOpSeq = 0;
let pendingStopPromise: Promise<void> | null = null;

function applySessionSnapshot(
  set: (partial: Partial<ConnectHpStoreState>) => void,
  info: ConnectHpSessionInfo
) {
  if (!info.active) {
    set({
      active: false,
      ip: '',
      port: 0,
      url: '',
      qrSize: 0,
      qrPath: '',
      networkCategory: info.networkCategory,
      candidateInterfaces: info.candidateInterfaces,
      connectedClients: 0,
      autoCopyClipboard: info.autoCopyClipboard,
      idleTimeoutSecs: info.idleTimeoutSecs,
      downloadDir: info.downloadDir,
      reason: info.reason ?? null,
      isLoading: false,
      error: null,
    });
    return;
  }

  set({
    active: true,
    ip: info.ip,
    port: info.port,
    url: info.url,
    qrSize: info.qrSize,
    qrPath: info.qrPath,
    networkCategory: info.networkCategory,
    candidateInterfaces: info.candidateInterfaces,
    connectedClients: info.connectedClients,
    autoCopyClipboard: info.autoCopyClipboard,
    idleTimeoutSecs: info.idleTimeoutSecs,
    downloadDir: info.downloadDir,
    reason: info.reason ?? null,
    isLoading: false,
    error: null,
  });
}

function flashTransferNotice(
  set: (partial: Partial<ConnectHpStoreState>) => void,
  msg: string
) {
  if (transferNoticeTimer) {
    clearTimeout(transferNoticeTimer);
    transferNoticeTimer = null;
  }
  set({ lastTransferNotice: msg });
  transferNoticeTimer = setTimeout(() => {
    transferNoticeTimer = null;
    set({ lastTransferNotice: null });
  }, 3200);
}

export const useConnectHpStore = create<ConnectHpStoreState>((set, get) => ({
  active: false,
  ip: '',
  port: 0,
  url: '',
  qrSize: 0,
  qrPath: '',
  networkCategory: 'Unknown',
  candidateInterfaces: [],
  connectedClients: 0,
  autoCopyClipboard: true,
  idleTimeoutSecs: 600,
  downloadDir: '',
  reason: null,
  isLoading: false,
  error: null,
  lastTransferNotice: null,

  initListeners: () => {
    if (initializedListeners) return;
    initializedListeners = true;

    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      void getConnectHpStatus().then((status) => {
        if (status && status.active) {
          applySessionSnapshot(set, status);
          void get().pushItemsToBackend();
        }
      });

      void listen<ConnectHpSessionInfo>('casa://connect-hp-status', (event) => {
        if (event.payload) {
          if (pendingStopPromise !== null && event.payload.active) {
            return;
          }
          applySessionSnapshot(set, event.payload);
        }
      }).then((fn) => {
        unlistenStatus = fn;
      });

      void listen<ConnectHpIncomingItemEvent>('casa://connect-hp-item', async (event) => {
        const payload = event.payload;
        if (!payload || !payload.payload) return;
        const dz = useDropZoneStore.getState();

        if (payload.kind === 'text') {
          await dz.addItem(payload.payload);
          playChimeCue('ding');
          flashTransferNotice(
            set,
            payload.copiedToClipboard ? 'Teks diterima & disalin' : 'Teks diterima dari HP'
          );
        } else if (payload.kind === 'batch_folder' && payload.batchId) {
          const count = payload.fileCount ?? 1;
          const total = payload.batchTotal ?? count;
          dz.upsertBatchFolderItem({
            batchId: payload.batchId,
            folderPath: payload.payload,
            title: payload.fileName || 'Batch HP',
            fileCount: count,
            batchTotal: total,
            sizeBytes: payload.sizeBytes ?? undefined,
          });
          if (count === 1 || count === total) {
            playChimeCue('ding');
          }
          flashTransferNotice(set, `${count}/${total} file masuk ke folder`);
        } else {
          await dz.addDroppedPaths([payload.payload]);
          playChimeCue('ding');
          flashTransferNotice(set, `${payload.fileName || 'Berkas'} diterima dari HP`);
        }
      }).then((fn) => {
        unlistenIncoming = fn;
      });
    }

    let lastSyncedItems = useDropZoneStore.getState().items;
    unsubscribeDropStore = useDropZoneStore.subscribe((state) => {
      if (state.items === lastSyncedItems) return;
      lastSyncedItems = state.items;
      if (get().active) {
        void get().pushItemsToBackend(state.items);
      }
    });
  },

  startSession: async (preferredIp?: string) => {
    if (pendingStopPromise) {
      await pendingStopPromise;
    }
    if (get().isLoading) return;
    const seq = ++sessionOpSeq;
    set({ isLoading: true, error: null });
    try {
      const info = await startConnectHp(preferredIp, get().autoCopyClipboard);
      if (seq !== sessionOpSeq) return;
      applySessionSnapshot(set, info);
      if (info.active) {
        await get().pushItemsToBackend();
      }
    } catch (err) {
      if (seq !== sessionOpSeq) return;
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Gagal menyalakan server Connect HP',
      });
    }
  },

  stopSession: async () => {
    const seq = ++sessionOpSeq;
    if (transferNoticeTimer) {
      clearTimeout(transferNoticeTimer);
      transferNoticeTimer = null;
    }
    set({
      active: false,
      ip: '',
      port: 0,
      url: '',
      qrSize: 0,
      qrPath: '',
      connectedClients: 0,
      isLoading: false,
      error: null,
      lastTransferNotice: null,
      reason: 'manual_stop',
    });

    const p = stopConnectHp()
      .catch(() => {
        // Ignore cleanly
      })
      .finally(() => {
        if (pendingStopPromise === p) {
          pendingStopPromise = null;
        }
      });
    pendingStopPromise = p;
    await p;

    if (seq === sessionOpSeq) {
      set({
        active: false,
        ip: '',
        port: 0,
        url: '',
        qrSize: 0,
        qrPath: '',
        connectedClients: 0,
        isLoading: false,
        reason: 'manual_stop',
      });
    }
  },

  selectInterface: async (ip: string) => {
    if (pendingStopPromise) {
      await pendingStopPromise;
    }
    if (!get().active) {
      await get().startSession(ip);
      return;
    }
    set({ isLoading: true, error: null });
    try {
      const info = await selectConnectHpInterface(ip);
      applySessionSnapshot(set, info);
    } catch (err) {
      set({
        isLoading: false,
        error: err instanceof Error ? err.message : 'Gagal mengganti antarmuka jaringan',
      });
    }
  },

  toggleAutoCopy: async (enabled?: boolean) => {
    const next = typeof enabled === 'boolean' ? enabled : !get().autoCopyClipboard;
    set({ autoCopyClipboard: next });
    if (get().active) {
      try {
        const info = await setConnectHpAutoCopy(next);
        if (info) applySessionSnapshot(set, info);
      } catch {
        // Ignore cleanly
      }
    }
  },

  openNetworkSettings: async (target: 'network' | 'hotspot' | 'firewall') => {
    await openWindowsNetworkSettings(target);
  },

  pushItemsToBackend: async (items?: DropItem[]) => {
    if (!get().active) return;
    const list = items ?? useDropZoneStore.getState().items;
    await syncConnectHpItems(mapDropItemsForHpSync(list));
  },
}));

export function teardownConnectHpListenersForTest(): void {
  unlistenStatus?.();
  unlistenIncoming?.();
  unsubscribeDropStore?.();
  unlistenStatus = null;
  unlistenIncoming = null;
  unsubscribeDropStore = null;
  initializedListeners = false;
  if (transferNoticeTimer) {
    clearTimeout(transferNoticeTimer);
    transferNoticeTimer = null;
  }
}
