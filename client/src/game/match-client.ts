// The running match on the client: reads snapshots into NetEntities, draws other units a bit in
// the past, predicts the own hero, shows events (attacks, hits, deaths, gold) and sends the
// player's commands.
//
// The own hero has two modes. "Predict": after a move or stop, the client moves it at once with
// the same code as the server. "Server": while the server drives it (attack, chase, dead), the
// client draws it like any other unit and keeps the predictor on the server's position, so the
// next move click starts from the right place.

import {
  BinaryWriter,
  blankPlayerState,
  CommandType,
  DamageKind,
  ENTITY_TYPES,
  EventType,
  isFlyingType,
  isHeroType,
  isPredicted,
  moveSpeedOf,
  NEUTRAL,
  quantizePoint,
  readSnapshot,
  SnapshotData,
  SnapshotFlag,
  UnitState,
  writeCommand,
  type GameCommand,
  type MatchStartInfo,
  type NetPlayerState,
} from '@game/shared';
import type { GameSocket } from '../net/socket';
import { HealthBars, type BarInput } from '../render/health-bars';
import { Projectiles } from '../render/projectiles';
import { TILT } from '../render/rts-camera';
import { TEAM_COLORS } from '../render/team-material';
import { TEAMS, type GameWorld } from '../render/world';
import type { FloatingText } from '../ui/floating-text';
import { HeroPredictor } from './hero-predictor';
import { NetEntity, type Pose } from './net-entity';
import { TickClock } from './tick-clock';

const OWN_BAR = '#3fd93a',
  NEUTRAL_BAR = '#f2cc26',
  ENEMY_BAR = '#e6261a';

/** After this long dead, hide a hero's body (its death clip is over). */
const HIDE_DEAD_HERO_MS = 2500;

export class MatchClient {
  readonly entities = new Map<number, NetEntity>();
  readonly clock = new TickClock();
  predictor: HeroPredictor | null = null;
  ownHero: NetEntity | null = null;
  /** the player's private hero data (gold, XP, level...) */
  readonly player: NetPlayerState = blankPlayerState();
  /** last server tick we got */
  tick = 0;
  snapshots = 0;
  /** true while the server drives the own hero (see the top of this file) */
  serverMode = false;
  /** Called when gold, XP, level or respawn time changed. */
  onPlayer: ((p: NetPlayerState) => void) | null = null;
  private seq = 0;
  private markCount = 0;
  private readonly snap = new SnapshotData();
  private readonly w = new BinaryWriter(32);
  private readonly pose: Pose = { x: 0, y: 0, facing: 0, state: 0 };
  private readonly heroPose = { x: 0, y: 0, facing: 0 };
  private readonly unsubscribe: () => void;
  private cameraPlaced = false;
  private readonly bars: HealthBars;
  private readonly barInput: BarInput[] = [];
  private readonly projectiles: Projectiles;
  private readonly deadSince = new Map<number, number>();
  private readonly pt = { x: 0, y: 0 };

  constructor(
    readonly world: GameWorld,
    private readonly net: GameSocket,
    readonly info: MatchStartInfo,
    private readonly floating: FloatingText | null = null,
  ) {
    this.unsubscribe = net.onSnapshot((data) => this.onSnapshot(data));
    world.beforeFrame = (dt) => this.frame(dt);
    this.bars = new HealthBars(world.scene, TILT);
    this.projectiles = new Projectiles(world.scene);
  }

  get slot(): number {
    return this.info.yourSlot;
  }

  get myTeam(): number {
    return this.info.slots.find((s) => s.index === this.slot)?.team ?? 0;
  }

  teamOf(e: NetEntity): number {
    if (e.owner === NEUTRAL) return 0;
    return this.info.slots.find((s) => s.index === e.owner)?.team ?? -1;
  }

  isEnemy(e: NetEntity): boolean {
    return this.teamOf(e) !== this.myTeam;
  }

  // ---------- commands ----------

  /** Right click on the ground (shift = add to the path). */
  moveTo(x: number, y: number, queue: boolean): void {
    const [qx, qy] = quantizePoint(x, y);
    this.send({ type: CommandType.Move, x: qx, y: qy, queue });
  }

  attack(target: NetEntity): void {
    this.send({ type: CommandType.Attack, target: target.id });
  }

  attackMove(x: number, y: number): void {
    const [qx, qy] = quantizePoint(x, y);
    this.send({ type: CommandType.AttackMove, x: qx, y: qy });
  }

  stop(): void {
    this.send({ type: CommandType.Stop });
  }

  hold(): void {
    this.send({ type: CommandType.Hold });
  }

  private send(cmd: GameCommand): void {
    const p = this.predictor;
    if (!p || !this.ownHero || this.ownHero.state & UnitState.Dead) return;
    this.seq = (this.seq % 0xffff) + 1; // 1..65535, 0 means "no command yet"
    this.net.sendBinary(writeCommand(this.w, this.seq, cmd));
    if (isPredicted(cmd)) {
      if (this.serverMode) {
        // Take over from where the server had the hero; the drawn hero slides there.
        const k = this.ownHero.sample(this.tick, this.pose, this.tick);
        const u = this.ownHero.unit;
        p.rebase(k.x, k.y, k.facing, u?.x ?? k.x, u?.y ?? k.y);
        this.serverMode = false;
      }
      p.issue(this.seq, cmd);
    } else {
      this.serverMode = true;
    }
  }

