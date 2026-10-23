// Army movement for the faction AI: groups walk on shared flow fields (one per goal) instead of
// one A* per unit; attack groups fight what they meet. Written by Codex for Phase 8b
// (task: tools/codex-tasks/army.md). Marching in one block (pace, who walks in front) and the
// chase leash came later (faction AI pass).

import { gameData } from '../../data/index';
import { FlowFieldCache, flowDirection, flowDistance, type FlowField } from '../../nav/flow-field';
import { TICK_RATE, type MatchSim, type SimEntity } from '../match-sim';
import { CATAPULT_TYPE } from './targeting';

const SAMPLE_TICKS = 5;
const STEP_DISTANCE = 1.5;
const GOAL_DISTANCE = 3;
const STUCK_DISTANCE = 0.5;
const STUCK_TICKS = 3 * TICK_RATE;
const FALLBACK_TICKS = 5 * TICK_RATE;
/** A field build takes a few ms: at most this many per tick, other groups wait a tick. */
const BUILDS_PER_TICK = 1;
const ARMY = gameData.ai.faction.army;
const MELEE_RANGE = gameData.rules.combat.meleeRange + 0.6;
/** Groups smaller than this walk freely (no pace). */
const PACE_MIN_MEMBERS = 3;
/** A unit this far behind the middle of its group walks at full speed to catch up. */
const CATCH_UP = 5;
/** Close to the goal everyone walks freely (the fight starts there). */
const PACE_GOAL_DISTANCE = 12;
/** In front of its place by up to this much more: a unit slows down; farther: it waits. */
const PACE_WAIT = 6;
const PACE_SLOW = 0.6;
/** Members this close to the group's focus building hit it (see ArmyGroup.focusId). */
const FOCUS_RANGE = 18;

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
  /**
   * attack mode: a building (an enemy Town Hall) the members near it hit and keep hitting,
   * whatever fights them there (0 = none). Defending heroes respawn; the Town Hall does not.
   */
  focusId: number;
  /** marching: median path distance to the goal of the walking members (NaN = no pace this tick) */
  paceMiddle: number;
  /** marching: move speed of the slowest walking member */
  paceSpeed: number;
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
  /** path distances of one group's walking members (reused every tick) */
  private readonly paceList: number[] = [];
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
    const group: ArmyGroup = {
      id: this.nextGroupId++,
      members: [],
      mode,
      targetX: x,
      targetY: y,
      neutrals: false,
      focusId: 0,
      paceMiddle: NaN,
      paceSpeed: 0,
    };
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
      const e = this.sim.get(id);
      if (e) e.speedCap = 0;
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
    this.pace(g, field);
    for (const id of g.members) this.updateMember(g, this.sim.get(id)!, field);
  }

  /**
   * An attack group marches as one block: the slowest walking member sets the speed, and the
   * middle of the group (median path distance to the goal) sets who waits. Without this, fast
   * riders arrive first and die alone, and the army reaches the enemy as a long stream. The
   * median (not the mean) so a few stragglers far behind do not stop the whole army.
   */
  private pace(g: ArmyGroup, field: FlowField): void {
    g.paceMiddle = NaN;
    g.paceSpeed = 0;
    if (g.mode !== 'attack') return;
    const list = this.paceList;
    list.length = 0;
    let slowest = Infinity;
    for (const id of g.members) {
      const e = this.sim.get(id)!;
      if (e.targetId || this.sim.isFlying(e)) continue;
      const d = flowDistance(field, e.mover.x, e.mover.y);
      if (!Number.isFinite(d)) continue;
      list.push(d);
      if (e.stats.moveSpeed < slowest) slowest = e.stats.moveSpeed;
    }
    if (list.length < PACE_MIN_MEMBERS) return;
    list.sort(byNumber);
    g.paceMiddle = list[list.length >> 1]!;
    g.paceSpeed = slowest;
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
      e.speedCap = 0;
      this.setOrder(g, e);
    } else if (g.mode === 'attack' && g.focusId && this.focus(g, e)) {
      this.markNotWalking(move, e);
      return;
    } else if (g.mode === 'attack' && e.targetId) {
      e.speedCap = 0;
      // Chase leash: a unit that ran this far away, or this far from the group's goal, is let
      // go and the unit walks on with its group. Without the goal leash a tough hero walking
      // away pulled a whole siege army out of the enemy base.
      const t = this.sim.get(e.targetId);
      if (
        t &&
        !t.building &&
        e.swing !== 1 &&
        (Math.hypot(t.mover.x - e.mover.x, t.mover.y - e.mover.y) > ARMY.chaseLeash ||
          Math.hypot(t.mover.x - g.targetX, t.mover.y - g.targetY) > ARMY.goalLeash)
      ) {
        e.targetId = 0;
        e.mover.path = [];
      } else {
        this.markNotWalking(move, e);
        return;
      }
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
    if (field && !Number.isNaN(g.paceMiddle)) {
      const d = flowDistance(field, e.mover.x, e.mover.y);
      const ahead = g.paceMiddle - d - ARMY.groupSpread[roleOf(e)];
      if (d > PACE_GOAL_DISTANCE && ahead > PACE_WAIT) {
        // Far in front: wait for the group (idle still fights what comes close).
        e.mover.path = [];
        e.order = 'idle';
        e.speedCap = 0;
        this.markNotWalking(move, e);
        return;
      }
      // A little in front: slower; behind: full speed to catch up; else the group's pace.
      e.speedCap = d <= PACE_GOAL_DISTANCE || ahead < -CATCH_UP ? 0 : ahead > 0 ? g.paceSpeed * PACE_SLOW : g.paceSpeed;
    } else e.speedCap = 0;
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

  /** A member close to the group's focus building attacks it. False when it is gone or far. */
  private focus(g: ArmyGroup, e: SimEntity): boolean {
    const b = this.sim.get(g.focusId);
    if (!b?.alive) {
      g.focusId = 0;
      return false;
    }
    if (e.stats.damageMax <= 0 || Math.hypot(b.mover.x - e.mover.x, b.mover.y - e.mover.y) > FOCUS_RANGE) return false;
    if (e.targetId !== b.id) {
      e.targetId = b.id;
      e.swing = 0;
    }
    // 'attack' keeps the target: attack-move would turn to the heroes that fight back.
    e.order = 'attack';
    e.speedCap = 0;
    return true;
  }

  /** At the goal: gather/retreat stop; attackers stay and fight what is near (the goal may be a building). */
  private finishAtGoal(g: ArmyGroup, e: SimEntity): void {
    e.mover.path = [];
    e.speedCap = 0;
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
    if (e) e.speedCap = 0;
    this.moves.set(id, {
      x: e?.mover.x ?? 0,
      y: e?.mover.y ?? 0,
      checkedAt: this.sim.tick,
      fallbackUntil: 0,
    });
  }
}

/** Melee walks in front of a marching group, siege at the back (ai.json army.groupSpread). */
export function roleOf(e: SimEntity): 'melee' | 'ranged' | 'siege' {
  if (e.type === CATAPULT_TYPE) return 'siege';
  return e.stats.attackRange <= MELEE_RANGE ? 'melee' : 'ranged';
}

function byNumber(a: number, b: number): number {
  return a - b;
}
