import React, { useEffect, useRef, useState, memo } from 'react';
import { motion } from 'framer-motion';
import type { CompanionMood } from '../../hooks/useCompanionMood';
import { useSkillStore } from '../../skills/store';
import { useQueueStore } from '../../stores/useQueueStore';
import { useDropZoneStore } from '../../stores/useDropZoneStore';

export interface CasaCompanionEyesProps {
  size?: 'sm' | 'md';
  mood?: CompanionMood;
  isWakeupBounce?: boolean;
  blinkTrigger?: string | number;
  className?: string;
}

/**
 * CasaCompanionEyes (CASA v2.0 — Pure Black Notch Identity)
 * - Mata Kiri: Tajam pure `#ffffff` `×`
 * - Mata Kanan: Tajam pure `#ffffff` `♥`
 * - Kondisi Terjaga (`awake`/`idle`): skala vertikal penuh (`scaleY: 1`), `opacity: 1`, kedip alami lembut.
 * - Kondisi Tidur (`sleep`): menyipit vertikal (`scaleY: 0.5`) mempertahankan keterbacaan `× ♥` dengan napas pelan (`opacity ~0.25`, durasi 4s).
 */
export const CasaCompanionEyes: React.FC<CasaCompanionEyesProps> = memo(({
  size = 'md',
  mood = 'awake',
  isWakeupBounce: propWakeupBounce = false,
  blinkTrigger,
  className = '',
}) => {
  const prevMoodRef = useRef<CompanionMood>(mood);

  const [internalBounce, setInternalBounce] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);

  // Subscribe to current playing track for gentle track-change blink
  const mediaSkillTrackTitle = useSkillStore(
    (s) =>
      s.skillStates['core.media']?.nativeTrack?.id ||
      s.skillStates['core.media']?.nativeTrack?.title ||
      s.skillStates['core.media']?.song?.title ||
      ''
  );
  const queueStoreTrackId = useQueueStore((s) => s.currentTrack?.id || s.currentTrack?.title || '');
  const dropZoneCount = useDropZoneStore((s) => s.items.length);
  const hasDropItems = dropZoneCount > 0;
  const prevDropCountRef = useRef(dropZoneCount);
  const [dropPopTick, setDropPopTick] = useState(0);
  const effectiveTrackKey = `${blinkTrigger ?? ''}|${mediaSkillTrackTitle}|${queueStoreTrackId}`;
  const prevTrackKeyRef = useRef<string>(effectiveTrackKey);

  useEffect(() => {
    if (dropZoneCount > prevDropCountRef.current) {
      setDropPopTick((t) => t + 1);
    }
    prevDropCountRef.current = dropZoneCount;
  }, [dropZoneCount]);

  // Detect transition from 'sleep' / 'drowsy' -> 'awake' for wakeup spring micro-bounce
  useEffect(() => {
    const prev = prevMoodRef.current;
    prevMoodRef.current = mood;

    if ((prev === 'sleep' || prev === 'drowsy') && mood === 'awake') {
      setInternalBounce(true);
      const timer = setTimeout(() => setInternalBounce(false), 420);
      return () => clearTimeout(timer);
    }
  }, [mood]);

  // Gentle blink on track change
  useEffect(() => {
    if (prevTrackKeyRef.current !== effectiveTrackKey) {
      prevTrackKeyRef.current = effectiveTrackKey;
      if (mood !== 'sleep') {
        setIsBlinking(true);
        const timer = setTimeout(() => setIsBlinking(false), 160);
        return () => clearTimeout(timer);
      }
    }
  }, [effectiveTrackKey, mood]);

  // Periodic natural blink ONLY when awake/idle
  useEffect(() => {
    if (mood === 'sleep' || mood === 'drowsy') {
      setIsBlinking(false);
      return;
    }

    let blinkTimer: ReturnType<typeof setTimeout>;
    let openTimer: ReturnType<typeof setTimeout>;

    const scheduleBlink = () => {
      const delay = 4000 + Math.random() * 2400;
      blinkTimer = setTimeout(() => {
        setIsBlinking(true);
        openTimer = setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 120);
      }, delay);
    };

    scheduleBlink();
    return () => {
      clearTimeout(blinkTimer);
      clearTimeout(openTimer);
    };
  }, [mood]);

  const showBounce = propWakeupBounce || internalBounce;
  const isSleeping = mood === 'sleep';

  const targetScaleY = isBlinking
    ? 0.1
    : isSleeping
    ? 0.5
    : mood === 'drowsy'
    ? 0.68
    : 1;

  const scaleTransition = isBlinking
    ? { duration: 0.1, ease: 'easeInOut' as const }
    : isSleeping
    ? { duration: 1.1, ease: 'easeInOut' as const }
    : { type: 'spring' as const, stiffness: 420, damping: 24 };

  const svgSizeClass = size === 'sm' ? 'w-[10px] h-[10px]' : 'w-[15px] h-[15px]';
  const gapClass = size === 'sm' ? 'gap-2.5' : 'gap-[20px]';

  return (
    <motion.div
      initial={false}
      animate={showBounce ? { scale: [0.86, 1.1, 1] } : { scale: 1 }}
      transition={
        showBounce
          ? { type: 'spring', stiffness: 450, damping: 25, duration: 0.4 }
          : { type: 'spring', stiffness: 450, damping: 25 }
      }
      className={`inline-flex items-center justify-center select-none overflow-visible ${className}`}
    >
      <motion.div
        initial={false}
        animate={
          isSleeping
            ? { opacity: [0.20, 0.30, 0.20] }
            : mood === 'drowsy'
            ? { opacity: 0.65 }
            : { opacity: 1 }
        }
        transition={
          isSleeping
            ? { repeat: Infinity, duration: 4, ease: 'easeInOut' }
            : { duration: 0.28, ease: 'easeOut' }
        }
        className={`flex items-center justify-center ${gapClass}`}
      >
        {/* Mata Kiri: Crisp Pure White × (or ◈ when Drop Zone has items) */}
        <svg
          viewBox="0 0 18 18"
          data-drop-eye={hasDropItems ? 'true' : 'false'}
          className={`${svgSizeClass} overflow-visible`}
          aria-hidden="true"
        >
          <motion.g
            key={hasDropItems ? `compact-drop-${dropPopTick}` : 'compact-idle'}
            initial={hasDropItems ? { scale: 0.6, scaleY: targetScaleY } : false}
            animate={{ scale: 1, scaleY: targetScaleY }}
            transition={
              hasDropItems
                ? {
                    scale: { type: 'spring', stiffness: 520, damping: 18 },
                    scaleY: scaleTransition,
                  }
                : scaleTransition
            }
            style={{ originX: '9px', originY: '9px' }}
          >
            {hasDropItems ? (
              <>
                <path
                  d="M 9,2.2 L 15.8,9 L 9,15.8 L 2.2,9 Z"
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth="2.0"
                  strokeLinejoin="round"
                />
                <path
                  d="M 9,6.0 L 12.0,9 L 9,12.0 L 6.0,9 Z"
                  fill="#ffffff"
                />
              </>
            ) : (
              <path
                d="M 3.5,3.5 L 14.5,14.5 M 14.5,3.5 L 3.5,14.5"
                fill="none"
                stroke="#ffffff"
                strokeWidth="2.4"
                strokeLinecap="round"
              />
            )}
          </motion.g>
        </svg>

        {/* Mata Kanan: Crisp Pure White ♥ */}
        <svg viewBox="0 0 18 18" className={`${svgSizeClass} overflow-visible`} aria-hidden="true">
          <motion.g
            initial={false}
            animate={{ scaleY: targetScaleY }}
            transition={scaleTransition}
            style={{ originX: '9px', originY: '9px' }}
          >
            <path
              d="M 9,15.2 L 8.1,14.4 C 4.2,10.9 2.2,8.9 2.2,6.2 C 2.2,4.1 3.9,2.5 5.9,2.5 C 7.2,2.5 8.3,3.2 9,4.3 C 9.7,3.2 10.8,2.5 12.1,2.5 C 14.1,2.5 15.8,4.1 15.8,6.2 C 15.8,8.9 13.8,10.9 9.9,14.4 Z"
              fill="#ffffff"
            />
          </motion.g>
        </svg>
      </motion.div>
    </motion.div>
  );
});

CasaCompanionEyes.displayName = 'CasaCompanionEyes';
