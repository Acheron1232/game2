// Terrain: height mesh in 32-unit chunks + a material plugin that paints the ground from the baked
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
/** Mountains drawn outside the playable map (game units on each side). The camera never gets there. */
export const APRON = 64;
/** Ground type index used for the outer mountains (cliff rock). */
const ROCK = GROUND_TYPES.indexOf('cliff');
/** Game units covered by one repeat of a ground tile. */
const TILE_SIZE = 4;

/** Ground type -> terrain tile file (Phase 3 sheet "textures"). */
const TILE_OF: Record<string, string> = {
  grass: 'grass_meadow_v2',
  grass_lush: 'grass_lush_meadow_v2',
  grass_dry: 'grass_dry_meadow_v2',
  dirt: 'dirt_meadow_v2',
  rough_dirt: 'rough_dirt_meadow_v2',
  temple_stone: 'temple_stone',
  sand: 'sand',
  cliff: 'cliff_face',
  water_bed: 'sand_wet',
  forest_floor: 'forest_floor_meadow_v2',
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
  private reference = import.meta.env.DEV && new URLSearchParams(location.search).has('terrainReference');

  // Read inside getCustomCode, which the base constructor already calls: so these are static.
  static cols = 384;
  static cellSize = 0.5;

  constructor(material: StandardMaterial) {
    super(material, 'TerrainSplat', 150, { TERRAINSPLAT: false, TERRAIN_REFERENCE: false });
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
    defines['TERRAIN_REFERENCE'] = this.reference;
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
  if (c.x < -6 || c.y < -6 || c.x > ${n + 6} || c.y > ${n + 6}) { return ${ROCK}; }
  let cc = clamp(c, vec2<i32>(0), vec2<i32>(${n}));
  return i32(round(textureLoad(terrainIndexSampler, cc, 0).r * 255.0));
}
#endif`,
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef TERRAINSPLAT
{
  let gp = vec2<f32>(fragmentInputs.vPositionW.x, -fragmentInputs.vPositionW.z);
  let cell = gp / ${cs} - vec2<f32>(0.5);
  let c0 = vec2<i32>(floor(cell));
  let f = smoothstep(vec2<f32>(0.0), vec2<f32>(1.0), fract(cell));
  let uv = gp / ${ts};
  let dx = dpdx(uv);
  let dy = dpdy(uv);
  let t = vec4<i32>(terrainType(c0), terrainType(c0 + vec2<i32>(1, 0)), terrainType(c0 + vec2<i32>(0, 1)), terrainType(c0 + vec2<i32>(1, 1)));
  var w = vec4<f32>((1.0-f.x)*(1.0-f.y), f.x*(1.0-f.y), (1.0-f.x)*f.y, f.x*f.y);
  // Merge equal layers before sampling: a uniform patch needs one tile read, not four.
  #ifndef TERRAIN_REFERENCE
  if (t.y == t.x) { w.x += w.y; w.y = 0.0; }
  if (t.z == t.x) { w.x += w.z; w.z = 0.0; } else if (t.z == t.y) { w.y += w.z; w.z = 0.0; }
  if (t.w == t.x) { w.x += w.w; w.w = 0.0; } else if (t.w == t.y) { w.y += w.w; w.w = 0.0; } else if (t.w == t.z) { w.z += w.w; w.w = 0.0; }
  #endif
  var ground = vec3<f32>(0.0);
  if (w.x > 0.0) { ground += textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, t.x, dx, dy).rgb * w.x; }
  if (w.y > 0.0) { ground += textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, t.y, dx, dy).rgb * w.y; }
  if (w.z > 0.0) { ground += textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, t.z, dx, dy).rgb * w.z; }
  if (w.w > 0.0) { ground += textureSampleGrad(terrainTilesSampler, terrainTilesSamplerSampler, uv, t.w, dx, dy).rgb * w.w; }
  baseColor = vec4<f32>(baseColor.rgb * ground, baseColor.a);
}
#endif`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef TERRAINSPLAT
uniform highp sampler2D terrainIndexSampler;
uniform highp sampler2DArray terrainTilesSampler;
int terrainType(ivec2 c) {
  if (c.x < -6 || c.y < -6 || c.x > ${n + 6} || c.y > ${n + 6}) return ${ROCK};
  ivec2 cc = clamp(c, ivec2(0), ivec2(${n}));
  return int(texelFetch(terrainIndexSampler, cc, 0).r * 255.0 + 0.5);
}
#endif`,
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#ifdef TERRAINSPLAT
{
  vec2 gp = vec2(vPositionW.x, -vPositionW.z);
  vec2 cell = gp / ${cs} - 0.5;
  ivec2 c0 = ivec2(floor(cell));
  vec2 f = smoothstep(vec2(0.0), vec2(1.0), fract(cell));
  vec2 uv = gp / ${ts};
  vec2 dx = dFdx(uv), dy = dFdy(uv);
  ivec4 t = ivec4(terrainType(c0), terrainType(c0 + ivec2(1, 0)), terrainType(c0 + ivec2(0, 1)), terrainType(c0 + ivec2(1, 1)));
  vec4 w = vec4((1.0-f.x)*(1.0-f.y), f.x*(1.0-f.y), (1.0-f.x)*f.y, f.x*f.y);
  #ifndef TERRAIN_REFERENCE
  if (t.y == t.x) { w.x += w.y; w.y = 0.0; }
  if (t.z == t.x) { w.x += w.z; w.z = 0.0; } else if (t.z == t.y) { w.y += w.z; w.z = 0.0; }
  if (t.w == t.x) { w.x += w.w; w.w = 0.0; } else if (t.w == t.y) { w.y += w.w; w.w = 0.0; } else if (t.w == t.z) { w.z += w.w; w.w = 0.0; }
  #endif
  vec3 ground = vec3(0.0);
  // Explicit gradients keep mip selection correct inside non-uniform branches.
  if (w.x > 0.0) ground += textureGrad(terrainTilesSampler, vec3(uv, float(t.x)), dx, dy).rgb * w.x;
  if (w.y > 0.0) ground += textureGrad(terrainTilesSampler, vec3(uv, float(t.y)), dx, dy).rgb * w.y;
  if (w.z > 0.0) ground += textureGrad(terrainTilesSampler, vec3(uv, float(t.z)), dx, dy).rgb * w.z;
  if (w.w > 0.0) ground += textureGrad(terrainTilesSampler, vec3(uv, float(t.w)), dx, dy).rgb * w.w;
  baseColor.rgb *= ground;
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
  bmp.close();
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

  // ---- height at vertices (every 1 unit), smoothed from the cell levels. The mesh also covers an
  // apron of APRON units around the map: rising mountains that close the world off.
  const VN = size + 1 + 2 * APRON;
  const heights = new Float32Array(VN * VN);
  const cellHeight = (x: number, y: number) => {
    let sum = 0,
      cnt = 0,
      water = false,
      high = false;
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        for (const off of [0.25, 0.75]) {
          const i = terrainCellAt(grid, x + dx + off, y + dy + off);
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
    if (!high) h += (hash2(x, y) - 0.5) * 0.16; // gentle bumps on the low ground
    return h;
  };
  for (let vy = 0; vy < VN; vy++) {
    for (let vx = 0; vx < VN; vx++) {
      const x = vx - APRON,
        y = vy - APRON;
      const out = Math.max(-x, -y, x - size, y - size);
      if (out <= 0) {
        heights[vy * VN + vx] = cellHeight(x, y);
      } else {
        // Mountains: the border height plus a steep rise with big rocky bumps.
        const ex = Math.max(0, Math.min(size, x)),
          ey = Math.max(0, Math.min(size, y));
        const base = cellHeight(ex, ey);
        const ridge = 0.5 + 0.5 * Math.sin(x * 0.11 + Math.cos(y * 0.07) * 2) * Math.cos(y * 0.09 + x * 0.03);
        heights[vy * VN + vx] =
          base + out * (0.55 + 0.35 * ridge) + Math.min(out, 12) * (hash2(x, y) - 0.5) * 0.35 + (out > 10 ? (ridge - 0.5) * 8 : 0);
      }
    }
  }
  const heightAt = (x: number, y: number) => {
    const fx = Math.max(-APRON, Math.min(size + APRON - 1e-3, x)) + APRON,
      fy = Math.max(-APRON, Math.min(size + APRON - 1e-3, y)) + APRON;
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
  const tileSize = 256;
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

  // ---- chunks (the apron chunks are the mountains)
  const chunks: Mesh[] = [];
  const per = (size + 2 * APRON) / CHUNK;
  for (let cy = 0; cy < per; cy++) {
    for (let cx = 0; cx < per; cx++) {
      const n = CHUNK + 1;
      const pos = new Float32Array(n * n * 3);
      const nor = new Float32Array(n * n * 3);
      const col = new Float32Array(n * n * 4);
      const idx = new Uint32Array(CHUNK * CHUNK * 6);
      for (let j = 0; j < n; j++) {
        for (let i = 0; i < n; i++) {
          const vx = cx * CHUNK + i,
            vy = cy * CHUNK + j;
          const gx = vx - APRON,
            gy = vy - APRON;
          const k = j * n + i;
          const h = heights[vy * VN + vx]!;
          pos.set([gx, h, -gy], k * 3);
          const hl = heights[vy * VN + Math.max(0, vx - 1)]!,
            hr = heights[vy * VN + Math.min(VN - 1, vx + 1)]!;
          const hd = heights[Math.max(0, vy - 1) * VN + vx]!,
            hu = heights[Math.min(VN - 1, vy + 1) * VN + vx]!;
          // Normal of the height field (world z is -game y, so the z part flips).
          const nx = hl - hr,
            nz = hu - hd,
            ny = 2;
          const len = Math.hypot(nx, ny, nz);
          nor.set([nx / len, ny / len, nz / len], k * 3);
          // Painted light: forests darker, hollows darker, hill tops lighter (fake ambient occlusion).
          const ci = terrainCellAt(grid, gx, gy);
          const forest = ci >= 0 && ((grid.flags[ci] ?? 0) & TerrainFlag.Forest) !== 0;
          const around = (hl + hr + hd + hu) / 4;
          const cavity = Math.max(-0.18, Math.min(0.12, (h - around) * 0.9));
          // Broad color variation breaks tile repetition without another per-pixel texture read.
          const macro = Math.sin(gx * 0.12) * Math.cos(gy * 0.09) + Math.sin(gx * 0.04 + gy * 0.07) * 0.5;
          const shade = (forest ? 0.82 : 1) * (0.98 + 0.035 * macro) * (1 + cavity);
          const meadow = ci >= 0 && (grid.ground[ci] ?? ROCK) < 2;
          // Keep the new, quieter meadow green and readable under the warm sun.
          col.set([shade * (meadow ? 1.04 : 1), shade * (meadow ? 1.24 : 1), shade * (meadow ? 1.08 : 0.98), 1], k * 4);
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
    // Water surface a bit below the lowest point of the shore around the lake.
    let shore = Infinity;
    for (let k = 0; k < 24; k++) {
      const a = (k / 24) * Math.PI * 2;
      shore = Math.min(shore, heightAt(x + Math.cos(a) * (w.radii[0] + 1.5), y + Math.sin(a) * (w.radii[1] + 1.5)));
    }
    disc.position.set(x, pool ? LEVEL_HEIGHT * 0.92 : shore - 0.35, -y);
    disc.material = waterMat;
    disc.isPickable = false;
    disc.freezeWorldMatrix();
    water.push(disc);
  }

  return { heightAt, chunks, water, material };
}
