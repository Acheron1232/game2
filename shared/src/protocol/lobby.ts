import type { MatchSummary, PlayerSummary } from '../sim/summary';
// Lobby messages: JSON text frames. Rare and small, so JSON is fine and easy to debug.

import { z } from 'zod';

export const SLOT_COUNT = 4;
export const SLOT_KINDS = ['open', 'human', 'bot', 'closed'] as const;
export type SlotKind = (typeof SLOT_KINDS)[number];
export const AI_LEVELS = ['easy', 'normal', 'hard'] as const;
export type AiLevel = (typeof AI_LEVELS)[number];
export const RANDOM_HERO = 'random';

export interface SlotState {
  index: number;
  kind: SlotKind;
  /** player id for humans */
  playerId: string | null;
  name: string;
  /** 1..4 */
  team: number;
  /** 0..3, index into the team colors */
  color: number;
  /** hero id or "random" */
  hero: string;
  ai: AiLevel;
  ready: boolean;
  /** 0..100 */
  load: number;
  online: boolean;
  /** in a match: the player is away for long and a bot plays the hero until they come back */
  away?: boolean;
}

export type RoomPhase = 'lobby' | 'playing';

export interface RoomState {
  code: string;
  hostId: string;
  phase: RoomPhase;
  slots: SlotState[];
}

/** One line in the game list of the main menu. */
export interface RoomSummary {
  code: string;
  /** host's name */
  host: string;
  phase: RoomPhase;
  humans: number;
  bots: number;
  /** slots a new player can take */
  open: number;
}

/** What every client gets when a match starts (and again when it rejoins). */
export interface MatchStartInfo {
  matchId: string;
  yourSlot: number;
  slots: { index: number; kind: SlotKind; name: string; team: number; color: number; hero: string; start: number }[];
  rejoin: boolean;
  /** watch mode (dev): every slot is a bot, the players only watch; the game runs this many times faster */
  watch?: number;
}

export interface MatchStats {
  ticks: number;
  tickMsAvg: number;
  tickMsMax: number;
  entities: number;
  /** bytes sent per slot per second (last second) */
  bytesPerSec: number[];
  /** scoreboard rows (factions and heroes), once per second */
  scores?: PlayerSummary[];
}

// ---------- client -> server ----------

const name = z
  .string()
  .max(64)
  .transform((s) => s.trim().slice(0, 24) || 'Player');
const slotIndex = z
  .number()
  .int()
  .min(0)
  .max(SLOT_COUNT - 1);

export const clientLobbyMessageSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('hello'),
    protocol: z.number(),
    name,
    /** this tab's own session: taken back even if the server thinks it is still online */
    session: z.string().max(64).optional(),
    /** older sessions of this browser: only taken when that player is offline */
    sessions: z.array(z.string().max(64)).max(8).optional(),
  }),
  z.object({ type: z.literal('setName'), name }),
  z.object({ type: z.literal('createRoom') }),
  z.object({ type: z.literal('listRooms') }),
  z.object({ type: z.literal('joinRoom'), code: z.string().max(8) }),
  z.object({ type: z.literal('leaveRoom') }),
  z.object({ type: z.literal('setSlotKind'), slot: slotIndex, kind: z.enum(['open', 'bot', 'closed']) }),
  z.object({ type: z.literal('kick'), slot: slotIndex }),
  z.object({
    type: z.literal('updateSlot'),
    slot: slotIndex,
    team: z.number().int().min(1).max(4).optional(),
    color: z.number().int().min(0).max(3).optional(),
    hero: z.string().max(32).optional(),
    ai: z.enum(AI_LEVELS).optional(),
  }),
  z.object({ type: z.literal('ready'), ready: z.boolean() }),
  z.object({ type: z.literal('load'), pct: z.number().min(0).max(100) }),
  z.object({ type: z.literal('chat'), text: z.string().max(400) }),
  z.object({
    type: z.literal('start'),
    /** load test only, the server ignores it unless it allows test options */
    test: z.object({ units: z.number().int().min(0).max(1000), area: z.enum(['bases', 'center']) }).optional(),
    /** dev servers only: bots play every slot, the players watch at this game speed (1-10) */
    watch: z.object({ speed: z.number().int().min(1).max(10) }).optional(),
  }),
  z.object({ type: z.literal('matchReady') }),
  /** dev servers only: give the own hero XP, gold or an item (for testing) */
  z.object({
    type: z.literal('cheat'),
    xp: z.number().min(0).max(100000).optional(),
    gold: z.number().min(0).max(100000).optional(),
    item: z.string().max(32).optional(),
    /** put the hero here (game units) */
    pos: z.tuple([z.number().min(0).max(512), z.number().min(0).max(512)]).optional(),
  }),
  z.object({ type: z.literal('endMatch') }),
]);

export type ClientLobbyMessage = z.infer<typeof clientLobbyMessageSchema>;

export function parseClientLobbyMessage(text: string): ClientLobbyMessage | null {
  try {
    const result = clientLobbyMessageSchema.safeParse(JSON.parse(text));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

// ---------- server -> client ----------

export type ErrorCode =
  'bad_protocol' | 'bad_message' | 'no_room' | 'room_full' | 'not_host' | 'not_allowed' | 'color_taken' | 'not_ready' | 'in_match';

export type ServerLobbyMessage =
  | { type: 'welcome'; playerId: string; session: string; serverVersion: string; name: string; inRoom?: boolean }
  | { type: 'error'; code: ErrorCode; text: string }
  | { type: 'room'; room: RoomState }
  | { type: 'roomLeft'; reason: 'left' | 'kicked' | 'closed' }
  | { type: 'roomList'; rooms: RoomSummary[] }
  | { type: 'chat'; from: string; text: string; system?: boolean }
  | { type: 'matchStart'; match: MatchStartInfo }
  | { type: 'matchGo'; tick: number }
  /** winnerTeam: 0 when the host ended the match; summary: the end screen (a won match only) */
  | { type: 'matchEnd'; winnerTeam: number; summary?: MatchSummary }
  | { type: 'stats'; stats: MatchStats }
  /** the Tab scoreboard, once per second while a match runs */
  | { type: 'scores'; scores: PlayerSummary[] };
