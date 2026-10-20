import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { Constants } from '@babylonjs/core/Engines/constants';
import type { Material } from '@babylonjs/core/Materials/material';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { Observer } from '@babylonjs/core/Misc/observable';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { Scene } from '@babylonjs/core/scene';

export interface FogGrid {
  cols: number;
  cell: number;
  visible: Uint8Array;
  explored: Uint8Array;
}

export const FOG_VISIBLE_BRIGHTNESS = 1;
export const FOG_EXPLORED_BRIGHTNESS = 0.45;
export const FOG_HIDDEN_BRIGHTNESS = 0.25;

const FADE_SECONDS = 0.3;
const GLSL = 0;
const WGSL = 1;

/** Returns the light level for one fog cell. Visible takes priority over explored. */
export function fogBrightness(visible: number, explored: number): number {
  if (visible !== 0) return FOG_VISIBLE_BRIGHTNESS;
  return explored !== 0 ? FOG_EXPLORED_BRIGHTNESS : FOG_HIDDEN_BRIGHTNESS;
}

/** Moves values by at most maxStep and snaps them exactly onto their targets. */
export function fadeFogValues(current: Float32Array, target: Float32Array, maxStep: number): boolean {
  if (current.length !== target.length) throw new RangeError('Fog fade arrays must have the same length.');
  if (!(maxStep > 0)) return false;
  let changed = false;
  for (let i = 0; i < current.length; i++) {
    const from = current[i]!;
    const to = target[i]!;
    if (from === to) continue;
    const delta = to - from;
    current[i] = Math.abs(delta) <= maxStep ? to : from + Math.sign(delta) * maxStep;
    changed = true;
  }
  return changed;
}

/** Builds a top-down black alpha mask. Grid row 0 is written to the bottom canvas row. */
export function buildFogOverlayPixels(grid: FogGrid, out?: Uint8ClampedArray): Uint8ClampedArray {
  const cells = grid.cols * grid.cols;
  if (grid.visible.length < cells || grid.explored.length < cells) throw new RangeError('Fog grid data is too small.');
  const pixels = out ?? new Uint8ClampedArray(cells * 4);
  if (pixels.length !== cells * 4) throw new RangeError('Fog overlay output has the wrong size.');
  for (let y = 0; y < grid.cols; y++) {
    const sourceRow = y * grid.cols;
    const outputRow = (grid.cols - 1 - y) * grid.cols;
    for (let x = 0; x < grid.cols; x++) {
      const source = sourceRow + x;
      const output = (outputRow + x) * 4;
      pixels[output] = 0;
      pixels[output + 1] = 0;
      pixels[output + 2] = 0;
      pixels[output + 3] = Math.round((1 - fogBrightness(grid.visible[source]!, grid.explored[source]!)) * 255);
    }
  }
  return pixels;
}

interface FogPluginState {
  readonly texture: RawTexture;
  readonly mapSize: number;
  enabled: boolean;
}

class FogMaterialPlugin extends MaterialPluginBase {
  constructor(
    material: StandardMaterial,
    private readonly state: FogPluginState,
  ) {
    super(material, 'FogOfWar', 300);
    this._enable(true);
  }

  override getClassName(): string {
    return 'FogMaterialPlugin';
  }

  override isCompatible(shaderLanguage: number): boolean {
    return shaderLanguage === GLSL || shaderLanguage === WGSL;
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('fogSampler');
  }

