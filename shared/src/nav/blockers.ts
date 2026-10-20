// Changes to the walk grid during a match: building footprints come and go, chopped trees open
// forest cells. The server and every client apply the same changes in the same way, so the
// client's own-hero prediction keeps finding the same paths as the server.

import { labelRegions, type NavGrid } from './nav-grid';

/** In cells. */
const EDGE_SLACK = 0.02;

export class NavBlockers {
  /** walk grid without any building (forest still closed) */
  private readonly base: Uint8Array;
  /** how many building footprints cover each cell */
  private readonly cover: Uint8Array;
  /** bumped on every change (cached paths use it) */
  version = 0;
  /**
   * bumped only when cells close (a building is placed). Flow fields only need a rebuild then:
   * cells that open (a chopped tree, a fallen building) never trap a unit on an old field.
   */
  closeVersion = 0;
  private dirty = false;

  constructor(private readonly nav: NavGrid) {
    this.base = nav.walk.slice();
    this.cover = new Uint8Array(nav.walk.length);
  }

  /**
   * Cells a center-based rectangle covers. Edges within EDGE_SLACK of a cell line snap to it:
   * clients get the position quantized (about 0.002 units off) and must close the same cells.
   */
  private forRect(x: number, y: number, w: number, h: number, fn: (i: number) => void): void {
    const g = this.nav;
    const c0 = Math.max(0, Math.floor((x - w / 2) / g.cellSize + EDGE_SLACK));
    const c1 = Math.min(g.cols - 1, Math.ceil((x + w / 2) / g.cellSize - EDGE_SLACK) - 1);
    const r0 = Math.max(0, Math.floor((y - h / 2) / g.cellSize + EDGE_SLACK));
    const r1 = Math.min(g.rows - 1, Math.ceil((y + h / 2) / g.cellSize - EDGE_SLACK) - 1);
    for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) fn(r * g.cols + c);
  }

  /** A building is placed: its footprint closes. */
  addRect(x: number, y: number, w: number, h: number): void {
    this.forRect(x, y, w, h, (i) => {
      this.cover[i]!++;
      this.nav.walk[i] = 0;
    });
    this.closeVersion++;
    this.changed();
  }

  /** A building is gone: its cells open again unless something else still covers them. */
  removeRect(x: number, y: number, w: number, h: number): void {
    this.forRect(x, y, w, h, (i) => {
      if (this.cover[i]! > 0) this.cover[i]!--;
      if (this.cover[i] === 0) this.nav.walk[i] = this.base[i]!;
    });
    this.changed();
  }

  /** Is any cell of this rectangle covered or closed? */
  rectFree(x: number, y: number, w: number, h: number): boolean {
    let free = true;
    this.forRect(x, y, w, h, (i) => {
      if (!this.nav.walk[i]) free = false;
    });
    return free;
  }

  /** Chopped tree: its forest cells become open ground for good. */
  openCells(cells: readonly number[]): void {
    if (!cells.length) return;
    for (const i of cells) {
      this.base[i] = 1;
      if (this.cover[i] === 0) this.nav.walk[i] = 1;
    }
    this.changed();
  }

  private changed(): void {
    this.version++;
    this.dirty = true;
  }

  /** Rebuilds the area ids when something changed. Cheap to call every tick. */
  refresh(): boolean {
    if (!this.dirty) return false;
    this.dirty = false;
    labelRegions(this.nav);
    return true;
  }
}
