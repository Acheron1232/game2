// What every player may know about a hero they can see: its items, its skill levels (so an
// aura or a passive shows on the model) and its buffs with the time left. Sent in a small block
// at the end of a snapshot, only when something changed.

import { gameData } from '../data/index';
import type { Buff } from '../sim/buffs';

/** Buff ids that do not come from an ability, a unit skill or an item. */
const EXTRA_BUFFS = [
  'stun',
  'channel',
  'taunt',
  'web',
  'howl',
  'ward',
  'item_channel',
  'magnetize',
  'earth-rolling',
  'earth-enchanted',
  'earth-used-stone',
  'earth-stored-stones',
];

/** Every buff id the game can make, in a fixed order (the same on the server and the client). */
export const BUFF_KINDS: readonly string[] = (() => {
  const ids: string[] = [];
  const seen = new Set<string>();
  const add = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    ids.push(id);
  };
  for (const a of gameData.abilities) {
    add(a.id);
    add(`aura:${a.id}`);
  }
  for (const s of gameData.skills) {
    add(s.id);
    add(`unit-aura:${s.id}`);
  }
  for (const it of gameData.items) {
    add(`item:${it.id}`);
    add(`item-aura:${it.id}`);
  }
  for (const id of EXTRA_BUFFS) add(id);
  return ids;
})();

const KIND_INDEX = new Map(BUFF_KINDS.map((id, i) => [id, i]));

/** Bit 15 of a sent buff kind: an enemy put it there (a debuff). */
export const BUFF_HARMFUL = 0x8000;
/** Ticks-left value of a buff with no end (auras, passives while they last). */
export const BUFF_ENDLESS = 0xffff;
/** At most this many buffs per hero are sent (the rest are rare and still show as markers). */
export const MAX_SENT_BUFFS = 16;

export function buffKindOf(id: string): number {
  return KIND_INDEX.get(id) ?? -1;
}

/** The ability, skill or item a buff comes from ("aura:crimson_pact" -> crimson_pact). */
export function buffSourceId(kind: number): string {
  const id = BUFF_KINDS[kind] ?? '';
  const colon = id.indexOf(':');
  return colon >= 0 ? id.slice(colon + 1) : id;
}

/** Hero data in the snapshot's hero block. */
export interface NetHeroInfo {
  id: number;
  /** 6 slots: item index + 1, 0 = empty */
  items: number[];
  abilityLevels: number[];
  /** pairs: kind (| BUFF_HARMFUL), ticks left (BUFF_ENDLESS = no end) */
  buffs: number[];
}

export function blankHeroInfo(): NetHeroInfo {
  return { id: 0, items: [0, 0, 0, 0, 0, 0], abilityLevels: [], buffs: [] };
}

/** Own passives ("passive:...") are the hero's skills, shown with its skills, not as buffs. */
function shownBuff(b: Buff): boolean {
  return !b.id.startsWith('passive:');
}

/**
 * Fills `out` for a hero and returns a number that changes when anything the client shows
 * changes. End times count in half seconds, so an effect renewed every tick (a zone, an aura
 * pulse) is re-sent at most twice a second.
 */
export function heroInfoOf(
  id: number,
  team: number,
  inventory: readonly ({ item: number } | null)[],
  abilityLevels: readonly number[],
  buffs: readonly Buff[],
  tick: number,
  out: NetHeroInfo,
): number {
  out.id = id;
  let h = 2166136261;
  const mix = (v: number) => {
    h = Math.imul(h ^ v, 16777619);
  };
  for (let i = 0; i < 6; i++) {
    const s = inventory[i];
    out.items[i] = s ? s.item + 1 : 0;
    mix(out.items[i]!);
  }
  out.items.length = 6;
  out.abilityLevels.length = abilityLevels.length;
  for (let i = 0; i < abilityLevels.length; i++) {
    out.abilityLevels[i] = abilityLevels[i]!;
    mix(abilityLevels[i]! + 100);
  }
  out.buffs.length = 0;
  for (const b of buffs) {
    if (out.buffs.length >= MAX_SENT_BUFFS * 2) break;
    if (!shownBuff(b)) continue;
    const kind = buffKindOf(b.id);
    if (kind < 0) continue;
    const code = kind | (b.sourceTeam !== team ? BUFF_HARMFUL : 0);
    const left = Number.isFinite(b.until) ? Math.max(0, Math.min(BUFF_ENDLESS - 1, b.until - tick)) : BUFF_ENDLESS;
    out.buffs.push(code, left);
    mix(code);
    mix(Number.isFinite(b.until) ? Math.floor(b.until / 10) : -1);
  }
  return h >>> 0;
}
