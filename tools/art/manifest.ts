// Writes client/public/assets/manifest.json: every game asset with size, content hash and load group.
// The client loader reads it to show progress and to ask for "file?v=hash" (safe to cache forever).
// Run: pnpm art:manifest  (pnpm art:process runs it too)

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { ROOT } from './lib/sheets';

const ASSETS = join(ROOT, 'client', 'public', 'assets');

/** Folder -> lobby loading group. */
const GROUPS: Record<string, string> = {
  terrain: 'Map',
  foliage: 'Map',
  materials: 'Units',
  icons: 'Interface',
  portraits: 'Interface',
  effects: 'Effects',
  models: 'Units',
  heroes: 'Heroes',
  audio: 'Sounds',
};

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const full = join(dir, f);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const files = walk(ASSETS)
  .filter((f) => !f.endsWith('manifest.json') && !f.endsWith('.DS_Store'))
  .sort()
  .map((f) => {
    const path = relative(ASSETS, f);
    const folder = path.split('/')[0] ?? '';
    return {
      path,
      bytes: statSync(f).size,
      hash: createHash('sha256').update(readFileSync(f)).digest('hex').slice(0, 10),
      group: GROUPS[folder] ?? 'Interface',
    };
  });

mkdirSync(ASSETS, { recursive: true });
const totalBytes = files.reduce((n, f) => n + f.bytes, 0);
writeFileSync(join(ASSETS, 'manifest.json'), JSON.stringify({ version: 1, totalBytes, files }, null, 2) + '\n');
console.log(`manifest.json: ${files.length} files, ${(totalBytes / 1024 / 1024).toFixed(2)} MB`);
