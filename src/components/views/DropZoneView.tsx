import React, { useState, useRef } from 'react';
import {
  UploadCloud,
  FileText,
  FolderOpen,
  Folder,
  ExternalLink,
  Copy,
  Check,
  Link2,
  Image as ImageIcon,
  Clipboard,
  X,
  Layers,
  GripHorizontal,
} from 'lucide-react';
import { invoke, convertFileSrc } from '@tauri-apps/api/core';
import { startDrag } from '@tauri-apps/plugin-drag';
import { useDropZoneStore, DropItem } from '../../stores/useDropZoneStore';
import { playChimeCue } from '../../utils/tauriBridge';
import { CosmicVoidPurgeIcon } from '../system/CosmicIcons';

export const DropZoneView: React.FC = () => {
  const { items, isDragging, isInternalDragging, removeItem, clearAll, addItem } = useDropZoneStore();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  const handleWheel = (e: React.WheelEvent) => {
    // Hentikan propagasi agar perputaran roda mouse di area shelf tidak mengubah mode CASA
    e.stopPropagation();
    if (scrollContainerRef.current) {
      // Petakan perputaran roda vertikal mouse PC ke pergeseran horizontal
      scrollContainerRef.current.scrollLeft += e.deltaY;
    }
  };

  const handleCopyText = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    playChimeCue('tap');
    setTimeout(() => {
      setCopiedId((prev) => (prev === id ? null : prev));
    }, 1500);
  };

  /** Meluncurkan file langsung dengan ShellExecuteW tanpa dialog peringatan */
  const handleLaunchFile = async (path: string) => {
    try {
      playChimeCue('tap');
      await invoke('launch_file_item', { path });
    } catch (err) {
      console.warn('[DropZoneView] Failed to launch file:', err);
    }
  };

  /** Membuka folder lokasi berkas dan menyorotnya di Windows Explorer */
  const handleRevealInFolder = async (path: string) => {
    try {
      playChimeCue('whisper');
      await invoke('reveal_in_folder', { path });
    } catch (err) {
      console.warn('[DropZoneView] Failed to reveal in folder:', err);
    }
  };

  /** Memulai sesi drag-and-drop native via tauri-plugin-drag untuk mengekspor file ke Explorer/Desktop */
  const handleCardDragStart = async (e: React.MouseEvent | React.DragEvent, filePath: string) => {
    // 1. Matikan drag bawaan browser HTML5
    if ('preventDefault' in e) {
      e.preventDefault();
    }

    // 2. Bersihkan seleksi teks agar tidak mengunci kursor
    window.getSelection()?.removeAllRanges();

    try {
      // 3. Panggil plugin native dengan path file dan icon '' (string kosong)
      // PENTING: icon JANGAN diisi 'file' atau nama sembarang karena drag-rs di Windows
      // akan gagal jika mencari bitmap file yang tidak ada di disk.
      useDropZoneStore.getState().setIsInternalDragging(true);
      playChimeCue('whisper');
      await startDrag({
        item: [filePath],
        icon: '',
      });
    } catch (err) {
      console.error('[DropZoneView] Native drag failed:', err);
    } finally {
      // Beri sedikit delay agar drag session selesai sepenuhnya sebelum membuka kembali drag-in
      setTimeout(() => {
        useDropZoneStore.getState().setIsInternalDragging(false);
      }, 250);
    }
  };

  const handleOpenUrl = async (url: string) => {
    try {
      playChimeCue('tap');
      await invoke('open_url_item', { url });
    } catch (err) {
      console.warn('[DropZoneView] Failed to open URL:', err);
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text && text.trim()) {
        await addItem(text);
        playChimeCue('ding');
      }
    } catch (err) {
      console.warn('[DropZoneView] Failed to read clipboard:', err);
    }
  };

  const getExtensionColor = (ext?: string) => {
    if (!ext) return 'bg-[#18181c] text-zinc-300 border-[#2e2e34]';
    const lower = ext.toLowerCase();
    if (['pdf'].includes(lower)) {
      return 'bg-rose-500/10 text-rose-300 border-rose-500/25';
    }
    if (['zip', 'rar', '7z', 'tar', 'gz'].includes(lower)) {
      return 'bg-purple-500/10 text-purple-300 border-purple-500/25';
    }
    if (['ts', 'tsx', 'js', 'jsx', 'rs', 'py', 'json', 'html', 'css', 'go', 'cpp', 'c', 'md', 'markdown', 'txt'].includes(lower)) {
      return 'bg-purple-950/40 text-[#c084fc] border-purple-500/30';
    }
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'bmp', 'ico', 'avif'].includes(lower)) {
      return 'bg-purple-950/40 text-[#c084fc] border-purple-500/30';
    }
    if (['mp3', 'wav', 'flac', 'm4a', 'ogg', 'aac'].includes(lower)) {
      return 'bg-teal-500/10 text-teal-300 border-teal-500/25';
    }
    if (['mp4', 'mkv', 'mov', 'webm', 'avi'].includes(lower)) {
      return 'bg-indigo-500/10 text-indigo-300 border-indigo-500/25';
    }
    return 'bg-[#18181c] text-zinc-300 border-[#2e2e34]';
  };

  return (
    <div
      onDragOver={(e) => {
        if (isInternalDragging) return;
        e.preventDefault();
        e.stopPropagation();
        e.dataTransfer.dropEffect = 'copy';
      }}
      onDragEnter={(e) => {
        if (isInternalDragging) return;
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={async (e) => {
        if (isInternalDragging) return;
        e.preventDefault();
        e.stopPropagation();
        useDropZoneStore.getState().setIsDragging(false);
        const text = e.dataTransfer.getData('text/plain') || e.dataTransfer.getData('text/uri-list');
        if (text && text.trim()) {
          await useDropZoneStore.getState().addItem(text.trim());
          playChimeCue('ding');
          return;
        }
        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
          for (let i = 0; i < e.dataTransfer.files.length; i++) {
            const file = e.dataTransfer.files[i];
            const path = (file as any).path || file.name;
            await useDropZoneStore.getState().addDroppedPath(path);
          }
          playChimeCue('ding');
        }
      }}
      className="relative w-full h-full flex flex-col justify-between px-4 pb-2 pt-1 select-none overflow-hidden"
    >
      <style>{`
        .custom-shelf-scrollbar::-webkit-scrollbar {
          height: 3.5px;
        }
        .custom-shelf-scrollbar::-webkit-scrollbar-track {
          background: #09090b;
          border-radius: 4px;
        }
        .custom-shelf-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 4px;
        }
        .custom-shelf-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #38383e;
        }
      `}</style>

      {/* 1. Header Shelf */}
      <div className="flex items-center justify-between h-[26px] shrink-0 border-b border-[#222226] pb-1 mb-1">
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-semibold text-zinc-400 tracking-wider uppercase font-sans">
              Drop Zone Shelf
            </span>
            <span className="font-sans font-medium text-[10px] tracking-wider text-[#e3e0f7] bg-purple-950/40 border border-purple-500/30 px-2 py-0.5 rounded-full tabular-nums">
              {items.length} {items.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {/* Aksi Tempel Persisten di Header: Selalu muncul & bisa diklik kapan saja */}
          <button
            onClick={handlePasteClipboard}
            className="font-sans text-[10.5px] font-medium text-purple-300 hover:text-white bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/30 px-2 py-0.5 rounded-lg transition-all flex items-center gap-1 cursor-pointer active:scale-[0.97]"
            title="Tempel teks atau tautan langsung dari papan klip sistem"
          >
            <span>+ Tempel Teks</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5">
          <button
            disabled={items.length === 0}
            onClick={() => {
              if (items.length === 0) return;
              clearAll();
              playChimeCue('whisper');
            }}
            className={`flex items-center gap-1.5 px-2 py-0.5 rounded-lg font-sans font-medium text-[10.5px] transition-colors group ${
              items.length === 0
                ? 'text-zinc-600 opacity-40 cursor-default'
                : 'text-zinc-400 hover:text-rose-400 cursor-pointer active:scale-[0.97]'
            }`}
            title={items.length > 0 ? 'Kosongkan semua item di shelf' : 'Shelf kosong'}
          >
            <CosmicVoidPurgeIcon
              className={`w-3.5 h-3.5 transition-colors ${
                items.length === 0 ? 'text-zinc-600' : 'text-zinc-500 group-hover:text-rose-400'
              }`}
            />
            <span>Bersihkan</span>
          </button>
        </div>
      </div>

      {/* 2. Main Content Body */}
      <div className="flex-1 min-h-0 relative flex items-center justify-center overflow-hidden">
        {/* Active Drag-Hover State Target */}
        {isDragging && !isInternalDragging ? (
          <div className="w-full h-full flex flex-col items-center justify-center border-2 border-dashed border-purple-500/50 bg-purple-950/30 rounded-xl p-2">
            <UploadCloud className="w-7 h-7 text-[#c084fc] animate-bounce mb-1" />
            <span className="text-[12.5px] font-semibold text-[#c084fc] tracking-tight">
              Lepaskan untuk menyimpan di Shelf
            </span>
            <span className="text-[10px] text-[#c084fc]/90 mt-0.5">
              Menerima berkas dari Explorer, gambar, teks salinan, dan tautan web
            </span>
          </div>
        ) : items.length === 0 ? (
          /* Tata Letak Split-View 2 Kolom Seimbang */
          <div className="grid grid-cols-2 gap-3.5 w-full h-[118px] max-h-[118px] items-stretch">
            {/* Kolom Kiri (Drop Zone Landing Pad) */}
            <div className="border-2 border-dashed border-purple-500/30 rounded-2xl bg-gradient-to-b from-purple-950/20 to-[#09090b] py-2.5 px-3 flex flex-col items-center justify-center text-center hover:border-purple-400/60 transition-all select-none">
              <Layers className="w-6 h-6 text-[#c084fc] mb-1 drop-shadow-[0_0_8px_rgba(192,132,252,0.4)]" />
              <span className="font-sans text-[11.5px] font-medium leading-none mb-0.5 text-[#e3e0f7] tracking-tight">
                Rak Penampung Kosong
              </span>
              <span className="font-sans text-[9.5px] text-zinc-400 leading-tight max-w-[200px]">
                Seret berkas dari Windows Explorer, gambar, atau URL ke notch ini.
              </span>
            </div>

            {/* Kolom Kanan (Clipboard Pocket & Quick Stash) */}
            <div className="rounded-2xl border border-purple-500/20 bg-[#120d1c]/50 py-2.5 px-3 flex flex-col justify-between select-none">
              <div className="flex items-center justify-between">
                <span className="text-[9.5px] font-semibold tracking-wider text-purple-300/70 uppercase font-sans">
                  CLIPBOARD STASH
                </span>
              </div>

              <p className="font-sans text-[9.5px] text-zinc-400 leading-tight mt-0.5 line-clamp-2">
                Simpan cuplikan teks, skrip, atau tautan aktif langsung dari papan klip sistem.
              </p>

              <button
                onClick={handlePasteClipboard}
                className="w-full py-1.5 px-2.5 rounded-lg bg-purple-950/40 hover:bg-purple-900/60 border border-purple-500/40 text-[#e3e0f7] text-[11px] font-medium flex items-center justify-center gap-2 shadow-sm transition-all cursor-pointer active:scale-[0.97] mt-auto"
                title="Tempel teks atau tautan langsung dari papan klip sistem"
              >
                <Clipboard className="w-3.5 h-3.5 text-[#c084fc]" />
                <span>Tempel Clipboard</span>
              </button>
            </div>
          </div>
        ) : (
          /* Horizontal Shelf Cards Carousel with Smooth Mouse-Wheel Support */
          <div
            ref={scrollContainerRef}
            onWheel={handleWheel}
            className="w-full h-full flex items-center gap-3 overflow-x-auto overflow-y-hidden pb-1 pt-0.5 px-0.5 scroll-smooth select-none custom-shelf-scrollbar"
            style={{ scrollbarWidth: 'thin' }}
          >
            {items.map((item) => (
              <ShelfCard
                key={item.id}
                item={item}
                copiedId={copiedId}
                onCopyText={handleCopyText}
                onLaunchFile={handleLaunchFile}
                onRevealInFolder={handleRevealInFolder}
                onCardDragStart={handleCardDragStart}
                onOpenUrl={handleOpenUrl}
                onRemove={removeItem}
                getExtensionColor={getExtensionColor}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

interface ShelfCardProps {
  item: DropItem;
  copiedId: string | null;
  onCopyText: (id: string, text: string) => void;
  onLaunchFile: (path: string) => void;
  onRevealInFolder: (path: string) => void;
  onCardDragStart: (e: React.MouseEvent | React.DragEvent, path: string) => void;
  onOpenUrl: (url: string) => void;
  onRemove: (id: string) => void;
  getExtensionColor: (ext?: string) => string;
}

const ShelfCard: React.FC<ShelfCardProps> = ({
  item,
  copiedId,
  onCopyText,
  onLaunchFile,
  onRevealInFolder,
  onCardDragStart,
  onOpenUrl,
  onRemove,
  getExtensionColor,
}) => {
  const [imgError, setImgError] = useState(false);
  const isDraggable = item.type === 'file' || item.type === 'image';

  return (
    <div
      onMouseDown={(e) => {
        // Hanya picu jika tombol klik kiri dan item merupakan file/image
        if (e.button === 0 && isDraggable) {
          onCardDragStart(e, item.payload);
        }
      }}
      onDragStart={(e) => {
        // Matikan drag bawaan browser HTML5
        e.preventDefault();
      }}
      className={`relative w-[210px] min-w-[210px] h-[92px] shrink-0 rounded-xl bg-[#121215] hover:bg-[#16161a] border border-[#222226] hover:border-[#38383e] p-2 flex flex-col justify-between group transition-all duration-100 ease-out select-none ${
        isDraggable ? 'cursor-grab active:cursor-grabbing hover:border-purple-400/50' : ''
      }`}
      title={
        isDraggable
          ? `${item.title} (Seret ke Explorer atau Desktop untuk menyalin)`
          : undefined
      }
    >
      {/* ✕ Remove Button */}
      <button
        draggable={false}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onRemove(item.id);
          playChimeCue('whisper');
        }}
        className="absolute top-1.5 right-1.5 w-4 h-4 rounded-full bg-[#18181c] hover:bg-rose-500/20 text-zinc-400 hover:text-rose-300 border border-[#2e2e34] hover:border-rose-500/30 flex items-center justify-center transition-all duration-100 ease-out cursor-pointer z-10 active:scale-[0.97]"
        title="Hapus dari shelf"
      >
        <X className="w-2.5 h-2.5 pointer-events-none" />
      </button>

      {/* Card Content based on type */}
      {item.type === 'text' && (
        <>
          <div className="flex items-center gap-1.5 pr-4">
            <FileText className="w-3.5 h-3.5 text-[#c084fc] shrink-0" />
            <span className="text-[10px] font-semibold text-zinc-400 truncate uppercase tracking-wider font-sans">
              Teks
            </span>
            <span className="font-sans text-[9px] text-purple-300/80 tabular-nums ml-auto">
              {item.sizeFormatted}
            </span>
          </div>

          <p className="font-sans text-[11px] text-zinc-200 line-clamp-2 leading-relaxed bg-[#120d1c]/60 p-2 rounded-lg border border-purple-500/20 my-0.5 break-all">
            {item.payload}
          </p>

          <button
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onCopyText(item.id, item.payload)}
            className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-purple-300 hover:text-white bg-purple-950/30 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-400/50 text-[9.5px] font-medium transition-all duration-100 ease-out cursor-pointer active:scale-[0.97]"
          >
            {copiedId === item.id ? (
              <>
                <Check className="w-2.5 h-2.5 text-emerald-400" />
                <span className="text-emerald-300">Tersalin!</span>
              </>
            ) : (
              <>
                <Copy className="w-2.5 h-2.5" />
                <span>Salin Teks</span>
              </>
            )}
          </button>
        </>
      )}

      {item.type === 'file' && (
        <>
          <div className="flex items-center justify-between pr-4">
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                className={`px-1 py-0.2 rounded text-[9px] font-mono font-bold uppercase border shrink-0 ${getExtensionColor(
                  item.extension
                )}`}
              >
                {item.extension || 'FILE'}
              </span>
              <span className="text-[11px] font-medium text-zinc-100 truncate tracking-tight font-sans" title={item.title}>
                {item.title}
              </span>
            </div>

            {/* Mini Reveal in Explorer button */}
            <button
              draggable={false}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRevealInFolder(item.payload);
              }}
              className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#18181c] transition-all duration-100 ease-out ml-1 shrink-0 active:scale-[0.97]"
              title="Tampilkan lokasi berkas di Windows Explorer"
            >
              <Folder className="w-3 h-3 pointer-events-none" />
            </button>
          </div>

          <div className="flex items-center justify-between text-[9.5px] px-0.5">
            <span className="font-sans text-[10px] text-purple-300/80 tabular-nums">
              {item.sizeFormatted}
            </span>
            <div
              className="flex items-center gap-1 text-[10px] text-zinc-500 truncate max-w-[140px]"
              title={item.payload}
            >
              <GripHorizontal className="w-2.5 h-2.5 opacity-40 shrink-0" />
              <span className="truncate">{item.payload}</span>
            </div>
          </div>

          <button
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onLaunchFile(item.payload)}
            className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-purple-300 hover:text-white bg-purple-950/30 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-400/50 text-[9.5px] font-medium transition-all duration-100 ease-out cursor-pointer active:scale-[0.97]"
            title="Buka berkas langsung dengan aplikasi default Windows"
          >
            <FolderOpen className="w-2.5 h-2.5" />
            <span>Buka Berkas</span>
          </button>
        </>
      )}

      {item.type === 'image' && (
        <>
          <div className="flex items-center gap-2 pr-4">
            {/* Clickable Square Thumbnail */}
            <div
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => onLaunchFile(item.payload)}
              className="w-9 h-9 rounded-md bg-[#09090b] border border-purple-500/30 shrink-0 overflow-hidden flex items-center justify-center cursor-pointer hover:border-purple-400/60 hover:scale-105 transition-all"
              title="Klik thumbnail untuk membuka gambar di penampil default"
            >
              {!imgError ? (
                <img
                  draggable={false}
                  src={convertFileSrc(item.payload)}
                  alt={item.title}
                  className="w-full h-full object-cover pointer-events-none"
                  onError={() => setImgError(true)}
                />
              ) : (
                <ImageIcon className="w-4 h-4 text-[#c084fc]" />
              )}
            </div>

            <div className="flex flex-col min-w-0 flex-1">
              <div className="flex items-center justify-between">
                <span className="text-[10.5px] font-medium text-zinc-100 truncate tracking-tight font-sans" title={item.title}>
                  {item.title}
                </span>

                {/* Mini Reveal in Explorer button */}
                <button
                  draggable={false}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRevealInFolder(item.payload);
                  }}
                  className="p-1 rounded text-zinc-400 hover:text-zinc-100 hover:bg-[#18181c] transition-all duration-100 ease-out shrink-0 active:scale-[0.97]"
                  title="Tampilkan lokasi berkas di Windows Explorer"
                >
                  <Folder className="w-2.8 h-2.8 pointer-events-none" />
                </button>
              </div>

              <span className="font-sans text-[10px] text-purple-300/80 tabular-nums mt-0.5">
                {item.sizeFormatted}
              </span>
            </div>
          </div>

          <button
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onLaunchFile(item.payload)}
            className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-purple-300 hover:text-white bg-purple-950/30 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-400/50 text-[9.5px] font-medium transition-all duration-100 ease-out cursor-pointer active:scale-[0.97] mt-1"
            title="Buka gambar di aplikasi penampil foto default Windows"
          >
            <FolderOpen className="w-2.5 h-2.5" />
            <span>Buka Gambar</span>
          </button>
        </>
      )}

      {item.type === 'url' && (
        <>
          <div className="flex items-center gap-1.5 pr-4">
            <Link2 className="w-3.5 h-3.5 text-purple-300 shrink-0" />
            <span className="text-[11px] font-medium text-zinc-100 truncate tracking-tight font-sans" title={item.title}>
              {item.title}
            </span>
          </div>

          <p className="text-[9.5px] text-purple-300/70 font-sans truncate px-0.5" title={item.payload}>
            {item.payload}
          </p>

          <button
            draggable={false}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={() => onOpenUrl(item.payload)}
            className="flex items-center justify-center gap-1 w-full py-0.5 rounded text-purple-300 hover:text-white bg-purple-950/30 hover:bg-purple-900/50 border border-purple-500/30 hover:border-purple-400/50 text-[9.5px] font-medium transition-all duration-100 ease-out cursor-pointer active:scale-[0.97]"
            title="Buka tautan di browser bawaan sistem"
          >
            <ExternalLink className="w-2.5 h-2.5" />
            <span>Buka Tautan</span>
          </button>
        </>
      )}
    </div>
  );
};
