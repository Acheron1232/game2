// Checks that the data files agree with each other (ids exist, level lists have the right
// length, the map uses known camp types, ...). Shapes are checked by the zod schemas;
// this file checks the links between files. Returns a list of problems (empty = good).

import type { GameData } from './index';

const SLOTS = ['Q', 'W', 'E', 'R', 'D', 'F'] as const;

export function validateGameData(d: GameData): string[] {
  const errors: string[] = [];
  const fail = (msg: string) => errors.push(msg);

  const hb = d.rules.heroBase;
  const xp = d.rules.experience.totalXpForLevel;
  if (xp.length !== hb.maxLevel) fail(`experience.totalXpForLevel: has ${xp.length} values, needs ${hb.maxLevel}`);
  if (xp.some((n, i) => i > 0 && n <= xp[i - 1]!)) fail('experience.totalXpForLevel: must grow at every level');
  for (const [name, steps] of [
    ['basicAbilityHeroLevels', hb.basicAbilityHeroLevels],
    ['ultimateHeroLevels', hb.ultimateHeroLevels],
  ] as const) {
    if (steps.some((n, i) => n < 1 || n > hb.maxLevel || (i > 0 && n <= steps[i - 1]!)))
      fail(`heroBase.${name}: levels must grow and stay between 1 and ${hb.maxLevel}`);
  }
  if (3 * hb.basicAbilityHeroLevels.length + hb.ultimateHeroLevels.length > hb.maxLevel)
    fail('heroBase: a max-level hero has fewer skill points than ability levels');

  const heroIds = new Set(d.heroes.map((h) => h.id));
  const abilityById = new Map(d.abilities.map((a) => [a.id, a]));
  if (d.abilities.length > 127) fail('abilities: more than 127 (cast events reserve index 127)');
  for (const a of d.abilities) {
    const effect = a.params['effect'];
    if (effect === undefined) continue;
    const base = typeof effect === 'string' ? abilityById.get(effect) : undefined;
    if (!base || base.params['effect'] !== undefined || base.kind !== a.kind || base.target !== a.target)
      fail(`ability ${a.id}: effect must name a base ability with the same kind and target`);
  }
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
    skills: d.skills,
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
      const want = a.params['innate']
        ? 1
        : (a.slot === 'R' ? d.rules.heroBase.ultimateHeroLevels : d.rules.heroBase.basicAbilityHeroLevels).length;
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

  const skillIds = new Set(d.skills.map((s) => s.id));
  for (const u of d.units) {
    for (const s of u.skills) if (!skillIds.has(s.id)) fail(`unit ${u.id}: skill ${s.id} has no name in skills.json`);
    for (const s of u.skills) {
      if (typeof s['summonUnit'] === 'string' && !unitById.has(s['summonUnit']))
        fail(`unit ${u.id}: unknown skill summon ${s['summonUnit']}`);
      const info = d.skills.find((x) => x.id === s.id);
      if (info?.kind === 'active' && !info.target) fail(`skill ${s.id}: an active skill needs a target (none or unit)`);
      if (info?.target === 'unit' && !info.targets) fail(`skill ${s.id}: a unit target needs targets (enemy or ally)`);
      if (info?.target === 'unit' && typeof s['range'] !== 'number') fail(`unit ${u.id}: skill ${s.id} needs a range`);
      if ((s['manaCost'] as number | undefined) && !(u.mana > 0)) fail(`unit ${u.id}: skill ${s.id} costs mana, the unit has none`);
    }
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
    for (const s of b.skills ?? []) if (!skillIds.has(s.id)) fail(`building ${b.id}: unknown skill ${s.id}`);
    for (const t of b.trains) if (!unitById.has(t)) fail(`building ${b.id}: trains unknown unit ${t}`);
    for (const r of b.requires) if (!buildingById.has(r)) fail(`building ${b.id}: unknown requirement ${r}`);
    if (b.upgradesTo && !buildingById.has(b.upgradesTo)) fail(`building ${b.id}: unknown upgradesTo ${b.upgradesTo}`);
    if (b.heroSummon && b.trains.length) fail(`building ${b.id}: a hero shrine trains no units`);
  }
  const shrines = d.buildings.buildings.filter((b) => b.heroSummon);
  if (shrines.length > 1) fail('buildings: more than one building with heroSummon');

  for (const it of d.items) {
    if (it.tier === 'consumable' && !it.charges) fail(`item ${it.id}: consumables need charges`);
    if (it.charges && (it.stackMax ?? 1) < it.charges) fail(`item ${it.id}: stackMax is smaller than charges`);
    if (it.active?.target === 'point' && !it.active.castRange) fail(`item ${it.id}: point items need castRange`);
    if (it.active?.sight && !unitById.has('watcher_ward')) fail(`item ${it.id}: needs the watcher_ward unit`);
    if (it.cost !== null && it.cost < it.value * d.rules.gold.sellFactor) fail(`item ${it.id}: sells for more than it costs`);
  }
  if (d.items.length > 255) fail('items: more than 255 (the network sends an item index as u8)');
  const sold = new Set(d.shops.flatMap((s) => s.items));
  for (const it of d.items) {
    if (!it.recipe) continue;
    let sum = it.recipe.fee;
    for (const cid of it.recipe.components) {
      const c = itemById.get(cid);
      if (!c || c.cost === null || cid === it.id) fail(`item ${it.id}: recipe part ${cid} is not a shop item`);
      else sum += c.cost;
    }
    if (it.cost !== sum) fail(`item ${it.id}: cost ${it.cost}, but parts + fee = ${sum}`);
    if (!sold.has(it.id)) fail(`item ${it.id}: a recipe item no shop sells`);
  }

  for (const s of d.shops) {
    for (const uid of Object.keys(s.mercenaryStock ?? {}))
      if (!s.mercenaries?.includes(uid)) fail(`shop ${s.id}: stock for a recruit outside its roster: ${uid}`);
    for (const uid of (s as { mercenaries?: string[] }).mercenaries ?? []) {
      const u = unitById.get(uid);
      if (!u) fail(`shop ${s.id}: unknown mercenary ${uid}`);
      else if (u.group !== 'mercenary' || !u.cost || u.supply === undefined)
        fail(`shop ${s.id}: ${uid} is not a mercenary with cost and supply`);
    }
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
    if (step.do === 'summon' && (step.what !== 'hero' || !shrines.length))
      fail(`ai build order: summon needs what "hero" and a hero shrine`);
  }
  for (const hid of heroIds) if (!d.ai.faction.factionHero.roles[hid]) fail(`ai faction hero: no role for ${hid}`);
  for (const hid of Object.keys(d.ai.faction.factionHero.roles)) if (!heroIds.has(hid)) fail(`ai faction hero: unknown hero ${hid}`);
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
