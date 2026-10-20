// Finds binary map data on disk. The JSON data is bundled into the code, the terrain grid is not.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

/** shared/data/<name>, looked up from the source tree, the build folder and the working folder. */
export function readSharedDataFile(name: string): Uint8Array {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const candidates = [
    process.env['GAME_DATA_DIR'] ? join(process.env['GAME_DATA_DIR'], name) : '',
    join(here, '..', '..', 'shared', 'data', name), // server/src or server/dist
    join(here, '..', '..', '..', 'shared', 'data', name), // server/src/<folder>
    join(process.cwd(), 'shared', 'data', name),
    join(process.cwd(), '..', 'shared', 'data', name),
  ].filter(Boolean);
  for (const path of candidates) if (existsSync(path)) return new Uint8Array(readFileSync(path));
  throw new Error(`Can not find shared/data/${name}. Set GAME_DATA_DIR.`);
}
