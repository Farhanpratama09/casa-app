import React, { memo } from 'react';
import {
  Play,
  ChevronLeft,
  Heart,
  Library,
  Loader2,
  Search,
  X,
  Plus,
  Check,
  Sparkles,
} from 'lucide-react';
import { SpotifyTrackItem, SpotifyPlaylistItem } from '../../../utils/spotifyService';
import { useQueueStore } from '../../../stores/useQueueStore';

export interface SpotifyPanelsProps {
  activeSubPanel: 'playlist' | 'queue' | 'search';
  isUserConnected: boolean;
  // Playlist props
  playlists: SpotifyPlaylistItem[];
  isLoadingPlaylists?: boolean;
  selectedPlaylist: SpotifyPlaylistItem | null;
  onSelectPlaylist: (playlist: SpotifyPlaylistItem | null) => void;
  playlistTracks: SpotifyTrackItem[];
  isLoadingPlaylistTracks?: boolean;
  likedSongsTotal?: number | null;
  onPlayPlaylistTrack: (track: SpotifyTrackItem) => void;
  onPlayAllInPlaylist: () => void;
  onConnectSpotify: () => void;
  // Queue props
  queueTracks: SpotifyTrackItem[];
  isLoadingQueue?: boolean;
  queueContextTitle?: string;
  onPlayQueueTrack: (track: SpotifyTrackItem, index: number) => void;
  onRemoveQueueTrack?: (index: number) => void;
  // Search props
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchResults: SpotifyTrackItem[];
  isSearching?: boolean;
  addedQueueId?: string | null;
  onPlaySearchTrack: (track: SpotifyTrackItem) => void;
  onAddToQueue: (track: SpotifyTrackItem) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onFocusInput?: () => void;
  setIsSearchFocused?: (focused: boolean) => void;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};

/**
 * 1. SpotifyLibraryView:
 * Compact Liked Songs card with mint glow + tightly packed playlist items (36x36px covers).
 */
