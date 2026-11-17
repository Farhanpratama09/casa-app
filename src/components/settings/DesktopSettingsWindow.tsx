import React, { useEffect, useRef, useState } from 'react';
import {
  Palette,
  SlidersHorizontal,
  Volume2,
  ShieldCheck,
  X,
  Minus,
  Check,
  Upload,
  Play,
  Square,
  RotateCcw,
  RefreshCw,
  Download,
  Sparkles,
  Keyboard,
  ExternalLink,
  Target,
  Moon,
  Cpu,
  MemoryStick,
  Radio,
} from 'lucide-react';
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow';
import { check, type Update } from '@tauri-apps/plugin-updater';
import { relaunch } from '@tauri-apps/plugin-process';
import {
  CASA_THEME_PALETTES,
  CasaFullscreenBehavior,
  CasaHorizontalAlign,
  CasaHoverDelayMs,
  CasaIdlePillStyle,
  CasaPlacementMode,
  CasaSettings,
  CasaThemeId,
  CasaThemePalette,
  resetAllSettings,
  updateSettings,
  useSettingsStore,
} from '../../stores/useSettingsStore';
import {
  previewAlarmChime,
  processAndSaveCustomAlarm,
  resetCustomAlarm,
  stopAlarmChime,
  syncActiveAlarmVolume,
} from '../../utils/alarmChime';
import { useMusicAffinityStore } from '../../hooks/useMusicAffinity';
import {
  AppUpdateCheckResult,
  getAutostartEnabled,
  getGlobalShortcutStatus,
  openExternalUrl,
  playChimeCue,
  setAutostartEnabled,
} from '../../utils/tauriBridge';

type SettingsSectionId = 'appearance' | 'behavior' | 'audio' | 'system';

const SIDEBAR_ITEMS: Array<{
  id: SettingsSectionId;
  label: string;
  subtitle: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    id: 'appearance',
    label: 'Appearance',
    subtitle: 'Tema visual & pratinjau kapsul',
    icon: Palette,
  },
  {
    id: 'behavior',
    label: 'Island & Behavior',
    subtitle: 'Posisi, delay hover & fullscreen',
    icon: SlidersHorizontal,
  },
  {
    id: 'audio',
    label: 'Timer & Audio',
    subtitle: 'Nada dering 15s & siklus fokus',
    icon: Volume2,
  },
  {
    id: 'system',
    label: 'System & Updates',
    subtitle: 'Startup, hotkey, updater & About',
    icon: ShieldCheck,
  },
];

const THEME_CARDS: Array<{
  id: CasaThemeId;
  title: string;
  tag: string;
  description: string;
  swatches: [string, string, string, string];
}> = [
  {
    id: 'default',
    title: 'Warna Utama',
    tag: 'Default',
    description: 'Amber Focus, Emerald Rest, Fuchsia CPU & Cyan Audio.',
    swatches: ['#F59E0B', '#10B981', '#E879F9', '#38BDF8'],
  },
  {
    id: 'monochrome',
    title: 'Monokrom',
    tag: 'Stealth OLED',
    description: 'Putih murni #FFFFFF dan zinc monokrom kontras tinggi.',
    swatches: ['#FFFFFF', '#E4E4E7', '#A1A1AA', '#71717A'],
  },
  {
    id: 'colorblind',
    title: 'Buta Warna',
    tag: 'Okabe-Ito',
    description: 'Biru Langit, Emas, dan Vermilion ramah deuteranopia.',
    swatches: ['#38BDF8', '#FDE047', '#EA580C', '#1D4ED8'],
  },
];

const PLACEMENT_OPTIONS: Array<{ value: CasaPlacementMode; label: string }> = [
  { value: 'docked', label: 'Docked Notch' },
  { value: 'floating', label: 'Floating Pill' },
];

const ALIGN_OPTIONS: Array<{ value: CasaHorizontalAlign; label: string }> = [
  { value: 'left', label: 'Kiri' },
  { value: 'center', label: 'Tengah' },
  { value: 'right', label: 'Kanan' },
];

const PILL_STYLE_OPTIONS: Array<{ value: CasaIdlePillStyle; label: string }> = [
  { value: 'eyes', label: 'Mata × ♥' },
  { value: 'clock', label: 'Jam Digital' },
];

const HOVER_DELAY_OPTIONS: Array<{ value: CasaHoverDelayMs; label: string }> = [
  { value: 0, label: '0ms' },
  { value: 300, label: '300ms' },
  { value: -1, label: 'Nonaktif' },
];

const FULLSCREEN_OPTIONS: Array<{ value: CasaFullscreenBehavior; label: string }> = [
  { value: 'smart-tuck', label: 'Smart Tuck' },
  { value: 'total-hide', label: 'Hide Total' },
  { value: 'always-visible', label: 'Selalu Tampil' },
];

const isTauriRuntime = () =>
  typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

const SettingFlatRow: React.FC<{
  title: string;
  description: string;
  children: React.ReactNode;
}> = ({ title, description, children }) => (
  <div className="py-3.5 flex items-center justify-between gap-4">
    <div className="min-w-0">
      <div className="text-[12.5px] font-semibold text-white/95 leading-snug">{title}</div>
      <div className="text-[11px] text-white/45 leading-snug mt-0.5">{description}</div>
    </div>
    <div className="shrink-0">{children}</div>
  </div>
);

const PillToggleSwitch: React.FC<{
  checked: boolean;
  disabled?: boolean;
  label: string;
  onChange: (next: boolean) => void;
}> = ({ checked, disabled = false, label, onChange }) => (
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    disabled={disabled}
    onClick={() => {
      playChimeCue('tap');
      onChange(!checked);
    }}
    className={`relative w-10 h-[22px] rounded-full border transition-colors cursor-pointer disabled:opacity-45 ${
      checked
        ? 'bg-white border-white'
        : 'bg-white/[0.08] border-white/[0.15] hover:border-white/30'
    }`}
  >
    <span
      className={`absolute top-[2px] w-4 h-4 rounded-full transition-all shadow-sm ${
        checked ? 'left-[20px] bg-black' : 'left-[2px] bg-white/80'
      }`}
    />
  </button>
);

