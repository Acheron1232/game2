// Flow fields for army movement: one shared field per target, on a 1-unit grid (2 x 2 walk cells),
// built with Dijkstra (8 directions, no corner cutting). Units sample the field where they stand
// instead of running one A* each. Written by Codex for Phase 8 (task: tools/codex-tasks/flow-field.md).

import type { NavGrid } from './nav-grid';

const FLOW_CELL = 1;
const DIAGONAL_COST = Math.SQRT2;
const DIR_X = [1, -1, 0, 0, 1, 1, -1, -1];
const DIR_Y = [0, 0, 1, -1, 1, -1, 1, -1];
const DIR_COST = [1, 1, 1, 1, DIAGONAL_COST, DIAGONAL_COST, DIAGONAL_COST, DIAGONAL_COST];

let openCells = new Uint8Array(0);
let heapCells = new Int32Array(0);
let heapPositions = new Int32Array(0);

export interface FlowField {
  /** 1-unit cells */
  readonly cols: number;
  readonly rows: number;
  readonly cell: number;
  readonly targetX: number;
  readonly targetY: number;
  /** cost to reach the target per coarse cell (Infinity = can not reach) */
  readonly dist: Float32Array;
  /** walk-grid version this field was built for */
  readonly version: number;
}

function ensureBuffers(size: number): void {
  if (openCells.length === size) return;
  openCells = new Uint8Array(size);
  heapCells = new Int32Array(size);
  heapPositions = new Int32Array(size);
}

function nearestOpenCell(cols: number, rows: number, tx: number, ty: number): number {
  let best = -1;
  let bestDistance = Infinity;
  for (let r = 0; r < rows; r++) {
    const dy = r + 0.5 - ty;
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (!openCells[i]) continue;
      const dx = c + 0.5 - tx;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        best = i;
        bestDistance = distance;
      }
    }
  }
  return best;
}

/** Builds a shared field toward a target point. */
export function buildFlowField(nav: NavGrid, tx: number, ty: number, version = 0): FlowField {
  const cols = Math.floor(nav.cols / 2);
  const rows = Math.floor(nav.rows / 2);
  const size = cols * rows;
  const dist = new Float32Array(size);
  dist.fill(Infinity);
  ensureBuffers(size);
  heapPositions.fill(-1);

  const walkCols = nav.cols;
  const walk = nav.walk;
  for (let r = 0; r < rows; r++) {
    const wr = r * 2;
    for (let c = 0; c < cols; c++) {
      const wc = c * 2;
      const top = wr * walkCols + wc;
      const bottom = top + walkCols;
      openCells[r * cols + c] = (walk[top] ?? 0) + (walk[top + 1] ?? 0) + (walk[bottom] ?? 0) + (walk[bottom + 1] ?? 0) >= 3 ? 1 : 0;
    }
  }

  const targetC = Math.floor(tx / FLOW_CELL);
  const targetR = Math.floor(ty / FLOW_CELL);
  const targetAt = targetC >= 0 && targetR >= 0 && targetC < cols && targetR < rows ? targetR * cols + targetC : -1;
  const target = targetAt >= 0 && openCells[targetAt] ? targetAt : nearestOpenCell(cols, rows, tx, ty);
  if (target < 0) return { cols, rows, cell: FLOW_CELL, targetX: tx, targetY: ty, dist, version };

  let heapSize = 1;
  heapCells[0] = target;
  heapPositions[target] = 0;
  dist[target] = 0;

  const swap = (a: number, b: number): void => {
    const cell = heapCells[a]!;
    heapCells[a] = heapCells[b]!;
    heapCells[b] = cell;
    heapPositions[heapCells[a]!] = a;
    heapPositions[heapCells[b]!] = b;
  };
  const moveUp = (position: number): void => {
    let at = position;
    while (at > 0) {
      const parent = (at - 1) >> 1;
      if (dist[heapCells[parent]!]! <= dist[heapCells[at]!]!) break;
      swap(parent, at);
      at = parent;
    }
  };
  const pushOrLower = (cell: number): void => {
    const position = heapPositions[cell]!;
    if (position >= 0) {
      moveUp(position);
      return;
    }
    heapCells[heapSize] = cell;
    heapPositions[cell] = heapSize;
    moveUp(heapSize++);
  };
  const pop = (): number => {
    const result = heapCells[0]!;
    heapPositions[result] = -2;
    heapSize--;
    if (heapSize === 0) return result;
    const tail = heapCells[heapSize]!;
    heapCells[0] = tail;
    heapPositions[tail] = 0;
    let at = 0;
    for (;;) {
      const left = at * 2 + 1;
      if (left >= heapSize) break;
      const right = left + 1;
      const child = right < heapSize && dist[heapCells[right]!]! < dist[heapCells[left]!]! ? right : left;
      if (dist[heapCells[at]!]! <= dist[heapCells[child]!]!) break;
      swap(at, child);
      at = child;
    }
    return result;
  };

  while (heapSize > 0) {
    const current = pop();
    const c = current % cols;
    const r = (current - c) / cols;
    const baseDistance = dist[current]!;
    for (let d = 0; d < 8; d++) {
      const dc = DIR_X[d]!;
      const dr = DIR_Y[d]!;
      const nc = c + dc;
      const nr = r + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const next = nr * cols + nc;
      if (!openCells[next] || heapPositions[next] === -2) continue;
      if (dc !== 0 && dr !== 0 && (!openCells[r * cols + nc] || !openCells[nr * cols + c])) continue;
      const nextDistance = baseDistance + DIR_COST[d]!;
      if (nextDistance >= dist[next]!) continue;
      dist[next] = nextDistance;
      pushOrLower(next);
    }
  }

  return { cols, rows, cell: FLOW_CELL, targetX: tx, targetY: ty, dist, version };
}

