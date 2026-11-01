import React, { useEffect, useRef, useState } from 'react';
import { useSkillStore } from '../../skills/store';
import { SashaEyes } from '@/components/views/SashaEyes';
import { MoonRabbitEmblem } from '@/components/MoonRabbitEmblem';
import { TimerPillSlot } from '@/features/timer/TimerPillSlot';

interface IdlePillViewProps {
  isDualBubble?: boolean;
  isExpanded?: boolean;
  isRestingSleep?: boolean;
  isTuckedPeek?: boolean;
  onExpandSkill?: (skillId: string) => void;
}

// Visualizer Gelombang Mikro (Equalizer)
const MiniEqualizerGlyph: React.FC<{ active?: boolean }> = ({ active = true }) => (
  <div
    className="flex items-end gap-[2px] h-[11px] shrink-0"
    style={{ filter: 'drop-shadow(0 0 4px rgba(152, 187, 214, 0.45))' }}
    aria-hidden="true"
  >
    <span
      className={`w-[2px] rounded-full bg-[#98BBD6] transition-all ${
        active ? 'h-[9px] animate-[pulse_0.9s_ease-in-out_infinite]' : 'h-[3px] opacity-40'
      }`}
    />
    <span
      className={`w-[2px] rounded-full bg-[#98BBD6] transition-all ${
        active ? 'h-[11px] animate-[pulse_0.6s_ease-in-out_infinite]' : 'h-[3px] opacity-40'
      }`}
    />
    <span
      className={`w-[2px] rounded-full bg-[#98BBD6] transition-all ${
        active ? 'h-[7px] animate-[pulse_1.1s_ease-in-out_infinite]' : 'h-[3px] opacity-40'
      }`}
    />
  </div>
);

// Komponen Marquee Teks Lagu & Artis Dinamis
interface MarqueeTrackProps {
  title: string;
  artist?: string;
  isPlaying?: boolean;
}

