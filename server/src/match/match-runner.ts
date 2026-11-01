// One match: the simulation, vision and one ClientView per player slot. It does not know about
// threads or sockets: the worker (or the inline host in tests) calls tick() 20 times a second.

import {
  BinaryReader,
  BinaryWriter,
  buildMatchNav,
  ClientView,
  EventList,
  gameData,
  FactionAI,
  matchSummary,
  type MatchSummary,
  itemIndex,
  MatchSim,
  newCharges,
  MsgId,
  nearestWalkable,
  parseTerrain,
  readCommand,
  SnapshotWriter,
  storeItem,
  entitySources,
  TeamSight,
  TICK_RATE,
  ENTITY_TYPES,
  isBuildingType,
  isHeroType,
  isMineType,
  MAX_LEVEL,
  NEUTRAL,
  NEUTRAL_TEAM,
  xpForLevel,
  type MatchSetup,
  type TreeList,
} from '@game/shared';

/** What the test panel can do (lobby message `cheat`): test mode matches and dev servers. */
export interface Cheat {
  xp?: number;
  levelUp?: boolean;
  gold?: number;
  item?: string;
  pos?: [number, number];
  spawn?: { unit: string; count: number; at: [number, number]; dummy?: boolean };
  clear?: boolean;
  god?: boolean;
  freeCasts?: boolean;
  reveal?: boolean;
  speed?: 1 | 2 | 4;
}

/** Buff of the "can not die" switch and of training dummies. */
const TEST_GOD = 'test_god';
const TEST_DUMMY = 'test_dummy';
/** At most this many test units at once (each spawn adds up to 20). */
const MAX_TEST_UNITS = 200;

/** Commands per second per player. Real play needs far less; the rest is dropped. */
export const MAX_COMMANDS_PER_SEC = 30;

export interface MatchPacket {
  slot: number;
  data: Uint8Array<ArrayBuffer>;
}

/** Slot number of the shared spectator view (watch mode). */
export const SPECTATOR = -1;

function copyEvent(to: EventList, e: { type: number; a: number; b: number; value: number; kind: number }): void {
  to.push(e.type as never, e.a, e.b, e.value, e.kind);
}

export class MatchRunner {
  readonly sim: MatchSim;
  private readonly vision: TeamSight;
  private readonly views = new Map<number, ClientView>();
  private readonly sw = new SnapshotWriter();
  private readonly w = new BinaryWriter(4096);
  private readonly commandCount = new Map<number, number>();
  /** bytes written per slot since the last stats read */
  readonly bytes = new Map<number, number>();
  droppedCommands = 0;

  /** sim steps per network tick (watch mode and the test speed switch run the game faster) */
  speed: number;
  /** test switch: these slots have no cooldowns and full mana */
  private readonly freeCasts = new Set<number>();
  /** units made by the test panel */
  private readonly testUnits = new Set<number>();
  /** watch mode: all events of the steps since the last snapshot */
  private readonly events = new EventList();

  /** trees: with them the match has factions (bases, workers, the AI); without them only heroes. */
  constructor(setup: MatchSetup, terrainBytes: Uint8Array, trees?: TreeList) {
    const terrain = parseTerrain(terrainBytes);
    const nav = buildMatchNav(terrain, gameData.map);
    this.sim = new MatchSim(setup, nav, trees ? { terrain, trees } : undefined);
    // Fog of war: sight is blocked by living trees and higher ground (flyers see over all).
    this.vision = new TeamSight(terrain, this.sim.factions?.trees ?? null);
    this.vision.update(entitySources(this.sim.entities));
    // Players can only order attacks on what their team sees.
    this.sim.canSee = (team, e) => this.vision.sees(team, e);
    // Faction brains for every slot, hero bots for Bot slots.
    this.sim.ai = new FactionAI(this.sim);
    this.sim.canSeePoint = (team, x, y) => this.vision.seesPoint(team, x, y);
    this.speed = Math.max(1, Math.min(10, Math.round(setup.watch ?? 1)));
    // Spectators of a watch-mode match share one view that sees everything (slot -1).
    if (setup.watch) {
      this.views.set(SPECTATOR, new ClientView(SPECTATOR, -1, true));
      this.bytes.set(SPECTATOR, 0);
    }
    for (const s of setup.slots) {
      this.views.set(s.index, new ClientView(s.index, s.team));
      this.bytes.set(s.index, 0);
    }
  }

  /** A binary message from the player in this slot. Bad or extra commands are dropped. */
  command(slot: number, data: Uint8Array): void {
    if (!this.views.has(slot)) return;
    const count = (this.commandCount.get(slot) ?? 0) + 1;
    this.commandCount.set(slot, count);
    if (count > MAX_COMMANDS_PER_SEC) {
      this.droppedCommands++;
      return;
    }
    try {
      const r = new BinaryReader(data);
      if (r.u8() !== MsgId.Command) return;
      const c = readCommand(r);
      if (c) this.sim.queueCommand(slot, c.seq, c.cmd);
    } catch {
      this.droppedCommands++;
    }
  }

  /** Offline players get no snapshots; their hero walks home and waits there. */
  setOnline(slot: number, online: boolean): void {
    const view = this.views.get(slot);
    if (!view) return;
    view.active = online;
    if (online) view.reset();
    else this.sim.sendHome(slot);
  }

