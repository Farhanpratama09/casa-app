import React from 'react';
import { MusicCardView } from '../../components/views/MusicCardView';
import { useMediaPlayback } from './useMediaPlayback';
import { MediaSkillState } from './types';

interface MediaExpandedViewProps {
  state?: MediaSkillState;
  onCollapse?: () => void;
  onUpdateState?: (
    patchOrFn: Partial<MediaSkillState> | ((prev: MediaSkillState) => MediaSkillState)
  ) => void;
  onNext?: () => void;
  onPrev?: () => void;
  mode6Compact?: boolean;
  podHostEl?: HTMLDivElement | null;
  isSearchPodOpen?: boolean;
  isQueuePodOpen?: boolean;
  isLyricsOpen?: boolean;
  onToggleLyrics?: () => void;
  onToggleSearchPod?: () => void;
  onToggleQueuePod?: () => void;
  onCloseSearchPod?: () => void;
  onCloseQueuePod?: () => void;
  onInteractionLock?: () => void;
}

export const MediaExpandedView: React.FC<MediaExpandedViewProps> = ({
  state: propState,
  onCollapse: _onCollapse,
  onUpdateState: _onUpdateState,
  onNext: propOnNext,
  onPrev: propOnPrev,
  mode6Compact = false,
  podHostEl = null,
  isSearchPodOpen = false,
  isQueuePodOpen = false,
  isLyricsOpen = false,
  onToggleLyrics,
  onToggleSearchPod,
  onToggleQueuePod,
  onCloseSearchPod,
  onCloseQueuePod,
  onInteractionLock,
}) => {
  const playback = useMediaPlayback();
  const state = propState || playback.mediaState;

  if (!state || !state.song) {
    return null;
  }

  const safeDuration =
    typeof state.song.duration === 'number' &&
    Number.isFinite(state.song.duration) &&
    state.song.duration > 0
      ? state.song.duration
      : 0;
  const rawElapsed =
    typeof state.song.currentTime === 'number' &&
    Number.isFinite(state.song.currentTime) &&
    state.song.currentTime > 0
      ? state.song.currentTime
      : 0;
  const safeCurrentTime = safeDuration > 0 ? Math.min(safeDuration, rawElapsed) : rawElapsed;
  const normalizedSong =
    safeDuration === state.song.duration && safeCurrentTime === state.song.currentTime
      ? state.song
      : { ...state.song, duration: safeDuration, currentTime: safeCurrentTime };

  return (
    <MusicCardView
      playbackClock={state.playbackClock}
      onSeekClock={playback.commitManualSeekClock}
      song={normalizedSong}
      onTogglePlay={playback.togglePlay}
      onNext={propOnNext || playback.nextTrack}
      onPrev={propOnPrev || playback.prevTrack}
      isShuffle={state.isShuffle}
      onToggleShuffle={playback.toggleShuffle}
      onSetShuffle={playback.setShuffle}
      activeSubPanel={state.activeSubPanel}
      onSubPanelChange={playback.setSubPanel}
      audioOutput={state.audioOutput}
      onToggleAudioOutput={playback.toggleAudioOutput}
      lyricLines={state.lyricsData?.lines || []}
      isSyncedLyrics={state.lyricsData?.isSynced || false}
      syncType={state.lyricsData?.syncType || 'none'}
      isInstrumental={state.lyricsData?.isInstrumental || false}
      lyricOffsetSeconds={state.lyricsData?.offsetSeconds || 0}
      onLyricsUpdated={playback.updateLyrics}
      isSpotifyRunning={state.isSpotifyRunning}
      is_browser={state.is_browser ?? state.song.is_browser}
      sessionId={state.session_id ?? state.song.session_id}
      activeSessions={state.active_sessions ?? state.song.active_sessions}
      playbackSource={state.playbackSource || 'companion'}
      onPlaybackSourceChange={(src) => playback.updateState({ playbackSource: src })}
      showLyrics={isLyricsOpen}
      onToggleLyrics={onToggleLyrics}
      isIdleLyricsEnabled={Boolean(state.showIdleLyrics)}
      onToggleIdleLyrics={playback.toggleIdleLyrics}
      onStopMedia={playback.stopPlayback}
      mode6Compact={mode6Compact}
      podHostEl={podHostEl}
      isSearchPodOpen={isSearchPodOpen}
      isQueuePodOpen={isQueuePodOpen}
      onToggleSearchPod={onToggleSearchPod}
      onToggleQueuePod={onToggleQueuePod}
      onCloseSearchPod={onCloseSearchPod}
      onCloseQueuePod={onCloseQueuePod}
      onInteractionLock={onInteractionLock}
    />
  );
};
