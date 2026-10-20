// The lobby service: rooms, slots, chat, match start and rejoin. Runs on the main thread.
// Matches run in their own worker (see match/match-host.ts).

import {
  entityTypeIndex,
  gameData,
  RANDOM_HERO,
  Rng,
  type ClientLobbyMessage,
  type ErrorCode,
  type MatchSetup,
  type MatchSummary,
  type RoomSummary,
  type ServerLobbyMessage,
  type SlotState,
} from '@game/shared';
import { createMatchHost, type MatchHost, type MatchMap } from '../match/match-host';
import { SPECTATOR } from '../match/match-runner';
import type { Player, PlayerConn, PlayerRegistry } from './players';
import { emptySlot, makeRoomCode, Room } from './room';

export interface LobbyOptions {
  serverVersion: string;
  matchMode: 'worker' | 'inline';
  /** Load-test options in the start message are only used when this is on. */
  allowTestOptions: boolean;
  /** A player who drops in the lobby keeps the slot this long (page reload). */
  lobbyGraceMs: number;
  /** A player who drops in a match can come back this long, then a bot takes the slot. */
  reconnectMs: number;
  /** The match starts this long after "start" even if a client did not say it is ready. */
  matchReadyTimeoutMs: number;
  /** terrain grid + trees; read once and shared by all matches */
  map: () => MatchMap;
  /** after one team wins, players see the end screen this long, then the room goes back to the lobby */
  matchEndDelayMs: number;
}

const HERO_IDS = new Set(gameData.heroes.map((h) => h.id));
const ERR: Record<ErrorCode, string> = {
  bad_protocol: 'The game was updated. Please reload the page.',
  bad_message: 'This message is not valid.',
  no_room: 'No game with this code.',
  room_full: 'This game is full.',
  not_host: 'Only the host can do this.',
  not_allowed: 'You can not change this.',
  color_taken: 'This color is taken.',
  not_ready: 'Not all players are ready.',
  in_match: 'This game has already started.',
};

export class Lobby {
  readonly rooms = new Map<string, Room>();
  private matchCount = 0;

  constructor(
    readonly players: PlayerRegistry,
    private readonly options: LobbyOptions,
  ) {}

  // ---------- connections ----------

  /** hello: a new player, or a returning one (same browser session). */
  connect(conn: PlayerConn, name: string, own: string | undefined, others: readonly string[]): Player {
    let p = this.players.resume(own, others);
    if (p) {
      if (p.conn && p.conn !== conn) p.conn.close(4003, 'Opened in another tab');
      p.conn = conn;
      p.offlineSince = 0;
      if (p.timer) clearTimeout(p.timer);
      p.timer = null;
    } else {
      p = this.players.create(name, conn);
    }
    this.send(p, { type: 'welcome', playerId: p.id, session: p.session, serverVersion: this.options.serverVersion, name: p.name });
    const room = p.room;
    const slot = room?.slotOf(p);
    if (room && slot) {
      slot.online = true;
      if (room.phase === 'playing' && slot.away) {
        room.match?.setBot(slot.index, false);
        slot.away = false;
        this.chat(room, `${slot.name} is back.`);
      }
      this.broadcastRoom(room);
      if (room.phase === 'playing') this.sendMatchStart(room, p, true);
    }
    return p;
  }

  disconnect(p: Player, conn: PlayerConn): void {
    if (p.conn !== conn) return; // an old socket of a player who came back in a new one
    p.conn = null;
    p.offlineSince = Date.now();
    const room = p.room;
    const slot = room?.slotOf(p);
    if (!room || !slot) {
      // Not in a game: forget the player after a while.
      p.timer = setTimeout(() => !p.conn && this.players.remove(p), 5 * 60_000);
      return;
    }
    slot.online = false;
    if (room.phase === 'playing') {
      room.match?.setOnline(slot.index, false);
      this.chat(room, `${slot.name} left. The hero waits at the base.`);
      // Away for long: a bot plays the hero, but the seat stays this player's for the whole
      // match. Coming back (same browser, even after closing it) gives the hero back.
      p.timer = setTimeout(() => {
        if (p.conn || p.room !== room || room.phase !== 'playing') return;
        room.match?.setBot(slot.index, true);
        slot.away = true;
        this.chat(room, `A bot plays for ${slot.name} until they come back.`);
        this.broadcastRoom(room);
      }, this.options.reconnectMs);
    } else {
      p.timer = setTimeout(() => !p.conn && this.leave(p, 'left'), this.options.lobbyGraceMs);
    }
    this.broadcastRoom(room);
  }

