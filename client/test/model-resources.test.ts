import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { AssetContainer } from '@babylonjs/core/assetContainer';
import { Bone } from '@babylonjs/core/Bones/bone';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { CreateBox } from '@babylonjs/core/Meshes/Builders/boxBuilder';
import { TransformNode } from '@babylonjs/core/Meshes/transformNode';
import { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import type { GameAssets } from '../src/loader/assets';
import { ModelLibrary } from '../src/render/model-library';

describe('model instance lifetime', () => {
  it('disposes cloned skeletons as well as meshes and animations, keeping shared materials', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const container = new AssetContainer(scene);
    const root = new TransformNode('rig', scene);
    const mesh = CreateBox('body', {}, scene);
    mesh.parent = root;
    const rig = new Skeleton('rig', 'rig', scene);
    new Bone('root', rig);
    mesh.skeleton = rig;
    const walk = new AnimationGroup('walk', scene);
    const anim = new Animation('sway', 'position.x', 30, Animation.ANIMATIONTYPE_FLOAT);
    anim.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    walk.addTargetedAnimation(anim, root);
    container.meshes.push(mesh);
    container.transformNodes.push(root);
    container.skeletons.push(rig);
    container.animationGroups.push(walk);
    container.removeAllFromScene();

    const material = new StandardMaterial('shared', scene);
    const library = new ModelLibrary(scene, { models: { test: { height: 2 } } } as unknown as GameAssets);
    (Reflect.get(library, 'containers') as Map<string, AssetContainer>).set('test', container);
    vi.spyOn(library, 'materialsFor').mockReturnValue({ palette: material, glow: material, setTeam: () => {} });
    const counts = () => [scene.meshes.length, scene.transformNodes.length, scene.skeletons.length, scene.animationGroups.length];
    const baseline = counts();
    try {
      for (let i = 0; i < 10; i++) {
        const instance = library.spawn('test');
        instance.animations.get('walk')?.start(true);
        expect(scene.skeletons).toHaveLength(baseline[2]! + 1);
        instance.dispose();
        expect(counts()).toEqual(baseline);
        expect(scene.materials).toContain(material);
      }
    } finally {
      container.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});

describe('baked army units', () => {
  it('bakes once, shares one hidden source per team, and disposes only the unit copy', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const container = new AssetContainer(scene);
    const root = new TransformNode('rig', scene);
    const mesh = CreateBox('body', {}, scene);
    mesh.parent = root;
    const rig = new Skeleton('rig', 'rig', scene);
    const bone = new Bone('root', rig);
    const node = new TransformNode('bone', scene);
    node.parent = root;
    bone.linkTransformNode(node);
    mesh.skeleton = rig;
    const walk = new AnimationGroup('walk', scene);
    const anim = new Animation('sway', 'position.x', 30, Animation.ANIMATIONTYPE_FLOAT);
    anim.setKeys([
      { frame: 0, value: 0 },
      { frame: 30, value: 1 },
    ]);
    walk.addTargetedAnimation(anim, node);
    container.meshes.push(mesh);
    container.transformNodes.push(root, node);
    container.skeletons.push(rig);
    container.animationGroups.push(walk);
    container.removeAllFromScene();

    const material = new StandardMaterial('shared', scene);
    const library = new ModelLibrary(scene, { models: { test: { height: 2 } } } as unknown as GameAssets);
    (Reflect.get(library, 'containers') as Map<string, AssetContainer>).set('test', container);
    vi.spyOn(library, 'materialsFor').mockReturnValue({ palette: material, glow: material, setTeam: () => {} });
    try {
      library.bake(['test', 'missing']);
      expect(library.isBaked('test')).toBe(true);
      const first = library.spawn('test', 'blue', true);
      const meshes = scene.meshes.length;
      const skeletons = scene.skeletons.length;
      const second = library.spawn('test', 'blue', true);
      // A copy is one instance under its own root: no new skeleton, no new source.
      expect(scene.meshes.length).toBe(meshes + 1);
      expect(scene.skeletons.length).toBe(skeletons);
      expect(second.baked?.clips.get('walk')).toMatchObject({ start: 0, rows: 31, seconds: 1 });
      expect(second.animations.size).toBe(0);
      second.dispose();
      first.dispose();
      expect(scene.meshes.length).toBe(meshes - 1);
      // The source stays for later units of this team.
      expect(scene.meshes.some((m) => m.bakedVertexAnimationManager && !m.isVisible)).toBe(true);
      // The skeleton path is unchanged without the flag.
      expect(library.spawn('test', 'blue').baked).toBeNull();
    } finally {
      container.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
