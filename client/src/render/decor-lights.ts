// Light for the living props of the map (campfires, lanterns, crystals, rune stones):
// - pools of light on the ground: one thin-instanced glow decal per color (two draw calls for the
//   whole map), warm ones flicker, cool ones breathe;
// - flames over campfires and sparkles over crystals: small particle systems that run only
//   near the camera.
// No real lights: Babylon lights cost every material on screen; these cost almost nothing.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import type { DecorItem } from './decor';
import { fxTexture } from './fx-textures';
import { fogGlowOnly } from './fog';

interface LightSpec {
  /** pool of light radius (times the prop scale) */
  radius: number;
  warm: boolean;
  /** particles: flames or sparkles, and their height over the prop's foot */
  particles?: 'flame' | 'sparkle';
  height: number;
}

const SPECS: Record<string, LightSpec> = {
  campfire: { radius: 4.8, warm: true, particles: 'flame', height: 0.15 },
  lantern: { radius: 3.4, warm: true, height: 1.65 },
  crystal: { radius: 3.8, warm: false, particles: 'sparkle', height: 0.9 },
  rune_stone: { radius: 2.6, warm: false, height: 1 },
};

/** Particles run only within this distance of the view (game units). */
const ACTIVE_RANGE = 60;

interface Emitter {
  x: number;
  y: number;
  ps: ParticleSystem;
}

export class DecorLights {
  private readonly emitters: Emitter[] = [];
  private readonly pools: Mesh[] = [];
  private readonly warmMat: StandardMaterial;
  private readonly coolMat: StandardMaterial;
  private checkAt = 0;

  constructor(scene: Scene, items: DecorItem[], types: string[], heightAt: (x: number, y: number) => number) {
    const pools = { warm: [] as number[], cool: [] as number[] };
    const m = new Matrix();
    for (const [x, y, t, scale] of items) {
      const spec = SPECS[types[t] ?? ''];
      if (!spec) continue;
      const r = spec.radius * scale;
      const h = heightAt(x, y);
      Matrix.ScalingToRef(r, 1, r, m);
      m.setTranslationFromFloats(x, h + 0.09, -y);
      (spec.warm ? pools.warm : pools.cool).push(...m.toArray());
      if (spec.particles) this.emitters.push({ x, y, ps: this.particles(scene, spec.particles, x, h + spec.height * scale, -y, scale) });
    }
    this.warmMat = this.poolMaterial(scene, 'decor-light-warm', '#ffb050', 0.55);
    this.coolMat = this.poolMaterial(scene, 'decor-light-cool', '#60d8ff', 0.5);
    for (const [key, mat] of [
      ['warm', this.warmMat],
      ['cool', this.coolMat],
    ] as const) {
      const list = pools[key];
      if (!list.length) continue;
      const mesh = CreateGround(`decor-light-${key}`, { width: 2, height: 2 }, scene);
      this.pools.push(mesh);
      mesh.material = mat;
      mesh.isPickable = false;
      mesh.thinInstanceSetBuffer('matrix', new Float32Array(list), 16, true);
    }
  }

  private poolMaterial(scene: Scene, name: string, color: string, alpha: number): StandardMaterial {
    const mat = new StandardMaterial(name, scene);
    const tex = fxTexture(scene, 'glow');
    // Unlit: color = emissive color x diffuse texture (an emissive texture would be added instead).
    mat.disableLighting = true;
    mat.emissiveColor = Color3.FromHexString(color);
    mat.diffuseTexture = tex;
    mat.specularColor.set(0, 0, 0);
    mat.opacityTexture = tex;
    mat.alpha = alpha;
    mat.alphaMode = Constants.ALPHA_ADD;
    mat.disableDepthWrite = true;
    // Lies on bumpy ground: pulled toward the camera a little, like the unit rings.
    mat.zOffset = -2;
    // Added light must not mix toward the haze color far away (white blots over the map), and
    // must not shine through the fog of war.
    mat.fogEnabled = false;
    fogGlowOnly(mat);
    return mat;
  }

  private particles(scene: Scene, kind: 'flame' | 'sparkle', x: number, h: number, z: number, scale: number): ParticleSystem {
    const ps = new ParticleSystem(`decor-${kind}`, kind === 'flame' ? 40 : 16, scene);
    ps.particleTexture = fxTexture(scene, kind === 'flame' ? 'glow' : 'spark');
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    ps.emitter = new Vector3(x, h, z);
    ps.updateSpeed = 1 / 60;
    if (kind === 'flame') {
      // Hot yellow at the bottom, orange, then dark red as it rises and fades.
      ps.createCylinderEmitter(0.22 * scale, 0.05, 0.1, 0);
      ps.addColorGradient(0, new Color4(1, 0.85, 0.4, 0.9));
      ps.addColorGradient(0.4, new Color4(1, 0.5, 0.12, 0.75));
      ps.addColorGradient(1, new Color4(0.6, 0.1, 0.02, 0));
      ps.addSizeGradient(0, 0.55 * scale);
      ps.addSizeGradient(1, 0.15 * scale);
      ps.minLifeTime = 0.5;
      ps.maxLifeTime = 0.9;
      ps.emitRate = 34;
      ps.minEmitPower = 0.6;
      ps.maxEmitPower = 1.2;
      ps.gravity = new Vector3(0, 1.2, 0);
    } else {
      ps.createSphereEmitter(0.6 * scale, 1);
      ps.color1 = new Color4(0.75, 0.95, 1, 1);
      ps.color2 = new Color4(0.4, 0.8, 1, 0.9);
      ps.colorDead = new Color4(0.3, 0.7, 1, 0);
      ps.minSize = 0.08;
      ps.maxSize = 0.18;
      ps.minLifeTime = 0.8;
      ps.maxLifeTime = 1.6;
      ps.emitRate = 7;
      ps.minEmitPower = 0.05;
      ps.maxEmitPower = 0.2;
      ps.gravity = new Vector3(0, 0.35, 0);
    }
    return ps;
  }

  /** Every frame: flicker and breathing; a few times a second: start or stop nearby particles. */
  update(viewX: number, viewY: number, active: boolean): void {
    // The menu shows the whole map from far away: the pools would be blots over the haze.
    for (const m of this.pools) if (m.isEnabled() !== active) m.setEnabled(active);
    const t = performance.now() / 1000;
    this.warmMat.alpha = 0.5 + 0.06 * Math.sin(t * 9.1) + 0.04 * Math.sin(t * 23.7);
    this.coolMat.alpha = 0.42 + 0.08 * Math.sin(t * 1.6);
    if (t < this.checkAt) return;
    this.checkAt = t + 0.4;
    for (const e of this.emitters) {
      const near = active && Math.abs(e.x - viewX) < ACTIVE_RANGE && Math.abs(e.y - viewY) < ACTIVE_RANGE;
      if (near && !e.ps.isStarted()) e.ps.start();
      else if (!near && e.ps.isStarted()) e.ps.stop();
    }
  }
}
