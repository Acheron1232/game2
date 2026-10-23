// Two 8-cell model-first skins per image; split without moving any cell boundaries.
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import sharp from 'sharp';

const batch = process.argv.includes('--batch2') ? 'selected-batch2' : 'selected-batch1';
const pairs = JSON.parse(readFileSync(new URL(`./${batch}.json`, import.meta.url), 'utf8')) as string[][];
const [command, number, input] = process.argv.slice(2);
const pair = pairs[Number(number) - 1];
if (!pair) throw new Error('Pass guide|process, batch number 1–5, and input PNG for process');
const root = resolve('..');
const heights = pair.map(
  (id) => (JSON.parse(readFileSync(`${root}/client/public/assets/models/${id}_skin.json`, 'utf8')) as { height: number }).height,
);
const height = heights.reduce((a, b) => a + b, 0);
const tops = heights.map((_, i) => heights.slice(0, i).reduce((a, b) => a + b, 0));
if (command === 'guide') {
  await sharp({ create: { width: 1024, height, channels: 3, background: '#777777' } })
    .composite(pair.map((id, i) => ({ input: `${root}/art/source/uv/${id}_guide.png`, top: tops[i]!, left: 0 })))
    .png()
    .toFile(`${root}/art/source/uv/${batch}-${number}.png`);
} else if (command === 'process' && input) {
  const source = await sharp(resolve(input)).resize(1024, height, { fit: 'fill' }).png().toBuffer();
  for (let i = 0; i < pair.length; i++) {
    const output = `${root}/art/raw/skin_${pair[i]}.png`;
    await sharp(source).extract({ left: 0, top: tops[i]!, width: 1024, height: heights[i]! }).png().toFile(output);
    const result = spawnSync('pnpm', ['exec', 'tsx', 'models/expansion-assets.ts', 'process', pair[i]!, output], { stdio: 'inherit' });
    if (result.status !== 0) throw new Error(`Failed skin ${pair[i]}`);
  }
} else throw new Error('Unknown command');