function SegmentedControl<T extends string | number>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (next: T) => void;
}) {
  return (
    <div className="inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[#070709] border border-white/[0.09]">
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            onClick={() => {
              playChimeCue('tap');
              onChange(opt.value);
            }}
            className={`px-2.5 py-1 rounded-[5px] text-[11px] font-medium transition-all cursor-pointer whitespace-nowrap ${
              active
                ? 'bg-white text-black font-semibold shadow-sm'
                : 'text-white/55 hover:text-white hover:bg-white/[0.06]'
            }`}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

const LiveNotchPreviewCard: React.FC<{
  settings: CasaSettings;
  palette: CasaThemePalette;
}> = ({ settings, palette }) => {
  const isFloating = settings.placementMode === 'floating';
  const alignClass =
    settings.horizontalAlign === 'left'
      ? 'justify-start pl-4'
      : settings.horizontalAlign === 'right'
      ? 'justify-end pr-4'
      : 'justify-center';

  const previewW = 192;
  const previewH = 34;
  const inset = 0.85;
  const cornerR = 15;
  const dockUPath = `M ${inset},0 L ${inset},${previewH - inset - cornerR} A ${cornerR},${cornerR} 0 0 0 ${
    inset + cornerR
  },${previewH - inset} L ${previewW - inset - cornerR},${
    previewH - inset
  } A ${cornerR},${cornerR} 0 0 0 ${previewW - inset},${previewH - inset - cornerR} L ${
    previewW - inset
  },0`;
  const pillR = (previewH - inset * 2) / 2;
  const midX = previewW / 2;
  const floatPillPath = `M ${midX},${inset} L ${previewW - inset - pillR},${inset} A ${pillR},${pillR} 0 0 1 ${
    previewW - inset
  },${inset + pillR} L ${previewW - inset},${previewH - inset - pillR} A ${pillR},${pillR} 0 0 1 ${
    previewW - inset - pillR
  },${previewH - inset} L ${inset + pillR},${previewH - inset} A ${pillR},${pillR} 0 0 1 ${inset},${
    previewH - inset - pillR
  } L ${inset},${inset + pillR} A ${pillR},${pillR} 0 0 1 ${inset + pillR},${inset} Z`;

  const themeLabel =
    THEME_CARDS.find((t) => t.id === settings.theme)?.title ?? 'Warna Utama';
  const alignLabel =
    settings.horizontalAlign === 'left'
      ? 'Kiri'
      : settings.horizontalAlign === 'right'
      ? 'Kanan'
      : 'Tengah';

  return (
    <div className="border border-white/[0.08] rounded-lg overflow-hidden bg-[#050506]">
      {/* Simulated Desktop Screen Top Bezel Stage */}
      <div
        className="relative h-[82px] w-full overflow-hidden border-b border-white/[0.07]"
        style={{
          background: `radial-gradient(ellipse 65% 85% at 50% 0%, ${palette.timerGlow}, rgba(14,14,18,0.85) 55%, #040406 100%)`,
        }}
      >
        <div
          aria-hidden="true"
          className="absolute inset-0 opacity-20"
          style={{
            backgroundImage:
              'radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px)',
            backgroundSize: '16px 16px',
          }}
        />

        {/* Alignment container */}
        <div className={`relative z-10 w-full flex ${alignClass} transition-all duration-200`}>
          <div
            className="relative inline-flex items-start justify-center transition-all duration-200"
            style={{ marginTop: isFloating ? 12 : 0 }}
          >
            {!isFloating && (
              <>
                <svg
                  width="10"
                  height="9"
                  viewBox="0 0 11 10"
                  fill="none"
                  aria-hidden="true"
                  className="absolute top-0 -left-[9px] pointer-events-none"
                >
                  <path d="M 0,0 H 11 V 10 H 10 A 10,10 0 0 0 0,0 Z" fill="#000000" />
                </svg>
                <svg
                  width="10"
                  height="9"
                  viewBox="0 0 11 10"
                  fill="none"
                  aria-hidden="true"
                  className="absolute top-0 -right-[9px] pointer-events-none"
                >
                  <path d="M 0,0 H 11 A 10,10 0 0 0 1,10 H 0 V 0 Z" fill="#000000" />
                </svg>
              </>
            )}

            <div
              className={`relative bg-[#000000] flex items-center justify-between px-3.5 transition-all duration-200 ${
                isFloating ? 'rounded-full' : 'rounded-b-[16px]'
              }`}
              style={{
                width: previewW,
                height: previewH,
                boxShadow: `0 0 16px ${palette.timerGlow}, 0 6px 18px rgba(0,0,0,0.7)`,
              }}
            >
              <svg
                viewBox={`0 0 ${previewW} ${previewH}`}
                className="pointer-events-none absolute inset-0 w-full h-full"
                aria-hidden="true"
              >
                <path
                  d={isFloating ? floatPillPath : dockUPath}
                  fill="none"
                  stroke={palette.timer}
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  pathLength={100}
                  strokeDasharray="100 100"
                  strokeDashoffset={26}
                />
              </svg>

              {/* Left Pill Identity */}
              <div className="relative z-10 flex items-center gap-2 min-w-0">
                {settings.idlePillStyle === 'clock' ? (
                  <span className="text-[11px] font-semibold tracking-tight text-white tabular-nums">
                    09:41
                  </span>
                ) : (
                  <svg viewBox="0 0 34 16" className="w-[18px] h-[9px]" aria-hidden="true">
                    <path
                      d="M 3.5,3.5 L 12.5,12.5 M 12.5,3.5 L 3.5,12.5"
                      fill="none"
                      stroke="#ffffff"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M 25,13.5 L 24.3,12.8 C 21.1,10.0 19.6,8.3 19.6,6.1 C 19.6,4.4 20.9,3.1 22.5,3.1 C 23.6,3.1 24.5,3.7 25,4.6 C 25.5,3.7 26.4,3.1 27.5,3.1 C 29.1,3.1 30.4,4.4 30.4,6.1 C 30.4,8.3 28.9,10.0 25.7,12.8 Z"
                      fill="#ffffff"
                    />
                  </svg>
                )}

                <span className="inline-flex items-center gap-1">
                  <span
                    className="w-1.5 h-1.5 rounded-[2px]"
                    style={{ backgroundColor: palette.cpu }}
                  />
                  <span
                    className="w-1.5 h-1.5 rounded-[2px]"
                    style={{ backgroundColor: palette.ram }}
                  />
                </span>
              </div>

              {/* Right Simulated Focus Readout */}
              <div className="relative z-10 flex items-center gap-1.5">
                <span
                  className="w-1.5 h-1.5 rounded-[2px] animate-pulse"
                  style={{ backgroundColor: palette.timer }}
                />
                <span
                  className="text-[10.5px] font-mono font-semibold tabular-nums"
                  style={{ color: palette.timer }}
                >
                  18:45
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Preview Metadata Footer */}
      <div className="px-3.5 py-2 flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2 text-white/75 font-medium">
          <span>Pratinjau Langsung</span>
          <span className="text-white/20">/</span>
          <span className="text-white/55">
            {isFloating ? 'Floating Pill (y=12)' : 'Docked Notch (y=0)'}
          </span>
        </div>
        <div className="flex items-center gap-1.5 text-[10.5px] font-mono text-white/55">
          <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08]">
            {alignLabel}
          </span>
          <span className="px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08]">
            {themeLabel}
          </span>
        </div>
      </div>
    </div>
  );
};

