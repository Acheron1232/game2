# Task: hero bots

Write `shared/src/sim/hero-bot.ts` and `shared/test/hero-bot.test.ts`.

## Background
A `Bot` slot has no human: a bot plays its hero. It farms camps that fit its level, retreats on low health, learns and uses abilities in a sensible way, and later joins its faction's attacks. Difficulty changes reaction time and decision quality, never stats. Settings: `gameData.ai.heroBot` (`shared/data/ai.json`: `difficulties.{easy,normal,hard}` with `reactionSec`, `abilityUseQuality`, `retreatAtHpPct`, `lastHitSkill`, `joinsAttacks`; `campChoice` text). Read `docs/design/HEROES.md` ("Hero bots": skill order) and `docs/design/AI_ARCHITECTURE.md`.

The simulation is `MatchSim` in `shared/src/sim/match-sim.ts`. Read it, plus `abilities.ts` (`heroAbility`, `castProblem`, `param`, `lv`, `targetAllowed`), `commands.ts` (`CommandType`, `GameCommand`), `camps.ts` (`CampState`: `members`, `x`, `y`, `respawnAt`), `stats.ts` (`canLearn`), `buffs.ts`. Useful sim fields: `sim.heroes[slot]` (`SimEntity` with `heroState`: level, skillPoints, abilityLevels, def.abilities, start), `sim.camps`, `sim.entities`, `sim.grid.query(x, y, r, fn)`, `sim.tick`, `sim.get(id)`, `sim.events` (this tick's events), `sim.canSee(team, e)`, `TICK_RATE`. Start spots: `gameData.map.starts[i].heroSpawn`.

**The bot plays only through `sim.queueCommand(slot, seq, cmd)`, like a human client.** It must never change entities directly. Use your own increasing `seq` numbers.

## API (exact)
```ts
export type BotDifficulty = 'easy' | 'normal' | 'hard';
export interface HeroBotHooks {
  /** Where the faction's army is attacking now, or null (wired in Phase 8b). */
  armyTarget?: () => { x: number; y: number } | null;
  /** Our base is under attack: point to defend, or null. */
  baseUnderAttack?: () => { x: number; y: number } | null;
}
export class HeroBot {
  constructor(slot: number, difficulty: BotDifficulty, hooks?: HeroBotHooks);
  /** Call once per sim tick, after sim.step(). Thinks only every reactionSec. */
  update(sim: MatchSim): void;
  /** For tests and the AI panel: "Farming wolves", "Retreating", "Joining the attack"... */
  readonly state: string;
}
```

## Behaviour
- **Learn:** whenever it has skill points: the ultimate when allowed, else the main damage / control ability (the slot whose ability does the most damage or stuns; tie → lower slot), then the others in turn (Q, W, E).
- **Retreat:** health below `retreatAtHpPct` and an enemy (or monster) within 10 → walk to its start spot; stay until health ≥ 85%, then go back to work.
- **Farm:** pick the closest alive camp (`respawnAt === 0`, at least one member alive) whose total monster level (sum of `stats.level` of alive members) is at most 2 × hero level (3 × when an allied hero is within 12). Walk there and attack the member with the lowest health (heroes do not start fights with neutrals on their own — attack them with an Attack command). Re-pick when the camp is dead.
- **Abilities (quality = `abilityUseQuality`: chance to use a good cast when one is possible):** use only casts where `castProblem(...) === null`. Unit-target damage / stun on the current target; point / area abilities when 2+ enemies are inside the radius (or the target is a hero); `none`-target areas (Sweep, Tremor...) when 2+ enemies are close; self buffs (Iron Stance, Stone Skin) when hit and below 70%; heals (Radiant Touch, Sanctuary, Dawn Shield) on itself or an ally below 50%; Blink away when retreating. Never cast with no target in range.
- **Join attacks:** if `joinsAttacks` and `hooks.armyTarget()` gives a point and the hero is level ≥ 4, attack-move there. Defend when `baseUnderAttack()` gives a point.
- Do not spam: send a new command only when the plan changes or every ~1.5 s while fighting; at most 3 commands per think.
- Must be cheap: no allocations per tick when nothing changes; heavy searches only on think ticks.

## Tests
Use `new MatchSim({ seed, slots: [...] }, buildMatchNav(parseTerrain(readFileSync('shared/data/map-terrain.bin')), gameData.map))` (camps on, no factions). Run ticks with `sim.step(); bot.update(sim);`.
- A normal bot on each of 4 different heroes (one per start) reaches hero level ≥ 4 within 8 game minutes and is alive at the end (or died at most twice).
- It spends skill points (≤ 1 unspent at the end) and casts abilities (count `EventType.Cast` events of its hero > 3).
- It sends fewer than 5% refused commands (wrap `sim.queueCommand` to count `false`).
- Retreat: set its hp to 15%, put a strong monster next to it → within 3 s it moves toward its start spot.
- Easy reacts slower than hard (count think decisions or commands per minute).
