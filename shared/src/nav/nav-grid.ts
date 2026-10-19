// Walk grid for ground units and A* paths. Same code on the server (Phase 6) and the client
// (own hero prediction), so both find the same path.

import { TerrainFlag, type TerrainGrid } from '../map/terrain';

export interface NavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** 1 = can walk, 0 = blocked */
  walk: Uint8Array;
}

/** Ground walk grid from the terrain: forest (trees), water, cliffs and the map border block. */
export function buildNavGrid(t: TerrainGrid): NavGrid {
  const walk = new Uint8Array(t.cols * t.rows);
  const blocked = TerrainFlag.Forest | TerrainFlag.Water | TerrainFlag.Cliff | TerrainFlag.Border;
  for (let i = 0; i < walk.length; i++) {
    const f = t.flags[i] ?? 0;
    walk[i] = f & TerrainFlag.Passable && !(f & blocked) ? 1 : 0;
  }
  return { cols: t.cols, rows: t.rows, cellSize: t.cellSize, walk };
}

/** Marks a rectangle (game units) as blocked, for buildings and other static objects. */
export function blockRect(g: NavGrid, x: number, y: number, w: number, h: number): void {
  const c0 = Math.max(0, Math.floor((x - w / 2) / g.cellSize));
  const c1 = Math.min(g.cols - 1, Math.floor((x + w / 2) / g.cellSize));
  const r0 = Math.max(0, Math.floor((y - h / 2) / g.cellSize));
  const r1 = Math.min(g.rows - 1, Math.floor((y + h / 2) / g.cellSize));
  for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) g.walk[r * g.cols + c] = 0;
}

export function isWalkable(g: NavGrid, x: number, y: number): boolean {
  const c = Math.floor(x / g.cellSize);
  const r = Math.floor(y / g.cellSize);
  return c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.walk[r * g.cols + c] === 1;
}

