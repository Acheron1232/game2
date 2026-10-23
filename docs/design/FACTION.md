# The Kingdom — AI faction

The MVP has one faction, **The Kingdom**: a classic human-like fantasy realm of timber halls, stone walls, knights and archers. All four teams play it, each in its own team color. More factions come after the MVP.

Data: `shared/data/units.json` (group `faction`), `shared/data/buildings.json`, `shared/data/upgrades.json`, `shared/data/ai.json`.

## Start of the match

Each faction starts with: a Town Hall at its start spot, 5 Workers, 500 gold, 150 wood. The hero spawns next to the Town Hall.

## Team match (8 players: two heroes per kingdom)

A team room has 8 slots: slot k (1 · I) and slot 4 + k (1 · II) play for kingdom k. The kingdom is run by the faction AI as always; its two heroes are played by people or bots. The second hero is the kingdom's own hero from the first minute (it takes the Hero Shrine hero's place, so the AI builds no shrine): same owner, team and color, it spawns next to the first one. Both heroes hire soldiers at their own buildings, buy Town Hall upgrades and earn their own gold and XP. A Bot hero in a team walks with the kingdom's army when it is out, defends the base, and **comes to help an allied hero** (its human teammate too) that fights enemy units or heroes within 35. Code: `MatchSetup.teams`, `ClientView.kingdom`, `MatchClient.owner`.

## The faction's own hero (Hero Shrine)

Besides the player's hero, every faction gets **one hero of its own**, played by the AI:

- The AI builds a **Hero Shrine** (needs Barracks; cost and time in the buildings table) right after the Archery Range, then summons the hero there as soon as it can pay (`heroSummon` in `buildings.json`). One hero per faction.
- **Which hero** (ai.json `factionHero`): every hero has a role (front, ranged, support, caster). The AI scores each hero: + bonus for a front-line hero when its army has less than half melee supply, + bonus for a ranged hero when it lacks ranged units, + bonus for a healer or caster when the army is big, + some luck. It **never picks the hero its player plays**, so the two heroes of one side always look different.
- The hero is a full hero: levels, skill points, items (it shops with the same item list as hero bots), its own gold from last hits and camps. It does **not** buy Town Hall upgrades: that stays the player's job.
- It plays with the hero-bot logic: farms camps alone while the army is at home; walks with the army when the army is out (camps, enemy armies, attacks) and shares the XP of everything the army kills; defends the base when it is attacked; goes to a fountain or home when hurt.
- It comes back to life at the shrine (same wait as player heroes). Shrine gone: at the start spot. When the faction is defeated, its hero dies for good.
- Technical: it has its own command slot (`FACTION_HERO_SLOT + player slot`, so slot 4–7) and sends the same commands a player sends. It belongs to the player's team and color. Kills by a hero give the gold to that hero; kills by army units still give it to the player's hero, as before.

## Economy

- Workers mine gold at the gold mine next to the Town Hall (10 gold per trip, max 5 workers in a mine at once) and chop trees (10 wood per trip).
- Workers bring resources to the nearest Town Hall / Stronghold / Citadel.
- Supply: each Town Hall gives 12, each House gives 8. There is **no real army limit**. Instead a big army costs **upkeep** (rules.json `economy.upkeep`): the more supply a kingdom uses (workers too), the less gold every mining trip brings. Wood is not touched.

| Supply used | Gold per trip | Name |
|---|---|---|
| 0–69 | 100% | No upkeep |
| 70–99 | 80% | Low upkeep |
| 100–129 | 60% | High upkeep |
| 130–159 | 40% | Heavy upkeep |
| 160+ | 25% | Crushing upkeep |

  The top bar shows the step next to the supply. `supplyCap` (250) is only a safety ceiling for the server; with upkeep a kingdom does not get near it.
