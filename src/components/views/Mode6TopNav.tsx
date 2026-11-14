import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ChevronUp,
  Settings,
  Volume2,
  VolumeX,
  Sun,
  Zap,
  BatteryWarning,
  BatteryCharging,
  ArrowBigUpDash,
  Bluetooth,
  Headphones,
} from 'lucide-react';
import { IslandMode } from '../../types/island';
import { playChimeCue } from '../../utils/tauriBridge';
import { openDesktopSettingsWindow } from '../../utils/settingsWindow';
import { useSystemHardware, SystemHudAlert } from '../../hooks/useSystemHardware';
import { useSystemTelemetry } from '../../hooks/useSystemTelemetry';
import { useDropZoneStore } from '../../stores/useDropZoneStore';
import { BatteryPill } from '../system/BatteryPill';
import { CasaCompanionAvatar } from '../companion/CasaCompanionAvatar';

export interface Mode6TopNavProps {
  currentMode: IslandMode;
  onSelectMode: (mode: IslandMode) => void;
  onToggleDevTrigger?: () => void;
  onCollapse?: () => void;
  onHeaderClick?: (e: React.MouseEvent) => void;
  isPeekPreview?: boolean;
}

const NAV_TABS: Array<{ id: IslandMode; label: string; matchModes: IslandMode[] }> = [
  { id: 'expanded_music', label: 'Musik', matchModes: ['expanded_music'] },
  {
    id: 'expanded_timer',
    label: 'Focus & Tasks',
    matchModes: ['expanded_timer', 'expanded_todo'],
  },
  { id: 'expanded_control', label: 'Control Center', matchModes: ['expanded_control'] },
  { id: 'drop_zone', label: 'Drop Zone', matchModes: ['drop_zone'] },
];

const renderHudIcon = (alert: SystemHudAlert) => {
  switch (alert.kind) {
    case 'volume':
      return (
        <Volume2
          className="w-3 h-3 shrink-0"
          style={{ color: alert.isActive ? 'var(--casa-volume, #38BDF8)' : 'var(--casa-danger, #F43F5E)' }}
        />
      );
    case 'mute':
      return alert.isActive ? (
        <VolumeX className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-danger, #F43F5E)' }} />
      ) : (
        <Volume2 className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-volume, #38BDF8)' }} />
      );
    case 'brightness':
      return <Sun className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-brightness, #FACC15)' }} />;
    case 'charging':
      return alert.isActive ? (
        <BatteryCharging className="w-3 h-3 text-emerald-400 shrink-0" />
      ) : (
        <Zap className="w-3 h-3 text-amber-300 shrink-0" />
      );
    case 'low_battery':
      return <BatteryWarning className="w-3 h-3 text-red-400 shrink-0" />;
    case 'caps_lock':
      return (
        <ArrowBigUpDash
          className={`w-3 h-3 shrink-0 ${alert.isActive ? 'text-sky-400' : 'text-white/55'}`}
        />
      );
    case 'bluetooth':
      return (
        <Bluetooth
          className={`w-3 h-3 shrink-0 ${alert.isActive ? 'text-sky-400' : 'text-zinc-400'}`}
        />
      );
    case 'audio_output':
      return alert.audioOutputKind === 'bluetooth' ? (
        <Bluetooth className="w-3 h-3 text-sky-400 shrink-0" />
      ) : alert.audioOutputKind === 'wired' ? (
        <Headphones className="w-3 h-3 text-indigo-300 shrink-0" />
      ) : (
        <Volume2 className="w-3 h-3 text-emerald-400 shrink-0" />
      );
  }
};

