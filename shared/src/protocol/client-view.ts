// Server side, but plain logic (here so client tests can run the whole path).
// What one player has been told. Each tick it compares the simulation with what the player's
// client can work out by itself (last sent position + velocity), and writes only the changes,
// the events the player can see, and the player's own hero data when it changed.

import { EventType } from '../sim/events';
import { TICK_DT, type MatchSim, type SimEntity } from '../sim/match-sim';
import type { TeamVision } from '../sim/vision';
import type { BinaryWriter } from './binary';
import {
  blankPlayerState,
  dqPos,
  dqVel,
  Field,
  qFacing,
  qHp,
  qPos,
  qVel,
  SnapshotFlag,
  UnitState,
  type NetPlayerState,
  type NetUpdate,
  type SnapshotWriter,
} from './game';

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
  mana: number;
  maxMana: number;
  level: number;
  buffs: number;
  seenAt: number;
}

/** How far the client's guess may drift before we send a fix (game units). */
const DRIFT_OTHERS = 0.05;
/** The own hero must match closely: prediction is checked against it. */
const DRIFT_OWN_HERO = 0.01;
/** Velocity change that counts as "the unit changed its way" (in 1/2000 units per second). */
const VEL_STEP = 40;

export function unitStateOf(e: SimEntity): number {
  let s = 0;
  if (e.alive && (e.vx !== 0 || e.vy !== 0 || e.mover.path.length)) s |= UnitState.Moving;
  if (e.swing === 1) s |= UnitState.Attacking;
  if (!e.alive) s |= UnitState.Dead;
  if (
    !e.alive ||
    e.targetId ||
    e.order === 'attack' ||
    e.order === 'attackMove' ||
    e.order === 'hold' ||
    e.order === 'cast' ||
    e.returning ||
    e.forced ||
    e.buffs.some((b) => b.stun || b.root || b.tauntId)
  )
    s |= UnitState.ServerDriven;
  return s;
}

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
    mana: 0,
    maxMana: 0,
    level: 0,
    buffs: 0,
    mask: 0,
  };
  private readonly player = blankPlayerState();
  private playerKey = '';
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
    this.playerKey = '';
  }

  write(sim: MatchSim, vision: TeamVision, sw: SnapshotWriter, w: BinaryWriter): Uint8Array<ArrayBuffer> {
    const stamp = ++this.stamp;
    const tick = sim.tick;
    sw.begin(tick, sim.lastSeq[this.slot] ?? 0, tick - (sim.lastSeqTick[this.slot] ?? 0) + 1, this.full ? SnapshotFlag.Full : 0);
    this.full = false;
    this.writePlayer(sim, sw);
    for (const e of sim.entities) {
      if (!vision.sees(this.team, e)) continue;
      const qx = qPos(e.mover.x),
        qy = qPos(e.mover.y),
        qvx = qVel(e.vx),
        qvy = qVel(e.vy);
      const qf = qFacing(e.mover.facing);
      const state = unitStateOf(e);
      const hp = qHp(e.hp, e.alive),
        maxHp = Math.round(e.stats.maxHp),
        mana = Math.floor(e.mana),
        maxMana = Math.round(e.stats.maxMana),
        level = e.heroState?.level ?? e.stats.level,
        buffs = e.alive ? sim.buffFlagsOf(e) : 0;
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
          hp,
          maxHp,
          mana,
          maxMana,
          level,
          buffs,
        });
        this.sent.set(e.id, {
          x: qx,
          y: qy,
          vx: qvx,
          vy: qvy,
          tick,
          facing: qf,
          state,
          hp,
          maxHp,
          mana,
          maxMana,
          level,
          buffs,
          seenAt: stamp,
        });
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
      if (hp !== s.hp) mask |= Field.Hp;
      if (maxHp !== s.maxHp) mask |= Field.MaxHp;
      // Mana only matters for heroes (bars); a whole point of change is enough.
      if (e.hero && (mana !== s.mana || maxMana !== s.maxMana)) mask |= Field.Mana;
      if (level !== s.level) mask |= Field.Level;
      if (buffs !== s.buffs) mask |= Field.Buffs;
      if (!mask) continue;
      const u = this.upd;
      u.id = e.id;
      u.mask = mask;
      u.x = qx;
      u.y = qy;
      u.vx = qvx;
      u.vy = qvy;
      u.facing = qf;
      u.state = state;
      u.hp = hp;
      u.maxHp = maxHp;
      u.mana = mana;
      u.maxMana = maxMana;
      u.level = level;
      u.buffs = buffs;
      sw.update(u);
      if (mask & Field.Motion) {
        s.x = qx;
        s.y = qy;
        s.vx = qvx;
        s.vy = qvy;
        s.tick = tick;
      }
      s.facing = qf;
      s.state = state;
      s.hp = hp;
      s.maxHp = maxHp;
      s.mana = mana;
      s.maxMana = maxMana;
      s.level = level;
      s.buffs = buffs;
    }
    for (const [id, s] of this.sent) {
      if (s.seenAt === stamp) continue;
      sw.remove(id);
      this.sent.delete(id);
    }
    this.writeEvents(sim, vision, sw);
    return sw.finish(w);
  }

  get known(): number {
    return this.sent.size;
  }

  private writePlayer(sim: MatchSim, sw: SnapshotWriter): void {
    const hero = sim.heroes[this.slot];
    const hs = hero?.heroState;
    if (!hero || !hs) return;
    const p: NetPlayerState = this.player;
    p.heroId = hero.id;
    p.gold = Math.floor(hs.gold);
    p.xp = Math.floor(hs.xp);
    p.level = hs.level;
    p.skillPoints = hs.skillPoints;
    p.respawnTicks = hs.respawnAt ? Math.max(0, hs.respawnAt - sim.tick) : 0;
    p.moveSpeed = Math.round(hero.stats.moveSpeed * 100);
    for (let i = 0; i < 4; i++) {
      p.abilityLevels[i] = hs.abilityLevels[i] ?? 0;
      p.cooldownEnds[i] = (hero.cooldowns[i] ?? 0) > sim.tick ? hero.cooldowns[i]! : 0;
    }
    // Respawn time counts down every tick: send it in whole seconds only.
    const key = `${p.heroId},${p.gold},${p.xp},${p.level},${p.skillPoints},${Math.ceil(p.respawnTicks / 20)},${p.moveSpeed},${p.abilityLevels.join(',')},${p.cooldownEnds.join(',')}`;
    if (key === this.playerKey) return;
    this.playerKey = key;
    sw.playerState(p);
  }

  private writeEvents(sim: MatchSim, vision: TeamVision, sw: SnapshotWriter): void {
    const list = sim.events;
    for (let i = 0; i < list.count; i++) {
      const e = list.items[i]!;
      if (e.type === EventType.Gold) {
        if (e.kind === this.slot) sw.event(e.type, e.a, e.b, e.value, e.kind);
        continue;
      }
      const a = sim.get(e.a),
        b = e.b ? sim.get(e.b) : undefined;
      if ((a && this.sent.has(a.id)) || (b && vision.sees(this.team, b) && this.sent.has(b.id)))
        sw.event(e.type, e.a, e.b, e.value, e.kind);
    }
  }
}