const MarqueeTrack: React.FC<MarqueeTrackProps> = ({ title, artist, isPlaying = true }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);

  const fullText = artist ? `${title} • ${artist}` : title;

  useEffect(() => {
    if (!isPlaying) {
      setIsOverflowing(false);
      return;
    }
    const checkOverflow = () => {
      if (containerRef.current && textRef.current) {
        setIsOverflowing(textRef.current.scrollWidth > containerRef.current.clientWidth + 2);
      }
    };
    checkOverflow();
    window.addEventListener('resize', checkOverflow);
    return () => window.removeEventListener('resize', checkOverflow);
  }, [fullText, isPlaying]);

  const renderContent = (refProp?: React.Ref<HTMLSpanElement>, withSpacer = false) => (
    <span
      ref={refProp}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap ${withSpacer ? 'pr-6' : ''}`}
    >
      <span className="font-medium text-white/90">{title}</span>
      {artist && (
        <>
          <span className="text-white/30">•</span>
          <span className="text-white/50">{artist}</span>
        </>
      )}
    </span>
  );

  return (
    <div
      ref={containerRef}
      className={`min-w-0 overflow-hidden whitespace-nowrap relative select-none ${
        isOverflowing
          ? '[mask-image:linear-gradient(to_right,transparent,black_8px,black_calc(100%-8px),transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_8px,black_calc(100%-8px),transparent)]'
          : ''
      }`}
    >
      {isOverflowing ? (
        <div className="inline-flex animate-lyrics-marquee">
          {renderContent(textRef, true)}
          {renderContent(undefined, true)}
        </div>
      ) : (
        renderContent(textRef, false)
      )}
    </div>
  );
};

export const IdlePillViewComponent: React.FC<IdlePillViewProps> = ({
  isExpanded = false,
  isRestingSleep = false,
  isTuckedPeek = false,
  onExpandSkill,
}) => {
  const mediaState = useSkillStore((s) => s.skillStates['core.media']);
  const song = mediaState?.song;
  const playbackSource = mediaState?.playbackSource || 'companion';
  const nativeTrack = mediaState?.nativeTrack;
  const isNativePlaying = Boolean(mediaState?.isNativePlaying);

  const isPlaying = playbackSource === 'native'
    ? Boolean(isNativePlaying && nativeTrack)
    : Boolean(song?.isPlaying && song?.title && song.title.trim() !== '');

  // Akses langsung state timer dari store (BUKAN .timerState)
  const timerState = useSkillStore((s) => s.skillStates['core.timer']);
  const isTimerActive = Boolean(timerState?.isActive);

  // Digital Clock & Tabular Date
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      setTimeStr(`${hours}.${minutes}`);
      setDateStr(
        now.toLocaleDateString('en-US', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      );
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // =========================================================================
  // VIEW 2: MUSIK AKTIF (Stabil 380px — Anti Berubah-Ubah ke Mata)
  // Layout: [ MoonRabbitEmblem ] [ C Λ S Λ ] | [ Jam Digital • Tanggal ] | [ Judul Lagu (Marquee) + Equalizer Anchor ]
  // Di luar bar di sebelah kanan, piringan satelit vinyl berputar aktif.
  // =========================================================================
  if (isPlaying) {
    const trackTitle = playbackSource === 'native'
      ? (nativeTrack?.title || 'Playing Media')
      : (song?.title || 'Playing Media');

    const rawArtist = playbackSource === 'native'
      ? (nativeTrack?.artist || '')
      : (song?.artist || '');

    const artistName =
      rawArtist && rawArtist.trim() !== '' && rawArtist !== 'Unknown Artist'
        ? rawArtist
        : '';

    return (
      <div
        className={`relative w-[380px] h-[38px] px-3.5 py-1.5 select-none mx-auto flex items-center shrink-0 ${
          isExpanded ? 'pointer-events-none' : ''
        }`}
      >
        {/* Sisi Kiri: MoonRabbitEmblem + C Λ S Λ */}
        <div className="flex items-center gap-1.5 shrink-0" title="CASA System">
          <MoonRabbitEmblem size={18} />
          <span className="text-[10px] font-bold text-white/90 tracking-[0.2em] select-none">
            C Λ S Λ
          </span>
        </div>

        {/* Separator 1 */}
        <span className="h-3 w-[1px] bg-white/[0.08] mx-2.5 shrink-0" aria-hidden="true" />

        {/* Tengah: Jam Digital & Tanggal */}
        <div
          data-idle-clock-date="true"
          className="flex items-center shrink-0 tabular-nums select-none"
        >
          <span className="font-sans font-bold text-white/95 text-[12.5px] tracking-tight">
            {timeStr || '19.13'}
          </span>
          <span className="text-white/25 mx-1.5">•</span>
          <span className="font-sans font-medium text-white/45 text-[11px]">
            {dateStr}
          </span>
        </div>

        {/* Separator 2: Simetris dengan ml-2.5 */}
        <span className="h-3 w-[1px] bg-white/10 ml-2.5 shrink-0" aria-hidden="true" />

        {/* Sisi Kanan: Mengalir wajar dari divider (ml-2.5, tanpa ml-auto) */}
        <div
          onClick={(e) => {
            if (isExpanded) return;
            e.stopPropagation();
            if (onExpandSkill) {
              onExpandSkill('core.media');
            }
          }}
          className={`flex items-center gap-2.5 ml-2.5 min-w-0 max-w-[180px] ${
            isExpanded ? 'pointer-events-none' : 'cursor-pointer'
          }`}
          title={artistName ? `${trackTitle} • ${artistName}` : trackTitle}
        >
          {/* Wadah Teks */}
          <div
            className="flex-1 min-w-0 overflow-hidden text-xs font-urbanist select-none"
            style={{ fontFamily: "'Urbanist', sans-serif" }}
          >
            <MarqueeTrack title={trackTitle} artist={artistName} isPlaying={isPlaying} />
          </div>

          {/* Equalizer Terkunci */}
          <div className="shrink-0 flex items-center">
            <MiniEqualizerGlyph active={isPlaying} />
          </div>
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 3: TIMER AKTIF & MUSIK MATI (Stabil 350px)
  // Layout: [ MoonRabbitEmblem ] [ C Λ S Λ ] | [ Jam • Tanggal ] | [ 24:15 ⏱ Lunar Sky ]
  // Teks countdown tampil permanen dan tidak pernah hilang/menciut ke mata.
  // =========================================================================
  if (isTimerActive) {
    return (
      <div
        className={`relative w-[350px] h-[38px] px-3.5 select-none mx-auto flex items-center justify-between gap-2.5 shrink-0 ${
          isExpanded ? 'pointer-events-none' : ''
        }`}
      >
        {/* Sisi Kiri: MoonRabbitEmblem + C Λ S Λ */}
        <div className="flex items-center gap-1.5 shrink-0" title="CASA System">
          <MoonRabbitEmblem size={18} />
          <span className="text-[10px] font-bold text-white/90 tracking-[0.2em] select-none">
            C Λ S Λ
          </span>
        </div>

        {/* Separator */}
        <span className="h-3 w-[1px] bg-white/[0.08] shrink-0" aria-hidden="true" />

        {/* Tengah: Jam Digital & Tanggal */}
        <div
          data-idle-clock-date="true"
          className="flex items-center shrink-0 tabular-nums select-none"
        >
          <span className="font-sans font-bold text-white/95 text-[12.5px] tracking-tight">
            {timeStr || '19.13'}
          </span>
          <span className="text-white/25 mx-1.5">•</span>
          <span className="font-sans font-medium text-white/45 text-[11px]">
            {dateStr}
          </span>
        </div>

        {/* Separator */}
        <span className="h-3 w-[1px] bg-white/[0.08] shrink-0" aria-hidden="true" />

        {/* Sisi Kanan: Countdown Timer Slot */}
        <div className={`shrink-0 flex items-center justify-end ${isExpanded ? 'pointer-events-none' : ''}`}>
          <TimerPillSlot
            state={timerState}
            onClick={() => {
              if (onExpandSkill) {
                onExpandSkill('core.timer');
              }
            }}
          />
        </div>
      </div>
    );
  }

  // =========================================================================
  // VIEW 4: HENING TOTAL (Musik Mati & Timer Mati)
  // Continuous Single Wrapper: Smooth crossfade antara SashaEyes (Resting 168px)
  // dan Jam Digital (Awake 290px) tanpa unmount mendadak!
  // =========================================================================
  return (
    <div
      className={`relative w-full h-[38px] flex items-center justify-center select-none mx-auto shrink-0 overflow-hidden ${
        isExpanded ? 'pointer-events-none' : ''
      }`}
    >
      {/* Sub-layer 1: SashaEyes (True Resting) */}
      <div
        data-resting-capsule="true"
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
          isExpanded || !isRestingSleep
            ? 'opacity-0 pointer-events-none'
            : 'opacity-100 pointer-events-auto'
        }`}
      >
        <SashaEyes />
      </div>

      {/* Sub-layer 2: Jam Digital & Hari Tanggal (Awake 290px) */}
      <div
        className={`absolute inset-0 w-[290px] px-4 py-1.5 mx-auto flex items-center justify-between transition-opacity duration-300 ${
          isExpanded || isRestingSleep
            ? 'opacity-0 pointer-events-none'
            : 'opacity-100 pointer-events-auto'
        }`}
      >
        {/* Sisi Kiri: MoonRabbitEmblem + C Λ S Λ */}
        <div className="flex items-center gap-1.5 shrink-0" title="CASA System">
          <MoonRabbitEmblem size={18} />
          <span className="text-[10px] font-bold text-white/90 tracking-[0.2em] select-none">
            C Λ S Λ
          </span>
        </div>

        {/* Separator Tengah */}
        <span className="h-3 w-[1px] bg-white/[0.08] shrink-0" aria-hidden="true" />

        {/* Sisi Kanan: Jam Digital & Hari Tanggal (Rata Kanan Proporsional) */}
        <div
          data-idle-clock-date="true"
          className="flex items-center justify-end shrink-0 tabular-nums select-none"
        >
          <span className="font-sans font-bold text-white/95 text-[12.5px] tracking-tight">
            {timeStr || '19.13'}
          </span>
          <span className="text-white/25 mx-1.5">•</span>
          <span className="font-sans font-medium text-white/45 text-[11px]">
            {dateStr}
          </span>
        </div>
      </div>
    </div>
  );
};

export const IdlePillView = React.memo(IdlePillViewComponent);
