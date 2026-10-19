// Fills number tables in docs/design/*.md from shared/data/*.json,
// so the docs never drift from the data. JSON is the source of truth.
//
// In a doc, write:   <!-- table:NAME -->  <!-- /table -->
// and this script puts the table between the two markers.
// Run: node tools/data/fill-doc-tables.mjs

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = (n) => JSON.parse(readFileSync(join(ROOT, 'shared', 'data', `${n}.json`), 'utf8'));
const rules = load('rules'),
  heroes = load('heroes').heroes,
  abilities = load('abilities').abilities;
const units = load('units').units,
  buildings = load('buildings').buildings,
  items = load('items').items;
const shops = load('shops').shops,
  camps = load('camps'),
  upgrades = load('upgrades').upgrades,
  map = load('map-layout');

const abilityById = new Map(abilities.map((a) => [a.id, a]));
const unitById = new Map(units.map((u) => [u.id, u]));
const itemById = new Map(items.map((i) => [i.id, i]));
const nameOf = (id) => unitById.get(id)?.name ?? buildings.find((b) => b.id === id)?.name ?? itemById.get(id)?.name ?? id;
const lv = (v) => (Array.isArray(v) ? v.join(' / ') : String(v));
const table = (head, rows) =>
  [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
const words = (k) => k.replace(/([A-Z])/g, ' $1').toLowerCase();

function heroStats() {
  const hb = rules.heroBase,
    at = rules.attributes;
  const rows = [];
  for (const h of heroes)
    for (const lvl of [1, 10]) {
      const st = Object.fromEntries(Object.entries(h.attributes).map(([k, [b, g]]) => [k, Math.floor(b + g * (lvl - 1))]));
      rows.push([
        lvl === 1 ? `**${h.name}**` : '',
        lvl,
        `${st.strength} / ${st.agility} / ${st.intelligence}`,
        hb.hp + h.hpBonus + st.strength * at.strength.hpPerPoint,
        hb.mana + st.intelligence * at.intelligence.manaPerPoint,
        (h.baseArmor + st.agility * at.agility.armorPerPoint).toFixed(1),
        h.baseDamage.map((d) => d + st[h.mainStat]).join('-'),
        h.attackRange,
        ((1 + (st.agility * at.agility.attackSpeedPctPerPoint) / 100) / h.attackCooldown).toFixed(2),
        h.moveSpeed,
      ]);
    }
  return table(['Hero', 'Lvl', 'Str / Agi / Int', 'HP', 'Mana', 'Armor', 'Damage', 'Range', 'Attacks/s', 'Speed'], rows);
}

function heroBase() {
  return table(
    ['Hero', 'Role', 'Main stat', 'Str (+/lvl)', 'Agi (+/lvl)', 'Int (+/lvl)', 'Attack', 'Moves'],
    heroes.map((h) => [
      h.name,
      h.role,
      h.mainStat,
      ...['strength', 'agility', 'intelligence'].map((k) => `${h.attributes[k][0]} (+${h.attributes[k][1]})`),
      h.attackRange > 2 ? `ranged ${h.attackRange}` : 'melee',
      h.movementLayer === 'ground' ? 'ground' : 'flying (low air)',
    ]),
  );
}

function heroAbilities(heroId) {
  const h = heroes.find((x) => x.id === heroId);
  return h.abilities
    .map((id) => {
      const a = abilityById.get(id);
      const head = `**${a.slot} — ${a.name}** (${a.kind}${a.target !== 'none' ? `, target: ${a.target}` : ''}) — ${a.text}`;
      const facts = [];
      if (a.castRange) facts.push(`range ${lv(a.castRange)}`);
      if (a.manaCost) facts.push(`mana ${lv(a.manaCost)}`);
      if (a.cooldown) facts.push(`cooldown ${lv(a.cooldown)} s`);
      if (a.castTime) facts.push(`cast time ${a.castTime} s`);
      const params = Object.entries(a.params).map(([k, v]) => `${words(k)} ${lv(v)}`);
      return `${head}\n- ${[...facts, ...params].join('; ')}`;
    })
    .join('\n\n');
}

function unitTable(group) {
  return table(
    ['Unit', 'Lvl', 'HP', 'Armor', 'Attack', 'Damage', 'Range', 'Hits', 'Speed', 'Cost (g/w)', 'Supply', 'Time', 'From', 'Needs', 'Bounty'],
    units
      .filter((u) => u.group === group)
      .map((u) => [
        u.name,
        u.level,
        u.hp,
        `${u.armor} ${u.armorType}`,
        u.attackType,
        u.damage.join('-'),
        u.attackRange,
        u.canHit.join('+'),
        `${u.moveSpeed}${u.movementLayer === 'air' ? ' (air)' : ''}`,
        u.cost ? `${u.cost.gold}/${u.cost.wood}` : '—',
        u.supply ?? '—',
        u.buildTime ?? '—',
        u.trainedAt ? nameOf(u.trainedAt) : '—',
        u.requires?.length ? u.requires.map(nameOf).join(', ') : '—',
        u.bounty.join('-'),
      ]),
  );
}

function buildingTable() {
  return table(
    ['Building', 'Tier', 'HP', 'Armor', 'Cost (g/w)', 'Time', 'Size', 'Supply', 'Trains', 'Needs'],
    buildings.map((b) => [
      b.name + (b.attack ? ` (attacks ${b.attack.damage.join('-')} ${b.attack.attackType}, range ${b.attack.attackRange})` : ''),
      b.tier,
      b.hp,
      b.armor,
      `${b.cost.gold}/${b.cost.wood}`,
      b.buildTime,
      b.footprint.join('×'),
      b.supplyGiven || '—',
      b.trains.length ? b.trains.map(nameOf).join(', ') : '—',
      b.requires.length ? b.requires.map(nameOf).join(', ') : '—',
    ]),
  );
}

function itemTable() {
  return table(
    ['Item', 'Tier', 'Cost', 'Sell', 'Effect'],
    items.map((i) => [i.name, i.tier, i.cost ?? 'drop only', Math.floor(i.value * rules.gold.sellFactor), i.text]),
  );
}

function shopTable() {
  return table(
    ['Shop', 'Where', 'Sells'],
    shops.map((s) => [s.name, map.shops.filter((m) => m.type === s.id).length + ' on the map', s.items.map(nameOf).join(', ')]),
  );
}

function campTable() {
  return table(
    ['Camp', 'Tier', 'Monsters', 'Total HP', 'Gold (avg)', 'XP', 'Respawn', 'Drops', 'On map'],
    camps.campTypes.map((c) => {
      let hp = 0,
        gold = 0,
        xp = 0;
      for (const [uid, n] of c.monsters) {
        const u = unitById.get(uid);
        hp += u.hp * n;
        gold += ((u.bounty[0] + u.bounty[1]) / 2) * n;
        xp += rules.experience.xpForKillingUnitOfLevel[u.level - 1] * n;
      }
      return [
        c.id,
        c.tier,
        c.monsters.map(([u, n]) => `${n}× ${nameOf(u)}`).join(', '),
        hp,
        Math.round(gold),
        xp,
        `${c.respawnSec} s`,
        `${camps.dropTables[c.dropTable].dropChancePct}% (${c.dropTable})`,
        map.camps.filter((m) => m.type === c.id).length,
      ];
    }),
  );
}

function dropTables() {
  return table(
    ['Table', 'Chance', 'Items (weight)'],
    Object.entries(camps.dropTables).map(([k, t]) => [k, `${t.dropChancePct}%`, t.items.map(([i, w]) => `${nameOf(i)} (${w})`).join(', ')]),
  );
}

function upgradeTable() {
  return table(
    ['Upgrade', 'Levels', 'Cost', 'Effect', 'Faction needs'],
    upgrades.map((u) => [
      u.name + (u.repeatable ? ` (repeat, cooldown ${u.cooldown} s)` : ''),
      u.maxLevel,
      lv(u.cost),
      u.text +
        ' ' +
        Object.entries(u.effect)
          .filter(([k]) => k !== 'affects')
          .map(([k, v]) => `${words(k)} ${lv(v)}`)
          .join(', '),
      u.requires.map((r, i) => `L${i + 1}: ${r.length ? r.map(nameOf).join(' + ') : '—'}`).join('; '),
    ]),
  );
}

function xpTable() {
  const e = rules.experience;
  return table(
    ['Level', ...e.totalXpForLevel.map((_, i) => i + 1)],
    [
      ['Total XP needed', ...e.totalXpForLevel],
      ['XP for killing a unit of this level', ...e.xpForKillingUnitOfLevel],
      [
        'XP for killing a hero of this level',
        ...e.totalXpForLevel.map((_, i) => e.xpForKillingHero.base + e.xpForKillingHero.perVictimLevel * i),
      ],
      ['Respawn time (s)', ...e.totalXpForLevel.map((_, i) => rules.respawn.heroBaseSec + rules.respawn.heroPerLevelSec * (i + 1))],
    ],
  );
}

function damageTable() {
  const t = rules.damageTable;
  return table(
    ['Attack \\ Armor', ...t.armorTypes],
    Object.entries(t.attackTypes).map(([k, row]) => [k, ...t.armorTypes.map((a) => `${Math.round(row[a] * 100)}%`)]),
  );
}

const TABLES = {
  'hero-base': heroBase,
  'hero-stats': heroStats,
  'units-faction': () => unitTable('faction'),
  'units-neutral': () => unitTable('neutral'),
  'units-summon': () => unitTable('summon'),
  buildings: buildingTable,
  items: itemTable,
  shops: shopTable,
  camps: campTable,
  'drop-tables': dropTables,
  upgrades: upgradeTable,
  xp: xpTable,
  damage: damageTable,
};
for (const h of heroes) TABLES[`abilities-${h.id}`] = () => heroAbilities(h.id);

const DOCS = join(ROOT, 'docs', 'design');
let filled = 0;
for (const f of readdirSync(DOCS).filter((f) => f.endsWith('.md'))) {
  const path = join(DOCS, f);
  const before = readFileSync(path, 'utf8');
  const after = before.replace(/<!-- table:([\w-]+) -->[\s\S]*?<!-- \/table -->/g, (_, name) => {
    if (!TABLES[name]) throw new Error(`${f}: unknown table "${name}"`);
    filled++;
    return `<!-- table:${name} -->\n${TABLES[name]()}\n<!-- /table -->`;
  });
  if (after !== before) writeFileSync(path, after);
}
console.log(`Filled ${filled} tables.`);
