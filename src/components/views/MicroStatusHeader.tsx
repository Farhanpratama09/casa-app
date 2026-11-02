import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { IslandMode } from '../../types/island';
import { MoonRabbitEmblem } from '../MoonRabbitEmblem';
import { LunarBunnyGlyph } from '../LunarBunnyGlyph';
import { useSystemHardware } from '../../hooks/useSystemHardware';
import {
  BunnyHeadphonesWired,
  BunnyHeadphonesBluetooth,
  MoonCraterSpeaker,
  AlertBunnyCaps,
} from '../system/LunarIcons';
import { LunarControlNotch } from '../system/LunarControlNotch';

interface MicroStatusHeaderProps {
  currentMode?: IslandMode;
  onSelectMode?: (mode: IslandMode) => void;
  onPrev?: () => void;
  onNext?: () => void;
  isPlaying?: boolean;
  batteryPct?: number;
  showDevTrigger?: boolean;
  onToggleDevTrigger?: () => void;
  onCollapse?: () => void;
  onHeaderClick?: (e: React.MouseEvent) => void;
  isPeekPreview?: boolean;
}

/**
 * Mini Circular Battery Ring (Diameter ~20-22px)
 * Orbit stardust tipis yang pas di dalam bar tinggi 28px dengan persentase di sampingnya
 */
export const MiniCircularBattery: React.FC<{
  percentage: number;
  isCharging: boolean;
  hasBattery: boolean;
  size?: number;
}> = ({ percentage, isCharging, hasBattery, size = 20 }) => {
  const radius = size / 2 - 1.5;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const offset = circumference - (clamped / 100) * circumference;

  const strokeColor = isCharging
    ? '#34D399'
    : clamped <= 20
    ? '#F43F5E'
    : '#38BDF8';

  const glowStyle = isCharging
    ? { filter: 'drop-shadow(0 0 3px rgba(52, 211, 153, 0.7))' }
    : clamped <= 20
    ? { filter: 'drop-shadow(0 0 3px rgba(244, 63, 94, 0.7))' }
    : { filter: 'drop-shadow(0 0 3px rgba(56, 189, 248, 0.6))' };

  return (
    <div
      className="flex items-center gap-1.5 select-none shrink-0"
      title={`Baterai: ${hasBattery ? `${clamped}%` : 'AC'}${isCharging ? ' (Charging)' : ''}`}
    >
      <div
        className="relative flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <svg className="w-full h-full -rotate-90 transform" viewBox={`0 0 ${size} ${size}`}>
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            className="text-white/[0.08]"
          />
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={glowStyle}
            className="transition-all duration-500 ease-out"
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {isCharging ? (
            <Zap className="w-2.5 h-2.5 text-[#34D399] animate-pulse fill-[#34D399]/30" />
          ) : (
            <span className="w-1 h-1 rounded-full bg-white/40" />
          )}
        </div>
      </div>
      <span className="font-mono text-[10px] tabular-nums font-semibold leading-none text-white/80">
        {hasBattery ? `${clamped}%` : 'AC'}
      </span>
    </div>
  );
};

// 1. Modul Musik: Tactical Soundwave Glyph (4 Garis Batang Audio Harmonis)
const TacticalSoundwaveGlyph: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <line x1="2.5" y1="5.2" x2="2.5" y2="8.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="5.5" y1="2.6" x2="5.5" y2="11.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="8.5" y1="4.0" x2="8.5" y2="10.0" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    <line x1="11.5" y1="5.8" x2="11.5" y2="8.2" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
  </svg>
);

// 2. Modul Timer: Eclipse Chrono (Eclipse Orbit Ring)
const EclipseChronoIcon: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Eclipse Chrono Orbital Ring */}
    <circle cx="7" cy="7" r="5.2" stroke="currentColor" strokeWidth="1.2" fill="none" />
    {/* Eclipse Moon Disc */}
    <path
      d="M7 2.2 A4.8 4.8 0 0 0 7 11.8 A3.5 3.5 0 0 1 7 2.2 Z"
      fill="currentColor"
    />
    {/* Chrono Orbit Hand */}
    <circle cx="7" cy="7" r="1" fill="currentColor" />
    <line x1="7" y1="7" x2="9.6" y2="4.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

// 3. Modul Tasks: Constellation Checklist Glyph (Tiga Titik Bintang Rasi Bertingkat)
const ConstellationChecklistGlyph: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Garis Rasi Penghubung Tipis Transparan */}
    <path
      d="M3 3.5 L6.5 7 L10 10.5"
      stroke="currentColor"
      strokeWidth="1.1"
      strokeLinecap="round"
      strokeDasharray="1.5 1.5"
      opacity="0.4"
    />
    {/* 3 Titik Bintang Rasi (Stardust Nodes) Bertingkat */}
    <circle cx="3" cy="3.5" r="1.3" fill="currentColor" />
    <line x1="5.5" y1="3.5" x2="12.5" y2="3.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.9" />

    <circle cx="6.5" cy="7" r="1.3" fill="currentColor" />
    <line x1="9" y1="7" x2="12.5" y2="7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.75" />

    <circle cx="10" cy="10.5" r="1.3" fill="currentColor" />
    <line x1="12" y1="10.5" x2="12.5" y2="10.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" opacity="0.5" />
  </svg>
);

