import React from 'react';

export type SkillId = string;

/**
 * Priority tiers for dynamic arbitrament on the island surfaces.
 * Numeric weights:
 * - idle: 0 (No active state or user engagement)
 * - ambient: 10 (Background passive data, e.g. music paused or low-key monitoring)
 * - active: 50 (Foreground tasks actively running, e.g. focus timer countdown, music playing)
 * - alert: 80 (Attention needed, e.g. timer finished, critical threshold reached)
 * - critical: 100 (Immediate system modal / override)
 */
export type SkillPriorityTier = 'idle' | 'ambient' | 'active' | 'alert' | 'critical';

export const PRIORITY_WEIGHTS: Record<SkillPriorityTier, number> = {
  idle: 0,
  ambient: 10,
  active: 50,
  alert: 80,
  critical: 100,
};

export interface SkillDisplayMetadata {
  id: SkillId;
  name: string;
  version: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
  category: 'productivity' | 'media' | 'utility' | 'system';
  author?: string;
}

export interface SkillVisualSlots<TState = unknown> {
  /**
   * Slot 1: Mini badge or ticker inside the Idle Pill (Height: 38px)
   */
  PillTeaser?: React.FC<{
    state: TState;
    onClick: () => void;
  }>;

  /**
   * Slot 2: Satellite circular bubble (36x36px) used in dual-bubble mode
   */
  BubbleTeaser?: React.FC<{
    state: TState;
    onClick: () => void;
  }>;

  /**
   * Slot 3: Full interactive expanded card view
   */
  ExpandedCard: React.FC<{
    state: TState;
    onCollapse: () => void;
    onUpdateState: (patchOrFn: Partial<TState> | ((prev: TState) => TState)) => void;
  }>;

  /**
   * Slot 4: Optional compact banner for HUD notifications
   */
  CompactBanner?: React.FC<{
    state: TState;
    onDismiss: () => void;
  }>;

  /**
   * Slot 5: Micro status header indicator rendered at the corner of expanded cards
   */
  MicroStatus?: React.FC<{
    state: TState;
  }>;
}

export interface SkillDimensionProfile {
  expanded: {
    width: number;
    height: number;
  };
  compact?: {
    width: number;
    height: number;
  };
}

export interface CasaSkill<TState = any> {
  manifest: SkillDisplayMetadata;
  dimensions: SkillDimensionProfile;
  slots: SkillVisualSlots<TState>;
  initialState: TState;

  /**
   * Determines the live priority tier based on current skill state.
   */
  getPriority: (state: TState) => SkillPriorityTier;

  /**
   * Lifecycle hook triggered when the skill is initialized in the runtime.
   * Can return a cleanup function.
   */
  onMount?: (
    getState: () => TState,
    setState: (patchOrFn: Partial<TState> | ((prev: TState) => TState)) => void
  ) => (() => void) | void;
}
