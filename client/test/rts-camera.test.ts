import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RtsCamera } from '../src/render/rts-camera';

afterEach(() => vi.unstubAllGlobals());

describe('camera input across HUD panels', () => {
  it('scrolls north and south from window pointer events, and stops after leaving', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const host = new EventTarget();
    vi.stubGlobal('window', host);
    const canvas = Object.assign(new EventTarget(), {
      clientWidth: 1280,
      clientHeight: 720,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
    }) as unknown as HTMLCanvasElement;
    vi.spyOn(engine, 'getDeltaTime').mockReturnValue(1000 / 60);
    const camera = new RtsCamera(scene, canvas, () => 0, 256);
    camera.lookAt(128, 128);
    const move = (y: number) => host.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: 640, clientY: y }));
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
    };
    try {
      move(4); // top HUD, not the canvas
      frames(60);
      expect(camera.target.y).toBeGreaterThan(150);
      move(716); // bottom HUD
      frames(120);
      expect(camera.target.y).toBeLessThan(110);
      host.dispatchEvent(Object.assign(new Event('pointerout'), { relatedTarget: null }));
      frames(60); // allow existing easing to settle
      const stopped = camera.target.y;
      frames(60);
      expect(camera.target.y).toBeCloseTo(stopped, 2);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
