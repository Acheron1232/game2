// Process the six-cell ImageGen test sheet without replacing the original terrain art.
import sharp, { type OverlayOptions } from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { crop, findCells, makeSeamless, seamScore, type Rgba } from './lib/pixels';
import { ROOT } from './lib/sheets';

const ids = ['grass', 'grass_lush', 'grass_dry', 'dirt', 'rough_dirt', 'forest_floor'];
const source = join(ROOT, 'art/raw/terrain-meadow-v2.png');
const dir = join(ROOT, 'art/source/terrain-meadow-v2');
await mkdir(dir, { recursive: true });
const raw = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
const sheet: Rgba = { data: new Uint8ClampedArray(raw.data), width: raw.info.width, height: raw.info.height };
const cells = findCells(sheet, 3, 2);
const preview: OverlayOptions[] = [];
const report = [];
for (const [i, id] of ids.entries()) {
  const cell = crop(sheet, cells[i]!);
  const resized = await sharp(Buffer.from(cell.data), { raw: { width: cell.width, height: cell.height, channels: 4 } })
    .resize(256, 256)
    .raw()
    .toBuffer();
  const tile = makeSeamless({ data: new Uint8ClampedArray(resized), width: 256, height: 256 });
  const image = sharp(Buffer.from(tile.data), { raw: { width: 256, height: 256, channels: 4 } });
  await image
    .clone()
    .png()
    .toFile(join(dir, `${id}.png`));
  const output = join(ROOT, `client/public/assets/terrain/${id}_meadow_v2.webp`);
  const info = await image.clone().webp({ quality: 92, effort: 6 }).toFile(output);
  const small = await image.clone().resize(128, 128).png().toBuffer();
  for (let y = 0; y < 4; y++)
    for (let x = 0; x < 4; x++) {
      preview.push({ input: small, left: (i % 3) * 512 + x * 128, top: Math.floor(i / 3) * 512 + y * 128 });
    }
  report.push({ id, bytes: info.size, edgeDifference: seamScore(tile) });
}
await sharp({ create: { width: 1536, height: 1024, channels: 4, background: '#222222' } })
  .composite(preview)
  .png()
  .toFile(join(dir, '_contact.png'));
await writeFile(join(dir, 'report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