  /** The visible unit under a screen point (CSS pixels), or null. */
  pick(sx: number, sy: number): NetEntity | null {
    let best: NetEntity | null = null,
      bestD = Infinity;
    for (const e of this.entities.values()) {
      const u = e.unit;
      if (!u || u.dead) continue;
      if (!this.world.screenPoint(u.x, u.y, u.flyHeight + u.height * 0.5, this.pt)) continue;
      const d = Math.hypot(this.pt.x - sx, this.pt.y - sy);
      // Bigger models are easier to click.
      if (d < 18 + u.height * 10 && d < bestD) {
        bestD = d;
        best = e;
      }
    }
    return best;
  }

  // ---------- snapshots ----------

  private onSnapshot(data: ArrayBuffer): void {
    const s = readSnapshot(data, this.snap);
    this.snapshots++;
    this.tick = s.tick;
    this.clock.onSnapshot(s.tick);
    const mark = ++this.markCount;
    const full = (s.flags & SnapshotFlag.Full) !== 0;
    if (s.hasPlayer) {
      Object.assign(this.player, s.player, { abilityLevels: [...s.player.abilityLevels] });
      if (this.predictor) this.predictor.mover.speed = s.player.moveSpeed / 100;
      this.onPlayer?.(this.player);
    }
    for (let i = 0; i < s.spawnCount; i++) {
      const sp = s.spawns[i]!;
      this.remove(sp.id);
      const e = new NetEntity(s.tick, sp);
      e.mark = mark;
      this.entities.set(e.id, e);
      this.show(e);
    }
    for (let i = 0; i < s.updateCount; i++) {
      const u = s.updates[i]!;
      const e = this.entities.get(u.id);
      if (!e) continue;
      e.apply(s.tick, u);
      e.mark = mark;
    }
    for (let i = 0; i < s.goneCount; i++) this.remove(s.gone[i]!);
    if (full) for (const e of [...this.entities.values()]) if (e.mark !== mark) this.remove(e.id);
    for (let i = 0; i < s.eventCount; i++) {
      const ev = s.events[i]!;
      this.onEvent(ev.type, ev.a, ev.b, ev.value, ev.kind);
    }

    const hero = this.ownHero;
    const p = this.predictor;
    if (hero && p) {
      p.advance(performance.now());
      hero.sample(s.tick, this.pose, s.tick);
      const acked = s.ackSeq === this.seq;
      const driven = (hero.state & UnitState.ServerDriven) !== 0;
      if (acked && driven) this.serverMode = true;
      else if (acked && this.serverMode && !driven) {
        // The server is done with its order (target died...): predict again from here.
        const u = hero.unit;
        p.rebase(this.pose.x, this.pose.y, this.pose.facing, u?.x ?? this.pose.x, u?.y ?? this.pose.y);
        this.serverMode = false;
      }
      if (this.serverMode) p.rebase(this.pose.x, this.pose.y, this.pose.facing);
      else p.reconcile(s.ackSeq, s.ticksSinceAck, this.pose.x, this.pose.y);
    }
  }

  private onEvent(type: number, a: number, b: number, value: number, kind: number): void {
    const ea = this.entities.get(a);
    switch (type) {
      case EventType.Attack: {
        const u = ea?.unit;
        if (u && !u.dead) this.world.playOnce(u, Math.random() < 0.5 ? 'attack' : 'attack2', 0.9);
        break;
      }
      case EventType.Projectile: {
        const from = ea?.unit,
          to = this.entities.get(b);
        if (!ea || !from || !to) break;
        const color = ea.owner === NEUTRAL ? '#ffd966' : (TEAM_COLORS[TEAMS[ea.color] ?? 'red'] ?? '#ffffff');
        const h = this.world.terrain.heightAt(from.x, from.y) + from.flyHeight + from.height * 0.6;
        this.projectiles.fire(
          from.x,
          from.y,
          h,
          value,
          () => {
            const tu = to.unit;
            if (!tu || !this.entities.has(to.id)) return null;
            return { x: tu.x, y: tu.y, h: this.world.terrain.heightAt(tu.x, tu.y) + tu.flyHeight + tu.height * 0.5 };
          },
          color,
        );
        break;
      }
      case EventType.Damage: {
        const u = ea?.unit;
        if (!u || !this.floating) break;
        const src = this.entities.get(b);
        const mine = (x: NetEntity | undefined) => !!x && x.owner === this.slot;
        const up = u.flyHeight + u.height + 0.3;
        // Only numbers that matter to this player: what we deal and what we take.
        if (kind === DamageKind.Heal) {
          if (mine(ea)) this.floating.show(`+${value}`, 'heal', u.x, u.y, up);
        } else if (mine(ea)) this.floating.show(String(value), 'hurt', u.x, u.y, up);
        else if (mine(src)) this.floating.show(String(value), kind === DamageKind.Spell ? 'spell' : 'damage', u.x, u.y, up);
        break;
      }
      case EventType.Gold: {
        const u = ea?.unit;
        if (u && this.floating) this.floating.show(`+${value}`, 'gold', u.x, u.y, u.flyHeight + u.height + 0.8);
        break;
      }
      case EventType.LevelUp: {
        const u = ea?.unit;
        if (u && this.floating && ea.owner === this.slot) this.floating.show(`Level ${value}!`, 'level', u.x, u.y, u.height + 1.2);
        break;
      }
    }
  }

