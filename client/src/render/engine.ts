// Starts Babylon: WebGPU when the browser has it, WebGL2 otherwise. WebGL1 is not supported.

import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';

export type RendererKind = 'WebGPU' | 'WebGL2';

export interface GameEngine {
  engine: AbstractEngine;
  kind: RendererKind;
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<GameEngine> {
  // ?webgl in the URL forces the fallback, handy for testing.
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
    try {
      const engine = new WebGPUEngine(canvas, { antialias: true, adaptToDeviceRatio: true });
      await engine.initAsync();
      return { engine, kind: 'WebGPU' };
    } catch (err) {
      console.warn('WebGPU failed to start, using WebGL2.', err);
    }
  }
  const engine = new Engine(canvas, true, { preserveDrawingBuffer: false, stencil: true, disableWebGL2Support: false }, true);
  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error('Your browser does not support WebGL2. Please update your browser.');
  }
  return { engine, kind: 'WebGL2' };
}
