// Packs the material swatches (Phase 3) into one palette atlas for all 3D models.
//   client/public/assets/models/palette.webp       color atlas, 8 x 8 slots of 128 px
//   client/public/assets/models/palette_team.webp  white where the slot is a team-color material
//   tools/models/palette.json                      slot name -> UV rect (read by the Blender scripts)
// Every model part uses one slot and is tinted with vertex colors, so a few swatches give many colors.
// Run: pnpm --filter @game/tools models:palette

import { readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { ROOT } from '../art/lib/sheets';

const SLOT = 128;
const GRID = 8;
const SIZE = SLOT * GRID;
const MATERIALS = join(ROOT, 'client', 'public', 'assets', 'materials');
const OUT = join(ROOT, 'client', 'public', 'assets', 'models');

/** Flat slots made here (not from Codex), for small details: eyes, glows, teeth, plain paint. */
const FLAT: Record<string, [number, number, number]> = {
  flat_white: [236, 232, 222],
  flat_grey: [140, 138, 132],
  flat_black: [28, 24, 22],
  flat_glow: [255, 255, 255],
  flat_team: [210, 210, 210],
};
const TEAM_SLOTS = new Set(['team_cloth', 'team_armor', 'flat_team']);

const TERRAIN = join(ROOT, 'client', 'public', 'assets', 'terrain');
/** Ground tiles that models need too (leaves, rocks, moss). */
const FROM_TERRAIN = ['grass_lush', 'grass_dark', 'moss_ground', 'rock_grey', 'rock_mossy', 'cliff_face'];
const swatches = readdirSync(MATERIALS)
  .filter((f) => f.endsWith('.webp') && !f.endsWith('_team.webp'))
  .map((f) => f.replace('.webp', ''))
  .sort();
const folderOf = (name: string) => (FROM_TERRAIN.includes(name) ? TERRAIN : MATERIALS);
const names = [...swatches, ...FROM_TERRAIN, ...Object.keys(FLAT)];
if (names.length > GRID * GRID) throw new Error(`Too many swatches for the palette: ${names.length}`);

const color: OverlayOptions[] = [];
const team: OverlayOptions[] = [];
const rects: Record<string, [number, number, number, number]> = {};
// Small inset so texture filtering never reads the next slot.
const INSET = 4;
for (const [i, name] of names.entries()) {
  const x = (i % GRID) * SLOT,
    y = Math.floor(i / GRID) * SLOT;
  const flat = FLAT[name];
  const input = flat
    ? await sharp({ create: { width: SLOT, height: SLOT, channels: 3, background: { r: flat[0], g: flat[1], b: flat[2] } } })
        .png()
        .toBuffer()
    : await sharp(join(folderOf(name), `${name}.webp`))
        .resize(SLOT, SLOT)
        .png()
        .toBuffer();
  color.push({ input, left: x, top: y });
  if (TEAM_SLOTS.has(name)) {
    team.push({
      input: await sharp({ create: { width: SLOT, height: SLOT, channels: 3, background: '#ffffff' } })
        .png()
        .toBuffer(),
      left: x,
      top: y,
    });
  }
  // UV rect [u0, v0, u1, v1] with v going up (glTF / Blender style: v = 1 is the top row).
  rects[name] = [(x + INSET) / SIZE, 1 - (y + SLOT - INSET) / SIZE, (x + SLOT - INSET) / SIZE, 1 - (y + INSET) / SIZE];
}

const blank = (bg: string) => sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: bg } });
await blank('#808080').composite(color).webp({ quality: 90 }).toFile(join(OUT, 'palette.webp'));
await blank('#000000').composite(team).webp({ quality: 90 }).toFile(join(OUT, 'palette_team.webp'));
// Preview copy for Blender renders only: team slots painted red so team parts are easy to see.
const red = await sharp({ create: { width: SLOT, height: SLOT, channels: 3, background: '#c42a24' } })
  .png()
  .toBuffer();
await blank('#808080')
  .composite([...color, ...team.map((t) => ({ ...t, input: red, blend: 'multiply' as const }))])
  .png()
  .toFile(join(ROOT, 'tools', 'models', 'palette_preview.png'));
writeFileSync(
  join(ROOT, 'tools', 'models', 'palette.json'),
  JSON.stringify({ size: SIZE, slot: SLOT, team: [...TEAM_SLOTS], rects }, null, 2) + '\n',
);
console.log(
  `palette: ${names.length} slots (${swatches.length} materials + ${FROM_TERRAIN.length} terrain + ${Object.keys(FLAT).length} flat) -> client/public/assets/models/palette.webp`,
);