export const DesktopSettingsWindow: React.FC = () => {
  const { settings, palette } = useSettingsStore();
  const [activeSection, setActiveSection] = useState<SettingsSectionId>('appearance');

  // Audio custom alarm states
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isTestingSoundRef = useRef(false);
  const [isTestingSound, setIsTestingSound] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [audioFeedback, setAudioFeedback] = useState<{
    kind: 'ok' | 'err';
    text: string;
  } | null>(null);

  // System & Signed Updater states
  const [shortcutRegistered, setShortcutRegistered] = useState<boolean | null>(null);
  const [autostartBusy, setAutostartBusy] = useState(false);
  const [autostartError, setAutostartError] = useState<string | null>(null);
  const [isCheckingUpdate, setIsCheckingUpdate] = useState(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);
  const [installProgressText, setInstallProgressText] = useState<string | null>(null);
  const [updateResult, setUpdateResult] = useState<AppUpdateCheckResult | null>(null);
  const pendingUpdateRef = useRef<Update | null>(null);
  const [dataNotice, setDataNotice] = useState<string | null>(null);

  const releasePendingUpdate = () => {
    const prev = pendingUpdateRef.current;
    pendingUpdateRef.current = null;
    if (prev) {
      void prev.close().catch(() => {});
    }
  };

  const handleCloseWindow = async () => {
    playChimeCue('tap');
    if (isTestingSoundRef.current) {
      isTestingSoundRef.current = false;
      stopAlarmChime();
    }
    releasePendingUpdate();
    if (!isTauriRuntime()) return;
    try {
      await getCurrentWebviewWindow().close();
    } catch (err) {
      console.error('[CASA] Failed to close settings window:', err);
    }
  };

  const handleMinimizeWindow = async () => {
    playChimeCue('tap');
    if (!isTauriRuntime()) return;
    try {
      await getCurrentWebviewWindow().minimize();
    } catch (err) {
      console.error('[CASA] Failed to minimize settings window:', err);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        void handleCloseWindow();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      if (isTestingSoundRef.current) {
        isTestingSoundRef.current = false;
        stopAlarmChime();
      }
      releasePendingUpdate();
    };
  }, []);

  useEffect(() => {
    if (activeSection !== 'system') return;
    let active = true;

    void getGlobalShortcutStatus().then((ok) => {
      if (active) setShortcutRegistered(ok);
    });

    void getAutostartEnabled().then((enabled) => {
      if (active && enabled !== settings.launchAtStartup) {
        updateSettings({ launchAtStartup: enabled });
      }
    });

    return () => {
      active = false;
    };
  }, [activeSection]);

  const handleUploadAlarmFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsProcessingAudio(true);
    setAudioFeedback(null);
    try {
      const saved = await processAndSaveCustomAlarm(file);
      setAudioFeedback({
        kind: 'ok',
        text: `Tersimpan: ${saved.fileName} (${saved.durationSeconds.toFixed(1)}d, auto-trim & fade-out)`,
      });
    } catch (err) {
      setAudioFeedback({
        kind: 'err',
        text: err instanceof Error ? err.message : 'Gagal memproses file audio.',
      });
    } finally {
      setIsProcessingAudio(false);
    }
  };

  const handleToggleTestSound = () => {
    playChimeCue('tap');
    if (isTestingSound) {
      isTestingSoundRef.current = false;
      setIsTestingSound(false);
      stopAlarmChime();
      return;
    }
    isTestingSoundRef.current = true;
    setIsTestingSound(true);
    previewAlarmChime(() => {
      isTestingSoundRef.current = false;
      setIsTestingSound(false);
    });
  };

  const handleResetCustomAlarm = async () => {
    playChimeCue('tap');
    isTestingSoundRef.current = false;
    setIsTestingSound(false);
    await resetCustomAlarm();
    setAudioFeedback({
      kind: 'ok',
      text: 'Kembali ke Harmonic Chime bawaan (C5–E5–G5–B5).',
    });
  };

  const handleToggleAutostart = async (next: boolean) => {
    setAutostartBusy(true);
    setAutostartError(null);
    try {
      const confirmed = await setAutostartEnabled(next);
      updateSettings({ launchAtStartup: confirmed });
    } catch (err) {
      setAutostartError(
        err instanceof Error ? err.message : 'Gagal mengubah status Auto-Start Windows.'
      );
    } finally {
      setAutostartBusy(false);
    }
  };

  const handleCheckUpdates = async () => {
    playChimeCue('tap');
    if (!isTauriRuntime()) {
      setUpdateResult({
        currentVersion: '2.0.2',
        available: false,
        version: null,
        body: null,
        date: null,
        statusKind: 'offline',
        message: 'Pemeriksaan pembaruan hanya tersedia di aplikasi desktop CASA.',
      });
      return;
    }

    setIsCheckingUpdate(true);
    setUpdateResult(null);
    setInstallProgressText(null);
    releasePendingUpdate();

    try {
      const update = await check();
      if (update) {
        pendingUpdateRef.current = update;
        setUpdateResult({
          currentVersion: update.currentVersion,
          available: true,
          version: update.version,
          body: update.body ?? null,
          date: update.date ?? null,
          statusKind: 'available',
          message: `Pembaruan v${update.version} tersedia dan terverifikasi tanda tangan digital.`,
        });
      } else {
        setUpdateResult({
          currentVersion: '2.0.2',
          available: false,
          version: null,
          body: null,
          date: null,
          statusKind: 'up-to-date',
          message: 'CASA sudah menggunakan versi terbaru (v2.0.2).',
        });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const lower = msg.toLowerCase();
      const isOfflineOrNoManifest =
        lower.includes('404') ||
        lower.includes('not found') ||
        lower.includes('release') ||
        lower.includes('dns') ||
        lower.includes('timeout') ||
        lower.includes('connect') ||
        lower.includes('network');

      setUpdateResult({
        currentVersion: '2.0.2',
        available: false,
        version: null,
        body: msg,
        date: null,
        statusKind: isOfflineOrNoManifest ? 'offline' : 'error',
        message:
          lower.includes('404') || lower.includes('not found') || lower.includes('release')
            ? 'Belum ada manifest rilis baru (latest.json) di GitHub Releases.'
            : isOfflineOrNoManifest
            ? 'Offline: tidak dapat menjangkau GitHub Releases saat ini.'
            : 'Gagal memeriksa pembaruan dari GitHub.',
      });
    } finally {
      setIsCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!isTauriRuntime()) return;
    playChimeCue('tap');
    setIsInstallingUpdate(true);
    setInstallProgressText('Menyiapkan pengunduhan...');

    try {
      let update = pendingUpdateRef.current;
      if (!update) {
        update = await check();
        if (update) {
          pendingUpdateRef.current = update;
        }
      }

      if (!update) {
        setUpdateResult({
          currentVersion: '2.0.2',
          available: false,
          version: null,
          body: null,
          date: null,
          statusKind: 'up-to-date',
          message: 'CASA sudah menggunakan versi terbaru.',
        });
        setInstallProgressText(null);
        return;
      }

      let downloaded = 0;
      let totalLength = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalLength = event.data.contentLength ?? 0;
          downloaded = 0;
          setInstallProgressText(
            totalLength > 0
              ? `Mengunduh v${update.version} (0%)...`
              : `Mengunduh v${update.version}...`
          );
        } else if (event.event === 'Progress') {
          downloaded += event.data.chunkLength;
          if (totalLength > 0) {
            const pct = Math.min(100, Math.round((downloaded / totalLength) * 100));
            setInstallProgressText(`Mengunduh v${update.version} (${pct}%)...`);
          } else {
            const mb = (downloaded / (1024 * 1024)).toFixed(1);
            setInstallProgressText(`Mengunduh v${update.version} (${mb} MB)...`);
          }
        } else if (event.event === 'Finished') {
          setInstallProgressText('Paket terverifikasi & terpasang. Memulai ulang CASA...');
        }
      });

      releasePendingUpdate();
      await relaunch();
    } catch (err) {
      setUpdateResult((prev) => ({
        currentVersion: prev?.currentVersion ?? '2.0.2',
        available: prev?.available ?? false,
        version: prev?.version ?? null,
        body: null,
        date: null,
        statusKind: 'error',
        message: err instanceof Error ? err.message : 'Gagal memasang pembaruan.',
      }));
      setInstallProgressText(null);
    } finally {
      setIsInstallingUpdate(false);
    }
  };

  const handleResetMusicAffinity = () => {
    playChimeCue('tap');
    useMusicAffinityStore.getState().resetAffinity();
    setDataNotice('Rekomendasi & riwayat pencarian musik direset (Custom Playlist aman).');
    setTimeout(() => setDataNotice(null), 3500);
  };

  const handleResetAllDefaults = async () => {
    playChimeCue('tap');
    isTestingSoundRef.current = false;
    setIsTestingSound(false);
    resetAllSettings();
    await resetCustomAlarm();
    try {
      await setAutostartEnabled(false);
    } catch {}
    setDataNotice('Seluruh pengaturan dikembalikan ke konfigurasi bawaan.');
    setTimeout(() => setDataNotice(null), 3500);
  };

  const activeMeta = SIDEBAR_ITEMS.find((s) => s.id === activeSection) ?? SIDEBAR_ITEMS[0];

  return (
    <div className="w-screen h-screen bg-[#000000] text-white flex flex-col overflow-hidden border border-white/[0.09] select-none">
      {/* Custom Dark Frameless Titlebar */}
      <header
        data-tauri-drag-region
        className="h-[38px] shrink-0 bg-[#050505] border-b border-white/[0.08] flex items-center justify-between px-3.5"
      >
        <div
          data-tauri-drag-region
          className="flex items-center gap-2.5 text-[11.5px] font-medium text-white/80 pointer-events-none"
        >
          <svg viewBox="0 0 34 16" className="w-[18px] h-[9px]" aria-hidden="true">
            <path
              d="M 3.5,3.5 L 12.5,12.5 M 12.5,3.5 L 3.5,12.5"
              fill="none"
              stroke="#ffffff"
              strokeWidth="2.2"
              strokeLinecap="round"
            />
            <path
              d="M 25,13.5 L 24.3,12.8 C 21.1,10.0 19.6,8.3 19.6,6.1 C 19.6,4.4 20.9,3.1 22.5,3.1 C 23.6,3.1 24.5,3.7 25,4.6 C 25.5,3.7 26.4,3.1 27.5,3.1 C 29.1,3.1 30.4,4.4 30.4,6.1 C 30.4,8.3 28.9,10.0 25.7,12.8 Z"
              fill="#ffffff"
            />
          </svg>
          <span>CASA Settings</span>
          <span className="text-white/25">/</span>
          <span className="text-white/50">{activeMeta.label}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void handleMinimizeWindow()}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/50 hover:text-white hover:bg-white/[0.08] transition-colors cursor-pointer"
            title="Perkecil"
            aria-label="Perkecil jendela Settings"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => void handleCloseWindow()}
            className="w-6 h-6 rounded-md flex items-center justify-center text-white/60 hover:text-white hover:bg-white/[0.12] transition-colors cursor-pointer"
            title="Tutup Settings (CASA tetap berjalan)"
            aria-label="Tutup Settings"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </header>

      {/* Two-Column Body: 196px Left Sidebar + Flex Right Content Pane */}
      <div className="flex-1 min-h-0 flex overflow-hidden">
        {/* Left Sidebar (196px) */}
        <aside className="w-[196px] shrink-0 bg-[#070707] border-r border-white/[0.08] flex flex-col justify-between p-3.5">
          <div>
            {/* Flat Sidebar Identity Header */}
            <div className="px-1 pb-3 border-b border-white/[0.07]">
              <div className="flex items-center justify-between">
                <span className="text-[13.5px] font-bold tracking-tight text-white">
                  CASA
                </span>
                <span className="px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/[0.10] text-[10px] font-mono text-white/75">
                  v2.0.2
                </span>
              </div>
              <div className="text-[10px] font-mono text-white/40 mt-0.5 truncate">
                Dynamic Rabbit Island
              </div>
            </div>

            {/* Vertical Section Nav */}
            <nav className="mt-3.5 space-y-1" aria-label="Kategori Pengaturan">
              {SIDEBAR_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeSection === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      playChimeCue('tap');
                      setActiveSection(item.id);
                    }}
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-[12px] font-medium transition-all cursor-pointer text-left border ${
                      active
                        ? 'bg-white/[0.09] text-white border-white/[0.12]'
                        : 'text-white/55 hover:text-white/90 hover:bg-white/[0.04] border-transparent'
                    }`}
                  >
                    {active && (
                      <span
                        aria-hidden="true"
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-4 rounded-r bg-white"
                      />
                    )}
                    <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-white' : 'text-white/45'}`} />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>

          {/* Sidebar Bottom Status (Monochrome Sync Icon instead of green dot) */}
          <div className="pt-3 border-t border-white/[0.07] space-y-1.5 px-1">
            <div className="flex items-center gap-2 text-[10.5px] font-mono text-white/60">
              <Radio className="w-[13px] h-[13px] text-white/65 shrink-0" />
              <span>Sinkronisasi real-time</span>
            </div>
            <div className="text-[10px] text-white/35 flex items-center gap-1.5">
              <span>Tekan</span>
              <kbd className="px-1.5 py-0.5 rounded-[4px] bg-[#121215] border border-white/20 border-b-2 text-[9.5px] font-mono text-white/75">
                Esc
              </kbd>
              <span>tutup</span>
            </div>
          </div>
        </aside>

        {/* Right Scrollable Content Pane */}
        <main className="flex-1 min-w-0 bg-black overflow-y-auto oled-thin-scrollbar p-6">
          <div className="max-w-[512px] space-y-5">
            {/* Section Title */}
            <div>
              <h1 className="text-[16px] font-semibold tracking-tight text-white">
                {activeMeta.label}
              </h1>
              <p className="text-[11.5px] text-white/45 mt-0.5">{activeMeta.subtitle}</p>
            </div>

            {/* Live Island Preview Stage on Appearance & Island Behavior tabs */}
            {(activeSection === 'appearance' || activeSection === 'behavior') && (
              <LiveNotchPreviewCard settings={settings} palette={palette} />
            )}

            {/* TAB 1: APPEARANCE */}
            {activeSection === 'appearance' && (
              <div className="space-y-5">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2.5">
                    Pilih Tema Warna
                  </div>
                  <div className="grid grid-cols-3 gap-2.5">
                    {THEME_CARDS.map((card) => {
                      const selected = settings.theme === card.id;
                      const cardPalette = CASA_THEME_PALETTES[card.id];
                      return (
                        <button
                          key={card.id}
                          type="button"
                          onClick={() => {
                            playChimeCue('tap');
                            updateSettings({ theme: card.id });
                          }}
                          className={`group relative text-left p-3 rounded-lg border transition-all cursor-pointer flex flex-col justify-between ${
                            selected
                              ? 'border-white/75 bg-white/[0.04]'
                              : 'bg-[#050506] border-white/[0.08] hover:border-white/25 hover:bg-white/[0.02]'
                          }`}
                        >
                          <div>
                            {/* Mini visual swatch capsule */}
                            <div className="h-8 w-full rounded bg-[#000000] border border-white/[0.07] flex items-center justify-between px-2.5 mb-2.5">
                              <div className="flex items-center gap-1">
                                <span
                                  className="w-3 h-1.5 rounded-[2px]"
                                  style={{ backgroundColor: cardPalette.timer }}
                                />
                                <span
                                  className="w-1.5 h-1.5 rounded-[2px]"
                                  style={{ backgroundColor: cardPalette.cpu }}
                                />
                                <span
                                  className="w-1.5 h-1.5 rounded-[2px]"
                                  style={{ backgroundColor: cardPalette.ram }}
                                />
                              </div>
                              <span
                                className="text-[9px] font-mono font-semibold tabular-nums"
                                style={{ color: cardPalette.timer }}
                              >
                                25:00
                              </span>
                            </div>

                            <div className="flex items-center justify-between gap-1">
                              <span className="text-[12px] font-semibold text-white">
                                {card.title}
                              </span>
                              {selected && (
                                <span className="w-4 h-4 rounded-[4px] bg-white text-black flex items-center justify-center shrink-0">
                                  <Check className="w-2.5 h-2.5 stroke-[3]" />
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] font-mono text-white/45 mt-0.5">
                              {card.tag}
                            </div>
                            <p className="text-[10.5px] text-white/50 leading-snug mt-1.5">
                              {card.description}
                            </p>
                          </div>

                          <div className="flex items-center gap-1.5 mt-3 pt-2 border-t border-white/[0.06]">
                            {card.swatches.map((hex) => (
                              <span
                                key={hex}
                                className="w-[10px] h-[10px] rounded-[3px] border border-white/15 shrink-0"
                                style={{ backgroundColor: hex }}
                              />
                            ))}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Active Accent Breakdown — Flat Swatch Bar with Precision Squares & Lucide Icons */}
                <div className="pt-3 border-t border-white/[0.07]">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-white/45 mb-2">
                    Spektrum Aksen Aktif
                  </div>
                  <div className="grid grid-cols-5 border border-white/[0.08] rounded-lg divide-x divide-white/[0.07] bg-[#060607] overflow-hidden">
                    {[
                      { label: 'Focus', color: palette.timer, icon: Target },
                      { label: 'Rest', color: palette.rest, icon: Moon },
                      { label: 'CPU', color: palette.cpu, icon: Cpu },
                      { label: 'RAM', color: palette.ram, icon: MemoryStick },
                      { label: 'Volume', color: palette.volume, icon: Volume2 },
                    ].map((token) => {
                      const TokenIcon = token.icon;
                      return (
                        <div
                          key={token.label}
                          className="px-2 py-2 flex items-center justify-center gap-1.5 min-w-0"
                        >
                          <TokenIcon className="w-3 h-3 text-white/50 shrink-0" />
                          <span
                            className="w-[10px] h-[10px] rounded-[3px] border border-white/15 shrink-0"
                            style={{ backgroundColor: token.color }}
                          />
                          <span className="text-[10px] font-medium text-white/80 truncate">
                            {token.label}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: ISLAND & BEHAVIOR */}
            {activeSection === 'behavior' && (
              <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
                <SettingFlatRow
                  title="Mode Penempatan"
                  description="Tempel rapat di bibir atas layar atau melayang bebas y=12px."
                >
                  <SegmentedControl
                    value={settings.placementMode}
                    options={PLACEMENT_OPTIONS}
                    onChange={(next) => updateSettings({ placementMode: next })}
                  />
                </SettingFlatRow>

                <SettingFlatRow
                  title="Posisi Horizontal"
                  description="Geser posisi notch ke kiri, tengah, atau kanan monitor."
                >
                  <SegmentedControl
                    value={settings.horizontalAlign}
                    options={ALIGN_OPTIONS}
                    onChange={(next) => updateSettings({ horizontalAlign: next })}
                  />
                </SettingFlatRow>

                <SettingFlatRow
                  title="Gaya Pil Idle"
                  description="Tampilkan mata ekspresif × ♥ atau jam digital ringkas HH:MM."
                >
                  <SegmentedControl
                    value={settings.idlePillStyle}
                    options={PILL_STYLE_OPTIONS}
                    onChange={(next) => updateSettings({ idlePillStyle: next })}
                  />
                </SettingFlatRow>

                <SettingFlatRow
                  title="Delay Hover-to-Peek"
                  description="Atur sensitivitas kursor saat menyentuh kapsul di atas layar."
                >
                  <SegmentedControl
                    value={settings.hoverDelayMs}
                    options={HOVER_DELAY_OPTIONS}
                    onChange={(next) => updateSettings({ hoverDelayMs: next })}
                  />
                </SettingFlatRow>

                <SettingFlatRow
                  title="Auto-Tuck Saat Idle"
                  description="Lipat tipis otomatis ketika hening tanpa musik atau timer."
                >
                  <PillToggleSwitch
                    label="Auto-Tuck Saat Idle"
                    checked={settings.autoTuckIdle}
                    onChange={(next) => updateSettings({ autoTuckIdle: next })}
                  />
                </SettingFlatRow>

                <SettingFlatRow
                  title="Perilaku Fullscreen"
                  description="Atur reaksi CASA saat game atau video fullscreen aktif."
                >
                  <SegmentedControl
                    value={settings.fullscreenBehavior}
                    options={FULLSCREEN_OPTIONS}
                    onChange={(next) => updateSettings({ fullscreenBehavior: next })}
                  />
                </SettingFlatRow>
              </div>
            )}

            {/* TAB 3: TIMER & AUDIO */}
            {activeSection === 'audio' && (
              <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
                <div className="py-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-[12.5px] font-semibold text-white/95">
                        Volume Alarm Focus
                      </div>
                      <div className="text-[11px] text-white/45 mt-0.5">
                        Mengatur kekerasan nada dering alarm saat sesi selesai.
                      </div>
                    </div>
                    <span
                      className="text-[13px] font-mono font-semibold tabular-nums px-2 py-0.5 rounded bg-white/[0.04] border border-white/[0.08]"
                      style={{ color: palette.timer }}
                    >
                      {settings.alarmVolume}%
                    </span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.alarmVolume}
                    onChange={(e) => {
                      const val = Number(e.target.value);
                      updateSettings({ alarmVolume: val });
                      syncActiveAlarmVolume(val);
                    }}
                    className="w-full h-1.5 rounded cursor-pointer"
                    style={{ accentColor: palette.timer }}
                    aria-label="Volume Alarm Focus"
                  />
                </div>

                <div className="py-4 space-y-3">
                  <div>
                    <div className="text-[12.5px] font-semibold text-white/95">
                      Nada Dering Kustom (Maks 15 Detik)
                    </div>
                    <div className="text-[11px] text-white/50 mt-0.5 truncate font-mono">
                      {settings.customAlarmMeta
                        ? `Aktif: ${settings.customAlarmMeta.fileName} (${settings.customAlarmMeta.durationSeconds.toFixed(1)}d)`
                        : 'Bawaan: Harmonic Chime (C5–E5–G5–B5)'}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept=".mp3,.wav,.ogg,.m4a,audio/mpeg,audio/wav,audio/ogg,audio/mp4"
                      onChange={handleUploadAlarmFile}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isProcessingAudio}
                      onClick={() => {
                        playChimeCue('tap');
                        fileInputRef.current?.click();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-white text-black hover:bg-white/90 text-[11.5px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-45"
                    >
                      <Upload className="w-3.5 h-3.5" />
                      {isProcessingAudio ? 'Memproses...' : 'Upload Audio'}
                    </button>

                    <button
                      type="button"
                      onClick={handleToggleTestSound}
                      className="px-3 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/[0.12] text-[11.5px] font-medium text-white flex items-center gap-1.5 cursor-pointer"
                    >
                      {isTestingSound ? (
                        <>
                          <Square className="w-3 h-3 fill-current" />
                          Stop Tes
                        </>
                      ) : (
                        <>
                          <Play className="w-3 h-3 fill-current" />
                          Test Suara
                        </>
                      )}
                    </button>

                    {settings.customAlarmMeta && (
                      <button
                        type="button"
                        onClick={() => void handleResetCustomAlarm()}
                        className="px-3 py-1.5 rounded-lg bg-transparent hover:bg-white/[0.08] border border-white/[0.10] text-[11.5px] text-white/75 hover:text-white flex items-center gap-1.5 cursor-pointer"
                      >
                        <RotateCcw className="w-3 h-3" />
                        Kembalikan Default
                      </button>
                    )}
                  </div>

                  <div className="text-[10.5px] text-white/40">
                    Mendukung .mp3, .wav, .ogg, .m4a (maks 10 MB). File panjang dipotong otomatis hingga 15 detik dengan fade-out halus.
                  </div>

                  {audioFeedback && (
                    <div
                      style={{
                        color:
                          audioFeedback.kind === 'err' ? palette.danger : palette.rest,
                        backgroundColor:
                          audioFeedback.kind === 'err'
                            ? `${palette.danger}1a`
                            : `${palette.rest}1a`,
                        borderColor:
                          audioFeedback.kind === 'err'
                            ? `${palette.danger}40`
                            : `${palette.rest}40`,
                      }}
                      className="text-[11px] px-3 py-2 rounded-lg border"
                    >
                      {audioFeedback.text}
                    </div>
                  )}
                </div>

                <SettingFlatRow
                  title="Auto-Start Siklus Rest / Focus"
                  description="Langsung berlanjut antara sesi Focus dan Rest dengan 1x chime singkat."
                >
                  <PillToggleSwitch
                    label="Auto-Start Siklus Rest / Focus"
                    checked={settings.autoStartNextCycle}
                    onChange={(next) => updateSettings({ autoStartNextCycle: next })}
                  />
                </SettingFlatRow>
              </div>
            )}

            {/* TAB 4: SYSTEM, UPDATES & ABOUT */}
            {activeSection === 'system' && (
              <div className="space-y-4">
                <div className="divide-y divide-white/[0.07] border-t border-b border-white/[0.07]">
                  <SettingFlatRow
                    title="Jalankan Saat Windows Menyala"
                    description="Buka CASA otomatis secara senyap ketika Anda masuk Windows."
                  >
                    <PillToggleSwitch
                      label="Jalankan Saat Windows Menyala"
                      checked={settings.launchAtStartup}
                      disabled={autostartBusy}
                      onChange={(next) => void handleToggleAutostart(next)}
                    />
                  </SettingFlatRow>

                  {autostartError && (
                    <div className="py-2 text-[11px]" style={{ color: palette.danger }}>
                      {autostartError}
                    </div>
                  )}

                  {/* Global Hotkey Row with Physical Keycaps */}
                  <div className="py-3.5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-[#08080A] border border-white/[0.09] flex items-center justify-center shrink-0">
                        <Keyboard className="w-4 h-4 text-white/75" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-[12.5px] font-semibold text-white/95 flex items-center gap-1.5 flex-wrap">
                          <span>Shortcut Global</span>
                          <span className="inline-flex items-center gap-1">
                            <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-[#121215] border border-white/25 border-b-2 text-[10px] font-mono text-white/90">
                              Alt
                            </kbd>
                            <span className="text-white/35 text-[10px] font-mono">+</span>
                            <kbd className="inline-flex items-center px-1.5 py-0.5 rounded-[5px] bg-[#121215] border border-white/25 border-b-2 text-[10px] font-mono text-white/90">
                              Space
                            </kbd>
                          </span>
                        </div>
                        <div className="text-[11px] text-white/45 mt-0.5">
                          Buka atau tutup Control Center dari aplikasi apa pun.
                        </div>
                      </div>
                    </div>
                    <span
                      style={
                        shortcutRegistered === null
                          ? undefined
                          : shortcutRegistered
                          ? {
                              color: palette.rest,
                              borderColor: `${palette.rest}4d`,
                              backgroundColor: `${palette.rest}1a`,
                            }
                          : {
                              color: palette.timer,
                              borderColor: `${palette.timer}4d`,
                              backgroundColor: `${palette.timer}1a`,
                            }
                      }
                      className={`text-[10.5px] font-mono font-semibold px-2 py-0.5 rounded border shrink-0 ${
                        shortcutRegistered === null
                          ? 'text-white/50 border-white/10 bg-white/[0.04]'
                          : ''
                      }`}
                    >
                      {shortcutRegistered === null
                        ? 'Memeriksa...'
                        : shortcutRegistered
                        ? 'Aktif'
                        : 'Konflik'}
                    </span>
                  </div>

                  {/* About & Signed Auto-Updater Row */}
                  <div className="py-4 space-y-3">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[13px] font-semibold text-white">
                            CASA v{updateResult?.currentVersion ?? '2.0.2'}
                          </span>
                          <span className="text-[10px] font-mono text-white/45 px-1.5 py-0.5 rounded border border-white/[0.08] bg-[#08080A]">
                            Signed Updater
                          </span>
                        </div>
                        <div className="text-[11.5px] text-white/75 font-medium mt-1">
                          Companion &amp; Ambient System Assistant
                        </div>
                        <div className="text-[10px] font-mono text-white/40 mt-0.5">
                          Crimson · Asa · Sasha · Assistant
                        </div>
                        <div className="text-[10.5px] text-white/45 mt-1.5 flex items-center gap-1.5 flex-wrap">
                          <span>Endpoint rilis</span>
                          <span className="text-white/25">/</span>
                          <button
                            type="button"
                            onClick={() =>
                              void openExternalUrl(
                                'https://github.com/Farhanpratama09/casa-app/releases'
                              )
                            }
                            className="inline-flex items-center gap-1 text-white/70 hover:text-white underline underline-offset-2 cursor-pointer transition-colors"
                            title="Buka https://github.com/Farhanpratama09/casa-app/releases"
                          >
                            <span>Farhanpratama09/casa-app</span>
                            <ExternalLink className="w-3 h-3" />
                          </button>
                        </div>
                      </div>

                      <button
                        type="button"
                        disabled={isCheckingUpdate || isInstallingUpdate}
                        onClick={() => void handleCheckUpdates()}
                        className="px-3 py-1.5 rounded-lg bg-white/[0.08] hover:bg-white/[0.15] border border-white/[0.14] text-[11.5px] font-medium text-white flex items-center gap-1.5 cursor-pointer disabled:opacity-45 shrink-0"
                      >
                        <RefreshCw
                          className={`w-3.5 h-3.5 ${isCheckingUpdate ? 'animate-spin' : ''}`}
                        />
                        {isCheckingUpdate ? 'Memeriksa...' : 'Check Updates'}
                      </button>
                    </div>

                    {updateResult && (
                      <div className="pt-2.5 border-t border-white/[0.06] flex items-center justify-between gap-3">
                        <span
                          style={
                            updateResult.statusKind === 'available'
                              ? { color: palette.rest }
                              : updateResult.statusKind === 'offline'
                              ? { color: palette.timer }
                              : updateResult.statusKind !== 'up-to-date'
                              ? { color: palette.danger }
                              : undefined
                          }
                          className={`text-[11px] ${
                            updateResult.statusKind === 'available'
                              ? 'font-medium'
                              : updateResult.statusKind === 'up-to-date'
                              ? 'text-white/75'
                              : ''
                          }`}
                        >
                          {installProgressText || updateResult.message}
                        </span>
                        {updateResult.available && (
                          <button
                            type="button"
                            disabled={isInstallingUpdate}
                            onClick={() => void handleInstallUpdate()}
                            className="px-3 py-1 rounded-lg bg-white hover:bg-white/90 text-black text-[11px] font-semibold flex items-center gap-1.5 cursor-pointer disabled:opacity-50 shrink-0"
                          >
                            <Download className="w-3.5 h-3.5" />
                            {isInstallingUpdate
                              ? 'Menginstal...'
                              : `Install & Restart v${updateResult.version}`}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2.5 pt-1">
                  <button
                    type="button"
                    onClick={handleResetMusicAffinity}
                    className="px-3 py-2 rounded-lg bg-[#060607] hover:bg-white/[0.06] border border-white/[0.08] text-[11.5px] font-medium text-white/85 hover:text-white flex items-center justify-center gap-2 cursor-pointer transition-colors"
                    title="Hanya menghapus riwayat pencarian dan skor rekomendasi; Custom Playlist aman"
                  >
                    <Sparkles className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset Rekomendasi Musik</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => void handleResetAllDefaults()}
                    className="px-3 py-2 rounded-lg bg-[#060607] hover:bg-white/[0.08] border border-white/[0.08] hover:border-white/25 text-[11.5px] font-medium text-white/75 hover:text-white flex items-center justify-center gap-2 cursor-pointer transition-colors"
                  >
                    <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                    <span>Reset Pengaturan Default</span>
                  </button>
                </div>

                {dataNotice && (
                  <div className="text-[11px] px-3 py-2 rounded-lg bg-white/[0.05] border border-white/[0.12] text-white/85">
                    {dataNotice}
                  </div>
                )}
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
};
