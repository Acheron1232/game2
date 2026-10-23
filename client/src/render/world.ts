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
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import '@babylonjs/core/Culling/ray';
import { Scene } from '@babylonjs/core/scene';
import { ImageProcessingConfiguration } from '@babylonjs/core/Materials/imageProcessingConfiguration';
import { ColorCurves } from '@babylonjs/core/Materials/colorCurves';
import { buildMatchNav, gameData, shopModel, SIGHT_CELL, type NavGrid, type TerrainGrid } from '@game/shared';
import selectionRingUrl from '../assets/ui/selection_ring.webp?url';
import type { GameAssets } from '../loader/assets';
import { bakedClock, bakedPose } from './baked-animation';
import { attachHeroEffects, type HeroEffects } from './hero-effects';
import { ModelLibrary, type ModelInstance } from './model-library';
import { UnitGroundMarks, groundMarkRadius } from './unit-ground-marks';
import { RtsCamera, TILT } from './rts-camera';
import { TEAM_COLORS } from './team-material';
import { createDecor, type DecorItem } from './decor';
import { scatterInstances } from './instancing';
import { FogOfWar } from './fog';
import { CombatFx } from './combat-fx';
import { GroundItemViews } from './ground-items';
import { createTerrain, type Terrain } from './terrain';

export type TreeList = [number, number, number, number][];
const TREE_MODELS = ['tree_pine', 'tree_oak', 'tree_dead', 'bush'];
/** F4 stress test: a mixed army (types x teams), like a big late-game fight. */
const STRESS_UNITS = ['swordsman', 'archer', 'worker', 'lancer', 'cleric', 'catapult'];
export const TEAMS = ['red', 'blue', 'teal', 'purple'];
const TMP = new Vector3();

/** Game position + facing -> world transform. North is -z, models face +z. */
function place(node: { position: Vector3; rotationQuaternion: Quaternion | null }, x: number, y: number, h: number, facing: number): void {
  node.position.set(x, h, -y);
  node.rotationQuaternion ??= new Quaternion();
  Quaternion.RotationAxisToRef(Vector3.UpReadOnly, facing + Math.PI, node.rotationQuaternion);
}

/** A unit on screen. Its pose comes from the network layer (game/match-client.ts). */
export interface Unit {
  modelId: string;
  model: ModelInstance;
  x: number;
  y: number;
  facing: number;
  moving: boolean;
  /** move speed, to play the walk animation at the right pace */
  speed: number;
  team: string;
  markerTeam: string;
  building: boolean;
  effects: HeroEffects | null;
  anim: string;
  /** a one-time animation (attack, death) runs until this time (ms), then walk / idle again */
  actionUntil: number;
  dead: boolean;
  /** units in the air are drawn this high above the ground */
  flyHeight: number;
  /** model height, for health bars */
  height: number;
  /** draw scale (Mountain Form makes the golem bigger) */
  scale: number;
  /** normal draw scale of this unit (small wards use a scaled-down model) */
  baseScale: number;
  /** a jump on screen: an arc between these times (ms) */
  arcStart: number;
  arcEnd: number;
  /** building sites grow out of the ground: 0 = just placed, 1 = done */
  rise: number;
  /** Conservative camera culling; logical position and hidden state remain independent. */
  visualVisible: boolean;
  animationStarted: number;
  animationSpeed: number;
}

interface TreeSlot {
  mesh: Mesh;
  slot: number;
  /** the mesh's thin-instance matrix buffer (Babylon writes into it) */
  data: Float32Array;
  /** the tree's own matrix, kept while it is hidden */
  matrix?: Matrix;
}

/** A zero matrix: the copy has no size, so nothing is drawn. */
const HIDDEN_MATRIX = Matrix.Zero();

/** Flying units hover this high (Sky Dragon, harpies). */
const FLY_HEIGHT = 2.6;

