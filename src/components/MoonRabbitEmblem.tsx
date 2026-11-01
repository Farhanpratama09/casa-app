import React from 'react';

interface MoonRabbitEmblemProps {
  className?: string;
  size?: number;
}

export const MoonRabbitEmblem: React.FC<MoonRabbitEmblemProps> = ({
  className = '',
  size = 18,
}) => {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 20 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={`shrink-0 select-none ${className}`}
      style={{
        filter: 'drop-shadow(0 0 5px rgba(152, 187, 214, 0.45))',
      }}
      aria-label="Sasha Moon Rabbit Emblem"
    >
      <defs>
        <linearGradient id="moonArcGrad" x1="2" y1="2" x2="18" y2="18" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#98BBD6" stopOpacity="0.95" />
          <stop offset="100%" stopColor="#6C8EA8" stopOpacity="0.4" />
        </linearGradient>
      </defs>

      {/* 1. Crescent Moon Arc hugging rabbit from left to lower base */}
      <path
        d="M 9.5 2 C 5.5 2.2 2 5.8 2 10.2 C 2 14.6 5.6 18.2 10 18.2 C 12.8 18.2 15.3 16.7 16.6 14.5 C 13.8 15.3 10.6 14.5 8.7 12.4 C 6.8 10.3 6.6 7.2 8 4.6 C 8.5 3.7 9 3 9.5 2 Z"
        fill="url(#moonArcGrad)"
      />

      {/* 2. Rabbit Head Base */}
      <circle cx="11.8" cy="11.2" r="3.8" fill="#FFFFFF" fillOpacity="0.92" />

      {/* 3. Left Upright Ear: Sharp Cyber Blade with Ice Blue Core */}
      <path
        d="M 9.5 8.2 L 9.2 3.2 C 9.2 2.7 9.8 2.4 10.2 2.8 L 11.6 8.0 Z"
        fill="#FFFFFF"
        fillOpacity="0.95"
      />
      {/* Neon Ice Blue Core Stripe */}
      <line
        x1="9.8"
        y1="3.6"
        x2="10.4"
        y2="7.4"
        stroke="#98BBD6"
        strokeWidth="0.9"
        strokeLinecap="round"
      />

      {/* 4. Right Ear: Floppy Lop-Ear folded over */}
      <path
        d="M 13.2 8.0 C 14.2 7.6 15.6 8.4 15.8 9.8 C 16.0 11.2 15.2 12.6 14.4 12.8 C 13.8 13.0 13.2 12.2 13.2 11.4 Z"
        fill="#E2E8F0"
        fillOpacity="0.92"
      />
      {/* Silver Cyber Hoop Ring on Floppy Ear */}
      <circle
        cx="15.2"
        cy="11.2"
        r="1.2"
        stroke="#98BBD6"
        strokeWidth="0.75"
        fill="none"
      />

      {/* 5. Minimalist Facial Features */}
      {/* Left eye: cross (✖) */}
      <path
        d="M 9.9 10.4 L 10.9 11.4 M 10.9 10.4 L 9.9 11.4"
        stroke="#98BBD6"
        strokeWidth="0.7"
        strokeLinecap="round"
      />
      {/* Right eye: tiny tareme dot / heart */}
      <circle cx="13.1" cy="10.9" r="0.6" fill="#98BBD6" />
    </svg>
  );
};
