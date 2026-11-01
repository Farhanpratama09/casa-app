import { SongMetadata, AudioOutputDevice, MediaSessionItem } from '../../types/island';
import { MusicSubPanel } from '../../components/views/MusicCardView';
import { LyricResult } from '../../utils/lyricsService';
import type { NativeTrack } from '../../services/nativeAudioService';

export type { SongMetadata, AudioOutputDevice, MusicSubPanel, LyricResult, MediaSessionItem, NativeTrack };

export interface MediaSkillState {
  song: SongMetadata;
  hasNativeMedia: boolean;
  isShuffle: boolean;
  activeSubPanel: MusicSubPanel;
  audioOutput: AudioOutputDevice;
  lyricsData: LyricResult;
  isSpotifyRunning: boolean;
  is_browser?: boolean;
  session_id?: string;
  active_sessions?: MediaSessionItem[];
  playbackSource?: 'companion' | 'native';
  nativeTrack?: NativeTrack | null;
  isNativePlaying?: boolean;
}
