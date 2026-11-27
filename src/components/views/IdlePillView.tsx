import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Volume2,
  VolumeX,
  Sun,
  Zap,
  BatteryCharging,
  BatteryWarning,
  ArrowBigUpDash,
  Bluetooth,
  Headphones,
  Timer,
  Paperclip,
  BellRing,
} from 'lucide-react';
import { useSkillStore } from '../../skills/store';
import { useTimerState } from '../../features/timer/useTimerState';
import { stopPrayerAlert, usePrayerStore } from '../../features/ibadah/prayerStore';
import { resolvePrayerVisualTheme } from '../../features/ibadah/prayerScheduleLogic';
import type { DueReminderAlert } from '../../features/calendar/calendarScheduleLogic';
import { useDropZoneStore } from '../../stores/useDropZoneStore';
import { TodoItem } from '../../types/island';
import { useSystemHardware, SystemHudAlert } from '../../hooks/useSystemHardware';
import { useSystemTelemetry } from '../../hooks/useSystemTelemetry';
import { BatteryPill } from '../system/BatteryPill';
import { useCasaAudio } from '../../context/CasaAudioContext';
import {
  computeLyricAdjustedTimeMs,
  computeSyncedLyricIndex,
  resolvePlaybackPositionMs,
} from '../../features/media/playbackClock';
import { reanchorMediaPlaybackClock } from '../../skills/media/MediaSkill';
import { RestingPill } from '../companion/RestingPill';
import {
  CasaCompanionAvatar,
  resolveCompanionExpression,
  type CompanionExpression,
} from '../companion/CasaCompanionAvatar';
import { TwinEqualizerGlyph } from '../system/CosmicIcons';
import { formatDurationClock } from '../../features/timer/timerUtils';
import { useSettingsStore } from '../../stores/useSettingsStore';

const snapEvenWidth = (width: number): number => Math.max(88, Math.ceil(width / 2) * 2);
const EMPTY_TODOS: TodoItem[] = [];

interface IdlePillViewProps {
  isDualBubble?: boolean;
  isExpanded?: boolean;
  isRestingSleep?: boolean;
  isTucked?: boolean;
  isTuckedPeek?: boolean;
  remeasureKey?: number;
  activeReminderAlert?: DueReminderAlert | null;
  onSnoozeReminder?: () => void;
  onDismissReminder?: () => void;
  onExpandSkill?: (skillId: string) => void;
  onContentWidthChange?: (width: number) => void;
}

/**
 * Pure Circle Battery Ring (CASA v2.0 Minimalist Flat Style)
 * Cincin melingkar proporsional (0–100%) tanpa neon glow berlebih.
 */
export const PureCircleBattery: React.FC<{
  percentage: number;
  isCharging: boolean;
  hasBattery?: boolean;
  size?: number;
  className?: string;
  showText?: boolean;
}> = ({
  percentage,
  isCharging,
  hasBattery = true,
  size = 16,
  className = '',
  showText = true,
}) => {
  if (!hasBattery) return null;

  const center = size / 2;
  const radius = center - 1.7;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(100, Math.round(percentage)));
  const offset = circumference - (clamped / 100) * circumference;

  const strokeColor = isCharging
    ? 'var(--casa-rest, #10B981)'
    : clamped <= 20
    ? 'var(--casa-danger, #F43F5E)'
    : clamped <= 50
    ? 'var(--casa-timer, #F59E0B)'
    : '#E4E4E7';

  return (
    <div
      className={`flex items-center gap-1.5 shrink-0 select-none ${className}`}
      title={`Baterai: ${clamped}%${isCharging ? ' (Charging)' : ''}`}
    >
      <div
        className="relative flex items-center justify-center shrink-0"
        style={{ width: size, height: size }}
      >
        <svg
          className="w-full h-full -rotate-90 transform"
          viewBox={`0 0 ${size} ${size}`}
        >
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            className="text-white/[0.14]"
          />
          <circle
            cx={center}
            cy={center}
            r={radius}
            fill="none"
            stroke={strokeColor}
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {isCharging && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <Zap
              className="w-2.5 h-2.5"
              style={{
                color: 'var(--casa-rest, #10B981)',
                fill: 'color-mix(in srgb, var(--casa-rest, #10B981) 35%, transparent)',
              }}
            />
          </div>
        )}
      </div>

      {showText && (
        <span className="font-sans font-semibold text-[11.5px] tracking-[-0.02em] tabular-nums text-white leading-none antialiased">
          {clamped}%
        </span>
      )}
    </div>
  );
};

// Komponen Marquee Teks Lagu Dinamis dengan Lebar Alami Deterministik
interface MarqueeTrackProps {
  title: string;
  artist?: string;
  isPlaying?: boolean;
  maxWidth?: number;
}

