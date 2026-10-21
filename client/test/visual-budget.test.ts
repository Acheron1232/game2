import { Animation } from '@babylonjs/core/Animations/animation';
import { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
import { Skeleton } from '@babylonjs/core/Bones/skeleton';
import { Frustum } from '@babylonjs/core/Maths/math.frustum';
import { Matrix, Vector3, Vector4 } from '@babylonjs/core/Maths/math.vector';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { GameWorld, type Unit } from '../src/render/world';

// Exercise the real visibility/animation transitions with Babylon, without loading the map.
type VisualWorld = GameWorld & {
  updateView(): void;
  updateVisualVisibility(u: Unit): void;
};
const methods = GameWorld.prototype as unknown as VisualWorld;

function fixture() {
  const engine = new NullEngine({
    renderWidth: 1280,
    renderHeight: 720,
    textureSize: 512,
    deterministicLockstep: false,
    lockstepMaxSteps: 4,
  });
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  const camera = new ArcRotateCamera('camera', Math.PI / 2, 0.73, 30, Vector3.Zero(), scene);
  const world = {
    camera: { camera },
    terrain: { heightAt: () => 0 },
    viewMatrix: Matrix.Identity(),
    viewPlanes: Frustum.GetPlanes(Matrix.Identity()),
    viewPoint: new Vector3(),
    inView: GameWorld.prototype.inView,
  } as unknown as VisualWorld;
  methods.updateView.call(world);
  const root = new Mesh('unit', scene);
  const clip = new AnimationGroup('walk', scene);
  const animation = new Animation('walk', 'rotation.y', 30, Animation.ANIMATIONTYPE_FLOAT);
  animation.setKeys([
    { frame: 0, value: 0 },
    { frame: 30, value: 1 },
  ]);
  clip.addTargetedAnimation(animation, root);
  clip.start(true);
  const unit = {
    x: 0,
    y: 0,
    height: 3,
    scale: 1,
    flyHeight: 0,
    anim: 'walk',
    visualVisible: true,
    animationStarted: 1000,
    animationSpeed: 1,
    model: { root, meshes: [root], animations: new Map([['walk', clip]]) },
    effects: { setVisible: vi.fn() },
  } as unknown as Unit;
  return {
    world,
    unit,
    clip,
    scene,
    engine,
    dispose() {
      scene.dispose();
      engine.dispose();
    },
  };
}

describe('off-camera visual work', () => {
  it('keeps the target and edge margin, rejects distant units, and follows a camera teleport', () => {
    const f = fixture();
    try {
      expect(f.world.inView(f.unit)).toBe(true);
      f.unit.x = 200;
      expect(f.world.inView(f.unit)).toBe(false);
      f.world.camera.camera.target.x = 200;
      methods.updateView.call(f.world);
      expect(f.world.inView(f.unit)).toBe(true);
      // Full projection remains unchanged (HUD scissoring does not alter it).
      expect(f.world.camera.camera.viewport.width).toBe(1);
    } finally {
      f.dispose();
    }
  });

  it('pauses outside the camera and restores wall-clock phase and scale on return', () => {
    const f = fixture();
    const now = vi.spyOn(performance, 'now').mockReturnValue(2250);
    try {
      f.unit.x = 200;
      methods.updateVisualVisibility.call(f.world, f.unit);
      expect(f.clip.isPlaying).toBe(false);
      expect(f.unit.model.meshes[0]!.isVisible).toBe(false);
      expect(f.unit.model.root.isEnabled()).toBe(true);
      f.unit.x = 0;
      f.unit.scale = 1.4;
      methods.updateVisualVisibility.call(f.world, f.unit);
      expect(f.clip.isPlaying).toBe(true);
      expect(f.clip.getCurrentFrame()).toBeCloseTo(7.5);
      expect(f.unit.model.root.rotation.y).toBeCloseTo(0.25);
      expect(f.unit.model.root.scaling.x).toBe(1.4);
      expect(f.unit.effects!.setVisible).toHaveBeenLastCalledWith(true);
    } finally {
      now.mockRestore();
      f.dispose();
    }
  });

  it('keeps a hidden miner/hero hidden and clamps an expired one-shot to its last pose', () => {
    const f = fixture();
    const now = vi.spyOn(performance, 'now').mockReturnValue(5000);
    try {
      f.clip.loopAnimation = false;
      f.unit.model.root.setEnabled(false);
      methods.updateVisualVisibility.call(f.world, f.unit);
      expect(f.unit.visualVisible).toBe(false);
      f.unit.model.root.setEnabled(true);
      methods.updateVisualVisibility.call(f.world, f.unit);
      expect(f.clip.getCurrentFrame()).toBeCloseTo(30);
      expect(f.unit.model.root.rotation.y).toBeCloseTo(1);
    } finally {
      now.mockRestore();
      f.dispose();
    }
  });
});

describe('baked army units off camera', () => {
  it('hide their instance without touching the GPU clip, and snap scale on return', () => {
    const f = fixture();
    try {
      const settings = new Vector4(5, 30, 2, 60);
      Object.assign(f.unit.model, { animations: new Map(), baked: { clips: new Map(), settings, loop: true, held: false } });
      f.unit.x = 200;
      methods.updateVisualVisibility.call(f.world, f.unit);
      expect(f.unit.model.meshes[0]!.isVisible).toBe(false);
      f.unit.x = 0;
      f.unit.scale = 1.2;
      methods.updateVisualVisibility.call(f.world, f.unit);
      expect(f.unit.model.meshes[0]!.isVisible).toBe(true);
      expect(f.unit.model.root.scaling.x).toBe(1.2);
      expect(settings.asArray()).toEqual([5, 30, 2, 60]);
      expect(f.clip.isPlaying).toBe(true);
    } finally {
      f.dispose();
    }
  });
});

it('reuses static shadow maps but refreshes camera moves and animated casters', () => {
  const engine = new NullEngine();
  const scene = new Scene(engine);
  const map = new RenderTargetTexture('shadow', 64, scene);
  const resetRefreshCounter = vi.spyOn(map, 'resetRefreshCounter');
  const refreshWrites = vi.spyOn(map, 'refreshRate', 'set');
  const light = { position: Vector3.Zero(), shadowFrustumSize: 80 };
  const mesh = new Mesh('caster', scene);
  map.renderList = [mesh];
  const world = {
    shadows: { getLight: () => light, getShadowMap: () => map },
    shadowDirty: true,
    shadowLight: new Vector3(Infinity, Infinity, Infinity),
    shadowSize: -1,
    shadowEnabled: false,
    shadowPoses: new Map(),
    units: new Set(),
    scene: { shadowsEnabled: true },
    renderStats: { shadowRefreshes: 0 },
  };
  const update = () => (GameWorld.prototype as unknown as { updateShadowBudget(): void }).updateShadowBudget.call(world);
  update();
  update();
  expect(resetRefreshCounter).toHaveBeenCalledTimes(1);
  light.position.x = 10;
  update();
  expect(resetRefreshCounter).toHaveBeenCalledTimes(2);
  mesh.skeleton = new Skeleton('rig', 'rig', scene);
  update();
  update();
  expect(resetRefreshCounter).toHaveBeenCalledTimes(4);
  mesh.isVisible = false;
  update();
  update();
  expect(resetRefreshCounter).toHaveBeenCalledTimes(4);
  world.scene.shadowsEnabled = false;
  update();
  world.scene.shadowsEnabled = true;
  update();
  expect(resetRefreshCounter).toHaveBeenCalledTimes(6);
  expect(refreshWrites).toHaveBeenCalledOnce();
  scene.dispose();
  engine.dispose();
});
