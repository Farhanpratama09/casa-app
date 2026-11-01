import React, { useState, useEffect, useLayoutEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import { IslandMode, CompactSubtype, HardwareMetrics, IslandState } from '../types/island';
import { IdlePillView } from './views/IdlePillView';
import { CompactStripView } from './views/CompactStripView';
import { DropZoneView } from './views/DropZoneView';
import { MicroStatusHeader } from './views/MicroStatusHeader';
import { IslandBubbleSkillSlot } from './shell/IslandSkillSlot';
import { MediaExpandedView } from '../features/media/MediaExpandedView';
import { TimerExpandedView } from '../features/timer/TimerExpandedView';
import { TodoExpandedView } from '../features/todo/TodoExpandedView';
import { SatelliteDisc } from './views/SatelliteDisc';
import { setSmartIgnoreCursorEvents, playChimeCue, adjustWindowSize, updateIslandHitbox } from '../utils/tauriBridge';
import { useSkillStore } from '../skills/store';
import {
  registerIslandTransitionHook,
  unregisterIslandTransitionHook,
  recordCanvasResizeCall,
} from '../utils/islandStressTester';

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

export const CasaIsland: React.FC<CasaIslandProps> = ({
  mode,
  compactSubtype,
  onChangeMode,
  isGamingMode,
  showDevTrigger = false,
  onToggleDevTrigger,
}) => {
  // Live Skill State from Central Skill Store
  const isMusicPlaying = useSkillStore((s) => {
    const media = s.skillStates['core.media'];
    if (media?.playbackSource === 'native') {
      return Boolean(media.isNativePlaying && media.nativeTrack);
    }
    return media?.song?.isPlaying ?? false;
  });
  const isTimerActive = useSkillStore(
    (s) => Boolean(s.skillStates['core.timer']?.isActive)
  );
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

  // Transition Guard & Anti-Spam Animation Lock (500ms safety window)
  const isTransitioningRef = useRef<boolean>(false);
  const transitionLockTimerRef = useRef<NodeJS.Timeout | null>(null);

  const lockTransition = (timeoutMs = 500) => {
    isTransitioningRef.current = true;
    if (transitionLockTimerRef.current) {
      clearTimeout(transitionLockTimerRef.current);
    }
    transitionLockTimerRef.current = setTimeout(() => {
      isTransitioningRef.current = false;
      transitionLockTimerRef.current = null;
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
  const isWakingUpRef = useRef<boolean>(false);
  const wakeUpTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isRestingSleepRef = useRef<boolean>(false);
  const hoverSuppressedRef = useRef<boolean>(false);
  const isCursorInsideRef = useRef<boolean>(false);
  const lastWindowResizeTimeRef = useRef<number>(0);
  const islandRef = useRef<HTMLDivElement>(null);
  const modeRef = useRef<IslandMode>(mode);
  const isDraggingFileRef = useRef<boolean>(false);
  const previousModeBeforeDragRef = useRef<IslandMode>('idle');

  // Auto-Sleep setelah 5.5 detik tanpa aktivitas kursor:
  // HAKIKAT RESTING: HANYA BOLEH AKTIF jika hening total: !isMusicPlaying && !isTimerActive
  const [isRestingSleep, setIsRestingSleep] = useState<boolean>(false);

  useEffect(() => {
    isRestingSleepRef.current = isRestingSleep;
  }, [isRestingSleep]);

  const resetRestingSleepTimer = useCallback(() => {
    if (restingSleepTimerRef.current) {
      clearTimeout(restingSleepTimerRef.current);
      restingSleepTimerRef.current = null;
    }
    // ISOLASI STATE GUARD: Timer resting HANYA BOLEH AKTIF jika islandState === 'idle' DAN hening total
    if (islandStateRef.current !== 'idle' || isMusicPlaying || isTimerActive) {
      isRestingSleepRef.current = false;
      setIsRestingSleep(false);
      return;
    }
    // Jika sudah dalam mode resting sleep, jangan reset atau bangunkan via hover/leave
    if (isRestingSleepRef.current) {
      return;
    }

    restingSleepTimerRef.current = setTimeout(() => {
      if (islandStateRef.current === 'idle' && !isMusicPlaying && !isTimerActive) {
        isCollapsingRef.current = true;
        isRestingSleepRef.current = true;
        setIsRestingSleep(true);
      }
      restingSleepTimerRef.current = null;
    }, 5500);
  }, [isMusicPlaying, isTimerActive]);

  // Sinkronisasi status aktivitas (musik / timer):
  // Jika ada aktivitas (isMusicPlaying || isTimerActive), matikan/pause timer auto-sleep 5.5s total.
  useEffect(() => {
    if (isMusicPlaying || isTimerActive) {
      isRestingSleepRef.current = false;
      setIsRestingSleep(false);
      if (restingSleepTimerRef.current) {
        clearTimeout(restingSleepTimerRef.current);
        restingSleepTimerRef.current = null;
      }
    } else if (islandStateRef.current === 'idle') {
      resetRestingSleepTimer();
    }
  }, [isMusicPlaying, isTimerActive, resetRestingSleepTimer]);

  // Initial countdown on mount
  useEffect(() => {
    resetRestingSleepTimer();
  }, [resetRestingSleepTimer]);

  useEffect(() => {
    modeRef.current = mode;
  }, [mode]);

  const IDLE_AWAKE_NO_MUSIC_WIDTH = 290;
  const IDLE_AWAKE_TIMER_ONLY_WIDTH = 350;
  const IDLE_AWAKE_WITH_MUSIC_WIDTH = 380;
  const TRUE_RESTING_WIDTH = 168;
  const TUCKED_WIDTH = 180;
  const TUCKED_SENSOR_WIDTH = 120;
  const TUCKED_SENSOR_HEIGHT = 10;
  const EXPANDED_WIDTH = 620;
  const EXPANDED_HEIGHT = 168;
  const IDLE_PHYSICAL_HEIGHT = 38;
  const IDLE_WINDOW_HEIGHT = 42; // 38px physical capsule + 4px tight buffer (anti browser tab block)

  const hasSecondaryBubble =
    isMusicPlaying ||
    secondaryBubbleSkillId !== null ||
    mode === 'dual_bubble' ||
    (mode as string) === 'dual_idle';
  const currentIdleWidth = isMusicPlaying
    ? IDLE_AWAKE_WITH_MUSIC_WIDTH
    : isTimerActive
    ? IDLE_AWAKE_TIMER_ONLY_WIDTH
    : isRestingSleep
    ? TRUE_RESTING_WIDTH
    : IDLE_AWAKE_NO_MUSIC_WIDTH;
  // Dynamic native canvas width in idle/resting mode (tight fit to free browser tab clicks on left & right):
  // - Mode Resting: 180px (height 42px)
  // - Mode Idle (Standard 290px): 310px (height 42px)
  // - Jendela 620px HANYA aktif saat status 'expanded' atau 'idle_peek'.
  const getActiveIdleWindowWidth = useCallback(() => {
    if (isRestingSleep || isRestingSleepRef.current) {
      return 180;
    }
    if (hasSecondaryBubble) {
      const baseW = isMusicPlaying
        ? IDLE_AWAKE_WITH_MUSIC_WIDTH
        : isTimerActive
        ? IDLE_AWAKE_TIMER_ONLY_WIDTH
        : IDLE_AWAKE_NO_MUSIC_WIDTH;
      return baseW + 96 + 12;
    }
    if (isTimerActive) {
      return IDLE_AWAKE_TIMER_ONLY_WIDTH + 20;
    }
    return 310;
  }, [isRestingSleep, hasSecondaryBubble, isMusicPlaying, isTimerActive]);

  const idleWindowWidth = getActiveIdleWindowWidth();

  const hasSecondaryBubbleRef = useRef<boolean>(hasSecondaryBubble);
  useEffect(() => {
    hasSecondaryBubbleRef.current = hasSecondaryBubble;
  }, [hasSecondaryBubble]);

  const idleWindowWidthRef = useRef<number>(idleWindowWidth);
  useEffect(() => {
    idleWindowWidthRef.current = idleWindowWidth;
  }, [idleWindowWidth]);

  // Window Size Coordinator Refs to avoid redundant Tauri IPC invocations
  const currentWinSizeRef = useRef<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });

  const isCollapsingRef = useRef<boolean>(false);

  const applyWindowSize = (w: number, h: number) => {
    const roundedW = Math.round(w);
    const roundedH = Math.round(h);
    if (
      currentWinSizeRef.current.width === roundedW &&
      currentWinSizeRef.current.height === roundedH
    ) {
      return;
    }
    currentWinSizeRef.current = { width: roundedW, height: roundedH };
    lastWindowResizeTimeRef.current = Date.now();
    recordCanvasResizeCall();
    // Option B: The native Win32 window is permanently locked at 620x250.
    // We update the active capsule hitbox in Rust backend, enabling the 50Hz poller
    // to dynamically toggle WS_EX_TRANSPARENT on the wings without any DWM swapchain hitch.
    updateIslandHitbox(roundedW, roundedH);
  };

  // Register stress testing hook
  useEffect(() => {
    registerIslandTransitionHook((targetState, targetMode, secondaryBubble) => {
      const targetW =
        targetState === 'tucked'
          ? TUCKED_SENSOR_WIDTH
          : EXPANDED_WIDTH;
      const targetH =
        targetState === 'expanded' || targetState === 'idle_peek'
          ? EXPANDED_HEIGHT + 10
          : targetState === 'tucked'
          ? (showDevTrigger ? 104 : TUCKED_SENSOR_HEIGHT)
          : IDLE_WINDOW_HEIGHT;

      // Rule: if growing, resize window IMMEDIATELY at t = 0 before visual state updates
      if (targetW > (currentWinSizeRef.current.width || 0)) {
        applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);
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
  }, [onChangeMode, showDevTrigger]);

  // Helper to map active skill to its default expanded mode
  const getEffectiveExpandedMode = (skillId: string | null): IslandMode => {
    if (skillId === 'core.timer') return 'expanded_timer';
    if (skillId === 'core.todo') return 'expanded_todo';
    return 'expanded_music';
  };

  // Determine effective mode to render when expanded or previewing
  const effectiveExpandedMode: IslandMode =
    mode === 'drop_zone'
      ? 'drop_zone'
      : mode.startsWith('expanded_')
      ? mode
      : getEffectiveExpandedMode(activeSkillId);

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

  // Dimensions Calculator for Dynamic Resting Capsule (168px), Compact Glance (280px), Normal Idle (440px), and Expanded (700px)
  const getIslandDimensions = (state: IslandState, targetMode: IslandMode = effectiveExpandedMode) => {
    if (state === 'tucked') {
      return { width: TUCKED_WIDTH, height: 8, cornerRadius: 4 };
    }
    if (state === 'tucked_peek') {
      const peekWidth = isMusicPlaying
        ? IDLE_AWAKE_WITH_MUSIC_WIDTH
        : isTimerActive
        ? IDLE_AWAKE_TIMER_ONLY_WIDTH
        : IDLE_AWAKE_NO_MUSIC_WIDTH;
      return {
        width: peekWidth,
        height: 38,
        cornerRadius: 20,
      };
    }
    if (state === 'idle') {
      return {
        width: currentIdleWidth,
        height: 38,
        cornerRadius: 20,
      };
    }
    // For 'idle_peek' and 'expanded':
    switch (targetMode) {
      case 'expanded_timer':
      case 'expanded_todo':
      case 'drop_zone':
      case 'expanded_music':
      default:
        return { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT, cornerRadius: 24 };
    }
  };

  const { width, height, cornerRadius } = getIslandDimensions(islandState, effectiveExpandedMode);

  const isExpandedView =
    islandState === 'expanded' ||
    islandState === 'idle_peek' ||
    mode === 'drop_zone' ||
    mode.startsWith('expanded_');

  // Dynamic Hover Sensor Dimensions: anti ghost trigger on tucked and resting
  const getSensorDimensions = () => {
    if (islandState === 'tucked') {
      return { width: TUCKED_SENSOR_WIDTH, height: TUCKED_SENSOR_HEIGHT };
    }
    if (islandState === 'idle' && isRestingSleep && isLandingComplete) {
      return { width: TRUE_RESTING_WIDTH, height: IDLE_PHYSICAL_HEIGHT };
    }
    if (isExpandedView || !isLandingComplete) {
      return { width: EXPANDED_WIDTH, height: EXPANDED_HEIGHT };
    }
    return { width, height };
  };

  const { width: sensorWidth, height: sensorHeight } = getSensorDimensions();

  // Secondary Bubble HANYA BOLEH dirender jika dan hanya jika pulau berada dalam status idle murni
  // dan pendaratan penyusutan pil utama telah selesai sempurna di lebar 396px.
  const shouldShowSecondaryBubble =
    hasSecondaryBubble &&
    !isExpandedView &&
    islandState === 'idle' &&
    isLandingComplete;

  // Initial Window Setup on Mount
  useEffect(() => {
    // Option B: Lock native Win32 window at 620x250 permanently to eliminate DWM ResizeBuffers hitch
    adjustWindowSize(620, 250);
    const initialW = idleWindowWidth;
    const initialH = showDevTrigger ? 104 : IDLE_WINDOW_HEIGHT;
    applyWindowSize(initialW, initialH);
  }, []);

  const prevIslandStateRef = useRef<IslandState>('idle');

  // Strict Lifecycle Sync for Native Win32 Window Canvas (runs before paint)
  useLayoutEffect(() => {
    const prevState = prevIslandStateRef.current;
    const wasExpanded =
      prevState === 'expanded' || prevState === 'idle_peek';

    try {
      if (islandState !== 'idle' || isExpandedView) {
        setIsLandingComplete(false);
      }

      if (islandState === 'tucked') {
        // SEDANG MENYUSUT: DILARANG KERAS mengecilkan jendela Win32 di frame 0 saat animasi mulai!
        // Biarkan jendela tetap di ukuran sebelumnya sampai onAnimationComplete selesai 100%.
        isCollapsingRef.current = true;
        return;
      }

      if (islandState === 'tucked_peek') {
        isCollapsingRef.current = false;
        applyWindowSize(getActiveIdleWindowWidth(), showDevTrigger ? 104 : IDLE_WINDOW_HEIGHT);
        return;
      }

      if (islandState === 'idle_peek' || islandState === 'expanded') {
        isCollapsingRef.current = false;
        const { width: targetW, height: targetH } = getIslandDimensions(islandState, effectiveExpandedMode);
        applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);
        return;
      }

      if (islandState === 'idle') {
        const curH = currentWinSizeRef.current.height;
        const curW = currentWinSizeRef.current.width || EXPANDED_WIDTH;
        const targetH = showDevTrigger ? 104 : IDLE_WINDOW_HEIGHT;
        const targetW = getActiveIdleWindowWidth();

        if (wasExpanded || isCollapsingRef.current || targetW < curW) {
          // SEDANG MENYUSUT (dari expanded ke idle, atau dari idle 310px ke resting 180px):
          // DILARANG memanggil applyWindowSize di frame 0!
          // Biarkan kanvas tetap sampai animasi menyusut selesai 100% di onAnimationComplete.
          isCollapsingRef.current = true;
          return;
        }

        // Jika membesar saat idle (misal bangun dari resting 180px ke idle 310px), perbesar kanvas jendela
        if (targetW > curW) {
          applyWindowSize(targetW, targetH);
        } else if (curH !== targetH) {
          applyWindowSize(curW, targetH);
        }
      }
    } finally {
      prevIslandStateRef.current = islandState;
    }
  }, [islandState, effectiveExpandedMode, showDevTrigger, hasSecondaryBubble, idleWindowWidth, getActiveIdleWindowWidth]);

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
    setIsPeeking(false);
    isPeekingRef.current = false;
    hoverSuppressedRef.current = true;
    lockTransition(500);
    isCollapsingRef.current = true;
    setIsLandingComplete(false);
    islandStateRef.current = 'idle';
    setIslandState('idle');
    setIsRestingSleep(false);
    playChimeCue('tap');
    onChangeMode(hasSecondaryBubble ? 'dual_bubble' : 'idle');
    resetRestingSleepTimer();
  }, [hasSecondaryBubble, onChangeMode, resetRestingSleepTimer]);

  // Helper to lock preview into permanent expanded state
  const handleLockExpanded = useCallback(() => {
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
    hoverSuppressedRef.current = false;
    setIsPeeking(false);
    isPeekingRef.current = false;
    if (islandStateRef.current === 'tucked' || islandStateRef.current === 'tucked_peek') {
      lockTransition(500);
      islandStateRef.current = 'idle';
      setIslandState('idle');
      setIsRestingSleep(false);
      resetRestingSleepTimer();
      playChimeCue('tap');
      return;
    }
    setIsLandingComplete(false);
    const targetMode = getEffectiveExpandedMode(activeSkillId);
    const { width: targetW, height: targetH } = getIslandDimensions('expanded', targetMode);
    applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);

    requestAnimationFrame(() => {
      islandStateRef.current = 'expanded';
      setIslandState('expanded');
      onChangeMode(targetMode);
      playChimeCue('tap');
    });
  }, [activeSkillId, onChangeMode, resetRestingSleepTimer, showDevTrigger]);

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
        lockTransition(500);
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
      const { width: targetW, height: targetH } = getIslandDimensions('expanded', targetMode);
      applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);

      requestAnimationFrame(() => {
        islandStateRef.current = 'expanded';
        setIslandState('expanded');
        onChangeMode(targetMode);
      });
    },
    [onChangeMode, resetRestingSleepTimer, showDevTrigger]
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
        lockTransition(500);
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

  const handleSecondaryBubbleClick = useCallback(() => {
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
    setIsPeeking(false);
    isPeekingRef.current = false;
    if (islandStateRef.current === 'tucked' || islandStateRef.current === 'tucked_peek') {
      lockTransition(500);
      islandStateRef.current = 'idle';
      setIslandState('idle');
      setIsRestingSleep(false);
      resetRestingSleepTimer();
      playChimeCue('tap');
      return;
    }
    const targetSkill = isTimerActive ? 'core.timer' : (secondaryBubbleSkillId || 'core.media');
    expandToSkill(targetSkill);
  }, [expandToSkill, secondaryBubbleSkillId, resetRestingSleepTimer, isTimerActive]);

  const handleHeaderClick = useCallback(
    (e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      // Jika masih dalam status intip / belum terkunci, klik harus MENGUNCI mekar
      if (isPeeking || isPeekingRef.current || islandState !== 'expanded') {
        handleLockExpanded();
      } else {
        // Hanya ciutkan ke idle jika status SUDAH terkunci di expanded
        collapseToIdle();
      }
    },
    [isPeeking, islandState, handleLockExpanded, collapseToIdle]
  );

  const handleSelectMode = useCallback(
    (newMode: IslandMode) => {
      if (isTransitioningRef.current) return;
      lockTransition(250);
      playChimeCue('tap');
      if (islandStateRef.current === 'idle_peek') {
        handleLockExpanded();
      }
      const targetSkill =
        newMode === 'expanded_timer'
          ? 'core.timer'
          : newMode === 'expanded_todo'
          ? 'core.todo'
          : 'core.media';
      useSkillStore.getState().setActiveSkillId(targetSkill);
      const { width: targetW, height: targetH } = getIslandDimensions(islandStateRef.current, newMode);
      applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);
      onChangeMode(newMode);
    },
    [showDevTrigger, onChangeMode, handleLockExpanded]
  );

  // Hover Interaction State Machine (Dual-Tier with ISOLASI MUTLAK & Exit-Gate Lock)
  const handleMouseEnter = useCallback(() => {
    isCursorInsideRef.current = true;

    // Redam Flap Sintetis: Abaikan event jika dipicu dalam jeda < 120ms pasca-resize jendela native Win32
    if (Date.now() - lastWindowResizeTimeRef.current < 120) {
      hoverSuppressedRef.current = true;
      return;
    }

    // EXIT-GATE LOCK: Selama gembok aktif pasca-ciut, dilarang keras memicu idle_peek atau tucked_peek
    if (hoverSuppressedRef.current) {
      return;
    }

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

    const currentState = islandStateRef.current;

    // 1. Status 'tucked' (minimize bar): Transisi responsif ke mode intip (tucked_peek) dalam 50ms
    if (currentState === 'tucked') {
      tuckedEnterTimerRef.current = setTimeout(() => {
        if (islandStateRef.current === 'tucked' && !hoverSuppressedRef.current) {
          setIsPeeking(true);
          isPeekingRef.current = true;
          setIsRestingSleep(false);
          islandStateRef.current = 'tucked_peek';
          setIslandState('tucked_peek');
          playChimeCue('tap');
        }
        tuckedEnterTimerRef.current = null;
      }, 50);
      return;
    }

    // 2. ISOLASI MUTLAK:
    // Selama status bernilai 'tucked_peek', event hover tingkat 2 (pembuka preview) DIBLOKIR TOTAL.
    if (currentState === 'tucked_peek') {
      setIsPeeking(true);
      isPeekingRef.current = true;
      return;
    }

    // 3. Status 'idle' (standard pill): Transisi responsif ke mode intip (idle_peek) dalam 60ms
    if (currentState === 'idle') {
      // WAKE-ON-CLICK ONLY: Saat isRestingSleep === true, matikan pemicu bangun dari onMouseEnter!
      // Kursor lewat atau diam di atas mata TIDAK BOLEH membangunkan CASA ke Idle.
      if (isRestingSleep || isRestingSleepRef.current) {
        return;
      }

      // Selama masa cooldown bangun dari resting (isWakingUpRef true), abaikan pemicu hover intip/mekar
      if (isWakingUpRef.current) {
        return;
      }

      intensiveHoverTimerRef.current = setTimeout(() => {
        if (
          islandStateRef.current === 'idle' &&
          !hoverSuppressedRef.current &&
          !isWakingUpRef.current &&
          !isRestingSleepRef.current
        ) {
          const targetMode = getEffectiveExpandedMode(activeSkillId);
          const { width: targetW, height: targetH } = getIslandDimensions('idle_peek', targetMode);
          applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);

          requestAnimationFrame(() => {
            if (
              islandStateRef.current === 'idle' &&
              !hoverSuppressedRef.current &&
              !isWakingUpRef.current &&
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
      }, 60);
      return;
    }

    // In 'idle_peek' or 'expanded', cursor movements stay within current state
  }, [isRestingSleep, activeSkillId, showDevTrigger]);

  const handleMouseMove = useCallback(() => {
    isCursorInsideRef.current = true;

    // EXIT-GATE LOCK: Selama gembok aktif pasca-ciut, dilarang keras memicu idle_peek atau tucked_peek
    if (hoverSuppressedRef.current) {
      return;
    }

    const currentState = islandStateRef.current;

    if (leaveTimeoutRef.current) {
      clearTimeout(leaveTimeoutRef.current);
      leaveTimeoutRef.current = null;
    }
    if (hoverLeaveTimerRef.current) {
      clearTimeout(hoverLeaveTimerRef.current);
      hoverLeaveTimerRef.current = null;
    }

    if (currentState === 'idle') {
      // WAKE-ON-CLICK ONLY: Saat isRestingSleep === true, matikan pemicu bangun dari onMouseMove!
      if (isRestingSleep || isRestingSleepRef.current) {
        return;
      }

      // Selama masa cooldown bangun dari resting, abaikan pemicu hover intip/mekar
      if (isWakingUpRef.current) {
        return;
      }

      if (!intensiveHoverTimerRef.current && !isCollapsingRef.current && !isTransitioningRef.current) {
        intensiveHoverTimerRef.current = setTimeout(() => {
          if (
            islandStateRef.current === 'idle' &&
            !hoverSuppressedRef.current &&
            !isWakingUpRef.current &&
            !isRestingSleepRef.current
          ) {
            const targetMode = getEffectiveExpandedMode(activeSkillId);
            const { width: targetW, height: targetH } = getIslandDimensions('idle_peek', targetMode);
            applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);

            requestAnimationFrame(() => {
              if (
                islandStateRef.current === 'idle' &&
                !hoverSuppressedRef.current &&
                !isWakingUpRef.current &&
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
        }, 60);
      }
    } else if (currentState === 'tucked') {
      if (!tuckedEnterTimerRef.current && !isCollapsingRef.current && !isTransitioningRef.current) {
        tuckedEnterTimerRef.current = setTimeout(() => {
          if (islandStateRef.current === 'tucked' && !hoverSuppressedRef.current) {
            setIsPeeking(true);
            isPeekingRef.current = true;
            isRestingSleepRef.current = false;
            setIsRestingSleep(false);
            islandStateRef.current = 'tucked_peek';
            setIslandState('tucked_peek');
            playChimeCue('tap');
          }
          tuckedEnterTimerRef.current = null;
        }, 50);
      }
    }
  }, [isRestingSleep]);

  const handleMouseLeave = useCallback(() => {
    isCursorInsideRef.current = false;
    hoverSuppressedRef.current = false;

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
      return;
    }
    if (currentState === 'expanded') {
      return;
    }

    // 1. Status 'tucked_peek':
    // REQUIREMENT 2: Hysteresis / debounce 180ms sebelum menutup kembali ke 'tucked'
    if (currentState === 'tucked_peek') {
      if (leaveTimeoutRef.current) {
        clearTimeout(leaveTimeoutRef.current);
      }
      leaveTimeoutRef.current = setTimeout(() => {
        // Cek kembali status saat timer habis:
        // Hanya tutup jika status masih 'tucked_peek' (belum diklik menjadi 'idle'/'expanded')
        if (islandStateRef.current === 'tucked_peek') {
          isCollapsingRef.current = true;
          setIsLandingComplete(false);
          islandStateRef.current = 'tucked';
          setIslandState('tucked');
          setIsPeeking(false);
          isPeekingRef.current = false;
        }
        leaveTimeoutRef.current = null;
      }, 180);
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
          setIsLandingComplete(false);
          setIsPeeking(false);
          isPeekingRef.current = false;
          islandStateRef.current = 'idle';
          setIslandState('idle');
          resetRestingSleepTimer();
        }
        hoverLeaveTimerRef.current = null;
      }, 180);
      return;
    }
  }, [resetRestingSleepTimer]);

  // Click Handler on Notch: One-Click Deterministic Inversion
  const handlePillClick = useCallback(
    (e: React.MouseEvent) => {
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
      if (isTransitioningRef.current) return;

      const currentState = islandStateRef.current;

      // Status 'tucked': Klik mengunci status menjadi 'idle' permanen
      if (currentState === 'tucked') {
        hoverSuppressedRef.current = true;
        setIsPeeking(false);
        isPeekingRef.current = false;
        lockTransition(500);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        resetRestingSleepTimer();
        playChimeCue('tap');
        return;
      }

      // Status 'tucked_peek':
      // REQUIREMENT 3: Klik saat 'tucked_peek' mengunci status menjadi 'idle' permanen
      if (currentState === 'tucked_peek') {
        hoverSuppressedRef.current = true;
        setIsPeeking(false);
        isPeekingRef.current = false;
        lockTransition(500);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        resetRestingSleepTimer();
        playChimeCue('tap');
        return;
      }

      // Status 'idle_peek':
      // KLIK SAAT PREVIEW = KUNCI STAY (EXPAND PERMANEN)
      if (currentState === 'idle_peek') {
        setIsPeeking(false);
        isPeekingRef.current = false;
        handleLockExpanded();
        return;
      }

      // Status 'idle':
      // WAKE-ON-CLICK: Jika dalam mode Resting (isRestingSleep true), klik kiri membangunkannya ke Idle
      if (currentState === 'idle') {
        if (isRestingSleep || isRestingSleepRef.current) {
          hoverSuppressedRef.current = true;
          isRestingSleepRef.current = false;
          setIsRestingSleep(false);
          isWakingUpRef.current = true;
          if (wakeUpTimerRef.current) {
            clearTimeout(wakeUpTimerRef.current);
          }
          wakeUpTimerRef.current = setTimeout(() => {
            isWakingUpRef.current = false;
            wakeUpTimerRef.current = null;
          }, 350);
          playChimeCue('tap');
          resetRestingSleepTimer();
          return;
        }
        lockTransition(500);
        handleLockExpanded();
        return;
      }

      // Status 'expanded':
      // Klik pada pill/header menciutkan kembali ke 'idle'
      if (currentState === 'expanded') {
        collapseToIdle();
        return;
      }
    },
    [handleLockExpanded, collapseToIdle, isRestingSleep, resetRestingSleepTimer]
  );

  // Right-Click Context Menu: Collapse if expanded/peeking, or tuck away into thin top line if idle/resting
  const handlePillContextMenu = useCallback(
    (e: React.MouseEvent) => {
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
        hoverSuppressedRef.current = true;
        lockTransition(500);
        isCollapsingRef.current = true;
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
        playChimeCue('whisper');
      } else if (currentState === 'tucked' || currentState === 'tucked_peek') {
        hoverSuppressedRef.current = true;
        lockTransition(500);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        resetRestingSleepTimer();
        playChimeCue('tap');
      }
    },
    [collapseToIdle, resetRestingSleepTimer]
  );

  // MouseDown Guard: Cancel pending hover timers immediately on press to prevent mid-click state collision
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
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
        hoverSuppressedRef.current = true;
        lockTransition(500);
        isCollapsingRef.current = true;
        setIsLandingComplete(false);
        islandStateRef.current = 'tucked';
        setIslandState('tucked');
        playChimeCue('whisper');
      } else if (currentState === 'tucked' || currentState === 'tucked_peek') {
        hoverSuppressedRef.current = true;
        lockTransition(500);
        isRestingSleepRef.current = false;
        setIsRestingSleep(false);
        islandStateRef.current = 'idle';
        setIslandState('idle');
        resetRestingSleepTimer();
        playChimeCue('tap');
      }
    }
  }, [resetRestingSleepTimer]);

  // Global click-outside & Escape listeners to collapse unpinned or active floating card
  useEffect(() => {
    const handleGlobalClick = (e: MouseEvent) => {
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
        if (currentState === 'expanded') {
          collapseToIdle();
        } else if (currentState === 'idle_peek') {
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
          collapseToIdle();
        } else if (currentState === 'idle_peek') {
          islandStateRef.current = 'idle';
          setIslandState('idle');
        } else if (currentState === 'tucked_peek') {
          islandStateRef.current = 'tucked';
          setIslandState('tucked');
          setIsPeeking(false);
          isPeekingRef.current = false;
        } else if (currentState === 'tucked') {
          setIsPeeking(false);
          isPeekingRef.current = false;
          lockTransition(500);
          islandStateRef.current = 'idle';
          setIslandState('idle');
          setIsRestingSleep(false);
          resetRestingSleepTimer();
          playChimeCue('tap');
        }
      }
    };

    window.addEventListener('mousedown', handleGlobalClick);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleGlobalClick);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [secondaryBubbleSkillId, showDevTrigger]);

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
      } else if ((isExpandedView || isPeeking) && effectiveExpandedMode !== 'drop_zone') {
        const modes: IslandMode[] = ['expanded_music', 'expanded_timer', 'expanded_todo'];
        const currentIdx = modes.indexOf(effectiveExpandedMode);
        const validIdx = currentIdx >= 0 ? currentIdx : 0;
        const nextIdx = (validIdx + dirStep + modes.length) % modes.length;
        const nextMode = modes[nextIdx];
        const targetSkill =
          nextMode === 'expanded_timer'
            ? 'core.timer'
            : nextMode === 'expanded_todo'
            ? 'core.todo'
            : 'core.media';
        useSkillStore.getState().setActiveSkillId(targetSkill);
        const { width: targetW, height: targetH } = getIslandDimensions('expanded', nextMode);
        applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);
        onChangeMode(nextMode);
      }
    },
    [isExpandedView, effectiveExpandedMode, showDevTrigger, onChangeMode]
  );

  // Wheel scroll on idle pill or expanded card to cycle active skills
  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      const direction = e.deltaY > 0 ? 'next' : 'prev';
      handleNavigate(direction);
    },
    [handleNavigate]
  );

  // Native Tauri Window File-Drop Listener for automatic DropZone morphing
  useEffect(() => {
    if (typeof window === 'undefined' || !('__TAURI_INTERNALS__' in window)) {
      return;
    }

    let unlisten: (() => void) | undefined;
    let isSubscribed = true;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (!isSubscribed) return;
        const payload = event.payload;

        if (payload.type === 'enter') {
          islandStateRef.current = 'expanded';
          setIslandState('expanded');
          isDraggingFileRef.current = true;
          if (modeRef.current !== 'drop_zone') {
            previousModeBeforeDragRef.current = modeRef.current;
          }
          const { width: targetW, height: targetH } = getIslandDimensions('expanded', 'drop_zone');
          applyWindowSize(targetW, showDevTrigger ? targetH + 70 : targetH);
          onChangeMode('drop_zone');
          playChimeCue('whisper');
        } else if (payload.type === 'leave') {
          if (!isDraggingFileRef.current) return;
          isDraggingFileRef.current = false;
          setStagedDroppedFile(null);
          if (modeRef.current === 'drop_zone') {
            collapseToIdle();
          }
        } else if (payload.type === 'drop') {
          isDraggingFileRef.current = false;
          playChimeCue('ding');
          const paths = payload.paths;
          if (paths && paths.length > 0) {
            const filePath = paths[0];
            const fileName = filePath.replace(/^.*[\\/]/, '') || filePath;
            setStagedDroppedFile(fileName);
          }

          if (dropTimeoutRef.current) {
            clearTimeout(dropTimeoutRef.current);
          }
          dropTimeoutRef.current = setTimeout(() => {
            collapseToIdle();
            setStagedDroppedFile(null);
            dropTimeoutRef.current = null;
          }, 1500);
        }
      })
      .then((unlistenFn) => {
        if (isSubscribed) {
          unlisten = unlistenFn;
        } else {
          unlistenFn();
        }
      })
      .catch((err) => {
        console.warn('[CasaIsland] Native onDragDropEvent registration failed:', err);
      });

    return () => {
      isSubscribed = false;
      if (unlisten) {
        unlisten();
      }
      if (dropTimeoutRef.current) {
        clearTimeout(dropTimeoutRef.current);
      }
    };
  }, [showDevTrigger, onChangeMode]);

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
      if (wakeUpTimerRef.current) clearTimeout(wakeUpTimerRef.current);
    };
  }, []);

  return (
    <div
      ref={islandRef}
      className="fixed top-0 left-1/2 -translate-x-1/2 flex items-start justify-center select-none z-40 pointer-events-none"
    >
      {/* Dynamic Hover Sensor Wrapper: Anti-Ghost Trigger on Tucked & Resting */}
      <div
        data-island-hover-sensor="true"
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
        className="relative flex items-start justify-center pointer-events-auto bg-transparent overflow-visible"
        style={{
          width: sensorWidth,
          height: sensorHeight,
        }}
      >
        {/* Main Hardware Notch Shell (Docked to Top Bezel) with Frosted Glass */}
        <motion.div
          data-island-container="true"
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
          onClick={handlePillClick}
          onContextMenu={handlePillContextMenu}
          animate={{
            width,
            height,
          }}
          transition={{
            type: 'spring',
            stiffness: 260,
            damping: 25,
            mass: 0.8,
          }}
          onAnimationComplete={() => {
            unlockTransition();
            if (isCollapsingRef.current) {
              isCollapsingRef.current = false;
              if (isCursorInsideRef.current) {
                hoverSuppressedRef.current = true;
              }
              doubleRaf(() => {
                if (islandStateRef.current === 'tucked') {
                  applyWindowSize(TUCKED_WIDTH, showDevTrigger ? 104 : 14);
                  isRestingSleepRef.current = false;
                  setIsRestingSleep(false);
                } else if (islandStateRef.current === 'idle') {
                  if (isRestingSleepRef.current) {
                    applyWindowSize(180, showDevTrigger ? 104 : 42);
                  } else {
                    const targetW = getActiveIdleWindowWidth();
                    const targetH = showDevTrigger ? 104 : 42;
                    applyWindowSize(targetW, targetH);
                  }
                }
              });
            }
            if (islandStateRef.current === 'idle' && !isExpandedView) {
              setIsLandingComplete((prev) => (prev ? prev : true));
            }
          }}
          style={{
            borderRadius: isExpandedView ? 24 : 20,
            overflow: 'hidden',
          }}
          className={`relative flex flex-col pointer-events-auto shrink-0 border border-white/[0.06] backdrop-blur-2xl ${
            islandState === 'tucked'
              ? 'bg-[#0D0E12]/90 shadow-[0_2px_10px_rgba(0,0,0,0.5)] hover:bg-[#0D0E12] cursor-pointer'
              : isExpandedView
              ? 'bg-[#0D0E12]/90 shadow-[0_20px_50px_rgba(0,0,0,0.6)]'
              : 'bg-[#0D0E12]/95 shadow-ambient cursor-pointer hover:shadow-ambient-glow'
          }`}
          title={
            islandState === 'tucked'
              ? 'CASA (Arahkan kursor untuk mengintip / Klik untuk membuka)'
              : undefined
          }
        >
          {/* Internal Content Animated with Stacked Absolute Layers (Zero Ghosting & Zero Unmount Jolt) */}
          <div className="relative w-full h-full overflow-hidden">
            {/* Layer 0: Tucked Stealth Notch Accent Line (Static Stacked Layer) */}
            <motion.div
              data-island-view="tucked"
              initial={false}
              animate={{
                opacity: islandState === 'tucked' ? 1 : 0,
              }}
              transition={{ duration: 0.10, ease: 'easeOut' }}
              className="absolute inset-0 w-full h-[8px] flex items-center justify-center pointer-events-none"
            >
              <div className="w-8 h-[2px] bg-white/30 rounded-full transition-colors" />
            </motion.div>

            {/* Layer 1: Expanded View (Static Stacked Layer - Fixed 620x168 Canvas to Prevent Reflow) */}
            <motion.div
              data-island-view="expanded"
              initial={false}
              animate={{
                opacity: isExpandedView ? 1 : 0,
              }}
              transition={
                isExpandedView
                  ? { duration: 0.12, delay: 0, ease: 'easeOut' }
                  : { duration: 0.12, ease: 'easeIn' }
              }
              onClick={(e) => {
                // KLIK SAAT PREVIEW = KUNCI STAY (EXPAND PERMANEN)
                if (islandStateRef.current === 'idle_peek') {
                  e.stopPropagation();
                  handleLockExpanded();
                  return;
                }
                e.stopPropagation();
              }}
              className={`absolute inset-0 top-0 left-1/2 -translate-x-1/2 w-[620px] h-[168px] flex flex-col justify-start overflow-hidden select-none ${
                isExpandedView ? 'z-20' : 'z-10'
              }`}
              style={{
                pointerEvents: isExpandedView ? 'auto' : 'none',
              }}
            >
              {effectiveExpandedMode !== 'drop_zone' && (
                <MicroStatusHeader
                  currentMode={effectiveExpandedMode}
                  onSelectMode={handleSelectMode}
                  onPrev={() => handleNavigate('prev')}
                  onNext={() => handleNavigate('next')}
                  isPlaying={isMusicPlaying}
                  batteryPct={metrics.batteryPct}
                  showDevTrigger={showDevTrigger}
                  onToggleDevTrigger={onToggleDevTrigger}
                  onHeaderClick={handleHeaderClick}
                  isPeekPreview={islandState === 'idle_peek'}
                />
              )}

              <div className="w-full flex-1 flex flex-col justify-center overflow-hidden">
                {effectiveExpandedMode === 'expanded_music' && (
                  <MediaExpandedView onCollapse={collapseToIdle} />
                )}

                {effectiveExpandedMode === 'expanded_timer' && (
                  <TimerExpandedView onCollapse={collapseToIdle} />
                )}

                {effectiveExpandedMode === 'expanded_todo' && (
                  <TodoExpandedView onCollapse={collapseToIdle} />
                )}

                {effectiveExpandedMode === 'drop_zone' && (
                  <DropZoneView stagedFile={stagedDroppedFile} />
                )}
              </div>
            </motion.div>

            {/* Layer 2: Idle View (Static Stacked Layer) */}
            <motion.div
              data-island-view="idle"
              initial={false}
              animate={{
                opacity: isExpandedView || islandState === 'tucked' ? 0 : 1,
              }}
              transition={
                isExpandedView || islandState === 'tucked'
                  ? { duration: 0.06, ease: 'easeIn' }
                  : { duration: 0.10, delay: 0.06, ease: 'easeOut' }
              }
              className={`absolute inset-0 top-0 left-1/2 -translate-x-1/2 w-full h-[38px] mx-auto flex items-center justify-center shrink-0 ${
                isExpandedView ? 'z-10' : 'z-20'
              }`}
              style={{
                pointerEvents: isExpandedView || islandState === 'tucked' ? 'none' : 'auto',
              }}
            >
              <IdlePillView
                isDualBubble={hasSecondaryBubble}
                isExpanded={isExpandedView}
                isRestingSleep={isRestingSleep}
                isTuckedPeek={islandState === 'tucked_peek'}
                onExpandSkill={handleExpandSkill}
              />
            </motion.div>
          </div>
        </motion.div>

        {/* Piringan Satelit Kanan (Natural Sibling Layout - Anti Desync / Zero Shift) */}
        <div
          className="w-0 flex-shrink-0 flex items-start justify-start overflow-visible pointer-events-none"
          style={{ height: IDLE_PHYSICAL_HEIGHT }}
        >
          <AnimatePresence>
            {shouldShowSecondaryBubble && (
              <motion.div
                data-island-bubble="secondary"
                initial={{ scale: 0.8, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                }}
                exit={{ opacity: 0, scale: 0.5, transition: { duration: 0.08, ease: 'easeIn' } }}
                transition={{
                  type: 'spring',
                  stiffness: 260,
                  damping: 25,
                  mass: 0.8,
                }}
                className="pointer-events-auto ml-[10px] shrink-0"
              >
                <SatelliteDisc onClick={handleSecondaryBubbleClick} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
};