  /** A binary game message from a player. */
  binary(p: Player, data: Uint8Array): void {
    const room = p.room;
    const slot = room?.slotOf(p);
    if (room?.going && slot) room.match?.command(slot.index, data);
  }

  // ---------- lobby messages ----------

  handle(p: Player, msg: ClientLobbyMessage): void {
    switch (msg.type) {
      case 'hello':
        return;
      case 'setName': {
        p.name = msg.name;
        const slot = p.room?.slotOf(p);
        if (slot && p.room) {
          slot.name = msg.name;
          this.broadcastRoom(p.room);
        }
        return;
      }
      case 'createRoom':
        return this.createRoom(p);
      case 'listRooms':
        return this.send(p, { type: 'roomList', rooms: this.roomList() });
      case 'joinRoom':
        return this.joinRoom(p, msg.code.trim().toUpperCase());
      case 'leaveRoom':
        return this.leave(p, 'left');
      case 'setSlotKind':
        return this.setSlotKind(p, msg.slot, msg.kind);
      case 'kick':
        return this.kick(p, msg.slot);
      case 'updateSlot':
        return this.updateSlot(p, msg);
      case 'ready':
      case 'load': {
        const room = p.room;
        const slot = room?.slotOf(p);
        if (!room || !slot || room.phase !== 'lobby') return;
        if (msg.type === 'ready') slot.ready = msg.ready;
        else {
          const pct = Math.floor(msg.pct);
          if (pct === slot.load) return;
          slot.load = pct;
        }
        return this.broadcastRoom(room);
      }
      case 'chat': {
        const text = msg.text.trim().slice(0, 200);
        if (p.room && text) this.broadcast(p.room, { type: 'chat', from: p.name, text });
        return;
      }
      case 'start':
        return this.start(p, msg.test, msg.watch?.speed);
      case 'matchReady': {
        const room = p.room;
        if (!room || room.phase !== 'playing') return;
        room.matchReady.add(p.id);
        // The client may have missed the first (full) snapshot while it was still loading.
        const own = room.slotOf(p);
        if (room.going && own) room.match?.resetView(own.index);
        if (room.humans.every((s) => !s.online || room.matchReady.has(s.playerId!))) this.go(room);
        return;
      }
      case 'endMatch':
        return this.endMatch(p);
      case 'cheat': {
        const slot = p.room?.slotOf(p);
        if (this.options.allowTestOptions && slot && p.room?.going) p.room.match?.cheat(slot.index, msg);
        return;
      }
    }
  }

  private createRoom(p: Player): void {
    if (!this.leaveForNewRoom(p)) return;
    const room = new Room(
      makeRoomCode((c) => this.rooms.has(c)),
      p.id,
    );
    this.rooms.set(room.code, room);
    this.seat(room, room.slots[0]!, p);
    this.broadcastRoom(room);
  }

  private joinRoom(p: Player, code: string): void {
    const room = this.rooms.get(code);
    if (!room) return this.error(p, 'no_room');
    if (p.room === room) return this.broadcastRoom(room);
    if (room.phase !== 'lobby') return this.error(p, 'in_match');
    const slot = room.slots.find((s) => s.kind === 'open');
    if (!slot) return this.error(p, 'room_full');
    if (!this.leaveForNewRoom(p)) return;
    this.seat(room, slot, p);
    this.chat(room, `${p.name} joined.`);
    this.broadcastRoom(room);
  }

  private leaveForNewRoom(p: Player): boolean {
    if (p.room?.phase === 'playing') {
      this.error(p, 'in_match');
      return false;
    }
    if (p.room) this.leave(p, 'left');
    return true;
  }

