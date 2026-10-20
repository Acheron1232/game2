# Task: final combat effects (hits, level up, gold, falling buildings)

Write `client/src/render/combat-fx.ts` and `client/test/combat-fx.test.ts`. Do not edit other files (the lead engineer wires it into `match-client.ts`).

## Background
Babylon.js 9 client. Read `client/src/render/ability-fx.ts` (pooled `ParticleSystem`s on the shared effects atlas `effectsAtlas(scene)`, cells described in `client/public/assets/effects/effects.json`, `CELL`, `Frames`; flash meshes), `client/src/render/projectiles.ts`, `client/src/ui/floating-text.ts` (damage numbers are HTML, not your job), `client/src/render/world.ts` (`Unit`: `x`, `y`, `height`, `flyHeight`, `model.root`, `world.unitHeight(u)`; world position = (x, height, -y)). Rules in `CLAUDE.md`: no new objects per frame in hot loops, pools for effects, no new shaders after the match starts (create every material and particle system in the constructor, so they compile in the lobby).

## API (exact)
```ts
export type FxQuality = 'low' | 'high';
export class CombatFx {
  constructor(scene: Scene);
  /** A hit lands: a short spark at the target (kind: 'attack' | 'spell' | 'siege' | 'miss'). */
  hit(x: number, h: number, z: number, kind: 'attack' | 'spell' | 'siege' | 'miss', color?: string): void;
  /** Level up: a rising golden ring and a column of light around the hero for ~1.2 s. */
  levelUp(x: number, h: number, z: number, radius: number): void;
  /** Gold from a last hit: a few small gold coins/sparkles that pop up and fade. */
  gold(x: number, h: number, z: number): void;
  /** A unit dies: small dust puff (ground units only). */
  death(x: number, h: number, z: number, size: number): void;
  /** A building falls: big dust cloud and debris sparks for ~2 s, size = footprint width. */
  buildingDown(x: number, h: number, z: number, size: number): void;
  /** A building site is placed / finished: a small dust ring. */
  buildDust(x: number, h: number, z: number, size: number): void;
  setQuality(q: FxQuality): void;
  update(dt: number): void;
  dispose(): void;
}
```

## Rules
- Pools: a fixed number of particle systems per effect kind (for example 12 hit sparks, 4 level-ups, 6 gold, 8 death puffs, 3 building dust), reused round-robin. When all are busy, reuse the oldest. Never create a ParticleSystem, mesh or material after the constructor.
- Look: short and readable from the RTS camera (camera about 30–45 units away, looking down at ~55°). Hits: 0.15–0.25 s, small; spells brighter in the given color; siege bigger with dust; miss: a tiny white puff. Level up: gold, clearly visible, not covering the whole screen. Gold: 3–6 small gold sparks. Building down: brown/grey dust, size scales with the footprint.
- `setQuality('low')`: about half the particles per effect and skip the debris sparks; `'high'`: full.
- Use the existing effects atlas cells (look in `effects.json` for spark / smoke / glow / ring frames); additive blend for light, standard alpha blend for dust (two blend modes = two kinds of systems).
- `update(dt)` only advances what the class itself animates (e.g. the rising ring mesh); particle systems run on their own.

## Tests (`client/test/combat-fx.test.ts`)
Vitest without a GPU: export the pure parts and test them — the round-robin pool picker (reuses the oldest when full), the per-quality particle counts, the level-up ring animation curve (height and alpha over time, ends at 0 alpha by its life).
Run `pnpm --filter @game/client typecheck`, `pnpm --filter @game/client exec vitest run test/combat-fx.test.ts`, eslint and prettier on your files.