- Gold mines run out: main 20,000, natural expansion 14,000, corner expansion 16,000 (guarded by ogres).
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
| Pike Warden | 3 | 550 | 4 heavy | normal | 18-23 | 1.5 | ground | 2.6 | 150/30 | 3 | 25 | Barracks | Stronghold | 18-24 |
| Frost Adept | 3 | 330 | 0 unarmored | magic | 14-18 | 6 | ground+air | 2.7 | 190/50 | 3 | 28 | Chapel | Stronghold | 18-24 |
| Foundry Golem | 4 | 950 | 5 heavy | normal | 26-34 | 1.6 | ground | 2.2 | 260/90 | 5 | 38 | Golem Foundry | Stronghold, Forge | 18-24 |
| Chainbreaker | 3 | 690 | 4 heavy | normal | 32-39 | 1.5 | ground | 2.45 | 190/40 | 3 | 31 | Bulwark Hall | Stronghold, Forge | 24-30 |
| Rune Gunner | 3 | 380 | 1 unarmored | pierce | 30-38 | 7 | ground+air | 2.5 | 220/55 | 3 | 31 | Workshop | Stronghold, Forge | 24-30 |
| Null Warden | 3 | 480 | 2 medium | magic | 12-16 | 5 | ground+air | 2.6 | 230/60 | 3 | 31 | Chapel | Stronghold | 24-30 |
| Reliquary Guard | 4 | 850 | 5 heavy | normal | 20-27 | 1.3 | ground | 2.35 | 250/65 | 4 | 34 | Bulwark Hall | Stronghold, Forge | 32-40 |
| Banner Captain | 3 | 580 | 3 heavy | normal | 16-21 | 1.2 | ground | 2.7 | 200/30 | 3 | 31 | Barracks | Stronghold | 24-30 |
| Lantern Novice | 3 | 310 | 0 unarmored | magic | 9-12 | 5 | ground+air | 2.75 | 170/40 | 2 | 28 | Chapel | Stronghold | 16-20 |
| Veil Sister | 3 | 350 | 1 unarmored | magic | 10-14 | 5.5 | ground+air | 2.7 | 210/55 | 3 | 31 | Chapel | Stronghold | 24-30 |
| Bulwark Golem | 4 | 1250 | 7 heavy | normal | 22-28 | 1.5 | ground | 1.9 | 340/120 | 6 | 40 | Golem Foundry | Stronghold, Forge | 48-60 |
| Siege Golem | 4 | 1100 | 5 heavy | siege | 75-95 | 1.8 | ground | 1.85 | 380/150 | 6 | 40 | Golem Foundry | Stronghold, Forge | 48-60 |
| Boar Lancer | 4 | 850 | 4 heavy | normal | 30-37 | 1.5 | ground | 3.6 | 260/65 | 4 | 36 | Tusk Lodge | Stronghold | 32-44 |
| Ram Drummer | 4 | 720 | 2 heavy | normal | 13-18 | 1.3 | ground | 3.1 | 240/60 | 4 | 36 | Tusk Lodge | Stronghold | 32-44 |
| Covered Ram | 4 | 1050 | 4 heavy | siege | 80-100 | 1.4 | ground | 2 | 280/100 | 5 | 39 | Workshop | Stronghold | 40-55 |
| Bolt Cart | 4 | 520 | 2 heavy | siege | 40-48 | 8 | ground | 2.15 | 240/90 | 4 | 36 | Workshop | Stronghold | 32-44 |
| Kite Bomber | 4 | 500 | 1 light | siege | 32-40 | 5.5 | ground | 3.4 (air) | 280/100 | 4 | 36 | Hawk Roost | Citadel | 32-44 |
<!-- /table -->

