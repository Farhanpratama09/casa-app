import { NativeTrack } from '../../../services/nativeAudioService';

export type PlaybackSource = 'companion' | 'native';
export type MusicSubPanel = 'none' | 'lyrics' | 'search' | 'queue' | 'playlist';
export const SUB_PANELS: MusicSubPanel[] = ['lyrics', 'search', 'queue', 'playlist'];

export const MOCK_NATIVE_SEARCH_TRACKS: NativeTrack[] = [];

export const formatDuration = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};
