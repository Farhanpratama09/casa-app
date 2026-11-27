import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { CalendarDays, VolumeX } from 'lucide-react';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { listen } from '@tauri-apps/api/event';
import { IslandMode, CompactSubtype, HardwareMetrics, IslandState } from '../types/island';
import { IdlePillView } from './views/IdlePillView';
import { CasaCompanionAvatar } from './companion/CasaCompanionAvatar';
import { DropZoneView } from './views/DropZoneView';
import { Mode6TopNav } from './views/Mode6TopNav';
import { Mode6ControlCenterView } from './views/mode6/Mode6ControlCenterView';
import { FocusHoverPeekCard } from './views/FocusHoverPeekCard';
import { useSystemHardware } from '../hooks/useSystemHardware';
import { useUpdateNotification } from '../hooks/useUpdateNotification';
import { useTimerState } from '../features/timer/useTimerState';
import { useTodoState } from '../features/todo/useTodoState';
import { MediaExpandedView } from '../features/media/MediaExpandedView';
import { TimerExpandedView } from '../features/timer/TimerExpandedView';
import { TodoExpandedView } from '../features/todo/TodoExpandedView';
import { IbadahExpandedView } from '../features/ibadah/IbadahExpandedView';
import { CalculatorExpandedView } from '../features/calculator/CalculatorExpandedView';
import { CalendarExpandedView } from '../features/calendar/CalendarExpandedView';
import { resolvePrayerVisualTheme } from '../features/ibadah/prayerScheduleLogic';
import {
  notifyPrayerSettingsChanged,
  setPrayerRuntimeFullscreenState,
  stopPrayerAlert,
  usePrayerStore,
} from '../features/ibadah/prayerStore';
import {
  dismissActiveReminder,
  notifyCalendarSettingsChanged,
  setCalendarRuntimeFullscreenState,
  snoozeActiveReminder,
  stopCalendarAlertChime,
  useCalendarStore,
} from '../features/calendar/calendarStore';
import {
  setSmartIgnoreCursorEvents,
  playChimeCue,
  adjustWindowSize,
  updateIslandHitboxes,
  setIslandPinned,
  focusIslandWindow,
  alignWindowTop,
  setWindowVisibility,
  setBackgroundAudioDucking,
  HitRect,
} from '../utils/tauriBridge';
import { useSkillStore } from '../skills/store';
import { useDropZoneStore } from '../stores/useDropZoneStore';
import { useConnectHpStore } from '../stores/useConnectHpStore';
import { useSettingsStore, CasaHorizontalAlign } from '../stores/useSettingsStore';
import {
  isSpotifyUserConnected,
  isSpotifyPremiumRestricted,
  subscribeSpotifyPremiumRestriction,
} from '../utils/spotifyService';
import { unlockAlarmAudio } from '../utils/alarmChime';
import { unlockCalendarChimeAudio } from '../features/calendar/calendarChime';
import {
  registerIslandTransitionHook,
  unregisterIslandTransitionHook,
  recordCanvasResizeCall,
} from '../utils/islandStressTester';
import {
  computePrimaryIslandHitboxAndSensor,
  computeReminderSatelliteBounds,
  computeSearchDrawerBounds,
  ISLAND_DIMENSIONS,
  resolveEffectiveIslandLayout,
  snapEvenDimension,
  useSearchDrawerExtraHeight,
} from '../utils/islandLayoutState';

interface CasaIslandProps {
  mode: IslandMode;
  compactSubtype: CompactSubtype;
  onChangeMode: (newMode: IslandMode, subtype?: CompactSubtype) => void;
  isGamingMode: boolean;
  showDevTrigger?: boolean;
  onToggleDevTrigger?: () => void;
}

const doubleRaf = (callback: () => void) => {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      callback();
    });
  });
};

const AUTO_TUCK_IDLE_DELAY_MS = 10000;
const HOVER_HYSTERESIS_MS = ISLAND_DIMENSIONS.HOVER_TRANSITION_HYSTERESIS_MS;

const computeCenterOffsetX = (
  align: CasaHorizontalAlign,
  capsuleW: number,
  leftPodOpen = false,
  rightPodOpen = false
): number => {
  if (align === 'left') {
    const leftMargin = leftPodOpen ? 230 : 28;
    return Math.round(leftMargin + capsuleW / 2 - 550);
  }
  if (align === 'right') {
    const rightMargin = rightPodOpen ? 230 : 28;
    return Math.round(1100 - rightMargin - capsuleW / 2 - 550);
  }
  return 0;
};

