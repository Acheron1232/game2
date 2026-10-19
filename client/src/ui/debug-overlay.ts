// Small corner with renderer, FPS and ping. Toggle with F3.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import type { Scene } from '@babylonjs/core/scene';
import type { NetState } from '../net/socket';
import { setText } from './dom';
import { S } from './strings';

export function startDebugOverlay(node: HTMLElement, engine: AbstractEngine, renderer: string, net: NetState, scene?: Scene): void {
  const inst = scene ? new SceneInstrumentation(scene) : null;
  if (inst) inst.captureFrameTime = true;
  node.hidden = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F3') {
      ev.preventDefault();
      node.hidden = !node.hidden;
    }
  });
  const update = () => {
    const ping = net.pingMs === null ? '—' : `${Math.round(net.pingMs)} ms`;
    const extra =
      inst && scene
        ? ` · ${inst.frameTimeCounter.lastSecAverage.toFixed(1)} ms · draws ${inst.drawCallsCounter.current} · tris ${Math.round(scene.getActiveIndices() / 3 / 1000)}k`
        : '';
    setText(node, `${renderer} · ${S.fps} ${Math.round(engine.getFps())}${extra} · ${S.ping} ${ping}`);
  };
  update();
  setInterval(update, 500);
}
