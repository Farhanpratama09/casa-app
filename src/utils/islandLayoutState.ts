import { useSyncExternalStore } from 'react';
import type { IslandMode, IslandState } from '../types/island';

export type EffectiveIslandState = 'tucked' | 'idle' | 'expanded';

export const ISLAND_DIMENSIONS = {
  TUCKED_WIDTH: 120,
  TUCKED_HEIGHT: 4,
  TUCKED_SENSOR_WIDTH: 124,
  TUCKED_SENSOR_HEIGHT: 8,
  IDLE_MIN_AWAKE_WIDTH: 180,
  IDLE_HUD_MIN_WIDTH: 244,
  ALARM_BANNER_WIDTH: 360,
  PRAYER_BANNER_WIDTH: 256,
  EXPANDED_ALERT_BANNER_EXTRA_HEIGHT: 28,
  IDLE_PHYSICAL_HEIGHT: 39,
  IDLE_WINDOW_HEIGHT: 40,
  FOCUS_PEEK_WIDTH: 420,
  FOCUS_PEEK_HEIGHT: 84,
  EXPANDED_MUSIC_DEFAULT_WIDTH: 480,
  EXPANDED_MUSIC_FIVE_TAB_WIDTH: 540,
  EXPANDED_MUSIC_DEFAULT_HEIGHT: 186,
  EXPANDED_MUSIC_LYRICS_WIDTH: 640,
  EXPANDED_MUSIC_LYRICS_HEIGHT: 192,
  EXPANDED_PRODUCTIVITY_WIDTH: 600,
  EXPANDED_PRODUCTIVITY_HEIGHT: 186,
  EXPANDED_CONTROL_WIDTH: 500,
  EXPANDED_CONTROL_FIVE_TAB_WIDTH: 540,
  EXPANDED_CONTROL_HEIGHT: 186,
  EXPANDED_IBADAH_WIDTH: 560,
  EXPANDED_IBADAH_HEIGHT: 186,
  EXPANDED_DROPZONE_WIDTH: 580,
  EXPANDED_DROPZONE_HEIGHT: 192,
  POST_FULLSCREEN_HOVER_COOLDOWN_MS: 450,
} as const;

export function snapEvenDimension(value: number): number {
  return Math.ceil(value / 2) * 2;
}

export interface IslandLayoutInput {
  islandState: IslandState;
  expandedMode: IslandMode;
  measuredPillWidth: number;
  isFloatingMode: boolean;
  hasHudAlert: boolean;
  isAlarmRinging: boolean;
  isPrayerAlertActive?: boolean;
  isIbadahEnabled?: boolean;
  isRestingSleep: boolean;
  isLyricsOpen: boolean;
  isFocusHoverPeek: boolean;
}

export interface EffectiveIslandLayout {
  effectiveState: EffectiveIslandState;
  width: number;
  height: number;
  topPx: number;
  hitboxTopOffset: number;
  isTucked: boolean;
  isExpandedView: boolean;
  bottomCornerRadius: number;
  topCornerRadius: number;
}

/**
 * Single source of truth deriving visual state, capsule geometry, top offset,
 * and layer flags from one unified `effectiveState` ('tucked' | 'idle' | 'expanded').
 * Prevents cross-state width/height desyncs (e.g. Mode 6 width cropped to 39px idle height).
 */
