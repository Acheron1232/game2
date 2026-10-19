import type { AddressInfo } from 'node:net';
import { BinaryWriter, MsgId, PROTOCOL_VERSION, readBinaryMessage, writePing } from '@game/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { createGameServer, type GameServer } from '../src/server';
import { CloseCode } from '../src/net/connection';

let server: GameServer;
let base: string;

beforeAll(async () => {
  server = createGameServer();
  await new Promise<void>((resolve) => server.http.listen(0, '127.0.0.1', resolve));
  base = `127.0.0.1:${(server.http.address() as AddressInfo).port}`;
});

afterAll(() => server.close());

function connect(): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://${base}/ws`);
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

function nextMessage(ws: WebSocket): Promise<{ data: Buffer; isBinary: boolean }> {
  return new Promise((resolve) => ws.once('message', (data, isBinary) => resolve({ data: data as Buffer, isBinary })));
}

describe('server', () => {
  it('answers the health check', async () => {
    const res = await fetch(`http://${base}/health`);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  it('says welcome to hello and answers ping with pong', async () => {
    const ws = await connect();
    ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION, name: 'Tester' }));
    const welcome = JSON.parse((await nextMessage(ws)).data.toString());
    expect(welcome).toMatchObject({ type: 'welcome' });
    expect(server.players.count).toBe(1);

    ws.send(writePing(new BinaryWriter(), { clientTime: 42 }));
    const reply = await nextMessage(ws);
    expect(reply.isBinary).toBe(true);
    const pong = readBinaryMessage(reply.data);
    expect(pong.id).toBe(MsgId.Pong);
    expect(pong).toMatchObject({ clientTime: 42 });
    ws.close();
  });

  it('closes a client with an old protocol version', async () => {
    const ws = await connect();
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(JSON.stringify({ type: 'hello', protocol: PROTOCOL_VERSION + 99, name: 'Old' }));
    expect(JSON.parse((await nextMessage(ws)).data.toString())).toMatchObject({ type: 'error', code: 'bad_protocol' });
    expect(await closed).toBe(CloseCode.BadProtocol);
  });

  it('refuses game messages before hello', async () => {
    const ws = await connect();
    const closed = new Promise<number>((resolve) => ws.once('close', (code) => resolve(code)));
    ws.send(writePing(new BinaryWriter(), { clientTime: 1 }));
    expect(await closed).toBe(CloseCode.BadMessage);
  });
});
