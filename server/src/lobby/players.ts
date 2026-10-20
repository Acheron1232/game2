// Players known to this server. A player keeps a session token, so after a dropped connection
// or a closed tab the same browser can take its place back (in its room and match).

import { randomBytes, randomUUID } from 'node:crypto';
import type { ServerLobbyMessage } from '@game/shared';
import type { Room } from './room';

/** The socket side of a player, so the lobby does not depend on `ws`. */
export interface PlayerConn {
  sendJson(msg: ServerLobbyMessage): void;
  sendBinary(data: Uint8Array): void;
  close(code: number, reason: string): void;
}

export interface Player {
  id: string;
  name: string;
  session: string;
  conn: PlayerConn | null;
  room: Room | null;
  /** last time the connection went away (ms), 0 while online */
  offlineSince: number;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PlayerRegistry {
  private readonly byId = new Map<string, Player>();
  private readonly bySession = new Map<string, Player>();

  get count(): number {
    return this.byId.size;
  }

  get online(): number {
    let n = 0;
    for (const p of this.byId.values()) if (p.conn) n++;
    return n;
  }

  create(name: string, conn: PlayerConn): Player {
    const player: Player = {
      id: randomUUID(),
      name,
      session: randomBytes(18).toString('base64url'),
      conn,
      room: null,
      offlineSince: 0,
      timer: null,
    };
    this.byId.set(player.id, player);
    this.bySession.set(player.session, player);
    return player;
  }

  /**
   * Finds the player for a returning client. `own` is this tab's session: it is taken back
   * even if the server still thinks the old socket is open (a reload). `others` are older tabs
   * of the same browser: they are only taken when that player is offline (a reopened tab).
   */
  resume(own: string | undefined, others: readonly string[]): Player | null {
    const mine = own ? this.bySession.get(own) : undefined;
    if (mine) return mine;
    for (const token of others) {
      const p = this.bySession.get(token);
      if (p && !p.conn) return p;
    }
    return null;
  }

  get(id: string): Player | undefined {
    return this.byId.get(id);
  }

  remove(p: Player): void {
    if (p.timer) clearTimeout(p.timer);
    this.byId.delete(p.id);
    this.bySession.delete(p.session);
  }

  all(): IterableIterator<Player> {
    return this.byId.values();
  }
}
