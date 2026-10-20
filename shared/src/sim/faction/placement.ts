// Where the faction AI puts a new building: a free spot on the 1-unit build grid inside the base
// area, with space around other buildings and never on the worker and exit corridors.
// Written by Codex for Phase 8 (task: tools/codex-tasks/placement.md).

import { TerrainFlag, type TerrainGrid } from '../../map/terrain';
import { isWalkable, type NavGrid } from '../../nav/nav-grid';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Corridor {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  width: number;
}

export interface PlacementQuery {
  footprint: [number, number];
  center: [number, number];
  radius: number;
  townHall: [number, number];
  existing: Rect[];
  corridors: Corridor[];
  spacing?: number;
  minFromTownHall?: number;
  preferToward?: [number, number];
}

const EPSILON = 1e-9;

function gridOffset(size: number): number {
  return Math.round(size) % 2 === 0 ? 0 : 0.5;
}

function onBuildGrid(value: number, size: number): boolean {
  const offset = gridOffset(size);
  return Math.abs(value - offset - Math.round(value - offset)) < EPSILON;
}

function rectDistanceSquared(x: number, y: number, w: number, h: number, other: Rect): number {
  const dx = Math.max(0, Math.abs(x - other.x) - (w + other.w) * 0.5);
  const dy = Math.max(0, Math.abs(y - other.y) - (h + other.h) * 0.5);
  return dx * dx + dy * dy;
}

function pointRectDistanceSquared(px: number, py: number, left: number, right: number, bottom: number, top: number): number {
  const dx = px < left ? left - px : px > right ? px - right : 0;
  const dy = py < bottom ? bottom - py : py > top ? py - top : 0;
  return dx * dx + dy * dy;
}

function pointSegmentDistanceSquared(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) {
    const ex = px - ax;
    const ey = py - ay;
    return ex * ex + ey * ey;
  }
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  const ex = px - (ax + t * dx);
  const ey = py - (ay + t * dy);
  return ex * ex + ey * ey;
}

function orientation(ax: number, ay: number, bx: number, by: number, cx: number, cy: number): number {
  return (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
}

function segmentsCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  if (Math.max(ax, bx) < Math.min(cx, dx) || Math.max(cx, dx) < Math.min(ax, bx)) return false;
  if (Math.max(ay, by) < Math.min(cy, dy) || Math.max(cy, dy) < Math.min(ay, by)) return false;
  const abC = orientation(ax, ay, bx, by, cx, cy);
  const abD = orientation(ax, ay, bx, by, dx, dy);
  const cdA = orientation(cx, cy, dx, dy, ax, ay);
  const cdB = orientation(cx, cy, dx, dy, bx, by);
  return abC * abD <= 0 && cdA * cdB <= 0;
}

function touchesCorridor(x: number, y: number, w: number, h: number, corridor: Corridor): boolean {
  const left = x - w * 0.5;
  const right = x + w * 0.5;
  const bottom = y - h * 0.5;
  const top = y + h * 0.5;
  const radiusSquared = corridor.width * corridor.width * 0.25;

  if (
    segmentsCross(corridor.ax, corridor.ay, corridor.bx, corridor.by, left, bottom, right, bottom) ||
    segmentsCross(corridor.ax, corridor.ay, corridor.bx, corridor.by, right, bottom, right, top) ||
    segmentsCross(corridor.ax, corridor.ay, corridor.bx, corridor.by, right, top, left, top) ||
    segmentsCross(corridor.ax, corridor.ay, corridor.bx, corridor.by, left, top, left, bottom)
  ) {
    return true;
  }

  let distanceSquared = pointRectDistanceSquared(corridor.ax, corridor.ay, left, right, bottom, top);
  distanceSquared = Math.min(
    distanceSquared,
    pointRectDistanceSquared(corridor.bx, corridor.by, left, right, bottom, top),
    pointSegmentDistanceSquared(left, bottom, corridor.ax, corridor.ay, corridor.bx, corridor.by),
    pointSegmentDistanceSquared(right, bottom, corridor.ax, corridor.ay, corridor.bx, corridor.by),
    pointSegmentDistanceSquared(right, top, corridor.ax, corridor.ay, corridor.bx, corridor.by),
    pointSegmentDistanceSquared(left, top, corridor.ax, corridor.ay, corridor.bx, corridor.by),
  );
  return distanceSquared <= radiusSquared + EPSILON;
}

