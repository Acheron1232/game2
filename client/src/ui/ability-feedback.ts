import { BuffFlag, lv, UnitState } from '@game/shared';
import type { AbilityInfo } from '../game/match-client';
import { S } from './strings';

type Readiness = Pick<AbilityInfo, 'def' | 'level' | 'cooldownLeft' | 'enoughMana' | 'canLearn'>;

/** Checked both on the hotkey and on the target click: the caster may change in between. */
export function abilityBlockReason(info: Readiness, state: number, buffs: number): string | null {
  if (state & UnitState.Dead) return S.deadAbility;
  if (info.level === 0) return info.canLearn ? S.learn : S.notLearned;
  if (info.def.kind !== 'active') return S.passive;
  if (buffs & BuffFlag.Stun) return S.stunned;
  if (buffs & BuffFlag.Silence) return S.silenced;
  if (info.cooldownLeft > 0) return S.abilityNotReady;
  if (!info.enoughMana) return lv(info.def.params['healthCost'], info.level) ? S.noHealth : S.noMana;
  return null;
}
