import React, { memo } from 'react';
import { ListMusic, Trash2, X, Search, Music, Pause, Loader2 } from 'lucide-react';
import { NativeTrack } from '../../../services/nativeAudioService';
import { playChimeCue } from '../../../utils/tauriBridge';
import { formatDuration } from './constants';

export interface NativeQueueDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  queue: NativeTrack[];
  currentIndex: number;
  onSelectTrack: (index: number) => void;
  onRemoveTrack: (e: React.MouseEvent, index: number) => void;
  onClearQueue: (e: React.MouseEvent) => void;
  onOpenSearch?: () => void;
  isPlaying?: boolean;
  isResolvingAudio?: boolean;
}

export const NativeQueueDrawer: React.FC<NativeQueueDrawerProps> = memo(({
  isOpen,
  onClose,
  queue,
  currentIndex,
  onSelectTrack,
  onRemoveTrack,
  onClearQueue,
  onOpenSearch,
  isPlaying = false,
  isResolvingAudio = false,
}) => {
  if (!isOpen) return null;

  const handleClose = () => {
    playChimeCue('tap');
    onClose();
  };

  const handleOpenSearch = () => {
    playChimeCue('tap');
    onClose();
    onOpenSearch?.();
  };

  return (
    <div
      data-tauri-drag-region="false"
      className="absolute inset-0 z-40 bg-[#0A0D15]/95 backdrop-blur-xl p-3 flex flex-col justify-between select-none animate-in fade-in duration-200"
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Top Header Row */}
      <div className="flex items-center justify-between shrink-0 border-b border-white/[0.08] pb-1.5">
        <div className="flex items-center gap-2">
          <div className="w-5 h-5 rounded-full bg-sky-500/20 text-sky-300 flex items-center justify-center shrink-0">
            <ListMusic className="w-3 h-3" />
          </div>
          <span className="text-[12px] font-semibold text-white tracking-tight font-urbanist">
            Antrean CASA Native
          </span>
          <span className="text-[10px] font-mono text-sky-400 bg-sky-500/10 border border-sky-400/20 rounded-full px-1.5 py-0.2">
            {queue.length} lagu
          </span>
        </div>

        <div className="flex items-center gap-2">
          {queue.length > 0 && (
            <button
              onClick={onClearQueue}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9.5px] font-medium bg-rose-500/10 hover:bg-rose-500/20 border border-rose-400/20 text-rose-300 hover:text-rose-200 transition-all cursor-pointer active:scale-95"
              title="Kosongkan seluruh antrean"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Kosongkan</span>
            </button>
          )}

          <button
            onClick={handleClose}
            className="w-6 h-6 rounded-full hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
            title="Tutup antrean"
            aria-label="Tutup antrean"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Queue Items List */}
      <div
        data-tauri-drag-region="false"
        onWheel={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 overflow-y-auto mt-1.5 pr-1 space-y-1 cosmic-music-scrollbar"
      >
        {queue.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/30 text-center py-4 gap-1.5">
            <ListMusic className="w-6 h-6 opacity-30 text-sky-300" />
            <p className="text-[11px] font-sans">Antrean lagu masih kosong.</p>
            <button
              onClick={handleOpenSearch}
              className="mt-1 px-2.5 py-1 rounded-full text-[10px] font-medium bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/30 text-sky-200 transition-all cursor-pointer active:scale-95 flex items-center gap-1"
            >
              <Search className="w-3 h-3 text-sky-300" />
              <span>Cari lagu untuk diputar</span>
            </button>
          </div>
        ) : (
          queue.map((track, idx) => {
            const isCurrentTrack = currentIndex === idx;
            return (
              <div
                key={`${track.id}-${idx}`}
                onClick={() => {
                  playChimeCue('tap');
                  onSelectTrack(idx);
                }}
                className={`flex items-center justify-between p-1.5 rounded-lg border transition-all cursor-pointer group active:scale-[0.99] ${
                  isCurrentTrack
                    ? 'bg-sky-500/15 border-sky-400/40 text-white shadow-[0_0_12px_rgba(56,189,248,0.15)]'
                    : 'bg-white/[0.03] hover:bg-white/[0.08] hover:border-sky-400/30 border-white/[0.04]'
                }`}
              >
                {/* Left: Index / Status + Artwork + Info */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1">
                  {/* Index or Live Indicator */}
                  <div className="w-4 flex items-center justify-center shrink-0">
                    {isCurrentTrack ? (
                      isResolvingAudio ? (
                        <Loader2 className="w-3 h-3 text-sky-300 animate-spin" />
                      ) : isPlaying ? (
                        <div className="flex items-end gap-0.5 h-3">
                          <span className="w-0.5 h-3 bg-sky-400 rounded-full animate-pulse" />
                          <span className="w-0.5 h-2 bg-sky-300 rounded-full animate-pulse delay-75" />
                          <span className="w-0.5 h-2.5 bg-sky-400 rounded-full animate-pulse delay-150" />
                        </div>
                      ) : (
                        <Pause className="w-2.5 h-2.5 text-sky-400/70" />
                      )
                    ) : (
                      <span className="text-[10px] font-mono text-white/30 group-hover:text-white/60">
                        {idx + 1}
                      </span>
                    )}
                  </div>

                  {/* Artwork */}
                  <div className="w-8 h-8 rounded-lg bg-[#131722] border border-white/10 overflow-hidden shrink-0 flex items-center justify-center relative aspect-square">
                    {track.albumArt || track.thumbnailUrl ? (
                      <img
                        src={track.albumArt || track.thumbnailUrl}
                        alt={track.title}
                        className="w-full h-full aspect-square object-cover flex-shrink-0"
                        onError={(e) => {
                          (e.currentTarget as HTMLElement).style.display = 'none';
                        }}
                      />
                    ) : (
                      <Music className="w-3.5 h-3.5 text-sky-300/70" />
                    )}
                  </div>

                  {/* Title & Artist */}
                  <div className="flex flex-col min-w-0 flex-1 justify-center">
                    <span
                      className={`text-[11.5px] font-semibold truncate leading-tight font-sans ${
                        isCurrentTrack ? 'text-sky-200' : 'text-white/90 group-hover:text-sky-200'
                      }`}
                    >
                      {track.title}
                    </span>
                    <span className="text-[10px] text-white/40 group-hover:text-white/60 truncate font-sans">
                      {track.artist}
                    </span>
                  </div>
                </div>

                {/* Right: Duration & Delete Action */}
                <div className="flex items-center gap-1.5 ml-2 shrink-0">
                  <span className="text-[10px] font-mono text-white/40 group-hover:text-sky-300/70 tabular-nums">
                    {formatDuration(track.durationSeconds)}
                  </span>
                  <button
                    onClick={(e) => onRemoveTrack(e, idx)}
                    className="w-5 h-5 rounded-md hover:bg-rose-500/20 text-white/40 hover:text-rose-400 flex items-center justify-center transition-all active:scale-95 cursor-pointer ml-1 shrink-0"
                    title="Hapus dari antrean"
                    aria-label="Hapus dari antrean"
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
});

NativeQueueDrawer.displayName = 'NativeQueueDrawer';
