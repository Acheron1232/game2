// Loads every model once into an AssetContainer, keeps one material per (skin, team), and makes
// placed copies. Also compiles every material + mesh variant during loading (no hitch later).

import '@babylonjs/loaders/glTF/2.0';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { LoadAssetContainerAsync } from '@babylonjs/core/Loading/sceneLoader';
import type { AssetContainer } from '@babylonjs/core/assetContainer';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import type { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import type { Scene } from '@babylonjs/core/scene';
import type { GameAssets } from '../loader/assets';
import { createModelMaterials, loadTexturePair, type ModelMaterials } from './team-material';

export interface ModelInstance {
  id: string;
  root: TransformNode;
  meshes: AbstractMesh[];
  nodes: TransformNode[];
  animations: Map<string, AnimationGroup>;
  materials: ModelMaterials;
  dispose(): void;
}

export class ModelLibrary {
  private readonly containers = new Map<string, AssetContainer>();
  private readonly materials = new Map<string, ModelMaterials>();
  private readonly textures = new Map<string, ReturnType<typeof loadTexturePair>>();

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

  /** A new copy of a model with its own skeleton and animations. */
  spawn(id: string, team = 'red'): ModelInstance {
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

  /** Compiles every shader variant now: each model with its material, once. */
  async warmUp(teams: string[]): Promise<void> {
    const jobs: Promise<void>[] = [];
    for (const id of this.ids) {
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
  }
}