interface ModuleItem {
  id: IslandMode;
  name: string;
  activeColor: string;
  activeBg: string;
  activeBorder: string;
  Icon: React.FC<{ className?: string }>;
}

const MODULES: ModuleItem[] = [
  {
    id: 'expanded_music',
    name: 'Lunar Audio',
    activeColor: 'text-[#98BBD6]',
    activeBg: 'bg-[#98BBD6]/15',
    activeBorder: 'border border-[#98BBD6]/30 shadow-[0_0_10px_rgba(152,187,214,0.35)]',
    Icon: TacticalSoundwaveGlyph,
  },
  {
    id: 'expanded_timer',
    name: 'Lunar Orbit',
    activeColor: 'text-[#7DD3FC]',
    activeBg: 'bg-[#7DD3FC]/12',
    activeBorder: 'border border-[#7DD3FC]/30 shadow-[0_0_10px_rgba(125,211,252,0.25)]',
    Icon: LunarBunnyGlyph,
  },
  {
    id: 'expanded_todo',
    name: 'Tasks',
    activeColor: 'text-[#818CF8]',
    activeBg: 'bg-[#818CF8]/15',
    activeBorder: 'border border-[#818CF8]/30 shadow-[0_0_10px_rgba(129,140,248,0.35)]',
    Icon: ConstellationChecklistGlyph,
  },
];

