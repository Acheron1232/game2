// Path following for one unit: move along points at a speed and turn toward the way it goes.
// Pure logic, used by client prediction now and by the server simulation in Phase 6.

export interface Mover {
  x: number;
  y: number;
  /** radians, 0 = facing +y (north), counter clockwise */
  facing: number;
  /** game units per second */
  speed: number;
  /** radians per second */
  turnSpeed: number;
  path: [number, number][];
}

export function createMover(x: number, y: number, speed: number): Mover {
  return { x, y, facing: 0, speed, turnSpeed: 10, path: [] };
}

export function isMoving(m: Mover): boolean {
  return m.path.length > 0;
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Advances the mover by dt seconds. Units turn while they walk, like classic RTS units. */
export function stepMover(m: Mover, dt: number): void {
  let left = m.speed * dt;
  while (left > 0 && m.path.length) {
    const [tx, ty] = m.path[0]!;
    const dx = tx - m.x,
      dy = ty - m.y;
    const d = Math.hypot(dx, dy);
    if (d > 1e-4) {
      const want = Math.atan2(-dx, dy);
      const diff = wrap(want - m.facing);
      const maxTurn = m.turnSpeed * dt;
      m.facing = wrap(m.facing + Math.max(-maxTurn, Math.min(maxTurn, diff)));
      // Slow down a lot while facing far away from the target, so turns look natural.
      const factor = Math.abs(diff) > 1.2 ? 0.35 : 1;
      const stepLen = Math.min(d, left * factor);
      m.x += (dx / d) * stepLen;
      m.y += (dy / d) * stepLen;
      left -= stepLen / factor;
      if (stepLen >= d - 1e-4) m.path.shift();
    } else {
      m.path.shift();
    }
  }
}
