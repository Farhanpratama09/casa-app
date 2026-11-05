import React, { useEffect, useRef, useState, memo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { CompanionMood } from '../../hooks/useCompanionMood';
import { useSkillStore } from '../../skills/store';
import { useQueueStore } from '../../stores/useQueueStore';

export interface CasaCompanionEyesProps {
  size?: 'sm' | 'md';
  mood?: CompanionMood;
  isWakeupBounce?: boolean;
  blinkTrigger?: string | number;
  className?: string;
}

/**
 * CasaCompanionEyes (Mode Resting: Dead-Center Visor + Bulan Sabit Vertikal + Retikel ✕ & ♥)
 * - Bingkai Visor Poligonal Transparan dead-center (titik pusat 16, 16).
 * - Mata Kiri: Bulan Sabit Vertikal C Padat + Retikel Silang ✕ di cekungan sabit.
 * - Mata Kanan: Bulan Sabit Vertikal Ɔ Padat + Retikel Hati ♥ di cekungan sabit.
 * - Mode Tidur (sleep): Sepasang kurva tidur damai terpisah ( ◡ ) ( ◡ ).
 */
export const CasaCompanionEyes: React.FC<CasaCompanionEyesProps> = memo(({
  size = 'md',
  mood = 'idle',
  isWakeupBounce: propWakeupBounce = false,
  blinkTrigger,
  className = '',
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const prevMoodRef = useRef<CompanionMood>(mood);

  const [internalBounce, setInternalBounce] = useState(false);
  const [isBlinking, setIsBlinking] = useState(false);
  const [gazeOffset, setGazeOffset] = useState({ x: 0, y: 0 });

  // Subscribe to current playing track for gentle track-change blink
  const mediaSkillTrackTitle = useSkillStore(
    (s) =>
      s.skillStates['core.media']?.nativeTrack?.id ||
      s.skillStates['core.media']?.nativeTrack?.title ||
      s.skillStates['core.media']?.song?.title ||
      ''
  );
  const queueStoreTrackId = useQueueStore((s) => s.currentTrack?.id || s.currentTrack?.title || '');
  const effectiveTrackKey = `${blinkTrigger ?? ''}|${mediaSkillTrackTitle}|${queueStoreTrackId}`;
  const prevTrackKeyRef = useRef<string>(effectiveTrackKey);

  // Detect transition from 'sleep' / 'drowsy' -> 'awake' for wakeup spring micro-bounce
  useEffect(() => {
    const prev = prevMoodRef.current;
    prevMoodRef.current = mood;

    if ((prev === 'sleep' || prev === 'drowsy') && mood === 'awake') {
      setInternalBounce(true);
      const timer = setTimeout(() => setInternalBounce(false), 480);
      return () => clearTimeout(timer);
    }
  }, [mood]);

  // Gentle blink on track change
  useEffect(() => {
    if (prevTrackKeyRef.current !== effectiveTrackKey) {
      prevTrackKeyRef.current = effectiveTrackKey;
      if (mood !== 'sleep') {
        setIsBlinking(true);
        const timer = setTimeout(() => setIsBlinking(false), 200);
        return () => clearTimeout(timer);
      }
    }
  }, [effectiveTrackKey, mood]);

  // Periodic natural blink when in 'awake' or 'idle' state
  useEffect(() => {
    if (mood === 'sleep' || mood === 'drowsy') {
      setIsBlinking(false);
      return;
    }

    let blinkTimer: ReturnType<typeof setTimeout>;
    let openTimer: ReturnType<typeof setTimeout>;

    const scheduleBlink = () => {
      const delay = 3800 + Math.random() * 2400;
      blinkTimer = setTimeout(() => {
        setIsBlinking(true);
        openTimer = setTimeout(() => {
          setIsBlinking(false);
          scheduleBlink();
        }, 140);
      }, delay);
    };

    scheduleBlink();
    return () => {
      clearTimeout(blinkTimer);
      clearTimeout(openTimer);
    };
  }, [mood]);

  // Subtle fluid cursor tracking for 'md' resting pill when awake/idle
  useEffect(() => {
    if (size !== 'md' || mood === 'sleep' || mood === 'drowsy') {
      setGazeOffset({ x: 0, y: 0 });
      return;
    }

    let resetTimer: ReturnType<typeof setTimeout>;

    const handleMouseMove = (e: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = e.clientX - cx;
      const dy = e.clientY - cy;
      const dist = Math.hypot(dx, dy);

      if (dy > 320 || dist > 460) {
        setGazeOffset({ x: 0, y: 0 });
        return;
      }

      const angle = Math.atan2(dy, dx);
      const intensity = Math.min(dist / 130, 1);
      setGazeOffset({
        x: Math.cos(angle) * intensity * 1.2,
        y: Math.sin(angle) * intensity * 0.9,
      });

      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => {
        setGazeOffset({ x: 0, y: 0 });
      }, 2600);
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      clearTimeout(resetTimer);
    };
  }, [size, mood]);

  const showBounce = propWakeupBounce || internalBounce;

  const targetScaleY = isBlinking
    ? 0.12
    : mood === 'awake'
    ? 1
    : mood === 'idle'
    ? 1
    : mood === 'drowsy'
    ? 0.55
    : 0.2;

  const targetOpacity =
    mood === 'awake'
      ? 1
      : mood === 'idle'
      ? 0.95
      : mood === 'drowsy'
      ? 0.65
      : 0.4;

  const eyeTransition = isBlinking
    ? { duration: 0.11, ease: 'easeInOut' as const }
    : mood === 'awake'
    ? { type: 'spring' as const, stiffness: 450, damping: 25 }
    : mood === 'drowsy'
    ? { duration: 1.2, ease: 'easeInOut' as const }
    : { type: 'spring' as const, stiffness: 360, damping: 28 };

  const svgSizeClass = size === 'sm' ? 'w-7 h-[18px]' : 'w-[44px] h-[26px]';
  const gapClass = size === 'sm' ? 'gap-2.5' : 'gap-[14px]';

  return (
    <motion.div
      ref={containerRef}
      initial={false}
      animate={showBounce ? { scale: [0.8, 1.15, 1] } : { scale: 1 }}
      transition={
        showBounce
          ? { type: 'spring', stiffness: 450, damping: 25, duration: 0.42 }
          : { type: 'spring', stiffness: 450, damping: 25 }
      }
      className={`inline-flex items-center justify-center select-none overflow-visible ${gapClass} ${className}`}
    >
      <AnimatePresence mode="wait" initial={false}>
        {mood === 'sleep' ? (
          /* Mode Tidur Damai: Sepasang kurva tidur damai terpisah ( ◡ )   ( ◡ ) dengan breathing glow */
          <motion.div
            key="sleep-eyes"
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.35, ease: 'easeInOut' }}
            className="flex items-center justify-center gap-4 overflow-visible"
          >
            <motion.div
              animate={{ opacity: [0.35, 0.75, 0.35] }}
              transition={{ repeat: Infinity, duration: 3.5, ease: 'easeInOut' }}
              className="flex items-center justify-center gap-4 overflow-visible"
            >
              <svg
                viewBox="0 0 24 16"
                className="w-5 h-3.5 drop-shadow-[0_0_8px_rgba(34,211,238,0.75)] overflow-visible"
              >
                <path
                  d="M 2,4 Q 12,14 22,4"
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
              <svg
                viewBox="0 0 24 16"
                className="w-5 h-3.5 drop-shadow-[0_0_8px_rgba(34,211,238,0.75)] overflow-visible"
              >
                <path
                  d="M 2,4 Q 12,14 22,4"
                  fill="none"
                  stroke="#22d3ee"
                  strokeWidth="2.6"
                  strokeLinecap="round"
                />
              </svg>
            </motion.div>
          </motion.div>
        ) : (
          /* Mode Resting: Dead-Center Visor + Bulan Sabit Vertikal (C & Ɔ) + Retikel ✕ & ♥ */
          <motion.div
            key="awake-dead-center-eyes"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.94 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className={`flex items-center justify-center ${gapClass}`}
          >
            {/* MATA KIRI: Visor Panoramik 44x26 + Bulan Sabit C Montok + Retikel ✕ di Focal Center */}
            <svg
              viewBox="0 0 44 26"
              className={`${svgSizeClass} drop-shadow-[0_0_8px_rgba(34,211,238,0.85)] overflow-visible`}
            >
              {/* Bingkai Visor Chamfered Horizontal 45° */}
              <path
                d="M 9,3 L 35,3 L 41,9 L 41,17 L 35,23 L 9,23 L 3,17 L 3,9 Z"
                fill="rgba(34,211,238,0.04)"
                stroke="#22d3ee"
                strokeWidth="1.2"
                strokeOpacity="0.45"
                strokeLinejoin="round"
              />
              <motion.g
                initial={false}
                animate={{
                  scaleY: targetScaleY,
                  opacity: targetOpacity,
                  x: gazeOffset.x,
                  y: gazeOffset.y,
                }}
                transition={eyeTransition}
                style={{ originX: '22px', originY: '13px' }}
              >
                {/* Bulan Sabit C Padat (Menempati X=8 sampai X=24, Tebal Perut ~8 Unit) */}
                <path
                  d="M 24,5 C 8,5 8,21 24,21 C 16.5,18.5 16.5,7.5 24,5 Z"
                  fill="#22d3ee"
                />
                {/* Retikel ✕ Cyan Bercahaya di Focal Center (X=24.5, Y=13) - Jarak Aman 6+ Unit */}
                <path
                  d="M 23,11.5 L 26,14.5 M 26,11.5 L 23,14.5"
                  stroke="#a5f3fc"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </motion.g>
            </svg>

            {/* MATA KANAN: Visor Panoramik 44x26 + Bulan Sabit Ɔ Montok + Retikel ♥ di Focal Center */}
            <svg
              viewBox="0 0 44 26"
              className={`${svgSizeClass} drop-shadow-[0_0_8px_rgba(34,211,238,0.85)] overflow-visible`}
            >
              {/* Bingkai Visor Chamfered Horizontal Simetris */}
              <path
                d="M 9,3 L 35,3 L 41,9 L 41,17 L 35,23 L 9,23 L 3,17 L 3,9 Z"
                fill="rgba(34,211,238,0.04)"
                stroke="#22d3ee"
                strokeWidth="1.2"
                strokeOpacity="0.45"
                strokeLinejoin="round"
              />
              <motion.g
                initial={false}
                animate={{
                  scaleY: targetScaleY,
                  opacity: targetOpacity,
                  x: gazeOffset.x,
                  y: gazeOffset.y,
                }}
                transition={eyeTransition}
                style={{ originX: '22px', originY: '13px' }}
              >
                {/* Bulan Sabit Ɔ Padat Simetris (Menempati X=36 sampai X=20) */}
                <path
                  d="M 20,5 C 36,5 36,21 20,21 C 27.5,18.5 27.5,7.5 20,5 Z"
                  fill="#22d3ee"
                />
                {/* Retikel ♥ Cyan Bercahaya di Focal Center (X=19.5, Y=13) - Jarak Aman 6+ Unit */}
                <path
                  d="M 19.5,15.0 L 18.8,14.3 C 17.6,13.1 17.3,12.3 17.3,11.7 C 17.3,11.0 17.8,10.6 18.4,10.6 C 18.8,10.6 19.2,10.8 19.5,11.1 C 19.8,10.8 20.2,10.6 20.6,10.6 C 21.2,10.6 21.7,11.0 21.7,11.7 C 21.7,12.3 21.4,13.1 20.2,14.3 Z"
                  fill="#a5f3fc"
                />
              </motion.g>
            </svg>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

CasaCompanionEyes.displayName = 'CasaCompanionEyes';