/** Nearest walkable cell center to (x, y), searching outward in rings. */
export function nearestWalkable(g: NavGrid, x: number, y: number, maxRadius = 40): [number, number] | null {
  const c0 = Math.floor(x / g.cellSize);
  const r0 = Math.floor(y / g.cellSize);
  for (let rad = 0; rad <= maxRadius; rad++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dr = -rad; dr <= rad; dr++) {
      for (let dc = -rad; dc <= rad; dc++) {
        if (Math.max(Math.abs(dr), Math.abs(dc)) !== rad) continue;
        const c = c0 + dc,
          r = r0 + dr;
        if (c < 0 || r < 0 || c >= g.cols || r >= g.rows || !g.walk[r * g.cols + c]) continue;
        const d = dr * dr + dc * dc;
        if (d < bestD) {
          bestD = d;
          best = [(c + 0.5) * g.cellSize, (r + 0.5) * g.cellSize];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

/** Visits every crossed cell, including both neighbors at diagonal corners. */
export function lineWalkable(g: NavGrid, ax: number, ay: number, bx: number, by: number): boolean {
  if (!isWalkable(g, ax, ay) || !isWalkable(g, bx, by)) return false;
  let c = Math.floor(ax / g.cellSize),
    r = Math.floor(ay / g.cellSize);
  const ec = Math.floor(bx / g.cellSize),
    er = Math.floor(by / g.cellSize);
  const dx = bx - ax,
    dy = by - ay;
  const sx = Math.sign(dx),
    sy = Math.sign(dy);
  const stepX = dx === 0 ? Infinity : g.cellSize / Math.abs(dx);
  const stepY = dy === 0 ? Infinity : g.cellSize / Math.abs(dy);
  let nextX = dx === 0 ? Infinity : ((sx > 0 ? c + 1 : c) * g.cellSize - ax) / dx;
  let nextY = dy === 0 ? Infinity : ((sy > 0 ? r + 1 : r) * g.cellSize - ay) / dy;
  const open = (x: number, y: number) => x >= 0 && y >= 0 && x < g.cols && y < g.rows && g.walk[y * g.cols + x] === 1;
  while (c !== ec || r !== er) {
    if (Math.abs(nextX - nextY) < 1e-10) {
      if (!open(c + sx, r) || !open(c, r + sy)) return false;
      c += sx;
      r += sy;
      nextX += stepX;
      nextY += stepY;
    } else if (nextX < nextY) {
      c += sx;
      nextX += stepX;
    } else {
      r += sy;
      nextY += stepY;
    }
    if (!open(c, r)) return false;
  }
  return true;
}

// Reused between calls so a path search does not allocate big arrays.
let gScore = new Float32Array(0);
let came = new Int32Array(0);
let closed = new Uint8Array(0);
let heap = new Int32Array(0);
let heapF = new Float32Array(0);

/**
 * A* on the grid with 8 directions (no corner cutting), then string pulling so the path is a
 * few straight lines. Returns points in game units, from start (excluded) to goal.
 * The goal moves to the nearest walkable cell if it is blocked. Empty array = no path.
 */
export function findPath(g: NavGrid, sx: number, sy: number, gx: number, gy: number, maxNodes = 60000): [number, number][] {
  const n = g.cols * g.rows;
  if (gScore.length !== n) {
    gScore = new Float32Array(n);
    came = new Int32Array(n);
    closed = new Uint8Array(n);
    heap = new Int32Array(n);
    heapF = new Float32Array(n);
  }
  const goal = isWalkable(g, gx, gy) ? [gx, gy] : nearestWalkable(g, gx, gy);
  const start = isWalkable(g, sx, sy) ? [sx, sy] : nearestWalkable(g, sx, sy, 6);
  if (!goal || !start) return [];
  const [ex, ey] = goal as [number, number];
  if (lineWalkable(g, sx, sy, ex, ey)) return [[ex, ey]];

  const cs = g.cellSize;
  const sIdx = Math.floor(start[1]! / cs) * g.cols + Math.floor(start[0]! / cs);
  const eIdx = Math.floor(ey / cs) * g.cols + Math.floor(ex / cs);
  gScore.fill(Infinity);
  closed.fill(0);
  let size = 0;
  const ec = eIdx % g.cols,
    er = Math.floor(eIdx / g.cols);
  const h = (i: number) => {
    const dc = Math.abs((i % g.cols) - ec),
      dr = Math.abs(Math.floor(i / g.cols) - er);
    return Math.max(dc, dr) + 0.4142 * Math.min(dc, dr);
  };
  const push = (i: number, f: number) => {
    let k = size++;
    heap[k] = i;
    heapF[k] = f;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= heapF[k]!) break;
      [heap[p], heap[k]] = [heap[k]!, heap[p]!];
      [heapF[p], heapF[k]] = [heapF[k]!, heapF[p]!];
      k = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    size--;
    heap[0] = heap[size]!;
    heapF[0] = heapF[size]!;
    let k = 0;
    while (true) {
      const l = 2 * k + 1,
        r = l + 1;
      let m = k;
      if (l < size && heapF[l]! < heapF[m]!) m = l;
      if (r < size && heapF[r]! < heapF[m]!) m = r;
      if (m === k) break;
      [heap[m], heap[k]] = [heap[k]!, heap[m]!];
      [heapF[m], heapF[k]] = [heapF[k]!, heapF[m]!];
      k = m;
    }
    return top;
  };
  gScore[sIdx] = 0;
  came[sIdx] = -1;
  push(sIdx, h(sIdx));
  let visited = 0;
  let found = false;
  const DIRS = [
    [1, 0, 1],
    [-1, 0, 1],
    [0, 1, 1],
    [0, -1, 1],
    [1, 1, 1.4142],
    [1, -1, 1.4142],
    [-1, 1, 1.4142],
    [-1, -1, 1.4142],
  ] as const;
  while (size > 0 && visited < maxNodes) {
    const cur = pop();
    if (closed[cur]) continue;
    closed[cur] = 1;
    visited++;
    if (cur === eIdx) {
      found = true;
      break;
    }
    const cc = cur % g.cols,
      cr = Math.floor(cur / g.cols);
    for (const [dc, dr, cost] of DIRS) {
      const nc = cc + dc,
        nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
      const ni = nr * g.cols + nc;
      if (!g.walk[ni] || closed[ni]) continue;
      // No cutting corners past blocked cells
      if (dc !== 0 && dr !== 0 && (!g.walk[cr * g.cols + nc] || !g.walk[nr * g.cols + cc])) continue;
      const ng = gScore[cur]! + cost;
      if (ng < gScore[ni]!) {
        gScore[ni] = ng;
        came[ni] = cur;
        push(ni, ng + h(ni));
      }
    }
  }
  if (!found) return [];
  const cells: [number, number][] = [];
  for (let i = eIdx; i !== -1 && i !== sIdx; i = came[i]!) cells.push([((i % g.cols) + 0.5) * cs, (Math.floor(i / g.cols) + 0.5) * cs]);
  cells.reverse();
  cells[cells.length - 1] = [ex, ey];
  // String pulling: keep only the corners we can not see past.
  const out: [number, number][] = [];
  let ax = sx,
    ay = sy;
  let i = 0;
  while (i < cells.length) {
    let j = cells.length - 1;
    while (j > i && !lineWalkable(g, ax, ay, cells[j]![0], cells[j]![1])) j--;
    out.push(cells[j]!);
    [ax, ay] = cells[j]!;
    i = j + 1;
  }
  return out;
}