  private show(e: NetEntity): void {
    const modelId = ENTITY_TYPES[e.type] ?? 'swordsman';
    const hero = isHeroType(e.type);
    const k = e.last;
    // Neutral monsters have no team color: their masks are black anyway.
    const team = e.owner === NEUTRAL ? 'red' : (TEAMS[e.color] ?? 'red');
    e.unit = this.world.addUnit(modelId, team, k.x, k.y, k.facing, moveSpeedOf(e.type), hero, isFlyingType(e.type));
    if (e.state & UnitState.Dead) this.world.setDead(e.unit, true);
    if (hero && e.owner === this.slot) {
      this.ownHero = e;
      this.predictor = new HeroPredictor(k.x, k.y, k.facing, moveSpeedOf(e.type), this.world.nav, isFlyingType(e.type));
      this.serverMode = (e.state & UnitState.ServerDriven) !== 0;
      this.world.select(e.unit);
      if (!this.cameraPlaced) this.world.camera.lookAt(k.x, k.y, true);
      this.cameraPlaced = true;
    }
  }

  private remove(id: number): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.unit) this.world.removeUnit(e.unit);
    this.entities.delete(id);
    this.deadSince.delete(id);
    if (e === this.ownHero) {
      this.ownHero = null;
      this.predictor = null;
    }
  }

  // ---------- every frame ----------

  private frame(dt: number): void {
    const p = this.predictor;
    p?.advance(performance.now());
    const rt = this.clock.renderTick();
    const now = performance.now();
    let bars = 0;
    for (const e of this.entities.values()) {
      const u = e.unit;
      if (!u) continue;
      if (e === this.ownHero && p && !this.serverMode) {
        p.pose(this.heroPose);
        u.x = this.heroPose.x;
        u.y = this.heroPose.y;
        u.facing = this.heroPose.facing;
        u.moving = p.moving;
      } else {
        e.sample(rt, this.pose, this.tick);
        u.x = this.pose.x;
        u.y = this.pose.y;
        u.facing = this.pose.facing;
        u.moving = (this.pose.state & UnitState.Moving) !== 0;
      }
      const dead = (e.state & UnitState.Dead) !== 0;
      if (dead !== u.dead) {
        this.world.setDead(u, dead);
        if (dead) this.deadSince.set(e.id, now);
        else {
          this.deadSince.delete(e.id);
          this.world.hideUnit(u, false);
        }
      }
      if (dead) {
        const since = this.deadSince.get(e.id) ?? now;
        if (isHeroType(e.type) && now - since > HIDE_DEAD_HERO_MS) this.world.hideUnit(u, true);
        continue;
      }
      // Health bar: heroes always, others when hurt or selected.
      const hero = isHeroType(e.type);
      if (!hero && e.hp >= e.maxHp && this.world.selected !== u) continue;
      const b = (this.barInput[bars] ??= { x: 0, y: 0, z: 0, hp: 1, mana: -1, hero: false, color: OWN_BAR });
      bars++;
      b.x = u.x;
      b.y = this.world.terrain.heightAt(u.x, u.y) + u.flyHeight + u.height + 0.35;
      b.z = -u.y;
      b.hp = e.maxHp ? e.hp / e.maxHp : 0;
      b.mana = hero && e.maxMana > 0 ? e.mana / e.maxMana : -1;
      b.hero = hero;
      const team = this.teamOf(e);
      // Own: green, neutral: yellow, enemy: red, ally: its team color.
      b.color =
        e.owner === this.slot
          ? OWN_BAR
          : team === 0
            ? NEUTRAL_BAR
            : team === this.myTeam
              ? (TEAM_COLORS[TEAMS[e.color] ?? 'red'] ?? OWN_BAR)
              : ENEMY_BAR;
    }
    this.bars.update(this.barInput, bars);
    this.projectiles.update(dt);
    this.floating?.update((x, y, up, out) => this.world.screenPoint(x, y, up, out));
  }

  /** Match time in seconds, from the server tick. */
  get seconds(): number {
    return this.clock.ready ? Math.max(0, this.clock.serverTick()) / 20 : 0;
  }

  dispose(): void {
    this.unsubscribe();
    this.world.beforeFrame = null;
    for (const id of [...this.entities.keys()]) this.remove(id);
    this.world.select(null);
    this.bars.update([], 0);
    this.projectiles.update(0);
  }
}
