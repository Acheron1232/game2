// Walk grid for ground units and A* paths. Same code on the server (Phase 6) and the client
// (own hero prediction), so both find the same path.

import { TerrainFlag, type TerrainGrid } from '../map/terrain';

export interface NavGrid {
  cols: number;
  rows: number;
  cellSize: number;
  /** 1 = can walk, 0 = blocked */
  walk: Uint8Array;
  /**
   * Connected area id per cell (0 = blocked), from labelRegions(). When set, a click into an
   * area the unit can not reach goes to the nearest reachable point instead, without a long
   * search. Must be rebuilt when blocking changes (trees cut, buildings: Phase 7+).
   */
  region?: Int32Array;
}

/** Gives every connected walkable area its own id (8 directions, no corner cutting). */
export function labelRegions(g: NavGrid): void {
  const n = g.cols * g.rows;
  const region = new Int32Array(n);
  const stack = new Int32Array(n);
  let next = 0;
  for (let i = 0; i < n; i++) {
    if (!g.walk[i] || region[i]) continue;
    const id = ++next;
    let top = 0;
    stack[top++] = i;
    region[i] = id;
    while (top) {
      const cur = stack[--top]!;
      const c = cur % g.cols,
        r = (cur - c) / g.cols;
      for (let d = 0; d < 8; d++) {
        const dc = DIR_C[d]!,
          dr = DIR_R[d]!;
        const nc = c + dc,
          nr = r + dr;
        if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue;
        const ni = nr * g.cols + nc;
        if (!g.walk[ni] || region[ni]) continue;
        if (dc !== 0 && dr !== 0 && (!g.walk[r * g.cols + nc] || !g.walk[nr * g.cols + c])) continue;
        region[ni] = id;
        stack[top++] = ni;
      }
    }
  }
  g.region = region;
}

function regionAt(g: NavGrid, x: number, y: number): number {
  if (!g.region) return 0;
  return g.region[Math.floor(y / g.cellSize) * g.cols + Math.floor(x / g.cellSize)] ?? 0;
}

const DIR_C = [1, -1, 0, 0, 1, 1, -1, -1];
const DIR_R = [0, 0, 1, -1, 1, -1, 1, -1];
const DIR_COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

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

/**
 * Nearest walkable cell center to (x, y), searching outward in square rings (only the ring's
 * edge cells, so a big radius stays cheap). With `inRegion`, only cells of that connected area.
 */
