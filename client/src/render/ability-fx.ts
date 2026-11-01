// Placeholder looks for abilities (the final art comes in Phase 9). Every ability must be easy
// to see: a ground ring or disc in the hero's color, a burst of sprite particles from the
// effects atlas and flying bolts for line shots. Buff markers are in status-fx.ts.

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateDisc } from '@babylonjs/core/Meshes/Builders/discBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import { fxTexture, type FxShape } from './fx-textures';
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
  earth_spirit: { color: '#9aef52', frames: 'dust', color2: '#598641' },
  thorn_marshal: { color: '#8ce65a', frames: 'nature', color2: '#c6a154' },
  grave_bellkeeper: { color: '#63ebd3', frames: 'arcane', color2: '#496b9e' },
  tidebreaker: { color: '#71dafa', frames: 'frost', color2: '#2b72b5' },
  lantern_monk: { color: '#ffe4a1', frames: 'heal', color2: '#79dba1' },
  obsidian_heart: { color: '#ffad42', frames: 'fire', color2: '#e13c19' },
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

export class AbilityFx {
  private readonly flashes: Flash[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly bursts: ParticleSystem[] = [];
  private nextBurst = 0;
  private readonly mats = new Map<string, StandardMaterial>();
  private readonly ringTemplate: Mesh;
  private readonly discTemplate: Mesh;
  private readonly zoneTemplate: Mesh;
  /** which painted shape each ground template shows (fx-textures.ts) */
  private readonly shapes = new Map<Mesh, FxShape>();

  constructor(private readonly scene: Scene) {
    // Flat squares with soft painted shapes: a glowing ring, a round glow, a rune circle.
    const ground = (name: string, shape: FxShape) => {
      const mesh = CreateGround(name, { width: 2, height: 2 }, scene);
      mesh.setEnabled(false);
      this.shapes.set(mesh, shape);
      return mesh;
    };
    this.ringTemplate = ground('fx-ring', 'ring');
    this.discTemplate = ground('fx-disc', 'glow');
    this.zoneTemplate = ground('fx-zone', 'rune');
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
      // Emit once, then let the tail finish and stop updating this idle pool slot.
      ps.targetStopDuration = 0.05;
      ps.minAngularSpeed = -2;
      ps.maxAngularSpeed = 2;
      ps.emitter = new Vector3();
      ps.updateSpeed = 1 / 60;
      this.bursts.push(ps);
    }
  }

  /** A glowing material: a color, painted through one of the soft shapes. */
  private mat(color: string, shape: FxShape): StandardMaterial {
    const key = `${color}:${shape}`;
    let m = this.mats.get(key);
    if (!m) {
      m = new StandardMaterial(`fx-${key}`, this.scene);
      const tex = fxTexture(this.scene, shape);
      // Unlit: color = emissive color x diffuse texture (an emissive texture would be added instead).
      m.disableLighting = true;
      m.emissiveColor = Color3.FromHexString(color);
      m.diffuseTexture = tex;
      m.specularColor.set(0, 0, 0);
      m.opacityTexture = tex;
      // Normal blending keeps the hero's color on bright grass and stone (adding light turns
      // orange fire into a pale white flash there).
      m.alphaMode = Constants.ALPHA_COMBINE;
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

  /** Where a move or attack order goes: a small ring that shrinks onto the point. */
  orderMark(x: number, h: number, z: number, color: string): void {
    this.flash(this.ringTemplate, x, h, z, 0.75, 0.2, color, 0.95, 0.4, false, 0);
  }

  /** A flat disc on the ground for a while (zones), or a quick flash (life < 0.6). */
  disc(x: number, h: number, z: number, radius: number, color: string, life: number, owner = 0): void {
    const zone = life > 0.8;
    // A zone is a turning rune circle with a faint glow; a quick hit is a soft flash.
    this.flash(this.discTemplate, x, h, z, radius, radius, color, zone ? 0.22 : 0.7, life, zone, owner);
    if (zone) this.flash(this.zoneTemplate, x, h, z, radius, radius, color, 0.85, life, true, owner);
  }

  /** A cone flash (Fire Breath): a disc slice pointing at `angle` (radians, game space). */
  cone(x: number, h: number, z: number, length: number, angleDeg: number, dir: number, color: string): void {
    const arc = angleDeg / 360;
    const mesh = CreateDisc('fx-cone', { radius: length, arc, tessellation: 24 }, this.scene);
    mesh.material = this.mat(color, 'glow');
    mesh.isPickable = false;
    mesh.position.set(x, h, z);
    // Disc lies in XY: turn it flat, then aim its arc center along dir.
    mesh.rotation.set(Math.PI / 2, 0, 0);
    mesh.rotation.y = dir + arc * Math.PI;
    this.flashes.push({ mesh, born: performance.now(), life: 0.5, from: 1, to: 1, alpha: 0.9, active: true, hold: false, owner: -1 });
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
    f.mesh.material = this.mat(color, this.shapes.get(template) ?? 'glow');
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
    ps.start();
  }

  /** A glowing bolt flying in a straight line (Arcane Arrow, Spear Throw). */
  bolt(x: number, y: number, h: number, ex: number, ey: number, speed: number, color: string): void {
    let b = this.bolts.find((x) => !x.active);
    if (!b) {
      // A flat streak of light along the flight line (the camera looks down at it).
      const mesh = CreateGround('fx-bolt', { width: 0.7, height: 2.2 }, this.scene);
      mesh.isPickable = false;
      b = { mesh, x: 0, y: 0, h: 0, dx: 0, dy: 0, left: 0, speed: 0, active: false };
      this.bolts.push(b);
    }
    const d = Math.hypot(ex - x, ey - y) || 1;
    Object.assign(b, { x, y, h, dx: (ex - x) / d, dy: (ey - y) / d, left: d, speed, active: true });
    b.mesh.material = this.mat(color, 'glow');
    b.mesh.setEnabled(true);
    b.mesh.position.set(x, h, -y);
    b.mesh.rotation.y = Math.atan2(b.dx, -b.dy) + Math.PI;
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

  dispose(): void {
    for (const ps of this.bursts) ps.dispose(false);
    for (const f of this.flashes) f.mesh.dispose();
    for (const b of this.bolts) b.mesh.dispose();
    this.ringTemplate.dispose();
    this.discTemplate.dispose();
    this.zoneTemplate.dispose();
    for (const mat of this.mats.values()) mat.dispose();
    this.flashes.length = 0;
    this.bolts.length = 0;
    this.bursts.length = 0;
    this.mats.clear();
  }
}
