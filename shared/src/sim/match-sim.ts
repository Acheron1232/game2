// The match simulation: entities, the command queue and one fixed tick.
// Runs on the server (in the match worker). Plain logic: no network, no timers, no DOM.
// Phase 6 has heroes and test units that walk; combat comes in Phase 7.

import { gameData } from '../data/index';
import { findPath, nearestWalkable, type NavGrid } from '../nav/nav-grid';
import { applyCommand, type GameCommand } from './commands';
import { entityTypeIndex, isHeroType, maxHpOf, moveSpeedOf, sightOf } from './entity-types';
import { createMover, stepMover, type Mover } from './movement';
import { Rng } from './rng';

export const TICK_RATE = gameData.rules.simulation.tickRate;
export const TICK_DT = 1 / TICK_RATE;
/** Owner id for neutral entities (camps come in Phase 7). */
export const NEUTRAL = 255;

export interface MatchSlot {
  index: number;
  /** entity type index of the hero, see entity-types.ts */
  heroType: number;
  team: number;
  color: number;
  /** start spot index in the map layout */
  start: number;
}

export interface MatchSetup {
  seed: number;
  slots: MatchSlot[];
  /** Load test: this many walking units, spread over the slots. */
  testUnits?: number;
  /** Where test units walk: around each base, or all in the temple center (worst case for vision). */
  testArea?: 'bases' | 'center';
}

export interface SimEntity {
  id: number;
  type: number;
  hero: boolean;
  owner: number;
  team: number;
  color: number;
  mover: Mover;
  /** velocity of the last tick, game units per second */
  vx: number;
  vy: number;
  hp: number;
  maxHp: number;
  sight: number;
  /** test units: next tick to pick a new walk target, and the area they walk in */
  thinkAt: number;
  homeX: number;
  homeY: number;
}

interface QueuedCommand {
  slot: number;
  seq: number;
  /** null = not valid, only the sequence number counts */
  cmd: GameCommand | null;
}

const TEST_UNIT_TYPES = ['worker', 'swordsman', 'archer', 'cleric', 'lancer'];

export class MatchSim {
  tick = 0;
  readonly entities: SimEntity[] = [];
  readonly heroes: (SimEntity | null)[] = [];
  /** last processed command per slot and the tick it ran */
  readonly lastSeq: number[] = [];
  readonly lastSeqTick: number[] = [];
  private readonly byId = new Map<number, SimEntity>();
  private readonly queue: QueuedCommand[] = [];
  private nextId = 1;
  private readonly rng: Rng;
  private readonly size = gameData.map.size.width;

  constructor(
    readonly setup: MatchSetup,
    readonly nav: NavGrid,
  ) {
    this.rng = new Rng(setup.seed);
    for (const s of setup.slots) {
      const start = gameData.map.starts[s.start]!;
      const [x, y] = start.heroSpawn;
      this.heroes[s.index] = this.spawn(s.heroType, s.index, s.team, s.color, x, y);
      this.lastSeq[s.index] = 0;
      this.lastSeqTick[s.index] = 0;
    }
    if (setup.testUnits) this.spawnTestUnits(setup.testUnits, setup.testArea ?? 'bases');
  }

  get(id: number): SimEntity | undefined {
    return this.byId.get(id);
  }

  spawn(type: number, owner: number, team: number, color: number, x: number, y: number): SimEntity {
    const mover = createMover(x, y, moveSpeedOf(type));
    // Face the map center at the start, like the buildings.
    mover.facing = Math.atan2(-(this.size / 2 - x), this.size / 2 - y);
    const e: SimEntity = {
      id: this.nextId++,
      type,
      hero: isHeroType(type),
      owner,
      team,
      color,
      mover,
      vx: 0,
      vy: 0,
      hp: maxHpOf(type),
      maxHp: maxHpOf(type),
      sight: sightOf(type),
      thinkAt: 0,
      homeX: x,
      homeY: y,
    };
    this.entities.push(e);
    this.byId.set(e.id, e);
    return e;
  }

  /**
   * Queues a command. It runs at the start of the next tick. Returns false (and drops it) when
   * it is not valid; the sequence number still counts as processed.
   */
  queueCommand(slot: number, seq: number, cmd: GameCommand): boolean {
    const ok = this.isValid(slot, cmd);
    this.queue.push({ slot, seq, cmd: ok ? cmd : null });
    return ok;
  }

  /** Makes a hero walk back to its start spot (the player left). Not a player command. */
  sendHome(slot: number): void {
    const hero = this.heroes[slot];
    const s = this.setup.slots.find((x) => x.index === slot);
    if (!hero || !s) return;
    const [x, y] = gameData.map.starts[s.start]!.heroSpawn;
    applyCommand(hero.mover, this.nav, { type: 1, x, y, queue: false });
  }

  step(): void {
    this.tick++;
    for (const q of this.queue) {
      const hero = this.heroes[q.slot];
      if (hero && q.cmd) applyCommand(hero.mover, this.nav, q.cmd);
      this.lastSeq[q.slot] = q.seq;
      this.lastSeqTick[q.slot] = this.tick;
    }
    this.queue.length = 0;

    for (const e of this.entities) {
      if (!e.hero && e.thinkAt <= this.tick && e.thinkAt > 0) this.wander(e);
      const px = e.mover.x,
        py = e.mover.y;
      stepMover(e.mover, TICK_DT);
      e.vx = (e.mover.x - px) / TICK_DT;
      e.vy = (e.mover.y - py) / TICK_DT;
    }
  }

  private isValid(slot: number, cmd: GameCommand): boolean {
    const hero = this.heroes[slot];
    if (!hero || hero.hp <= 0) return false;
    if (cmd.type === 1)
      return Number.isFinite(cmd.x) && Number.isFinite(cmd.y) && cmd.x >= 0 && cmd.y >= 0 && cmd.x <= this.size && cmd.y <= this.size;
    return cmd.type === 2;
  }

  private spawnTestUnits(count: number, area: 'bases' | 'center'): void {
    const slots = this.setup.slots;
    if (!slots.length) return;
    for (let i = 0; i < count; i++) {
      const s = slots[i % slots.length]!;
      const [cx, cy] = area === 'center' ? [this.size / 2, this.size / 2] : gameData.map.starts[s.start]!.heroSpawn;
      const p = this.randomPointNear(cx, cy, area === 'center' ? 30 : 24);
      if (!p) continue;
      const type = entityTypeIndex(TEST_UNIT_TYPES[i % TEST_UNIT_TYPES.length]!);
      const e = this.spawn(type, s.index, s.team, s.color, p[0], p[1]);
      e.homeX = cx;
      e.homeY = cy;
      e.thinkAt = 1 + this.rng.int(0, 60);
    }
  }

  private wander(e: SimEntity): void {
    e.thinkAt = this.tick + this.rng.int(40, 140);
    if (e.mover.path.length) return;
    const p = this.randomPointNear(e.homeX, e.homeY, 24);
    if (p) e.mover.path = findPath(this.nav, e.mover.x, e.mover.y, p[0], p[1], 6000);
  }

  private randomPointNear(x: number, y: number, r: number): [number, number] | null {
    const a = this.rng.next() * Math.PI * 2,
      d = Math.sqrt(this.rng.next()) * r;
    return nearestWalkable(this.nav, x + Math.cos(a) * d, y + Math.sin(a) * d, 12);
  }
}
