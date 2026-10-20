// Server side, but plain logic (here so client tests can run the whole path).
// What one player has been told. Each tick it compares the simulation with what the player's
// client can work out by itself (last sent position + velocity), and writes only the changes.

import { TICK_DT, type MatchSim, type SimEntity } from '../sim/match-sim';
import type { TeamVision } from '../sim/vision';
import type { BinaryWriter } from './binary';
import { dqPos, dqVel, Field, qFacing, qPos, qVel, SnapshotFlag, UnitState, type NetUpdate, type SnapshotWriter } from './game';

interface Sent {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** tick of the last motion update: the client moves on from here */
  tick: number;
  facing: number;
  state: number;
  hp: number;
  maxHp: number;
  seenAt: number;
}

/** How far the client's guess may drift before we send a fix (game units). */
const DRIFT_OTHERS = 0.05;
/** The own hero must match closely: prediction is checked against it. */
const DRIFT_OWN_HERO = 0.01;
/** Velocity change that counts as "the unit changed its way" (in 1/2000 units per second). */
const VEL_STEP = 40;

export class ClientView {
  private readonly sent = new Map<number, Sent>();
  private full = true;
  private stamp = 0;
  private readonly upd: NetUpdate = {
    id: 0,
    type: 0,
    owner: 0,
    color: 0,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    facing: 0,
    state: 0,
    hp: 0,
    maxHp: 0,
    mask: 0,
  };
  /** False while the player is offline: nothing is written. */
  active = true;

  constructor(
    readonly slot: number,
    readonly team: number,
  ) {}

  /** The next snapshot is a full one (after a rejoin). */
  reset(): void {
    this.sent.clear();
    this.full = true;
  }

  write(sim: MatchSim, vision: TeamVision, sw: SnapshotWriter, w: BinaryWriter): Uint8Array<ArrayBuffer> {
    const stamp = ++this.stamp;
    const tick = sim.tick;
    sw.begin(tick, sim.lastSeq[this.slot] ?? 0, tick - (sim.lastSeqTick[this.slot] ?? 0) + 1, this.full ? SnapshotFlag.Full : 0);
    this.full = false;
    for (const e of sim.entities) {
      if (!vision.sees(this.team, e)) continue;
      const qx = qPos(e.mover.x),
        qy = qPos(e.mover.y),
        qvx = qVel(e.vx),
        qvy = qVel(e.vy);
      const qf = qFacing(e.mover.facing);
      const state = e.vx !== 0 || e.vy !== 0 || e.mover.path.length ? UnitState.Moving : 0;
      const s = this.sent.get(e.id);
      if (!s) {
        sw.spawn({
          id: e.id,
          type: e.type,
          owner: e.owner,
          color: e.color,
          x: qx,
          y: qy,
          vx: qvx,
          vy: qvy,
          facing: qf,
          state,
          hp: e.hp,
          maxHp: e.maxHp,
        });
        this.sent.set(e.id, { x: qx, y: qy, vx: qvx, vy: qvy, tick, facing: qf, state, hp: e.hp, maxHp: e.maxHp, seenAt: stamp });
        continue;
      }
      s.seenAt = stamp;
      let mask = 0;
      const t = (tick - s.tick) * TICK_DT;
      const drift = Math.hypot(dqPos(s.x) + dqVel(s.vx) * t - e.mover.x, dqPos(s.y) + dqVel(s.vy) * t - e.mover.y);
      const limit = e.hero && e.owner === this.slot ? DRIFT_OWN_HERO : DRIFT_OTHERS;
      if (drift > limit || Math.abs(qvx - s.vx) > VEL_STEP || Math.abs(qvy - s.vy) > VEL_STEP) mask |= Field.Motion;
      const df = Math.abs(qf - s.facing);
      if (Math.min(df, 256 - df) >= 2) mask |= Field.Facing;
      if (state !== s.state) mask |= Field.State;
      if (e.hp !== s.hp) mask |= Field.Hp;
      if (e.maxHp !== s.maxHp) mask |= Field.MaxHp;
      if (!mask) continue;
      this.writeUpdate(sw, e, mask, qx, qy, qvx, qvy, qf, state);
      if (mask & Field.Motion) {
        s.x = qx;
        s.y = qy;
        s.vx = qvx;
        s.vy = qvy;
        s.tick = tick;
      }
      s.facing = qf;
      s.state = state;
      s.hp = e.hp;
      s.maxHp = e.maxHp;
    }
    for (const [id, s] of this.sent) {
      if (s.seenAt === stamp) continue;
      sw.remove(id);
      this.sent.delete(id);
    }
    return sw.finish(w);
  }

  get known(): number {
    return this.sent.size;
  }

  private writeUpdate(
    sw: SnapshotWriter,
    e: SimEntity,
    mask: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    f: number,
    state: number,
  ): void {
    const u = this.upd;
    u.id = e.id;
    u.mask = mask;
    u.x = x;
    u.y = y;
    u.vx = vx;
    u.vy = vy;
    u.facing = f;
    u.state = state;
    u.hp = e.hp;
    u.maxHp = e.maxHp;
    sw.update(u);
  }
}
