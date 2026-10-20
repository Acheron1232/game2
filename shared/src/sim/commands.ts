// Player commands and how they change a unit. The server runs them for real; the client runs
// the movement ones (Move, Stop) for its own hero right away (prediction), so both get the
// same path. Attack orders are not predicted: the client shows the server's hero for those.

import { findPath, type NavGrid } from '../nav/nav-grid';
import type { Mover } from './movement';

export const CommandType = {
  Move: 1,
  Stop: 2,
  Attack: 3,
  AttackMove: 4,
  Hold: 5,
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

export type GameCommand =
  | { type: typeof CommandType.Move; x: number; y: number; queue: boolean }
  | { type: typeof CommandType.Stop }
  | { type: typeof CommandType.Attack; target: number }
  | { type: typeof CommandType.AttackMove; x: number; y: number }
  | { type: typeof CommandType.Hold };

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
  } else path = findPath(nav, sx, sy, x, y);
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
