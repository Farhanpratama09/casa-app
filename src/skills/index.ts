import { SkillRegistry } from './registry';
import { useSkillStore } from './store';
import { registerActiveFeatures } from '../features/skillsRegistry';
import { timerSkill } from './builtin/timerSkill';
import { todoSkill } from './builtin/todoSkill';
import { mediaSkill } from './media/MediaSkill';

export * from './types';
export * from './registry';
export * from './store';
export * from './builtin/timerSkill';
export * from './builtin/todoSkill';
export * from './media/MediaSkill';

let isInitialized = false;

/**
 * Initializes the Universal Skills Engine and mounts registered built-in skills.
 */
export function initializeSkillsEngine(): void {
  if (isInitialized) return;
  isInitialized = true;

  // Register Built-in Skills via Features Registry
  registerActiveFeatures();

  // Initialize skills in reactive store
  const store = useSkillStore.getState();
  SkillRegistry.getAll().forEach((skill) => {
    store.initSkill(skill);
  });
}
