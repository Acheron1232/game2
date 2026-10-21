// Loads every model once into an AssetContainer, keeps one material per (skin, team), and makes
// placed copies. Also compiles every material + mesh variant during loading (no hitch later).
// Army units use baked vertex animation: one hidden source mesh per (type, team) and an instance
// per unit, so a whole army of one type and team is one draw (see baked-animation.ts).

import '@babylonjs/loaders/glTF/2.0';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { BakedVertexAnimationManager } from '@babylonjs/core/BakedVertexAnimation/bakedVertexAnimationManager';
import { Constants } from '@babylonjs/core/Engines/constants';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { type Matrix, Quaternion, Vector4 } from '@babylonjs/core/Maths/math.vector';
import '@babylonjs/core/Meshes/instancedMesh';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { Scene } from '@babylonjs/core/scene';
import type { GameAssets } from '../loader/assets';
import type { BakedClip } from './baked-animation';
import { createModelMaterials, loadTexturePair, type ModelMaterials } from './team-material';

/** Clips army units play. Others (hit, victory) are not baked. */
const BAKED_CLIPS = ['idle', 'walk', 'attack', 'attack2', 'cast', 'death'];
/** Babylon's per-instance VAT attribute: (start row, end row, offset, rows per second). */
const VAT_SETTINGS = 'bakedVertexAnimationSettingsInstanced';
/** Frames the warm-up copies are drawn in the menu, so GPU pipelines exist before the match. */
const PREWARM_FRAMES = 3;

/** Per-unit baked animation state. */
export interface BakedState {
  clips: Map<string, BakedClip>;
  /** this unit's VAT settings; all its instances share the object and Babylon reads it every frame */
  settings: Vector4;
  loop: boolean;
  /** a finished one-shot clip holds its last row */
  held: boolean;
}

interface BakedSource {
  mesh: Mesh;
  /** the mesh's transform under the model root */
  local: Matrix;
}

interface BakedModel {
  clips: Map<string, BakedClip>;
  manager: BakedVertexAnimationManager;
  teams: Map<string, BakedSource[]>;
}

export interface ModelInstance {
  id: string;
  root: TransformNode;
  meshes: AbstractMesh[];
  nodes: TransformNode[];
  animations: Map<string, AnimationGroup>;
  materials: ModelMaterials;
  /** set for army units drawn with baked vertex animation (then `animations` is empty) */
  baked: BakedState | null;
  dispose(): void;
}

export class ModelLibrary {
  private readonly containers = new Map<string, AssetContainer>();
  private readonly materials = new Map<string, ModelMaterials>();
  private readonly textures = new Map<string, ReturnType<typeof loadTexturePair>>();
  private readonly baked = new Map<string, BakedModel>();

  constructor(
    private readonly scene: Scene,
    private readonly assets: GameAssets,
  ) {}

  get models() {
    return this.assets.models;
  }

  get ids(): string[] {
    return [...this.containers.keys()];
  }

  async loadAll(): Promise<void> {
    const ids = Object.keys(this.assets.models).filter((id) => this.assets.has(`models/${id}.glb`));
    await Promise.all(
      ids.map(async (id) => {
        const container = await LoadAssetContainerAsync(this.assets.url(`models/${id}.glb`), this.scene, { pluginExtension: '.glb' });
        // The loader's own PBR materials are never used: mark glow parts by name, then drop them.
        for (const mesh of container.meshes) if (mesh.material?.name === 'glow') mesh.name += '|glow';
        for (const mat of container.materials) mat.dispose();
        container.materials.length = 0;
        this.containers.set(id, container);
      }),
    );
  }

  /** Material set for a model's skin atlas and a team color (shared between all copies). */
  materialsFor(id: string, team: string): ModelMaterials {
    const skin = this.assets.models[id]?.skin ?? null;
    const key = `${skin ?? 'palette'}|${team}`;
    let mats = this.materials.get(key);
    if (!mats) {
      let tex = this.textures.get(skin ?? 'palette');
      if (!tex) {
        const base = skin ?? 'palette';
        tex = loadTexturePair(this.scene, this.assets.url(`models/${base}.webp`), this.assets.url(`models/${base}_team.webp`));
        this.textures.set(skin ?? 'palette', tex);
      }
      mats = createModelMaterials(this.scene, tex.palette, tex.teamMask, team);
      this.materials.set(key, mats);
    }
    return mats;
  }

