// Runs the whole network path without a network: server sim -> ClientView snapshots -> client
// NetEntity + HeroPredictor, with fake one-way delay. The own hero must not need fixes when
// nothing unexpected happens, and must end where the server's hero ends.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BinaryWriter,
  buildMatchNav,
  ClientView,
  CommandType,
  entityTypeIndex,
  gameData,
  isHeroType,
  MatchSim,
  moveSpeedOf,
  parseTerrain,
  quantizePoint,
  readCommand,
  readSnapshot,
  SnapshotData,
  SnapshotWriter,
  TeamVision,
  writeCommand,
  BinaryReader,
  type GameCommand,
} from '@game/shared';
import { describe, expect, it } from 'vitest';
import { HeroPredictor } from '../src/game/hero-predictor';
import { NetEntity } from '../src/game/net-entity';

const terrain = parseTerrain(readFileSync(join(__dirname, '..', '..', 'shared', 'data', 'map-terrain.bin')));
const nav = buildMatchNav(terrain, gameData.map);

type Input = { at: number; dx: number; dy: number; queue?: boolean } | { at: number; learn: number };

function run(oneWayMs: number, jitterMs: number, clicks: Input[], endMs: number, start = 0) {
  const sim = new MatchSim(
    { seed: 3, noCamps: true, slots: [{ index: 0, heroType: entityTypeIndex('staff_warrior'), team: 1, color: 0, start }] },
    buildMatchNav(terrain, gameData.map),
  );
  const vision = new TeamVision(256);
  const view = new ClientView(0, 1);
  const sw = new SnapshotWriter();
  const w = new BinaryWriter(1024);
  const cw = new BinaryWriter(64);
  const snap = new SnapshotData();
  const ents = new Map<number, NetEntity>();
  let own: NetEntity | null = null;
  let pred: HeroPredictor | null = null;
  let seq = 0;
  // [arrival time, payload]
  const toServer: [number, Uint8Array][] = [];
  const toClient: [number, Uint8Array][] = [];
  const pose = { x: 0, y: 0, facing: 0, state: 0 };
  let rnd = 1;
  const jitter = () => {
    rnd = (rnd * 16807) % 2147483647;
    return (rnd / 2147483647) * jitterMs;
  };
  let lastArrival = 0;
  let lastCommandArrival = 0;
  const pending = [...clicks];
  // Client frames at ~120 fps, starting at a random phase vs the server ticks.
  for (let t = 0, frame = 3.7; t <= endMs; t++) {
    if (t > 0 && t % 50 === 0) {
      while (toServer.length && toServer[0]![0] <= t) {
        const r = new BinaryReader(toServer.shift()![1]);
        r.u8();
        const c = readCommand(r)!;
        sim.queueCommand(0, c.seq, c.cmd);
      }
      sim.step();
      if (sim.tick % 2 === 1) vision.update(sim.entities);
      // TCP keeps order: a message never arrives before the one sent before it.
      lastArrival = Math.max(lastArrival, t + oneWayMs + jitter());
      toClient.push([lastArrival, view.write(sim, vision, sw, w).slice()]);
    }
    while (toClient.length && toClient[0]![0] <= t) {
      const s = readSnapshot(toClient.shift()![1], snap);
      for (let i = 0; i < s.spawnCount; i++) {
        const e = new NetEntity(s.tick, s.spawns[i]!);
        ents.set(e.id, e);
        if (isHeroType(e.type) && e.owner === 0) {
          own = e;
          pred = new HeroPredictor(e.last.x, e.last.y, e.last.facing, moveSpeedOf(e.type), nav);
        }
      }
      for (let i = 0; i < s.updateCount; i++) ents.get(s.updates[i]!.id)?.apply(s.tick, s.updates[i]!);
      if (own && pred) {
        own.sample(s.tick, pose);
        pred.reconcile(s.predictionSeq, s.ticksSinceAck, pose.x, pose.y);
      }
    }
    if (t >= frame) {
      frame += 1000 / 120;
      if (pred && pending.length && pending[0]!.at <= t) {
        const c = pending.shift()!;
        let cmd: GameCommand;
        if ('learn' in c) cmd = { type: CommandType.Learn, slot: c.learn };
        else {
          const [x, y] = quantizePoint(pred.mover.x + c.dx, pred.mover.y + c.dy);
          cmd = { type: CommandType.Move, x, y, queue: !!c.queue };
        }
        seq++;
        lastCommandArrival = Math.max(lastCommandArrival, t + oneWayMs + jitter());
        toServer.push([lastCommandArrival, writeCommand(cw, seq, cmd).slice()]);
        if (cmd.type === CommandType.Learn) pred.skip(seq);
        else pred.issue(seq, cmd);
      }
      pred?.advance(t);
    }
  }
  const hero = sim.heroes[0]!.mover;
  return { pred: pred!, server: { x: hero.x, y: hero.y, moving: hero.path.length > 0 } };
}