export function resolveEffectiveIslandLayout(
  input: IslandLayoutInput
): EffectiveIslandLayout {
  const isPrayerAlert = Boolean(input.isPrayerAlertActive);
  const isIbadahEnabled = Boolean(input.isIbadahEnabled);
  const hasPriorityAlert = input.isAlarmRinging || isPrayerAlert;

  const effectiveState: EffectiveIslandState =
    input.islandState === 'expanded' || input.islandState === 'idle_peek'
      ? 'expanded'
      : input.islandState === 'tucked' && !input.hasHudAlert && !hasPriorityAlert
      ? 'tucked'
      : 'idle';

  const userTopOffset = input.isFloatingMode ? 12 : 0;
  const userCssTop = input.isFloatingMode ? 12 : -1;

  if (effectiveState === 'tucked') {
    return {
      effectiveState: 'tucked',
      width: snapEvenDimension(ISLAND_DIMENSIONS.TUCKED_WIDTH),
      height: ISLAND_DIMENSIONS.TUCKED_HEIGHT,
      topPx: 0,
      hitboxTopOffset: 0,
      isTucked: true,
      isExpandedView: false,
      bottomCornerRadius: 9999,
      topCornerRadius: 0,
    };
  }

  if (effectiveState === 'expanded') {
    let expandedWidth: number;
    let expandedHeight: number;
    let expandedRadius: number;

    if (input.islandState === 'idle_peek' && input.isFocusHoverPeek) {
      expandedWidth = snapEvenDimension(ISLAND_DIMENSIONS.FOCUS_PEEK_WIDTH);
      expandedHeight = ISLAND_DIMENSIONS.FOCUS_PEEK_HEIGHT;
      expandedRadius = 20;
    } else {
      switch (input.expandedMode) {
        case 'expanded_music':
          expandedWidth = snapEvenDimension(
            input.isLyricsOpen
              ? ISLAND_DIMENSIONS.EXPANDED_MUSIC_LYRICS_WIDTH
              : isIbadahEnabled
              ? ISLAND_DIMENSIONS.EXPANDED_MUSIC_FIVE_TAB_WIDTH
              : ISLAND_DIMENSIONS.EXPANDED_MUSIC_DEFAULT_WIDTH
          );
          expandedHeight = input.isLyricsOpen
            ? ISLAND_DIMENSIONS.EXPANDED_MUSIC_LYRICS_HEIGHT
            : ISLAND_DIMENSIONS.EXPANDED_MUSIC_DEFAULT_HEIGHT;
          expandedRadius = 22;
          break;
        case 'expanded_control':
          expandedWidth = snapEvenDimension(
            isIbadahEnabled
              ? ISLAND_DIMENSIONS.EXPANDED_CONTROL_FIVE_TAB_WIDTH
              : ISLAND_DIMENSIONS.EXPANDED_CONTROL_WIDTH
          );
          expandedHeight = ISLAND_DIMENSIONS.EXPANDED_CONTROL_HEIGHT;
          expandedRadius = 22;
          break;
        case 'expanded_ibadah':
          expandedWidth = snapEvenDimension(ISLAND_DIMENSIONS.EXPANDED_IBADAH_WIDTH);
          expandedHeight = ISLAND_DIMENSIONS.EXPANDED_IBADAH_HEIGHT;
          expandedRadius = 22;
          break;
        case 'expanded_timer':
        case 'expanded_todo':
          expandedWidth = snapEvenDimension(ISLAND_DIMENSIONS.EXPANDED_PRODUCTIVITY_WIDTH);
          expandedHeight = ISLAND_DIMENSIONS.EXPANDED_PRODUCTIVITY_HEIGHT;
          expandedRadius = 22;
          break;
        case 'drop_zone':
        default:
          expandedWidth = snapEvenDimension(ISLAND_DIMENSIONS.EXPANDED_DROPZONE_WIDTH);
          expandedHeight = ISLAND_DIMENSIONS.EXPANDED_DROPZONE_HEIGHT;
          expandedRadius = 22;
          break;
      }

      if (isPrayerAlert && input.expandedMode !== 'expanded_ibadah') {
        expandedHeight += ISLAND_DIMENSIONS.EXPANDED_ALERT_BANNER_EXTRA_HEIGHT;
      }
    }

    return {
      effectiveState: 'expanded',
      width: expandedWidth,
      height: expandedHeight,
      topPx: userCssTop,
      hitboxTopOffset: userTopOffset,
      isTucked: false,
      isExpandedView: true,
      bottomCornerRadius: expandedRadius,
      topCornerRadius: input.isFloatingMode ? expandedRadius : 0,
    };
  }

  // effectiveState === 'idle' (includes 'idle', 'tucked_peek', and HUD/alarm/prayer wakeup while tucked)
  const safeMeasured = snapEvenDimension(Math.max(88, input.measuredPillWidth));
  const idleWidth = isPrayerAlert
    ? snapEvenDimension(Math.max(ISLAND_DIMENSIONS.PRAYER_BANNER_WIDTH, safeMeasured))
    : input.isAlarmRinging
    ? snapEvenDimension(Math.max(ISLAND_DIMENSIONS.ALARM_BANNER_WIDTH, safeMeasured))
    : input.islandState === 'tucked' && input.hasHudAlert
    ? snapEvenDimension(Math.max(safeMeasured, ISLAND_DIMENSIONS.IDLE_HUD_MIN_WIDTH))
    : !input.isRestingSleep || input.hasHudAlert
    ? snapEvenDimension(Math.max(safeMeasured, ISLAND_DIMENSIONS.IDLE_MIN_AWAKE_WIDTH))
    : safeMeasured;

  return {
    effectiveState: 'idle',
    width: idleWidth,
    height: ISLAND_DIMENSIONS.IDLE_PHYSICAL_HEIGHT,
    topPx: userCssTop,
    hitboxTopOffset: userTopOffset,
    isTucked: false,
    isExpandedView: false,
    bottomCornerRadius: 16,
    topCornerRadius: input.isFloatingMode ? 16 : 0,
  };
}

