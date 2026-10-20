import type { AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import type { MatchStartInfo, SnapshotData } from '@game/shared';
import { createGameServer } from '../src/server';
import { TestClient } from './helpers';

describe('production command boundaries', () => {
  it('ignores mass spawns, speed overrides, cheats and debug match termination', async () => {
    const server = createGameServer({ matchMode: 'inline', allowTestOptions: false });
    await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
    const client = await TestClient.connect(`127.0.0.1:${(server.http.address() as AddressInfo).port}`, 'Release test');
    try {
      client.send({ type: 'createRoom' });
      await client.waitFor((m) => m.type === 'room');
      client.send({ type: 'load', pct: 100 });
      await client.waitUntil(() => client.lastRoom()?.slots[0]?.load === 100);
      client.send({ type: 'start', test: { units: 300, area: 'center' }, watch: { speed: 10 } });
      const message = await client.waitFor((m) => m.type === 'matchStart');
      expect((message as { match: MatchStartInfo }).match.watch).toBeUndefined();
      client.send({ type: 'matchReady' });
      await client.waitFor((m) => m.type === 'matchGo');
      await client.waitUntil(() => client.snapshots.length >= 3);
      expect(client.snapshots[0]!.spawns.length).toBeLessThan(300);
      const before = client.snapshots.length;
      client.send({ type: 'cheat', xp: 6000, gold: 10000 });
      client.send({ type: 'endMatch' });
      await client.waitUntil(() => client.snapshots.length >= before + 4);
      expect(client.json.some((m) => m.type === 'matchEnd')).toBe(false);
      const snapshot = Reflect.get(client, 'snap') as SnapshotData;
      expect(snapshot.player.level).toBe(1);
      expect(snapshot.player.gold).toBeLessThan(1000);
      expect(client.lastRoom()?.phase).toBe('playing');
    } finally {
      await client.close();
      await server.close();
    }
  });
});
