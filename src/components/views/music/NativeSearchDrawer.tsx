import React, { useState, useEffect, useRef, memo } from 'react';
import { Search, X, Loader2, Music, Plus, Check } from 'lucide-react';
import { NativeTrack, searchTracks } from '../../../services/nativeAudioService';
import { playChimeCue } from '../../../utils/tauriBridge';
import { MOCK_NATIVE_SEARCH_TRACKS, formatDuration } from './constants';

export interface NativeSearchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onPlayTrack: (track: NativeTrack, currentList: NativeTrack[]) => void;
  onAddToQueue: (e: React.MouseEvent, track: NativeTrack) => void;
  currentTrackId?: string | null;
  isResolvingAudio?: boolean;
  addedTrackId?: string | null;
}

export const NativeSearchDrawer: React.FC<NativeSearchDrawerProps> = memo(({
  isOpen,
  onClose,
  onPlayTrack,
  onAddToQueue,
  currentTrackId,
  isResolvingAudio = false,
  addedTrackId,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NativeTrack[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto focus input when drawer opens
  useEffect(() => {
    if (isOpen) {
      const timer = setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
      return () => clearTimeout(timer);
    } else {
      setSearchQuery('');
      setSearchResults([]);
      setIsSearching(false);
    }
  }, [isOpen]);

  // Debounced search via InnerTube
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
        console.warn('[NativeSearchDrawer] searchTracks error:', err);
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (!isOpen) return null;

  const displayTracks = searchQuery.trim() ? searchResults : MOCK_NATIVE_SEARCH_TRACKS;

  const handleSelectTrack = (track: NativeTrack) => {
    playChimeCue('tap');
    onPlayTrack(track, displayTracks);
    onClose();
  };

  const handleClose = () => {
    playChimeCue('tap');
    onClose();
  };

  return (
    <div
      data-tauri-drag-region="false"
      className="absolute inset-0 z-40 bg-[#0A0D15]/95 backdrop-blur-xl p-3 flex flex-col justify-between select-none animate-in fade-in duration-200"
      onClick={(e) => e.stopPropagation()}
      onWheel={(e) => e.stopPropagation()}
    >
      {/* Top Search Input Row */}
      <div className="flex items-center gap-2 shrink-0 border-b border-white/[0.08] pb-1.5">
        <div className="flex items-center gap-2 flex-1 bg-white/[0.06] hover:bg-white/[0.09] focus-within:bg-white/[0.1] focus-within:border-sky-400/40 border border-white/10 rounded-lg px-2.5 py-1 transition-all">
          {isSearching ? (
            <Loader2 className="w-3.5 h-3.5 text-sky-400 animate-spin shrink-0" />
          ) : (
            <Search className="w-3.5 h-3.5 text-white/40 shrink-0" />
          )}
          <input
            ref={inputRef}
            type="text"
            data-tauri-drag-region="false"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Ketik judul lagu atau artis..."
            className="w-full bg-transparent text-[11.5px] text-white placeholder-white/40 outline-none font-sans"
            autoFocus
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}
          />
          {searchQuery && (
            <button
              onClick={() => {
                setSearchQuery('');
                setSearchResults([]);
                inputRef.current?.focus();
              }}
              className="w-4 h-4 rounded-full hover:bg-white/10 text-white/40 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
              title="Hapus pencarian"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          )}
        </div>

        <button
          onClick={handleClose}
          className="w-6 h-6 rounded-full hover:bg-white/10 text-white/50 hover:text-white flex items-center justify-center transition-colors cursor-pointer shrink-0"
          title="Tutup pencarian"
          aria-label="Tutup pencarian"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Results / Skeleton List */}
      <div
        data-tauri-drag-region="false"
        onWheel={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 overflow-y-auto mt-1.5 pr-1 space-y-1 cosmic-music-scrollbar"
      >
        <div className="flex items-center justify-between text-[9.5px] font-urbanist text-white/40 px-1 font-medium tracking-wide uppercase">
          <span>
            {searchQuery.trim()
              ? isSearching
                ? 'Mencari lagu online...'
                : `Hasil Pencarian (${searchResults.length})`
              : 'Daftar Lagu (Rekomendasi)'}
          </span>
          {isResolvingAudio && (
            <span className="text-sky-300 font-semibold flex items-center gap-1 animate-pulse">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              RESOLVING STREAM...
            </span>
          )}
        </div>

        {isSearching && searchResults.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-white/40 text-center py-4 gap-1.5">
            <Loader2 className="w-5 h-5 text-sky-400 animate-spin" />
            <span className="text-[11px] font-sans">Mencari lagu di database online...</span>
          </div>
        ) : displayTracks.length > 0 ? (
          displayTracks.map((track) => (
            <div
              key={track.id}
              onClick={() => handleSelectTrack(track)}
              className={`flex items-center justify-between p-1.5 rounded-lg border transition-all cursor-pointer group active:scale-[0.99] ${
                currentTrackId === track.id
                  ? 'bg-sky-500/15 border-sky-400/40 text-white'
                  : 'bg-white/[0.03] hover:bg-white/[0.08] hover:border-sky-400/30 border-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0 flex-1">
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
                <div className="flex flex-col min-w-0 flex-1 justify-center">
                  <span className="text-[11.5px] font-semibold text-white/90 group-hover:text-sky-200 truncate leading-tight font-sans">
                    {track.title}
                  </span>
                  <span className="text-[10px] text-white/40 group-hover:text-white/60 truncate font-sans">
                    {track.artist}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-1.5 ml-2 shrink-0">
                {isResolvingAudio && currentTrackId === track.id && (
                  <Loader2 className="w-3 h-3 text-sky-300 animate-spin" />
                )}
                <span className="text-[10px] font-mono text-white/40 group-hover:text-sky-300/70 tabular-nums">
                  {formatDuration(track.durationSeconds)}
                </span>
                <button
                  onClick={(e) => onAddToQueue(e, track)}
                  className="w-5 h-5 rounded-md hover:bg-white/15 text-white/40 hover:text-sky-300 flex items-center justify-center transition-all active:scale-95 cursor-pointer ml-1 shrink-0"
                  title="Tambah ke Antrean"
                  aria-label="Tambah ke Antrean"
                >
                  {addedTrackId === track.id ? (
                    <Check className="w-3 h-3 text-emerald-400 animate-in zoom-in duration-150" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                </button>
              </div>
            </div>
          ))
        ) : (
          <div className="flex flex-col items-center justify-center h-full text-white/30 text-center py-2">
            <Music className="w-5 h-5 mb-1 opacity-40" />
            <p className="text-[11px] font-sans">Tidak ada hasil untuk "{searchQuery}"</p>
          </div>
        )}
      </div>
    </div>
  );
});

NativeSearchDrawer.displayName = 'NativeSearchDrawer';
