// Starts Babylon: WebGPU when the browser has it, WebGL2 otherwise. WebGL1 is not supported.

import { Engine } from '@babylonjs/core/Engines/engine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { MENU_FPS, renderScale } from './render-budget';

export type RendererKind = 'WebGPU' | 'WebGL2';

export interface GameEngine {
  engine: AbstractEngine;
  kind: RendererKind;
  adapter: string;
  setRenderScale: (scale: number) => void;
}

/** Render at native display resolution and pause work when the window is inactive. */
function configureRenderBudget(engine: AbstractEngine): GameEngine['setRenderScale'] {
  engine.maxFPS = MENU_FPS;
  engine.renderEvenInBackground = false;
  let qualityScale = 1;
  const resize = () => {
    engine.setHardwareScalingLevel(renderScale(window.devicePixelRatio) / qualityScale);
    engine.resize();
  };
  window.addEventListener('resize', resize);
  engine.onDisposeObservable.addOnce(() => window.removeEventListener('resize', resize));
  resize();
  return (scale) => {
    qualityScale = scale;
    resize();
  };
}

function describeAdapter(engine: Engine | WebGPUEngine): string {
  const info = engine.getInfo();
  return [info.vendor, info.renderer, info.version].filter((part) => part && !part.startsWith('unknown ')).join(' / ') || 'unavailable';
}

export async function createEngine(canvas: HTMLCanvasElement): Promise<GameEngine> {
  // ?webgl in the URL forces the fallback, handy for testing.
  const forceWebGL = new URLSearchParams(location.search).has('webgl');
  if (!forceWebGL && (await WebGPUEngine.IsSupportedAsync)) {
    let engine: WebGPUEngine | undefined;
    try {
      // MSAA instead of an FXAA post-process: no extra full-screen pass (see GameWorld).
      engine = new WebGPUEngine(canvas, {
        antialias: true,
        adaptToDeviceRatio: false,
        powerPreference: 'high-performance',
        // Babylon filters unsupported features before requestDevice. Keep timings optional.
        deviceDescriptor: { requiredFeatures: ['timestamp-query'] },
      });
      await engine.initAsync();
      const setRenderScale = configureRenderBudget(engine);
      return { engine, kind: 'WebGPU', adapter: describeAdapter(engine), setRenderScale };
    } catch (err) {
      try {
        engine?.dispose();
      } catch {
        // Babylon disposal assumes init reached the GPU resource setup. An adapter
        // failure can happen earlier; cleanup must not prevent the WebGL fallback.
      }
      console.warn('WebGPU failed to start, using WebGL2.', err);
    }
  }
  const engine = new Engine(
    canvas,
    true,
    { powerPreference: 'high-performance', preserveDrawingBuffer: false, stencil: true, disableWebGL2Support: false },
    false,
  );
  if (engine.webGLVersion < 2) {
    engine.dispose();
    throw new Error('Your browser does not support WebGL2. Please update your browser.');
  }
  const setRenderScale = configureRenderBudget(engine);
  return { engine, kind: 'WebGL2', adapter: describeAdapter(engine), setRenderScale };
}
