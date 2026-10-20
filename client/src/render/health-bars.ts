// Health (and hero mana) bars above units, drawn in 3D: three thin-instanced quads (dark back,
// health fill, mana fill), one draw call each. Updated every frame without new objects.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

export interface BarInput {
  x: number;
  /** world height of the bar's center */
  y: number;
  z: number;
  /** 0..1 */
  hp: number;
  /** 0..1, or -1 for no mana bar */
  mana: number;
  hero: boolean;
  /** fill color, like '#3fd93a' */
  color: string;
}

const HERO_W = 1.5,
  UNIT_W = 1.0,
  HP_H = 0.15,
  MANA_H = 0.08;

class Layer {
  readonly mesh: Mesh;
  private matrices = new Float32Array(16 * 64);
  count = 0;

  constructor(scene: Scene, name: string, color: Color3, order: number) {
    this.mesh = CreatePlane(name, { size: 1 }, scene);
    const mat = new StandardMaterial(name, scene);
    mat.disableLighting = true;
    mat.emissiveColor = color;
    mat.backFaceCulling = false;
    // Always on top of the world, but under the HTML HUD.
    mat.depthFunction = Constants.ALWAYS;
    mat.disableDepthWrite = true;
    // Drawn in the transparent pass, so alphaIndex keeps the order: back, health, mana.
    mat.alpha = 0.99;
    this.mesh.material = mat;
    this.mesh.isPickable = false;
    this.mesh.renderingGroupId = 1;
    this.mesh.alphaIndex = order;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.thinInstanceCount = 0;
    this.mesh.setEnabled(false);
  }

  reserve(n: number): void {
    if (n * 16 <= this.matrices.length) return;
    const size = Math.max(n, (this.matrices.length / 16) * 2);
    const m = new Float32Array(size * 16);
    m.set(this.matrices);
    this.matrices = m;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
  }

  put(m: Matrix): void {
    m.copyToArray(this.matrices, this.count * 16);
    this.count++;
  }

  flush(): void {
    // Zero thin instances would draw the source quad at the world origin.
    this.mesh.setEnabled(this.count > 0);
    this.mesh.thinInstanceCount = this.count;
    this.mesh.thinInstanceBufferUpdated('matrix');
    this.count = 0;
  }
}

export class HealthBars {
  private readonly back: Layer;
  /** one health layer per color (own, neutral, enemy, ally team colors) */
  private readonly fills = new Map<string, Layer>();
  private readonly mana: Layer;
  private readonly scene: Scene;
  private readonly rot = new Quaternion();
  private readonly m = new Matrix();
  private readonly scale = new Vector3();
  private readonly pos = new Vector3();
  /** the bar's own "up" in the world: tilted back toward the camera */
  private readonly up = new Vector3();

  constructor(
    scene: Scene,
    /** camera tilt from vertical (beta), the bars face the camera */
    tilt: number,
  ) {
    this.scene = scene;
    this.back = new Layer(scene, 'bar-back', new Color3(0.05, 0.04, 0.03), 0);
    this.mana = new Layer(scene, 'bar-mana', new Color3(0.25, 0.5, 1), 2);
    // The RTS camera looks north (-z) from above and never turns: one fixed rotation (lean the
    // quad back by 90° - tilt) makes every bar face it.
    Quaternion.FromEulerAnglesToRef(-(Math.PI / 2 - tilt), 0, 0, this.rot);
    this.up.set(0, Math.sin(tilt), -Math.cos(tilt));
  }

  update(bars: readonly BarInput[], count: number): void {
    this.back.reserve(count);
    this.mana.reserve(count);
    for (let i = 0; i < count; i++) {
      const b = bars[i]!;
      const w = b.hero ? HERO_W : UNIT_W;
      const withMana = b.mana >= 0;
      const h = HP_H + (withMana ? MANA_H + 0.02 : 0);
      this.quad(this.back, b.x, b.y, b.z, w + 0.06, h + 0.06, 0, 0);
      const hp = Math.max(0, Math.min(1, b.hp));
      const top = withMana ? (h - HP_H) / 2 : 0;
      // Fill grows from the left: shift its center by half of what is missing.
      this.quad(this.fillLayer(b.color, count), b.x, b.y, b.z, w * hp, HP_H, -(w * (1 - hp)) / 2, top);
      if (withMana) {
        const mp = Math.max(0, Math.min(1, b.mana));
        this.quad(this.mana, b.x, b.y, b.z, w * mp, MANA_H, -(w * (1 - mp)) / 2, top - HP_H / 2 - MANA_H / 2 - 0.02);
      }
    }
    this.back.flush();
    for (const f of this.fills.values()) f.flush();
    this.mana.flush();
  }

  private fillLayer(color: string, count: number): Layer {
    let f = this.fills.get(color);
    if (!f) this.fills.set(color, (f = new Layer(this.scene, `bar-hp-${color}`, Color3.FromHexString(color), 1)));
    f.reserve(count);
    return f;
  }

  private quad(layer: Layer, x: number, y: number, z: number, w: number, h: number, dx: number, dy: number): void {
    this.scale.set(Math.max(0.0001, w), h, 1);
    this.pos.set(x + dx, y + dy * this.up.y, z + dy * this.up.z);
    Matrix.ComposeToRef(this.scale, this.rot, this.pos, this.m);
    layer.put(this.m);
  }

  dispose(): void {
    for (const layer of [this.back, this.mana, ...this.fills.values()]) layer.mesh.dispose(false, true);
    this.fills.clear();
  }
}
