import type { AddressInfo } from 'node:net';
import { CommandType, type ServerLobbyMessage } from '@game/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGameServer, type GameServer } from '../src/server';
import { TestClient } from './helpers';

let server: GameServer;
let base: string;

beforeAll(async () => {
  server = createGameServer({
    matchMode: 'inline',
    allowTestOptions: true,
    lobbyGraceMs: 200,
    reconnectMs: 2000,
    matchReadyTimeoutMs: 3000,
  });
  await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

type Msg<T extends ServerLobbyMessage['type']> = Extract<ServerLobbyMessage, { type: T }>;

describe('lobby and match', () => {
  it('runs a 2-player game from room to moving heroes, and a dropped player rejoins', async () => {
    const host = await TestClient.connect(base, 'Host');
    host.send({ type: 'createRoom' });
    const code = (await host.waitFor<Msg<'room'>>((m) => m.type === 'room')).room.code;
    expect(code).toMatch(/^[A-Z2-9]{5}$/);

    const guest = await TestClient.connect(base, 'Guest');
    guest.send({ type: 'joinRoom', code });
    await guest.waitFor((m) => m.type === 'room');
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.kind === 'human');
    expect(host.lastRoom()!.slots[1]!.name).toBe('Guest');

    // Colors stay unique.
    let n = guest.json.length;
    guest.send({ type: 'updateSlot', slot: 1, color: 0 });
    expect((await guest.waitFor<Msg<'error'>>((m) => m.type === 'error', n)).code).toBe('color_taken');
    // Only own slot (or a bot for the host) can change.
    n = guest.json.length;
    guest.send({ type: 'updateSlot', slot: 0, hero: 'sky_dragon' });
    expect((await guest.waitFor<Msg<'error'>>((m) => m.type === 'error', n)).code).toBe('not_allowed');
    guest.send({ type: 'updateSlot', slot: 1, hero: 'stone_golem', team: 2 });

    // Not loaded yet: the host can not start.
    n = host.json.length;
    host.send({ type: 'start' });
    expect((await host.waitFor<Msg<'error'>>((m) => m.type === 'error', n)).code).toBe('not_ready');

    for (const c of [host, guest]) c.send({ type: 'load', pct: 100 });
    guest.send({ type: 'ready', ready: true });
    guest.send({ type: 'chat', text: 'hi' });
    expect((await host.waitFor<Msg<'chat'>>((m) => m.type === 'chat' && !m.system)).text).toBe('hi');
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.ready === true && host.lastRoom()?.slots[1]?.load === 100);

    host.send({ type: 'start' });
    const hs = (await host.waitFor<Msg<'matchStart'>>((m) => m.type === 'matchStart')).match;
    const gs = (await guest.waitFor<Msg<'matchStart'>>((m) => m.type === 'matchStart')).match;
    expect(hs.yourSlot).toBe(0);
    expect(gs.yourSlot).toBe(1);
    expect(gs.slots.find((s) => s.index === 1)!.hero).toBe('stone_golem');
    for (const c of [host, guest]) c.send({ type: 'matchReady' });
    await host.waitFor((m) => m.type === 'matchGo');

    // Snapshots come every tick; the first one spawns at least the own hero.
    await host.waitUntil(() => host.snapshots.length >= 5);
    expect(host.snapshots[0]!.full).toBe(true);
    const heroId = host.snapshots[0]!.spawns[0]!;
    const before = { ...host.pos.get(heroId)! };

    const seq = host.command({ type: CommandType.Move, x: before.x / 256 + 6, y: before.y / 256 - 6, queue: false });
    await host.waitUntil(() => host.snapshots.some((s) => s.ack === seq));
    await host.waitUntil(() => host.pos.get(heroId)!.x !== before.x, 2000);

    // Standing still costs almost nothing: an idle snapshot is a few bytes.
    const idle = guest.snapshots.slice(-3).map((s) => s.bytes);
    expect(Math.min(...idle)).toBeLessThan(40);

    // The guest drops and comes back with its session.
    const session = guest.session;
    await guest.close();
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.online === false);
    const back = await TestClient.connect(base, 'Guest', session);
    expect(back.playerId).toBe(guest.playerId);
    expect(back.json[0]).toMatchObject({ type: 'welcome', inRoom: true });
    const rejoin = (await back.waitFor<Msg<'matchStart'>>((m) => m.type === 'matchStart')).match;
    expect(rejoin.rejoin).toBe(true);
    await back.waitUntil(() => back.snapshots.length > 0);
    expect(back.snapshots[0]!.full).toBe(true);
    expect(back.snapshots[0]!.spawns.length).toBeGreaterThan(0);

    host.send({ type: 'endMatch' });
    await back.waitFor((m) => m.type === 'matchEnd');
    expect(back.lastRoom()?.phase).toBe('lobby');
    await Promise.all([host.close(), back.close()]);
  });

  it('a bot plays for a player who is away long, and the player gets the hero back later', async () => {
    const host = await TestClient.connect(base, 'A');
    host.send({ type: 'createRoom' });
    const code = (await host.waitFor<Msg<'room'>>((m) => m.type === 'room')).room.code;
    const b = await TestClient.connect(base, 'B');
    b.send({ type: 'joinRoom', code });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.kind === 'human');
    for (const c of [host, b]) c.send({ type: 'load', pct: 100 });
    b.send({ type: 'ready', ready: true });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.ready === true && host.lastRoom()?.slots[1]?.load === 100);
    host.send({ type: 'start' });
    await host.waitFor((m) => m.type === 'matchStart');
    const session = b.session;
    await b.close();
    // After the reconnect window (2 s here) a bot plays the hero, but the seat is still B's.
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.away === true, 4000);
    expect(host.lastRoom()!.slots[1]!.kind).toBe('human');
    expect(host.lastRoom()!.slots[1]!.name).toBe('B');
    // Much later B opens the game again (same browser): straight back into the match.
    const back = await TestClient.connect(base, 'B', session);
    expect(back.playerId).toBe(b.playerId);
    expect((await back.waitFor<Msg<'matchStart'>>((m) => m.type === 'matchStart')).match.rejoin).toBe(true);
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.away === false && host.lastRoom()?.slots[1]?.online === true);
    await Promise.all([host.close(), back.close()]);
  });

  it('gives the slot to a bot for good when a player leaves the match', async () => {
    const host = await TestClient.connect(base, 'C');
    host.send({ type: 'createRoom' });
    const code = (await host.waitFor<Msg<'room'>>((m) => m.type === 'room')).room.code;
    const d = await TestClient.connect(base, 'D');
    d.send({ type: 'joinRoom', code });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.kind === 'human');
    for (const c of [host, d]) c.send({ type: 'load', pct: 100 });
    d.send({ type: 'ready', ready: true });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.ready === true && host.lastRoom()?.slots[1]?.load === 100);
    host.send({ type: 'start' });
    await host.waitFor((m) => m.type === 'matchStart');
    d.send({ type: 'leaveRoom' });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.kind === 'bot', 4000);
    expect(host.lastRoom()!.slots[1]!.name).toContain('(bot)');
    await Promise.all([host.close(), d.close()]);
  });

  it('a team room: 8 slots, the partner of a kingdom joins its team, open team slots get bots', async () => {
    const host = await TestClient.connect(base, 'H');
    host.send({ type: 'createRoom' });
    const code = (await host.waitFor<Msg<'room'>>((m) => m.type === 'room')).room.code;
    host.send({ type: 'setMode', mode: 'teams' });
    await host.waitUntil(() => host.lastRoom()?.mode === 'teams' && host.lastRoom()!.slots.length === 8);
    // Kingdoms 3 and 4 do not play: both their slots closed.
    for (const i of [2, 3, 6, 7]) host.send({ type: 'setSlotKind', slot: i, kind: 'closed' });
    host.send({ type: 'setSlotKind', slot: 5, kind: 'closed' });
    await host.waitUntil(() => host.lastRoom()?.slots[5]?.kind === 'closed');
    const g = await TestClient.connect(base, 'G');
    g.send({ type: 'joinRoom', code });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.kind === 'human');
    // Team and color belong to the slot in a team room.
    g.send({ type: 'updateSlot', slot: 1, team: 1, color: 0 });
    for (const c of [host, g]) c.send({ type: 'load', pct: 100 });
    g.send({ type: 'ready', ready: true });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.ready === true && host.lastRoom()?.slots[1]?.load === 100);
    expect(host.lastRoom()!.slots[1]!.team).toBe(2);
    host.send({ type: 'start' });
    const info = (await g.waitFor<Msg<'matchStart'>>((m) => m.type === 'matchStart')).match;
    // Host's kingdom: host + a bot in its open second slot 4; guest's kingdom: guest only (slot 5 closed).
    expect(info.slots.map((s) => s.index).sort()).toEqual([0, 1, 4]);
    const partner = info.slots.find((s) => s.index === 4)!;
    expect(partner.kind).toBe('bot');
    expect(partner.team).toBe(1);
    expect(partner.start).toBe(info.slots.find((s) => s.index === 0)!.start);
    await Promise.all([host.close(), g.close()]);
  });

  it('the host can kick and a full room says so', async () => {
    const host = await TestClient.connect(base, 'H');
    host.send({ type: 'createRoom' });
    const code = (await host.waitFor<Msg<'room'>>((m) => m.type === 'room')).room.code;
    host.send({ type: 'setSlotKind', slot: 2, kind: 'bot' });
    host.send({ type: 'setSlotKind', slot: 3, kind: 'closed' });
    const g = await TestClient.connect(base, 'G');
    g.send({ type: 'joinRoom', code });
    await host.waitUntil(() => host.lastRoom()?.slots[1]?.kind === 'human');
    const x = await TestClient.connect(base, 'X');
    x.send({ type: 'joinRoom', code });
    expect((await x.waitFor<Msg<'error'>>((m) => m.type === 'error')).code).toBe('room_full');
    host.send({ type: 'kick', slot: 1 });
    expect((await g.waitFor<Msg<'roomLeft'>>((m) => m.type === 'roomLeft')).reason).toBe('kicked');
    await Promise.all([host.close(), g.close(), x.close()]);
  });
});