const MarqueeTrack: React.FC<MarqueeTrackProps> = ({
  title,
  artist,
  isPlaying = true,
  maxWidth = 200,
}) => {
  const probeRef = useRef<HTMLSpanElement>(null);
  const [textWidth, setTextWidth] = useState<number>(0);

  useLayoutEffect(() => {
    if (probeRef.current) {
      const measured = Math.ceil(probeRef.current.getBoundingClientRect().width);
      setTextWidth(measured);
    }
  }, [title, artist]);

  const isOverflowing = isPlaying && textWidth > maxWidth;
  const boundedWidth = textWidth > 0 ? Math.min(textWidth, maxWidth) : undefined;

  const renderContent = (refProp?: React.Ref<HTMLSpanElement>, withSpacer = false) => (
    <span
      ref={refProp}
      className={`inline-flex items-center gap-1.5 whitespace-nowrap py-[1px] ${withSpacer ? 'pr-6' : ''}`}
    >
      <span className="font-sans font-semibold text-[12px] leading-[1.35] text-white tracking-[-0.02em] antialiased">
        {title}
      </span>
      {artist && (
        <>
          <span className="text-zinc-600 select-none text-[10px]">•</span>
          <span className="font-sans font-normal text-[11.5px] leading-[1.35] text-zinc-400 tracking-[-0.02em] antialiased">
            {artist}
          </span>
        </>
      )}
    </span>
  );

  return (
    <div
      style={boundedWidth !== undefined ? { width: boundedWidth } : undefined}
      className={`relative min-w-0 max-w-full overflow-hidden whitespace-nowrap select-none ${
        isOverflowing
          ? '[mask-image:linear-gradient(to_right,transparent,black_8px,black_calc(100%-8px),transparent)] [-webkit-mask-image:linear-gradient(to_right,transparent,black_8px,black_calc(100%-8px),transparent)]'
          : ''
      }`}
    >
      {/* Hidden intrinsic width probe matching exact font weights & tracking */}
      <span
        ref={probeRef}
        aria-hidden="true"
        className="pointer-events-none absolute invisible left-0 top-0 whitespace-nowrap inline-flex items-center gap-1.5"
      >
        <span className="font-sans font-semibold text-[12px] tracking-[-0.02em]">{title}</span>
        {artist && (
          <>
            <span className="text-[10px]">•</span>
            <span className="font-sans font-normal text-[11.5px] tracking-[-0.02em]">{artist}</span>
          </>
        )}
      </span>

      {isOverflowing ? (
        <div className="inline-flex animate-lyrics-marquee">
          {renderContent(undefined, true)}
          {renderContent(undefined, true)}
        </div>
      ) : (
        renderContent(undefined, false)
      )}
    </div>
  );
};