export const Mode6TopNav: React.FC<Mode6TopNavProps> = ({
  currentMode,
  onSelectMode,
  onToggleDevTrigger,
  onCollapse,
  onHeaderClick,
  isPeekPreview = false,
}) => {
  const { hudAlert: rawHudAlert } = useSystemHardware();
  const { stats: systemStats } = useSystemTelemetry(false);
  const dropZoneCount = useDropZoneStore((s) => s.items.length);
  const isControlCenterTab = currentMode === 'expanded_control';
  const showHeaderBattery = systemStats.battery.has_battery && !isControlCenterTab;
  const hudAlert =
    isControlCenterTab &&
    rawHudAlert &&
    (rawHudAlert.kind === 'volume' ||
      rawHudAlert.kind === 'brightness' ||
      rawHudAlert.kind === 'mute')
      ? null
      : rawHudAlert;

  return (
    <header
      onClick={onHeaderClick}
      className="w-full h-[34px] px-2.5 grid grid-cols-[1fr_auto_1fr] items-center gap-2 bg-[#000000] border-b border-white/[0.08] select-none shrink-0 relative z-30"
    >
      {/* Kiri: Mata Reaktif Companion */}
      <div className="flex items-center justify-start min-w-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onHeaderClick?.(e);
          }}
          onContextMenu={(e) => {
            if (!import.meta.env.DEV) return;
            e.preventDefault();
            e.stopPropagation();
            onToggleDevTrigger?.();
          }}
          className="w-[32px] h-[22px] rounded-full flex items-center justify-center hover:bg-white/[0.06] transition-colors cursor-pointer shrink-0"
          title={
            isPeekPreview
              ? 'Klik untuk mengunci Mode 6'
              : import.meta.env.DEV
              ? 'CASA (Klik kanan: Dev Trigger)'
              : 'CASA'
          }
          aria-label="CASA Eyes"
        >
          <CasaCompanionAvatar />
        </button>
      </div>

      {/* Tengah: Bar Navigasi Kapsul Gelap atau Transient System HUD Badge */}
      <div className="relative flex items-center justify-center min-w-0">
        <AnimatePresence mode="wait" initial={false}>
          {hudAlert ? (
            <motion.div
              key={`mode6-hud-${hudAlert.id}`}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.14 }}
              className="flex items-center gap-2 px-2.5 py-[3px] rounded-full bg-[#111114] border border-white/[0.14] text-[10px] font-medium text-white shadow-sm"
            >
              {renderHudIcon(hudAlert)}
              <span className="whitespace-nowrap">{hudAlert.label}</span>
              {typeof hudAlert.percent === 'number' && (
                <div className="w-14 h-[4px] rounded-full bg-white/15 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-150"
                    style={{
                      width: `${Math.max(0, Math.min(100, hudAlert.percent))}%`,
                      backgroundColor: hudAlert.accentColor,
                    }}
                  />
                </div>
              )}
              {hudAlert.detail && (
                <span className="tabular-nums text-white/75">{hudAlert.detail}</span>
              )}
            </motion.div>
          ) : (
            <motion.nav
              key="mode6-nav-tabs"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              aria-label="Navigasi Modul Mode 6"
              className="flex items-center gap-0.5 p-[2.5px] rounded-full bg-[#0b0b0d] border border-white/[0.08]"
            >
              {NAV_TABS.map((tab) => {
                const isActive = tab.matchModes.includes(currentMode);
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      playChimeCue('tap');
                      onSelectMode(tab.id);
                    }}
                    className={`relative px-2 py-[3px] rounded-full text-[10px] leading-none tracking-tight transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                      isActive
                        ? 'text-white font-semibold'
                        : 'text-white/50 hover:text-white/85 font-medium'
                    }`}
                  >
                    {isActive && (
                      <motion.span
                        layoutId="mode6-nav-active-pill"
                        transition={{ type: 'spring', stiffness: 440, damping: 32, mass: 0.7 }}
                        className="absolute inset-0 rounded-full bg-white/[0.15] border border-white/[0.12] pointer-events-none"
                      />
                    )}
                    <span className="relative z-10 inline-flex items-center gap-1">
                      <span>{tab.label}</span>
                      {tab.id === 'drop_zone' && dropZoneCount > 0 && (
                        <span
                          className={`px-1.5 py-[1px] rounded-full text-[8.5px] font-mono leading-none tabular-nums ${
                            isActive
                              ? 'bg-white text-black font-bold'
                              : 'bg-white/[0.14] text-white/80'
                          }`}
                        >
                          {dropZoneCount}
                        </span>
                      )}
                    </span>
                  </button>
                );
              })}
            </motion.nav>
          )}
        </AnimatePresence>
      </div>

      {/* Kanan: Icon Baterai Ringkas (Auto-Hide di Control Center) + Tombol Minimize / Tutup ke Idle */}
      <div className="flex items-center justify-end gap-1.5 shrink-0 min-w-0">
        {showHeaderBattery && (
          <BatteryPill battery={systemStats.battery} showPercentage={false} />
        )}
        <button
          type="button"
          data-settings-btn="true"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            playChimeCue('tap');
            void openDesktopSettingsWindow();
          }}
          className="w-6 h-6 rounded-full bg-white/[0.06] hover:bg-white/[0.16] border border-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer shrink-0"
          title="Buka Pengaturan CASA"
          aria-label="Pengaturan CASA"
        >
          <Settings className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          data-collapse-btn="true"
          onMouseDown={(e) => {
            e.stopPropagation();
          }}
          onClick={(e) => {
            e.stopPropagation();
            playChimeCue('tap');
            onCollapse?.();
          }}
          className="w-6 h-6 rounded-full bg-white/[0.06] hover:bg-white/[0.16] border border-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer shrink-0"
          title="Tutup Mode 6 ke Idle"
          aria-label="Tutup Mode 6"
        >
          <ChevronUp className="w-3.5 h-3.5" />
        </button>
      </div>
    </header>
  );
};
