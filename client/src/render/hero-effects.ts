// Light "atmosphere" effects for heroes: a few small particle systems hung on effect sockets
// (empties named fx_<name> in the model, see tools/models/blender/kit.py socket()), plus a slow
// pulse on the glow material. Budget: about 10-40 live particles per hero.

import { Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';

/** Order of the 4-frame effects in client/public/assets/effects/effects.webp (Phase 3 sheet). */
export const FRAMES = ['fire', 'smoke', 'spark', 'arcane', 'heal', 'blood', 'dust', 'nature', 'frost', 'lightning'] as const;
export type Frames = (typeof FRAMES)[number];
export const CELL = 132; // atlas slot size in pixels (128 + 2 * 2 padding)

export interface EffectSpec {
  socket: string;
  frames: Frames;
  color1: string;
  color2: string;
  /** particles per second */
  rate: number;
  life: [number, number];
  size: [number, number];
  speed: [number, number];
  /** main direction (world, y is up) */
  dir: [number, number, number];
  /** emitter sphere radius */
  spread: number;
  /** upward pull (negative = falls) */
  lift: number;
  additive: boolean;
}

export interface HeroLook {
  effects: EffectSpec[];
  /** pulse of the glow material: [speed, min, max] */
  glowPulse?: [number, number, number];
}

const fx = (socket: string, frames: Frames, color1: string, color2: string, o: Partial<EffectSpec> = {}): EffectSpec => ({
  socket,
  frames,
  color1,
  color2,
  rate: 6,
  life: [0.8, 1.4],
  size: [0.12, 0.22],
  speed: [0.05, 0.2],
  dir: [0, 1, 0],
  spread: 0.15,
  lift: 0.2,
  additive: true,
  ...o,
});

export const HERO_LOOKS: Record<string, HeroLook> = {
  staff_warrior: {
    effects: [
      fx('ring', 'heal', '#ffd77a', '#ff9a3a', { rate: 6, size: [0.16, 0.3] }),
      fx('ring', 'spark', '#fff0c0', '#ffb040', { rate: 4, size: [0.06, 0.12], spread: 0.25, lift: 0.4 }),
      fx('fist_l', 'spark', '#ffe2a0', '#c07a20', { rate: 3, size: [0.06, 0.12], spread: 0.1, lift: 0.3 }),
      fx('aura', 'spark', '#ffe2a0', '#c07a20', { rate: 4, size: [0.08, 0.16], spread: 0.5, lift: 0.3 }),
    ],
  },
  blood_witch: {
    effects: [
      fx('crystal', 'arcane', '#ff3a3a', '#7a0010', { rate: 9, size: [0.16, 0.3], spread: 0.08 }),
      fx('crystal', 'blood', '#ff4040', '#600008', { rate: 3, size: [0.08, 0.14], dir: [0, -1, 0], lift: -0.6, life: [0.6, 1] }),
      fx('hand_l', 'smoke', '#7a0a14', '#2a0006', { rate: 5, size: [0.2, 0.4], additive: false, lift: 0.15, life: [1.2, 2] }),
      fx('hand_l', 'arcane', '#ff3030', '#5a0008', { rate: 4, size: [0.08, 0.16], spread: 0.06 }),
      fx('hem', 'smoke', '#3a0408', '#100002', { rate: 4, size: [0.35, 0.6], additive: false, spread: 0.35, lift: 0.04, life: [1.5, 2.5] }),
    ],
    glowPulse: [2.2, 0.7, 1.0],
  },
  sky_dragon: {
    effects: [
      fx('mouth', 'fire', '#ffb040', '#ff4010', { rate: 9, size: [0.16, 0.32], dir: [0, 0.4, 0], speed: [0.1, 0.3], life: [0.4, 0.8] }),
      fx('mouth', 'smoke', '#5a4a40', '#201812', { rate: 3, size: [0.25, 0.45], additive: false, life: [1, 1.8] }),
      fx('chest', 'fire', '#ff9030', '#c02000', { rate: 3, size: [0.1, 0.18], spread: 0.3, lift: 0.4, life: [0.5, 0.9] }),
      fx('tail', 'spark', '#ffc060', '#ff5010', { rate: 4, size: [0.06, 0.12], spread: 0.15, lift: 0.3 }),
    ],
    glowPulse: [3, 0.7, 1.0],
  },
  stone_golem: {
    effects: [
      fx('core', 'arcane', '#6ad8ff', '#1050c0', { rate: 5, size: [0.18, 0.32], spread: 0.15 }),
      fx('crystals_l', 'spark', '#ff80ff', '#a040c0', { rate: 3, size: [0.06, 0.12], spread: 0.25 }),
      fx('crystals_r', 'spark', '#ff80ff', '#a040c0', { rate: 3, size: [0.06, 0.12], spread: 0.25 }),
      fx('eyes', 'arcane', '#7ae0ff', '#1060d0', { rate: 3, size: [0.06, 0.12], spread: 0.08, lift: 0.2 }),
      fx('feet', 'dust', '#9a9080', '#4a4436', { rate: 2, size: [0.4, 0.7], additive: false, spread: 0.5, lift: 0.03, life: [1.2, 2] }),
    ],
    glowPulse: [1.2, 0.6, 1.0],
  },
  light_healer: {
    effects: [
      fx('halo', 'heal', '#fff2b0', '#ffc040', { rate: 7, size: [0.14, 0.26], spread: 0.32, lift: 0.15 }),
      fx('mace', 'spark', '#ffffff', '#ffd060', { rate: 5, size: [0.08, 0.14] }),
      fx('mace', 'heal', '#fff6c0', '#ffd060', { rate: 3, size: [0.2, 0.32], spread: 0.05 }),
      fx('hand_l', 'heal', '#fff0a0', '#ffc040', { rate: 4, size: [0.08, 0.16], spread: 0.06, lift: 0.3 }),
    ],
    glowPulse: [1.6, 0.8, 1.0],
  },
  arcane_huntress: {
    effects: [
      fx('bow', 'arcane', '#c880ff', '#5020c0', { rate: 9, size: [0.1, 0.2], spread: 0.35, lift: 0.1 }),
      fx('arrow', 'spark', '#e0b0ff', '#7030e0', { rate: 4, size: [0.05, 0.1], spread: 0.05 }),
      fx('quiver', 'arcane', '#b070ff', '#4010a0', { rate: 3, size: [0.08, 0.14], spread: 0.08, lift: 0.3 }),
    ],
    glowPulse: [2.5, 0.7, 1.0],
  },
  centaur_raider: {
    effects: [
      fx('hooves', 'dust', '#a88a60', '#5a4630', { rate: 4, size: [0.35, 0.6], additive: false, spread: 0.5, lift: 0.05, life: [1, 1.6] }),
      fx('spear', 'spark', '#ffd080', '#c06020', { rate: 3, size: [0.05, 0.1], spread: 0.05 }),
      fx('chest', 'fire', '#ff6030', '#a01000', { rate: 2, size: [0.06, 0.1], spread: 0.2, lift: 0.3, life: [0.6, 1] }),
    ],
  },
  forest_elf: {
    effects: [
      fx('aura', 'nature', '#b8ff7a', '#3a9a2a', { rate: 3, size: [0.12, 0.2], spread: 0.6, lift: 0.1, life: [1.5, 2.5] }),
      fx('aura', 'spark', '#e0ff90', '#80c040', { rate: 3, size: [0.04, 0.08], spread: 0.8, lift: 0.05, life: [1.5, 3] }),
      fx('bow', 'nature', '#a0ff60', '#2a8020', { rate: 4, size: [0.08, 0.14], spread: 0.3, lift: -0.05 }),
      fx('antlers', 'spark', '#f0ffa0', '#90d040', { rate: 3, size: [0.04, 0.08], spread: 0.15, lift: 0.2 }),
    ],
    glowPulse: [1.8, 0.8, 1.0],
  },
};

const atlasCache = new WeakMap<Scene, Texture>();
export function effectsAtlas(scene: Scene): Texture {
  let t = atlasCache.get(scene);
  if (!t) {
    t = new Texture('/assets/effects/effects.webp', scene, { invertY: false, noMipmap: true });
    atlasCache.set(scene, t);
  }
  return t;
}

export const c4 = (hex: string, a = 1) => {
  const n = parseInt(hex.slice(1), 16);
  return new Color4(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a);
};

export interface HeroEffects {
  setVisible(visible: boolean): void;
  dispose(): void;
}

/** Attaches the hero's look effects. `nodes` = transform nodes of the loaded model (result.transformNodes). */
export function attachHeroEffects(scene: Scene, heroId: string, nodes: TransformNode[], glow?: StandardMaterial): HeroEffects {
  const look = HERO_LOOKS[heroId];
  const systems: ParticleSystem[] = [];
  const emitters: Mesh[] = [];
  if (!look) return { setVisible() {}, dispose() {} };
  for (const e of look.effects) {
    const socket = nodes.find((n) => n.name === `fx_${e.socket}`);
    if (!socket) continue;
    const emitter = new Mesh(`fx-emitter-${e.socket}`, scene);
    emitter.parent = socket;
    emitters.push(emitter);
    const ps = new ParticleSystem(`fx-${heroId}-${e.socket}-${e.frames}`, Math.ceil(e.rate * e.life[1]) + 4, scene, null, true);
    ps.particleTexture = effectsAtlas(scene);
    ps.spriteCellWidth = CELL;
    ps.spriteCellHeight = CELL;
    const k = FRAMES.indexOf(e.frames) * 4;
    ps.startSpriteCellID = k;
    ps.endSpriteCellID = k + 3;
    ps.spriteCellChangeSpeed = 1;
    ps.spriteCellLoop = false;
    ps.emitter = emitter;
    ps.createSphereEmitter(e.spread, 1);
    ps.emitRate = e.rate;
    ps.minLifeTime = e.life[0];
    ps.maxLifeTime = e.life[1];
    ps.minSize = e.size[0];
    ps.maxSize = e.size[1];
    ps.minEmitPower = e.speed[0];
    ps.maxEmitPower = e.speed[1];
    ps.direction1 = new Vector3(...e.dir).scale(0.6);
    ps.direction2 = new Vector3(...e.dir);
    ps.gravity = new Vector3(0, e.lift, 0);
    ps.color1 = c4(e.color1);
    ps.color2 = c4(e.color2);
    ps.colorDead = c4(e.color2, 0);
    ps.minAngularSpeed = -1;
    ps.maxAngularSpeed = 1;
    ps.blendMode = e.additive ? ParticleSystem.BLENDMODE_ADD : ParticleSystem.BLENDMODE_STANDARD;
    ps.updateSpeed = 1 / 60;
    ps.start();
    systems.push(ps);
  }
  let visible = true;
  let observer: ReturnType<typeof scene.onBeforeRenderObservable.add> | null = null;
  if (look.glowPulse && glow) {
    const [speed, lo, hi] = look.glowPulse;
    const base = glow.diffuseColor.clone();
    let t = 0;
    observer = scene.onBeforeRenderObservable.add(() => {
      if (!visible) return;
      t += scene.getEngine().getDeltaTime() / 1000;
      const k = lo + (hi - lo) * (0.5 + 0.5 * Math.sin(t * speed));
      glow.diffuseColor.copyFrom(base).scaleInPlace(k);
    });
  }
  return {
    setVisible(on) {
      visible = on;
      for (const system of systems) {
        if (on) system.start();
        else {
          system.stop();
          system.reset();
        }
      }
    },
    dispose() {
      // The atlas belongs to the scene and is shared by every hero and ability.
      for (const s of systems) s.dispose(false);
      for (const e of emitters) e.dispose();
      if (observer) scene.onBeforeRenderObservable.remove(observer);
    },
  };
}
