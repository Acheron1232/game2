// Server side, but plain logic (here so client tests can run the whole path).
// What one player has been told. Each tick it compares the simulation with what the player's
// client can work out by itself (last sent position + velocity), and writes only the changes,
// the events the player can see, and the player's own hero data when it changed.

import { EventType, type EventList } from '../sim/events';
import type { FactionState } from '../sim/faction/faction';
import { gameData } from '../data/index';
import { ENTITY_TYPES } from '../sim/entity-types';

/** Town Hall upgrades in upgrades.json order (same order as the faction block). */
const UPGRADE_IDS = gameData.upgrades.upgrades.map((u) => u.id);
/** supply per entity type (0 for heroes and buildings) */
const SUPPLY = ENTITY_TYPES.map((id) => gameData.units.find((u) => u.id === id)?.supply ?? 0);
import { itemReadyAt } from '../sim/items';
import { TICK_DT, type MatchSim, type SimEntity } from '../sim/match-sim';
import type { Vision } from '../sim/vision';
import type { BinaryWriter } from './binary';
import {
  blankFactionState,
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
  type NetFactionState,
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
  progress: number;
  seenAt: number;
}

/** How far the client's guess may drift before we send a fix (game units). */
const DRIFT_OTHERS = 0.05;
/** The own hero must match closely: prediction is checked against it. */
const DRIFT_OWN_HERO = 0.01;
/** Velocity change that counts as "the unit changed its way" (in 1/2000 units per second). */
const VEL_STEP = 40;
/** Building progress bars: send a change of at least this much (of 255). */
const PROGRESS_STEP = 3;

/** Construction, training or tier upgrade of a building, 0..255. */
export function progressOf(e: SimEntity): number {
  const b = e.building;
  if (!b || !e.alive) return 0;
  let p = 0;
  if (!b.done) p = b.progress;
  else if (b.upgradeTo >= 0 && b.upgradeTotal > 0) p = 1 - b.upgradeLeft / b.upgradeTotal;
  else if (b.trainTotal > 0) p = 1 - b.trainLeft / b.trainTotal;
  return Math.max(0, Math.min(255, Math.round(p * 255)));
}

export function unitStateOf(e: SimEntity): number {
  let s = 0;
  // A root/stun preserves the path to resume later, but must not keep the walk clip running.
  let immobilized = false;
  let taunted = false;
  for (const b of e.buffs) {
    if (b.stun || b.root) immobilized = true;
    if (b.tauntId) taunted = true;
  }
  if (e.alive && !immobilized && (e.vx !== 0 || e.vy !== 0 || e.mover.path.length)) s |= UnitState.Moving;
  if (e.swing === 1) s |= UnitState.Attacking;
  if (!e.alive) s |= UnitState.Dead;
  if (e.building && !e.building.done) s |= UnitState.Constructing;
  if (e.hidden) s |= UnitState.Hidden;
  const carry = e.job?.carry;
  if (carry === 'gold') s |= UnitState.CarryGold;
  else if (carry === 'wood') s |= UnitState.CarryWood;
  if (
    !e.alive ||
    e.targetId ||
    e.order === 'attack' ||
    e.order === 'attackMove' ||
    e.order === 'follow' ||
    e.order === 'hold' ||
    e.order === 'cast' ||
    e.order === 'item' ||
    e.returning ||
    e.forced ||
    immobilized ||
    taunted
  )
    s |= UnitState.ServerDriven;
  return s;
}

