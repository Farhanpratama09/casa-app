import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { cleanupEphemeralDropZone, stageDroppedFile } from '../utils/tauriBridge';

export type DropItemType = 'file' | 'image' | 'text' | 'link';

export const MAX_DROP_TEXT_LENGTH = 50_000;
export const MAX_STAGED_FILE_BYTES = 25 * 1024 * 1024;
const FRESH_SEED_WINDOW_MS = 15_000;
const DRAG_OUT_UNDO_MS = 4_000;

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
  domain?: string;
  displayUrl?: string;
  charCount?: number;
  lineCount?: number;
  isStagedTemp?: boolean;
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

const BLOCKED_URI_SCHEME_RE =
  /^(?:javascript|data|vbscript|blob|file|ms-msdt|search-ms|ms-officecmd|cmd|powershell)\s*:/i;

const CONTROL_AND_BIDI_RE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u200E\u200F\u202A-\u202E\u2066-\u2069]/g;

export function sanitizeDropText(raw: string): string {
  if (!raw) return '';
  let text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/?[a-zA-Z][a-zA-Z0-9:-]*(?:\s+[^<>]*)?\/?>/g, ' ');

  text = text
    .replace(CONTROL_AND_BIDI_RE, '')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .trim();

  if (text.length > MAX_DROP_TEXT_LENGTH) {
    text = text.slice(0, MAX_DROP_TEXT_LENGTH);
  }
  return text;
}

export function isBlockedUriScheme(raw: string): boolean {
  if (!raw) return false;
  const cleaned = raw.replace(CONTROL_AND_BIDI_RE, '').trim().replace(/^<|>$/g, '');
  return BLOCKED_URI_SCHEME_RE.test(cleaned);
}

export function extractUriListCandidate(uriList: string): string | null {
  if (!uriList) return null;
  const lines = uriList.split(/\r?\n/);
  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    return trimmed;
  }
  return null;
}

export function extractAnchorFromHtml(html: string): { href: string; label?: string } | null {
  if (!html) return null;
  const match = html.match(
    /<a\b[^>]*\bhref\s*=\s*(?:"([^"]+)"|'([^']+)')[^>]*>([\s\S]*?)<\/a>/i
  );
  if (!match) return null;
  const href = (match[1] || match[2] || '').trim();
  if (!href) return null;
  const label = sanitizeDropText(match[3] || '');
  return label ? { href, label } : { href };
}

