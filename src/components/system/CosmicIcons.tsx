import React from 'react';

export interface CosmicIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
  size?: number;
}

/**
 * 1. SpotifyLunarIcon:
 * 3 busur cincin orbit bulan (lunar orbital arcs) memancar dari kawah/bulan sabit mikro
 * di sudut kiri bawah, dengan kurva atas menyerupai lengkungan telinga kelinci halus.
 */
export const SpotifyLunarIcon: React.FC<CosmicIconProps> = ({
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
    {/* Lunar Crescent Crater di kiri bawah */}
    <path
      d="M4.8 19C4.1 17.5 3.9 15.8 4.2 14.2C4.4 13.5 4.8 12.8 5.3 12.2C5 13.5 5.2 15 5.9 16.2C6.6 17.4 7.7 18.2 9 18.6C8.1 19 6.5 19.3 4.8 19Z"
      fill="currentColor"
    />
    <circle cx="5.2" cy="18" r="0.8" fill="currentColor" opacity="0.85" />

    {/* Arc 1 (Bawah - Terpendek): Busur orbit bulan bawah */}
    <path
      d="M7.5 16.2C9.8 14.8 12.4 14.5 15.2 15.2"
      stroke="currentColor"
      strokeWidth="1.9"
      strokeLinecap="round"
    />

    {/* Arc 2 (Tengah): Busur orbit tengah */}
    <path
      d="M6.8 12.3C9.8 10.6 13.8 10.4 17.5 11.6"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
    />

    {/* Arc 3 (Atas - Terpanjang): Melengkung ke atas dengan siluet telinga kelinci halus */}
    <path
      d="M6.2 8.4C9.8 6.3 14.5 6 18.8 7.6C19.8 6.6 20.3 5.2 19.8 3.8C18.8 4.8 17.8 6 16.5 7"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

/**
 * 2. QueueOrbitIcon (Queue / Lunar Stardust Orbit Playlist):
 * 3 lintasan orbit stardust sejajar horizontal dengan titik satelit bulan mikro.
 */
export interface QueueOrbitIconProps extends CosmicIconProps {
  queueCount?: number;
  count?: number;
}

export const QueueOrbitIcon: React.FC<QueueOrbitIconProps> = ({
  className = 'w-4 h-4',
  size = 24,
  queueCount,
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
    {/* Baris 1: Garis orbit atas dengan satelit mikro */}
    <line x1="4" y1="6.5" x2="16" y2="6.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="19.5" cy="6.5" r="1.3" fill="currentColor" />

    {/* Baris 2: Garis orbit tengah dengan satelit mikro */}
    <line x1="4" y1="12" x2="13" y2="12" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <circle cx="16.5" cy="12" r="1.3" fill="currentColor" />

    {/* Baris 3: Garis orbit bawah dengan mini play arrow / rabbit node */}
    <line x1="4" y1="17.5" x2="11" y2="17.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    <path d="M14.5 15.5 L18 17.5 L14.5 19.5 Z" fill="currentColor" stroke="currentColor" strokeWidth="0.8" strokeLinejoin="round" />
  </svg>
);

/**
 * 3. LunarLyricIcon (Lirik Kosmik / Cosmic Lyric Wave):
 * Siluet naskah lirik berbentuk pita nebula meliuk dengan bintang stardust.
 */
export const LunarLyricIcon: React.FC<CosmicIconProps> = ({
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
    {/* Stardust Lyric Page Outline */}
    <rect x="4" y="3.5" width="16" height="17" rx="3.5" stroke="currentColor" strokeWidth="1.6" />
    {/* Dynamic Lyric Flow Lines */}
    <line x1="7.5" y1="8" x2="14" y2="8" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="16.5" cy="8" r="1" fill="currentColor" />

    <line x1="7.5" y1="12" x2="16.5" y2="12" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />

    <line x1="7.5" y1="16" x2="12" y2="16" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
    <circle cx="14.5" cy="16" r="1" fill="currentColor" opacity="0.7" />
  </svg>
);

/**
 * 4. CosmicSearchIcon (Search / Lunar Telescope Reticle):
 * Kaca pembesar teleskop kosmik beraksen kelinci bulan.
 */
export const CosmicSearchIcon: React.FC<CosmicIconProps> = ({
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
    {/* Cincin Lensa Teleskop */}
    <circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" strokeWidth="1.8" />
    {/* Micro Crescent Glint di dalam lensa */}
    <path
      d="M7.5 8C7.5 6.5 9 5.5 10.5 5.5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      opacity="0.6"
    />
    {/* Tangkai Teleskop Ramping */}
    <line x1="15.5" y1="15.5" x2="20.5" y2="20.5" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
  </svg>
);

/**
 * 5. CosmicBunnyHeadphones (Headphone Kelinci Kosmik):
 * Headphone audio dengan siluet telinga kelinci mikro di atas headband.
 */
export const CosmicBunnyHeadphones: React.FC<CosmicIconProps> = ({
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
    {/* Micro Rabbit Ears di puncak headband */}
    <path
      d="M9.2 5.5 C8.2 3, 9 1, 10.2 1 C11.2 1.4, 11 3.8, 10.8 5.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M13.2 5.5 C13 3.8, 12.8 1.4, 13.8 1 C15 1, 15.8 3, 14.8 5.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Headband Arch */}
    <path
      d="M4.5 12 C4.5 6.5, 19.5 6.5, 19.5 12"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {/* Left Earcup Cuff */}
    <rect
      x="3"
      y="11.5"
      width="3.5"
      height="8"
      rx="1.75"
      fill="currentColor"
      fillOpacity="0.2"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    {/* Right Earcup Cuff */}
    <rect
      x="17.5"
      y="11.5"
      width="3.5"
      height="8"
      rx="1.75"
      fill="currentColor"
      fillOpacity="0.2"
      stroke="currentColor"
      strokeWidth="1.4"
    />
    {/* Micro Inner Cushion Line */}
    <line x1="6.5" y1="13.5" x2="6.5" y2="17.5" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
    <line x1="17.5" y1="13.5" x2="17.5" y2="17.5" stroke="currentColor" strokeWidth="0.9" opacity="0.5" />
  </svg>
);

/**
 * 6. TaskOrbitIcon (Task Orbit / Lunar Bunny Task Glyph):
 * Cincin orbit tugas kosmik dengan siluet telinga kelinci mikro dan checklist stardust.
 */
export const TaskOrbitIcon: React.FC<CosmicIconProps> = ({
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
    {/* Bunny Ears Siluet Mikro di atas */}
    <path
      d="M8.5 5 C7.8 2.8, 8.5 1, 9.8 0.8 C10.8 1.2, 10.6 3.5, 10.2 5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    <path
      d="M13.8 5 C13.4 3.5, 13.2 1.2, 14.2 0.8 C15.5 1, 16.2 2.8, 15.5 5"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
    />
    {/* Lunar Orbit Ellipse */}
    <ellipse
      cx="12"
      cy="13.5"
      rx="8.5"
      ry="5.5"
      stroke="currentColor"
      strokeWidth="1.3"
      strokeDasharray="2.5 1.5"
      opacity="0.45"
    />
    {/* Tactical Central Check / Stardust */}
    <path
      d="M8.5 13.2 L11 15.5 L16 10.5"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Orbit Node Star */}
    <circle cx="19.5" cy="11.5" r="1" fill="currentColor" />
  </svg>
);

/**
 * 7. FocusRabbitIcon (Gabungan Kelinci Fokus Kosmik):
 * Siluet telinga kelinci mikro elegan dengan cincin fokus dial Pomodoro (aksen cyan lembut).
 */
export const FocusRabbitIcon: React.FC<CosmicIconProps> = ({
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
    {/* Siluet Telinga Kelinci Kosmik di Bagian Atas */}
    <path
      d="M8.2 6.5 C7.2 4, 7.8 1.5, 9.2 1.2 C10.4 1.5, 10.5 4.2, 10 6.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    <path
      d="M14 6.5 C13.5 4.2, 13.6 1.5, 14.8 1.2 C16.2 1.5, 16.8 4, 15.8 6.5"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
    {/* Cincin Dial Fokus */}
    <circle
      cx="12"
      cy="14"
      r="7"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeDasharray="3 1.5"
      opacity="0.8"
    />
    {/* Focus Core Circle */}
    <circle
      cx="12"
      cy="14"
      r="3.5"
      stroke="currentColor"
      strokeWidth="1.4"
      fill="currentColor"
      fillOpacity="0.15"
    />
    {/* Pusat Titik Fokus */}
    <circle cx="12" cy="14" r="1.2" fill="currentColor" />
  </svg>
);

/**
 * 8. CosmicAudioSpeaker:
 * Corong suara akustik bersih (audio horn / acoustic cone) dengan busur gelombang audio kosmik,
 * menggantikan kisi melingkar / target reticle.
 */
export const CosmicAudioSpeaker: React.FC<CosmicIconProps> = ({
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
    {/* Corong Speaker Akustik Bersih */}
    <path
      d="M4 9.5H7.5L12 5.5V18.5L7.5 14.5H4C3.45 14.5 3 14.05 3 13.5V10.5C3 9.95 3.45 9.5 4 9.5Z"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      fill="currentColor"
      fillOpacity="0.15"
    />
    {/* Gelombang Suara Kosmik 1 (Inner Arc) */}
    <path
      d="M15.5 9C16.3 9.8 16.8 10.9 16.8 12C16.8 13.1 16.3 14.2 15.5 15"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
    />
    {/* Gelombang Suara Kosmik 2 (Outer Arc) */}
    <path
      d="M18.8 6.5C20.2 7.9 21 9.9 21 12C21 14.1 20.2 16.1 18.8 17.5"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeOpacity="0.75"
    />
  </svg>
);

export { CosmicSpeakerRabbitIcon } from './CosmicSpeakerRabbitIcon';
export { RabbitCapsLockIcon } from './RabbitCapsLockIcon';

/**
 * TwinEqualizerGlyph:
 * Equalizer bar visualizer kembar identik antara mode Idle dan mode Mekar.
 * Tiga bar rounded-full dengan warna soft ice blue (#38bdf8).
 */
export const TwinEqualizerGlyph: React.FC<{
  active?: boolean;
  isMuted?: boolean;
  isSpotify?: boolean;
  className?: string;
}> = ({ active = true, isMuted = false, isSpotify = false, className = '' }) => {
  const isPlaying = active && !isMuted;
  const barBg = isSpotify ? 'bg-[#10b981]' : 'bg-[#38bdf8]';
  const filterGlow = isPlaying
    ? isSpotify
      ? 'drop-shadow(0 0 4px rgba(16, 185, 129, 0.5))'
      : 'drop-shadow(0 0 4px rgba(56, 189, 248, 0.45))'
    : 'none';

  return (
    <div
      className={`flex items-end gap-[2px] h-[12px] shrink-0 select-none ${className}`}
      style={{ filter: filterGlow }}
      aria-hidden="true"
    >
      <span
        className={`w-[2px] rounded-full transition-all duration-300 ${
          isPlaying
            ? `h-[9px] ${barBg} animate-[pulse_0.9s_ease-in-out_infinite]`
            : 'h-[3px] bg-zinc-700'
        }`}
      />
      <span
        className={`w-[2px] rounded-full transition-all duration-300 ${
          isPlaying
            ? `h-[12px] ${barBg} animate-[pulse_0.6s_ease-in-out_infinite]`
            : 'h-[3px] bg-zinc-700'
        }`}
      />
      <span
        className={`w-[2px] rounded-full transition-all duration-300 ${
          isPlaying
            ? `h-[7px] ${barBg} animate-[pulse_1.1s_ease-in-out_infinite]`
            : 'h-[3px] bg-zinc-700'
        }`}
      />
    </div>
  );
};

/**
 * CosmicVoidPurgeIcon:
 * Ikon pusaran lubang hitam kosmik & sapuan stardust mikro untuk aksi pembersihan (purge/clear).
 */
export const CosmicVoidPurgeIcon: React.FC<CosmicIconProps> = ({
  className = 'w-3.5 h-3.5',
  size = 14,
  ...props
}) => (
  <svg
    viewBox="0 0 16 16"
    width={size}
    height={size}
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
    className={className}
    stroke="currentColor"
    strokeWidth="1.25"
    strokeLinecap="round"
    strokeLinejoin="round"
    {...props}
  >
    {/* Singularity Core Vortex */}
    <circle cx="8" cy="8" r="1.5" fill="currentColor" fillOpacity="0.85" />

    {/* Spiral Orbit 1 */}
    <path d="M8 2.5C11.0376 2.5 13.5 4.96243 13.5 8C13.5 9.6 12.8 11 11.6 12" />

    {/* Spiral Orbit 2 with Stardust Sweep */}
    <path d="M4.2 4.4C3.1 5.4 2.5 6.7 2.5 8C2.5 11.0376 4.96243 13.5 8 13.5C9.8 13.5 11.4 12.6 12.4 11.2" strokeDasharray="1.8 1.8" />

    {/* Inner Spiral Arc */}
    <path d="M5.5 8C5.5 6.61929 6.61929 5.5 8 5.5C9.38071 5.5 10.5 6.61929 10.5 8" />

    {/* Stardust Dust Micro-dots */}
    <circle cx="3.2" cy="5.2" r="0.5" fill="currentColor" />
    <circle cx="13" cy="4.8" r="0.5" fill="currentColor" />
    <circle cx="6.5" cy="13.2" r="0.5" fill="currentColor" />
  </svg>
);

