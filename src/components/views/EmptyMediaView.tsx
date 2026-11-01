import React from 'react';
import { Loader2 } from 'lucide-react';
import { MoonRabbitEmblem } from '../MoonRabbitEmblem';

interface EmptyMediaViewProps {
  onOpenSpotify: () => void;
  onOpenPlaylist?: () => void;
  onQuitSpotify?: (e: React.MouseEvent) => void;
  isWakingSpotify?: boolean;
  renderSourcePill?: () => React.ReactNode;
}

export const EmptyMediaView: React.FC<EmptyMediaViewProps> = ({
  onOpenSpotify,
  onQuitSpotify,
  isWakingSpotify = false,
  renderSourcePill,
}) => {
  return (
    <div className="w-full max-w-[620px] h-[140px] px-6 py-4 select-none flex items-center justify-between overflow-hidden relative">
      {/* =================================================================== */}
      {/* Ambient Cosmic Background Texture Layers                            */}
      {/* =================================================================== */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0">
        <div
          className="absolute inset-0 pointer-events-none blur-2xl opacity-75"
          style={{
            background:
              'radial-gradient(circle at bottom left, rgba(14, 165, 233, 0.12) 0%, rgba(30, 27, 75, 0.08) 45%, transparent 70%)',
          }}
        />
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none opacity-20"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M -20,120 Q 280,30 640,65"
            fill="none"
            stroke="white"
            strokeWidth="1"
            strokeOpacity="0.04"
            strokeDasharray="4 6"
          />
          <circle cx="270" cy="22" r="1.2" fill="#7DD3FC" opacity="0.18" />
          <circle cx="385" cy="115" r="1.5" fill="#E0F2FE" opacity="0.15" />
          <circle cx="450" cy="32" r="1.0" fill="#7DD3FC" opacity="0.14" />
          <circle cx="530" cy="98" r="1.4" fill="#E0F2FE" opacity="0.16" />
          <circle cx="595" cy="45" r="1.2" fill="#7DD3FC" opacity="0.15" />
        </svg>
      </div>

      {/* =================================================================== */}
      {/* Left: Artwork Frame (56x56) + Polished Urbanist Typography          */}
      {/* =================================================================== */}
      <div className="flex items-center gap-4 min-w-0 relative z-10">
        {/* Artwork Frame: w-14 h-14 with Lunar Ice-Blue Standby Scanner Glow */}
        <div
          onContextMenu={onQuitSpotify}
          className="w-14 h-14 rounded-xl border border-white/10 bg-white/[0.03] flex items-center justify-center shrink-0 relative overflow-hidden group cursor-default shadow-[0_0_15px_rgba(0,0,0,0.5)]"
          title="CASA Standby Radar (Klik Kanan: Keluar Spotify)"
        >
          {/* Subtle Lunar Ice-Blue Glow */}
          <div
            className="absolute inset-0 pointer-events-none opacity-40 group-hover:opacity-60 transition-opacity"
            style={{
              background:
                'radial-gradient(circle at center, rgba(125, 211, 252, 0.28) 0%, rgba(152, 187, 214, 0.10) 50%, transparent 75%)',
            }}
          />

          {/* Standby Pulse Rings */}
          <div className="absolute w-10 h-10 rounded-full border border-sky-300/20 animate-ping opacity-25 pointer-events-none" />
          <div className="absolute w-8 h-8 rounded-full border border-sky-300/15 pointer-events-none" />

          {/* Central Moon Rabbit Emblem */}
          <MoonRabbitEmblem
            size={24}
            className="relative z-10 opacity-90 group-hover:scale-105 transition-transform"
          />
        </div>

        {/* Text Area: Vertical rhythm gap-0.5 */}
        <div className="flex flex-col gap-0.5 min-w-0" style={{ fontFamily: "'Urbanist', sans-serif" }}>
          {/* Category Header */}
          <div className="flex items-center gap-2">
            <span
              className="text-[10px] tracking-[0.25em] text-white/40 uppercase font-semibold font-urbanist"
              style={{ fontFamily: "'Urbanist', sans-serif" }}
            >
              MEDIA
            </span>
            {isWakingSpotify && (
              <span
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-sky-400/15 border border-sky-400/30 text-sky-300 text-[9px] font-urbanist animate-pulse"
                style={{ fontFamily: "'Urbanist', sans-serif" }}
              >
                <Loader2 className="w-2.5 h-2.5 animate-spin" />
                <span>CONNECTING...</span>
              </span>
            )}
          </div>

          {/* Main Title */}
          <h3
            className="text-sm font-medium text-white/85 tracking-wide font-urbanist m-0 p-0 leading-snug truncate"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
          >
            No Media Playing
          </h3>

          {/* Subtext */}
          <p
            className="text-xs text-white/40 font-urbanist m-0 p-0 leading-normal truncate"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
          >
            Putar audio di Spotify atau browser
          </p>
        </div>
      </div>

      {/* =================================================================== */}
      {/* Right: Symmetrical Glassmorphism Launcher "Buka Spotify"            */}
      {/* =================================================================== */}
      <div className="flex items-center shrink-0 relative z-10 gap-2">
        {renderSourcePill && renderSourcePill()}
        <button
          type="button"
          onClick={onOpenSpotify}
          onContextMenu={onQuitSpotify}
          disabled={isWakingSpotify}
          className="px-3.5 py-1.5 rounded-full border border-white/10 bg-white/[0.04] hover:bg-white/[0.08] hover:border-white/20 transition-all flex items-center gap-2 text-xs text-white/70 hover:text-white active:scale-95 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed group shrink-0"
          style={{ fontFamily: "'Urbanist', sans-serif" }}
          title="Klik: Buka Spotify | Klik Kanan: Tutup Total"
        >
          {isWakingSpotify ? (
            <Loader2 className="w-[13px] h-[13px] animate-spin text-white/60" />
          ) : (
            <svg
              className="w-[13px] h-[13px] text-white/60 group-hover:text-white shrink-0 transition-colors"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10 10-4.477 10-10S17.523 2 12 2zm4.586 14.424c-.18.295-.563.387-.857.207-2.35-1.435-5.308-1.76-8.792-.963-.335.077-.67-.133-.746-.468-.077-.334.132-.67.467-.746 3.808-.87 7.076-.496 9.721 1.115.294.18.387.562.207.855zm1.226-2.724c-.227.368-.711.485-1.08.258-2.69-1.653-6.79-2.134-9.97-1.168-.413.125-.852-.108-.977-.52-.125-.413.108-.852.52-.977 3.633-1.103 8.147-.568 11.249 1.328.368.226.485.71.258 1.079zm.106-2.835C14.692 8.95 9.375 8.775 6.297 9.71c-.495.15-1.022-.13-1.172-.625-.15-.496.13-1.022.626-1.172 3.535-1.073 9.404-.866 13.115 1.338.445.264.59.838.327 1.282-.264.444-.838.59-1.281.327z" />
            </svg>
          )}
          <span className="font-urbanist" style={{ fontFamily: "'Urbanist', sans-serif" }}>
            Buka Spotify
          </span>
        </button>
      </div>
    </div>
  );
};
