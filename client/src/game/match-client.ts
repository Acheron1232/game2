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
  abilityTargetAllowed,
  BinaryWriter,
  canLearn,
  dqPos,
  gameData,
  lv,
  TICK_RATE,
  ITEMS,
  type AbilityDef,
  type ItemDef,
  type CastTarget,
  blankFactionState,
  blankPlayerState,
  buildingDefOf,
  buildTreeIndex,
  CommandType,
  footprintOf,
  isBuildingType,
  labelRegions,
  statsOf,
  TeamSight,
  type SightSource,
  NavBlockers,
  removeTree,
  type NetFactionState,
  type TreeIndex,
  DamageKind,
  ENTITY_TYPES,
  EventType,
  isFlyingType,
  isHeroType,
  isPredicted,
  layerOf,
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
import type { FogGrid } from '../render/fog';
import { Projectiles } from '../render/projectiles';
import { TILT } from '../render/rts-camera';
import { TEAM_COLORS } from '../render/team-material';
import { TEAMS, type GameWorld } from '../render/world';
import type { FloatingText } from '../ui/floating-text';
import { S } from '../ui/strings';
import { HeroPredictor } from './hero-predictor';
import { NetEntity, type Pose } from './net-entity';
import { TickClock } from './tick-clock';
import { EventTimeline } from './event-timeline';

export interface ItemInfo {
  def: ItemDef;
  /** index in items.json */
  index: number;
  charges: number;
  cooldownLeft: number;
  /** 0..1 of the cooldown still to go */
  cooldownFrac: number;
}

export interface GroundItemInfo {
  id: number;
  item: number;
  charges: number;
  x: number;
  y: number;
}

/** Models for units that have none of their own: [model, scale]. */
const MODEL_ALIAS: Record<string, [string, number]> = {
  watcher_ward: ['ruin_pillar', 0.3],
};

/** Item ids with a small look when used (the rest show nothing extra). */
const ITEM_FX: Record<string, { frames: 'heal' | 'arcane' | 'smoke' | 'spark'; color: string; color2: string }> = {
  healing_potion: { frames: 'heal', color: '#7dff6a', color2: '#2c7a22' },
  mana_potion: { frames: 'arcane', color: '#6aa8ff', color2: '#22457a' },
  scroll_of_return: { frames: 'arcane', color: '#9fd8ff', color2: '#3a5aa0' },
  smoke_bomb: { frames: 'smoke', color: '#8f86a8', color2: '#2a2438' },
  ward: { frames: 'spark', color: '#ffe58a', color2: '#a0801a' },
  tome_of_wisdom: { frames: 'spark', color: '#ffe58a', color2: '#a77bdc' },
};

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
/** How often the own team's sight (fog of war) is computed. */
const SIGHT_MS = 160;

