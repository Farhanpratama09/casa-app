import React, { useMemo, useState } from 'react';
import {
  ChevronLeft,
  Disc3,
  ListMusic,
  ListPlus,
  Play,
  Plus,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { NativeTrack } from '../../../services/nativeAudioService';
import {
  CustomPlaylist,
  SmartPlaylist,
  usePlaylistsWithSmartMixes,
} from '../../../stores/usePlaylistStore';
import {
  MusicTrackLike,
  NormalizedMusicTrack,
  normalizeTrackForPlaylist,
} from '../../../utils/musicQueueEngine';
import { focusIslandWindow } from '../../../utils/tauriBridge';
import { formatDuration } from './constants';

export interface MusicPlaylistViewProps {
  compact?: boolean;
  currentTrack?: MusicTrackLike | null;
  onPlayPlaylistTrack: (track: NativeTrack, playlistTracks: NativeTrack[]) => void;
  onAddToQueue?: (e: React.MouseEvent | null, track: NativeTrack) => void;
}

function toNativeTrack(t: NormalizedMusicTrack): NativeTrack {
  return {
    id: t.id,
    title: t.title,
    artist: t.artist,
    durationSeconds: t.durationSeconds || 0,
    thumbnailUrl: t.thumbnailUrl || '',
    streamUrl: t.streamUrl || t.url || t.path,
    candidates: t.candidates,
    isLocal: t.isLocal,
    source: t.source,
  };
}

export const MusicPlaylistView: React.FC<MusicPlaylistViewProps> = ({
  compact = true,
  currentTrack,
  onPlayPlaylistTrack,
  onAddToQueue,
}) => {
  const {
    customPlaylists,
    smartPlaylists,
    createPlaylist,
    deletePlaylist,
    addTrackToPlaylist,
    removeTrackFromPlaylist,
  } = usePlaylistsWithSmartMixes();

  const [newPlaylistName, setNewPlaylistName] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedPlaylist = useMemo<(CustomPlaylist | SmartPlaylist) | null>(() => {
    if (!selectedId) return null;
    const customMatch = customPlaylists.find((p) => p.id === selectedId);
    if (customMatch) return customMatch;
    const smartMatch = smartPlaylists.find((p) => p.id === selectedId);
    return smartMatch || null;
  }, [selectedId, customPlaylists, smartPlaylists]);

  const handleCreatePlaylist = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newPlaylistName.trim();
    if (!trimmed) return;
    const created = createPlaylist(trimmed);
    if (created) {
      setNewPlaylistName('');
    }
  };

  const handlePlayAll = (tracks: NormalizedMusicTrack[]) => {
    if (!tracks || tracks.length === 0) return;
    const nativeList = tracks.map(toNativeTrack);
    onPlayPlaylistTrack(nativeList[0], nativeList);
  };

  const handlePlaySpecific = (
    clicked: NormalizedMusicTrack,
    playlistTracks: NormalizedMusicTrack[]
  ) => {
    const nativeList = playlistTracks.map(toNativeTrack);
    const picked = toNativeTrack(clicked);
    onPlayPlaylistTrack(picked, nativeList);
  };

  const isSmartPlaylist = (pl: CustomPlaylist | SmartPlaylist): pl is SmartPlaylist =>
    'isSmart' in pl && pl.isSmart === true;

  // Drill-down playlist view
  if (selectedPlaylist) {
    const smart = isSmartPlaylist(selectedPlaylist);
    const tracks = selectedPlaylist.tracks;

    return (
      <div className="flex flex-col h-full min-h-0 select-none">
        {/* Compact Drill-Down Header */}
        <div className="flex items-center justify-between gap-1.5 pb-1 border-b border-white/10 shrink-0">
          <div className="flex items-center gap-1 min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setSelectedId(null)}
              className="w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/15 text-zinc-300 hover:text-white flex items-center justify-center shrink-0 transition-colors"
              title="Back to Playlists"
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="text-[11px] font-semibold text-white truncate">
              {selectedPlaylist.name}
            </span>
            {smart ? (
              <span className="px-1.5 py-[1px] rounded text-[8px] font-mono tracking-wider uppercase bg-white/10 text-zinc-300 border border-white/15 shrink-0">
                {selectedPlaylist.badge}
              </span>
            ) : (
              <span className="text-[9.5px] font-mono text-zinc-500 shrink-0">
                {tracks.length}
              </span>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {!smart && currentTrack && currentTrack.title && (
              <button
                type="button"
                onClick={() =>
                  addTrackToPlaylist(
                    selectedPlaylist.id,
                    normalizeTrackForPlaylist(currentTrack)
                  )
                }
                className="h-5 px-1.5 rounded-full bg-white/[0.06] hover:bg-white/15 text-zinc-200 border border-white/15 flex items-center gap-1 text-[9px] font-medium transition-colors"
                title="Add current track to this playlist"
              >
                <ListPlus className="w-2.5 h-2.5" />
                <span>+ Current</span>
              </button>
            )}
            <button
              type="button"
              disabled={tracks.length === 0}
              onClick={() => handlePlayAll(tracks)}
              className="h-5 px-2 rounded-full bg-white text-black hover:bg-zinc-200 disabled:opacity-30 flex items-center gap-1 text-[9.5px] font-bold transition-colors"
              title="Play playlist"
            >
              <Play className="w-2.5 h-2.5 fill-current" />
              <span>Play</span>
            </button>
            {!smart && (
              <button
                type="button"
                onClick={() => {
                  deletePlaylist(selectedPlaylist.id);
                  setSelectedId(null);
                }}
                className="w-5 h-5 rounded-full bg-white/[0.04] hover:bg-white/15 text-zinc-400 hover:text-white flex items-center justify-center transition-colors"
                title="Delete playlist"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Playlist Track Rows */}
        <div
          onWheel={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain oled-thin-scrollbar pt-1 pr-0.5 flex flex-col gap-0.5 ${
            compact ? '' : 'pr-1'
          }`}
        >
          {tracks.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-3">
              <p className="text-[10.5px] text-zinc-400 font-medium">
                {smart ? 'No tracks matched yet' : 'Empty playlist'}
              </p>
              <p className="text-[9px] text-zinc-500 mt-0.5">
                {smart
                  ? 'Listen >30s or add local audio files to populate'
                  : 'Use + Save icon in Player or Search to add songs'}
              </p>
            </div>
          ) : (
            tracks.map((track, idx) => (
              <div
                key={`${track.id}-${idx}`}
                onClick={() => handlePlaySpecific(track, tracks)}
                className="group flex items-center justify-between gap-2 px-1.5 py-1 rounded-lg hover:bg-white/[0.07] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span className="w-4 text-[9px] font-mono text-zinc-500 text-right shrink-0">
                    {idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium text-white truncate leading-tight">
                      {track.title}
                    </div>
                    <div className="text-[9.5px] text-zinc-400 truncate leading-tight">
                      {track.artist}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {track.durationSeconds > 0 && (
                    <span className="text-[9px] font-mono text-zinc-500 mr-0.5">
                      {formatDuration(track.durationSeconds)}
                    </span>
                  )}
                  {onAddToQueue && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onAddToQueue(e, toNativeTrack(track));
                      }}
                      className="w-5 h-5 rounded-full bg-white/[0.04] hover:bg-white text-zinc-400 hover:text-black flex items-center justify-center transition-colors opacity-80 group-hover:opacity-100"
                      title="Add to Up Next"
                    >
                      <Plus className="w-2.5 h-2.5" />
                    </button>
                  )}
                  {!smart && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeTrackFromPlaylist(selectedPlaylist.id, idx);
                      }}
                      className="w-5 h-5 rounded-full hover:bg-white/15 text-zinc-500 hover:text-white flex items-center justify-center transition-colors"
                      title="Remove from playlist"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // Root Playlists View: Quick Create + Smart Playlists + Custom Playlists
  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      {/* Quick + New Playlist Bar */}
      <form
        data-tauri-drag-region="false"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onPointerDown={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onSubmit={handleCreatePlaylist}
        className="flex items-center gap-1.5 pb-1 border-b border-white/10 shrink-0"
      >
        <input
          type="text"
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          value={newPlaylistName}
          onPointerDown={(e) => {
            e.stopPropagation();
            void focusIslandWindow();
          }}
          onMouseDown={(e) => {
            e.stopPropagation();
            void focusIslandWindow();
          }}
          onClick={(e) => {
            e.stopPropagation();
            void focusIslandWindow();
          }}
          onFocus={() => {
            void focusIslandWindow();
          }}
          onChange={(e) => setNewPlaylistName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter') {
              e.preventDefault();
              handleCreatePlaylist();
            }
          }}
          placeholder="+ New Playlist (Enter)"
          className="flex-1 min-w-0 h-6 bg-[#0a0a0a] border border-white/15 focus:border-white/40 rounded-lg px-2 text-[10.5px] text-white placeholder-zinc-500 outline-none transition-colors select-text"
        />
        <button
          type="submit"
          data-tauri-drag-region="false"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
          disabled={!newPlaylistName.trim()}
          className="h-6 px-2 rounded-lg bg-white text-black disabled:opacity-30 hover:bg-zinc-200 text-[10px] font-semibold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
        >
          <Plus className="w-3 h-3" strokeWidth={2.4} />
          <span>Create</span>
        </button>
      </form>

      {/* Scrollable Smart + Custom Playlist List */}
      <div
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain oled-thin-scrollbar pt-1 pr-0.5 flex flex-col gap-1.5"
      >
        {/* Dynamic Smart Playlists (Read-Only) */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1 px-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            <Sparkles className="w-2.5 h-2.5 text-zinc-400" />
            <span>Smart Mixes</span>
          </div>
          <div className="grid grid-cols-2 gap-1">
            {smartPlaylists.map((sm) => (
              <div
                key={sm.id}
                onClick={() => setSelectedId(sm.id)}
                className="group flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg bg-[#0a0a0a] hover:bg-white/[0.08] border border-white/10 hover:border-white/25 cursor-pointer transition-colors min-w-0"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 min-w-0">
                    <span className="text-[10.5px] font-semibold text-white truncate">
                      {sm.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 text-[8.5px] text-zinc-400 truncate">
                    <span className="font-mono uppercase text-zinc-300">
                      {sm.badge}
                    </span>
                    <span>·</span>
                    <span className="truncate">
                      {sm.id === 'smart-artist-mix'
                        ? sm.subtitle
                        : `${sm.tracks.length} tracks`}
                    </span>
                  </div>
                </div>
                {sm.tracks.length > 0 && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handlePlayAll(sm.tracks);
                    }}
                    className="w-5 h-5 rounded-full bg-white/10 group-hover:bg-white text-white group-hover:text-black flex items-center justify-center shrink-0 transition-colors"
                    title={`Play ${sm.name}`}
                  >
                    <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Custom Playlists */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-zinc-500">
            <div className="flex items-center gap-1">
              <ListMusic className="w-2.5 h-2.5 text-zinc-400" />
              <span>Your Playlists</span>
            </div>
            <span className="font-mono text-zinc-500">{customPlaylists.length}</span>
          </div>

          {customPlaylists.length === 0 ? (
            <div className="px-2 py-2 rounded-lg bg-[#0a0a0a] border border-white/[0.07] text-[9.5px] text-zinc-500 flex items-center justify-between">
              <span>Create a playlist above to save mixed local & online songs.</span>
            </div>
          ) : (
            customPlaylists.map((pl) => (
              <div
                key={pl.id}
                onClick={() => setSelectedId(pl.id)}
                className="group flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-[#0a0a0a] hover:bg-white/[0.08] border border-white/10 hover:border-white/25 cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <Disc3 className="w-3.5 h-3.5 text-zinc-400 shrink-0" />
                  <span className="text-[10.5px] font-medium text-white truncate">
                    {pl.name}
                  </span>
                  <span className="text-[9px] font-mono text-zinc-400 shrink-0 tabular-nums">
                    {pl.tracks.length} lagu
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  {pl.tracks.length > 0 && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePlayAll(pl.tracks);
                      }}
                      className="w-5 h-5 rounded-full bg-white/10 hover:bg-white text-white hover:text-black flex items-center justify-center transition-colors"
                      title={`Play ${pl.name}`}
                    >
                      <Play className="w-2.5 h-2.5 fill-current ml-0.5" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePlaylist(pl.id);
                    }}
                    className="w-5 h-5 rounded-full hover:bg-white/15 text-zinc-500 hover:text-white flex items-center justify-center transition-colors opacity-70 group-hover:opacity-100"
                    title="Delete playlist"
                  >
                    <Trash2 className="w-2.5 h-2.5" />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default MusicPlaylistView;
