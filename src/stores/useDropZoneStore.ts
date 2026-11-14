import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type DropItemType = 'file' | 'image' | 'text' | 'url';

export const IMAGE_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'svg',
  'ico',
  'avif',
]);

export const AUDIO_EXTENSIONS = new Set([
  'mp3',
  'wav',
  'flac',
  'ogg',
  'm4a',
  'aac',
  'opus',
]);

export const VIDEO_EXTENSIONS = new Set(['mp4', 'mkv', 'webm', 'mov', 'avi']);
export const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'bz2']);

export interface DropItem {
  id: string;
  type: DropItemType;
  title: string;
  payload: string;
  sizeBytes?: number;
  extension?: string;
  isDir?: boolean;
  timestamp: number;
}

interface RustFileMetadata {
  exists: boolean;
  size_bytes: number;
  is_dir: boolean;
}

export function normalizeWindowsPathKey(rawPath: string): string {
  const trimmed = rawPath.trim().replace(/^["']|["']$/g, '');
  if (!trimmed) return '';
  const isUnc = trimmed.startsWith('\\\\') || trimmed.startsWith('//');
  const unified = trimmed.replace(/\//g, '\\').replace(/\\{2,}/g, '\\');
  const normalized = isUnc ? `\\${unified}` : unified;
  return normalized.replace(/\\+$/, '').toLowerCase();
}

export function cleanFilePath(rawPath: string): string {
  return rawPath.trim().replace(/^["']|["']$/g, '');
}

export function isAudioItem(item: DropItem): boolean {
  if ((item.type !== 'file' && item.type !== 'image') || item.isDir) {
    return false;
  }
  const ext = (item.extension || '').toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) return true;
  const match = item.payload.toLowerCase().match(/\.([a-z0-9]+)$/);
  return Boolean(match && AUDIO_EXTENSIONS.has(match[1]));
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb < 10 ? kb.toFixed(1) : Math.round(kb)} KB`;
  const mb = kb / 1024;
  if (mb < 1024) return `${mb.toFixed(1)} MB`;
  const gb = mb / 1024;
  return `${gb.toFixed(2)} GB`;
}

export function parseDropContent(
  raw: string,
  explicitSize?: number
): Omit<DropItem, 'id' | 'timestamp'> {
  const trimmedRaw = raw.trim();
  const pathCandidate = cleanFilePath(trimmedRaw);

  // URL check (preserve exact query/fragment, only trim whitespace)
  if (/^https?:\/\/[^\s]+$/i.test(trimmedRaw)) {
    let title = trimmedRaw;
    try {
      const parsed = new URL(trimmedRaw);
      const host = parsed.hostname.replace(/^www\./i, '');
      const pathAndQuery =
        parsed.pathname !== '/' || parsed.search
          ? `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}`
          : '';
      title = `${host}${pathAndQuery}`;
      if (title.length > 48) {
        title = `${title.slice(0, 46)}…`;
      }
    } catch {
      title = trimmedRaw.slice(0, 48);
    }
    return {
      type: 'url',
      title,
      payload: trimmedRaw,
    };
  }

  // Local path check (Windows drive path, UNC path, or Unix path — uses quote-stripped pathCandidate)
  const looksLikeWindowsPath =
    /^[a-zA-Z]:[\\/]/.test(pathCandidate) || /^\\\\[^\\]+\\/.test(pathCandidate);
  const looksLikeUnixPath = /^\/(?!\/)[^\n\r]+$/.test(pathCandidate);

  if (looksLikeWindowsPath || looksLikeUnixPath) {
    const fileName = pathCandidate.replace(/^.*[\\/]/, '') || pathCandidate;
    const extMatch = fileName.match(/\.([a-zA-Z0-9]{1,10})$/);
    const extension = extMatch ? extMatch[1].toLowerCase() : undefined;
    const isImage = extension ? IMAGE_EXTENSIONS.has(extension) : false;

    return {
      type: isImage ? 'image' : 'file',
      title: fileName,
      payload: pathCandidate,
      extension,
      sizeBytes: explicitSize && explicitSize > 0 ? explicitSize : undefined,
    };
  }

  // Text snippet fallback (keep quotes & line breaks intact)
  const firstLine = trimmedRaw.split(/\r?\n/)[0]?.trim() || trimmedRaw;
  const title = firstLine.length > 48 ? `${firstLine.slice(0, 46)}…` : firstLine || 'Text Note';
  return {
    type: 'text',
    title,
    payload: trimmedRaw,
    sizeBytes: new Blob([trimmedRaw]).size,
  };
}

const STORAGE_KEY = 'casa_drop_zone_shelf_items_v1';
const MAX_STORED_ITEMS = 50;

function loadPersistedItems(): DropItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[DropZoneStore] Failed to load persisted items:', err);
    return [];
  }
}

function savePersistedItems(items: DropItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, MAX_STORED_ITEMS)));
  } catch (err) {
    console.warn('[DropZoneStore] Failed to save persisted items:', err);
  }
}

async function resolveItemWithMetadata(
  raw: string,
  explicitSize?: number
): Promise<DropItem> {
  const parsed = parseDropContent(raw, explicitSize);
  let resolvedType = parsed.type;
  let resolvedSize = parsed.sizeBytes;
  let isDir = false;

  if ((parsed.type === 'file' || parsed.type === 'image') && '__TAURI_INTERNALS__' in window) {
    try {
      const meta = await invoke<RustFileMetadata>('get_file_metadata', {
        path: parsed.payload,
      });
      if (meta.exists) {
        isDir = Boolean(meta.is_dir);
        if (isDir) {
          resolvedType = 'file';
          resolvedSize = undefined;
        } else if (meta.size_bytes > 0) {
          resolvedSize = meta.size_bytes;
        }
      }
    } catch {
      // Fallback safely to pre-parsed values
    }
  }

  return {
    ...parsed,
    type: resolvedType,
    sizeBytes: resolvedSize,
    isDir,
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
  };
}

function normalizeUrlKey(rawUrl: string): string {
  const trimmed = rawUrl.trim();
  try {
    const u = new URL(trimmed);
    const pathname = u.pathname === '/' ? '' : u.pathname;
    return `url:${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${pathname}${u.search}${u.hash}`;
  } catch {
    return `url:${trimmed}`;
  }
}

function itemMatchKey(item: Pick<DropItem, 'type' | 'payload'>): string {
  if (item.type === 'file' || item.type === 'image') {
    return `path:${normalizeWindowsPathKey(item.payload)}`;
  }
  if (item.type === 'url') {
    return normalizeUrlKey(item.payload);
  }
  return `text:${item.payload.trim()}`;
}

export interface DropActionFeedback {
  id: string;
  isDuplicate: boolean;
  label: string;
  timestamp: number;
}

interface DropZoneStore {
  items: DropItem[];
  isDragging: boolean;
  isInternalDragging: boolean;
  lastActionFeedback: DropActionFeedback | null;
  setIsDragging: (isDragging: boolean) => void;
  setIsInternalDragging: (isInternal: boolean) => void;
  clearActionFeedback: () => void;
  addItem: (raw: string, explicitSize?: number) => Promise<DropItem>;
  addPath: (path: string) => Promise<DropItem>;
  addDroppedPath: (path: string) => Promise<DropItem>;
  addDroppedPaths: (paths: string[]) => Promise<DropItem[]>;
  syncAssetScopes: () => Promise<void>;
  removeItem: (id: string) => void;
  clearAll: () => void;
}

export const useDropZoneStore = create<DropZoneStore>((set, get) => ({
  items: loadPersistedItems(),
  isDragging: false,
  isInternalDragging: false,
  lastActionFeedback: null,

  setIsDragging: (isDragging: boolean) => set({ isDragging }),
  setIsInternalDragging: (isInternalDragging: boolean) => set({ isInternalDragging }),
  clearActionFeedback: () => set({ lastActionFeedback: null }),

  addItem: async (raw: string, explicitSize?: number) => {
    const clean = raw.trim();
    if (!clean) {
      throw new Error('Empty drop item');
    }

    const prepared = await resolveItemWithMetadata(clean, explicitSize);
    const key = itemMatchKey(prepared);
    let finalItem = prepared;

    set((state) => {
      const existingIdx = state.items.findIndex((it) => itemMatchKey(it) === key);
      if (existingIdx !== -1) {
        const existing = state.items[existingIdx];
        finalItem = {
          ...existing,
          ...prepared,
          id: existing.id,
          timestamp: Date.now(),
        };
        const rest = state.items.filter((_, idx) => idx !== existingIdx);
        const nextItems = [finalItem, ...rest].slice(0, MAX_STORED_ITEMS);
        savePersistedItems(nextItems);
        return {
          items: nextItems,
          isDragging: false,
          lastActionFeedback: {
            id: finalItem.id,
            isDuplicate: true,
            label: 'Sudah ada · digeser ke depan',
            timestamp: Date.now(),
          },
        };
      }

      const nextItems = [prepared, ...state.items].slice(0, MAX_STORED_ITEMS);
      savePersistedItems(nextItems);
      return {
        items: nextItems,
        isDragging: false,
        lastActionFeedback: {
          id: prepared.id,
          isDuplicate: false,
          label:
            prepared.type === 'url'
              ? 'Tautan disimpan'
              : prepared.type === 'text'
              ? 'Snippet disimpan'
              : 'Berkas ditambahkan',
          timestamp: Date.now(),
        },
      };
    });

    return finalItem;
  },

  addPath: async (path: string) => {
    return get().addItem(path);
  },

  addDroppedPath: async (path: string) => {
    return get().addItem(path);
  },

  addDroppedPaths: async (paths: string[]) => {
    const seenBatchKeys = new Set<string>();
    const uniqueRawPaths: string[] = [];

    for (const raw of paths) {
      const cleaned = cleanFilePath(raw);
      if (!cleaned) continue;
      const key = normalizeWindowsPathKey(cleaned) || cleaned;
      if (seenBatchKeys.has(key)) continue;
      seenBatchKeys.add(key);
      uniqueRawPaths.push(cleaned);
    }

    if (uniqueRawPaths.length === 0) {
      set({ isDragging: false });
      return [];
    }

    const preparedList = await Promise.all(
      uniqueRawPaths.map((p) => resolveItemWithMetadata(p))
    );

    const preparedKeys = new Set(preparedList.map((it) => itemMatchKey(it)));
    let resultingBatch: DropItem[] = [];

    set((state) => {
      const existingMap = new Map<string, DropItem>();
      for (const existing of state.items) {
        existingMap.set(itemMatchKey(existing), existing);
      }

      const now = Date.now();
      resultingBatch = preparedList.map((prep, idx) => {
        const key = itemMatchKey(prep);
        const prev = existingMap.get(key);
        return prev
          ? { ...prev, ...prep, id: prev.id, timestamp: now - idx }
          : { ...prep, timestamp: now - idx };
      });

      const duplicateCount = preparedList.filter((prep) =>
        existingMap.has(itemMatchKey(prep))
      ).length;
      const remaining = state.items.filter((it) => !preparedKeys.has(itemMatchKey(it)));
      const nextItems = [...resultingBatch, ...remaining].slice(0, MAX_STORED_ITEMS);
      savePersistedItems(nextItems);
      return {
        items: nextItems,
        isDragging: false,
        lastActionFeedback:
          resultingBatch.length > 0
            ? {
                id: resultingBatch[0].id,
                isDuplicate: duplicateCount === resultingBatch.length,
                label:
                  duplicateCount === resultingBatch.length
                    ? 'Sudah ada · digeser ke depan'
                    : resultingBatch.length === 1
                    ? 'Berkas disimpan'
                    : `${resultingBatch.length} berkas disimpan`,
                timestamp: now,
              }
            : state.lastActionFeedback,
      };
    });

    return resultingBatch;
  },

  syncAssetScopes: async () => {
    if (!('__TAURI_INTERNALS__' in window)) return;
    const paths = get()
      .items.filter((it) => (it.type === 'file' || it.type === 'image') && !it.isDir)
      .map((it) => it.payload);

    if (paths.length === 0) return;

    try {
      await invoke<string[]>('register_drop_zone_files', { paths });
    } catch {
      // Ignore if offline/missing paths
    }
  },

  removeItem: (id: string) => {
    set((state) => {
      const nextItems = state.items.filter((it) => it.id !== id);
      savePersistedItems(nextItems);
      return { items: nextItems };
    });
  },

  clearAll: () => {
    savePersistedItems([]);
    set({ items: [] });
  },
}));

if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
  setTimeout(() => {
    void useDropZoneStore.getState().syncAssetScopes();
  }, 120);
}
