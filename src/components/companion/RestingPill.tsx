import React, { memo } from 'react';
import { CasaCompanionEyes } from './CasaCompanionEyes';
import { useCompanionMood } from '../../hooks/useCompanionMood';

export interface RestingPillProps {
  className?: string;
}

export const RestingPill: React.FC<RestingPillProps> = memo(({ className = '' }) => {
  const { mood, isWakeupBounce, onMouseEnter, onMouseMove, onMouseLeave, wakeUp } = useCompanionMood('idle');

  return (
    <div
      onClick={() => wakeUp()}
      onMouseEnter={onMouseEnter}
      onMouseMove={onMouseMove}
      onMouseLeave={onMouseLeave}
      className={`relative w-full h-full flex items-center justify-center select-none cursor-pointer overflow-visible ${className}`}
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
