// Placeholder looks for abilities (the final art comes in Phase 9). Every ability must be easy
// to see: a ground ring or disc in the hero's color, a burst of sprite particles from the
// effects atlas, flying bolts for line shots, and small markers on units that have a buff.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateTorus } from '@babylonjs/core/Meshes/Builders/torusBuilder';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import { BuffFlag } from '@game/shared';
import { c4, CELL, effectsAtlas, FRAMES, type Frames } from './hero-effects';

/** Look per hero: ring color and particle frames. */
export const HERO_FX: Record<string, { color: string; frames: Frames; color2: string }> = {
  blood_witch: { color: '#e0232f', frames: 'blood', color2: '#5a0008' },
  staff_warrior: { color: '#ffd35a', frames: 'spark', color2: '#ff8a1a' },
  sky_dragon: { color: '#ff7a1a', frames: 'fire', color2: '#a01a00' },
  stone_golem: { color: '#c9a77a', frames: 'dust', color2: '#6a5236' },
  light_healer: { color: '#fff3a8', frames: 'heal', color2: '#7dff9a' },
  arcane_huntress: { color: '#b07bff', frames: 'arcane', color2: '#3a1aa0' },
  centaur_raider: { color: '#f0b46a', frames: 'dust', color2: '#8a5a24' },
  forest_elf: { color: '#5fe07a', frames: 'nature', color2: '#1f6a2a' },
  monster: { color: '#ffb347', frames: 'smoke', color2: '#5a4630' },
};

interface Flash {
  mesh: Mesh;
  born: number;
  life: number;
  /** grow from this scale to `to` */
  from: number;
  to: number;
  alpha: number;
  active: boolean;
  /** a zone stays at full strength until near its end */
  hold: boolean;
  owner: number;
}

interface Bolt {
  mesh: Mesh;
  x: number;
  y: number;
  h: number;
  dx: number;
  dy: number;
  left: number;
  speed: number;
  active: boolean;
}

interface Marker {
  meshes: Map<number, AbstractMesh>;
}

const MARKERS: { flag: number; color: string; head: boolean; size: number }[] = [
  { flag: BuffFlag.Stun, color: '#ffe14a', head: true, size: 0.5 },
  { flag: BuffFlag.Root, color: '#45d14a', head: false, size: 0.9 },
  { flag: BuffFlag.Slow, color: '#6aa8ff', head: false, size: 1.1 },
  { flag: BuffFlag.Shield, color: '#d8f0ff', head: false, size: 1.35 },
  { flag: BuffFlag.Blessed, color: '#ffd35a', head: false, size: 1.2 },
  { flag: BuffFlag.Marked, color: '#b07bff', head: true, size: 0.35 },
  { flag: BuffFlag.Burning, color: '#ff4a2a', head: false, size: 0.75 },
  { flag: BuffFlag.Taunted, color: '#ff2a2a', head: true, size: 0.45 },
  { flag: BuffFlag.Channel, color: '#c08bff', head: false, size: 1.6 },
  // Only the owner's team gets invisible units, so this shows "you are hidden".
  { flag: BuffFlag.Invisible, color: '#8f86a8', head: false, size: 1.0 },
];

