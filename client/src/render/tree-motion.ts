// Trees that move: a short shake when an axe or a blow hits them, and a fall when they are cut
// or broken (away from what cut them); then they sink into the ground and are gone.
// Trees are thin instances (one matrix per tree in each mesh's shared buffer). Only the moving
// trees' matrices are written, and only their 16 floats are sent to the GPU.

import { Matrix, Vector3 } from '@babylonjs/core/Maths/math.vector';
import type { Mesh } from '@babylonjs/core/Meshes/mesh';
import '@babylonjs/core/Meshes/thinInstanceMesh';

export interface TreeSlot {
  mesh: Mesh;
  slot: number;
  /** the mesh's thin-instance matrix buffer (Babylon writes into it) */
  data: Float32Array;
  /** the tree's own matrix, kept while it moves or is hidden */
  matrix?: Matrix;
}

/** A zero matrix: the copy has no size, so nothing is drawn. */
export const HIDDEN_MATRIX = Matrix.Zero();

const SHAKE_MS = 450;
const SHAKE_RAD = (4 * Math.PI) / 180;
const FALL_MS = 1050;
/** almost flat: a lying tree leans on its branches */
const FALL_RAD = (84 * Math.PI) / 180;
const BOUNCE_MS = 260;
const BOUNCE_RAD = (5 * Math.PI) / 180;
const LIE_MS = 1100;
const SINK_MS = 1000;
const SINK_DEPTH = 1.6;
/** A tree grows back out of the ground (a slight overshoot at the end, like a spring). */
const GROW_MS = 1800;

interface Motion {
  id: number;
  slots: TreeSlot[];
  start: number;
  kind: 'shake' | 'fall' | 'grow';
  /** horizontal axis to turn around (world x, z) */
  ax: number;
  az: number;
  landed: boolean;
}

/** Size of a growing tree at `ms` after it started (0..1, a little over 1 near the end). */
export function growScale(ms: number): number {
  const t = Math.min(1, Math.max(0, ms / GROW_MS));
  // Ease-out with a small overshoot (back easing).
  const c = 1.6;
  const u = t - 1;
  return Math.max(0.02, 1 + (c + 1) * u * u * u + c * u * u);
}

/** Bends of a fall at `ms` after it started: tilt angle and how deep the trunk has sunk. */
export function fallPose(ms: number, out: { angle: number; sink: number; done: boolean }): { angle: number; sink: number; done: boolean } {
  out.sink = 0;
  out.done = false;
  if (ms < FALL_MS) {
    // A tree starts slowly and speeds up as it goes over.
    const t = ms / FALL_MS;
    out.angle = FALL_RAD * t * t;
  } else if (ms < FALL_MS + BOUNCE_MS) {
    out.angle = FALL_RAD - BOUNCE_RAD * Math.sin((Math.PI * (ms - FALL_MS)) / BOUNCE_MS);
  } else {
    out.angle = FALL_RAD;
    const sinkMs = ms - FALL_MS - BOUNCE_MS - LIE_MS;
    if (sinkMs > 0) {
      const t = Math.min(1, sinkMs / SINK_MS);
      out.sink = SINK_DEPTH * t * t;
      out.done = t >= 1;
    }
  }
  return out;
}

export class TreeMotion {
  private readonly moving = new Map<number, Motion>();
  private readonly hidden = new Set<number>();
  private readonly base = new Matrix();
  private readonly rot = new Matrix();
  private readonly out = new Matrix();
  private readonly pos = new Vector3();
  private readonly axis = new Vector3();
  private readonly size = new Matrix();
  private readonly pose = { angle: 0, sink: 0, done: false };
  /** a fallen tree hit the ground (dust) */
  onLanded: ((id: number) => void) | null = null;

  constructor(
    private readonly slots: TreeSlot[][],
    /** game position of a map tree */
    private readonly position: (id: number) => [number, number] | undefined,
  ) {}

  /** A blow: the tree shakes for a moment. `fromX/Y` (game) is where the blow came from. */
  shake(id: number, fromX: number, fromY: number): void {
    const kind = this.moving.get(id)?.kind;
    if (this.hidden.has(id) || kind === 'fall' || kind === 'grow') return;
    this.begin(id, fromX, fromY, 'shake');
  }

  /** The tree goes over, away from `fromX/Y`, then sinks and is hidden. */
  fall(id: number, fromX: number, fromY: number): void {
    if (this.hidden.has(id) || this.moving.get(id)?.kind === 'fall') return;
    this.begin(id, fromX, fromY, 'fall');
  }

  /** A cut tree grows back out of the ground. */
  grow(id: number): void {
    this.hidden.delete(id);
    this.begin(id, 0, 0, 'grow');
  }

