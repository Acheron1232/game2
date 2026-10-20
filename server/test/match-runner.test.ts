import {
  BinaryWriter,
  CommandType,
  ENTITY_TYPES,
  entityTypeIndex,
  EventType,
  isWalkable,
  readSnapshot,
  SnapshotData,
  UnitState,
  writeCommand,
  MsgId,
  type TreeList,
} from '@game/shared';
import { describe, expect, it } from 'vitest';
import { readSharedDataFile } from '../src/data-files';
import { MAX_COMMANDS_PER_SEC, MatchRunner } from '../src/match/match-runner';

const terrain = readSharedDataFile('map-terrain.bin');
const trees = (JSON.parse(new TextDecoder().decode(readSharedDataFile('map-trees.json'))) as { trees: TreeList }).trees;
const setup = {
  seed: 7,
  slots: [0, 1].map((i) => ({ index: i, heroType: entityTypeIndex('staff_warrior'), team: i + 1, color: i, start: i })),
};

describe('match runner', () => {
  it('drops bad commands and commands over the rate limit', () => {
    const r = new MatchRunner(setup, terrain);
    const w = new BinaryWriter(64);
    const hero = r.sim.heroes[0]!.mover;
    // Outside the map: the wire format clamps it to the edge, and the path ends on open ground.
    r.command(0, writeCommand(w, 1, { type: CommandType.Move, x: 9999, y: -5, queue: false }));
    // Garbage bytes and a wrong message id are ignored.
    r.command(0, new Uint8Array([MsgId.Command, 1]));
    r.command(0, new Uint8Array([99, 1, 2, 3]));
    r.tick();
    for (const [x, y] of hero.path) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(256);
      expect(y).toBeLessThanOrEqual(256);
    }
    expect(isWalkable(r.sim.nav, ...hero.path[hero.path.length - 1]!)).toBe(true);
    expect(r.sim.lastSeq[0]).toBe(1);
    // A hero that is not alive takes no orders.
    r.sim.heroes[0]!.alive = false;
    expect(r.sim.queueCommand(0, 2, { type: CommandType.Move, x: 100, y: 100, queue: false })).toBe(false);

    for (let i = 0; i < MAX_COMMANDS_PER_SEC + 15; i++) r.command(1, writeCommand(w, 100 + i, { type: CommandType.Stop }));
    r.tick();
    // Only the first 30 of this second ran; the rest were dropped.
    expect(r.sim.lastSeq[1]).toBe(100 + MAX_COMMANDS_PER_SEC - 1);
    expect(r.droppedCommands).toBeGreaterThanOrEqual(15);
  });

  it('a player only gets what its team can see', () => {
    const r = new MatchRunner(setup, terrain);
    const snap = new SnapshotData();
    const out = r.tick();
    const first = out.find((p) => p.slot === 0)!;
    const s = readSnapshot(first.data, snap);
    // Bases are far apart: slot 0 sees only its own hero.
    expect(s.spawnCount).toBe(1);
    expect(s.spawns[0]!.owner).toBe(0);
  });

  it('an offline player gets nothing, and a full snapshot on return', () => {
    const r = new MatchRunner(setup, terrain);
    r.tick();
    r.setOnline(1, false);
    expect(r.tick().some((p) => p.slot === 1)).toBe(false);
    r.setOnline(1, true);
    const back = r.tick().find((p) => p.slot === 1)!;
    const s = readSnapshot(back.data, new SnapshotData());
    expect(s.flags & 1).toBe(1);
    expect(s.spawnCount).toBe(1);
  });

  it('with factions: the own base, the faction block, and cut trees on a full snapshot', () => {
    const r = new MatchRunner(setup, terrain, trees);
    const s = readSnapshot(r.tick().find((p) => p.slot === 0)!.data, new SnapshotData());
    expect(s.hasFaction).toBe(true);
    expect(s.factions[0]).toMatchObject({ slot: 0, gold: 500, wood: 150, supplyUsed: 5, supplyCap: 12, tier: 1, workers: 5, army: 0 });
    const types = s.spawns.slice(0, s.spawnCount).map((sp) => ENTITY_TYPES[sp.type]);
    expect(types.filter((t) => t === 'worker').length).toBe(5);
    expect(types).toContain('town_hall');
    expect(types).toContain('gold_mine');
    // The enemy base is far away and not seen.
    expect(s.spawns.slice(0, s.spawnCount).every((sp) => sp.owner === 0 || ENTITY_TYPES[sp.type] === 'gold_mine')).toBe(true);
    // Run a while: workers go into the mine (hidden) and the faction block only comes on changes.
    let hidden = false;
    for (let i = 0; i < 200; i++)
      for (const p of r.tick())
        if (p.slot === 0) {
          const t = readSnapshot(p.data, new SnapshotData());
          for (let k = 0; k < t.updateCount; k++) if (t.updates[k]!.state & UnitState.Hidden) hidden = true;
        }
    expect(hidden).toBe(true);
    // A rejoin gets every cut tree again.
    r.sim.factions!.cutTrees.push(3, 9);
    r.setOnline(0, false);
    r.setOnline(0, true);
    const back = readSnapshot(r.tick().find((p) => p.slot === 0)!.data, new SnapshotData());
    const gone = back.events
      .slice(0, back.eventCount)
      .filter((e) => e.type === EventType.TreeGone)
      .map((e) => e.a);
    expect(gone).toEqual([3, 9]);
    expect(r.winnerTeam).toBe(0);
  });
});
