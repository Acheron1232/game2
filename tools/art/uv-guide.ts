// Model-first textures (tavern mercenaries): the model is built first with an empty 8-cell skin,
// then Codex paints the skin on top of a guide picture of the model's own UV layout.
//   pnpm --filter @game/tools exec tsx art/uv-guide.ts init <model>    placeholder skin layout (before the first build)
//   pnpm --filter @game/tools models:build <model> --uv               writes art/source/models/<model>_uv.svg
//   pnpm --filter @game/tools exec tsx art/uv-guide.ts guide <model>   art/source/uv/<model>_guide.png (input image for Codex)
//   pnpm --filter @game/tools exec tsx art/uv-guide.ts portrait <model> client/public/assets/portraits/<model>.webp from the
//                                                                     model's front preview (after models:build --preview)
// The layout is the same one art:process writes for an 8-cell skin sheet (4 x 2 cells of 256 px,
// UV rects pulled in by 3 px), so the painted texture fits the UVs made from the placeholder.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { ROOT } from './lib/sheets';

export const MERC_CELLS = ['face', 'body', 'arm', 'legs', 'foot_hand', 'team', 'weapon_a', 'weapon_b'] as const;
const COLS = 4,
  SLOT = 256,
  INSET = 3;
const WIDTH = COLS * SLOT,
  HEIGHT = Math.ceil(MERC_CELLS.length / COLS) * SLOT;

const [command, model] = process.argv.slice(2);
if (!model || (command !== 'init' && command !== 'guide' && command !== 'portrait')) {
  console.error('Usage: tsx art/uv-guide.ts init|guide|portrait <model>');
  process.exit(1);
}
const skin = `${model}_skin`;
const modelsDir = join(ROOT, 'client', 'public', 'assets', 'models');
const sourceDir = join(ROOT, 'art', 'source', 'models');

const cellBox = (i: number) => ({ left: (i % COLS) * SLOT, top: Math.floor(i / COLS) * SLOT });

if (command === 'init') {
  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  MERC_CELLS.forEach((name, i) => {
    const { left, top } = cellBox(i);
    rects[`${model}__${name}`] = { x: (left + INSET) / WIDTH, y: (top + INSET) / HEIGHT, w: (SLOT - 2 * INSET) / WIDTH, h: (SLOT - 2 * INSET) / HEIGHT };
  });
  const json = join(modelsDir, `${skin}.json`);
  if (!existsSync(json)) writeFileSync(json, JSON.stringify({ image: `${skin}.webp`, width: WIDTH, height: HEIGHT, team: true, rects }, null, 2) + '\n');
  // A grey checker so Blender previews work before the real texture exists.
  mkdirSync(sourceDir, { recursive: true });
  const preview = join(sourceDir, `${skin}_preview.png`);
  if (!existsSync(preview)) {
    const px = Buffer.alloc(WIDTH * HEIGHT * 3);
    for (let y = 0; y < HEIGHT; y++)
      for (let x = 0; x < WIDTH; x++) px.fill((Math.floor(x / 32) + Math.floor(y / 32)) % 2 ? 150 : 120, (y * WIDTH + x) * 3, (y * WIDTH + x) * 3 + 3);
    await sharp(px, { raw: { width: WIDTH, height: HEIGHT, channels: 3 } }).png().toFile(preview);
  }
  console.log(`Placeholder skin for ${model}: ${json}`);
} else if (command === 'portrait') {
  // The preview is 6 shots side by side; the second one is the front view.
  const preview = join(sourceDir, `${model}.png`);
  const meta = await sharp(preview).metadata();
  const shot = meta.height!;
  const front = await sharp(preview).extract({ left: shot, top: 0, width: shot, height: shot }).png().toBuffer();
  const trimmed = await sharp(front).trim().png().toBuffer({ resolveWithObject: true });
  // Head and upper body: a square from the top of the figure.
  const w = trimmed.info.width,
    h = trimmed.info.height;
  const side = Math.min(w, h, Math.max(Math.round(h * 0.55), Math.round(w * 0.7)));
  const left = Math.max(0, Math.round((w - side) / 2));
  const crop = await sharp(trimmed.data).extract({ left, top: 0, width: Math.min(side, w - left), height: side }).png().toBuffer();
  const out = join(ROOT, 'client', 'public', 'assets', 'portraits', `${model}.webp`);
  await sharp(crop)
    .resize(112, 112, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .extend({ top: 8, bottom: 8, left: 8, right: 8, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .flatten({ background: '#2b241e' })
    .webp({ quality: 88 })
    .toFile(out);
  console.log(`Portrait: ${out}`);
} else {
  const uvPath = join(sourceDir, `${model}_uv.svg`);
  if (!existsSync(uvPath)) throw new Error(`No UV layout. Run: pnpm --filter @game/tools models:build ${model} --uv`);
  // Cell backgrounds, grid lines and big labels.
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${HEIGHT}">`, `<rect width="100%" height="100%" fill="#7a7a7a"/>`];
  MERC_CELLS.forEach((name, i) => {
    const { left, top } = cellBox(i);
    svg.push(`<rect x="${left}" y="${top}" width="${SLOT}" height="${SLOT}" fill="${i % 2 ? '#8c8c8c' : '#808080'}" stroke="#202020" stroke-width="4"/>`);
    svg.push(`<text x="${left + 10}" y="${top + 30}" font-family="Helvetica, Arial" font-size="24" font-weight="bold" fill="#ffffff" stroke="#000000" stroke-width="1">${name.toUpperCase()}</text>`);
  });
  svg.push('</svg>');
  // UV outlines in bright yellow (Blender writes them as light lines with alpha).
  const uv = await sharp(uvPath).resize(WIDTH, HEIGHT).ensureAlpha().raw().toBuffer();
  for (let i = 0; i < uv.length; i += 4) {
    const a = uv[i + 3]!;
    uv[i] = 255;
    uv[i + 1] = 230;
    uv[i + 2] = 40;
    uv[i + 3] = a ? 255 : 0;
  }
  const outDir = join(ROOT, 'art', 'source', 'uv');
  mkdirSync(outDir, { recursive: true });
  const out = join(outDir, `${model}_guide.png`);
  await sharp(Buffer.from(svg.join('')))
    .composite([{ input: await sharp(uv, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer() }])
    .png()
    .toFile(out);
  console.log(`Guide: ${out}`);
}
