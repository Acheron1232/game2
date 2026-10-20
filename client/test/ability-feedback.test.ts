import { ABILITIES, abilityIndex, BuffFlag, UnitState } from '@game/shared';
import { describe, expect, it } from 'vitest';
import { abilityBlockReason } from '../src/ui/ability-feedback';
import { S } from '../src/ui/strings';

describe('ability availability while aiming', () => {
  it('changes feedback when the caster is stunned, silenced or killed after aiming starts', () => {
    const info = { def: ABILITIES[abilityIndex('arcane_arrow')]!, level: 1, cooldownLeft: 0, enoughMana: true, canLearn: false };
    expect(abilityBlockReason(info, 0, 0)).toBeNull();
    expect(abilityBlockReason(info, 0, BuffFlag.Stun)).toBe(S.stunned);
    expect(abilityBlockReason(info, 0, BuffFlag.Silence)).toBe(S.silenced);
    expect(abilityBlockReason(info, UnitState.Dead, 0)).toBe(S.deadAbility);
    expect(abilityBlockReason(info, 0, 0)).toBeNull();
  });

  it('rechecks spent mana, health and cooldown before sending a target', () => {
    const info = { def: ABILITIES[abilityIndex('arcane_arrow')]!, level: 1, cooldownLeft: 0, enoughMana: false, canLearn: false };
    expect(abilityBlockReason(info, 0, 0)).toBe(S.noMana);
    expect(abilityBlockReason({ ...info, def: ABILITIES[abilityIndex('blood_bolt')]! }, 0, 0)).toBe(S.noHealth);
    expect(abilityBlockReason({ ...info, enoughMana: true, cooldownLeft: 0.5 }, 0, 0)).toBe(S.abilityNotReady);
  });
});
