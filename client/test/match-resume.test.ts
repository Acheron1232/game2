import { BinaryWriter, entityTypeIndex, qPos, SnapshotFlag, SnapshotWriter, UnitState, type MatchStartInfo } from '@game/shared';
import { describe, expect, it, vi } from 'vitest';
import { MatchClient } from '../src/game/match-client';
import type { GameSocket } from '../src/net/socket';
import type { GameWorld, Unit } from '../src/render/world';
import type { NavGrid } from '@game/shared';

vi.mock('../src/render/ability-fx', () => ({
  HERO_FX: {},
  AbilityFx: class {
    clearMarkers() {}
    dispose() {}
  },
}));
vi.mock('../src/render/health-bars', () => ({
  HealthBars: class {
    dispose() {}
  },
}));
vi.mock('../src/render/projectiles', () => ({
  Projectiles: class {
    dispose() {}
  },
}));

describe('joining a match already in motion', () => {
  it('shows the server path until a fresh move can be predicted', () => {
    let receive: (bytes: ArrayBuffer) => void = () => {};
    const send = vi.fn();
    const net = {
      onSnapshot: (fn: typeof receive) => {
        receive = fn;
        return () => {};
      },
      sendBinary: send,
    } as unknown as GameSocket;
    const unit = { x: 20, y: 20, facing: 0, moving: true, dead: false } as Unit;
    const world = {
      scene: {},
      nav: { cols: 64, rows: 64, cellSize: 1, walk: new Uint8Array(64 * 64).fill(1) } as NavGrid,
      camera: { lookAt: vi.fn() },
      addUnit: () => unit,
      removeUnit: vi.fn(),
      select: vi.fn(),
    } as unknown as GameWorld;
    const info = { yourSlot: 0, slots: [{ index: 0, team: 1 }] } as MatchStartInfo;
    const match = new MatchClient(world, net, info);
    const sw = new SnapshotWriter();
    sw.begin(100, 55, 20, SnapshotFlag.Full, 55);
    sw.spawn({
      id: 1,
      type: entityTypeIndex('staff_warrior'),
      owner: 0,
      color: 0,
      x: qPos(20),
      y: qPos(20),
      vx: 6400,
      vy: 0,
      facing: 0,
      state: UnitState.Moving,
      hp: 500,
      maxHp: 500,
      mana: 100,
      maxMana: 100,
      level: 1,
      buffs: 0,
    });
    receive(sw.finish(new BinaryWriter()).slice().buffer);
    expect(match.ownHero).not.toBeNull();
    expect(match.serverMode).toBe(true);
    expect(match.predictor?.stats.corrections).toBe(0);
    match.moveTo(25, 20, false);
    expect(match.serverMode).toBe(false);
    expect(send).toHaveBeenCalledOnce();
    match.dispose();
  });
});
