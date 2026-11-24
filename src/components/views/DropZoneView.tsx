import React, { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Plus,
  FolderPlus,
  Smartphone,
  ClipboardPaste,
  Trash2,
  Inbox,
  Copy,
  Check,
  Play,
  X,
  Folder,
  Music,
  Film,
  FileArchive,
  FileText,
  Image as ImageIcon,
  Globe,
  AlignLeft,
  GripVertical,
  ExternalLink,
  ShieldAlert,
  RotateCcw,
  AlertTriangle,
} from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import {
  useDropZoneStore,
  DropItem,
  ARCHIVE_EXTENSIONS,
  VIDEO_EXTENSIONS,
  AUDIO_EXTENSIONS,
  IMAGE_EXTENSIONS,
  formatBytes,
  isAudioItem,
  parseSafeHttpUrl,
} from '../../stores/useDropZoneStore';
import { useConnectHpStore } from '../../stores/useConnectHpStore';
import { useCasaAudio } from '../../context/CasaAudioContext';
import { NativeTrack, parseTrackTitleAndArtist } from '../../services/nativeAudioService';
import {
  playChimeCue,
  nativeDragDropFiles,
  nativeDragDropText,
  pickDropZoneFilesNative,
  pickDropZoneFolderNative,
} from '../../utils/tauriBridge';
import { useSettingsStore } from '../../stores/useSettingsStore';

export interface DropZoneViewProps {
  isLockedExpanded?: boolean;
  onOpenMusic?: () => void;
  podHostEl?: HTMLDivElement | null;
  isConnectHpPodOpen?: boolean;
  onToggleConnectHpPod?: () => void;
  onCloseConnectHpPod?: () => void;
  onInteractionLock?: () => void;
}

const DRAG_THRESHOLD_PX = 8;

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (!text) return false;
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fallback below when Clipboard API rejects in non-focused contexts
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', 'true');
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

const isLinkItem = (item: DropItem): boolean => item.type === 'link';

const renderCategoryIcon = (item: DropItem, isMonochrome = false) => {
  if (item.isDir) {
    return <Folder className={`w-4 h-4 ${isMonochrome ? 'text-white/80' : 'text-sky-400/85'}`} />;
  }
  if (isLinkItem(item)) {
    return <Globe className={`w-4 h-4 ${isMonochrome ? 'text-white/85' : 'text-sky-400'}`} />;
  }
  if (item.type === 'text') {
    return <AlignLeft className={`w-4 h-4 ${isMonochrome ? 'text-white/80' : 'text-sky-400/85'}`} />;
  }

  const ext = (item.extension || '').toLowerCase();
  if (AUDIO_EXTENSIONS.has(ext)) {
    return <Music className={`w-4 h-4 ${isMonochrome ? 'text-white/85' : 'text-sky-400'}`} />;
  }
  if (VIDEO_EXTENSIONS.has(ext)) {
    return <Film className={`w-4 h-4 ${isMonochrome ? 'text-white/80' : 'text-purple-400/90'}`} />;
  }
  if (ARCHIVE_EXTENSIONS.has(ext)) {
    return <FileArchive className={`w-4 h-4 ${isMonochrome ? 'text-white/80' : 'text-amber-400'}`} />;
  }
  if (IMAGE_EXTENSIONS.has(ext) || item.type === 'image') {
    return <ImageIcon className={`w-4 h-4 ${isMonochrome ? 'text-white/85' : 'text-purple-400'}`} />;
  }
  return <FileText className={`w-4 h-4 ${isMonochrome ? 'text-white/80' : 'text-sky-400/85'}`} />;
};

const getItemMetaLabel = (item: DropItem): string => {
  if (item.isDir || item.type === 'folder') {
    if (typeof item.fileCount === 'number' && typeof item.batchTotal === 'number') {
      const sz = item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : '';
      return `${item.fileCount}/${item.batchTotal} file${sz}`;
    }
    if (typeof item.fileCount === 'number') {
      const sz = item.sizeBytes ? ` · ${formatBytes(item.sizeBytes)}` : '';
      return `${item.fileCount} ${item.fileCount === 1 ? 'file' : 'files'}${sz}`;
    }
    return 'Folder';
  }
  if (isLinkItem(item)) {
    return item.domain || 'HTTPS Link';
  }
  if (item.type === 'text') {
    const chars = item.charCount ?? item.payload.length;
    const lines = item.lineCount ?? item.payload.split(/\r?\n/).length;
    return lines > 1 ? `${chars} chars · ${lines} lines` : `${chars} chars`;
  }
  const ext = item.extension ? item.extension.toUpperCase() : 'File';
  const size = item.sizeBytes ? formatBytes(item.sizeBytes) : '';
  return size ? `${ext} · ${size}` : ext;
};

const getLinkPreviewInfo = (item: DropItem): { title: string; subtitle: string; badge: string } => {
  const parsed = parseSafeHttpUrl(item.payload, item.title);
  const title = item.title || parsed?.title || parsed?.domain || 'Link';
  const subtitle = item.displayUrl || parsed?.displayUrl || item.domain || item.payload;
  const badge = item.payload.startsWith('https://') ? 'HTTPS' : 'HTTP';
  return { title, subtitle, badge };
};

interface DropShelfCardProps {
  item: DropItem;
  isHighlighted?: boolean;
  onRemove: (id: string) => void;
  onOpenMusic?: () => void;
  onCopiedFeedback?: () => void;
  onDragOutFeedback?: (status: 'dropped' | 'missing', item: DropItem) => void;
}