export class MatchClient {
  readonly entities = new Map<number, NetEntity>();
  readonly clock: TickClock;
  predictor: HeroPredictor | null = null;
  ownHero: NetEntity | null = null;
  /** the player's private hero data (gold, XP, level...) */
  readonly player: NetPlayerState = blankPlayerState();
  /** last server tick we got */
  tick = 0;
  snapshots = 0;
  /** true while the server drives the own hero (see the top of this file) */
  serverMode = false;
  /** settings: health bars on every unit, not only on hurt or selected ones */
  allBars = false;
  /** Called when gold, XP, level or respawn time changed. */
  onPlayer: ((p: NetPlayerState) => void) | null = null;
  /** the player's AI faction (gold, wood, supply, what it does) */
  readonly faction: NetFactionState = blankFactionState();
  /** every faction we know (spectators get all of them), by slot */
  readonly factions = new Map<number, NetFactionState>();
  hasFaction = false;
  /** a slot lost (its Town Halls are gone) */
  onDefeated: ((slot: number) => void) | null = null;
  /** one team is left */
  onMatchOver: ((winnerTeam: number) => void) | null = null;
  /** a hero died (kill feed); killer = entity id of the last hit (may be unknown to us) */
  onHeroKilled: ((victim: NetEntity, killer: number) => void) | null = null;
  winnerTeam = 0;
  /** A message from the server for this player (inventory full...). */
  onNotice: ((code: number) => void) | null = null;
  /** items lying on the ground that this player sees */
  readonly groundItems = new Map<number, GroundItemInfo>();
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
  private readonly blinkOrigins = new Map<number, { x: number; y: number; valid: boolean }>();
  private readonly pt = { x: 0, y: 0 };
  private readonly teams: number[] = [];
  private readonly projectText = (x: number, y: number, up: number, out: { x: number; y: number }) => this.world.screenPoint(x, y, up, out);
  private readonly events = new EventTimeline();
  private readonly drawEvent = (ev: { type: number; a: number; b: number; value: number; kind: number }) =>
    this.onEvent(ev.type, ev.a, ev.b, ev.value, ev.kind);
  /** The same walk-grid changes as the server (buildings, chopped trees), for own-hero prediction. */
  private readonly blockers: NavBlockers;
  private readonly walkAtStart: Uint8Array;
  private readonly trees: TreeIndex;
  private readonly blocked = new Map<number, { x: number; y: number; w: number; h: number }>();
  private readonly cutTrees: number[] = [];
  /** workers inside a gold mine (not drawn) */
  private readonly inside = new Set<number>();
  /** Fog of war: the same line-of-sight code as the server, run on our own team's units. */
  private readonly sight: TeamSight;
  private readonly sightSources: SightSource[] = [];
  private sightAt = 0;
  /** what the fog and the minimap show (null for a spectator: no fog) */
  fogGrid: FogGrid | null = null;

  constructor(
    readonly world: GameWorld,
    private readonly net: GameSocket,
    readonly info: MatchStartInfo,
    private readonly floating: FloatingText | null = null,
  ) {
    this.clock = new TickClock(info.watch ?? 1);
    for (const slot of info.slots) this.teams[slot.index] = slot.team;
    this.unsubscribe = net.onSnapshot((data) => this.onSnapshot(data));
    world.beforeFrame = (dt) => this.frame(dt);
    this.bars = new HealthBars(world.scene, TILT);
    this.projectiles = new Projectiles(world.scene);
    this.fx = new AbilityFx(world.scene);
    this.walkAtStart = world.nav.walk.slice();
    this.blockers = new NavBlockers(world.nav);
    this.trees = buildTreeIndex(world.trees, world.grid);
    this.sight = new TeamSight(world.grid, this.trees);
    world.setMenuBase(false);
  }

  get slot(): number {
    return this.info.yourSlot;
  }

  /** watch mode: no own hero, sees everything */
  get spectator(): boolean {
    return this.info.yourSlot < 0;
  }

  get myTeam(): number {
    return this.teams[this.slot] ?? 0;
  }

  teamOf(e: NetEntity): number {
    if (e.owner === NEUTRAL) return 0;
    return this.teams[e.owner] ?? -1;
  }

  isEnemy(e: NetEntity): boolean {
    return this.teamOf(e) !== this.myTeam;
  }

  canTarget(ability: AbilityDef, target: NetEntity): boolean {
    if (!this.ownHero || target.state & UnitState.Dead) return false;
    const relation = target === this.ownHero ? 'self' : this.isEnemy(target) ? 'enemy' : 'ally';
    return abilityTargetAllowed(ability, relation, layerOf(target.type));
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
    this.sendSide({ type: CommandType.Learn, slot });
  }

  /** Use the item in inventory slot 0..5. Potions and the like do not stop the hero. */
  useItem(slot: number, target: CastTarget): void {
    const a = this.item(slot)?.def.active;
    if (!a) return;
    if (target.kind === 2) [target.x, target.y] = quantizePoint(target.x, target.y);
    const cmd: GameCommand = { type: CommandType.UseItem, slot, target: target.kind, id: target.id, x: target.x, y: target.y };
    if (a.target === 'none' && !a.channelTime) this.sendSide(cmd);
    else this.send(cmd);
  }

  buy(item: number): void {
    this.sendSide({ type: CommandType.BuyItem, item });
  }

  /** Town Hall upgrade (index in upgrades.json), bought with hero gold at the own Town Hall. */
  buyUpgrade(upgrade: number): void {
    this.sendSide({ type: CommandType.BuyUpgrade, upgrade });
  }

