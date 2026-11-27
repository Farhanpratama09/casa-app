export type IslandMode =
  | 'idle'
  | 'dual_bubble'
  | 'compact_strip'
  | 'expanded_music'
  | 'expanded_timer'
  | 'expanded_todo'
  | 'expanded_control'
  | 'expanded_ibadah'
  | 'expanded_calculator'
  | 'expanded_calendar'
  | 'drop_zone';

export type IslandState =
  | 'tucked'
  | 'tucked_peek'
  | 'idle'
  | 'idle_peek'
  | 'expanded';

export type CompactSubtype =
  | 'charging'
  | 'mute_mic'
  | 'volume_hud'
  | 'calendar_peek'
  | 'caps_lock';

export type AudioOutputDevice = 'headset' | 'speaker';

export interface MediaSessionItem {
  session_id: string;
  app_name: string;
  browser_type?: string | null;
  title: string;
  artist: string;
  is_playing: boolean;
}

export interface SongMetadata {
  session_id?: string;
  title: string;
  artist: string;
  albumArt?: string;
  albumArtUrl?: string;
  duration: number; // in seconds
  currentTime: number; // in seconds
  isPlaying: boolean;
  isShuffle?: boolean;
  is_browser?: boolean;
  is_spotify?: boolean;
  source_app?: string;
  active_sessions?: MediaSessionItem[];
  showLyrics?: boolean;
  lyrics?: {
    prev?: string;
    current?: string;
    next?: string;
  };
  queue?: { title: string; artist: string }[];
}

export interface PlaybackClockSnapshot {
  basePositionMs: number;
  capturedAtMs: number;
  isPlaying: boolean;
  durationMs: number;
}

export interface TodoItem {
  id: string;
  text: string;
  completed: boolean;
  isPinned?: boolean;
  scheduledTime?: string; // Optional Time-Block HH:MM (e.g., "09:00")
}

export interface TimerState {
  isActive: boolean;
  isPaused: boolean;
  totalSeconds: number;
  remainingSeconds: number;
  currentCycle: number; // 1 to 4
  mode: 'focus' | 'rest' | 'break';
  focusedTaskId?: string | null;
  isAlarmRinging?: boolean;
  presetTotalSeconds?: number;
}

export interface HardwareMetrics {
  cpuUsage: number;
  ramMb: number;
  batteryPct: number;
  isCharging: boolean;
  isMicMuted: boolean;
  volumePct: number;
  isGamingMode: boolean;
}
