import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Wifi,
  WifiOff,
  Bluetooth,
  BluetoothOff,
  Coffee,
  Volume2,
  VolumeX,
  Sun,
  RefreshCw,
  X,
  Lock,
  Check,
  Headphones,
  Loader2,
  ChevronRight,
  ExternalLink,
  ShieldAlert,
  MoonStar,
  Calculator,
} from 'lucide-react';
import { useSystemHardware, formatAudioOutputLabel } from '../../../hooks/useSystemHardware';
import { useSystemTelemetry } from '../../../hooks/useSystemTelemetry';
import { BatteryPill } from '../../system/BatteryPill';
import { playChimeCue, focusIslandWindow } from '../../../utils/tauriBridge';
import { CASA_THEME_PALETTES, useSettingsStore } from '../../../stores/useSettingsStore';

export interface Mode6ControlCenterViewProps {
  onOpenMusic?: () => void;
  podHostEl?: HTMLDivElement | null;
  capsuleWidth?: number;
  isWifiPodOpen?: boolean;
  isBtPodOpen?: boolean;
  onToggleWifiPod?: () => void;
  onToggleBtPod?: () => void;
  onCloseWifiPod?: () => void;
  onCloseBtPod?: () => void;
  onInteractionLock?: () => void;
}

interface SmoothSliderProps {
  icon: React.ReactNode;
  label: string;
  value: number;
  accentColor: string;
  disabled?: boolean;
  muted?: boolean;
  onChange: (val: number) => void;
}

const SmoothOledSlider: React.FC<SmoothSliderProps> = ({
  icon,
  label,
  value,
  accentColor,
  disabled = false,
  muted = false,
  onChange,
}) => {
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const computeValue = (clientX: number) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onChange(Math.round(ratio * 100));
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (disabled) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    computeValue(e.clientX);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || disabled) return;
    e.stopPropagation();
    computeValue(e.clientX);
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    e.stopPropagation();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {}
    setIsDragging(false);
  };

  const clamped = Math.max(0, Math.min(100, Math.round(value)));

  return (
    <div
      onWheel={(e) => {
        e.stopPropagation();
        if (disabled) return;
        const delta = e.deltaY < 0 ? 5 : -5;
        onChange(Math.max(0, Math.min(100, clamped + delta)));
      }}
      title={label}
      className={`h-[30px] rounded-xl bg-[#0a0a0a] border border-white/[0.06] px-2.5 flex items-center gap-2 select-none transition-colors hover:border-white/[0.14] ${
        disabled ? 'opacity-45 cursor-not-allowed' : ''
      }`}
    >
      {/* Left Icon */}
      <span className="shrink-0 flex items-center justify-center pointer-events-none">
        {icon}
      </span>

      {/* Interactive Click/Drag Bar */}
      <div
        ref={trackRef}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={clamped}
        tabIndex={0}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`relative flex-1 h-full flex items-center touch-none ${
          disabled ? 'cursor-not-allowed' : 'cursor-pointer'
        }`}
      >
        <div className="relative w-full h-[6px] rounded-full bg-white/[0.10] overflow-hidden">
          <div
            className={`h-full rounded-full transition-[width,background-color] ${
              isDragging ? 'duration-0' : 'duration-75 ease-out'
            }`}
            style={{
              width: `${clamped}%`,
              backgroundColor: muted ? 'var(--casa-danger, #F43F5E)' : accentColor,
            }}
          />
        </div>
      </div>

      {/* Right Tabular Percentage */}
      <span className="shrink-0 min-w-[28px] text-right text-[10px] font-semibold font-sans tabular-nums text-white/80 pointer-events-none">
        {muted ? 'Mute' : `${clamped}%`}
      </span>
    </div>
  );
};

interface RadialMetricCardProps {
  centerLabel: string;
  percent: number;
  strokeColor: string;
  primaryText: string;
  secondaryText: string;
  valueClassName?: string;
}