export class GameWorld {
  readonly scene: Scene;
  readonly camera: RtsCamera;
  readonly nav: NavGrid;
  readonly units = new Set<Unit>();
  /** the selected unit: the ring is drawn under it */
  selected: Unit | null = null;
  /** Called every frame before units are drawn, with the frame time in seconds. */
  beforeFrame: ((dt: number) => void) | null = null;
  /** items lying on the ground */
  readonly items: GroundItemViews;
  private shadows: ShadowGenerator;
  private ring: Mesh;
  private groundMarks: UnitGroundMarks;
  private stress: Unit[] = [];
  private menuMode = true;
  private readonly viewMatrix = Matrix.Identity();
  private readonly viewPlanes = Frustum.GetPlanes(Matrix.Identity());
  private readonly viewPoint = new Vector3();
  private shadowDirty = true;
  private readonly shadowLight = new Vector3(Infinity, Infinity, Infinity);
  private shadowSize = -1;
  private shadowEnabled = false;
  private readonly shadowPoses = new Map<Unit, Float64Array>();
  readonly renderStats = { visible: 0, total: 0, shadowRefreshes: 0 };
  private readonly screenPosition = new Vector3();
  private readonly screenViewport = new Viewport(0, 0, 0, 0);

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
    readonly trees: TreeList,
    private readonly treeSlots: TreeSlot[][],
    private readonly menuBase: ModelInstance[],
    readonly fog: FogOfWar,
    readonly combat: CombatFx,
  ) {
    this.scene = scene;
    this.camera = camera;
    this.shadows = shadows;
    this.ring = ring;
    this.groundMarks = new UnitGroundMarks(scene);
    this.nav = nav;
    this.items = new GroundItemViews(scene, library, terrain.heightAt);
  }

  static async create(
    engine: AbstractEngine,
    canvas: HTMLCanvasElement,
    grid: TerrainGrid,
    trees: TreeList,
    decor: { types: string[]; decor: DecorItem[] },
    assets: GameAssets,
  ): Promise<GameWorld> {
    const scene = new Scene(engine);
    // Fog of war is part of every material from the start, so no shader compiles in the match.
    const fog = new FogOfWar(scene, grid.cols * grid.cellSize, Math.round((grid.cols * grid.cellSize) / SIGHT_CELL));
    fog.attachAll();
    // Combat effects live as long as the world: their materials compile while loading.
    const combat = new CombatFx(scene);
    if (import.meta.env.DEV && new URLSearchParams(location.search).has('noShadows')) scene.shadowsEnabled = false;
    scene.useRightHandedSystem = true; // same as glTF and Blender: models load without mirroring
    scene.clearColor = new Color4(0.55, 0.62, 0.68, 1);
    scene.ambientColor = new Color3(0.3, 0.3, 0.3);
    // Light haze far from the camera, tinted like the sky; it also softens the far mountains.
    scene.fogMode = Scene.FOGMODE_LINEAR;
    scene.fogColor = new Color3(0.62, 0.66, 0.66);
    scene.fogStart = 55;
    scene.fogEnd = 150;
    scene.skipPointerMovePicking = true;
    scene.animationPropertiesOverride = new AnimationPropertiesOverride();
    scene.animationPropertiesOverride.enableBlending = true;
    scene.animationPropertiesOverride.blendingSpeed = 0.12;

    // Cool sky light from above, warm bounce from the ground.
    const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
    sky.intensity = 0.65;
    sky.diffuse = new Color3(0.75, 0.84, 1);
    sky.groundColor = new Color3(0.48, 0.42, 0.33);
    // Low warm late-afternoon sun from the south-west (game), i.e. from -x and +z in world
    // space: longer shadows and golden light give the hills more shape.
    const sun = new DirectionalLight('sun', new Vector3(0.62, -0.72, -0.5).normalize(), scene);
    sun.intensity = 1.2;
    sun.diffuse = new Color3(1, 0.95, 0.88);
    sun.specular = new Color3(0.4, 0.35, 0.3);
    sun.position = new Vector3(-80, 110, 80);
    sun.shadowFrustumSize = 100;
    sun.shadowMinZ = 1;
    sun.shadowMaxZ = 240;
    const shadows = new ShadowGenerator(1024, sun);
    shadows.usePercentageCloserFiltering = true;
    shadows.filteringQuality = ShadowGenerator.QUALITY_LOW;
    shadows.bias = 0.0008;
    shadows.normalBias = 0.02;
    shadows.darkness = 0.35;

    const layout = gameData.map;
    const terrain = await createTerrain(scene, grid, layout, assets);
    const library = new ModelLibrary(scene, assets);
    await library.loadAll();
    // Army units: baked vertex animation + instancing (`?skinned` in dev keeps skeletons, for A/B).
    if (!(import.meta.env.DEV && new URLSearchParams(location.search).has('skinned'))) library.bake(gameData.units.map((u) => u.id));
    const nav = buildMatchNav(grid, layout);

    // ---- trees: one thin-instanced mesh set per tree type. Pines also grow on the lower
    // mountain slopes outside the map, so the world does not end at a hard line.
    const size = grid.cols * grid.cellSize;
    const byType: TreeList[] = [[], [], [], []];
    // map tree index of each copy, so a chopped tree can be hidden later
    const mapIndex: number[][] = [[], [], [], []];
    trees.forEach((t, i) => {
      byType[t[2]]?.push(t);
      mapIndex[t[2]]?.push(i);
    });
    const treeSlots: TreeSlot[][] = trees.map(() => []);
    for (let k = 0; k < 2600; k++) {
      const a = Math.sin(k * 12.9898) * 43758.5453,
        b = Math.sin(k * 78.233) * 12345.6789;
      const u = a - Math.floor(a),
        v = b - Math.floor(b);
      const side = k % 4,
        along = u * (size + 40) - 20,
        out = 2 + v * v * 26;
      const [x, y] = side === 0 ? [along, -out] : side === 1 ? [along, size + out] : side === 2 ? [-out, along] : [size + out, along];
      byType[v > 0.15 ? 0 : 2]!.push([x, y, 0, 0.9 + u * 0.5]);
    }
    TREE_MODELS.forEach((id, k) => {
      const list = byType[k]!;
      if (!list.length) return;
      const q = new Quaternion();
      const sc = new Vector3();
      const pos = new Vector3();
      for (const mesh of library.staticMeshes(id)) {
        scatterInstances(
          mesh,
          list.length,
          (i) => [list[i]![0], list[i]![1]],
          (i, out) => {
            const [x, y, , s] = list[i]!;
            Quaternion.RotationAxisToRef(Vector3.Up(), ((x * 7.13 + y * 3.71) % 6.283) - 3.14, q);
            sc.set(s, s * (0.92 + ((x * 13.7 + y) % 0.16)), s);
            pos.set(x, terrain.heightAt(x, y) - 0.05, -y);
            Matrix.ComposeToRef(sc, q, pos, out);
          },
          undefined,
          (i, m, slot, data) => {
            const at = mapIndex[k]![i];
            if (at !== undefined) treeSlots[at]!.push({ mesh: m, slot, data });
          },
        );
      }
    });

    // ---- decor: rocks, stumps, ruins, fences, crates, grass and flowers
    await createDecor(scene, decor.decor, decor.types, terrain.heightAt, library, assets);

    // ---- buildings and neutral places
    const center = size / 2;
    const facingTo = (x: number, y: number) => Math.atan2(-(center - x), center - y);
    const put = (id: string, x: number, y: number, team: string, shadow = true) => {
      const inst = library.spawn(id, team);
      place(inst.root, x, y, terrain.heightAt(x, y), facingTo(x, y));
      inst.animations.get('idle')?.start(true);
      if (shadow) for (const mesh of inst.meshes) shadows.addShadowCaster(mesh, false);
      for (const mesh of inst.meshes) mesh.freezeWorldMatrix();
      return inst;
    };
    // Town Halls and mines for the menu view; in a match they come from the server.
    const menuBase: ModelInstance[] = [];
    layout.starts.forEach((s, i) => menuBase.push(put('town_hall', s.townHall[0], s.townHall[1], TEAMS[i % TEAMS.length]!)));
    for (const m of layout.goldMines) menuBase.push(put('gold_mine', m.pos[0], m.pos[1], 'red'));
    for (const s of layout.shops) put(shopModel(s.type), s.pos[0], s.pos[1], 'red');
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

    const camera = new RtsCamera(scene, canvas, terrain.heightAt, size);
    const world = new GameWorld(engine, terrain, library, grid, scene, camera, shadows, ring, nav, trees, treeSlots, menuBase, fog, combat);
    world.setupColorGrading();
    scene.onBeforeRenderObservable.add(() => world.tick(engine.getDeltaTime() / 1000));
    world.setMenuMode(true);
    return world;
  }

  /** Hides chopped trees (map tree indices). Safe to call again for the same tree. */
  hideTrees(ids: readonly number[]): void {
    const dirty = new Set<Mesh>();
    for (const id of ids) {
      for (const s of this.treeSlots[id] ?? []) {
        if (s.matrix) continue;
        s.matrix = Matrix.FromArray(s.data, s.slot * 16);
        s.mesh.thinInstanceSetMatrixAt(s.slot, HIDDEN_MATRIX, false);
        dirty.add(s.mesh);
      }
    }
    for (const m of dirty) m.thinInstanceBufferUpdated('matrix');
  }

  /** Back to the full forest (the match is over). */
  showAllTrees(): void {
    const dirty = new Set<Mesh>();
    for (const slots of this.treeSlots)
      for (const s of slots) {
        if (!s.matrix) continue;
        s.mesh.thinInstanceSetMatrixAt(s.slot, s.matrix, false);
        s.matrix = undefined;
        dirty.add(s.mesh);
      }
    for (const m of dirty) m.thinInstanceBufferUpdated('matrix');
  }

  /** In a match the server sends Town Halls and gold mines: hide the menu copies. */
  setMenuBase(visible: boolean): void {
    for (const b of this.menuBase) {
      b.root.setEnabled(visible);
      const idle = b.animations.get('idle');
      if (visible) idle?.start(true);
      else idle?.stop(true);
    }
    this.shadowDirty = true;
  }

  /** Faces a building toward the map center, like the menu Town Halls. */
  buildingFacing(x: number, y: number): number {
    const c = (this.grid.cols * this.grid.cellSize) / 2;
    return Math.atan2(-(c - x), c - y);
  }

  /** Adds a unit (hero or unit model) to the scene. Heroes and buildings cast shadows; heroes get their effects. */
  addUnit(
    modelId: string,
    team: string,
    x: number,
    y: number,
    facing: number,
    speed: number,
    hero: boolean,
    flying = false,
    building = false,
  ): Unit {
    const model = this.library.spawn(modelId, team, !hero && !building);
    if (hero || building) for (const mesh of model.meshes) this.shadows.addShadowCaster(mesh, false);
    const effects = hero ? attachHeroEffects(this.scene, modelId, model.nodes, model.materials.glow) : null;
    const unit: Unit = {
      modelId,
      model,
      x,
      y,
      facing,
      moving: false,
      speed,
      team,
      markerTeam: team,
      building,
      effects,
      anim: '',
      actionUntil: 0,
      dead: false,
      flyHeight: flying ? FLY_HEIGHT : 0,
      height: this.library.models[modelId]?.height ?? 2,
      scale: 1,
      baseScale: 1,
      arcStart: 0,
      arcEnd: 0,
      rise: 1,
      visualVisible: true,
      animationStarted: performance.now(),
      animationSpeed: 1,
    };
    this.play(unit, 'idle');
    this.units.add(unit);
    this.shadowDirty = true;
    this.syncUnit(unit);
    return unit;
  }

  removeUnit(u: Unit): void {
    if (!this.units.delete(u)) return;
    this.shadowPoses.delete(u);
    this.shadowDirty = true;
    if (this.selected === u) this.select(null);
    for (const mesh of u.model.meshes) this.shadows.removeShadowCaster(mesh, false);
    u.effects?.dispose();
    u.model.dispose();
  }

  /** Shows the selection ring under a unit (in its team color), or hides it. */
  select(u: Unit | null): void {
    this.selected = u;
    this.ring.setEnabled(!!u);
    if (!u) return;
    const radius = Math.max(1.1, (this.library.models[u.modelId]?.height ?? 2) * 0.42);
    this.ring.scaling.set(radius * 2.2, 1, radius * 2.2);
    (this.ring.material as StandardMaterial).emissiveColor = Color3.FromHexString(TEAM_COLORS[u.markerTeam] ?? '#9b8870');
  }

  async warmUpGroundMarks(): Promise<void> {
    await this.groundMarks.warmUp();
  }

  markerRadius(u: Unit): number {
    return groundMarkRadius(u);
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
    this.fog.setEnabled(!on);
    this.camera.enabled = !on;
    if (!on && this.selected) this.camera.lookAt(this.selected.x, this.selected.y);
  }

  /**
   * Debug (F4): `count` real army units on screen, mixed types and teams, each walking or
   * swinging in its own phase. Same path as match units, so it measures a big fight.
   */
  toggleStress(count = 300): number {
    if (this.stress.length) {
      for (const u of this.stress) this.removeUnit(u);
      this.stress = [];
      return 0;
    }
    const ids = STRESS_UNITS.filter((id) => this.library.models[id]);
    const target = this.camera.camera.target;
    const side = Math.ceil(Math.sqrt(count));
    const now = performance.now();
    for (let i = 0; i < count; i++) {
      const x = target.x + ((i % side) - side / 2) * 1.6,
        y = -target.z + (Math.floor(i / side) - side / 2) * 1.6;
      const u = this.addUnit(ids[i % ids.length]!, TEAMS[Math.floor(i / ids.length) % TEAMS.length]!, x, y, (i * 0.7) % 6.283, 3, false);
      u.moving = i % 4 !== 0;
      this.play(u, u.moving ? 'walk' : 'idle');
      // Spread the phases so the army does not move in lockstep.
      u.animationStarted = now - ((i * 173) % 2000);
      this.poseBaked(u, now);
      this.stress.push(u);
    }
    return count;
  }

  /**
   * Color grading runs inside every material shader, not as a post-process. A post-process
   * needs a full-screen half-float copy of the frame plus extra full-screen passes; at Retina
   * size and 120 FPS that was about half of all GPU time. Edges are smoothed by MSAA
   * (see engine.ts), which costs little on tile-based GPUs. Particles supply glow, no bloom.
   */
  private setupColorGrading(): void {
    const ip = this.scene.imageProcessingConfiguration;
    ip.applyByPostProcess = false;
    ip.isEnabled = true;
    ip.toneMappingEnabled = true;
    ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_ACES;
    ip.exposure = 1.05;
    ip.contrast = 1.04;
    ip.vignetteEnabled = true;
    ip.vignetteWeight = 0.8;
    ip.vignetteColor = new Color4(0.08, 0.05, 0.02, 0);
    ip.colorCurvesEnabled = true;
    // Warm highlights, cool shadows: the classic "painted fantasy" look.
    const curves = new ColorCurves();
    curves.globalSaturation = 2;
    curves.highlightsHue = 40;
    curves.highlightsDensity = 8;
    curves.highlightsSaturation = 8;
    curves.shadowsHue = 220;
    curves.shadowsDensity = 10;
    curves.shadowsSaturation = 10;
    ip.colorCurves = curves;
  }

  play(unit: Unit, name: string, loop = true, speed = 1): void {
    const baked = unit.model.baked;
    if (unit.anim === name && loop) {
      if (name === 'walk' && unit.animationSpeed !== unit.speed / 3) {
        const clip = unit.model.animations.get(name);
        if (clip || baked) {
          const now = performance.now();
          unit.animationStarted = now - ((now - unit.animationStarted) * unit.animationSpeed) / (unit.speed / 3 || 1);
          unit.animationSpeed = unit.speed / 3;
          if (clip) clip.speedRatio = unit.animationSpeed;
          this.poseBaked(unit, now);
        }
      }
      return;
    }
    const next = unit.model.animations.get(name);
    if (baked ? !baked.clips.has(name) : !next) return;
    unit.model.animations.get(unit.anim)?.stop();
    unit.animationSpeed = loop && name === 'walk' ? unit.speed / 3 : speed;
    unit.animationStarted = performance.now();
    unit.anim = name;
    if (baked) {
      baked.loop = loop;
      baked.held = false;
      this.poseBaked(unit, unit.animationStarted);
      return;
    }
    next!.start(loop, unit.animationSpeed);
    if (!unit.visualVisible) next!.stop(true);
  }

  /** Baked units: GPU clip settings from the wall-clock phase (same timing as the skeleton path). */
  private poseBaked(u: Unit, now: number): void {
    const baked = u.model.baked;
    const clip = baked?.clips.get(u.anim);
    if (!baked || !clip) return;
    const elapsed = clip.seconds > 0 ? (Math.max(0, now - u.animationStarted) * u.animationSpeed) / 1000 / clip.seconds : 1;
    baked.held = bakedPose(clip, baked.loop, elapsed, u.animationSpeed, bakedClock(now), baked.settings);
  }

  /** Length in seconds of a model's clip at speed 1. */
  private clipSeconds(u: Unit, name: string): number | undefined {
    const baked = u.model.baked?.clips.get(name);
    if (baked) return baked.seconds;
    const g = u.model.animations.get(name);
    if (!g) return undefined;
    const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
    return (g.to - g.from) / fps;
  }

  /** Plays a one-time clip (attack, cast, death). `seconds` = how long it should take. */
  playOnce(u: Unit, name: string, seconds?: number): void {
    const length = this.clipSeconds(u, name);
    if (length === undefined) return;
    const speed = seconds && length > seconds ? length / seconds : 1;
    this.play(u, name, false, speed);
    u.actionUntil = performance.now() + (length / speed) * 1000;
  }

  /** Death: play the clip once and stay down. Heroes are hidden until they come back. */
  setDead(u: Unit, dead: boolean): void {
    if (u.dead === dead) return;
    u.dead = dead;
    if (dead) {
      this.playOnce(u, 'death');
      u.actionUntil = Infinity;
      if (this.selected === u) this.ring.setEnabled(false);
    } else {
      u.actionUntil = 0;
      u.model.root.setEnabled(true);
      this.play(u, 'idle');
      if (this.selected === u) this.ring.setEnabled(true);
    }
  }

  /** Hides a dead hero after its death clip (it is still in the game, waiting to respawn). */
  hideUnit(u: Unit, hidden: boolean): void {
    u.model.root.setEnabled(!hidden);
  }

  /** Screen position (CSS pixels) of a point above a unit, or null when off screen. */
  screenPoint(x: number, y: number, up: number, out: { x: number; y: number }): boolean {
    const cam = this.camera.camera;
    cam.viewport.toGlobalToRef(this.engine.getRenderWidth(), this.engine.getRenderHeight(), this.screenViewport);
    const p = Vector3.ProjectToRef(
      TMP.set(x, this.terrain.heightAt(x, y) + up, -y),
      Matrix.IdentityReadOnly,
      this.scene.getTransformMatrix(),
      this.screenViewport,
      this.screenPosition,
    );
    const scale = this.engine.getRenderWidth() / (this.engine.getRenderingCanvas()?.clientWidth || this.engine.getRenderWidth());
    out.x = p.x / scale;
    out.y = p.y / scale;
    return p.z > 0 && p.z < 1;
  }

  /** Current visual altitude, shared by the model, bars, picking and homing effects. */
  unitHeight(u: Unit, now = performance.now()): number {
    const { x, y } = u;
    const ground = this.terrain.heightAt(x, y);
    // Flyers bob a little so they look alive.
    let h = u.flyHeight ? ground + u.flyHeight + Math.sin(now / 600 + x) * 0.12 : ground;
    // Jumps (Sky Pillar, Inferno Dive): up and down in an arc.
    if (now >= u.arcStart && now < u.arcEnd) h += Math.sin((Math.PI * (now - u.arcStart)) / (u.arcEnd - u.arcStart)) * 3.5;
    // A building site sits low in the ground and rises while it is built.
    if (u.rise < 1) h -= (1 - u.rise) * u.height * 0.85;
    return h;
  }

  private syncUnit(u: Unit, dt = 1 / 60): void {
    const { x, y, facing } = u;
    place(u.model.root, x, y, this.unitHeight(u), facing);
    const sc = u.model.root.scaling;
    if (sc.x !== u.scale) {
      // Grow and shrink smoothly.
      const next = sc.x + (u.scale - sc.x) * (1 - Math.exp(-10 * dt));
      sc.setAll(Math.abs(next - u.scale) < 0.01 ? u.scale : next);
    }
    if (u === this.selected) this.ring.position.set(x, this.terrain.heightAt(x, y) + 0.08, -y);
  }

  /** Refresh once before sampling visual work. No allocations in the per-unit test. */
  private updateView(): void {
    this.camera.camera.getViewMatrix().multiplyToRef(this.camera.camera.getProjectionMatrix(), this.viewMatrix);
    Frustum.GetPlanesToRef(this.viewMatrix, this.viewPlanes);
  }

  /** Include height, spell jumps, particles and shadows near the screen edge. */
  inView(u: Unit): boolean {
    this.viewPoint.set(u.x, this.terrain.heightAt(u.x, u.y) + u.flyHeight + u.height * u.scale * 0.5, -u.y);
    const radius = Math.max(12, u.height * u.scale * 1.5 + 5);
    for (const plane of this.viewPlanes) if (plane.dotCoordinate(this.viewPoint) < -radius) return false;
    return true;
  }

  private updateVisualVisibility(u: Unit): void {
    const visible = u.model.root.isEnabled() && this.inView(u);
    if (visible === u.visualVisible) return;
    u.visualVisible = visible;
    for (const mesh of u.model.meshes) mesh.isVisible = visible;
    u.effects?.setVisible(visible);
    // Baked clips follow the shared GPU clock, so they are in phase again on their own.
    if (u.model.baked) {
      if (visible) u.model.root.scaling.setAll(u.scale);
      return;
    }
    const clip = u.model.animations.get(u.anim);
    if (!clip) return;
    if (!visible) clip.stop(true);
    else {
      // Resume at the wall-clock phase, including attacks/deaths that ended off screen.
      const fps = clip.targetedAnimations[0]?.animation.framePerSecond ?? 30;
      const elapsed = (Math.max(0, performance.now() - u.animationStarted) * fps * u.animationSpeed) / 1000;
      const length = clip.to - clip.from;
      clip.start(clip.loopAnimation, u.animationSpeed);
      clip.goToFrame(clip.from + (clip.loopAnimation && length > 0 ? elapsed % length : Math.min(length, elapsed)));
      u.model.root.scaling.setAll(u.scale);
    }
  }

  /** Reuse the shadow map only when every caster and the light projection are unchanged.
   * Animated casters stay live: caching an idle skeleton would freeze its shadow. */
  private updateShadowBudget(): void {
    const sun = this.shadows.getLight() as DirectionalLight;
    let dirty =
      this.shadowDirty ||
      !sun.position.equals(this.shadowLight) ||
      this.shadowSize !== sun.shadowFrustumSize ||
      this.shadowEnabled !== this.scene.shadowsEnabled;
    this.shadowLight.copyFrom(sun.position);
    this.shadowSize = sun.shadowFrustumSize;
    this.shadowEnabled = this.scene.shadowsEnabled;
    for (const u of this.units) {
      if (!u.effects && !u.building) continue;
      let pose = this.shadowPoses.get(u);
      if (!pose) {
        pose = new Float64Array(8).fill(NaN);
        this.shadowPoses.set(u, pose);
      }
      const enabled = Number(u.model.root.isEnabled());
      const visible = Number(u.visualVisible);
      const scale = u.model.root.scaling.x;
      if (
        pose[0] !== u.x ||
        pose[1] !== u.y ||
        pose[2] !== u.facing ||
        pose[3] !== u.rise ||
        pose[4] !== scale ||
        pose[5] !== enabled ||
        pose[6] !== visible
      )
        dirty = true;
      pose[0] = u.x;
      pose[1] = u.y;
      pose[2] = u.facing;
      pose[3] = u.rise;
      pose[4] = scale;
      pose[5] = enabled;
      pose[6] = visible;
    }
    const map = this.shadows.getShadowMap();
    if (!map) return;
    for (const mesh of map.renderList ?? []) {
      if (mesh.isEnabled() && mesh.isVisible && mesh.skeleton) {
        dirty = true;
        break;
      }
    }
    // The setter resets Babylon's counter, even when assigning the same value.
    if (map.refreshRate !== 0) map.refreshRate = 0;
    if (dirty) {
      map.resetRefreshCounter();
      this.renderStats.shadowRefreshes++;
    }
    this.shadowDirty = false;
  }

  private tick(dt: number): void {
    dt = Math.min(dt, 0.1);
    // Spend shadow texels on the current view instead of spreading them across all four bases.
    const sun = this.shadows.getLight() as DirectionalLight;
    const target = this.camera.camera.target;
    sun.position.set(target.x - sun.direction.x * 100, target.y - sun.direction.y * 100, target.z - sun.direction.z * 100);
    sun.shadowFrustumSize = this.menuMode
      ? this.grid.cols * this.grid.cellSize + 80
      : Math.max(80, this.camera.camera.radius * this.engine.getAspectRatio(this.camera.camera) * 2);
    this.updateView();
    this.beforeFrame?.(dt);
    this.fog.update(dt);
    this.combat.update(dt);
    this.items.update();
    const now = performance.now();
    this.library.setBakedTime(bakedClock(now));
    this.renderStats.total = this.units.size;
    this.renderStats.visible = 0;
    for (const u of this.units) {
      this.updateVisualVisibility(u);
      if (!u.visualVisible) continue;
      this.renderStats.visible++;
      if (!u.dead && now >= u.actionUntil) this.play(u, u.moving ? 'walk' : 'idle');
      // Walking cancels an attack swing on screen, like it does in the game.
      else if (!u.dead && u.moving && (u.anim === 'attack' || u.anim === 'attack2')) {
        u.actionUntil = 0;
        this.play(u, 'walk');
      }
      // A one-shot clip (attack, death) holds its last pose once it is over.
      const baked = u.model.baked;
      if (baked && !baked.loop && !baked.held) this.poseBaked(u, now);
      this.syncUnit(u, dt);
    }
    this.ring.setEnabled(!!this.selected && !this.selected.dead && this.selected.visualVisible);
    this.groundMarks.update(this.units, this.terrain.heightAt, this.scene.shadowsEnabled);
    this.updateShadowBudget();
    if (this.menuMode) {
      const t = performance.now() / 1000;
      const c = (this.grid.cols * this.grid.cellSize) / 2;
      this.camera.camera.alpha = Math.PI / 2 + t * 0.03;
      this.camera.camera.beta = 0.95;
      this.camera.camera.radius = 150;
      this.camera.camera.target.set(c, 0, -c);
    } else {
      this.camera.camera.alpha = Math.PI / 2;
      this.camera.camera.beta = TILT;
    }
  }
}
