// What a unit has on it, drawn in the world so it reads at a glance (also on enemies):
// - buff markers: orbiting stars for a stun, an eye for a mark, thorns for a root, a frost ring
//   for a slow, a bubble for a shield... (from the BuffFlag bits every unit sends);
// - aura circles: a slowly turning rune circle under a hero that has learned an aura or carries
//   an aura item, as big as the aura;
// - item glows: a few light motes around a hero that carries a rare or legendary item.
// Markers are instances of one template per kind (one draw call per kind). Aura circles and item
// glows exist only for heroes (a handful).

import { Constants } from '@babylonjs/core/Engines/constants';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import { CreatePlane } from '@babylonjs/core/Meshes/Builders/planeBuilder';
import { CreateSphere } from '@babylonjs/core/Meshes/Builders/sphereBuilder';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/instancedMesh';
import { ParticleSystem } from '@babylonjs/core/Particles/particleSystem';
import type { Scene } from '@babylonjs/core/scene';
import { abilityIndex, ABILITIES, BuffFlag, gameData, ITEMS } from '@game/shared';
import { fxTexture, type FxShape } from './fx-textures';

type Place = 'ground' | 'orbit' | 'head' | 'body' | 'bubble';

interface MarkerSpec {
  flag: number;
  shape: FxShape;
  color: string;
  place: Place;
  /** times the unit's marker scale */
  size: number;
  /** turns per second (ground and orbit) */
  spin: number;
  /** soft pulse of the size */
  pulse: number;
  alpha: number;
}

const MARKERS: MarkerSpec[] = [
  { flag: BuffFlag.Stun, shape: 'stars', color: '#ffe14a', place: 'orbit', size: 0.75, spin: 0.9, pulse: 0, alpha: 1 },
  { flag: BuffFlag.Root, shape: 'thorns', color: '#5fdc4a', place: 'ground', size: 1.0, spin: 0, pulse: 0.04, alpha: 0.9 },
  { flag: BuffFlag.Slow, shape: 'ring', color: '#7ab8ff', place: 'ground', size: 1.15, spin: 0, pulse: 0.06, alpha: 0.85 },
  { flag: BuffFlag.Burning, shape: 'glow', color: '#ff6a2a', place: 'body', size: 1.2, spin: 0, pulse: 0.18, alpha: 0.75 },
  { flag: BuffFlag.Marked, shape: 'eye', color: '#c48bff', place: 'head', size: 0.5, spin: 0, pulse: 0.08, alpha: 1 },
  { flag: BuffFlag.Taunted, shape: 'alert', color: '#ff3a2a', place: 'head', size: 0.45, spin: 0, pulse: 0.1, alpha: 1 },
  { flag: BuffFlag.Silence, shape: 'ring', color: '#b07bff', place: 'orbit', size: 0.55, spin: 0.4, pulse: 0.05, alpha: 0.9 },
  { flag: BuffFlag.Magnetized, shape: 'rune', color: '#9aef52', place: 'ground', size: 1.4, spin: -0.3, pulse: 0, alpha: 0.8 },
  { flag: BuffFlag.Shield, shape: 'glow', color: '#cfe8ff', place: 'bubble', size: 1.0, spin: 0, pulse: 0.03, alpha: 0.18 },
  { flag: BuffFlag.Blessed, shape: 'ring', color: '#ffd35a', place: 'ground', size: 1.3, spin: 0, pulse: 0.08, alpha: 0.9 },
  { flag: BuffFlag.Channel, shape: 'rune', color: '#c08bff', place: 'ground', size: 1.6, spin: 0.35, pulse: 0, alpha: 0.85 },
  // Only the owner's team gets invisible units, so this shows "you are hidden".
  { flag: BuffFlag.Invisible, shape: 'ring', color: '#a89cc8', place: 'ground', size: 1.0, spin: 0, pulse: 0.1, alpha: 0.5 },
];

/** Glows of special items: motes around the hero in the item's colors. */
interface ItemLook {
  color1: string;
  color2: string;
  /** body: around the chest; head: a halo; feet: along the ground */
  at: 'body' | 'head' | 'feet';
  shape: FxShape;
  rate: number;
}

