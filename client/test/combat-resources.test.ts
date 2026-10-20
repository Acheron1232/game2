import { NullEngine } from '@babylonjs/core/Engines/nullEngine';
import { RawTexture } from '@babylonjs/core/Materials/Textures/rawTexture';
import { Scene } from '@babylonjs/core/scene';
import { BuffFlag } from '@game/shared';
import { describe, expect, it, vi } from 'vitest';
import { AbilityFx } from '../src/render/ability-fx';
import { HealthBars } from '../src/render/health-bars';
import { effectsAtlas } from '../src/render/hero-effects';
import type * as HeroEffectsModule from '../src/render/hero-effects';
import { Projectiles } from '../src/render/projectiles';

vi.mock('../src/render/hero-effects', async (original) => {
  const real = await original<typeof HeroEffectsModule>();
  const textures = new WeakMap<Scene, RawTexture>();
  return {
    ...real,
    effectsAtlas: (scene: Scene) => {
      let texture = textures.get(scene);
      if (!texture) {
        texture = RawTexture.CreateRGBATexture(new Uint8Array([255, 255, 255, 255]), 1, 1, scene);
        textures.set(scene, texture);
      }
      return texture;
    },
  };
});

describe('combat render resources', () => {
  it('does not upload matrix buffers for empty health-bar layers', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const bars = new HealthBars(scene, 0.7);
    try {
      bars.update([{ x: 20, y: 3, z: -20, hp: 1, mana: 1, hero: true, color: '#00ff00' }], 1);
      const uploads = scene.meshes.filter((m) => m.name.startsWith('bar-')).map((m) => vi.spyOn(m, 'thinInstanceBufferUpdated'));
      bars.update([], 0);
      for (const upload of uploads) expect(upload).not.toHaveBeenCalled();
      bars.update([{ x: 30, y: 3, z: -20, hp: 0.5, mana: 0.5, hero: true, color: '#00ff00' }], 1);
      for (const upload of uploads) expect(upload).toHaveBeenCalledTimes(1);
    } finally {
      bars.dispose();
      scene.dispose();
      engine.dispose();
    }
  });

  it('removes a cancelled channel zone before its normal duration ends', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const fx = new AbilityFx(scene);
    try {
      fx.disc(20, 0, -20, 5, '#b07bff', 4, 7);
      fx.update(0);
      expect(scene.meshes.some((m) => m.name.endsWith('-c') && m.isEnabled())).toBe(true);
      now.mockReturnValue(1500);
      fx.endZones(7);
      now.mockReturnValue(1800);
      fx.update(0);
      expect(scene.meshes.some((m) => m.name.endsWith('-c') && m.isEnabled())).toBe(false);
    } finally {
      fx.dispose();
      scene.dispose();
      engine.dispose();
      now.mockRestore();
    }
  });

  it('returns to the scene baseline after repeated matches without disposing the shared atlas', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const atlas = effectsAtlas(scene);
    // Babylon creates its scene-owned fallback material on the first clone.
    void scene.defaultMaterial;
    const baseline = [scene.meshes.length, scene.materials.length, scene.particleSystems.length, scene.textures.length];
    try {
      for (let i = 0; i < 5; i++) {
        const fx = new AbilityFx(scene);
        const bars = new HealthBars(scene, 0.7);
        const projectiles = new Projectiles(scene);
        fx.ring(20, 0, -20, 3, '#ff0000');
        fx.disc(20, 0, -20, 3, '#ff0000', 5, 1);
        fx.cone(20, 0, -20, 8, 60, 0, '#ff0000');
        fx.bolt(20, 20, 2, 30, 20, 20, '#ff0000');
        fx.setMarkers(1, BuffFlag.Stun | BuffFlag.Root, 20, 0, 3, -20, 1);
        fx.burst(20, 2, -20, 'fire', '#ff0000', '#ff8800');
        bars.update([{ x: 20, y: 3, z: -20, hp: 0.5, mana: 1, hero: true, color: '#00ff00' }], 1);
        projectiles.fire(
          20,
          20,
          2,
          10,
          (out) => {
            Object.assign(out, { x: 30, y: 20, h: 2 });
            return true;
          },
          '#ff0000',
        );
        fx.dispose();
        bars.dispose();
        projectiles.dispose();
        expect([scene.meshes.length, scene.materials.length, scene.particleSystems.length, scene.textures.length]).toEqual(baseline);
        expect(atlas.getInternalTexture()).not.toBeNull();
      }
    } finally {
      scene.dispose();
      engine.dispose();
    }
  });

  it('hides empty instance layers and places a reused bolt before the next frame', () => {
    const engine = new NullEngine();
    const scene = new Scene(engine);
    const fx = new AbilityFx(scene);
    const bars = new HealthBars(scene, 0.7);
    const projectiles = new Projectiles(scene);
    try {
      bars.update([], 0);
      expect(scene.meshes.filter((m) => m.name.startsWith('bar-')).every((m) => !m.isEnabled())).toBe(true);
      projectiles.fire(20, 20, 2, 10, () => false, '#ff0000');
      projectiles.update(0.1);
      expect(scene.meshes.find((m) => m.name.startsWith('projectile-'))?.isEnabled()).toBe(false);
      fx.bolt(20, 20, 2, 30, 20, 20, '#ff0000');
      fx.update(1);
      fx.bolt(70, 80, 3, 90, 80, 20, '#ff0000');
      expect(scene.getMeshByName('fx-bolt')?.position.asArray()).toEqual([70, 3, -80]);
    } finally {
      fx.dispose();
      bars.dispose();
      projectiles.dispose();
      scene.dispose();
      engine.dispose();
    }
  });
});
