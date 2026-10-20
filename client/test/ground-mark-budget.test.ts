import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { Scene } from '@babylonjs/core/scene';
import { expect, it, vi } from 'vitest';
import { UnitGroundMarks } from '../src/render/unit-ground-marks';
import type { Unit } from '../src/render/world';

it('does not upload unchanged marks; culls off-camera units without stale instances', () => {
  const engine = new NullEngine();
  const gradient = { addColorStop() {} };
  const context = { createRadialGradient: () => gradient, fillRect() {} };
  vi.spyOn(engine, 'createCanvas').mockReturnValue({ width: 64, height: 64, getContext: () => context } as unknown as HTMLCanvasElement);
  const scene = new Scene(engine);
  try {
    const marks = new UnitGroundMarks(scene);
    const unit = {
      x: 20.1,
      y: 30.2,
      height: 2,
      scale: 1,
      visualVisible: true,
      markerTeam: 'red',
      model: { root: { isEnabled: () => true } },
    } as unknown as Unit;
    const heightAt = () => 0.123;
    marks.update([unit], heightAt, true);
    const layers = scene.meshes.filter((m) => m.name === 'unit-contact-shadows' || m.name === 'unit-ground-red');
    const uploads = layers.map((m) => vi.spyOn(m, 'thinInstanceBufferUpdated'));
    marks.update([unit], heightAt, true);
    for (const spy of uploads) expect(spy).not.toHaveBeenCalled();
    unit.visualVisible = false;
    marks.update([unit], heightAt, true);
    expect(layers.every((m) => !m.isEnabled())).toBe(true);
    unit.visualVisible = true;
    unit.x += 10;
    marks.update([unit], heightAt, true);
    expect(layers.every((m) => m.isEnabled())).toBe(true);
    for (const spy of uploads) expect(spy).toHaveBeenCalledOnce();
    marks.update([unit], heightAt, false);
    expect(layers[0]!.isEnabled()).toBe(false);
  } finally {
    scene.dispose();
    engine.dispose();
  }
});
