import React from 'react';
import { SkillRegistry } from '../../skills/registry';
import { useSkillStore } from '../../skills/store';
import { SkillId } from '../../skills/types';

interface IslandExpandedSkillSlotProps {
  skillId: SkillId;
  onCollapse: () => void;
}

export const IslandExpandedSkillSlot: React.FC<IslandExpandedSkillSlotProps> = ({
  skillId,
  onCollapse,
}) => {
  const skill = SkillRegistry.get(skillId);
  const state = useSkillStore((s) => s.skillStates[skillId]);
  const updateSkillState = useSkillStore((s) => s.updateSkillState);

  if (!skill || !skill.slots.ExpandedCard) {
    return (
      <div className="w-full h-full flex items-center justify-center text-white/40 text-xs">
        Skill not found or lacks expanded card: {skillId}
      </div>
    );
  }

  const ExpandedComponent = skill.slots.ExpandedCard;

  return (
    <ExpandedComponent
      state={state}
      onCollapse={onCollapse}
      onUpdateState={(patchOrFn) => updateSkillState(skillId, patchOrFn)}
    />
  );
};

interface IslandBubbleSkillSlotProps {
  skillId: SkillId;
  onClick: () => void;
}

export const IslandBubbleSkillSlot: React.FC<IslandBubbleSkillSlotProps> = ({
  skillId,
  onClick,
}) => {
  const skill = SkillRegistry.get(skillId);
  const state = useSkillStore((s) => s.skillStates[skillId]);

  if (!skill || !skill.slots.BubbleTeaser) {
    return null;
  }

  const BubbleComponent = skill.slots.BubbleTeaser;

  return <BubbleComponent state={state} onClick={onClick} />;
};

interface IslandPillSkillSlotProps {
  skillId?: SkillId | null;
  onClick: () => void;
  fallback?: React.ReactNode;
}

export const IslandPillSkillSlot: React.FC<IslandPillSkillSlotProps> = ({
  skillId,
  onClick,
  fallback = null,
}) => {
  if (!skillId) return <>{fallback}</>;
  const skill = SkillRegistry.get(skillId);
  const state = useSkillStore((s) => s.skillStates[skillId]);

  if (!skill || !skill.slots.PillTeaser) {
    return <>{fallback}</>;
  }

  const PillComponent = skill.slots.PillTeaser;
  return <PillComponent state={state} onClick={onClick} />;
};
