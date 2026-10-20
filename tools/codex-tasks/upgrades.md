# Task: Town Hall upgrades rules and stat effects

Write `shared/src/sim/faction/upgrades.ts` and `shared/test/upgrades.test.ts`.

## Background
The hero buys upgrades for its own AI faction at its own Town Hall, with hero gold. Data: `shared/data/upgrades.json` (read through `gameData.upgrades` from `shared/src/data/index.ts`; check `shared/src/data/schemas.ts` for its shape). Rules in `docs/design/FACTION.md` ("Town Hall upgrades"): "Melee" = swordsman, lancer, hawk_rider; "Ranged" = archer, cleric and watchtower; catapults get only Siege Works; Iron Plates = all faction units (not buildings, not heroes); Stone Walls = buildings and towers; Rich Veins = worker gather amount; Training Drills = train time; War Banner = temporary army buff (+damage %, +move speed %, 60 s, repeatable with a 180 s cooldown); Tier Up Fund = gives 200 faction gold earmarked for the next tier (repeatable, 60 s cooldown, not when already a Citadel). `requires` lists building ids per level; "stronghold" means a Town Hall at tier 2 or higher, "citadel" tier 3. Combat stats type: `CombatStats` in `shared/src/sim/stats.ts`.

## API (exact)
```ts
export type UpgradeId = 'sharper_blades' | 'better_arrows' | 'iron_plates' | 'training_drills' | 'stone_walls' | 'siege_works' | 'rich_veins' | 'war_banner' | 'tier_up_fund';
export interface FactionTech {
  tier: 1 | 2 | 3;
  /** ids of finished buildings the faction has (town_hall / stronghold / citadel follow the tier rule above) */
  buildings: ReadonlySet<string>;
  levels: Readonly<Record<string, number>>;
  /** tick each repeatable upgrade is ready again */
  readyAt: Readonly<Record<string, number>>;
}
export type UpgradeProblem = 'max' | 'needs' | 'gold' | 'cooldown' | 'citadel';
export interface UpgradeStatus { id: UpgradeId; level: number; maxLevel: number; cost: number | null; ok: boolean; problem?: UpgradeProblem; needs: string[] }
export function upgradeStatus(id: UpgradeId, tech: FactionTech, heroGold: number, tick: number): UpgradeStatus;
export function allUpgradeStatus(tech: FactionTech, heroGold: number, tick: number): UpgradeStatus[];
export type UnitCategory = 'melee' | 'ranged' | 'catapult' | 'worker' | 'tower' | 'building' | 'other';
export function unitCategory(typeId: string): UnitCategory;
/** Faction stat effects of the bought levels (+ War Banner while active) on one unit or building. Returns a new object; base is not changed. */
export function applyUpgrades(base: CombatStats, typeId: string, levels: Readonly<Record<string, number>>, warBannerActive: boolean): CombatStats;
/** Multiplier for train time (Training Drills: -10% / -20% => 0.9 / 0.8). */
export function trainTimeFactor(levels: Readonly<Record<string, number>>): number;
/** Multiplier for gold / wood per trip (Rich Veins). */
export function gatherFactor(levels: Readonly<Record<string, number>>): number;
```

## Rules
- Damage percent multiplies `damageMin` and `damageMax`. Armor adds. Stone Walls: `maxHp` × (1 + pct), armor +.
- Watchtower is both "ranged" (Better Arrows) and a building (Stone Walls).
- `upgradeStatus` order of checks: max level → citadel rule (tier up fund) → cooldown → needs → gold. `needs` lists the missing building ids for the next level.
- No magic numbers: every number from `upgrades.json`.

## Tests
- Every upgrade's cost per level equals the data.
- Sharper Blades level 2 on a swordsman: damage × 1.2; not on an archer or a catapult.
- Better Arrows on a watchtower and an archer; Iron Plates on a lancer (+armor) but not on a barracks; Stone Walls on a barracks (+hp % and +armor).
- Siege Works only on a catapult; War Banner active: +15% damage, +10% move speed on army units, nothing when not active.
- `upgradeStatus`: needs Forge for Sharper Blades level 1; level 2 needs Stronghold (tier 2); gold too low → 'gold'; Tier Up Fund at tier 3 → 'citadel'; War Banner on cooldown → 'cooldown'; max level → 'max'.
- `trainTimeFactor` / `gatherFactor` at 0, 1, 2 levels.
