import React, { memo } from 'react';

export interface VinylDiscFallbackProps {
  isPlaying?: boolean;
}

export const VinylDiscFallback: React.FC<VinylDiscFallbackProps> = memo(({ isPlaying = false }) => (
  <div
    className="relative w-full h-full rounded-[10px] bg-[#111111] overflow-hidden flex items-center justify-center border border-white/10 shadow-inner select-none"
    title="Vinyl Record"
  >
    {/* Concentric vinyl groove rings */}
    <div
      className={`absolute inset-1 rounded-full border border-white/[0.07] ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    />
    <div
      className={`absolute inset-2.5 rounded-full border border-white/[0.05] ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    />
    <div
      className={`absolute inset-4 rounded-full border border-white/[0.04] ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    />

    {/* Center vinyl label (Monochromatic luxury hardware disc) */}
    <div
      className={`relative w-[20px] h-[20px] rounded-full bg-gradient-to-tr from-white/20 via-white/10 to-white/5 border border-white/20 flex items-center justify-center shadow-md ${
        isPlaying ? 'animate-[spin_10s_linear_infinite]' : ''
      }`}
    >
      {/* Center spindle hole */}
      <div className="w-[5px] h-[5px] rounded-full bg-black border border-white/40" />
    </div>
  </div>
));

VinylDiscFallback.displayName = 'VinylDiscFallback';
