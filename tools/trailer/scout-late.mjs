import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MatchRunner } from '../../server/src/match/match-runner.ts';
import { gameData, entityTypeIndex, ENTITY_TYPES } from '../../shared/src/index.ts';

const root = resolve(import.meta.dirname, '../..');
const out = `${root}/media/trailer-late60/source`;
await mkdir(out, { recursive: true });
const terrain = new Uint8Array(await readFile(`${root}/shared/data/map-terrain.bin`));
const { trees } = JSON.parse(await readFile(`${root}/shared/data/map-trees.json`, 'utf8'));
const seed = Number(process.env.TRAILER_SEED ?? 20261021);
const heroes = ['sky_dragon', 'arcane_huntress', 'stone_golem', 'blood_witch'];
const setup = {
  seed,
  watch: 1,
  slots: heroes.map((h, i) => ({ index: i, heroType: entityTypeIndex(h), team: i + 1, color: i, start: i, ai: 'hard', bot: true })),
};
const r = new MatchRunner(setup, terrain, trees);
const fights = [],
  cities = [];
let best = 0;
for (let tick = 0; tick < 36 * 60 * 20; tick++) {
  if (tick % 10 === 0) r.tick();
  else r.sim.step();
  if (r.sim.tick % 1200 === 0) {
    console.log(
      'Minute',
      r.sim.tick / 1200,
      r.sim.factions.list.map((f) => ({ tier: f.tier, buildings: f.buildings.size, army: f.supplyUsed, status: f.status })),
    );
  }
  if (r.sim.tick < 15 * 60 * 20 || r.sim.tick % 100) continue;
  const army = r.sim.entities.filter((e) => e.alive && e.owner < 4 && !e.building && !e.job);
  let winner;
  for (const e of army) {
    if (!e.targetId && !e.cast && !e.swing) continue;
    const nearby = army.filter((o) => Math.hypot(o.mover.x - e.mover.x, o.mover.y - e.mover.y) < 23);
    const teams = new Map();
    let fighting = 0;
    for (const o of nearby) {
      teams.set(o.team, (teams.get(o.team) ?? 0) + 1);
      if (o.targetId || o.swing || o.cast) fighting++;
    }
    const counts = [...teams.values()].sort((a, b) => b - a);
    if ((counts[1] ?? 0) < 4) continue;
    const score = counts[1] * 7 + fighting * 2 + nearby.length;
    if (!winner || score > winner.score)
      winner = {
        tick: r.sim.tick,
        x: e.mover.x,
        y: e.mover.y,
        score,
        count: nearby.length,
        opposing: counts,
        fighting,
        types: [...new Set(nearby.map((o) => ENTITY_TYPES[o.type]))],
      };
  }
  if (winner) {
    fights.push(winner);
    if (winner.score > best) {
      best = winner.score;
      console.log('Battle', winner);
    }
  }
  for (const f of r.sim.factions.list) {
    if (f.defeated || f.tier < 3) continue;
    const bs = r.sim.entities.filter((e) => e.alive && e.owner === f.slot && e.building?.done && ENTITY_TYPES[e.type] !== 'gold_mine');
    const hall = bs.find((e) => e.id === f.homeHallId);
    if (hall)
      cities.push({
        tick: r.sim.tick,
        x: hall.mover.x,
        y: hall.mover.y,
        slot: f.slot,
        score: bs.length * 10 + f.supplyUsed,
        buildings: bs.length,
        tier: f.tier,
      });
  }
  if (r.winnerTeam) break;
}
fights.sort((a, b) => b.score - a.score);
cities.sort((a, b) => b.score - a.score);
const selected = [];
for (const f of fights)
  if (selected.every((o) => Math.abs(o.tick - f.tick) > 1000)) {
    selected.push(f);
    if (selected.length === 8) break;
  }
const report = {
  seed,
  setup,
  cities: cities.slice(0, 8),
  fights: selected,
  endTick: r.sim.tick,
  winner: r.winnerTeam,
  map: gameData.map.name,
};
await writeFile(`${out}/scout.json`, JSON.stringify(report, null, 2));
console.log('SELECTED', JSON.stringify(report));