Roles in one line:
- **Worker** — gathers, builds, repairs.
- **Swordsman** — cheap tough front line.
- **Archer** — ranged damage, hits air.
- **Cleric** — heals nearby units (Mend) and shields an ally in a fight (Faith Ward, +4 armor). Both work by themselves; the player can press them too.
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
| Barracks | 1 | 1200 | 5 | 160/50 | 50 | 4×4 | — | Swordsman, Lancer, Pike Warden, Banner Captain | — |
| Archery Range | 1 | 1100 | 5 | 150/60 | 50 | 4×3 | — | Archer | Barracks |
| Forge | 1 | 1000 | 5 | 140/60 | 45 | 3×3 | — | — | — |
| Chapel | 2 | 1000 | 5 | 180/80 | 55 | 3×4 | — | Cleric, Frost Adept, Null Warden, Lantern Novice, Veil Sister | Stronghold |
| Workshop | 2 | 1100 | 5 | 160/100 | 55 | 4×4 | — | Catapult, Rune Gunner, Covered Ram, Bolt Cart | Stronghold, Forge |
| Hawk Roost | 3 | 1200 | 5 | 200/150 | 60 | 4×4 | — | Hawk Rider, Kite Bomber | Citadel |
| Watchtower (attacks 22-26 pierce, range 7) | 1 | 550 | 5 | 110/60 | 35 | 2×2 | — | — | Barracks |
| Hero Shrine | 1 | 900 | 5 | 180/60 | 45 | 3×3 | — | Faction hero (250/50, 30 s) | Barracks |
| Golem Foundry | 2 | 1400 | 5 | 220/140 | 65 | 5×4 | — | Foundry Golem, Bulwark Golem, Siege Golem | Stronghold, Forge |
| Bulwark Hall | 2 | 1450 | 5 | 210/100 | 55 | 4×4 | — | Chainbreaker, Reliquary Guard | Stronghold |
| Timber Wall | 1 | 600 | 2 | 20/30 | 12 | 2×1 | — | — | — |
| Stone Wall | 2 | 1100 | 5 | 35/45 | 20 | 2×1 | — | — | Stronghold |
| Reinforced Wall | 2 | 1700 | 8 | 65/60 | 25 | 2×1 | — | — | Stronghold |
| Repair Post | 2 | 650 | 3 | 100/75 | 30 | 3×2 | — | — | Stronghold |
| Rally Bastion | 2 | 1050 | 5 | 150/90 | 40 | 3×3 | — | — | Stronghold |
| Chain Spire | 2 | 700 | 4 | 190/80 | 45 | 2×2 | — | — | Stronghold |
| Frost Obelisk | 2 | 850 | 5 | 150/75 | 40 | 2×2 | — | — | Stronghold |
| Bell Ward | 2 | 750 | 4 | 170/80 | 40 | 2×2 | — | — | Stronghold |
| Pitch Basin | 2 | 400 | 1 | 65/45 | 20 | 2×2 | — | — | Stronghold |
| Wind Totem | 2 | 600 | 3 | 140/60 | 35 | 2×2 | — | — | Stronghold |
| Shield Pylon | 2 | 700 | 5 | 180/90 | 45 | 2×2 | — | — | Stronghold |
| Tusk Lodge | 2 | 1300 | 5 | 210/100 | 60 | 4×4 | — | Boar Lancer, Ram Drummer | Stronghold |
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

## Hired soldiers (the hero's own small army)

The player's hero can hire soldiers for itself, with **hero gold** (rules.json `hire`):

- Stand next to one of your own finished production buildings (Barracks, Archery Range, Chapel, Workshop, Hawk Roost). A "Hire at …" panel opens with the units that building trains. Same tech as the kingdom: a Lancer needs Stronghold and Forge.
- Price = (unit gold + unit wood) × `priceFactor` (1.5): Swordsman 180, Archer 225, Cleric 285, Catapult 420, Lancer 450, Hawk Rider 525.
- Up to `maxSupply` (30) supply of soldiers per hero (15 two-supply soldiers at most). They use no kingdom supply and are not part of the kingdom's army; Town Hall upgrades work on them.
- The player does not give them orders. They follow the hero (a spot near it), choose their own targets, and stay in their fight when the hero takes a few steps. They leave a fight only when it is more than `leash` (14) from the hero. They fight neutral camps only when the hero fights. When the hero is dead they walk to its respawn point and wait.
- **Focus fire:** when the hero gets an attack order on one enemy (A + click, or right click on it), every soldier that can hit that enemy attacks it, also past the leash. It ends when the hero gets another order (move, stop, attack-move on the ground...) or the enemy dies; then they choose their own targets again. Soldiers that can not hit it (ground fighters vs. a flyer) keep their own targets. It follows the hero's order, not its current target, so a taunt on the hero does not pull the soldiers away. Bot heroes use the same order on camps, so their soldiers focus too.
- Bot heroes (Bot slots) hire too (ai.json `heroBot.hiring`): from level 3, the most expensive unit they can pay while keeping 350 gold, at an own building or a tavern within 90. The faction's own hero does not hire (it has the whole army).

### Taverns (mercenaries)

Two neutral **taverns** on the map hire special mercenaries to any hero (same 12-supply limit, same follow-and-fight behaviour, no kingdom tech needed, their own price in hero gold):

