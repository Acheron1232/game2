import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { expect, it, vi } from 'vitest';
import { MoveOrderMarker } from '../src/render/move-order-marker';

it('shows a short click flash and reuses it when another move is clicked', () => {
  let now = 1000;
  const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
  const engine = new NullEngine();
  const scene = new Scene(engine);
  try {
    const marker = new MoveOrderMarker(scene);
    const mesh = scene.getMeshByName('move-order-marker')!;
    const meshes = scene.meshes.length;
    marker.show(20, 30, 0.2);
    expect(mesh.isEnabled()).toBe(true);
    now += 180;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(mesh.isEnabled()).toBe(true);
    marker.show(22, 32, 0.4);
    expect(scene.meshes.length).toBe(meshes);
    expect(mesh.position.x).toBe(22);
    now += 500;
    scene.onBeforeRenderObservable.notifyObservers(scene);
    expect(mesh.isEnabled()).toBe(false);
  } finally {
    clock.mockRestore();
    scene.dispose();
    engine.dispose();
  }
});