export function parseSafeHttpUrl(
  raw: string,
  titleHint?: string
): { href: string; domain: string; displayUrl: string; title: string } | null {
  if (!raw) return null;
  let candidate = raw.replace(CONTROL_AND_BIDI_RE, '').trim();
  if (candidate.startsWith('<') && candidate.endsWith('>') && candidate.length > 2) {
    candidate = candidate.slice(1, -1).trim();
  }
  if (!candidate || /[\s\r\n]/.test(candidate)) {
    return null;
  }
  if (isBlockedUriScheme(candidate)) {
    return null;
  }

  let normalizedCandidate = candidate;
  const hasExplicitHttpScheme = /^https?:\/\//i.test(candidate);
  if (!hasExplicitHttpScheme) {
    if (/^www\.[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+(?:[/?#][^\s]*)?$/i.test(candidate)) {
      normalizedCandidate = `https://${candidate}`;
    } else {
      return null;
    }
  }

  let parsed: URL;
  try {
    parsed = new URL(normalizedCandidate);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return null;
  }

  const hostLower = parsed.hostname.toLowerCase();
  if (!hostLower || (!hostLower.includes('.') && hostLower !== 'localhost')) {
    return null;
  }

  const domain = hostLower.replace(/^www\./i, '');
  const trimmedPath =
    parsed.pathname !== '/' || parsed.search || parsed.hash
      ? `${parsed.pathname === '/' ? '' : parsed.pathname}${parsed.search}${parsed.hash}`
      : '';

  const rawDisplay = `${domain}${trimmedPath}`;
  const displayUrl = rawDisplay.length > 56 ? `${rawDisplay.slice(0, 55)}…` : rawDisplay;

  let cleanHint = titleHint ? sanitizeDropText(titleHint) : '';
  if (cleanHint && (cleanHint === candidate || cleanHint === parsed.href)) {
    cleanHint = '';
  }

  let derivedTitle = cleanHint;
  if (!derivedTitle) {
    const segments = parsed.pathname.split('/').filter(Boolean);
    const lastSeg = segments[segments.length - 1];
    if (lastSeg) {
      try {
        derivedTitle = sanitizeDropText(decodeURIComponent(lastSeg));
      } catch {
        derivedTitle = sanitizeDropText(lastSeg);
      }
    }
    if (!derivedTitle) {
      derivedTitle = domain;
    }
  }

  const href = hasExplicitHttpScheme ? candidate : parsed.href;
  return {
    href,
    domain,
    displayUrl,
    title: derivedTitle,
  };
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

export interface ParseDropOptions {
  allowLocalPath?: boolean;
  titleHint?: string;
  isStagedTemp?: boolean;
}

export function parseDropContent(
  raw: string,
  explicitSize?: number,
  options?: ParseDropOptions
): Omit<DropItem, 'id' | 'timestamp'> | null {
  if (!raw || isBlockedUriScheme(raw)) {
    return null;
  }

  const safeLink = parseSafeHttpUrl(raw, options?.titleHint);
  if (safeLink) {
    return {
      type: 'link',
      title: safeLink.title,
      payload: safeLink.href,
      domain: safeLink.domain,
      displayUrl: safeLink.displayUrl,
      extension: 'LINK',
    };
  }

  if (options?.allowLocalPath) {
    const pathCandidate = cleanFilePath(raw.trim());
    const looksLikeWindowsPath =
      /^[a-zA-Z]:[\\/]/.test(pathCandidate) || /^\\\\[^\\]+\\/.test(pathCandidate);
    const looksLikeUnixPath = /^\/(?!\/)[^\n\r]+$/.test(pathCandidate);

    if (looksLikeWindowsPath || looksLikeUnixPath || pathCandidate.length > 0) {
      const fileName = pathCandidate.replace(/^.*[\\/]/, '') || pathCandidate;
      const extMatch = fileName.match(/\.([a-zA-Z0-9]{1,10})$/);
      const extension = extMatch ? extMatch[1].toLowerCase() : undefined;
      const isImage = extension ? IMAGE_EXTENSIONS.has(extension) : false;

      return {
        type: isImage ? 'image' : 'file',
        title: fileName,
        payload: pathCandidate,
        extension,
        isStagedTemp: options.isStagedTemp,
        sizeBytes: explicitSize && explicitSize > 0 ? explicitSize : undefined,
      };
    }
  }

  const sanitized = sanitizeDropText(raw);
  if (!sanitized) {
    return null;
  }

  const lines = sanitized.split('\n');
  const firstNonEmpty = lines.find((line) => line.trim().length > 0)?.trim() || sanitized;
  const title = firstNonEmpty.length > 64 ? `${firstNonEmpty.slice(0, 62)}…` : firstNonEmpty;

  return {
    type: 'text',
    title: title || 'Text Note',
    payload: sanitized,
    extension: 'TXT',
    charCount: sanitized.length,
    lineCount: lines.length,
    sizeBytes: new Blob([sanitized]).size,
  };
}

const STORAGE_KEY = 'casa_drop_zone_shelf_items_v1';
const MAX_STORED_ITEMS = 50;

function normalizeHydratedItem(rawItem: unknown): DropItem | null {
  if (!rawItem || typeof rawItem !== 'object') return null;
  const rec = rawItem as Record<string, unknown>;
  if (typeof rec.payload !== 'string' || typeof rec.id !== 'string') return null;
  const timestamp = typeof rec.timestamp === 'number' ? rec.timestamp : 0;
  if (!Number.isFinite(timestamp) || Math.abs(Date.now() - timestamp) > FRESH_SEED_WINDOW_MS) {
    return null;
  }

  const rawType = rec.type === 'url' ? 'link' : rec.type;
  if (rawType !== 'file' && rawType !== 'image' && rawType !== 'text' && rawType !== 'link') {
    return null;
  }

  if (rawType === 'link') {
    const parsed = parseSafeHttpUrl(rec.payload);
    if (!parsed) return null;
    return {
      id: rec.id,
      type: 'link',
      title: typeof rec.title === 'string' && rec.title.trim() ? rec.title : parsed.title,
      payload: parsed.href,
      domain: typeof rec.domain === 'string' ? rec.domain : parsed.domain,
      displayUrl: typeof rec.displayUrl === 'string' ? rec.displayUrl : parsed.displayUrl,
      extension: 'LINK',
      timestamp,
    };
  }

  return {
    id: rec.id,
    type: rawType,
    title: typeof rec.title === 'string' ? rec.title : rec.payload,
    payload: rec.payload,
    sizeBytes: typeof rec.sizeBytes === 'number' ? rec.sizeBytes : undefined,
    extension: typeof rec.extension === 'string' ? rec.extension : undefined,
    isDir: Boolean(rec.isDir),
    charCount: typeof rec.charCount === 'number' ? rec.charCount : undefined,
    lineCount: typeof rec.lineCount === 'number' ? rec.lineCount : undefined,
    timestamp,
  };
}

function clearPersistedStorage(): void {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      window.localStorage.setItem(STORAGE_KEY, '[]');
    }
  } catch {
    // ignore storage errors
  }
}

function loadInitialItems(): DropItem[] {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return [];
    }
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      clearPersistedStorage();
      return [];
    }
    const fresh = parsed
      .map((item) => normalizeHydratedItem(item))
      .filter((item): item is DropItem => item !== null)
      .slice(0, MAX_STORED_ITEMS);

    if (fresh.length === 0) {
      clearPersistedStorage();
    }
    return fresh;
  } catch (err) {
    console.warn('[DropZoneStore] Failed to load ephemeral items:', err);
    clearPersistedStorage();
    return [];
  }
}