describe('client prediction against the server', () => {
  it.each([false, true])('ignores an older movement ack across learning and sequence wrap (deferred: %s)', (deferred) => {
    const [x, y] = gameData.map.starts[0]!.heroSpawn;
    const p = new HeroPredictor(x, y, 0, 3.2, nav);
    p.advance(0);
    p.issue(65535, { type: CommandType.Move, x: x + 8, y, queue: false });
    p.advance(60);
    if (deferred) p.reconcile(65535, 3, x - 5, y - 5);
    p.skip(1); // a Learn command between the two moves
    p.issue(2, { type: CommandType.Move, x, y: y - 8, queue: false });
    p.advance(160);
    if (!deferred) p.reconcile(65535, 3, x - 5, y - 5);
    expect(p.stats.corrections).toBe(0);
    expect(p.stats.snaps).toBe(0);
  });

  it('keeps the movement clock when learning during a long walk', () => {
    const [sx, sy] = gameData.map.starts[1]!.heroSpawn;
    const { pred, server } = run(
      50,
      30,
      [{ at: 500, dx: 136 - sx, dy: 128 - sy }, ...Array.from({ length: 10 }, (_, i) => ({ at: 510 + i * 17, learn: i % 4 }))],
      60000,
      1,
    );
    expect(server.moving).toBe(false);
    expect(Math.hypot(pred.mover.x - server.x, pred.mover.y - server.y)).toBeLessThan(0.02);
    expect(pred.stats.snaps).toBe(0);
    expect(pred.stats.corrections).toBe(0);
  });
  const clicks = [
    { at: 500, dx: 12, dy: -8 },
    { at: 2600, dx: -9, dy: 6 },
    { at: 2900, dx: 4, dy: 10, queue: true },
    { at: 4000, dx: 15, dy: 3 },
  ];

  it('needs no fixes on a perfect network', () => {
    const { pred, server } = run(0, 0, clicks, 12000);
    expect(server.moving).toBe(false);
    expect(Math.hypot(pred.mover.x - server.x, pred.mover.y - server.y)).toBeLessThan(0.02);
    expect(pred.stats.snaps).toBe(0);
    expect(pred.stats.corrections).toBe(0);
  });

  it('stays in step with 100 ms ping and jitter', () => {
    const { pred, server } = run(50, 30, clicks, 12000);
    expect(server.moving).toBe(false);
    expect(Math.hypot(pred.mover.x - server.x, pred.mover.y - server.y)).toBeLessThan(0.02);
    expect(pred.stats.snaps).toBe(0);
    expect(pred.stats.corrections).toBe(0);
  });

  it.each([
    [0, 0, 0],
    [0, 50, 30],
    [1, 0, 0],
    [1, 50, 30],
    [2, 0, 0],
    [2, 50, 30],
    [3, 0, 0],
    [3, 50, 30],
  ])('settles after a long walk from base %i with %i ms one-way delay and %i ms jitter', (start, delay, jitter) => {
    const [sx, sy] = gameData.map.starts[start]!.heroSpawn;
    const { pred, server } = run(
      delay,
      jitter,
      [
        { at: 500, dx: 136 - sx, dy: 126 - sy },
        { at: 38000, dx: 10, dy: 3 },
      ],
      60000,
      start,
    );
    expect(server.moving).toBe(false);
    expect(Math.hypot(pred.mover.x - server.x, pred.mover.y - server.y)).toBeLessThan(0.02);
    expect(pred.stats.snaps).toBe(0);
    expect(pred.stats.corrections).toBe(0);
  });
});
