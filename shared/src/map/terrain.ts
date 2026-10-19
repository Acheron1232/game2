// Reads map-terrain.bin (made by tools/map/bake-terrain.mjs). Format is in docs/design/MAP.md.

export const TERRAIN_MAGIC = 'ETRN';
export const TERRAIN_HEADER_BYTES = 14;

export const GROUND_TYPES = [
  'grass',
  'grass_lush',
  'grass_dry',
  'dirt',
  'rough_dirt',
  'temple_stone',
  'sand',
  'cliff',
  'water_bed',
  'forest_floor',
] as const;
export type GroundType = (typeof GROUND_TYPES)[number];

export const TerrainFlag = {
  Passable: 1,
  Buildable: 2,
  Forest: 4,
  Border: 8,
  Cliff: 16,
  Water: 32,
  Ramp: 64,
  High: 128,
} as const;

export interface TerrainGrid {
  version: number;
  cols: number;
  rows: number;
  cellSize: number;
  ground: Uint8Array;
  flags: Uint8Array;
  /** level = byte / 100 - 1 */
  height: Uint8Array;
}

export function parseTerrain(data: ArrayBuffer | Uint8Array): TerrainGrid {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0] ?? 0, bytes[1] ?? 0, bytes[2] ?? 0, bytes[3] ?? 0);
  if (magic !== TERRAIN_MAGIC) throw new Error('Not a terrain file');
  const version = view.getUint16(4, true);
  const cols = view.getUint16(6, true);
  const rows = view.getUint16(8, true);
  const cellSize = view.getFloat32(10, true);
  const n = cols * rows;
  if (bytes.byteLength !== TERRAIN_HEADER_BYTES + n * 3) throw new Error('Terrain file has the wrong size');
  const at = (k: number) => bytes.subarray(TERRAIN_HEADER_BYTES + k * n, TERRAIN_HEADER_BYTES + (k + 1) * n);
  return { version, cols, rows, cellSize, ground: at(0), flags: at(1), height: at(2) };
}

/** Cell index for a point in game units, or -1 outside the map. */
export function terrainCellAt(t: TerrainGrid, x: number, y: number): number {
  const c = Math.floor(x / t.cellSize);
  const r = Math.floor(y / t.cellSize);
  if (c < 0 || r < 0 || c >= t.cols || r >= t.rows) return -1;
  return r * t.cols + c;
}

export function terrainLevel(t: TerrainGrid, cell: number): number {
  return (t.height[cell] ?? 100) / 100 - 1;
}
