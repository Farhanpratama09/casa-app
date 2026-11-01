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
} from 'lucide-react';
import { SpotifyTrackItem, SpotifyPlaylistItem } from '../../../utils/spotifyService';

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
  onPlayQueueTrack: (track: SpotifyTrackItem, index: number) => void;
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
  onPlayQueueTrack,
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
  // 1. Playlists & Liked Songs Drill-down
  if (activeSubPanel === 'playlist') {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
        {selectedPlaylist ? (
          /* Drill-down Track List */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            <div className="flex items-center justify-between mb-1 shrink-0 gap-1 border-b border-white/[0.06] pb-1">
              <button
                onClick={() => onSelectPlaylist(null)}
                className="flex items-center gap-0.5 text-[9.5px] font-medium text-white/70 hover:text-white transition-colors min-w-0 cursor-pointer"
                title="Back to Playlists"
              >
                <ChevronLeft className="w-3 h-3 shrink-0" />
                <span className="truncate max-w-[140px]">{selectedPlaylist.name}</span>
              </button>
              <button
                onClick={onPlayAllInPlaylist}
                className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-white text-black text-[9px] font-semibold hover:bg-white/90 active:scale-95 transition-all shadow-sm shrink-0 cursor-pointer"
                title="Play All"
              >
                <Play className="w-2.5 h-2.5 fill-current" />
                <span>Play All</span>
              </button>
            </div>

            <div
              data-tauri-drag-region="false"
              onWheel={(e) => e.stopPropagation()}
              className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-sky-400/30 hover:[&::-webkit-scrollbar-thumb]:bg-sky-400/60 [&::-webkit-scrollbar-thumb]:rounded-full pointer-events-auto flex flex-col gap-1 pr-2 select-none"
            >
              {isLoadingPlaylistTracks ? (
                <div className="flex items-center justify-center py-4 text-white/50">
                  <Loader2 className="w-3 h-3 animate-spin mr-1.5" />
                  <span className="text-[9.5px]">Loading tracks...</span>
                </div>
              ) : playlistTracks.length > 0 ? (
                playlistTracks.map((t) => {
                  const durationSec = Math.round(t.durationMs / 1000);
                  return (
                    <button
                      key={t.id}
                      onClick={() => onPlayPlaylistTrack(t)}
                      className="flex items-center gap-2 p-1 rounded-[5px] hover:bg-white/10 text-left transition-colors group shrink-0 cursor-pointer"
                      title={`Play ${t.title} - ${t.artist}`}
                    >
                      {t.albumArt ? (
                        <img
                          src={t.albumArt}
                          alt=""
                          className="w-5 h-5 rounded-[3px] object-cover shrink-0 pointer-events-none"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-[3px] bg-white/10 flex items-center justify-center shrink-0">
                          <Play className="w-2 h-2 text-white/60" />
                        </div>
                      )}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[10px] font-medium text-white truncate group-hover:text-white">
                          {t.title}
                        </span>
                        <span className="text-[8.5px] text-island-secondary truncate">
                          {t.artist}
                        </span>
                      </div>
                      <span className="text-[8.5px] text-white/40 tabular-nums shrink-0">
                        {formatTime(durationSec)}
                      </span>
                    </button>
                  );
                })
              ) : (
                <span className="text-[10px] text-white/30 italic text-center py-2">
                  No tracks found
                </span>
              )}
            </div>
          </div>
        ) : (
          /* Top-level Playlists & Liked Songs */
          <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
            {isUserConnected ? (
              <div
                data-tauri-drag-region="false"
                onWheel={(e) => e.stopPropagation()}
                className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-sky-400/30 hover:[&::-webkit-scrollbar-thumb]:bg-sky-400/60 [&::-webkit-scrollbar-thumb]:rounded-full pointer-events-auto flex flex-col gap-1 pr-2 select-none"
              >
                {/* Pinned Liked Songs Collection */}
                <button
                  onClick={() => {
                    onSelectPlaylist({
                      id: 'liked-songs',
                      name: 'Liked Songs',
                      tracksTotal: likedSongsTotal ?? 0,
                      uri: 'spotify:user:collection',
                    });
                  }}
                  className="flex items-center gap-2 p-1.5 rounded-[6px] bg-white/[0.04] hover:bg-white/10 border border-[#98BBD6]/20 text-left transition-colors group shrink-0 cursor-pointer"
                  title="Browse Liked Songs"
                >
                  <div className="w-5 h-5 rounded-[4px] bg-gradient-to-br from-[#5A8BA8] to-[#1E3A4C] flex items-center justify-center shrink-0 shadow-sm">
                    <Heart className="w-3 h-3 text-white fill-white" />
                  </div>
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[10px] font-medium text-white truncate group-hover:text-white">
                      Liked Songs
                    </span>
                    <span className="text-[8.5px] text-[#98BBD6]/80 truncate tabular-nums">
                      {likedSongsTotal !== null ? `${likedSongsTotal} tracks` : 'Favorites'}
                    </span>
                  </div>
                </button>

                {/* User Playlists List */}
                {playlists.length > 0 ? (
                  playlists.map((p) => (
                    <button
                      key={p.id}
                      onClick={() => onSelectPlaylist(p)}
                      className="flex items-center gap-2 p-1 rounded-[5px] hover:bg-white/10 text-left transition-colors group shrink-0 cursor-pointer"
                      title={`Browse playlist: ${p.name}`}
                    >
                      {p.coverArt ? (
                        <img
                          src={p.coverArt}
                          alt=""
                          className="w-5 h-5 rounded-[3px] object-cover shrink-0 pointer-events-none"
                        />
                      ) : (
                        <div className="w-5 h-5 rounded-[3px] bg-white/10 flex items-center justify-center shrink-0">
                          <Library className="w-2.5 h-2.5 text-white/60" />
                        </div>
                      )}
                      <div className="flex flex-col min-w-0 flex-1">
                        <span className="text-[10px] font-medium text-white truncate group-hover:text-white">
                          {p.name}
                        </span>
                        <span className="text-[8.5px] text-island-secondary truncate tabular-nums">
                          {p.tracksTotal} tracks
                        </span>
                      </div>
                    </button>
                  ))
                ) : (
                  !isLoadingPlaylists && (
                    <span className="text-[10px] text-white/30 italic text-center py-2">
                      No playlists found
                    </span>
                  )
                )}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center flex-1 text-center px-1">
                <span className="text-[10px] text-white/70 mb-2 leading-tight">
                  Connect personal account to browse playlists
                </span>
                <button
                  onClick={onConnectSpotify}
                  className="px-3 py-1 rounded-full bg-white text-black font-semibold text-[10px] hover:bg-white/90 active:scale-95 transition-all shadow-sm cursor-pointer"
                >
                  Connect Account
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // 2. Up Next (Queue)
  if (activeSubPanel === 'queue') {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
        <div
          data-tauri-drag-region="false"
          onWheel={(e) => e.stopPropagation()}
          className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-sky-400/30 hover:[&::-webkit-scrollbar-thumb]:bg-sky-400/60 [&::-webkit-scrollbar-thumb]:rounded-full pointer-events-auto flex flex-col gap-1 pr-2 select-none"
        >
          {queueTracks.length === 0 && isLoadingQueue ? (
            <div className="flex-1 flex flex-col items-center justify-center gap-1.5 py-6 pointer-events-none opacity-60">
              <Loader2 className="w-4 h-4 text-white/50 animate-spin" />
              <span className="text-[10px] text-white/40 font-medium">Memuat antrean...</span>
            </div>
          ) : queueTracks.length > 0 ? (
            queueTracks.map((t, idx) => {
              const durationSec = Math.round(t.durationMs / 1000);
              return (
                <button
                  key={`${t.id}-${t.uri}-${idx}`}
                  onClick={() => onPlayQueueTrack(t, idx)}
                  className="flex items-center gap-2 p-1 rounded-[5px] hover:bg-white/10 text-left transition-colors group cursor-pointer w-full shrink-0"
                  title={`Play ${t.title} - ${t.artist}`}
                >
                  {t.albumArt ? (
                    <img
                      src={t.albumArt}
                      alt=""
                      className="w-5 h-5 rounded-[3px] object-cover shrink-0 pointer-events-none"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-[3px] bg-white/10 flex items-center justify-center shrink-0">
                      <Play className="w-2 h-2 text-white/60" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[10px] font-medium text-white truncate group-hover:text-white">
                      {t.title}
                    </span>
                    <span className="text-[8.5px] text-island-secondary truncate">
                      {t.artist}
                    </span>
                  </div>
                  <span className="text-[9px] text-white/40 tabular-nums shrink-0 ml-1">
                    {formatTime(durationSec)}
                  </span>
                </button>
              );
            })
          ) : (
            <div className="flex flex-col gap-1 py-2 text-center">
              <span className="text-[10px] text-white/30 italic">
                {isLoadingQueue ? 'Loading queue...' : 'No upcoming tracks'}
              </span>
            </div>
          )}
        </div>

        {!isUserConnected && (
          <div className="flex items-center justify-between px-2 py-0.5 rounded-[5px] bg-white/[0.05] border border-white/10 mt-1 shrink-0">
            <span className="text-[8.5px] text-white/60 truncate">Sync real queue</span>
            <button
              onClick={onConnectSpotify}
              className="px-2 py-0.5 rounded-full bg-white text-black font-semibold text-[8.5px] hover:bg-white/90 active:scale-95 transition-all shrink-0 cursor-pointer"
            >
              Connect
            </button>
          </div>
        )}
      </div>
    );
  }

  // 3. Spotify Quick Search
  if (activeSubPanel === 'search') {
    return (
      <div className="flex-1 min-h-0 flex flex-col justify-between overflow-hidden">
        {/* Search Input Box */}
        <div
          className="flex items-center gap-1.5 px-2 py-1 rounded-[6px] bg-white/[0.08] border border-white/10 shrink-0"
          onClick={(e) => {
            e.stopPropagation();
            onFocusInput?.();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            onFocusInput?.();
          }}
        >
          <Search className="w-2.5 h-2.5 text-white/40 shrink-0" />
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
            placeholder="Search Spotify..."
            className="w-full bg-transparent text-white text-[10px] placeholder-white/30 focus:outline-none select-text pointer-events-auto"
          />
          {isSearching ? (
            <Loader2 className="w-2.5 h-2.5 text-white/50 animate-spin shrink-0" />
          ) : searchQuery ? (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onSearchQueryChange('');
              }}
              className="text-white/40 hover:text-white shrink-0 cursor-pointer"
            >
              <X className="w-2.5 h-2.5" />
            </button>
          ) : null}
        </div>

        {/* Search Results or Quick Presets */}
        {searchQuery.trim() ? (
          <div
            data-tauri-drag-region="false"
            onWheel={(e) => e.stopPropagation()}
            className="flex-1 min-h-0 overflow-y-auto cosmic-music-scrollbar [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-sky-400/30 hover:[&::-webkit-scrollbar-thumb]:bg-sky-400/60 [&::-webkit-scrollbar-thumb]:rounded-full pointer-events-auto flex flex-col gap-1 pr-2 mt-1 select-none"
          >
            {searchResults.length === 0 && !isSearching ? (
              <span className="text-[10px] text-white/30 italic text-center py-2">
                No tracks found
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
                  className="flex items-center gap-1.5 p-1 rounded-[5px] hover:bg-white/10 text-left transition-colors group cursor-pointer shrink-0"
                  title={`Play ${t.title} - ${t.artist}`}
                >
                  {t.albumArt ? (
                    <img
                      src={t.albumArt}
                      alt=""
                      className="w-5 h-5 rounded-[3px] object-cover shrink-0 pointer-events-none"
                    />
                  ) : (
                    <div className="w-5 h-5 rounded-[3px] bg-white/10 flex items-center justify-center shrink-0">
                      <Play className="w-2 h-2 text-white/60" />
                    </div>
                  )}
                  <div className="flex flex-col min-w-0 flex-1">
                    <span className="text-[10px] font-medium text-white truncate group-hover:text-white">
                      {t.title}
                    </span>
                    <span className="text-[8.5px] text-island-secondary truncate">
                      {t.artist}
                    </span>
                  </div>
                  <button
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onClick={(e) => {
                      e.stopPropagation();
                      onAddToQueue(t);
                    }}
                    className="w-5 h-5 rounded-full hover:bg-white/20 text-white/40 hover:text-white flex items-center justify-center shrink-0 transition-colors cursor-pointer"
                    title="Add to Spotify Queue"
                  >
                    {addedQueueId === t.id ? (
                      <Check className="w-2.5 h-2.5 text-island-green" />
                    ) : (
                      <Plus className="w-2.5 h-2.5" />
                    )}
                  </button>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-1 pt-1.5">
            <span className="text-[9px] text-island-secondary font-medium uppercase tracking-wider">
              Quick Discover
            </span>
            <div className="flex flex-wrap gap-1">
              {['Lofi', 'Synthwave', 'Focus', 'Chill'].map((tag) => (
                <button
                  key={tag}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onClick={() => onSearchQueryChange(tag)}
                  className="px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] text-white/60 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                >
                  {tag}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  }

  return null;
});

SpotifyPanels.displayName = 'SpotifyPanels';