  sell(slot: number): void {
    this.sendSide({ type: CommandType.SellItem, slot });
  }

  swapItems(from: number, to: number): void {
    this.sendSide({ type: CommandType.SwapItems, from, to });
  }

  /** Walk to a point and put the item there. */
  dropItem(slot: number, x: number, y: number): void {
    const [qx, qy] = quantizePoint(x, y);
    this.send({ type: CommandType.DropItem, slot, x: qx, y: qy });
  }

  pickUp(id: number): void {
    this.send({ type: CommandType.PickUp, id });
  }

  giveItem(slot: number, hero: NetEntity): void {
    this.send({ type: CommandType.GiveItem, slot, target: hero.id });
  }

  /** What the HUD needs about the item in an inventory slot. */
  item(slot: number): ItemInfo | null {
    const index = (this.player.items[slot] ?? 0) - 1;
    const def = ITEMS[index];
    if (!def) return null;
    const end = this.player.itemCooldownEnds[slot] ?? 0;
    const left = end ? Math.max(0, (end - this.clock.serverTick()) / TICK_RATE) : 0;
    const total = def.active?.cooldown ?? 0;
    return {
      def,
      index,
      charges: this.player.charges[slot] ?? 0,
      cooldownLeft: left,
      cooldownFrac: total > 0 ? Math.min(1, left / total) : 0,
    };
  }

  /** The item on the ground under a screen point (CSS pixels), or null. */
  pickGroundItem(sx: number, sy: number): GroundItemInfo | null {
    const id = this.world.items.pick(sx, sy, (x, y, up, out) => this.world.screenPoint(x, y, up, out));
    return this.groundItems.get(id) ?? null;
  }

  /**
   * A command that does not move the hero (learn, buy, sell, potions...): prediction goes on as
   * before. The predictor still gets the number, so acks line up.
   */
  private sendSide(cmd: GameCommand): void {
    this.seq = (this.seq % 0xffff) + 1;
    this.net.sendBinary(writeCommand(this.w, this.seq, cmd));
    // Acknowledged separately from the movement reconciliation clock.
    this.predictor?.skip(this.seq);
  }