async function resolveItemWithMetadata(
  raw: string,
  explicitSize?: number,
  options?: ParseDropOptions
): Promise<DropItem | null> {
  const parsed = parseDropContent(raw, explicitSize, options);
  if (!parsed) return null;

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
    return `link:${u.protocol.toLowerCase()}//${u.host.toLowerCase()}${pathname}${u.search}${u.hash}`;
  } catch {
    return `link:${trimmed}`;
  }
}

function itemMatchKey(item: Pick<DropItem, 'type' | 'payload'>): string {
  if (item.type === 'file' || item.type === 'image') {
    return `path:${normalizeWindowsPathKey(item.payload)}`;
  }
  if (item.type === 'link') {
    return normalizeUrlKey(item.payload);
  }
  return `text:${item.payload.trim()}`;
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const CHUNK_SIZE = 0x4000;
  const chunks: string[] = [];
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)));
  }
  return btoa(chunks.join(''));
}

export interface DropActionFeedback {
  id: string;
  isDuplicate: boolean;
  label: string;
  timestamp: number;
}

export interface DataTransferDropResult {
  added: number;
  blocked: boolean;
}

interface DropZoneStore {
  items: DropItem[];
  isDragging: boolean;
  isInternalDragging: boolean;
  lastActionFeedback: DropActionFeedback | null;
  lastDraggedOutItem: DropItem | null;
  securityNotice: string | null;
  setIsDragging: (isDragging: boolean) => void;
  setIsInternalDragging: (isInternal: boolean) => void;
  clearActionFeedback: () => void;
  setSecurityNotice: (msg: string | null) => void;
  recordDraggedOutItem: (item: DropItem) => void;
  undoLastDraggedOut: () => DropItem | null;
  dismissDraggedOutUndo: () => void;
  addItem: (raw: string, explicitSize?: number, titleHint?: string) => Promise<DropItem | null>;
  addPath: (path: string) => Promise<DropItem | null>;
  addDroppedPath: (path: string) => Promise<DropItem | null>;
  addDroppedPaths: (
    paths: string[],
    options?: { stagedPaths?: Set<string> }
  ) => Promise<DropItem[]>;
  addDroppedDataTransfer: (dt: DataTransfer | null) => Promise<DataTransferDropResult>;
  syncAssetScopes: () => Promise<void>;
  removeItem: (id: string) => void;
  clearAll: () => void;
  clearEphemeralSession: () => void;
}

