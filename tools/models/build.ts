// Builds 3D models: Blender script -> GLB -> cleaned and quantized GLB -> manifest.
//   pnpm --filter @game/tools models:build              every model in tools/models/blender/models
//   pnpm --filter @game/tools models:build tree_oak     one model
//   add --preview to also render art/source/models/<id>.png
//
// Compression: KHR_mesh_quantization (positions, normals, UVs, colors in fewer bytes). The browser
// reads it without any extra decoder. Meshopt compression can come later with a bundled decoder.

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { dedup, prune, quantize } from '@gltf-transform/functions';
import { ROOT } from '../art/lib/sheets';

const BLENDER = process.env['BLENDER'] ?? '/Applications/Blender.app/Contents/MacOS/Blender';
const MODELS_DIR = join(ROOT, 'tools', 'models', 'blender', 'models');
const OUT = join(ROOT, 'client', 'public', 'assets', 'models');
const HELPERS = new Set(['nature', 'kit', 'humanoid', 'chunky', 'rigs', 'unitkit', '_monsters', '_buildings', '_decor', '_mercs']);

const args = process.argv.slice(2);
const preview = args.includes('--preview');
const wanted = args.filter((a) => !a.startsWith('--'));
const all = readdirSync(MODELS_DIR)
  .filter((f) => f.endsWith('.py') && !HELPERS.has(f.replace('.py', '')))
  .map((f) => f.replace('.py', ''))
  .sort();
const ids = wanted.length ? wanted : all;

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
let failed = 0;
for (const id of ids) {
  const run = spawnSync(
    BLENDER,
    [
      '-b',
      '--factory-startup',
      '-P',
      join(ROOT, 'tools', 'models', 'blender', 'build_model.py'),
      '--',
      id,
      ...(preview ? ['--preview'] : []),
      ...(args.includes('--uv') ? ['--uv'] : []),
    ],
    {
      encoding: 'utf8',
    },
  );
  const line = run.stdout.split('\n').find((l) => l.startsWith('MODEL '));
  if (run.status !== 0 || !line) {
    failed++;
    console.error(
      `FAILED ${id}\n${(run.stdout + run.stderr)
        .split('\n')
        .filter((l) => /Error|Traceback|line \d+/.test(l))
        .join('\n')}`,
    );
    continue;
  }
  const path = join(OUT, `${id}.glb`);
  const before = statSync(path).size;
  const doc = await io.read(path);
  // Our game material (Babylon StandardMaterial) works in gamma space, but glTF stores vertex
  // colors as linear. Store them as sRGB, so a color picked in a model script looks the same in game.
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const col = prim.getAttribute('COLOR_0');
      if (!col) continue;
      const arr = col.getArray()!;
      // Blender writes normalized uint16 (or uint8); plain floats are possible too.
      const type = col.getComponentType();
      const max = type === 5121 ? 255 : type === 5123 ? 65535 : 1;
      const size = col.getElementSize();
      for (let i = 0; i < arr.length; i++) {
        if (size === 4 && i % 4 === 3) continue;
        const c = arr[i]! / max;
        const s = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
        arr[i] = max === 1 ? s : Math.round(s * max);
      }
    }
  }
  // The game sets the shared palette texture itself, so drop the embedded copy (UVs stay).
  for (const mat of doc.getRoot().listMaterials()) mat.setBaseColorTexture(null).setEmissiveTexture(null);
  await doc.transform(
    dedup(),
    prune({ keepAttributes: true, keepLeaves: true }),
    quantize({ quantizePosition: 14, quantizeNormal: 10, quantizeTexcoord: 12, quantizeColor: 8 }),
  );
  await io.write(path, doc);
  const root = doc.getRoot();
  const clips = root.listAnimations().map((a) => a.getName());
  const hasColors = root.listMeshes().some((m) => m.listPrimitives().some((p) => p.getAttribute('COLOR_0')));
  const hasUv = root.listMeshes().every((m) => m.listPrimitives().every((p) => p.getAttribute('TEXCOORD_0')));
  const materials = root.listMaterials().map((m) => m.getName());
  console.log(
    `${line.slice(6)} | ${(before / 1024).toFixed(0)} KB -> ${(statSync(path).size / 1024).toFixed(0)} KB | materials ${materials.join(', ')} | colors ${hasColors ? 'yes' : 'NO'} | uv ${hasUv ? 'yes' : 'NO'} | clips ${clips.join(', ') || '-'}`,
  );
  if (!hasColors || !hasUv) failed++;
}

// Model index for the game: which texture atlas each model uses, its size and effect sockets.
const index: Record<string, unknown> = {};
for (const id of all) {
  const info = join(ROOT, 'art', 'source', 'models', `${id}.json`);
  if (!existsSync(info)) continue;
  const d = JSON.parse(readFileSync(info, 'utf8')) as {
    skin?: string | null;
    height: number;
    triangles: number;
    sockets?: string[];
    clips: { name: string }[];
  };
  index[id] = {
    skin: d.skin ?? null,
    height: d.height,
    triangles: d.triangles,
    sockets: d.sockets ?? [],
    clips: d.clips.map((c) => c.name),
  };
}
writeFileSync(join(OUT, 'models.json'), JSON.stringify(index, null, 2) + '\n');

await import('../art/manifest');
if (failed) {
  console.error(`${failed} model(s) failed.`);
  process.exit(1);
}
