# The Kingdom — AI faction

The MVP has one faction, **The Kingdom**: a classic human-like fantasy realm of timber halls, stone walls, knights and archers. All four teams play it, each in its own team color. More factions come after the MVP.

Data: `shared/data/units.json` (group `faction`), `shared/data/buildings.json`, `shared/data/upgrades.json`, `shared/data/ai.json`.

## Start of the match

Each faction starts with: a Town Hall at its start spot, 5 Workers, 500 gold, 150 wood. The hero spawns next to the Town Hall.

## Economy

- Workers mine gold at the gold mine next to the Town Hall (10 gold per trip, max 5 workers in a mine at once) and chop trees (10 wood per trip).
- Workers bring resources to the nearest Town Hall / Stronghold / Citadel.
- Supply: each Town Hall gives 12, each House gives 8, max 100.
- Gold mines run out: main 15,000, natural expansion 10,000, corner expansion 12,000 (guarded by ogres).
- Trees are real: chopped trees are removed. This slowly opens the forest around bases, like in classic RTS games.

## Units

<!-- table:units-faction -->
| Unit | Lvl | HP | Armor | Attack | Damage | Range | Hits | Speed | Cost (g/w) | Supply | Time | From | Needs | Bounty |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Worker | 1 | 220 | 0 medium | normal | 5-6 | 1 | ground | 2.6 | 75/0 | 1 | 15 | Town Hall | — | 8-10 |
| Swordsman | 2 | 420 | 2 heavy | normal | 12-14 | 1 | ground | 2.7 | 120/0 | 2 | 18 | Barracks | — | 18-24 |
| Archer | 2 | 300 | 0 medium | pierce | 15-18 | 6 | ground+air | 2.8 | 130/20 | 2 | 20 | Archery Range | — | 18-24 |
| Cleric | 2 | 300 | 0 unarmored | magic | 8-10 | 5 | ground+air | 2.7 | 160/30 | 2 | 25 | Chapel | Stronghold | 18-24 |
| Lancer | 4 | 800 | 4 heavy | normal | 28-34 | 1.4 | ground | 3.5 | 240/60 | 4 | 35 | Barracks | Stronghold, Forge | 30-38 |
| Catapult | 3 | 450 | 2 heavy | siege | 60-70 | 10 | ground | 2.2 | 220/60 | 3 | 30 | Workshop | Stronghold | 26-32 |
| Hawk Rider | 4 | 700 | 1 light | normal | 30-36 | 2.5 | ground+air | 3.6 (air) | 280/70 | 4 | 40 | Hawk Roost | Citadel | 34-42 |
<!-- /table -->

Roles in one line:
- **Worker** — gathers, builds, repairs.
- **Swordsman** — cheap tough front line.
- **Archer** — ranged damage, hits air.
- **Cleric** — heals nearby units (auto-cast Mend).
- **Lancer** — fast heavy rider, flanks and kills archers.
- **Catapult** — long range siege, kills towers and buildings.
- **Hawk Rider** — flying Tier 3 unit, hits air and ground.

## Buildings

<!-- table:buildings -->
| Building | Tier | HP | Armor | Cost (g/w) | Time | Size | Supply | Trains | Needs |
|---|---|---|---|---|---|---|---|---|---|
| Town Hall | 1 | 2000 | 5 | 385/185 | 120 | 5×5 | 12 | Worker | — |
| Stronghold | 2 | 2500 | 5 | 300/150 | 90 | 5×5 | 12 | Worker | Town Hall |
| Citadel | 3 | 3000 | 6 | 350/200 | 110 | 5×5 | 12 | Worker | Stronghold, Forge |
| House | 1 | 500 | 3 | 80/20 | 30 | 2×2 | 8 | — | — |
| Barracks | 1 | 1200 | 5 | 160/50 | 50 | 4×4 | — | Swordsman, Lancer | — |
| Archery Range | 1 | 1100 | 5 | 150/60 | 50 | 4×3 | — | Archer | Barracks |
| Forge | 1 | 1000 | 5 | 140/60 | 45 | 3×3 | — | — | — |
| Chapel | 2 | 1000 | 5 | 180/80 | 55 | 3×4 | — | Cleric | Stronghold |
| Workshop | 2 | 1100 | 5 | 160/100 | 55 | 4×4 | — | Catapult | Stronghold, Forge |
| Hawk Roost | 3 | 1200 | 5 | 200/150 | 60 | 4×4 | — | Hawk Rider | Citadel |
| Watchtower (attacks 22-26 pierce, range 7) | 1 | 550 | 5 | 110/60 | 35 | 2×2 | — | — | Barracks |
<!-- /table -->

## Tech tree

```
Town Hall (tier 1) ── trains Worker
 ├─ House (supply)
 ├─ Barracks ── Swordsman
 │   ├─ Archery Range ── Archer
 │   └─ Watchtower
 ├─ Forge
 └─ upgrade ─► Stronghold (tier 2)
                ├─ Chapel ── Cleric
                ├─ Barracks + Forge ── Lancer
                ├─ Workshop (needs Forge) ── Catapult
                └─ upgrade (needs Forge) ─► Citadel (tier 3)
                                              └─ Hawk Roost ── Hawk Rider
```

## Town Hall upgrades

Bought by **your hero** with **hero gold** at your own Town Hall. They help only your own faction.

