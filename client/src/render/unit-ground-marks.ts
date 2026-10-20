// Shared thin-instance layers: soft contact shadows and team ground areas, not one mesh per unit.
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { Scene } from '@babylonjs/core/scene';
import type { Unit } from './world';
import { TEAM_COLORS } from './team-material';

class GroundLayer {
  private readonly mesh;
  private matrices = new Float32Array(16 * 128);
  private count = 0;
  constructor(scene: Scene, name: string, texture: DynamicTexture, color: string, alpha: number) {
    this.mesh = CreateGround(name, { width: 2, height: 2 }, scene);
    const material = new StandardMaterial(name, scene);
    material.disableLighting = true;
    material.emissiveColor = Color3.FromHexString(color);
    material.diffuseTexture = texture;
    material.useAlphaFromDiffuseTexture = true;
    material.alpha = alpha;
    material.disableDepthWrite = true;
    material.zOffset = -1;
    this.mesh.material = material;
    this.mesh.isPickable = false;
    this.mesh.alwaysSelectAsActiveMesh = true;
    this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    this.mesh.setEnabled(false);
  }
  put(x: number, height: number, y: number, radius: number): void {
    if ((this.count + 1) * 16 > this.matrices.length) {
      const next = new Float32Array(this.matrices.length * 2);
      next.set(this.matrices);
      this.matrices = next;
      this.mesh.thinInstanceSetBuffer('matrix', this.matrices, 16, false);
    }
    const at = this.count++ * 16;
    // Scale + translation only; reuse the instance buffer instead of allocating matrices.
    const b = this.matrices;
    b[at] = b[at + 10] = radius;
    b[at + 5] = b[at + 15] = 1;
    b[at + 12] = x;
    b[at + 13] = height;
    b[at + 14] = -y;
  }
  prepare(): void {
    this.put(0, -10000, 0, 1);
    this.flush();
  }
  flush(): void {
    this.mesh.setEnabled(this.count > 0);
    this.mesh.thinInstanceCount = this.count;
    if (this.count) this.mesh.thinInstanceBufferUpdated('matrix');
    this.count = 0;
  }
}

export function groundMarkRadius(u: Pick<Unit, 'height' | 'scale'>): number {
  return Math.max(0.7, Math.min(1.6, u.height * 0.4)) * u.scale;
}

export class UnitGroundMarks {
  private readonly shadows: GroundLayer;
  private warming = false;
  private readonly teams = new Map<string, GroundLayer>();
  constructor(private readonly scene: Scene) {
    const makeTexture = (name: string, shadow: boolean) => {
      const texture = new DynamicTexture(name, 64, scene, true);
      texture.hasAlpha = true;
      const ctx = texture.getContext();
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      if (shadow) {
        gradient.addColorStop(0, 'rgba(255,255,255,0.65)');
        gradient.addColorStop(0.4, 'rgba(255,255,255,0.42)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
      } else {
        gradient.addColorStop(0, 'rgba(255,255,255,0.10)');
        gradient.addColorStop(0.55, 'rgba(255,255,255,0.22)');
        gradient.addColorStop(0.78, 'rgba(255,255,255,0.65)');
        gradient.addColorStop(0.9, 'rgba(255,255,255,0.28)');
        gradient.addColorStop(1, 'rgba(255,255,255,0)');
      }
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, 64, 64);
      texture.update();
      return texture;
    };
    this.shadows = new GroundLayer(scene, 'unit-contact-shadows', makeTexture('soft-shadow', true), '#080b07', 0.68);
    const area = makeTexture('team-ground-area', false);
    for (const [team, color] of Object.entries({ ...TEAM_COLORS, neutral: '#9b8870' })) {
      this.teams.set(team, new GroundLayer(scene, `unit-ground-${team}`, area, color, 0.55));
    }
  }
  async warmUp(): Promise<void> {
    // Compile the normal instanced render path while loading, including fog uniforms.
    const layers = [this.shadows, ...this.teams.values()];
    this.warming = true;
    try {
      for (const layer of layers) layer.prepare();
      this.scene.render();
      await this.scene.whenReadyAsync();
    } finally {
      for (const layer of layers) layer.flush();
      this.warming = false;
    }
  }
  update(units: Iterable<Unit>, heightAt: (x: number, y: number) => number, shadows: boolean): void {
    if (this.warming) return;
    for (const u of units) {
      if (u.dead || u.building || !u.model.root.isEnabled()) continue;
      const radius = groundMarkRadius(u);
      const height = heightAt(u.x, u.y);
      // Flyers keep a wider ground shadow to show their position below the model.
      const offset = u.flyHeight ? 0.6 : 0.18;
      if (shadows) this.shadows.put(u.x + offset, height + 0.055, u.y + offset, radius * (u.flyHeight ? 1.35 : 1.05));
      this.teams.get(u.markerTeam)?.put(u.x, height + 0.075, u.y, radius);
    }
    this.shadows.flush();
    for (const layer of this.teams.values()) layer.flush();
  }
}
