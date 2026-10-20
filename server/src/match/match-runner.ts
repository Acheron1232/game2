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
  itemIndex,
  MatchSim,
  newCharges,
  MsgId,
  nearestWalkable,
  parseTerrain,
  readCommand,
  SnapshotWriter,
  storeItem,
  TeamVision,
  TICK_RATE,
  type MatchSetup,
  type TreeList,
} from '@game/shared';

/** What the dev cheat can do (lobby message `cheat`). */
export interface Cheat {
  xp?: number;
  gold?: number;
  item?: string;
  pos?: [number, number];
}

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
  private readonly vision: TeamVision;
  private readonly views = new Map<number, ClientView>();
  private readonly sw = new SnapshotWriter();
  private readonly w = new BinaryWriter(4096);
  private readonly commandCount = new Map<number, number>();
  /** bytes written per slot since the last stats read */
  readonly bytes = new Map<number, number>();
  droppedCommands = 0;

  /** sim steps per network tick (watch mode runs the game faster) */
  readonly speed: number;
  /** watch mode: all events of the steps since the last snapshot */
  private readonly events = new EventList();

  /** trees: with them the match has factions (bases, workers, the AI); without them only heroes. */
  constructor(setup: MatchSetup, terrainBytes: Uint8Array, trees?: TreeList) {
    const terrain = parseTerrain(terrainBytes);
    const nav = buildMatchNav(terrain, gameData.map);
    this.sim = new MatchSim(setup, nav, trees ? { terrain, trees } : undefined);
    this.vision = new TeamVision(gameData.map.size.width);
    this.vision.update(this.sim.entities);
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

  /** Dev servers only (the lobby checks): XP, gold, an item, a new place, full health and mana, cooldowns ready. */
  cheat(slot: number, c: Cheat): void {
    const hero = this.sim.heroes[slot];
    if (!hero?.heroState) return;
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
      this.sim.step();
      if (this.speed > 1) for (let i = 0; i < this.sim.events.count; i++) copyEvent(this.events, this.sim.events.items[i]!);
      if (this.sim.tick % TICK_RATE === 0) this.commandCount.clear();
    }
    // Vision every 2 ticks (10 Hz) is enough for "who can I see".
    if (this.speed > 1 || this.sim.tick % 2 === 1) this.vision.update(this.sim.entities);
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
