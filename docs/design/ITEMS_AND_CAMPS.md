# Items, Shops and Neutral Camps

Data: `shared/data/items.json`, `shared/data/shops.json`, `shared/data/camps.json`. Camp places are in `shared/data/map-layout.json`.

## Items

<!-- table:items -->
| Item | Tier | Cost | Sell | Effect |
|---|---|---|---|---|
| Healing Potion | consumable | 50 | 25 | Restore 250 health. |
| Mana Potion | consumable | 60 | 30 | Restore 150 mana. |
| Scroll of Return | consumable | 120 | 60 | After 3 seconds, teleport to your Town Hall. |
| Watcher Ward | consumable | 75 | 37 | Place a hidden eye on the ground. It sees for 3 minutes. |
| Smoke Bomb | consumable | 80 | 40 | Turn invisible for 8 seconds. Attacking or casting ends it. |
| Tome of Wisdom | consumable | drop only | 50 | Gain 150 experience at once. |
| Boots of Haste | basic | 300 | 150 | +0.6 move speed. |
| Iron Claws | basic | 250 | 125 | +8 damage. |
| Guard Ring | basic | 200 | 100 | +3 armor. |
| Swift Gloves | basic | 300 | 150 | +15% attack speed. |
| Sage Cloak | basic | 250 | 125 | +6 intelligence. |
| Giant Belt | basic | 250 | 125 | +6 strength. |
| Thief Band | basic | 250 | 125 | +6 agility. |
| Life Pendant | basic | 200 | 100 | +2.5 health regen per second. |
| Mana Stone | basic | 200 | 100 | +1.5 mana regen per second. |
| Ironwood Shield | advanced | 600 | 300 | +5 armor and +200 health. |
| Warblade | advanced | 700 | 350 | +20 damage. |
| Royal Circlet | advanced | 500 | 250 | +4 to all stats. |
| Vampire Fang | rare | drop only | 400 | Your attacks heal you for 15% of the damage. |
| Frost Orb | rare | drop only | 400 | +5 damage. Attacks slow the target by 20% for 2 seconds. |
| Storm Hammer | rare | drop only | 450 | 20% chance on attack to throw lightning that jumps to 3 enemies for 90 damage. |
| Phoenix Feather | rare | drop only | 500 | When you die, come back to life where you fell with half health. Used up. |
| Temple Crown | rare | drop only | 750 | +8 to all stats. |
<!-- /table -->

Rules:
- 6 slots. Potions stack up to 5 in one slot, other consumables as listed.
- `unique` items (Boots of Haste and all rare items) give their bonus once, even if you carry two.
- Healing Potion and Mana Potion share one 10-second cooldown.
- Scroll of Return: 3-second channel; moving or getting stunned stops it.
- Watcher Ward: invisible; enemies need a ward of their own or a reveal (Mana Mark) to see it. Later: a "detect" item.
- Smoke Bomb: invisible for 8 s; attacking, casting or using an item ends it. Watchtowers do not see invisible units in the MVP.
- Phoenix Feather: on death, you come back where you fell after 2 seconds with 50% health (mana stays as it was). The feather is used up. The death still counts: the killer gets the bounty and you lose the death gold.
- Dropped items stay on the ground for 3 minutes, then vanish.
- Potions, Tome and Smoke Bomb work at once and do not stop what the hero is doing. Watcher Ward walks into range first (6). Items can be used while silenced, not while stunned.
- Selling a stack sells all of it: half the value for the charges that are left.
- Storm Hammer: the hit target is the first of the 3; each jump goes to the nearest enemy within 5 that was not hit yet.
- Uphill miss: an attack from low ground up to high ground (temple plateau, watch hill) misses 25% of the time. Only ground units, melee and ranged. Ramps are in between and count by their height.

## Shops

<!-- table:shops -->
| Shop | Where | Sells |
|---|---|---|
| Trader's Tent | 4 on the map | Healing Potion, Mana Potion, Scroll of Return, Watcher Ward, Smoke Bomb, Boots of Haste, Iron Claws, Guard Ring, Swift Gloves, Sage Cloak, Giant Belt, Thief Band, Life Pendant, Mana Stone |
| Temple Market | 1 on the map | Healing Potion, Scroll of Return, Watcher Ward, Ironwood Shield, Warblade, Royal Circlet |
| Mossy Tankard | 1 on the map |  |
| Ember Kettle | 1 on the map |  |
<!-- /table -->

- Shops are neutral and can not be attacked.
- Buy: right click the item in the shop panel, or click and press the hotkey. Sell: drag an item onto the shop panel.
- The shop panel opens by itself when your hero is within 6 units, or when you click the shop. Buying and selling need the hero within 6 units.

## Neutral camps

