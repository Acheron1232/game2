import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { SphereParticleEmitter } from '@babylonjs/core/Particles/EmitterTypes/sphereParticleEmitter';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import { CELL, effectsAtlas, FRAMES, type Frames } from './hero-effects';

export type FxQuality = 'low' | 'high';

export type CombatParticleKind =
  'attack' | 'spell' | 'siege' | 'miss' | 'level-up' | 'gold' | 'death' | 'building-dust' | 'building-debris' | 'build-dust';

export interface PoolTimeSlot {
  startedAt: number;
  activeUntil: number;
}

export interface LevelUpRingSample {
  height: number;
  alpha: number;
  scale: number;
}

export const LEVEL_UP_LIFE = 1.2;

const HIGH_PARTICLE_COUNTS: Record<CombatParticleKind, number> = {
  attack: 8,
  spell: 14,
  siege: 18,
  miss: 4,
  'level-up': 28,
  gold: 6,
  death: 10,
  'building-dust': 42,
  'building-debris': 18,
  'build-dust': 14,
};

/** Picks an idle slot in round-robin order, or the oldest busy slot. */
export function pickPoolSlot(slots: readonly PoolTimeSlot[], now: number, nextIndex: number): number {
  if (slots.length === 0) return -1;
  const start = ((nextIndex % slots.length) + slots.length) % slots.length;
  for (let offset = 0; offset < slots.length; offset++) {
    const index = (start + offset) % slots.length;
    if (slots[index]!.activeUntil <= now) return index;
  }
  let oldest = start;
  for (let offset = 1; offset < slots.length; offset++) {
    const index = (start + offset) % slots.length;
    if (slots[index]!.startedAt < slots[oldest]!.startedAt) oldest = index;
  }
  return oldest;
}

/** Particle budget for one event. Low quality uses about half and has no debris. */
export function combatParticleCount(kind: CombatParticleKind, quality: FxQuality): number {
  const high = HIGH_PARTICLE_COUNTS[kind];
  if (quality === 'high') return high;
  return kind === 'building-debris' ? 0 : Math.ceil(high / 2);
}

/** Samples the local movement of the gold level-up ring. */
export function levelUpRingCurve(age: number, out: LevelUpRingSample): LevelUpRingSample {
  const t = Math.min(1, Math.max(0, age / LEVEL_UP_LIFE));
  out.height = t * 2.6;
  out.alpha = 1 - t;
  out.scale = 0.65 + Math.min(1, t * 2) * 0.5;
  return out;
}

interface ParticleSlot extends PoolTimeSlot {
  system: ParticleSystem;
  emitter: Vector3;
  shape: SphereParticleEmitter;
}

interface ParticlePool {
  slots: ParticleSlot[];
  next: number;
}

interface RingSlot extends PoolTimeSlot {
  mesh: Mesh;
  age: number;
  x: number;
  h: number;
  z: number;
  radius: number;
  active: boolean;
  sample: LevelUpRingSample;
}

const FRAME_COUNT = 4;
const GOLD = '#ffd45a';
const GOLD_DARK = '#d88918';
const DUST = '#9b8870';
const DUST_DARK = '#51483f';