const ITEM_LOOKS: Record<string, ItemLook> = {
  vampire_fang: { color1: '#ff2a3a', color2: '#5a0010', at: 'body', shape: 'glow', rate: 10 },
  bloodletter_axe: { color1: '#e0232f', color2: '#4a0008', at: 'body', shape: 'glow', rate: 7 },
  frost_orb: { color1: '#bfe8ff', color2: '#3a7ad0', at: 'body', shape: 'spark', rate: 9 },
  storm_hammer: { color1: '#e8f4ff', color2: '#4a7aff', at: 'body', shape: 'spark', rate: 12 },
  phoenix_feather: { color1: '#ffd36a', color2: '#ff4a10', at: 'body', shape: 'glow', rate: 10 },
  temple_crown: { color1: '#fff0a0', color2: '#d8a020', at: 'head', shape: 'spark', rate: 8 },
  crown_of_ages: { color1: '#fff6c0', color2: '#e0b030', at: 'head', shape: 'spark', rate: 10 },
  royal_circlet: { color1: '#ffe9a0', color2: '#c09030', at: 'head', shape: 'spark', rate: 4 },
  kingslayer: { color1: '#ff8a5a', color2: '#8a1a10', at: 'body', shape: 'spark', rate: 9 },
  sky_piercer: { color1: '#9ff4ff', color2: '#1a8ab0', at: 'body', shape: 'spark', rate: 9 },
  archmage_scepter: { color1: '#d6a8ff', color2: '#5a2ab0', at: 'body', shape: 'glow', rate: 10 },
  titan_aegis: { color1: '#fff8e0', color2: '#c0a060', at: 'feet', shape: 'glow', rate: 8 },
  dawn_relic: { color1: '#fff3b0', color2: '#ffb040', at: 'head', shape: 'glow', rate: 8 },
  windrunner_boots: { color1: '#d8fff0', color2: '#4ac0a0', at: 'feet', shape: 'glow', rate: 6 },
};

/** At most this many item glows per hero (the most valuable items win). */
const MAX_LOOKS = 2;

/** Colors of aura circles (abilities: the caster's look color; items: their own). */
const ITEM_AURA_COLORS: Record<string, string> = {
  guardian_shield: '#9fd0ff',
  banner_of_valor: '#ffb84a',
  healers_censer: '#8dffb0',
  soul_lantern: '#7fe8d8',
  dawn_relic: '#fff0a0',
};

interface MarkerSet {
  meshes: Map<number, AbstractMesh>;
}

interface HeroLooks {
  circle: Mesh | null;
  circleKey: string;
  glows: { id: string; ps: ParticleSystem; look: ItemLook }[];
  glowKey: string;
  seen: number;
}

const tmp = new Vector3();

/** The aura circle a hero should show: radius and color, or null. */
function auraOf(heroDef: { abilities: string[] } | undefined, levels: readonly number[], items: readonly number[], heroColor: string) {
  let best: { radius: number; color: string } | null = null;
  heroDef?.abilities.forEach((aid, slot) => {
    const a = ABILITIES[abilityIndex(aid)];
    if (!a || a.kind !== 'aura' || !(levels[slot] ?? 0)) return;
    const r = Number(a.params['radius'] ?? 0);
    if (r > 0 && (!best || r > best.radius)) best = { radius: r, color: heroColor };
  });
  for (const code of items) {
    const def = code ? ITEMS[code - 1] : undefined;
    const aura = (def as { aura?: { radius?: number } } | undefined)?.aura;
    if (!def || !aura?.radius) continue;
    if (!best || aura.radius > best.radius) best = { radius: aura.radius, color: ITEM_AURA_COLORS[def.id] ?? '#ffe9a0' };
  }
  return best as { radius: number; color: string } | null;
}

export class StatusFx {
  private readonly templates = new Map<number, Mesh>();
  private readonly markers = new Map<number, MarkerSet>();
  private readonly heroes = new Map<number, HeroLooks>();
  private readonly circleMats = new Map<string, StandardMaterial>();
  private circleTemplate: Mesh;
  private stamp = 0;

  constructor(private readonly scene: Scene) {
    for (const m of MARKERS) this.templates.set(m.flag, this.makeTemplate(m));
    this.circleTemplate = CreateGround('fx-aura-circle', { width: 2, height: 2 }, scene);
    this.circleTemplate.isPickable = false;
    this.circleTemplate.setEnabled(false);
  }

  private material(name: string, shape: FxShape, color: string, alpha: number, additive = true): StandardMaterial {
    const mat = new StandardMaterial(name, this.scene);
    const tex = fxTexture(this.scene, shape);
    // Unlit: color = emissive color x diffuse texture (an emissive texture would be added instead).
    mat.disableLighting = true;
    mat.emissiveColor = Color3.FromHexString(color);
    mat.diffuseTexture = tex;
    mat.specularColor.set(0, 0, 0);
    mat.opacityTexture = tex;
    mat.alpha = alpha;
    mat.backFaceCulling = false;
    mat.disableDepthWrite = true;
    if (additive) mat.alphaMode = Constants.ALPHA_ADD;
    return mat;
  }

