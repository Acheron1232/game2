// Map decor: model decor (rocks, stumps, ruins, fences...) and foliage cards (grass, flowers,
// ferns, reeds...) as thin instances. One draw call per decor type. Nothing here blocks movement.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Material } from '@babylonjs/core/Materials/material';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';
import type { GameAssets } from '../loader/assets';
import { scatterInstances } from './instancing';
import type { ModelLibrary } from './model-library';

export type DecorItem = [number, number, number, number, number];

/** Decor types drawn as foliage cards: atlas cell name and card size [width, height]. */
const CARDS: Record<string, { cell: string; size: [number, number]; cross: boolean }> = {
  grass: { cell: 'grass_tuft_a', size: [0.9, 0.55], cross: true },
  flowers_yellow: { cell: 'flowers_yellow', size: [0.8, 0.55], cross: true },
  flowers_blue: { cell: 'flowers_blue', size: [0.8, 0.55], cross: true },
  flowers_red: { cell: 'flowers_red', size: [0.8, 0.55], cross: true },
  fern: { cell: 'fern', size: [1.1, 0.8], cross: true },
  mushrooms: { cell: 'mushrooms', size: [0.6, 0.4], cross: true },
  reeds: { cell: 'reeds', size: [0.9, 1.3], cross: true },
  pebbles: { cell: 'pebbles', size: [0.9, 0.9], cross: false },
};

interface Atlas {
  width: number;
  height: number;
  rects: Record<string, { x: number; y: number; w: number; h: number }>;
}

/** Two crossed quads (or one flat quad on the ground) with UVs of one atlas cell. */
function cardMesh(name: string, scene: Scene, rect: Atlas['rects'][string], size: [number, number], cross: boolean): Mesh {
  const [w, h] = size;
  const u0 = rect.x,
    u1 = rect.x + rect.w,
    v0 = rect.y + rect.h,
    v1 = rect.y;
  const pos: number[] = [],
    uv: number[] = [],
    nor: number[] = [],
    idx: number[] = [];
  const quad = (ax: number, az: number) => {
    const b = pos.length / 3;
    if (cross) {
      pos.push(
        (-ax * w) / 2,
        0,
        (-az * w) / 2,
        (ax * w) / 2,
        0,
        (az * w) / 2,
        (ax * w) / 2,
        h,
        (az * w) / 2,
        (-ax * w) / 2,
        h,
        (-az * w) / 2,
      );
      // Normals point up, so cards are lit like the ground around them (no dark backsides).
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    } else {
      pos.push(-w / 2, 0.04, -h / 2, w / 2, 0.04, -h / 2, w / 2, 0.04, h / 2, -w / 2, 0.04, h / 2);
      nor.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    uv.push(u0, v0, u1, v0, u1, v1, u0, v1);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  quad(1, 0);
  if (cross) quad(0, 1);
  const mesh = new Mesh(name, scene);
  const vd = new VertexData();
  vd.positions = pos;
  vd.normals = nor;
  vd.uvs = uv;
  vd.indices = idx;
  vd.applyToMesh(mesh);
  return mesh;
}

export async function createDecor(
  scene: Scene,
  items: DecorItem[],
  types: string[],
  heightAt: (x: number, y: number) => number,
  library: ModelLibrary,
  assets: GameAssets,
): Promise<Mesh[]> {
  const byType = new Map<number, DecorItem[]>();
  for (const it of items) {
    const list = byType.get(it[2]);
    if (list) list.push(it);
    else byType.set(it[2], [it]);
  }
  const meshes: Mesh[] = [];

  // Foliage cards share one alpha-tested material (no blending: cheap and no sorting).
  const atlas = (await (await fetch(assets.url('foliage/foliage.json'))).json()) as Atlas;
  const cardMat = new StandardMaterial('foliage', scene);
  const tex = new Texture(assets.url('foliage/foliage.webp'), scene, { invertY: false, forcedExtension: '.webp' });
  tex.hasAlpha = true;
  cardMat.diffuseTexture = tex;
  cardMat.useAlphaFromDiffuseTexture = true;
  cardMat.transparencyMode = Material.MATERIAL_ALPHATEST;
  cardMat.alphaCutOff = 0.45;
  cardMat.backFaceCulling = false;
  cardMat.specularColor = Color3.Black();

  const q = new Quaternion();
  const sc = new Vector3();
  const pos = new Vector3();
  const place = (list: DecorItem[], sink: number) => ({
    at: (i: number): [number, number] => [list[i]![0], list[i]![1]],
    compose: (i: number, out: Matrix) => {
      const [x, y, , s, yaw] = list[i]!;
      Quaternion.RotationAxisToRef(Vector3.Up(), (yaw * Math.PI) / 180, q);
      sc.set(s, s, s);
      pos.set(x, heightAt(x, y) - sink, -y);
      Matrix.ComposeToRef(sc, q, pos, out);
    },
  });
  for (const [typeIndex, list] of byType) {
    const type = types[typeIndex]!;
    const card = CARDS[type];
    if (card) {
      const rect = atlas.rects[card.cell];
      if (!rect) continue;
      const mesh = cardMesh(`decor-${type}`, scene, rect, card.size, card.cross);
      mesh.material = cardMat;
      const p = place(list, 0.03);
      meshes.push(...scatterInstances(mesh, list.length, p.at, p.compose));
      continue;
    }
    if (!library.ids.includes(type)) continue;
    const p = place(list, 0.05);
    for (const mesh of library.staticMeshes(type)) meshes.push(...scatterInstances(mesh, list.length, p.at, p.compose));
  }
  return meshes;
}