  /** What the HUD needs about the own hero's ability in a slot. */
  ability(slot: number): AbilityInfo | null {
    const own = this.ownHero;
    const def = gameData.heroes[own?.type ?? -1];
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
      const height = u.height * u.model.root.scaling.y;
      const altitude = this.world.unitHeight(u) - this.world.terrain.heightAt(u.x, u.y);
      if (!this.world.screenPoint(u.x, u.y, altitude + height * 0.5, this.pt)) continue;
      const d = Math.hypot(this.pt.x - sx, this.pt.y - sy);
      // Bigger models are easier to click.
      if (d < 18 + height * 10 && d < bestD) {
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
      Object.assign(this.player, s.player, {
        abilityLevels: [...s.player.abilityLevels],
        items: [...s.player.items],
        charges: [...s.player.charges],
        itemCooldownEnds: [...s.player.itemCooldownEnds],
      });
      if (this.predictor) this.predictor.mover.speed = s.player.moveSpeed / 100;
      this.onPlayer?.(this.player);
    }
    for (let k = 0; k < s.factionCount; k++) {
      const f = s.factions[k]!;
      const copy = { ...f, upgrades: [...f.upgrades], upgradeReady: [...f.upgradeReady], tech: [...f.tech] };
      this.factions.set(f.slot, copy);
      if (f.slot === this.slot) {
        Object.assign(this.faction, copy);
        this.hasFaction = true;
      }
    }
    // A spectator has no hero: start over the temple.
    if (this.spectator && !this.cameraPlaced) {
      this.world.camera.lookAt(
        this.world.grid.cols * this.world.grid.cellSize * 0.5,
        this.world.grid.rows * this.world.grid.cellSize * 0.5,
        true,
      );
      this.cameraPlaced = true;
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
      if (e.state & UnitState.Dead) this.unblock(e.id);
    }
    for (let i = 0; i < s.goneCount; i++) this.remove(s.gone[i]!);
    if (full) for (const e of [...this.entities.values()]) if (e.mark !== mark) this.remove(e.id);
    // Items on the ground. A full snapshot sends every item in sight again.
    if (full) {
      this.groundItems.clear();
      this.world.items.clear();
    }
    for (let i = 0; i < s.itemSpawnCount; i++) {
      const g = s.itemSpawns[i]!;
      const info = { id: g.id, item: g.item, charges: g.charges, x: dqPos(g.x), y: dqPos(g.y) };
      this.groundItems.set(g.id, info);
      this.world.items.add(g.id, ITEMS[g.item]?.tier ?? 'basic', info.x, info.y);
    }
    for (let i = 0; i < s.itemGoneCount; i++) {
      this.groundItems.delete(s.itemGone[i]!);
      this.world.items.remove(s.itemGone[i]!);
    }
    for (let i = 0; i < s.eventCount; i++) {
      const ev = s.events[i]!;
      // Map changes count at once (prediction needs them now), not on the render timeline.
      if (ev.type === EventType.TreeGone) {
        this.cutTree(ev.a);
        continue;
      }
      if (ev.type === EventType.MatchOver) {
        this.winnerTeam = ev.a;
        this.onMatchOver?.(ev.a);
        continue;
      }
      if (ev.type === EventType.Defeated) {
        this.onDefeated?.(ev.a);
        continue;
      }
      if (ev.type === EventType.Cast && ev.kind !== 255 && ABILITIES[ev.kind & 127]?.id === 'blink') {
        const caster = this.entities.get(ev.a);
        if (caster) {
          // Keep the server's departure point. Prediction may already have moved the drawn
          // hero toward the landing point when the effect reaches the render timeline.
          caster.sample(s.tick, this.pose, s.tick);
          const origin = this.blinkOrigins.get(ev.a) ?? { x: 0, y: 0, valid: false };
          origin.x = this.pose.x;
          origin.y = this.pose.y;
          origin.valid = true;
          this.blinkOrigins.set(ev.a, origin);
        }
      }
      this.events.add(s.tick, ev);
    }

    this.blockers.refresh();
    this.hideCutTrees();
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
      else p.reconcile(s.predictionSeq, s.ticksSinceAck, this.pose.x, this.pose.y);
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
        const h = this.world.unitHeight(from) + from.height * from.model.root.scaling.y * 0.6;
        this.projectiles.fire(
          from.x,
          from.y,
          h,
          value,
          (out) => {
            const tu = to.unit;
            if (!tu || tu.dead || !this.entities.has(to.id)) return false;
            out.x = tu.x;
            out.y = tu.y;
            out.h = this.world.unitHeight(tu) + tu.height * tu.model.root.scaling.y * 0.5;
            return true;
          },
          color,
          spell ? 0.6 : 0.28,
        );
        break;
      }
      case EventType.Cast:
        this.onCast(ea, a, b, value, kind);
        break;
      case EventType.AbilityEffect:
        this.onCast(ea, a, b, value, (kind & 31) | (kind & 128), true, ((kind >> 5) & 3) + 1);
        break;
      case EventType.Impact: {
        const sp = ABILITIES[kind & 31];
        if (!sp) break;
        const x = dqPos(b),
          y = dqPos(value);
        const look = this.heroFx(sp.hero);
        const h = this.world.terrain.heightAt(x, y);
        const level = ((kind >> 5) & 3) + 1;
        const r = lv(sp.params['radius'], level) || 1.2;
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
        if (kind === DamageKind.Miss) {
          if (mine(ea) || mine(src)) this.floating.show(S.miss, 'miss', u.x, u.y, up);
        } else if (kind === DamageKind.Mana) {
          if (mine(ea)) this.floating.show(`+${value}`, 'mana', u.x, u.y, up);
        } else if (kind === DamageKind.Heal) {
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
      case EventType.Chain: {
        // Storm Hammer: a quick white-blue bolt from one unit to the next.
        const from = ea?.unit,
          to = this.entities.get(b)?.unit;
        if (!from || !to) break;
        const h = this.world.terrain.heightAt(from.x, from.y) + from.flyHeight + from.height * 0.6;
        this.fx.bolt(from.x, from.y, h, to.x, to.y, 70, '#bfe6ff');
        const th = this.world.terrain.heightAt(to.x, to.y) + to.flyHeight + to.height * 0.5;
        this.fx.burst(to.x, th, -to.y, 'spark', '#e6f6ff', '#4a8be0', 18, 0.4, 2);
        break;
      }
      case EventType.ItemUse: {
        const item = ITEMS[kind];
        const look = item ? ITEM_FX[item.id] : undefined;
        if (!item || !look) break;
        const x = dqPos(b),
          y = dqPos(value);
        const h = this.world.terrain.heightAt(x, y);
        this.fx.burst(x, h + 1, -y, look.frames, look.color, look.color2, 30, 0.7, 2);
        if (item.id === 'scroll_of_return' || item.id === 'ward') this.fx.ring(x, h, -y, 1.6, look.color, 0.6);
        if (item.active?.gainXp && ea?.unit && ea.owner === this.slot)
          this.floating?.show(`+${item.active.gainXp} XP`, 'level', ea.unit.x, ea.unit.y, ea.unit.height + 1);
        break;
      }
      case EventType.Notice:
        this.onNotice?.(value);
        break;
      case EventType.Death:
        if (ea && isHeroType(ea.type)) this.onHeroKilled?.(ea, b);
        break;
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
  private onCast(ea: NetEntity | undefined, caster: number, b: number, value: number, kind: number, complete = false, level = 1): void {
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
    if (!complete) {
      this.world.playOnce(u, 'cast', Math.max(0.4, a.castTime + 0.25));
      return;
    }
    const look = this.heroFx(a.hero);
    const point = (kind & 128) !== 0;
    const px = point ? dqPos(b) : u.x,
      py = point ? dqPos(value) : u.y;
    const target = !point && b ? this.entities.get(b)?.unit : undefined;
    const gh = (x: number, y: number) => this.world.terrain.heightAt(x, y);
    // The server sends this only after the cast succeeds. No wall-clock timers or phantom
    // effects after a cancelled wind-up; this event already shares the pose's render tick.
    const radius = lv(a.params['radius'], level) || lv(a.params['tauntRadius'], level);
    switch (a.id) {
      case 'sky_pillar':
      case 'inferno_dive': {
        // Start the leap arc when the completed cast reaches the render timeline.
        const t0 = performance.now();
        u.arcStart = t0;
        u.arcEnd = t0 + (lv(a.params['leapTime'], 1) || lv(a.params['diveTime'], 1)) * 1000;
        break;
      }
      case 'blink': {
        const origin = this.blinkOrigins.get(caster);
        const x = origin?.valid ? origin.x : u.x;
        const y = origin?.valid ? origin.y : u.y;
        if (origin) origin.valid = false;
        this.fx.burst(x, gh(x, y) + 1, -y, look.frames, look.color, look.color2, 30, 0.5, 2);
        break;
      }
      case 'fire_breath': {
        const dir = Math.atan2(py - u.y, px - u.x);
        this.fx.cone(u.x, gh(u.x, u.y) + 0.2, -u.y, lv(a.params['length'], 1), lv(a.params['angleDeg'], 1), dir, look.color);
        for (let i = 1; i <= 3; i++) {
          const d = (i / 3) * lv(a.params['length'], 1) * 0.8;
          const x = u.x + Math.cos(dir) * d,
            y = u.y + Math.sin(dir) * d;
          this.fx.burst(x, gh(x, y) + 1, -y, 'fire', '#ffd060', '#ff3a00', 20, 0.5 + i * 0.3, 2);
        }
        break;
      }
      case 'blood_moon':
      case 'sanctuary':
      case 'arcane_storm': {
        const life = lv(a.params['duration'], level) || lv(a.params['channelTime'], level);
        this.fx.disc(px, gh(px, py), -py, radius, look.color, life, caster);
        this.fx.burst(px, gh(px, py) + 2, -py, look.frames, look.color, look.color2, 40, radius * 0.6, 1.5);
        break;
      }
      case 'forest_spirit':
        this.fx.burst(px, gh(px, py) + 0.5, -py, 'nature', look.color, look.color2, 50, 1.2, 2.5);
        break;
      default: {
        const tu = target ?? u;
        const h = gh(tu.x, tu.y);
        if (a.target === 'none' && radius) {
          // An area around the hero (Sweep, Tremor, Trample, Wrath...).
          this.fx.ring(tu.x, h, -tu.y, radius, look.color, 0.55);
          this.fx.burst(tu.x, h + 0.6, -tu.y, look.frames, look.color, look.color2, 50, radius * 0.6, 3);
        } else this.fx.burst(tu.x, h + tu.flyHeight + tu.height * 0.6, -tu.y, look.frames, look.color, look.color2, 35, 0.6, 2);
      }
    }
  }

  private show(e: NetEntity): void {
    const typeId = ENTITY_TYPES[e.type] ?? 'swordsman';
    const [modelId, scale] = MODEL_ALIAS[typeId] ?? [typeId, 1];
    const hero = isHeroType(e.type);
    const building = isBuildingType(e.type);
    const k = e.last;
    // Neutral monsters have no team color: their masks are black anyway.
    const team = e.owner === NEUTRAL ? 'red' : (TEAMS[e.color] ?? 'red');
    const facing = building ? this.world.buildingFacing(k.x, k.y) : k.facing;
    e.unit = this.world.addUnit(modelId, team, k.x, k.y, facing, moveSpeedOf(e.type), hero, isFlyingType(e.type), building);
    if (scale !== 1) {
      e.unit.baseScale = e.unit.scale = scale;
      e.unit.height *= scale;
      e.unit.model.root.scaling.setAll(scale);
    }
    if (e.state & UnitState.Dead) this.world.setDead(e.unit, true);
    else if (buildingDefOf(e.type)) {
      // Faction buildings close their cells (gold mines are in the map grid already).
      const [w, h] = footprintOf(e.type);
      const r = { x: k.x, y: k.y, w, h };
      this.blockers.addRect(r.x, r.y, r.w, r.h);
      this.blocked.set(e.id, r);
    }
    if (hero && e.owner === this.slot) {
      this.ownHero = e;
      this.predictor = new HeroPredictor(k.x, k.y, k.facing, moveSpeedOf(e.type), this.world.nav, isFlyingType(e.type));
      // A rejoined walking hero has no local path history. Draw server motion until the next
      // own order instead of correcting an idle predictor on every snapshot.
      this.serverMode = (e.state & (UnitState.ServerDriven | UnitState.Moving)) !== 0;
      this.world.select(e.unit);
      if (!this.cameraPlaced) this.world.camera.lookAt(k.x, k.y, true);
      this.cameraPlaced = true;
    }
  }

  private remove(id: number): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.unit) this.world.removeUnit(e.unit);
    this.unblock(id);
    this.inside.delete(id);
    this.fx.clearMarkers(id);
    this.entities.delete(id);
    this.deadSince.delete(id);
    this.blinkOrigins.delete(id);
    if (e === this.ownHero) {
      this.ownHero = null;
      this.predictor = null;
    }
  }

