import { cp, mkdir, readFile, writeFile, readdir, stat, rm } from 'node:fs/promises';
import { resolve, join } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = join(root, 'dist', 'release');
await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });
for (const [from, to] of [
  ['server/dist', 'server'],
  ['client/dist', 'client'],
  ['deploy/runtime', 'runtime'],
  ['deploy/Dockerfile', 'Dockerfile'],
  ['deploy/Caddyfile', 'Caddyfile'],
  ['shared/data/map-terrain.bin', 'data/map-terrain.bin'],
  ['shared/data/map-trees.json', 'data/map-trees.json'],
]) {
  await mkdir(resolve(out, to, '..'), { recursive: true });
  await cp(join(root, from), join(out, to), { recursive: true });
}
async function bytes(dir) {
  let total = 0;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    total += entry.isDirectory() ? await bytes(path) : (await stat(path)).size;
  }
  return total;
}
const manifest = JSON.parse(await readFile(join(out, 'client/assets/manifest.json'), 'utf8'));
const report = { clientBytes: await bytes(join(out, 'client')), manifestBytes: manifest.totalBytes, assetCount: manifest.files.length };
if (report.clientBytes >= 100 * 1024 * 1024) throw new Error('Client exceeds the 100 MiB first-download budget');
await writeFile(join(out, 'asset-budget.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
