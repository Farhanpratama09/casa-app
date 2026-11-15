import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Check, ListPlus, Plus } from 'lucide-react';
import { usePlaylistsWithSmartMixes } from '../../../stores/usePlaylistStore';
import { setSearchDrawerExtraHeight } from '../../../utils/islandLayoutState';
import {
  isSameTrack,
  MusicTrackLike,
  normalizeTrackForPlaylist,
} from '../../../utils/musicQueueEngine';
import { focusIslandWindow } from '../../../utils/tauriBridge';

const NO_DRAG_STYLE = { WebkitAppRegion: 'no-drag' } as unknown as React.CSSProperties;

export interface AddToPlaylistPopoverProps {
  track: MusicTrackLike | null | undefined;
  compact?: boolean;
  className?: string;
  title?: string;
  onAdded?: (playlistName: string) => void;
  /** Optional container ref (e.g. Left Search Drawer card) to lock the popover inside the card bounds. */
  containerRef?: React.RefObject<HTMLElement | null>;
  /** Lock popover width horizontally inside `containerRef` (`inset-x-2`) to prevent left/right Win32 click-through. */
  containedInCard?: boolean;
  /** Dynamically extend `search_drawer` Win32 hitbox height when the anchored popover protrudes downward. */
  reportSearchDrawerHitbox?: boolean;
}