<!-- table:upgrades -->
| Upgrade | Levels | Cost | Effect | Faction needs |
|---|---|---|---|---|
| Sharper Blades | 3 | 150 / 250 / 350 | Melee units deal more damage. damage pct 10 / 20 / 30 | L1: Forge; L2: Forge + Stronghold; L3: Forge + Citadel |
| Better Arrows | 3 | 150 / 250 / 350 | Ranged units and towers deal more damage. damage pct 10 / 20 / 30 | L1: Forge; L2: Forge + Stronghold; L3: Forge + Citadel |
| Iron Plates | 3 | 175 / 275 / 375 | All units get more armor. bonus armor 2 / 4 / 6 | L1: Forge; L2: Forge + Stronghold; L3: Forge + Citadel |
| Training Drills | 2 | 200 / 300 | Units train faster. train time pct -10 / -20 | L1: —; L2: Stronghold |
| Stone Walls | 2 | 200 / 300 | Buildings and towers get more health and armor. max hp pct 20 / 40, bonus armor 2 / 4 | L1: —; L2: Stronghold |
| Siege Works | 2 | 150 / 250 | Catapults deal more damage. damage pct 20 / 40 | L1: Workshop; L2: Workshop + Citadel |
| Rich Veins | 2 | 150 / 250 | Workers bring more gold and wood each trip. gather pct 10 / 20 | L1: —; L2: Stronghold |
| War Banner (repeat, cooldown 180 s) | 1 | 200 | Your army fights harder for 60 seconds: +15% damage, +10% move speed. damage pct 15, move speed pct 10, duration 60 | L1: — |
| Tier Up Fund (repeat, cooldown 60 s) | 1 | 200 | Give 200 gold to your faction. It must be spent on the next Town Hall tier. give gold 200, earmark next_tier | L1: — |
<!-- /table -->

- "Melee" = Swordsman, Lancer, Hawk Rider. "Ranged" = Archer, Cleric and Watchtowers. Catapults get only Siege Works.
- The AI reacts to what you buy (see "Reactions" below).
- Tier Up Fund gold can only be used for the next Town Hall tier. If the AI is already saving for it, the tier comes sooner.

## How the AI thinks

The faction AI runs on the server, 2–4 times per second (not every tick). It has these parts:

1. **Economy manager** — keeps workers busy, trains workers up to `workerTarget`, sends 70% to gold and 30% to wood (changes with what the next build needs), builds Houses before supply runs out (when free supply < 6).
2. **Build manager** — follows the build order, then free play. Picks building spots from the base build area (a grid around the Town Hall), never blocks the mine path, keeps 1 unit of space between buildings, puts Watchtowers on the side facing the map center.
3. **Production manager** — keeps production buildings busy with the unit mix for its tier.
4. **Army manager** — groups units into a **defense group** (at least 4 supply at home after the first attack) and an **attack army**. Gathers the army at a rally point, waits for stragglers, then attacks.
5. **Target picker** — picks which enemy to attack (by difficulty: closest, weakest, or where our hero is fighting). Re-checks every 5 seconds.
6. **Defense** — when the base is hit, the army comes home if it is closer to home than to its target. Workers fight only if the Town Hall is below 30% health.
7. **Expansion** — takes the natural expansion when it is safe (camp cleared, no enemy army near). Clears the camp with the army first if needed.
8. **Retreat** — if the army drops below `retreatAtArmyPct` of its starting supply and is losing, it goes home.

### Difficulty

| | Easy | Normal | Hard |
|---|---|---|---|
| Think delay | 1.0 s | 0.5 s | 0.3 s |
| Workers | 12 | 16 | 20 |
| Production buildings | 2 | 3 | 5 |
| First attack at army supply | 20 | 24 | 22 (early pressure) |
| Later attacks at | 22 | 28 | 34 |
| Expands at | never | 10 min | 7 min |
| Focus fire | no | yes | yes |
| Pulls wounded units back | no | no | yes |
| Retreats when army is below | never | 30% | 40% |
| Target | closest | closest or weakest | weakest, or where its hero fights |

Difficulty never changes stats or income. A Hard AI is smarter, not stronger.

### Build order (all difficulties)

Easy waits 20 seconds between steps. Steps start when the one before has **started** and the AI can pay.

1. House
2. Barracks
3. House
4. Archery Range
5. 2× Swordsman
6. Watchtower
7. Forge
8. House
9. 3× Archer
10. Upgrade to Stronghold
11. House
12. Chapel
13. Workshop
14. Expand to natural (when allowed)
15. Second Barracks (if allowed)
16. Upgrade to Citadel
17. Hawk Roost

After this: free play — keep supply ahead, keep production busy, rebuild lost buildings, add towers (Hard adds a tower at the expansion).

### Unit mix by tier

| Tier | Swordsman | Archer | Lancer | Cleric | Catapult | Hawk Rider |
|---|---|---|---|---|---|---|
| 1 | 60% | 40% | | | | |
| 2 | 25% | 25% | 25% | 15% | 10% | |
| 3 | 15% | 20% | 25% | 10% | 10% | 20% |

### Reactions to the hero

| When | The AI does |
|---|---|
| Hero bought Sharper Blades | +10% Swordsman and Lancer share (from Archer) |
| Hero bought Better Arrows | +10% Archer share (from Swordsman) |
| Hero bought Siege Works | +5% Catapult share |
| Enemy has many air units | +15% Archer share |
| Our hero is fighting near an enemy base (Hard) | Sends the army to that base |

### The AI status panel

The player can not give orders, but always sees what the AI is doing. The AI writes one short status line, for example:
- "Building Barracks"
- "Saving for Stronghold (240 / 300 gold)"
- "Army gathering (18 / 24 supply)"
- "Attacking Blue"
- "Defending the base!"
- "Taking the expansion"
- "Retreating"
