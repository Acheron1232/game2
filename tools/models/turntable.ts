// Review sheets for models: renders each model from 8 sides, from the RTS camera and close-ups of
// the head (tools/models/blender/turntable.py), and puts them on one picture per model.
//   pnpm --filter @game/tools exec tsx models/turntable.ts <out_dir> <id> [id...]
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const ROOT = join(import.meta.dirname, '..', '..');
const BLENDER = process.env['BLENDER'] ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const [outDir, ...ids] = process.argv.slice(2);
if (!outDir || !ids.length) throw new Error('usage: turntable.ts <out_dir> <id> [id...]');
const SIZE = 384;
const VIEWS = ['t0', 't1', 't2', 't3', 't4', 't5', 't6', 't7', 'rts', 'head_front', 'head_back', 'top'];

for (const id of ids) {
  const run = spawnSync(
    BLENDER,
    ['-b', '--factory-startup', '-P', join(ROOT, 'tools/models/blender/turntable.py'), '--', id, outDir, String(SIZE)],
    {
      encoding: 'utf8',
    },
  );
  if (run.status !== 0) {
    console.error(`FAILED ${id}\n${run.stderr.slice(-2000)}`);
    continue;
  }
  const files = VIEWS.map((v) => join(outDir, `${id}_${v}.png`)).filter((f) => existsSync(f));
  const cols = 6;
  const tiles = await Promise.all(
    files.map(async (f, i) => ({ input: await sharp(f).toBuffer(), left: (i % cols) * SIZE, top: Math.floor(i / cols) * SIZE })),
  );
  await sharp({ create: { width: cols * SIZE, height: Math.ceil(files.length / cols) * SIZE, channels: 4, background: '#5a5e64' } })
    .composite(tiles)
    .png()
    .toFile(join(outDir, `${id}.png`));
  for (const f of files) rmSync(f);
  console.log(`sheet ${join(outDir, `${id}.png`)}`);
}