let securityNoticeTimer: ReturnType<typeof setTimeout> | null = null;
let dragOutUndoTimer: ReturnType<typeof setTimeout> | null = null;

export const useDropZoneStore = create<DropZoneStore>((set, get) => ({
  items: loadInitialItems(),
  isDragging: false,
  isInternalDragging: false,
  lastActionFeedback: null,
  lastDraggedOutItem: null,
  securityNotice: null,

  setIsDragging: (isDragging: boolean) => set({ isDragging }),
  setIsInternalDragging: (isInternalDragging: boolean) => set({ isInternalDragging }),
  clearActionFeedback: () => set({ lastActionFeedback: null }),

  setSecurityNotice: (msg: string | null) => {
    if (securityNoticeTimer) {
      clearTimeout(securityNoticeTimer);
      securityNoticeTimer = null;
    }
    set(msg ? { securityNotice: msg, lastActionFeedback: null } : { securityNotice: null });
    if (msg) {
      securityNoticeTimer = setTimeout(() => {
        securityNoticeTimer = null;
        set({ securityNotice: null });
      }, 4200);
    }
  },

  recordDraggedOutItem: (item: DropItem) => {
    if (dragOutUndoTimer) {
      clearTimeout(dragOutUndoTimer);
      dragOutUndoTimer = null;
    }
    set({ lastDraggedOutItem: item });
    dragOutUndoTimer = setTimeout(() => {
      dragOutUndoTimer = null;
      set({ lastDraggedOutItem: null });
    }, DRAG_OUT_UNDO_MS);
  },

  undoLastDraggedOut: () => {
    if (dragOutUndoTimer) {
      clearTimeout(dragOutUndoTimer);
      dragOutUndoTimer = null;
    }
    const candidate = get().lastDraggedOutItem;
    if (!candidate) {
      return null;
    }
    const restored: DropItem = {
      ...candidate,
      timestamp: Date.now(),
    };
    const key = itemMatchKey(restored);
    clearPersistedStorage();
    set((state) => {
      const remaining = state.items.filter((it) => itemMatchKey(it) !== key);
      const nextItems = [restored, ...remaining].slice(0, MAX_STORED_ITEMS);
      return {
        items: nextItems,
        lastDraggedOutItem: null,
        securityNotice: null,
        lastActionFeedback: {
          id: restored.id,
          isDuplicate: false,
          label: 'Kartu dipulihkan',
          timestamp: Date.now(),
        },
      };
    });
    return restored;
  },

  dismissDraggedOutUndo: () => {
    if (dragOutUndoTimer) {
      clearTimeout(dragOutUndoTimer);
      dragOutUndoTimer = null;
    }
    set({ lastDraggedOutItem: null });
  },

  addItem: async (raw: string, explicitSize?: number, titleHint?: string) => {
    const clean = raw.trim();
    if (!clean) {
      return null;
    }

    if (isBlockedUriScheme(clean)) {
      get().setSecurityNotice('Skema URI tidak aman diblokir (hanya http:// & https://)');
      set({ isDragging: false });
      return null;
    }

    const prepared = await resolveItemWithMetadata(clean, explicitSize, {
      allowLocalPath: false,
      titleHint,
    });
    if (!prepared) {
      set({ isDragging: false });
      return null;
    }

    const key = itemMatchKey(prepared);
    let finalItem = prepared;
    clearPersistedStorage();

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
        return {
          items: nextItems,
          isDragging: false,
          securityNotice: null,
          lastActionFeedback: {
            id: finalItem.id,
            isDuplicate: true,
            label: 'Sudah ada · digeser ke depan',
            timestamp: Date.now(),
          },
        };
      }

      const nextItems = [prepared, ...state.items].slice(0, MAX_STORED_ITEMS);
      return {
        items: nextItems,
        isDragging: false,
        securityNotice: null,
        lastActionFeedback: {
          id: prepared.id,
          isDuplicate: false,
          label:
            prepared.type === 'link'
              ? 'Tautan diparkir'
              : prepared.type === 'text'
              ? 'Catatan diparkir'
              : 'Berkas ditambahkan',
          timestamp: Date.now(),
        },
      };
    });

    return finalItem;
  },

  addPath: async (path: string) => {
    const batch = await get().addDroppedPaths([path]);
    return batch[0] ?? null;
  },

  addDroppedPath: async (path: string) => {
    const batch = await get().addDroppedPaths([path]);
    return batch[0] ?? null;
  },

  addDroppedPaths: async (paths: string[], options?: { stagedPaths?: Set<string> }) => {
    const seenBatchKeys = new Set<string>();
    const uniqueRawPaths: string[] = [];

    for (const raw of paths) {
      const cleaned = cleanFilePath(raw);
      if (!cleaned || isBlockedUriScheme(cleaned)) continue;
      const key = normalizeWindowsPathKey(cleaned) || cleaned;
      if (seenBatchKeys.has(key)) continue;
      seenBatchKeys.add(key);
      uniqueRawPaths.push(cleaned);
    }

    if (uniqueRawPaths.length === 0) {
      set({ isDragging: false });
      return [];
    }

    const preparedRaw = await Promise.all(
      uniqueRawPaths.map((p) =>
        resolveItemWithMetadata(p, undefined, {
          allowLocalPath: true,
          isStagedTemp: Boolean(options?.stagedPaths?.has(p)),
        })
      )
    );
    const preparedList = preparedRaw.filter((it): it is DropItem => it !== null);
    if (preparedList.length === 0) {
      set({ isDragging: false });
      return [];
    }

    const preparedKeys = new Set(preparedList.map((it) => itemMatchKey(it)));
    let resultingBatch: DropItem[] = [];
    clearPersistedStorage();

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
      return {
        items: nextItems,
        isDragging: false,
        securityNotice: null,
        lastActionFeedback:
          resultingBatch.length > 0
            ? {
                id: resultingBatch[0].id,
                isDuplicate: duplicateCount === resultingBatch.length,
                label:
                  duplicateCount === resultingBatch.length
                    ? 'Sudah ada · digeser ke depan'
                    : resultingBatch.length === 1
                    ? 'Berkas diparkir'
                    : `${resultingBatch.length} berkas diparkir`,
                timestamp: now,
              }
            : state.lastActionFeedback,
      };
    });

    return resultingBatch;
  },

  addDroppedDataTransfer: async (dt: DataTransfer | null): Promise<DataTransferDropResult> => {
    if (!dt) {
      set({ isDragging: false });
      return { added: 0, blocked: false };
    }

    // Priority 1: Dropped Files
    if (dt.files && dt.files.length > 0) {
      const collectedPaths: string[] = [];
      const stagedPaths = new Set<string>();

      for (let i = 0; i < dt.files.length; i++) {
        const file = dt.files[i];
        const diskPath = (file as File & { path?: string }).path;
        if (diskPath && diskPath.trim()) {
          collectedPaths.push(diskPath);
          continue;
        }

        if ('__TAURI_INTERNALS__' in window) {
          if (file.size > MAX_STAGED_FILE_BYTES) {
            get().setSecurityNotice(
              `Berkas "${file.name}" melebihi batas transit 25 MB; gunakan + Add.`
            );
            continue;
          }
          if (file.size > 0) {
            try {
              const buffer = await file.arrayBuffer();
              const b64 = arrayBufferToBase64(buffer);
              const staged = await stageDroppedFile(file.name, b64);
              if (staged) {
                collectedPaths.push(staged);
                stagedPaths.add(staged);
              }
            } catch (err) {
              console.warn('[DropZoneStore] Stage dropped file failed:', err);
            }
          }
        } else if (file.name) {
          collectedPaths.push(file.name);
        }
      }

      if (collectedPaths.length > 0) {
        const addedItems = await get().addDroppedPaths(collectedPaths, { stagedPaths });
        return { added: addedItems.length, blocked: false };
      }
      set({ isDragging: false });
      return { added: 0, blocked: false };
    }

    const htmlData = dt.getData('text/html') || '';
    const htmlAnchor = extractAnchorFromHtml(htmlData);

    // Priority 2: URI List (dragged links from browser address bar / bookmarks / web)
    const uriListRaw = dt.getData('text/uri-list');
    const uriCandidate = extractUriListCandidate(uriListRaw);
    if (uriCandidate) {
      if (isBlockedUriScheme(uriCandidate)) {
        get().setSecurityNotice('Skema URI tidak aman diblokir (hanya http:// & https://)');
        set({ isDragging: false });
        return { added: 0, blocked: true };
      }
      const titleHint =
        htmlAnchor && htmlAnchor.label ? htmlAnchor.label : undefined;
      const item = await get().addItem(uriCandidate, undefined, titleHint);
      return { added: item ? 1 : 0, blocked: false };
    }

    // Priority 3: Plain Text (selected text snippets or text URLs)
    const plainRaw = dt.getData('text/plain');
    if (plainRaw && plainRaw.trim()) {
      if (isBlockedUriScheme(plainRaw)) {
        get().setSecurityNotice('Skema URI tidak aman diblokir (hanya http:// & https://)');
        set({ isDragging: false });
        return { added: 0, blocked: true };
      }
      const titleHint =
        parseSafeHttpUrl(plainRaw) && htmlAnchor?.label ? htmlAnchor.label : undefined;
      const item = await get().addItem(plainRaw, undefined, titleHint);
      return { added: item ? 1 : 0, blocked: false };
    }

    // Priority 4: HTML fallback (when text/plain & text/uri-list are absent)
    if (htmlData.trim()) {
      if (htmlAnchor) {
        if (isBlockedUriScheme(htmlAnchor.href)) {
          get().setSecurityNotice('Skema URI tidak aman diblokir (hanya http:// & https://)');
          set({ isDragging: false });
          return { added: 0, blocked: true };
        }
        const item = await get().addItem(htmlAnchor.href, undefined, htmlAnchor.label);
        return { added: item ? 1 : 0, blocked: false };
      }

      const sanitized = sanitizeDropText(htmlData);
      if (sanitized) {
        const item = await get().addItem(sanitized);
        return { added: item ? 1 : 0, blocked: false };
      }
    }

    set({ isDragging: false });
    return { added: 0, blocked: false };
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
      if (nextItems.length === 0) {
        clearPersistedStorage();
      }
      return { items: nextItems };
    });
  },

  clearAll: () => {
    if (dragOutUndoTimer) {
      clearTimeout(dragOutUndoTimer);
      dragOutUndoTimer = null;
    }
    clearPersistedStorage();
    set({ items: [], lastDraggedOutItem: null, securityNotice: null });
    void cleanupEphemeralDropZone();
  },

  clearEphemeralSession: () => {
    if (securityNoticeTimer) {
      clearTimeout(securityNoticeTimer);
      securityNoticeTimer = null;
    }
    if (dragOutUndoTimer) {
      clearTimeout(dragOutUndoTimer);
      dragOutUndoTimer = null;
    }
    clearPersistedStorage();
    set({
      items: [],
      isDragging: false,
      isInternalDragging: false,
      lastActionFeedback: null,
      lastDraggedOutItem: null,
      securityNotice: null,
    });
    void cleanupEphemeralDropZone();
  },
}));

if (typeof window !== 'undefined') {
  if ('__TAURI_INTERNALS__' in window) {
    setTimeout(() => {
      void useDropZoneStore.getState().syncAssetScopes();
    }, 120);
  }

  const handleEphemeralUnload = () => {
    useDropZoneStore.getState().clearEphemeralSession();
  };
  window.addEventListener('beforeunload', handleEphemeralUnload);
  window.addEventListener('pagehide', handleEphemeralUnload);
}
