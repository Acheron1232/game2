// Checks that the data files agree with each other (ids exist, level lists have the right
// length, the map uses known camp types, ...). Shapes are checked by the zod schemas;
// this file checks the links between files. Returns a list of problems (empty = good).

import type { GameData } from './index';

const SLOTS = ['Q', 'W', 'E', 'R'] as const;

export function validateGameData(d: GameData): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  const heroIds = new Set(d.heroes.map((h) => h.id));
  const abilityById = new Map(d.abilities.map((a) => [a.id, a]));
  const unitById = new Map(d.units.map((u) => [u.id, u]));
  const buildingById = new Map(d.buildings.buildings.map((b) => [b.id, b]));
  const neutralBuildingIds = new Set(d.buildings.neutralBuildings.map((b) => b.id));
  const itemById = new Map(d.items.map((i) => [i.id, i]));
  const shopIds = new Set(d.shops.map((s) => s.id));
  const campIds = new Set(d.camps.campTypes.map((c) => c.id));

  const lists: Record<string, { id: string }[]> = {
    heroes: d.heroes,
    abilities: d.abilities,
    units: d.units,
    buildings: d.buildings.buildings,
    items: d.items,
    camps: d.camps.campTypes,
    upgrades: d.upgrades.upgrades,
  };
  for (const [name, list] of Object.entries(lists)) {
    const seen = new Set<string>();
    for (const x of list) {
      if (seen.has(x.id)) fail(`${name}: duplicate id ${x.id}`);
      seen.add(x.id);
    }
  }

  // A number list must have one value per level.
  const checkLevels = (where: string, obj: Record<string, unknown>, maxLevel: number) => {
    for (const [k, v] of Object.entries(obj)) {
      if (Array.isArray(v) && v.every((n) => typeof n === 'number') && v.length !== maxLevel) {
        fail(`${where}.${k}: has ${v.length} values, needs ${maxLevel}`);
      }
    }
  };

  for (const h of d.heroes) {
    h.abilities.forEach((aid, i) => {
      const a = abilityById.get(aid);
      if (!a) return fail(`hero ${h.id}: unknown ability ${aid}`);
      if (a.hero !== h.id) fail(`ability ${aid}: belongs to ${a.hero}, but is listed on ${h.id}`);
      if (a.slot !== SLOTS[i]) fail(`ability ${aid}: slot ${a.slot}, expected ${SLOTS[i]}`);
      const want = a.slot === 'R' ? 1 : 3;
      if (a.maxLevel !== want) fail(`ability ${aid}: maxLevel ${a.maxLevel}, expected ${want}`);
      checkLevels(`ability ${aid}`, { castRange: a.castRange, manaCost: a.manaCost, cooldown: a.cooldown }, a.maxLevel);
      checkLevels(`ability ${aid}.params`, a.params, a.maxLevel);
      const summon = a.params['summonUnit'];
      if (typeof summon === 'string' && !unitById.has(summon)) fail(`ability ${aid}: unknown summon ${summon}`);
    });
  }
  for (const a of d.abilities) if (!heroIds.has(a.hero)) fail(`ability ${a.id}: unknown hero ${a.hero}`);

  const armorTypes = new Set<string>(d.rules.damageTable.armorTypes);
  for (const [atk, row] of Object.entries(d.rules.damageTable.attackTypes)) {
    for (const t of armorTypes) if (typeof (row as Record<string, number>)[t] !== 'number') fail(`damageTable.${atk}: missing ${t}`);
  }

  for (const u of d.units) {
    if (u.attackRange <= d.rules.combat.meleeRange + 0.3 && u.canHit.includes('air')) fail(`unit ${u.id}: a melee unit can not hit air`);
    if (u.level < 1 || u.level > d.rules.experience.xpForKillingUnitOfLevel.length) fail(`unit ${u.id}: level is outside the XP table`);
    if (u.group === 'faction') {
      const b = u.trainedAt ? buildingById.get(u.trainedAt) : undefined;
      if (!b) fail(`unit ${u.id}: unknown trainedAt ${u.trainedAt}`);
      else if (!b.trains.includes(u.id)) fail(`unit ${u.id}: ${b.id} does not list it in trains`);
      for (const r of u.requires ?? []) if (!buildingById.has(r)) fail(`unit ${u.id}: unknown requirement ${r}`);
      if (!u.cost || u.supply === undefined || u.buildTime === undefined)
        fail(`unit ${u.id}: faction units need cost, supply and buildTime`);
    }
  }

  for (const b of d.buildings.buildings) {
    for (const t of b.trains) if (!unitById.has(t)) fail(`building ${b.id}: trains unknown unit ${t}`);
    for (const r of b.requires) if (!buildingById.has(r)) fail(`building ${b.id}: unknown requirement ${r}`);
    if (b.upgradesTo && !buildingById.has(b.upgradesTo)) fail(`building ${b.id}: unknown upgradesTo ${b.upgradesTo}`);
  }

  for (const s of d.shops) {
    for (const iid of s.items) {
      const it = itemById.get(iid);
      if (!it) fail(`shop ${s.id}: unknown item ${iid}`);
      else if (it.cost === null) fail(`shop ${s.id}: sells drop-only item ${iid}`);
    }
  }

  for (const c of d.camps.campTypes) {
    for (const [uid] of c.monsters) {
      const u = unitById.get(uid);
      if (!u) fail(`camp ${c.id}: unknown monster ${uid}`);
      else if (u.group !== 'neutral') fail(`camp ${c.id}: ${uid} is not a neutral unit`);
    }
    if (!d.camps.dropTables[c.dropTable]) fail(`camp ${c.id}: unknown drop table ${c.dropTable}`);
  }
  for (const [name, t] of Object.entries(d.camps.dropTables)) {
    for (const [iid] of t.items) if (!itemById.has(iid)) fail(`drop table ${name}: unknown item ${iid}`);
  }

  for (const u of d.upgrades.upgrades) {
    if (u.cost.length !== u.maxLevel) fail(`upgrade ${u.id}: cost needs ${u.maxLevel} values`);
    if (u.requires.length !== u.maxLevel) fail(`upgrade ${u.id}: requires needs ${u.maxLevel} lists`);
    for (const lvl of u.requires) for (const r of lvl) if (!buildingById.has(r)) fail(`upgrade ${u.id}: unknown requirement ${r}`);
    checkLevels(`upgrade ${u.id}.effect`, u.effect, u.maxLevel);
  }

  for (const step of d.ai.faction.buildOrder) {
    if ((step.do === 'build' || step.do === 'upgrade') && !buildingById.has(step.what))
      fail(`ai build order: unknown building ${step.what}`);
    if (step.do === 'train' && !unitById.has(step.what)) fail(`ai build order: unknown unit ${step.what}`);
  }
  for (const [tier, mix] of Object.entries(d.ai.faction.unitMix)) {
    if (typeof mix === 'string') continue;
    let sum = 0;
    for (const [uid, share] of Object.entries(mix)) {
      if (!unitById.has(uid)) fail(`ai unit mix ${tier}: unknown unit ${uid}`);
      sum += share;
    }
    if (Math.abs(sum - 1) > 0.001) fail(`ai unit mix ${tier}: shares add up to ${sum}, need 1`);
  }
  for (const hid of heroIds) {
    const build = d.ai.heroBot.heroBuild[hid];
    if (!build) fail(`ai hero build: missing ${hid}`);
    for (const iid of build ?? []) if (!itemById.get(iid)?.cost) fail(`ai hero build ${hid}: ${iid} is not a shop item`);
  }

  const m = d.map;
  const inside = ([x, y]: [number, number]) =>
    x >= m.border.width && y >= m.border.width && x <= m.size.width - m.border.width && y <= m.size.height - m.border.width;
  if (m.starts.length !== d.rules.match.maxSlots) fail(`map has ${m.starts.length} start spots, rules want ${d.rules.match.maxSlots}`);
  for (const c of m.camps) {
    if (!campIds.has(c.type)) fail(`map camp ${c.id}: unknown camp type ${c.type}`);
    if (!inside(c.pos)) fail(`map camp ${c.id}: outside the map`);
  }
  for (const s of m.shops) {
    if (!shopIds.has(s.type)) fail(`map shop ${s.id}: unknown shop ${s.type}`);
    if (!neutralBuildingIds.has(s.type)) fail(`map shop ${s.id}: no neutral building ${s.type}`);
  }
  for (const f of m.fountains) if (!neutralBuildingIds.has(f.type)) fail(`map fountain ${f.id}: no neutral building ${f.type}`);
  for (const g of m.goldMines) if (!inside(g.pos)) fail(`map mine ${g.id}: outside the map`);

  return errors;
}
