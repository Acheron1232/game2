import { terrainCellAt, terrainLevel, type TerrainGrid } from '../map/terrain';
import type { TreeIndex } from '../nav/trees';
import { hiddenFrom, revealedTo } from './buffs';
import { isFlyingType } from './entity-types';
import type { SimEntity } from './match-sim';

export const SIGHT_CELL = 2;

export interface SightSource {
  x: number;
  y: number;
  team: number;
  sight: number;
  air: boolean;
}

interface TeamGrid {
  visible: Uint8Array;
  explored: Uint8Array;
  groundCoverage: Uint16Array;
  airCoverage: Uint16Array;
}

interface RayTable {
  readonly targetX: Int16Array;
  readonly targetY: Int16Array;
  readonly starts: Uint32Array;
  readonly stepX: Int16Array;
  readonly stepY: Int16Array;
}

const COMMON_RADIUS = 16;
const RAY_TABLES: RayTable[] = [];

function makeRayTable(radius: number): RayTable {
  const targetX: number[] = [];
  const targetY: number[] = [];
  const starts: number[] = [0];
  const stepX: number[] = [];
  const stepY: number[] = [];
  const radiusSq = radius * radius;

  for (let y = -radius; y <= radius; y++) {
    for (let x = -radius; x <= radius; x++) {
      if ((x === 0 && y === 0) || x * x + y * y > radiusSq) continue;
      targetX.push(x);
      targetY.push(y);

      let atX = 0;
      let atY = 0;
      const absX = Math.abs(x);
      const absY = Math.abs(y);
      const signX = Math.sign(x);
      const signY = Math.sign(y);
      let error = absX - absY;
      while (atX !== x || atY !== y) {
        const twiceError = error * 2;
        if (twiceError > -absY) {
          error -= absY;
          atX += signX;
        }
        if (twiceError < absX) {
          error += absX;
          atY += signY;
        }
        stepX.push(atX);
        stepY.push(atY);
      }
      starts.push(stepX.length);
    }
  }

  return {
    targetX: new Int16Array(targetX),
    targetY: new Int16Array(targetY),
    starts: new Uint32Array(starts),
    stepX: new Int16Array(stepX),
    stepY: new Int16Array(stepY),
  };
}

for (let radius = 0; radius <= COMMON_RADIUS; radius++) RAY_TABLES.push(makeRayTable(radius));

export class TeamSight {
  readonly cols: number;
  readonly cell = SIGHT_CELL;
  private readonly rows: number;
  private readonly levels: Float32Array;
  private readonly forest: Uint8Array;
  private readonly forestCounts: Uint8Array;
  private readonly grids = new Map<number, TeamGrid>();
  private aliveTrees = -1;

