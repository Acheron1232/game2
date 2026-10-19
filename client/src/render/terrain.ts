// Terrain: height mesh in 6 x 6 chunks + a material plugin that paints the ground from the baked
// grid. Every 0.5 unit cell has a ground type; the shader blends the 4 nearest cells' tile
// textures (a texture array of the Phase 3 terrain tiles), so edges between ground types are soft.
//
// World axes (right-handed scene): x = game x (east), y = up, z = -game y (north is -z).

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Constants } from '@babylonjs/core/Engines/constants';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { RawTexture2DArray } from '@babylonjs/core/Materials/Textures/rawTexture2DArray';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { Scene } from '@babylonjs/core/scene';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { GROUND_TYPES, TerrainFlag, terrainCellAt, terrainLevel, type MapLayout, type TerrainGrid } from '@game/shared';
import type { GameAssets } from '../loader/assets';

/** World height of one terrain level (ground 0 -> temple top 1). */
export const LEVEL_HEIGHT = 2.2;
const CHUNK = 32;
/** Game units covered by one repeat of a ground tile. */
const TILE_SIZE = 4;

/** Ground type -> terrain tile file (Phase 3 sheet "textures"). */
const TILE_OF: Record<string, string> = {
  grass: 'grass',
  grass_lush: 'grass_lush',
  grass_dry: 'grass_dry',
  dirt: 'dirt',
  rough_dirt: 'rough_dirt',
  temple_stone: 'temple_stone',
  sand: 'sand',
  cliff: 'cliff_face',
  water_bed: 'sand_wet',
  forest_floor: 'forest_floor',
};

export interface Terrain {
  /** World height at a game position. */
  heightAt(x: number, y: number): number;
  chunks: Mesh[];
  water: Mesh[];
  material: StandardMaterial;
}

const GLSL = 0;
const WGSL = 1;

class TerrainSplatPlugin extends MaterialPluginBase {
  index: RawTexture | null = null;
  tiles: RawTexture2DArray | null = null;

  // Read inside getCustomCode, which the base constructor already calls: so these are static.
  static cols = 384;
  static cellSize = 0.5;

  constructor(material: StandardMaterial) {
    super(material, 'TerrainSplat', 150, { TERRAINSPLAT: false });
    this._enable(true);
  }

  override getClassName(): string {
    return 'TerrainSplatPlugin';
  }

  override isCompatible(lang: number): boolean {
    return lang === GLSL || lang === WGSL;
  }

  override prepareDefines(defines: Record<string, unknown>): void {
    defines['TERRAINSPLAT'] = !!(this.index && this.tiles);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('terrainIndexSampler', 'terrainTilesSampler');
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _sub: SubMesh): void {
    if (!this.index || !this.tiles) return;
    ubo.setTexture('terrainIndexSampler', this.index);
    ubo.setTexture('terrainTilesSampler', this.tiles);
  }

  override getCustomCode(shaderType: string, lang?: number): Record<string, string> | null {
    if (shaderType !== 'fragment') return null;
    const n = TerrainSplatPlugin.cols - 1;
    const cs = TerrainSplatPlugin.cellSize.toFixed(4);
    const ts = TILE_SIZE.toFixed(4);
    if (lang === WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TERRAINSPLAT
var terrainIndexSamplerSampler: sampler;
var terrainIndexSampler: texture_2d<f32>;
var terrainTilesSamplerSampler: sampler;
var terrainTilesSampler: texture_2d_array<f32>;
fn terrainType(c: vec2<i32>) -> i32 {
  let cc = clamp(c, vec2<i32>(0), vec2<i32>(${n}));
  return i32(round(textureLoad(terrainIndexSampler, cc, 0).r * 255.0));
}
#endif`,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef TERRAINSPLAT
{
  let gp = vec2<f32>(fragmentInputs.vPositionW.x, -fragmentInputs.vPositionW.z);
  let cell = gp / ${cs} - vec2<f32>(0.5);
  let c0 = vec2<i32>(floor(cell));
  let f = smoothstep(vec2<f32>(0.15), vec2<f32>(0.85), fract(cell));
  let uv = gp / ${ts};
  let dx = dpdx(uv);
  let dy = dpdy(uv);
  let a = textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, terrainType(c0), dx, dy).rgb;
  let b = textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, terrainType(c0 + vec2<i32>(1, 0)), dx, dy).rgb;
  let c = textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, terrainType(c0 + vec2<i32>(0, 1)), dx, dy).rgb;
  let d = textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, terrainType(c0 + vec2<i32>(1, 1)), dx, dy).rgb;
  baseColor = vec4<f32>(baseColor.rgb * mix(mix(a, b, f.x), mix(c, d, f.x), f.y), baseColor.a);
}
#endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TERRAINSPLAT
uniform highp sampler2D terrainIndexSampler;
uniform highp sampler2DArray terrainTilesSampler;
int terrainType(ivec2 c) {
  ivec2 cc = clamp(c, ivec2(0), ivec2(${n}));
  return int(texelFetch(terrainIndexSampler, cc, 0).r * 255.0 + 0.5);
}
#endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef TERRAINSPLAT
{
  vec2 gp = vec2(vPositionW.x, -vPositionW.z);
  vec2 cell = gp / ${cs} - 0.5;
  ivec2 c0 = ivec2(floor(cell));
  vec2 f = smoothstep(vec2(0.15), vec2(0.85), fract(cell));
  vec2 uv = gp / ${ts};
  vec3 a = texture(terrainTilesSampler, vec3(uv, float(terrainType(c0)))).rgb;
  vec3 b = texture(terrainTilesSampler, vec3(uv, float(terrainType(c0 + ivec2(1, 0))))).rgb;
  vec3 c = texture(terrainTilesSampler, vec3(uv, float(terrainType(c0 + ivec2(0, 1))))).rgb;
  vec3 d = texture(terrainTilesSampler, vec3(uv, float(terrainType(c0 + ivec2(1, 1))))).rgb;
  baseColor.rgb *= mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
#endif`,
    };
  }
}

