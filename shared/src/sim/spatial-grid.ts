// "Who is near" for targets, aggro, XP sharing and pushing units apart. A bucket grid that is
// rebuilt every tick: linked lists in typed arrays, so nothing is allocated per tick.

export interface Positioned {
  mover: { x: number; y: number };
}

export class SpatialGrid<T extends Positioned> {
  private readonly cols: number;
  private head: Int32Array;
  private next = new Int32Array(1024);
  private items: T[] = [];

  constructor(
    size: number,
    private readonly cell = 4,
  ) {
    this.cols = Math.ceil(size / cell);
    this.head = new Int32Array(this.cols * this.cols).fill(-1);
  }

  rebuild(list: readonly T[], keep: (e: T) => boolean): void {
    this.head.fill(-1);
    if (this.next.length < list.length) this.next = new Int32Array(list.length * 2);
    this.items.length = 0;
    for (const e of list) {
      if (!keep(e)) continue;
      const i = this.items.length;
      this.items.push(e);
      const c = this.cellOf(e.mover.x, e.mover.y);
      this.next[i] = this.head[c]!;
      this.head[c] = i;
    }
  }

  /** Calls fn for every kept entity within r of (x, y). Return true from fn to stop early. */
  query(x: number, y: number, r: number, fn: (e: T, d2: number) => boolean | void): void {
    const r2 = r * r;
    const c0 = Math.max(0, Math.floor((x - r) / this.cell)),
      c1 = Math.min(this.cols - 1, Math.floor((x + r) / this.cell));
    const r0 = Math.max(0, Math.floor((y - r) / this.cell)),
      r1 = Math.min(this.cols - 1, Math.floor((y + r) / this.cell));
    for (let row = r0; row <= r1; row++) {
      for (let col = c0; col <= c1; col++) {
        for (let i = this.head[row * this.cols + col]!; i !== -1; i = this.next[i]!) {
          const e = this.items[i]!;
          const dx = e.mover.x - x,
            dy = e.mover.y - y;
          const d2 = dx * dx + dy * dy;
          if (d2 <= r2 && fn(e, d2) === true) return;
        }
      }
    }
  }

  private cellOf(x: number, y: number): number {
    const c = Math.min(this.cols - 1, Math.max(0, Math.floor(x / this.cell)));
    const r = Math.min(this.cols - 1, Math.max(0, Math.floor(y / this.cell)));
    return r * this.cols + c;
  }
}
