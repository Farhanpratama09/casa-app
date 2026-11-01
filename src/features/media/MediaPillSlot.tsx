import React from 'react';
import { useMediaPlayback } from './useMediaPlayback';
import { MediaSkillState } from './types';

interface MediaPillSlotProps {
  state?: MediaSkillState;
  onClick?: () => void;
}

export const MediaPillSlot: React.FC<MediaPillSlotProps> = ({ state: propState, onClick }) => {
  const playback = useMediaPlayback();
  const state = propState || playback.mediaState;

  if (!state) return null;
  const { song, playbackSource, nativeTrack, isNativePlaying } = state;

  const isNative = playbackSource === 'native';
  const isPlaying = isNative
    ? Boolean(isNativePlaying && nativeTrack)
    : Boolean(song?.isPlaying && song?.title && song.title.trim() !== '');

  if (!isPlaying) {
    return null;
  }

  const title = isNative ? (nativeTrack?.title || 'Playing Media') : (song?.title || 'Playing Media');
  const artist = isNative ? (nativeTrack?.artist || '') : (song?.artist || '');
  const artwork = isNative
    ? (nativeTrack?.artworkUrl || nativeTrack?.thumbnailUrl || nativeTrack?.albumArt)
    : (song?.albumArtUrl || song?.albumArt);

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-2 shrink-0 cursor-pointer select-none group max-w-[140px]"
      title={`Playing: ${title}${artist ? ` - ${artist}` : ''}`}
    >
      <div className="flex flex-col items-end min-w-0">
        <span
          className="text-[10.5px] font-medium text-white/70 group-hover:text-emerald-400 truncate max-w-[110px] text-right transition-colors"
          title={`${title}${artist ? ` - ${artist}` : ''}`}
        >
          {title}
        </span>
      </div>
      <div
        className="w-[16px] h-[16px] rounded-full overflow-hidden border border-white/20 shadow-sm animate-[spin_8s_linear_infinite] shrink-0"
        style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
      >
        {artwork ? (
          <img
            src={artwork}
            alt="Mini Art"
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLElement).style.display = 'none';
            }}
          />
        ) : (
          <div className="w-full h-full bg-emerald-500/20 flex items-center justify-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
          </div>
        )}
      </div>
    </div>
  );
};