  /**
   * A new copy of a model. With `baked` and a baked model: an instance of the shared source
   * (no skeleton); else its own skeleton and animations.
   */
  spawn(id: string, team = 'red', baked = false): ModelInstance {
    const model = baked ? this.baked.get(id) : undefined;
    if (model) return this.spawnBaked(id, team, model);
    const container = this.containers.get(id);
    if (!container) throw new Error(`No model ${id}`);
    const mats = this.materialsFor(id, team);
    const entries = container.instantiateModelsToScene((n) => `${id}:${n}`, false, { doNotInstantiate: true });
    const root = entries.rootNodes[0] as TransformNode;
    const meshes = root.getChildMeshes(false);
    for (const m of meshes) {
      m.material = m.name.includes('|glow') ? mats.glow : mats.palette;
      m.hasVertexAlpha = false;
      m.isPickable = false;
    }
    // Clones are renamed with our prefix ('staff_warrior:walk'); look them up by the plain clip name.
    const animations = new Map(entries.animationGroups.map((g) => [g.name.slice(g.name.indexOf(':') + 1), g]));
    for (const g of entries.animationGroups) g.stop();
    return {
      id,
      root,
      meshes,
      nodes: root.getChildTransformNodes(false),
      animations,
      materials: mats,
      baked: null,
      dispose() {
        // Disposing only the root leaves cloned skeletons (and their bone buffers) alive.
        // Entries owns the whole instance; shared materials/textures stay in the library.
        entries.dispose();
      },
    };
  }

  /** Static meshes (no skeleton) for thin instancing: trees, rocks. */
  staticMeshes(id: string, team = 'red'): Mesh[] {
    const inst = this.spawn(id, team);
    inst.root.setEnabled(true);
    return inst.meshes as Mesh[];
  }

  /**
   * Bakes the clips of these models (army units) into vertex animation textures. Models without
   * a skeleton or a walk clip keep the normal path.
   */
  bake(ids: readonly string[]): void {
    // Blending would mix each sampled frame with the one before it.
    const blending = this.scene.animationPropertiesOverride;
    this.scene.animationPropertiesOverride = null;
    try {
      for (const id of ids) {
        if (!this.containers.has(id) || this.baked.has(id)) continue;
        const model = this.bakeModel(id);
        if (model) this.baked.set(id, model);
      }
    } finally {
      this.scene.animationPropertiesOverride = blending;
    }
  }

  isBaked(id: string): boolean {
    return this.baked.has(id);
  }

  /** The shared shader clock of all baked units (see bakedClock). */
  setBakedTime(clock: number): void {
    for (const model of this.baked.values()) model.manager.time = clock;
  }

  private bakeModel(id: string): BakedModel | null {
    const inst = this.spawn(id);
    try {
      const skeleton = inst.meshes[0]?.skeleton;
      const clips = BAKED_CLIPS.flatMap((name) => {
        const g = inst.animations.get(name);
        return g ? [[name, g] as const] : [];
      });
      // One skeleton for every part, matrices that do not depend on the mesh, and a walk clip.
      if (!skeleton || skeleton.needInitialSkinMatrix || inst.meshes.some((m) => m.skeleton !== skeleton) || !inst.animations.has('walk'))
        return null;
      const floats = (skeleton.bones.length + 1) * 16;
      const table = new Map<string, BakedClip>();
      let rows = 0;
      for (const [name, g] of clips) {
        const fps = g.targetedAnimations[0]?.animation.framePerSecond ?? 30;
        const count = Math.round(g.to - g.from) + 1;
        table.set(name, { start: rows, rows: count, seconds: (g.to - g.from) / fps });
        rows += count;
      }
      const data = new Float32Array(rows * floats);
      for (const [name, g] of clips) {
        const clip = table.get(name)!;
        g.start(false, 1, g.from, g.to);
        g.pause();
        for (let k = 0; k < clip.rows; k++) {
          g.goToFrame(Math.min(g.to, g.from + k));
          // Bones copy their linked glTF nodes here, then build the skin matrices.
          skeleton.prepare(true);
          data.set(skeleton.getTransformMatrices(inst.meshes[0]!), (clip.start + k) * floats);
        }
        g.stop();
      }
      const texture = RawTexture.CreateRGBATexture(
        data,
        floats / 4,
        rows,
        this.scene,
        false,
        false,
        Texture.NEAREST_SAMPLINGMODE,
        Constants.TEXTURETYPE_FLOAT,
      );
      texture.name = `vat:${id}`;
      const manager = new BakedVertexAnimationManager(this.scene);
      manager.texture = texture;
      return { clips: table, manager, teams: new Map() };
    } finally {
      inst.dispose();
    }
  }

