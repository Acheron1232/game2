// Checks all game data: shapes (zod) and links between files.
// Run: pnpm data:check

import { loadGameData, validateGameData } from '@game/shared';

const data = loadGameData(); // throws with a clear message if a file has the wrong shape
const errors = validateGameData(data);
if (errors.length) {
  console.error(`Data check FAILED (${errors.length}):\n- ${errors.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `Data check OK: ${data.heroes.length} heroes, ${data.abilities.length} abilities, ${data.units.length} units, ` +
    `${data.buildings.buildings.length} buildings, ${data.items.length} items, ${data.map.camps.length} camps on the map.`,
);
