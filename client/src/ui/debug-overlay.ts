// Small corner with renderer, FPS and ping. Toggle with F3.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { NetState } from '../net/socket';
import { setText } from './dom';
import { S } from './strings';

export function startDebugOverlay(node: HTMLElement, engine: AbstractEngine, renderer: string, net: NetState): void {
  node.hidden = false;
  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F3') {
      ev.preventDefault();
      node.hidden = !node.hidden;
    }
  });
  const update = () => {
    const ping = net.pingMs === null ? '—' : `${Math.round(net.pingMs)} ms`;
    setText(node, `${renderer} · ${S.fps} ${Math.round(engine.getFps())} · ${S.ping} ${ping}`);
  };
  update();
  setInterval(update, 500);
}
