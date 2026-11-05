import React, { memo } from 'react';
import { motion } from 'framer-motion';
import type { CompanionMood } from '../../hooks/useCompanionMood';
import { useSkillStore } from '../../skills/store';

export interface CasaCompanionAvatarProps {
  isPlaying?: boolean;
  mood?: CompanionMood;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * CasaCompanionAvatar (Status Bar & Header Companion)
 * - Saat isPlaying === false (Idle Status Bar Mode):
 *   Telinga kelinci neon + sepasang mata bulan sabit vertikal (C & Ɔ) dengan retikel mikro ✕ & ♥
 *   (TANPA outline kotak/topeng).
 * - Saat isPlaying === true (Mode Dengar Lagu):
 *   Telinga kelinci neon + Cyber Headphone (bando & earcup) + Mata Senyum Bahagia ( ˘ ‿ ˘ ) + Head-Bobbing.
 */
export const CasaCompanionAvatar: React.FC<CasaCompanionAvatarProps> = memo(({
  isPlaying: propIsPlaying,
  className = '',
}) => {
  // Subscribe to global media playback state if isPlaying prop is not explicitly provided
  const storeIsPlaying = useSkillStore((s) => {
    const media = s.skillStates['core.media'];
    if (!media) return false;
    if (media.playbackSource === 'native') {
      return Boolean(media.isNativePlaying && media.nativeTrack);
    }
    return Boolean(media.song?.isPlaying && media.song?.title && media.song.title.trim() !== '');
  });

  const isPlaying = propIsPlaying !== undefined ? propIsPlaying : storeIsPlaying;

  return (
    <motion.div
      initial={false}
      animate={
        isPlaying
          ? { y: [0, -1.5, 0], scale: 1 }
          : { y: 0, scale: 1 }
      }
      transition={
        isPlaying
          ? { repeat: Infinity, duration: 1.2, ease: 'easeInOut' }
          : { type: 'spring', stiffness: 450, damping: 25 }
      }
      className={`relative inline-flex items-center justify-center shrink-0 select-none overflow-visible ${className}`}
      title={isPlaying ? 'CASA Cyber Moon Rabbit (Vibing)' : 'CASA Cyber Moon Rabbit (Standby)'}
    >
      {isPlaying ? (
        /* Mode Dengar Lagu (isPlaying === true): Telinga Kelinci + Cyber Headphone + Mata Bahagia ( ˘ ‿ ˘ ) */
        <svg
          viewBox="0 -2 40 30"
          className="w-7 h-6 drop-shadow-[0_0_8px_rgba(34,211,238,0.7)] shrink-0 overflow-visible"
        >
          {/* 1. Sepasang Telinga Kelinci Neon */}
          <path
            d="M 14,11 C 11,3 15,1.5 17,7.5"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <path
            d="M 26,11 C 29,3 25,1.5 23,7.5"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* 2. Cyber Headphone (Bando + Earcup Kiri & Kanan) */}
          <path
            d="M 4.5,16.5 C 4.5,-1.2 35.5,-1.2 35.5,16.5"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.7"
            strokeLinecap="round"
          />
          <rect x="2.2" y="13.2" width="3" height="9" rx="1.5" fill="#22d3ee" />
          <rect x="34.8" y="13.2" width="3" height="9" rx="1.5" fill="#22d3ee" />

          {/* 3. Ekspresi Mata Bahagia Menyipit Gembira ( ˘ ‿ ˘ ) */}
          <path
            d="M 9.8,19.8 C 10.2,14.2 17.6,14.2 18.0,19.8 C 16.2,17.0 11.6,17.0 9.8,19.8 Z"
            fill="#22d3ee"
          />
          <path
            d="M 22.0,19.8 C 22.4,14.2 29.8,14.2 30.2,19.8 C 28.4,17.0 23.8,17.0 22.0,19.8 Z"
            fill="#22d3ee"
          />
        </svg>
      ) : (
        /* Mode Idle Status Bar (isPlaying === false): Wajah Kelinci Cyber (Telinga Sejajar + Sabit Montok + Retikel ✕ & ♥) */
        <svg
          viewBox="0 0 24 24"
          className="w-[20px] h-[20px] drop-shadow-[0_0_6px_rgba(34,211,238,0.85)] shrink-0 overflow-visible"
        >
          {/* 1. Sepasang Telinga Kelinci Tegak & Ramping (Sejajar Sumbu Mata X=7.5 & X=16.5) */}
          <path
            d="M 7.5,9.5 C 5.0,2.0 8.5,1.0 10.0,6.5"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M 16.5,9.5 C 19.0,2.0 15.5,1.0 14.0,6.5"
            fill="none"
            stroke="#22d3ee"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          {/* 2. MATA KIRI: Bulan Sabit C + Retikel Silang ✕ (X=10.2, Y=14.5) */}
          <path
            d="M 9.5,11.5 C 5.5,11.5 5.5,17.5 9.5,17.5 C 7.2,16.0 7.2,13.0 9.5,11.5 Z"
            fill="#22d3ee"
          />
          <path
            d="M 9.6,13.8 L 11.0,15.2 M 11.0,13.8 L 9.6,15.2"
            stroke="#ffffff"
            strokeWidth="1.1"
            strokeLinecap="round"
          />

          {/* 3. MATA KANAN: Bulan Sabit Ɔ + Retikel Hati ♥ (X=13.8, Y=14.5) */}
          <path
            d="M 14.5,11.5 C 18.5,11.5 18.5,17.5 14.5,17.5 C 16.8,16.0 16.8,13.0 14.5,11.5 Z"
            fill="#22d3ee"
          />
          <path
            d="M 13.8,15.6 L 13.0,14.8 C 12.3,14.1 12.1,13.7 12.1,13.3 C 12.1,12.8 12.5,12.5 12.9,12.5 C 13.2,12.5 13.5,12.7 13.8,13.0 C 14.1,12.7 14.4,12.5 14.7,12.5 C 15.1,12.5 15.5,12.8 15.5,13.3 C 15.5,13.7 15.3,14.1 14.6,14.8 Z"
            fill="#ffffff"
          />
        </svg>
      )}
    </motion.div>
  );
});

CasaCompanionAvatar.displayName = 'CasaCompanionAvatar';
