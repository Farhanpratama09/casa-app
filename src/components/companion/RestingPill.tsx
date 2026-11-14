import React, { memo } from 'react';
import { CasaCompanionEyes } from './CasaCompanionEyes';
import { useCompanionMood } from '../../hooks/useCompanionMood';

export interface RestingPillProps {
  className?: string;
  isSleepingActive?: boolean;
}

export const RestingPill: React.FC<RestingPillProps> = memo(({
  className = '',
  isSleepingActive = true,
}) => {
  const { mood, isWakeupBounce, onMouseEnter, onMouseMove, onMouseLeave } = useCompanionMood('awake', isSleepingActive);

  return (
    <div
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`relative min-w-[126px] w-full h-full px-8 flex items-center justify-center select-none cursor-pointer overflow-visible ${className}`}
    >
      <CasaCompanionEyes
        size="md"
        mood={mood}
        isWakeupBounce={isWakeupBounce}
      />
    </div>
  );
});

RestingPill.displayName = 'RestingPill';
