// Own hero prediction. A click moves the hero at once with the same path and movement code
// as the server, in the same fixed 20 Hz steps. When a snapshot says where the server's hero
// was, we compare it with where ours was at the same moment and fix the small difference
// smoothly: the hero's real position jumps, the drawn one slides over ~100 ms.

import { applyCommand, createMover, stepMover, TICK_DT, type GameCommand, type Mover, type NavGrid } from '@game/shared';

const HISTORY = 512; // steps (25 s)
/** Bigger errors than this snap (teleport-like server moves). */
const SNAP_DISTANCE = 2;
/** The wire allows 0.01 units of drift plus position rounding. Do not chase that noise. */
const IGNORE_DISTANCE = 0.02;
/** Steps to run at most in one go (10 s). */
const MAX_CATCH_UP = 200;
/** How fast the drawn hero catches up after a fix (seconds). */
const SMOOTH_TIME = 0.1;

export interface PredictorStats {
  corrections: number;
  snaps: number;
  lastError: number;
}

export class HeroPredictor {
  readonly mover: Mover;
  /** local step count; history[step % HISTORY] is the state after that step */
  private step = 0;
  private acc = 0;
  private readonly hx = new Float64Array(HISTORY);
  private readonly hy = new Float64Array(HISTORY);
  private prevX: number;
  private prevY: number;
  private prevF: number;
  private offX = 0;
  private offY = 0;
  private readonly pending: { seq: number; cmd: GameCommand }[] = [];
  /** command seq -> local step it ran in */
  private readonly cmdStep = new Map<number, number>();
  private lastSeq = 0;
  private lastMs: number | null = null;
  /** a server position for a step we have not run yet: checked when we get there */
  private deferred: { ack: number; at: number; x: number; y: number } | null = null;
  readonly stats: PredictorStats = { corrections: 0, snaps: 0, lastError: 0 };

  constructor(
    x: number,
    y: number,
    facing: number,
    speed: number,
    private readonly nav: NavGrid,
    private readonly flying = false,
  ) {
    this.mover = createMover(x, y, speed);
    this.mover.facing = facing;
    this.prevX = x;
    this.prevY = y;
    this.prevF = facing;
    this.hx[0] = x;
    this.hy[0] = y;
  }

  get moving(): boolean {
    return this.mover.path.length > 0;
  }

  /**
   * Starts again from the server's state (after the server moved the hero by itself: attack,
   * chase, death). `drawnX/Y` is where the hero is on screen now, so the switch slides.
   */
  rebase(x: number, y: number, facing: number, drawnX = x, drawnY = y): void {
    this.mover.x = this.prevX = x;
    this.mover.y = this.prevY = y;
    this.mover.facing = this.prevF = facing;
    this.mover.path = [];
    this.pending.length = 0;
    this.cmdStep.clear();
    this.deferred = null;
    for (let i = 0; i < HISTORY; i++) {
      this.hx[i] = x;
      this.hy[i] = y;
    }
    this.offX = drawnX - x;
    this.offY = drawnY - y;
  }

  /** Learning has its own acknowledgement; it must not change the movement clock. */
  skip(seq: number): void {
    this.lastSeq = seq;
  }

  /** The command runs in the next step, like on the server. */
  issue(seq: number, cmd: GameCommand): void {
    this.pending.push({ seq, cmd });
    this.lastSeq = seq;
  }

