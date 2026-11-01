import React from 'react';

interface TacticalLunarGlyphProps {
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Tactical Lunar Glyph (14x14px, stroke 1.3-1.5)
 * Komponen SVG custom bergaya stealth/taktikal:
 * - Siluet telinga kelinci geometris minimalis (garis sudut tajam stealth).
 * - Cincin orbit elips presisi.
 * - Titik pendar kecil (orbital node) di lintasan orbitnya.
 */
export const TacticalLunarGlyph: React.FC<TacticalLunarGlyphProps> = ({
  className = 'w-3.5 h-3.5',
  style,
}) => (
  <svg
    viewBox="0 0 14 14"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={`shrink-0 select-none ${className}`}
    style={style}
    aria-label="Tactical Lunar Glyph"
  >
    {/* 1. Siluet Telinga Kelinci Geometris Bergaya Stealth/Taktikal */}
    <path
      d="M3.6 6.2 L4.8 1.4 L6.0 6.0 M8.0 6.0 L9.2 1.4 L10.4 6.2"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Subtle stealth interior facet shading */}
    <path
      d="M3.6 6.2 L4.8 1.4 L6.0 6.0 Z M8.0 6.0 L9.2 1.4 L10.4 6.2 Z"
      fill="currentColor"
      fillOpacity="0.22"
    />

    {/* 2. Cincin Orbit Elips Presisi */}
    <ellipse
      cx="7"
      cy="7.8"
      rx="5.6"
      ry="3.8"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
    />

    {/* 3. Titik Pendar Kecil (Orbital Node) di Lintasan Orbit */}
    <circle cx="12.4" cy="7.3" r="1.1" fill="currentColor" />
  </svg>
);

// Alias untuk kompatibilitas import yang sudah ada
export const LunarBunnyGlyph = TacticalLunarGlyph;
