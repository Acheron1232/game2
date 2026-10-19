// The game world on screen: terrain, water, trees, buildings, the player's hero, camera, lights.
// Until Phase 6 the hero moves locally (the same movement code the server will run).

import { AnimationPropertiesOverride } from '@babylonjs/core/Animations/animationPropertiesOverride';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ShadowGenerator } from '@babylonjs/core/Lights/Shadows/shadowGenerator';
import '@babylonjs/core/Lights/Shadows/shadowGeneratorSceneComponent';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import { Scene } from '@babylonjs/core/scene';
import {
  blockRect,
  buildNavGrid,
  createMover,
  findPath,
  gameData,
  isMoving,
  stepMover,
  type Mover,
  type NavGrid,
  type TerrainGrid,
} from '@game/shared';
import selectionRingUrl from '../assets/ui/selection_ring.webp?url';
import type { GameAssets } from '../loader/assets';
import { attachHeroEffects, type HeroEffects } from './hero-effects';
import { ModelLibrary, type ModelInstance } from './model-library';
import { RtsCamera, TILT } from './rts-camera';
import { TEAM_COLORS } from './team-material';
import { createTerrain, type Terrain } from './terrain';

export type TreeList = [number, number, number, number][];
const TREE_MODELS = ['tree_pine', 'tree_oak', 'tree_dead', 'bush'];
export const TEAMS = ['red', 'blue', 'teal', 'purple'];

/** Building sizes on the nav grid (game units). */
const FOOTPRINT: Record<string, [number, number]> = {
  town_hall: [5, 5],
  gold_mine: [3.4, 3.4],
  side_shop: [3, 3],
  temple_market: [3.4, 3.4],
  fountain_of_life: [3, 3],
};

/** Game position + facing -> world transform. North is -z, models face +z. */
function place(node: { position: Vector3; rotationQuaternion: Quaternion | null }, x: number, y: number, h: number, facing: number): void {
  node.position.set(x, h, -y);
  node.rotationQuaternion = Quaternion.RotationAxis(Vector3.Up(), facing + Math.PI);
}

export interface Unit {
  model: ModelInstance;
  mover: Mover;
  team: string;
  effects: HeroEffects | null;
  anim: string;
}

export class GameWorld {
  readonly scene: Scene;
  readonly camera: RtsCamera;
  readonly nav: NavGrid;
  hero: Unit | null = null;
  readonly units: Unit[] = [];
  private shadows: ShadowGenerator;
  private ring: Mesh;
  private stress: ModelInstance[] = [];
  private menuMode = true;

  private constructor(
    readonly engine: AbstractEngine,
    readonly terrain: Terrain,
    readonly library: ModelLibrary,
    readonly grid: TerrainGrid,
    scene: Scene,
    camera: RtsCamera,
    shadows: ShadowGenerator,
    ring: Mesh,
    nav: NavGrid,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.shadows = shadows;
    this.ring = ring;
    this.nav = nav;
  }

