import React from 'react';

export interface CosmicSpeakerRabbitIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  isMuted?: boolean;
}

/**
 * CosmicSpeakerRabbitIcon:
 * Bespoke icon siluet kelinci kosmik memegang megaphone/corong suara mini untuk kontrol volume.
 * - Saat Aktif: Telinga kelinci tegak anggun ke atas dengan gelombang suara memancar dari corong.
 * - Saat Mute: Telinga kelinci melipat turun ke bawah dengan garis diagonal abu-abu netral (#71717a).
 */
export const CosmicSpeakerRabbitIcon: React.FC<CosmicSpeakerRabbitIconProps> = ({
  className = 'w-4 h-4',
  size = 24,
  isMuted = false,
  ...props
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    {...props}
  >
    {/* =================================================================== */}
    {/* Telinga Kelinci Kosmik                                             */}
    {/* =================================================================== */}
    {!isMuted ? (
      <React.Fragment>
        {/* Telinga Kiri Tegak Anggun */}
        <path
          d="M4.8 11.5 C3.8 7, 4.2 2.2, 5.8 1.5 C7 2, 6.8 7, 6.2 11.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Telinga Kanan Tegak Anggun */}
        <path
          d="M7.8 11.5 C7.2 6.5, 7.8 2.2, 9.2 1.8 C10.4 2.2, 9.8 7, 9 11.5"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </React.Fragment>
    ) : (
      <React.Fragment>
        {/* Saat Mute: Telinga Melipat Turun ke Bawah */}
        <path
          d="M5.5 11 C3.5 12.2, 2 14.5, 2.5 16.5 C3.2 17, 5 15, 6 12.5"
          stroke="#71717a"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <path
          d="M7.5 11 C6.2 13, 5 15.5, 5.5 17.2 C6.5 17.5, 7.8 15.5, 8.2 12.5"
          stroke="#71717a"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </React.Fragment>
    )}

    {/* =================================================================== */}
    {/* Kepala Kelinci Mikro                                                */}
    {/* =================================================================== */}
    <path
      d="M3.5 17 C3 14, 4.5 11.5, 7 11.5 C9.5 11.5, 10.5 14, 10 17 C9.5 18.5, 4.5 18.5, 3.5 17 Z"
      stroke={isMuted ? '#71717a' : 'currentColor'}
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Titik Mata Kelinci Kosmik */}
    <circle
      cx="6"
      cy="14"
      r="0.8"
      fill={isMuted ? '#71717a' : 'currentColor'}
    />

    {/* =================================================================== */}
    {/* Megaphone / Corong Suara Mini                                       */}
    {/* =================================================================== */}
    {/* Badan Corong Megaphone */}
    <path
      d="M9 13.5 L14.5 9.5 V18.5 L9 14.5 Z"
      stroke={isMuted ? '#71717a' : 'currentColor'}
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill={isMuted ? 'transparent' : 'currentColor'}
      fillOpacity={isMuted ? 0 : 0.15}
    />
    {/* Gagang / Handle Megaphone */}
    <path
      d="M9.5 14.5 L8.5 17"
      stroke={isMuted ? '#71717a' : 'currentColor'}
      strokeWidth="1.2"
      strokeLinecap="round"
    />

    {/* =================================================================== */}
    {/* Gelombang Suara (Aktif) / Garis Diagonal Mute (Muted)               */}
    {/* =================================================================== */}
    {!isMuted ? (
      <React.Fragment>
        {/* Inner Soundwave Arc */}
        <path
          d="M17 11 C18 12.2 18 15.8 17 17"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        />
        {/* Outer Soundwave Arc */}
        <path
          d="M19.5 9 C21.5 11 21.5 17 19.5 19"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
          opacity="0.8"
        />
      </React.Fragment>
    ) : (
      /* Garis Diagonal Mute Abu-Abu Netral (#71717a) */
      <line
        x1="3"
        y1="21"
        x2="21"
        y2="3"
        stroke="#71717a"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    )}
  </svg>
);
