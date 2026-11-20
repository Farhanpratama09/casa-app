import React, { memo } from 'react';
import { motion } from 'framer-motion';
import type { CompanionMood } from '../../hooks/useCompanionMood';
import { useSkillStore } from '../../skills/store';
import { useSystemHardware } from '../../hooks/useSystemHardware';
import { useSystemTelemetry } from '../../hooks/useSystemTelemetry';
import { usePrayerStore } from '../../features/ibadah/prayerStore';

export type CompanionExpression =
  | 'prayer'      // ✦ ☾ (Waktu Ibadah tiba - Bintang & Bulan Sabit Pure Monochrome OLED)
  | 'alarm'       // > < (Alarm berbunyi - aksen Warm Amber)
  | 'dual_active' // •̀ ♪ (Focus timer & Musik aktif bersamaan)
  | 'focus'       // •̀ ♥ (Focus timer berjalan)
  | 'music'       // ♪ ♥ (Musik diputar)
  | 'awake_lock'  // ✦ ♥ (Keep Awake aktif)
  | 'low_battery' // × ♡ (Baterai laptop < 15% & tidak dicas)
  | 'idle';       // × ♥ (Default idle)

export interface CompanionExpressionInputs {
  isPrayerAlert?: boolean;
  isAlarmRinging: boolean;
  isTimerRunning: boolean;
  isPlaying: boolean;
  keepAwake: boolean;
  hasBattery: boolean;
  batteryLevel: number;
  isCharging: boolean;
}

/**
 * Pure priority resolver for reactive companion eye expressions:
 * 1. prayer (• ‿ •)
 * 2. alarm (> <)
 * 3. dual_active (•̀ ♪)
 * 4. focus (•̀ ♥)
 * 5. music (♪ ♥)
 * 6. awake_lock (✦ ♥)
 * 7. low_battery (× ♡)
 * 8. idle (× ♥)
 */
export function resolveCompanionExpression({
  isPrayerAlert = false,
  isAlarmRinging,
  isTimerRunning,
  isPlaying,
  keepAwake,
  hasBattery,
  batteryLevel,
  isCharging,
}: CompanionExpressionInputs): CompanionExpression {
  if (isPrayerAlert) return 'prayer';
  if (isAlarmRinging) return 'alarm';
  if (isTimerRunning && isPlaying) return 'dual_active';
  if (isTimerRunning) return 'focus';
  if (isPlaying) return 'music';
  if (keepAwake) return 'awake_lock';
  if (hasBattery && !isCharging && batteryLevel < 15) return 'low_battery';
  return 'idle';
}

export interface CasaCompanionAvatarProps {
  isPlaying?: boolean;
  isTimerRunning?: boolean;
  isAlarmRinging?: boolean;
  isPrayerAlert?: boolean;
  keepAwake?: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
  mood?: CompanionMood;
  expression?: CompanionExpression;
  size?: 'sm' | 'md';
  className?: string;
}

const EXPRESSION_TITLES: Record<CompanionExpression, string> = {
  prayer: 'CASA (✦ ☾ Waktu Ibadah)',
  alarm: 'CASA (> < Time\'s Up!)',
  dual_active: 'CASA (•̀ ♪ Focus + Music)',
  focus: 'CASA (•̀ ♥ Focus Active)',
  music: 'CASA (♪ ♥ Music Playing)',
  awake_lock: 'CASA (✦ ♥ Keep Awake)',
  low_battery: 'CASA (× ♡ Low Battery)',
  idle: 'CASA (× ♥ Standby)',
};

/**
 * CasaCompanionAvatar (Status Bar & Header Companion — CASA v2.0)
 * Reactive geometric SVG vector expressions shared across Idle pills and Mode 6 header:
 * - alarm:       > < (Warm Amber)
 * - dual_active: •̀ ♪
 * - focus:       •̀ ♥
 * - music:       ♪ ♥
 * - awake_lock:  ✦ ♥
 * - low_battery: × ♡
 * - idle:        × ♥
 */
