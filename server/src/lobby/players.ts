// Players connected to this server. Rooms and slots come in Phase 6.

import { randomUUID } from 'node:crypto';

export interface Player {
  id: string;
  name: string;
  joinedAt: number;
}

export class PlayerRegistry {
  private readonly players = new Map<string, Player>();

  get count(): number {
    return this.players.size;
  }

  add(name: string): Player {
    const player = { id: randomUUID(), name, joinedAt: Date.now() };
    this.players.set(player.id, player);
    return player;
  }

  remove(id: string): void {
    this.players.delete(id);
  }
}
