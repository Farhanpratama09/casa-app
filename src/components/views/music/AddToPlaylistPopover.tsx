import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListPlus, Plus } from 'lucide-react';
import { usePlaylistsWithSmartMixes } from '../../../stores/usePlaylistStore';
import { isSameTrack, MusicTrackLike, normalizeTrackMetadata } from '../../../utils/musicQueueEngine';

export interface AddToPlaylistPopoverProps {
  track: MusicTrackLike | null | undefined;
  compact?: boolean;
  className?: string;
  title?: string;
  onAdded?: (playlistName: string) => void;
}

export const AddToPlaylistPopover: React.FC<AddToPlaylistPopoverProps> = ({
  track,
  compact = false,
  className = '',
  title = 'Add to Playlist',
  onAdded,
}) => {
  const { customPlaylists, createPlaylist, addTrackToPlaylist } = usePlaylistsWithSmartMixes();
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const normalizedTrack = track ? normalizeTrackMetadata(track) : null;

  useEffect(() => {
    if (!isOpen) return;

    const updatePosition = () => {
      const btn = buttonRef.current;
      if (!btn || typeof window === 'undefined') return;
      const rect = btn.getBoundingClientRect();
      const panelWidth = 204;
      const estimatedRowsHeight = Math.min(132, Math.max(28, customPlaylists.length * 26));
      const panelHeight = Math.min(window.innerHeight - 8, estimatedRowsHeight + 56);
      const clampedLeft = Math.max(
        6,
        Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 6)
      );
      const preferAbove = rect.bottom + panelHeight + 6 > window.innerHeight;
      const rawTop = preferAbove ? rect.top - panelHeight - 4 : rect.bottom + 4;
      const clampedTop = Math.max(4, Math.min(rawTop, window.innerHeight - panelHeight - 4));
      setCoords({ top: clampedTop, left: clampedLeft });
    };

    updatePosition();

    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current?.contains(target) ||
        buttonRef.current?.contains(target)
      ) {
        return;
      }
      setIsOpen(false);
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };

    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, customPlaylists.length]);

  if (!normalizedTrack || !normalizedTrack.title) return null;

  const isInAnyPlaylist = customPlaylists.some((pl) =>
    pl.tracks.some((t) => isSameTrack(t, normalizedTrack))
  );

  const handleToggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsOpen((prev) => !prev);
  };

  const handleSelectPlaylist = (e: React.MouseEvent, playlistId: string, playlistName: string) => {
    e.stopPropagation();
    addTrackToPlaylist(playlistId, normalizedTrack);
    setJustAddedId(playlistId);
    onAdded?.(playlistName);
    setTimeout(() => {
      setJustAddedId(null);
      setIsOpen(false);
    }, 320);
  };

  const handleCreateAndAdd = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const trimmed = newName.trim();
    if (!trimmed) return;
    const created = createPlaylist(trimmed, [normalizedTrack]);
    if (created) {
      setNewName('');
      setJustAddedId(created.id);
      onAdded?.(created.name);
      setTimeout(() => {
        setJustAddedId(null);
        setIsOpen(false);
      }, 320);
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggleOpen}
        title={title}
        aria-label={title}
        className={
          className ||
          `${
            compact ? 'w-6 h-6' : 'w-7 h-7'
          } rounded-full flex items-center justify-center transition-all border shrink-0 ${
            isOpen || justAddedId
              ? 'bg-white text-black border-white'
              : isInAnyPlaylist
              ? 'bg-white/10 text-white border-white/25 hover:bg-white/20'
              : 'bg-white/[0.04] text-zinc-400 border-white/10 hover:text-white hover:border-white/25'
          }`
        }
      >
        <ListPlus className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} strokeWidth={2} />
      </button>

      {isOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={popoverRef}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: `${coords.top}px`,
              left: `${coords.left}px`,
              width: '204px',
              maxHeight: '178px',
            }}
            className="z-[9999] bg-[#0a0a0a] border border-white/20 rounded-xl shadow-[0_12px_32px_rgba(0,0,0,0.95)] p-1.5 flex flex-col gap-1 text-white select-none"
          >
            <div className="flex items-center justify-between px-1.5 pt-0.5 shrink-0">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400 truncate">
                Save to Playlist
              </span>
              <span className="text-[8.5px] font-mono text-zinc-500">
                {customPlaylists.length}
              </span>
            </div>

            <div
              onWheel={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              className="flex-1 min-h-0 max-h-[132px] overflow-y-auto overscroll-contain oled-thin-scrollbar pr-0.5 flex flex-col gap-0.5"
            >
              {customPlaylists.length === 0 ? (
                <div className="px-1.5 py-2 text-[9.5px] text-zinc-500 text-center">
                  No custom playlists yet
                </div>
              ) : (
                customPlaylists.map((pl) => {
                  const alreadyAdded = pl.tracks.some((t) =>
                    isSameTrack(t, normalizedTrack)
                  );
                  const isConfirmed = justAddedId === pl.id || alreadyAdded;
                  return (
                    <button
                      key={pl.id}
                      type="button"
                      onClick={(e) => handleSelectPlaylist(e, pl.id, pl.name)}
                      className={`w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg text-left transition-colors ${
                        isConfirmed
                          ? 'bg-white/12 text-white'
                          : 'hover:bg-white/[0.08] text-zinc-200'
                      }`}
                    >
                      <span className="text-[10.5px] font-medium truncate flex-1">
                        {pl.name}
                      </span>
                      {isConfirmed ? (
                        <Check className="w-3 h-3 text-white shrink-0" />
                      ) : (
                        <span className="text-[9px] font-mono text-zinc-500 shrink-0">
                          {pl.tracks.length}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>

            <form
              onSubmit={handleCreateAndAdd}
              className="flex items-center gap-1 pt-1 border-t border-white/10"
            >
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateAndAdd();
                  }
                }}
                placeholder="+ New playlist"
                className="flex-1 min-w-0 bg-black border border-white/15 focus:border-white/40 rounded-md px-2 py-0.5 text-[10px] text-white placeholder-zinc-500 outline-none"
              />
              <button
                type="submit"
                disabled={!newName.trim()}
                className="w-5 h-5 rounded-md bg-white text-black disabled:opacity-30 flex items-center justify-center shrink-0 hover:bg-zinc-200 transition-colors"
                title="Create & Add"
              >
                <Plus className="w-3 h-3" strokeWidth={2.5} />
              </button>
            </form>
          </div>,
          document.body
        )}
    </>
  );
};

export default AddToPlaylistPopover;
