// Keep the model-first UV layout intact: no trimming, auto-cropping, or aspect fitting.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { ROOT } from '../art/lib/sheets';
import { splitTeamColor } from '../art/lib/pixels';

const [command, input, torsoPatch] = process.argv.slice(2);
const ids = ['pike_warden', 'frost_adept'];
const uvDir = join(ROOT, 'art/source/uv');
const source = join(ROOT, 'art/source/models');
const out = join(ROOT, 'client/public/assets/models');
mkdirSync(uvDir, { recursive: true });

if (command === 'guide') {
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: '#808080' } })
    .composite(
      await Promise.all(
        ids.map(async (id, i) => ({
          input: await sharp(join(uvDir, id + '_guide.png'))
            .resize(1024, 512)
            .png()
            .toBuffer(),
          left: 0,
          top: i * 512,
        })),
      ),
    )
    .png()
    .toFile(join(uvDir, 'warden-frost-painted-guide.png'));
  console.log('Wrote stacked 4×4 UV guide, Pike Warden above Frost Adept.');
} else if (command === 'process' && input) {
  const normalized = await sharp(resolve(input)).resize(1024, 1024, { fit: 'fill' }).ensureAlpha().raw().toBuffer();
  for (const [index, id] of ids.entries()) {
    let raw = Buffer.from(normalized.subarray(index * 1024 * 512 * 4, (index + 1) * 1024 * 512 * 4));
    if (torsoPatch) {
      const panels = await sharp(resolve(torsoPatch)).resize(512, 512, { fit: 'fill' }).png().toBuffer();
      const patches = await Promise.all(
        [0, 1].map(async (side) => ({
          input: await sharp(panels)
            .extract({ left: side * 256, top: index * 256, width: 256, height: 256 })
            .resize(128, 256, { fit: 'fill' })
            .png()
            .toBuffer(),
          left: 256 + side * 128,
          top: 0,
        })),
      );
      raw = await sharp(raw, { raw: { width: 1024, height: 512, channels: 4 } })
        .composite(patches)
        .raw()
        .toBuffer();
    }
    const result = splitTeamColor({ data: new Uint8ClampedArray(raw), width: 1024, height: 512 });
    if (!result.mask) throw new Error(id + ': no magenta team areas in painted sheet');
    // Painted dark magenta sometimes shifts toward wine red. Keep those folds in the
    // same team region rather than leaving a purple rim when the team turns blue.
    for (let i = 0; i < raw.length; i += 4) {
      const r = raw[i]!,
        g = raw[i + 1]!,
        b = raw[i + 2]!;
      const hi = Math.max(r, b),
        lo = Math.min(r, b);
      if (hi < 45 || lo <= g * 1.4 + 10 || Math.abs(r - b) >= hi * 0.8) continue;
      const grey = Math.min(255, Math.round((r + b) * 0.525));
      result.color.data[i] = result.color.data[i + 1] = result.color.data[i + 2] = grey;
      result.mask.data[i] = result.mask.data[i + 1] = result.mask.data[i + 2] = result.mask.data[i + 3] = 255;
    }
    const options = { raw: { width: 1024, height: 512, channels: 4 as const } };
    const color = Buffer.from(result.color.data);
    const mask = Buffer.from(result.mask.data);
    await sharp(color, options)
      .webp({ quality: 92, alphaQuality: 100 })
      .toFile(join(out, id + '_skin.webp'));
    // Opaque black outside team regions: alpha must not make filtering smear white edges.
    await sharp(mask, options)
      .flatten({ background: '#000000' })
      .webp({ lossless: true })
      .toFile(join(out, id + '_skin_team.webp'));
    const preview = Buffer.from(color);
    for (let i = 0; i < preview.length; i += 4) {
      if (!mask[i]) continue;
      preview[i] = Math.min(255, color[i]! * 0.77 * 1.75);
      preview[i + 1] = Math.min(255, color[i + 1]! * 0.165 * 1.75);
      preview[i + 2] = Math.min(255, color[i + 2]! * 0.14 * 1.75);
    }
    await sharp(preview, options)
      .png()
      .toFile(join(source, id + '_skin_preview.png'));
    // The source PNG keeps original magenta, so the same art can be processed again.
    await sharp(raw, options)
      .png()
      .toFile(join(source, id + '_painted_source.png'));
    console.log(id + ': wrote full painted atlas, team mask and Blender preview');
  }
} else {
  throw new Error('Usage: tsx models/painted-unit-skins.ts guide | process <image>');
}
