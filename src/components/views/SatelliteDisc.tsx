import React from 'react';
import { Music } from 'lucide-react';
import { useSkillStore } from '../../skills/store';

interface SatelliteDiscProps {
  onClick?: () => void;
  className?: string;
}

export const SatelliteDisc: React.FC<SatelliteDiscProps> = ({ onClick, className = '' }) => {
  const mediaState = useSkillStore((s) => s.skillStates['core.media']);
  const song = mediaState?.song;
  const playbackSource = mediaState?.playbackSource || 'companion';
  const nativeTrack = mediaState?.nativeTrack;
  const isNativePlaying = Boolean(mediaState?.isNativePlaying);

  const isMusicActive = playbackSource === 'native'
    ? Boolean(nativeTrack && (nativeTrack.title || nativeTrack.artist))
    : Boolean(song?.title && song.title.trim() !== '');

  const isPlaying = playbackSource === 'native'
    ? isNativePlaying
    : Boolean(song?.isPlaying);

  const currentArtwork = playbackSource === 'native'
    ? (nativeTrack?.artworkUrl || nativeTrack?.thumbnailUrl || nativeTrack?.albumArt)
    : (song?.albumArtUrl || song?.albumArt);

  const timerState = useSkillStore((s) => s.skillStates['core.timer']);
  const isTimerActive = Boolean(timerState?.isActive);
  const remainingSeconds = timerState?.remainingSeconds ?? 0;
  const totalSeconds = timerState?.totalSeconds || 25 * 60;
  const isTimerPaused = Boolean(timerState?.isPaused);
  const isAlert = isTimerActive && remainingSeconds <= 1;

  // Lintasan Orbit Rasi Bintang untuk 36px disc (r = 15.5px)
  const radius = 15.5;
  const circumference = 2 * Math.PI * radius; // ~97.39
  const progress = totalSeconds > 0 ? Math.max(0, Math.min(1, remainingSeconds / totalSeconds)) : 1;
  const strokeDashoffset = circumference * (1 - progress);

  // Koordinat Bintang Pengorbit (Orbiting Star / Lunar Node)
  // Berputar memutari keliling lingkaran mengikuti sisa cooldown timer
  const angle = progress * 2 * Math.PI;
  const starX = 18 + radius * Math.cos(angle);
  const starY = 18 + radius * Math.sin(angle);

  // Format short timer display: e.g. "24m" or "45s"
  const formatTimerShort = (sec: number) => {
    if (sec <= 0) return '0m';
    if (sec < 60) return `${sec}s`;
    return `${Math.ceil(sec / 60)}m`;
  };

  const formatMMSS = (sec: number) => {
    const mins = Math.floor(sec / 60);
    const secs = sec % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const timerTooltip = isTimerActive
    ? `Pomodoro: ${formatMMSS(remainingSeconds)} (${timerState?.mode || 'focus'})`
    : '';
  const activeTitle = playbackSource === 'native' ? (nativeTrack?.title || '') : (song?.title || '');
  const activeArtist = playbackSource === 'native' ? (nativeTrack?.artist || '') : (song?.artist || '');
  const musicTooltip = isMusicActive ? `Playing: ${activeTitle}${activeArtist ? ` - ${activeArtist}` : ''}` : '';
  const fullTooltip = [timerTooltip, musicTooltip].filter(Boolean).join(' • ') || 'Secondary Widget';

  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      title={fullTooltip}
      aria-label={fullTooltip}
      className={`relative w-[36px] h-[36px] rounded-full bg-[#0D0E12]/95 backdrop-blur-md flex items-center justify-center select-none shadow-ambient cursor-pointer hover:shadow-ambient-glow transition-all ${className}`.trim()}
    >
      {/* SVG Lintasan Orbit Rasi Bintang saat Timer Aktif */}
      {isTimerActive && (
        <svg
          className="absolute inset-0 w-full h-full -rotate-90 overflow-visible pointer-events-none"
          viewBox="0 0 36 36"
        >
          <defs>
            <linearGradient id="satOrbitGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#7DD3FC" />
              <stop offset="100%" stopColor="#818CF8" />
            </linearGradient>
          </defs>

          {/* Lingkaran Dasar: Garis orbit titik-titik halus (Stardust Track) */}
          <circle
            cx="18"
            cy="18"
            r={radius}
            stroke="rgba(125, 211, 252, 0.15)"
            strokeWidth="1"
            strokeDasharray="2 4"
            fill="none"
          />

          {/* Progress Waktu: Busur tipis bergradien cyan lembut (strokeWidth 2) */}
          <circle
            cx="18"
            cy="18"
            r={radius}
            stroke={isAlert ? '#EF4444' : isTimerPaused ? 'rgba(255,255,255,0.25)' : 'url(#satOrbitGrad)'}
            strokeWidth="2"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            style={{
              transition: 'stroke-dashoffset 0.8s linear, stroke 0.3s ease',
              filter: !isTimerPaused && !isAlert ? 'drop-shadow(0 0 4px rgba(125, 211, 252, 0.25))' : undefined,
            }}
          />

          {/* Bintang Pengorbit (Orbiting Star / Lunar Node) */}
          <circle
            cx={starX}
            cy={starY}
            r="2"
            fill="#F8FAFC"
            stroke="#7DD3FC"
            strokeWidth="0.8"
            className={!isTimerPaused ? 'animate-pulse' : ''}
            style={{
              filter: 'drop-shadow(0 0 4px #7DD3FC)',
            }}
          />
        </svg>
      )}

      {/* Subtle border jika Timer TIDAK aktif */}
      {!isTimerActive && (
        <div className="absolute inset-0 rounded-full border border-white/[0.10] pointer-events-none" />
      )}

      {/* Center Content: Prioritaskan Timer saat aktif (Mode Dual-Idle) */}
      {isTimerActive ? (
        <div className="z-10 flex flex-col items-center justify-center leading-none">
          <span
            className={`text-[10px] font-bold tabular-nums tracking-tight font-urbanist ${
              isAlert
                ? 'text-red-400 animate-pulse'
                : isTimerPaused
                ? 'text-white/40'
                : 'text-[#F8FAFC]'
            }`}
            style={{
              fontFamily: "'Urbanist', sans-serif",
              fontVariantNumeric: 'tabular-nums',
              filter: !isTimerPaused && !isAlert ? 'drop-shadow(0 0 5px rgba(125, 211, 252, 0.25))' : undefined,
            }}
          >
            {formatTimerShort(remainingSeconds)}
          </span>
        </div>
      ) : isMusicActive ? (
        /* Center Content: Spinning Vinyl jika musik aktif (Spotify / Native) */
        <div
          className="relative w-[22px] h-[22px] rounded-full bg-[#121318] border border-white/20 p-[1.5px] shadow-sm shrink-0 z-10 flex items-center justify-center animate-[spin_7s_linear_infinite]"
          style={{ animationPlayState: isPlaying ? 'running' : 'paused' }}
        >
          {currentArtwork ? (
            <div className="relative w-full h-full rounded-full overflow-hidden">
              <img
                src={currentArtwork}
                alt="Vinyl Cover Art"
                className="w-full h-full rounded-full object-cover"
                onError={(e) => {
                  (e.target as HTMLElement).style.display = 'none';
                }}
              />
              {/* Spindle hole in center */}
              <div className="absolute inset-0 m-auto w-[4px] h-[4px] rounded-full bg-[#121318] border border-white/40 pointer-events-none" />
            </div>
          ) : (
            <div className="w-full h-full rounded-full bg-[#98BBD6]/20 flex items-center justify-center">
              <Music className="w-2.5 h-2.5 text-[#98BBD6]" />
            </div>
          )}
        </div>
      ) : (
        /* Fallback: Inactive Music Icon */
        <div className="w-full h-full flex items-center justify-center">
          <Music className="w-3 h-3 text-white/30" />
        </div>
      )}
    </div>
  );
};