<!-- table:camps -->
| Camp | Tier | Monsters | Total HP | Gold (avg) | XP | Respawn | Drops | On map |
|---|---|---|---|---|---|---|---|---|
| green_wolves | green | 3× Grey Wolf | 600 | 42 | 75 | 180 s | 25% (green) | 4 |
| green_bandits | green | 2× Bandit, 1× Bandit Archer | 640 | 46 | 90 | 180 s | 25% (green) | 4 |
| orange_harpies | orange | 2× Harpy, 1× Harpy Matron | 1250 | 84 | 205 | 240 s | 60% (orange) | 4 |
| orange_trolls | orange | 2× Forest Troll, 1× Troll Shaman, 1× Alpha Wolf | 1270 | 86 | 200 | 240 s | 60% (orange) | 4 |
| red_ogres | red | 2× Ogre Brute, 1× Ogre Warlord | 3600 | 180 | 420 | 300 s | 100% (red) | 4 |
| red_sentinels | red | 2× Stone Sentinel, 2× Rock Spider | 3440 | 171 | 380 | 300 s | 100% (temple) | 4 |
<!-- /table -->

Placement (see [MAP.md](MAP.md)) — every sector has the same set:
- **Green Wolves** — west of the base, toward the lake.
- **Green Bandits** — south-east of the base, by the road to the natural expansion.
- **Orange Harpies** — on the way from the base to the temple ring.
- **Orange Trolls** — standing on the natural expansion's Town Hall spot. Must be cleared to expand.
- **Red Ogres** — standing on the corner expansion's Town Hall spot.
- **Red Sentinels** — on the temple plateau, next to the ramp. They guard the center but do not block the way to the Temple Market.

### Monsters

<!-- table:units-neutral -->
| Unit | Lvl | HP | Armor | Attack | Damage | Range | Hits | Speed | Cost (g/w) | Supply | Time | From | Needs | Bounty |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Grey Wolf | 1 | 200 | 1 medium | normal | 9-11 | 1 | ground | 3.2 | — | — | — | — | — | 12-16 |
| Alpha Wolf | 3 | 450 | 2 medium | normal | 18-22 | 1 | ground | 3.3 | — | — | — | — | — | 22-28 |
| Bandit | 1 | 220 | 1 medium | normal | 10-12 | 1 | ground | 2.8 | — | — | — | — | — | 12-16 |
| Bandit Archer | 2 | 200 | 0 light | pierce | 12-15 | 5.5 | ground+air | 2.8 | — | — | — | — | — | 16-20 |
| Forest Troll | 2 | 260 | 0 medium | pierce | 13-16 | 5 | ground+air | 2.8 | — | — | — | — | — | 16-20 |
| Troll Shaman | 3 | 300 | 0 unarmored | magic | 10-12 | 5 | ground+air | 2.8 | — | — | — | — | — | 22-28 |
| Harpy | 3 | 350 | 1 light | pierce | 15-18 | 4 | ground+air | 3.2 (air) | — | — | — | — | — | 22-28 |
| Harpy Matron | 4 | 550 | 2 light | pierce | 22-26 | 4 | ground+air | 3.2 (air) | — | — | — | — | — | 30-38 |
| Rock Spider | 2 | 320 | 3 heavy | normal | 12-15 | 1 | ground | 3 | — | — | — | — | — | 16-20 |
| Spider Queen | 5 | 900 | 3 heavy | normal | 30-36 | 1.2 | ground | 3 | — | — | — | — | — | 40-50 |
| Ogre Brute | 5 | 1000 | 3 heavy | normal | 35-42 | 1.3 | ground | 2.7 | — | — | — | — | — | 45-55 |
| Ogre Warlord | 7 | 1600 | 4 heavy | normal | 50-60 | 1.4 | ground | 2.7 | — | — | — | — | — | 70-90 |
| Stone Sentinel | 6 | 1400 | 6 heavy | normal | 40-50 | 1.4 | ground | 2.5 | — | — | — | — | — | 60-75 |
<!-- /table -->

Monster skills (auto-cast):
- **Alpha Wolf — Howl:** nearby monsters deal 15% more damage for 10 s.
- **Troll Shaman — Mend:** heals a hurt monster for 25.
- **Harpy Matron — Screech:** slows enemies around by 25% for 3 s.
- **Spider Queen — Web:** roots one enemy for 2 s.
- **Ogre Warlord — Ground Slam:** 80 damage and 1.5 s stun around it.
- **Stone Sentinel — Stone Guard (passive):** takes 30% less spell damage.

### Drop tables

<!-- table:drop-tables -->
| Table | Chance | Items (weight) |
|---|---|---|
| green | 25% | Healing Potion (30), Mana Potion (25), Watcher Ward (15), Tome of Wisdom (15), Life Pendant (10), Guard Ring (5) |
| orange | 60% | Healing Potion (15), Tome of Wisdom (15), Scroll of Return (10), Iron Claws (15), Thief Band (8), Giant Belt (8), Sage Cloak (8), Smoke Bomb (6), Frost Orb (8), Vampire Fang (7) |
| red | 100% | Vampire Fang (20), Frost Orb (20), Storm Hammer (20), Phoenix Feather (15), Royal Circlet (15), Ironwood Shield (10) |
| temple | 100% | Storm Hammer (25), Phoenix Feather (25), Warblade (20), Temple Crown (15), Vampire Fang (15) |
<!-- /table -->

One roll per camp when the last monster dies. "Chance" is the chance that anything drops; then one item is picked by weight.
