// The walk grid of a match: terrain + the buildings that stand on the map from the start.
// Server and client build it the same way, so the client's own-hero prediction finds the
// same paths as the server.

import type { MapLayout } from '../data/schemas';
import type { TerrainGrid } from '../map/terrain';
import { blockRect, buildNavGrid, labelRegions, type NavGrid } from './nav-grid';

/** Ground size (width, depth) that a building blocks, in game units. */
export const BUILDING_FOOTPRINT: Record<string, [number, number]> = {
  town_hall: [5, 5],
  gold_mine: [3.4, 3.4],
  side_shop: [3, 3],
  temple_market: [3.4, 3.4],
  fountain_of_life: [3, 3],
};

export interface MapBuilding {
  id: string;
  x: number;
  y: number;
  /** start slot for town halls, -1 for neutral buildings */
  start: number;
}

export function mapBuildings(layout: MapLayout): MapBuilding[] {
  return [
    ...layout.starts.map((s, i) => ({ id: 'town_hall', x: s.townHall[0], y: s.townHall[1], start: i })),
    ...layout.goldMines.map((m) => ({ id: 'gold_mine', x: m.pos[0], y: m.pos[1], start: -1 })),
    ...layout.shops.map((s) => ({ id: s.type === 'temple_market' ? 'temple_market' : 'side_shop', x: s.pos[0], y: s.pos[1], start: -1 })),
    ...layout.fountains.map((f) => ({ id: 'fountain_of_life', x: f.pos[0], y: f.pos[1], start: -1 })),
  ];
}

export function buildMatchNav(terrain: TerrainGrid, layout: MapLayout): NavGrid {
  const nav = buildNavGrid(terrain);
  for (const b of mapBuildings(layout)) {
    const fp = BUILDING_FOOTPRINT[b.id];
    if (fp) blockRect(nav, b.x, b.y, fp[0], fp[1]);
  }
  labelRegions(nav);
  return nav;
}
