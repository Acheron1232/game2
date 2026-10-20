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
    camera.lookAt(16, 128);
    expect(camera.target.x).toBe(16); // west-base view must not be clamped 40 units inward
    camera.lookAt(128, 128);
    const move = (y: number, x = 640) => host.dispatchEvent(Object.assign(new Event('pointermove'), { clientX: x, clientY: y }));
    const frames = (n: number) => {
      for (let i = 0; i < n; i++) scene.onBeforeRenderObservable.notifyObservers(scene);
    };
    try {
      move(360, 20); // before reaching the browser sidebar at the exact left edge
      frames(60);
      expect(camera.target.x).toBeLessThan(105);
      move(360, 1260);
      frames(120);
      expect(camera.target.x).toBeGreaterThan(145);
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
      camera.lookAt(128, 128);
      const down = Object.assign(new Event('pointerdown'), { clientX: 640, clientY: 360, button: 0, altKey: true });
      canvas.dispatchEvent(down);
      expect(camera.dragging).toBe(true);
      move(420, 740);
      frames(60);
      expect(camera.target.x).toBeLessThan(125);
      expect(camera.target.y).toBeGreaterThan(130);
      host.dispatchEvent(new Event('pointerup'));
      expect(camera.dragging).toBe(false);
      host.dispatchEvent(Object.assign(new Event('keydown'), { key: 'ArrowLeft', code: 'ArrowLeft' }));
      camera.enabled = false;
      camera.enabled = true;
      camera.lookAt(128, 128);
      move(360);
      frames(60);
      expect(camera.target.x).toBeCloseTo(128, 2);
      vi.stubGlobal('document', Object.assign(new EventTarget(), { pointerLockElement: canvas }));
      canvas.dispatchEvent(Object.assign(new Event('pointerdown'), { clientX: 0, clientY: 360, button: 1 }));
      const lockedMove = () =>
        host.dispatchEvent(
          Object.assign(new Event('pointermove'), {
            clientX: 0,
            clientY: 360,
            movementX: -100,
            movementY: 0,
          }),
        );
      lockedMove();
      frames(60);
      const firstPan = camera.target.x;
      lockedMove(); // The virtual cursor is at its edge, but relative movement still pans.
      frames(60);
      expect(camera.target.x).toBeGreaterThan(firstPan + 4);
      host.dispatchEvent(new Event('pointercancel'));
      expect(camera.dragging).toBe(false);
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });
});
