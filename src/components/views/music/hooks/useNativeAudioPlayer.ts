import { useCasaAudio } from '../../../../context/CasaAudioContext';
import { NativeTrack } from '../../../../services/nativeAudioService';
import { LyricResult } from '../../../../utils/lyricsService';
import { PlaybackSource } from '../constants';

export interface UseNativeAudioPlayerOptions {
  playbackSource?: PlaybackSource;
  onTrackChange?: (track: NativeTrack | null) => void;
  onLyricsUpdated?: (result: LyricResult) => void;
  onQueueUpdated?: (queue: NativeTrack[]) => void;
}

/**
 * useNativeAudioPlayer:
 * Thin compatibility proxy delegating to the persistent root CasaAudioContext.
 * This guarantees audio playback and state never unmount when switching modules (Timer, Tasks, etc.).
 */
export function useNativeAudioPlayer(_options: UseNativeAudioPlayerOptions = {}) {
  return useCasaAudio();
}
