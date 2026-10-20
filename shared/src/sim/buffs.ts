// Buffs and debuffs: a short list on every entity. Each buff has an id; the same id from the same
// source refreshes its time instead of stacking (rules.json crowdControl.stackRule).
// Stats are rebuilt from the base stats + all buffs whenever the list changes.

import type { CombatStats } from './stats';

/** Bits sent to clients so they can show what is on a unit (placeholder looks in Phase 7b). */
export const BuffFlag = {
  Stun: 1,
  Root: 2,
  Silence: 4,
  Slow: 8,
  /** damage block / reduction / can not die */
  Shield: 16,
  /** good effect from an ally (blessing, aura... only strong ones) */
  Blessed: 32,
  /** mana mark */
  Marked: 64,
  /** damage over time (bleed, burn, vines) */
  Burning: 128,
  Taunted: 256,
  /** Mountain Form: draw bigger */
  Big: 512,
  /** channeling a spell */
  Channel: 1024,
} as const;

export interface Buff {
  /** what it is (ability id, or "aura:<ability>") */
  id: string;
  sourceId: number;
  sourceOwner: number;
  sourceTeam: number;
  /** tick it ends (Infinity for passives) */
  until: number;
  flags: number;
  stun?: boolean;
  root?: boolean;
  silence?: boolean;
  /** less move speed in percent (the strongest slow counts) */
  slowPct?: number;
  moveSpeedPct?: number;
  attackSpeedPct?: number;
  bonusArmor?: number;
  /** all damage taken is cut by this percent (Iron Stance) */
  damageBlockPct?: number;
  /** all damage taken is cut by this percent (Stone Skin), multiplies with block */
  damageReductionPct?: number;
  spellReductionPct?: number;
  /** more spell damage taken (Mana Mark) */
  spellDamageTakenPct?: number;
  /** heal for this percent of attack damage dealt */
  lifeStealPct?: number;
  /** more attack damage (Howl) */
  damagePct?: number;
  hpRegen?: number;
  bonusMaxHpPct?: number;
  /** spell damage per second, dealt every half second */
  dps?: number;
  /** health can not go below this */
  minHp?: number;
  /** heal when the buff ends (Dawn Shield) */
  healAtEnd?: number;
  /** must attack this entity */
  tauntId?: number;
  /** enemies of the source can see this unit (Mana Mark) */
  reveal?: boolean;
  /** draw scale (Mountain Form) */
  scale?: number;
}

export function sumBuffs(buffs: readonly Buff[], key: keyof Buff): number {
  let s = 0;
  for (const b of buffs) {
    const v = b[key];
    if (typeof v === 'number') s += v;
  }
  return s;
}

export function maxBuff(buffs: readonly Buff[], key: keyof Buff): number {
  let s = 0;
  for (const b of buffs) {
    const v = b[key];
    if (typeof v === 'number' && v > s) s = v;
  }
  return s;
}

export function hasBuff(buffs: readonly Buff[], key: 'stun' | 'root' | 'silence' | 'reveal'): boolean {
  for (const b of buffs) if (b[key]) return true;
  return false;
}

export function buffFlags(buffs: readonly Buff[]): number {
  let f = 0;
  for (const b of buffs) f |= b.flags;
  return f;
}

/** Base stats + buffs. */
export function applyBuffs(base: CombatStats, buffs: readonly Buff[]): CombatStats {
  if (!buffs.length) return base;
  const s = { ...base };
  s.armor += sumBuffs(buffs, 'bonusArmor');
  const slow = Math.min(90, maxBuff(buffs, 'slowPct'));
  s.moveSpeed = base.moveSpeed * (1 + sumBuffs(buffs, 'moveSpeedPct') / 100) * (1 - slow / 100);
  const as = sumBuffs(buffs, 'attackSpeedPct');
  s.attackCooldown = base.attackCooldown / Math.max(0.2, 1 + as / 100);
  s.maxHp = base.maxHp * (1 + sumBuffs(buffs, 'bonusMaxHpPct') / 100);
  s.hpRegen = base.hpRegen + sumBuffs(buffs, 'hpRegen');
  const dmg = 1 + sumBuffs(buffs, 'damagePct') / 100;
  s.damageMin = base.damageMin * dmg;
  s.damageMax = base.damageMax * dmg;
  return s;
}
