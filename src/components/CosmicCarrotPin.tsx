import React from 'react';

interface CarrotPinProps {
  isPinned: boolean;
  onClick: () => void;
}

/**
 * Prismatic Cosmic Carrot Pin
 * Komponen ikon pin khusus bertema Kelinci Bulan berupa kristal prisma geometris bersudut tajam (stealth facet).
 */
export const CosmicCarrotPin: React.FC<CarrotPinProps> = ({ isPinned, onClick }) => {
  return (
    <button
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
      className="p-1 rounded hover:bg-white/[0.06] transition-all cursor-pointer group"
      title={isPinned ? "Unpin task" : "Pin to top"}
      aria-label={isPinned ? "Unpin task" : "Pin to top"}
    >
      <svg
        className={`w-3.5 h-3.5 transition-all duration-200 ${
          isPinned
            ? "text-indigo-300 drop-shadow-[0_0_8px_rgba(129,140,248,0.6)]"
            : "text-white/20 group-hover:text-white/50"
        }`}
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
        {isPinned && <line x1="8" y1="4" x2="8" y2="12" stroke="#090D16" strokeWidth="0.8" />}
      </svg>
    </button>
  );
};
