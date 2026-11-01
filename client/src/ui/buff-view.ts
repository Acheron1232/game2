// Buff icons for the HUD: the own hero's buff bar and the selected unit's panel.
// Heroes come with a full list from the server (hero block: what, from whom, time left).
// Other units only have the BuffFlag bits; those show as one icon per kind of effect.

import { abilityIndex, ABILITIES, BuffFlag, BUFF_KINDS, buffSourceId, gameData, itemIndex, ITEMS, TICK_RATE } from '@game/shared';
import type { HeroBuff } from '../game/net-entity';

export interface BuffView {
  /** stable id for the DOM (kind or flag) */
  key: string;
  icon: string | null;
  /** first letter when there is no icon */
  letter: string;
  harmful: boolean;
  /** seconds left, 0 = no end (auras) */
  left: number;
  /** how many of this buff (from different sources) */
  stacks: number;
  /** first line is the title */
  tooltip: string[];
}

interface AssetsLike {
  has(path: string): boolean;
  url(path: string): string;
}

/** Icons for effects that are not named after an ability or an item. */
const SPECIAL: Record<string, { name: string; icon: string; text: string }> = {
  stun: { name: 'Stunned', icon: 'boulder_toss', text: 'Can not move, attack or cast.' },
  taunt: { name: 'Taunted', icon: 'mountain_form', text: 'Must attack the one who taunted it.' },
  channel: { name: 'Channeling', icon: 'arcane_storm', text: 'Casting a long spell. Moving stops it.' },
  item_channel: { name: 'Channeling', icon: 'scroll_of_return', text: 'Using an item. Moving stops it.' },
  web: { name: 'Webbed', icon: 'vine_snare', text: 'Can not move.' },
  ward: { name: 'Ward', icon: 'smoke_bomb', text: 'A hidden eye that gives sight.' },
  magnetize: { name: 'Magnetized', icon: 'magnetize', text: 'Pulled by stone power.' },
  'earth-rolling': { name: 'Rolling', icon: 'rolling_boulder', text: 'Rolling forward.' },
  'earth-enchanted': { name: 'Enchanted', icon: 'enchant_remnant', text: 'Turned into a stone by magic.' },
  'earth-used-stone': { name: 'Stone used', icon: 'stone_remnant', text: 'A stone was used.' },
  'earth-stored-stones': { name: 'Stones', icon: 'stone_remnant', text: 'Stones ready to use.' },
};

/** Effects known only by their BuffFlag bit (army units, camp monsters). */
const FLAG_VIEWS: { flag: number; name: string; icon: string; harmful: boolean; text: string }[] = [
  { flag: BuffFlag.Stun, name: 'Stunned', icon: 'boulder_toss', harmful: true, text: 'Can not move, attack or cast.' },
  { flag: BuffFlag.Root, name: 'Rooted', icon: 'vine_snare', harmful: true, text: 'Can not move.' },
  { flag: BuffFlag.Silence, name: 'Silenced', icon: 'hex_bolt', harmful: true, text: 'Can not cast.' },
  { flag: BuffFlag.Slow, name: 'Slowed', icon: 'frost_nova', harmful: true, text: 'Moves slower.' },
  { flag: BuffFlag.Burning, name: 'Burning', icon: 'fire_breath', harmful: true, text: 'Takes damage over time.' },
  { flag: BuffFlag.Marked, name: 'Marked', icon: 'mana_mark', harmful: true, text: 'Takes more spell damage.' },
  { flag: BuffFlag.Taunted, name: 'Taunted', icon: 'mountain_form', harmful: true, text: 'Must attack the one who taunted it.' },
  { flag: BuffFlag.Magnetized, name: 'Magnetized', icon: 'magnetize', harmful: true, text: 'Pulled by stone power.' },
  { flag: BuffFlag.Shield, name: 'Shielded', icon: 'guardian_shield', harmful: false, text: 'Takes less damage.' },
  { flag: BuffFlag.Blessed, name: 'Blessed', icon: 'blessing', harmful: false, text: 'A strong spell from an ally.' },
  { flag: BuffFlag.Channel, name: 'Channeling', icon: 'arcane_storm', harmful: false, text: 'Casting a long spell.' },
  { flag: BuffFlag.Invisible, name: 'Hidden', icon: 'smoke_bomb', harmful: false, text: 'Enemies can not see it.' },
];

function iconOf(assets: AssetsLike, ...ids: string[]): string | null {
  for (const id of ids) if (id && assets.has(`icons/${id}.webp`)) return assets.url(`icons/${id}.webp`);
  return null;
}

/** Name, description and icon ids of a buff kind (index in BUFF_KINDS). */
export function describeBuff(kind: number): { name: string; text: string; iconIds: string[]; aura: boolean } {
  const id = BUFF_KINDS[kind] ?? '';
  const src = buffSourceId(kind);
  const special = SPECIAL[id];
  if (special) return { name: special.name, text: special.text, iconIds: [special.icon], aura: false };
  const aura = id.includes('aura:');
  if (id.startsWith('item')) {
    const def = ITEMS[itemIndex(src)];
    return { name: def?.name ?? src, text: def?.text ?? '', iconIds: [src], aura };
  }
  const ability = ABILITIES[abilityIndex(src)];
  if (ability) return { name: ability.name, text: ability.text, iconIds: [ability.id], aura };
  const skill = gameData.skills.find((s) => s.id === src);
  return { name: skill?.name ?? src, text: skill?.text ?? '', iconIds: [src], aura };
}

/** A hero's buffs from its hero block, grouped by kind (stacks), harmful ones first. */
export function heroBuffViews(list: readonly HeroBuff[], tick: number, assets: AssetsLike): BuffView[] {
  const out: BuffView[] = [];
  for (const b of list) {
    const left = Number.isFinite(b.end) ? Math.max(0, (b.end - tick) / TICK_RATE) : 0;
    if (Number.isFinite(b.end) && left <= 0) continue;
    const key = `${b.kind}${b.harmful ? 'h' : ''}`;
    const same = out.find((v) => v.key === key);
    if (same) {
      same.stacks++;
      same.left = Math.max(same.left, left);
      continue;
    }
    const d = describeBuff(b.kind);
    out.push({
      key,
      icon: iconOf(assets, ...d.iconIds),
      letter: d.name.charAt(0),
      harmful: b.harmful,
      left,
      stacks: 1,
      tooltip: [d.aura ? `${d.name} (aura)` : d.name, d.text, b.harmful ? 'From an enemy.' : 'From you or an ally.'].filter(Boolean),
    });
  }
  out.sort((a, b) => Number(b.harmful) - Number(a.harmful));
  return out;
}

/** Icons for the BuffFlag bits of a unit without a hero block. */
export function flagBuffViews(flags: number, assets: AssetsLike): BuffView[] {
  const out: BuffView[] = [];
  for (const f of FLAG_VIEWS) {
    if (!(flags & f.flag)) continue;
    out.push({
      key: `f${f.flag}`,
      icon: iconOf(assets, f.icon),
      letter: f.name.charAt(0),
      harmful: f.harmful,
      left: 0,
      stacks: 1,
      tooltip: [f.name, f.text],
    });
  }
  return out;
}

/** Item icons and tooltips of a hero's 6 slots (item index + 1, 0 = empty). */
export function heroItemViews(items: readonly number[], assets: AssetsLike): ({ icon: string | null; tooltip: string[] } | null)[] {
  return items.map((code) => {
    const def = code ? ITEMS[code - 1] : undefined;
    if (!def) return null;
    return { icon: iconOf(assets, def.id), tooltip: [def.name, def.text].filter(Boolean) };
  });
}