export const SpotifyLibraryView: React.FC<{
  isUserConnected: boolean;
  playlists: SpotifyPlaylistItem[];
  isLoadingPlaylists?: boolean;
  selectedPlaylist: SpotifyPlaylistItem | null;
  onSelectPlaylist: (playlist: SpotifyPlaylistItem | null) => void;
  playlistTracks: SpotifyTrackItem[];
  isLoadingPlaylistTracks?: boolean;
  likedSongsTotal?: number | null;
  onPlayPlaylistTrack: (track: SpotifyTrackItem) => void;
  onPlayAllInPlaylist: () => void;
  onConnectSpotify: () => void;
}> = memo(({
  isUserConnected,
  playlists,
  isLoadingPlaylists = false,
  selectedPlaylist,
  onSelectPlaylist,
  playlistTracks,
  isLoadingPlaylistTracks = false,
  likedSongsTotal,
  onPlayPlaylistTrack,
  onPlayAllInPlaylist,
  onConnectSpotify,
}) => {
  if (selectedPlaylist) {
    /* Drill-down Track List */
    return (
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex items-center justify-between mb-1.5 shrink-0 gap-1 border-b border-[#222226] pb-1">
          <button
            onClick={() => onSelectPlaylist(null)}
            className="flex items-center gap-1 font-sans text-[10.5px] font-medium text-zinc-400 hover:text-emerald-300 transition-colors min-w-0 cursor-pointer"
            title="Kembali ke Daftar Playlist"
          >
            <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
            <span className="truncate max-w-[150px]">{selectedPlaylist.name}</span>
          </button>
          <button
            onClick={onPlayAllInPlaylist}
            className="flex items-center gap-1 px-2.5 py-0.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-[#09090b] font-sans font-medium text-[10px] transition-all active:scale-[0.97] shrink-0 cursor-pointer shadow-sm"
            title="Putar Semua Trek"
          >
            <Play className="w-2.5 h-2.5 fill-current" />
            <span>Putar Semua</span>
          </button>
        </div>

        <div
          data-tauri-drag-region="false"
          onWheel={(e) => e.stopPropagation()}
          className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar pointer-events-auto flex flex-col gap-1 pr-1.5 select-none"
        >
          {isLoadingPlaylistTracks ? (
            <div className="flex items-center justify-center py-6 text-zinc-400 gap-1.5">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-400" />
              <span className="font-sans text-[10.5px]">Memuat trek playlist...</span>
            </div>
          ) : playlistTracks.length > 0 ? (
            playlistTracks.map((t) => {
              const durationSec = Math.round(t.durationMs / 1000);
              return (
                <button
                  key={t.id}
                  onClick={() => onPlayPlaylistTrack(t)}
                  className="flex items-center gap-2.5 p-1 rounded-lg hover:bg-[#18181c] text-left transition-colors group shrink-0 cursor-pointer w-full border border-transparent hover:border-[#2e2e34]"
                  title={`Putar ${t.title} - ${t.artist}`}
                >
                  {t.albumArt ? (
                    <img
                      src={t.albumArt}
                      alt=""
                      className="w-7 h-7 rounded-md object-cover shrink-0 pointer-events-none border border-[#222226]"
                    />
                  ) : (
                    <div className="w-7 h-7 rounded-md bg-[#18181c] flex items-center justify-center shrink-0 border border-[#222226]">
                      <Play className="w-2.5 h-2.5 text-zinc-400" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="font-sans text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-300 transition-colors">
                      {t.title}
                    </span>
                    <span className="font-sans text-[10px] text-zinc-400 truncate">
                      {t.artist}
                    </span>
                  </div>
                  <span className="font-sans text-[10.5px] text-zinc-400 tabular-nums shrink-0">
                    {formatTime(durationSec)}
                  </span>
                </button>
              );
            })
          ) : (
            <span className="font-sans text-[10.5px] text-zinc-500 italic text-center py-4">
              Tidak ada trek di playlist ini
            </span>
          )}
        </div>
      </div>
    );
  }

  /* Top-level Playlists & Liked Songs */
  return (
    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
      {isUserConnected ? (
        <div
          data-tauri-drag-region="false"
          onWheel={(e) => e.stopPropagation()}
          className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar pointer-events-auto flex flex-col gap-1.5 pr-1.5 select-none"
        >
          {/* Compact Liked Songs Card with Mint Glow */}
          <button
            onClick={() => {
              onSelectPlaylist({
                id: 'liked-songs',
                name: 'Liked Songs',
                tracksTotal: likedSongsTotal ?? 0,
                uri: 'spotify:user:collection',
              });
            }}
            className="bg-gradient-to-r from-emerald-950/30 via-[#141418] to-[#121215] border border-emerald-500/25 rounded-xl p-2.5 flex items-center gap-3 cursor-pointer hover:border-emerald-500/50 transition-all group shrink-0 w-full text-left"
            title="Buka Koleksi Lagu Disukai"
          >
            <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center shadow-[0_0_10px_rgba(16,185,129,0.35)] shrink-0">
              <Heart className="w-4 h-4 text-emerald-400 fill-emerald-400" />
            </div>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="font-sans text-xs font-semibold text-zinc-100 group-hover:text-emerald-300 transition-colors truncate">
                Liked Songs
              </span>
              <span className="font-sans text-[10px] text-emerald-400/80 tabular-nums truncate">
                {likedSongsTotal !== null ? `${likedSongsTotal} lagu favorit` : 'Koleksi Favorit'}
              </span>
            </div>
          </button>

          {/* User Playlists List (Format Rapat 36x36px Cover) */}
          {playlists.length > 0 ? (
            playlists.map((p) => (
              <button
                key={p.id}
                onClick={() => onSelectPlaylist(p)}
                className="flex items-center gap-2.5 p-1.5 rounded-xl hover:bg-[#18181c] text-left transition-all group shrink-0 cursor-pointer w-full border border-transparent hover:border-[#2e2e34]"
                title={`Buka playlist: ${p.name}`}
              >
                {p.coverArt ? (
                  <img
                    src={p.coverArt}
                    alt=""
                    className="w-9 h-9 rounded-lg object-cover shrink-0 border border-[#222226] pointer-events-none"
                  />
                ) : (
                  <div className="w-9 h-9 rounded-lg bg-[#18181c] border border-[#222226] flex items-center justify-center shrink-0 text-emerald-400/60">
                    <Library className="w-4 h-4" />
                  </div>
                )}
                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-sans font-medium text-xs text-zinc-200 group-hover:text-white truncate">
                    {p.name}
                  </span>
                  <span className="font-sans text-[10px] text-zinc-500 tabular-nums">
                    {p.tracksTotal} trek
                  </span>
                </div>
              </button>
            ))
          ) : (
            !isLoadingPlaylists && (
              <span className="font-sans text-[10.5px] text-zinc-500 italic text-center py-4">
                Belum ada playlist ditemukan
              </span>
            )
          )}
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center flex-1 text-center px-2 py-4">
          <span className="font-sans text-[10.5px] text-zinc-400 mb-2.5 leading-relaxed">
            Hubungkan akun Spotify untuk menjelajahi seluruh koleksi playlist Anda.
          </span>
          <button
            onClick={onConnectSpotify}
            className="px-3.5 py-1 rounded-full bg-emerald-500 hover:bg-emerald-400 text-[#09090b] font-sans font-medium text-xs active:scale-95 transition-all shadow-sm cursor-pointer"
          >
            Hubungkan Spotify
          </button>
        </div>
      )}
    </div>
  );
});

SpotifyLibraryView.displayName = 'SpotifyLibraryView';

/**
 * 2. SpotifyQueueView:
 * Antrean Lagu header + numbered list row (01, 02) + mini cover + duration + micro dismiss on hover.
 */
export const SpotifyQueueView: React.FC<{
  queueTracks: SpotifyTrackItem[];
  isLoadingQueue?: boolean;
  queueContextTitle?: string;
  onPlayQueueTrack: (track: SpotifyTrackItem, index: number) => void;
  onRemoveQueueTrack?: (index: number) => void;
  isUserConnected: boolean;
  onConnectSpotify: () => void;
}> = memo(({
  queueTracks,
  isLoadingQueue = false,
  queueContextTitle,
  onPlayQueueTrack,
  onRemoveQueueTrack,
  isUserConnected,
  onConnectSpotify,
}) => {
  const radioQueue = useQueueStore((s) => s.radioQueue);
  const totalTrek = queueTracks.length + radioQueue.length;

  const handlePlayRadioTrack = (track: any, radioIdx: number) => {
    const spotifyTrack: SpotifyTrackItem = {
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album || '',
      albumArt: track.albumArt || track.thumbnailUrl || '',
      durationMs: track.durationMs || (track.durationSeconds || 180) * 1000,
      uri: track.uri || `spotify:track:${track.id}`,
    };
    onPlayQueueTrack(spotifyTrack, queueTracks.length + radioIdx);
  };

  const handleRemoveRadioTrack = (e: React.MouseEvent, radioIdx: number) => {
    e.stopPropagation();
    useQueueStore.getState().removeFromRadioQueue(radioIdx);
  };

  return (
    <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
      {/* Queue Context Header */}
      <div className="flex items-center justify-between shrink-0 pb-1 mb-1 border-b border-[#222226]">
        <div className="flex items-center gap-2 min-w-0">
          <span className="font-sans text-[11px] font-medium text-emerald-300/90 tracking-wider uppercase">
            Antrean Lagu
          </span>
          {queueContextTitle && (
            <span
              className="font-sans text-[9.5px] font-medium text-zinc-400 bg-zinc-800/60 border border-zinc-700/40 px-2 py-0.5 rounded-full truncate max-w-[130px]"
              title={queueContextTitle}
            >
              {queueContextTitle}
            </span>
          )}
        </div>
        <span className="font-sans text-[9.5px] text-emerald-400/80 font-medium tabular-nums shrink-0">
          {totalTrek} trek
        </span>
      </div>

      <div
        data-tauri-drag-region="false"
        onWheel={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar pointer-events-auto flex flex-col gap-1 pr-1.5 select-none"
      >
        {totalTrek === 0 && isLoadingQueue ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-6">
            <Loader2 className="w-4 h-4 text-emerald-400 animate-spin" />
            <span className="font-sans text-[10.5px] text-zinc-400 font-medium">Memuat antrean...</span>
          </div>
        ) : totalTrek > 0 ? (
          <>
            {/* 1. Antrean Pilihan (Manual Queue / Real Spotify Queue) */}
            {queueTracks.length > 0 && (
              <>
                {radioQueue.length > 0 && (
                  <div className="flex items-center justify-between text-[9px] font-sans font-medium text-emerald-400/80 px-1 py-1 uppercase tracking-wider">
                    <span>Antrean Pilihan</span>
                    <span className="text-[9px] text-zinc-500 tabular-nums font-normal">
                      {queueTracks.length} trek
                    </span>
                  </div>
                )}
                {queueTracks.map((t, idx) => {
                  const durationSec = Math.round(t.durationMs / 1000);
                  return (
                    <div
                      key={`${t.id}-${t.uri}-${idx}`}
                      onClick={() => onPlayQueueTrack(t, idx)}
                      className="flex items-center gap-2 p-1 rounded-lg hover:bg-[#18181c] text-left transition-colors group cursor-pointer w-full shrink-0 border border-transparent hover:border-[#2e2e34]"
                      title={`Putar sekarang: ${t.title} - ${t.artist}`}
                    >
                      {/* Track Index (01, 02) */}
                      <span className="font-sans font-medium text-[10px] text-zinc-500 tabular-nums w-4 text-center shrink-0">
                        {String(idx + 1).padStart(2, '0')}
                      </span>

                      {/* Mini Cover (rounded-md) */}
                      {t.albumArt ? (
                        <img
                          src={t.albumArt}
                          alt=""
                          className="w-6 h-6 rounded-md object-cover shrink-0 pointer-events-none border border-[#222226]"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-md bg-[#18181c] flex items-center justify-center shrink-0 border border-[#222226]">
                          <Play className="w-2 h-2 text-zinc-400" />
                        </div>
                      )}

                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-sans text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-300 transition-colors">
                          {t.title}
                        </span>
                        <span className="font-sans text-[10px] text-zinc-400 truncate">
                          {t.artist}
                        </span>
                      </div>

                      <span className="font-sans text-[10.5px] text-zinc-400 tabular-nums shrink-0 ml-1">
                        {formatTime(durationSec)}
                      </span>

                      {/* Micro Dismiss Cross on Hover */}
                      {onRemoveQueueTrack && (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            useQueueStore.getState().removeFromManualQueue(idx);
                            onRemoveQueueTrack(idx);
                          }}
                          className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-rose-400 hover:bg-rose-500/15 shrink-0 cursor-pointer"
                          title="Hapus dari antrean"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  );
                })}
              </>
            )}

            {/* 2. Alir Radio Kosmik (Radio Queue) */}
            {radioQueue.length > 0 && (
              <>
                <div className="flex items-center justify-between text-[9px] font-sans font-medium text-emerald-400/80 px-1 pt-2 pb-1 uppercase tracking-wider border-t border-[#222226]/80 mt-1.5">
                  <div className="flex items-center gap-1.5">
                    <span>Alir Radio Kosmik</span>
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[8.5px] font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-400/25 shadow-[0_0_8px_rgba(16,185,129,0.2)]">
                      <Sparkles className="w-2.5 h-2.5 text-emerald-300 animate-pulse" />
                      <span>Radio Kosmik</span>
                    </span>
                  </div>
                  <span className="text-[9px] text-zinc-500 tabular-nums font-normal">
                    {radioQueue.length} rekomendasi
                  </span>
                </div>

                {radioQueue.map((t, rIdx) => {
                  const durationSec = t.durationSeconds || Math.round((t.durationMs || 180000) / 1000);
                  return (
                    <div
                      key={`radio-${t.id}-${rIdx}`}
                      onClick={() => handlePlayRadioTrack(t, rIdx)}
                      className="flex items-center gap-2 p-1 rounded-lg hover:bg-[#18181c] text-left transition-colors group cursor-pointer w-full shrink-0 border border-transparent hover:border-emerald-500/30"
                      title={`Putar rekomendasi: ${t.title} - ${t.artist}`}
                    >
                      {/* Radio Sparkle Icon */}
                      <div className="w-4 h-4 flex items-center justify-center shrink-0">
                        <Sparkles className="w-2.5 h-2.5 text-emerald-400/70 group-hover:text-emerald-300 transition-colors" />
                      </div>

                      {/* Mini Cover (rounded-md) */}
                      {t.albumArt || t.thumbnailUrl ? (
                        <img
                          src={t.albumArt || t.thumbnailUrl}
                          alt=""
                          className="w-6 h-6 rounded-md object-cover shrink-0 pointer-events-none border border-[#222226]"
                        />
                      ) : (
                        <div className="w-6 h-6 rounded-md bg-[#18181c] flex items-center justify-center shrink-0 border border-[#222226]">
                          <Play className="w-2 h-2 text-zinc-400" />
                        </div>
                      )}

                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="font-sans text-xs font-medium text-zinc-100 truncate group-hover:text-emerald-300 transition-colors">
                          {t.title}
                        </span>
                        <span className="font-sans text-[10px] text-zinc-400 truncate">
                          {t.artist}
                        </span>
                      </div>

                      <span className="font-sans text-[10.5px] text-zinc-400 tabular-nums shrink-0 ml-1">
                        {formatTime(durationSec)}
                      </span>

                      {/* Micro Dismiss Cross on Hover */}
                      <button
                        onClick={(e) => handleRemoveRadioTrack(e, rIdx)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity w-5 h-5 rounded flex items-center justify-center text-zinc-500 hover:text-rose-400 hover:bg-rose-500/15 shrink-0 cursor-pointer"
                        title="Hapus dari alir radio"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </>
        ) : (
          <div className="flex flex-col gap-1 py-4 text-center">
            <span className="font-sans text-[10.5px] text-zinc-500 italic">
              {isLoadingQueue ? 'Memuat antrean...' : 'Tidak ada trek berikutnya'}
            </span>
          </div>
        )}
      </div>

      {!isUserConnected && (
        <div className="flex items-center justify-between px-2.5 py-1 rounded-lg bg-emerald-950/20 border border-emerald-500/20 mt-1 shrink-0">
          <span className="font-sans text-[9px] text-emerald-300/80 truncate">Sinkronisasi antrean asli Spotify</span>
          <button
            onClick={onConnectSpotify}
            className="px-2.5 py-0.5 rounded-full bg-emerald-500 hover:bg-emerald-400 text-[#09090b] font-sans font-medium text-[9px] active:scale-95 transition-all shrink-0 cursor-pointer"
          >
            Hubungkan
          </button>
        </div>
      )}
    </div>
  );
});

SpotifyQueueView.displayName = 'SpotifyQueueView';

/**
 * 3. SpotifySearchView:
 * Emerald bordered input box, genre discovery tags, and 32x32px search result cards with hover '+' queue action.
 */
export const SpotifySearchView: React.FC<{
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  searchResults: SpotifyTrackItem[];
  isSearching?: boolean;
  addedQueueId?: string | null;
  onPlaySearchTrack: (track: SpotifyTrackItem) => void;
  onAddToQueue: (track: SpotifyTrackItem) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  onFocusInput?: () => void;
  setIsSearchFocused?: (focused: boolean) => void;
}> = memo(({
  searchQuery,
  onSearchQueryChange,
  searchResults,
  isSearching = false,
  addedQueueId = null,
  onPlaySearchTrack,
  onAddToQueue,
  inputRef,
  onFocusInput,
  setIsSearchFocused,
}) => {
  return (
    <div className="relative w-full h-[118px] max-h-[118px] flex flex-col justify-start overflow-hidden select-none">
      {/* Search Input Box */}
      <div
        className="flex items-center gap-2 px-2.5 py-1.5 bg-[#121215] border border-emerald-500/25 rounded-xl shrink-0 focus-within:border-emerald-400/50 transition-colors"
        onClick={(e) => {
          e.stopPropagation();
          onFocusInput?.();
        }}
        onMouseDown={(e) => {
          e.stopPropagation();
          onFocusInput?.();
        }}
      >
        <Search className="w-3 h-3 text-emerald-400 shrink-0" />
        <input
          ref={inputRef}
          type="text"
          data-tauri-drag-region="false"
          value={searchQuery}
          onChange={(e) => onSearchQueryChange(e.target.value)}
          onFocus={() => {
            setIsSearchFocused?.(true);
            onFocusInput?.();
          }}
          onBlur={() => {
            setTimeout(() => {
              setIsSearchFocused?.(false);
            }, 150);
          }}
          onKeyDown={(e) => e.stopPropagation()}
          onKeyUp={(e) => e.stopPropagation()}
          placeholder="Cari lagu, artis, atau album di Spotify..."
          className="w-full bg-transparent font-sans text-xs text-zinc-100 placeholder-zinc-500 focus:outline-none focus:ring-0 select-text pointer-events-auto"
        />
        {isSearching ? (
          <Loader2 className="w-3 h-3 text-emerald-400 animate-spin shrink-0" />
        ) : searchQuery ? (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onSearchQueryChange('');
            }}
            className="text-zinc-400 hover:text-white shrink-0 cursor-pointer"
          >
            <X className="w-3 h-3" />
          </button>
        ) : null}
      </div>

      {/* Dynamic Content: Empty Search vs Active Search Results */}
      {!searchQuery.trim() ? (
        /* Saat Input Kosong: Tampilkan baris tag genre 1 baris flex-nowrap */
        <div className="flex flex-col gap-1.5 pt-2 min-h-0 overflow-hidden">
          <span className="font-sans text-[11px] font-medium text-emerald-300/90 tracking-wider uppercase shrink-0">
            QUICK SEARCH
          </span>
          <div className="flex items-center flex-nowrap overflow-x-auto cosmic-music-scrollbar py-0.5 gap-1.5 shrink-0 select-none">
            {['Lofi', 'Synthwave', 'Focus', 'Chill', 'K-Pop', 'Rock', 'Ambient'].map((tag) => (
              <button
                key={tag}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={() => onSearchQueryChange(tag)}
                className="bg-emerald-950/20 border border-emerald-500/20 text-emerald-300 text-[10px] rounded-lg px-2.5 py-0.5 hover:bg-emerald-900/30 transition-colors cursor-pointer font-sans font-medium shrink-0 whitespace-nowrap"
              >
                {tag}
              </button>
            ))}
          </div>
          <p className="font-sans text-[9.5px] text-zinc-500 leading-snug line-clamp-2 mt-0.5 truncate">
            Ketik judul lagu atau nama artis untuk mencari katalog Spotify langsung dari CASA.
          </p>
        </div>
      ) : (
        /* Saat Input Berisi Teks (Pencarian Berjalan): Sembunyikan tag genre dan alokasikan seluruh ruang 118px untuk daftar hasil lagu */
        <div
          data-tauri-drag-region="false"
          onWheel={(e) => e.stopPropagation()}
          className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar pointer-events-auto flex flex-col gap-1 pr-1.5 mt-1.5 select-none"
        >
          {searchResults.length === 0 && !isSearching ? (
            <span className="font-sans text-[10.5px] text-zinc-500 italic text-center py-4">
              Tidak ada trek ditemukan untuk "{searchQuery}"
            </span>
          ) : (
            searchResults.map((t) => (
              <div
                key={t.id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  onPlaySearchTrack(t);
                }}
                className="flex items-center gap-2.5 p-1 rounded-xl hover:bg-[#18181c] text-left transition-colors group cursor-pointer shrink-0 border border-transparent hover:border-[#2e2e34]"
                title={`Putar ${t.title} - ${t.artist}`}
              >
                {/* Cover 32x32px (rounded-lg) */}
                {t.albumArt ? (
                  <img
                    src={t.albumArt}
                    alt=""
                    className="w-8 h-8 rounded-lg object-cover shrink-0 pointer-events-none border border-[#222226]"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-lg bg-[#18181c] flex items-center justify-center shrink-0 border border-[#222226]">
                    <Play className="w-3 h-3 text-zinc-400" />
                  </div>
                )}

                <div className="flex flex-col min-w-0 flex-1">
                  <span className="font-sans text-xs text-zinc-100 font-medium truncate group-hover:text-emerald-300 transition-colors">
                    {t.title}
                  </span>
                  <span className="font-sans text-[10px] text-zinc-400 truncate">
                    {t.artist}
                  </span>
                </div>

                {/* Tombol '+' tambah ke antrean (muncul saat hover) */}
                <button
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddToQueue(t);
                  }}
                  className={`w-6 h-6 rounded-lg flex items-center justify-center shrink-0 transition-all cursor-pointer ${
                    addedQueueId === t.id
                      ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40 opacity-100'
                      : 'bg-emerald-950/40 hover:bg-emerald-900/60 border border-emerald-500/30 text-emerald-300 hover:text-white opacity-0 group-hover:opacity-100'
                  }`}
                  title="Tambah ke antrean Spotify"
                >
                  {addedQueueId === t.id ? (
                    <Check className="w-3 h-3 text-emerald-400" />
                  ) : (
                    <Plus className="w-3 h-3" />
                  )}
                </button>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
});

SpotifySearchView.displayName = 'SpotifySearchView';

/**
 * SpotifyPanels Master Container:
 * Renders the active sub-panel based on activeSubPanel.
 */
export const SpotifyPanels: React.FC<SpotifyPanelsProps> = memo(({
  activeSubPanel,
  isUserConnected,
  playlists,
  isLoadingPlaylists = false,
  selectedPlaylist,
  onSelectPlaylist,
  playlistTracks,
  isLoadingPlaylistTracks = false,
  likedSongsTotal,
  onPlayPlaylistTrack,
  onPlayAllInPlaylist,
  onConnectSpotify,
  queueTracks,
  isLoadingQueue = false,
  queueContextTitle,
  onPlayQueueTrack,
  onRemoveQueueTrack,
  searchQuery,
  onSearchQueryChange,
  searchResults,
  isSearching = false,
  addedQueueId = null,
  onPlaySearchTrack,
  onAddToQueue,
  inputRef,
  onFocusInput,
  setIsSearchFocused,
}) => {
  if (activeSubPanel === 'playlist') {
    return (
      <SpotifyLibraryView
        isUserConnected={isUserConnected}
        playlists={playlists}
        isLoadingPlaylists={isLoadingPlaylists}
        selectedPlaylist={selectedPlaylist}
        onSelectPlaylist={onSelectPlaylist}
        playlistTracks={playlistTracks}
        isLoadingPlaylistTracks={isLoadingPlaylistTracks}
        likedSongsTotal={likedSongsTotal}
        onPlayPlaylistTrack={onPlayPlaylistTrack}
        onPlayAllInPlaylist={onPlayAllInPlaylist}
        onConnectSpotify={onConnectSpotify}
      />
    );
  }

  if (activeSubPanel === 'queue') {
    return (
      <SpotifyQueueView
        queueTracks={queueTracks}
        isLoadingQueue={isLoadingQueue}
        queueContextTitle={queueContextTitle}
        onPlayQueueTrack={onPlayQueueTrack}
        onRemoveQueueTrack={onRemoveQueueTrack}
        isUserConnected={isUserConnected}
        onConnectSpotify={onConnectSpotify}
      />
    );
  }

  if (activeSubPanel === 'search') {
    return (
      <SpotifySearchView
        searchQuery={searchQuery}
        onSearchQueryChange={onSearchQueryChange}
        searchResults={searchResults}
        isSearching={isSearching}
        addedQueueId={addedQueueId}
        onPlaySearchTrack={onPlaySearchTrack}
        onAddToQueue={onAddToQueue}
        inputRef={inputRef}
        onFocusInput={onFocusInput}
        setIsSearchFocused={setIsSearchFocused}
      />
    );
  }

  return null;
});

SpotifyPanels.displayName = 'SpotifyPanels';
