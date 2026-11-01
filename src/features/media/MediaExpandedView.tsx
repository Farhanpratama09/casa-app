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
}

export const MediaExpandedView: React.FC<MediaExpandedViewProps> = ({
  state: propState,
  onCollapse: _onCollapse,
  onUpdateState: _onUpdateState,
  onNext: propOnNext,
  onPrev: propOnPrev,
}) => {
  const playback = useMediaPlayback();
  const state = propState || playback.mediaState;

  if (!state || !state.song) {
    return null;
  }

  return (
    <MusicCardView
      song={state.song}
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
      playbackSource={state.playbackSource}
      onPlaybackSourceChange={(src) => playback.updateState({ playbackSource: src })}
    />
  );
};