  /**
   * Runs the fixed steps that are due by `nowMs` (performance.now). Driven by the real clock,
   * not by frames: a hidden tab draws nothing but must stay in step with the server.
   */
  advance(nowMs: number): void {
    const dt = this.lastMs === null ? 0 : (nowMs - this.lastMs) / 1000;
    this.lastMs = nowMs;
    if (dt <= 0) return;
    this.acc += dt;
    // After a very long pause, do not try to run thousands of steps: the next fix will snap.
    if (this.acc > MAX_CATCH_UP * TICK_DT) this.acc = MAX_CATCH_UP * TICK_DT;
    while (this.acc >= TICK_DT) {
      this.acc -= TICK_DT;
      this.prevX = this.mover.x;
      this.prevY = this.mover.y;
      this.prevF = this.mover.facing;
      this.step++;
      // Prune on input, not on position errors: perfect prediction may never correct.
      // Without new movement keep its last clock, including through idle/learning.
      if (this.pending.length) {
        for (const [seq, at] of this.cmdStep) {
          if (at >= this.step - HISTORY) break;
          this.cmdStep.delete(seq);
        }
      }
      for (const p of this.pending) {
        applyCommand(this.mover, this.nav, p.cmd, this.flying);
        // A wrapped sequence must take its new place in chronological order.
        this.cmdStep.delete(p.seq);
        this.cmdStep.set(p.seq, this.step);
      }
      this.pending.length = 0;
      stepMover(this.mover, TICK_DT);
      this.hx[this.step % HISTORY] = this.mover.x;
      this.hy[this.step % HISTORY] = this.mover.y;
      const d = this.deferred;
      if (d && d.at <= this.step) {
        this.deferred = null;
        // Still valid only if no newer command ran before that step.
        const next = this.nextCommandStep(d.ack);
        if (next === undefined || d.at < next) this.correct(d.at, d.x, d.y);
      }
    }
    const k = Math.exp(-Math.min(dt, 1) / SMOOTH_TIME);
    this.offX *= k;
    this.offY *= k;
  }

  /** Drawn pose: between the last two steps, plus the sliding fix. */
  pose(out: { x: number; y: number; facing: number }): void {
    const f = this.acc / TICK_DT;
    out.x = this.prevX + (this.mover.x - this.prevX) * f + this.offX;
    out.y = this.prevY + (this.mover.y - this.prevY) * f + this.offY;
    const d = Math.atan2(Math.sin(this.mover.facing - this.prevF), Math.cos(this.mover.facing - this.prevF));
    out.facing = this.prevF + d * f;
  }

  /**
   * The server's hero stood at (sx, sy) after `ticksSinceAck` ticks since the Move/Stop
   * `ackSeq`. Compare with our state after the same number of steps since that move command.
   */
  reconcile(ackSeq: number, ticksSinceAck: number, sx: number, sy: number): void {
    let at: number;
    if (ackSeq === 0 || !this.cmdStep.has(ackSeq)) {
      // No command yet (or from before a rejoin): only compare when nothing is on the way.
      if (this.pending.length || ackSeq !== (this.lastSeq & 0xffff)) return;
      at = this.step;
    } else {
      at = this.cmdStep.get(ackSeq)! + ticksSinceAck - 1;
      // A newer command already ran here but not yet on the server: wait for its ack.
      const next = this.nextCommandStep(ackSeq);
      if (next !== undefined && at >= next) return;
      if (at <= this.step - HISTORY) return;
      // The server got there first (its snapshot came before our step ran): check it later.
      if (at > this.step) {
        if (at - this.step <= 10) this.deferred = { ack: ackSeq, at, x: sx, y: sy };
        return;
      }
    }
    this.correct(at, sx, sy);
  }

  private nextCommandStep(ackSeq: number): number | undefined {
    let found = false;
    // Sequence numbers may have gaps from Learn commands and may wrap at 65535.
    // Map insertion order is the local issue order in both cases.
    for (const [seq, step] of this.cmdStep) {
      if (found) return step;
      if (seq === ackSeq) found = true;
    }
    return undefined;
  }

  private correct(at: number, sx: number, sy: number): void {
    const ex = sx - this.hx[at % HISTORY]!,
      ey = sy - this.hy[at % HISTORY]!;
    const err = Math.hypot(ex, ey);
    if (err < IGNORE_DISTANCE) return;
    this.stats.lastError = err;
    // Move our real state (and the history after that step) onto the server's line.
    for (let s = at; s <= this.step; s++) {
      this.hx[s % HISTORY]! += ex;
      this.hy[s % HISTORY]! += ey;
    }
    this.mover.x += ex;
    this.mover.y += ey;
    this.prevX += ex;
    this.prevY += ey;
    if (err > SNAP_DISTANCE) {
      this.offX = this.offY = 0;
      this.stats.snaps++;
    } else {
      this.offX -= ex;
      this.offY -= ey;
      this.stats.corrections++;
    }
  }
}