  private makeTemplate(m: MarkerSpec): Mesh {
    const name = `fx-status-${m.flag}`;
    let mesh: Mesh;
    if (m.place === 'bubble') {
      mesh = CreateSphere(name, { diameter: 2, segments: 12 }, this.scene);
      const mat = new StandardMaterial(name, this.scene);
      mat.disableLighting = true;
      mat.emissiveColor = Color3.FromHexString(m.color);
      mat.alpha = m.alpha;
      mat.alphaMode = Constants.ALPHA_ADD;
      mat.disableDepthWrite = true;
      mat.backFaceCulling = true;
      mesh.material = mat;
    } else if (m.place === 'head' || m.place === 'body') {
      mesh = CreatePlane(name, { size: 2 }, this.scene);
      mesh.billboardMode = Mesh.BILLBOARDMODE_ALL;
      mesh.material = this.material(name, m.shape, m.color, m.alpha);
    } else {
      mesh = CreateGround(name, { width: 2, height: 2 }, this.scene);
      const mat = this.material(name, m.shape, m.color, m.alpha);
      // Ground marks lie on bumpy ground: pull them toward the camera a little.
      if (m.place === 'ground') mat.zOffset = -2;
      mesh.material = mat;
    }
    mesh.isPickable = false;
    mesh.setEnabled(false);
    return mesh;
  }

  /** Call once per frame before the units. */
  begin(): void {
    this.stamp++;
  }

  /** Buff markers of one unit (BuffFlag bits); flags 0 removes them. */
  setMarkers(id: number, flags: number, x: number, ground: number, top: number, z: number, scale: number): void {
    let set = this.markers.get(id);
    if (!flags && !set) return;
    if (!set) this.markers.set(id, (set = { meshes: new Map() }));
    const t = performance.now() / 1000;
    for (const spec of MARKERS) {
      let mesh = set.meshes.get(spec.flag);
      if (!(flags & spec.flag)) {
        if (mesh) {
          mesh.dispose();
          set.meshes.delete(spec.flag);
        }
        continue;
      }
      if (!mesh) {
        mesh = this.templates.get(spec.flag)!.createInstance(`status-${id}-${spec.flag}`);
        mesh.isPickable = false;
        set.meshes.set(spec.flag, mesh);
      }
      const pulse = 1 + spec.pulse * Math.sin(t * 6 + id);
      const s = spec.size * scale * pulse;
      switch (spec.place) {
        case 'ground':
          mesh.scaling.set(s, 1, s);
          mesh.position.set(x, ground + 0.12, z);
          mesh.rotation.y = t * spec.spin * Math.PI * 2;
          break;
        case 'orbit':
          mesh.scaling.set(s, 1, s);
          mesh.position.set(x, top + 0.3, z);
          mesh.rotation.y = t * spec.spin * Math.PI * 2;
          break;
        case 'head':
          mesh.scaling.set(s, s, s);
          mesh.position.set(x, top + 0.55 + 0.05 * Math.sin(t * 3), z);
          break;
        case 'body':
          mesh.scaling.set(s * (0.9 + 0.2 * Math.sin(t * 13 + id)), s, s);
          mesh.position.set(x, (ground + top) / 2, z);
          break;
        case 'bubble': {
          const r = Math.max(0.7, (top - ground) * 0.62) * pulse;
          mesh.scaling.set(r * scale, r, r * scale);
          mesh.position.set(x, (ground + top) / 2, z);
          break;
        }
      }
    }
    if (!set.meshes.size) this.markers.delete(id);
  }

  clearMarkers(id: number): void {
    const set = this.markers.get(id);
    if (!set) return;
    for (const mesh of set.meshes.values()) mesh.dispose();
    this.markers.delete(id);
  }

  /** The unit left the game or the view. */
  remove(id: number): void {
    this.clearMarkers(id);
    this.clearHero(id);
  }