function setColor(out: Color4, hex: string, alpha: number): void {
  const value = /^#[0-9a-f]{6}$/i.test(hex) ? Number.parseInt(hex.slice(1), 16) : 0xffffff;
  out.set(((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255, alpha);
}

export class CombatFx {
  private quality: FxQuality = 'high';
  private clock = 0;
  private readonly hitPool: ParticlePool;
  private readonly hitDustPool: ParticlePool;
  private readonly levelPool: ParticlePool;
  private readonly goldPool: ParticlePool;
  private readonly deathPool: ParticlePool;
  private readonly buildingDustPool: ParticlePool;
  private readonly buildingDebrisPool: ParticlePool;
  private readonly buildDustPool: ParticlePool;
  private readonly rings: RingSlot[] = [];
  private nextRing = 0;
  private readonly ringMaterial: StandardMaterial;

  constructor(private readonly scene: Scene) {
    this.hitPool = this.makePool('combat-hit', 12, 24, 'spark', ParticleSystem.BLENDMODE_ADD);
    this.hitDustPool = this.makePool('combat-hit-dust', 6, 20, 'dust', ParticleSystem.BLENDMODE_STANDARD);
    this.levelPool = this.makePool('combat-level', 4, 40, 'heal', ParticleSystem.BLENDMODE_ADD);
    this.goldPool = this.makePool('combat-gold', 6, 12, 'spark', ParticleSystem.BLENDMODE_ADD);
    this.deathPool = this.makePool('combat-death', 8, 16, 'dust', ParticleSystem.BLENDMODE_STANDARD);
    this.buildingDustPool = this.makePool('combat-building-dust', 3, 64, 'dust', ParticleSystem.BLENDMODE_STANDARD);
    this.buildingDebrisPool = this.makePool('combat-building-debris', 3, 24, 'spark', ParticleSystem.BLENDMODE_ADD);
    this.buildDustPool = this.makePool('combat-build-dust', 6, 20, 'dust', ParticleSystem.BLENDMODE_STANDARD);

    this.ringMaterial = new StandardMaterial('combat-level-ring-material', scene);
    this.ringMaterial.disableLighting = true;
    this.ringMaterial.emissiveColor = Color3.FromHexString(GOLD);
    this.ringMaterial.diffuseColor.set(0, 0, 0);
    this.ringMaterial.alpha = 1;
    this.ringMaterial.backFaceCulling = false;
    this.ringMaterial.disableDepthWrite = true;
    for (let i = 0; i < 4; i++) {
      const mesh = CreateTorus(`combat-level-ring-${i}`, { diameter: 2, thickness: 0.1, tessellation: 40 }, scene);
      mesh.material = this.ringMaterial;
      mesh.isPickable = false;
      mesh.setEnabled(false);
      this.rings.push({
        mesh,
        startedAt: 0,
        activeUntil: 0,
        age: 0,
        x: 0,
        h: 0,
        z: 0,
        radius: 1,
        active: false,
        sample: { height: 0, alpha: 1, scale: 1 },
      });
    }
  }

  /** A hit lands: a short spark at the target. */
  hit(x: number, h: number, z: number, kind: 'attack' | 'spell' | 'siege' | 'miss', color?: string): void {
    if (kind === 'miss') {
      this.burst(
        this.hitDustPool,
        x,
        h,
        z,
        'smoke',
        '#f4f1e8',
        '#a9a59c',
        combatParticleCount(kind, this.quality),
        0.12,
        0.12,
        0.22,
        0.08,
        0.18,
        0.15,
        0.5,
        0.2,
      );
      return;
    }
    const spell = kind === 'spell';
    const siege = kind === 'siege';
    this.burst(
      this.hitPool,
      x,
      h,
      z,
      spell ? 'arcane' : 'spark',
      color ?? (spell ? '#bd86ff' : '#fff0b0'),
      spell ? '#5d27bd' : '#e77d24',
      combatParticleCount(kind, this.quality),
      siege ? 0.36 : 0.14,
      0.12,
      siege ? 0.32 : 0.22,
      siege ? 0.18 : 0.1,
      siege ? 0.44 : 0.28,
      siege ? 0.6 : 0.35,
      siege ? 2.8 : 1.6,
      siege ? -3.8 : -1.2,
    );
    if (siege) {
      this.burst(
        this.hitDustPool,
        x,
        h,
        z,
        'dust',
        DUST,
        DUST_DARK,
        combatParticleCount('attack', this.quality),
        0.5,
        0.35,
        0.65,
        0.28,
        0.62,
        0.2,
        0.9,
        0.7,
      );
    }
  }

  /** Level up: a rising golden ring and a column of light around the hero. */
  levelUp(x: number, h: number, z: number, radius: number): void {
    const index = pickPoolSlot(this.rings, this.clock, this.nextRing);
    const ring = this.rings[index]!;
    this.nextRing = (index + 1) % this.rings.length;
    ring.startedAt = this.clock;
    ring.activeUntil = this.clock + LEVEL_UP_LIFE;
    ring.age = 0;
    ring.x = x;
    ring.h = h;
    ring.z = z;
    ring.radius = radius;
    ring.active = true;
    ring.mesh.position.set(x, h + 0.12, z);
    levelUpRingCurve(0, ring.sample);
    const scale = radius * ring.sample.scale;
    ring.mesh.scaling.set(scale, 1, scale);
    ring.mesh.visibility = ring.sample.alpha;
    ring.mesh.setEnabled(true);
    this.burst(
      this.levelPool,
      x,
      h + 0.15,
      z,
      'heal',
      '#fff4b0',
      GOLD,
      combatParticleCount('level-up', this.quality),
      radius * 0.55,
      0.65,
      1.15,
      0.18,
      0.48,
      0.3,
      1.1,
      3.2,
    );
  }

  /** Gold from a last hit: a few small gold sparkles that pop up and fade. */
  gold(x: number, h: number, z: number): void {
    this.burst(
      this.goldPool,
      x,
      h,
      z,
      'spark',
      '#fff1a0',
      GOLD_DARK,
      combatParticleCount('gold', this.quality),
      0.18,
      0.45,
      0.75,
      0.08,
      0.2,
      0.8,
      1.7,
      1.8,
    );
  }

  /** A unit dies: small dust puff. Call this only for ground units. */
  death(x: number, h: number, z: number, size: number): void {
    this.burst(
      this.deathPool,
      x,
      h,
      z,
      'dust',
      DUST,
      DUST_DARK,
      combatParticleCount('death', this.quality),
      Math.max(0.15, size * 0.22),
      0.35,
      0.7,
      size * 0.12,
      size * 0.3,
      0.15,
      0.7,
      0.6,
    );
  }

  /** A building falls: a large dust cloud and, on high quality, debris sparks. */
  buildingDown(x: number, h: number, z: number, size: number): void {
    const radius = Math.max(0.5, size * 0.45);
    this.burst(
      this.buildingDustPool,
      x,
      h,
      z,
      'dust',
      '#a28d73',
      '#49433d',
      combatParticleCount('building-dust', this.quality),
      radius,
      1.15,
      1.9,
      Math.max(0.35, size * 0.12),
      Math.max(0.7, size * 0.25),
      0.15,
      1.1,
      0.9,
    );
    const debris = combatParticleCount('building-debris', this.quality);
    if (debris > 0) {
      this.burst(
        this.buildingDebrisPool,
        x,
        h + 0.2,
        z,
        'spark',
        '#d7b27c',
        '#6e4930',
        debris,
        radius * 0.8,
        0.65,
        1.25,
        0.12,
        0.28,
        1.4,
        3.6,
        -5,
      );
    }
  }

  /** A building site is placed or finished: a small dust ring. */
  buildDust(x: number, h: number, z: number, size: number): void {
    this.burst(
      this.buildDustPool,
      x,
      h,
      z,
      'dust',
      '#b09a7c',
      '#65584a',
      combatParticleCount('build-dust', this.quality),
      Math.max(0.3, size * 0.42),
      0.45,
      0.8,
      Math.max(0.18, size * 0.08),
      Math.max(0.35, size * 0.16),
      0.1,
      0.5,
      0.55,
    );
  }

  setQuality(q: FxQuality): void {
    this.quality = q;
  }

  update(dt: number): void {
    const step = Math.max(0, dt);
    this.clock += step;
    for (const ring of this.rings) {
      if (!ring.active) continue;
      ring.age += step;
      levelUpRingCurve(ring.age, ring.sample);
      ring.mesh.position.set(ring.x, ring.h + 0.12 + ring.sample.height, ring.z);
      const scale = ring.radius * ring.sample.scale;
      ring.mesh.scaling.set(scale, 1, scale);
      ring.mesh.visibility = ring.sample.alpha;
      if (ring.age >= LEVEL_UP_LIFE) {
        ring.active = false;
        ring.mesh.setEnabled(false);
      }
    }
  }

  dispose(): void {
    this.disposePool(this.hitPool);
    this.disposePool(this.hitDustPool);
    this.disposePool(this.levelPool);
    this.disposePool(this.goldPool);
    this.disposePool(this.deathPool);
    this.disposePool(this.buildingDustPool);
    this.disposePool(this.buildingDebrisPool);
    this.disposePool(this.buildDustPool);
    for (const ring of this.rings) ring.mesh.dispose(false, false);
    this.rings.length = 0;
    this.ringMaterial.dispose();
  }

  private makePool(name: string, count: number, capacity: number, frames: Frames, blendMode: number): ParticlePool {
    const pool: ParticlePool = { slots: [], next: 0 };
    const atlas = effectsAtlas(this.scene);
    for (let i = 0; i < count; i++) {
      const system = new ParticleSystem(`${name}-${i}`, capacity, this.scene, null, true);
      const emitter = new Vector3();
      system.particleTexture = atlas;
      system.spriteCellWidth = CELL;
      system.spriteCellHeight = CELL;
      this.setFrames(system, frames);
      system.spriteCellChangeSpeed = 1;
      system.spriteCellLoop = false;
      system.blendMode = blendMode;
      system.emitter = emitter;
      const shape = system.createSphereEmitter(0.2, 1);
      shape.directionRandomizer = 0.4;
      system.emitRate = 0;
      system.targetStopDuration = 0.04;
      system.minAngularSpeed = -3;
      system.maxAngularSpeed = 3;
      system.updateSpeed = 1 / 60;
      system.color1 = new Color4(1, 1, 1, 1);
      system.color2 = new Color4(1, 1, 1, 1);
      system.colorDead = new Color4(1, 1, 1, 0);
      pool.slots.push({ system, emitter, shape, startedAt: 0, activeUntil: 0 });
    }
    return pool;
  }

  private burst(
    pool: ParticlePool,
    x: number,
    h: number,
    z: number,
    frames: Frames,
    color1: string,
    color2: string,
    count: number,
    radius: number,
    minLife: number,
    maxLife: number,
    minSize: number,
    maxSize: number,
    minPower: number,
    maxPower: number,
    lift: number,
  ): void {
    if (count <= 0) return;
    const index = pickPoolSlot(pool.slots, this.clock, pool.next);
    const slot = pool.slots[index]!;
    pool.next = (index + 1) % pool.slots.length;
    slot.startedAt = this.clock;
    slot.activeUntil = this.clock + maxLife + 0.05;
    slot.system.stop();
    slot.system.reset();
    slot.emitter.set(x, h, z);
    slot.shape.radius = radius;
    this.setFrames(slot.system, frames);
    slot.system.minLifeTime = minLife;
    slot.system.maxLifeTime = maxLife;
    slot.system.minSize = minSize;
    slot.system.maxSize = maxSize;
    slot.system.minEmitPower = minPower;
    slot.system.maxEmitPower = maxPower;
    slot.system.gravity.set(0, lift, 0);
    setColor(slot.system.color1, color1, 1);
    setColor(slot.system.color2, color2, 0.9);
    setColor(slot.system.colorDead, color2, 0);
    slot.system.manualEmitCount = count;
    slot.system.start();
  }

  private setFrames(system: ParticleSystem, frames: Frames): void {
    const first = FRAMES.indexOf(frames) * FRAME_COUNT;
    system.startSpriteCellID = first;
    system.endSpriteCellID = first + FRAME_COUNT - 1;
  }

  private disposePool(pool: ParticlePool): void {
    for (const slot of pool.slots) slot.system.dispose(false);
    pool.slots.length = 0;
  }
}