export class AbilityFx {
  private readonly flashes: Flash[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly bursts: ParticleSystem[] = [];
  private nextBurst = 0;
  private readonly mats = new Map<string, StandardMaterial>();
  private readonly ringTemplate: Mesh;
  private readonly discTemplate: Mesh;
  private readonly markerTemplates = new Map<number, Mesh>();
  private readonly markers = new Map<number, Marker>();

  constructor(private readonly scene: Scene) {
    this.ringTemplate = CreateTorus('fx-ring', { diameter: 2, thickness: 0.12, tessellation: 48 }, scene);
    this.ringTemplate.setEnabled(false);
    this.discTemplate = CreateDisc('fx-disc', { radius: 1, tessellation: 40 }, scene);
    this.discTemplate.rotation.x = Math.PI / 2;
    this.discTemplate.bakeCurrentTransformIntoVertices();
    this.discTemplate.setEnabled(false);
    for (let i = 0; i < 10; i++) {
      const ps = new ParticleSystem(`fx-burst-${i}`, 120, scene, null, true);
      ps.particleTexture = effectsAtlas(scene);
      ps.spriteCellWidth = CELL;
      ps.spriteCellHeight = CELL;
      ps.spriteCellChangeSpeed = 1;
      ps.spriteCellLoop = false;
      ps.blendMode = ParticleSystem.BLENDMODE_ADD;
      ps.emitRate = 0;
      ps.minLifeTime = 0.4;
      ps.maxLifeTime = 0.9;
      ps.minAngularSpeed = -2;
      ps.maxAngularSpeed = 2;
      ps.emitter = new Vector3();
      ps.updateSpeed = 1 / 60;
      ps.start();
      this.bursts.push(ps);
    }
    for (const m of MARKERS) {
      const t = CreateTorus(`fx-marker-${m.flag}`, { diameter: 2, thickness: m.head ? 0.16 : 0.1, tessellation: 32 }, scene);
      t.material = this.mat(m.color, 0.75);
      t.isPickable = false;
      t.setEnabled(false);
      this.markerTemplates.set(m.flag, t);
    }
  }

  private mat(color: string, alpha: number): StandardMaterial {
    const key = `${color}:${alpha}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`fx-${key}`, this.scene);
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(color);
      m.alpha = alpha;
      m.backFaceCulling = false;
      m.disableDepthWrite = true;
      // Ground effects must show over bumpy ground.
      m.depthFunction = Constants.ALWAYS;
      this.mats.set(key, m);
    }
    return m;
  }

  /** A ring that grows and fades (an area hit). */
  ring(x: number, h: number, z: number, radius: number, color: string, life = 0.5): void {
    this.flash(this.ringTemplate, x, h, z, radius * 0.4, radius, color, 0.9, life, false, 0);
  }

  /** A flat disc on the ground for a while (zones), or a quick flash (life < 0.6). */
  disc(x: number, h: number, z: number, radius: number, color: string, life: number, owner = 0): void {
    const zone = life > 0.8;
    this.flash(this.discTemplate, x, h, z, radius, radius, color, zone ? 0.32 : 0.45, life, zone, owner);
    if (zone) this.flash(this.ringTemplate, x, h, z, radius, radius, color, 0.8, life, true, owner);
  }

  /** A cone flash (Fire Breath): a disc slice pointing at `angle` (radians, game space). */
  cone(x: number, h: number, z: number, length: number, angleDeg: number, dir: number, color: string): void {
    const arc = angleDeg / 360;
    const mesh = CreateDisc('fx-cone', { radius: length, arc, tessellation: 24 }, this.scene);
    mesh.material = this.mat(color, 0.5);
    mesh.isPickable = false;
    mesh.position.set(x, h, z);
    // Disc lies in XY: turn it flat, then aim its arc center along dir.
    mesh.rotation.set(Math.PI / 2, 0, 0);
    mesh.rotation.y = dir + arc * Math.PI;
    this.flashes.push({ mesh, born: performance.now(), life: 0.5, from: 1, to: 1, alpha: 0.5, active: true, hold: false, owner: -1 });
  }

  private flash(
    template: Mesh,
    x: number,
    h: number,
    z: number,
    from: number,
    to: number,
    color: string,
    alpha: number,
    life: number,
    hold: boolean,
    owner: number,
  ): void {
    let f = this.flashes.find((x) => !x.active && x.mesh.name.startsWith(template.name));
    if (!f) {
      const mesh = template.clone(`${template.name}-c`, null, true)!;
      mesh.isPickable = false;
      f = { mesh, born: 0, life, from, to, alpha, active: false, hold, owner };
      this.flashes.push(f);
    }
    f.mesh.material = this.mat(color, 1);
    f.mesh.setEnabled(true);
    f.mesh.position.set(x, h + 0.12, z);
    Object.assign(f, { born: performance.now(), life, from, to, alpha, active: true, hold, owner });
  }

  /** Stop the zones of one caster (a channel ended early). */
  endZones(owner: number): void {
    for (const f of this.flashes)
      if (f.active && f.hold && f.owner === owner) f.life = Math.min(f.life, (performance.now() - f.born) / 1000 + 0.2);
  }

  /** A burst of sprite particles. */
  burst(x: number, h: number, z: number, frames: Frames, color1: string, color2: string, count = 30, radius = 0.6, speed = 2): void {
    const ps = this.bursts[this.nextBurst++ % this.bursts.length]!;
    (ps.emitter as Vector3).set(x, h, z);
    const k = FRAMES.indexOf(frames) * 4;
    ps.startSpriteCellID = k;
    ps.endSpriteCellID = k + 3;
    ps.createSphereEmitter(radius, 1);
    ps.minEmitPower = speed * 0.4;
    ps.maxEmitPower = speed;
    ps.minSize = 0.35;
    ps.maxSize = 0.8;
    ps.gravity.set(0, 1.5, 0);
    ps.color1 = c4(color1);
    ps.color2 = c4(color2);
    ps.colorDead = c4(color2, 0);
    ps.manualEmitCount = count;
  }

  /** A glowing bolt flying in a straight line (Arcane Arrow, Spear Throw). */
  bolt(x: number, y: number, h: number, ex: number, ey: number, speed: number, color: string): void {
    let b = this.bolts.find((x) => !x.active);
    if (!b) {
      const mesh = CreateBox('fx-bolt', { width: 0.18, height: 0.18, depth: 1.4 }, this.scene);
      mesh.isPickable = false;
      b = { mesh, x: 0, y: 0, h: 0, dx: 0, dy: 0, left: 0, speed: 0, active: false };
      this.bolts.push(b);
    }
    const d = Math.hypot(ex - x, ey - y) || 1;
    Object.assign(b, { x, y, h, dx: (ex - x) / d, dy: (ey - y) / d, left: d, speed, active: true });
    b.mesh.material = this.mat(color, 1);
    b.mesh.setEnabled(true);
    b.mesh.rotation.y = Math.atan2(b.dx, -b.dy) + Math.PI;
  }

  /** Buff markers: one ring per buff bit, under the feet or over the head. */
  setMarkers(id: number, flags: number, x: number, ground: number, top: number, z: number, scale: number): void {
    let m = this.markers.get(id);
    if (!flags && !m) return;
    if (!m) this.markers.set(id, (m = { meshes: new Map() }));
    const spin = performance.now() / 400;
    for (const spec of MARKERS) {
      let mesh = m.meshes.get(spec.flag);
      if (!(flags & spec.flag)) {
        if (mesh) {
          mesh.dispose();
          m.meshes.delete(spec.flag);
        }
        continue;
      }
      if (!mesh) {
        const inst = this.markerTemplates.get(spec.flag)!.createInstance(`marker-${id}-${spec.flag}`);
        inst.isPickable = false;
        m.meshes.set(spec.flag, inst);
        mesh = inst;
      }
      const s = spec.size * scale;
      mesh.scaling.set(s, 1, s);
      mesh.position.set(x, spec.head ? top + 0.35 : ground + 0.1, z);
      mesh.rotation.y = spec.head ? spin * 2 : spin * 0.5;
    }
    if (!m.meshes.size) this.markers.delete(id);
  }

  clearMarkers(id: number): void {
    const m = this.markers.get(id);
    if (!m) return;
    for (const mesh of m.meshes.values()) mesh.dispose();
    this.markers.delete(id);
  }

  update(dt: number): void {
    const now = performance.now();
    for (const f of this.flashes) {
      if (!f.active) continue;
      const t = (now - f.born) / 1000 / f.life;
      if (t >= 1) {
        f.active = false;
        if (f.owner === -1) f.mesh.dispose();
        else f.mesh.setEnabled(false);
        continue;
      }
      const s = f.from + (f.to - f.from) * Math.min(1, t * 2);
      f.mesh.scaling.set(s, 1, s);
      const fade = f.hold ? (t > 0.85 ? (1 - t) / 0.15 : 1) : 1 - t;
      f.mesh.visibility = f.alpha * fade;
      if (f.hold) f.mesh.rotation.y += dt * 0.6;
    }
    // Drop finished one-time meshes (cones) from the list, without making a new array.
    let w = 0;
    for (const f of this.flashes) if (f.active || f.owner !== -1) this.flashes[w++] = f;
    this.flashes.length = w;
    for (const b of this.bolts) {
      if (!b.active) continue;
      const step = b.speed * dt;
      b.x += b.dx * step;
      b.y += b.dy * step;
      b.left -= step;
      if (b.left <= 0) {
        b.active = false;
        b.mesh.setEnabled(false);
        continue;
      }
      b.mesh.position.set(b.x, b.h, -b.y);
    }
  }
}
