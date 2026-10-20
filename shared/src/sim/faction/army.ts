// Army movement for the faction AI: groups walk on shared flow fields (one per goal) instead of
// one A* per unit; attack groups fight what they meet. Written by Codex for Phase 8b
// (task: tools/codex-tasks/army.md).

import { FlowFieldCache, flowDirection, flowDistance, type FlowField } from '../../nav/flow-field';
import { TICK_RATE, type MatchSim, type SimEntity } from '../match-sim';

const SAMPLE_TICKS = 5;
const STEP_DISTANCE = 1.5;
const GOAL_DISTANCE = 3;
const STUCK_DISTANCE = 0.5;
const STUCK_TICKS = 3 * TICK_RATE;
const FALLBACK_TICKS = 5 * TICK_RATE;
/** A field build takes a few ms: at most this many per tick, other groups wait a tick. */
const BUILDS_PER_TICK = 1;

export type ArmyMode = 'gather' | 'attack' | 'retreat';

export interface ArmyGroup {
  readonly id: number;
  /** unit ids; dead or missing ids are removed by update() */
  readonly members: number[];
  mode: ArmyMode;
  targetX: number;
  targetY: number;
  /** attack mode also fights neutral monsters (clearing a camp); off: walk past camps */
  neutrals: boolean;
}

interface MemberMove {
  x: number;
  y: number;
  checkedAt: number;
  fallbackUntil: number;
}

export class ArmyMover {
  private readonly groupList: ArmyGroup[] = [];
  readonly groups: readonly ArmyGroup[] = this.groupList;
  private readonly owner = new Map<number, ArmyGroup>();
  private readonly moves = new Map<number, MemberMove>();
  private readonly fields: FlowFieldCache;
  private readonly direction = { x: 0, y: 0 };
  private nextGroupId = 1;
  private blockersVersion: number;
  private builds = 0;

  constructor(
    private readonly sim: MatchSim,
    maxFields = 16,
  ) {
    this.fields = new FlowFieldCache(sim.nav, maxFields);
    this.blockersVersion = sim.factions?.blockers.closeVersion ?? 0;
    this.fields.version = this.blockersVersion;
  }

  create(ids: readonly number[], mode: ArmyMode, x: number, y: number): ArmyGroup {
    const group: ArmyGroup = { id: this.nextGroupId++, members: [], mode, targetX: x, targetY: y, neutrals: false };
    this.groupList.push(group);
    for (const id of ids) this.add(group, id);
    return group;
  }

  setGoal(g: ArmyGroup, mode: ArmyMode, x: number, y: number): void {
    g.mode = mode;
    g.targetX = x;
    g.targetY = y;
    for (const id of g.members) this.resetMove(id);
  }

  add(g: ArmyGroup, id: number): void {
    const old = this.owner.get(id);
    if (old === g) return;
    if (old) {
      const at = old.members.indexOf(id);
      if (at >= 0) old.members.splice(at, 1);
    }
    g.members.push(id);
    this.owner.set(id, g);
    this.resetMove(id);
  }

  disband(g: ArmyGroup): void {
    const at = this.groupList.indexOf(g);
    if (at < 0) return;
    this.groupList.splice(at, 1);
    for (const id of g.members) {
      if (this.owner.get(id) !== g) continue;
      this.owner.delete(id);
      this.moves.delete(id);
    }
    g.members.length = 0;
  }

  /** Call once per tick. Moves every group a step. */
  update(): void {
    this.refreshVersion();
    this.builds = 0;
    for (const group of this.groupList) this.updateGroup(group);
  }

  /** Mean position of the living members (writes into out), false when empty. */
  center(g: ArmyGroup, out: { x: number; y: number }): boolean {
    let x = 0;
    let y = 0;
    let count = 0;
    for (const id of g.members) {
      const e = this.sim.get(id);
      if (!e?.alive) continue;
      x += e.mover.x;
      y += e.mover.y;
      count++;
    }
    if (!count) return false;
    out.x = x / count;
    out.y = y / count;
    return true;
  }

  /** Share of living members within `radius` of the goal (0..1). */
  arrived(g: ArmyGroup, radius: number): number {
    const radiusSquared = Math.max(0, radius) ** 2;
    let living = 0;
    let near = 0;
    for (const id of g.members) {
      const e = this.sim.get(id);
      if (!e?.alive) continue;
      living++;
      const dx = g.targetX - e.mover.x;
      const dy = g.targetY - e.mover.y;
      if (dx * dx + dy * dy <= radiusSquared) near++;
    }
    return living ? near / living : 0;
  }

  private refreshVersion(): void {
    const version = this.sim.factions?.blockers.closeVersion ?? 0;
    if (version === this.blockersVersion) return;
    this.blockersVersion = version;
    this.fields.version++;
  }