  private unblock(id: number): void {
    const r = this.blocked.get(id);
    if (!r) return;
    this.blockers.removeRect(r.x, r.y, r.w, r.h);
    this.blocked.delete(id);
  }

  /** A tree fell: open its cells now, hide its model with the next batch. */
  private cutTree(i: number): void {
    if (!this.trees.alive[i]) return;
    this.blockers.openCells(removeTree(this.trees, i));
    this.cutTrees.push(i);
  }

  private hideCutTrees(): void {
    if (!this.cutTrees.length) return;
    this.world.hideTrees(this.cutTrees);
    this.cutTrees.length = 0;
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
      if (e === this.ownHero) u.speed = this.player.moveSpeed / 100;
      const state = e.state;
      // A worker inside a gold mine is not drawn.
      const inMine = (state & UnitState.Hidden) !== 0;
      if (inMine !== this.inside.has(e.id)) {
        if (inMine) this.inside.add(e.id);
        else this.inside.delete(e.id);
        this.world.hideUnit(u, inMine);
        if (inMine && this.world.selected === u) this.world.select(null);
      }
      if (inMine) continue;
      if (isBuildingType(e.type)) {
        u.facing = this.world.buildingFacing(u.x, u.y);
        u.moving = false;
        u.rise = state & UnitState.Constructing ? 0.15 + 0.85 * (e.progress / 255) : 1;
      }
      const dead = (state & UnitState.Dead) !== 0;
      if (dead !== u.dead) {
        this.world.setDead(u, dead);
        if (dead) this.deadSince.set(e.id, now);
        else {
          this.deadSince.delete(e.id);
          this.world.hideUnit(u, false);
        }
      }
      // Buff markers and Mountain Form size.
      u.scale = (e.buffs & BuffFlag.Big ? 1.4 : 1) * u.baseScale;
      if (e.buffs && !dead) {
        const ground = this.world.unitHeight(u, now);
        this.fx.setMarkers(e.id, e.buffs, u.x, ground, ground + u.height * u.model.root.scaling.y, -u.y, Math.max(0.8, u.height * 0.45));
      } else this.fx.clearMarkers(e.id);
      if (dead) {
        const since = this.deadSince.get(e.id) ?? now;
        if (isHeroType(e.type) && now - since > HIDE_DEAD_HERO_MS) this.world.hideUnit(u, true);
        continue;
      }
      // Health bar: heroes always, others when hurt or selected.
      const hero = isHeroType(e.type);
      if (!hero && !this.allBars && e.hp >= e.maxHp && this.world.selected !== u) continue;
      const b = (this.barInput[bars] ??= { x: 0, y: 0, z: 0, hp: 1, mana: -1, hero: false, color: OWN_BAR });
      bars++;
      b.x = u.x;
      b.y = this.world.unitHeight(u, now) + u.height * u.model.root.scaling.y + 0.35;
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
    this.events.drain(rt, this.drawEvent);
    if (now >= this.sightAt) this.updateSight(now);
    this.bars.update(this.barInput, bars);
    this.projectiles.update(dt);
    this.fx.update(dt);
    this.floating?.update(this.projectText);
  }

