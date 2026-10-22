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
- Supply: each Town Hall gives 12, each House gives 8, max 100.
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
| Hero Shrine | 1 | 900 | 5 | 180/60 | 45 | 3×3 | — | Faction hero (250/50, 30 s) | Barracks |
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
- Up to `maxSupply` (12) supply of soldiers per hero. They use no kingdom supply and are not part of the kingdom's army; Town Hall upgrades work on them.
- The player does not give them orders. They follow the hero (a spot near it), choose their own targets, and stay in their fight when the hero takes a few steps. They leave a fight only when it is more than `leash` (14) from the hero. They fight neutral camps only when the hero fights. When the hero is dead they walk to its respawn point and wait.
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

1. **Economy manager** — keeps workers busy, trains workers up to `workerTarget`, sends 70% to gold and 30% to wood (changes with what the next build needs), builds Houses before supply runs out (when free supply drops below the personality's `houseAhead`, 5–9). Workers **repair** hurt buildings for free (below 70% health, towers below 85%; up to 3 repairers; while the base is under attack only towers).
2. **Build manager** — follows the build order (changed a little by the personality), then free play. Picks building spots from the base build area (a grid around the Town Hall), never blocks the mine path or the exit toward the map center. Where a building goes depends on the personality (see "AI personality"). When the build area is full the base **grows** (6, 12, 18 units past it; outside the area only on open ground with 2 units of walkable space around, so a building never closes a narrow path). Free play never ends: tier ups, more Watchtowers over time (main base, then 1–3 at every expansion), more production buildings for the unit mix.
3. **Production manager** — keeps production buildings busy with the unit mix for its tier.
4. **Army manager** — groups units into a **defense group** (at least 4 supply at home after the first attack) and an **attack army**. Gathers the army at a rally point, waits for stragglers, then attacks. Between attacks the army **roams** (see "A living map" below).
5. **Target picker** — picks which enemy to attack (by difficulty: closest, weakest, or where our hero is fighting). Re-checks every 5 seconds. At the enemy base the army walks to the Town Hall first when it is close.
6. **Defense** — see "Coming home to defend" below. Workers fight only if the Town Hall is below 30% health, and then only the half nearest the fight (the other half keeps gathering).
7. **Expansion** — takes the natural expansion when it is safe (camp cleared, no enemy army near). Clears the camp with the army first if needed (but never pulls the army out of a siege for it).
8. **Retreat** — if the army drops below `retreatAtArmyPct` of its starting supply, it goes home. Not when the faction is maxed out (100 supply) and rich: then its losses come back at once.
9. **Faction hero** — builds the Hero Shrine and summons the hero (see above).
10. **Attack timing** — before an attack the AI compares its army (and heroes with it) with the defense of the target base: towers (3 supply each) and units near its Town Hall. It attacks when it is at least 1.15 × stronger; until then it clears camps. After 75 s of waiting it goes anyway, and in the late game it never waits. Weakly defended factions are better targets. Against an enemy with 6+ towers it trains more catapults (+15% of the mix). In the late game the army walks past towers to the Town Hall.

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
- **Reinforcements** walk to the attack army as one wave and join it when they reach it.

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
| First attack at army supply | 20 | 24 | 22 (early pressure) |
| Later attacks at | 22 | 28 | 34 |
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
- "Army clearing camps"
- "Fighting Blue's army"
- "Summoning the stone golem"
- "Attacking Blue"
- "Defending the base!"
- "Taking the expansion"
- "Retreating"
- "No enemy left to attack" (a solo match, or the last faction standing)