const RadialMetricCard: React.FC<RadialMetricCardProps> = ({
  centerLabel,
  percent,
  strokeColor,
  primaryText,
  secondaryText,
  valueClassName = 'text-white/90',
}) => {
  const clamped = Math.max(0, Math.min(100, percent));
  const radius = 13.5;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference * (1 - clamped / 100);

  return (
    <div className="h-[42px] rounded-xl bg-[#0a0a0a] border border-white/[0.06] px-2.5 flex items-center gap-2.5 min-w-0">
      <div className="relative w-[36px] h-[36px] shrink-0 flex items-center justify-center">
        <svg className="w-[36px] h-[36px]" viewBox="0 0 36 36" aria-hidden="true">
          <circle
            cx={18}
            cy={18}
            r={radius}
            fill="none"
            stroke="rgba(255,255,255,0.08)"
            strokeWidth="3.5"
          />
          <circle
            cx={18}
            cy={18}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="3.5"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            transform="rotate(-90 18 18)"
            className="transition-[stroke-dashoffset,stroke] duration-500 ease-out"
          />
        </svg>
        <span className="absolute font-sans text-[7.5px] font-bold tracking-[0.04em] uppercase text-white/55 pointer-events-none select-none">
          {centerLabel}
        </span>
      </div>

      <div className="min-w-0 flex-1 flex flex-col justify-center leading-tight">
        <span className={`font-sans text-[11px] font-bold tabular-nums leading-none ${valueClassName}`}>
          {primaryText}
        </span>
        <span className="font-sans text-[9px] font-medium text-white/45 tabular-nums truncate mt-0.5 leading-none">
          {secondaryText}
        </span>
      </div>
    </div>
  );
};

