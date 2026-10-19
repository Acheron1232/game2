// Turns a raw Codex sheet into game files.
//   pnpm art:process <sheetId>     one sheet
//   pnpm art:process --all         every sheet that has a raw image
//
// For each cell: cut it out of the grid, then by kind:
//   tile     -> seamless, square            sprite -> green removed, trimmed
//   frame    -> green removed, square (for CSS border-image / 9-slice)
//   icon     -> square                       additive -> glow kept on black
//   concept  -> green removed, kept in art/source only (model reference)
// Team color (magenta) becomes grey shading + a <name>_team.webp mask.
// Clean full-size PNGs go to art/source/<sheet>/, small WebP files to the game folders.

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp, { type OverlayOptions } from 'sharp';
import { findSheet, loadSheets, ROOT, type Cell, type Sheet } from './lib/sheets';
import { alphaFromBrightness, clearBorderLines, crop, findCells, hasTransparency, keyOutBackground, keyOutGreen, makeSeamless, opaqueBounds, seamScore, splitTeamColor, type Rgba } from './lib/pixels';

const WEBP = { quality: 88, alphaQuality: 100, effort: 5 } as const;

function outDir(cell: Cell): string | null {
  if (cell.out === 'concept') return null;
  if (cell.out === 'ui') return join(ROOT, 'client', 'src', 'assets', 'ui');
  return join(ROOT, 'client', 'public', 'assets', cell.out);
}

async function readRgba(path: string): Promise<Rgba> {
  const { data, info } = await sharp(path).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

const toSharp = (img: Rgba) => sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), { raw: { width: img.width, height: img.height, channels: 4 } });

async function resizeRgba(img: Rgba, w: number, h: number, fit: 'fill' | 'inside' | 'cover'): Promise<Rgba> {
  const { data, info } = await toSharp(img).resize(w, h, { fit, kernel: 'lanczos3' }).raw().toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height };
}

interface CellResult {
  cell: Cell;
  image: Rgba;
  mask: Rgba | null;
  note: string;
}

/** Transparent sheets only need their soft edges cleaned; flat-color sheets lose the backdrop by its color. */
function removeBackdrop(img: Rgba, transparentSheet: boolean): Rgba {
  const clean = clearBorderLines(img);
  return transparentSheet ? keyOutGreen(clean, true) : keyOutBackground(clean);
}

async function processCell(cell: Cell, raw: Rgba, transparentSheet: boolean): Promise<CellResult> {
  let img = raw;
  let note = '';
  switch (cell.kind) {
    case 'tile': {
      img = await resizeRgba(img, cell.size, cell.size, 'cover');
      const before = seamScore(img);
      img = makeSeamless(img);
      note = `seam ${before.toFixed(0)} -> ${seamScore(img).toFixed(0)}`;
      break;
    }
    case 'frame':
      img = await resizeRgba(removeBackdrop(img, transparentSheet), cell.size, cell.size, 'fill');
      break;
    case 'icon':
    case 'skin':
      img = await resizeRgba(img, cell.size, cell.size, 'cover');
      break;
    case 'additive':
      img = await resizeRgba(alphaFromBrightness(clearBorderLines(img)), cell.size, cell.size, 'inside');
      break;
    case 'sprite':
    case 'concept': {
      img = removeBackdrop(img, transparentSheet);
      const box = opaqueBounds(img);
      if (!box) return { cell, image: img, mask: null, note: 'EMPTY (all green?)' };
      img = crop(img, box);
      if (img.width > cell.size || img.height > cell.size) img = await resizeRgba(img, cell.size, cell.size, 'inside');
      note = `${img.width}x${img.height}`;
      break;
    }
  }
  let mask: Rgba | null = null;
  // Model skins mark their team cells by hand: skin tones can look a bit magenta to the detector.
  if (cell.teamColor || cell.kind === 'concept' || cell.kind === 'tile') {
    const split = splitTeamColor(img);
    if (split.mask) {
      img = split.color;
      mask = split.mask;
      note += ' +team mask';
    }
  }
  return { cell, image: img, mask, note };
}

/**
 * Cells in one image, slot by slot, plus UV rects. Sprites stand on the bottom of their slot.
 * Skin atlases (model textures) have no padding, so they stay a power of two; their UV rects
 * are pulled in by 3 px instead, so filtering never reads the next cell. If any cell has a
 * team mask, a matching <name>_team.webp is written too, plus a red-team preview for Blender.
 */
