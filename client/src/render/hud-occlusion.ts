import type { Scene } from '@babylonjs/core/scene';

/** Keep the full projection/picking area, but skip shading under the opaque top HUD.
 * Leave eight CSS pixels of overscan for FXAA/texture filtering at the boundary.
 * Transparent bottom-panel gaps deliberately stay rendered. */
export class HudOcclusion {
  enabled = false;
  private top = 0;
  constructor(scene: Scene, panel: HTMLElement) {
    const engine = scene.getEngine();
    const measure = () => {
      this.top = Math.max(0, panel.getBoundingClientRect().bottom - 8);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(panel);
    window.addEventListener('resize', measure);
    measure();
    scene.onBeforeDrawPhaseObservable.add(() => {
      if (!this.enabled || this.top <= 0) return;
      const canvas = engine.getRenderingCanvas();
      if (!canvas?.clientHeight) return;
      const width = engine.getRenderWidth(),
        height = engine.getRenderHeight();
      const cut = Math.min(height - 1, Math.floor((this.top * height) / canvas.clientHeight));
      // Babylon flips normal WebGPU RTTs to preserve WebGL texture orientation.
      // Use the same rectangle on both backends; offsetting RTT y clips the bottom.
      engine.enableScissor(0, 0, width, height - cut);
    });
    scene.onAfterDrawPhaseObservable.add(() => engine.disableScissor());
    scene.onDisposeObservable.addOnce(() => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    });
  }
}