  private seat(room: Room, slot: SlotState, p: Player): void {
    Object.assign(slot, emptySlot(slot.index), { kind: 'human', playerId: p.id, name: p.name, online: !!p.conn });
    // Keep colors unique: take the first free one if the slot's own color is used.
    const used = new Set(room.slots.filter((s) => s !== slot && s.kind !== 'open' && s.kind !== 'closed').map((s) => s.color));
    if (used.has(slot.color)) slot.color = [0, 1, 2, 3].find((c) => !used.has(c)) ?? slot.color;
    room.members.add(p);
    p.room = room;
  }

  /** The player leaves the room. In a running match a bot takes over the hero. */
  leave(p: Player, reason: 'left' | 'kicked'): void {
    const room = p.room;
    if (!room) return;
    const slot = room.slotOf(p);
    if (room.phase === 'playing' && slot) return this.botTakesOver(room, p, reason);
    if (slot) Object.assign(slot, emptySlot(slot.index));
    room.members.delete(p);
    p.room = null;
    this.send(p, { type: 'roomLeft', reason });
    if (slot) this.chat(room, reason === 'kicked' ? `${p.name} was kicked.` : `${p.name} left.`);
    this.afterLeave(room);
  }

  private botTakesOver(room: Room, p: Player, reason: 'left' | 'kicked' = 'left'): void {
    const slot = room.slotOf(p);
    if (slot) {
      Object.assign(slot, { kind: 'bot', playerId: null, name: `${slot.name} (bot)`, online: false, ready: true, load: 100 });
      this.chat(room, `A bot plays for ${p.name} now.`);
    }
    room.members.delete(p);
    p.room = null;
    if (p.timer) clearTimeout(p.timer);
    p.timer = null;
    this.send(p, { type: 'roomLeft', reason });
    this.afterLeave(room);
  }

  private afterLeave(room: Room): void {
    const humans = room.humans;
    if (!humans.length) return this.closeRoom(room);
    if (!humans.some((s) => s.playerId === room.hostId)) room.hostId = (humans.find((s) => s.online) ?? humans[0]!).playerId!;
    this.broadcastRoom(room);
  }

  private closeRoom(room: Room): void {
    room.match?.stop();
    if (room.goTimer) clearTimeout(room.goTimer);
    if (room.endTimer) clearTimeout(room.endTimer);
    for (const m of room.members) {
      m.room = null;
      this.send(m, { type: 'roomLeft', reason: 'closed' });
    }
    this.rooms.delete(room.code);
  }

  private setSlotKind(p: Player, index: number, kind: 'open' | 'bot' | 'closed'): void {
    const room = this.hostRoom(p);
    if (!room) return;
    const slot = room.slots[index]!;
    if (slot.playerId === p.id) return this.error(p, 'not_allowed');
    if (slot.kind === 'human') {
      const other = this.players.get(slot.playerId!);
      if (other) this.leave(other, 'kicked');
    }
    Object.assign(slot, emptySlot(index), { kind });
    if (kind === 'bot') {
      const used = new Set(room.slots.filter((s) => s !== slot && s.kind !== 'open' && s.kind !== 'closed').map((s) => s.color));
      Object.assign(slot, {
        name: `Bot ${index + 1}`,
        ready: true,
        load: 100,
        color: used.has(index) ? ([0, 1, 2, 3].find((c) => !used.has(c)) ?? index) : index,
      });
    }
    this.broadcastRoom(room);
  }

  private kick(p: Player, index: number): void {
    const room = this.hostRoom(p);
    if (!room) return;
    const slot = room.slots[index]!;
    if (slot.kind !== 'human' || slot.playerId === p.id) return this.error(p, 'not_allowed');
    const other = this.players.get(slot.playerId!);
    if (other) this.leave(other, 'kicked');
  }

