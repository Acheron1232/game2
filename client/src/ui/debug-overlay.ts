// Small corner with renderer, FPS and ping. Toggle with F3.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { WebGPUEngine } from '@babylonjs/core/Engines/webgpuEngine';
import type { WebGPURenderTargetWrapper } from '@babylonjs/core/Engines/WebGPU/webgpuRenderTargetWrapper';
import type { RenderTargetWrapper } from '@babylonjs/core/Engines/renderTargetWrapper';
import type { RenderTargetTexture } from '@babylonjs/core/Materials/Textures/renderTargetTexture';
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
  adapter = 'unavailable',
): void {
  node.title = `Graphics adapter: ${adapter}. CPU measures scene rendering only, not all main-thread work. GPU timing may be unavailable on this browser or driver.`;
  const adapterLabel = adapter.length > 90 ? `${adapter.slice(0, 87)}…` : adapter;
  const inst = scene ? new SceneInstrumentation(scene) : null;
  const gpu = new EngineInstrumentation(engine);
  const gpuTiming = !!engine.getCaps().timerQuery;
  const webgpu = engine instanceof WebGPUEngine ? engine : null;
  const syncVisibility = () => {
    // WebGPU's legacy whole-frame counter uses writeTimestamp, which Chrome no longer
    // exposes. Use supported render-pass timestamps instead of displaying a false zero.
    if (webgpu) webgpu.enableGPUTimingMeasurements = gpuTiming && !node.hidden;
    else gpu.captureGPUFrameTime = gpuTiming && !node.hidden;
    if (inst) inst.captureFrameTime = !node.hidden;
  };
  // Settings also change visibility. Hidden diagnostics must not keep issuing GPU queries.
  new MutationObserver(syncVisibility).observe(node, { attributes: true, attributeFilter: ['hidden'] });
  syncVisibility();
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F3') {
      ev.preventDefault();
      node.hidden = !node.hidden;
      syncVisibility();
    }
  });
  const targets = new Set<RenderTargetWrapper>();
  const gpuMilliseconds = () => {
    if (!gpuTiming) return 0;
    if (!webgpu) return gpu.gpuFrameTimeCounter.lastSecAverage / 1e6;
    let ns = webgpu.gpuTimeInFrameForMainPass?.counter.lastSecAverage ?? 0;
    targets.clear();
    // Targets created before diagnostics was enabled contribute to the main counter;
    // later targets have their own counter. Shared ping-pong buffers count only once.
    const add = (target: RenderTargetWrapper | null) => {
      if (!target || targets.has(target)) return;
      targets.add(target);
      ns += (target as WebGPURenderTargetWrapper).gpuTimeInFrame?.counter.lastSecAverage ?? 0;
    };
    for (const texture of scene?.textures ?? []) {
      if (texture.isRenderTarget && scene?.shadowsEnabled) add((texture as RenderTargetTexture).renderTarget);
    }
    for (const post of scene?.postProcesses ?? []) add(post.inputTexture);
    return ns / 1e6;
  };
  const update = () => {
    if (node.hidden) return;
    const ping = net.pingMs === null ? '—' : `${Math.round(net.pingMs)} ms`;
    const gpuMs = gpuMilliseconds();
    const extra =
      inst && scene
        ? ` · CPU ${inst.frameTimeCounter.lastSecAverage.toFixed(1)} ms · GPU${webgpu ? ' passes' : ''} ${gpuMs > 0 ? gpuMs.toFixed(1) + ' ms' : 'unavailable'} · draws ${inst.drawCallsCounter.current} · tris ${Math.round(scene.getActiveIndices() / 3 / 1000)}k`
        : '';
    setText(
      node,
      `${renderer} · ${S.fps} ${Math.round(engine.getFps())}/${engine.maxFPS ?? '∞'} · ${engine.getRenderWidth()}×${engine.getRenderHeight()}${extra} · adapter ${adapterLabel} · ${S.ping} ${ping}${more?.() ?? ''}`,
    );
  };
  update();
  setInterval(update, 500);
}