function cellsAreFree(terrain: TerrainGrid, nav: NavGrid, x: number, y: number, w: number, h: number): boolean {
  const left = x - w * 0.5;
  const right = x + w * 0.5;
  const bottom = y - h * 0.5;
  const top = y + h * 0.5;
  const c0 = Math.floor(left / nav.cellSize);
  const c1 = Math.ceil(right / nav.cellSize) - 1;
  const r0 = Math.floor(bottom / nav.cellSize);
  const r1 = Math.ceil(top / nav.cellSize) - 1;
  if (c0 < 0 || r0 < 0 || c1 >= nav.cols || r1 >= nav.rows) return false;

  for (let row = r0; row <= r1; row++) {
    const cellY = (row + 0.5) * nav.cellSize;
    const terrainRow = Math.floor(cellY / terrain.cellSize);
    if (terrainRow < 0 || terrainRow >= terrain.rows) return false;
    for (let col = c0; col <= c1; col++) {
      const cellX = (col + 0.5) * nav.cellSize;
      if (!isWalkable(nav, cellX, cellY)) return false;
      const terrainCol = Math.floor(cellX / terrain.cellSize);
      if (terrainCol < 0 || terrainCol >= terrain.cols) return false;
      const flags = terrain.flags[terrainRow * terrain.cols + terrainCol] ?? 0;
      if ((flags & TerrainFlag.Buildable) === 0) return false;
    }
  }
  return true;
}

export function canPlace(terrain: TerrainGrid, nav: NavGrid, q: PlacementQuery, x: number, y: number): boolean {
  const [w, h] = q.footprint;
  if (w <= 0 || h <= 0 || !onBuildGrid(x, w) || !onBuildGrid(y, h)) return false;

  const farX = Math.abs(x - q.center[0]) + w * 0.5;
  const farY = Math.abs(y - q.center[1]) + h * 0.5;
  if (farX * farX + farY * farY > q.radius * q.radius + EPSILON) return false;

  const spacing = q.spacing ?? 1;
  const townHallSpacing = q.minFromTownHall ?? 1.5;
  for (let i = 0; i < q.existing.length; i++) {
    const other = q.existing[i]!;
    const isTownHall = Math.abs(other.x - q.townHall[0]) < EPSILON && Math.abs(other.y - q.townHall[1]) < EPSILON;
    const gap = isTownHall ? Math.max(spacing, townHallSpacing) : spacing;
    if (rectDistanceSquared(x, y, w, h, other) + EPSILON < gap * gap) return false;
  }

  for (let i = 0; i < q.corridors.length; i++) {
    if (touchesCorridor(x, y, w, h, q.corridors[i]!)) return false;
  }

  return cellsAreFree(terrain, nav, x, y, w, h);
}

export function findBuildSpot(terrain: TerrainGrid, nav: NavGrid, q: PlacementQuery): { x: number; y: number } | null {
  const [w, h] = q.footprint;
  const offsetX = gridOffset(w);
  const offsetY = gridOffset(h);
  const minX = Math.ceil(q.center[0] - q.radius - offsetX) + offsetX;
  const maxX = Math.floor(q.center[0] + q.radius - offsetX) + offsetX;
  const minY = Math.ceil(q.center[1] - q.radius - offsetY) + offsetY;
  const maxY = Math.floor(q.center[1] + q.radius - offsetY) + offsetY;
  const towardX = q.preferToward ? q.preferToward[0] - q.townHall[0] : 0;
  const towardY = q.preferToward ? q.preferToward[1] - q.townHall[1] : 0;
  let bestX = 0;
  let bestY = 0;
  let bestSide = 2;
  let bestDistance = q.preferToward ? -Infinity : Infinity;
  let found = false;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (!canPlace(terrain, nav, q, x, y)) continue;
      const dx = x - q.townHall[0];
      const dy = y - q.townHall[1];
      const distance = dx * dx + dy * dy;
      const side = q.preferToward && dx * towardX + dy * towardY <= 0 ? 1 : 0;
      const betterDistance = q.preferToward ? distance > bestDistance + EPSILON : distance < bestDistance - EPSILON;
      const sameDistance = Math.abs(distance - bestDistance) <= EPSILON;
      if (
        !found ||
        side < bestSide ||
        (side === bestSide && betterDistance) ||
        (side === bestSide && sameDistance && (y < bestY || (y === bestY && x < bestX)))
      ) {
        found = true;
        bestX = x;
        bestY = y;
        bestSide = side;
        bestDistance = distance;
      }
    }
  }

  return found ? { x: bestX, y: bestY } : null;
}

export function baseCorridors(
  townHall: [number, number],
  mine: [number, number],
  mapCenter: [number, number],
  buildRadius: number,
): Corridor[] {
  const dx = mapCenter[0] - townHall[0];
  const dy = mapCenter[1] - townHall[1];
  const length = Math.hypot(dx, dy);
  const scale = length > 0 ? buildRadius / length : 0;
  return [
    { ax: townHall[0], ay: townHall[1], bx: mine[0], by: mine[1], width: 3.5 },
    {
      ax: townHall[0],
      ay: townHall[1],
      bx: townHall[0] + dx * scale,
      by: townHall[1] + dy * scale,
      width: 4,
    },
  ];
}