  private updateSlot(p: Player, msg: Extract<ClientLobbyMessage, { type: 'updateSlot' }>): void {
    const room = p.room;
    if (!room || room.phase !== 'lobby') return;
    const slot = room.slots[msg.slot]!;
    const own = slot.playerId === p.id;
    const hostBot = room.hostId === p.id && slot.kind === 'bot';
    if (!own && !hostBot) return this.error(p, 'not_allowed');
    if (msg.color !== undefined && msg.color !== slot.color) {
      if (room.slots.some((s) => s !== slot && s.kind !== 'open' && s.kind !== 'closed' && s.color === msg.color))
        return this.error(p, 'color_taken');
      slot.color = msg.color;
    }
    if (msg.team !== undefined) slot.team = msg.team;
    if (msg.hero !== undefined && (msg.hero === RANDOM_HERO || HERO_IDS.has(msg.hero))) slot.hero = msg.hero;
    if (msg.ai !== undefined && hostBot) slot.ai = msg.ai;
    this.broadcastRoom(room);
  }

  private hostRoom(p: Player): Room | null {
    const room = p.room;
    if (!room) return null;
    if (room.hostId !== p.id) {
      this.error(p, 'not_host');
      return null;
    }
    if (room.phase !== 'lobby') {
      this.error(p, 'in_match');
      return null;
    }
    return room;
  }

  // ---------- match ----------

  private start(p: Player, test?: { units: number; area: 'bases' | 'center' }, watchSpeed?: number): void {
    // Watch mode is a dev tool (like the load test): bots play, the players only watch.
    const watch = watchSpeed && this.options.allowTestOptions ? watchSpeed : 0;
    const room = this.hostRoom(p);
    if (!room) return;
    const humans = room.humans;
    const waiting = humans.filter((s) => s.load < 100 || (!s.ready && s.playerId !== room.hostId) || !s.online);
    if (waiting.length)
      return this.send(p, { type: 'error', code: 'not_ready', text: `Waiting for: ${waiting.map((s) => s.name).join(', ')}.` });

    const seed = (Math.random() * 2 ** 31) | 0;
    const rng = new Rng(seed);
    const playing = room.slots.filter((s) => s.kind === 'human' || s.kind === 'bot');
    const starts = rng.shuffle([0, 1, 2, 3]);
    const taken = new Set(playing.map((s) => s.hero).filter((h) => h !== RANDOM_HERO));
    const heroes = playing.map((s) => {
      if (s.hero !== RANDOM_HERO) return s.hero;
      const free = gameData.heroes.map((h) => h.id).filter((h) => !taken.has(h));
      const pick = rng.pick(free.length ? free : gameData.heroes.map((h) => h.id));
      taken.add(pick);
      return pick;
    });
    const setup: MatchSetup = {
      seed,
      slots: playing.map((s, i) => ({
        index: s.index,
        heroType: entityTypeIndex(heroes[i]!),
        team: s.team,
        color: s.color,
        start: starts[i]!,
        // Every player has a faction run by the AI (Normal for humans); a bot slot also has an AI hero.
        ai: s.kind === 'bot' ? s.ai : ('normal' as const),
        bot: s.kind === 'bot' || !!watch,
      })),
    };
    if (watch) setup.watch = watch;
    if (test && this.options.allowTestOptions) {
      setup.testUnits = test.units;
      setup.testArea = test.area;
    }
    room.matchInfo = {
      matchId: `${room.code}-${++this.matchCount}`,
      ...(watch ? { watch } : {}),
      slots: playing.map((s, i) => ({
        index: s.index,
        kind: s.kind,
        name: s.name,
        team: s.team,
        color: s.color,
        hero: heroes[i]!,
        start: starts[i]!,
      })),
    };
    room.phase = 'playing';
    room.going = false;
    room.matchReady.clear();
    room.match = this.createMatch(room, setup);
    for (const m of room.members) this.sendMatchStart(room, m, false);
    this.broadcastRoom(room);
    room.goTimer = setTimeout(() => this.go(room), this.options.matchReadyTimeoutMs);
  }

  private createMatch(room: Room, setup: MatchSetup): MatchHost {
    const host = createMatchHost(setup, this.options.map(), this.options.matchMode);
    host.onEnd = (winnerTeam, summary) => {
      if (room.match !== host) return;
      room.endTimer = setTimeout(() => {
        if (room.match === host) this.finishMatch(room, winnerTeam, summary);
      }, this.options.matchEndDelayMs);
    };
    host.onPackets = (_tick, packets) => {
      for (const { slot, data } of packets) {
        // Watch mode: the spectator snapshot goes to every player in the room.
        if (slot === SPECTATOR) {
          for (const m of room.members) m.conn?.sendBinary(data);
          continue;
        }
        const id = room.slots[slot]?.playerId;
        const conn = id ? this.players.get(id)?.conn : null;
        conn?.sendBinary(data);
      }
    };
    return host;
  }