async function decodeTile(url: string, size: number): Promise<Uint8ClampedArray> {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bmp, 0, 0, size, size);
  return ctx.getImageData(0, 0, size, size).data;
}

/** Small stable noise for height and color variation. */
function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

export async function createTerrain(scene: Scene, grid: TerrainGrid, layout: MapLayout, assets: GameAssets): Promise<Terrain> {
  const size = grid.cols * grid.cellSize;

  // ---- height at grid vertices (every 1 unit), smoothed from the cell levels
  const VN = size + 1;
  const heights = new Float32Array(VN * VN);
  for (let vy = 0; vy < VN; vy++) {
    for (let vx = 0; vx < VN; vx++) {
      let sum = 0,
        cnt = 0,
        water = false,
        high = false;
      for (let dy = -1; dy <= 0; dy++) {
        for (let dx = -1; dx <= 0; dx++) {
          for (const off of [0.25, 0.75]) {
            const i = terrainCellAt(grid, vx + dx + off, vy + dy + off);
            if (i < 0) continue;
            sum += terrainLevel(grid, i);
            cnt++;
            const f = grid.flags[i] ?? 0;
            if (f & TerrainFlag.Water) water = true;
            if (f & (TerrainFlag.High | TerrainFlag.Cliff)) high = true;
          }
        }
      }
      let h = cnt ? (sum / cnt) * LEVEL_HEIGHT : 0;
      if (water) h -= 0.25;
      if (!high) h += (hash2(vx, vy) - 0.5) * 0.18; // gentle bumps on the low ground
      heights[vy * VN + vx] = h;
    }
  }
  const heightAt = (x: number, y: number) => {
    const fx = Math.max(0, Math.min(size - 1e-3, x)),
      fy = Math.max(0, Math.min(size - 1e-3, y));
    const x0 = Math.floor(fx),
      y0 = Math.floor(fy);
    const tx = fx - x0,
      ty = fy - y0;
    const h00 = heights[y0 * VN + x0]!,
      h10 = heights[y0 * VN + x0 + 1]!,
      h01 = heights[(y0 + 1) * VN + x0]!,
      h11 = heights[(y0 + 1) * VN + x0 + 1]!;
    return h00 * (1 - tx) * (1 - ty) + h10 * tx * (1 - ty) + h01 * (1 - tx) * ty + h11 * tx * ty;
  };

  // ---- material: textures
  const tileSize = 128;
  const layers = GROUND_TYPES.length;
  const tileData = new Uint8Array(tileSize * tileSize * 4 * layers);
  await Promise.all(
    GROUND_TYPES.map(async (g, k) => {
      const px = await decodeTile(assets.url(`terrain/${TILE_OF[g]}.webp`), tileSize);
      tileData.set(px, k * tileSize * tileSize * 4);
    }),
  );
  const tiles = new RawTexture2DArray(
    tileData,
    tileSize,
    tileSize,
    layers,
    Constants.TEXTUREFORMAT_RGBA,
    scene,
    true,
    false,
    Texture.TRILINEAR_SAMPLINGMODE,
  );
  tiles.wrapU = Texture.WRAP_ADDRESSMODE;
  tiles.wrapV = Texture.WRAP_ADDRESSMODE;
  tiles.anisotropicFilteringLevel = 4;
  const index = new RawTexture(
    grid.ground,
    grid.cols,
    grid.rows,
    Constants.TEXTUREFORMAT_R,
    scene,
    false,
    false,
    Texture.NEAREST_SAMPLINGMODE,
    Constants.TEXTURETYPE_UNSIGNED_BYTE,
  );

  const material = new StandardMaterial('terrain', scene);
  material.specularColor = new Color3(0.04, 0.04, 0.04);
  TerrainSplatPlugin.cols = grid.cols;
  TerrainSplatPlugin.cellSize = grid.cellSize;
  const splat = new TerrainSplatPlugin(material);
  splat.index = index;
  splat.tiles = tiles;

  // ---- chunks
  const chunks: Mesh[] = [];
  for (let cy = 0; cy < size / CHUNK; cy++) {
    for (let cx = 0; cx < size / CHUNK; cx++) {
      const n = CHUNK + 1;
      const pos = new Float32Array(n * n * 3);
      const nor = new Float32Array(n * n * 3);
      const col = new Float32Array(n * n * 4);
      const idx = new Uint32Array(CHUNK * CHUNK * 6);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const gx = cx * CHUNK + i,
            gy = cy * CHUNK + j;
          const k = j * n + i;
          const h = heights[gy * VN + gx]!;
          pos.set([gx, h, -gy], k * 3);
          const hl = heights[gy * VN + Math.max(0, gx - 1)]!,
            hr = heights[gy * VN + Math.min(VN - 1, gx + 1)]!;
          const hd = heights[Math.max(0, gy - 1) * VN + gx]!,
            hu = heights[Math.min(VN - 1, gy + 1) * VN + gx]!;
          // Normal of the height field (world z is -game y, so the z part flips).
          const nx = hl - hr,
            nz = hu - hd,
            ny = 2;
          const len = Math.hypot(nx, ny, nz);
          nor.set([nx / len, ny / len, nz / len], k * 3);
          // Painted light: forest floor and low spots a bit darker, like baked ambient light.
          const ci = terrainCellAt(grid, gx, gy);
          const forest = ci >= 0 && ((grid.flags[ci] ?? 0) & TerrainFlag.Forest) !== 0;
          const shade = (forest ? 0.78 : 1) * (0.94 + 0.12 * hash2(gx * 3, gy * 7));
          col.set([shade, shade, shade, 1], k * 4);
        }
      }
      let t = 0;
      for (let j = 0; j < CHUNK; j++) {
        for (let i = 0; i < CHUNK; i++) {
          const a = j * n + i,
            b = a + 1,
            c = a + n,
            d = c + 1;
          idx.set([a, c, b, b, c, d], t);
          t += 6;
        }
      }
      const mesh = new Mesh(`terrain-${cx}-${cy}`, scene);
      const vd = new VertexData();
      vd.positions = pos;
      vd.normals = nor;
      vd.colors = col;
      vd.indices = idx;
      vd.applyToMesh(mesh);
      mesh.material = material;
      mesh.receiveShadows = true;
      mesh.freezeWorldMatrix();
      mesh.metadata = { terrain: true };
      chunks.push(mesh);
    }
  }

  // ---- water: one flat disc per lake or pool, a bit above the water bed
  const waterMat = new StandardMaterial('water', scene);
  const waterTex = new Texture(assets.url('terrain/water_deep.webp'), scene);
  waterTex.uScale = waterTex.vScale = 6;
  waterMat.diffuseTexture = waterTex;
  waterMat.alpha = 0.82;
  waterMat.specularColor = new Color3(0.5, 0.55, 0.6);
  waterMat.specularPower = 48;
  waterMat.emissiveColor = new Color3(0.05, 0.12, 0.16);
  scene.onBeforeRenderObservable.add(() => {
    const t = performance.now() / 1000;
    waterTex.uOffset = t * 0.01;
    waterTex.vOffset = Math.sin(t * 0.3) * 0.02;
  });
  const water: Mesh[] = [];
  for (const w of layout.water) {
    const [x, y] = w.center;
    const pool = w.tag === 'temple_pool';
    const disc = CreateDisc(`water-${w.tag}`, { radius: 1, tessellation: 28 }, scene);
    disc.rotation.x = Math.PI / 2;
    disc.scaling.set(w.radii[0] + 1.2, w.radii[1] + 1.2, 1);
    disc.rotation.y = (w.rotationDeg * Math.PI) / 180;
    disc.position.set(x, pool ? LEVEL_HEIGHT * 0.92 : -0.35, -y);
    disc.material = waterMat;
    disc.isPickable = false;
    disc.freezeWorldMatrix();
    water.push(disc);
  }

  return { heightAt, chunks, water, material };
}
