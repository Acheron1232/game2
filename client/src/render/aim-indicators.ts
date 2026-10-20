// Ground markers while aiming an ability: the cast range around the hero, and the shape the
// ability will hit at the cursor (circle, cone, line) or a ring on the unit under the cursor.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';

export type AimShape =
  | { kind: 'circle'; radius: number }
  | { kind: 'cone'; length: number; angleDeg: number }
  | { kind: 'line'; length: number; width: number }
  | { kind: 'unit' };

const GOOD = Color3.FromHexString('#7fd0ff');
const EDGE = Color3.FromHexString('#bfe8ff');
const BAD = Color3.FromHexString('#ff6a5a');

export class AimIndicators {
  private readonly range: Mesh;
  private readonly circle: Mesh;
  private readonly circleEdge: Mesh;
  private readonly line: Mesh;
  private readonly unitRing: Mesh;
  private cone: Mesh | null = null;
  private coneKey = '';
  private readonly mat: StandardMaterial;
  private readonly edgeMat: StandardMaterial;
  private readonly meshes: Mesh[];
  private readonly circleMeshes: Mesh[];

  constructor(private readonly scene: Scene) {
    this.mat = this.material('#7fd0ff', 0.25);
    this.edgeMat = this.material('#bfe8ff', 0.8);
    this.range = CreateTorus('aim-range', { diameter: 2, thickness: 0.06, tessellation: 64 }, scene);
    this.range.material = this.edgeMat;
    this.circle = CreateDisc('aim-circle', { radius: 1, tessellation: 40 }, scene);
    this.circle.rotation.x = Math.PI / 2;
    this.circle.material = this.mat;
    this.circleEdge = CreateTorus('aim-circle-edge', { diameter: 2, thickness: 0.08, tessellation: 48 }, scene);
    this.circleEdge.material = this.edgeMat;
    this.line = CreateGround('aim-line', { width: 1, height: 1 }, scene);
    this.line.material = this.mat;
    this.unitRing = CreateTorus('aim-unit', { diameter: 2, thickness: 0.12, tessellation: 32 }, scene);
    this.unitRing.material = this.edgeMat;
    this.meshes = [this.range, this.circle, this.circleEdge, this.line, this.unitRing];
    this.circleMeshes = [this.circle, this.circleEdge];
    for (const m of this.meshes) {
      m.isPickable = false;
      m.setEnabled(false);
    }
  }

  private material(color: string, alpha: number): StandardMaterial {
    const m = new StandardMaterial(`aim-${color}`, this.scene);
    m.disableLighting = true;
    m.emissiveColor = Color3.FromHexString(color);
    m.alpha = alpha;
    m.backFaceCulling = false;
    m.disableDepthWrite = true;
    m.depthFunction = Constants.ALWAYS;
    return m;
  }

  hide(): void {
    for (const m of this.meshes) m.setEnabled(false);
    this.cone?.setEnabled(false);
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
    this.mat.emissiveColor.copyFrom(bad ? BAD : GOOD);
    this.edgeMat.emissiveColor.copyFrom(bad ? BAD : EDGE);
    if (castRange > 0) {
      this.range.setEnabled(true);
      this.range.position.set(hx, h(hx, hy) + 0.1, -hy);
      this.range.scaling.set(castRange, 1, castRange);
    }
    const dir = Math.atan2(cy - hy, cx - hx);
    switch (shape.kind) {
      case 'circle':
        for (const m of this.circleMeshes) {
          m.setEnabled(true);
          m.position.set(cx, h(cx, cy) + 0.12, -cy);
          m.scaling.set(shape.radius, m === this.circle ? shape.radius : 1, shape.radius);
        }
        // The disc was turned flat, so its "y" scale is the depth.
        this.circle.scaling.set(shape.radius, shape.radius, 1);
        break;
      case 'line': {
        this.line.setEnabled(true);
        const mx = hx + (Math.cos(dir) * shape.length) / 2,
          my = hy + (Math.sin(dir) * shape.length) / 2;
        this.line.position.set(mx, h(mx, my) + 0.12, -my);
        this.line.scaling.set(shape.width, 1, shape.length);
        this.line.rotation.y = Math.PI / 2 + dir;
        break;
      }
      case 'cone': {
        const key = `${shape.length}:${shape.angleDeg}`;
        if (key !== this.coneKey) {
          this.cone?.dispose();
          this.cone = CreateDisc('aim-cone', { radius: shape.length, arc: shape.angleDeg / 360, tessellation: 24 }, this.scene);
          this.cone.material = this.mat;
          this.cone.isPickable = false;
          this.coneKey = key;
        }
        const c = this.cone!;
        c.setEnabled(true);
        c.position.set(hx, h(hx, hy) + 0.12, -hy);
        // The disc slice covers angles [yaw - arc, yaw] after it is laid flat: center it on dir.
        c.rotation.set(Math.PI / 2, dir + (shape.angleDeg * Math.PI) / 360, 0);
        break;
      }
      case 'unit':
        if (unit) {
          this.unitRing.setEnabled(true);
          this.unitRing.position.set(unit.x, h(unit.x, unit.y) + 0.1, -unit.y);
          this.unitRing.scaling.set(unit.r, 1, unit.r);
        }
        break;
    }
  }
}
