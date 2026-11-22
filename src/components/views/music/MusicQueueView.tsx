import React from 'react';
import { Repeat, Repeat1, Shuffle, Sparkles, Trash2, X } from 'lucide-react';
import { NativeTrack } from '../../../services/nativeAudioService';
import { normalizeTrackMetadata, RepeatMode } from '../../../utils/musicQueueEngine';
import { AddToPlaylistPopover } from './AddToPlaylistPopover';
import { formatDuration } from './constants';

export interface MusicQueueViewProps {
  compact?: boolean;
  currentTrack: NativeTrack | null;
  manualQueue: NativeTrack[];
  smartQueue: NativeTrack[];
  isPlaying?: boolean;
  isResolving?: boolean;
  isShuffle: boolean;
  repeatMode: RepeatMode;
  isFetchingSmart?: boolean;
  onToggleShuffle: () => void;
  onToggleRepeat: () => void;
  onSelectManualTrack: (manualIndex: number) => void;
  onRemoveManualTrack: (manualIndex: number) => void;
  onSelectSmartTrack: (smartIndex: number) => void;
  onRemoveSmartTrack: (smartIndex: number) => void;
  onClearQueue: (e?: React.MouseEvent) => void;
}

export const MusicQueueView: React.FC<MusicQueueViewProps> = ({
  compact = true,
  currentTrack,
  manualQueue,
  smartQueue,
  isPlaying = false,
  isResolving = false,
  isShuffle,
  repeatMode,
  isFetchingSmart = false,
  onToggleShuffle,
  onToggleRepeat,
  onSelectManualTrack,
  onRemoveManualTrack,
  onSelectSmartTrack,
  onRemoveSmartTrack,
  onClearQueue,
}) => {
  const normalizedCurrent = currentTrack
    ? normalizeTrackMetadata(currentTrack as any)
    : null;
  const totalUpcoming = manualQueue.length + smartQueue.length;

  return (
    <div className="flex flex-col h-full min-h-0 select-none">
      {/* Compact Header Controls */}
      <div className="flex items-center justify-between gap-2 pb-1 border-b border-white/10 shrink-0">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onToggleShuffle}
            className={`h-5 px-2 rounded-full flex items-center gap-1 text-[9.5px] font-semibold border transition-colors ${
              isShuffle
                ? 'bg-white text-black border-white'
                : 'bg-[#0a0a0a] text-zinc-400 border-white/15 hover:text-white'
            }`}
            title="Shuffle upcoming tracks"
          >
            <Shuffle className="w-2.5 h-2.5" />
            <span>Shuffle</span>
          </button>
          <button
            type="button"
            onClick={onToggleRepeat}
            className={`h-5 px-2 rounded-full flex items-center gap-1 text-[9.5px] font-semibold border transition-colors ${
              repeatMode !== 'off'
                ? 'bg-white text-black border-white'
                : 'bg-[#0a0a0a] text-zinc-400 border-white/15 hover:text-white'
            }`}
            title={
              repeatMode === 'one'
                ? 'Repeat One (loop current track)'
                : repeatMode === 'all'
                ? 'Repeat All (loop playlist / queue)'
                : 'Repeat Off (auto Smart Queue)'
            }
          >
            {repeatMode === 'one' ? (
              <Repeat1 className="w-2.5 h-2.5" />
            ) : (
              <Repeat className="w-2.5 h-2.5" />
            )}
            <span>{repeatMode === 'all' ? 'Repeat All' : repeatMode === 'one' ? 'Repeat 1' : 'Repeat'}</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <span className="text-[9px] font-mono text-zinc-500">
            {totalUpcoming} queued
          </span>
          {totalUpcoming > 0 && (
            <button
              type="button"
              onClick={onClearQueue}
              className="h-5 px-1.5 rounded-full bg-white/[0.04] hover:bg-white/15 text-zinc-400 hover:text-white border border-white/10 flex items-center gap-1 text-[9px] transition-colors"
              title="Clear upcoming queue"
            >
              <Trash2 className="w-2.5 h-2.5" />
              <span>Clear</span>
            </button>
          )}
        </div>
      </div>

      {/* Scrollable Sections: Now Playing -> Up Next -> Smart Queue */}
      <div
        className={`flex-1 min-h-0 overflow-y-auto scrollbar-none pt-1 flex flex-col gap-1.5 ${
          compact ? '' : 'pr-0.5'
        }`}
      >
        {/* 1. Now Playing */}
        {normalizedCurrent && (
          <div className="flex flex-col gap-0.5">
            <span className="px-1 text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Now Playing
            </span>
            <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-white/[0.08] border border-white/20">
              <div className="flex items-center gap-2 min-w-0 flex-1">
                <div
                  className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                    isResolving
                      ? 'bg-zinc-400 animate-ping'
                      : isPlaying
                      ? 'bg-white animate-pulse'
                      : 'bg-zinc-500'
                  }`}
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-semibold text-white truncate leading-tight">
                    {normalizedCurrent.title}
                  </div>
                  <div className="text-[9.5px] text-zinc-300 truncate leading-tight">
                    {normalizedCurrent.artist}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <AddToPlaylistPopover track={normalizedCurrent} compact />
              </div>
            </div>
          </div>
        )}

        {/* 2. Up Next (Manual Queue) */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-1">
            <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-500">
              Up Next
            </span>
            <span className="text-[8.5px] font-mono text-zinc-600">
              {manualQueue.length}
            </span>
          </div>

          {manualQueue.length === 0 ? (
            <div className="px-2 py-1.5 rounded-lg bg-[#0a0a0a] border border-white/[0.06] text-[9.5px] text-zinc-500">
              No manual tracks waiting.
            </div>
          ) : (
            manualQueue.map((raw, idx) => {
              const norm = normalizeTrackMetadata(raw as any);
              return (
                <div
                  key={`${raw.id}-manual-${idx}`}
                  onClick={() => onSelectManualTrack(idx)}
                  className="group flex items-center justify-between gap-2 px-1.5 py-1 rounded-lg hover:bg-white/[0.07] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="w-3.5 text-[9px] font-mono text-zinc-500 text-right shrink-0">
                      {idx + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-medium text-white truncate leading-tight">
                        {norm.title}
                      </div>
                      <div className="text-[9px] text-zinc-400 truncate leading-tight">
                        {norm.artist}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {norm.durationSeconds > 0 && (
                      <span className="text-[9px] font-mono text-zinc-500">
                        {formatDuration(norm.durationSeconds)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveManualTrack(idx);
                      }}
                      className="w-5 h-5 rounded-full hover:bg-white/15 text-zinc-500 hover:text-white flex items-center justify-center transition-colors"
                      title="Remove from Up Next"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* 3. Smart Queue (Auto-Fill up to 5 tracks) */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-1">
              <Sparkles className="w-2.5 h-2.5 text-zinc-400" />
              <span className="text-[8px] font-bold uppercase tracking-[0.14em] text-zinc-400">
                Smart Queue
              </span>
            </div>
            <span className="text-[8.5px] font-mono text-zinc-500">
              {repeatMode === 'one'
                ? 'REPEAT 1'
                : repeatMode === 'all'
                ? 'REPEAT ALL'
                : isFetchingSmart
                ? 'FILLING...'
                : `${smartQueue.length}/5`}
            </span>
          </div>

          {smartQueue.length === 0 ? (
            <div className="px-2 py-1.5 rounded-lg bg-[#0a0a0a] border border-white/[0.06] text-[9.5px] text-zinc-500">
              {repeatMode === 'one'
                ? 'Repeat One active · looping current track.'
                : repeatMode === 'all'
                ? 'Repeat All active · looping playlist/queue.'
                : manualQueue.length >= 2
                ? 'Auto-fills when Up Next drops below 2.'
                : isFetchingSmart
                ? 'Finding matching tracks...'
                : 'No Smart Queue suggestions yet.'}
            </div>
          ) : (
            smartQueue.map((raw, idx) => {
              const norm = normalizeTrackMetadata(raw as any);
              return (
                <div
                  key={`${raw.id}-smart-${idx}`}
                  onClick={() => onSelectSmartTrack(idx)}
                  className="group flex items-center justify-between gap-2 px-1.5 py-1 rounded-lg bg-[#0a0a0a]/80 hover:bg-white/[0.07] border border-white/[0.05] cursor-pointer transition-colors"
                >
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <Sparkles className="w-2.5 h-2.5 text-zinc-500 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="text-[10.5px] font-medium text-zinc-200 group-hover:text-white truncate leading-tight">
                        {norm.title}
                      </div>
                      <div className="text-[9px] text-zinc-500 truncate leading-tight">
                        {norm.artist}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {norm.durationSeconds > 0 && (
                      <span className="text-[9px] font-mono text-zinc-600">
                        {formatDuration(norm.durationSeconds)}
                      </span>
                    )}
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveSmartTrack(idx);
                      }}
                      className="w-5 h-5 rounded-full hover:bg-white/15 text-zinc-500 hover:text-white flex items-center justify-center transition-colors"
                      title="Remove from Smart Queue"
                    >
                      <X className="w-2.5 h-2.5" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};

export default MusicQueueView;
