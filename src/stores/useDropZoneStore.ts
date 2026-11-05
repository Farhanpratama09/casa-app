import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

export type DropItemType = 'file' | 'image' | 'text' | 'url';

export interface DropItem {
  id: string;
  type: DropItemType;
  title: string;
  payload: string; // path berkas, teks polos, atau URL
  sizeFormatted?: string; // misal: "2.4 MB" atau "120 chars"
  extension?: string;     // misal: "pdf", "png", "zip"
  timestamp: number;
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const size = bytes / Math.pow(1024, i);
  return `${size.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

const IMAGE_EXTENSIONS = new Set([
  'png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'
]);

export function parseDropContent(raw: string, explicitSize?: number): Omit<DropItem, 'id' | 'timestamp'> {
  const trimmed = raw.trim();

  // 1. URL Detection (starts with http:// or https://)
  if (/^https?:\/\/[^\s]+$/i.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      const host = url.hostname.replace(/^www\./, '');
      const pathSnippet = url.pathname !== '/' ? url.pathname : '';
      return {
        type: 'url',
        title: host + (pathSnippet ? pathSnippet.slice(0, 24) : ''),
        payload: trimmed,
        sizeFormatted: 'Web Link',
      };
    } catch {
      return {
        type: 'url',
        title: trimmed.slice(0, 36),
        payload: trimmed,
        sizeFormatted: 'Web Link',
      };
    }
  }

  // 2. File / Image Detection (Windows file paths or standalone filenames with extension)
  const isWindowsPath = /^[a-zA-Z]:[\\/]|^\\\\/.test(trimmed) || (!trimmed.includes('\n') && /\.[a-zA-Z0-9]{1,8}$/.test(trimmed));
  if (isWindowsPath) {
    const filename = trimmed.replace(/^.*[\\/]/, '') || trimmed;
    const extMatch = filename.match(/\.([a-zA-Z0-9]+)$/);
    const ext = extMatch ? extMatch[1].toLowerCase() : undefined;

    if (ext && IMAGE_EXTENSIONS.has(ext)) {
      return {
        type: 'image',
        title: filename,
        payload: trimmed,
        extension: ext,
        sizeFormatted: explicitSize !== undefined ? formatBytes(explicitSize) : ext.toUpperCase(),
      };
    }

    return {
      type: 'file',
      title: filename,
      payload: trimmed,
      extension: ext,
      sizeFormatted: explicitSize !== undefined ? formatBytes(explicitSize) : (ext ? ext.toUpperCase() : 'FILE'),
    };
  }

  // 3. Text / Code Snippet fallback
  const lines = trimmed.split('\n');
  const firstLine = lines[0].trim();
  const title = firstLine.slice(0, 38) + (firstLine.length > 38 || lines.length > 1 ? '...' : '');
  const charCount = trimmed.length;

  return {
    type: 'text',
    title: title || 'Teks Salinan',
    payload: trimmed,
    sizeFormatted: `${charCount} karakter`,
  };
}

const STORAGE_KEY = 'casa_drop_zone_shelf_items_v1';

function loadPersistedItems(): DropItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed;
    }
  } catch (err) {
    console.warn('[DropZoneStore] Failed to load persisted items:', err);
  }
  return [];
}

function savePersistedItems(items: DropItem[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 50)));
  } catch (err) {
    console.warn('[DropZoneStore] Failed to save persisted items:', err);
  }
}

interface DropZoneStore {
  items: DropItem[];
  isDragging: boolean;
  isInternalDragging: boolean;
  setIsDragging: (isDragging: boolean) => void;
  setIsInternalDragging: (isInternal: boolean) => void;
  addItem: (raw: string, explicitSize?: number) => Promise<DropItem>;
  addPath: (path: string) => Promise<DropItem>;
  addDroppedPath: (path: string) => Promise<DropItem>;
  removeItem: (id: string) => void;
  clearAll: () => void;
}

export const useDropZoneStore = create<DropZoneStore>((set, get) => ({
  items: loadPersistedItems(),
  isDragging: false,
  isInternalDragging: false,

  setIsDragging: (isDragging: boolean) => set({ isDragging }),
  setIsInternalDragging: (isInternalDragging: boolean) => set({ isInternalDragging }),

  addItem: async (raw: string, explicitSize?: number) => {
    const parsed = parseDropContent(raw, explicitSize);

    // If it's a file or image and explicit size is not given, attempt to fetch real size from Rust
    if ((parsed.type === 'file' || parsed.type === 'image') && explicitSize === undefined) {
      try {
        const meta = await invoke<{ exists: boolean; size_bytes: number; is_dir: boolean }>(
          'get_file_metadata',
          { path: parsed.payload }
        );
        if (meta && meta.exists && meta.size_bytes > 0) {
          parsed.sizeFormatted = formatBytes(meta.size_bytes);
        }
      } catch {
        // Fallback already assigned
      }
    }

    let resultItem: DropItem;

    set((state) => {
      // Hanya deduplikasi berkas/gambar fisik berdasarkan path Windows (case-insensitive)
      // Untuk cuplikan teks & link web, izinkan penambahan multi-entri dinamis tanpa saling menimpa
      const isPath = parsed.type === 'file' || parsed.type === 'image';
      const existingIdx = isPath
        ? state.items.findIndex(
            (it) => it.payload.toLowerCase() === parsed.payload.toLowerCase()
          )
        : -1;

      if (existingIdx >= 0) {
        // Existing file re-dropped: update timestamp, refresh metadata, and bring to front
        const existing = state.items[existingIdx];
        resultItem = {
          ...existing,
          ...parsed,
          timestamp: Date.now(),
        };
        const rest = state.items.filter((_, idx) => idx !== existingIdx);
        const nextItems = [resultItem, ...rest];
        savePersistedItems(nextItems);
        return { items: nextItems, isDragging: false };
      }

      // New item (setiap paste teks baru menghasilkan entri unik tersendiri)
      resultItem = {
        ...parsed,
        id: `drop_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        timestamp: Date.now(),
      };
      const nextItems = [resultItem, ...state.items];
      savePersistedItems(nextItems);
      return { items: nextItems, isDragging: false };
    });

    return resultItem!;
  },

  addPath: async (path: string) => {
    return get().addItem(path);
  },

  addDroppedPath: async (path: string) => {
    return get().addItem(path);
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