export const CasaCompanionAvatar: React.FC<CasaCompanionAvatarProps> = memo(({
  isPlaying: propIsPlaying,
  isTimerRunning: propIsTimerRunning,
  isAlarmRinging: propIsAlarmRinging,
  isPrayerAlert: propIsPrayerAlert,
  keepAwake: propKeepAwake,
  batteryLevel: propBatteryLevel,
  isCharging: propIsCharging,
  expression,
  size = 'sm',
  className = '',
}) => {
  const storeIsPlaying = useSkillStore((s) => {
    const media = s.skillStates['core.media'];
    if (!media) return false;
    if (media.playbackSource === 'native') {
      return Boolean(media.isNativePlaying && media.nativeTrack);
    }
    return Boolean(media.song?.isPlaying && media.song?.title && media.song.title.trim() !== '');
  });
  const timerState = useSkillStore((s) => s.skillStates['core.timer']);
  const prayerStore = usePrayerStore();
  const { telemetry } = useSystemHardware();
  const { stats: systemStats, isLoaded: systemStatsLoaded } = useSystemTelemetry(false);

  const isPlaying = propIsPlaying !== undefined ? propIsPlaying : storeIsPlaying;
  const isTimerRunning =
    propIsTimerRunning !== undefined
      ? propIsTimerRunning
      : Boolean(timerState?.isActive && !timerState?.isPaused);
  const isAlarmRinging =
    propIsAlarmRinging !== undefined
      ? propIsAlarmRinging
      : Boolean(timerState?.isAlarmRinging);
  const isPrayerAlert =
    propIsPrayerAlert !== undefined
      ? propIsPrayerAlert
      : Boolean(prayerStore.activeAlert && !prayerStore.activeAlert.suppressVisual);
  const keepAwake =
    propKeepAwake !== undefined ? propKeepAwake : Boolean(telemetry.stay_awake);

  const hasBattery = systemStatsLoaded
    ? systemStats.battery.has_battery
    : telemetry.has_battery;
  const batteryLevel =
    propBatteryLevel !== undefined
      ? propBatteryLevel
      : systemStatsLoaded
      ? systemStats.battery.percent
      : telemetry.battery_percentage;
  const isCharging =
    propIsCharging !== undefined
      ? propIsCharging
      : systemStatsLoaded
      ? (systemStats.battery.is_charging || systemStats.battery.is_plugged_in)
      : telemetry.is_charging;

  const resolvedExpression: CompanionExpression =
    expression ??
    resolveCompanionExpression({
      isPrayerAlert,
      isAlarmRinging,
      isTimerRunning,
      isPlaying,
      keepAwake,
      hasBattery,
      batteryLevel,
      isCharging,
    });

  const svgSizeClass = size === 'md' ? 'w-[28px] h-[13px]' : 'w-[24px] h-[11px]';

  const renderLeftEye = () => {
    switch (resolvedExpression) {
      case 'prayer':
        // ✦ crisp 4-point celestial star with soft monochrome twinkle glow
        return (
          <path
            d="M 8.5,1.8 Q 8.9,7.4 14.5,8 Q 8.9,8.6 8.5,14.2 Q 8.1,8.6 2.5,8 Q 8.1,7.4 8.5,1.8 Z"
            fill="var(--casa-ibadah, #FFFFFF)"
            style={{
              filter: 'drop-shadow(0 0 2.5px var(--casa-ibadah-glow, rgba(255,255,255,0.45)))',
            }}
          />
        );
      case 'alarm':
        // > sharp crisp chevron (Warm Amber accent)
        return (
          <path
            d="M 4.5,3.2 L 12.5,8 L 4.5,12.8"
            fill="none"
            stroke="var(--casa-timer, #F59E0B)"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      case 'dual_active':
      case 'focus':
        // •̀ focused eye + determined downward brow
        return (
          <>
            <path
              d="M 4.2,3.0 L 12.2,5.6"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.9"
              strokeLinecap="round"
            />
            <circle cx="8.4" cy="9.8" r="2.7" fill="#ffffff" />
          </>
        );
      case 'music':
        // ♪ crisp eighth note
        return (
          <>
            <path
              d="M 9.8,11.6 L 9.8,3.2 L 14.2,4.8"
              fill="none"
              stroke="#ffffff"
              strokeWidth="1.9"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <ellipse
              cx="6.8"
              cy="11.6"
              rx="3.0"
              ry="2.2"
              transform="rotate(-18 6.8 11.6)"
              fill="#ffffff"
            />
          </>
        );
      case 'awake_lock':
        // ✦ crisp 4-point star spark
        return (
          <path
            d="M 8.5,1.8 Q 8.8,7.6 14.6,8 Q 8.8,8.4 8.5,14.2 Q 8.2,8.4 2.4,8 Q 8.2,7.6 8.5,1.8 Z"
            fill="#ffffff"
          />
        );
      case 'low_battery':
      case 'idle':
      default:
        // × crisp white X
        return (
          <path
            d="M 3.5,3.5 L 12.5,12.5 M 12.5,3.5 L 3.5,12.5"
            fill="none"
            stroke="#ffffff"
            strokeWidth="2.1"
            strokeLinecap="round"
          />
        );
    }
  };

  const renderRightEye = () => {
    if (resolvedExpression === 'prayer') {
      // ☾ crisp crescent moon matching ✦ left eye
      return (
        <path
          d="M 27.2,2.7 C 21.0,2.9 20.6,13.1 27.2,13.3 C 24.0,11.8 24.0,4.2 27.2,2.7 Z"
          fill="var(--casa-ibadah, #FFFFFF)"
          style={{
            filter: 'drop-shadow(0 0 2.5px var(--casa-ibadah-glow, rgba(255,255,255,0.45)))',
          }}
        />
      );
    }

    if (resolvedExpression === 'alarm') {
      // < sharp crisp chevron (Warm Amber accent)
      return (
        <path
          d="M 29.5,3.2 L 21.5,8 L 29.5,12.8"
          fill="none"
          stroke="var(--casa-timer, #F59E0B)"
          strokeWidth="2.1"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      );
    }

    if (resolvedExpression === 'dual_active') {
      // ♪ crisp white eighth note on right eye paired with •̀ left eye
      return (
        <>
          <path
            d="M 26.2,11.6 L 26.2,3.2 L 30.6,4.8"
            fill="none"
            stroke="#ffffff"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <ellipse
            cx="23.2"
            cy="11.6"
            rx="3.0"
            ry="2.2"
            transform="rotate(-18 23.2 11.6)"
            fill="#ffffff"
          />
        </>
      );
    }

    const heartPath =
      'M 25,13.5 L 24.3,12.8 C 21.1,10.0 19.6,8.3 19.6,6.1 C 19.6,4.4 20.9,3.1 22.5,3.1 C 23.6,3.1 24.5,3.7 25,4.6 C 25.5,3.7 26.4,3.1 27.5,3.1 C 29.1,3.1 30.4,4.4 30.4,6.1 C 30.4,8.3 28.9,10.0 25.7,12.8 Z';

    if (resolvedExpression === 'low_battery') {
      // ♡ hollow white heart outline
      return (
        <path
          d={heartPath}
          fill="none"
          stroke="#ffffff"
          strokeWidth="1.65"
          strokeLinejoin="round"
        />
      );
    }

    // ♥ filled white heart
    return <path d={heartPath} fill="#ffffff" />;
  };

  const hasMusicMotion =
    isPlaying || resolvedExpression === 'music' || resolvedExpression === 'dual_active';

  const bobAnimate =
    resolvedExpression === 'prayer'
      ? { opacity: [0.78, 1, 0.78], scale: [0.95, 1.05, 0.95], x: 0, y: 0 }
      : resolvedExpression === 'alarm'
      ? { x: [0, -1, 1, -1, 0], scale: 1, opacity: 1 }
      : hasMusicMotion
      ? { y: [0, -1, 0], scale: 1, opacity: 1 }
      : { y: 0, x: 0, scale: 1, opacity: 1 };

  const bobTransition =
    resolvedExpression === 'prayer'
      ? { repeat: Infinity, duration: 2.3, ease: 'easeInOut' as const }
      : resolvedExpression === 'alarm'
      ? { repeat: Infinity, duration: 0.45, ease: 'easeInOut' as const }
      : hasMusicMotion
      ? { repeat: Infinity, duration: 1.2, ease: 'easeInOut' as const }
      : { type: 'spring' as const, stiffness: 450, damping: 25 };

  return (
    <motion.div
      initial={false}
      animate={bobAnimate}
      transition={bobTransition}
      data-companion-expression={resolvedExpression}
      className={`relative inline-flex items-center justify-center shrink-0 select-none overflow-visible ${className}`}
      title={EXPRESSION_TITLES[resolvedExpression]}
    >
      <svg
        viewBox="0 0 34 16"
        className={`${svgSizeClass} shrink-0 overflow-visible`}
        aria-hidden="true"
      >
        {renderLeftEye()}
        {renderRightEye()}
      </svg>
    </motion.div>
  );
});

CasaCompanionAvatar.displayName = 'CasaCompanionAvatar';