| Tavern | Mercenary | Price | Supply | Role |
|---|---|---|---|---|
| Mossy Tankard | Ratling Cutthroat | 210 | 2 | fast melee rat-man with two daggers |
| Mossy Tankard | Toadfolk Mystic | 260 | 2 | ranged magic toad shaman, heals allies (Mend) |
| Ember Kettle | Shellback Beetle | 520 | 4 | slow armored tank beetle, ground slam (stun) |
| Ember Kettle | Ember Wisp | 380 | 3 | flying fire spirit, ranged magic |

Stats: `units.json` (group `mercenary`), lists: `shops.json` (`mercenaries`). Art: a concept sheet first, then each model, then Codex painted each model's 8-cell texture on top of a guide picture of that model's UV layout (`tools/art/uv-guide.ts`).

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

1. **Economy manager** — keeps workers busy, trains workers up to `workerTarget`, sends 70% to gold and 30% to wood (changes with what the next build needs), builds Houses before supply runs out (when free supply drops below the personality's `houseAhead`, 5–9; no more Houses past what it trains, see below). Workers **repair** hurt buildings for free (below 70% health, towers below 85%; up to 3 repairers; while the base is under attack only towers).
2. **Build manager** — follows the build order (changed a little by the personality), then free play. Picks building spots from the base build area (a grid around the Town Hall), never blocks the mine path or the exit toward the map center. Where a building goes depends on the personality (see "AI personality"). When the build area is full the base **grows** (6, 12, 18 units past it; outside the area only on open ground with 2 units of walkable space around, so a building never closes a narrow path). Free play never ends: tier ups, more Watchtowers over time (main base, then 1–3 at every expansion), more production buildings for the unit mix.
3. **Production manager** — keeps production buildings busy with the unit mix for its tier. Above `trainUpToSupply` (130 used supply, ai.json `army`) it trains no more army unless its base is attacked: the upkeep would eat more gold than the soldiers are worth.
4. **Army manager** — groups units into a **defense group** (at least 4 supply at home after the first attack) and an **attack army**. Gathers the army at a rally point, waits for stragglers, then attacks. Between attacks the army **roams** (see "A living map" below).
5. **Target picker** — picks which enemy to attack (by difficulty: closest, weakest, or where our hero is fighting). Re-checks every 5 seconds. At the enemy base the army walks to the Town Hall first when it is close.
6. **Defense** — see "Coming home to defend" below. Workers fight only if the Town Hall is below 30% health, and then only the half nearest the fight (the other half keeps gathering).
7. **Expansion** — takes the natural expansion when it is safe (camp cleared, no enemy army near). Clears the camp with the army first if needed (but never pulls the army out of a siege for it). It keeps the Town Hall money only once the spot is free: before 2026-10-23 it kept 385 gold from the moment the expansion was due, and while the army was busy elsewhere that froze the kingdom's gold (and its army) for 10–25 minutes.
8. **Retreat** — if the army drops below `retreatAtArmyPct` of its starting supply, it goes home. Not when the faction is near `trainUpToSupply` and rich: then its losses come back at once.
9. **Faction hero** — builds the Hero Shrine and summons the hero (see above).
10. **Attack timing** — before an attack the AI compares its army (and heroes with it) with the defense of the target base: towers (3 supply each) and units near its Town Hall. It attacks when it is at least 1.15 × stronger; until then it clears camps. After 75 s of waiting it goes anyway, and in the late game it never waits. From `attackAtSupplyUsed` (100 used supply) it goes with what it has (at least half the attack size): under upkeep an army that waits only costs. Weakly defended factions are better targets: few buildings, a small army, and few defenders at home (an army that is out does not defend). A kingdom another AI attacks now is a better target too (it fights on two sides), and the AI sticks to its last target unless another one is clearly better. **After a won fight in the field** the army pushes on to that enemy's base when it still has `pushAfterWinPct` (60%) of the attack size and half its health. Against an enemy with 6+ towers it trains more catapults (+15% of the mix). In the late game the army walks past towers to the Town Hall.

### Building prices rise (rules.json `economy.buildingPriceRise`)

Like upkeep in classic RTS games, there is no fixed limit on towers or production buildings. After `freeCount` buildings of one type (sites too), every next one costs `pctPerExtra` % more gold and wood, adding up. A lost building makes the next one cheaper again. Now: Watchtower 4 free, then +25% each (5th 138/75, 8th 220/120); Barracks and Archery Range 2 free, +35%; Chapel, Workshop, Hawk Roost 1 free, +35%. Town Halls, Houses, Forge and Hero Shrine never rise. Each AI personality pays for a tower only up to its own price limit (rusher 1.25–1.75 ×, balanced and boomer 1.75–2.5 ×, turtle 3–4 × the first price), and a risen tower only when it keeps 1.5 × its price in the bank (army money).

### AI personality (personality.ts)

Every faction AI gets a character for the match, made from the match seed and its slot (the same seed gives the same game). Difficulty still decides how well it plays; the personality decides its style:

| Style | What it does |
|---|---|
| Balanced | The normal build order and timings. |
| Turtle | 3–5 extra towers, a new one every 3–5 minutes, two extra towers in the build order, pays a lot for towers, attacks with 10–30% more army. |
| Rusher | 1–2 more soldiers in every train step, the first tower after the Stronghold, attacks with 10–25% less army, expands later. |
| Boomer | Expands 2–4 minutes earlier, 1–2 more production buildings, a second expansion at minute 15–20, more towers at expansions. |

For everyone, picked at random: the side the base grows toward and how strongly, where houses go (often behind the hall like a wall), the space between buildings (1–2.5), a random spread of spots, the angle of the tower line and the space between towers (6–11), how far ahead houses are built, the attack size (± 10–15%), the expansion minute (−1 to +2), and the unit mix (each unit × 0.75–1.3). Picture of bases from three seeds: [ai-bases-preview.png](ai-bases-preview.png) (gold = Town Hall, magenta = towers, brown = houses).

### A living map (ai.json `army`)

- **Heroes walk with the army.** Both heroes of a Bot slot (the player's hero and the faction's hero) join the army whenever it is out (camps, enemy armies, attacks) and share the XP of its kills; they count as army strength (2 + level each) when they are near it. When the army is at home they farm camps near the base, hire soldiers and shop. A bot hero walks home for Town Hall upgrades when its upgrade savings (30% of the gold it earns, kept apart from items and hiring) pay for one.
- **Roaming.** From `roamAtSupply` army supply (6), while the next attack is not ready, the army clears neutral camps it can beat (total monster level ≤ `campLevelPerSupply` × army supply, our hero counts too; flying monsters only with enough archers or other units that hit air), up to `roamRadius` from home (bigger at higher tiers), never right next to an enemy base. After a camp it goes on to the nearest next camp while its health is above `roamMinHpPct`, else home. When it is strong enough for an attack it attacks straight from where it is.
- **Meeting other armies.** An enemy army (at least 4 supply of units; heroes alone do not count) seen within `huntRange` of our army, away from its own base, is attacked when our strength is at least `huntStrengthRatio` × theirs (supply, a hero counts as 2 + level). A much stronger army that is close: our army goes home. An attack army on its way also fights an enemy army it meets, then walks on.
- **Reinforcements** walk to the attack army as one wave (at least `reinforceSupply`, 10) and join it when they reach it.

### Coming home to defend

When enemies (not workers passing by) are within 24 of one of our Town Halls:
- the home group fights them;
- a **roaming** army (camps, a fight in the forest) always comes home;
- an **attack** army comes home only if it is closer to home than to its goal **and** it is not already fighting at the building it attacks (within `siegeRange` of it). An army in the middle of a siege finishes the job.
- A wave of reinforcements on its way turns back home.

### Marching and fighting

- An attack group marches as one block: the slowest walking unit sets the speed; a unit more than `groupSpread` (by role) in front of the middle of the group slows down, and waits when it is far in front. Melee walks in front, ranged units in the middle, catapults at the back. Close to the goal everybody walks freely.
- **Target classes** (army units and towers): enemy units that fight back and heroes first, then Watchtowers, then workers, then other buildings; inside a class, the ones that attack our team first; then the weakest (focus fire) or the nearest. Catapults still hit buildings first (towers first).
- A unit that is hitting a building or a worker turns to an enemy fighter that comes within 7.
- **Chase leash:** an army unit lets a fleeing unit go when it is more than `chaseLeash` away and walks on with its group.

### Difficulty

| | Easy | Normal | Hard |
|---|---|---|---|
| Think delay | 1.0 s | 0.5 s | 0.3 s |
| Workers | 12 | 16 | 20 |
| Production buildings | 2 | 3 | 5 |
| First attack at army supply | 22 | 30 | 28 (early pressure) |
| Later attacks at | 28 | 40 | 46 |
| Expands at | never | 10 min | 7 min |
| Focus fire | no | yes | yes |
| Pulls wounded units back | no | no | yes |
| Retreats when army is below | never | 20% | 40% |
| Target | closest | closest or weakest | weakest, or where its hero fights |

Difficulty never changes stats or income. A Hard AI is smarter, not stronger.

### Build order (all difficulties)

Easy waits 20 seconds between steps. Steps start when the one before has **started** and the AI can pay.

1. House
2. Barracks
3. House
4. Archery Range
5. Hero Shrine (the hero is summoned when it is ready)
6. 2× Swordsman
7. Watchtower
8. Forge
9. House
10. 3× Archer
11. Upgrade to Stronghold
12. House
13. Chapel
14. Workshop
15. Expand to natural (when allowed)
16. Second Barracks (if allowed)
17. Upgrade to Citadel
18. Hawk Roost

After this: free play — keep supply ahead, keep production busy, rebuild lost buildings, add towers (Hard adds a tower at the expansion).

### Unit mix by tier

| Tier | Swordsman | Archer | Lancer | Cleric | Catapult | Hawk Rider |
|---|---|---|---|---|---|---|
| 1 | 60% | 40% | | | | |
| 2 | 25% | 25% | 25% | 15% | 10% | |
| 3 | 15% | 20% | 25% | 10% | 10% | 20% |

### Self-play tuning (tools/ai/tune.ts)

The AI does not learn while it plays. Instead a tool tunes its numbers with many bot matches (an evolutionary search, no neural network): `pnpm --filter @game/tools ai:tune`.

- **What it changes:** ai.json `faction.difficulties.normal` (firstAttackArmySupply, attackArmySupply, retreatAtArmyPct, expandAtMinute), `faction.army` (roamAtSupply, huntStrengthRatio, reinforceSupply, attackAtSupplyUsed, trainUpToSupply, pushAfterWinPct, campLevelPerSupply) and the `unitMix` shares of every tier (each unit keeps at least 3%; shares always add up to 1). Ranges are in `tools/ai/lib/genes.ts`.
- **How a candidate is tested:** a headless 4-player bot match (normal) where the candidate plays 2 slots and the current ai.json numbers play the other 2, each its own team. Every seed is played twice with the sides swapped (the **mirror**: candidate in slots 1+3, then in 2+4, and so on over all corner pairs), so the start spots, heroes and personalities that come from the seed help both sides the same. Score: 1 if a candidate slot wins, 0 if a current one wins, no winner in time: the candidates' share of the kingdoms still alive. 0.5 means equal.
- **The search:** generation 1 is the current numbers with random changes. Every generation all candidates play the same new seeds; the best half lives on (its score keeps adding up), and children of two of them (each number from one parent, then small random changes) fill the rest.
- **Ladder (`--ladder`):** the opponent starts as the ai.json numbers. When the leader has two generations of matches and a score of at least `--promote-from` (0.6), it gets its own check on new seeds (`--promote-matches`, 32). Clearly better there (score minus 2 standard errors above 0.5): it becomes the new opponent (a "champion") for everybody, and all scores start again. So the AI gets better step by step, not only against the old version. The final check is always against ai.json.
- **Long runs:** the report is saved after every generation and holds the whole search state; `--resume <report>` goes on from the last saved generation. `--until <time>` (or `--hours`) stops starting new generations so that the final check still ends before that time. `tools/ai/run-long.sh <report> [options]` runs it at nice 15 and resumes by itself after an error (up to 5 times). The tool only lowers its CPU priority, never raises it.
- **The check:** the best candidate plays `--validate` (48) matches on seeds it never saw (24 seeds, both sides). Better only when the score minus two standard errors is above 0.5. `--check-only <report>` runs only the check for the best candidate of an earlier report (a new `--seed` gives new seeds).
- **Why the check matters:** the search score is too high by design: a candidate is kept *because* it won, and its lucky early matches stay in its average.
- **How the numbers reach one faction:** `MatchSetup.aiTuning` (tools only, never from the lobby or the protocol) holds changed numbers per faction slot; `tuning.ts` `factionRules()` puts them over ai.json, and the brain reads all these numbers from there. The game itself always plays the ai.json numbers.
- The tool never writes ai.json. A person reads the report (`server/logs/ai-tune-*.json`: every generation, the best candidate, the old → new numbers, the check) and decides.
- **First run (2026-10-23):** 5 generations × 10 candidates × 8 matches (400 matches, 23 min with 8 processes; this search did not have the mirror yet). Best candidate c15: search score 0.81 over 32 matches. Check 1 (48 seeds, no mirror): 0.40. Check 2 (`--check-only`, 24 new seeds × both sides): 0.60. Together about 0.50: **not shown to be better**, ai.json unchanged. In 13 of the 24 mirrored seeds each side won once: the seed and the start spots decide more than these numbers do. So a real gain needs many more matches per candidate (a night on the server).
- Limits: it only tunes Normal; it learns to beat the current AI, not humans (a candidate that beats the AI may still be easy for a player); personalities still add their own random changes on top.

### Reactions to the hero

| When | The AI does |
|---|---|
| Hero bought Sharper Blades | +10% Swordsman and Lancer share (from Archer) |
| Hero bought Better Arrows | +10% Archer share (from Swordsman) |
| Hero bought Siege Works | +5% Catapult share |
| Enemy has many air units | +15% Archer share |
| Our hero is fighting near an enemy base (Hard) | Sends the army to that base |

### Kingdom orders (orders.ts, ai.json `orders`)

The players can tell their kingdom's AI what to do next. The **Orders** row sits under the kingdom line in the top bar:

| Button | What the AI does |
|---|---|
| **Auto** | Decides alone (all of the above). The start order. |
| **Attack [color]** | One button per enemy kingdom still in the game. The army goes for that kingdom's nearest Town Hall now with what it has (at least `attackMinSupply`, 6), without waiting for a stronger army; new soldiers follow as waves. An army that is out turns to the new target. Back to Auto when that kingdom is out of the game. |
| **Defend** | The army stays home and fights only within `stayHomeRange` (40) of the Town Hall. `defendExtraTowers` (2) more towers. |
| **Build up** | Like Defend without the extra towers: the army stays home and grows, all money goes to soldiers. |
| **Farm** | No attacks: the army clears camps up to `farmRoamRadius` (160) from home, camp after camp (XP and gold for the heroes). |
| **Expand** | Take the nearest free gold mine now: the army clears it first (an attack army is called back), then a worker builds the Town Hall. Back to Auto once the Town Hall is started (or when no mine is free). |

- An order stays until a player changes it (or it is done, see above). The status line starts with it: "Order: Attack Blue · …".
- **One order per kingdom.** In a team match both heroes of a kingdom see the same row and can change it; the last order counts. When a teammate changes it, the other player sees "Name: Attack Blue".
- **Bot heroes follow it.** They walk with the army when it is out (attack, farm, clearing the expansion). With Defend they farm only camps within `heroCampRange.defend` (45) of home, with Build up within 75, and wait at the base when there is none. This is true for a bot teammate in a team match and for the shrine hero.
- Technical: command `KingdomOrder` (18) with the order index and the target kingdom slot; the hero may be dead. The snapshot's faction block carries the order, its target and who gave it (protocol 15).

### The AI status panel

The players see what the AI is doing (and steer it with the orders above). The AI writes one short status line, for example:
- "Building Barracks"
- "Saving for Stronghold (240 / 300 gold)"
- "Army gathering (18 / 24 supply)"
- "Army clearing camps"
- "Fighting Blue's army"
- "Summoning the stone golem"
- "Attacking Blue"
- "Defending the base!"
- "Taking the expansion"
- "Retreating"
- "No enemy left to attack" (a solo match, or the last faction standing)
- "Pushing on to Blue after a won fight"
- "Order: Defend · Army guards the base", "Order: Build up · Building up the army (34 supply)", "Order: Farm · Army clearing camps"