  /**
   * Test panel (the lobby allows it in test mode and on dev servers): XP, gold, an item, a new
   * place, spawns and switches. Every call also gives full health and mana and ready cooldowns.
   */
  cheat(slot: number, c: Cheat): void {
    const hero = this.sim.heroes[slot];
    if (!hero?.heroState) return;
    if (c.spawn) this.spawnTest(c.spawn);
    if (c.clear) {
      for (const id of this.testUnits) {
        const e = this.sim.get(id);
        if (e?.alive) this.sim.kill(e, { id: e.id, owner: e.owner, team: e.team });
      }
      this.testUnits.clear();
    }
    if (c.god !== undefined) {
      if (c.god)
        this.sim.addBuff(hero, {
          id: TEST_GOD,
          sourceId: hero.id,
          sourceOwner: hero.owner,
          sourceTeam: hero.team,
          until: Infinity,
          flags: 0,
          minHp: 1,
        });
      else this.sim.removeBuff(hero, TEST_GOD);
    }
    if (c.freeCasts !== undefined) {
      if (c.freeCasts) this.freeCasts.add(slot);
      else this.freeCasts.delete(slot);
    }
    if (c.reveal !== undefined) {
      const view = this.views.get(slot);
      if (view) view.reveal = c.reveal;
    }
    if (c.speed) this.speed = c.speed;
    if (c.levelUp && hero.heroState.level < MAX_LEVEL) this.sim.addXp(hero, xpForLevel(hero.heroState.level + 1) - hero.heroState.xp);
    if (c.xp) this.sim.addXp(hero, c.xp);
    if (c.gold) this.sim.addGold(hero, c.gold);
    const it = c.item ? itemIndex(c.item) : -1;
    if (it >= 0 && storeItem(hero.heroState.inventory, it, newCharges(it))) this.sim.refreshStats(hero);
    const p = c.pos && hero.alive ? nearestWalkable(this.sim.nav, c.pos[0], c.pos[1], 16) : null;
    if (p) this.sim.teleport(hero, p[0], p[1]);
    // Also full health and mana, and no cooldowns: quick ability tests.
    if (hero.alive) {
      hero.hp = hero.stats.maxHp;
      hero.mana = hero.stats.maxMana;
      hero.cooldowns.fill(0);
      hero.heroState.itemCooldowns.clear();
    }
  }

  /** Test units around a point: neutral (they attack everyone), or dummies that only stand and take hits. */
  private spawnTest(s: NonNullable<Cheat['spawn']>): void {
    const type = ENTITY_TYPES.indexOf(s.unit);
    if (type < 0 || isHeroType(type) || isBuildingType(type) || isMineType(type)) return;
    for (const id of this.testUnits) if (!this.sim.get(id)?.alive) this.testUnits.delete(id);
    const count = Math.min(s.count, MAX_TEST_UNITS - this.testUnits.size);
    for (let i = 0; i < count; i++) {
      // A small ring around the point, so a group does not stand on one spot.
      const a = (i / Math.max(1, count)) * Math.PI * 2;
      const r = count > 1 ? 1.2 + 0.25 * count : 0;
      const p = nearestWalkable(this.sim.nav, s.at[0] + Math.cos(a) * r, s.at[1] + Math.sin(a) * r, 16);
      if (!p) continue;
      const e = this.sim.spawn(type, NEUTRAL, NEUTRAL_TEAM, 255, p[0], p[1]);
      this.testUnits.add(e.id);
      if (s.dummy)
        this.sim.addBuff(e, {
          id: TEST_DUMMY,
          sourceId: e.id,
          sourceOwner: NEUTRAL,
          sourceTeam: NEUTRAL_TEAM,
          until: Infinity,
          flags: 0,
          stun: true,
          minHp: 1,
        });
    }
  }

  /** End screen data. */
  summary(): MatchSummary {
    return matchSummary(this.sim);
  }

  /** The winning team once the match is over, else 0. */
  get winnerTeam(): number {
    return this.sim.factions?.winnerTeam ?? 0;
  }

  /** A player is away for long: a hero bot plays for them until they come back (on = false). */
  setBot(slot: number, on: boolean): void {
    (this.sim.ai as FactionAI | null)?.setHeroBot(slot, on);
  }

  resetView(slot: number): void {
    this.views.get(slot)?.reset();
  }

  /** Runs one tick and returns one snapshot per online player. */
  tick(): MatchPacket[] {
    this.events.clear();
    for (let k = 0; k < this.speed; k++) {
      for (const slot of this.freeCasts) {
        const h = this.sim.heroes[slot];
        if (!h?.alive || !h.heroState) continue;
        h.cooldowns.fill(0);
        h.mana = h.stats.maxMana;
        h.heroState.itemCooldowns.clear();
      }
      this.sim.step();
      if (this.speed > 1) for (let i = 0; i < this.sim.events.count; i++) copyEvent(this.events, this.sim.events.items[i]!);
      if (this.sim.tick % TICK_RATE === 0) this.commandCount.clear();
    }
    // Vision every 2 ticks (10 Hz) is enough for "who can I see".
    if (this.speed > 1 || this.sim.tick % 2 === 1) this.vision.update(entitySources(this.sim.entities));
    const out: MatchPacket[] = [];
    for (const view of this.views.values()) {
      if (!view.active) continue;
      // Copy: the buffer moves to the main thread and the writer is reused.
      const data = view.write(this.sim, this.vision, this.sw, this.w, this.speed > 1 ? this.events : this.sim.events).slice();
      this.bytes.set(view.slot, (this.bytes.get(view.slot) ?? 0) + data.byteLength);
      out.push({ slot: view.slot, data });
    }
    return out;
  }
}
