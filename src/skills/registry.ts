import { CasaSkill, SkillId } from './types';

class SkillRegistryClass {
  private skills: Map<SkillId, CasaSkill> = new Map();
  private listeners: Set<() => void> = new Set();

  public register(skill: CasaSkill): void {
    if (this.skills.has(skill.manifest.id)) {
      console.warn(`[SkillRegistry] Overwriting existing skill: ${skill.manifest.id}`);
    }
    this.skills.set(skill.manifest.id, skill);
    this.notify();
  }

  public unregister(id: SkillId): void {
    if (this.skills.delete(id)) {
      this.notify();
    }
  }

  public get(id: SkillId): CasaSkill | undefined {
    return this.skills.get(id);
  }

  public getAll(): CasaSkill[] {
    return Array.from(this.skills.values());
  }

  public subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((fn) => {
      try {
        fn();
      } catch (err) {
        console.error('[SkillRegistry] Error notifying listener:', err);
      }
    });
  }
}

export const SkillRegistry = new SkillRegistryClass();
