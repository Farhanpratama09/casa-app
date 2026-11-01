import React from 'react';
import { TimerCardView } from '../../components/views/TimerCardView';
import { useTimerState } from './useTimerState';
import { TimerState } from './types';

interface TimerExpandedViewProps {
  state?: TimerState;
  onCollapse?: () => void;
  onUpdateState?: (
    patchOrFn: Partial<TimerState> | ((prev: TimerState) => TimerState)
  ) => void;
}

export const TimerExpandedView: React.FC<TimerExpandedViewProps> = ({
  state: propState,
  onCollapse: _onCollapse,
  onUpdateState: _onUpdateState,
}) => {
  const timer = useTimerState();
  const state = propState || timer.timerState;

  if (!state) {
    return null;
  }

  return (
    <TimerCardView
      timer={state}
      onToggleTimer={timer.toggleTimer}
      onResetTimer={timer.resetTimer}
      onSelectPreset={(minutes, mode) =>
        timer.selectPreset(minutes, mode === 'break' ? 'rest' : mode)
      }
      onAdjustMinutes={timer.adjustMinutes}
    />
  );
};
