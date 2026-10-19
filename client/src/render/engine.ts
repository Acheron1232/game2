// Starts Babylon: WebGPU when the browser has it, WebGL2 otherwise. WebGL1 is not supported.

import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { MENU_FPS, renderScale } from './render-budget';

export type RendererKind = 'WebGPU' | 'WebGL2';

export interface GameEngine {
  engine: AbstractEngine;
  kind: RendererKind;
}

/** Render at native display resolution and pause work when the window is inactive. */
function configureRenderBudget(engine: AbstractEngine): void {
  engine.maxFPS = MENU_FPS;
  engine.renderEvenInBackground = false;
  const resize = () => {
    engine.setHardwareScalingLevel(renderScale(window.devicePixelRatio));
    engine.resize();
  };
  window.addEventListener('resize', resize);
  resize();
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<GameEngine> {
  // ?webgl in the URL forces the fallback, handy for testing.
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      // FXAA is applied by the scene; avoid paying for native MSAA as well.
      const engine = new WebGPUEngine(canvas, { antialias: false, adaptToDeviceRatio: false });
      await engine.initAsync();
      configureRenderBudget(engine);
      return { engine, kind: 'WebGPU' };
    } catch (err) {
      console.warn('WebGPU failed to start, using WebGL2.', err);
    }
  }
  const engine = new Engine(canvas, false, { preserveDrawingBuffer: false, stencil: true, disableWebGL2Support: false }, false);
  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error('Your browser does not support WebGL2. Please update your browser.');
  }
  configureRenderBudget(engine);
  return { engine, kind: 'WebGL2' };
}
