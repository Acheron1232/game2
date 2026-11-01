// Ground markers while aiming an ability: the cast range around the hero, and the shape the
// ability will hit at the cursor (circle, cone, line) or a ring on the unit under the cursor.
// All are flat squares with shapes painted in code (fx-textures.ts): a dashed range ring, an
// area with a bright rim and ticks, a sector with chevrons, a lane with running arrows.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import { coneTexture, fxTexture, type FxShape } from './fx-textures';

export type AimShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'cone'; length: number; angleDeg: number }
  | { kind: 'line'; length: number; width: number }
  | { kind: 'unit' };

const GOOD = Color3.FromHexString('#9fe6ff');
const BAD = Color3.FromHexString('#ff6a5a');
/** Arrows on a line skill run toward the end this fast (texture lengths per second). */
const ARROW_SPEED = 0.9;

export class AimIndicators {
  private readonly range: Mesh;
  private readonly circle: Mesh;
  private readonly line: Mesh;
  private readonly cone: Mesh;
  private readonly unitRing: Mesh;
  private readonly mats: StandardMaterial[] = [];
  private readonly coneMat: StandardMaterial;
  private readonly lineTex: Texture;
  private readonly meshes: Mesh[];

  constructor(private readonly scene: Scene) {
    const flat = (name: string, shape: FxShape | null, alpha: number) => {
      const mesh = CreateGround(name, { width: 2, height: 2 }, scene);
      mesh.isPickable = false;
      mesh.setEnabled(false);
      const mat = this.material(name, alpha);
      if (shape) mat.diffuseTexture = mat.opacityTexture = fxTexture(scene, shape);
      mesh.material = mat;
      return mesh;
    };
    this.range = flat('aim-range', 'dashring', 0.75);
    this.circle = flat('aim-circle', 'aoe', 0.95);
    this.unitRing = flat('aim-unit', 'ring', 1);
    this.cone = flat('aim-cone', null, 0.95);
    this.coneMat = this.cone.material as StandardMaterial;
    // The lane is 1 x 1 and scaled to width x length; its arrows repeat along the length.
    this.line = CreateGround('aim-line', { width: 1, height: 1 }, scene);
    this.line.isPickable = false;
    this.line.setEnabled(false);
    const lineMat = this.material('aim-line', 0.9);
    this.lineTex = fxTexture(scene, 'arrows').clone()!;
    this.lineTex.wrapV = 1; // wrap: the arrows repeat
    lineMat.diffuseTexture = lineMat.opacityTexture = this.lineTex;
    this.line.material = lineMat;
    this.meshes = [this.range, this.circle, this.line, this.cone, this.unitRing];
  }

  private material(name: string, alpha: number): StandardMaterial {
    const m = new StandardMaterial(`${name}-mat`, this.scene);
    // Unlit: color = emissive color x diffuse texture (an emissive texture would be added instead).
    m.disableLighting = true;
    m.emissiveColor = GOOD.clone();
    m.specularColor.set(0, 0, 0);
    m.alpha = alpha;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    // Shown over bumpy ground and over units: the player must always see where it lands.
    m.depthFunction = Constants.ALWAYS;
    this.mats.push(m);
    return m;
  }

  hide(): void {
    for (const m of this.meshes) m.setEnabled(false);
  }

  /**
   * hx/hy: hero, cx/cy: cursor (game coordinates), h: ground height function.
   * `bad` = red tint (not enough mana or not ready).
   */
  show(
    shape: AimShape,
    castRange: number,
    hx: number,
    hy: number,
    cx: number,
    cy: number,
    h: (x: number, y: number) => number,
    unit: { x: number; y: number; r: number } | null,
    bad: boolean,
  ): void {
    this.hide();
    for (const m of this.mats) m.emissiveColor.copyFrom(bad ? BAD : GOOD);
    const t = performance.now() / 1000;
    if (castRange > 0) {
      this.range.setEnabled(true);
      this.range.position.set(hx, h(hx, hy) + 0.1, -hy);
      this.range.scaling.set(castRange, 1, castRange);
      this.range.rotation.y = t * 0.15;
    }
    const dir = Math.atan2(cy - hy, cx - hx);
    switch (shape.kind) {
      case 'circle': {
        this.circle.setEnabled(true);
        this.circle.position.set(cx, h(cx, cy) + 0.12, -cy);
        // A soft "breath" so the area reads as alive, not as a sticker.
        const s = shape.radius * (1 + 0.025 * Math.sin(t * 5));
        this.circle.scaling.set(s, 1, s);
        this.circle.rotation.y = -t * 0.3;
        break;
      }
      case 'line': {
        this.line.setEnabled(true);
        const mx = hx + (Math.cos(dir) * shape.length) / 2,
          my = hy + (Math.sin(dir) * shape.length) / 2;
        this.line.position.set(mx, h(mx, my) + 0.12, -my);
        this.line.scaling.set(shape.width, 1, shape.length);
        this.line.rotation.y = Math.PI / 2 + dir;
        // One arrow pair per lane width along the length.
        this.lineTex.vScale = shape.length / Math.max(0.5, shape.width);
        this.lineTex.vOffset = -t * ARROW_SPEED;
        break;
      }
      case 'cone': {
        this.coneMat.diffuseTexture = this.coneMat.opacityTexture = coneTexture(this.scene, shape.angleDeg);
        this.cone.setEnabled(true);
        this.cone.position.set(hx, h(hx, hy) + 0.12, -hy);
        this.cone.scaling.set(shape.length, 1, shape.length);
        this.cone.rotation.y = dir;
        break;
      }
      case 'unit':
        if (unit) {
          this.unitRing.setEnabled(true);
          this.unitRing.position.set(unit.x, h(unit.x, unit.y) + 0.1, -unit.y);
          const s = unit.r * 1.15 * (1 + 0.05 * Math.sin(t * 6));
          this.unitRing.scaling.set(s, 1, s);
        }
        break;
    }
  }
}