export const Mode6ControlCenterView: React.FC<Mode6ControlCenterViewProps> = ({
  podHostEl,
  capsuleWidth,
  isWifiPodOpen = false,
  isBtPodOpen = false,
  onToggleWifiPod,
  onToggleBtPod,
  onCloseWifiPod,
  onCloseBtPod,
  onInteractionLock,
}) => {
  const { settings, updateSettings } = useSettingsStore();
  const themePalette = CASA_THEME_PALETTES[settings.theme] || CASA_THEME_PALETTES.default;
  const overloadColor = settings.theme === 'default' ? '#EF4444' : themePalette.danger;
  const {
    telemetry,
    wifiNetworks,
    wifiScanning,
    wifiError,
    captivePortalSsid,
    fetchWifiNetworks,
    connectWifi,
    openCaptivePortal,
    openEnterpriseWifiDialog,
    bluetoothDevices,
    bluetoothScanning,
    bluetoothError,
    fetchBluetoothDevices,
    toggleBluetoothConnection,
    toggleWifi,
    toggleBluetooth,
    toggleStayAwake,
    toggleMute,
    setMasterVolume,
    setBrightness,
  } = useSystemHardware();
  const { stats: systemStats } = useSystemTelemetry(true);

  const [passwordSsid, setPasswordSsid] = useState<string | null>(null);
  const [wifiPassword, setWifiPassword] = useState('');
  const [connectingSsid, setConnectingSsid] = useState<string | null>(null);
  const [togglingBtAddr, setTogglingBtAddr] = useState<string | null>(null);

  useEffect(() => {
    if (isWifiPodOpen) {
      void fetchWifiNetworks();
    } else {
      setPasswordSsid(null);
      setWifiPassword('');
    }
  }, [isWifiPodOpen, telemetry.wifi_ssid, telemetry.wifi_enabled, fetchWifiNetworks]);

  useEffect(() => {
    if (isBtPodOpen) {
      void fetchBluetoothDevices();
    }
  }, [
    isBtPodOpen,
    telemetry.bluetooth_device_name,
    telemetry.bluetooth_enabled,
    telemetry.connected_bluetooth_devices,
    fetchBluetoothDevices,
  ]);

  const handleJoinWifi = async (ssid: string, pwd?: string) => {
    setConnectingSsid(ssid);
    try {
      const ok = await connectWifi(ssid, pwd);
      if (ok) {
        playChimeCue('ding');
        setPasswordSsid(null);
        setWifiPassword('');
      } else {
        // Clear password input on failed attempt so secret never lingers in DOM state
        setWifiPassword('');
      }
    } finally {
      setConnectingSsid(null);
    }
  };

  const handleBtAction = async (address: string, connect: boolean) => {
    setTogglingBtAddr(address);
    try {
      const ok = await toggleBluetoothConnection(address, connect);
      if (ok) {
        playChimeCue('ding');
      }
    } finally {
      setTogglingBtAddr(null);
    }
  };

  // Match exact Mode6 hitbox Pod alignment dynamically with resolveEffectiveIslandLayout width
  const MAIN_WIDTH = capsuleWidth ?? 500;
  const POD_WIDTH = 204;
  const leftPodX = Math.round(550 - MAIN_WIDTH / 2 - 10 - POD_WIDTH);
  const rightPodX = Math.round(550 + MAIN_WIDTH / 2 + 10);

  const wifiSubLabel =
    telemetry.wifi_enabled && telemetry.wifi_ssid
      ? telemetry.wifi_ssid
      : telemetry.wifi_enabled
      ? 'Pilih Wi-Fi'
      : 'Off';

  const connectedBtDevices = telemetry.connected_bluetooth_devices || [];
  const primaryConnectedBt = connectedBtDevices[0] || null;

  const btSubLabel = telemetry.bluetooth_enabled
    ? primaryConnectedBt
      ? `${primaryConnectedBt.name}${
          typeof primaryConnectedBt.battery_percent === 'number'
            ? ` • ${primaryConnectedBt.battery_percent}%`
            : ''
        }${connectedBtDevices.length > 1 ? ` +${connectedBtDevices.length - 1}` : ''}`
      : telemetry.bluetooth_device_name || 'Perangkat'
    : 'Off';

  const audioOutputLabel = formatAudioOutputLabel(
    telemetry.audio_output_kind,
    telemetry.audio_output_battery
  );

  const podsMarkup = (
    <div
      className="pointer-events-none w-[1100px] h-[196px] relative select-none"
      data-tauri-drag-region="false"
    >
      {/* LEFT SATELLITE POD: WI-FI NETWORK SCANNER & CONNECTOR */}
      <AnimatePresence>
        {isWifiPodOpen && (
          <motion.aside
            key="left-wifi-pod"
            data-pod="left"
            data-satellite-pod="true"
            initial={{ opacity: 0, x: 14, scale: 0.96, left: leftPodX }}
            animate={{ opacity: 1, x: 0, scale: 1, left: leftPodX }}
            exit={{ opacity: 0, x: 10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onWheel={(e) => e.stopPropagation()}
            style={{ top: 15, width: POD_WIDTH, height: 171 }}
            className="pointer-events-auto absolute bg-[#000000] border border-white/[0.12] rounded-2xl p-2.5 flex flex-col gap-2 shadow-[0_12px_32px_rgba(0,0,0,0.9)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Wifi className="w-3.5 h-3.5 text-white/80 shrink-0" />
                <span className="text-[10.5px] font-semibold text-white truncate">
                  Wi-Fi Networks
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    void fetchWifiNetworks();
                  }}
                  title="Pindai ulang Wi-Fi"
                  className="w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/65 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <RefreshCw className={`w-2.5 h-2.5 ${wifiScanning ? 'animate-spin' : ''}`} />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onCloseWifiPod?.();
                  }}
                  title="Tutup panel Wi-Fi"
                  className="w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/55 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {wifiError && (
              <div
                style={{
                  color: themePalette.danger,
                  backgroundColor: `${themePalette.danger}1a`,
                  borderColor: `${themePalette.danger}40`,
                }}
                className="text-[9px] border rounded-lg px-2 py-1 leading-tight shrink-0"
              >
                {wifiError}
              </div>
            )}

            {captivePortalSsid && (
              <div
                data-captive-portal-banner="true"
                style={{
                  color: themePalette.timer,
                  backgroundColor: `${themePalette.timer}18`,
                  borderColor: `${themePalette.timer}48`,
                }}
                className="flex items-center justify-between gap-1.5 border rounded-lg px-2 py-1 shrink-0"
              >
                <div className="flex items-center gap-1 min-w-0">
                  <ShieldAlert className="w-3 h-3 shrink-0" />
                  <span className="text-[8.5px] font-semibold truncate">
                    Perlu Login
                  </span>
                </div>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    void openCaptivePortal();
                  }}
                  className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded-full bg-white text-black hover:bg-white/90 text-[8px] font-semibold cursor-pointer active:scale-95 shrink-0"
                >
                  <span>Buka Portal</span>
                  <ExternalLink className="w-2 h-2" />
                </button>
              </div>
            )}

            {/* Available Networks List */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-1 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              {wifiScanning && wifiNetworks.length === 0 ? (
                <div className="h-full flex items-center justify-center gap-1.5 text-[10px] text-white/45">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Memindai Wi-Fi...</span>
                </div>
              ) : wifiNetworks.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-[10px] text-white/40 px-2">
                  Tidak ada jaringan Wi-Fi tersedia
                </div>
              ) : (
                wifiNetworks.map((net) => {
                  const isPromptingPwd = passwordSsid === net.ssid;
                  const isBusy = connectingSsid === net.ssid;
                  const authBadge = net.auth_label || (net.is_secured ? 'WPA2' : 'Open');
                  return (
                    <div
                      key={net.ssid}
                      style={
                        net.is_connected
                          ? {
                              backgroundColor: `${themePalette.wifi}16`,
                              borderColor: `${themePalette.wifi}40`,
                            }
                          : undefined
                      }
                      className={`rounded-lg border px-2 py-1.5 transition-colors ${
                        net.is_connected
                          ? ''
                          : 'bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-1">
                        <div className="min-w-0 flex-1 flex items-center gap-1">
                          {net.is_secured ? (
                            <Lock className="w-2.5 h-2.5 text-white/45 shrink-0" />
                          ) : (
                            <Wifi className="w-2.5 h-2.5 text-white/60 shrink-0" />
                          )}
                          <span
                            className="text-[9.5px] font-medium text-white truncate"
                            title={`${net.ssid} · ${authBadge}${net.cipher_label && net.cipher_label !== 'None' ? `/${net.cipher_label}` : ''} (${net.signal_quality}%)`}
                          >
                            {net.ssid}
                          </span>
                          <span className="px-1 py-[0.5px] rounded bg-white/[0.07] text-[7px] font-mono text-white/55 shrink-0">
                            {authBadge}
                          </span>
                        </div>

                        <span className="text-[8px] font-mono tabular-nums text-white/40 shrink-0">
                          {net.signal_quality}%
                        </span>

                        {net.is_connected ? (
                          net.is_captive_portal ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                playChimeCue('tap');
                                void openCaptivePortal();
                              }}
                              style={{
                                backgroundColor: `${themePalette.timer}26`,
                                color: themePalette.timer,
                              }}
                              className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded-full text-[8px] font-semibold cursor-pointer shrink-0"
                              title="Wi-Fi ini memerlukan login Captive Portal"
                            >
                              <span>Perlu Login</span>
                            </button>
                          ) : (
                            <span
                              style={{
                                backgroundColor: `${themePalette.wifi}26`,
                                color: themePalette.wifi,
                              }}
                              className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded-full text-[8px] font-semibold shrink-0"
                            >
                              <Check className="w-2.5 h-2.5" />
                              Active
                            </span>
                          )
                        ) : net.is_enterprise && !net.has_profile ? (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              playChimeCue('tap');
                              void openEnterpriseWifiDialog();
                            }}
                            title="Jaringan Enterprise (802.1X) — buka dialog jaringan Windows"
                            className="inline-flex items-center gap-0.5 px-1.5 py-[2px] rounded-full bg-white/[0.12] hover:bg-white/[0.22] border border-white/15 text-white text-[8px] font-semibold cursor-pointer active:scale-95 shrink-0"
                          >
                            <span>802.1X</span>
                            <ExternalLink className="w-2 h-2" />
                          </button>
                        ) : (
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={(e) => {
                              e.stopPropagation();
                              playChimeCue('tap');
                              if (!net.is_secured || net.has_profile) {
                                void handleJoinWifi(net.ssid);
                              } else {
                                setPasswordSsid((cur) => (cur === net.ssid ? null : net.ssid));
                                setWifiPassword('');
                                setTimeout(() => void focusIslandWindow(), 20);
                              }
                            }}
                            className="px-2 py-[2px] rounded-full bg-white text-black hover:bg-white/90 text-[8.5px] font-semibold cursor-pointer active:scale-95 shrink-0 disabled:opacity-50"
                          >
                            {isBusy ? '...' : 'Connect'}
                          </button>
                        )}
                      </div>

                      {isPromptingPwd && !net.is_connected && !net.is_enterprise && (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            void handleJoinWifi(net.ssid, wifiPassword);
                          }}
                          className="flex items-center gap-1 mt-1.5"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <input
                            type="password"
                            autoFocus
                            minLength={8}
                            maxLength={64}
                            value={wifiPassword}
                            onFocus={() => void focusIslandWindow()}
                            onChange={(e) => setWifiPassword(e.target.value)}
                            onKeyDown={(e) => e.stopPropagation()}
                            placeholder="Password (8-63 char)..."
                            className="flex-1 min-w-0 h-5 px-1.5 rounded bg-black/60 border border-white/20 text-[9px] text-white placeholder-white/35 outline-none"
                          />
                          <button
                            type="submit"
                            disabled={wifiPassword.length < 8 || isBusy}
                            className="h-5 px-2 rounded bg-white text-black text-[9px] font-semibold cursor-pointer disabled:opacity-40 shrink-0"
                          >
                            {isBusy ? '...' : 'Join'}
                          </button>
                        </form>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>

      {/* RIGHT SATELLITE POD: PAIRED BLUETOOTH CONNECT / DISCONNECT */}
      <AnimatePresence>
        {isBtPodOpen && (
          <motion.aside
            key="right-bt-pod"
            data-pod="right"
            data-satellite-pod="true"
            initial={{ opacity: 0, x: -14, scale: 0.96, left: rightPodX }}
            animate={{ opacity: 1, x: 0, scale: 1, left: rightPodX }}
            exit={{ opacity: 0, x: -10, scale: 0.96 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32, mass: 0.7 }}
            onMouseDown={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onClick={(e) => {
              e.stopPropagation();
              onInteractionLock?.();
            }}
            onWheel={(e) => e.stopPropagation()}
            style={{ top: 15, width: POD_WIDTH, height: 171 }}
            className="pointer-events-auto absolute bg-[#000000] border border-white/[0.12] rounded-2xl p-2.5 flex flex-col gap-2 shadow-[0_12px_32px_rgba(0,0,0,0.9)] overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-1 pb-1.5 border-b border-white/[0.08] shrink-0">
              <div className="flex items-center gap-1.5 min-w-0">
                <Bluetooth className="w-3.5 h-3.5 text-white/80 shrink-0" />
                <span className="text-[10.5px] font-semibold text-white truncate">
                  Bluetooth Devices
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    void fetchBluetoothDevices();
                  }}
                  title="Muat ulang perangkat ter-pair"
                  className="w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/65 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <RefreshCw
                    className={`w-2.5 h-2.5 ${bluetoothScanning ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    playChimeCue('tap');
                    onCloseBtPod?.();
                  }}
                  title="Tutup panel Bluetooth"
                  className="w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.14] text-white/55 hover:text-white flex items-center justify-center cursor-pointer"
                >
                  <X className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>

            {bluetoothError && (
              <div
                style={{
                  color: themePalette.danger,
                  backgroundColor: `${themePalette.danger}1a`,
                  borderColor: `${themePalette.danger}40`,
                }}
                className="text-[9px] border rounded-lg px-2 py-1 leading-tight shrink-0"
              >
                {bluetoothError}
              </div>
            )}

            {/* Paired Devices List */}
            <div className="flex-1 min-h-0 overflow-y-auto pr-0.5 space-y-1 [&::-webkit-scrollbar]:w-[2px] [&::-webkit-scrollbar-thumb]:bg-white/20 [&::-webkit-scrollbar-thumb]:rounded-full">
              {bluetoothScanning && bluetoothDevices.length === 0 ? (
                <div className="h-full flex items-center justify-center gap-1.5 text-[10px] text-white/45">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>Memuat perangkat...</span>
                </div>
              ) : bluetoothDevices.length === 0 ? (
                <div className="h-full flex items-center justify-center text-center text-[10px] text-white/40 px-2">
                  Belum ada perangkat Bluetooth ter-pair
                </div>
              ) : (
                bluetoothDevices.map((dev) => {
                  const isBusy = togglingBtAddr === dev.address;
                  const liveConnected = connectedBtDevices.find(
                    (c) =>
                      (c.address && dev.address && c.address.toLowerCase() === dev.address.toLowerCase()) ||
                      c.name.trim().toLowerCase() === dev.name.trim().toLowerCase()
                  );
                  const isConnected = dev.is_connected || Boolean(liveConnected);
                  const batteryPct =
                    typeof dev.battery_percent === 'number'
                      ? dev.battery_percent
                      : liveConnected?.battery_percent ?? null;

                  return (
                    <div
                      key={dev.id}
                      style={
                        isConnected
                          ? {
                              backgroundColor: `${themePalette.bluetooth}18`,
                              borderColor: `${themePalette.bluetooth}45`,
                            }
                          : undefined
                      }
                      className={`rounded-lg border px-2 py-1.5 flex items-center justify-between gap-1.5 transition-colors ${
                        isConnected
                          ? ''
                          : 'bg-white/[0.03] border-white/[0.07] hover:bg-white/[0.07]'
                      }`}
                    >
                      <div className="min-w-0 flex-1 flex items-center gap-1.5">
                        {dev.device_type === 'audio' ? (
                          <Headphones className="w-3 h-3 text-white/75 shrink-0" />
                        ) : (
                          <Bluetooth className="w-3 h-3 text-white/60 shrink-0" />
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="text-[10px] font-medium text-white truncate leading-tight">
                            {dev.name}
                          </div>
                          <div className="flex items-center gap-1 text-[8px] leading-tight">
                            <span className="text-white/45 uppercase">
                              {isConnected ? 'Connected' : dev.device_type}
                            </span>
                            {isConnected && typeof batteryPct === 'number' && (
                              <span
                                style={
                                  batteryPct <= 20
                                    ? {
                                        backgroundColor: `${themePalette.danger}26`,
                                        color: themePalette.danger,
                                      }
                                    : {
                                        backgroundColor: `${themePalette.rest}26`,
                                        color: themePalette.rest,
                                      }
                                }
                                className="px-1 py-[0.5px] rounded-full font-mono font-semibold tabular-nums"
                              >
                                {batteryPct}%
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isBusy || !dev.address}
                        onClick={(e) => {
                          e.stopPropagation();
                          playChimeCue('tap');
                          void handleBtAction(dev.address, !isConnected);
                        }}
                        className={`px-2 py-[3px] rounded-full text-[8.5px] font-semibold cursor-pointer active:scale-95 shrink-0 disabled:opacity-50 ${
                          isConnected
                            ? 'bg-white/[0.12] text-white hover:bg-white/[0.22] border border-white/15'
                            : 'bg-white text-black hover:bg-white/90'
                        }`}
                      >
                        {isBusy ? '...' : isConnected ? 'Disconnect' : 'Connect'}
                      </button>
                    </div>
                  );
                })
              )}
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );

  return (
    <>
      {podHostEl && createPortal(podsMarkup, podHostEl)}

      <div
        data-tauri-drag-region="false"
        className="w-full h-full bg-[#000000] px-3.5 pt-[2px] pb-[5px] flex flex-col justify-between gap-[2px] select-none"
      >
        {/* Header Bar: System Control + Quick Module Chips (Ibadah / Calc) + Active Audio/BT/Battery */}
        <div className="flex items-center justify-between gap-1.5 h-[16px] px-0.5 shrink-0">
          <div className="flex items-center gap-1.5 min-w-0 shrink-0">
            <span className="font-sans text-[8.5px] font-semibold tracking-[0.08em] uppercase text-white/40 leading-none shrink-0">
              Control
            </span>
            <button
              type="button"
              data-quick-module-toggle="ibadah"
              aria-pressed={settings.ibadah.enabled}
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                updateSettings((prev) => ({
                  ...prev,
                  ibadah: { ...prev.ibadah, enabled: !prev.ibadah.enabled },
                }));
              }}
              title={
                settings.ibadah.enabled
                  ? 'Nonaktifkan tab modul Ibadah'
                  : 'Aktifkan tab modul Ibadah'
              }
              style={
                settings.ibadah.enabled
                  ? {
                      borderColor: `${themePalette.ibadah}70`,
                      backgroundColor: `${themePalette.ibadah}22`,
                      color: themePalette.ibadah,
                    }
                  : undefined
              }
              className={`inline-flex items-center gap-0.5 px-1.5 h-[14px] rounded-full border text-[8px] font-semibold leading-none cursor-pointer transition-colors active:scale-95 ${
                settings.ibadah.enabled
                  ? ''
                  : 'bg-[#0a0a0a] border-white/[0.10] text-white/45 hover:text-white/80 hover:border-white/[0.20]'
              }`}
            >
              <MoonStar className="w-2 h-2 shrink-0" />
              <span>Ibadah</span>
            </button>
            <button
              type="button"
              data-quick-module-toggle="calc"
              aria-pressed={settings.calculatorEnabled}
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                updateSettings({ calculatorEnabled: !settings.calculatorEnabled });
              }}
              title={
                settings.calculatorEnabled
                  ? 'Nonaktifkan tab modul Kalkulator (Calc)'
                  : 'Aktifkan tab modul Kalkulator (Calc)'
              }
              style={
                settings.calculatorEnabled
                  ? {
                      borderColor: `${themePalette.timer}70`,
                      backgroundColor: `${themePalette.timer}20`,
                      color: themePalette.timer,
                    }
                  : undefined
              }
              className={`inline-flex items-center gap-0.5 px-1.5 h-[14px] rounded-full border text-[8px] font-semibold leading-none cursor-pointer transition-colors active:scale-95 ${
                settings.calculatorEnabled
                  ? ''
                  : 'bg-[#0a0a0a] border-white/[0.10] text-white/45 hover:text-white/80 hover:border-white/[0.20]'
              }`}
            >
              <Calculator className="w-2 h-2 shrink-0" />
              <span>Calc</span>
            </button>
          </div>
          <div className="flex items-center justify-end gap-1 min-w-0">
            {telemetry.bluetooth_enabled && connectedBtDevices.length > 0 && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  playChimeCue('tap');
                  onToggleBtPod?.();
                }}
                title={connectedBtDevices
                  .map((d) =>
                    typeof d.battery_percent === 'number'
                      ? `${d.name} (${d.battery_percent}%)`
                      : d.name
                  )
                  .join(', ')}
                className="inline-flex items-center gap-1 px-1.5 h-[14px] rounded-full bg-[#0a0a0a] border border-white/[0.10] hover:border-white/[0.20] text-[8.5px] font-medium text-white/75 leading-none max-w-[118px] cursor-pointer transition-colors"
              >
                <Bluetooth className="w-2.5 h-2.5 shrink-0" style={{ color: themePalette.bluetooth }} />
                <span className="truncate">
                  {connectedBtDevices[0].name}
                  {typeof connectedBtDevices[0].battery_percent === 'number'
                    ? ` • ${connectedBtDevices[0].battery_percent}%`
                    : ''}
                  {connectedBtDevices.length > 1 ? ` +${connectedBtDevices.length - 1}` : ''}
                </span>
              </button>
            )}

            <span
              className="inline-flex items-center gap-1 px-1.5 h-[14px] rounded-full bg-[#0a0a0a] border border-white/[0.10] text-[8.5px] font-medium text-white/80 leading-none max-w-[116px] shrink-0"
              title={`Audio Output: ${telemetry.audio_device_name}`}
            >
              {telemetry.audio_output_kind === 'bluetooth' ? (
                <Bluetooth className="w-2.5 h-2.5 shrink-0" style={{ color: themePalette.bluetooth }} />
              ) : telemetry.audio_output_kind === 'wired' ? (
                <Headphones className="w-2.5 h-2.5 shrink-0" style={{ color: themePalette.volume }} />
              ) : (
                <Volume2 className="w-2.5 h-2.5 shrink-0" style={{ color: themePalette.volume }} />
              )}
              <span className="truncate tabular-nums">{audioOutputLabel}</span>
            </span>

            {systemStats.battery.has_battery && (
              <BatteryPill
                battery={systemStats.battery}
                showPercentage={true}
                statusLabel={true}
              />
            )}
          </div>
        </div>

        {/* Row 1: 4 Tactile Toggle Cards (OLED #0a0a0a base + semantic accents) */}
        <div className="grid grid-cols-4 gap-1.5 shrink-0">
          {/* 1. Wi-Fi (Teal #2DD4BF when active) */}
          <div
            style={
              telemetry.wifi_enabled
                ? {
                    color: themePalette.wifi,
                    borderColor: `${themePalette.wifi}80`,
                    boxShadow: `0 0 12px ${themePalette.wifi}24`,
                  }
                : undefined
            }
            className={`h-[36px] rounded-xl border flex flex-col items-stretch justify-between p-[2.5px] transition-all bg-[#0a0a0a] ${
              telemetry.wifi_enabled
                ? ''
                : 'text-white/65 border-white/[0.08] hover:border-white/[0.16]'
            }`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                toggleWifi();
              }}
              title="Toggle Wi-Fi Windows"
              className="flex-1 flex items-center justify-center gap-1 rounded-lg hover:bg-white/[0.05] cursor-pointer active:scale-95"
            >
              {telemetry.wifi_enabled ? (
                <Wifi className="w-3 h-3 shrink-0" />
              ) : (
                <WifiOff className="w-3 h-3 shrink-0" />
              )}
              <span className="text-[9.5px] font-semibold tracking-tight leading-none">
                Wi-Fi
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                onToggleWifiPod?.();
              }}
              title={`Buka daftar Wi-Fi (${wifiSubLabel})`}
              style={
                telemetry.wifi_enabled
                  ? {
                      backgroundColor: `${themePalette.wifi}${isWifiPodOpen ? '40' : '20'}`,
                      color: themePalette.wifi,
                    }
                  : undefined
              }
              className={`w-full h-[12px] px-1 rounded-md flex items-center justify-center gap-0.5 text-[7.5px] font-medium truncate cursor-pointer transition-colors ${
                telemetry.wifi_enabled
                  ? ''
                  : isWifiPodOpen
                  ? 'bg-white/20 text-white'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/55'
              }`}
            >
              <span className="truncate">{wifiSubLabel}</span>
              <ChevronRight className="w-2 h-2 shrink-0" />
            </button>
          </div>

          {/* 2. Bluetooth (Indigo #6366F1 when active) */}
          <div
            style={
              telemetry.bluetooth_enabled
                ? {
                    color: themePalette.bluetooth,
                    borderColor: `${themePalette.bluetooth}8c`,
                    boxShadow: `0 0 12px ${themePalette.bluetooth}29`,
                  }
                : undefined
            }
            className={`h-[36px] rounded-xl border flex flex-col items-stretch justify-between p-[2.5px] transition-all bg-[#0a0a0a] ${
              telemetry.bluetooth_enabled
                ? ''
                : 'text-white/65 border-white/[0.08] hover:border-white/[0.16]'
            }`}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                toggleBluetooth();
              }}
              title="Toggle Bluetooth Windows"
              className="flex-1 flex items-center justify-center gap-1 rounded-lg hover:bg-white/[0.05] cursor-pointer active:scale-95"
            >
              {telemetry.bluetooth_enabled ? (
                <Bluetooth className="w-3 h-3 shrink-0" />
              ) : (
                <BluetoothOff className="w-3 h-3 shrink-0" />
              )}
              <span className="text-[9.5px] font-semibold tracking-tight leading-none">
                BT
              </span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                playChimeCue('tap');
                onToggleBtPod?.();
              }}
              title={`Buka perangkat Bluetooth (${btSubLabel})`}
              style={
                telemetry.bluetooth_enabled
                  ? {
                      backgroundColor: `${themePalette.bluetooth}${isBtPodOpen ? '40' : '26'}`,
                      color: themePalette.bluetooth,
                    }
                  : undefined
              }
              className={`w-full h-[12px] px-1 rounded-md flex items-center justify-center gap-0.5 text-[7.5px] font-medium truncate cursor-pointer transition-colors ${
                telemetry.bluetooth_enabled
                  ? ''
                  : isBtPodOpen
                  ? 'bg-white/20 text-white'
                  : 'bg-white/[0.06] hover:bg-white/[0.12] text-white/55'
              }`}
            >
              <span className="truncate">{btSubLabel}</span>
              <ChevronRight className="w-2 h-2 shrink-0" />
            </button>
          </div>

          {/* 3. Keep Awake (Amber #F59E0B when active) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              toggleStayAwake();
            }}
            title="Cegah layar/PC tidur (Keep Awake)"
            style={
              telemetry.stay_awake
                ? {
                    color: themePalette.awake,
                    borderColor: `${themePalette.awake}80`,
                    boxShadow: `0 0 12px ${themePalette.awake}24`,
                  }
                : undefined
            }
            className={`h-[36px] rounded-xl border bg-[#0a0a0a] flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 cursor-pointer ${
              telemetry.stay_awake
                ? ''
                : 'text-white/65 border-white/[0.08] hover:border-white/[0.16] hover:text-white'
            }`}
          >
            <Coffee className="w-3 h-3" />
            <span className="text-[9.5px] font-semibold tracking-tight leading-none">
              Awake
            </span>
          </button>

          {/* 4. Master Mute (Rose #F43F5E when muted) */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              toggleMute();
            }}
            title="Toggle Mute Master Audio Windows"
            style={
              telemetry.is_muted
                ? {
                    color: themePalette.danger,
                    borderColor: `${themePalette.danger}80`,
                    boxShadow: `0 0 12px ${themePalette.danger}24`,
                  }
                : undefined
            }
            className={`h-[36px] rounded-xl border bg-[#0a0a0a] flex flex-col items-center justify-center gap-0.5 transition-all active:scale-95 cursor-pointer ${
              telemetry.is_muted
                ? ''
                : 'text-white/65 border-white/[0.08] hover:border-white/[0.16] hover:text-white'
            }`}
          >
            {telemetry.is_muted ? (
              <VolumeX className="w-3 h-3" />
            ) : (
              <Volume2 className="w-3 h-3" />
            )}
            <span className="text-[9.5px] font-semibold tracking-tight leading-none">
              Mute
            </span>
          </button>
        </div>

        {/* Row 2: Radial CPU & RAM Telemetry Gauges (grid-cols-2, 36x36px rings) */}
        <div
          className="grid grid-cols-2 gap-2 shrink-0"
          aria-label="System CPU and RAM usage"
        >
          <RadialMetricCard
            centerLabel="CPU"
            percent={systemStats.cpu_usage_percent}
            strokeColor={
              systemStats.cpu_usage_percent >= 90 ? overloadColor : themePalette.cpu
            }
            primaryText={`${Math.round(systemStats.cpu_usage_percent)}%`}
            secondaryText={systemStats.cpu_usage_percent >= 90 ? 'High load' : 'Processor'}
            valueClassName={
              systemStats.cpu_usage_percent >= 90
                ? 'text-[var(--casa-danger,#EF4444)]'
                : 'text-[var(--casa-cpu,#E879F9)]'
            }
          />
          <RadialMetricCard
            centerLabel="RAM"
            percent={systemStats.ram_percent}
            strokeColor={systemStats.ram_percent >= 90 ? overloadColor : themePalette.ram}
            primaryText={`${Math.round(systemStats.ram_percent)}%`}
            secondaryText={
              systemStats.ram_total_gb > 0
                ? `${systemStats.ram_used_gb.toFixed(1)} / ${systemStats.ram_total_gb.toFixed(0)} GB`
                : 'Memory'
            }
            valueClassName={
              systemStats.ram_percent >= 90
                ? 'text-[var(--casa-danger,#EF4444)]'
                : 'text-[var(--casa-ram,#A855F7)]'
            }
          />
        </div>

        {/* Row 3: 2-Column Side-by-Side Icon-Only Sliders */}
        <div className="grid grid-cols-2 gap-2 shrink-0">
          <SmoothOledSlider
            icon={
              telemetry.is_muted ? (
                <VolumeX className="w-3.5 h-3.5" style={{ color: themePalette.danger }} />
              ) : (
                <Volume2 className="w-3.5 h-3.5" style={{ color: themePalette.volume }} />
              )
            }
            label="Volume"
            value={telemetry.master_volume}
            accentColor={themePalette.volume}
            muted={telemetry.is_muted}
            onChange={setMasterVolume}
          />
          <SmoothOledSlider
            icon={<Sun className="w-3.5 h-3.5" style={{ color: themePalette.brightness }} />}
            label="Brightness"
            value={telemetry.brightness_percent}
            accentColor={themePalette.brightness}
            onChange={setBrightness}
          />
        </div>
      </div>
    </>
  );
};