  /** The hidden source meshes of a baked model for one team (made once, kept for the session). */
  private bakedSources(id: string, team: string, model: BakedModel): BakedSource[] {
    let list = model.teams.get(team);
    if (list) return list;
    const inst = this.spawn(id, team);
    const toRoot = inst.root.computeWorldMatrix(true).clone().invert();
    list = inst.meshes.map((m) => {
      const mesh = m as Mesh;
      const local = mesh.computeWorldMatrix(true).multiply(toRoot);
      mesh.bakedVertexAnimationManager = model.manager;
      mesh.registerInstancedBuffer(VAT_SETTINGS, 4);
      mesh.instancedBuffers[VAT_SETTINGS] = new Vector4(0, 1, 0, 0);
      // Only its instances are drawn. It keeps the skeleton only for the bone attributes in the
      // shader; the bone nodes and clips go, so nothing of it is posed or updated per frame.
      mesh.isVisible = false;
      mesh.isPickable = false;
      mesh.setParent(null);
      mesh.freezeWorldMatrix();
      return { mesh, local };
    });
    for (const bone of inst.meshes[0]?.skeleton?.bones ?? []) bone.linkTransformNode(null);
    for (const g of inst.animations.values()) g.dispose();
    inst.root.dispose();
    model.teams.set(team, list);
    return list;
  }

  private spawnBaked(id: string, team: string, model: BakedModel): ModelInstance {
    const sources = this.bakedSources(id, team, model);
    const root = new TransformNode(`${id}:unit`, this.scene);
    const settings = new Vector4(0, 1, 0, 0);
    const meshes = sources.map(({ mesh, local }) => {
      const inst = mesh.createInstance(`${mesh.name}:copy`);
      inst.parent = root;
      local.decompose(inst.scaling, (inst.rotationQuaternion ??= new Quaternion()), inst.position);
      inst.instancedBuffers[VAT_SETTINGS] = settings;
      inst.isPickable = false;
      // The rest-pose box does not hold every animated pose; GameWorld culls units itself.
      inst.alwaysSelectAsActiveMesh = true;
      inst.doNotSyncBoundingInfo = true;
      return inst;
    });
    return {
      id,
      root,
      meshes,
      nodes: [],
      animations: new Map(),
      materials: this.materialsFor(id, team),
      baked: { clips: model.clips, settings, loop: true, held: false },
      dispose() {
        root.dispose();
      },
    };
  }

  /** Compiles every shader variant now: each model with its material, once. */
  async warmUp(teams: string[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    const prewarm: ModelInstance[] = [];
    for (const id of this.ids) {
      const baked = this.baked.get(id);
      if (baked) {
        for (const team of teams) {
          for (const { mesh } of this.bakedSources(id, team, baked))
            jobs.push(mesh.material?.forceCompilationAsync(mesh, { useInstances: true }) ?? Promise.resolve());
          // A first draw also builds the GPU pipeline (WebGPU), far below the map.
          const copy = this.spawnBaked(id, team, baked);
          copy.root.position.y = -200;
          prewarm.push(copy);
        }
        continue;
      }
      for (const team of this.assets.models[id]?.skin === null ? ['red'] : teams) {
        const inst = this.spawn(id, team);
        const compiled = inst.meshes.map((m) => m.material?.forceCompilationAsync(m, { useInstances: false }));
        jobs.push(
          Promise.all(compiled)
            .then(() => undefined)
            .finally(() => inst.dispose()),
        );
      }
    }
    await Promise.all(jobs);
    if (!prewarm.length) return;
    let frames = 0;
    const observer = this.scene.onAfterRenderObservable.add(() => {
      if (++frames < PREWARM_FRAMES) return;
      this.scene.onAfterRenderObservable.remove(observer);
      for (const copy of prewarm) copy.dispose();
    });
  }
}
