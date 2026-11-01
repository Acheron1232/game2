// Water surfaces over the map's pools: a see-through teal surface just under the rim, with two
// layers of small waves (one normal map moving two ways) that catch the sun. The pool bottom is
// the terrain itself, so the edge follows the real shore.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { MapLayout } from '@game/shared';

/** Tileable small waves as a normal map (sum of sines on whole periods, so it repeats cleanly). */
function waveNormals(scene: Scene): RawTexture {
  const N = 128;
  const waves = [
    [1, 2, 0.5, 0.3],
    [3, -1, 0.25, 1.7],
    [-2, 3, 0.2, 2.9],
    [5, 4, 0.1, 0.8],
    [-6, 5, 0.08, 4.1],
  ] as const;
  const h = (x: number, y: number) => {
    let v = 0;
    for (const [kx, ky, a, p] of waves) v += a * Math.sin(((kx * x + ky * y) / N) * Math.PI * 2 + p);
    return v;
  };
  const data = new Uint8Array(N * N * 4);
  const s = 2.2;
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      const dx = (h(x + 1, y) - h(x - 1, y)) * s,
        dy = (h(x, y + 1) - h(x, y - 1)) * s;
      const l = Math.hypot(dx, dy, 1);
      const o = (y * N + x) * 4;
      data[o] = Math.round((-dx / l) * 127 + 128);
      data[o + 1] = Math.round((-dy / l) * 127 + 128);
      data[o + 2] = Math.round((1 / l) * 127 + 128);
      data[o + 3] = 255;
    }
  const t = new RawTexture(data, N, N, Constants.TEXTUREFORMAT_RGBA, scene, true, false, Texture.TRILINEAR_SAMPLINGMODE);
  t.wrapU = t.wrapV = Texture.WRAP_ADDRESSMODE;
  return t;
}

/** Water surface under the shore (game units). */
const WATER_BELOW_SHORE = 0.14;

export function createWater(scene: Scene, layout: MapLayout, heightAt: (x: number, y: number) => number): Mesh[] {
  if (!layout.water.length) return [];
  const mat = new StandardMaterial('water', scene);
  mat.diffuseColor = new Color3(0.07, 0.24, 0.3);
  mat.emissiveColor = new Color3(0.02, 0.07, 0.09);
  mat.specularColor = new Color3(0.55, 0.52, 0.45);
  mat.specularPower = 180;
  mat.alpha = 0.84;
  const bump = waveNormals(scene);
  bump.uScale = bump.vScale = 4;
  bump.level = 0.45;
  mat.bumpTexture = bump;
  mat.backFaceCulling = false;
  const meshes = layout.water.map((w, i) => {
    const [cx, cy] = w.center;
    const r = Math.max(w.radii[0], w.radii[1]) + 1.5;
    // The surface sits a little under the lowest point of the shore around the pool, so the
    // edge is where the ground rises through it.
    let shore = Infinity;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      shore = Math.min(shore, heightAt(cx + Math.cos(a) * (r + 1), cy + Math.sin(a) * (r + 1)));
    }
    const mesh = CreateDisc(`water-${i}`, { radius: r, tessellation: 40 }, scene);
    mesh.rotation.x = Math.PI / 2;
    mesh.scaling.y = w.radii[1] / w.radii[0] || 1;
    mesh.rotation.y = ((w.rotationDeg ?? 0) * Math.PI) / 180;
    mesh.position.set(cx, Math.max(heightAt(cx, cy) + 0.1, shore - WATER_BELOW_SHORE), -cy);
    mesh.material = mat;
    mesh.isPickable = false;
    return mesh;
  });
  // Waves drift slowly; the one map moves two ways, which reads as small crossing waves.
  const start = performance.now();
  scene.onBeforeRenderObservable.add(() => {
    const t = (performance.now() - start) / 1000;
    bump.uOffset = (t * 0.018) % 1;
    bump.vOffset = (Math.sin(t * 0.21) * 0.06 + t * 0.011) % 1;
  });
  return meshes;
}
