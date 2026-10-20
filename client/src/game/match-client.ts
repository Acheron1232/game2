// The running match on the client: reads snapshots into NetEntities, draws other units a bit in
// the past, predicts the own hero, and sends the player's commands.

import {
  BinaryWriter,
  CommandType,
  ENTITY_TYPES,
  isHeroType,
  moveSpeedOf,
  quantizePoint,
  readSnapshot,
  SnapshotData,
  SnapshotFlag,
  UnitState,
  writeCommand,
  type GameCommand,
  type MatchStartInfo,
} from '@game/shared';
import type { GameSocket } from '../net/socket';
import { TEAMS, type GameWorld } from '../render/world';
import { HeroPredictor } from './hero-predictor';
import { NetEntity, type Pose } from './net-entity';
import { TickClock } from './tick-clock';

export class MatchClient {
  readonly entities = new Map<number, NetEntity>();
  readonly clock = new TickClock();
  predictor: HeroPredictor | null = null;
  ownHero: NetEntity | null = null;
  /** last server tick we got */
  tick = 0;
  snapshots = 0;
  private seq = 0;
  private markCount = 0;
  private readonly snap = new SnapshotData();
  private readonly w = new BinaryWriter(32);
  private readonly pose: Pose = { x: 0, y: 0, facing: 0, state: 0 };
  private readonly heroPose = { x: 0, y: 0, facing: 0 };
  private readonly unsubscribe: () => void;
  private cameraPlaced = false;

  constructor(
    readonly world: GameWorld,
    private readonly net: GameSocket,
    readonly info: MatchStartInfo,
  ) {
    this.unsubscribe = net.onSnapshot((data) => this.onSnapshot(data));
    world.beforeFrame = (dt) => this.frame(dt);
  }

  get slot(): number {
    return this.info.yourSlot;
  }

  /** Right click on the ground (shift = add to the path). */
  moveTo(x: number, y: number, queue: boolean): void {
    const [qx, qy] = quantizePoint(x, y);
    this.send({ type: CommandType.Move, x: qx, y: qy, queue });
  }

  stop(): void {
    this.send({ type: CommandType.Stop });
  }

  private send(cmd: GameCommand): void {
    if (!this.predictor) return;
    this.seq = (this.seq % 0xffff) + 1; // 1..65535, 0 means "no command yet"
    this.net.sendBinary(writeCommand(this.w, this.seq, cmd));
    this.predictor.issue(this.seq, cmd);
  }

  private onSnapshot(data: ArrayBuffer): void {
    const s = readSnapshot(data, this.snap);
    this.snapshots++;
    this.tick = s.tick;
    this.clock.onSnapshot(s.tick);
    const mark = ++this.markCount;
    const full = (s.flags & SnapshotFlag.Full) !== 0;
    for (let i = 0; i < s.spawnCount; i++) {
      const sp = s.spawns[i]!;
      this.remove(sp.id);
      const e = new NetEntity(s.tick, sp);
      e.mark = mark;
      this.entities.set(e.id, e);
      this.show(e);
    }
    for (let i = 0; i < s.updateCount; i++) {
      const u = s.updates[i]!;
      const e = this.entities.get(u.id);
      if (!e) continue;
      e.apply(s.tick, u);
      e.mark = mark;
    }
    for (let i = 0; i < s.goneCount; i++) this.remove(s.gone[i]!);
    if (full) for (const e of [...this.entities.values()]) if (e.mark !== mark) this.remove(e.id);

    const hero = this.ownHero;
    if (hero && this.predictor) {
      this.predictor.advance(performance.now());
      hero.sample(s.tick, this.pose);
      this.predictor.reconcile(s.ackSeq, s.ticksSinceAck, this.pose.x, this.pose.y);
    }
  }

  private show(e: NetEntity): void {
    const modelId = ENTITY_TYPES[e.type] ?? 'swordsman';
    const hero = isHeroType(e.type);
    const k = e.last;
    e.unit = this.world.addUnit(modelId, TEAMS[e.color] ?? 'red', k.x, k.y, k.facing, moveSpeedOf(e.type), hero);
    if (hero && e.owner === this.slot) {
      this.ownHero = e;
      this.predictor = new HeroPredictor(k.x, k.y, k.facing, moveSpeedOf(e.type), this.world.nav);
      this.world.select(e.unit);
      if (!this.cameraPlaced) this.world.camera.lookAt(k.x, k.y, true);
      this.cameraPlaced = true;
    }
  }

  private remove(id: number): void {
    const e = this.entities.get(id);
    if (!e) return;
    if (e.unit) this.world.removeUnit(e.unit);
    this.entities.delete(id);
    if (e === this.ownHero) {
      this.ownHero = null;
      this.predictor = null;
    }
  }

  private frame(_dt: number): void {
    const p = this.predictor;
    p?.advance(performance.now());
    const rt = this.clock.renderTick();
    for (const e of this.entities.values()) {
      const u = e.unit;
      if (!u) continue;
      if (e === this.ownHero && p) {
        p.pose(this.heroPose);
        u.x = this.heroPose.x;
        u.y = this.heroPose.y;
        u.facing = this.heroPose.facing;
        u.moving = p.moving;
      } else {
        e.sample(rt, this.pose, this.tick);
        u.x = this.pose.x;
        u.y = this.pose.y;
        u.facing = this.pose.facing;
        u.moving = (this.pose.state & UnitState.Moving) !== 0;
      }
    }
  }

  /** Match time in seconds, from the server tick. */
  get seconds(): number {
    return this.clock.ready ? Math.max(0, this.clock.serverTick()) / 20 : 0;
  }

  dispose(): void {
    this.unsubscribe();
    this.world.beforeFrame = null;
    for (const id of [...this.entities.keys()]) this.remove(id);
    this.world.select(null);
  }
}
