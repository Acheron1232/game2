import { Material } from '@babylonjs/core/Materials/material';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import { Mesh } from '@babylonjs/core/Meshes/mesh';
import { VertexData } from '@babylonjs/core/Meshes/mesh.vertexData';
import type { Scene } from '@babylonjs/core/scene';

const FLASH_MS = 380;

/** Three small arrowheads pull into the clicked point, then disappear. One reused mesh. */
export class MoveOrderMarker {
  private readonly mesh: Mesh;
  private readonly material: StandardMaterial;
  private until = 0;

  constructor(scene: Scene) {
    const positions: number[] = [];
    const indices: number[] = [];
    for (let i = 0; i < 3; i++) {
      const angle = (i * Math.PI * 2) / 3;
      const c = Math.cos(angle),
        s = Math.sin(angle);
      const start = positions.length / 3;
      // A narrow notched tip, pointed toward the center. No circle or direction sign.
      for (const [x, z] of [
        [0, 0.12],
        [-0.11, 0.44],
        [0, 0.34],
        [0.11, 0.44],
      ])
        positions.push(x! * c - z! * s, 0, x! * s + z! * c);
      indices.push(start, start + 1, start + 2, start, start + 2, start + 3);
    }
    this.mesh = new Mesh('move-order-marker', scene);
    const data = new VertexData();
    data.positions = positions;
    data.indices = indices;
    data.normals = new Array<number>(positions.length).fill(0);
    VertexData.ComputeNormals(positions, indices, data.normals);
    data.applyToMesh(this.mesh);
    this.material = new StandardMaterial('move-order-green', scene);
    this.material.disableLighting = true;
    this.material.emissiveColor = Color3.FromHexString('#6de83c');
    this.material.backFaceCulling = false;
    this.material.disableDepthWrite = true;
    this.material.zOffset = -2;
    this.material.transparencyMode = Material.MATERIAL_ALPHABLEND;
    this.material.alpha = 0.85;
    this.mesh.material = this.material;
    this.mesh.isPickable = false;
    this.mesh.receiveShadows = false;
    this.mesh.setEnabled(false);
    scene.onBeforeRenderObservable.add(() => {
      if (!this.until) return;
      const left = this.until - performance.now();
      if (left <= 0) return this.hide();
      const progress = 1 - left / FLASH_MS;
      this.material.alpha = 0.85 * Math.min(1, left / 220);
      const scale = 1 - 0.42 * (1 - (1 - progress) * (1 - progress));
      this.mesh.scaling.set(scale, 1, scale);
    });
  }

  async warmUp(): Promise<void> {
    await this.material.forceCompilationAsync(this.mesh);
  }

  show(x: number, y: number, height: number): void {
    this.mesh.position.set(x, height + 0.1, -y);
    this.mesh.scaling.setAll(1);
    this.material.alpha = 0.85;
    this.until = performance.now() + FLASH_MS;
    this.mesh.setEnabled(true);
  }

  hide(): void {
    this.until = 0;
    this.mesh.setEnabled(false);
  }
}