  static async create(
    engine: AbstractEngine,
    canvas: HTMLCanvasElement,
    grid: TerrainGrid,
    trees: TreeList,
    assets: GameAssets,
  ): Promise<GameWorld> {
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true; // same as glTF and Blender: models load without mirroring
    scene.clearColor = new Color4(0.42, 0.52, 0.6, 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.42, 0.52, 0.6);
    scene.fogStart = 70;
    scene.fogEnd = 160;
    scene.skipPointerMovePicking = true;
    scene.animationPropertiesOverride = new AnimationPropertiesOverride();
    scene.animationPropertiesOverride.enableBlending = true;
    scene.animationPropertiesOverride.blendingSpeed = 0.12;

    const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.62;
    sky.diffuse = new Color3(0.86, 0.9, 1);
    sky.groundColor = new Color3(0.36, 0.33, 0.28);
    // Warm afternoon sun from the south-west (game), i.e. from -x and +z in world space.
    const sun = new DirectionalLight('sun', new Vector3(0.55, -1, -0.45).normalize(), scene);
    sun.intensity = 1.05;
    sun.diffuse = new Color3(1, 0.93, 0.8);
    sun.position = new Vector3(-60, 120, 60);
    const shadows = new ShadowGenerator(2048, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
    shadows.bias = 0.0008;
    shadows.normalBias = 0.02;
    shadows.darkness = 0.35;

    const layout = gameData.map;
    const terrain = await createTerrain(scene, grid, layout, assets);
    const library = new ModelLibrary(scene, assets);
    await library.loadAll();
    const nav = buildNavGrid(grid);

    // ---- trees: one thin-instanced mesh set per tree type
    const byType: TreeList[] = [[], [], [], []];
    for (const t of trees) byType[t[2]]?.push(t);
    TREE_MODELS.forEach((id, k) => {
      const list = byType[k]!;
      if (!list.length) return;
      for (const mesh of library.staticMeshes(id)) {
        // The mesh node's own transform holds the quantization scale (KHR_mesh_quantization):
        // keep it by baking it into every instance matrix, then clear the node.
        const local = mesh.computeWorldMatrix(true).clone();
        mesh.parent = null;
        mesh.position.setAll(0);
        mesh.rotationQuaternion = null;
        mesh.scaling.setAll(1);
        const buf = new Float32Array(list.length * 16);
        const m = new Matrix();
        const out = new Matrix();
        list.forEach(([x, y, , s], i) => {
          const rot = Quaternion.RotationAxis(Vector3.Up(), ((x * 7.13 + y * 3.71) % 6.283) - 3.14);
          Matrix.ComposeToRef(
            new Vector3(s, s * (0.92 + ((x * 13.7 + y) % 0.16)), s),
            rot,
            new Vector3(x, terrain.heightAt(x, y) - 0.05, -y),
            m,
          );
          local.multiplyToRef(m, out);
          out.copyToArray(buf, i * 16);
        });
        mesh.thinInstanceSetBuffer('matrix', buf, 16, true);
        mesh.alwaysSelectAsActiveMesh = false;
        mesh.thinInstanceRefreshBoundingInfo(false);
        mesh.freezeWorldMatrix();
        mesh.doNotSyncBoundingInfo = true;
      }
    });

    // ---- buildings and neutral places
    const center = 96;
    const facingTo = (x: number, y: number) => Math.atan2(-(center - x), center - y);
    const put = (id: string, x: number, y: number, team: string, shadow = true) => {
      const inst = library.spawn(id, team);
      place(inst.root, x, y, terrain.heightAt(x, y), facingTo(x, y));
      inst.animations.get('idle')?.start(true);
      if (shadow) for (const mesh of inst.meshes) shadows.addShadowCaster(mesh, false);
      for (const mesh of inst.meshes) mesh.freezeWorldMatrix();
      const fp = FOOTPRINT[id];
      if (fp) blockRect(nav, x, y, fp[0], fp[1]);
      return inst;
    };
    layout.starts.forEach((s, i) => put('town_hall', s.townHall[0], s.townHall[1], TEAMS[i % TEAMS.length]!));
    for (const m of layout.goldMines) put('gold_mine', m.pos[0], m.pos[1], 'red');
    for (const s of layout.shops) put(s.type === 'temple_market' ? 'temple_market' : 'side_shop', s.pos[0], s.pos[1], 'red');
    for (const f of layout.fountains) put('fountain_of_life', f.pos[0], f.pos[1], 'red');

    for (const mesh of terrain.chunks) mesh.receiveShadows = true;

    // ---- selection ring under the selected unit
    const ring = CreateGround('selection', { width: 1, height: 1 }, scene);
    const ringMat = new StandardMaterial('selection', scene);
    ringMat.diffuseTexture = new Texture(selectionRingUrl, scene);
    ringMat.diffuseTexture.hasAlpha = true;
    ringMat.useAlphaFromDiffuseTexture = true;
    ringMat.emissiveColor = Color3.FromHexString(TEAM_COLORS.red!);
    ringMat.disableLighting = true;
    ringMat.zOffset = -2;
    ring.material = ringMat;
    ring.isPickable = false;
    ring.setEnabled(false);

    const camera = new RtsCamera(scene, canvas, terrain.heightAt, grid.cols * grid.cellSize);
    const world = new GameWorld(engine, terrain, library, grid, scene, camera, shadows, ring, nav);
    scene.onBeforeRenderObservable.add(() => world.tick(engine.getDeltaTime() / 1000));
    world.setMenuMode(true);
    return world;
  }

  /** Spawns the player's hero at a start spot. */
  spawnHero(heroId: string, x: number, y: number, team: string): Unit {
    const def = gameData.heroes.find((h) => h.id === heroId);
    const model = this.library.spawn(heroId, team);
    const mover = createMover(x, y, def?.moveSpeed ?? 3);
    mover.facing = Math.atan2(-(96 - x), 96 - y);
    for (const mesh of model.meshes) this.shadows.addShadowCaster(mesh, false);
    const unit: Unit = { model, mover, team, effects: attachHeroEffects(this.scene, heroId, model.nodes, model.materials.glow), anim: '' };
    this.play(unit, 'idle');
    this.units.push(unit);
    this.hero = unit;
    const radius = Math.max(1.1, (this.library.models[heroId]?.height ?? 2) * 0.42);
    this.ring.scaling.set(radius * 2.2, 1, radius * 2.2);
    (this.ring.material as StandardMaterial).emissiveColor = Color3.FromHexString(TEAM_COLORS[team] ?? '#ffffff');
    this.ring.setEnabled(true);
    this.syncUnit(unit);
    return unit;
  }

  /** Orders the hero to walk to a game position (path on the nav grid). */
  moveHero(x: number, y: number): void {
    if (!this.hero) return;
    const m = this.hero.mover;
    m.path = findPath(this.nav, m.x, m.y, x, y);
  }

  /** Ground point under the mouse in game coordinates, or null. */
  pickGround(screenX: number, screenY: number): { x: number; y: number } | null {
    const pick = this.scene.pick(screenX, screenY, (mesh) => mesh.metadata?.terrain === true, false, this.camera.camera);
    if (!pick?.hit || !pick.pickedPoint) return null;
    return { x: pick.pickedPoint.x, y: -pick.pickedPoint.z };
  }

  /** Menu: slow circle over the temple. Game: RTS camera over the hero. */
  setMenuMode(on: boolean): void {
    this.menuMode = on;
    this.camera.enabled = !on;
    if (!on && this.hero) this.camera.lookAt(this.hero.mover.x, this.hero.mover.y);
  }

  /** Debug: N copies of a unit around the hero (shared animation), to measure speed. */
  toggleStress(count = 300, id = 'swordsman'): number {
    if (this.stress.length) {
      for (const s of this.stress) s.dispose();
      this.stress = [];
      return 0;
    }
    const cx = this.hero?.mover.x ?? 96,
      cy = this.hero?.mover.y ?? 96;
    const base = this.library.spawn(id, 'blue');
    base.animations.get('walk')?.start(true);
    this.stress.push(base);
    const side = Math.ceil(Math.sqrt(count));
    const source = base.meshes[0] as Mesh;
    place(base.root, cx - side, cy + 4, this.terrain.heightAt(cx - side, cy + 4), 0);
    for (let i = 1; i < count; i++) {
      const x = cx - side + (i % side) * 2,
        y = cy + 4 + Math.floor(i / side) * 2;
      // Each copy gets its own root node; the instance keeps the source mesh's local transform.
      const node = new TransformNode(`stress-${i}`, this.scene);
      place(node, x, y, this.terrain.heightAt(x, y), 0);
      const inst = source.createInstance(`stress-${i}-mesh`);
      inst.parent = node;
      inst.position.copyFrom(source.position);
      inst.rotationQuaternion = source.rotationQuaternion?.clone() ?? null;
      inst.scaling.copyFrom(source.scaling);
      this.stress.push({ ...base, root: node, dispose: () => node.dispose() });
    }
    return count;
  }

  private play(unit: Unit, name: string): void {
    if (unit.anim === name) return;
    const next = unit.model.animations.get(name);
    if (!next) return;
    unit.model.animations.get(unit.anim)?.stop();
    next.start(true, name === 'walk' ? unit.mover.speed / 3 : 1);
    unit.anim = name;
  }

  private syncUnit(u: Unit): void {
    const { x, y, facing } = u.mover;
    place(u.model.root, x, y, this.terrain.heightAt(x, y), facing);
    if (u === this.hero) this.ring.position.set(x, this.terrain.heightAt(x, y) + 0.08, -y);
  }

  private tick(dt: number): void {
    dt = Math.min(dt, 0.1);
    for (const u of this.units) {
      stepMover(u.mover, dt);
      this.play(u, isMoving(u.mover) ? 'walk' : 'idle');
      this.syncUnit(u);
    }
    if (this.menuMode) {
      const t = performance.now() / 1000;
      this.camera.camera.alpha = Math.PI / 2 + t * 0.03;
      this.camera.camera.beta = 0.95;
      this.camera.camera.radius = 120;
      this.camera.camera.target.set(96, 0, -96);
    } else {
      this.camera.camera.alpha = Math.PI / 2;
      this.camera.camera.beta = TILT;
    }
  }
}