  override getUniforms(shaderLanguage?: number) {
    return {
      ubo: [
        { name: 'fogEnabled', size: 1, type: 'float' },
        { name: 'fogMapSize', size: 1, type: 'float' },
      ],
      fragment: shaderLanguage === WGSL ? '' : 'uniform float fogEnabled;\nuniform float fogMapSize;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat('fogEnabled', this.state.enabled ? 1 : 0);
    uniformBuffer.updateFloat('fogMapSize', this.state.mapSize);
    uniformBuffer.setTexture('fogSampler', this.state.texture);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: number): Record<string, string> | null {
    if (shaderType !== 'fragment') return null;
    if (shaderLanguage === WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS: 'var fogSamplerSampler: sampler;\nvar fogSampler: texture_2d<f32>;',
        CUSTOM_FRAGMENT_BEFORE_FOG: `
if (uniforms.fogEnabled > 0.5) {
  let fogUv = vec2f(fragmentInputs.vPositionW.x, -fragmentInputs.vPositionW.z) / uniforms.fogMapSize;
  let sampledFog = textureSample(fogSampler, fogSamplerSampler, clamp(fogUv, vec2f(0.0), vec2f(1.0))).r;
  let insideFog = all(fogUv >= vec2f(0.0)) && all(fogUv <= vec2f(1.0));
  let fogLight = select(${FOG_EXPLORED_BRIGHTNESS}, sampledFog, insideFog);
  let fogGrey = dot(color.rgb, vec3f(0.299, 0.587, 0.114));
  let fogDesaturate = clamp((1.0 - fogLight) * 0.32, 0.0, 0.25);
  color = vec4f(mix(color.rgb, vec3f(fogGrey), fogDesaturate) * fogLight, color.a);
}`,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS: 'uniform sampler2D fogSampler;',
      CUSTOM_FRAGMENT_BEFORE_FOG: `
if (fogEnabled > 0.5) {
  vec2 fogUv = vec2(vPositionW.x, -vPositionW.z) / fogMapSize;
  float sampledFog = texture2D(fogSampler, clamp(fogUv, vec2(0.0), vec2(1.0))).r;
  bool insideFog = all(greaterThanEqual(fogUv, vec2(0.0))) && all(lessThanEqual(fogUv, vec2(1.0)));
  float fogLight = insideFog ? sampledFog : ${FOG_EXPLORED_BRIGHTNESS};
  float fogGrey = dot(color.rgb, vec3(0.299, 0.587, 0.114));
  float fogDesaturate = clamp((1.0 - fogLight) * 0.32, 0.0, 0.25);
  color.rgb = mix(color.rgb, vec3(fogGrey), fogDesaturate) * fogLight;
}`,
    };
  }
}

export class FogOfWar {
  private readonly state: FogPluginState;
  private readonly current: Float32Array;
  private readonly target: Float32Array;
  private readonly upload: Uint8Array;
  private readonly attached = new WeakSet<StandardMaterial>();
  private materialObserver: Observer<Material> | null = null;

  constructor(
    private readonly scene: Scene,
    mapSize: number,
    private readonly cols: number,
  ) {
    if (!(mapSize > 0) || !Number.isInteger(cols) || cols <= 0) throw new RangeError('Fog size must be positive.');
    const cells = cols * cols;
    this.current = new Float32Array(cells);
    this.current.fill(FOG_VISIBLE_BRIGHTNESS);
    this.target = new Float32Array(cells);
    this.target.fill(FOG_VISIBLE_BRIGHTNESS);
    this.upload = new Uint8Array(cells);
    this.upload.fill(255);
    const texture = new RawTexture(
      this.upload,
      cols,
      cols,
      Constants.TEXTUREFORMAT_R,
      scene,
      false,
      false,
      Texture.BILINEAR_SAMPLINGMODE,
      Constants.TEXTURETYPE_UNSIGNED_BYTE,
    );
    texture.wrapU = Texture.CLAMP_ADDRESSMODE;
    texture.wrapV = Texture.CLAMP_ADDRESSMODE;
    this.state = { texture, mapSize, enabled: true };
  }

  /** Adds the fog to one material. Safe to call more than once. */
  attach(material: StandardMaterial): void {
    if (this.attached.has(material)) return;
    this.attached.add(material);
    new FogMaterialPlugin(material, this.state);
  }

  /** Adds the fog to current materials and watches materials made later. */
  attachAll(): void {
    for (const material of this.scene.materials) if (material instanceof StandardMaterial) this.attach(material);
    if (this.materialObserver) return;
    this.materialObserver = this.scene.onNewMaterialAddedObservable.add((material) => {
      if (material instanceof StandardMaterial) this.attach(material);
    });
  }

  setGrid(grid: FogGrid): void {
    const cells = this.cols * this.cols;
    if (grid.cols !== this.cols || grid.visible.length < cells || grid.explored.length < cells) {
      throw new RangeError('Fog grid does not match the renderer size.');
    }
    for (let i = 0; i < cells; i++) this.target[i] = fogBrightness(grid.visible[i]!, grid.explored[i]!);
  }

  update(dt: number): void {
    if (!fadeFogValues(this.current, this.target, (Math.max(0, dt) / FADE_SECONDS) * (FOG_VISIBLE_BRIGHTNESS - FOG_HIDDEN_BRIGHTNESS)))
      return;
    for (let i = 0; i < this.upload.length; i++) this.upload[i] = Math.round(this.current[i]! * 255);
    this.state.texture.update(this.upload);
  }

  /** Everything seen (after a match): no fade, at once. */
  clear(): void {
    this.target.fill(FOG_VISIBLE_BRIGHTNESS);
    this.current.fill(FOG_VISIBLE_BRIGHTNESS);
    this.upload.fill(255);
    this.state.texture.update(this.upload);
  }

  setEnabled(on: boolean): void {
    this.state.enabled = on;
  }

  dispose(): void {
    if (this.materialObserver) {
      this.scene.onNewMaterialAddedObservable.remove(this.materialObserver);
      this.materialObserver = null;
    }
    this.state.texture.dispose();
  }
}
