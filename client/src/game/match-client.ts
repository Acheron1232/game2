// The running match on the client: reads snapshots into NetEntities, draws other units a bit in
// the past, predicts the own hero, shows events (attacks, hits, deaths, gold) and sends the
// player's commands.
//
// The own hero has two modes. "Predict": after a move or stop, the client moves it at once with
// the same code as the server. "Server": while the server drives it (attack, chase, dead), the
// client draws it like any other unit and keeps the predictor on the server's position, so the
// next move click starts from the right place.

import {
  ABILITIES,
  abilityIndex,
  BinaryWriter,
  canLearn,
  dqPos,
  gameData,
  lv,
  TICK_RATE,
  type AbilityDef,
  type CastTarget,
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
  BuffFlag,
  UnitState,
  writeCommand,
  type GameCommand,
  type MatchStartInfo,
  type NetPlayerState,
} from '@game/shared';
import type { GameSocket } from '../net/socket';
import { AbilityFx, HERO_FX } from '../render/ability-fx';
import { HealthBars, type BarInput } from '../render/health-bars';
import { Projectiles } from '../render/projectiles';
import { TILT } from '../render/rts-camera';
import { TEAM_COLORS } from '../render/team-material';
import { TEAMS, type GameWorld } from '../render/world';
import type { FloatingText } from '../ui/floating-text';
import { HeroPredictor } from './hero-predictor';
import { NetEntity, type Pose } from './net-entity';
import { TickClock } from './tick-clock';