export const IdlePillViewComponent: React.FC<IdlePillViewProps> = ({
  isExpanded = false,
  isRestingSleep = false,
  isTucked = false,
  remeasureKey = 0,
  activeReminderAlert = null,
  onSnoozeReminder,
  onDismissReminder,
  onExpandSkill,
  onContentWidthChange,
}) => {
  const measureRef = useRef<HTMLDivElement>(null);
  const lastReportedWidthRef = useRef<number>(0);

  const mediaState = useSkillStore((s) => s.skillStates['core.media']);
  const casaAudio = useCasaAudio();
  const song = mediaState?.song;
  const playbackSource = mediaState?.playbackSource || 'companion';
  const nativeTrack = mediaState?.nativeTrack;
  const isNativePlaying = Boolean(mediaState?.isNativePlaying);

  const isPlaying = playbackSource === 'native'
    ? Boolean(isNativePlaying && nativeTrack)
    : Boolean(song?.isPlaying && song?.title && song.title.trim() !== '');

  useEffect(() => {
    reanchorMediaPlaybackClock();
  }, [isExpanded]);

  const isIdleLyricsEnabled = Boolean(mediaState?.showIdleLyrics);
  const activeLyricsResult =
    playbackSource === 'native'
      ? casaAudio.lyricsData || mediaState?.lyricsData
      : mediaState?.lyricsData;
  const livePositionMs = resolvePlaybackPositionMs({
    playbackSource: playbackSource === 'native' ? 'native' : 'companion',
    playbackClock: mediaState?.playbackClock,
    nativePositionMs: casaAudio.getAccurateTimeMs(),
    fallbackPositionSec: song?.currentTime ?? 0,
  });

  let activeLyricText = '';
  if (
    isPlaying &&
    isIdleLyricsEnabled &&
    activeLyricsResult?.isSynced &&
    Array.isArray(activeLyricsResult.lines) &&
    activeLyricsResult.lines.length > 0
  ) {
    const adjustedMs = computeLyricAdjustedTimeMs(livePositionMs, {
      playbackSource: playbackSource === 'native' ? 'native' : 'companion',
      offsetSeconds: activeLyricsResult.offsetSeconds || 0,
    });
    const activeIdx = computeSyncedLyricIndex(activeLyricsResult.lines, adjustedMs);
    const candidate = activeIdx >= 0 ? activeLyricsResult.lines[activeIdx]?.text : undefined;
    if (candidate && candidate.trim() !== '') {
      activeLyricText = candidate.trim();
    }
  }

  const isSpotifyActive = Boolean(
    playbackSource !== 'native' &&
    (song?.is_spotify || (mediaState?.isSpotifyRunning && !mediaState?.is_browser))
  );

  // Akses langsung state timer dari store
  const timerState = useSkillStore((s) => s.skillStates['core.timer']);
  const { addFiveMinutes, dismissAlarm, completeFocusedTodoAndDismiss } = useTimerState();
  const todos: TodoItem[] = useSkillStore((s) => s.skillStates['core.todo']?.todos ?? EMPTY_TODOS);
  const isTimerActive = Boolean(timerState?.isActive);
  const isAlarmRinging = Boolean(timerState?.isAlarmRinging);
  const isTimerPaused = Boolean(timerState?.isPaused);
  const timerRemaining = timerState?.remainingSeconds ?? 0;
  const timerTotal = timerState?.totalSeconds ?? 25 * 60;

  const focusedTask = useMemo(() => {
    const targetId = timerState?.focusedTaskId;
    if (targetId) {
      const byFocus = todos.find((t) => !t.completed && t.id === targetId);
      if (byFocus) return byFocus;
    }
    return todos.find((t) => !t.completed && t.isPinned) || null;
  }, [todos, timerState?.focusedTaskId]);

  const timerLabel = focusedTask
    ? focusedTask.text
    : timerState?.mode === 'rest'
    ? 'Break Timer'
    : 'Focus Timer';

  const timerProgress =
    timerTotal > 0 ? Math.max(0, Math.min(1, 1 - timerRemaining / timerTotal)) : 0;

  // Digital Clock & Tabular Date
  const [timeStr, setTimeStr] = useState('');
  const [dateStr, setDateStr] = useState('');

  // Shared Hardware Telemetry & Interactive Transient System HUD (2.5s interrupt)
  const {
    hudAlert,
    telemetry,
    setHudInteracting,
    setMasterVolume,
    setBrightness,
  } = useSystemHardware();
  const isKeepAwake = Boolean(telemetry.stay_awake);
  const { settings } = useSettingsStore();
  const idlePillStyle = settings.idlePillStyle;
  const useClockPill = idlePillStyle === 'clock';
  const { stats: systemStats, isLoaded: systemStatsLoaded } = useSystemTelemetry(false);
  const [showBatteryTransient, setShowBatteryTransient] = useState(false);
  const prevPluggedInRef = useRef<boolean | null>(null);
  const batteryTransientTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!systemStatsLoaded || !systemStats.battery.has_battery) {
      return;
    }
    const currentPlugged = systemStats.battery.is_plugged_in;
    if (prevPluggedInRef.current === null) {
      prevPluggedInRef.current = currentPlugged;
      return;
    }
    if (prevPluggedInRef.current !== currentPlugged) {
      prevPluggedInRef.current = currentPlugged;
      setShowBatteryTransient(true);
      if (batteryTransientTimerRef.current) {
        clearTimeout(batteryTransientTimerRef.current);
      }
      batteryTransientTimerRef.current = setTimeout(() => {
        setShowBatteryTransient(false);
        batteryTransientTimerRef.current = null;
      }, 3500);
    }
  }, [systemStatsLoaded, systemStats.battery.has_battery, systemStats.battery.is_plugged_in]);

  useEffect(() => {
    return () => {
      if (batteryTransientTimerRef.current) {
        clearTimeout(batteryTransientTimerRef.current);
      }
    };
  }, []);
  const hudBarRef = useRef<HTMLDivElement>(null);
  const [isDraggingHud, setIsDraggingHud] = useState(false);

  const updateHudSliderFromPointer = (clientX: number, alert: SystemHudAlert) => {
    const rect = hudBarRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const nextVal = Math.round(ratio * 100);
    if (alert.kind === 'volume' || alert.kind === 'mute') {
      void setMasterVolume(nextVal);
    } else if (alert.kind === 'brightness') {
      void setBrightness(nextVal);
    }
  };

  useEffect(() => {
    const updateTime = () => {
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
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  // Derive active Mode 1-5, 2.5s Transient System HUD, or Priority Focus Alarm Takeover
  const hasLaptopBattery = systemStatsLoaded
    ? systemStats.battery.has_battery
    : telemetry.has_battery;
  const laptopBatteryPct = systemStatsLoaded
    ? systemStats.battery.percent
    : telemetry.battery_percentage;
  const laptopBatteryCharging = systemStatsLoaded
    ? (systemStats.battery.is_charging || systemStats.battery.is_plugged_in)
    : telemetry.is_charging;
  const isLowBatteryExpression = Boolean(
    hasLaptopBattery && !laptopBatteryCharging && laptopBatteryPct < 15
  );

  const prayerStore = usePrayerStore();
  const activePrayerAlert =
    prayerStore.activeAlert && !prayerStore.activeAlert.suppressVisual
      ? prayerStore.activeAlert
      : null;
  const isPrayerAlertVisible = activePrayerAlert !== null;
  const isReminderAlertVisible = activeReminderAlert !== null;
  const parkedFileCount = useDropZoneStore((s) => s.items.length);

  const companionExpression: CompanionExpression = resolveCompanionExpression({
    isPrayerAlert: isPrayerAlertVisible,
    isAlarmRinging,
    isReminderAlert: isReminderAlertVisible,
    isTimerRunning: isTimerActive && !isTimerPaused,
    isPlaying,
    keepAwake: isKeepAwake,
    hasDropItems: parkedFileCount > 0,
    hasBattery: hasLaptopBattery,
    batteryLevel: laptopBatteryPct,
    isCharging: laptopBatteryCharging,
  });

  const isRestingMode =
    !isPrayerAlertVisible &&
    !isAlarmRinging &&
    !isReminderAlertVisible &&
    !isPlaying &&
    !isTimerActive &&
    isRestingSleep &&
    !isKeepAwake &&
    !isLowBatteryExpression &&
    !hudAlert &&
    !useClockPill;
  const activeModeKey = isPrayerAlertVisible
    ? 'prayer-takeover'
    : isAlarmRinging
    ? 'alarm-takeover'
    : isReminderAlertVisible
    ? 'reminder-takeover'
    : hudAlert
    ? 'system-hud'
    : isPlaying && isTimerActive
    ? 'dual-idle'
    : isPlaying
    ? 'music-idle'
    : isTimerActive
    ? 'timer-idle'
    : isRestingMode
    ? 'resting'
    : 'idle';

  // ResizeObserver + intrinsic measurement -> rounded UP to even integer for crisp DPI alignment
  const reportMeasuredWidth = () => {
    if (isTucked) return;
    const el = measureRef.current;
    if (!el || !onContentWidthChange) return;
    const rawW = el.getBoundingClientRect().width;
    const evenW = snapEvenWidth(rawW);
    if (evenW !== lastReportedWidthRef.current) {
      lastReportedWidthRef.current = evenW;
      onContentWidthChange(evenW);
    }
  };

  useLayoutEffect(() => {
    reportMeasuredWidth();
  });

  useEffect(() => {
    if (isTucked) {
      lastReportedWidthRef.current = 0;
      return;
    }
    const rafId = requestAnimationFrame(() => {
      reportMeasuredWidth();
    });
    const el = measureRef.current;
    if (!el || !onContentWidthChange) {
      return () => cancelAnimationFrame(rafId);
    }

    const observer = new ResizeObserver(() => {
      reportMeasuredWidth();
    });
    observer.observe(el);
    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, [onContentWidthChange, isTucked, remeasureKey]);

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

  const reminderAccentColor =
    settings.theme === 'monochrome' ? '#FFFFFF' : '#FB7185';
  const timerText = formatDurationClock(timerRemaining);
  const showLyricFocus = Boolean(isIdleLyricsEnabled && activeLyricText);
  const dropZoneIdleBadge =
    parkedFileCount > 0 ? (
      <>
        <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />
        <button
          type="button"
          onClick={(e) => {
            if (isExpanded) return;
            e.stopPropagation();
            onExpandSkill?.('core.drop_zone');
          }}
          title={`${parkedFileCount} berkas di Drop Zone (Klik untuk buka)`}
          className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10.5px] font-medium text-white/80 hover:text-white hover:bg-white/[0.08] transition-colors shrink-0 ${
            isExpanded ? 'pointer-events-none' : 'cursor-pointer'
          }`}
        >
          <Paperclip className="w-3 h-3 text-white/65 shrink-0" aria-hidden="true" />
          <span className="font-mono text-[10.5px] tabular-nums leading-none">
            {parkedFileCount}
          </span>
        </button>
      </>
    ) : null;
  const ringRadius = 5;
  const ringCircumference = 2 * Math.PI * ringRadius;
  const ringDashOffset = ringCircumference * (1 - timerProgress);

  const showBatteryInIdle =
    systemStats.battery.has_battery &&
    (showBatteryTransient || systemStats.battery.status === 'low');

  const showRamWarningDot =
    !hudAlert && !showBatteryTransient && systemStats.ram_percent >= 90;

  const idleBatterySlot = showBatteryInIdle ? (
    <>
      <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />
      <BatteryPill
        battery={systemStats.battery}
        showPercentage={true}
        statusLabel={showBatteryTransient}
      />
    </>
  ) : null;

  const idleRamWarningDot = showRamWarningDot ? (
    <span
      style={{
        backgroundColor: 'var(--casa-danger, #EF4444)',
        boxShadow: '0 0 6px var(--casa-danger-glow, rgba(248,113,113,0.75))',
      }}
      className="w-1.5 h-1.5 rounded-full shrink-0"
      title={`Penggunaan RAM tinggi: ${Math.round(systemStats.ram_percent)}%`}
      aria-label={`RAM usage high ${Math.round(systemStats.ram_percent)}%`}
    />
  ) : null;

  const renderHudGlyph = (alert: SystemHudAlert) => {
    switch (alert.kind) {
      case 'volume':
        return (
          <Volume2
            className="w-3.5 h-3.5 shrink-0"
            style={{
              color: alert.isActive
                ? 'var(--casa-volume, #38BDF8)'
                : 'var(--casa-danger, #F43F5E)',
            }}
          />
        );
      case 'mute':
        return alert.isActive ? (
          <VolumeX
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--casa-danger, #F43F5E)' }}
          />
        ) : (
          <Volume2
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--casa-volume, #38BDF8)' }}
          />
        );
      case 'brightness':
        return (
          <Sun
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: 'var(--casa-brightness, #FACC15)' }}
          />
        );
      case 'charging':
        return alert.isActive ? (
          <Zap className="w-3.5 h-3.5 shrink-0 fill-current" style={{ color: '#facc15' }} />
        ) : (
          <BatteryCharging className="w-3.5 h-3.5 shrink-0" style={{ color: alert.accentColor || '#22c55e' }} />
        );
      case 'low_battery':
        return (
          <BatteryWarning
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: (alert.percent ?? 20) <= 10 ? '#ef4444' : '#f59e0b' }}
          />
        );
      case 'caps_lock':
        return (
          <ArrowBigUpDash
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: alert.isActive ? 'var(--casa-volume, #38BDF8)' : 'rgba(255,255,255,0.55)' }}
          />
        );
      case 'bluetooth':
        return (
          <Bluetooth
            className="w-3.5 h-3.5 shrink-0"
            style={{ color: alert.isActive ? 'var(--casa-bluetooth, #6366F1)' : '#a1a1aa' }}
          />
        );
      case 'audio_output':
        return alert.audioOutputKind === 'bluetooth' ? (
          <Bluetooth className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--casa-bluetooth, #6366F1)' }} />
        ) : alert.audioOutputKind === 'wired' ? (
          <Headphones className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--casa-volume, #38BDF8)' }} />
        ) : (
          <Volume2 className="w-3.5 h-3.5 shrink-0" style={{ color: 'var(--casa-volume, #38BDF8)' }} />
        );
    }
  };

  if (isTucked) {
    return (
      <div
        ref={measureRef}
        aria-hidden="true"
        className="opacity-0 pointer-events-none invisible w-0 h-0 overflow-hidden"
      />
    );
  }

  return (
    <div
      ref={measureRef}
      className={`inline-flex items-center justify-center w-max h-full select-none mx-auto shrink-0 ${
        isExpanded ? 'pointer-events-none' : ''
      }`}
    >
      {activeModeKey === 'prayer-takeover' && activePrayerAlert ? (() => {
        const prayerTheme = resolvePrayerVisualTheme(
          activePrayerAlert.prayerId,
          settings.theme === 'monochrome'
        );
        return (
        /* PRIORITY BANNER TAKEOVER: Pengingat Ibadah T-0 (✦ ☾ + Adzan <Sholat> + Jam + Equalizer + Stop/Tutup) */
        <motion.div
          key={`mode-prayer-takeover-${activePrayerAlert.fireKey}`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => {
            // hoverExpandLocked: klik area non-tombol TIDAK melebarkan Mode 6
            e.stopPropagation();
          }}
          style={
            {
              '--casa-ibadah': prayerTheme.accent,
              '--casa-ibadah-glow': prayerTheme.glow,
            } as React.CSSProperties
          }
          className="casa-prayer-t0-pill min-w-[248px] px-3.5 h-full flex items-center justify-between gap-2.5 bg-transparent select-none cursor-default"
        >
          <div className="flex items-center gap-2 min-w-0">
            <CasaCompanionAvatar isPlaying={false} expression="prayer" />
            <div className="flex items-center gap-1.5 min-w-0">
              <span
                style={{ color: 'var(--casa-ibadah, #FFFFFF)' }}
                className="font-sans text-[11.5px] font-bold tracking-tight whitespace-nowrap"
              >
                Adzan {activePrayerAlert.prayerLabel}
              </span>
              {activePrayerAlert.timeLabel && (
                <span className="font-mono text-[10.5px] tabular-nums text-white/50 whitespace-nowrap">
                  {activePrayerAlert.timeLabel}
                </span>
              )}
            </div>
            {activePrayerAlert.audioMode !== 'visual' && (
              <span
                className="casa-prayer-eq shrink-0 ml-0.5"
                aria-hidden="true"
              >
                <span className="casa-prayer-eq-bar" />
                <span className="casa-prayer-eq-bar" />
                <span className="casa-prayer-eq-bar" />
                <span className="casa-prayer-eq-bar" />
              </span>
            )}
          </div>

          <button
            type="button"
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              stopPrayerAlert();
            }}
            style={{
              backgroundColor: 'var(--casa-ibadah, #FFFFFF)',
              color: '#000000',
            }}
            className="h-[22px] px-2.5 rounded-full hover:brightness-95 font-sans text-[10px] font-bold transition-all cursor-pointer active:scale-95 whitespace-nowrap shrink-0"
            title={
              activePrayerAlert.audioMode === 'visual'
                ? 'Tutup pengingat ibadah'
                : 'Hentikan audio adzan'
            }
          >
            {activePrayerAlert.audioMode === 'visual' ? 'Tutup' : 'Stop'}
          </button>
        </motion.div>
        );
      })() : activeModeKey === 'alarm-takeover' ? (
        /* PRIORITY BANNER TAKEOVER: Focus Timer "Time's Up!" (~360px OLED + Warm Amber) */
        <motion.div
          key="mode-alarm-takeover"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => {
            if (isExpanded) return;
            e.stopPropagation();
            onExpandSkill?.('core.timer');
          }}
          className={`${focusedTask ? 'w-[428px]' : 'w-[360px]'} px-3.5 h-full flex items-center justify-between gap-2.5 bg-[#000000] select-none ${
            isExpanded ? 'pointer-events-none' : 'cursor-pointer'
          }`}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            {!useClockPill ? (
              <CasaCompanionAvatar isPlaying={false} expression="alarm" />
            ) : (
              <BellRing
                style={{ color: 'var(--casa-timer, #F59E0B)' }}
                className="w-4 h-4 animate-pulse shrink-0"
                aria-hidden="true"
              />
            )}
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                style={{ color: 'var(--casa-timer, #F59E0B)' }}
                className="font-sans text-[11.5px] font-bold tracking-tight whitespace-nowrap shrink-0"
              >
                Time&apos;s Up!
              </span>
              <span className="text-zinc-600 text-[10px] shrink-0">·</span>
              <span className="font-sans text-[11px] font-medium text-white/90 truncate">
                {focusedTask ? focusedTask.text : 'Focus Session Complete'}
              </span>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {focusedTask ? (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    completeFocusedTodoAndDismiss(focusedTask.id);
                  }}
                  style={{ backgroundColor: 'var(--casa-timer, #F59E0B)' }}
                  className="h-[22px] px-2.5 rounded-full hover:brightness-110 text-black font-sans text-[10px] font-bold transition-all cursor-pointer active:scale-95 whitespace-nowrap"
                  title="Matikan alarm, reset timer & centang tugas selesai"
                >
                  Selesai
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    addFiveMinutes();
                  }}
                  className="h-[22px] px-2 rounded-full bg-white/[0.12] hover:bg-white/[0.20] border border-white/20 text-white font-sans text-[10px] font-semibold transition-colors cursor-pointer active:scale-95 whitespace-nowrap"
                  title="Tambah 5 menit & pertahankan tautan tugas"
                >
                  +5m
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissAlarm();
                  }}
                  className="h-[22px] px-2 rounded-full bg-white/[0.06] hover:bg-white/[0.16] border border-white/[0.12] text-white/80 hover:text-white font-sans text-[10px] font-medium transition-colors cursor-pointer active:scale-95 whitespace-nowrap"
                  title="Matikan alarm tanpa mencentang tugas"
                >
                  Dismiss
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    addFiveMinutes();
                  }}
                  style={{ backgroundColor: 'var(--casa-timer, #F59E0B)' }}
                  className="h-[22px] px-2 rounded-full hover:brightness-110 text-black font-sans text-[10px] font-bold transition-all cursor-pointer active:scale-95"
                  title="Tambah 5 menit & lanjutkan"
                >
                  +5m
                </button>
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    dismissAlarm();
                  }}
                  className="h-[22px] px-2 rounded-full bg-white/[0.10] hover:bg-white/[0.20] border border-white/15 text-white font-sans text-[10px] font-semibold transition-colors cursor-pointer active:scale-95"
                  title="Matikan alarm & reset preset"
                >
                  Dismiss
                </button>
              </>
            )}
          </div>
        </motion.div>
      ) : activeModeKey === 'reminder-takeover' && activeReminderAlert ? (
        /* PRIORITY BANNER TAKEOVER: Pengingat Jadwal T-0 (◉ ♥ + Judul + Snooze 5m + Dismiss) */
        <motion.div
          key={`mode-reminder-takeover-${activeReminderAlert.fireKey}`}
          data-reminder-pill="t0"
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          onClick={(e) => {
            // hoverExpandLocked: klik area non-tombol TIDAK melebarkan Mode 6
            e.stopPropagation();
          }}
          className="min-w-[276px] max-w-[330px] px-3 h-full flex items-center justify-between gap-2 bg-transparent select-none cursor-default"
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <CasaCompanionAvatar isPlaying={false} expression="reminder_t0" />
            <div className="flex items-center gap-1.5 min-w-0 flex-1">
              <span
                className="font-sans text-[11px] font-semibold tracking-tight text-white truncate"
                title={activeReminderAlert.title}
              >
                {activeReminderAlert.title}
              </span>
              {activeReminderAlert.scheduledTimeHHMM && (
                <span className="font-mono text-[9.5px] tabular-nums text-white/50 shrink-0">
                  {activeReminderAlert.scheduledTimeHHMM}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              data-reminder-action="snooze"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onSnoozeReminder?.();
              }}
              className="h-[21px] px-2 rounded-full bg-white/[0.10] hover:bg-white/[0.20] border border-white/15 text-white font-sans text-[9.5px] font-semibold transition-colors cursor-pointer active:scale-95 whitespace-nowrap"
              title="Tunda pengingat 5 menit"
            >
              Snooze 5m
            </button>
            <button
              type="button"
              data-reminder-action="dismiss"
              onPointerDown={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onDismissReminder?.();
              }}
              style={{
                backgroundColor: reminderAccentColor,
                color: '#000000',
              }}
              className="h-[21px] px-2 rounded-full hover:brightness-95 font-sans text-[9.5px] font-bold transition-all cursor-pointer active:scale-95 whitespace-nowrap"
              title="Tutup pengingat jadwal"
            >
              Dismiss
            </button>
          </div>
        </motion.div>
      ) : activeModeKey === 'system-hud' && hudAlert ? (
        /* TRANSIENT SYSTEM HUD (2.5s Interaktif di Pil Atas) */
        <motion.div
          key={`mode-hud-${hudAlert.kind}`}
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
          onMouseEnter={() => setHudInteracting(true)}
          onMouseLeave={() => {
            if (!isDraggingHud) setHudInteracting(false);
          }}
          className="px-3.5 h-full flex items-center gap-2.5 select-none"
        >
          {renderHudGlyph(hudAlert)}
          <span className="font-sans text-[11.5px] font-semibold tracking-tight text-white whitespace-nowrap max-w-[230px] truncate">
            {hudAlert.label}
          </span>

          {(hudAlert.kind === 'volume' ||
            hudAlert.kind === 'brightness' ||
            hudAlert.kind === 'mute') &&
            typeof hudAlert.percent === 'number' && (
              <div
                ref={hudBarRef}
                role="slider"
                aria-label={hudAlert.label}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={hudAlert.percent}
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => {
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setIsDraggingHud(true);
                  setHudInteracting(true);
                  updateHudSliderFromPointer(e.clientX, hudAlert);
                }}
                onPointerMove={(e) => {
                  if (!isDraggingHud) return;
                  e.stopPropagation();
                  updateHudSliderFromPointer(e.clientX, hudAlert);
                }}
                onPointerUp={(e) => {
                  if (!isDraggingHud) return;
                  e.stopPropagation();
                  try {
                    e.currentTarget.releasePointerCapture(e.pointerId);
                  } catch {}
                  setIsDraggingHud(false);
                  setHudInteracting(false);
                }}
                className="relative w-[86px] h-[6px] rounded-full bg-white/15 overflow-hidden cursor-pointer touch-none"
              >
                <div
                  className="h-full rounded-full transition-[width] duration-75"
                  style={{
                    width: `${Math.max(0, Math.min(100, hudAlert.percent))}%`,
                    backgroundColor: hudAlert.accentColor,
                  }}
                />
              </div>
            )}

          {hudAlert.detail && (
            (hudAlert.kind === 'bluetooth' || hudAlert.kind === 'audio_output') ? (
              <span
                style={
                  hudAlert.detail.endsWith('%')
                    ? {
                        backgroundColor: 'color-mix(in srgb, var(--casa-rest, #10B981) 16%, transparent)',
                        borderColor: 'color-mix(in srgb, var(--casa-rest, #10B981) 35%, transparent)',
                        color: 'var(--casa-rest, #10B981)',
                      }
                    : undefined
                }
                className={`px-1.5 py-[1px] rounded-full border font-mono text-[10px] font-semibold tabular-nums whitespace-nowrap shrink-0 ${
                  hudAlert.detail.endsWith('%')
                    ? ''
                    : 'bg-white/[0.08] border-white/[0.12] text-white/75'
                }`}
              >
                {hudAlert.detail}
              </span>
            ) : (
              <span className="font-sans text-[11px] font-medium tabular-nums text-white/75 whitespace-nowrap">
                {hudAlert.detail}
              </span>
            )
          )}
        </motion.div>
      ) : activeModeKey === 'resting' ? (
        /* MODE 1: RESTING — Kapsul Proporsional 128×38 dengan Mata Putih × ♥ */
        <motion.div
          key="mode-resting"
          data-resting-capsule="true"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="h-full flex items-center justify-center"
        >
          <RestingPill isSleepingActive={isRestingMode && !isKeepAwake && !isExpanded} />
        </motion.div>
      ) : activeModeKey === 'dual-idle' ? (
        /* MODE 5: DUAL IDLE (Musik + Focus Ring & Task Timer Berdampingan) */
        <motion.div
          key="mode-dual-idle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="px-3.5 h-full flex items-center gap-2.5"
        >
          {useClockPill ? (
            <span className="font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white/90 leading-none shrink-0">
              {timeStr || '19:13'}
            </span>
          ) : (
            <div className="flex items-center h-6 shrink-0 overflow-visible" title="CASA">
              <CasaCompanionAvatar isPlaying={isPlaying} expression={companionExpression} mood="awake" />
            </div>
          )}

          <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />

          {/* Segmen Musik: Klik langsung buka tab Media di Mode 6 */}
          <div
            onClick={(e) => {
              if (isExpanded) return;
              e.stopPropagation();
              onExpandSkill?.('core.media');
            }}
            className={`flex items-center gap-2 rounded-full -mx-1 px-1 py-0.5 hover:bg-white/[0.06] transition-colors ${
              isExpanded ? 'pointer-events-none' : 'cursor-pointer'
            }`}
            title={artistName ? `${trackTitle} • ${artistName}` : trackTitle}
          >
            <MarqueeTrack title={trackTitle} artist={artistName} isPlaying={isPlaying} maxWidth={140} />
            <TwinEqualizerGlyph active={isPlaying} isSpotify={isSpotifyActive} />
          </div>

          <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />

          {/* Segmen Focus Timer: Micro Ring + Task + Countdown */}
          <div
            onClick={(e) => {
              if (isExpanded) return;
              e.stopPropagation();
              onExpandSkill?.('core.timer');
            }}
            className={`flex items-center gap-1.5 rounded-full -mx-1 px-1 py-0.5 hover:bg-white/[0.06] transition-colors shrink-0 ${
              isExpanded ? 'pointer-events-none' : 'cursor-pointer'
            } ${isTimerPaused ? 'opacity-60' : 'opacity-100'}`}
            title={`${timerLabel} ${isTimerPaused ? '(Paused) ' : ''}· ${timerText}`}
            role="button"
            aria-label="Focus Timer Countdown"
          >
            {focusedTask ? (
              <>
                <svg className="w-3.5 h-3.5 -rotate-90 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r={ringRadius} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.8" />
                  <circle
                    cx="7"
                    cy="7"
                    r={ringRadius}
                    fill="none"
                    stroke={
                      timerState?.mode === 'rest'
                        ? 'var(--casa-rest, #10B981)'
                        : 'var(--casa-timer, #F59E0B)'
                    }
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringDashOffset}
                  />
                </svg>
                <span className="font-sans text-[11px] font-medium text-white/80 truncate max-w-[74px]">
                  {focusedTask.text}
                </span>
                <span className="text-white/35 text-[10px]">·</span>
              </>
            ) : (
              <Timer
                data-focus-timer-icon="true"
                className={`w-3.5 h-3.5 shrink-0 ${isTimerPaused ? 'opacity-65' : 'animate-pulse'}`}
                style={{
                  color:
                    timerState?.mode === 'rest'
                      ? 'var(--casa-rest, #10B981)'
                      : 'var(--casa-timer, #F59E0B)',
                }}
                aria-hidden="true"
              />
            )}
            <span className="font-sans font-semibold text-[11.5px] tracking-[-0.02em] tabular-nums leading-none text-white antialiased">
              {timerText}
            </span>
          </div>
          {idleBatterySlot}
          {idleRamWarningDot}
          {dropZoneIdleBadge}
        </motion.div>
      ) : activeModeKey === 'music-idle' ? (
        /* MODE 3: IDLE MUSIK — Mata × ♥ meluncur halus & lirik statis single-line simetris saat Idle Lyrics aktif */
        <motion.div
          key="mode-music-idle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="px-4 h-full flex items-center"
        >
          <motion.div
            initial={false}
            animate={{
              width: showLyricFocus ? 0 : 'auto',
              opacity: showLyricFocus ? 0 : 1,
              marginRight: showLyricFocus ? 0 : 10,
            }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
            aria-hidden={showLyricFocus}
            className="flex items-center gap-2.5 overflow-hidden shrink-0"
          >
            <div className="flex items-center h-6 shrink-0 overflow-visible" title="CASA">
              {useClockPill ? (
                <span className="font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white/90 leading-none">
                  {timeStr || '19:13'}
                </span>
              ) : (
                <CasaCompanionAvatar isPlaying={isPlaying} expression={companionExpression} mood="awake" />
              )}
            </div>
            <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />
          </motion.div>

          <div
            onClick={(e) => {
              if (isExpanded) return;
              e.stopPropagation();
              onExpandSkill?.('core.media');
            }}
            className={`flex items-center gap-2 rounded-full -mx-1 px-1 py-0.5 hover:bg-white/[0.06] transition-colors ${
              isExpanded ? 'pointer-events-none' : 'cursor-pointer'
            }`}
            title={
              activeLyricText
                ? `${activeLyricText} (${trackTitle})`
                : artistName
                ? `${trackTitle} • ${artistName}`
                : trackTitle
            }
          >
            {showLyricFocus ? (
              <div className="inline-flex items-center overflow-hidden transition-[width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]">
                <motion.span
                  key={activeLyricText}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                  className="font-sans font-semibold text-[12px] leading-[1.35] inline-block py-[2px] text-white tracking-[-0.02em] whitespace-nowrap max-w-[680px] overflow-hidden text-ellipsis antialiased select-none"
                >
                  {activeLyricText}
                </motion.span>
              </div>
            ) : (
              <MarqueeTrack title={trackTitle} artist={artistName} isPlaying={isPlaying} maxWidth={200} />
            )}
            <TwinEqualizerGlyph active={isPlaying} isSpotify={isSpotifyActive} />
          </div>
          {idleBatterySlot}
          {!showLyricFocus && (
            <>
              {idleRamWarningDot}
              {dropZoneIdleBadge}
            </>
          )}
        </motion.div>
      ) : activeModeKey === 'timer-idle' ? (
        /* MODE 4: IDLE TIMER — [ × ♥ | ◯ Active Task · MM:SS ] */
        <motion.div
          key="mode-timer-idle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="px-3.5 h-full flex items-center gap-2.5"
        >
          <div className="flex items-center h-6 shrink-0 overflow-visible" title="CASA">
            {useClockPill ? (
              <span className="font-mono text-[11px] font-semibold tabular-nums tracking-tight text-white/90 leading-none">
                {timeStr || '19:13'}
              </span>
            ) : (
              <CasaCompanionAvatar isPlaying={false} expression={companionExpression} mood="awake" />
            )}
          </div>

          <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />

          <div
            onClick={(e) => {
              if (isExpanded) return;
              e.stopPropagation();
              onExpandSkill?.('core.timer');
            }}
            className={`flex items-center gap-1.5 rounded-full -mx-1 px-1 py-0.5 hover:bg-white/[0.06] transition-colors shrink-0 ${
              isExpanded ? 'pointer-events-none' : 'cursor-pointer'
            } ${isTimerPaused ? 'opacity-60' : 'opacity-100'}`}
            title={`${timerLabel} ${isTimerPaused ? '(Paused) ' : ''}· ${timerText}`}
            role="button"
            aria-label="Focus Timer Countdown"
          >
            {focusedTask ? (
              <>
                <svg className="w-3.5 h-3.5 -rotate-90 shrink-0" viewBox="0 0 14 14" aria-hidden="true">
                  <circle cx="7" cy="7" r={ringRadius} fill="none" stroke="rgba(255,255,255,0.18)" strokeWidth="1.8" />
                  <circle
                    cx="7"
                    cy="7"
                    r={ringRadius}
                    fill="none"
                    stroke={
                      timerState?.mode === 'rest'
                        ? 'var(--casa-rest, #10B981)'
                        : 'var(--casa-timer, #F59E0B)'
                    }
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeDasharray={ringCircumference}
                    strokeDashoffset={ringDashOffset}
                  />
                </svg>
                <span className="font-sans text-[11.5px] font-medium text-white/85 truncate max-w-[115px]">
                  {focusedTask.text}
                </span>
                <span className="text-white/35 text-[10px]">·</span>
              </>
            ) : (
              <Timer
                data-focus-timer-icon="true"
                className={`w-3.5 h-3.5 shrink-0 ${isTimerPaused ? 'opacity-65' : 'animate-pulse'}`}
                style={{
                  color:
                    timerState?.mode === 'rest'
                      ? 'var(--casa-rest, #10B981)'
                      : 'var(--casa-timer, #F59E0B)',
                }}
                aria-hidden="true"
              />
            )}
            <span className="font-sans font-semibold text-[12px] tracking-[-0.02em] tabular-nums leading-none text-white antialiased">
              {timerText}
            </span>
          </div>
          {idleBatterySlot}
          {idleRamWarningDot}
          {dropZoneIdleBadge}
        </motion.div>
      ) : (
        /* MODE 2: IDLE STANDBY — [ × ♥ | Jam · Tanggal | Baterai ] */
        <motion.div
          key="mode-idle"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="px-3.5 h-full flex items-center gap-2.5"
        >
          {!useClockPill && (
            <>
              <div className="flex items-center h-6 shrink-0 overflow-visible" title="CASA">
                <CasaCompanionAvatar isPlaying={false} expression={companionExpression} mood="awake" />
              </div>

              <span className="h-3 w-[1px] bg-white/[0.14] shrink-0" aria-hidden="true" />
            </>
          )}

          <div
            data-idle-clock-date="true"
            className="flex items-center shrink-0 tabular-nums select-none"
          >
            <div className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
              <span className="font-sans font-semibold text-[12.5px] tracking-[-0.02em] text-white tabular-nums antialiased">
                {timeStr || '19:13'}
              </span>
              <span className="text-zinc-600 select-none">·</span>
              <span className="font-sans font-normal text-[11.5px] tracking-[-0.02em] text-zinc-400 tabular-nums antialiased">
                {dateStr}
              </span>
            </div>
          </div>

          {idleBatterySlot}
          {idleRamWarningDot}
          {dropZoneIdleBadge}
        </motion.div>
      )}
    </div>
  );
};

export const IdlePillView = React.memo(IdlePillViewComponent);
