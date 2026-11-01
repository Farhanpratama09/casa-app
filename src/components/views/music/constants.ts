import { NativeTrack } from '../../../services/nativeAudioService';

export type PlaybackSource = 'companion' | 'native';
export type MusicSubPanel = 'none' | 'lyrics' | 'search' | 'queue' | 'playlist';
export const SUB_PANELS: MusicSubPanel[] = ['lyrics', 'search', 'queue', 'playlist'];

export const MOCK_NATIVE_SEARCH_TRACKS: NativeTrack[] = [
  {
    id: 'HkiaLCniIj8',
    title: 'DRIP',
    artist: 'BABYMONSTER',
    albumArt: 'https://is1-ssl.mzstatic.com/image/thumb/Music221/v4/b9/e1/ef/b9e1ef3a-e3eb-8152-e91b-20aca0fc9ffd/BM_DRIP_Digital-Cover_4000.jpg/500x500bb.jpg',
    thumbnailUrl: 'https://i.ytimg.com/vi/HkiaLCniIj8/hqdefault.jpg',
    durationSeconds: 190,
  },
  {
    id: 'T--6HBX2K4g',
    title: 'Hype Boy',
    artist: 'NewJeans',
    albumArt: 'https://is1-ssl.mzstatic.com/image/thumb/Music112/v4/4e/64/34/4e64344b-3ac6-c503-2c41-257a15401416/192641873096_Cover.jpg/500x500bb.jpg',
    thumbnailUrl: 'https://i.ytimg.com/vi/T--6HBX2K4g/hqdefault.jpg',
    durationSeconds: 180,
  },
  {
    id: 'ZRtdQ81jPUQ',
    title: 'Idol',
    artist: 'YOASOBI',
    albumArt: 'https://is1-ssl.mzstatic.com/image/thumb/Music126/v4/3a/17/eb/3a17eb30-eacb-82eb-51df-d1321dbb55bc/197188492205.jpg/500x500bb.jpg',
    thumbnailUrl: 'https://i.ytimg.com/vi/ZRtdQ81jPUQ/hqdefault.jpg',
    durationSeconds: 210,
  },
  {
    id: 'k6ihWb6w_p0',
    title: 'Supernova',
    artist: 'aespa',
    albumArt: 'https://is1-ssl.mzstatic.com/image/thumb/Music211/v4/34/f2/36/34f236b2-6014-4113-1b6c-811c7da2be95/aespa_Supernova_Digital-Cover_4000.jpg/500x500bb.jpg',
    thumbnailUrl: 'https://i.ytimg.com/vi/k6ihWb6w_p0/hqdefault.jpg',
    durationSeconds: 189,
  },
];

export const formatDuration = (seconds: number): string => {
  if (isNaN(seconds) || seconds < 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
};