  private updateGroup(g: ArmyGroup): void {
    let write = 0;
    for (let i = 0; i < g.members.length; i++) {
      const id = g.members[i]!;
      const e = this.sim.get(id);
      if (!e?.alive) {
        if (this.owner.get(id) === g) this.owner.delete(id);
        this.moves.delete(id);
        continue;
      }
      g.members[write++] = id;
    }
    g.members.length = write;
    if (!write) return;
    let field = this.fields.peek(g.targetX, g.targetY);
    if (!field) {
      // Members keep their last step until the field is ready.
      if (this.builds >= BUILDS_PER_TICK) return;
      this.builds++;
      field = this.fields.get(g.targetX, g.targetY);
    }
    for (const id of g.members) this.updateMember(g, this.sim.get(id)!, field);
  }

  private updateMember(g: ArmyGroup, e: SimEntity, groupField: FlowField): void {
    let move = this.moves.get(e.id);
    if (!move) {
      move = { x: e.mover.x, y: e.mover.y, checkedAt: this.sim.tick, fallbackUntil: 0 };
      this.moves.set(e.id, move);
    }

    if (g.mode === 'retreat') {
      e.targetId = 0;
      e.swing = 0;
      this.setOrder(g, e);
    } else if (g.mode === 'attack' && e.targetId) {
      this.markNotWalking(move, e);
      return;
    }

    const dx = g.targetX - e.mover.x;
    const dy = g.targetY - e.mover.y;
    const directDistance = Math.hypot(dx, dy);
    const flying = this.sim.isFlying(e) || e.stats.layer === 'air';
    const field = flying ? undefined : groupField;
    if (directDistance <= GOAL_DISTANCE || (field && flowDistance(field, e.mover.x, e.mover.y) < GOAL_DISTANCE)) {
      this.finishAtGoal(g, e);
      this.markNotWalking(move, e);
      return;
    }

    if (move.fallbackUntil) {
      if (this.sim.tick < move.fallbackUntil && e.mover.path.length) {
        this.setOrder(g, e);
        return;
      }
      move.fallbackUntil = 0;
      move.x = e.mover.x;
      move.y = e.mover.y;
      move.checkedAt = this.sim.tick;
    }

    const movedX = e.mover.x - move.x;
    const movedY = e.mover.y - move.y;
    if (movedX * movedX + movedY * movedY > STUCK_DISTANCE * STUCK_DISTANCE) {
      move.x = e.mover.x;
      move.y = e.mover.y;
      move.checkedAt = this.sim.tick;
    } else if (this.sim.tick - move.checkedAt >= STUCK_TICKS) {
      this.setOrder(g, e);
      this.sim.moveTo(e, g.targetX, g.targetY);
      move.fallbackUntil = this.sim.tick + FALLBACK_TICKS;
      return;
    }

    if ((this.sim.tick + e.id) % SAMPLE_TICKS !== 0) return;
    this.setOrder(g, e);
    if (flying) {
      this.direction.x = dx / directDistance;
      this.direction.y = dy / directDistance;
    } else if (!flowDirection(field!, e.mover.x, e.mover.y, this.direction)) {
      this.sim.moveTo(e, g.targetX, g.targetY);
      move.fallbackUntil = this.sim.tick + FALLBACK_TICKS;
      return;
    }
    e.mover.path = [[e.mover.x + this.direction.x * STEP_DISTANCE, e.mover.y + this.direction.y * STEP_DISTANCE]];
  }

  /** At the goal: gather/retreat stop; attackers stay and fight what is near (the goal may be a building). */
  private finishAtGoal(g: ArmyGroup, e: SimEntity): void {
    e.mover.path = [];
    e.orderX = g.mode === 'attack' ? e.mover.x : g.targetX;
    e.orderY = g.mode === 'attack' ? e.mover.y : g.targetY;
    e.order = g.mode === 'attack' ? 'attackMove' : 'idle';
    e.skipNeutrals = g.mode === 'attack' && !g.neutrals;
  }

  private setOrder(g: ArmyGroup, e: SimEntity): void {
    e.skipNeutrals = g.mode === 'attack' && !g.neutrals;
    e.order = g.mode === 'attack' ? 'attackMove' : 'move';
    e.orderX = g.targetX;
    e.orderY = g.targetY;
  }

  private markNotWalking(move: MemberMove, e: SimEntity): void {
    move.x = e.mover.x;
    move.y = e.mover.y;
    move.checkedAt = this.sim.tick;
    move.fallbackUntil = 0;
  }

  private resetMove(id: number): void {
    const e = this.sim.get(id);
    this.moves.set(id, {
      x: e?.mover.x ?? 0,
      y: e?.mover.y ?? 0,
      checkedAt: this.sim.tick,
      fallbackUntil: 0,
    });
  }
}
