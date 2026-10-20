import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTerrain, TeamSight, type SightSource } from '@game/shared';

const terrain = parseTerrain(readFileSync(join(import.meta.dirname, '../../shared/data/map-terrain.bin')));
const sight = new TeamSight(terrain, null);
const sources: SightSource[] = Array.from({ length: 300 }, (_, i) => ({
  x: 120 + (i % 4) * 2,
  y: 120 + Math.floor((i % 16) / 4) * 2,
  team: (i % 4) + 1,
  sight: 12,
  air: false,
}));
for (let i = 0; i < 20; i++) sight.update(sources);
const start = performance.now();
for (let i = 0; i < 1000; i++) sight.update(sources);
console.log(`300 clustered sight sources: ${((performance.now() - start) / 1000).toFixed(3)} ms/update`);
