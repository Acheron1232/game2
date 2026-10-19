// Flat colors per ground type. Placeholder look until the Phase 3 terrain textures exist.

import type { GroundType } from '@game/shared';

export const GROUND_COLORS: Record<GroundType, [number, number, number]> = {
  grass: [88, 140, 52],
  grass_lush: [66, 124, 46],
  grass_dry: [128, 146, 62],
  dirt: [150, 106, 62],
  rough_dirt: [128, 96, 62],
  temple_stone: [150, 146, 128],
  sand: [196, 176, 120],
  cliff: [104, 100, 92],
  water_bed: [40, 88, 140],
  forest_floor: [34, 70, 34],
};

export const TREE_COLORS: [number, number, number][] = [
  [30, 82, 46], // pine
  [52, 112, 40], // oak
  [96, 84, 62], // dead
  [70, 124, 50], // bush
];