export interface SearchDrawerBoundsInput {
  centerOffsetX: number;
  capsuleWidth: number;
  capsuleHeight: number;
  topOffset: number;
  podWidth?: number;
  extraPopoverHeight?: number;
  windowHeight?: number;
}

export interface SearchDrawerBoundsRect {
  center_offset_x: number;
  top_offset: number;
  width: number;
  height: number;
}

/**
 * Computes the Win32 hit-test rectangle for the Left Search Satellite Pod,
 * dynamically expanding downward when an anchored SAVE TO PLAYLIST popover protrudes
 * below the base pod height while clamping inside the native overlay window height.
 */
export function computeSearchDrawerBounds(
  input: SearchDrawerBoundsInput
): SearchDrawerBoundsRect {
  const podWidth = input.podWidth ?? 204;
  const podOffsetX = Math.round(input.capsuleWidth / 2 + 10 + podWidth / 2);
  const podHitboxTop = input.topOffset + 14;
  const baseHeight = Math.max(140, input.capsuleHeight - 14);
  const extraHeight = Math.max(0, Math.ceil(input.extraPopoverHeight ?? 0));
  const windowHeight = input.windowHeight ?? 340;
  const maxHeight = Math.max(baseHeight, windowHeight - podHitboxTop - 2);

  return {
    center_offset_x: input.centerOffsetX - podOffsetX,
    top_offset: podHitboxTop,
    width: podWidth,
    height: Math.min(maxHeight, baseHeight + extraHeight),
  };
}

let searchDrawerExtraHeightPx = 0;
const searchDrawerListeners = new Set<() => void>();

export function setSearchDrawerExtraHeight(extraHeightPx: number): void {
  const normalized = Math.max(0, Math.min(180, Math.ceil(extraHeightPx)));
  if (normalized === searchDrawerExtraHeightPx) return;
  searchDrawerExtraHeightPx = normalized;
  searchDrawerListeners.forEach((listener) => listener());
}

export function getSearchDrawerExtraHeight(): number {
  return searchDrawerExtraHeightPx;
}

function subscribeSearchDrawerExtraHeight(listener: () => void): () => void {
  searchDrawerListeners.add(listener);
  return () => {
    searchDrawerListeners.delete(listener);
  };
}

export function useSearchDrawerExtraHeight(): number {
  return useSyncExternalStore(
    subscribeSearchDrawerExtraHeight,
    getSearchDrawerExtraHeight,
    getSearchDrawerExtraHeight
  );
}
