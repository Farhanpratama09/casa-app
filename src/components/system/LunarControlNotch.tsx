import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { VolumeX, X, ChevronDown } from 'lucide-react';
import type { SystemTelemetry, AudioDeviceItem } from '../../hooks/useSystemHardware';
import {
  BunnyHeadphonesWired,
  BunnyHeadphonesBluetooth,
  MoonCraterSpeaker,
  StardustBatteryCapsule,
  AlertBunnyCaps,
  MoonPhaseIcon,
} from './LunarIcons';

export interface LunarControlNotchProps {
  isOpen: boolean;
  onClose: () => void;
  telemetry: SystemTelemetry;
  audioDevices?: AudioDeviceItem[];
  selectAudioDevice?: (id: string) => Promise<void>;
  fetchAudioDevices?: () => Promise<AudioDeviceItem[]>;
  setMasterVolume: (level: number) => Promise<void>;
  setBrightness: (level: number) => Promise<void>;
  toggleMute: () => Promise<void>;
}

export const LunarControlNotch: React.FC<LunarControlNotchProps> = ({
  isOpen,
  onClose,
  telemetry,
  audioDevices = [],
  selectAudioDevice,
  fetchAudioDevices,
  setMasterVolume,
  setBrightness,
  toggleMute,
}) => {
  // Local state for 60fps responsive slider dragging
  const [localVolume, setLocalVolume] = useState<number>(telemetry.master_volume);
  const [localBrightness, setLocalBrightness] = useState<number>(telemetry.brightness_percent);
  const [isDevicePickerOpen, setIsDevicePickerOpen] = useState(false);
  const volumeDebounceTimer = useRef<NodeJS.Timeout | null>(null);
  const devicePickerRef = useRef<HTMLDivElement>(null);

  // Sync local state when external telemetry changes
  useEffect(() => {
    setLocalVolume(telemetry.master_volume);
  }, [telemetry.master_volume]);

  useEffect(() => {
    setLocalBrightness(telemetry.brightness_percent);
  }, [telemetry.brightness_percent]);

  // Click-outside handler for Device Picker dropdown
  useEffect(() => {
    if (!isDevicePickerOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (devicePickerRef.current && !devicePickerRef.current.contains(e.target as Node)) {
        setIsDevicePickerOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isDevicePickerOpen]);

  // Keyboard shortcut: Escape to close
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        if (isDevicePickerOpen) {
          setIsDevicePickerOpen(false);
        } else {
          onClose();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isDevicePickerOpen, onClose]);

  // Volume slider handlers
  const handleVolumeChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const val = Number(e.target.value);
      setLocalVolume(val);

      if (volumeDebounceTimer.current) {
        clearTimeout(volumeDebounceTimer.current);
      }
      volumeDebounceTimer.current = setTimeout(() => {
        setMasterVolume(val);
      }, 50);
    },
    [setMasterVolume]
  );

  const handleVolumeCommit = useCallback(
    (val: number) => {
      if (volumeDebounceTimer.current) {
        clearTimeout(volumeDebounceTimer.current);
        volumeDebounceTimer.current = null;
      }
      setMasterVolume(val);
    },
    [setMasterVolume]
  );

  // Brightness slider handlers
  const handleBrightnessChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setLocalBrightness(Number(e.target.value));
  }, []);

  const handleBrightnessCommit = useCallback(
    (val: number) => {
      if (!telemetry.is_brightness_supported) return;
      setBrightness(val);
    },
    [telemetry.is_brightness_supported, setBrightness]
  );

  // Audio Device classification icon
  const renderEndpointIcon = () => {
    switch (telemetry.audio_device_type) {
      case 'headphone_bluetooth':
        return <BunnyHeadphonesBluetooth className="w-4 h-4 text-sky-400 shrink-0" />;
      case 'headphone_wired':
        return <BunnyHeadphonesWired className="w-4 h-4 text-indigo-300 shrink-0" />;
      case 'speaker':
      default:
        return <MoonCraterSpeaker className="w-4 h-4 text-[#98BBD6] shrink-0" />;
    }
  };

  const getDeviceBadgeLabel = () => {
    switch (telemetry.audio_device_type) {
      case 'headphone_bluetooth':
        return 'BLUETOOTH';
      case 'headphone_wired':
        return 'WIRED';
      case 'speaker':
      default:
        return 'SPEAKER';
    }
  };

  // Math calculation for Tapered Cyber-Carrot Track polygon
  const volPct = Math.max(0, Math.min(100, localVolume));
  const carrotTop = 5.5 - 3.5 * (volPct / 100);
  const carrotBottom = 8.5 + 3.5 * (volPct / 100);

  return (
    <AnimatePresence>
      {isOpen && (
        <div
          data-interactive="true"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
          onPointerDown={(e) => e.stopPropagation()}
          className="absolute top-[28px] left-0 w-full h-[140px] z-50 flex flex-col justify-start pointer-events-auto select-none"
        >
          {/* Backdrop Overlay semi-transparan over the media canvas */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => {
              e.stopPropagation();
              onClose();
            }}
            className="absolute inset-0 bg-black/50 backdrop-blur-md cursor-pointer"
          />

          {/* Expanding Lunar Notch Docked Sheet */}
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative z-10 w-full bg-[#08090C]/90 backdrop-blur-2xl border-b border-x border-white/[0.07] shadow-[0_12px_32px_rgba(0,0,0,0.85)] rounded-b-2xl px-4 py-2.5 flex flex-col gap-2 pointer-events-auto"
          >
            {/* Header: Device Routing Header & Close Button */}
            <div className="flex items-center justify-between gap-2 border-b border-white/[0.06] pb-1.5 relative">
              <div className="relative">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (fetchAudioDevices) fetchAudioDevices();
                    setIsDevicePickerOpen((prev) => !prev);
                  }}
                  className={`flex items-center gap-2 px-2 py-1 rounded-lg border transition-all cursor-pointer text-left select-none ${
                    isDevicePickerOpen
                      ? 'bg-[#98BBD6]/15 border-[#98BBD6]/40 text-white shadow-[0_0_10px_rgba(152,187,214,0.3)]'
                      : 'bg-white/[0.03] hover:bg-white/[0.07] border-white/[0.07] text-white/90'
                  }`}
                  title="Klik untuk memilih rute output audio"
                >
                  {renderEndpointIcon()}
                  <span className="font-sans text-[11px] font-semibold tracking-wide truncate max-w-[280px]">
                    {telemetry.audio_device_name}
                  </span>
                  <span className="font-sans text-[8.5px] tracking-[0.14em] uppercase font-semibold px-1.5 py-0.5 rounded bg-white/[0.06] text-white/60 border border-white/[0.07] shrink-0">
                    {getDeviceBadgeLabel()}
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 text-white/40 transition-transform ${
                      isDevicePickerOpen ? 'rotate-180 text-[#98BBD6]' : ''
                    }`}
                  />
                </button>

                {/* Output Audio Selector Dropdown */}
                {isDevicePickerOpen && (
                  <div
                    ref={devicePickerRef}
                    className="absolute top-full mt-1.5 left-0 z-50 w-[310px] bg-[#0c0e14]/95 backdrop-blur-2xl border border-white/[0.08] shadow-[0_12px_32px_rgba(0,0,0,0.95)] rounded-xl p-2 flex flex-col gap-1 select-none"
                  >
                    <div className="flex items-center justify-between px-2 py-1 border-b border-white/[0.06]">
                      <span className="font-sans text-[9px] tracking-[0.14em] uppercase font-semibold text-white/50">
                        PILIH OUTPUT AUDIO
                      </span>
                      <span className="font-mono text-[9px] text-white/40 tabular-nums">
                        {audioDevices.length} Perangkat
                      </span>
                    </div>
                    <div className="max-h-[120px] overflow-y-auto flex flex-col gap-1 py-1">
                      {audioDevices.map((dev) => {
                        const isSelected =
                          dev.is_default || dev.name === telemetry.audio_device_name;
                        return (
                          <button
                            key={dev.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (selectAudioDevice) selectAudioDevice(dev.id);
                              setIsDevicePickerOpen(false);
                            }}
                            className={`flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left transition-all cursor-pointer ${
                              isSelected
                                ? 'bg-[#98BBD6]/15 border border-[#98BBD6]/35 text-white shadow-[0_0_8px_rgba(152,187,214,0.25)]'
                                : 'hover:bg-white/[0.05] border border-transparent text-white/70 hover:text-white'
                            }`}
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              {dev.device_type === 'headphone_bluetooth' ? (
                                <BunnyHeadphonesBluetooth className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                              ) : dev.device_type === 'headphone_wired' ? (
                                <BunnyHeadphonesWired className="w-3.5 h-3.5 text-indigo-300 shrink-0" />
                              ) : (
                                <MoonCraterSpeaker className="w-3.5 h-3.5 text-[#98BBD6] shrink-0" />
                              )}
                              <span className="font-sans text-[10.5px] font-medium truncate max-w-[210px]">
                                {dev.name}
                              </span>
                            </div>
                            {isSelected && (
                              <span className="w-1.5 h-1.5 rounded-full bg-[#98BBD6] shadow-[0_0_6px_#98BBD6] shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="w-5 h-5 flex items-center justify-center rounded text-white/40 hover:text-white/90 hover:bg-white/10 transition-colors cursor-pointer"
                title="Tutup Lunar Notch (Esc)"
                aria-label="Close Lunar Notch"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            {/* A. Master Volume Fader (Tapered Cyber-Carrot Track) */}
            <div className="flex items-center gap-3">
              {/* Quick Mute Tactile Button */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleMute();
                }}
                className={`flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] transition-all cursor-pointer shrink-0 select-none ${
                  telemetry.is_muted
                    ? 'bg-rose-500/20 text-rose-300 border-rose-500/40 shadow-[0_0_8px_rgba(244,63,94,0.3)]'
                    : 'bg-white/[0.04] hover:bg-white/[0.08] text-white/70 hover:text-white border-white/[0.07]'
                }`}
                title={telemetry.is_muted ? 'Klik untuk Unmute' : 'Klik untuk Mute'}
              >
                <VolumeX
                  className={`w-3.5 h-3.5 ${
                    telemetry.is_muted ? 'text-rose-400' : 'text-white/60'
                  }`}
                />
                <span className="font-sans text-[9px] tracking-[0.14em] uppercase font-semibold">
                  {telemetry.is_muted ? 'MUTED' : 'VOL'}
                </span>
              </button>

              {/* Tapered Cyber-Carrot Track Container */}
              <div className="relative flex-1 h-6 flex items-center">
                <svg
                  viewBox="0 0 100 14"
                  preserveAspectRatio="none"
                  className="w-full h-3.5 pointer-events-none rounded"
                >
                  <defs>
                    <linearGradient id="cyberCarrotGrad" x1="0" y1="0" x2="1" y2="0">
                      <stop offset="0%" stopColor="#F97316" />
                      <stop offset="100%" stopColor="#FB923C" />
                    </linearGradient>
                  </defs>

                  {/* Background Track */}
                  <polygon
                    points="0,5.5 100,2 100,12 0,8.5"
                    fill="rgba(255, 255, 255, 0.08)"
                  />

                  {/* Active Fill */}
                  {volPct > 0 && (
                    <polygon
                      points={`0,5.5 ${volPct},${carrotTop} ${volPct},${carrotBottom} 0,8.5`}
                      fill="url(#cyberCarrotGrad)"
                      style={{
                        filter: 'drop-shadow(0 0 6px rgba(249, 115, 22, 0.45))',
                      }}
                    />
                  )}
                </svg>

                {/* Handle / Thumb: Obsidian Crystal Capsule */}
                <div
                  className="absolute top-1/2 -translate-y-1/2 w-3.5 h-5 rounded-[4px] bg-[#12141a] border border-white/30 shadow-[0_0_8px_rgba(249,115,22,0.4)] flex items-center justify-center pointer-events-none transition-transform"
                  style={{
                    left: `calc(${volPct}% - ${volPct * 0.14}px)`,
                  }}
                >
                  <div className="w-[1.5px] h-2.5 rounded-full bg-[#FB923C] shadow-[0_0_4px_#FB923C]" />
                </div>

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={localVolume}
                  onChange={handleVolumeChange}
                  onPointerUp={(e) => handleVolumeCommit(Number(e.currentTarget.value))}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                  title={`Volume: ${localVolume}%`}
                  aria-label="Master Volume"
                />
              </div>

              {/* Numeric Metric Value */}
              <span className="font-mono text-xs tabular-nums font-semibold text-white/90 w-10 text-right shrink-0">
                {telemetry.is_muted ? '0%' : `${localVolume}%`}
              </span>
            </div>

            {/* B. Display Brightness Fader (Moon Phase Orbit Track) */}
            <div className="flex items-center gap-3">
              <div
                className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-white/[0.04] border border-white/[0.07] text-[10px] text-white/70 shrink-0"
                title="Kecerahan Layar"
              >
                <MoonPhaseIcon
                  percentage={localBrightness}
                  size={14}
                  className="w-3.5 h-3.5 text-white/80"
                />
                <span className="font-sans text-[9px] tracking-[0.14em] uppercase font-semibold text-white/60">
                  LUMEN
                </span>
              </div>

              <div
                className={`relative flex-1 h-6 flex items-center ${
                  !telemetry.is_brightness_supported ? 'opacity-40 cursor-not-allowed' : ''
                }`}
                title={
                  telemetry.is_brightness_supported
                    ? `Kecerahan Layar: ${localBrightness}%`
                    : 'External Display (WMI Disabled)'
                }
              >
                <div className="relative w-full h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-white/30 to-[#E2E8F0]"
                    style={{
                      width: telemetry.is_brightness_supported ? `${localBrightness}%` : '0%',
                    }}
                  />
                </div>

                {telemetry.is_brightness_supported && (
                  <div
                    className="absolute top-1/2 -translate-y-1/2 pointer-events-none transition-transform flex items-center justify-center text-white drop-shadow-[0_0_8px_rgba(255,255,255,0.7)]"
                    style={{
                      left: `calc(${localBrightness}% - 10px)`,
                    }}
                  >
                    <MoonPhaseIcon percentage={localBrightness} size={18} className="w-4 h-4" />
                  </div>
                )}

                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  disabled={!telemetry.is_brightness_supported}
                  value={localBrightness}
                  onChange={handleBrightnessChange}
                  onPointerUp={(e) => handleBrightnessCommit(Number(e.currentTarget.value))}
                  className={`absolute inset-0 w-full h-full opacity-0 ${
                    telemetry.is_brightness_supported ? 'cursor-pointer' : 'cursor-not-allowed'
                  }`}
                  aria-label="Display Brightness"
                />
              </div>

              {/* Numeric Metric Value */}
              <span className="font-mono text-xs tabular-nums font-semibold text-white/90 w-10 text-right shrink-0">
                {telemetry.is_brightness_supported ? `${localBrightness}%` : 'N/A'}
              </span>
            </div>

            {/* Sub-strip Footer Telemetry */}
            <div className="flex items-center justify-between pt-1 border-t border-white/[0.04] text-[9.5px]">
              <div className="flex items-center gap-1.5">
                <AlertBunnyCaps
                  isActive={telemetry.is_caps_locked}
                  size={14}
                  className="w-3.5 h-3.5"
                />
                <span
                  className={`font-sans text-[9px] tracking-[0.14em] uppercase font-semibold ${
                    telemetry.is_caps_locked ? 'text-rose-400' : 'text-white/40'
                  }`}
                >
                  {telemetry.is_caps_locked ? 'CAPS LOCK AKTIF' : 'CAPS LOCK NONAKTIF'}
                </span>
              </div>

              <div className="flex items-center gap-1.5 text-white/60">
                <StardustBatteryCapsule
                  percentage={telemetry.battery_percentage}
                  isCharging={telemetry.is_charging}
                  size={18}
                  className="w-4 h-2.5"
                />
                <span className="font-mono text-[9.5px] tabular-nums">
                  {telemetry.has_battery
                    ? `${telemetry.battery_percentage}% ${
                        telemetry.is_charging ? '(Charging)' : ''
                      }`
                    : 'Desktop (AC)'}
                </span>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
};
