import React from 'react';
import { cosmicTokens } from '../theme/cosmicTokens';

interface CarrotPinProps {
  isPinned: boolean;
  onClick: () => void;
}

/**
 * Prismatic Cosmic Carrot Pin
 * Komponen ikon pin khusus bertema Kelinci Bulan berupa kristal prisma geometris bersudut tajam (stealth facet).
 * - Saat disematkan (isPinned): Crystal Carrot Amethyst (#c084fc) dengan pendar kosmik ungu.
 * - Saat tidak aktif: Abu-abu netral (#52525b).
 */
export const CosmicCarrotPin: React.FC<CarrotPinProps> = ({ isPinned, onClick }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-1 rounded hover:bg-white/[0.06] transition-all cursor-pointer group"
      title={isPinned ? "Lepas sematan tugas" : "Sematkan tugas ke atas"}
      aria-label={isPinned ? "Lepas sematan tugas" : "Sematkan tugas ke atas"}
    >
      <svg
        className="w-3.5 h-3.5 transition-all duration-200"
        style={{
          color: isPinned ? cosmicTokens.productivity.carrotActive : cosmicTokens.productivity.carrotInactive,
          filter: isPinned ? `drop-shadow(${cosmicTokens.productivity.carrotGlow})` : 'none',
        }}
        viewBox="0 0 16 16"
        fill={isPinned ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      >
        {/* Daun Kristal Mikro (3 Facets) */}
        <path d="M8 1 L8 4" />
        <path d="M5.5 2 L7.5 4" />
        <path d="M10.5 2 L8.5 4" />
        {/* Badan Prisma Wortel Runcing */}
        <polygon points="5,4 11,4 8.5,14 7.5,14" />
        {/* Garis Aksen Facet Tengah saat Terisi */}
        {isPinned && <line x1="8" y1="4" x2="8" y2="12" stroke="#09090b" strokeWidth="0.8" />}
      </svg>
    </button>
  );
};
