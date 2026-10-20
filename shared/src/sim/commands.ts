// Player commands and how they change a unit. The server runs them for real; the client runs
// the movement ones (Move, Stop) for its own hero right away (prediction), so both get the
// same path. Attack orders are not predicted: the client shows the server's hero for those.

import { findPath, type NavGrid } from '../nav/nav-grid';
import type { Mover } from './movement';
import { dqPos, qPos } from '../map/coordinates';

export const CommandType = {
  Move: 1,
  Stop: 2,
  Attack: 3,
  AttackMove: 4,
  Hold: 5,
  /** use ability in slot 0..3 (Q W E R) */
  Cast: 6,
  /** spend a skill point on slot 0..3 */
  Learn: 7,
  /** use the item in inventory slot 0..5 (keys 1-6), same target kinds as Cast */
  UseItem: 8,
  /** buy an item from a shop in range */
  BuyItem: 9,
  /** sell the item in an inventory slot to a shop in range */
  SellItem: 10,
  /** walk to a point and put the item there */
  DropItem: 11,
  /** walk to an item on the ground and take it */
  PickUp: 12,
  /** walk to an allied hero and give it the item */
  GiveItem: 13,
  /** move an item to another inventory slot (swap) */
  SwapItems: 14,
  /** buy a Town Hall upgrade (index in upgrades.json) for the hero's faction, at its own Town Hall */
  BuyUpgrade: 15,
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

export type GameCommand =
  | { type: typeof CommandType.Move; x: number; y: number; queue: boolean }
  | { type: typeof CommandType.Stop }
  | { type: typeof CommandType.Attack; target: number }
  | { type: typeof CommandType.AttackMove; x: number; y: number }
  | { type: typeof CommandType.Hold }
  /** target: 0 = none, 1 = unit (id), 2 = point (x, y) */
  | { type: typeof CommandType.Cast; slot: number; target: 0 | 1 | 2; id: number; x: number; y: number }
  | { type: typeof CommandType.Learn; slot: number }
  | { type: typeof CommandType.UseItem; slot: number; target: 0 | 1 | 2; id: number; x: number; y: number }
  /** item: index in items.json */
  | { type: typeof CommandType.BuyItem; item: number }
  | { type: typeof CommandType.SellItem; slot: number }
  | { type: typeof CommandType.DropItem; slot: number; x: number; y: number }
  /** id: ground item id */
  | { type: typeof CommandType.PickUp; id: number }
  /** target: entity id of the allied hero */
  | { type: typeof CommandType.GiveItem; slot: number; target: number }
  | { type: typeof CommandType.SwapItems; from: number; to: number }
  | { type: typeof CommandType.BuyUpgrade; upgrade: number };

/** Commands the client can predict for its own hero. */
export function isPredicted(cmd: GameCommand): boolean {
  return cmd.type === CommandType.Move || cmd.type === CommandType.Stop;
}

/** Flyers stay this far inside the map edge (the mountain wall). */
export const FLY_MARGIN = 9;

/**
 * Plans a path to (x, y). With `queue` the new path starts where the current one ends.
 * Flyers go straight (they ignore the walk grid), but stay inside the map.
 */
export function applyMove(m: Mover, nav: NavGrid, x: number, y: number, queue: boolean, flying = false): boolean {
  const last = m.path[m.path.length - 1];
  const [sx, sy] = queue && last ? last : [m.x, m.y];
  let path: [number, number][];
  if (flying) {
    const size = nav.cols * nav.cellSize;
    const cx = Math.max(FLY_MARGIN, Math.min(size - FLY_MARGIN, x)),
      cy = Math.max(FLY_MARGIN, Math.min(size - FLY_MARGIN, y));
    path = Math.hypot(cx - sx, cy - sy) > 1e-3 ? [[cx, cy]] : [];
  } else {
    // A spawn on a cell edge can round into its neighbor in a snapshot. Plan from the
    // same wire position on both sides, so A* and string pulling choose the same route.
    path = findPath(nav, dqPos(qPos(sx)), dqPos(qPos(sy)), x, y);
  }
  if (queue) m.path.push(...path);
  else m.path = path;
  return path.length > 0;
}

export function applyStop(m: Mover): void {
  m.path = [];
}

/** The movement part of a command (Move and Stop). Other commands do not move by themselves. */
export function applyCommand(m: Mover, nav: NavGrid, cmd: GameCommand, flying = false): void {
  if (cmd.type === CommandType.Move) applyMove(m, nav, cmd.x, cmd.y, cmd.queue, flying);
  else if (cmd.type === CommandType.Stop || cmd.type === CommandType.Hold) applyStop(m);
}
