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
  IDLE_PHYSICAL_HEIGHT: 39,
  IDLE_WINDOW_HEIGHT: 40,
  FOCUS_PEEK_WIDTH: 420,
  FOCUS_PEEK_HEIGHT: 84,
  EXPANDED_MUSIC_DEFAULT_WIDTH: 480,
  EXPANDED_MUSIC_DEFAULT_HEIGHT: 186,
  EXPANDED_MUSIC_LYRICS_WIDTH: 640,
  EXPANDED_MUSIC_LYRICS_HEIGHT: 192,
  EXPANDED_PRODUCTIVITY_WIDTH: 600,
  EXPANDED_PRODUCTIVITY_HEIGHT: 186,
  EXPANDED_CONTROL_WIDTH: 500,
  EXPANDED_CONTROL_HEIGHT: 186,
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
  const effectiveState: EffectiveIslandState =
    input.islandState === 'expanded' || input.islandState === 'idle_peek'
      ? 'expanded'
      : input.islandState === 'tucked' && !input.hasHudAlert && !input.isAlarmRinging
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
              : ISLAND_DIMENSIONS.EXPANDED_MUSIC_DEFAULT_WIDTH
          );
          expandedHeight = input.isLyricsOpen
            ? ISLAND_DIMENSIONS.EXPANDED_MUSIC_LYRICS_HEIGHT
            : ISLAND_DIMENSIONS.EXPANDED_MUSIC_DEFAULT_HEIGHT;
          expandedRadius = 22;
          break;
        case 'expanded_control':
          expandedWidth = snapEvenDimension(ISLAND_DIMENSIONS.EXPANDED_CONTROL_WIDTH);
          expandedHeight = ISLAND_DIMENSIONS.EXPANDED_CONTROL_HEIGHT;
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

  // effectiveState === 'idle' (includes 'idle', 'tucked_peek', and HUD/alarm wakeup while tucked)
  const safeMeasured = snapEvenDimension(Math.max(88, input.measuredPillWidth));
  const idleWidth = input.isAlarmRinging
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
