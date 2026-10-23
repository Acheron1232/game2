// The walk grid of a match: terrain + the neutral buildings that never move or fall (gold mines,
// shops, fountains). Faction buildings (Town Halls too) are entities and block the grid through
// NavBlockers when they are placed.
// Server and client build it the same way, so the client's own-hero prediction finds the
// same paths as the server.

import type { MapLayout } from '../data/schemas';
import { gameData } from '../data/index';
import type { TerrainGrid } from '../map/terrain';
import { blockRect, buildNavGrid, labelRegions, type NavGrid } from './nav-grid';

/** Ground size (width, depth) that a building blocks, in game units. */
export const BUILDING_FOOTPRINT: Record<string, [number, number]> = {
  town_hall: [5, 5],
  gold_mine: [3.4, 3.4],
  side_shop: [3, 3],
  temple_market: [3.4, 3.4],
  fountain_of_life: [3, 3],
  tavern: [3.6, 3.2],
  wayfarer_inn: [3.6, 3.2],
  cinder_inn: [3.6, 3.2],
};

/** The model (and footprint) of a map shop: the temple market (also the Relic Hall), a tavern, or a trader's tent. */
export function shopModel(type: string): string {
  const model = gameData.shops.find((s) => s.id === type)?.['model'];
  if (typeof model === 'string') return model;
  if (type === 'temple_market' || type === 'relic_hall') return 'temple_market';
  return type.startsWith('tavern') ? 'tavern' : 'side_shop';
}

export interface MapBuilding {
  id: string;
  x: number;
  y: number;
  /** start slot for town halls, -1 for neutral buildings */
  start: number;
}

export function mapBuildings(layout: MapLayout): MapBuilding[] {
  return [
    ...layout.goldMines.map((m) => ({ id: 'gold_mine', x: m.pos[0], y: m.pos[1], start: -1 })),
    ...layout.shops.map((s) => ({ id: shopModel(s.type), x: s.pos[0], y: s.pos[1], start: -1 })),
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
