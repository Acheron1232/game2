// Small corner with renderer, FPS and ping. Toggle with F3.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import '@babylonjs/core/Engines/AbstractEngine/abstractEngine.timeQuery';
import '@babylonjs/core/Engines/Extensions/engine.query';
import '@babylonjs/core/Engines/WebGPU/Extensions/engine.query';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { EngineInstrumentation } from '@babylonjs/core/Instrumentation/engineInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import type { NetState } from '../net/socket';
import { setText } from './dom';
import { S } from './strings';

export function startDebugOverlay(
  node: HTMLElement,
  engine: AbstractEngine,
  renderer: string,
  net: NetState,
  scene?: Scene,
  more?: () => string,
): void {
  const inst = scene ? new SceneInstrumentation(scene) : null;
  const gpu = new EngineInstrumentation(engine);
  const gpuTiming = !!engine.getCaps().timerQuery;
  gpu.captureGPUFrameTime = gpuTiming;
  if (inst) inst.captureFrameTime = true;
  node.hidden = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F3') {
      ev.preventDefault();
      node.hidden = !node.hidden;
      gpu.captureGPUFrameTime = gpuTiming && !node.hidden;
    }
  });
  const update = () => {
    const ping = net.pingMs === null ? '—' : `${Math.round(net.pingMs)} ms`;
    const extra =
      inst && scene
        ? ` · CPU ${inst.frameTimeCounter.lastSecAverage.toFixed(1)} ms · GPU ${gpuTiming && gpu.gpuFrameTimeCounter.lastSecAverage > 0 ? (gpu.gpuFrameTimeCounter.lastSecAverage / 1e6).toFixed(1) + ' ms' : '—'} · draws ${inst.drawCallsCounter.current} · tris ${Math.round(scene.getActiveIndices() / 3 / 1000)}k`
        : '';
    setText(
      node,
      `${renderer} · ${S.fps} ${Math.round(engine.getFps())}/${engine.maxFPS ?? '∞'} · ${engine.getRenderWidth()}×${engine.getRenderHeight()}${extra} · ${S.ping} ${ping}${more?.() ?? ''}`,
    );
  };
  update();
  setInterval(update, 500);
}
