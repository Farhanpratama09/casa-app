import { create } from 'zustand';
import { CasaSkill, PRIORITY_WEIGHTS, SkillId, SkillPriorityTier } from './types';
import { SkillRegistry } from './registry';
import { getRegisteredSkillIds } from '../features/skillsRegistry';

interface SkillStoreState {
  skillStates: Record<SkillId, any>;
  cleanups: Record<SkillId, () => void>;

  // Dynamic Island Slot Allocation
  activeSkillId: SkillId | null;
  userSelectedSkillId: SkillId | null;
  primaryPillSkillId: SkillId | null;
  secondarySkillId: SkillId | null;
  secondaryBubbleSkillId: SkillId | null;
  activeExpandedSkillId: SkillId | null;

  // Actions
  initSkill: (skill: CasaSkill) => void;
  cleanupSkill: (id: SkillId) => void;
  updateSkillState: (
    id: SkillId,
    patchOrFn: any | ((prev: any) => any)
  ) => void;
  patchSkillState: (
    id: SkillId,
    patchOrFn: any | ((prev: any) => any)
  ) => void;
  setActiveExpandedSkill: (id: SkillId | null) => void;
  setActiveSkillId: (id: SkillId | null) => void;
  cycleActiveSkill: (direction: 1 | -1) => void;
  recalculateArbitration: () => void;
}

export const useSkillStore = create<SkillStoreState>((set, get) => ({
  skillStates: {},
  cleanups: {},
  activeSkillId: null,
  userSelectedSkillId: null,
  primaryPillSkillId: null,
  secondarySkillId: null,
  secondaryBubbleSkillId: null,
  activeExpandedSkillId: null,

  initSkill: (skill: CasaSkill) => {
    const { skillStates, cleanups } = get();
    const id = skill.manifest.id;

    // Set initial state if not already populated
    if (skillStates[id] === undefined) {
      set((state) => ({
        skillStates: { ...state.skillStates, [id]: skill.initialState },
      }));
    }

    // Run onMount lifecycle hook if defined
    if (skill.onMount && !cleanups[id]) {
      const getState = () => get().skillStates[id];
      const setState = (patchOrFn: any) => get().updateSkillState(id, patchOrFn);

      const cleanup = skill.onMount(getState, setState);
      if (typeof cleanup === 'function') {
        set((state) => ({
          cleanups: { ...state.cleanups, [id]: cleanup },
        }));
      }
    }

    get().recalculateArbitration();
  },

  cleanupSkill: (id: SkillId) => {
    const { cleanups } = get();
    if (cleanups[id]) {
      try {
        cleanups[id]();
      } catch (e) {
        console.error(`[SkillStore] Error in cleanup for ${id}:`, e);
      }
      set((state) => {
        const nextCleanups = { ...state.cleanups };
        delete nextCleanups[id];
        return { cleanups: nextCleanups };
      });
    }
  },

  updateSkillState: (id: SkillId, patchOrFn: any) => {
    set((state) => {
      const prev = state.skillStates[id];
      const next =
        typeof patchOrFn === 'function' ? patchOrFn(prev) : { ...prev, ...patchOrFn };

      return {
        skillStates: { ...state.skillStates, [id]: next },
      };
    });

    get().recalculateArbitration();
  },

  patchSkillState: (id: SkillId, patchOrFn: any) => {
    get().updateSkillState(id, patchOrFn);
  },

  setActiveExpandedSkill: (id: SkillId | null) => {
    set({ activeExpandedSkillId: id });
  },

  setActiveSkillId: (id: SkillId | null) => {
    set({
      userSelectedSkillId: id,
      activeSkillId: id,
      primaryPillSkillId: id,
    });
  },

  cycleActiveSkill: (direction: 1 | -1) => {
    const registeredSkills: SkillId[] = getRegisteredSkillIds();
    const currentId = get().activeSkillId || registeredSkills[0];
    const currentIndex = registeredSkills.indexOf(currentId);
    const validIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex =
      (validIndex + direction + registeredSkills.length) % registeredSkills.length;
    const nextId = registeredSkills[nextIndex];

    set({
      userSelectedSkillId: nextId,
      activeSkillId: nextId,
      primaryPillSkillId: nextId,
    });
  },

  recalculateArbitration: () => {
    const { skillStates, userSelectedSkillId } = get();
    const allSkills = SkillRegistry.getAll();

    if (allSkills.length === 0) return;

    // Evaluate priority scores for each registered skill
    const scoredSkills = allSkills.map((skill) => {
      const state = skillStates[skill.manifest.id] ?? skill.initialState;
      const tier: SkillPriorityTier = skill.getPriority(state);
      const weight = PRIORITY_WEIGHTS[tier] || 0;
      return { skill, tier, weight };
    });

    // Sort descending by priority weight
    scoredSkills.sort((a, b) => b.weight - a.weight);

    // If an alert candidate exists, it strictly preempts everything
    const alertCandidate = scoredSkills.find((s) => s.tier === 'alert');
    if (alertCandidate) {
      const alertId = alertCandidate.skill.manifest.id;
      const secondary = scoredSkills.find(
        (s) => s.skill.manifest.id !== alertId && s.weight > 0
      )?.skill.manifest.id ?? null;

      set({
        activeSkillId: alertId,
        primaryPillSkillId: alertId,
        secondarySkillId: secondary,
        secondaryBubbleSkillId: secondary,
      });
      return;
    }

    // Filter skills that have at least ambient priority (> 0)
    const activeCandidates = scoredSkills.filter((s) => s.weight > 0);

    // If user explicitly cycled or picked a skill, preserve that as primary unless idle
    let primary: SkillId | null = null;
    if (userSelectedSkillId) {
      primary = userSelectedSkillId;
    } else {
      primary = activeCandidates.length > 0 ? activeCandidates[0].skill.manifest.id : null;
    }

    const secondaryCandidates = activeCandidates.filter(
      (c) => c.skill.manifest.id !== primary
    );
    const secondary = secondaryCandidates.length > 0 ? secondaryCandidates[0].skill.manifest.id : null;

    set({
      activeSkillId: primary,
      primaryPillSkillId: primary,
      secondarySkillId: secondary,
      secondaryBubbleSkillId: secondary,
    });
  },
}));
