// Items lying on the ground: a small crate with a glowing ring in the color of the item tier.
// There are only a few at a time, so each one is a plain copy of the crate model.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { InstancedMesh } from '@babylonjs/core/Meshes/instancedMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { ModelInstance, ModelLibrary } from './model-library';

const TIER_COLORS: Record<string, string> = {
  consumable: '#9be36a',
  basic: '#e8dcc0',
  advanced: '#5aa8ff',
  rare: '#ffb03a',
};
const CRATE_SCALE = 0.45;

interface View {
  crate: ModelInstance;
  ring: InstancedMesh;
  x: number;
  y: number;
}

export class GroundItemViews {
  private readonly views = new Map<number, View>();
  private readonly rings = new Map<string, Mesh>();

  constructor(
    private readonly scene: Scene,
    private readonly library: ModelLibrary,
    private readonly heightAt: (x: number, y: number) => number,
  ) {
    for (const [tier, color] of Object.entries(TIER_COLORS)) {
      const ring = CreateTorus(`item-ring-${tier}`, { diameter: 1.5, thickness: 0.08, tessellation: 32 }, scene);
      const m = new StandardMaterial(`item-ring-${tier}`, scene);
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(color);
      m.alpha = 0.85;
      m.disableDepthWrite = true;
      m.depthFunction = Constants.ALWAYS;
      ring.material = m;
      ring.isPickable = false;
      // Kept enabled far below the map, so its shader compiles while the game loads.
      ring.position.set(0, -100, 0);
      this.rings.set(tier, ring);
    }
  }

  add(id: number, tier: string, x: number, y: number): void {
    this.remove(id);
    const h = this.heightAt(x, y);
    const crate = this.library.spawn('crate', 'red');
    crate.root.position.set(x, h, -y);
    crate.root.scaling.setAll(CRATE_SCALE);
    crate.root.rotation.y = (id * 1.7) % 6.28;
    const ring = (this.rings.get(tier) ?? this.rings.get('basic')!).createInstance(`item-${id}`);
    ring.position.set(x, h + 0.08, -y);
    ring.isPickable = false;
    this.views.set(id, { crate, ring, x, y });
  }

  remove(id: number): void {
    const v = this.views.get(id);
    if (!v) return;
    v.crate.dispose();
    v.ring.dispose();
    this.views.delete(id);
  }

  clear(): void {
    for (const id of [...this.views.keys()]) this.remove(id);
  }

  /** The item closest to a screen point (CSS pixels), within a small radius. */
  pick(sx: number, sy: number, project: (x: number, y: number, up: number, out: { x: number; y: number }) => boolean): number {
    const pt = { x: 0, y: 0 };
    let best = 0,
      bestD = 28;
    for (const [id, v] of this.views) {
      if (!project(v.x, v.y, 0.3, pt)) continue;
      const d = Math.hypot(pt.x - sx, pt.y - sy);
      if (d < bestD) {
        bestD = d;
        best = id;
      }
    }
    return best;
  }

  /** Ring spin: a slow turn makes items easy to spot. */
  update(): void {
    const a = performance.now() / 900;
    for (const v of this.views.values()) v.ring.rotation.y = a;
  }
}
