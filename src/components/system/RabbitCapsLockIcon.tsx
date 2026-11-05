import React from 'react';

export interface RabbitCapsLockIconProps extends React.SVGProps<SVGSVGElement> {
  size?: number;
  isActive?: boolean;
}

/**
 * RabbitCapsLockIcon:
 * Bespoke icon Caps Lock dengan siluet kelinci kosmik.
 * - Nonaktif: Siluet kepala kelinci dengan telinga rileks/tidur ke samping (text-zinc-500).
 * - Aktif: Siluet kelinci dengan telinga tegak tinggi menyala warna Cosmic Mauve (#c084fc), tanpa warna merah.
 */
export const RabbitCapsLockIcon: React.FC<RabbitCapsLockIconProps> = ({
  className = 'w-4 h-4',
  size = 24,
  isActive = false,
  ...props
}) => {
  const activeColor = '#c084fc';
  const inactiveColor = '#71717a';
  const strokeColor = isActive ? activeColor : inactiveColor;

  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {isActive ? (
        <React.Fragment>
          {/* ================================================================= */}
          {/* MODE AKTIF: Telinga Tegak Tinggi Menyala Cosmic Mauve             */}
          {/* ================================================================= */}
          {/* Telinga Kiri Tegak Tinggi */}
          <path
            d="M8.2 13.5 C7.2 8, 7.8 1.5, 9.8 1 C11 1.5, 10.8 8, 10 13.5"
            stroke={strokeColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: 'drop-shadow(0 0 4px rgba(192, 132, 252, 0.6))',
            }}
          />
          {/* Telinga Kanan Tegak Tinggi */}
          <path
            d="M13.8 13.5 C13 8, 13 1.5, 14.2 1 C16.2 1.5, 16.8 8, 15.8 13.5"
            stroke={strokeColor}
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{
              filter: 'drop-shadow(0 0 4px rgba(192, 132, 252, 0.6))',
            }}
          />
          {/* Mahkota / Inti Bintang Kosmik Amethyst di Antara Telinga */}
          <polygon
            points="12,14.5 13.8,17 12,19.5 10.2,17"
            fill={activeColor}
            style={{ filter: 'drop-shadow(0 0 5px #c084fc)' }}
          />
        </React.Fragment>
      ) : (
        <React.Fragment>
          {/* ================================================================= */}
          {/* MODE NONAKTIF: Telinga Rileks / Tidur Melipat ke Samping          */}
          {/* ================================================================= */}
          {/* Telinga Kiri Rileks Tidur */}
          <path
            d="M9 13.5 C6.5 13, 2.5 14, 2 16.5 C2.5 18.5, 7 17, 9.5 15"
            stroke={strokeColor}
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Telinga Kanan Rileks Tidur */}
          <path
            d="M15 13.5 C17.5 13, 21.5 14, 22 16.5 C21.5 18.5, 17 17, 14.5 15"
            stroke={strokeColor}
            strokeWidth="1.3"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Inti Node Tenang */}
          <circle cx="12" cy="17" r="1.3" fill={strokeColor} opacity="0.5" />
        </React.Fragment>
      )}

      {/* =================================================================== */}
      {/* Busur Kepala Kelinci di Bagian Bawah                                */}
      {/* =================================================================== */}
      <path
        d="M6 14 C6 11, 18 11, 18 14 C18 18, 6 18, 6 14 Z"
        stroke={strokeColor}
        strokeWidth="1.3"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill={isActive ? activeColor : 'none'}
        fillOpacity={isActive ? 0.12 : 0}
      />
    </svg>
  );
};