export function nearestWalkable(g: NavGrid, x: number, y: number, maxRadius = 40, inRegion = 0): [number, number] | null {
  const c0 = Math.floor(x / g.cellSize);
  const r0 = Math.floor(y / g.cellSize);
  let bestC = 0,
    bestR = 0,
    bestD = Infinity;
  const test = (c: number, r: number) => {
    if (c < 0 || r < 0 || c >= g.cols || r >= g.rows) return;
    const i = r * g.cols + c;
    if (!g.walk[i] || (inRegion && g.region![i] !== inRegion)) return;
    const d = (c - c0) * (c - c0) + (r - r0) * (r - r0);
    if (d < bestD) {
      bestD = d;
      bestC = c;
      bestR = r;
    }
  };
  for (let rad = 0; rad <= maxRadius; rad++) {
    if (rad === 0) test(c0, r0);
    else {
      for (let dc = -rad; dc <= rad; dc++) {
        test(c0 + dc, r0 - rad);
        test(c0 + dc, r0 + rad);
      }
      for (let dr = -rad + 1; dr <= rad - 1; dr++) {
        test(c0 - rad, r0 + dr);
        test(c0 + rad, r0 + dr);
      }
    }
    if (bestD < Infinity) return [(bestC + 0.5) * g.cellSize, (bestR + 0.5) * g.cellSize];
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

// Reused between calls so a path search does not allocate big arrays. A cell's score is only
// valid when its stamp is the current search number, so nothing has to be cleared per search.
let gScore = new Float32Array(0);
let came = new Int32Array(0);
let seen = new Uint32Array(0);
let done = new Uint32Array(0);
let heap = new Int32Array(0);
let heapF = new Float32Array(0);
let search = 0;

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
    seen = new Uint32Array(n);
    done = new Uint32Array(n);
    heap = new Int32Array(n * 2);
    heapF = new Float32Array(n * 2);
    search = 0;
  }
  const start = isWalkable(g, sx, sy) ? [sx, sy] : nearestWalkable(g, sx, sy, 6);
  if (!start) return [];
  // Same connected area as the start, so the search below always finds a way.
  const area = regionAt(g, start[0]!, start[1]!);
  const goal = isWalkable(g, gx, gy) && (!area || regionAt(g, gx, gy) === area) ? [gx, gy] : nearestWalkable(g, gx, gy, 160, area);
  if (!goal) return [];
  const [ex, ey] = goal as [number, number];
  if (lineWalkable(g, sx, sy, ex, ey)) return [[ex, ey]];

  const id = ++search;
  const cols = g.cols,
    rows = g.rows,
    walk = g.walk;
  const cs = g.cellSize;
  const sIdx = Math.floor(start[1]! / cs) * cols + Math.floor(start[0]! / cs);
  const eIdx = Math.floor(ey / cs) * cols + Math.floor(ex / cs);
  let size = 0;
  const ec = eIdx % cols,
    er = Math.floor(eIdx / cols);
  const h = (c: number, r: number) => {
    const dc = Math.abs(c - ec),
      dr = Math.abs(r - er);
    return Math.max(dc, dr) + 0.4142 * Math.min(dc, dr);
  };
  const push = (i: number, f: number) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (heapF[p]! <= f) break;
      heap[k] = heap[p]!;
      heapF[k] = heapF[p]!;
      k = p;
    }
    heap[k] = i;
    heapF[k] = f;
  };
  const pop = () => {
    const top = heap[0]!;
    size--;
    const last = heap[size]!,
      lastF = heapF[size]!;
    let k = 0;
    for (;;) {
      const l = 2 * k + 1;
      if (l >= size) break;
      const m = l + 1 < size && heapF[l + 1]! < heapF[l]! ? l + 1 : l;
      if (heapF[m]! >= lastF) break;
      heap[k] = heap[m]!;
      heapF[k] = heapF[m]!;
      k = m;
    }
    heap[k] = last;
    heapF[k] = lastF;
    return top;
  };
  gScore[sIdx] = 0;
  seen[sIdx] = id;
  came[sIdx] = -1;
  push(sIdx, h(sIdx % cols, Math.floor(sIdx / cols)));
  let visited = 0;
  let found = false;
  while (size > 0 && visited < maxNodes && size < heap.length - 8) {
    const cur = pop();
    if (done[cur] === id) continue;
    done[cur] = id;
    visited++;
    if (cur === eIdx) {
      found = true;
      break;
    }
    const cc = cur % cols,
      cr = (cur - cc) / cols;
    const gc = gScore[cur]!;
    for (let d = 0; d < 8; d++) {
      const dc = DIR_C[d]!,
        dr = DIR_R[d]!;
      const nc = cc + dc,
        nr = cr + dr;
      if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue;
      const ni = nr * cols + nc;
      if (!walk[ni] || done[ni] === id) continue;
      // No cutting corners past blocked cells
      if (dc !== 0 && dr !== 0 && (!walk[cr * cols + nc] || !walk[nr * cols + cc])) continue;
      const ng = gc + DIR_COST[d]!;
      if (seen[ni] !== id || ng < gScore[ni]!) {
        seen[ni] = id;
        gScore[ni] = ng;
        came[ni] = cur;
        push(ni, ng + h(nc, nr));
      }
    }
  }
  if (!found) return [];
  const cells: [number, number][] = [];
  for (let i = eIdx; i !== -1 && i !== sIdx; i = came[i]!) cells.push([((i % cols) + 0.5) * cs, (Math.floor(i / cols) + 0.5) * cs]);
  cells.reverse();
  cells[cells.length - 1] = [ex, ey];
  // String pulling: from each corner, go forward along the cells while we can still walk
  // straight there. Linear in the path length (checking from the far end was quadratic).
  const out: [number, number][] = [];
  let ax = sx,
    ay = sy;
  let i = 0;
  while (i < cells.length) {
    let j = i;
    while (j + 1 < cells.length && lineWalkable(g, ax, ay, cells[j + 1]![0], cells[j + 1]![1])) j++;
    out.push(cells[j]!);
    [ax, ay] = cells[j]!;
    i = j + 1;
  }
  return out;
}
