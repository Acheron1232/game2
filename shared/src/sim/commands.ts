// Player commands and how they change a unit. The server runs them for real; the client runs
// the same code for its own hero right away (prediction), so both get the same path.

import { findPath, type NavGrid } from '../nav/nav-grid';
import type { Mover } from './movement';

export const CommandType = {
  Move: 1,
  Stop: 2,
} as const;
export type CommandType = (typeof CommandType)[keyof typeof CommandType];

export type GameCommand = { type: typeof CommandType.Move; x: number; y: number; queue: boolean } | { type: typeof CommandType.Stop };

/** Plans a path to (x, y). With `queue` the new path starts where the current one ends. */
export function applyMove(m: Mover, nav: NavGrid, x: number, y: number, queue: boolean): boolean {
  const last = m.path[m.path.length - 1];
  const [sx, sy] = queue && last ? last : [m.x, m.y];
  const path = findPath(nav, sx, sy, x, y);
  if (queue) m.path.push(...path);
  else m.path = path;
  return path.length > 0;
}

export function applyStop(m: Mover): void {
  m.path = [];
}

export function applyCommand(m: Mover, nav: NavGrid, cmd: GameCommand): void {
  if (cmd.type === CommandType.Move) applyMove(m, nav, cmd.x, cmd.y, cmd.queue);
  else applyStop(m);
}
