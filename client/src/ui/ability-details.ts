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

// Unit skills (skills.json names, numbers on the unit in units.json) use a few more keys.
const SKILL_LABELS: Record<string, string> = {
  ...LABELS,
  range: 'Range',
  damagePct: 'Damage bonus',
  manaCost: 'Mana',
  cooldown: 'Cooldown',
};

function unitOf(key: string): string {
  if (key.endsWith('Pct')) return '%';
  if (key.endsWith('Duration') || key === 'duration' || key === 'channelTime' || key === 'cooldown') return ' s';
  return key === 'angleDeg' ? '°' : '';
}

/** "90 / 150 / 210 / 270": every level. One number if it never changes. */
function perLevel(v: number | number[] | string | boolean | undefined, unit: string): string {
  if (!Array.isArray(v)) return typeof v === 'number' && v ? `${v}${unit}` : '';
  if (v.every((n) => n === v[0])) return v[0] ? `${v[0]}${unit}` : '';
  return v.join(' / ') + unit;
}

/** The numbers of every level of an ability, for looking at any hero (own, ally, enemy). */
export function abilityAllLevels(ability: AbilityDef): string[] {
  const parts: string[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const text = perLevel(ability.params[key], unitOf(key));
    if (text) parts.push(`${label} ${text}`);
  }
  const cost = [
    ['Mana', perLevel(ability.manaCost, '')],
    ['Health cost', perLevel(ability.params['healthCost'], '')],
    ['Cooldown', perLevel(ability.cooldown, ' s')],
    ['Range', perLevel(ability.castRange, '')],
  ]
    .filter(([, t]) => t)
    .map(([label, t]) => `${label} ${t}`);
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 2) lines.push(parts.slice(i, i + 2).join(' · '));
  if (cost.length) lines.push(cost.join(' · '));
  return lines;
}

/** Numbers of a unit skill (one level). */
export function skillDetails(skill: Record<string, unknown>): string[] {
  const parts: string[] = [];
  for (const [key, label] of Object.entries(SKILL_LABELS)) {
    const v = skill[key];
    if (typeof v === 'number' && v) parts.push(`${label} ${v}${unitOf(key)}`);
  }
  const lines: string[] = [];
  for (let i = 0; i < parts.length; i += 3) lines.push(parts.slice(i, i + 3).join(' · '));
  return lines;
}

/** Numbers come from the same data and learned level as the server effect. */
export function abilityDetails(ability: AbilityDef, learned: number): string[] {
  const level = Math.max(1, learned);
  const parts: string[] = [];
  for (const [key, label] of Object.entries(LABELS)) {
    const value = lv(ability.params[key], level);
    if (!value) continue;
    parts.push(`${label} ${value}${unitOf(key)}`);
  }
  const lines = learned ? [] : ['Level 1 preview'];
  for (let i = 0; i < parts.length; i += 3) lines.push(parts.slice(i, i + 3).join(' · '));
  return lines;
}