  /** Hidden at once (a rejoin learns of old cuts). */
  hide(ids: readonly number[]): void {
    const dirty = new Set<Mesh>();
    for (const id of ids) {
      if (this.hidden.has(id)) continue;
      this.hidden.add(id);
      this.moving.delete(id);
      for (const s of this.slots[id] ?? []) {
        s.matrix ??= Matrix.FromArray(s.data, s.slot * 16);
        s.mesh.thinInstanceSetMatrixAt(s.slot, HIDDEN_MATRIX, false);
        dirty.add(s.mesh);
      }
    }
    for (const m of dirty) m.thinInstanceBufferUpdated('matrix');
  }

  /** Back to the full forest (the match is over). */
  showAll(): void {
    const dirty = new Set<Mesh>();
    this.moving.clear();
    this.hidden.clear();
    for (const slots of this.slots)
      for (const s of slots) {
        if (!s.matrix) continue;
        s.mesh.thinInstanceSetMatrixAt(s.slot, s.matrix, false);
        s.matrix = undefined;
        dirty.add(s.mesh);
      }
    for (const m of dirty) m.thinInstanceBufferUpdated('matrix');
  }

  get active(): number {
    return this.moving.size;
  }

  update(now: number): void {
    for (const m of this.moving.values()) {
      const ms = now - m.start;
      let angle: number,
        sink = 0;
      if (m.kind === 'grow') {
        if (ms >= GROW_MS) {
          this.moving.delete(m.id);
          this.restore(m);
          continue;
        }
        const k = growScale(ms);
        Matrix.ScalingToRef(k, k, k, this.size);
        this.write(m, 0, 0, this.size);
        continue;
      }
      if (m.kind === 'fall') {
        fallPose(ms, this.pose);
        angle = this.pose.angle;
        sink = this.pose.sink;
        if (!m.landed && ms >= FALL_MS) {
          m.landed = true;
          this.onLanded?.(m.id);
        }
        if (this.pose.done) {
          this.moving.delete(m.id);
          this.hide([m.id]);
          continue;
        }
      } else {
        const t = ms / SHAKE_MS;
        if (t >= 1) {
          this.moving.delete(m.id);
          this.restore(m);
          continue;
        }
        angle = SHAKE_RAD * Math.sin(t * Math.PI * 5) * (1 - t);
      }
      this.write(m, angle, sink);
    }
  }

  /** Back to the tree's own matrix (standing, full size). */
  private restore(m: Motion): void {
    for (const s of m.slots) {
      if (!s.matrix) continue;
      s.mesh.thinInstanceSetMatrixAt(s.slot, s.matrix, false);
      const at = s.slot * 16;
      s.mesh.thinInstancePartialBufferUpdate('matrix', s.data.subarray(at, at + 16), at);
      s.matrix = undefined;
    }
  }

  private begin(id: number, fromX: number, fromY: number, kind: Motion['kind']): void {
    const slots = this.slots[id];
    const at = this.position(id);
    if (!slots?.length || !at) return;
    // World x = game x, world z = -game y. Lean away from the cause; any way if it is on the tree.
    let dx = at[0] - fromX,
      dz = -(at[1] - fromY);
    const len = Math.hypot(dx, dz);
    if (len < 0.01) {
      const a = (id * 2.399) % (Math.PI * 2);
      dx = Math.cos(a);
      dz = Math.sin(a);
    } else {
      dx /= len;
      dz /= len;
    }
    for (const s of slots) s.matrix ??= Matrix.FromArray(s.data, s.slot * 16);
    // Axis (up x lean): turning around it tips the top toward the lean. Check the sign once,
    // whatever Babylon's rotation convention is.
    this.axis.set(dz, 0, -dx);
    Matrix.RotationAxisToRef(this.axis, 0.5, this.rot);
    Vector3.TransformNormalFromFloatsToRef(0, 1, 0, this.rot, this.pos);
    const sign = this.pos.x * dx + this.pos.z * dz >= 0 ? 1 : -1;
    this.moving.set(id, { id, slots, start: performance.now(), kind, ax: dz * sign, az: -dx * sign, landed: false });
  }

  /** Each part's matrix: its own (scale and turn) x the tilt (or size) around the trunk foot x the foot. */
  private write(m: Motion, angle: number, sink: number, around?: Matrix): void {
    if (around) this.rot.copyFrom(around);
    else {
      this.axis.set(m.ax, 0, m.az);
      Matrix.RotationAxisToRef(this.axis, angle, this.rot);
    }
    for (const s of m.slots) {
      const own = s.matrix;
      if (!own) continue;
      this.base.copyFrom(own);
      this.base.getTranslationToRef(this.pos);
      this.base.setTranslationFromFloats(0, 0, 0);
      this.base.multiplyToRef(this.rot, this.out);
      this.out.setTranslationFromFloats(this.pos.x, this.pos.y - sink, this.pos.z);
      s.mesh.thinInstanceSetMatrixAt(s.slot, this.out, false);
      const at = s.slot * 16;
      s.mesh.thinInstancePartialBufferUpdate('matrix', s.data.subarray(at, at + 16), at);
    }
  }
}
