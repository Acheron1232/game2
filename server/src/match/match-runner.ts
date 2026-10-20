// One match: the simulation, vision and one ClientView per player slot. It does not know about
// threads or sockets: the worker (or the inline host in tests) calls tick() 20 times a second.

import {
  BinaryReader,
  BinaryWriter,
  buildMatchNav,
  ClientView,
  gameData,
  MatchSim,
  MsgId,
  parseTerrain,
  readCommand,
  SnapshotWriter,
  TeamVision,
  TICK_RATE,
  type MatchSetup,
} from '@game/shared';

/** Commands per second per player. Real play needs far less; the rest is dropped. */
export const MAX_COMMANDS_PER_SEC = 30;

export interface MatchPacket {
  slot: number;
  data: Uint8Array<ArrayBuffer>;
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

  constructor(setup: MatchSetup, terrainBytes: Uint8Array) {
    const nav = buildMatchNav(parseTerrain(terrainBytes), gameData.map);
    this.sim = new MatchSim(setup, nav);
    this.vision = new TeamVision(gameData.map.size.width);
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

  resetView(slot: number): void {
    this.views.get(slot)?.reset();
  }

  /** Runs one tick and returns one snapshot per online player. */
  tick(): MatchPacket[] {
    this.sim.step();
    if (this.sim.tick % TICK_RATE === 0) this.commandCount.clear();
    // Vision every 2 ticks (10 Hz) is enough for "who can I see".
    if (this.sim.tick % 2 === 1) this.vision.update(this.sim.entities);
    const out: MatchPacket[] = [];
    for (const view of this.views.values()) {
      if (!view.active) continue;
      // Copy: the buffer moves to the main thread and the writer is reused.
      const data = view.write(this.sim, this.vision, this.sw, this.w).slice();
      this.bytes.set(view.slot, (this.bytes.get(view.slot) ?? 0) + data.byteLength);
      out.push({ slot: view.slot, data });
    }
    return out;
  }
}
