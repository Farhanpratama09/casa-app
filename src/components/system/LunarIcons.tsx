import React from 'react';
import { CosmicSpeakerRabbitIcon, CosmicSpeakerRabbitIconProps } from './CosmicSpeakerRabbitIcon';
import { RabbitCapsLockIcon, RabbitCapsLockIconProps } from './RabbitCapsLockIcon';

export { CosmicSpeakerRabbitIcon, RabbitCapsLockIcon };
export type { CosmicSpeakerRabbitIconProps, RabbitCapsLockIconProps };

export interface LunarIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
  isMuted?: boolean;
  isActive?: boolean;
}

export const MoonCraterSpeaker = CosmicSpeakerRabbitIcon;
export const AlertBunnyCaps = RabbitCapsLockIcon;

/**
 * BunnyHeadphonesWired:
 * Headphone over-ear ramping dengan bando membentuk siluet telinga kelinci ganda tajam
 * dan aksen kabel berpilin neon tipis.
 */
export const BunnyHeadphonesWired: React.FC<LunarIconProps> = ({
  className = 'w-4 h-4',
  size = 24,
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
    {/* Left Bunny Ear Headband Silhouette */}
    <path
      d="M7 11.5 C6.5 7.5, 7.2 2, 8.8 1.5 C10 2, 10.2 6.5, 9.8 10.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Right Bunny Ear Headband Silhouette */}
    <path
      d="M14.2 10.5 C13.8 6.5, 14 2, 15.2 1.5 C16.8 2, 17.5 7.5, 17 11.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Arch Headband Base */}
    <path
      d="M5 12 C5 6.5, 19 6.5, 19 12"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      opacity="0.85"
    />
    {/* Left Earcup */}
    <rect
      x="2.5"
      y="11.5"
      width="3.8"
      height="7.5"
      rx="1.9"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    {/* Right Earcup */}
    <rect
      x="17.7"
      y="11.5"
      width="3.8"
      height="7.5"
      rx="1.9"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    {/* Twisted Neon Cyber Wire from left earcup */}
    <path
      d="M4.4 19 C4.4 21, 2.5 21, 3 22.5 C3.5 23.8, 5.5 23.2, 5.5 24.5"
      stroke="#38BDF8"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.9"
    />
  </svg>
);

/**
 * BunnyHeadphonesBluetooth:
 * Siluet telinga kelinci cybernetic yang memancarkan 2 cincin orbit stardust
 * (lunar pulse waves) di puncaknya dengan aksen #38BDF8.
 */
export const BunnyHeadphonesBluetooth: React.FC<LunarIconProps> = ({
  className = 'w-4 h-4',
  size = 24,
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
    {/* 2 Stardust Orbit Rings (Lunar Pulse Waves) at Apex */}
    <path
      d="M9.5 2.2 A 3 2 0 0 1 14.5 2.2"
      stroke="#38BDF8"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      d="M7.8 0.5 A 5 3 0 0 1 16.2 0.5"
      stroke="#38BDF8"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeOpacity="0.6"
      strokeDasharray="1.5 1.5"
    />
    {/* Pulse Apex Center Node */}
    <circle cx="12" cy="4" r="0.8" fill="#38BDF8" />

    {/* Left Cyber Bunny Ear */}
    <path
      d="M7.2 11.5 C6.8 8, 7.5 3.5, 9 3 C10 3.5, 10.2 7.5, 9.8 11"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Right Cyber Bunny Ear */}
    <path
      d="M14.2 11 C13.8 7.5, 14 3.5, 15 3 C16.5 3.5, 17.2 8, 16.8 11.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Headband */}
    <path
      d="M5 12 C5 6.5, 19 6.5, 19 12"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      opacity="0.85"
    />
    {/* Left Earcup */}
    <rect
      x="2.5"
      y="11.5"
      width="3.8"
      height="7.5"
      rx="1.9"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="1.3"
    />
    {/* Right Earcup */}
    <rect
      x="17.7"
      y="11.5"
      width="3.8"
      height="7.5"
      rx="1.9"
      fill="currentColor"
      fillOpacity="0.25"
      stroke="currentColor"
      strokeWidth="1.3"
    />
  </svg>
);

/**
 * StardustBatteryCapsule:
 * Tabung kaca kapsul kosmik; saat is_charging, tampilkan pendar aurora emerald (#34D399)
 * dengan indikator petir halus.
 */
export interface StardustBatteryCapsuleProps extends LunarIconProps {
  percentage?: number;
  isCharging?: boolean;
}

export const StardustBatteryCapsule: React.FC<StardustBatteryCapsuleProps> = ({
  className = 'w-5 h-3',
  size = 24,
  percentage = 100,
  isCharging = false,
  ...props
}) => {
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const fillWidth = Math.max(1, (clamped / 100) * 13.5);

  const isLow = clamped <= 20 && !isCharging;
  const fillColor = isCharging
    ? '#34D399'
    : isLow
    ? '#F43F5E'
    : '#98BBD6';

  return (
    <svg
      viewBox="0 0 24 14"
      width={size}
      height={(size * 14) / 24}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      {...props}
    >
      {/* Outer Glass Capsule */}
      <rect
        x="1"
        y="1"
        width="18.5"
        height="12"
        rx="4"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeOpacity="0.5"
      />
      {/* Terminal Cap (Anode) */}
      <path
        d="M21 4.5 C22 4.5, 22.5 5.2, 22.5 7 C22.5 8.8, 22 9.5, 21 9.5"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
        strokeOpacity="0.6"
      />

      {/* Fluid / Stardust Level Fill */}
      <rect
        x="2.5"
        y="2.5"
        width={fillWidth}
        height="9"
        rx="2.5"
        fill={fillColor}
        fillOpacity={isCharging ? 0.75 : 0.6}
        style={{
          filter: isCharging
            ? 'drop-shadow(0 0 4px rgba(52, 211, 153, 0.7))'
            : isLow
            ? 'drop-shadow(0 0 3px rgba(244, 63, 94, 0.6))'
            : undefined,
        }}
      />

      {/* Subtle Charging Lightning Bolt Glyphs */}
      {isCharging && (
        <path
          d="M10.5 2.5 L7.5 7.5 H10.5 L8.5 11.5 L13 6.8 H10 L11.5 2.5 Z"
          fill="#34D399"
          stroke="#08090C"
          strokeWidth="0.6"
          style={{ filter: 'drop-shadow(0 0 3px #34D399)' }}
        />
      )}
    </svg>
  );
};

/**
 * MoonPhaseIcon:
 * Ikon fase bulan dinamis sesuai nilai slider:
 * - 0–25%: Bulan sabit ramping (Crescent)
 * - 26–75%: Setengah lingkaran (Quarter Moon)
 * - 76–100%: Bulan purnama berpendar (Full Moon Glow)
 */
export interface MoonPhaseIconProps extends LunarIconProps {
  percentage: number;
}

export const MoonPhaseIcon: React.FC<MoonPhaseIconProps> = ({
  className = 'w-4 h-4',
  size = 24,
  percentage,
  ...props
}) => {
  const val = Math.max(0, Math.min(100, Math.round(percentage)));

  // 1. 0–25%: Bulan sabit ramping (Crescent)
  if (val <= 25) {
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
        <path
          d="M14.5 3.5 C9 5.5, 7.8 12.5, 13.5 18.5 C7 17.5, 5.2 11.5, 9.5 4.8 C11.2 2.2, 13.5 2.8, 14.5 3.5 Z"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="0.5"
        />
        {/* Subtle Stardust Glimmer */}
        <circle cx="17.5" cy="7.5" r="0.7" fill="#E2E8F0" opacity="0.8" />
      </svg>
    );
  }

  // 2. 26–75%: Setengah lingkaran (Quarter Moon)
  if (val <= 75) {
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
        {/* Outer Orbit Rim */}
        <circle
          cx="12"
          cy="12"
          r="8.5"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeOpacity="0.4"
        />
        {/* Lit Half Disc */}
        <path
          d="M12 3.5 A 8.5 8.5 0 0 1 12 20.5 Z"
          fill="currentColor"
        />
      </svg>
    );
  }

  // 3. 76–100%: Bulan purnama berpendar (Full Moon Glow)
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
      {/* Corona Outer Orbit Ring */}
      <circle
        cx="12"
        cy="12"
        r="10.2"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeDasharray="2.5 2"
        strokeOpacity="0.4"
      />
      {/* Full Moon Spherical Body */}
      <circle
        cx="12"
        cy="12"
        r="8"
        fill="currentColor"
        style={{
          filter: 'drop-shadow(0 0 5px rgba(255, 255, 255, 0.75))',
        }}
      />
      {/* Subtle Lunar Crater Textures */}
      <circle cx="9.5" cy="9.5" r="1.2" fill="#08090C" fillOpacity="0.15" />
      <circle cx="14" cy="13" r="1.5" fill="#08090C" fillOpacity="0.12" />
      <circle cx="13" cy="8.5" r="0.9" fill="#08090C" fillOpacity="0.12" />
    </svg>
  );
};
