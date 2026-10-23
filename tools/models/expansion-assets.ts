// Model-first skins for the five heroes, foundry and its trained golem.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../art/lib/sheets';
import { splitTeamColor } from '../art/lib/pixels';

export const HERO_CELLS = [
  'face',
  'head_back',
  'chest',
  'back',
  'arm',
  'forearm',
  'legs',
  'shin',
  'foot',
  'hand',
  'team',
  'cloth',
  'weapon_a',
  'weapon_b',
  'extra_a',
  'extra_b',
];
const FOUNDRY_CELLS = [
  'wall',
  'roof',
  'foundation',
  'wood',
  'iron',
  'furnace',
  'door',
  'banner',
  'statue_face',
  'statue_back',
  'statue_body',
  'stone',
  'brass',
  'chain',
  'crane',
  'glow',
];
const UNIT_CELLS = ['face', 'body', 'arm', 'legs', 'foot_hand', 'team', 'weapon_a', 'weapon_b'];
const [command, id, input] = process.argv.slice(2);
const SELECTED_UNITS = [
  'chainbreaker',
  'rune_gunner',
  'null_warden',
  'reliquary_guard',
  'banner_captain',
  'lantern_novice',
  'veil_sister',
  'bulwark_golem',
  'siege_golem',
];
const REINFORCEMENTS = JSON.parse(readFileSync(new URL('./reinforcement-cells.json', import.meta.url), 'utf8')) as Record<string, string[]>;
const ids = [
  ...Object.keys(REINFORCEMENTS),
  ...SELECTED_UNITS,
  'earth_spirit',
  'thorn_marshal',
  'grave_bellkeeper',
  'tidebreaker',
  'lantern_monk',
  'obsidian_heart',
  'foundry_golem',
  'golem_foundry',
];
if (!id || !ids.includes(id) || !['init', 'guide', 'process'].includes(command ?? ''))
  throw new Error('Usage: expansion-assets.ts init|guide|process <id> [image]');
const cells =
  REINFORCEMENTS[id] ??
  (id === 'golem_foundry' ? FOUNDRY_CELLS : id === 'foundry_golem' || SELECTED_UNITS.includes(id) ? UNIT_CELLS : HERO_CELLS);
const width = 1024,
  height = cells.length === 8 ? 512 : 1024;
const out = join(ROOT, 'client/public/assets/models');
const source = join(ROOT, 'art/source/models');
const guideDir = join(ROOT, 'art/source/uv');
mkdirSync(guideDir, { recursive: true });
const names = cells.map((s) => (id === 'foundry_golem' || SELECTED_UNITS.includes(id) || REINFORCEMENTS[id] ? id + '__' + s : s));
if (command === 'init') {
  const rects = Object.fromEntries(
    names.map((name, i) => [
      name,
      { x: ((i % 4) * 256 + 4) / width, y: (Math.floor(i / 4) * 256 + 4) / height, w: 248 / width, h: 248 / height },
    ]),
  );
  writeFileSync(
    join(out, id + '_skin.json'),
    JSON.stringify({ image: id + '_skin.webp', width, height, team: true, rects }, null, 2) + '\n',
  );
  if (!existsSync(join(source, id + '_skin_preview.png'))) {
    const data = Buffer.alloc(width * height * 3);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const k = (y * width + x) * 3,
          v = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 ? 165 : 105;
        data[k] = data[k + 1] = data[k + 2] = v;
      }
    await sharp(data, { raw: { width, height, channels: 3 } })
      .png()
      .toFile(join(source, id + '_skin_preview.png'));
    await sharp(data, { raw: { width, height, channels: 3 } })
      .webp()
      .toFile(join(out, id + '_skin.webp'));
    await sharp({ create: { width, height, channels: 3, background: '#000000' } })
      .webp()
      .toFile(join(out, id + '_skin_team.webp'));
  }
} else if (command === 'guide') {
  const svg = ['<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">'];
  cells.forEach((name, i) => {
    const x = (i % 4) * 256,
      y = Math.floor(i / 4) * 256;
    svg.push(
      '<rect x="' +
        x +
        '" y="' +
        y +
        '" width="256" height="256" fill="' +
        (i % 2 ? '#828282' : '#727272') +
        '" stroke="#202020" stroke-width="3"/>',
    );
    svg.push(
      '<text x="' +
        (x + 8) +
        '" y="' +
        (y + 25) +
        '" font-family="Arial" font-size="19" font-weight="bold" fill="white">' +
        name.toUpperCase() +
        '</text>',
    );
  });
  svg.push('</svg>');
  const uv = await sharp(join(source, id + '_uv.svg'))
    .resize(width, height)
    .ensureAlpha()
    .raw()
    .toBuffer();
  for (let i = 0; i < uv.length; i += 4) {
    uv[i] = 255;
    uv[i + 1] = 225;
    uv[i + 2] = 30;
    uv[i + 3] = uv[i + 3] ? 255 : 0;
  }
  await sharp(Buffer.from(svg.join('')))
    .composite([
      {
        input: await sharp(uv, { raw: { width, height, channels: 4 } })
          .png()
          .toBuffer(),
      },
    ])
    .png()
    .toFile(join(guideDir, id + '_guide.png'));
} else {
  if (!input) throw new Error('Pass the generated painted skin.');
  const raw = await sharp(resolve(input)).resize(width, height, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  const result = splitTeamColor({ data: new Uint8ClampedArray(raw), width, height });
  const mask = result.mask?.data ?? new Uint8ClampedArray(raw.length);
  for (let i = 0; i < raw.length; i += 4) {
    const r = raw[i]!,
      g = raw[i + 1]!,
      b = raw[i + 2]!,
      hi = Math.max(r, b),
      lo = Math.min(r, b);
    if (hi < 45 || lo <= g * 1.4 + 10 || Math.abs(r - b) >= hi * 0.8) continue;
    const grey = Math.min(255, Math.round((r + b) * 0.525));
    result.color.data[i] = result.color.data[i + 1] = result.color.data[i + 2] = grey;
    mask[i] = mask[i + 1] = mask[i + 2] = mask[i + 3] = 255;
  }
  const opts = { raw: { width, height, channels: 4 as const } };
  const color = Buffer.from(result.color.data);
  await sharp(color, opts)
    .webp({ quality: 92, alphaQuality: 100 })
    .toFile(join(out, id + '_skin.webp'));
  await sharp(Buffer.from(mask), opts)
    .flatten({ background: '#000000' })
    .webp({ lossless: true })
    .toFile(join(out, id + '_skin_team.webp'));
  for (let i = 0; i < color.length; i += 4)
    if (mask[i]) {
      color[i] = Math.min(255, color[i]! * 1.35);
      color[i + 1] = Math.round(color[i + 1]! * 0.289);
      color[i + 2] = Math.round(color[i + 2]! * 0.245);
    }
  await sharp(color, opts)
    .png()
    .toFile(join(source, id + '_skin_preview.png'));
  await sharp(raw, opts)
    .png()
    .toFile(join(source, id + '_painted_source.png'));
}
console.log(command + ' ' + id + ': ' + width + '×' + height + ', ' + cells.length + ' cells');