const DropShelfCard: React.FC<DropShelfCardProps> = ({
  item,
  isHighlighted = false,
  onRemove,
  onOpenMusic,
  onCopiedFeedback,
  onDragOutFeedback,
}) => {
  const { setPlaybackSource, playTrack } = useCasaAudio();
  const { settings, palette: themePalette } = useSettingsStore();
  const isMonochrome = settings.theme === 'monochrome';
  const [imgError, setImgError] = useState(false);
  const [copied, setCopied] = useState(false);
  const [isOpeningAudio, setIsOpeningAudio] = useState(false);

  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const draggedDuringGestureRef = useRef(false);
  const isDragInFlightRef = useRef(false);

  useEffect(() => {
    setImgError(false);
  }, [item.payload]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      dragCleanupRef.current?.();
      dragCleanupRef.current = null;
    };
  }, []);

  const isFileBased =
    item.type === 'file' || item.type === 'image' || item.type === 'folder';
  const canDragOut = isFileBased || item.type === 'text' || isLinkItem(item);
  const isAudio = isAudioItem(item);

  const triggerCopiedFeedback = useCallback(() => {
    setCopied(true);
    playChimeCue('tap');
    onCopiedFeedback?.();
    if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    copyTimerRef.current = setTimeout(() => setCopied(false), 1400);
  }, [onCopiedFeedback]);

  const handleOpenItem = useCallback(async () => {
    if (draggedDuringGestureRef.current) {
      draggedDuringGestureRef.current = false;
      return;
    }
    try {
      if (isFileBased) {
        await invoke('launch_file_item', { path: item.payload });
        playChimeCue('tap');
      } else {
        const ok = await copyTextToClipboard(item.payload);
        if (ok) {
          triggerCopiedFeedback();
        }
      }
    } catch (err) {
      console.warn('[DropZoneCard] Open failed:', err);
    }
  }, [item, isFileBased, triggerCopiedFeedback]);

  const handleOpenUrl = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isLinkItem(item)) return;
      try {
        await invoke('open_url_item', { url: item.payload });
        playChimeCue('tap');
      } catch (err) {
        console.warn('[DropZoneCard] Open URL failed:', err);
      }
    },
    [item]
  );

  const handleCopyItem = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      try {
        if (isFileBased) {
          await invoke('copy_files_to_clipboard', { paths: [item.payload] });
          triggerCopiedFeedback();
        } else {
          const ok = await copyTextToClipboard(item.payload);
          if (ok) {
            triggerCopiedFeedback();
          }
        }
      } catch (err) {
        console.warn('[DropZoneCard] Clipboard copy failed:', err);
      }
    },
    [item.payload, isFileBased, triggerCopiedFeedback]
  );

  const handleQuickPlayAudio = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!isAudio || isOpeningAudio) return;
      setIsOpeningAudio(true);
      try {
        await invoke<string[]>('register_drop_zone_files', { paths: [item.payload] });
        const assetUrl = convertFileSrc(item.payload);
        const rawBaseName = item.title.replace(/\.[^.]+$/, '').trim() || item.title;
        const parsed = parseTrackTitleAndArtist(rawBaseName, 'Local Audio');
        const track: NativeTrack = {
          id: `local-dropzone-${item.id}`,
          title: parsed.title || rawBaseName,
          artist: parsed.artist || 'Local Audio',
          durationSeconds: 0,
          thumbnailUrl: '',
          streamUrl: assetUrl,
          candidates: [assetUrl],
        };
        setPlaybackSource('native');
        await playTrack(track, [track]);
        playChimeCue('ding');
        onOpenMusic?.();
      } catch (err) {
        console.warn('[DropZoneCard] Quick Play failed:', err);
      } finally {
        setIsOpeningAudio(false);
      }
    },
    [
      isAudio,
      isOpeningAudio,
      item.id,
      item.payload,
      item.title,
      setPlaybackSource,
      playTrack,
      onOpenMusic,
    ]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggedDuringGestureRef.current = false;
    if (!canDragOut || e.button !== 0) return;

    const target = e.target as HTMLElement;
    if (target.closest('[data-no-drag="true"]')) return;

    // Prevent WebView2 default focus-steal / selection-drag on pointerdown while preserving pointermove & click
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    let triggered = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerUp);
      dragCleanupRef.current = null;
    };

    const onPointerMove = async (moveEvent: PointerEvent) => {
      if (triggered || isDragInFlightRef.current) return;
      const dist = Math.hypot(moveEvent.clientX - startX, moveEvent.clientY - startY);
      if (dist < DRAG_THRESHOLD_PX) return;

      triggered = true;
      isDragInFlightRef.current = true;
      draggedDuringGestureRef.current = true;
      cleanup();

      useDropZoneStore.getState().setIsInternalDragging(true);
      try {
        const payloadToDrag = isLinkItem(item) ? item.payload.trim() : item.payload;
        const result = isFileBased
          ? await nativeDragDropFiles([item.payload])
          : await nativeDragDropText(payloadToDrag);
        if (result.status === 'dropped') {
          useDropZoneStore.getState().recordDraggedOutItem(item);
          onRemove(item.id);
          onDragOutFeedback?.('dropped', item);
          playChimeCue('ding');
        }
      } catch (err) {
        console.warn('[DropZoneCard] native drag-out error:', err);
        if (isFileBased) {
          onDragOutFeedback?.('missing', item);
        }
      } finally {
        // Release isInternalDragging ONLY after DoDragDrop settles
        useDropZoneStore.getState().setIsInternalDragging(false);
        isDragInFlightRef.current = false;
        draggedDuringGestureRef.current = false;
      }
    };

    const onPointerUp = () => {
      cleanup();
    };

    dragCleanupRef.current?.();
    dragCleanupRef.current = cleanup;
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('pointercancel', onPointerUp);
  };

  const linkInfo = isLinkItem(item) ? getLinkPreviewInfo(item) : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.94 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      draggable={false}
      onPointerDown={handlePointerDown}
      data-tauri-drag-region="false"
      data-drop-item-type={item.type}
      className={`group relative w-[186px] h-[106px] shrink-0 rounded-xl bg-[#0a0a0a] border transition-colors flex flex-col justify-between p-2 select-none ${
        isHighlighted
          ? 'border-white/40 ring-1 ring-white/20'
          : 'border-white/[0.06] hover:border-white/[0.16]'
      } ${canDragOut ? 'cursor-grab active:cursor-grabbing' : 'cursor-default'}`}
    >
      {/* Top Preview Body: Text Snippet vs Link Card vs File/Image */}
      {item.type === 'text' ? (
        <div
          onClick={(e) => {
            e.stopPropagation();
            void handleOpenItem();
          }}
          title={item.payload}
          className="flex flex-col gap-1 min-w-0 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-5 h-5 rounded-md bg-[#141417] border border-white/[0.06] flex items-center justify-center shrink-0">
                {renderCategoryIcon(item, isMonochrome)}
              </div>
              <span className="text-[8.5px] font-mono font-semibold tracking-wider text-white/60 uppercase">
                TXT
              </span>
            </div>
            <span className="text-[9px] font-mono text-white/45 truncate tabular-nums">
              {getItemMetaLabel(item)}
            </span>
          </div>
          <p className="text-[10.5px] leading-[1.32] text-white/90 line-clamp-2 break-words">
            {item.payload}
          </p>
        </div>
      ) : linkInfo ? (
        <div
          onClick={(e) => {
            e.stopPropagation();
            void handleOpenItem();
          }}
          title={item.payload}
          className="flex flex-col gap-1 min-w-0 cursor-pointer"
        >
          <div className="flex items-center justify-between gap-1.5 min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              <div className="w-5 h-5 rounded-md bg-[#141417] border border-white/[0.06] flex items-center justify-center shrink-0">
                {renderCategoryIcon(item, isMonochrome)}
              </div>
              <span className="text-[8.5px] font-mono font-semibold tracking-wider text-white/60 uppercase">
                LINK
              </span>
            </div>
            <span className="text-[9px] font-mono text-white/45 truncate tabular-nums">
              {item.domain || linkInfo.badge}
            </span>
          </div>
          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-white/92 truncate leading-tight">
              {linkInfo.title}
            </span>
            <span className="text-[9px] font-mono text-white/45 truncate leading-tight">
              {linkInfo.subtitle}
            </span>
          </div>
        </div>
      ) : (
        <div
          onClick={(e) => {
            e.stopPropagation();
            void handleOpenItem();
          }}
          title={item.payload}
          className="flex items-center gap-2 min-w-0 cursor-pointer"
        >
          <div className="w-9 h-9 rounded-lg bg-[#141417] border border-white/[0.06] overflow-hidden flex items-center justify-center shrink-0">
            {item.type === 'image' && !imgError ? (
              <img
                src={convertFileSrc(item.payload)}
                alt={item.title}
                draggable={false}
                onError={() => setImgError(true)}
                className="w-full h-full object-cover"
              />
            ) : (
              renderCategoryIcon(item, isMonochrome)
            )}
          </div>

          <div className="min-w-0 flex-1 flex flex-col gap-0.5">
            <span className="text-[11px] font-medium text-white/90 truncate leading-tight">
              {item.title}
            </span>
            <span className="text-[9.5px] font-mono text-white/45 truncate tabular-nums leading-tight">
              {getItemMetaLabel(item)}
            </span>
          </div>
        </div>
      )}

      {/* Bottom Action Bar */}
      <div
        data-no-drag="true"
        className="flex items-center justify-between gap-1 pt-1.5 border-t border-white/[0.05]"
      >
        <div className="flex items-center gap-1 min-w-0 text-white/35">
          {canDragOut && <GripVertical className="w-3 h-3 shrink-0" />}
          <span
            data-copy-status={copied ? 'copied' : 'idle'}
            className={`text-[9px] tracking-tight truncate ${
              copied ? 'text-white/90 font-medium' : ''
            }`}
          >
            {copied
              ? 'Tersalin'
              : item.type === 'folder' || item.isDir
              ? 'Drag folder'
              : isFileBased
              ? 'Drag out'
              : isLinkItem(item)
              ? 'Drag link'
              : 'Drag text'}
          </span>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {isAudio && (
            <button
              type="button"
              data-no-drag="true"
              onClick={handleQuickPlayAudio}
              title="Quick Play di Musik"
              className="w-[22px] h-[22px] rounded-md bg-white text-black hover:bg-white/90 flex items-center justify-center transition-transform active:scale-95 cursor-pointer"
            >
              <Play className="w-3 h-3 fill-current ml-[1px]" />
            </button>
          )}

          {isLinkItem(item) && (
            <button
              type="button"
              data-no-drag="true"
              onClick={handleOpenUrl}
              title="Buka tautan di browser"
              className="w-[22px] h-[22px] rounded-md bg-white/[0.05] text-white/70 border border-white/[0.08] hover:bg-white/[0.12] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            >
              <ExternalLink className="w-3 h-3" />
            </button>
          )}

          <button
            type="button"
            data-no-drag="true"
            onClick={handleCopyItem}
            title={
              isFileBased
                ? 'Salin berkas ke Clipboard Windows'
                : isLinkItem(item)
                ? 'Salin tautan'
                : 'Salin catatan teks'
            }
            style={
              copied
                ? {
                    backgroundColor: `${themePalette.rest}24`,
                    color: themePalette.rest,
                    borderColor: `${themePalette.rest}66`,
                  }
                : undefined
            }
            className={`w-[22px] h-[22px] rounded-md border flex items-center justify-center transition-colors cursor-pointer ${
              copied
                ? ''
                : 'bg-white/[0.05] text-white/70 border-white/[0.08] hover:bg-white/[0.12] hover:text-white'
            }`}
          >
            {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
          </button>

          <button
            type="button"
            data-no-drag="true"
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              onRemove(item.id);
            }}
            title="Hapus dari Drop Zone"
            className="w-[22px] h-[22px] rounded-md bg-white/[0.04] text-white/45 border border-white/[0.06] hover:bg-white/[0.12] hover:text-white flex items-center justify-center transition-colors cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </motion.div>
  );
};

