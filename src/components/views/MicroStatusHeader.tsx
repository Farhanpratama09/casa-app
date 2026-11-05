import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Zap } from 'lucide-react';
import { IslandMode } from '../../types/island';
import { CasaCompanionAvatar } from '../companion/CasaCompanionAvatar';
import { FocusRabbitIcon, TwinEqualizerGlyph } from '../system/CosmicIcons';
import { useSystemHardware } from '../../hooks/useSystemHardware';
import { useSkillStore } from '../../skills/store';
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

// 2. Modul Drop Shelf: Pocket / Shelf Glyph (Tas / Rak Penampung Berkas)
const DropShelfGlyph: React.FC<{ className?: string }> = ({ className = 'w-3.5 h-3.5' }) => (
  <svg viewBox="0 0 14 14" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Outline Badan Tas / Pocket */}
    <rect x="2" y="3.5" width="10" height="8" rx="2" stroke="currentColor" strokeWidth="1.2" />
    {/* Pegangan / Handle Tas Atas */}
    <path d="M4.5 3.5 V2.2 C4.5 1.7 5 1.2 5.6 1.2 H8.4 C9 1.2 9.5 1.7 9.5 2.2 V3.5" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
    {/* Garis Aksen Kantong / Pocket Flap */}
    <line x1="4.5" y1="6.8" x2="9.5" y2="6.8" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" strokeDasharray="1.5 1.5" opacity="0.8" />
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

  const mediaSkill = useSkillStore((s) => s.skillStates['core.media']);
  const isSpotifyActive = Boolean(
    mediaSkill?.playbackSource !== 'native' &&
    (mediaSkill?.song?.is_spotify || (mediaSkill?.isSpotifyRunning && !mediaSkill?.is_browser))
  );

  const modules: ModuleItem[] = [
    {
      id: 'expanded_music',
      name: 'Lunar Audio',
      activeColor: isSpotifyActive ? 'text-[#10b981]' : 'text-cyan-400',
      activeBg: isSpotifyActive ? 'bg-emerald-950/40' : 'bg-cyan-500/10',
      activeBorder: isSpotifyActive ? 'border border-emerald-500/30' : 'border border-cyan-500/30',
      Icon: TacticalSoundwaveGlyph,
    },
    {
      id: 'expanded_timer',
      name: 'Productivity',
      activeColor: 'text-[#818cf8]',
      activeBg: 'bg-[#818cf8]/15',
      activeBorder: 'border border-[#818cf8]/30',
      Icon: FocusRabbitIcon,
    },
    {
      id: 'drop_zone',
      name: 'Drop Shelf',
      activeColor: 'text-[#c084fc]',
      activeBg: 'bg-purple-950/40',
      activeBorder: 'border border-purple-500/35',
      Icon: DropShelfGlyph,
    },
  ];

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
      setTimeStr(`${hours}:${minutes}`);
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

  const normalizedMode =
    currentMode === 'expanded_todo' ? 'expanded_timer' : currentMode;
  const currentIdx = Math.max(
    0,
    modules.findIndex((m) => m.id === normalizedMode)
  );
  const activeModule = modules[currentIdx] || modules[0];

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
      className={`relative w-full h-[32px] shrink-0 select-none ${
        isNotchOpen ? 'z-40' : 'z-10'
      }`}
    >
      <div
        onClick={handleBarClick}
        className="w-full h-full px-4 pt-1 flex items-center justify-between border-b border-[#27272a] overflow-visible text-[11px] font-medium leading-none bg-[#09090b] cursor-pointer hover:bg-[#121215] transition-colors"
        title={
          isPeekPreview
            ? 'Klik untuk mengunci CASA (Lock Expanded)'
            : 'Klik header untuk menciutkan CASA (Collapse to Idle)'
        }
      >
        {/* Left: Interactive Vibing Companion Mascot + Divider Rapat (Anti-Kopong) */}
        <div
          data-tauri-drag-region
          className="flex items-center gap-2.5 shrink-0 cursor-default overflow-visible"
        >
          <div className="flex items-center h-7 shrink-0 overflow-visible">
            <CasaCompanionAvatar isPlaying={isPlaying} mood="awake" />
          </div>
          <span className="text-white/20 select-none text-xs font-light leading-none shrink-0" aria-hidden="true">|</span>
        </div>

        {/* Middle: Telemetry Clock (HH.mm.ss) + Tactile Segmented Lunar Astronomy Module Switcher */}
        <div className="flex items-center gap-2 shrink-0 h-full">
          <div
            data-tauri-drag-region
            data-idle-clock-date="true"
            className="flex items-center shrink-0 tabular-nums select-none cursor-default"
          >
            <span
              data-tauri-drag-region
              className="font-sans font-semibold text-[12px] tracking-tight tabular-nums text-zinc-100 antialiased"
            >
              {timeStr}
            </span>
            <span
              data-tauri-drag-region
              className="text-zinc-500/60 mx-1.5 text-[9px] select-none"
            >
              •
            </span>
            <span
              data-tauri-drag-region
              className="font-sans font-medium text-[11.5px] text-zinc-300 tracking-normal antialiased tabular-nums"
            >
              {dateStr}
            </span>
          </div>

          {/* Tactile Segmented Lunar Astronomy Module Switcher (Compacted to h-[22px] inside 28px bar) */}
          {(onSelectMode || onPrev || onNext) && (
            <div
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
              onMouseDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
              className="relative z-30 pointer-events-auto flex items-center gap-0.5 h-[22px] px-1 py-0 rounded-full bg-[#18181c] border border-[#2e2e34] ml-0.5 select-none"
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
                  if (onPrev) {
                    onPrev();
                  } else if (onSelectMode) {
                    const prevIdx = (currentIdx - 1 + modules.length) % modules.length;
                    onSelectMode(modules[prevIdx].id);
                  }
                }}
                className="w-5 h-5 flex items-center justify-center relative z-30 pointer-events-auto cursor-pointer text-zinc-400 hover:text-zinc-100 hover:bg-[#222226] active:scale-[0.97] rounded-full transition-all duration-100 ease-out"
                title="Modul Sebelumnya"
                aria-label="Previous Module"
              >
                <ChevronLeft className="w-3 h-3 pointer-events-none" />
              </button>

              <button
                type="button"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (onNext) {
                    onNext();
                  } else if (onSelectMode) {
                    const nextIdx = (currentIdx + 1) % modules.length;
                    onSelectMode(modules[nextIdx].id);
                  }
                }}
                className={`w-5 h-5 flex items-center justify-center rounded-full active:scale-[0.97] transition-all duration-100 ease-out pointer-events-auto cursor-pointer relative z-30 ${activeModule.activeColor} ${activeModule.activeBg} ${activeModule.activeBorder}`}
                title={`Modul: ${activeModule.name} (Klik untuk beralih)`}
                aria-label={`Modul: ${activeModule.name}`}
              >
                <activeModule.Icon className="w-3 h-3 shrink-0 pointer-events-none" />
              </button>

              <button
                type="button"
                style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  if (onNext) {
                    onNext();
                  } else if (onSelectMode) {
                    const nextIdx = (currentIdx + 1) % modules.length;
                    onSelectMode(modules[nextIdx].id);
                  }
                }}
                className="w-5 h-5 flex items-center justify-center relative z-30 pointer-events-auto cursor-pointer text-zinc-400 hover:text-zinc-100 hover:bg-[#222226] active:scale-[0.97] rounded-full transition-all duration-100 ease-out"
                title="Modul Berikutnya"
                aria-label="Next Module"
              >
                <ChevronRight className="w-3 h-3 pointer-events-none" />
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
              className="px-1.5 py-0.5 rounded text-[8.5px] font-mono tracking-tight transition-all ml-1 bg-[#18181c] hover:bg-[#222226] border border-[#2e2e34] text-zinc-300 font-semibold active:scale-[0.97]"
              title="Toggle Developer State Controls (Ctrl+Shift+D)"
              aria-label="Toggle Developer State Controls"
            >
              DEV
            </button>
          )}
        </div>

        {/* Right: Hardware Telemetry Pills & Lunar Control Notch Trigger */}
        <div className="flex items-center gap-1.5 shrink-0 h-full">
          {/* Caps Lock Indicator: AlertBunnyCaps (Hanya muncul saat Caps Lock aktif) */}
          {telemetry.is_caps_locked && (
            <div
              className="flex items-center gap-1 h-[20px] px-1.5 rounded text-[8.5px] font-mono font-bold tracking-[0.14em] uppercase bg-[rgba(192,132,252,0.12)] text-[#c084fc] border border-[rgba(192,132,252,0.25)] shadow-[0_0_8px_rgba(192,132,252,0.25)] select-none cursor-default"
              title="Caps Lock Aktif (VK_CAPITAL)"
            >
              <AlertBunnyCaps isActive={true} size={12} className="w-3 h-3 shrink-0 text-[#c084fc]" />
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
              className={`flex items-center h-[22px] px-1.5 rounded-full border transition-all duration-100 ease-out cursor-pointer select-none active:scale-[0.97] ${
                isNotchOpen
                  ? isSpotifyActive
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                    : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                  : 'bg-[#18181c] hover:bg-[#222226] border-[#2e2e34] text-zinc-300 hover:text-zinc-100'
              }`}
              title={`Baterai: ${telemetry.battery_percentage}%${telemetry.is_charging ? ' (Charging)' : ''} - Klik untuk Lunar Control Notch`}
              aria-label="Lunar Battery Control"
            >
              <MiniCircularBattery
                percentage={telemetry.battery_percentage}
                isCharging={telemetry.is_charging}
                hasBattery={telemetry.has_battery}
                size={16}
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
            className={`flex items-center gap-1.5 h-[22px] px-2 rounded-full border transition-all duration-100 ease-out cursor-pointer relative z-30 select-none active:scale-[0.97] ${
              telemetry.is_muted
                ? 'bg-zinc-800/80 text-zinc-400 border border-zinc-700 shadow-none'
                : isNotchOpen
                ? isSpotifyActive
                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-300'
                  : 'bg-cyan-500/15 border-cyan-500/40 text-cyan-300'
                : 'bg-[#18181c] hover:bg-[#222226] border-[#2e2e34] text-zinc-300 hover:text-zinc-100'
            }`}
            title={`Endpoint: ${telemetry.audio_device_name} (Vol: ${telemetry.master_volume}%) - Klik untuk Lunar Control Notch`}
            aria-label="Lunar Audio Control Notch"
          >
            {telemetry.is_muted ? (
              <MoonCraterSpeaker isMuted={true} className="w-3.5 h-3.5 shrink-0 text-zinc-400" />
            ) : telemetry.audio_device_type === 'headphone_bluetooth' ? (
              <BunnyHeadphonesBluetooth className="w-3.5 h-3.5 shrink-0 text-sky-400" />
            ) : telemetry.audio_device_type === 'headphone_wired' ? (
              <BunnyHeadphonesWired className="w-3.5 h-3.5 shrink-0 text-indigo-300" />
            ) : (
              <MoonCraterSpeaker isMuted={false} className={`w-3.5 h-3.5 shrink-0 ${isSpotifyActive ? 'text-emerald-400' : 'text-cyan-400'}`} />
            )}
            <span className={`font-mono text-[10px] tabular-nums font-semibold leading-none ${telemetry.is_muted ? 'text-zinc-400' : ''}`}>
              {telemetry.is_muted ? 'MUTED' : `${telemetry.master_volume}%`}
            </span>
          </button>

          {/* Dynamic Twin Audio Equalizer Glyph */}
          <TwinEqualizerGlyph active={isPlaying} isMuted={telemetry.is_muted} isSpotify={isSpotifyActive} className="ml-1" />
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
