import React, { useState, useEffect, useRef, memo } from 'react';
import {
  Search,
  FolderOpen,
  Music,
  ListMusic,
  Play,
  Pause,
  Plus,
  Check,
  Loader2,
  X,
  Sparkles,
} from 'lucide-react';
import { NativeTrack, searchTracks } from '../../../../services/nativeAudioService';
import { playChimeCue } from '../../../../utils/tauriBridge';
import { formatDuration, MOCK_NATIVE_SEARCH_TRACKS } from '../constants';
import { useQueueStore } from '../../../../stores/useQueueStore';

// ============================================================================
// 1. Native Queue Panel (Replaces Spotify Queue in Native Mode)
// ============================================================================

export interface NativeQueuePanelProps {
  currentTrack?: NativeTrack | null;
  queue: NativeTrack[];
  currentIndex: number;
  isPlaying: boolean;
  onSelectTrack: (index: number) => void;
  onRemoveTrack?: (e: React.MouseEvent, index: number) => void;
  onClearQueue?: (e: React.MouseEvent) => void;
  onOpenSearch?: () => void;
  onOpenLocalFile?: () => void;
  onPlayTrackDirect?: (track: NativeTrack) => void;
}

export const NativeQueuePanel: React.FC<NativeQueuePanelProps> = memo(({
  currentTrack: propCurrentTrack,
  queue,
  currentIndex,
  isPlaying,
  onSelectTrack,
  onRemoveTrack,
  onClearQueue,
  onOpenSearch,
  onOpenLocalFile,
  onPlayTrackDirect,
}) => {
  const storeCurrentTrack = useQueueStore((s) => s.currentTrack) as unknown as NativeTrack | null;
  const storeManualQueue = useQueueStore((s) => s.manualQueue) as unknown as NativeTrack[];
  const storeRadioQueue = useQueueStore((s) => s.radioQueue) as unknown as NativeTrack[];

  const effectiveCurrentTrack = propCurrentTrack || storeCurrentTrack;

  const isMatching = (a?: NativeTrack | null, b?: NativeTrack | null): boolean => {
    if (!a || !b) return false;
    if (a.id && b.id && a.id === b.id) return true;
    const aTitle = (a.title || '').toLowerCase().trim();
    const bTitle = (b.title || '').toLowerCase().trim();
    const aArtist = (a.artist || '').toLowerCase().trim();
    const bArtist = (b.artist || '').toLowerCase().trim();
    return aTitle === bTitle && (aArtist === bArtist || !aArtist || !bArtist);
  };

  // Raw items from store or props
  const rawManual =
    storeManualQueue.length > 0
      ? storeManualQueue
      : queue.filter((t) => !(t as any).isRadio);

  const rawRadio =
    storeRadioQueue.length > 0
      ? storeRadioQueue
      : queue.filter((t) => (t as any).isRadio);

  // Filter out the currently playing track from upcoming queue so it is not listed twice
  const manualItems = rawManual.filter((t) => !isMatching(t, effectiveCurrentTrack));
  const radioItems = rawRadio.filter((t) => !isMatching(t, effectiveCurrentTrack));

  const totalUpcoming = manualItems.length + radioItems.length;

  const handleSelectRadioItem = (track: NativeTrack, radioIdx: number) => {
    playChimeCue('tap');
    if (onPlayTrackDirect) {
      onPlayTrackDirect(track);
    } else {
      onSelectTrack(manualItems.length + radioIdx);
    }
  };

  const handleRemoveRadioItem = (e: React.MouseEvent, radioIdx: number) => {
    e.stopPropagation();
    playChimeCue('tap');
    useQueueStore.getState().removeFromRadioQueue(radioIdx);
  };

  return (
    <div
      data-tauri-drag-region="false"
      className="flex-1 min-h-0 flex flex-col justify-between select-none"
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Header bar: Track count & Clear action */}
      <div className="flex items-center justify-between shrink-0 pb-1 mb-1 border-b border-[#222226]/60">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="font-sans font-medium text-[10.5px] text-zinc-300 tracking-tight">
            Antrean
          </span>
          <span className="font-sans font-medium text-[10px] tracking-tight text-cyan-300 bg-cyan-950/40 border border-cyan-500/30 px-2 py-0.5 rounded-full tabular-nums">
            {totalUpcoming} lagu
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {totalUpcoming > 0 && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                useQueueStore.getState().clearAllQueues();
                onClearQueue?.(e);
              }}
              className="flex items-center gap-1 font-sans font-medium text-[10.5px] text-rose-300 hover:text-rose-200 bg-rose-950/25 hover:bg-rose-900/40 border border-rose-500/30 px-2 py-0.5 rounded-lg transition-all active:scale-[0.97] cursor-pointer"
              title="Kosongkan daftar lagu tunggu"
            >
              <X className="w-3 h-3 text-rose-400 shrink-0" />
              <span>Kosongkan</span>
            </button>
          )}

          {onOpenLocalFile && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                onOpenLocalFile();
              }}
              className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-cyan-300 active:scale-[0.97] transition-all duration-100 ease-out cursor-pointer"
              title="Buka Berkas Audio Lokal (.mp3, .flac, .wav)"
            >
              <FolderOpen className="w-2.5 h-2.5 text-cyan-400" />
              <span>+ Berkas</span>
            </button>
          )}
        </div>
      </div>

      {/* Queue items or Empty state */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1 cosmic-native-scrollbar">
        {!effectiveCurrentTrack && totalUpcoming === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-4 px-2">
            <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 mb-2">
              <ListMusic className="w-4 h-4 opacity-70" />
            </div>
            <p className="text-[11px] font-sans font-medium text-zinc-300">
              Antrean lagu masih kosong
            </p>
            <p className="text-[9.5px] font-sans text-zinc-500 mt-0.5 max-w-[210px]">
              Cari lagu online via InnerTube atau buka berkas audio lokal
            </p>
            <div className="flex items-center gap-2 mt-2.5">
              {onOpenSearch && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onOpenSearch();
                  }}
                  className="flex items-center gap-1.5 px-3 py-1 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-400/30 text-cyan-300 text-[10px] font-medium transition-all active:scale-[0.97] cursor-pointer shadow-sm"
                >
                  <Search className="w-3 h-3" />
                  <span>Cari Musik Online</span>
                </button>
              )}
              {onOpenLocalFile && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onOpenLocalFile();
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-zinc-200 text-[10px] font-medium transition-all active:scale-[0.97] cursor-pointer"
                >
                  <FolderOpen className="w-3 h-3 text-cyan-400" />
                  <span>Berkas</span>
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* 1. KONTEN KHUSUS: SEDANG BERPUTAR (NOW PLAYING) */}
            {effectiveCurrentTrack && (
              <div className="shrink-0">
                <div className="flex items-center justify-between text-[9px] font-sans font-medium text-cyan-400/90 px-1 py-1 uppercase tracking-wider">
                  <div className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                    <span>Sedang Berputar</span>
                  </div>
                  <span className="text-[8.5px] font-medium text-cyan-300/80 bg-cyan-950/40 border border-cyan-500/25 px-1.5 py-0.2 rounded">
                    Aktif
                  </span>
                </div>
                <div className="flex items-center justify-between p-1.5 rounded-lg border border-cyan-500/40 bg-cyan-500/15 text-zinc-100 shadow-[0_0_12px_rgba(34,211,238,0.18)]">
                  <div className="flex items-center gap-2 min-w-0 flex-1 mr-1.5">
                    {/* Equalizer Animasi Cyan */}
                    <div className="w-4 h-4 flex items-center justify-center shrink-0">
                      {isPlaying ? (
                        <div className="flex items-end gap-[1.5px] h-3">
                          <span className="w-[2px] h-3 bg-cyan-400 animate-pulse rounded-full" />
                          <span className="w-[2px] h-2 bg-cyan-400 animate-pulse delay-75 rounded-full" />
                          <span className="w-[2px] h-3.5 bg-cyan-400 animate-pulse delay-150 rounded-full" />
                        </div>
                      ) : (
                        <Pause className="w-3 h-3 text-cyan-400 shrink-0" />
                      )}
                    </div>

                    {/* Miniature Cover Thumbnail */}
                    {(effectiveCurrentTrack.albumArt || effectiveCurrentTrack.thumbnailUrl) && (
                      <img
                        src={effectiveCurrentTrack.albumArt || effectiveCurrentTrack.thumbnailUrl}
                        alt=""
                        className="w-6 h-6 rounded-md object-cover shrink-0 pointer-events-none border border-cyan-500/30"
                      />
                    )}

                    {/* Title & Artist */}
                    <div className="flex flex-col min-w-0 flex-1">
                      <span
                        className="text-[11px] font-sans font-semibold text-cyan-100 truncate leading-tight"
                        title={effectiveCurrentTrack.title}
                      >
                        {effectiveCurrentTrack.title}
                      </span>
                      <span
                        className="text-[9.5px] font-sans text-cyan-300/80 truncate leading-tight mt-0.5"
                        title={effectiveCurrentTrack.artist}
                      >
                        {effectiveCurrentTrack.artist}
                      </span>
                    </div>
                  </div>

                  {/* Duration */}
                  {effectiveCurrentTrack.durationSeconds > 0 && (
                    <span className="text-[9.5px] font-mono tabular-nums text-cyan-300/80 shrink-0">
                      {formatDuration(effectiveCurrentTrack.durationSeconds)}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* 2. BERIKUTNYA DALAM ANTREAN (UPCOMING TRACKS) */}
            {totalUpcoming > 0 ? (
              <div className="space-y-1.5 pt-0.5">
                <div className="flex items-center justify-between text-[9px] font-sans font-medium text-zinc-400 px-1 py-1 uppercase tracking-wider border-t border-[#222226]/80">
                  <span>Berikutnya dalam Antrean</span>
                  <span className="text-[9px] text-zinc-500 tabular-nums font-normal">
                    {totalUpcoming} trek
                  </span>
                </div>

                {/* 2a. Antrean Pilihan (Manual Queue) */}
                {manualItems.length > 0 && (
                  <div className="space-y-1">
                    {radioItems.length > 0 && (
                      <div className="flex items-center justify-between text-[8.5px] font-sans font-medium text-cyan-400/70 px-1 py-0.5 uppercase tracking-wider">
                        <span>Antrean Pilihan</span>
                        <span className="text-[8.5px] text-zinc-500 tabular-nums font-normal">
                          {manualItems.length} lagu
                        </span>
                      </div>
                    )}
                    {manualItems.map((track, idx) => {
                      return (
                        <div
                          key={track.id || `${track.title}-${idx}`}
                          onClick={() => {
                            playChimeCue('tap');
                            if (onPlayTrackDirect) {
                              onPlayTrackDirect(track);
                            } else {
                              onSelectTrack(idx);
                            }
                          }}
                          className="group flex items-center justify-between p-1.5 rounded-lg border border-[#222226] bg-[#141417]/80 hover:bg-[#1a1a20] hover:border-cyan-500/25 text-zinc-400 hover:text-zinc-200 transition-all duration-100 cursor-pointer"
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1 mr-1.5">
                            {/* Track Index */}
                            <div className="w-4 h-4 flex items-center justify-center shrink-0">
                              <span className="font-sans text-[10.5px] font-medium text-zinc-500 group-hover:text-zinc-300 tabular-nums">
                                {String(idx + 1).padStart(2, '0')}
                              </span>
                            </div>

                            {/* Track Info */}
                            <div className="flex flex-col min-w-0 flex-1">
                              <span
                                className="text-[11px] font-sans font-medium text-zinc-200 group-hover:text-cyan-200 truncate leading-tight transition-colors"
                                title={track.title}
                              >
                                {track.title}
                              </span>
                              <span
                                className="text-[9.5px] font-sans text-zinc-500 truncate leading-tight mt-0.5"
                                title={track.artist}
                              >
                                {track.artist}
                              </span>
                            </div>
                          </div>

                          {/* Duration & Remove Action */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {track.durationSeconds > 0 && (
                              <span className="text-[9.5px] font-mono tabular-nums text-zinc-500">
                                {formatDuration(track.durationSeconds)}
                              </span>
                            )}
                            {onRemoveTrack && (
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  playChimeCue('tap');
                                  useQueueStore.getState().removeFromManualQueue(idx);
                                  onRemoveTrack(e, idx);
                                }}
                                className="w-4 h-4 rounded flex items-center justify-center text-zinc-600 hover:text-rose-400 hover:bg-rose-950/20 transition-colors opacity-0 group-hover:opacity-100"
                                title="Hapus dari antrean"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {/* 2b. Alir Radio Kosmik (Radio Queue with Micro Stardust Badge) */}
                {radioItems.length > 0 && (
                  <div className="space-y-1 pt-1">
                    <div className="flex items-center justify-between text-[8.5px] font-sans font-medium text-cyan-400/80 px-1 py-0.5 uppercase tracking-wider border-t border-[#222226]/50 mt-1">
                      <div className="flex items-center gap-1.5">
                        <span>Alir Radio Kosmik</span>
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8.5px] font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-400/25 shadow-[0_0_8px_rgba(34,211,238,0.2)]">
                          <Sparkles className="w-2.5 h-2.5 text-cyan-300 animate-pulse" />
                          <span>Radio Kosmik</span>
                        </span>
                      </div>
                      <span className="text-[8.5px] text-zinc-500 tabular-nums font-normal">
                        {radioItems.length} rekomendasi
                      </span>
                    </div>

                    {radioItems.map((track, rIdx) => {
                      return (
                        <div
                          key={track.id || `radio-${track.title}-${rIdx}`}
                          onClick={() => handleSelectRadioItem(track, rIdx)}
                          className="group flex items-center justify-between p-1.5 rounded-lg border border-[#222226]/70 bg-[#121215]/70 hover:bg-[#181820] hover:border-cyan-500/30 text-zinc-400 hover:text-zinc-200 transition-all duration-100 cursor-pointer"
                          title={`Putar rekomendasi: ${track.title} - ${track.artist}`}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1 mr-1.5">
                            {/* Radio Icon */}
                            <div className="w-4 h-4 flex items-center justify-center shrink-0">
                              <Sparkles className="w-2.5 h-2.5 text-cyan-400/70 group-hover:text-cyan-300 transition-colors" />
                            </div>

                            {/* Track Info */}
                            <div className="flex flex-col min-w-0 flex-1">
                              <span
                                className="text-[11px] font-sans font-medium truncate leading-tight text-zinc-200 group-hover:text-cyan-200 transition-colors"
                                title={track.title}
                              >
                                {track.title}
                              </span>
                              <span
                                className="text-[9.5px] font-sans text-zinc-500 truncate leading-tight mt-0.5"
                                title={track.artist}
                              >
                                {track.artist}
                              </span>
                            </div>
                          </div>

                          {/* Duration & Remove Action */}
                          <div className="flex items-center gap-1.5 shrink-0">
                            {track.durationSeconds > 0 && (
                              <span className="text-[9.5px] font-mono tabular-nums text-zinc-500">
                                {formatDuration(track.durationSeconds)}
                              </span>
                            )}
                            <button
                              onClick={(e) => handleRemoveRadioItem(e, rIdx)}
                              className="w-4 h-4 rounded flex items-center justify-center text-zinc-600 hover:text-rose-400 hover:bg-rose-950/20 transition-colors opacity-0 group-hover:opacity-100"
                              title="Hapus dari alir radio"
                            >
                              <X className="w-2.5 h-2.5" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-4 text-center border-t border-[#222226]/60 mt-1.5">
                <span className="text-[10px] text-zinc-400 font-sans font-medium">
                  Antrean berikutnya kosong
                </span>
                <span className="text-[9px] text-zinc-500 font-sans mt-0.5 max-w-[200px]">
                  Lagu aktif tetap berjalan normal. Tambahkan lagu lewat pencarian online atau buka berkas.
                </span>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
});

NativeQueuePanel.displayName = 'NativeQueuePanel';

// ============================================================================
// 2. Native Online Search Panel (InnerTube Resolver + Luminescent Cyan)
// ============================================================================

export interface NativeSearchPanelProps {
  onPlayTrack: (track: NativeTrack, currentList: NativeTrack[]) => void;
  onAddToQueue: (e: React.MouseEvent, track: NativeTrack) => void;
  currentTrackId?: string | null;
  addedTrackId?: string | null;
  isResolvingAudio?: boolean;
  onOpenLocalFile?: () => void;
  onFilesDropped?: (files: FileList) => void;
}

export const NativeSearchPanel: React.FC<NativeSearchPanelProps> = memo(({
  onPlayTrack,
  onAddToQueue,
  currentTrackId,
  addedTrackId,
  isResolvingAudio = false,
  onOpenLocalFile,
  onFilesDropped,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NativeTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Debounced search via Rust InnerTube resolver
  useEffect(() => {
    const q = searchQuery.trim();
    if (!q) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);
    const timer = setTimeout(async () => {
      try {
        const results = await searchTracks(q);
        setSearchResults(results);
      } catch (err) {
        console.warn('[NativeSearchPanel] searchTracks error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  const displayTracks = searchQuery.trim() ? searchResults : MOCK_NATIVE_SEARCH_TRACKS;

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      onFilesDropped?.(e.dataTransfer.files);
    }
  };

  return (
    <div
      data-tauri-drag-region="false"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      className="flex-1 min-h-0 flex flex-col justify-between select-none"
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Top Search Input & Action Row */}
      <div className="flex items-center gap-1.5 shrink-0 pb-1.5 mb-1 border-b border-[#222226]">
        {/* Luminescent Cyan Search Input Box */}
        <div className="flex items-center gap-2 flex-1 bg-[#121215] border border-cyan-500/30 text-cyan-100 focus-within:border-cyan-400/60 rounded-xl px-3 py-1.5 text-xs w-full transition-all shadow-sm">
          {isSearching ? (
            <Loader2 className="w-3.5 h-3.5 text-cyan-400 animate-spin shrink-0" />
          ) : (
            <Search className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            data-tauri-drag-region="false"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ketik judul lagu atau artis..."
            className="w-full bg-transparent text-xs text-cyan-100 placeholder-zinc-500 outline-none font-sans"
            onKeyDown={(e) => e.stopPropagation()}
            autoFocus
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
                inputRef.current?.focus();
              }}
              className="w-3.5 h-3.5 rounded-full hover:bg-white/10 text-zinc-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
              title="Hapus pencarian"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        {/* Secondary Action: Buka Berkas Lokal */}
        {onOpenLocalFile && (
          <button
            onClick={() => {
              playChimeCue('tap');
              onOpenLocalFile();
            }}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-400 hover:text-cyan-300 text-[9.5px] font-sans font-medium transition-all active:scale-[0.97] cursor-pointer shrink-0"
            title="Buka Berkas Audio Lokal (.mp3, .flac, .wav)"
          >
            <FolderOpen className="w-3 h-3 text-cyan-400" />
            <span>Berkas</span>
          </button>
        )}
      </div>

      {/* Results Header Label */}
      <div className="flex items-center justify-between text-[9px] font-sans text-zinc-500 px-1 mb-1 font-medium tracking-wide uppercase shrink-0">
        <span>
          {searchQuery.trim()
            ? isSearching
              ? 'Mencari lagu online...'
              : `Hasil Pencarian (${searchResults.length})`
            : 'Pencarian Musik InnerTube'}
        </span>
        {isResolvingAudio && (
          <span className="text-cyan-400 font-semibold flex items-center gap-1 animate-pulse">
            <Loader2 className="w-2 h-2 animate-spin" />
            RESOLVING STREAM...
          </span>
        )}
      </div>

      {/* Results / Track List */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-1 pr-1 cosmic-native-scrollbar">
        {!searchQuery.trim() ? (
          <div className="flex flex-col items-center justify-center h-full text-center py-4 px-2">
            <div className="w-8 h-8 rounded-full bg-cyan-500/10 border border-cyan-500/25 flex items-center justify-center text-cyan-400 mb-2 shadow-[0_0_12px_rgba(34,211,238,0.15)]">
              <Search className="w-4 h-4 opacity-80" />
            </div>
            <h5 className="font-sans font-medium text-[11.5px] text-zinc-200 tracking-tight leading-snug">
              Pencarian Musik Online
            </h5>
            <p className="font-sans text-[9.5px] text-zinc-400 leading-normal mt-0.5 max-w-[260px]">
              Ketik judul lagu atau nama artis di atas untuk memutar streaming langsung via InnerTube
            </p>

            {/* Quick Suggestions Chips */}
            <div className="flex items-center gap-1.5 mt-3 flex-wrap justify-center max-w-[280px]">
              {['NewJeans', 'BABYMONSTER', 'YOASOBI', 'aespa', 'Lofi Beats'].map((tag) => (
                <button
                  key={tag}
                  onClick={() => setSearchQuery(tag)}
                  className="px-2 py-0.5 rounded-full text-[9px] font-medium bg-[#18181c] hover:bg-cyan-950/40 border border-[#2e2e34] hover:border-cyan-500/40 text-zinc-400 hover:text-cyan-300 transition-colors cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        ) : isSearching && searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center py-4 gap-1.5">
            <Loader2 className="w-5 h-5 text-cyan-400 animate-spin" />
            <span className="text-[10.5px] font-sans text-zinc-400">
              Mencari musik online via InnerTube...
            </span>
          </div>
        ) : searchResults.length > 0 ? (
          searchResults.map((track) => {
            const isCurrent = currentTrackId === track.id;
            return (
              <div
                key={track.id}
                onClick={() => {
                  playChimeCue('tap');
                  onPlayTrack(track, searchResults);
                }}
                className={`group flex items-center justify-between p-1.5 rounded-lg border transition-all duration-100 cursor-pointer active:scale-[0.99] ${
                  isCurrent
                    ? 'bg-cyan-500/15 border-cyan-500/30 text-zinc-100 shadow-[0_0_8px_rgba(34,211,238,0.2)]'
                    : 'bg-[#141417]/80 hover:bg-[#1a1a20] hover:border-cyan-500/30 border-[#222226] text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {/* Left: Thumbnail & Metadata */}
                <div className="flex items-center gap-2.5 min-w-0 flex-1 mr-1.5">
                  <div className="w-8 h-8 rounded-lg bg-[#09090b] border border-[#222226] overflow-hidden shrink-0 flex items-center justify-center relative aspect-square">
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
                      <Music className="w-3.5 h-3.5 text-cyan-400/70" />
                    )}
                  </div>

                  <div className="flex flex-col min-w-0 flex-1 justify-center">
                    <span
                      className={`text-[11.5px] font-sans font-medium truncate leading-tight ${
                        isCurrent ? 'text-cyan-200 font-semibold' : 'text-zinc-100 group-hover:text-cyan-200'
                      }`}
                      title={track.title}
                    >
                      {track.title}
                    </span>
                    <span
                      className="text-[9.5px] font-sans text-zinc-400 group-hover:text-zinc-300 truncate leading-tight mt-0.5"
                      title={track.artist}
                    >
                      {track.artist}
                    </span>
                  </div>
                </div>

                {/* Right: Resolving state, Duration & Add to Queue */}
                <div className="flex items-center gap-1.5 shrink-0">
                  {isResolvingAudio && isCurrent && (
                    <Loader2 className="w-3 h-3 text-cyan-400 animate-spin shrink-0" />
                  )}
                  {track.durationSeconds > 0 && (
                    <span className="text-[9.5px] font-mono tabular-nums text-zinc-500 group-hover:text-cyan-400/80">
                      {formatDuration(track.durationSeconds)}
                    </span>
                  )}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      onAddToQueue(e, track);
                    }}
                    className="w-5 h-5 rounded-md hover:bg-cyan-500/20 text-zinc-500 hover:text-cyan-300 flex items-center justify-center transition-all active:scale-95 cursor-pointer ml-0.5 shrink-0"
                    title="Tambah ke Antrean"
                    aria-label="Tambah ke Antrean"
                  >
                    {addedTrackId === track.id ? (
                      <Check className="w-3 h-3 text-cyan-400 animate-in zoom-in duration-150" />
                    ) : (
                      <Plus className="w-3 h-3 text-cyan-400/80" />
                    )}
                  </button>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-zinc-500 text-center py-4">
            <Music className="w-5 h-5 mb-1 opacity-40 text-cyan-400" />
            <p className="text-[11px] font-sans text-zinc-400">
              Tidak ada hasil untuk "{searchQuery}"
            </p>
          </div>
        )}
      </div>
    </div>
  );
});

NativeSearchPanel.displayName = 'NativeSearchPanel';