async function writeAtlas(name: string, results: CellResult[], dir: string): Promise<void> {
  const skin = results.every((r) => r.cell.kind === 'skin');
  // Skin atlases are always 4 slots wide (1024 px), so 16 or 20 cells stay easy to use.
  const cols = skin ? 4 : Math.ceil(Math.sqrt(results.length));
  const slot = Math.max(...results.map((r) => r.cell.size));
  const pad = skin ? 0 : 2;
  const inset = skin ? 3 : 0;
  const rows = Math.ceil(results.length / cols);
  const width = cols * (slot + pad * 2), height = rows * (slot + pad * 2);
  const composites: OverlayOptions[] = [];
  const masks: OverlayOptions[] = [];
  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  for (const [i, r] of results.entries()) {
    const sx = (i % cols) * (slot + pad * 2) + pad, sy = Math.floor(i / cols) * (slot + pad * 2) + pad;
    const left = sx + Math.floor((slot - r.image.width) / 2), top = sy + (slot - r.image.height);
    composites.push({ input: await toSharp(r.image).png().toBuffer(), left, top });
    if (r.mask) masks.push({ input: await toSharp(r.mask).png().toBuffer(), left, top });
    rects[r.cell.name] = { x: (left + inset) / width, y: (top + inset) / height, w: (r.image.width - 2 * inset) / width, h: (r.image.height - 2 * inset) / height };
  }
  const blank = () => sharp({ create: { width, height, channels: 4, background: { r: 0, g: 0, b: 0, alpha: skin ? 1 : 0 } } });
  await blank().composite(composites).webp(WEBP).toFile(join(dir, `${name}.webp`));
  if (masks.length) {
    await blank().composite(masks).flatten({ background: '#000000' }).webp({ quality: 90 }).toFile(join(dir, `${name}_team.webp`));
    // Blender preview copy: team parts in red, so they are easy to see in renders.
    const base = await blank().composite(composites).removeAlpha().raw().toBuffer();
    const mask = await blank().composite(masks).flatten({ background: '#000000' }).removeAlpha().raw().toBuffer();
    const red = [0xc4, 0x2a, 0x24];
    for (let i = 0; i < base.length; i += 3) {
      const k = mask[i]! / 255;
      for (let c = 0; c < 3; c++) base[i + c] = Math.min(255, base[i + c]! * (1 - k) + ((base[i + c]! * red[c]!) / 255) * 1.75 * k);
    }
    mkdirSync(join(ROOT, 'art', 'source', 'models'), { recursive: true });
    await sharp(base, { raw: { width, height, channels: 3 } }).png().toFile(join(ROOT, 'art', 'source', 'models', `${name}_preview.png`));
  }
  writeFileSync(join(dir, `${name}.json`), JSON.stringify({ image: `${name}.webp`, width, height, team: masks.length > 0, rects }, null, 2) + '\n');
}

/** A quick look at all cells on a checkerboard, for reviewing the cut. */
async function writeContactSheet(sheet: Sheet, results: CellResult[], dir: string): Promise<void> {
  const [cols] = sheet.grid;
  const s = 160, gap = 8;
  const rows = Math.ceil(results.length / cols);
  const width = cols * (s + gap) + gap, height = rows * (s + gap) + gap;
  const tile = 16;
  const checker = Buffer.alloc(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const v = (Math.floor(x / tile) + Math.floor(y / tile)) % 2 ? 90 : 60;
    checker.set([v, v, v, 255], (y * width + x) * 4);
  }
  const composites: OverlayOptions[] = [];
  for (const [i, r] of results.entries()) {
    const buf = await toSharp(r.image).resize(s, s, { fit: 'inside' }).png().toBuffer();
    const meta = await sharp(buf).metadata();
    composites.push({ input: buf, left: gap + (i % cols) * (s + gap) + Math.floor((s - (meta.width ?? s)) / 2), top: gap + Math.floor(i / cols) * (s + gap) + Math.floor((s - (meta.height ?? s)) / 2) });
  }
  await sharp(checker, { raw: { width, height, channels: 4 } }).composite(composites).png().toFile(join(dir, '_contact.png'));
}

async function processSheet(sheet: Sheet): Promise<void> {
  const rawPath = join(ROOT, 'art', 'raw', `${sheet.id}.png`);
  if (!existsSync(rawPath)) throw new Error(`No raw image at art/raw/${sheet.id}.png. Run: pnpm art:gen ${sheet.id}`);
  const raw = await readRgba(rawPath);
  const rects = findCells(raw, sheet.grid[0], sheet.grid[1]);
  const transparentSheet = hasTransparency(raw);
  const sourceDir = join(ROOT, 'art', 'source', sheet.id);
  mkdirSync(sourceDir, { recursive: true });
  const results: CellResult[] = [];
  const atlases = new Map<string, { dir: string; results: CellResult[] }>();
  const written = new Set<string>();
  for (const [i, cell] of sheet.cells.entries()) {
    const cut = crop(raw, rects[i]!);
    await toSharp(cut).png().toFile(join(sourceDir, `${cell.name}.png`));
    const result = await processCell(cell, cut, transparentSheet);
    results.push(result);
    const dir = outDir(cell);
    if (dir) {
      mkdirSync(dir, { recursive: true });
      written.add(dir.replace(ROOT + '/', ''));
    }
    if (dir && cell.atlas) {
      const a = atlases.get(cell.atlas) ?? { dir, results: [] };
      a.results.push(result);
      atlases.set(cell.atlas, a);
    } else if (dir) {
      await toSharp(result.image).webp(WEBP).toFile(join(dir, `${cell.name}.webp`));
      if (result.mask) await toSharp(result.mask).webp({ quality: 90, alphaQuality: 100 }).toFile(join(dir, `${cell.name}_team.webp`));
      // CSS cursors work best as PNG in every browser.
      if (cell.name.startsWith('cursor')) await toSharp(result.image).png().toFile(join(dir, `${cell.name}.png`));
    }
    console.log(`  ${cell.name.padEnd(22)} ${cell.kind.padEnd(8)} ${result.note}`);
  }
  for (const [name, a] of atlases) await writeAtlas(name, a.results, a.dir);
  await writeContactSheet(sheet, results, sourceDir);
  console.log(`${sheet.id}: ${results.length} cells from a ${raw.width}x${raw.height} image -> ${written.size ? [...written].join(', ') : 'art/source only'}`);
}

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: pnpm art:process <sheetId> | --all');
  process.exit(1);
}
const sheets = arg === '--all' ? loadSheets().filter((s) => existsSync(join(ROOT, 'art', 'raw', `${s.id}.png`))) : [findSheet(arg)];
for (const s of sheets) await processSheet(s);

await import('./manifest');
