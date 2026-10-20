// One game room: 4 slots, a host, and later the running match.

import { RANDOM_HERO, SLOT_COUNT, type MatchStartInfo, type RoomPhase, type RoomState, type SlotState } from '@game/shared';
import type { MatchHost } from '../match/match-host';
import type { Player } from './players';

const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O, 1/I/L

export function makeRoomCode(taken: (code: string) => boolean): string {
  for (;;) {
    let code = '';
    for (let i = 0; i < 5; i++) code += CODE_LETTERS[Math.floor(Math.random() * CODE_LETTERS.length)];
    if (!taken(code)) return code;
  }
}

export function emptySlot(index: number): SlotState {
  return {
    index,
    kind: 'open',
    playerId: null,
    name: '',
    team: index + 1,
    color: index,
    hero: RANDOM_HERO,
    ai: 'normal',
    ready: false,
    load: 0,
    online: false,
  };
}

export class Room {
  phase: RoomPhase = 'lobby';
  readonly slots: SlotState[] = Array.from({ length: SLOT_COUNT }, (_, i) => emptySlot(i));
  readonly members = new Set<Player>();
  match: MatchHost | null = null;
  matchInfo: Omit<MatchStartInfo, 'yourSlot' | 'rejoin'> | null = null;
  /** players whose client has built the match scene */
  readonly matchReady = new Set<string>();
  /** the match clock runs */
  going = false;
  goTimer: ReturnType<typeof setTimeout> | null = null;
  /** after the match is won: back to the lobby when this fires */
  endTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    readonly code: string,
    public hostId: string,
  ) {}

  slotOf(p: Player): SlotState | undefined {
    return this.slots.find((s) => s.playerId === p.id);
  }

  get humans(): SlotState[] {
    return this.slots.filter((s) => s.kind === 'human');
  }

  state(): RoomState {
    return { code: this.code, hostId: this.hostId, phase: this.phase, slots: this.slots.map((s) => ({ ...s })) };
  }
}
