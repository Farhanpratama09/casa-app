import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Zap } from 'lucide-react';
import { useSkillStore } from '../../skills/store';
import { useSystemHardware } from '../../hooks/useSystemHardware';
import { SashaEyes } from '@/components/views/SashaEyes';
import { MoonRabbitEmblem } from '@/components/MoonRabbitEmblem';
import { TimerPillSlot } from '@/features/timer/TimerPillSlot';
import {
  BunnyHeadphonesWired,
  BunnyHeadphonesBluetooth,
  MoonCraterSpeaker,
} from '../system/LunarIcons';

interface IdlePillViewProps {
  isDualBubble?: boolean;
  isExpanded?: boolean;
  isRestingSleep?: boolean;
  isTuckedPeek?: boolean;
  onExpandSkill?: (skillId: string) => void;
}

/**
 * Pure Circle Battery Ring (Mode Compact / Idle)
 * Cincin melingkar murni (Circle Only) tanpa teks angka persentase.
 * Arc melingkar proporsional (0–100%):
 * - Charging: Hijau Emerald (#34D399) + ikon petir mikro di tengah.
 * - Non-charging: Lunar Cyan (#38BDF8) bersih tanpa teks/ikon di dalamnya.
 */
export const PureCircleBattery: React.FC<{
  percentage: number;
  isCharging: boolean;
  hasBattery?: boolean;
  size?: number;
  className?: string;
}> = ({ percentage, isCharging, hasBattery = true, size = 18, className = '' }) => {
  if (!hasBattery) return null;

  const center = size / 2;
  const radius = center - 1.8;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const offset = circumference - (clamped / 100) * circumference;

  const strokeColor = isCharging
    ? '#34D399' // Emerald charging
    : clamped <= 20
    ? '#F43F5E' // Rose low
    : '#38BDF8'; // Lunar Cyan normal

  const glowStyle = isCharging
    ? { filter: 'drop-shadow(0 0 3px rgba(52, 211, 153, 0.75))' }
    : clamped <= 20
    ? { filter: 'drop-shadow(0 0 3px rgba(244, 63, 94, 0.75))' }
    : { filter: 'drop-shadow(0 0 3px rgba(56, 189, 248, 0.65))' };

  return (
    <div
      className={`relative flex items-center justify-center shrink-0 select-none ${className}`}
      style={{ width: size, height: size }}
      title={`Baterai: ${clamped}%${isCharging ? ' (Charging)' : ''}`}
    >
      <svg
        className="w-full h-full -rotate-90 transform"
        viewBox={`0 0 ${size} ${size}`}
      >
        {/* Track orbit redup */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          className="text-white/[0.08]"
        />
        {/* Arc baterai terisi proporsional */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={glowStyle}
          className="transition-all duration-500 ease-out"
        />
      </svg>

      {/* Pusat Cincin: Petir mikro saat charging, bersih tanpa teks saat normal */}
      {isCharging && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <Zap className="w-2.5 h-2.5 text-[#34D399] animate-pulse fill-[#34D399]/40" />
        </div>
      )}
    </div>
  );
};

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

  // Hardware Telemetry & Dynamic Morphing Alert
  const { telemetry } = useSystemHardware();
  const [activeAlert, setActiveAlert] = useState<{
    id: number;
    icon: React.ReactNode;
    text: string;
    colorClass: string;
    bgClass: string;
    borderClass: string;
  } | null>(null);
  const alertTimerRef = useRef<NodeJS.Timeout | null>(null);

  const prevCapsRef = useRef(telemetry.is_caps_locked);
  const prevChargingRef = useRef(telemetry.is_charging);
  const prevDeviceRef = useRef(telemetry.audio_device_name);
  const isInitialMount = useRef(true);

  useEffect(() => {
    // 0. Cold boot guard: Jangan picu false alert pada inisialisasi awal
    if (isInitialMount.current) {
      prevCapsRef.current = telemetry.is_caps_locked;
      prevChargingRef.current = telemetry.is_charging;
      prevDeviceRef.current = telemetry.audio_device_name;

      // Baseline terbentuk setelah telemetry OS pertama kali diterima (bukan placeholder default)
      if (telemetry.audio_device_name && telemetry.audio_device_name !== 'Default Audio Device') {
        isInitialMount.current = false;
      }
      return;
    }

    let triggeredAlert: {
      id: number;
      icon: React.ReactNode;
      text: string;
      colorClass: string;
      bgClass: string;
      borderClass: string;
    } | null = null;

    // 1. Caps Lock State Change
    if (prevCapsRef.current !== telemetry.is_caps_locked) {
      prevCapsRef.current = telemetry.is_caps_locked;
      triggeredAlert = {
        id: Date.now(),
        icon: (
          <span
            className={`w-2 h-2 rounded-full shrink-0 ${
              telemetry.is_caps_locked
                ? 'bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.9)]'
                : 'bg-white/40'
            }`}
          />
        ),
        text: telemetry.is_caps_locked ? 'CAPS LOCK AKTIF' : 'CAPS LOCK NONAKTIF',
        colorClass: telemetry.is_caps_locked ? 'text-rose-300' : 'text-white/70',
        borderClass: telemetry.is_caps_locked ? 'border-rose-500/40' : 'border-white/20',
        bgClass: telemetry.is_caps_locked
          ? 'bg-rose-500/15 shadow-[0_0_12px_rgba(244,63,94,0.35)]'
          : 'bg-white/[0.08]',
      };
    }
    // 2. Charger Connect / Disconnect
    else if (prevChargingRef.current !== telemetry.is_charging) {
      prevChargingRef.current = telemetry.is_charging;
      triggeredAlert = {
        id: Date.now(),
        icon: (
          <Zap className="w-3 h-3 text-[#34D399] shrink-0 animate-pulse fill-[#34D399]/30" />
        ),
        text: telemetry.is_charging
          ? `CHARGING • ${telemetry.battery_percentage}%`
          : `BATTERY • ${telemetry.battery_percentage}%`,
        colorClass: telemetry.is_charging ? 'text-emerald-300' : 'text-sky-300',
        borderClass: telemetry.is_charging ? 'border-emerald-500/40' : 'border-sky-500/40',
        bgClass: telemetry.is_charging
          ? 'bg-emerald-500/15 shadow-[0_0_12px_rgba(52,211,153,0.35)]'
          : 'bg-sky-500/15 shadow-[0_0_12px_rgba(56,189,248,0.25)]',
      };
    }
    // 3. Audio Endpoint Connect / Switch (hanya picu saat berpindah perangkat riil, bukan transisi dari placeholder default)
    else if (
      prevDeviceRef.current &&
      prevDeviceRef.current !== 'Default Audio Device' &&
      prevDeviceRef.current !== telemetry.audio_device_name
    ) {
      prevDeviceRef.current = telemetry.audio_device_name;
      const IconComp =
        telemetry.audio_device_type === 'headphone_bluetooth'
          ? BunnyHeadphonesBluetooth
          : telemetry.audio_device_type === 'headphone_wired'
          ? BunnyHeadphonesWired
          : MoonCraterSpeaker;
      triggeredAlert = {
        id: Date.now(),
        icon: <IconComp size={13} className="w-3.5 h-3.5 shrink-0 text-sky-400" />,
        text: `AUDIO: ${telemetry.audio_device_name}`,
        colorClass: 'text-sky-300',
        borderClass: 'border-sky-500/40',
        bgClass: 'bg-sky-500/15 shadow-[0_0_12px_rgba(56,189,248,0.35)]',
      };
    } else {
      prevDeviceRef.current = telemetry.audio_device_name;
    }

    if (triggeredAlert) {
      if (alertTimerRef.current) clearTimeout(alertTimerRef.current);
      setActiveAlert(triggeredAlert);
      alertTimerRef.current = setTimeout(() => {
        setActiveAlert(null);
        alertTimerRef.current = null;
      }, 2500); // 2.5s auto-dismiss
    }
  }, [
    telemetry.is_caps_locked,
    telemetry.is_charging,
    telemetry.audio_device_name,
    telemetry.battery_percentage,
    telemetry.audio_device_type,
  ]);

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

        {/* Tengah: Jam Digital & Tanggal / Dynamic Morphing Alert */}
        <div
          data-idle-clock-date="true"
          className="flex items-center shrink-0 tabular-nums select-none"
        >
          <AnimatePresence mode="wait">
            {activeAlert ? (
              <motion.div
                key={`playing-alert-${activeAlert.id}`}
                initial={{ opacity: 0, y: 5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.95 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`h-[22px] px-2 rounded-full border flex items-center gap-1 select-none ${activeAlert.bgClass} ${activeAlert.borderClass}`}
              >
                {activeAlert.icon}
                <span
                  className={`font-sans text-[8.5px] tracking-[0.12em] uppercase font-bold truncate max-w-[130px] ${activeAlert.colorClass}`}
                >
                  {activeAlert.text}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="playing-clock"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center tabular-nums"
              >
                <span className="font-mono font-bold text-white/95 text-[12px] tracking-tight tabular-nums">
                  {timeStr || '19.13'}
                </span>
                <span className="text-white/25 mx-1.5">•</span>
                <span className="font-sans font-medium text-white/45 text-[11px]">
                  {dateStr}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
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

          {/* Equalizer Terkunci & Pure Circle Battery Ring */}
          <div className="shrink-0 flex items-center gap-2">
            <MiniEqualizerGlyph active={isPlaying} />
            {telemetry.has_battery && (
              <PureCircleBattery
                percentage={telemetry.battery_percentage}
                isCharging={telemetry.is_charging}
                hasBattery={telemetry.has_battery}
                size={18}
              />
            )}
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

        {/* Tengah: Jam Digital & Tanggal / Dynamic Morphing Alert */}
        <div
          data-idle-clock-date="true"
          className="flex items-center shrink-0 tabular-nums select-none"
        >
          <AnimatePresence mode="wait">
            {activeAlert ? (
              <motion.div
                key={`playing-alert-${activeAlert.id}`}
                initial={{ opacity: 0, y: 5, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -5, scale: 0.95 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`h-[22px] px-2 rounded-full border flex items-center gap-1 select-none ${activeAlert.bgClass} ${activeAlert.borderClass}`}
              >
                {activeAlert.icon}
                <span
                  className={`font-sans text-[8.5px] tracking-[0.12em] uppercase font-bold truncate max-w-[130px] ${activeAlert.colorClass}`}
                >
                  {activeAlert.text}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="playing-clock"
                initial={{ opacity: 0, y: -5 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 5 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center tabular-nums"
              >
                <span className="font-mono font-bold text-white/95 text-[12px] tracking-tight tabular-nums">
                  {timeStr || '19.13'}
                </span>
                <span className="text-white/25 mx-1.5">•</span>
                <span className="font-sans font-medium text-white/45 text-[11px]">
                  {dateStr}
                </span>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Separator */}
        <span className="h-3 w-[1px] bg-white/[0.08] shrink-0" aria-hidden="true" />

        {/* Sisi Kanan: Countdown Timer Slot */}
        <div className={`shrink-0 flex items-center gap-2 justify-end ${isExpanded ? 'pointer-events-none' : ''}`}>
          {telemetry.has_battery && (
            <PureCircleBattery
              percentage={telemetry.battery_percentage}
              isCharging={telemetry.is_charging}
              hasBattery={telemetry.has_battery}
              size={18}
            />
          )}
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

      {/* Sub-layer 2: Jam Digital & Hari Tanggal + Mini Circular Battery Ring (Awake 290px) */}
      <div
        className={`absolute inset-0 w-[290px] px-3.5 py-1.5 mx-auto flex items-center justify-between transition-opacity duration-300 ${
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

        {/* Sisi Kanan: Dynamic Morphing Pill (Jam + Baterai vs Hardware Alert) */}
        <div
          data-idle-clock-date="true"
          className="flex items-center justify-end shrink-0 select-none min-w-0"
        >
          <AnimatePresence mode="wait">
            {activeAlert ? (
              <motion.div
                key={`compact-alert-${activeAlert.id}`}
                initial={{ opacity: 0, y: 6, scale: 0.95 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.95 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className={`h-[24px] px-2.5 rounded-full border flex items-center gap-1.5 select-none ${activeAlert.bgClass} ${activeAlert.borderClass}`}
              >
                {activeAlert.icon}
                <span
                  className={`font-sans text-[9px] tracking-[0.14em] uppercase font-bold truncate max-w-[170px] ${activeAlert.colorClass}`}
                >
                  {activeAlert.text}
                </span>
              </motion.div>
            ) : (
              <motion.div
                key="compact-clock-battery"
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 6 }}
                transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
                className="flex items-center gap-2 select-none"
              >
                {/* Jam Digital & Hari Tanggal */}
                <div className="flex items-center tabular-nums">
                  <span className="font-mono font-bold text-white/95 text-[12px] tracking-tight tabular-nums">
                    {timeStr || '19.38'}
                  </span>
                  <span className="text-white/25 mx-1.5">•</span>
                  <span className="font-sans font-medium text-white/45 text-[11px]">
                    {dateStr}
                  </span>
                </div>

                {/* Pure Circle Battery Ring (No Text) */}
                {telemetry.has_battery && (
                  <PureCircleBattery
                    percentage={telemetry.battery_percentage}
                    isCharging={telemetry.is_charging}
                    hasBattery={telemetry.has_battery}
                    size={18}
                  />
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};

export const IdlePillView = React.memo(IdlePillViewComponent);