export const AddToPlaylistPopover: React.FC<AddToPlaylistPopoverProps> = ({
  track,
  compact = false,
  className = '',
  title = 'Add to Playlist',
  onAdded,
  containerRef,
  containedInCard = false,
  reportSearchDrawerHitbox = false,
}) => {
  const { customPlaylists, createPlaylist, addTrackToPlaylist } = usePlaylistsWithSmartMixes();
  const [isOpen, setIsOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [justAddedId, setJustAddedId] = useState<string | null>(null);
  const [savedLabel, setSavedLabel] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const closeTimerRef = useRef<number | null>(null);

  const normalizedTrack = track ? normalizeTrackForPlaylist(track) : null;

  const scheduleClose = useCallback(() => {
    if (closeTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(closeTimerRef.current);
    }
    if (typeof window !== 'undefined') {
      closeTimerRef.current = window.setTimeout(() => {
        closeTimerRef.current = null;
        setJustAddedId(null);
        setSavedLabel(null);
        setIsOpen(false);
        if (reportSearchDrawerHitbox) {
          setSearchDrawerExtraHeight(0);
        }
      }, 420);
    }
  }, [reportSearchDrawerHitbox]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null && typeof window !== 'undefined') {
        window.clearTimeout(closeTimerRef.current);
      }
      if (reportSearchDrawerHitbox) {
        setSearchDrawerExtraHeight(0);
      }
    };
  }, [reportSearchDrawerHitbox]);

  const updatePosition = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn || typeof window === 'undefined') return;

    const rect = btn.getBoundingClientRect();
    const estimatedRowsHeight = Math.min(116, Math.max(26, customPlaylists.length * 24));
    const measuredHeight = popoverRef.current?.offsetHeight || 0;
    const panelHeight =
      measuredHeight > 0
        ? measuredHeight
        : Math.min(window.innerHeight - 12, estimatedRowsHeight + 60);

    const hostContainer = containedInCard ? containerRef?.current : null;
    if (hostContainer) {
      const cRect = hostContainer.getBoundingClientRect();
      const spaceBelowInWindow = Math.max(0, window.innerHeight - rect.bottom - 8);
      const spaceAboveInCard = Math.max(0, rect.top - cRect.top - 4);
      const preferBelow =
        spaceBelowInWindow >= panelHeight || spaceBelowInWindow >= spaceAboveInCard;

      const rawTop = preferBelow
        ? rect.bottom - cRect.top + 4
        : rect.top - cRect.top - panelHeight - 4;

      const maxBottomInCardSpace = Math.max(
        cRect.height,
        window.innerHeight - cRect.top - 6
      );
      const clampedTop = Math.max(
        4,
        Math.min(rawTop, Math.max(4, maxBottomInCardSpace - panelHeight))
      );

      setCoords({ top: Math.round(clampedTop), left: 8 });
      return;
    }

    const panelWidth = 204;
    const clampedLeft = Math.max(
      6,
      Math.min(rect.right - panelWidth, window.innerWidth - panelWidth - 6)
    );
    const preferAbove = rect.bottom + panelHeight + 6 > window.innerHeight;
    const rawTop = preferAbove ? rect.top - panelHeight - 4 : rect.bottom + 4;
    const clampedTop = Math.max(4, Math.min(rawTop, window.innerHeight - panelHeight - 4));
    setCoords({ top: Math.round(clampedTop), left: Math.round(clampedLeft) });
  }, [containedInCard, containerRef, customPlaylists.length]);

  useLayoutEffect(() => {
    if (!isOpen) {
      if (reportSearchDrawerHitbox) {
        setSearchDrawerExtraHeight(0);
      }
      return;
    }

    updatePosition();

    const syncHitboxOverhang = () => {
      if (!reportSearchDrawerHitbox) return;
      const containerEl = containerRef?.current;
      const popEl = popoverRef.current;
      if (!containerEl || !popEl) {
        setSearchDrawerExtraHeight(0);
        return;
      }
      const popBottomInCard = popEl.offsetTop + popEl.offsetHeight;
      const overhang = Math.max(
        0,
        Math.ceil(popBottomInCard - containerEl.clientHeight + 8)
      );
      setSearchDrawerExtraHeight(overhang);
    };

    syncHitboxOverhang();

    let resizeObs: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && popoverRef.current) {
      resizeObs = new ResizeObserver(() => {
        updatePosition();
        syncHitboxOverhang();
      });
      resizeObs.observe(popoverRef.current);
    }

    return () => {
      resizeObs?.disconnect();
    };
  }, [
    isOpen,
    customPlaylists.length,
    savedLabel,
    coords.top,
    containedInCard,
    containerRef,
    reportSearchDrawerHitbox,
    updatePosition,
  ]);

  useEffect(() => {
    if (!isOpen || typeof window === 'undefined') return;

    const handleOutside = (e: Event) => {
      const target = e.target as Node | null;
      if (
        (target && popoverRef.current?.contains(target)) ||
        (target && buttonRef.current?.contains(target))
      ) {
        return;
      }
      setIsOpen(false);
      if (reportSearchDrawerHitbox) {
        setSearchDrawerExtraHeight(0);
      }
    };

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setIsOpen(false);
        if (reportSearchDrawerHitbox) {
          setSearchDrawerExtraHeight(0);
        }
      }
    };

    window.addEventListener('pointerdown', handleOutside, true);
    window.addEventListener('mousedown', handleOutside, true);
    window.addEventListener('keydown', handleKey);
    window.addEventListener('resize', updatePosition);
    return () => {
      window.removeEventListener('pointerdown', handleOutside, true);
      window.removeEventListener('mousedown', handleOutside, true);
      window.removeEventListener('keydown', handleKey);
      window.removeEventListener('resize', updatePosition);
    };
  }, [isOpen, reportSearchDrawerHitbox, updatePosition]);

  if (!normalizedTrack || !normalizedTrack.title) return null;

  const isInAnyPlaylist = customPlaylists.some((pl) =>
    pl.tracks.some((t) => isSameTrack(t, normalizedTrack))
  );

  const handleToggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (closeTimerRef.current !== null && typeof window !== 'undefined') {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setIsOpen((prev) => {
      const next = !prev;
      if (!next && reportSearchDrawerHitbox) {
        setSearchDrawerExtraHeight(0);
      }
      return next;
    });
  };

  const handleSelectPlaylist = (
    e: React.MouseEvent,
    playlistId: string,
    playlistName: string
  ) => {
    e.stopPropagation();
    const freshTrack = normalizeTrackForPlaylist(normalizedTrack, {
      addedAt: Date.now(),
    });
    addTrackToPlaylist(playlistId, freshTrack);
    setJustAddedId(playlistId);
    setSavedLabel(playlistName);
    onAdded?.(playlistName);
    scheduleClose();
  };

  const handleCreateAndAdd = (e?: React.FormEvent) => {
    if (e) {
      e.preventDefault();
      e.stopPropagation();
    }
    const trimmed = newName.trim();
    if (!trimmed) return;
    const freshTrack = normalizeTrackForPlaylist(normalizedTrack, {
      addedAt: Date.now(),
    });
    const created = createPlaylist(trimmed, [freshTrack]);
    if (created) {
      setNewName('');
      setJustAddedId(created.id);
      setSavedLabel(created.name);
      onAdded?.(created.name);
      scheduleClose();
    }
  };

  const portalTarget =
    typeof document !== 'undefined'
      ? containedInCard && containerRef?.current
        ? containerRef.current
        : document.body
      : null;

  const isCardAnchored = Boolean(containedInCard && containerRef?.current);

  const stopBubble = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        data-tauri-drag-region="false"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        onPointerDown={stopBubble}
        onMouseDown={stopBubble}
        onClick={handleToggleOpen}
        title={title}
        aria-label={title}
        className={
          className ||
          `${
            compact ? 'w-6 h-6' : 'w-7 h-7'
          } rounded-full flex items-center justify-center transition-all border shrink-0 cursor-pointer ${
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
        portalTarget &&
        createPortal(
          <div
            ref={popoverRef}
            data-casa-popover="true"
            data-tauri-drag-region="false"
            onPointerDown={stopBubble}
            onMouseDown={stopBubble}
            onClick={stopBubble}
            style={
              isCardAnchored
                ? {
                    ...NO_DRAG_STYLE,
                    position: 'absolute',
                    top: `${coords.top}px`,
                    left: '8px',
                    right: '8px',
                    maxHeight: '166px',
                  }
                : {
                    ...NO_DRAG_STYLE,
                    position: 'fixed',
                    top: `${coords.top}px`,
                    left: `${coords.left}px`,
                    width: '204px',
                    maxHeight: '178px',
                  }
            }
            className="pointer-events-auto z-[9999] bg-[#0a0a0a] border border-white/25 rounded-xl shadow-[0_12px_32px_rgba(0,0,0,0.95)] p-1.5 flex flex-col gap-1 text-white select-none"
          >
            <div className="flex items-center justify-between px-1.5 pt-0.5 shrink-0 gap-1">
              <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-zinc-400 truncate">
                Save to Playlist
              </span>
              {savedLabel ? (
                <span className="text-[8.5px] font-semibold text-emerald-400 truncate flex items-center gap-0.5">
                  <Check className="w-2.5 h-2.5 shrink-0" />
                  <span className="truncate max-w-[68px]">{savedLabel}</span>
                </span>
              ) : (
                <span className="text-[8.5px] font-mono text-zinc-500">
                  {customPlaylists.length}
                </span>
              )}
            </div>

            <div
              onWheel={stopBubble}
              onTouchMove={stopBubble}
              className="flex-1 min-h-0 max-h-[108px] overflow-y-auto overscroll-contain oled-thin-scrollbar pr-0.5 flex flex-col gap-0.5"
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
                      data-tauri-drag-region="false"
                      style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                      onPointerDown={stopBubble}
                      onMouseDown={stopBubble}
                      onClick={(e) => handleSelectPlaylist(e, pl.id, pl.name)}
                      className={`w-full flex items-center justify-between gap-1.5 px-2 py-1 rounded-lg text-left transition-colors cursor-pointer ${
                        isConfirmed
                          ? 'bg-white/15 text-white'
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
              data-tauri-drag-region="false"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onPointerDown={stopBubble}
              onMouseDown={stopBubble}
              onClick={stopBubble}
              onSubmit={handleCreateAndAdd}
              className="flex items-center gap-1 pt-1 border-t border-white/10 shrink-0"
            >
              <input
                ref={inputRef}
                type="text"
                data-tauri-drag-region="false"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                value={newName}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  void focusIslandWindow();
                  inputRef.current?.focus();
                }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  void focusIslandWindow();
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  void focusIslandWindow();
                  inputRef.current?.focus();
                }}
                onFocus={() => {
                  void focusIslandWindow();
                }}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleCreateAndAdd();
                  }
                }}
                placeholder="+ New playlist"
                className="flex-1 min-w-0 bg-black border border-white/15 focus:border-white/40 rounded-md px-2 py-0.5 text-[10px] text-white placeholder-zinc-500 outline-none select-text"
              />
              <button
                type="submit"
                data-tauri-drag-region="false"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onPointerDown={stopBubble}
                onMouseDown={stopBubble}
                onClick={stopBubble}
                disabled={!newName.trim()}
                className="w-5 h-5 rounded-md bg-white text-black disabled:opacity-30 flex items-center justify-center shrink-0 hover:bg-zinc-200 transition-colors cursor-pointer"
                title="Create & Add"
                aria-label="Create & Add Playlist"
              >
                <Plus className="w-3 h-3" strokeWidth={2.5} />
              </button>
            </form>
          </div>,
          portalTarget
        )}
    </>
  );
};

export default AddToPlaylistPopover;
