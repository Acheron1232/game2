import { BinaryWriter, CommandType, entityTypeIndex, isWalkable, readSnapshot, SnapshotData, writeCommand, MsgId } from '@game/shared';
import { describe, expect, it } from 'vitest';
import { readSharedDataFile } from '../src/data-files';
import { MAX_COMMANDS_PER_SEC, MatchRunner } from '../src/match/match-runner';

const terrain = readSharedDataFile('map-terrain.bin');
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
    r.sim.heroes[0]!.hp = 0;
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
});