export const DropZoneView: React.FC<DropZoneViewProps> = ({
  isLockedExpanded: _isLockedExpanded = true,
  onOpenMusic,
  podHostEl = null,
  isConnectHpPodOpen = false,
  onToggleConnectHpPod,
  onCloseConnectHpPod,
  onInteractionLock,
}) => {
  const {
    items,
    isDragging,
    isInternalDragging,
    lastActionFeedback,
    lastDraggedOutItem,
    securityNotice,
    clearActionFeedback,
    setSecurityNotice,
    undoLastDraggedOut,
    addItem,
    addDroppedPaths,
    syncAssetScopes,
    removeItem,
    clearAll,
  } = useDropZoneStore();
  const connectHp = useConnectHpStore();
  const { settings, palette: themePalette } = useSettingsStore();
  const isMonochrome = settings.theme === 'monochrome';

  const [isPicking, setIsPicking] = useState(false);
  const [isPasting, setIsPasting] = useState(false);
  const [urlCopied, setUrlCopied] = useState(false);
  const [localHint, setLocalHint] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const shelfRef = useRef<HTMLDivElement>(null);
  const lastNativePasteRef = useRef<number>(0);
  const keydownFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const localHintTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const urlCopyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scrollShelfToFront = useCallback(() => {
    requestAnimationFrame(() => {
      shelfRef.current?.scrollTo({ left: 0, behavior: 'smooth' });
    });
  }, []);

  const flashLocalHint = useCallback((msg: string) => {
    setLocalHint(msg);
    if (localHintTimerRef.current) clearTimeout(localHintTimerRef.current);
    localHintTimerRef.current = setTimeout(() => setLocalHint(null), 1600);
  }, []);

  useEffect(() => {
    void syncAssetScopes();
  }, [syncAssetScopes]);

  useEffect(() => {
    return () => {
      if (keydownFallbackTimerRef.current) {
        clearTimeout(keydownFallbackTimerRef.current);
      }
      if (localHintTimerRef.current) {
        clearTimeout(localHintTimerRef.current);
      }
      if (urlCopyTimerRef.current) {
        clearTimeout(urlCopyTimerRef.current);
      }
    };
  }, []);

  // Auto-clear store promotion/deduplication feedback pill
  useEffect(() => {
    if (!lastActionFeedback) return;
    const timer = setTimeout(() => {
      clearActionFeedback();
    }, 1800);
    return () => clearTimeout(timer);
  }, [lastActionFeedback, clearActionFeedback]);

  // Explicit On-Demand Clipboard Read (ONLY triggered on Ctrl+V / Paste click; zero Ctrl+C background snooping)
  const handlePasteFromClipboard = useCallback(
    async (options?: { silentIfEmpty?: boolean }) => {
      if (isPasting) return;
      setIsPasting(true);
      try {
        // 1. Check CF_HDROP files first if user explicitly copied Explorer files
        if ('__TAURI_INTERNALS__' in window) {
          try {
            const winFiles = await invoke<string[]>('read_clipboard_files');
            if (Array.isArray(winFiles) && winFiles.length > 0) {
              await addDroppedPaths(winFiles);
              scrollShelfToFront();
              playChimeCue('ding');
              return;
            }
          } catch {
            // Fallback cleanly to text
          }
        }

        // 2. Web Clipboard API or Win32 CF_UNICODETEXT fallback
        let clipboardText = '';
        try {
          if (navigator.clipboard?.readText) {
            clipboardText = await navigator.clipboard.readText();
          }
        } catch {
          // Fallback cleanly to Win32 CF_UNICODETEXT
        }

        if ((!clipboardText || !clipboardText.trim()) && '__TAURI_INTERNALS__' in window) {
          try {
            const winText = await invoke<string | null>('read_clipboard_text');
            if (winText && winText.trim()) {
              clipboardText = winText;
            }
          } catch (err) {
            console.warn('[DropZoneView] Win32 read_clipboard_text failed:', err);
          }
        }

        if (clipboardText && clipboardText.trim()) {
          const added = await addItem(clipboardText);
          if (added) {
            scrollShelfToFront();
            playChimeCue('ding');
          } else {
            playChimeCue('tap');
          }
          return;
        }

        if (!options?.silentIfEmpty) {
          flashLocalHint('Clipboard kosong');
        }
      } finally {
        setIsPasting(false);
      }
    },
    [isPasting, addItem, addDroppedPaths, scrollShelfToFront, flashLocalHint]
  );

  // Explicit DOM paste & Ctrl+V listeners while Drop Zone is mounted (NO background Ctrl+C polling)
  useEffect(() => {
    const ingestClipboardDataTransfer = async (data: DataTransfer): Promise<boolean> => {
      const collectedPaths: string[] = [];

      if (data.files && data.files.length > 0) {
        for (let i = 0; i < data.files.length; i++) {
          const file = data.files[i];
          const diskPath = (file as File & { path?: string }).path;
          if (diskPath && diskPath.trim()) {
            collectedPaths.push(diskPath);
            continue;
          }

          if (file.type.startsWith('image/') && '__TAURI_INTERNALS__' in window) {
            try {
              const buffer = await file.arrayBuffer();
              const bytes = Array.from(new Uint8Array(buffer));
              const ext = file.type.split('/')[1]?.replace(/[^a-z0-9]/gi, '') || 'png';
              const savedPath = await invoke<string>('save_clipboard_image', {
                bytes,
                extension: ext,
              });
              if (savedPath) collectedPaths.push(savedPath);
            } catch (err) {
              console.warn('[DropZoneView] Failed saving pasted clipboard image:', err);
            }
          }
        }
      }

      if (collectedPaths.length > 0) {
        await addDroppedPaths(collectedPaths);
        scrollShelfToFront();
        playChimeCue('ding');
        return true;
      }

      if ('__TAURI_INTERNALS__' in window) {
        try {
          const winFiles = await invoke<string[]>('read_clipboard_files');
          if (Array.isArray(winFiles) && winFiles.length > 0) {
            await addDroppedPaths(winFiles);
            scrollShelfToFront();
            playChimeCue('ding');
            return true;
          }
        } catch {
          // Ignore cleanly
        }
      }

      const uriOrText = data.getData('text/uri-list') || data.getData('text/plain');
      if (uriOrText && uriOrText.trim()) {
        const added = await addItem(uriOrText);
        if (added) {
          scrollShelfToFront();
          playChimeCue('ding');
        } else {
          playChimeCue('tap');
        }
        return true;
      }

      return false;
    };

    const handleWindowPaste = async (e: ClipboardEvent) => {
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      lastNativePasteRef.current = Date.now();
      if (keydownFallbackTimerRef.current) {
        clearTimeout(keydownFallbackTimerRef.current);
        keydownFallbackTimerRef.current = null;
      }

      e.preventDefault();
      if (e.clipboardData) {
        const handled = await ingestClipboardDataTransfer(e.clipboardData);
        if (handled) return;
      }
      await handlePasteFromClipboard({ silentIfEmpty: false });
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'v') return;
      const activeTag = document.activeElement?.tagName;
      if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;

      if (keydownFallbackTimerRef.current) {
        clearTimeout(keydownFallbackTimerRef.current);
      }
      keydownFallbackTimerRef.current = setTimeout(() => {
        keydownFallbackTimerRef.current = null;
        if (Date.now() - lastNativePasteRef.current > 80) {
          void handlePasteFromClipboard({ silentIfEmpty: false });
        }
      }, 28);
    };

    window.addEventListener('paste', handleWindowPaste);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('paste', handleWindowPaste);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [addItem, addDroppedPaths, handlePasteFromClipboard, scrollShelfToFront]);

  const handlePickFiles = useCallback(
    async (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (isPicking) return;
      setIsPicking(true);
      try {
        const paths = await pickDropZoneFilesNative();
        if (Array.isArray(paths) && paths.length > 0) {
          await addDroppedPaths(paths);
          scrollShelfToFront();
          playChimeCue('ding');
        }
      } catch (err) {
        console.warn('[DropZoneView] File picker cancelled or failed:', err);
      } finally {
        setIsPicking(false);
      }
    },
    [isPicking, addDroppedPaths, scrollShelfToFront]
  );

  const handlePickFolders = useCallback(
    async (e?: React.MouseEvent) => {
      e?.stopPropagation();
      if (isPicking) return;
      setIsPicking(true);
      try {
        const paths = await pickDropZoneFolderNative();
        if (Array.isArray(paths) && paths.length > 0) {
          await addDroppedPaths(paths);
          scrollShelfToFront();
          playChimeCue('ding');
        }
      } catch (err) {
        console.warn('[DropZoneView] Folder picker cancelled or failed:', err);
      } finally {
        setIsPicking(false);
      }
    },
    [isPicking, addDroppedPaths, scrollShelfToFront]
  );

  const handleToggleConnectHp = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      playChimeCue('tap');
      const willOpen = !isConnectHpPodOpen;
      onToggleConnectHpPod?.();
      if (willOpen && (!connectHp.active || !connectHp.qrPath) && !connectHp.isLoading) {
        void connectHp.startSession();
      }
    },
    [isConnectHpPodOpen, onToggleConnectHpPod, connectHp]
  );

  const handleCopyConnectUrl = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!connectHp.url) return;
      const ok = await copyTextToClipboard(connectHp.url);
      if (ok) {
        setUrlCopied(true);
        playChimeCue('tap');
        if (urlCopyTimerRef.current) clearTimeout(urlCopyTimerRef.current);
        urlCopyTimerRef.current = setTimeout(() => setUrlCopied(false), 1600);
      }
    },
    [connectHp.url]
  );

  const handleShelfWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    e.stopPropagation();
    const container = shelfRef.current;
    if (!container) return;
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      container.scrollLeft += e.deltaY;
    }
  };

  const currentIface = connectHp.candidateInterfaces.find((c) => c.ip === connectHp.ip);
  const hasHotspotOption = connectHp.candidateInterfaces.some((c) => c.isHotspot);
  const isPublicWarning =
    connectHp.active &&
    connectHp.networkCategory === 'Public' &&
    !currentIface?.isHotspot;
  const podStatusBadge = !connectHp.active
    ? connectHp.isLoading
      ? 'Mulai...'
      : 'Off'
    : connectHp.connectedClients > 0
    ? `${connectHp.connectedClients} HP`
    : isPublicWarning
    ? 'Public'
    : 'Wait';

  const rightPodX = 850;
  const connectHpPodMarkup = (
    <div
      className="pointer-events-none w-[1100px] h-[196px] relative select-none"
      data-tauri-drag-region="false"
    >
      <AnimatePresence>
        {isConnectHpPodOpen && (
          <motion.aside
            key="right-connect-hp-pod"
            data-pod="right"
            data-satellite-pod="true"
            data-connect-hp-pod="true"
            initial={{ opacity: 0, x: -14, scale: 0.96, left: rightPodX }}
            animate={{ opacity: 1, x: 0, scale: 1, left: rightPodX }}
            exit={{ opacity: 0, x: -10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onWheel={(e) => e.stopPropagation()}
            style={{ top: 15, width: 204, height: 177 }}
            className="pointer-events-auto absolute bg-[#000000] border border-white/[0.12] rounded-2xl p-2 flex flex-col justify-between gap-1.5 shadow-[0_12px_32px_rgba(0,0,0,0.9)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-1 pb-1 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-1 min-w-0">
                <Smartphone className="w-3 h-3 text-white/85 shrink-0" />
                <span className="text-[9.5px] font-mono font-semibold tracking-wider text-white/90 uppercase truncate">
                  CONNECT HP
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <span
                  data-connect-hp-status={
                    connectHp.connectedClients > 0
                      ? 'connected'
                      : isPublicWarning
                      ? 'public'
                      : 'waiting'
                  }
                  className={`px-1.5 py-[1px] rounded-full text-[8px] font-mono font-semibold border ${
                    connectHp.connectedClients > 0
                      ? 'bg-white text-black border-white'
                      : 'bg-white/[0.08] text-white/80 border-white/[0.14]'
                  }`}
                >
                  {podStatusBadge}
                </span>
                <button
                  type="button"
                  data-connect-hp-stop="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    void connectHp.stopSession();
                    onCloseConnectHpPod?.();
                  }}
                  title="Matikan server & tutup Connect HP"
                  className="w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.16] text-white/60 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {/* Middle Body: 100x100 Declarative SVG QR + Controls */}
            <div className="flex items-center gap-2 flex-1 min-h-0">
              <div className="w-[100px] h-[100px] shrink-0 rounded-lg bg-white p-1 flex items-center justify-center overflow-hidden">
                {connectHp.qrPath && connectHp.qrSize > 0 ? (
                  <svg
                    viewBox={`0 0 ${connectHp.qrSize} ${connectHp.qrSize}`}
                    className="w-full h-full block"
                    shapeRendering="crispEdges"
                    aria-label="QR Code Connect HP"
                  >
                    <rect width={connectHp.qrSize} height={connectHp.qrSize} fill="#ffffff" />
                    <path d={connectHp.qrPath} fill="#000000" />
                  </svg>
                ) : connectHp.isLoading ? (
                  <span className="text-[8.5px] font-mono text-black/70 text-center leading-tight">
                    Memuat...
                  </span>
                ) : (
                  <button
                    type="button"
                    data-connect-hp-restart="true"
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      void connectHp.startSession();
                    }}
                    className="px-2 py-1 rounded-md bg-black text-white text-[8.5px] font-mono font-semibold cursor-pointer"
                  >
                    Mulai Ulang
                  </button>
                )}
              </div>

              <div className="flex-1 min-w-0 h-[100px] flex flex-col justify-between gap-1">
                <select
                  aria-label="Pilih antarmuka jaringan Connect HP"
                  data-connect-hp-iface="true"
                  value={connectHp.ip}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    e.stopPropagation();
                    void connectHp.selectInterface(e.target.value);
                  }}
                  className="w-full h-[22px] rounded-md bg-[#111114] border border-white/[0.14] px-1 text-[8px] font-mono text-white outline-none truncate cursor-pointer"
                >
                  {connectHp.candidateInterfaces.length === 0 ? (
                    <option value="">Detecting LAN...</option>
                  ) : (
                    connectHp.candidateInterfaces.map((iface) => (
                      <option key={iface.ip} value={iface.ip}>
                        {iface.label}
                      </option>
                    ))
                  )}
                </select>

                <button
                  type="button"
                  data-connect-hp-copy-url="true"
                  disabled={!connectHp.url}
                  onClick={handleCopyConnectUrl}
                  className="w-full h-[22px] rounded-md bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.12] px-1.5 text-[8.5px] font-medium text-white flex items-center justify-center gap-1 cursor-pointer disabled:opacity-40"
                >
                  {urlCopied ? <Check className="w-2.5 h-2.5" /> : <Copy className="w-2.5 h-2.5" />}
                  <span className="truncate">{urlCopied ? 'URL Disalin' : 'Salin URL'}</span>
                </button>

                <button
                  type="button"
                  data-connect-hp-autocopy="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    void connectHp.toggleAutoCopy();
                  }}
                  title="Otomatis salin teks kiriman HP ke Clipboard Windows"
                  className={`w-full h-[21px] rounded-md border px-1.5 text-[8px] font-mono font-medium truncate cursor-pointer transition-colors ${
                    connectHp.autoCopyClipboard
                      ? 'bg-white text-black border-white'
                      : 'bg-white/[0.04] text-white/65 border-white/[0.10] hover:text-white'
                  }`}
                >
                  {connectHp.autoCopyClipboard ? 'Auto Copy: ON' : 'Auto Copy: OFF'}
                </button>

                <div className="text-[8px] text-white/55 truncate leading-tight">
                  {connectHp.lastTransferNotice ||
                    (connectHp.connectedClients > 0
                      ? 'Siap transfer 2 arah'
                      : 'Scan QR via HP')}
                </div>
              </div>
            </div>

            {/* Footer Diagnostics / Firewall Guide */}
            <div className="shrink-0 pt-1 border-t border-white/[0.07]">
              {isPublicWarning ? (
                <div
                  data-connect-hp-public-guide="true"
                  className="flex items-center justify-between gap-1 text-[8px] text-white/85"
                >
                  <div className="flex items-center gap-1 min-w-0">
                    <AlertTriangle className="w-2.5 h-2.5 shrink-0 text-white" />
                    <span className="truncate">Public Wi-Fi · Firewall /</span>
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      void connectHp.openNetworkSettings(hasHotspotOption ? 'hotspot' : 'network');
                    }}
                    className="underline text-white font-semibold shrink-0 cursor-pointer"
                  >
                    {hasHotspotOption ? 'Hotspot' : 'Private'}
                  </button>
                </div>
              ) : connectHp.error ? (
                <div className="text-[8px] text-white/75 truncate" title={connectHp.error}>
                  {connectHp.error}
                </div>
              ) : (
                <div className="flex items-center justify-between gap-1 text-[8px] font-mono text-white/45">
                  <span className="truncate">
                    {connectHp.active ? `${connectHp.ip}:${connectHp.port}` : 'Server standby'}
                  </span>
                  <span className="shrink-0">
                    {connectHp.active ? `${connectHp.networkCategory} · 10m` : ''}
                  </span>
                </div>
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );

  const showDragTargetHighlight = isDragging && !isInternalDragging;
  const activeFeedbackBadge = localHint || lastActionFeedback?.label || null;

  return (
    <>
      {podHostEl && createPortal(connectHpPodMarkup, podHostEl)}

      <div
        ref={containerRef}
        tabIndex={-1}
        onDragOver={(e) => {
          if (useDropZoneStore.getState().isInternalDragging) return;
          e.preventDefault();
          if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
          }
        }}
        onDrop={(e) => {
          if (useDropZoneStore.getState().isInternalDragging) return;
          e.preventDefault();
          useDropZoneStore.getState().setIsDragging(false);
          void useDropZoneStore
            .getState()
            .addDroppedDataTransfer(e.dataTransfer)
            .then((res) => {
              if (res.added > 0) {
                scrollShelfToFront();
                playChimeCue('ding');
              } else if (res.blocked) {
                playChimeCue('tap');
              }
            });
        }}
        onMouseDown={(e) => {
          const target = e.target as HTMLElement | null;
          if (
            useDropZoneStore.getState().isInternalDragging ||
            target?.closest('[data-drop-item-type]') ||
            target?.closest('button')
          ) {
            return;
          }
          containerRef.current?.focus({ preventScroll: true });
        }}
        data-tauri-drag-region="false"
        className="relative w-full h-full bg-[#000000] px-3 py-2 flex flex-col justify-between gap-2 select-none overflow-hidden outline-none"
      >
        {/* Header Shelf Bar */}
        <div className="flex items-center justify-between gap-1.5 h-[24px] shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 flex-1">
            <span className="text-[11px] font-medium text-white/80 tabular-nums shrink-0">
              {items.length === 0
                ? 'Drop Zone Shelf'
                : `${items.length} ${items.length === 1 ? 'item parked' : 'items parked'}`}
            </span>

            <AnimatePresence initial={false}>
              {lastDraggedOutItem ? (
                <motion.button
                  key={`undo-${lastDraggedOutItem.id}`}
                  type="button"
                  data-dropzone-undo="true"
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.14 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setLocalHint(null);
                    undoLastDraggedOut();
                    scrollShelfToFront();
                    playChimeCue('tap');
                  }}
                  title="Pulihkan kartu terakhir yang ditarik keluar (4 detik)"
                  className="inline-flex items-center gap-1 px-2 py-[1px] rounded-full bg-white/[0.14] hover:bg-white/[0.22] border border-white/25 text-[9.5px] font-medium text-white truncate transition-colors cursor-pointer"
                >
                  <RotateCcw className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate">Dihapus · Urungkan</span>
                </motion.button>
              ) : activeFeedbackBadge ? (
                <motion.span
                  key={activeFeedbackBadge}
                  initial={{ opacity: 0, x: -4 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -4 }}
                  transition={{ duration: 0.14 }}
                  className="px-2 py-[1px] rounded-full bg-white/[0.10] border border-white/[0.12] text-[9.5px] font-medium text-white/85 truncate"
                >
                  {activeFeedbackBadge}
                </motion.span>
              ) : (
                items.length > 0 && (
                  <span className="text-[9.5px] text-white/35 truncate">
                    · Ephemeral · Ctrl+V
                  </span>
                )
              )}
            </AnimatePresence>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-dropzone-connect-hp="true"
              onClick={handleToggleConnectHp}
              title="Hubungkan HP via QR Code & Wi-Fi / Hotspot lokal"
              className={`inline-flex items-center gap-1 px-2 h-[22px] rounded-full border text-[10px] font-medium transition-colors cursor-pointer ${
                isConnectHpPodOpen
                  ? 'bg-white text-black border-white'
                  : connectHp.active
                  ? 'bg-white/[0.14] text-white border-white/35 hover:bg-white/[0.20]'
                  : 'bg-white/[0.08] hover:bg-white/[0.15] border-white/[0.10] text-white'
              }`}
            >
              <Smartphone className="w-3 h-3 shrink-0" />
              <span>Connect HP</span>
              {connectHp.active && (
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isConnectHpPodOpen ? 'bg-black' : 'bg-white'
                  }`}
                />
              )}
            </button>

            <button
              type="button"
              data-dropzone-paste="true"
              disabled={isPasting}
              onClick={(e) => {
                e.stopPropagation();
                void handlePasteFromClipboard({ silentIfEmpty: false });
              }}
              title="Tempel teks, tautan, atau berkas dari Clipboard (Ctrl+V)"
              className="inline-flex items-center gap-1 px-2 h-[22px] rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.10] text-[10px] font-medium text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <ClipboardPaste className="w-3 h-3 shrink-0" />
              <span>Paste</span>
            </button>

            <button
              type="button"
              data-dropzone-pick-file="true"
              disabled={isPicking}
              onClick={handlePickFiles}
              title="Pilih berkas hingga >4 GB via File Explorer"
              className="inline-flex items-center gap-1 px-2 h-[22px] rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.10] text-[10px] font-medium text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <Plus className="w-3 h-3 shrink-0" />
              <span>File</span>
            </button>

            <button
              type="button"
              data-dropzone-pick-folder="true"
              disabled={isPicking}
              onClick={handlePickFolders}
              title="Pilih folder utuh untuk dikirim ke HP sebagai streaming ZIP"
              className="inline-flex items-center gap-1 px-2 h-[22px] rounded-full bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.10] text-[10px] font-medium text-white transition-colors cursor-pointer disabled:opacity-50"
            >
              <FolderPlus className="w-3 h-3 shrink-0" />
              <span>Folder</span>
            </button>

            {items.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playChimeCue('tap');
                  clearAll();
                }}
                title="Bersihkan rak Dropzone"
                className="inline-flex items-center gap-1 px-2 h-[22px] rounded-full bg-white/[0.04] hover:bg-white/[0.10] border border-white/[0.08] text-[10px] font-medium text-white/60 hover:text-white transition-colors cursor-pointer"
              >
                <Trash2 className="w-3 h-3 shrink-0" />
                <span>Clear</span>
              </button>
            )}
          </div>
        </div>

        {/* Main Content Area: Empty State vs Horizontal Card Shelf */}
        <div className="relative flex-1 min-h-0 flex items-center">
          <AnimatePresence>
            {securityNotice && (
              <motion.div
                key={securityNotice}
                role="alert"
                data-security-notice="true"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.14 }}
                onClick={(e) => e.stopPropagation()}
                style={
                  isMonochrome
                    ? undefined
                    : {
                        borderColor: `${themePalette.danger}66`,
                        backgroundColor: '#141013F2',
                        color: themePalette.danger,
                      }
                }
                className={`absolute left-0 right-0 top-0 z-20 flex items-start justify-between gap-2 px-2.5 py-1.5 rounded-lg border shadow-[0_8px_20px_rgba(0,0,0,0.85)] backdrop-blur-sm ${
                  isMonochrome ? 'bg-[#121215]/95 border-white/30 text-white' : ''
                }`}
              >
                <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span className="text-[10px] font-medium leading-[1.35] whitespace-normal break-words line-clamp-2 flex-1 min-w-0">
                  {securityNotice}
                </span>
                <button
                  type="button"
                  data-security-notice-dismiss="true"
                  aria-label="Tutup peringatan"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSecurityNotice(null);
                  }}
                  className="w-4 h-4 rounded flex items-center justify-center shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
                >
                  <X className="w-3 h-3" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
          {items.length === 0 ? (
            <div
              onClick={handlePickFiles}
              className={`w-full h-full rounded-xl border border-dashed transition-colors flex flex-col items-center justify-center gap-2 cursor-pointer px-4 ${
                showDragTargetHighlight
                  ? isMonochrome
                    ? 'border-white/55 bg-white/[0.06]'
                    : 'border-indigo-500/60 bg-indigo-500/[0.08]'
                  : 'border-white/[0.12] hover:border-white/25 bg-[#0a0a0a]'
              }`}
            >
              <div className="flex items-center gap-2">
                <Inbox
                  className={`w-4 h-4 transition-colors ${
                    showDragTargetHighlight
                      ? isMonochrome
                        ? 'text-white'
                        : 'text-indigo-400'
                      : 'text-white/50'
                  }`}
                />
                <span className="text-[11.5px] font-medium text-white/85">
                  Drop files, links, or text · Ctrl+V to paste
                </span>
              </div>
              <div className="flex items-center gap-1.5 flex-wrap justify-center">
                <button
                  type="button"
                  disabled={isPasting}
                  onClick={(e) => {
                    e.stopPropagation();
                    void handlePasteFromClipboard({ silentIfEmpty: false });
                  }}
                  className="inline-flex items-center gap-1 px-2.5 h-[22px] rounded-full bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.10] text-[10px] font-medium text-white/90 transition-colors cursor-pointer disabled:opacity-50"
                >
                  <ClipboardPaste className="w-3 h-3" />
                  <span>Paste (Ctrl+V)</span>
                </button>
                <button
                  type="button"
                  disabled={isPicking}
                  onClick={handlePickFiles}
                  className="inline-flex items-center gap-1 px-2.5 h-[22px] rounded-full bg-white/[0.05] hover:bg-white/[0.14] border border-white/[0.08] text-[10px] font-medium text-white/75 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  <Plus className="w-3 h-3" />
                  <span>+ File</span>
                </button>
                <button
                  type="button"
                  disabled={isPicking}
                  onClick={handlePickFolders}
                  className="inline-flex items-center gap-1 px-2.5 h-[22px] rounded-full bg-white/[0.05] hover:bg-white/[0.14] border border-white/[0.08] text-[10px] font-medium text-white/75 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  <FolderPlus className="w-3 h-3" />
                  <span>+ Folder</span>
                </button>
                <button
                  type="button"
                  onClick={handleToggleConnectHp}
                  className="inline-flex items-center gap-1 px-2.5 h-[22px] rounded-full bg-white/[0.08] hover:bg-white/[0.16] border border-white/[0.14] text-[10px] font-medium text-white transition-colors cursor-pointer"
                >
                  <Smartphone className="w-3 h-3" />
                  <span>Connect HP</span>
                </button>
              </div>
            </div>
          ) : (
            <div
              ref={shelfRef}
              onWheel={handleShelfWheel}
              className="w-full h-full flex items-center gap-2 overflow-x-auto no-scrollbar"
            >
              <AnimatePresence initial={false} mode="popLayout">
                {items.map((item) => (
                  <DropShelfCard
                    key={item.id}
                    item={item}
                    isHighlighted={lastActionFeedback?.id === item.id}
                    onRemove={removeItem}
                    onOpenMusic={onOpenMusic}
                    onCopiedFeedback={() => flashLocalHint('Tersalin')}
                    onDragOutFeedback={(status, draggedItem) => {
                      if (status === 'dropped') {
                        const label =
                          draggedItem.type === 'link'
                            ? 'Link'
                            : draggedItem.type === 'text'
                            ? 'Teks'
                            : draggedItem.type === 'folder' || draggedItem.isDir
                            ? 'Folder'
                            : 'File';
                        flashLocalHint(`${label} dikirim keluar · dihapus dari rak`);
                      } else {
                        flashLocalHint('Berkas tidak ditemukan di disk');
                      }
                    }}
                  />
                ))}
              </AnimatePresence>
            </div>
          )}

          {/* Magnetic Drag-Over Overlay Highlight */}
          <AnimatePresence>
            {showDragTargetHighlight && items.length > 0 && (
              <motion.div
                key="dropzone-drag-overlay"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.12 }}
                className={`pointer-events-none absolute inset-0 rounded-xl border-2 border-dashed backdrop-blur-sm flex items-center justify-center gap-2 ${
                  isMonochrome
                    ? 'border-white/55 bg-white/[0.06]'
                    : 'border-indigo-500/60 bg-indigo-500/[0.08]'
                }`}
              >
                <Inbox className={`w-4 h-4 ${isMonochrome ? 'text-white' : 'text-indigo-400'}`} />
                <span className="text-[11.5px] font-medium text-white/90">
                  Lepaskan file, tautan, atau teks ke Drop Zone
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
};
