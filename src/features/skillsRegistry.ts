import { SkillId } from '../skills/types';
import { mediaSkill } from '../skills/media/MediaSkill';
import { timerSkill } from '../skills/timer/timerSkill';
import { todoSkill } from '../skills/builtin/todoSkill';
import { SkillRegistry } from '../skills/registry';

export interface ActiveFeatureModule {
  id: SkillId;
  name: string;
  skill: typeof mediaSkill | typeof timerSkill | typeof todoSkill;
}

export const ACTIVE_SKILL_MODULES: ActiveFeatureModule[] = [
  { id: 'core.media', name: 'Music & Spotify', skill: mediaSkill },
  { id: 'core.timer', name: 'Focus Timer', skill: timerSkill },
  { id: 'core.todo', name: 'To-Do Tasks', skill: todoSkill },
];

/**
 * Returns the list of registered active skill IDs in cycle order.
 */
export function getRegisteredSkillIds(): SkillId[] {
  return ACTIVE_SKILL_MODULES.map((m) => m.id);
}

/**
 * Registers all active skill modules into the central SkillRegistry.
 */
export function registerActiveFeatures(): void {
  ACTIVE_SKILL_MODULES.forEach((module) => {
    SkillRegistry.register(module.skill);
  });
}