  constructor(
    private readonly terrain: TerrainGrid,
    private readonly trees: TreeIndex | null,
  ) {
    this.cols = Math.ceil((terrain.cols * terrain.cellSize) / SIGHT_CELL);
    this.rows = Math.ceil((terrain.rows * terrain.cellSize) / SIGHT_CELL);
    if (this.cols !== this.rows) throw new Error('Sight needs a square map');
    this.levels = new Float32Array(this.cols * this.rows);
    this.forest = new Uint8Array(this.levels.length);
    this.forestCounts = new Uint8Array(this.levels.length);

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const terrainCell = terrainCellAt(terrain, (col + 0.5) * SIGHT_CELL, (row + 0.5) * SIGHT_CELL);
        this.levels[row * this.cols + col] = terrainCell === -1 ? 0 : terrainLevel(terrain, terrainCell);
      }
    }
    this.refreshForest();
  }

  update(sources: Iterable<SightSource>): void {
    this.refreshForest();
    for (const grid of this.grids.values()) {
      grid.visible.fill(0);
      grid.groundCoverage.fill(0);
      grid.airCoverage.fill(0);
    }

    for (const source of sources) {
      if (source.sight <= 0) continue;
      const grid = this.teamGrid(source.team);
      const col = this.clampCol(Math.floor(source.x / SIGHT_CELL));
      const row = this.clampRow(Math.floor(source.y / SIGHT_CELL));
      const center = row * this.cols + col;
      const radius = Math.floor(source.sight / SIGHT_CELL);
      // Units in the same sight cell cast identical rays. A larger same-layer source
      // already includes all rays of a smaller one, even with forest/cliff blockers.
      const coverage = source.air ? grid.airCoverage : grid.groundCoverage;
      if (coverage[center]! >= radius + 1) continue;
      coverage[center] = radius + 1;
      grid.visible[center] = 1;
      if (radius <= COMMON_RADIUS) this.addCachedSight(grid.visible, col, row, radius, source.air);
      else this.addLargeSight(grid.visible, col, row, radius, source.air);
    }

    for (const grid of this.grids.values()) {
      const visible = grid.visible;
      const explored = grid.explored;
      for (let i = 0; i < visible.length; i++) if (visible[i]) explored[i] = 1;
    }
  }

  sees(team: number, e: SimEntity): boolean {
    if (e.team === team) return true;
    if (revealedTo(e.buffs, team)) return true;
    if (hiddenFrom(e, team)) return false;
    if (!e.building) return this.seesPoint(team, e.mover.x, e.mover.y);

    const grid = this.grids.get(team)?.visible;
    if (!grid) return false;
    const left = this.clampCol(Math.floor((e.mover.x - e.building.w / 2) / SIGHT_CELL));
    const right = this.clampCol(Math.ceil((e.mover.x + e.building.w / 2) / SIGHT_CELL) - 1);
    const bottom = this.clampRow(Math.floor((e.mover.y - e.building.h / 2) / SIGHT_CELL));
    const top = this.clampRow(Math.ceil((e.mover.y + e.building.h / 2) / SIGHT_CELL) - 1);
    for (let row = bottom; row <= top; row++) {
      const start = row * this.cols;
      for (let col = left; col <= right; col++) if (grid[start + col]) return true;
    }
    return false;
  }

  seesPoint(team: number, x: number, y: number): boolean {
    const grid = this.grids.get(team)?.visible;
    if (!grid) return false;
    const col = this.clampCol(Math.floor(x / SIGHT_CELL));
    const row = this.clampRow(Math.floor(y / SIGHT_CELL));
    return grid[row * this.cols + col] === 1;
  }

  visible(team: number): Uint8Array {
    return this.teamGrid(team).visible;
  }

  explored(team: number): Uint8Array {
    return this.teamGrid(team).explored;
  }

  private teamGrid(team: number): TeamGrid {
    let grid = this.grids.get(team);
    if (!grid) {
      const cells = this.cols * this.rows;
      grid = {
        visible: new Uint8Array(cells),
        explored: new Uint8Array(cells),
        groundCoverage: new Uint16Array(cells),
        airCoverage: new Uint16Array(cells),
      };
      this.grids.set(team, grid);
    }
    return grid;
  }

  private addCachedSight(visible: Uint8Array, col: number, row: number, radius: number, air: boolean): void {
    const rays = RAY_TABLES[radius]!;
    if (air) {
      for (let target = 0; target < rays.targetX.length; target++) {
        const x = col + rays.targetX[target]!;
        const y = row + rays.targetY[target]!;
        if (x >= 0 && y >= 0 && x < this.cols && y < this.rows) visible[y * this.cols + x] = 1;
      }
      return;
    }

    const viewerLevel = this.levels[row * this.cols + col]!;
    for (let target = 0; target < rays.targetX.length; target++) {
      const start = rays.starts[target]!;
      const end = rays.starts[target + 1]!;
      for (let step = start; step < end; step++) {
        const x = col + rays.stepX[step]!;
        const y = row + rays.stepY[step]!;
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) break;
        const cell = y * this.cols + x;
        visible[cell] = 1;
        if (this.forest[cell] || this.levels[cell]! >= viewerLevel + 0.5) break;
      }
    }
  }

  private addLargeSight(visible: Uint8Array, col: number, row: number, radius: number, air: boolean): void {
    const radiusSq = radius * radius;
    const viewerLevel = this.levels[row * this.cols + col]!;
    for (let targetY = -radius; targetY <= radius; targetY++) {
      for (let targetX = -radius; targetX <= radius; targetX++) {
        if ((targetX === 0 && targetY === 0) || targetX * targetX + targetY * targetY > radiusSq) continue;
        let x = 0;
        let y = 0;
        const absX = Math.abs(targetX);
        const absY = Math.abs(targetY);
        const signX = Math.sign(targetX);
        const signY = Math.sign(targetY);
        let error = absX - absY;
        while (x !== targetX || y !== targetY) {
          const twiceError = error * 2;
          if (twiceError > -absY) {
            error -= absY;
            x += signX;
          }
          if (twiceError < absX) {
            error += absX;
            y += signY;
          }
          const sightCol = col + x;
          const sightRow = row + y;
          if (sightCol < 0 || sightRow < 0 || sightCol >= this.cols || sightRow >= this.rows) break;
          const cell = sightRow * this.cols + sightCol;
          visible[cell] = 1;
          if (!air && (this.forest[cell] || this.levels[cell]! >= viewerLevel + 0.5)) break;
        }
      }
    }
  }

  private refreshForest(): void {
    if (!this.trees) return;
    let alive = 0;
    for (let tree = 0; tree < this.trees.count; tree++) alive += this.trees.alive[tree]!;
    if (alive === this.aliveTrees) return;
    this.aliveTrees = alive;
    this.forest.fill(0);
    this.forestCounts.fill(0);
    for (let cell = 0; cell < this.trees.cellTree.length; cell++) {
      const tree = this.trees.cellTree[cell]!;
      if (tree === -1 || !this.trees.alive[tree]) continue;
      const terrainCol = cell % this.terrain.cols;
      const terrainRow = (cell - terrainCol) / this.terrain.cols;
      const col = Math.floor((terrainCol * this.terrain.cellSize) / SIGHT_CELL);
      const row = Math.floor((terrainRow * this.terrain.cellSize) / SIGHT_CELL);
      const sightCell = row * this.cols + col;
      if (this.forestCounts[sightCell]! < 2) this.forestCounts[sightCell] = this.forestCounts[sightCell]! + 1;
    }
    for (let cell = 0; cell < this.forestCounts.length; cell++) if (this.forestCounts[cell]! >= 2) this.forest[cell] = 1;
  }

  private clampCol(col: number): number {
    return Math.max(0, Math.min(this.cols - 1, col));
  }

  private clampRow(row: number): number {
    return Math.max(0, Math.min(this.rows - 1, row));
  }
}

/** SimEntity adapter that yields one reused source object. */
export function* entitySources(entities: readonly SimEntity[]): Iterable<SightSource> {
  const source: SightSource = { x: 0, y: 0, team: 0, sight: 0, air: false };
  for (const entity of entities) {
    if (!entity.alive) continue;
    source.x = entity.mover.x;
    source.y = entity.mover.y;
    source.team = entity.team;
    source.sight = entity.stats.sight;
    source.air = isFlyingType(entity.type);
    yield source;
  }
}
