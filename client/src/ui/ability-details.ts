import { lv, type AbilityDef } from '@game/shared';

// Player-facing effects only. Projectile speeds and draw scales are not useful tooltip stats.
const LABELS: Record<string, string> = {
  damage: 'Damage',
  impactDamage: 'Impact damage',
  damagePerSec: 'Damage/s',
  burnDamagePerSec: 'Burn damage/s',
  damagePerWave: 'Damage/wave',
  heal: 'Heal',
  healPerSec: 'Heal/s',
  healAtEnd: 'Heal at end',
  duration: 'Duration',
  burnDuration: 'Burn time',
  channelTime: 'Channel time',
  rootDuration: 'Root time',
  stunDuration: 'Stun time',
  slowDuration: 'Slow time',
  tauntDuration: 'Taunt time',
  radius: 'Radius',
  tauntRadius: 'Taunt radius',
  length: 'Length',
  width: 'Width',
  angleDeg: 'Cone',
  minRange: 'Minimum distance',
  bonusArmor: 'Armor',
  bonusHpRegen: 'Health regen/s',
  bonusMaxHpPct: 'Max health',
  bonusSpellDamagePct: 'Extra spell damage taken',
  damageBlockPct: 'Damage blocked',
  damageReductionPct: 'Damage reduction',
  spellReductionPct: 'Spell damage reduction',
  slowPct: 'Slow',
  selfSlowPct: 'Self slow',
  moveSpeedPct: 'Move speed',
  attackSpeedPct: 'Attack speed',
  lifeStealPct: 'Life steal',
  chancePct: 'Chance',
  count: 'Summons',
  summonHp: 'Summon health',
  summonDamage: 'Summon damage',
  waves: 'Waves',
  knockback: 'Push distance',
  sideKnockback: 'Side push',
  minHp: 'Minimum health',
};

/** Numbers come from the same data and learned level as the server effect. */
export function abilityDetails(ability: AbilityDef, learned: number): string[] {
  const level = Math.max(1, learned);
  const parts: string[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const value = lv(ability.params[key], level);
    if (!value) continue;
    const unit = key.endsWith('Pct')
      ? '%'
      : key.endsWith('Duration') || key === 'duration' || key === 'channelTime'
        ? ' s'
        : key === 'angleDeg'
          ? '°'
          : '';
    parts.push(`${label} ${value}${unit}`);
  }
  const lines = learned ? [] : ['Level 1 preview'];
  for (let i = 0; i < parts.length; i += 3) lines.push(parts.slice(i, i + 3).join(' · '));
  return lines;
}