export const MicroStatusHeader: React.FC<MicroStatusHeaderProps> = ({
  currentMode = 'expanded_music',
  onSelectMode,
  onPrev,
  onNext,
  isPlaying = true,
  batteryPct: _batteryPct,
  showDevTrigger = false,
  onToggleDevTrigger,
  onCollapse,
  onHeaderClick,
  isPeekPreview = false,
}) => {
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  const {
    telemetry,
    audioDevices,
    selectAudioDevice,
    fetchAudioDevices,
    setMasterVolume,
    setBrightness,
    toggleMute,
  } = useSystemHardware();
  const [isNotchOpen, setIsNotchOpen] = useState(false);

  // Close notch on mode change
  useEffect(() => {
    setIsNotchOpen(false);
  }, [currentMode]);

  useEffect(() => {
    const update = () => {
      const now = new Date();
      const hours = String(now.getHours()).padStart(2, '0');
      const minutes = String(now.getMinutes()).padStart(2, '0');
      const seconds = String(now.getSeconds()).padStart(2, '0');
      setTimeStr(`${hours}.${minutes}.${seconds}`);
      setDateStr(
        now.toLocaleDateString('en-US', {
          weekday: 'short',
          day: 'numeric',
          month: 'short',
        })
      );
    };
    update();
    const interval = setInterval(update, 1000);
    return () => clearInterval(interval);
  }, []);

  const currentIdx = Math.max(
    0,
    MODULES.findIndex((m) => m.id === currentMode)
  );
  const activeModule = MODULES[currentIdx] || MODULES[0];

  const handleBarClick = (e: React.MouseEvent) => {
    // Klik pada header bar HANYA mengeksekusi onHeaderClick/onCollapse jika pengguna mengklik area kosong bar,
    // BUKAN saat mengklik tombol panah navigasi atau tombol kontrol aktif.
    const target = e.target as HTMLElement;
    if (target.closest('button, [role="button"], a, input, select, textarea, [data-interactive="true"]')) {
      return;
    }
    e.stopPropagation();
    if (isNotchOpen) {
      setIsNotchOpen(false);
      return;
    }
    if (onHeaderClick) {
      onHeaderClick(e);
    } else if (onCollapse) {
      onCollapse();
    }
  };

  return (
    <div
      onClick={handleBarClick}
      className={`relative w-full h-[28px] px-4 flex items-center justify-between border-b border-white/[0.04] select-none text-[11px] font-medium leading-none shrink-0 bg-transparent cursor-pointer hover:bg-white/[0.04] transition-colors ${
        isNotchOpen ? 'z-40' : 'z-10'
      }`}
      title={
        isPeekPreview
          ? 'Klik untuk mengunci CASA (Lock Expanded)'
          : 'Klik header untuk menciutkan CASA (Collapse to Idle)'
      }
    >
      {/* Left: Moon Rabbit Brandmark & CASA Telemetry Wordmark */}
      <div
        data-tauri-drag-region
        className="flex items-center gap-1.5 shrink-0 cursor-default"
      >
        <MoonRabbitEmblem size={16} />
        <span
          data-tauri-drag-region
          className="tracking-[0.25em] text-[10px] font-bold text-white/90"
        >
          C Λ S Λ
        </span>
      </div>

      {/* Middle: Telemetry Clock (HH.mm.ss) + Tactile Segmented Lunar Astronomy Module Switcher */}
      <div className="flex items-center gap-2.5 shrink-0">
        <div
          data-tauri-drag-region
          data-idle-clock-date="true"
          className="flex items-center shrink-0 tabular-nums select-none cursor-default"
        >
          <span
            data-tauri-drag-region
            className="font-mono font-bold text-white/95 text-[12px] tracking-tight tabular-nums"
          >
            {timeStr}
          </span>
          <span data-tauri-drag-region className="text-white/25 mx-1.5">•</span>
          <span
            data-tauri-drag-region
            className="font-sans font-medium text-white/45 text-[11px]"
          >
            {dateStr}
          </span>
        </div>

        {/* Tactile Segmented Lunar Astronomy Module Switcher */}
        {(onSelectMode || onPrev || onNext) && (
          <div
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            className="relative z-30 pointer-events-auto flex items-center gap-1 px-1 py-0.5 rounded-full bg-white/[0.03] border border-white/[0.06] shadow-inner ml-1 select-none"
            title={`Modul: ${activeModule.name}`}
          >
            <button
              type="button"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[NAV] Prev Clicked');
                if (onPrev) {
                  onPrev();
                } else if (onSelectMode) {
                  const prevIdx = (currentIdx - 1 + MODULES.length) % MODULES.length;
                  onSelectMode(MODULES[prevIdx].id);
                }
              }}
              className="w-7 h-7 flex items-center justify-center relative z-30 pointer-events-auto cursor-pointer hover:text-white text-white/60 hover:bg-white/10 rounded-full transition-colors"
              title="Modul Sebelumnya"
              aria-label="Previous Module"
            >
              <ChevronLeft className="w-3.5 h-3.5 pointer-events-none" />
            </button>

            <button
              type="button"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[NAV] Next Clicked');
                if (onNext) {
                  onNext();
                } else if (onSelectMode) {
                  const nextIdx = (currentIdx + 1) % MODULES.length;
                  onSelectMode(MODULES[nextIdx].id);
                }
              }}
              className={`w-7 h-7 flex items-center justify-center rounded-full transition-colors pointer-events-auto cursor-pointer relative z-30 ${activeModule.activeColor} ${activeModule.activeBg} ${activeModule.activeBorder}`}
              title={`Modul: ${activeModule.name} (Klik untuk beralih)`}
              aria-label={`Modul: ${activeModule.name}`}
            >
              <activeModule.Icon className="w-3.5 h-3.5 shrink-0 pointer-events-none" />
            </button>

            <button
              type="button"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                console.log('[NAV] Next Clicked');
                if (onNext) {
                  onNext();
                } else if (onSelectMode) {
                  const nextIdx = (currentIdx + 1) % MODULES.length;
                  onSelectMode(MODULES[nextIdx].id);
                }
              }}
              className="w-7 h-7 flex items-center justify-center relative z-30 pointer-events-auto cursor-pointer hover:text-white text-white/60 hover:bg-white/10 rounded-full transition-colors"
              title="Modul Berikutnya"
              aria-label="Next Module"
            >
              <ChevronRight className="w-3.5 h-3.5 pointer-events-none" />
            </button>
          </div>
        )}

        {/* Developer Trigger Toggle (Kept for Ctrl+Shift+D debug mode) */}
        {showDevTrigger && onToggleDevTrigger && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              onToggleDevTrigger();
            }}
            className="px-1.5 py-0.5 rounded text-[8.5px] font-mono tracking-tight transition-all ml-1 bg-white/20 text-white border border-white/30 font-semibold"
            title="Toggle Developer State Controls (Ctrl+Shift+D)"
            aria-label="Toggle Developer State Controls"
          >
            DEV
          </button>
        )}
      </div>

      {/* Right: Hardware Telemetry Pills & Lunar Control Notch Trigger */}
      <div className="flex items-center gap-1.5 shrink-0">
        {/* Caps Lock Indicator: AlertBunnyCaps (Hanya muncul saat Caps Lock aktif) */}
        {telemetry.is_caps_locked && (
          <div
            className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[8.5px] font-sans font-bold tracking-[0.14em] uppercase bg-rose-500/15 text-rose-300 border border-rose-500/30 select-none cursor-default drop-shadow-[0_0_6px_rgba(244,63,94,0.35)]"
            title="Caps Lock Aktif (VK_CAPITAL)"
          >
            <AlertBunnyCaps isActive={true} size={13} className="w-3.5 h-3.5 shrink-0" />
            <span>CAPS</span>
          </div>
        )}

        {/* Battery Pill: Mini Circular Battery Ring + font-mono percentage */}
        {telemetry.has_battery && (
          <button
            type="button"
            data-interactive="true"
            style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              setIsNotchOpen((prev) => !prev);
            }}
            className={`flex items-center px-1.5 py-0.5 rounded-full border transition-all cursor-pointer select-none ${
              isNotchOpen
                ? 'bg-[#98BBD6]/20 border-[#98BBD6]/40 text-[#98BBD6] shadow-[0_0_8px_rgba(152,187,214,0.3)]'
                : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.07] text-white/80 hover:text-white'
            }`}
            title={`Baterai: ${telemetry.battery_percentage}%${telemetry.is_charging ? ' (Charging)' : ''} - Klik untuk Lunar Control Notch`}
            aria-label="Lunar Battery Control"
          >
            <MiniCircularBattery
              percentage={telemetry.battery_percentage}
              isCharging={telemetry.is_charging}
              hasBattery={telemetry.has_battery}
            />
          </button>
        )}

        {/* Audio Endpoint Pill: BunnyHeadphones / MoonCraterSpeaker + font-mono master volume */}
        <button
          type="button"
          data-interactive="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            setIsNotchOpen((prev) => !prev);
          }}
          className={`flex items-center gap-1.5 px-2 py-0.5 rounded-full border transition-all cursor-pointer relative z-30 select-none ${
            isNotchOpen
              ? 'bg-[#98BBD6]/20 border-[#98BBD6]/40 text-[#98BBD6] shadow-[0_0_8px_rgba(152,187,214,0.3)]'
              : 'bg-white/[0.04] hover:bg-white/[0.08] border-white/[0.07] text-white/80 hover:text-white'
          }`}
          title={`Endpoint: ${telemetry.audio_device_name} (Vol: ${telemetry.master_volume}%) - Klik untuk Lunar Control Notch`}
          aria-label="Lunar Audio Control Notch"
        >
          {telemetry.audio_device_type === 'headphone_bluetooth' ? (
            <BunnyHeadphonesBluetooth className="w-3.5 h-3.5 shrink-0 text-sky-400" />
          ) : telemetry.audio_device_type === 'headphone_wired' ? (
            <BunnyHeadphonesWired className="w-3.5 h-3.5 shrink-0 text-indigo-300" />
          ) : (
            <MoonCraterSpeaker className="w-3.5 h-3.5 shrink-0 text-[#98BBD6]" />
          )}
          <span className="font-mono text-[10px] tabular-nums font-semibold leading-none">
            {telemetry.is_muted ? 'MUTED' : `${telemetry.master_volume}%`}
          </span>
        </button>

        {/* Dynamic Mini Audio Waveform in Ice Blue */}
        <div
          className="w-[14px] h-[14px] flex items-end justify-center gap-[1.5px] pb-0.5 shrink-0"
          title="Audio Waveform"
        >
          <span
            className={`w-[1.5px] rounded-full transition-all ${
              isPlaying ? 'h-2 animate-pulse bg-[#98BBD6]' : 'h-1 bg-[#98BBD6]/40'
            }`}
            style={{ filter: isPlaying ? 'drop-shadow(0 0 3px rgba(152, 187, 214, 0.5))' : undefined }}
          />
          <span
            className={`w-[1.5px] rounded-full transition-all ${
              isPlaying ? 'h-3.5 animate-[bounce_0.8s_infinite] bg-[#98BBD6]' : 'h-1.5 bg-[#98BBD6]/40'
            }`}
            style={{ filter: isPlaying ? 'drop-shadow(0 0 3px rgba(152, 187, 214, 0.5))' : undefined }}
          />
          <span
            className={`w-[1.5px] rounded-full transition-all ${
              isPlaying ? 'h-2.5 animate-[pulse_0.6s_infinite] bg-[#98BBD6]' : 'h-1 bg-[#98BBD6]/40'
            }`}
            style={{ filter: isPlaying ? 'drop-shadow(0 0 3px rgba(152, 187, 214, 0.5))' : undefined }}
          />
        </div>
      </div>

      {/* Expanding Lunar Notch (Docked Sheet Overlay) */}
      <LunarControlNotch
        isOpen={isNotchOpen}
        onClose={() => setIsNotchOpen(false)}
        telemetry={telemetry}
        audioDevices={audioDevices}
        selectAudioDevice={selectAudioDevice}
        fetchAudioDevices={fetchAudioDevices}
        setMasterVolume={setMasterVolume}
        setBrightness={setBrightness}
        toggleMute={toggleMute}
      />
    </div>
  );
};
