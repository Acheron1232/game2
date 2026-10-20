import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { Viewport } from '@babylonjs/core/Maths/math.viewport';
import { Scene } from '@babylonjs/core/scene';
import { describe, expect, it, vi } from 'vitest';
import { GameWorld } from '../src/render/world';

describe('world positions in CSS pixels', () => {
  it.each([1, 2, 3])('projects the camera target to the center at DPR %i', (ratio) => {
    const engine = new NullEngine({
      renderWidth: 1280 * ratio,
      renderHeight: 720 * ratio,
      textureSize: 512,
      deterministicLockstep: false,
      lockstepMaxSteps: 4,
    });
    const scene = new Scene(engine);
    scene.useRightHandedSystem = true;
    const camera = new ArcRotateCamera('test', Math.PI / 2, 0.73, 30, Vector3.Zero(), scene);
    vi.spyOn(engine, 'getRenderingCanvas').mockReturnValue({ clientWidth: 1280 } as HTMLCanvasElement);
    scene.updateTransformMatrix(true);
    const world = {
      engine,
      scene,
      camera: { camera },
      terrain: { heightAt: () => 0 },
      screenPosition: new Vector3(),
      screenViewport: new Viewport(0, 0, 0, 0),
    } as unknown as GameWorld;
    const out = { x: 0, y: 0 };
    try {
      expect(GameWorld.prototype.screenPoint.call(world, 0, 0, 0, out)).toBe(true);
      expect(out.x).toBeCloseTo(640, 2);
      expect(out.y).toBeCloseTo(360, 2);
      GameWorld.prototype.screenPoint.call(world, 0, 0, 3.5, out);
      expect(out.y).toBeLessThan(360);
      expect(out.x).toBeCloseTo(640, 2);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
