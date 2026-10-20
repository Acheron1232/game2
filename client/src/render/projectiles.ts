// Ranged attacks on screen: a small glowing ball flies from the shooter to the target (it
// follows the target, like on the server). One thin-instanced mesh per color, a pool of slots.
// Placeholder look; real projectiles per hero/unit come in Phase 9.

import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import type { Scene } from '@babylonjs/core/scene';

interface Shot {
  active: boolean;
  x: number;
  y: number;
  h: number;
  speed: number;
  target: () => { x: number; y: number; h: number } | null;
  /** layer key: color and size */
  key: string;
}

interface ColorLayer {
  mesh: Mesh;
  matrices: Float32Array;
  count: number;
}

const MAX = 128;
const IDENTITY = Quaternion.Identity();
const ONE = new Vector3(1, 1, 1);

export class Projectiles {
  private readonly shots: Shot[] = [];
  private readonly layers = new Map<string, ColorLayer>();
  private readonly m = new Matrix();
  private readonly p = new Vector3();

  constructor(private readonly scene: Scene) {
    for (let i = 0; i < MAX; i++) this.shots.push({ active: false, x: 0, y: 0, h: 0, speed: 0, target: () => null, key: '' });
  }

  /** color: hex like '#ffd84a'; size: ball diameter (spells are bigger than attacks) */
  fire(x: number, y: number, h: number, speed: number, target: Shot['target'], color: string, size = 0.28): void {
    const s = this.shots.find((x) => !x.active);
    if (!s) return;
    s.active = true;
    s.x = x;
    s.y = y;
    s.h = h;
    s.speed = speed;
    s.target = target;
    s.key = `${color}:${size}`;
    this.layer(color, size, s.key);
  }

  private layer(color: string, size: number, key: string): ColorLayer {
    let l = this.layers.get(key);
    if (l) return l;
    const mesh = CreateSphere(`projectile-${key}`, { diameter: size, segments: 4 }, this.scene);
    const mat = new StandardMaterial(`projectile-${color}`, this.scene);
    mat.disableLighting = true;
    mat.emissiveColor = Color3.FromHexString(color);
    mesh.material = mat;
    mesh.isPickable = false;
    mesh.alwaysSelectAsActiveMesh = true;
    const matrices = new Float32Array(16 * MAX);
    mesh.thinInstanceSetBuffer('matrix', matrices, 16, false);
    mesh.thinInstanceCount = 0;
    mesh.setEnabled(false);
    l = { mesh, matrices, count: 0 };
    this.layers.set(key, l);
    return l;
  }

  update(dt: number): void {
    for (const s of this.shots) {
      if (!s.active) continue;
      const t = s.target();
      if (!t) {
        s.active = false;
        continue;
      }
      const dx = t.x - s.x,
        dy = t.y - s.y,
        dh = t.h - s.h;
      const d = Math.hypot(dx, dy, dh);
      const step = s.speed * dt;
      if (d <= step) {
        s.active = false;
        continue;
      }
      s.x += (dx / d) * step;
      s.y += (dy / d) * step;
      s.h += (dh / d) * step;
      const l = this.layers.get(s.key);
      if (!l) continue;
      this.p.set(s.x, s.h, -s.y);
      Matrix.ComposeToRef(ONE, IDENTITY, this.p, this.m);
      this.m.copyToArray(l.matrices, l.count * 16);
      l.count++;
    }
    for (const l of this.layers.values()) {
      l.mesh.setEnabled(l.count > 0);
      l.mesh.thinInstanceCount = l.count;
      l.mesh.thinInstanceBufferUpdated('matrix');
      l.count = 0;
    }
  }

  dispose(): void {
    for (const l of this.layers.values()) l.mesh.dispose(false, true);
    this.layers.clear();
    this.shots.length = 0;
  }
}
