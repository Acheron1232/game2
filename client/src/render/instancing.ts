// Thin instances split into map chunks. One big thin-instance buffer is always drawn whole (its
// bounding box covers the map), so the GPU draws every tree even off screen. Chunks let the
// camera skip what it can not see, for a few more draw calls.

import { Matrix } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export const INSTANCE_CHUNK = 48;

/**
 * Places `count` copies of `mesh`. `at(i)` gives the game position of copy i (for its chunk),
 * `compose(i, out)` writes its world matrix. The mesh node's own transform (it holds the
 * KHR_mesh_quantization scale) is baked into every copy, then cleared.
 */
export function scatterInstances(
  mesh: Mesh,
  count: number,
  at: (i: number) => [number, number],
  compose: (i: number, out: Matrix) => void,
  chunk = INSTANCE_CHUNK,
  /** told where copy i ended up (mesh, thin instance index, the mesh's matrix buffer), for later changes */
  placed?: (i: number, mesh: Mesh, slot: number, data: Float32Array) => void,
): Mesh[] {
  const local = mesh.computeWorldMatrix(true).clone();
  mesh.parent = null;
  mesh.position.setAll(0);
  mesh.rotationQuaternion = null;
  mesh.scaling.setAll(1);

  const buckets = new Map<string, number[]>();
  for (let i = 0; i < count; i++) {
    const [x, y] = at(i);
    const key = `${Math.floor(x / chunk)},${Math.floor(y / chunk)}`;
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = []));
    b.push(i);
  }
  // Clone first: the clones share the geometry and the material, and get their own buffers.
  const lists = [...buckets.values()];
  // Thin-instance buffers live on the geometry, so each clone needs its own (small) geometry copy.
  const meshes = lists.map((_, k) => {
    if (k === 0) return mesh;
    const c = mesh.clone(`${mesh.name}-${k}`, null, true)!;
    c.makeGeometryUnique();
    return c;
  });
  const m = new Matrix();
  const out = new Matrix();
  lists.forEach((list, k) => {
    const target = meshes[k]!;
    const buf = new Float32Array(list.length * 16);
    list.forEach((i, j) => {
      compose(i, m);
      local.multiplyToRef(m, out);
      out.copyToArray(buf, j * 16);
      placed?.(i, target, j, buf);
    });
    // A buffer that may change later (chopped trees) must not be static.
    target.thinInstanceSetBuffer('matrix', buf, 16, !placed);
    target.thinInstanceRefreshBoundingInfo(false);
    target.alwaysSelectAsActiveMesh = false;
    target.isPickable = false;
    target.freezeWorldMatrix();
    target.doNotSyncBoundingInfo = true;
  });
  if (!count) mesh.setEnabled(false);
  return meshes;
}