export const CasaIsland: React.FC<CasaIslandProps> = ({
  mode,
  compactSubtype,
  onChangeMode,
  isGamingMode,
  showDevTrigger = false,
  onToggleDevTrigger,
}) => {
  // Live Skill State from Central Skill Store
  const mediaState = useSkillStore((s) => s.skillStates['core.media']);
  const [isSpotifyFreeRestricted, setIsSpotifyFreeRestricted] = useState<boolean>(() =>
    isSpotifyPremiumRestricted()
  );

  useEffect(() => {
    return subscribeSpotifyPremiumRestriction((restricted) => {
      setIsSpotifyFreeRestricted(restricted);
    });
  }, []);

  const isMusicPlaying = (() => {
    if (mediaState?.playbackSource === 'native') {
      return Boolean(mediaState.isNativePlaying && mediaState.nativeTrack);
    }
    return mediaState?.song?.isPlaying ?? false;
  })();
  const idleTimerState = useSkillStore((s) => s.skillStates['core.timer']);
  const isTimerActive = Boolean(idleTimerState?.isActive);
  // Direct store selector so audio ducking activates even when ProductivitySplitView is unmounted (idle/tucked)
  const isAlarmRinging = useSkillStore((s) => Boolean(s.skillStates['core.timer']?.isAlarmRinging));
  const isAlarmRingingRef = useRef<boolean>(isAlarmRinging);
  isAlarmRingingRef.current = isAlarmRinging;
  const prayerStore = usePrayerStore();
  const visiblePrayerAlert =
    prayerStore.activeAlert && !prayerStore.activeAlert.suppressVisual
      ? prayerStore.activeAlert
      : null;
  const isPrayerAlertVisible = visiblePrayerAlert !== null;
  const isPrayerAlertVisibleRef = useRef<boolean>(isPrayerAlertVisible);
  isPrayerAlertVisibleRef.current = isPrayerAlertVisible;
  const { hudAlert, telemetry } = useSystemHardware();
  // Keep global update-status listener alive even while Mode 6 is collapsed
  useUpdateNotification();
  const isKeepAwake = Boolean(telemetry.stay_awake);
  const { settings } = useSettingsStore();
  const calendarState = useCalendarStore();
  const visibleReminderAlert =
    settings.calendarEnabled &&
    calendarState.activeAlert &&
    !isPrayerAlertVisible &&
    !isAlarmRinging
      ? calendarState.activeAlert
      : null;
  const isReminderAlertVisible = visibleReminderAlert !== null;
  const isReminderAlertVisibleRef = useRef<boolean>(isReminderAlertVisible);
  isReminderAlertVisibleRef.current = isReminderAlertVisible;
  const visibleUpcomingReminderBadge =
    settings.calendarEnabled &&
    !isPrayerAlertVisible &&
    !isAlarmRinging &&
    !isReminderAlertVisible &&
    !hudAlert
      ? calendarState.upcomingBadge
      : null;
  const isAdzanAudioActive = Boolean(
    prayerStore.activeAlert && prayerStore.activeAlert.audioMode !== 'visual'
  );
  const isCalendarAlertActive = Boolean(
    settings.calendarEnabled && calendarState.activeAlert
  );
  const shouldDuckBackgroundAudio =
    !isAdzanAudioActive && (isAlarmRinging || isCalendarAlertActive);

  useEffect(() => {
    void setBackgroundAudioDucking(shouldDuckBackgroundAudio);
  }, [shouldDuckBackgroundAudio]);

  useEffect(() => {
    if (isAdzanAudioActive) {
      stopCalendarAlertChime();
    }
  }, [isAdzanAudioActive]);

  useEffect(() => {
    const handleUnlockOnGesture = () => {
      unlockAlarmAudio();
      unlockCalendarChimeAudio();
      window.removeEventListener('pointerdown', handleUnlockOnGesture, true);
      window.removeEventListener('keydown', handleUnlockOnGesture, true);
    };
    window.addEventListener('pointerdown', handleUnlockOnGesture, {
      capture: true,
      passive: true,
    });
    window.addEventListener('keydown', handleUnlockOnGesture, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener('pointerdown', handleUnlockOnGesture, true);
      window.removeEventListener('keydown', handleUnlockOnGesture, true);
      void setBackgroundAudioDucking(false);
    };
  }, []);

  const isPriorityAlert =
    isAlarmRinging || isPrayerAlertVisible || isReminderAlertVisible;
  const isPriorityAlertRef = useRef<boolean>(isPriorityAlert);
  isPriorityAlertRef.current = isPriorityAlert;
  const activePrayerTheme = resolvePrayerVisualTheme(
    visiblePrayerAlert?.prayerId,
    settings.theme === 'monochrome'
  );
  const isIbadahEnabled = settings.ibadah.enabled;
  const isIbadahEnabledRef = useRef<boolean>(isIbadahEnabled);
  isIbadahEnabledRef.current = isIbadahEnabled;
  const isCalculatorEnabled = settings.calculatorEnabled;
  const isCalculatorEnabledRef = useRef<boolean>(isCalculatorEnabled);
  isCalculatorEnabledRef.current = isCalculatorEnabled;
  const isCalendarEnabled = settings.calendarEnabled;
  const isCalendarEnabledRef = useRef<boolean>(isCalendarEnabled);
  isCalendarEnabledRef.current = isCalendarEnabled;
  const placementMode = settings.placementMode;
  const isFloatingMode = placementMode === 'floating';
  const horizontalAlign = settings.horizontalAlign;
  const hoverDelayMs = settings.hoverDelayMs;
  const autoTuckIdle = settings.autoTuckIdle;
  const fullscreenBehavior = settings.fullscreenBehavior;
  const isFullscreenActive = Boolean(telemetry.is_fullscreen_active);
  const isExternalDragOver = useDropZoneStore((s) => s.isDragging && !s.isInternalDragging);
  const activeSkillId = useSkillStore((s) => s.activeSkillId);
  const secondaryBubbleSkillId = useSkillStore(
    (s) => s.secondarySkillId || s.secondaryBubbleSkillId
  );

  // Discrete Finite State Machine (FSM):
  // 'tucked' | 'tucked_peek' | 'idle' | 'idle_peek' | 'expanded'
  const [islandState, setIslandState] = useState<IslandState>('idle');
  const islandStateRef = useRef<IslandState>('idle');

  // Status Hover / Intip Sementara (Isolasi dari Status Aktif Permanen)
  const [isPeeking, setIsPeeking] = useState<boolean>(false);
  const isPeekingRef = useRef<boolean>(false);
  const leaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    islandStateRef.current = islandState;
    // ISOLASI STATE GUARD: Timer resting dan SashaEyes DILARANG menyentuh mode minimize (tucked / tucked_peek)
    if (islandState !== 'idle') {
      if (restingSleepTimerRef.current) {
        clearTimeout(restingSleepTimerRef.current);
        restingSleepTimerRef.current = null;
      }
      setIsRestingSleep(false);
    }
  }, [islandState]);

  // Landing lock for secondary bubble: strictly quarantined during expand, peek, and collapse animation
  const [isLandingComplete, setIsLandingComplete] = useState<boolean>(true);

  const [stagedDroppedFile, setStagedDroppedFile] = useState<string | null>(null);

  // Transition Guard & Anti-Spam Animation Lock (safety ceiling; cleared early in onAnimationComplete)
  const isTransitioningRef = useRef<boolean>(false);
  const transitionLockTimerRef = useRef<NodeJS.Timeout | null>(null);
  const schedulePostTransitionRecheckRef = useRef<(delayMs?: number) => void>(() => {});

  const lockTransition = (timeoutMs = 260, recheckOnExpire = false) => {
    isTransitioningRef.current = true;
    if (transitionLockTimerRef.current) {
      clearTimeout(transitionLockTimerRef.current);
    }
    transitionLockTimerRef.current = setTimeout(() => {
      isTransitioningRef.current = false;
      transitionLockTimerRef.current = null;
      if (recheckOnExpire) {
        schedulePostTransitionRecheckRef.current(0);
      }
    }, timeoutMs);
  };

  const unlockTransition = () => {
    isTransitioningRef.current = false;
    if (transitionLockTimerRef.current) {
      clearTimeout(transitionLockTimerRef.current);
      transitionLockTimerRef.current = null;
    }
  };

  const hoverLeaveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const intensiveHoverTimerRef = useRef<NodeJS.Timeout | null>(null);
  const tuckedEnterTimerRef = useRef<NodeJS.Timeout | null>(null);
  const collapseTimerRef = useRef<NodeJS.Timeout | null>(null);
  const dropTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const restingSleepTimerRef = useRef<NodeJS.Timeout | null>(null);
  const autoTuckIdleTimerRef = useRef<NodeJS.Timeout | null>(null);
  const wasTuckedByFullscreenRef = useRef<boolean>(false);
  const wasHiddenByFullscreenRef = useRef<boolean>(false);
  const wasTuckedBeforeAlertRef = useRef<boolean>(false);
  const prevPriorityAlertRef = useRef<boolean>(false);
  const prevIsFullscreenActiveRef = useRef<boolean>(false);
  const fullscreenExitCooldownUntilRef = useRef<number>(0);
  const collapseCooldownUntilRef = useRef<number>(0);
  const hoverSuppressionReleaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const postTransitionRecheckTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fullscreenExitTick, setFullscreenExitTick] = useState<number>(0);
  const isFloatingModeRef = useRef<boolean>(isFloatingMode);
  isFloatingModeRef.current = isFloatingMode;
  const horizontalAlignRef = useRef<CasaHorizontalAlign>(horizontalAlign);
  horizontalAlignRef.current = horizontalAlign;
  const hoverDelayMsRef = useRef(hoverDelayMs);
  hoverDelayMsRef.current = hoverDelayMs;
  const autoTuckIdleRef = useRef<boolean>(autoTuckIdle);
  autoTuckIdleRef.current = autoTuckIdle;
  const fullscreenBehaviorRef = useRef(fullscreenBehavior);
  fullscreenBehaviorRef.current = fullscreenBehavior;
  const isFullscreenActiveRef = useRef<boolean>(isFullscreenActive);
  isFullscreenActiveRef.current = isFullscreenActive;
  const isWakingUpRef = useRef<boolean>(false);
  const wakeUpTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRestingSleepRef = useRef<boolean>(false);
  const hoverSuppressedRef = useRef<boolean>(false);
  const isCursorInsideRef = useRef<boolean>(false);
  const hoverSensorRef = useRef<HTMLDivElement | null>(null);
  const lastPointerPosRef = useRef<{ x: number; y: number } | null>(null);
  const lastCollapseResizeTimeRef = useRef<number>(0);
  const scheduleHoverPeekRef = useRef<(allowIdleHoverRestart: boolean) => void>(() => {});
  const islandRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<IslandMode>(mode);
  const isDraggingFileRef = useRef<boolean>(false);
  const previousModeBeforeDragRef = useRef<IslandMode>('idle');

  const onChangeModeRef = useRef(onChangeMode);
  useEffect(() => {
    onChangeModeRef.current = onChangeMode;
  }, [onChangeMode]);

  const showDevTriggerRef = useRef(showDevTrigger);
  useEffect(() => {
    showDevTriggerRef.current = showDevTrigger;
  }, [showDevTrigger]);

  // Auto-Sleep setelah 5.5 detik tanpa aktivitas kursor:
  // HAKIKAT RESTING: HANYA BOLEH AKTIF jika hening total: !isMusicPlaying && !isTimerActive
  const [isRestingSleep, setIsRestingSleep] = useState<boolean>(false);

  useEffect(() => {
    isRestingSleepRef.current = isRestingSleep;
  }, [isRestingSleep]);

  const isMusicPlayingRef = useRef<boolean>(isMusicPlaying);
  const isTimerActiveRef = useRef<boolean>(isTimerActive);
  const isKeepAwakeRef = useRef<boolean>(isKeepAwake);
  useEffect(() => {
    isMusicPlayingRef.current = isMusicPlaying;
  }, [isMusicPlaying]);
  useEffect(() => {
    isTimerActiveRef.current = isTimerActive;
  }, [isTimerActive]);
  useEffect(() => {
    isKeepAwakeRef.current = isKeepAwake;
  }, [isKeepAwake]);

  const clearHoverSuppressionReleaseTimer = useCallback(() => {
    if (hoverSuppressionReleaseTimerRef.current) {
      clearTimeout(hoverSuppressionReleaseTimerRef.current);
      hoverSuppressionReleaseTimerRef.current = null;
    }
  }, []);

  const clearPostTransitionRecheckTimer = useCallback(() => {
    if (postTransitionRecheckTimerRef.current) {
      clearTimeout(postTransitionRecheckTimerRef.current);
      postTransitionRecheckTimerRef.current = null;
    }
  }, []);

  const markCollapseTransitionCooldown = useCallback((durationMs = HOVER_HYSTERESIS_MS) => {
    const until = Date.now() + durationMs;
    if (until > collapseCooldownUntilRef.current) {
      collapseCooldownUntilRef.current = until;
    }
  }, []);

  const isCollapseCooldownActive = useCallback(() => {
    const now = Date.now();
    return (
      isCollapsingRef.current ||
      now - lastCollapseResizeTimeRef.current < HOVER_HYSTERESIS_MS ||
      now < collapseCooldownUntilRef.current ||
      now < fullscreenExitCooldownUntilRef.current
    );
  }, []);

  const isPointerInsideHoverSensor = useCallback((): boolean => {
    if (!isCursorInsideRef.current) return false;
    const sRect = hoverSensorRef.current?.getBoundingClientRect();
    const lp = lastPointerPosRef.current;
    if (!sRect || !lp) {
      return isCursorInsideRef.current;
    }
    const inside =
      lp.x >= sRect.left &&
      lp.x <= sRect.right &&
      lp.y >= sRect.top &&
      lp.y <= sRect.bottom;
    if (!inside) {
      isCursorInsideRef.current = false;
    }
    return inside;
  }, []);

  const recheckPointerHoverIntent = useCallback(() => {
    if (!isPointerInsideHoverSensor()) return;
    if (hoverSuppressedRef.current) return;
    if (isCollapseCooldownActive() || isTransitioningRef.current) return;

    const current = islandStateRef.current;
    if (current === 'tucked' || current === 'idle') {
      scheduleHoverPeekRef.current(true);
    }
  }, [isPointerInsideHoverSensor, isCollapseCooldownActive]);

  const schedulePostTransitionRecheck = useCallback(
    (delayMs = 0) => {
      clearPostTransitionRecheckTimer();
      const now = Date.now();
      const remainingCollapseMs = Math.max(
        0,
        collapseCooldownUntilRef.current - now,
        lastCollapseResizeTimeRef.current + HOVER_HYSTERESIS_MS - now,
        fullscreenExitCooldownUntilRef.current - now
      );
      const waitMs = Math.max(delayMs, remainingCollapseMs > 0 ? remainingCollapseMs + 16 : 0);
      postTransitionRecheckTimerRef.current = setTimeout(() => {
        postTransitionRecheckTimerRef.current = null;
        recheckPointerHoverIntent();
      }, waitMs);
    },
    [clearPostTransitionRecheckTimer, recheckPointerHoverIntent]
  );

  useEffect(() => {
    schedulePostTransitionRecheckRef.current = schedulePostTransitionRecheck;
  }, [schedulePostTransitionRecheck]);

  const clearMinimizeWakeupLocks = useCallback(() => {
    clearHoverSuppressionReleaseTimer();
    clearPostTransitionRecheckTimer();
    hoverSuppressedRef.current = false;
    isCollapsingRef.current = false;
    collapseCooldownUntilRef.current = 0;
    lastCollapseResizeTimeRef.current = 0;
  }, [clearHoverSuppressionReleaseTimer, clearPostTransitionRecheckTimer]);

  const schedulePostCollapseSuppressionRelease = useCallback(() => {
    clearHoverSuppressionReleaseTimer();
    const now = Date.now();
    const waitMs = Math.max(
      HOVER_HYSTERESIS_MS,
      collapseCooldownUntilRef.current - now + 16,
      lastCollapseResizeTimeRef.current + HOVER_HYSTERESIS_MS - now + 16,
      fullscreenExitCooldownUntilRef.current - now + 16
    );
    hoverSuppressionReleaseTimerRef.current = setTimeout(() => {
      hoverSuppressionReleaseTimerRef.current = null;
      if (isCollapsingRef.current || isTransitioningRef.current) {
        if (!isCursorInsideRef.current && hoverSuppressedRef.current) {
          schedulePostCollapseSuppressionRelease();
        }
        return;
      }
      if (!isCursorInsideRef.current && Date.now() >= collapseCooldownUntilRef.current) {
        hoverSuppressedRef.current = false;
      } else if (isCursorInsideRef.current && !hoverSuppressedRef.current) {
        recheckPointerHoverIntent();
      }
    }, waitMs);
  }, [clearHoverSuppressionReleaseTimer, recheckPointerHoverIntent]);

  const clearAutoTuckIdleTimer = useCallback(() => {
    if (autoTuckIdleTimerRef.current) {
      clearTimeout(autoTuckIdleTimerRef.current);
      autoTuckIdleTimerRef.current = null;
    }
  }, []);

  const resetRestingSleepTimer = useCallback(() => {
    if (restingSleepTimerRef.current) {
      clearTimeout(restingSleepTimerRef.current);
      restingSleepTimerRef.current = null;
    }

    if (isPriorityAlertRef.current) {
      return;
    }
    // ISOLASI STATE GUARD: Timer auto-resting hanya berjalan saat idle hening total, Keep Awake mati, DAN kursor di luar kapsul
    if (
      islandStateRef.current !== 'idle' ||
      isMusicPlaying ||
      isTimerActive ||
      isKeepAwake ||
      isCursorInsideRef.current
    ) {
      if (isMusicPlaying || isTimerActive || isKeepAwake) {
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
      }
      return;
    }
    if (isRestingSleepRef.current) {
      return;
    }

    restingSleepTimerRef.current = setTimeout(() => {
      if (
        islandStateRef.current === 'idle' &&
        !isMusicPlayingRef.current &&
        !isTimerActiveRef.current &&
        !isKeepAwakeRef.current &&
        !isCursorInsideRef.current
      ) {
        isCollapsingRef.current = true;
        isRestingSleepRef.current = true;
        setIsRestingSleep(true);
      }
      restingSleepTimerRef.current = null;
    }, 5500);
  }, [isMusicPlaying, isTimerActive, isKeepAwake]);

  // Sinkronisasi status aktivitas (musik / timer / Keep Awake):
  // Jika ada aktivitas atau Keep Awake aktif, matikan/pause timer auto-sleep 5.5s dan tahan mata tetap terjaga.
  useEffect(() => {
    if (isMusicPlaying || isTimerActive || isKeepAwake) {
      isRestingSleepRef.current = false;
      setIsRestingSleep(false);
      if (restingSleepTimerRef.current) {
        clearTimeout(restingSleepTimerRef.current);
        restingSleepTimerRef.current = null;
      }
    } else if (islandStateRef.current === 'idle') {
      resetRestingSleepTimer();
    }
  }, [isMusicPlaying, isTimerActive, isKeepAwake, resetRestingSleepTimer]);

  // Initial countdown on mount
  useEffect(() => {
    resetRestingSleepTimer();
  }, [resetRestingSleepTimer]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  // Fluid hug-content notch dimensions (single source of truth in ISLAND_DIMENSIONS)
  const TUCKED_WIDTH = ISLAND_DIMENSIONS.TUCKED_WIDTH;
  const TUCKED_HEIGHT = ISLAND_DIMENSIONS.TUCKED_HEIGHT;
  const EXPANDED_WIDTH = ISLAND_DIMENSIONS.EXPANDED_DROPZONE_WIDTH;
  const IDLE_WINDOW_HEIGHT = ISLAND_DIMENSIONS.IDLE_WINDOW_HEIGHT;

  // Hardware HUD, Focus Timer & To-Do State (single shared listeners)
  const hasHudAlert = hudAlert !== null;
  const hasHudAlertRef = useRef<boolean>(false);
  hasHudAlertRef.current = hasHudAlert;

  const resetAutoTuckIdleTimer = useCallback(() => {
    clearAutoTuckIdleTimer();
    if (
      !autoTuckIdleRef.current ||
      islandStateRef.current !== 'idle' ||
      isMusicPlayingRef.current ||
      isTimerActiveRef.current ||
      isPriorityAlertRef.current ||
      isKeepAwakeRef.current ||
      hasHudAlertRef.current ||
      isCursorInsideRef.current ||
      (isFullscreenActiveRef.current && fullscreenBehaviorRef.current !== 'always-visible')
    ) {
      return;
    }

    autoTuckIdleTimerRef.current = setTimeout(() => {
      autoTuckIdleTimerRef.current = null;
      if (
        autoTuckIdleRef.current &&
        islandStateRef.current === 'idle' &&
        !isMusicPlayingRef.current &&
        !isTimerActiveRef.current &&
        !isPriorityAlertRef.current &&
        !isKeepAwakeRef.current &&
        !hasHudAlertRef.current &&
        !isCursorInsideRef.current &&
        !isTransitioningRef.current &&
        !(isFullscreenActiveRef.current && fullscreenBehaviorRef.current !== 'always-visible')
      ) {
        setIsPeeking(false);
        isPeekingRef.current = false;
        isCollapsingRef.current = true;
        markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
      }
    }, AUTO_TUCK_IDLE_DELAY_MS);
  }, [clearAutoTuckIdleTimer]);
  const focusTimer = useTimerState();
  const focusTodos = useTodoState();
  const focusedTaskId = focusTimer.focusedTaskId;
  const hasFocusedTask = Boolean(
    focusedTaskId && focusTodos.todos.some((t) => !t.completed && t.id === focusedTaskId)
  );
  const hasFocusedTaskRef = useRef<boolean>(false);
  hasFocusedTaskRef.current = hasFocusedTask;
  const isFocusTimerActive = Boolean(
    focusedTaskId !== null && hasFocusedTask && (focusTimer.isActive || focusTimer.isPaused)
  );
  const isFocusTimerActiveRef = useRef<boolean>(false);
  isFocusTimerActiveRef.current = isFocusTimerActive;

  // Detached Satellite Pod & On-Demand Lyrics States
  const [podHostEl, setPodHostEl] = useState<HTMLDivElement | null>(null);
  const [isSearchPodOpen, setIsSearchPodOpen] = useState<boolean>(false);
  const [isQueuePodOpen, setIsQueuePodOpen] = useState<boolean>(false);
  const [isWifiPodOpen, setIsWifiPodOpen] = useState<boolean>(false);
  const [isBtPodOpen, setIsBtPodOpen] = useState<boolean>(false);
  const [isConnectHpPodOpen, setIsConnectHpPodOpen] = useState<boolean>(false);
  const [isLyricsOpen, setIsLyricsOpen] = useState<boolean>(false);
  const isLyricsOpenRef = useRef<boolean>(false);
  isLyricsOpenRef.current = isLyricsOpen;
  const podStateRef = useRef({
    search: false,
    queue: false,
    wifi: false,
    bt: false,
    connectHp: false,
  });

  const [measuredPillWidth, setMeasuredPillWidth] = useState<number>(240);
  const measuredPillWidthRef = useRef<number>(240);

  const handleMeasuredPillWidth = useCallback((w: number) => {
    const evenW = Math.max(88, Math.ceil(w / 2) * 2);
    measuredPillWidthRef.current = evenW;
    setMeasuredPillWidth((prev) => (prev === evenW ? prev : evenW));
  }, []);

  const isDualIdleActive = isMusicPlaying && isTimerActive;
  const hasSecondaryBubble =
    isDualIdleActive ||
    secondaryBubbleSkillId !== null ||
    mode === 'dual_bubble' ||
    (mode as string) === 'dual_idle';

  const ALARM_BANNER_WIDTH = ISLAND_DIMENSIONS.ALARM_BANNER_WIDTH;
  const idleWindowWidth = resolveEffectiveIslandLayout({
    islandState: 'idle',
    expandedMode: 'idle',
    measuredPillWidth,
    isFloatingMode,
    hasHudAlert,
    isAlarmRinging,
    isPrayerAlertActive: isPrayerAlertVisible,
    isReminderAlertActive: isReminderAlertVisible,
    isIbadahEnabled,
    isCalculatorEnabled,
    isCalendarEnabled,
    isRestingSleep,
    isLyricsOpen: false,
    isFocusHoverPeek: false,
  }).width;

  const getActiveIdleWindowWidth = useCallback(() => {
    return resolveEffectiveIslandLayout({
      islandState: 'idle',
      expandedMode: 'idle',
      measuredPillWidth: measuredPillWidthRef.current,
      isFloatingMode: isFloatingModeRef.current,
      hasHudAlert: hasHudAlertRef.current,
      isAlarmRinging: isAlarmRingingRef.current,
      isPrayerAlertActive: isPrayerAlertVisibleRef.current,
      isReminderAlertActive: isReminderAlertVisibleRef.current,
      isIbadahEnabled: isIbadahEnabledRef.current,
      isCalculatorEnabled: isCalculatorEnabledRef.current,
      isCalendarEnabled: isCalendarEnabledRef.current,
      isRestingSleep: isRestingSleepRef.current,
      isLyricsOpen: false,
      isFocusHoverPeek: false,
    }).width;
  }, []);

  const reminderSatelliteElRef = useRef<HTMLButtonElement | null>(null);
  const [reminderSatelliteWidth, setReminderSatelliteWidth] = useState<number>(148);
  const reminderSatelliteWidthRef = useRef<number>(148);
  reminderSatelliteWidthRef.current = reminderSatelliteWidth;
  const showIdleReminderSatelliteRef = useRef<boolean>(false);

  const getActiveIdleHitboxHeight = useCallback(() => IDLE_WINDOW_HEIGHT, []);

  const searchDrawerExtraHeight = useSearchDrawerExtraHeight();
  const searchDrawerExtraHeightRef = useRef<number>(searchDrawerExtraHeight);
  searchDrawerExtraHeightRef.current = searchDrawerExtraHeight;

  const buildHitboxRects = useCallback(
    (
      capsuleW: number,
      capsuleH: number,
      devVisible: boolean,
      leftPodOpen = false,
      rightPodOpen = false,
      tucked = false,
      hoverPreview = false
    ): HitRect[] => {
      const roundedW = Math.max(88, snapEvenDimension(capsuleW));
      const roundedH = Math.round(capsuleH);
      const centerOffsetX = computeCenterOffsetX(
        horizontalAlignRef.current,
        roundedW,
        leftPodOpen,
        rightPodOpen
      );
      const primaryGeom = computePrimaryIslandHitboxAndSensor({
        capsuleW: roundedW,
        capsuleH: roundedH,
        isFloatingMode: isFloatingModeRef.current,
        tucked,
        isHoverPreview:
          hoverPreview ||
          islandStateRef.current === 'idle_peek' ||
          islandStateRef.current === 'tucked_peek',
        isAlarmRinging: isAlarmRingingRef.current,
        centerOffsetX,
      });

      const POD_WIDTH = 204;
      const podOffsetX = Math.round(roundedW / 2 + 10 + POD_WIDTH / 2);
      const podBaseTopOffset = primaryGeom.isTuckedBar
        ? 0
        : isFloatingModeRef.current
        ? ISLAND_DIMENSIONS.FLOATING_TOP_OFFSET
        : 0;
      const podHitboxTop = podBaseTopOffset + 14;
      const podHitboxHeight = Math.max(140, roundedH - 14);
      const rects: HitRect[] = [primaryGeom.hitbox];

      if (leftPodOpen) {
        // Left Search/Wi-Fi Satellite Pod (204px, 10px gap left of dynamic Mode 6 box)
        // Expands downward dynamically when anchored SAVE TO PLAYLIST popover protrudes
        rects.push(
          computeSearchDrawerBounds({
            centerOffsetX,
            capsuleWidth: roundedW,
            capsuleHeight: roundedH,
            topOffset: podBaseTopOffset,
            podWidth: POD_WIDTH,
            extraPopoverHeight: searchDrawerExtraHeightRef.current,
          })
        );
      }

      if (rightPodOpen) {
        // Right Queue/BT Satellite Pod (204px, 10px gap right of dynamic Mode 6 box)
        rects.push({
          center_offset_x: centerOffsetX + podOffsetX,
          top_offset: podHitboxTop,
          width: POD_WIDTH,
          height: podHitboxHeight,
        });
      }

      if (showIdleReminderSatelliteRef.current && !tucked && roundedH < 120) {
        rects.push(
          computeReminderSatelliteBounds({
            centerOffsetX,
            capsuleWidth: roundedW,
            satelliteWidth: reminderSatelliteWidthRef.current,
            isFloatingMode: isFloatingModeRef.current,
          })
        );
      }

      if (import.meta.env.DEV && devVisible) {
        rects.push({
          center_offset_x: 0,
          top_offset: 200,
          width: 760,
          height: 48,
        });
      }

      return rects;
    },
    []
  );

  const idleWindowWidthRef = useRef<number>(idleWindowWidth);
  useEffect(() => {
    idleWindowWidthRef.current = idleWindowWidth;
  }, [idleWindowWidth]);

  // Window Hitbox Coordinator Refs to avoid redundant Tauri IPC invocations
  const currentWinSizeRef = useRef<{ width: number; height: number; key: string }>({
    width: 0,
    height: 0,
    key: '',
  });
  const lastPrimaryRectRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const isCollapsingRef = useRef<boolean>(false);

  const syncCompositeHitboxes = useCallback((rects: HitRect[]) => {
    const primary = rects[0] || { width: 88, height: 40 };
    const roundedW = Math.max(88, Math.ceil(primary.width / 2) * 2);
    const roundedH = Math.round(primary.height);
    const key = rects
      .map(
        (r) =>
          `${Math.round(r.center_offset_x)}:${Math.round(r.top_offset)}:${Math.round(r.width)}x${Math.round(r.height)}`
      )
      .join('|');

    if (currentWinSizeRef.current.key === key) {
      return;
    }

    const prevPrimary = lastPrimaryRectRef.current;
    const isShrinkResize =
      prevPrimary.width > 0 &&
      (roundedW < prevPrimary.width || roundedH < prevPrimary.height);

    currentWinSizeRef.current = { width: roundedW, height: roundedH, key };
    lastPrimaryRectRef.current = { width: roundedW, height: roundedH };

    if (isShrinkResize) {
      lastCollapseResizeTimeRef.current = Date.now();
      markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
    }

    recordCanvasResizeCall();
    updateIslandHitboxes(rects);
  }, [markCollapseTransitionCooldown]);

  const applyWindowSize = useCallback(
    (
      w: number,
      h: number,
      devVisible = false,
      leftPod = false,
      rightPod = false,
      tucked = false,
      hoverPreview = false
    ) => {
      syncCompositeHitboxes(
        buildHitboxRects(w, h, devVisible, leftPod, rightPod, tucked, hoverPreview)
      );
    },
    [syncCompositeHitboxes, buildHitboxRects]
  );

  const applyWindowSizeRef = useRef(applyWindowSize);
  applyWindowSizeRef.current = applyWindowSize;

  // Register stress testing hook
  useEffect(() => {
    registerIslandTransitionHook((targetState, targetMode, secondaryBubble) => {
      const idleW = getActiveIdleWindowWidth();
      const isExpandedTarget = targetState === 'expanded' || targetState === 'idle_peek';
      const targetExpandedDims = isExpandedTarget
        ? getIslandDimensions(targetState, targetMode || effectiveExpandedMode)
        : null;
      const targetCapsuleW =
        targetState === 'tucked'
          ? TUCKED_WIDTH
          : targetExpandedDims
          ? targetExpandedDims.width
          : idleW;
      const targetCapsuleH = targetExpandedDims
        ? targetExpandedDims.height
        : targetState === 'tucked'
        ? TUCKED_HEIGHT
        : IDLE_WINDOW_HEIGHT;
      const rects = buildHitboxRects(
        targetCapsuleW,
        targetCapsuleH,
        showDevTrigger,
        false,
        false,
        targetState === 'tucked',
        targetState === 'idle_peek' || targetState === 'tucked_peek'
      );

      // Rule: if growing, expand hitbox IMMEDIATELY at t = 0 before visual state updates
      if (
        rects[0].width > (currentWinSizeRef.current.width || 0) ||
        rects[0].height > (currentWinSizeRef.current.height || 0)
      ) {
        syncCompositeHitboxes(rects);
      }

      if (targetState !== 'idle') {
        setIsLandingComplete(false);
      } else if (
        targetState === 'idle' &&
        !isCollapsingRef.current &&
        prevIslandStateRef.current === 'idle'
      ) {
        setIsLandingComplete(true);
      } else {
        setIsLandingComplete(false);
      }

      if (secondaryBubble !== undefined) {
        useSkillStore.setState({ secondaryBubbleSkillId: secondaryBubble });
      }
      if (targetMode !== undefined) {
        onChangeMode(targetMode);
      }
      setIslandState(targetState);
    });
    return () => {
      unregisterIslandTransitionHook();
    };
  }, [onChangeMode, showDevTrigger, getActiveIdleWindowWidth, buildHitboxRects, syncCompositeHitboxes]);

  // Helper to map active skill to its default expanded mode
  const getEffectiveExpandedMode = (skillId: string | null): IslandMode => {
    if (skillId === 'core.drop_zone') return 'drop_zone';
    if (skillId === 'core.timer' || skillId === 'core.todo') return 'expanded_timer';
    if (!isMusicPlayingRef.current && isTimerActiveRef.current) return 'expanded_timer';
    return 'expanded_music';
  };

  // Determine effective mode to render when expanded or previewing
  const effectiveExpandedMode: IslandMode =
    mode === 'drop_zone'
      ? 'drop_zone'
      : mode.startsWith('expanded_')
      ? mode
      : getEffectiveExpandedMode(activeSkillId);

  const isFocusHoverPeek =
    islandState !== 'expanded' &&
    islandState === 'idle_peek' &&
    isFocusTimerActive;
  const isFocusHoverPeekRef = useRef<boolean>(false);
  isFocusHoverPeekRef.current = isFocusHoverPeek;

  const mediaPlaybackSource = mediaState?.playbackSource || 'companion';
  const mediaSongTitle = mediaState?.song?.title?.trim() || '';
  const hasActiveExternalMedia = Boolean(
    mediaPlaybackSource !== 'native' &&
      mediaSongTitle !== '' &&
      mediaSongTitle !== 'No Media Playing' &&
      mediaSongTitle !== 'No Media Active'
  );
  const isExternalDesktopSpotify = Boolean(
    mediaState?.song?.is_spotify ||
      mediaState?.song?.source_app?.toLowerCase().includes('spotify')
  );
  const isExternalBrowserMedia = Boolean(mediaState?.is_browser || mediaState?.song?.is_browser);
  // Blokir pod Search/Queue di CasaIsland seketika saat media GSMTC eksternal aktif tanpa sesi Spotify Premium Web API
  const isMusicPodsBlockedAtHost = Boolean(
    hasActiveExternalMedia &&
      (!isSpotifyUserConnected() ||
        isSpotifyFreeRestricted ||
        (!isExternalDesktopSpotify && !isExternalBrowserMedia))
  );

  const effectiveLeftPodOpen =
    (islandState === 'expanded' || (islandState === 'idle_peek' && !isFocusHoverPeek)) &&
    ((effectiveExpandedMode === 'expanded_music' && !isMusicPodsBlockedAtHost && isSearchPodOpen) ||
      (effectiveExpandedMode === 'expanded_control' && isWifiPodOpen));
  const effectiveRightPodOpen =
    (islandState === 'expanded' || (islandState === 'idle_peek' && !isFocusHoverPeek)) &&
    ((effectiveExpandedMode === 'expanded_music' && !isMusicPodsBlockedAtHost && isQueuePodOpen) ||
      (effectiveExpandedMode === 'expanded_control' && isBtPodOpen) ||
      (effectiveExpandedMode === 'drop_zone' && isConnectHpPodOpen));

  useEffect(() => {
    useConnectHpStore.getState().initListeners();
  }, []);

  useEffect(() => {
    podStateRef.current = {
      search: effectiveExpandedMode === 'expanded_music' && effectiveLeftPodOpen,
      queue: effectiveExpandedMode === 'expanded_music' && effectiveRightPodOpen,
      wifi: effectiveExpandedMode === 'expanded_control' && effectiveLeftPodOpen,
      bt: effectiveExpandedMode === 'expanded_control' && effectiveRightPodOpen,
      connectHp: effectiveExpandedMode === 'drop_zone' && effectiveRightPodOpen,
    };
  }, [effectiveExpandedMode, effectiveLeftPodOpen, effectiveRightPodOpen]);

  // Close satellite pods when leaving their respective Mode 6 module or when GSMTC/Spotify Free restricts pods
  // (NOTE: Connect HP local server keeps running on collapse/tab switch unless explicitly stopped)
  useEffect(() => {
    if (
      effectiveExpandedMode !== 'expanded_music' ||
      (effectiveExpandedMode === 'expanded_music' && isMusicPodsBlockedAtHost)
    ) {
      setIsSearchPodOpen(false);
      setIsQueuePodOpen(false);
    }
    if (effectiveExpandedMode !== 'expanded_control') {
      setIsWifiPodOpen(false);
      setIsBtPodOpen(false);
    }
    if (effectiveExpandedMode !== 'drop_zone') {
      setIsConnectHpPodOpen(false);
    }
  }, [effectiveExpandedMode, isMusicPodsBlockedAtHost]);

  // Synchronize state with external mode changes from props (DevTriggerBar, Escape, etc.)
  const prevModeRef = useRef<IslandMode>(mode);
  useEffect(() => {
    if (prevModeRef.current !== mode) {
      if (mode === 'drop_zone' || mode.startsWith('expanded_')) {
        setIslandState('expanded');
      } else if (
        (mode === 'idle' || mode === 'dual_bubble') &&
        islandStateRef.current === 'expanded'
      ) {
        setIslandState('idle');
      }
      prevModeRef.current = mode;
    }
  }, [mode]);

  // Dimensions Calculator: strict single-source-of-truth across Modes 1-7
  const getIslandDimensions = (
    state: IslandState,
    targetMode: IslandMode = effectiveExpandedMode,
    lyricsOpen: boolean = isLyricsOpenRef.current,
    focusPeek: boolean = isFocusHoverPeekRef.current,
    hudWake: boolean = hasHudAlertRef.current
  ) => {
    const layout = resolveEffectiveIslandLayout({
      islandState: state,
      expandedMode: targetMode,
      measuredPillWidth: measuredPillWidthRef.current,
      isFloatingMode: isFloatingModeRef.current,
      hasHudAlert: hudWake,
      isAlarmRinging: isAlarmRingingRef.current,
      isPrayerAlertActive: isPrayerAlertVisibleRef.current,
      isReminderAlertActive: isReminderAlertVisibleRef.current,
      isIbadahEnabled: isIbadahEnabledRef.current,
      isCalculatorEnabled: isCalculatorEnabledRef.current,
      isCalendarEnabled: isCalendarEnabledRef.current,
      isRestingSleep: isRestingSleepRef.current,
      isLyricsOpen: lyricsOpen,
      isFocusHoverPeek: focusPeek,
    });
    return {
      width: layout.width,
      height: layout.height,
      cornerRadius: layout.bottomCornerRadius,
      isTucked: layout.isTucked,
    };
  };

  const effectiveLayout = resolveEffectiveIslandLayout({
    islandState,
    expandedMode: effectiveExpandedMode,
    measuredPillWidth: Math.max(88, snapEvenDimension(measuredPillWidth)),
    isFloatingMode,
    hasHudAlert,
    isAlarmRinging,
    isPrayerAlertActive: isPrayerAlertVisible,
    isReminderAlertActive: isReminderAlertVisible,
    isIbadahEnabled,
    isCalculatorEnabled,
    isCalendarEnabled,
    isRestingSleep,
    isLyricsOpen,
    isFocusHoverPeek,
  });
  const {
    width,
    height,
    topPx: activeTopPx,
    isTucked: isPureTucked,
    isExpandedView,
    bottomCornerRadius,
    topCornerRadius,
  } = effectiveLayout;

  const showIdleReminderSatellite =
    !isExpandedView &&
    !isPureTucked &&
    !isPriorityAlert &&
    !hasHudAlert &&
    visibleUpcomingReminderBadge !== null;
  showIdleReminderSatelliteRef.current = showIdleReminderSatellite;

  useEffect(() => {
    if (!showIdleReminderSatellite) return;
    const satEl = reminderSatelliteElRef.current;
    if (!satEl) return;
    const syncWidth = () => {
      const measured = Math.min(
        ISLAND_DIMENSIONS.REMINDER_SATELLITE_MAX_WIDTH,
        Math.max(72, Math.ceil(satEl.getBoundingClientRect().width / 2) * 2)
      );
      if (measured !== reminderSatelliteWidthRef.current) {
        setReminderSatelliteWidth(measured);
      }
    };
    syncWidth();
    const ro = new ResizeObserver(syncWidth);
    ro.observe(satEl);
    return () => ro.disconnect();
  }, [
    showIdleReminderSatellite,
    visibleUpcomingReminderBadge?.remainingMinutes,
    visibleUpcomingReminderBadge?.title,
  ]);

  const containerBoxRef = useRef<HTMLDivElement>(null);
  const [measuredPillBox, setMeasuredPillBox] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const isIdleTimerPerimeterVisible =
    islandState === 'idle' &&
    !isExpandedView &&
    !hasHudAlert &&
    !isPriorityAlert &&
    isTimerActive &&
    (idleTimerState?.totalSeconds ?? 0) > 0;
  const isPrayerPerimeterVisible =
    islandState === 'idle' &&
    !isExpandedView &&
    !hasHudAlert &&
    isPrayerAlertVisible;
  const needsPerimeterMeasurement =
    isIdleTimerPerimeterVisible || isPrayerPerimeterVisible;
  const isIdleTimerPaused = Boolean(idleTimerState?.isPaused);
  const idleTimerRemainingPct =
    idleTimerState && idleTimerState.totalSeconds > 0
      ? Math.min(
          100,
          Math.max(0, (idleTimerState.remainingSeconds / idleTimerState.totalSeconds) * 100)
        )
      : 0;

  useEffect(() => {
    const el = containerBoxRef.current;
    if (!el || !needsPerimeterMeasurement) return;

    const syncBox = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        setMeasuredPillBox({
          width: Math.round(rect.width * 10) / 10,
          height: Math.round(rect.height * 10) / 10,
        });
      }
    };

    syncBox();
    const observer = new ResizeObserver(() => {
      syncBox();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [needsPerimeterMeasurement, width, height, isFloatingMode]);

  // Dynamic Hover Sensor Dimensions tightly hugging capsule & bridging Floating top corridor
  const getSensorDimensions = () => {
    const primaryGeom = computePrimaryIslandHitboxAndSensor({
      capsuleW: width,
      capsuleH: height,
      isFloatingMode,
      tucked: isPureTucked,
      isHoverPreview: isPeeking || islandState === 'idle_peek' || islandState === 'tucked_peek',
      isAlarmRinging,
      centerOffsetX: 0,
    });
    return primaryGeom.sensor;
  };

  const { width: sensorWidth, height: sensorHeight } = getSensorDimensions();

  // Initial Window Setup on Mount
  useEffect(() => {
    // Native Win32 window locked at 1100x340 (fits 640px Mode 6 + Detached Left/Right 204px Floating Satellite Pods)
    void adjustWindowSize(1100, 340).then(() => {
      void alignWindowTop(horizontalAlignRef.current);
    });
    applyWindowSize(idleWindowWidth, getActiveIdleHitboxHeight(), showDevTrigger, false, false);
  }, []);

  // Align native Win32 1100px window horizontally when Left/Center/Right setting changes
  useEffect(() => {
    void alignWindowTop(horizontalAlign);
  }, [horizontalAlign]);

  // Re-sync hitboxes immediately when Floating Mode / Horizontal Alignment changes
  useLayoutEffect(() => {
    if (isCollapsingRef.current) return;
    if (islandState === 'tucked' && !hasHudAlert) {
      applyWindowSize(TUCKED_WIDTH, TUCKED_HEIGHT, showDevTrigger, false, false, true);
      return;
    }
    if (islandState === 'idle' || islandState === 'tucked_peek') {
      applyWindowSize(
        getActiveIdleWindowWidth(),
        getActiveIdleHitboxHeight(),
        showDevTrigger,
        false,
        false,
        false,
        islandState === 'tucked_peek'
      );
      return;
    }
    if (islandState === 'expanded' || islandState === 'idle_peek') {
      applyWindowSize(
        width,
        height,
        showDevTrigger,
        effectiveLeftPodOpen,
        effectiveRightPodOpen,
        false,
        islandState === 'idle_peek'
      );
    }
  }, [
    placementMode,
    horizontalAlign,
    islandState,
    hasHudAlert,
    width,
    height,
    showDevTrigger,
    effectiveLeftPodOpen,
    effectiveRightPodOpen,
    searchDrawerExtraHeight,
    showIdleReminderSatellite,
    reminderSatelliteWidth,
    applyWindowSize,
    getActiveIdleWindowWidth,
    getActiveIdleHitboxHeight,
  ]);

  // Sync Prayer & Calendar Schedulers with runtime fullscreen & same-window settings changes
  useEffect(() => {
    setPrayerRuntimeFullscreenState(isFullscreenActive);
    setCalendarRuntimeFullscreenState(isFullscreenActive, fullscreenBehavior);
  }, [isFullscreenActive, fullscreenBehavior]);

  useEffect(() => {
    notifyPrayerSettingsChanged();
    if (!settings.ibadah.enabled && modeRef.current === 'expanded_ibadah') {
      onChangeModeRef.current('expanded_music');
    }
  }, [settings.ibadah]);

  useEffect(() => {
    if (!settings.calculatorEnabled && modeRef.current === 'expanded_calculator') {
      onChangeModeRef.current('expanded_music');
    }
  }, [settings.calculatorEnabled]);

  useEffect(() => {
    notifyCalendarSettingsChanged();
    if (!settings.calendarEnabled && modeRef.current === 'expanded_calendar') {
      onChangeModeRef.current('expanded_control');
    }
  }, [settings.calendarEnabled, fullscreenBehavior]);

  // Auto-Tuck Quiet Idle Scheduler (10s after quiet idle if setting enabled)
  useEffect(() => {
    resetAutoTuckIdleTimer();
  }, [
    autoTuckIdle,
    islandState,
    isMusicPlaying,
    isTimerActive,
    isAlarmRinging,
    isPrayerAlertVisible,
    isReminderAlertVisible,
    isKeepAwake,
    hasHudAlert,
    isFullscreenActive,
    fullscreenBehavior,
    resetAutoTuckIdleTimer,
  ]);

  // Fullscreen App Behavior Enforcement (smart-tuck / total-hide / always-visible)
  useEffect(() => {
    const wasFullscreen = prevIsFullscreenActiveRef.current;
    prevIsFullscreenActiveRef.current = isFullscreenActive;

    const clearHoverAndPeekTimers = () => {
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
        hoverLeaveTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }
      clearAutoTuckIdleTimer();
    };

    if (fullscreenBehavior === 'total-hide' && isFullscreenActive) {
      clearHoverAndPeekTimers();
      if (restingSleepTimerRef.current) {
        clearTimeout(restingSleepTimerRef.current);
        restingSleepTimerRef.current = null;
      }
      wasTuckedByFullscreenRef.current = false;
      if (!wasHiddenByFullscreenRef.current) {
        wasHiddenByFullscreenRef.current = true;
        void setWindowVisibility(false);
      }
      return;
    }

    if (wasHiddenByFullscreenRef.current) {
      wasHiddenByFullscreenRef.current = false;
      void setWindowVisibility(true);
    }

    if (fullscreenBehavior === 'smart-tuck' && isFullscreenActive) {
      clearHoverAndPeekTimers();

      if (modeRef.current.startsWith('expanded_') || modeRef.current === 'drop_zone') {
        onChangeModeRef.current(hasSecondaryBubble ? 'dual_bubble' : 'idle');
      }

      if (!hasHudAlert && !isPriorityAlert && islandStateRef.current !== 'tucked') {
        wasTuckedByFullscreenRef.current = true;
        setIsPeeking(false);
        isPeekingRef.current = false;
        setIsSearchPodOpen(false);
        setIsQueuePodOpen(false);
        setIsWifiPodOpen(false);
        setIsBtPodOpen(false);
        isCollapsingRef.current = true;
        markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
      }
      return;
    }

    const exitedFullscreen = wasFullscreen && !isFullscreenActive;
    if (exitedFullscreen) {
      // Prevent synthetic Windows/WebView mousemove during fullscreen exit from auto-expanding Mode 6
      fullscreenExitCooldownUntilRef.current =
        Date.now() + ISLAND_DIMENSIONS.POST_FULLSCREEN_HOVER_COOLDOWN_MS;
    }

    if (wasTuckedByFullscreenRef.current || (exitedFullscreen && fullscreenBehavior === 'smart-tuck')) {
      wasTuckedByFullscreenRef.current = false;
      clearHoverAndPeekTimers();
      hoverSuppressedRef.current = false;
      setIsPeeking(false);
      isPeekingRef.current = false;
      setIsSearchPodOpen(false);
      setIsQueuePodOpen(false);
      setIsWifiPodOpen(false);
      setIsBtPodOpen(false);
      isCollapsingRef.current = false;
      unlockTransition();
      isRestingSleepRef.current = false;
      setIsRestingSleep(false);

      if (modeRef.current.startsWith('expanded_') || modeRef.current === 'drop_zone') {
        onChangeModeRef.current(hasSecondaryBubble ? 'dual_bubble' : 'idle');
      }

      islandStateRef.current = 'idle';
      setIslandState('idle');
      setFullscreenExitTick((t) => t + 1);

      const syncIdleHitboxes = () => {
        if (islandStateRef.current !== 'idle') return;
        const targetIdleW = Math.max(
          getActiveIdleWindowWidth(),
          ISLAND_DIMENSIONS.IDLE_MIN_AWAKE_WIDTH
        );
        applyWindowSize(
          targetIdleW,
          getActiveIdleHitboxHeight(),
          showDevTriggerRef.current,
          false,
          false,
          false
        );
      };

      syncIdleHitboxes();
      requestAnimationFrame(syncIdleHitboxes);
      resetRestingSleepTimer();
    }
  }, [
    fullscreenBehavior,
    isFullscreenActive,
    hasHudAlert,
    isPriorityAlert,
    hasSecondaryBubble,
    clearAutoTuckIdleTimer,
    applyWindowSize,
    getActiveIdleWindowWidth,
    getActiveIdleHitboxHeight,
    resetRestingSleepTimer,
  ]);

  const prevIslandStateRef = useRef<IslandState>('idle');
  const prevCapsuleSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  // Strict Lifecycle Sync for composite multi-rect Win32 click-through hitboxes (runs before paint)
  useLayoutEffect(() => {
    const prevState = prevIslandStateRef.current;
    const wasExpanded =
      prevState === 'expanded' || prevState === 'idle_peek';

    try {
      void setIslandPinned(islandState === 'expanded');

      if (islandState !== 'idle' || isExpandedView) {
        setIsLandingComplete(false);
      }

      if (islandState === 'tucked') {
        if (hasHudAlert) {
          isCollapsingRef.current = false;
          applyWindowSize(
            Math.max(getActiveIdleWindowWidth(), 244),
            IDLE_WINDOW_HEIGHT,
            showDevTrigger,
            false,
            false
          );
        } else {
          isCollapsingRef.current = true;
        }
        return;
      }

      if (islandState === 'tucked_peek') {
        isCollapsingRef.current = false;
        applyWindowSize(
          getActiveIdleWindowWidth(),
          IDLE_WINDOW_HEIGHT,
          showDevTrigger,
          false,
          false,
          false,
          true
        );
        return;
      }

      if (islandState === 'idle_peek' || islandState === 'expanded') {
        isCollapsingRef.current = false;
        const { width: targetW, height: targetH } = getIslandDimensions(
          islandState,
          effectiveExpandedMode,
          isLyricsOpen,
          isFocusHoverPeek,
          hasHudAlert
        );
        applyWindowSize(
          targetW,
          targetH,
          showDevTrigger,
          effectiveLeftPodOpen,
          effectiveRightPodOpen,
          false,
          islandState === 'idle_peek'
        );
        return;
      }

      if (islandState === 'idle') {
        const targetW = getActiveIdleWindowWidth();
        const targetH = getActiveIdleHitboxHeight();
        const isFromMinimize = prevState === 'tucked' || prevState === 'tucked_peek';
        const shrankIdleCapsule =
          prevState === 'idle' &&
          prevCapsuleSizeRef.current.width > 0 &&
          targetW < prevCapsuleSizeRef.current.width;

        if (!isFromMinimize && (wasExpanded || shrankIdleCapsule)) {
          // Wait for Framer Motion collapse animation to finish in onAnimationComplete before shrinking hitbox
          isCollapsingRef.current = true;
          return;
        }

        isCollapsingRef.current = false;
        applyWindowSize(targetW, targetH, showDevTrigger, false, false);
      }
    } finally {
      prevIslandStateRef.current = islandState;
      prevCapsuleSizeRef.current = { width, height };
    }
  }, [
    islandState,
    effectiveExpandedMode,
    isLyricsOpen,
    isFocusHoverPeek,
    hasHudAlert,
    isAlarmRinging,
    isPrayerAlertVisible,
    isReminderAlertVisible,
    showIdleReminderSatellite,
    reminderSatelliteWidth,
    isIbadahEnabled,
    isCalculatorEnabled,
    isCalendarEnabled,
    showDevTrigger,
    measuredPillWidth,
    effectiveLeftPodOpen,
    effectiveRightPodOpen,
    getActiveIdleWindowWidth,
    getActiveIdleHitboxHeight,
    applyWindowSize,
  ]);

  // Dynamic Dual-Bubble Synchronization when Idle
  useEffect(() => {
    if (islandState === 'idle') {
      if (mode === 'idle' && secondaryBubbleSkillId !== null) {
        onChangeMode('dual_bubble');
      } else if (mode === 'dual_bubble' && secondaryBubbleSkillId === null) {
        onChangeMode('idle');
      }
    }
  }, [mode, secondaryBubbleSkillId, onChangeMode, islandState]);

  // Unified collapse handler
  const collapseToIdle = useCallback(() => {
    if (isTransitioningRef.current) return;
    if (tuckedEnterTimerRef.current) {
      clearTimeout(tuckedEnterTimerRef.current);
      tuckedEnterTimerRef.current = null;
    }
    if (intensiveHoverTimerRef.current) {
      clearTimeout(intensiveHoverTimerRef.current);
      intensiveHoverTimerRef.current = null;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    clearAutoTuckIdleTimer();
    clearHoverSuppressionReleaseTimer();
    clearPostTransitionRecheckTimer();
    setIsPeeking(false);
    isPeekingRef.current = false;
    setIsSearchPodOpen(false);
    setIsQueuePodOpen(false);
    hoverSuppressedRef.current = true;
    markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
    lockTransition(280);
    isCollapsingRef.current = true;
    setIsLandingComplete(false);
    islandStateRef.current = 'idle';
    setIslandState('idle');
    setIsRestingSleep(false);
    playChimeCue('tap');
    onChangeMode(hasSecondaryBubble ? 'dual_bubble' : 'idle');
    resetRestingSleepTimer();
    resetAutoTuckIdleTimer();
  }, [
    hasSecondaryBubble,
    onChangeMode,
    resetRestingSleepTimer,
    clearAutoTuckIdleTimer,
    resetAutoTuckIdleTimer,
    clearHoverSuppressionReleaseTimer,
    clearPostTransitionRecheckTimer,
    markCollapseTransitionCooldown,
  ]);

  // Helper to lock preview into permanent expanded state
  const handleLockExpanded = useCallback(
    (forcedMode?: IslandMode) => {
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
        hoverLeaveTimerRef.current = null;
      }
      clearAutoTuckIdleTimer();
      hoverSuppressedRef.current = false;
      setIsPeeking(false);
      isPeekingRef.current = false;
      if (!forcedMode && islandStateRef.current === 'expanded') {
        return;
      }
      if (islandStateRef.current === 'tucked' || islandStateRef.current === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        const animateFromTucked = islandStateRef.current === 'tucked';
        lockTransition(animateFromTucked ? 240 : 120, true);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        setIsRestingSleep(false);
        resetRestingSleepTimer();
        playChimeCue('tap');
        return;
      }
      const wasFocusPeek = isFocusHoverPeekRef.current;
      setIsLandingComplete(false);
      const preservedExpandedMode =
        modeRef.current.startsWith('expanded_') || modeRef.current === 'drop_zone'
          ? modeRef.current
          : null;
      const targetMode =
        forcedMode ??
        (wasFocusPeek ? 'expanded_timer' : null) ??
        preservedExpandedMode ??
        getEffectiveExpandedMode(activeSkillId);
      if (targetMode === 'expanded_timer' || targetMode === 'expanded_todo') {
        useSkillStore.getState().setActiveSkillId('core.timer');
      }
      const { width: targetW, height: targetH } = getIslandDimensions(
        'expanded',
        targetMode,
        isLyricsOpenRef.current,
        false,
        hasHudAlertRef.current
      );
      const nextLeftPod =
        (targetMode === 'expanded_music' && podStateRef.current.search) ||
        (targetMode === 'expanded_control' && podStateRef.current.wifi);
      const nextRightPod =
        (targetMode === 'expanded_music' && podStateRef.current.queue) ||
        (targetMode === 'expanded_control' && podStateRef.current.bt);
      applyWindowSize(targetW, targetH, showDevTrigger, nextLeftPod, nextRightPod);

      islandStateRef.current = 'expanded';
      setIslandState('expanded');
      onChangeMode(targetMode);
      playChimeCue('tap');
    },
    [activeSkillId, onChangeMode, resetRestingSleepTimer, showDevTrigger, applyWindowSize]
  );

  // Helper to expand card permanently: coordinates state cleanly without synchronous frame-0 resize jolt
  const expandToSkill = useCallback(
    (targetSkillId: string | null) => {
      if (isTransitioningRef.current) return;
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
        hoverLeaveTimerRef.current = null;
      }
      setIsPeeking(false);
      isPeekingRef.current = false;
      if (islandStateRef.current === 'tucked' || islandStateRef.current === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        const animateFromTucked = islandStateRef.current === 'tucked';
        lockTransition(animateFromTucked ? 240 : 120, true);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        setIsRestingSleep(false);
        resetRestingSleepTimer();
        playChimeCue('tap');
        return;
      }
      lockTransition(500);
      setIsLandingComplete(false);
      playChimeCue('tap');
      const targetMode = getEffectiveExpandedMode(targetSkillId);
      if (targetMode !== 'expanded_music') {
        setIsSearchPodOpen(false);
        setIsQueuePodOpen(false);
      }
      if (targetMode !== 'expanded_control') {
        setIsWifiPodOpen(false);
        setIsBtPodOpen(false);
      }
      const { width: targetW, height: targetH } = getIslandDimensions('expanded', targetMode);
      applyWindowSize(targetW, targetH, showDevTrigger, false, false);

      requestAnimationFrame(() => {
        islandStateRef.current = 'expanded';
        setIslandState('expanded');
        onChangeMode(targetMode);
      });
    },
    [onChangeMode, resetRestingSleepTimer, showDevTrigger, applyWindowSize]
  );

  const handleExpandSkill = useCallback(
    (skillId: string) => {
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      setIsPeeking(false);
      isPeekingRef.current = false;
      if (islandStateRef.current === 'tucked' || islandStateRef.current === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        const animateFromTucked = islandStateRef.current === 'tucked';
        lockTransition(animateFromTucked ? 240 : 120, true);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        setIsRestingSleep(false);
        resetRestingSleepTimer();
        playChimeCue('tap');
        return;
      }
      expandToSkill(skillId);
    },
    [expandToSkill, resetRestingSleepTimer]
  );

  const collapseToIdleRef = useRef<() => void>(() => {});

  const handleHeaderClick = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      // Mode 6 tetap persistent: klik area header hanya mengunci peek preview jika masih peeking
      if (isPeeking || isPeekingRef.current || islandState !== 'expanded') {
        handleLockExpanded();
      }
    },
    [isPeeking, islandState, handleLockExpanded]
  );

  const handleSelectMode = useCallback(
    (newMode: IslandMode) => {
      if (isTransitioningRef.current) return;
      lockTransition(250);
      playChimeCue('tap');
      if (islandStateRef.current === 'idle_peek') {
        handleLockExpanded();
      }
      if (newMode !== 'expanded_music') {
        setIsSearchPodOpen(false);
        setIsQueuePodOpen(false);
      }
      if (newMode !== 'expanded_control') {
        setIsWifiPodOpen(false);
        setIsBtPodOpen(false);
      }
      if (newMode === 'expanded_timer') {
        useSkillStore.getState().setActiveSkillId('core.timer');
      } else if (newMode === 'expanded_todo') {
        useSkillStore.getState().setActiveSkillId('core.todo');
      } else if (newMode === 'expanded_music') {
        useSkillStore.getState().setActiveSkillId('core.media');
      }
      const { width: targetW, height: targetH } = getIslandDimensions(
        'expanded',
        newMode,
        isLyricsOpenRef.current,
        false,
        hasHudAlertRef.current
      );
      const nextLeftPod =
        (newMode === 'expanded_music' && podStateRef.current.search) ||
        (newMode === 'expanded_control' && podStateRef.current.wifi);
      const nextRightPod =
        (newMode === 'expanded_music' && podStateRef.current.queue) ||
        (newMode === 'expanded_control' && podStateRef.current.bt);
      applyWindowSize(targetW, targetH, showDevTrigger, nextLeftPod, nextRightPod);
      onChangeMode(newMode);
    },
    [showDevTrigger, onChangeMode, handleLockExpanded, applyWindowSize]
  );

  // Shared hover-peek state machine for both mouseEnter and mouseMove
  const scheduleHoverPeek = useCallback(
    (allowIdleHoverRestart: boolean) => {
      // Collapse cooldown hanya memblokir selama fase penyusutan/antiflicker, bukan mengunci ekspansi permanen
      if (isCollapseCooldownActive()) {
        if (!hoverSuppressedRef.current) {
          schedulePostTransitionRecheck();
        }
        return;
      }

      if (isPriorityAlert || isPriorityAlertRef.current) {
        return;
      }

      if (
        hoverDelayMsRef.current < 0 ||
        (isFullscreenActiveRef.current && fullscreenBehaviorRef.current === 'smart-tuck')
      ) {
        return;
      }

      const peekDelayMs = Math.max(0, hoverDelayMsRef.current);
      const currentState = islandStateRef.current;

      if (currentState === 'tucked') {
        if (allowIdleHoverRestart || (!tuckedEnterTimerRef.current && !isCollapsingRef.current)) {
          if (!tuckedEnterTimerRef.current) {
            tuckedEnterTimerRef.current = setTimeout(() => {
              if (
                islandStateRef.current === 'tucked' &&
                !hoverSuppressedRef.current &&
                !isCollapseCooldownActive()
              ) {
                isCollapsingRef.current = false;
                setIsPeeking(true);
                isPeekingRef.current = true;
                isRestingSleepRef.current = false;
                setIsRestingSleep(false);
                islandStateRef.current = 'tucked_peek';
                setIslandState('tucked_peek');
                playChimeCue('tap');
              }
              tuckedEnterTimerRef.current = null;
            }, peekDelayMs);
          }
        }
        return;
      }

      if (currentState === 'tucked_peek') {
        if (allowIdleHoverRestart) {
          setIsPeeking(true);
          isPeekingRef.current = true;
        }
        return;
      }

      if (currentState === 'idle') {
        if (isRestingSleep || isRestingSleepRef.current) {
          return;
        }

        if (
          !isAlarmRinging &&
          !isPriorityAlertRef.current &&
          !intensiveHoverTimerRef.current &&
          !isCollapsingRef.current
        ) {
          intensiveHoverTimerRef.current = setTimeout(() => {
            if (
              !isCollapseCooldownActive() &&
              islandStateRef.current === 'idle' &&
              !isPriorityAlertRef.current &&
              !hoverSuppressedRef.current &&
              !isRestingSleepRef.current
            ) {
              const focusPeekNext = isFocusTimerActiveRef.current;
              const targetMode = focusPeekNext
                ? 'expanded_timer'
                : getEffectiveExpandedMode(activeSkillId);
              const { width: targetW, height: targetH } = getIslandDimensions(
                'idle_peek',
                targetMode,
                isLyricsOpenRef.current,
                focusPeekNext,
                hasHudAlertRef.current
              );
              // Sinkronkan hitbox besar segera SEBELUM visual mekar agar kursor tidak pernah jatuh ke WS_EX_TRANSPARENT
              applyWindowSize(targetW, targetH, showDevTrigger, false, false, false, true);

              requestAnimationFrame(() => {
                if (
                  !isCollapseCooldownActive() &&
                  islandStateRef.current === 'idle' &&
                  !isPriorityAlertRef.current &&
                  !hoverSuppressedRef.current &&
                  !isRestingSleepRef.current
                ) {
                  setIsPeeking(true);
                  isPeekingRef.current = true;
                  setIsLandingComplete(false);
                  islandStateRef.current = 'idle_peek';
                  setIslandState('idle_peek');
                }
              });
            }
            intensiveHoverTimerRef.current = null;
          }, peekDelayMs);
        }
      }
    },
    [
      isAlarmRinging,
      isRestingSleep,
      activeSkillId,
      showDevTrigger,
      applyWindowSize,
      isCollapseCooldownActive,
      schedulePostTransitionRecheck,
    ]
  );

  useEffect(() => {
    scheduleHoverPeekRef.current = scheduleHoverPeek;
  }, [scheduleHoverPeek]);

  // Hover Interaction State Machine: Hover-to-Peek + Anti-Flicker Collapse Guard (tanpa dead-hover pasca-minimize)
  const handleMouseEnter = useCallback((e?: React.MouseEvent) => {
    if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    }
    isCursorInsideRef.current = true;

    if (hoverSuppressedRef.current) {
      return;
    }
    if (isCollapseCooldownActive() || isTransitioningRef.current) {
      schedulePostTransitionRecheck();
      return;
    }
    clearHoverSuppressionReleaseTimer();
    clearPostTransitionRecheckTimer();

    setSmartIgnoreCursorEvents(false);
    if (tuckedEnterTimerRef.current) {
      clearTimeout(tuckedEnterTimerRef.current);
      tuckedEnterTimerRef.current = null;
    }
    if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
    leaveTimeoutRef.current = null;
    if (intensiveHoverTimerRef.current) {
      clearTimeout(intensiveHoverTimerRef.current);
      intensiveHoverTimerRef.current = null;
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    if (restingSleepTimerRef.current) {
      clearTimeout(restingSleepTimerRef.current);
      restingSleepTimerRef.current = null;
    }
    clearAutoTuckIdleTimer();
    scheduleHoverPeek(true);
  }, [
    clearAutoTuckIdleTimer,
    clearHoverSuppressionReleaseTimer,
    clearPostTransitionRecheckTimer,
    isCollapseCooldownActive,
    schedulePostTransitionRecheck,
    scheduleHoverPeek,
  ]);

  const handleMouseMove = useCallback((e?: React.MouseEvent) => {
    if (e && typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    }
    isCursorInsideRef.current = true;

    if (hoverSuppressedRef.current) {
      return;
    }
    if (isCollapseCooldownActive() || isTransitioningRef.current) {
      schedulePostTransitionRecheck();
      return;
    }
    clearHoverSuppressionReleaseTimer();
    clearPostTransitionRecheckTimer();

    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    if (restingSleepTimerRef.current) {
      clearTimeout(restingSleepTimerRef.current);
      restingSleepTimerRef.current = null;
    }
    clearAutoTuckIdleTimer();
    scheduleHoverPeek(false);
  }, [
    clearAutoTuckIdleTimer,
    clearHoverSuppressionReleaseTimer,
    clearPostTransitionRecheckTimer,
    isCollapseCooldownActive,
    schedulePostTransitionRecheck,
    scheduleHoverPeek,
  ]);

  const handleMouseLeave = useCallback(() => {
    if (useDropZoneStore.getState().isInternalDragging) {
      return;
    }
    isCursorInsideRef.current = false;
    clearPostTransitionRecheckTimer();

    // Cegah handleMouseLeave membuka hoverSuppressedRef terlalu dini saat collapse atau cooldown masih aktif
    if (isCollapseCooldownActive() || isTransitioningRef.current) {
      if (hoverSuppressedRef.current) {
        schedulePostCollapseSuppressionRelease();
      }
    } else {
      hoverSuppressedRef.current = false;
    }

    if (tuckedEnterTimerRef.current) {
      clearTimeout(tuckedEnterTimerRef.current);
      tuckedEnterTimerRef.current = null;
    }
    if (intensiveHoverTimerRef.current) {
      clearTimeout(intensiveHoverTimerRef.current);
      intensiveHoverTimerRef.current = null;
    }
    const currentState = islandStateRef.current;

    // REQUIREMENT 3: State Lock: Prioritaskan Klik di Atas Hover
    // Jika status aktif permanen adalah 'idle' atau 'expanded', ABAIKAN SEPENUHNYA auto-minimize!
    if (currentState === 'idle') {
      resetRestingSleepTimer();
      resetAutoTuckIdleTimer();
      return;
    }
    if (currentState === 'expanded') {
      return;
    }

    // 1. Status 'tucked_peek': Hysteresis / debounce >= 200ms sebelum menutup kembali ke 'tucked'
    if (currentState === 'tucked_peek') {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
      }
      leaveTimeoutRef.current = setTimeout(() => {
        if (islandStateRef.current === 'tucked_peek') {
          isCollapsingRef.current = true;
          markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
          setIsLandingComplete(false);
          islandStateRef.current = 'tucked';
          setIslandState('tucked');
          setIsPeeking(false);
          isPeekingRef.current = false;
        }
        leaveTimeoutRef.current = null;
      }, HOVER_HYSTERESIS_MS);
      return;
    }

    // 2. Status 'idle_peek' (preview belum diklik/dipin)
    if (currentState === 'idle_peek') {
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
      }
      hoverLeaveTimerRef.current = setTimeout(() => {
        if (islandStateRef.current === 'idle_peek') {
          isCollapsingRef.current = true;
          markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
          setIsLandingComplete(false);
          setIsPeeking(false);
          isPeekingRef.current = false;
          islandStateRef.current = 'idle';
          setIslandState('idle');
          resetRestingSleepTimer();
          resetAutoTuckIdleTimer();
        }
        hoverLeaveTimerRef.current = null;
      }, HOVER_HYSTERESIS_MS);
      return;
    }
  }, [
    resetRestingSleepTimer,
    resetAutoTuckIdleTimer,
    clearPostTransitionRecheckTimer,
    isCollapseCooldownActive,
    markCollapseTransitionCooldown,
    schedulePostCollapseSuppressionRelease,
  ]);

  // Click Handler on Notch: One-Click Deterministic Inversion
  const handlePillClick = useCallback(
    (e: React.MouseEvent) => {
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      }
      const target = e.target as HTMLElement | null;
      if (target?.closest('[data-satellite-pod="true"]')) {
        e.stopPropagation();
        return;
      }
      e.stopPropagation();
      hoverSuppressedRef.current = false;
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
        hoverLeaveTimerRef.current = null;
      }
      clearAutoTuckIdleTimer();
      if (isTransitioningRef.current) return;

      const currentState = islandStateRef.current;

      // 1. Klik pada Mode 7 (Minimize / 'tucked' atau preview 'tucked_peek'):
      //    Keluar dari minimize deterministik tanpa menyisakan dead-hover di idle
      if (currentState === 'tucked' || currentState === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        const animateFromTucked = currentState === 'tucked';
        setIsPeeking(false);
        isPeekingRef.current = false;
        lockTransition(animateFromTucked ? 240 : 120, true);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        if (!isCursorInsideRef.current) {
          resetRestingSleepTimer();
        } else if (!animateFromTucked) {
          schedulePostTransitionRecheck(120);
        }
        playChimeCue('tap');
        return;
      }

      // Status 'idle_peek' (preview Mode 6): Click-to-Lock Mode 6 permanen
      if (currentState === 'idle_peek') {
        setIsPeeking(false);
        isPeekingRef.current = false;
        handleLockExpanded();
        return;
      }

      // 2. Status 'idle' dengan Click-to-Lock & Anti-Double-Jump Guard:
      //    - Saat Priority Alert (Adzan / Timer Alarm) aktif: hoverExpandLocked mengunci klik body pil
      //      sehingga menyentuh pil tidak akan melebarkan Mode 6 menutupi game/desktop.
      //    - Dari Mode 1 (Resting): klik mengunci ke Modes 2-5 (Idle aktif) tanpa langsung melompat ke Mode 6
      //    - Dari Modes 2-5 (Idle): klik mengunci Mode 6 (Mekar) secara persistent
      if (currentState === 'idle') {
        if (isPriorityAlertRef.current) {
          return;
        }
        if (isRestingSleep || isRestingSleepRef.current) {
          hoverSuppressedRef.current = true;
          isRestingSleepRef.current = false;
          setIsRestingSleep(false);
          if (!isCursorInsideRef.current) {
            resetRestingSleepTimer();
          }
          playChimeCue('tap');
          return;
        }
        lockTransition(500);
        handleLockExpanded();
        return;
      }

      // 3. Status 'expanded' (Mode 6 Mekar): Persistent — klik di dalam kapsul TIDAK menutup Mode 6
      if (currentState === 'expanded') {
        return;
      }
    },
    [handleLockExpanded, resetRestingSleepTimer, isRestingSleep]
  );

  // Right-Click Context Menu: Collapse if expanded/peeking, or tuck away into thin top line if idle/resting
  const handlePillContextMenu = useCallback(
    (e: React.MouseEvent) => {
      if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
        lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
      }
      e.preventDefault();
      e.stopPropagation();
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
        hoverLeaveTimerRef.current = null;
      }
      if (restingSleepTimerRef.current) {
        clearTimeout(restingSleepTimerRef.current);
        restingSleepTimerRef.current = null;
      }
      clearAutoTuckIdleTimer();
      setIsPeeking(false);
      isPeekingRef.current = false;
      if (isTransitioningRef.current) return;

      const currentState = islandStateRef.current;
      if (currentState === 'expanded' || currentState === 'idle_peek') {
        collapseToIdle();
      } else if (currentState === 'idle') {
        // Baik saat Idle biasa maupun saat Resting: langsung transisi ke mode Minimize ('tucked')
        // tanpa memicu bangun ke Idle terlebih dahulu!
        // JANGAN reset isRestingSleep ke false di sini! Pertahankan isRestingSleep agar
        // IdlePillView tetap merender SashaEyes (mata tidur) yang memudar keluar, BUKAN jam digital!
        clearHoverSuppressionReleaseTimer();
        hoverSuppressedRef.current = true;
        lockTransition(500);
        isCollapsingRef.current = true;
        markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
        playChimeCue('whisper');
      } else if (currentState === 'tucked' || currentState === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        const animateFromTucked = currentState === 'tucked';
        lockTransition(animateFromTucked ? 240 : 120, true);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        if (!isCursorInsideRef.current) {
          resetRestingSleepTimer();
        } else if (!animateFromTucked) {
          schedulePostTransitionRecheck(120);
        }
        playChimeCue('tap');
      }
    },
    [
      collapseToIdle,
      resetRestingSleepTimer,
      clearMinimizeWakeupLocks,
      markCollapseTransitionCooldown,
      clearHoverSuppressionReleaseTimer,
      schedulePostTransitionRecheck,
    ]
  );

  // MouseDown Guard: Cancel pending hover timers immediately on press to prevent mid-click state collision
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (typeof e.clientX === 'number' && typeof e.clientY === 'number') {
      lastPointerPosRef.current = { x: e.clientX, y: e.clientY };
    }
    e.stopPropagation();
    if (tuckedEnterTimerRef.current) {
      clearTimeout(tuckedEnterTimerRef.current);
      tuckedEnterTimerRef.current = null;
    }
    if (intensiveHoverTimerRef.current) {
      clearTimeout(intensiveHoverTimerRef.current);
      intensiveHoverTimerRef.current = null;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }

    if (e.button === 1) {
      e.preventDefault();
      setIsPeeking(false);
      isPeekingRef.current = false;
      if (isTransitioningRef.current) return;

      const currentState = islandStateRef.current;
      if (currentState === 'idle') {
        clearHoverSuppressionReleaseTimer();
        hoverSuppressedRef.current = true;
        lockTransition(500);
        isCollapsingRef.current = true;
        markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
        playChimeCue('whisper');
      } else if (currentState === 'tucked' || currentState === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        const animateFromTucked = currentState === 'tucked';
        lockTransition(animateFromTucked ? 240 : 120, true);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        if (!isCursorInsideRef.current) {
          resetRestingSleepTimer();
        } else if (!animateFromTucked) {
          schedulePostTransitionRecheck(120);
        }
        playChimeCue('tap');
      }
    }
  }, [
    resetRestingSleepTimer,
    clearMinimizeWakeupLocks,
    markCollapseTransitionCooldown,
    clearHoverSuppressionReleaseTimer,
    schedulePostTransitionRecheck,
  ]);

  // Generalized Priority Alert Wake & Post-Stop State Recovery (Timer Alarm + Pengingat Ibadah T-0)
  // - Expanded Mode 6: stays open (never collapses/minimizes; slim top banner simply clears).
  // - Normal Desktop (non-fullscreen): after Stop/ended, remains cleanly in `idle` so natural
  //   resting/auto-tuck timers resume organically without abrupt forced minimize.
  // - Fullscreen / Gaming (`isFullscreenActive && smart-tuck`): returns immediately to `tucked`.
  useEffect(() => {
    const wasActive = prevPriorityAlertRef.current;
    prevPriorityAlertRef.current = isPriorityAlert;

    if (isPriorityAlert && !wasActive) {
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      clearAutoTuckIdleTimer();
      if (restingSleepTimerRef.current) {
        clearTimeout(restingSleepTimerRef.current);
        restingSleepTimerRef.current = null;
      }
      if (isRestingSleepRef.current) {
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
      }

      const cur = islandStateRef.current;
      if (cur === 'tucked' || cur === 'tucked_peek') {
        clearMinimizeWakeupLocks();
        wasTuckedBeforeAlertRef.current =
          isFullscreenActiveRef.current && fullscreenBehaviorRef.current === 'smart-tuck';
        islandStateRef.current = 'idle';
        setIslandState('idle');
        setIsPeeking(false);
        isPeekingRef.current = false;
        applyWindowSize(
          getActiveIdleWindowWidth(),
          getActiveIdleHitboxHeight(),
          showDevTriggerRef.current,
          false,
          false
        );
      } else if (cur === 'idle_peek') {
        wasTuckedBeforeAlertRef.current = false;
        islandStateRef.current = 'idle';
        setIslandState('idle');
        setIsPeeking(false);
        isPeekingRef.current = false;
      } else {
        wasTuckedBeforeAlertRef.current = false;
      }
      return;
    }

    if (!isPriorityAlert && wasActive) {
      const isActiveFullscreenSmartTuck =
        isFullscreenActiveRef.current && fullscreenBehaviorRef.current === 'smart-tuck';
      wasTuckedBeforeAlertRef.current = false;

      if (islandStateRef.current === 'expanded') {
        // Keep Mode 6 expanded untouched after Stop / audio ended
        return;
      }

      if (isActiveFullscreenSmartTuck) {
        setIsPeeking(false);
        isPeekingRef.current = false;
        isCollapsingRef.current = true;
        markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
      } else {
        // Normal desktop: keep capsule visible in `idle` and resume natural resting / auto-tuck timers
        if (islandStateRef.current !== 'idle') {
          islandStateRef.current = 'idle';
          setIslandState('idle');
        }
        resetRestingSleepTimer();
        resetAutoTuckIdleTimer();
      }
    }
  }, [
    isPriorityAlert,
    clearAutoTuckIdleTimer,
    resetRestingSleepTimer,
    resetAutoTuckIdleTimer,
    applyWindowSize,
    getActiveIdleWindowWidth,
    getActiveIdleHitboxHeight,
  ]);

  useEffect(() => {
    collapseToIdleRef.current = collapseToIdle;
  }, [collapseToIdle]);

  const handleLockExpandedRef = useRef(handleLockExpanded);
  useEffect(() => {
    handleLockExpandedRef.current = handleLockExpanded;
  }, [handleLockExpanded]);

  // Global click-outside (WebView + Win32 OS desktop) & Escape listeners for persistent Mode 6
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
      if (
        (e.target as HTMLElement)?.closest('[data-dev-trigger="true"]') ||
        (e.target as HTMLElement)?.closest('[data-casa-popover="true"]')
      ) {
        return;
      }
      if (islandRef.current && !islandRef.current.contains(e.target as Node)) {
        if (isTransitioningRef.current) return;
        if (tuckedEnterTimerRef.current) {
          clearTimeout(tuckedEnterTimerRef.current);
          tuckedEnterTimerRef.current = null;
        }
        if (leaveTimeoutRef.current) {
          clearTimeout(leaveTimeoutRef.current);
          leaveTimeoutRef.current = null;
        }
        const currentState = islandStateRef.current;
        // Mode 6 yang sudah terkunci (expanded) tetap persistent saat klik di luar jendela aplikasi;
        // hanya preview sementara (idle_peek / tucked_peek) yang menutup otomatis.
        if (currentState === 'idle_peek') {
          islandStateRef.current = 'idle';
          setIslandState('idle');
        } else if (currentState === 'tucked_peek') {
          islandStateRef.current = 'tucked';
          setIslandState('tucked');
          setIsPeeking(false);
          isPeekingRef.current = false;
        }
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isTransitioningRef.current) return;
        if (tuckedEnterTimerRef.current) {
          clearTimeout(tuckedEnterTimerRef.current);
          tuckedEnterTimerRef.current = null;
        }
        if (leaveTimeoutRef.current) {
          clearTimeout(leaveTimeoutRef.current);
          leaveTimeoutRef.current = null;
        }
        const currentState = islandStateRef.current;
        if (currentState === 'expanded') {
          collapseToIdleRef.current();
        } else if (currentState === 'idle_peek') {
          islandStateRef.current = 'idle';
          setIslandState('idle');
        } else if (currentState === 'tucked_peek') {
          islandStateRef.current = 'tucked';
          setIslandState('tucked');
          setIsPeeking(false);
          isPeekingRef.current = false;
        } else if (currentState === 'tucked') {
          clearMinimizeWakeupLocks();
          setIsPeeking(false);
          isPeekingRef.current = false;
          lockTransition(240, true);
          const enterResting =
            !isMusicPlayingRef.current &&
            !isTimerActiveRef.current &&
            !isKeepAwakeRef.current;
          isRestingSleepRef.current = enterResting;
          setIsRestingSleep(enterResting);
          islandStateRef.current = 'idle';
          setIslandState('idle');
          if (!enterResting) {
            resetRestingSleepTimer();
          }
          playChimeCue('tap');
        }
      }
    };

    window.addEventListener('mousedown', handleGlobalClick);
    window.addEventListener('keydown', handleKeyDown);

    let unlistenOutsideClick: (() => void) | undefined;
    let unlistenToggleShortcut: (() => void) | undefined;
    let isMounted = true;
    if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
      listen('casa://outside-click', () => {
        if (!isMounted) return;
        if (isTransitioningRef.current || useDropZoneStore.getState().isInternalDragging) return;
        // Pertahankan Mode 6 terkunci ('expanded') tetap terbuka saat pengguna mengklik aplikasi lain;
        // tutup hanya pratinjau hover sementara ('idle_peek').
        if (islandStateRef.current === 'idle_peek') {
          islandStateRef.current = 'idle';
          setIslandState('idle');
        }
      })
        .then((unlisten) => {
          if (!isMounted) {
            unlisten();
          } else {
            unlistenOutsideClick = unlisten;
          }
        })
        .catch(() => {});

      listen('casa://toggle-island', () => {
        if (!isMounted) return;
        if (tuckedEnterTimerRef.current) {
          clearTimeout(tuckedEnterTimerRef.current);
          tuckedEnterTimerRef.current = null;
        }
        if (intensiveHoverTimerRef.current) {
          clearTimeout(intensiveHoverTimerRef.current);
          intensiveHoverTimerRef.current = null;
        }
        if (leaveTimeoutRef.current) {
          clearTimeout(leaveTimeoutRef.current);
          leaveTimeoutRef.current = null;
        }
        if (hoverLeaveTimerRef.current) {
          clearTimeout(hoverLeaveTimerRef.current);
          hoverLeaveTimerRef.current = null;
        }
        clearAutoTuckIdleTimer();

        const currentState = islandStateRef.current;
        if (currentState === 'expanded' || currentState === 'idle_peek') {
          isTransitioningRef.current = false;
          collapseToIdleRef.current();
        } else {
          if (currentState === 'tucked' || currentState === 'tucked_peek') {
            clearMinimizeWakeupLocks();
            islandStateRef.current = 'idle';
            setIslandState('idle');
            setIsPeeking(false);
            isPeekingRef.current = false;
          }
          isTransitioningRef.current = false;
          handleLockExpandedRef.current();
          void focusIslandWindow();
        }
      })
        .then((unlisten) => {
          if (!isMounted) {
            unlisten();
          } else {
            unlistenToggleShortcut = unlisten;
          }
        })
        .catch(() => {});
    }

    return () => {
      isMounted = false;
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('keydown', handleKeyDown);
      if (unlistenOutsideClick) {
        unlistenOutsideClick();
      }
      if (unlistenToggleShortcut) {
        unlistenToggleShortcut();
      }
    };
  }, [secondaryBubbleSkillId, showDevTrigger, resetRestingSleepTimer]);

  // Hardware Metrics
  const [metrics] = useState<HardwareMetrics>({
    cpuUsage: 0.2,
    ramMb: 41.8,
    batteryPct: 88,
    isCharging: true,
    isMicMuted: false,
    volumePct: 65,
    isGamingMode: isGamingMode,
  });

  // Unified single-pipeline navigation handler (shared by wheel scroll and header arrow clicks)
  const handleNavigate = useCallback(
    (direction: 'prev' | 'next') => {
      // 1. Bersihkan seluruh timer hover intip & collapse di baris paling awal
      if (tuckedEnterTimerRef.current) {
        clearTimeout(tuckedEnterTimerRef.current);
        tuckedEnterTimerRef.current = null;
      }
      if (intensiveHoverTimerRef.current) {
        clearTimeout(intensiveHoverTimerRef.current);
        intensiveHoverTimerRef.current = null;
      }
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
        leaveTimeoutRef.current = null;
      }
      if (hoverLeaveTimerRef.current) {
        clearTimeout(hoverLeaveTimerRef.current);
        hoverLeaveTimerRef.current = null;
      }
      if (collapseTimerRef.current) {
        clearTimeout(collapseTimerRef.current);
        collapseTimerRef.current = null;
      }

      const currentState = islandStateRef.current;
      console.log('[DEBUG] handleNavigate dipanggil:', direction, {
        currentState,
        isTransitioning: isTransitioningRef.current,
      });
      if (currentState === 'tucked') return;
      if (isTransitioningRef.current) return;
      lockTransition(250);
      playChimeCue('tap');

      const isPeeking = currentState === 'idle_peek';

      // 2. Kunci status secara instan jika sedang di idle_peek tanpa rAF collision
      if (isPeeking) {
        hoverSuppressedRef.current = false;
        setIsPeeking(false);
        isPeekingRef.current = false;
        setIsLandingComplete(false);
        islandStateRef.current = 'expanded';
        setIslandState('expanded');
      }

      const dirStep = direction === 'next' ? 1 : -1;

      if (currentState === 'idle' || currentState === 'tucked_peek') {
        useSkillStore.getState().cycleActiveSkill(dirStep);
      } else if (isExpandedView || isPeeking) {
        const modes: IslandMode[] = [
          'expanded_music',
          'expanded_timer',
          'drop_zone',
          ...(isIbadahEnabledRef.current ? (['expanded_ibadah'] as IslandMode[]) : []),
          ...(isCalculatorEnabledRef.current ? (['expanded_calculator'] as IslandMode[]) : []),
          ...(isCalendarEnabledRef.current ? (['expanded_calendar'] as IslandMode[]) : []),
          'expanded_control',
        ];
        const normalizedMode =
          effectiveExpandedMode === 'expanded_todo' ? 'expanded_timer' : effectiveExpandedMode;
        const currentIdx = modes.indexOf(normalizedMode);
        const validIdx = currentIdx >= 0 ? currentIdx : 0;
        const nextIdx = (validIdx + dirStep + modes.length) % modes.length;
        const nextMode = modes[nextIdx];
        if (nextMode !== 'expanded_music') {
          setIsSearchPodOpen(false);
          setIsQueuePodOpen(false);
        }
        if (nextMode !== 'expanded_control') {
          setIsWifiPodOpen(false);
          setIsBtPodOpen(false);
        }
        if (nextMode !== 'drop_zone') {
          setIsConnectHpPodOpen(false);
        }
        const targetSkill =
          nextMode === 'expanded_timer'
            ? 'core.timer'
            : 'core.media';
        useSkillStore.getState().setActiveSkillId(targetSkill);
        const { width: targetW, height: targetH } = getIslandDimensions('expanded', nextMode);
        applyWindowSize(targetW, targetH, showDevTrigger, false, false);
        onChangeMode(nextMode);
      }
    },
    [isExpandedView, effectiveExpandedMode, showDevTrigger, onChangeMode, applyWindowSize]
  );

  // Wheel scroll on idle pill or expanded card to cycle active skills
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      if (isPriorityAlertRef.current && !isExpandedView) {
        return;
      }
      if ((e.target as HTMLElement)?.closest('.oled-thin-scrollbar')) {
        return;
      }
      const direction = e.deltaY > 0 ? 'next' : 'prev';
      handleNavigate(direction);
    },
    [handleNavigate, isExpandedView]
  );

  const externalDragDepthRef = useRef<number>(0);

  const expandToDropZoneSurface = useCallback((markDragging: boolean) => {
    if (markDragging) {
      useDropZoneStore.getState().setIsDragging(true);
      isDraggingFileRef.current = true;
    } else {
      isDraggingFileRef.current = false;
      useDropZoneStore.getState().setIsDragging(false);
    }

    if (tuckedEnterTimerRef.current) {
      clearTimeout(tuckedEnterTimerRef.current);
      tuckedEnterTimerRef.current = null;
    }
    if (intensiveHoverTimerRef.current) {
      clearTimeout(intensiveHoverTimerRef.current);
      intensiveHoverTimerRef.current = null;
    }
    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }
    if (collapseTimerRef.current) {
      clearTimeout(collapseTimerRef.current);
      collapseTimerRef.current = null;
    }
    if (restingSleepTimerRef.current) {
      clearTimeout(restingSleepTimerRef.current);
      restingSleepTimerRef.current = null;
    }
    clearAutoTuckIdleTimer();
    if (wakeUpTimerRef.current) {
      clearTimeout(wakeUpTimerRef.current);
      wakeUpTimerRef.current = null;
    }

    hoverSuppressedRef.current = false;
    isCollapsingRef.current = false;
    setIsPeeking(false);
    isPeekingRef.current = false;
    setIsRestingSleep(false);
    isRestingSleepRef.current = false;

    setIsSearchPodOpen(false);
    setIsQueuePodOpen(false);
    setIsWifiPodOpen(false);
    setIsBtPodOpen(false);

    if (modeRef.current !== 'drop_zone' || islandStateRef.current !== 'expanded') {
      islandStateRef.current = 'expanded';
      setIslandState('expanded');
      if (modeRef.current !== 'drop_zone') {
        previousModeBeforeDragRef.current = modeRef.current;
      }
      const layout = resolveEffectiveIslandLayout({
        islandState: 'expanded',
        expandedMode: 'drop_zone',
        measuredPillWidth: measuredPillWidthRef.current,
        isFloatingMode: isFloatingModeRef.current,
        hasHudAlert: hasHudAlertRef.current,
        isAlarmRinging: isAlarmRingingRef.current,
        isPrayerAlertActive: isPrayerAlertVisibleRef.current,
        isReminderAlertActive: isReminderAlertVisibleRef.current,
        isIbadahEnabled: isIbadahEnabledRef.current,
        isCalculatorEnabled: isCalculatorEnabledRef.current,
        isCalendarEnabled: isCalendarEnabledRef.current,
        isRestingSleep: false,
        isLyricsOpen: false,
        isFocusHoverPeek: false,
      });
      applyWindowSizeRef.current(layout.width, layout.height, showDevTriggerRef.current, false, false);
      onChangeModeRef.current?.('drop_zone');
      if (markDragging) {
        playChimeCue('whisper');
      }
    }
  }, [clearAutoTuckIdleTimer]);

  const activateDropZoneForExternalDrag = useCallback(() => {
    expandToDropZoneSurface(true);
  }, [expandToDropZoneSurface]);

  // Capsule-Wide HTML5 Smart Drag-In Listener (Files, Links / text/uri-list, Plain Text / HTML snippets)
  // Works seamlessly across tucked, idle, resting, peek, and expanded states when dragDropEnabled=false.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const hasSupportedDragPayload = (dt: DataTransfer | null): boolean => {
      if (!dt) return false;
      if (dt.files && dt.files.length > 0) return true;
      if (dt.items && dt.items.length > 0) return true;
      const types = Array.from(dt.types || []);
      return types.some(
        (t) => t === 'Files' || t === 'text/uri-list' || t === 'text/plain' || t === 'text/html'
      );
    };

    const handleWindowDragEnter = (e: DragEvent) => {
      if (useDropZoneStore.getState().isInternalDragging) return;
      if (!hasSupportedDragPayload(e.dataTransfer)) return;
      e.preventDefault();
      externalDragDepthRef.current += 1;
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      activateDropZoneForExternalDrag();
    };

    const handleWindowDragOver = (e: DragEvent) => {
      if (useDropZoneStore.getState().isInternalDragging) return;
      if (!hasSupportedDragPayload(e.dataTransfer)) return;
      e.preventDefault();
      if (e.dataTransfer) {
        e.dataTransfer.dropEffect = 'copy';
      }
      activateDropZoneForExternalDrag();
    };

    const handleWindowDragLeave = (e: DragEvent) => {
      if (useDropZoneStore.getState().isInternalDragging) return;
      externalDragDepthRef.current = Math.max(0, externalDragDepthRef.current - 1);
      if (e.relatedTarget === null || externalDragDepthRef.current <= 0) {
        externalDragDepthRef.current = 0;
        isDraggingFileRef.current = false;
        useDropZoneStore.getState().setIsDragging(false);
      }
    };

    const handleWindowDrop = async (e: DragEvent) => {
      if (useDropZoneStore.getState().isInternalDragging) return;
      externalDragDepthRef.current = 0;
      if (e.defaultPrevented) return;
      if (!hasSupportedDragPayload(e.dataTransfer)) return;

      e.preventDefault();
      expandToDropZoneSurface(false);

      const firstFile = e.dataTransfer?.files?.[0];
      if (firstFile?.name) {
        setStagedDroppedFile(firstFile.name);
      }

      const res = await useDropZoneStore.getState().addDroppedDataTransfer(e.dataTransfer);
      if (res.added > 0) {
        playChimeCue('ding');
      } else if (res.blocked) {
        playChimeCue('tap');
      }
    };

    const handleWindowDragEnd = () => {
      externalDragDepthRef.current = 0;
      isDraggingFileRef.current = false;
      useDropZoneStore.getState().setIsDragging(false);
    };

    window.addEventListener('dragenter', handleWindowDragEnter);
    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('dragleave', handleWindowDragLeave);
    window.addEventListener('drop', handleWindowDrop);
    window.addEventListener('dragend', handleWindowDragEnd);

    return () => {
      window.removeEventListener('dragenter', handleWindowDragEnter);
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('dragleave', handleWindowDragLeave);
      window.removeEventListener('drop', handleWindowDrop);
      window.removeEventListener('dragend', handleWindowDragEnd);
    };
  }, [activateDropZoneForExternalDrag, expandToDropZoneSurface]);

  // Native Tauri Window File-Drop Listener for automatic DropZone morphing & persistent drop handling
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let isSubscribed = true;

    async function setupDropListener() {
      try {
        unlisten = await getCurrentWebview().onDragDropEvent(async (event) => {
          if (!isSubscribed) return;
          // Isolasi: Jika sedang melakukan drag-out internal, abaikan event drag-drop native
          if (useDropZoneStore.getState().isInternalDragging) return;
          const payload = event.payload;

          if (payload.type === 'enter' || payload.type === 'over') {
            activateDropZoneForExternalDrag();
          } else if (payload.type === 'leave') {
            isDraggingFileRef.current = false;
            useDropZoneStore.getState().setIsDragging(false);
          } else if (payload.type === 'drop') {
            expandToDropZoneSurface(false);
            const paths = payload.paths;
            if (paths && paths.length > 0) {
              const lastFile = paths[paths.length - 1];
              const fileName = lastFile.replace(/^.*[\\/]/, '') || lastFile;
              setStagedDroppedFile(fileName);
              await useDropZoneStore.getState().addDroppedPaths(paths);
              playChimeCue('ding');
            }
          }
        });
      } catch (err) {
        console.warn('[CasaIsland] Native onDragDropEvent registration failed:', err);
      }
    }

    setupDropListener();

    return () => {
      isSubscribed = false;
      if (unlisten) {
        unlisten();
      }
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
      }
    };
  }, [activateDropZoneForExternalDrag, expandToDropZoneSurface]);

  // Clean up all pending timers on unmount
  useEffect(() => {
    return () => {
      if (tuckedEnterTimerRef.current) clearTimeout(tuckedEnterTimerRef.current);
      if (leaveTimeoutRef.current) clearTimeout(leaveTimeoutRef.current);
      if (collapseTimerRef.current) clearTimeout(collapseTimerRef.current);
      if (transitionLockTimerRef.current) clearTimeout(transitionLockTimerRef.current);
      if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
      if (intensiveHoverTimerRef.current) clearTimeout(intensiveHoverTimerRef.current);
      if (dropTimeoutRef.current) clearTimeout(dropTimeoutRef.current);
      if (restingSleepTimerRef.current) clearTimeout(restingSleepTimerRef.current);
      if (autoTuckIdleTimerRef.current) clearTimeout(autoTuckIdleTimerRef.current);
      if (wakeUpTimerRef.current) clearTimeout(wakeUpTimerRef.current);
      clearHoverSuppressionReleaseTimer();
      clearPostTransitionRecheckTimer();
    };
  }, [clearHoverSuppressionReleaseTimer, clearPostTransitionRecheckTimer]);

  const activeCenterOffsetX = computeCenterOffsetX(
    horizontalAlign,
    width,
    effectiveLeftPodOpen,
    effectiveRightPodOpen
  );

  return (
    <div
      ref={islandRef}
      style={{
        top: isFloatingMode ? 0 : activeTopPx,
        left: `calc(50% + ${activeCenterOffsetX}px)`,
      }}
      className="fixed -translate-x-1/2 flex items-start justify-center select-none z-40 pointer-events-none"
    >
      {/* Detached Satellite Pod Portal Host (outside overflow-clip container, inside islandRef outside-click guard) */}
      <div
        ref={setPodHostEl}
        data-satellite-pod-host="true"
        style={{ top: activeTopPx }}
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 w-[1100px] h-[196px] overflow-visible z-40"
      />

      {/* Dynamic Hover Sensor Wrapper tightly embracing capsule & floating top corridor */}
      <div
        ref={hoverSensorRef}
        data-island-hover-sensor="true"
        onPointerEnter={handleMouseEnter}
        onPointerLeave={handleMouseLeave}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onMouseMove={handleMouseMove}
        onClick={(e) => {
          if (
            e.target === e.currentTarget &&
            (islandStateRef.current === 'tucked' || islandStateRef.current === 'tucked_peek')
          ) {
            handlePillClick(e);
          }
        }}
        className={`relative flex items-start justify-center bg-transparent overflow-visible touch-manipulation ${
          islandState === 'expanded' ? 'pointer-events-none' : 'pointer-events-auto'
        }`}
        style={{
          width: sensorWidth,
          height: sensorHeight,
          touchAction: 'manipulation',
        }}
      >
        {/* Top-Flush Notch Assembly + Left/Right Concave Inverse Corner Radius Shoulders (hidden when tucked or floating) */}
        <div className="relative inline-flex items-start justify-center overflow-visible">
          {!isFloatingMode && !isPureTucked && (
            <>
              {/* Bahu Kiri Inverse Corner Radius (#000000 + 1px inner bleed overlap) */}
              <svg
                width="11"
                height="10"
                viewBox="0 0 11 10"
                fill="none"
                aria-hidden="true"
                className="pointer-events-none absolute top-0 -left-[10px] z-30 transition-opacity duration-150 opacity-100"
              >
                <path d="M 0,0 H 11 V 10 H 10 A 10,10 0 0 0 0,0 Z" fill="#000000" />
              </svg>

              {/* Bahu Kanan Inverse Corner Radius (#000000 + 1px inner bleed overlap) */}
              <svg
                width="11"
                height="10"
                viewBox="0 0 11 10"
                fill="none"
                aria-hidden="true"
                className="pointer-events-none absolute top-0 -right-[10px] z-30 transition-opacity duration-150 opacity-100"
              >
                <path d="M 0,0 H 11 A 10,10 0 0 0 1,10 H 0 V 0 Z" fill="#000000" />
              </svg>
            </>
          )}

          {/* Main Pure Black Notch Container (#000000, border-t-0, sharp top, rounded bottom) */}
          <motion.div
            ref={containerBoxRef}
            data-island-container="true"
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onClick={handlePillClick}
            onContextMenu={handlePillContextMenu}
            animate={{
              width,
              height,
              y: isFloatingMode ? activeTopPx : 0,
            }}
            transition={
              isLandingComplete && islandState === 'idle' && !hasHudAlert
                ? {
                    width: { duration: 0.22, ease: [0.22, 1, 0.36, 1] },
                    height: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                    y: { duration: 0.2, ease: [0.22, 1, 0.36, 1] },
                  }
                : {
                    duration: 0.2,
                    ease: [0.22, 1, 0.36, 1],
                  }
            }
            onAnimationComplete={() => {
              unlockTransition();
              if (isCollapsingRef.current) {
                isCollapsingRef.current = false;
                markCollapseTransitionCooldown(HOVER_HYSTERESIS_MS);
                doubleRaf(() => {
                  // Cek koordinat pointer aktual terhadap sensor setelah menyusut: di Windows WS_EX_TRANSPARENT
                  // DOM mouseleave tidak selalu terpicu saat kapsul mengecil menjauhi kursor diam.
                  const pointerStillInsideSensor = isPointerInsideHoverSensor();
                  if (!pointerStillInsideSensor) {
                    clearHoverSuppressionReleaseTimer();
                    hoverSuppressedRef.current = false;
                  }

                  const devVis = showDevTriggerRef.current;
                  if (islandStateRef.current === 'tucked') {
                    if (hasHudAlertRef.current) {
                      applyWindowSize(
                        Math.max(getActiveIdleWindowWidth(), 244),
                        IDLE_WINDOW_HEIGHT,
                        devVis,
                        false,
                        false
                      );
                    } else {
                      applyWindowSize(TUCKED_WIDTH, TUCKED_HEIGHT, devVis, false, false, true);
                      isRestingSleepRef.current = false;
                      setIsRestingSleep(false);
                    }
                  } else if (islandStateRef.current === 'idle') {
                    applyWindowSize(
                      getActiveIdleWindowWidth(),
                      getActiveIdleHitboxHeight(),
                      devVis,
                      false,
                      false
                    );
                  }

                  if (pointerStillInsideSensor && !hoverSuppressedRef.current) {
                    schedulePostTransitionRecheck();
                  }
                });
              } else {
                if (!isCursorInsideRef.current && hoverSuppressedRef.current) {
                  schedulePostCollapseSuppressionRelease();
                } else {
                  recheckPointerHoverIntent();
                }
              }
              if (islandStateRef.current === 'idle' && !isExpandedView) {
                setIsLandingComplete((prev) => (prev ? prev : true));
              }
            }}
            style={{
              borderTopLeftRadius: topCornerRadius,
              borderTopRightRadius: topCornerRadius,
              borderBottomLeftRadius: bottomCornerRadius,
              borderBottomRightRadius: bottomCornerRadius,
              boxShadow: isPureTucked
                ? 'none'
                : isExternalDragOver
                ? settings.theme === 'monochrome'
                  ? '0 0 16px rgba(255, 255, 255, 0.22), 0 8px 28px rgba(0, 0, 0, 0.65)'
                  : '0 0 16px rgba(99, 102, 241, 0.28), 0 8px 28px rgba(0, 0, 0, 0.65)'
                : isPrayerPerimeterVisible
                ? `0 0 18px ${activePrayerTheme.outerShadow}, 0 8px 28px rgba(0, 0, 0, 0.72)`
                : isAlarmRinging && !isExpandedView && islandState !== 'tucked'
                ? '0 0 20px var(--casa-timer-glow, rgba(245, 158, 11, 0.45)), 0 8px 28px rgba(0, 0, 0, 0.75)'
                : isIdleTimerPerimeterVisible
                ? idleTimerState?.mode === 'rest'
                  ? '0 0 10px color-mix(in srgb, var(--casa-rest, #10B981) 28%, transparent), 0 8px 28px rgba(0, 0, 0, 0.65)'
                  : '0 0 12px var(--casa-timer-glow, rgba(245, 158, 11, 0.18)), 0 8px 28px rgba(0, 0, 0, 0.65)'
                : '0 8px 28px rgba(0, 0, 0, 0.65)',
              overflow: 'clip',
              touchAction: 'manipulation',
            }}
            className={`relative flex flex-col box-border pointer-events-auto shrink-0 bg-[#000000] overflow-clip touch-manipulation transition-shadow duration-200 ${
              isPureTucked
                ? 'h-[4px] pt-0 rounded-t-none rounded-b-full border-t-0 border-x-0 border-b border-white/15'
                : `${isFloatingMode ? 'pt-0' : 'pt-[1px]'} border-0`
            } ${
              isPureTucked
                ? ''
                : isExternalDragOver
                ? settings.theme === 'monochrome'
                  ? 'ring-1 ring-white/55'
                  : 'ring-1 ring-indigo-500/60'
                : isAlarmRinging && !isExpandedView && islandState !== 'tucked'
                ? 'ring-1 ring-[color:var(--casa-timer)]'
                : ''
            } ${
              isExpandedView ? '' : 'cursor-pointer'
            }`}
            title={
              islandState === 'tucked'
                ? 'CASA (Arahkan kursor untuk mengintip / Klik untuk membuka)'
                : undefined
            }
          >
            {/* Magnetic Drag-Over Tint Overlay */}
            {isExternalDragOver && (
              <div
                aria-hidden="true"
                className={`pointer-events-none absolute inset-0 z-30 ${
                  settings.theme === 'monochrome' ? 'bg-white/[0.06]' : 'bg-indigo-500/[0.08]'
                }`}
              />
            )}

            {/* Idle Timer / Prayer T-0 Perimeter Stroke (Open U-Shape Docked / Closed Rounded Pill Floating) */}
            {(isIdleTimerPerimeterVisible || isPrayerPerimeterVisible) && (() => {
              const perimeterW = measuredPillBox.width > 0 ? measuredPillBox.width : width;
              const perimeterH = measuredPillBox.height > 0 ? measuredPillBox.height : height;
              const strokeInset = 0.75;
              const clampedW = Math.max(4, perimeterW);
              const clampedH = Math.max(4, perimeterH);
              const maxCornerX = Math.max(2, (clampedW - strokeInset * 2) / 2);
              const maxCornerY = isFloatingMode
                ? Math.max(2, (clampedH - strokeInset * 2) / 2)
                : Math.max(2, clampedH - strokeInset * 2);
              const cornerR = Math.max(
                2,
                Math.min(bottomCornerRadius - strokeInset, maxCornerX, maxCornerY)
              );
              const leftX = strokeInset;
              const rightX = clampedW - strokeInset;
              const topY = strokeInset;
              const bottomY = clampedH - strokeInset;
              const uPathD = `M ${leftX},0 L ${leftX},${bottomY - cornerR} A ${cornerR},${cornerR} 0 0 0 ${leftX + cornerR},${bottomY} L ${rightX - cornerR},${bottomY} A ${cornerR},${cornerR} 0 0 0 ${rightX},${bottomY - cornerR} L ${rightX},0`;
              const midX = clampedW / 2;
              const floatingPathD = `M ${midX},${topY} L ${rightX - cornerR},${topY} A ${cornerR},${cornerR} 0 0 1 ${rightX},${topY + cornerR} L ${rightX},${bottomY - cornerR} A ${cornerR},${cornerR} 0 0 1 ${rightX - cornerR},${bottomY} L ${leftX + cornerR},${bottomY} A ${cornerR},${cornerR} 0 0 1 ${leftX},${bottomY - cornerR} L ${leftX},${topY + cornerR} A ${cornerR},${cornerR} 0 0 1 ${leftX + cornerR},${topY} Z`;
              const perimeterPathD = isFloatingMode ? floatingPathD : uPathD;

              if (isPrayerPerimeterVisible) {
                return (
                  <svg
                    data-prayer-perimeter-stroke="true"
                    data-placement-mode={isFloatingMode ? 'floating' : 'docked'}
                    className="pointer-events-none absolute inset-0 w-full h-full z-30"
                    viewBox={`0 0 ${clampedW} ${clampedH}`}
                    aria-hidden="true"
                  >
                    <path
                      d={perimeterPathD}
                      fill="none"
                      stroke={activePrayerTheme.stroke}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="casa-prayer-perimeter-stroke"
                      style={{
                        filter: `drop-shadow(0 0 3px ${activePrayerTheme.glow})`,
                      }}
                    />
                  </svg>
                );
              }

              const perimeterStrokeColor =
                idleTimerState?.mode === 'rest'
                  ? 'var(--casa-rest, #10B981)'
                  : 'var(--casa-timer, #F59E0B)';
              return (
                <svg
                  className={`pointer-events-none absolute inset-0 w-full h-full z-30 transition-opacity duration-200 ${
                    isIdleTimerPaused ? 'opacity-55' : 'opacity-100'
                  }`}
                  viewBox={`0 0 ${clampedW} ${clampedH}`}
                  aria-hidden="true"
                >
                  <path
                    d={perimeterPathD}
                    fill="none"
                    stroke={perimeterStrokeColor}
                    strokeWidth={1.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    pathLength={100}
                    strokeDasharray="100 100"
                    strokeDashoffset={100 - idleTimerRemainingPct}
                    className="transition-[stroke-dashoffset] duration-700 ease-linear"
                  />
                </svg>
              );
            })()}

            {/* Internal Content Animated with Clean Lifecycle & Overflow Clip */}
            <div
              className={`relative w-full h-full overflow-clip ${
                isPureTucked ? 'opacity-0 pointer-events-none invisible' : ''
              }`}
              style={{ overflow: 'clip' }}
            >
              {/* Layer 0 (4px OLED Tucked Bezel): empty sleek line with 0 inner elements to avoid clipping */}

              {/* Layer 1: Mode 6 Expanded View (Unmounted cleanly when !isExpandedView) */}
              <AnimatePresence initial={false}>
                {isExpandedView && (
                  <motion.div
                    key="expanded-layer"
                    data-island-view="expanded"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.12, ease: 'easeOut' }}
                    onClickCapture={(e) => {
                      const target = e.target as HTMLElement;
                      if (
                        target.closest('[data-collapse-btn="true"]') ||
                        target.closest('[data-satellite-pod="true"]') ||
                        target.closest('[data-focus-peek-card="true"]')
                      ) {
                        return;
                      }
                      if (islandStateRef.current === 'idle_peek') {
                        handleLockExpanded();
                      }
                    }}
                    onClick={(e) => {
                      const target = e.target as HTMLElement;
                      if (target.closest('[data-satellite-pod="true"]')) {
                        e.stopPropagation();
                        return;
                      }
                      if (islandStateRef.current === 'idle_peek') {
                        e.stopPropagation();
                        handleLockExpanded();
                        return;
                      }
                      e.stopPropagation();
                    }}
                    className="absolute inset-0 w-full h-full flex flex-col justify-start overflow-visible select-none z-20"
                    style={{
                      overflow: 'visible',
                      pointerEvents: 'auto',
                    }}
                  >
                    {isFocusHoverPeek && focusTimer.timerState ? (
                      <FocusHoverPeekCard
                        timer={focusTimer.timerState}
                        todos={focusTodos.todos}
                        onToggleTimer={focusTimer.toggleTimer}
                        onCompleteTask={(todoId) => {
                          focusTodos.toggleTodo(todoId);
                        }}
                        onStopTimer={focusTimer.stopTimerSession}
                        onLockExpanded={() => handleLockExpanded('expanded_timer')}
                      />
                    ) : (
                      <>
                        <Mode6TopNav
                          currentMode={effectiveExpandedMode}
                          onSelectMode={handleSelectMode}
                          onToggleDevTrigger={onToggleDevTrigger}
                          onCollapse={collapseToIdle}
                          onHeaderClick={handleHeaderClick}
                          isPeekPreview={islandState === 'idle_peek'}
                          upcomingReminderBadge={visibleUpcomingReminderBadge}
                        />

                        {visiblePrayerAlert && effectiveExpandedMode !== 'expanded_ibadah' && (
                          <div
                            style={
                              {
                                '--casa-ibadah': activePrayerTheme.accent,
                                '--casa-ibadah-glow': activePrayerTheme.glow,
                                borderBottomColor: activePrayerTheme.bannerBorder,
                                backgroundImage: `linear-gradient(90deg, ${activePrayerTheme.bannerTint}, rgba(8, 8, 10, 0.96) 65%)`,
                              } as React.CSSProperties
                            }
                            className="w-full h-[28px] px-3 flex items-center justify-between gap-2 bg-[#08080a] border-b shrink-0 relative z-25 select-none"
                          >
                            <div className="flex items-center gap-2 min-w-0">
                              <CasaCompanionAvatar isPlaying={false} expression="prayer" />
                              <span
                                style={{ color: 'var(--casa-ibadah, #FFFFFF)' }}
                                className="text-[10.5px] font-bold tracking-tight whitespace-nowrap"
                              >
                                Adzan {visiblePrayerAlert.prayerLabel}
                              </span>
                              {visiblePrayerAlert.timeLabel && (
                                <span className="font-mono text-[10px] tabular-nums text-white/45 whitespace-nowrap">
                                  {visiblePrayerAlert.timeLabel}
                                </span>
                              )}
                              {visiblePrayerAlert.audioMode !== 'visual' && (
                                <span className="casa-prayer-eq shrink-0" aria-hidden="true">
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
                              className="h-[19px] px-2 rounded-full text-[9.5px] font-bold inline-flex items-center gap-1 hover:opacity-90 active:scale-95 transition-all cursor-pointer shrink-0"
                              title={
                                visiblePrayerAlert.audioMode === 'visual'
                                  ? 'Tutup pengingat ibadah'
                                  : 'Hentikan audio adzan'
                              }
                            >
                              {visiblePrayerAlert.audioMode !== 'visual' && (
                                <VolumeX className="w-2.5 h-2.5" />
                              )}
                              <span>
                                {visiblePrayerAlert.audioMode === 'visual' ? 'Tutup' : 'Stop'}
                              </span>
                            </button>
                          </div>
                        )}

                        {!visiblePrayerAlert &&
                          visibleReminderAlert &&
                          effectiveExpandedMode !== 'expanded_calendar' && (
                            <div
                              data-expanded-reminder-banner="true"
                              style={{
                                borderBottomColor:
                                  settings.theme === 'monochrome'
                                    ? 'rgba(255, 255, 255, 0.16)'
                                    : 'rgba(251, 113, 133, 0.28)',
                                backgroundImage:
                                  settings.theme === 'monochrome'
                                    ? 'linear-gradient(90deg, rgba(255, 255, 255, 0.08), rgba(8, 8, 10, 0.96) 65%)'
                                    : 'linear-gradient(90deg, rgba(251, 113, 133, 0.10), rgba(8, 8, 10, 0.96) 65%)',
                              }}
                              className="w-full h-[28px] px-3 flex items-center justify-between gap-2 bg-[#08080a] border-b shrink-0 relative z-25 select-none"
                            >
                              <div className="flex items-center gap-2 min-w-0">
                                <CasaCompanionAvatar isPlaying={false} expression="reminder_t0" />
                                <span
                                  style={{
                                    color: settings.theme === 'monochrome' ? '#FFFFFF' : '#FB7185',
                                  }}
                                  className="text-[10.5px] font-bold tracking-tight truncate"
                                  title={visibleReminderAlert.title}
                                >
                                  {visibleReminderAlert.title}
                                </span>
                                {visibleReminderAlert.scheduledTimeHHMM && (
                                  <span className="font-mono text-[10px] tabular-nums text-white/45 whitespace-nowrap">
                                    {visibleReminderAlert.scheduledTimeHHMM}
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <button
                                  type="button"
                                  data-reminder-action="snooze"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onMouseDown={(e) => e.stopPropagation()}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    snoozeActiveReminder(5);
                                  }}
                                  className="h-[19px] px-2 rounded-full bg-white/[0.10] hover:bg-white/[0.18] border border-white/15 text-[9.5px] font-semibold text-white cursor-pointer active:scale-95 transition-all"
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
                                    dismissActiveReminder();
                                  }}
                                  style={{
                                    backgroundColor:
                                      settings.theme === 'monochrome' ? '#FFFFFF' : '#FB7185',
                                    color: '#000000',
                                  }}
                                  className="h-[19px] px-2 rounded-full text-[9.5px] font-bold hover:opacity-90 active:scale-95 transition-all cursor-pointer"
                                >
                                  Dismiss
                                </button>
                              </div>
                            </div>
                          )}

                        <div
                          className="w-full flex-1 min-h-0 flex flex-col justify-center overflow-visible relative z-20"
                          style={{ overflow: 'visible' }}
                        >
                          {effectiveExpandedMode === 'expanded_music' && (
                            <MediaExpandedView
                              onCollapse={collapseToIdle}
                              mode6Compact
                              podHostEl={podHostEl}
                              isSearchPodOpen={effectiveLeftPodOpen}
                              isQueuePodOpen={effectiveRightPodOpen}
                              isLyricsOpen={isLyricsOpen}
                              onToggleLyrics={() => {
                                if (islandStateRef.current === 'idle_peek') {
                                  handleLockExpanded();
                                }
                                const nextVal = !isLyricsOpenRef.current;
                                isLyricsOpenRef.current = nextVal;
                                setIsLyricsOpen(nextVal);
                              }}
                              onToggleSearchPod={() => {
                                if (islandStateRef.current === 'idle_peek') {
                                  handleLockExpanded();
                                }
                                setIsSearchPodOpen((prev) => !prev);
                              }}
                              onToggleQueuePod={() => {
                                if (islandStateRef.current === 'idle_peek') {
                                  handleLockExpanded();
                                }
                                setIsQueuePodOpen((prev) => !prev);
                              }}
                              onCloseSearchPod={() => setIsSearchPodOpen(false)}
                              onCloseQueuePod={() => setIsQueuePodOpen(false)}
                              onInteractionLock={handleLockExpanded}
                            />
                          )}

                          {effectiveExpandedMode === 'expanded_timer' && (
                            <TimerExpandedView
                              onCollapse={collapseToIdle}
                              onOpenMusic={() => handleSelectMode('expanded_music')}
                            />
                          )}

                          {effectiveExpandedMode === 'expanded_todo' && (
                            <TodoExpandedView
                              onCollapse={collapseToIdle}
                              onOpenMusic={() => handleSelectMode('expanded_music')}
                            />
                          )}

                          {effectiveExpandedMode === 'expanded_control' && (
                            <Mode6ControlCenterView
                              onOpenMusic={() => handleSelectMode('expanded_music')}
                              podHostEl={podHostEl}
                              capsuleWidth={width}
                              isWifiPodOpen={effectiveLeftPodOpen}
                              isBtPodOpen={effectiveRightPodOpen}
                              onToggleWifiPod={() => {
                                if (islandStateRef.current === 'idle_peek') {
                                  handleLockExpanded();
                                }
                                setIsWifiPodOpen((prev) => !prev);
                              }}
                              onToggleBtPod={() => {
                                if (islandStateRef.current === 'idle_peek') {
                                  handleLockExpanded();
                                }
                                setIsBtPodOpen((prev) => !prev);
                              }}
                              onCloseWifiPod={() => setIsWifiPodOpen(false)}
                              onCloseBtPod={() => setIsBtPodOpen(false)}
                              onInteractionLock={handleLockExpanded}
                            />
                          )}

                          {effectiveExpandedMode === 'expanded_ibadah' && (
                            <IbadahExpandedView />
                          )}

                          {effectiveExpandedMode === 'expanded_calculator' && (
                            <CalculatorExpandedView />
                          )}

                          {effectiveExpandedMode === 'expanded_calendar' && (
                            <CalendarExpandedView />
                          )}

                          {effectiveExpandedMode === 'drop_zone' && (
                            <DropZoneView
                              isLockedExpanded={islandState === 'expanded'}
                              onOpenMusic={() => handleSelectMode('expanded_music')}
                              podHostEl={podHostEl}
                              isConnectHpPodOpen={effectiveRightPodOpen}
                              onToggleConnectHpPod={() => {
                                if (islandStateRef.current === 'idle_peek') {
                                  handleLockExpanded();
                                }
                                setIsConnectHpPodOpen((prev) => !prev);
                              }}
                              onCloseConnectHpPod={() => setIsConnectHpPodOpen(false)}
                              onInteractionLock={handleLockExpanded}
                            />
                          )}
                        </div>
                      </>
                    )}
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Layer 2: Unified Fluid Hug-Content Modes 1-5 & Transient HUD Wake */}
              <motion.div
                data-island-view="idle"
                initial={false}
                animate={{
                  opacity: isExpandedView || isPureTucked ? 0 : 1,
                }}
                transition={
                  isPureTucked
                    ? { duration: 0 }
                    : isExpandedView
                    ? { duration: 0.06, ease: 'easeIn' }
                    : { duration: 0.10, delay: 0.05, ease: 'easeOut' }
                }
                className={`absolute inset-0 w-full h-full mx-auto flex items-center justify-center shrink-0 overflow-clip ${
                  isExpandedView ? 'z-10' : 'z-20'
                } ${isPureTucked ? 'pointer-events-none invisible' : ''}`}
                style={{
                  overflow: 'clip',
                  pointerEvents: isExpandedView || isPureTucked ? 'none' : 'auto',
                }}
              >
                <IdlePillView
                  isDualBubble={hasSecondaryBubble}
                  isExpanded={isExpandedView}
                  isRestingSleep={isRestingSleep && !isKeepAwake}
                  isTucked={isPureTucked}
                  isTuckedPeek={islandState === 'tucked_peek'}
                  remeasureKey={fullscreenExitTick}
                  activeReminderAlert={visibleReminderAlert}
                  onSnoozeReminder={() => snoozeActiveReminder(5)}
                  onDismissReminder={() => dismissActiveReminder()}
                  onExpandSkill={handleExpandSkill}
                  onContentWidthChange={handleMeasuredPillWidth}
                />
              </motion.div>
            </div>
          </motion.div>
        </div>
      </div>

      {/* Detached Right Satellite Pill for <= 5m Reminder (Idle Mode, 36px height, max 168px width, 8px right of idle capsule) */}
      {showIdleReminderSatellite && visibleUpcomingReminderBadge && (() => {
        const satAccent = settings.theme === 'monochrome' ? '#FFFFFF' : '#FB7185';
        const satBorder =
          settings.theme === 'monochrome'
            ? 'rgba(255, 255, 255, 0.36)'
            : 'rgba(251, 113, 133, 0.42)';
        const satLeftPx = Math.round(width / 2 + ISLAND_DIMENSIONS.REMINDER_SATELLITE_GAP);
        const satTopPx = isFloatingMode ? ISLAND_DIMENSIONS.FLOATING_TOP_OFFSET + 1.5 : 1.5;

        return (
          <motion.button
            ref={reminderSatelliteElRef}
            type="button"
            data-reminder-satellite="true"
            initial={{ opacity: 0, scale: 0.92, x: -4 }}
            animate={{ opacity: 1, scale: 1, x: 0 }}
            transition={{ duration: 0.16, ease: [0.16, 1, 0.3, 1] }}
            onPointerDown={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => {
              e.stopPropagation();
              playChimeCue('tap');
              setIsPeeking(false);
              isPeekingRef.current = false;
              hoverSuppressedRef.current = false;
              modeRef.current = 'expanded_calendar';
              onChangeModeRef.current('expanded_calendar');
              islandStateRef.current = 'expanded';
              setIslandState('expanded');
              setIsLandingComplete(false);
            }}
            style={{
              top: satTopPx,
              left: `calc(50% + ${satLeftPx}px)`,
              borderColor: satBorder,
            }}
            className="pointer-events-auto absolute z-40 h-[36px] max-w-[168px] px-2.5 rounded-full bg-[#000000] border flex items-center gap-1.5 shadow-[0_8px_24px_rgba(0,0,0,0.72)] cursor-pointer hover:brightness-110 active:scale-95 transition-all select-none"
            title={`Segera dalam ${visibleUpcomingReminderBadge.remainingMinutes} menit: ${visibleUpcomingReminderBadge.title} — Klik untuk buka Jadwal`}
          >
            <CalendarDays
              className="w-3 h-3 shrink-0"
              style={{ color: satAccent }}
              aria-hidden="true"
            />
            <span
              style={{ color: satAccent }}
              className="font-mono text-[10.5px] font-bold tabular-nums leading-normal shrink-0"
            >
              {visibleUpcomingReminderBadge.remainingMinutes}m
            </span>
            <span className="text-[11px] font-medium text-white/90 truncate leading-normal">
              {visibleUpcomingReminderBadge.title}
            </span>
          </motion.button>
        );
      })()}
    </div>
  );
};