/** Writes a unit direction toward the next field cell. */
export function flowDirection(f: FlowField, x: number, y: number, out: { x: number; y: number }): boolean {
  const c = Math.floor(x / f.cell);
  const r = Math.floor(y / f.cell);
  if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return false;
  const current = r * f.cols + c;
  const currentDistance = f.dist[current]!;
  if (currentDistance === 0) return false;

  let best = -1;
  let bestDistance = Infinity;
  let bestPositionDistance = Infinity;
  for (let d = 0; d < 8; d++) {
    const dc = DIR_X[d]!;
    const dr = DIR_Y[d]!;
    const nc = c + dc;
    const nr = r + dr;
    if (nc < 0 || nr < 0 || nc >= f.cols || nr >= f.rows) continue;
    const next = nr * f.cols + nc;
    const nextDistance = f.dist[next]!;
    if (!Number.isFinite(nextDistance)) continue;
    if (dc !== 0 && dr !== 0 && (!Number.isFinite(f.dist[r * f.cols + nc]!) || !Number.isFinite(f.dist[nr * f.cols + c]!))) continue;

    if (Number.isFinite(currentDistance)) {
      if (nextDistance >= bestDistance) continue;
    } else {
      const dx = (nc + 0.5) * f.cell - x;
      const dy = (nr + 0.5) * f.cell - y;
      const positionDistance = dx * dx + dy * dy;
      if (positionDistance > bestPositionDistance || (positionDistance === bestPositionDistance && nextDistance >= bestDistance)) continue;
      bestPositionDistance = positionDistance;
    }
    best = next;
    bestDistance = nextDistance;
  }
  if (best < 0 || (Number.isFinite(currentDistance) && bestDistance >= currentDistance)) return false;

  const bestC = best % f.cols;
  const bestR = (best - bestC) / f.cols;
  const dx = (bestC + 0.5) * f.cell - x;
  const dy = (bestR + 0.5) * f.cell - y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return false;
  out.x = dx / length;
  out.y = dy / length;
  return true;
}

/** Gives the field cost left from a point, in game units. */
export function flowDistance(f: FlowField, x: number, y: number): number {
  const c = Math.floor(x / f.cell);
  const r = Math.floor(y / f.cell);
  if (c < 0 || r < 0 || c >= f.cols || r >= f.rows) return Infinity;
  return f.dist[r * f.cols + c] ?? Infinity;
}

export class FlowFieldCache {
  version = 0;
  private readonly fields = new Map<number, FlowField>();
  private readonly maxFields: number;

  constructor(
    private readonly nav: NavGrid,
    maxFields = 8,
  ) {
    this.maxFields = Math.max(1, Math.floor(maxFields));
  }

  /** The cached field for this target cell when it is still valid, else null (builds nothing). */
  peek(tx: number, ty: number): FlowField | null {
    const key = Math.floor(ty / FLOW_CELL) * Math.floor(this.nav.cols / 2) + Math.floor(tx / FLOW_CELL);
    const found = this.fields.get(key);
    return found?.version === this.version ? found : null;
  }

  get(tx: number, ty: number): FlowField {
    const c = Math.floor(tx / FLOW_CELL);
    const r = Math.floor(ty / FLOW_CELL);
    const key = r * Math.floor(this.nav.cols / 2) + c;
    const found = this.fields.get(key);
    if (found?.version === this.version) {
      this.fields.delete(key);
      this.fields.set(key, found);
      return found;
    }

    const field = buildFlowField(this.nav, tx, ty, this.version);
    this.fields.delete(key);
    this.fields.set(key, field);
    if (this.fields.size > this.maxFields) this.fields.delete(this.fields.keys().next().value!);
    return field;
  }

  clear(): void {
    this.fields.clear();
  }
}