export interface AbilityInfo {
  def: AbilityDef;
  level: number;
  cooldownLeft: number;
  /** 0..1 of the cooldown still to go */
  cooldownFrac: number;
  enoughMana: boolean;
  canLearn: boolean;
}

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
  readonly fx: AbilityFx;
  private readonly deadSince = new Map<number, number>();
  private readonly pt = { x: 0, y: 0 };
  private readonly effectTimers = new Set<ReturnType<typeof setTimeout>>();

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
    this.fx = new AbilityFx(world.scene);
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

  /** Use ability Q W E R (slot 0..3). */
  cast(slot: number, target: CastTarget): void {
    if (target.kind === 2) [target.x, target.y] = quantizePoint(target.x, target.y);
    this.send({ type: CommandType.Cast, slot, target: target.kind, id: target.id, x: target.x, y: target.y });
  }

  /** Spend a skill point (works while dead too). */
  learn(slot: number): void {
    this.seq = (this.seq % 0xffff) + 1;
    this.net.sendBinary(writeCommand(this.w, this.seq, { type: CommandType.Learn, slot }));
    // Not a move: prediction goes on as before. Give the predictor the number, so acks line up.
    this.predictor?.skip(this.seq);
  }

  /** What the HUD needs about the own hero's ability in a slot. */
  ability(slot: number): AbilityInfo | null {
    const own = this.ownHero;
    const def = gameData.heroes.find((h) => h.id === ENTITY_TYPES[own?.type ?? -1]);
    const a = def ? ABILITIES[abilityIndex(def.abilities[slot]!)] : undefined;
    if (!own || !a) return null;
    const level = this.player.abilityLevels[slot] ?? 0;
    const end = this.player.cooldownEnds[slot] ?? 0;
    const left = end ? Math.max(0, (end - this.clock.serverTick()) / TICK_RATE) : 0;
    const total = lv(a.cooldown, Math.max(1, level));
    const cost = lv(a.manaCost, Math.max(1, level));
    const hpCost = lv(a.params['healthCost'], Math.max(1, level));
    return {
      def: a,
      level,
      cooldownLeft: left,
      cooldownFrac: total > 0 ? Math.min(1, left / total) : 0,
      enoughMana: own.mana >= cost && (!hpCost || own.hp > hpCost),
      canLearn: this.player.skillPoints > 0 && canLearn(slot, level, a.maxLevel, this.player.level),
    };
  }

  private send(cmd: GameCommand): void {
    if (cmd.type === CommandType.Learn) return this.learn(cmd.slot);
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
        // kind 0 = an attack, else ability index + 1 (a spell: bigger, in the hero's color).
        const spell = kind > 0 ? ABILITIES[kind - 1] : undefined;
        const color = spell
          ? this.heroFx(spell.hero).color
          : ea.owner === NEUTRAL
            ? '#ffd966'
            : (TEAM_COLORS[TEAMS[ea.color] ?? 'red'] ?? '#ffffff');
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
          spell ? 0.6 : 0.28,
        );
        break;
      }
      case EventType.Cast:
        this.onCast(ea, a, b, value, kind);
        break;
      case EventType.Impact: {
        const sp = ABILITIES[kind];
        if (!sp) break;
        const x = dqPos(b),
          y = dqPos(value);
        const look = this.heroFx(sp.hero);
        const h = this.world.terrain.heightAt(x, y);
        const r = lv(sp.params['radius'], 3) || 1.2;
        this.fx.ring(x, h, -y, r, look.color, 0.6);
        this.fx.burst(x, h + 0.5, -y, look.frames, look.color, look.color2, 45, r * 0.5, 3);
        if (sp.id === 'inferno_dive') this.fx.disc(x, h, -y, r, look.color, lv(sp.params['burnDuration'], 1));
        break;
      }
      case EventType.LineShot: {
        const sp = ABILITIES[kind],
          u = ea?.unit;
        if (!sp || !u) break;
        const h = this.world.terrain.heightAt(u.x, u.y) + u.flyHeight + u.height * 0.55;
        this.fx.bolt(u.x, u.y, h, dqPos(b), dqPos(value), lv(sp.params['projectileSpeed'], 1) || 20, this.heroFx(sp.hero).color);
        break;
      }
      case EventType.ChannelEnd:
        this.fx.endZones(a);
        break;
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

  private heroFx(heroId: string) {
    return HERO_FX[heroId] ?? HERO_FX['monster']!;
  }

  /** A cast starts: cast clip, and the placeholder look of the ability. */
  private onCast(ea: NetEntity | undefined, caster: number, b: number, value: number, kind: number): void {
    const u = ea?.unit;
    if (!ea || !u) return;
    if (kind === 255) {
      // A monster skill: a puff on the monster.
      this.world.playOnce(u, 'cast', 0.8);
      const h = this.world.terrain.heightAt(u.x, u.y);
      this.fx.ring(u.x, h, -u.y, 3.5, HERO_FX['monster']!.color, 0.5);
      return;
    }
    const a = ABILITIES[kind & 127];
    if (!a) return;
    const level = 3;
    const look = this.heroFx(a.hero);
    const point = (kind & 128) !== 0;
    const px = point ? dqPos(b) : u.x,
      py = point ? dqPos(value) : u.y;
    const target = !point && b ? this.entities.get(b)?.unit : undefined;
    this.world.playOnce(u, 'cast', Math.max(0.4, a.castTime + 0.25));
    const gh = (x: number, y: number) => this.world.terrain.heightAt(x, y);
    const delay = a.castTime * 1000;
    const later = (fn: () => void) => {
      if (delay <= 0) return fn();
      const timer = setTimeout(() => {
        this.effectTimers.delete(timer);
        fn();
      }, delay);
      this.effectTimers.add(timer);
    };
    const radius = lv(a.params['radius'], level) || lv(a.params['tauntRadius'], level);
    switch (a.id) {
      case 'sky_pillar':
      case 'inferno_dive': {
        // The jump itself: an arc over the leap time, after the cast time (+ the 100 ms the
        // client draws others in the past).
        const t0 = performance.now() + delay + (ea === this.ownHero && !this.serverMode ? 0 : 100);
        u.arcStart = t0;
        u.arcEnd = t0 + (lv(a.params['leapTime'], 1) || lv(a.params['diveTime'], 1)) * 1000;
        break;
      }
      case 'blink':
        this.fx.burst(u.x, gh(u.x, u.y) + 1, -u.y, look.frames, look.color, look.color2, 30, 0.5, 2);
        break;
      case 'fire_breath':
        later(() => {
          const dir = Math.atan2(py - u.y, px - u.x);
          this.fx.cone(u.x, gh(u.x, u.y) + 0.2, -u.y, lv(a.params['length'], 1), lv(a.params['angleDeg'], 1), dir, look.color);
          for (let i = 1; i <= 3; i++) {
            const d = (i / 3) * lv(a.params['length'], 1) * 0.8;
            const x = u.x + Math.cos(dir) * d,
              y = u.y + Math.sin(dir) * d;
            this.fx.burst(x, gh(x, y) + 1, -y, 'fire', '#ffd060', '#ff3a00', 20, 0.5 + i * 0.3, 2);
          }
        });
        break;
      case 'blood_moon':
      case 'sanctuary':
      case 'arcane_storm':
        later(() => {
          const life = lv(a.params['duration'], level) || lv(a.params['channelTime'], level);
          this.fx.disc(px, gh(px, py), -py, radius, look.color, life, caster);
          this.fx.burst(px, gh(px, py) + 2, -py, look.frames, look.color, look.color2, 40, radius * 0.6, 1.5);
        });
        break;
      case 'forest_spirit':
        later(() => this.fx.burst(px, gh(px, py) + 0.5, -py, 'nature', look.color, look.color2, 50, 1.2, 2.5));
        break;
      default:
        later(() => {
          const tu = target ?? u;
          const h = gh(tu.x, tu.y);
          if (a.target === 'none' && radius) {
            // An area around the hero (Sweep, Tremor, Trample, Wrath...).
            this.fx.ring(tu.x, h, -tu.y, radius, look.color, 0.55);
            this.fx.burst(tu.x, h + 0.6, -tu.y, look.frames, look.color, look.color2, 50, radius * 0.6, 3);
          } else this.fx.burst(tu.x, h + tu.flyHeight + tu.height * 0.6, -tu.y, look.frames, look.color, look.color2, 35, 0.6, 2);
        });
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
    this.fx.clearMarkers(id);
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
      // Buff markers and Mountain Form size.
      u.scale = e.buffs & BuffFlag.Big ? 1.4 : 1;
      if (e.buffs && !dead) {
        const ground = this.world.terrain.heightAt(u.x, u.y);
        this.fx.setMarkers(
          e.id,
          e.buffs,
          u.x,
          ground + u.flyHeight,
          ground + u.flyHeight + u.height * u.scale,
          -u.y,
          Math.max(0.8, u.height * 0.45),
        );
      } else this.fx.clearMarkers(e.id);
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
    this.fx.update(dt);
    this.floating?.update((x, y, up, out) => this.world.screenPoint(x, y, up, out));
  }

  /** Match time in seconds, from the server tick. */
  get seconds(): number {
    return this.clock.ready ? Math.max(0, this.clock.serverTick()) / 20 : 0;
  }

  dispose(): void {
    this.unsubscribe();
    for (const timer of this.effectTimers) clearTimeout(timer);
    this.effectTimers.clear();
    this.world.beforeFrame = null;
    for (const id of [...this.entities.keys()]) this.remove(id);
    this.world.select(null);
    this.bars.dispose();
    this.projectiles.dispose();
    this.fx.dispose();
    this.floating?.clear();
  }
}
