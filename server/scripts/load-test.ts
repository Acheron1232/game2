// Load test: 4 fake players play one match with many test units. Prints server tick time and
// the bytes each player gets per second.
//
//   pnpm --filter @game/server load-test -- --units 300 --area bases --seconds 20
//
// --area bases: test units walk around their own base (normal game: each player sees its own).
// --area center: all units walk on the temple (worst case: everyone sees everything).

import type { AddressInfo } from 'node:net';
import { parseArgs } from 'node:util';
import { CommandType, dqPos, gameData, type MatchStats, type ServerLobbyMessage } from '@game/shared';
import { createGameServer } from '../src/server';
import { TestClient } from '../test/helpers';

const { values } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    units: { type: 'string', default: '300' },
    area: { type: 'string', default: 'bases' },
    seconds: { type: 'string', default: '20' },
    inline: { type: 'boolean', default: false },
  },
});
const units = Number(values.units);
const area = values.area === 'center' ? 'center' : 'bases';
const seconds = Number(values.seconds);

const server = createGameServer({ matchMode: values.inline ? 'inline' : 'worker', allowTestOptions: true, matchReadyTimeoutMs: 5000 });
await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
const base = `127.0.0.1:${(server.http.address() as AddressInfo).port}`;

type Msg<T extends ServerLobbyMessage['type']> = Extract<ServerLobbyMessage, { type: T }>;
const clients = await Promise.all([0, 1, 2, 3].map((i) => TestClient.connect(base, `Load ${i + 1}`)));
const [host] = clients as [TestClient];
host.send({ type: 'createRoom' });
const code = (await host.waitFor<Msg<'room'>>((m) => m.type === 'room')).room.code;
for (const c of clients.slice(1)) {
  c.send({ type: 'joinRoom', code });
  await c.waitFor((m) => m.type === 'room');
}
for (const c of clients) c.send({ type: 'load', pct: 100 });
for (const c of clients.slice(1)) c.send({ type: 'ready', ready: true });
await host.waitUntil(
  () => host.lastRoom()?.slots.every((s) => s.kind === 'human' && s.load === 100 && (s.ready || s.index === 0)) ?? false,
);
host.send({ type: 'start', test: { units, area } });
const starts = await Promise.all(clients.map((c) => c.waitFor<Msg<'matchStart'>>((m) => m.type === 'matchStart')));
for (const c of clients) c.send({ type: 'matchReady' });
await host.waitFor((m) => m.type === 'matchGo');
console.log(`Match running: 4 players, ${units} test units around ${area === 'center' ? 'the temple' : 'the bases'}, ${seconds} s.`);

// Each player clicks somewhere near its hero every 1-3 seconds, like a real player walking around.
const timers = clients.map((c, i) => {
  const slot = starts[i]!.match.yourSlot;
  const start = gameData.map.starts[starts[i]!.match.slots.find((s) => s.index === slot)!.start]!;
  const click = () => {
    const id = c.ownHero(slot);
    const p = id ? c.pos.get(id) : undefined;
    const [x, y] = p ? [dqPos(p.x), dqPos(p.y)] : start.heroSpawn;
    c.command({ type: CommandType.Move, x: x + (Math.random() - 0.5) * 30, y: y + (Math.random() - 0.5) * 30, queue: false });
  };
  return setInterval(click, 1000 + Math.random() * 2000);
});

// Measure after a 3 second warm-up.
await new Promise((r) => setTimeout(r, 3000));
const bytes0 = clients.map((c) => c.bytes);
const t0 = performance.now();
const stats: MatchStats[] = [];
const statTimer = setInterval(() => {
  const room = [...server.lobby.rooms.values()][0];
  if (room?.match?.stats) stats.push(room.match.stats);
}, 1000);
await new Promise((r) => setTimeout(r, seconds * 1000));
clearInterval(statTimer);
const secs = (performance.now() - t0) / 1000;
for (const t of timers) clearInterval(t);

const kbs = clients.map((c, i) => (c.bytes - bytes0[i]!) / secs / 1024);
const avg = stats.length ? stats.reduce((a, s) => a + s.tickMsAvg, 0) / stats.length : NaN;
const max = stats.length ? Math.max(...stats.map((s) => s.tickMsMax)) : NaN;
const result = {
  units,
  area,
  seconds: Math.round(secs),
  entities: stats[stats.length - 1]?.entities ?? null,
  tickMsAvg: Number(avg.toFixed(3)),
  tickMsMax: Number(max.toFixed(3)),
  downKBps: kbs.map((k) => Number(k.toFixed(2))),
  downKBpsMax: Number(Math.max(...kbs).toFixed(2)),
  snapshotsPerSec: Number((clients[0]!.snapshots.length / (secs + 3.5)).toFixed(1)),
};
console.log(JSON.stringify(result, null, 2));
console.log(`Max tick per second: ${stats.map((s) => s.tickMsMax.toFixed(1)).join(' ')}`);
console.log(`Budget: tick < 10 ms -> ${max < 10 ? 'OK' : 'OVER'}; down < 20 KB/s per player -> ${result.downKBpsMax < 20 ? 'OK' : 'OVER'}`);
await Promise.all(clients.map((c) => c.close()));
await server.close();
process.exit(0);
