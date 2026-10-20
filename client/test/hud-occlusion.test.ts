import { Observable } from '@babylonjs/core/Misc/observable';
import type { Scene } from '@babylonjs/core/scene';
import { afterEach, expect, it, vi } from 'vitest';
import { HudOcclusion } from '../src/render/hud-occlusion';

afterEach(() => vi.unstubAllGlobals());
it.each([false, true])('scissors only the draw phase at native scale, without changing the viewport (WebGPU %s)', (isWebGPU) => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal('window', { addEventListener() {}, removeEventListener() {} });
  const engine = {
    isWebGPU,
    _currentRenderTarget: {},
    getRenderingCanvas: () => ({ clientHeight: 720 }),
    getRenderWidth: () => 2560,
    getRenderHeight: () => 1440,
    enableScissor: vi.fn(),
    disableScissor: vi.fn(),
  };
  const scene = {
    getEngine: () => engine,
    onBeforeDrawPhaseObservable: new Observable(),
    onAfterDrawPhaseObservable: new Observable(),
    onDisposeObservable: new Observable(),
  };
  const hud = new HudOcclusion(scene as unknown as Scene, { getBoundingClientRect: () => ({ bottom: 80 }) } as unknown as HTMLElement);
  scene.onBeforeDrawPhaseObservable.notifyObservers(null);
  expect(engine.enableScissor).not.toHaveBeenCalled();
  hud.enabled = true;
  scene.onBeforeDrawPhaseObservable.notifyObservers(null);
  expect(engine.enableScissor).toHaveBeenCalledWith(0, 0, 2560, 1296);
  scene.onAfterDrawPhaseObservable.notifyObservers(null);
  expect(engine.disableScissor).toHaveBeenCalledOnce();
  hud.enabled = false;
  scene.onBeforeDrawPhaseObservable.notifyObservers(null);
  expect(engine.enableScissor).toHaveBeenCalledOnce();
  scene.onDisposeObservable.notifyObservers(null);
});