export class ClientView {
  private readonly sent = new Map<number, Sent>();
  /** ground item id -> stamp it was last seen */
  private readonly sentItems = new Map<number, number>();
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
    progress: 0,
    mask: 0,
  };
  private readonly player = blankPlayerState();
  private playerKey = '';
  /** faction blocks by slot, and the last key sent for each */
  private readonly factionState = new Map<number, NetFactionState>();
  private readonly factionKey = new Map<number, string>();
  /** False while the player is offline: nothing is written. */
  active = true;

  constructor(
    readonly slot: number,
    readonly team: number,
    /** a spectator (watch mode): sees the whole map and every faction */
    readonly seeAll = false,
  ) {}

  /** The next snapshot is a full one (after a rejoin). */
  reset(): void {
    this.sent.clear();
    this.sentItems.clear();
    this.full = true;
    this.playerKey = '';
    this.factionKey.clear();
  }

  /** events: this tick's events, or all events since the last snapshot (fast watch mode). */
  write(sim: MatchSim, vision: Vision, sw: SnapshotWriter, w: BinaryWriter, events: EventList = sim.events): Uint8Array<ArrayBuffer> {
    const stamp = ++this.stamp;
    const tick = sim.tick;
    sw.begin(
      tick,
      sim.lastSeq[this.slot] ?? 0,
      tick - (sim.predictionTick[this.slot] ?? 0) + 1,
      this.full ? SnapshotFlag.Full : 0,
      sim.predictionSeq[this.slot] ?? 0,
    );
    const full = this.full;
    this.full = false;
    this.writePlayer(sim, sw);
    this.writeFaction(sim, sw);
    for (const e of sim.entities) {
      // Buildings and mines stay known in the fog (like a map), so the client can block their
      // cells for movement prediction. Their changes are only sent while the team sees them.
      const seen = this.seeAll || vision.sees(this.team, e);
      if (!seen && !(e.building && e.alive && this.sent.has(e.id))) continue;
      if (!seen) {
        this.sent.get(e.id)!.seenAt = stamp;
        continue;
      }
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
        buffs = e.alive ? sim.buffFlagsOf(e) : 0,
        progress = progressOf(e);
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
          progress,
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
          progress,
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
      if (progress !== s.progress && (Math.abs(progress - s.progress) >= PROGRESS_STEP || progress === 0 || progress === 255))
        mask |= Field.Progress;
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
      u.progress = progress;
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
      if (mask & Field.Progress) s.progress = progress;
    }
    for (const [id, s] of this.sent) {
      if (s.seenAt === stamp) continue;
      sw.remove(id);
      this.sent.delete(id);
    }
    this.writeEvents(sim, vision, sw, full, events);
    this.writeGroundItems(sim, vision, sw, stamp);
    return sw.finish(w);
  }

  /** Items on the ground: new ones in sight, and the ones that went away or out of sight. */
  private writeGroundItems(sim: MatchSim, vision: Vision, sw: SnapshotWriter, stamp: number): void {
    for (const g of sim.groundItems) {
      if (!this.seeAll && !vision.seesPoint(this.team, g.x, g.y)) continue;
      if (this.sentItems.has(g.id)) {
        this.sentItems.set(g.id, stamp);
        continue;
      }
      if (!sw.itemSpawn({ id: g.id, item: g.item, charges: g.charges, x: qPos(g.x), y: qPos(g.y) })) break;
      this.sentItems.set(g.id, stamp);
    }
    for (const [id, seen] of this.sentItems) {
      if (seen === stamp) continue;
      if (!sw.itemRemove(id)) break;
      this.sentItems.delete(id);
    }
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
    for (let i = 0; i < hs.inventory.length; i++) {
      const st = hs.inventory[i];
      p.items[i] = st ? st.item + 1 : 0;
      p.charges[i] = st ? st.charges : 0;
      p.itemCooldownEnds[i] = itemReadyAt(hs, i, sim.tick);
    }
    // Respawn time counts down every tick: send it in whole seconds only.
    const key = `${p.heroId},${p.gold},${p.xp},${p.level},${p.skillPoints},${Math.ceil(p.respawnTicks / 20)},${p.moveSpeed},${p.abilityLevels.join(',')},${p.cooldownEnds.join(',')},${p.items.join(',')},${p.charges.join(',')},${p.itemCooldownEnds.join(',')}`;
    if (key === this.playerKey) return;
    this.playerKey = key;
    sw.playerState(p);
  }

  /** The own faction, or every faction for a spectator; only blocks that changed. */
  private writeFaction(sim: MatchSim, sw: SnapshotWriter): void {
    const list = sim.factions?.list;
    if (!list) return;
    for (const fs of list) if (fs && (this.seeAll || fs.slot === this.slot)) this.writeOneFaction(sim, sw, fs);
  }

  private writeOneFaction(sim: MatchSim, sw: SnapshotWriter, fs: FactionState): void {
    let f = this.factionState.get(fs.slot);
    if (!f) this.factionState.set(fs.slot, (f = blankFactionState()));
    f.slot = fs.slot;
    f.gold = Math.floor(fs.gold);
    f.wood = Math.floor(fs.wood);
    f.supplyUsed = Math.min(255, fs.supplyUsed);
    f.supplyCap = Math.min(255, fs.supplyCap);
    f.tier = fs.tier;
    let workers = 0,
      army = 0;
    for (const id of fs.units) {
      const u = sim.get(id);
      if (!u?.alive) continue;
      if (u.job) workers++;
      else army += SUPPLY[u.type] ?? 0;
    }
    f.workers = Math.min(255, workers);
    f.army = Math.min(255, army);
    f.status = fs.status;
    for (let i = 0; i < UPGRADE_IDS.length; i++) {
      const id = UPGRADE_IDS[i]!;
      f.upgrades[i] = fs.upgrades[id] ?? 0;
      const ready = fs.upgradeReadyAt[id] ?? 0;
      f.upgradeReady[i] = ready > sim.tick ? ready : 0;
    }
    f.tech.length = 0;
    for (const id of fs.buildings) {
      const b = sim.get(id);
      if (b?.alive && b.building?.done && !f.tech.includes(b.type)) f.tech.push(b.type);
    }
    const key = `${f.gold},${f.wood},${f.supplyUsed},${f.supplyCap},${f.tier},${f.workers},${f.army},${f.status},${f.upgrades.join('.')},${f.upgradeReady.join('.')},${f.tech.join('.')}`;
    if (key === this.factionKey.get(fs.slot)) return;
    this.factionKey.set(fs.slot, key);
    sw.factionState(f);
  }

  private writeEvents(sim: MatchSim, vision: Vision, sw: SnapshotWriter, full: boolean, list: EventList): void {
    // A new (or rejoined) client gets every tree that is already gone.
    if (full && sim.factions) for (const t of sim.factions.cutTrees) sw.event(EventType.TreeGone, t, 0, 0, 0);
    for (let i = 0; i < list.count; i++) {
      const e = list.items[i]!;
      if (e.type === EventType.Gold) {
        if (e.kind === this.slot) sw.event(e.type, e.a, e.b, e.value, e.kind);
        continue;
      }
      // Not about one entity: everyone gets them (a = tree index / slot / team).
      if (e.type === EventType.TreeGone || e.type === EventType.Defeated || e.type === EventType.MatchOver) {
        sw.event(e.type, e.a, e.b, e.value, e.kind);
        continue;
      }
      if (e.type === EventType.Notice) {
        if (sim.get(e.a)?.owner === this.slot) sw.event(e.type, e.a, e.b, e.value, e.kind);
        continue;
      }
      // Item use shows where a ward went: only for the hero's own team.
      if (e.type === EventType.ItemUse) {
        if (sim.get(e.a)?.team === this.team) sw.event(e.type, e.a, e.b, e.value, e.kind);
        continue;
      }
      const a = sim.get(e.a),
        b = e.b ? sim.get(e.b) : undefined;
      if ((a && this.sent.has(a.id)) || (b && (this.seeAll || vision.sees(this.team, b)) && this.sent.has(b.id)))
        sw.event(e.type, e.a, e.b, e.value, e.kind);
    }
  }
}