  /** Own team's sight, about 6 times a second (enough for a fog that fades anyway). */
  private updateSight(now: number): void {
    this.sightAt = now + SIGHT_MS;
    if (this.spectator) return;
    const team = this.myTeam;
    let n = 0;
    for (const e of this.entities.values()) {
      const u = e.unit;
      if (!u || e.state & (UnitState.Dead | UnitState.Hidden) || this.teamOf(e) !== team) continue;
      const src = (this.sightSources[n++] ??= { x: 0, y: 0, team: 0, sight: 0, air: false });
      src.x = u.x;
      src.y = u.y;
      src.team = team;
      src.sight = statsOf(e.type).sight;
      src.air = isFlyingType(e.type);
    }
    this.sightSources.length = n;
    this.sight.update(this.sightSources);
    const grid = (this.fogGrid ??= {
      cols: this.sight.cols,
      cell: this.sight.cell,
      visible: this.sight.visible(team),
      explored: this.sight.explored(team),
    });
    grid.visible = this.sight.visible(team);
    grid.explored = this.sight.explored(team);
    this.world.fog.setGrid(grid);
  }

  /** Match time in seconds, from the server tick. */
  get seconds(): number {
    return this.clock.ready ? Math.max(0, this.clock.serverTick()) / 20 : 0;
  }

  dispose(): void {
    this.unsubscribe();
    this.world.beforeFrame = null;
    for (const id of [...this.entities.keys()]) this.remove(id);
    this.groundItems.clear();
    this.world.items.clear();
    this.world.select(null);
    // Back to the map as it was before the match.
    this.world.nav.walk.set(this.walkAtStart);
    labelRegions(this.world.nav);
    // Next match starts with a clear view, not this match's fog.
    this.world.fog.clear();
    this.world.showAllTrees();
    this.world.setMenuBase(true);
    this.bars.dispose();
    this.projectiles.dispose();
    this.fx.dispose();
    this.floating?.clear();
  }
}
