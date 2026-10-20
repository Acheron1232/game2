// Simple team vision for Phase 6: a coarse grid per team, marked in a circle around every unit
// the team owns. No line of sight yet (trees and high ground come with the fog in Phase 9).
// The server only sends a player the enemies that stand in a visible cell.

import { hiddenFrom, revealedTo } from './buffs';
import type { SimEntity } from './match-sim';

export const VISION_CELL = 4;

export class TeamVision {
  readonly cols: number;
  private readonly grids = new Map<number, Uint8Array>();

  constructor(mapSize: number) {
    this.cols = Math.ceil(mapSize / VISION_CELL);
  }

  update(entities: readonly SimEntity[]): void {
    for (const g of this.grids.values()) g.fill(0);
    const n = this.cols;
    for (const e of entities) {
      if (!e.alive) continue;
      let g = this.grids.get(e.team);
      if (!g) this.grids.set(e.team, (g = new Uint8Array(n * n)));
      const r = e.stats.sight / VISION_CELL;
      const cx = e.mover.x / VISION_CELL,
        cy = e.mover.y / VISION_CELL;
      const r0 = Math.max(0, Math.floor(cy - r)),
        r1 = Math.min(n - 1, Math.floor(cy + r));
      for (let row = r0; row <= r1; row++) {
        const dy = row + 0.5 - cy;
        const half = Math.sqrt(Math.max(0, r * r - dy * dy));
        const c0 = Math.max(0, Math.floor(cx - half)),
          c1 = Math.min(n - 1, Math.floor(cx + half));
        g.fill(1, row * n + c0, row * n + c1 + 1);
      }
    }
  }

  /** Can this team see the entity? Own team always can. */
  sees(team: number, e: SimEntity): boolean {
    if (e.team === team) return true;
    // Mana Mark: the marking team sees the unit wherever it is.
    if (revealedTo(e.buffs, team)) return true;
    if (hiddenFrom(e, team)) return false;
    return this.seesPoint(team, e.mover.x, e.mover.y);
  }

  /** Is this point inside the team's vision (items on the ground)? */
  seesPoint(team: number, x: number, y: number): boolean {
    const g = this.grids.get(team);
    if (!g) return false;
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / VISION_CELL)));
    const r = Math.min(this.cols - 1, Math.max(0, Math.floor(y / VISION_CELL)));
    return g[r * this.cols + c] === 1;
  }
}