  private go(room: Room): void {
    if (room.going || room.phase !== 'playing' || !room.match) return;
    if (room.goTimer) clearTimeout(room.goTimer);
    room.goTimer = null;
    room.going = true;
    // Players who are offline right now get no snapshots until they come back.
    for (const s of room.slots) if (s.kind === 'human' && !s.online) room.match.setOnline(s.index, false);
    for (const s of room.slots) if (s.kind === 'bot' || room.matchInfo?.watch) room.match.setOnline(s.index, false);
    room.match.go();
    this.broadcast(room, { type: 'matchGo', tick: 0 });
  }

  private sendMatchStart(room: Room, p: Player, rejoin: boolean): void {
    const slot = room.slotOf(p);
    if (!room.matchInfo || !slot) return;
    const watch = !!room.matchInfo.watch;
    this.send(p, { type: 'matchStart', match: { ...room.matchInfo, yourSlot: watch ? SPECTATOR : slot.index, rejoin } });
    if (rejoin) {
      if (watch) room.match?.resetView(SPECTATOR);
      else room.match?.setOnline(slot.index, true);
      if (room.going) this.send(p, { type: 'matchGo', tick: 0 });
    }
  }

  private endMatch(p: Player): void {
    const room = p.room;
    if (!room || room.phase !== 'playing') return;
    if (room.hostId !== p.id) return this.error(p, 'not_host');
    this.finishMatch(room, 0);
  }

  private finishMatch(room: Room, winnerTeam: number, summary?: MatchSummary): void {
    if (room.endTimer) clearTimeout(room.endTimer);
    room.endTimer = null;
    room.match?.stop();
    room.match = null;
    room.matchInfo = null;
    room.going = false;
    room.phase = 'lobby';
    for (const s of room.slots)
      if (s.kind === 'human') {
        s.ready = false;
        s.away = false;
      }
    // Players who never came back are gone now.
    for (const m of [...room.members]) if (!m.conn) this.leave(m, 'left');
    if (!this.rooms.has(room.code)) return;
    this.broadcast(room, { type: 'matchEnd', winnerTeam, ...(summary ? { summary } : {}) });
    this.broadcastRoom(room);
  }

  // ---------- sending ----------

  private send(p: Player, msg: ServerLobbyMessage): void {
    p.conn?.sendJson(msg);
  }

  private error(p: Player, code: ErrorCode): void {
    this.send(p, { type: 'error', code, text: ERR[code] });
  }

  private broadcast(room: Room, msg: ServerLobbyMessage): void {
    for (const m of room.members) this.send(m, msg);
  }

  private broadcastRoom(room: Room): void {
    this.broadcast(room, { type: 'room', room: room.state() });
  }

  private chat(room: Room, text: string): void {
    this.broadcast(room, { type: 'chat', from: '', text, system: true });
  }

  /** Games for the menu list: open lobbies first, then running matches. At most 50. */
  roomList(): RoomSummary[] {
    const list: RoomSummary[] = [];
    for (const r of this.rooms.values()) {
      const host = r.slots.find((s) => s.playerId === r.hostId);
      list.push({
        code: r.code,
        host: host?.name ?? '?',
        phase: r.phase,
        humans: r.humans.length,
        bots: r.slots.filter((s) => s.kind === 'bot').length,
        open: r.phase === 'lobby' ? r.slots.filter((s) => s.kind === 'open').length : 0,
      });
    }
    list.sort((a, b) => (a.phase === b.phase ? b.open - a.open : a.phase === 'lobby' ? -1 : 1));
    return list.slice(0, 50);
  }

  /** For /health and the load test. */
  summary(): { rooms: number; matches: number } {
    let matches = 0;
    for (const r of this.rooms.values()) if (r.phase === 'playing') matches++;
    return { rooms: this.rooms.size, matches };
  }

  close(): void {
    for (const room of [...this.rooms.values()]) this.closeRoom(room);
  }
}