  /**
   * A visible hero: its aura circle and item glows. `heroId` = model id (hero def id),
   * `levels` and `items` from its hero block.
   */
  setHero(
    id: number,
    heroId: string,
    levels: readonly number[],
    items: readonly number[],
    color: string,
    x: number,
    ground: number,
    top: number,
    z: number,
  ): void {
    let h = this.heroes.get(id);
    if (!h) this.heroes.set(id, (h = { circle: null, circleKey: '', glows: [], glowKey: '', seen: 0 }));
    h.seen = this.stamp;
    // Aura circle
    const def = gameData.heroes.find((d) => d.id === heroId);
    const aura = auraOf(def, levels, items, color);
    const key = aura ? `${aura.radius}/${aura.color}` : '';
    if (key !== h.circleKey) {
      h.circleKey = key;
      h.circle?.dispose();
      h.circle = null;
      if (aura) {
        const mesh = this.circleTemplate.clone(`aura-${id}`, null, true)!;
        mesh.material = this.circleMaterial(aura.color);
        mesh.scaling.set(aura.radius, 1, aura.radius);
        mesh.setEnabled(true);
        h.circle = mesh;
      }
    }
    if (h.circle) {
      h.circle.position.set(x, ground + 0.15, z);
      h.circle.rotation.y = (performance.now() / 1000) * 0.25;
    }
    // Item glows: the most valuable looks first.
    const looks = items
      .map((code) => (code ? ITEMS[code - 1] : undefined))
      .filter((d): d is NonNullable<typeof d> => !!d && !!ITEM_LOOKS[d.id])
      .sort((a, b) => (b.cost ?? 5000) - (a.cost ?? 5000))
      .slice(0, MAX_LOOKS)
      .map((d) => d.id);
    const glowKey = looks.join(',');
    if (glowKey !== h.glowKey) {
      h.glowKey = glowKey;
      for (const g of h.glows) g.ps.dispose(false);
      h.glows = looks.map((itemId) => ({ id: itemId, look: ITEM_LOOKS[itemId]!, ps: this.makeGlow(ITEM_LOOKS[itemId]!) }));
    }
    const height = top - ground;
    for (const g of h.glows) {
      const e = g.ps.emitter as Vector3;
      if (g.look.at === 'head') e.set(x, top + 0.15, z);
      else if (g.look.at === 'feet') e.set(x, ground + 0.15, z);
      else e.set(x, ground + height * 0.55, z);
    }
  }

  private circleMaterial(color: string): StandardMaterial {
    let m = this.circleMats.get(color);
    if (!m) {
      m = this.material(`fx-aura-${color}`, 'rune', color, 0.2);
      m.zOffset = -3;
      this.circleMats.set(color, m);
    }
    return m;
  }

  private makeGlow(look: ItemLook): ParticleSystem {
    const ps = new ParticleSystem('item-glow', 40, this.scene);
    ps.particleTexture = fxTexture(this.scene, look.shape);
    ps.emitter = new Vector3();
    ps.blendMode = ParticleSystem.BLENDMODE_ADD;
    const c1 = Color4.FromHexString(`${look.color1}ff`);
    const c2 = Color4.FromHexString(`${look.color2}cc`);
    ps.color1 = c1;
    ps.color2 = c2;
    ps.colorDead = new Color4(c2.r, c2.g, c2.b, 0);
    ps.minSize = look.shape === 'spark' ? 0.2 : 0.22;
    ps.maxSize = look.shape === 'spark' ? 0.4 : 0.45;
    ps.minLifeTime = 0.6;
    ps.maxLifeTime = 1.2;
    ps.emitRate = look.rate * 1.5;
    const r = look.at === 'head' ? 0.35 : look.at === 'feet' ? 0.6 : 0.45;
    ps.createCylinderEmitter(r, look.at === 'feet' ? 0.05 : 0.4, 0.2, 0);
    ps.minEmitPower = 0.1;
    ps.maxEmitPower = 0.35;
    ps.gravity = tmp.set(0, look.at === 'feet' ? 0.6 : 0.9, 0).clone();
    ps.minAngularSpeed = -2;
    ps.maxAngularSpeed = 2;
    ps.updateSpeed = 1 / 60;
    ps.start();
    return ps;
  }

  private clearHero(id: number): void {
    const h = this.heroes.get(id);
    if (!h) return;
    h.circle?.dispose();
    for (const g of h.glows) g.ps.dispose(false);
    this.heroes.delete(id);
  }

  /** Call once per frame after the units: heroes that were not drawn this frame lose their looks. */
  end(): void {
    for (const [id, h] of this.heroes) if (h.seen !== this.stamp) this.clearHero(id);
  }

  dispose(): void {
    for (const id of [...this.markers.keys()]) this.clearMarkers(id);
    for (const id of [...this.heroes.keys()]) this.clearHero(id);
    this.circleTemplate.material = null;
    for (const t of this.templates.values()) {
      t.material?.dispose();
      t.dispose();
    }
    for (const m of this.circleMats.values()) m.dispose();
    this.circleTemplate.dispose();
  }
}
