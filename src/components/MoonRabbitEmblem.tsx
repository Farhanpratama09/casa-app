import React from 'react';

interface MoonRabbitEmblemProps {
  className?: string;
  size?: number;
}

/**
 * Cyber Moon Rabbit Emblem (Crescent Moon with Cyber Bunny Ears)
 */
export const MoonRabbitEmblem: React.FC<MoonRabbitEmblemProps> = ({
  className = '',
  size = 16,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={`text-cyan-400 drop-shadow-[0_0_6px_rgba(34,211,238,0.6)] shrink-0 select-none ${className}`}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-label="CASA Cyber Moon Rabbit Emblem"
    >
      {/* Siluet Bulan Sabit yang Menyilang Membentuk Telinga Kelinci */}
      <path d="M12 3c-1.2 0-2.4.3-3.5.9 1 .8 1.8 2 2.1 3.4.4 1.8-.2 3.6-1.5 4.8-1.3 1.2-3.1 1.7-4.8 1.3-.8-.2-1.5-.6-2.1-1.1.2 4.4 3.8 8 8.3 8 4.6 0 8.4-3.8 8.4-8.4 0-4.6-3.7-8.3-8.4-8.3" />
      {/* Telinga Kelinci Kembar Cyber Ramping */}
      <path d="M16 2.5c.8 1.2.6 3-.4 4.2M19.5 5c.4 1.5-.2 3.2-1.5 4" />
    </svg>
  );
};
