import React, { useEffect } from 'react';
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
import {
  requestSilentUpdateCheck,
  useUpdateNotification,
} from '../../hooks/useUpdateNotification';
import { useSettingsStore } from '../../stores/useSettingsStore';

export interface Mode6TopNavProps {
  currentMode: IslandMode;
  onSelectMode: (mode: IslandMode) => void;
  onToggleDevTrigger?: () => void;
  onCollapse?: () => void;
  onHeaderClick?: (e: React.MouseEvent) => void;
  isPeekPreview?: boolean;
}

const BASE_NAV_TABS: Array<{ id: IslandMode; label: string; matchModes: IslandMode[] }> = [
  { id: 'expanded_music', label: 'Musik', matchModes: ['expanded_music'] },
  {
    id: 'expanded_timer',
    label: 'Focus & Tasks',
    matchModes: ['expanded_timer', 'expanded_todo'],
  },
  { id: 'expanded_control', label: 'Control Center', matchModes: ['expanded_control'] },
  { id: 'drop_zone', label: 'Drop Zone', matchModes: ['drop_zone'] },
];

const IBADAH_NAV_TAB: { id: IslandMode; label: string; matchModes: IslandMode[] } = {
  id: 'expanded_ibadah',
  label: 'Ibadah',
  matchModes: ['expanded_ibadah'],
};

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
        <BatteryCharging className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-rest, #10B981)' }} />
      ) : (
        <Zap className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-timer, #F59E0B)' }} />
      );
    case 'low_battery':
      return <BatteryWarning className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-danger, #F43F5E)' }} />;
    case 'caps_lock':
      return (
        <ArrowBigUpDash
          className="w-3 h-3 shrink-0"
          style={{ color: alert.isActive ? 'var(--casa-volume, #38BDF8)' : 'rgba(255,255,255,0.55)' }}
        />
      );
    case 'bluetooth':
      return (
        <Bluetooth
          className="w-3 h-3 shrink-0"
          style={{ color: alert.isActive ? 'var(--casa-bluetooth, #6366F1)' : '#a1a1aa' }}
        />
      );
    case 'audio_output':
      return alert.audioOutputKind === 'bluetooth' ? (
        <Bluetooth className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-bluetooth, #6366F1)' }} />
      ) : alert.audioOutputKind === 'wired' ? (
        <Headphones className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-volume, #38BDF8)' }} />
      ) : (
        <Volume2 className="w-3 h-3 shrink-0" style={{ color: 'var(--casa-volume, #38BDF8)' }} />
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
  const updateNotification = useUpdateNotification();
  const availableUpdateVersion = updateNotification.latestVersion;
  const { settings, palette } = useSettingsStore();
  const updateAccent = settings.theme === 'monochrome' ? '#FFFFFF' : palette.timer;

  // Trigger lightweight debounced update check whenever Mode 6 opens
  // (compensates for WS_EX_NOACTIVATE preventing native window.focus events)
  useEffect(() => {
    requestSilentUpdateCheck(false);
  }, []);
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

  const navTabs = settings.ibadah.enabled
    ? [...BASE_NAV_TABS, IBADAH_NAV_TAB]
    : BASE_NAV_TABS;
  const isCompactFiveTab = navTabs.length >= 5;

  return (
    <header
      onClick={onHeaderClick}
      className="w-full h-[34px] px-2.5 flex items-center justify-between gap-1.5 bg-[#000000] border-b border-white/[0.08] select-none shrink-0 relative z-30"
    >
      {/* Kiri: Mata Reaktif Companion */}
      <div className="flex items-center justify-start shrink-0">
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
      <div className="relative flex-1 flex items-center justify-center min-w-0">
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
              className="flex items-center gap-0.5 p-[2.5px] rounded-full bg-[#0b0b0d] border border-white/[0.08] max-w-full"
            >
              {navTabs.map((tab) => {
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
                    className={`relative rounded-full leading-none tracking-tight transition-colors duration-150 cursor-pointer whitespace-nowrap ${
                      isCompactFiveTab ? 'px-1.5 py-[3px] text-[9.5px]' : 'px-2 py-[3px] text-[10px]'
                    } ${
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

      {/* Kanan: Cincin Baterai Lingkaran (Auto-Hide di Control Center) + Settings + Collapse */}
      <div className="flex items-center justify-end gap-1 shrink-0 min-w-0">
        {showHeaderBattery && (
          <BatteryPill battery={systemStats.battery} showPercentage={true} size={14} />
        )}
        <div className="relative shrink-0">
          <button
            type="button"
            data-settings-btn="true"
            onMouseDown={(e) => {
              e.stopPropagation();
            }}
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              if (updateNotification.updateAvailable) {
                void updateNotification.dismissBadge();
                void openDesktopSettingsWindow('system');
              } else {
                void openDesktopSettingsWindow();
              }
            }}
            style={
              updateNotification.updateAvailable
                ? {
                    borderColor:
                      settings.theme === 'monochrome'
                        ? 'rgba(255,255,255,0.48)'
                        : `${palette.timer}88`,
                    color: '#FFFFFF',
                  }
                : undefined
            }
            className="relative w-[22px] h-[22px] rounded-full bg-white/[0.06] hover:bg-white/[0.16] border border-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer shrink-0"
            title={
              updateNotification.updateAvailable && availableUpdateVersion
                ? `Update v${availableUpdateVersion} tersedia — Klik untuk cek pembaruan`
                : 'Buka Pengaturan CASA'
            }
            aria-label={
              updateNotification.updateAvailable && availableUpdateVersion
                ? `Update v${availableUpdateVersion} tersedia — Pengaturan CASA`
                : 'Pengaturan CASA'
            }
          >
            <Settings className="w-3 h-3" />
            {updateNotification.updateAvailable && (
              <span
                data-update-badge="true"
                className="absolute -top-0.5 -right-0.5 flex h-[6.5px] w-[6.5px] pointer-events-none select-none"
              >
                <span
                  style={{ backgroundColor: updateAccent }}
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-80"
                />
                <span
                  style={{ backgroundColor: updateAccent }}
                  className="relative inline-flex rounded-full h-[6.5px] w-[6.5px] ring-1 ring-black"
                />
              </span>
            )}
          </button>

          {/* Compact floating pop-up notification anchored directly under the Settings gear */}
          <AnimatePresence>
            {updateNotification.updateAvailable &&
              updateNotification.badgeVisible &&
              availableUpdateVersion && (
                <motion.button
                  key="mode6-gear-update-popup"
                  type="button"
                  data-update-popup="true"
                  initial={{ opacity: 0, y: -4, scale: 0.94 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -3, scale: 0.95 }}
                  transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    void updateNotification.dismissBadge();
                    void openDesktopSettingsWindow('system');
                  }}
                  style={{
                    borderColor:
                      settings.theme === 'monochrome'
                        ? 'rgba(255,255,255,0.34)'
                        : `${palette.timer}66`,
                    boxShadow: '0 8px 20px rgba(0, 0, 0, 0.85)',
                  }}
                  className="absolute top-[28px] -right-[16px] z-50 px-2.5 py-1.5 rounded-lg bg-[#0d0d10]/95 backdrop-blur-md border text-left cursor-pointer hover:bg-[#141419] active:scale-[0.98] transition-all whitespace-nowrap"
                  title={`Buka System & Updates untuk memeriksa v${availableUpdateVersion}`}
                >
                  <span
                    aria-hidden="true"
                    style={{
                      borderColor:
                        settings.theme === 'monochrome'
                          ? 'rgba(255,255,255,0.34)'
                          : `${palette.timer}66`,
                    }}
                    className="absolute -top-[4px] right-[23px] w-2 h-2 rotate-45 bg-[#0d0d10] border-l border-t"
                  />
                  <div className="flex items-center gap-1.5">
                    <span
                      style={{ backgroundColor: updateAccent }}
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                    />
                    <span className="text-[10px] font-semibold text-white leading-none">
                      Update v{availableUpdateVersion}
                    </span>
                  </div>
                  <div className="text-[9px] text-white/55 mt-0.5 leading-none">
                    Klik untuk Check for Updates
                  </div>
                </motion.button>
              )}
          </AnimatePresence>
        </div>
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
          className="w-[22px] h-[22px] rounded-full bg-white/[0.06] hover:bg-white/[0.16] border border-white/[0.08] text-white/60 hover:text-white flex items-center justify-center transition-all active:scale-90 cursor-pointer shrink-0"
          title="Tutup Mode 6 ke Idle"
          aria-label="Tutup Mode 6"
        >
          <ChevronUp className="w-3 h-3" />
        </button>
      </div>
    </header>
  );
};
