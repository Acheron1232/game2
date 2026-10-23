# Items, Shops and Neutral Camps

Data: `shared/data/items.json`, `shared/data/shops.json`, `shared/data/camps.json`. Camp places are in `shared/data/map-layout.json`.

## Items

65 items. Five roles: **mage** (spell damage, shorter cooldowns, mana), **warrior** (damage, life steal, attack speed), **tank** (armor, health, spell resist), **support** (auras for allies, stronger heals) and **damage** (critical hits, attack speed).

- **Parts** (basic, Trader's Tent): cheap items with one bonus. **Advanced** items (Relic Hall) are made from parts plus a gold fee. **Legendary** items (Temple Market) are made from advanced items. An **upgrade** (Arcane Staff II, Bulwark Plate II, Sage's Hourglass, Windrunner Boots, Sage Treads) is a recipe that uses the item before it.
- Buying a recipe item uses the parts the hero carries (also the parts of a missing part, all the way down); the rest is paid in gold. Parts make room, so a full inventory can still build. The shop shows the price after the parts.
- New stats: spell damage %, less cooldown %, less spell damage taken %, stronger heals %, critical hit chance % (a crit does 1.75 × damage), max mana. Caps (rules.json `items.caps`): cooldown 40%, spell resist 60%, crit 50%, spell damage 80%, heal power 60%.
- Auras (Guardian Shield, Banner of Valor, Healer's Censer, Soul Lantern, Dawn Relic) work on all allies within the radius, units too. The same aura item on two heroes does not add up.
- Bots follow their hero's list in `ai.json` `heroBot.heroBuild`: a recipe item whole when the gold is enough, else part by part.

<!-- table:items -->
| Item | Tier | Role | Cost | Sell | Made from | Effect |
|---|---|---|---|---|---|---|
| Healing Potion | consumable | — | 50 | 25 | — | Restore 250 health. |
| Mana Potion | consumable | — | 60 | 30 | — | Restore 150 mana. |
| Scroll of Return | consumable | — | 120 | 60 | — | After 3 seconds, teleport to your Town Hall. |
| Watcher Ward | consumable | — | 75 | 37 | — | Place a hidden eye on the ground. It sees for 3 minutes. |
| Smoke Bomb | consumable | — | 80 | 40 | — | Turn invisible for 8 seconds. Attacking or casting ends it. |
| Tome of Wisdom | consumable | — | drop only | 50 | — | Gain 150 experience at once. |
| Boots of Haste | basic | — | 300 | 150 | — | +0.6 move speed. |
| Iron Claws | basic | — | 250 | 125 | — | +8 damage. |
| Guard Ring | basic | — | 200 | 100 | — | +3 armor. |
| Swift Gloves | basic | — | 300 | 150 | — | +15% attack speed. |
| Sage Cloak | basic | — | 250 | 125 | — | +6 intelligence. |
| Giant Belt | basic | — | 250 | 125 | — | +6 strength. |
| Thief Band | basic | — | 250 | 125 | — | +6 agility. |
| Life Pendant | basic | — | 200 | 100 | — | +2.5 health regen per second. |
| Mana Stone | basic | — | 200 | 100 | — | +1.5 mana regen per second. |
| Ironwood Shield | advanced | — | 600 | 300 | — | +5 armor and +200 health. |
| Warblade | advanced | — | 700 | 350 | — | +20 damage. |
| Royal Circlet | advanced | — | 500 | 250 | — | +4 to all stats. |
| Vampire Fang | rare | — | drop only | 400 | — | Your attacks heal you for 15% of the damage. |
| Frost Orb | rare | — | drop only | 400 | — | +5 damage. Attacks slow the target by 20% for 2 seconds. |
| Storm Hammer | rare | — | drop only | 450 | — | 20% chance on attack to throw lightning that jumps to 3 enemies for 90 damage. |
| Phoenix Feather | rare | — | drop only | 500 | — | When you die, come back to life where you fell with half health. Used up. |
| Temple Crown | rare | — | drop only | 750 | — | +8 to all stats. |
| Greater Healing Potion | consumable | — | 120 | 60 | — | Restore 500 health. |
| Greater Mana Potion | consumable | — | 130 | 65 | — | Restore 300 mana. |
| Focus Crystal | basic | mage | 300 | 150 | — | +6% spell damage. |
| Hourglass Charm | basic | mage | 300 | 150 | — | 5% less ability cooldown. |
| Mana Pearl | basic | mage | 250 | 125 | — | +150 max mana. |
| Mage Ring | basic | mage | 200 | 100 | — | +4 intelligence, +0.8 mana regen. |
| Warding Cloth | basic | tank | 300 | 150 | — | Take 10% less spell damage. |
| Chain Vest | basic | tank | 400 | 200 | — | +5 armor. |
| Heart Stone | basic | tank | 400 | 200 | — | +250 max health. |
| Iron Buckler | basic | tank | 200 | 100 | — | +2 armor, +100 max health. |
| Keen Dagger | basic | damage | 450 | 225 | — | 10% chance to hit hard (critical hit). |
| Healer's Herbs | basic | support | 250 | 125 | — | Your heals are 10% stronger. |
| Arcane Staff | advanced | mage | 750 | 375 | Focus Crystal + Sage Cloak + 200 | +12% spell damage, +8 intelligence. |
| Arcane Staff II | advanced | mage | 1350 | 675 | Arcane Staff + Focus Crystal + 300 | Upgrade. +20% spell damage, +14 intelligence. |
| Timeworn Tome | advanced | mage | 800 | 400 | Hourglass Charm + Mana Pearl + 250 | 10% less ability cooldown, +200 max mana. |
| Sage's Hourglass | advanced | mage | 1600 | 800 | Timeworn Tome + Hourglass Charm + Mana Stone + 300 | Upgrade. 20% less ability cooldown, +300 max mana, +2 mana regen. |
| Mana Font | advanced | mage | 600 | 300 | Mana Stone + Mana Pearl + 150 | +3 mana regen, +250 max mana. |
| Crystal Heart | advanced | mage | 950 | 475 | Heart Stone + Mana Pearl + 300 | +400 max health, +300 max mana. |
| Bloodletter Axe | advanced | warrior | 800 | 400 | Iron Claws + Life Pendant + 350 | +15 damage, heal for 8% of attack damage. |
| Berserker Mail | advanced | warrior | 1200 | 600 | Swift Gloves + Chain Vest + Giant Belt + 250 | +15% attack speed, +5 armor, +8 strength. |
| Warlord Blade | advanced | warrior | 1350 | 675 | Warblade + Giant Belt + 400 | +30 damage, +8 strength. |
| Giant Maul | advanced | warrior | 1000 | 500 | Iron Claws + Heart Stone + 350 | +25 damage, +250 max health. |
| Bulwark Plate | advanced | tank | 1100 | 550 | Chain Vest + Heart Stone + 300 | +9 armor, +300 max health. |
| Bulwark Plate II | advanced | tank | 2100 | 1050 | Bulwark Plate + Heart Stone + Life Pendant + 400 | Upgrade. +13 armor, +600 max health, +4 health regen. |
| Spellward Cloak | advanced | tank | 1000 | 500 | Warding Cloth + Heart Stone + 300 | Take 25% less spell damage, +200 max health. |
| Troll Heart | advanced | tank | 850 | 425 | Life Pendant + Giant Belt + 400 | +8 health regen, +10 strength. |
| Guardian Shield | advanced | tank | 1100 | 550 | Ironwood Shield + Iron Buckler + 300 | +6 armor, +250 max health. Aura: allies near you get +2 armor. |
| Banner of Valor | advanced | support | 800 | 400 | Guard Ring + Swift Gloves + 300 | Aura: allies near you get +3 armor and 10% attack speed. |
| Healer's Censer | advanced | support | 750 | 375 | Healer's Herbs + Life Pendant + 300 | Your heals are 20% stronger. Aura: allies near you get +2 health regen. |
| Soul Lantern | advanced | support | 650 | 325 | Mage Ring + Life Pendant + 250 | +8 intelligence. Aura: allies near you get +1.5 health regen and 8% move speed. |
| Elder Robe | advanced | support | 1000 | 500 | Sage Cloak + Hourglass Charm + Healer's Herbs + 200 | +10 intelligence, 5% less ability cooldown, your heals are 15% stronger. |
| Marksman Bow | advanced | damage | 1050 | 525 | Keen Dagger + Iron Claws + 350 | +20 damage, 15% chance to hit hard. |
| Assassin's Blade | advanced | damage | 1150 | 575 | Keen Dagger + Thief Band + 450 | +12 agility, 20% chance to hit hard. |
| Swift Quiver | advanced | damage | 850 | 425 | Swift Gloves + Thief Band + 300 | +30% attack speed, +6 agility. |
| Windrunner Boots | advanced | damage | 900 | 450 | Boots of Haste + Swift Gloves + 300 | Upgrade of Boots of Haste. +1.0 move speed, +20% attack speed. |
| Sage Treads | advanced | mage | 950 | 475 | Boots of Haste + Sage Cloak + Mana Stone + 200 | Upgrade of Boots of Haste. +0.9 move speed, +8 intelligence, +1.5 mana regen. |
| Archmage Scepter | legendary | mage | 2950 | 1475 | Arcane Staff II + Timeworn Tome + 800 | +30% spell damage, 15% less ability cooldown, +20 intelligence, +400 max mana. |
| Titan Aegis | legendary | tank | 4000 | 2000 | Bulwark Plate II + Spellward Cloak + 900 | +16 armor, +900 max health, take 30% less spell damage. |
| Kingslayer | legendary | warrior | 3500 | 1750 | Warlord Blade + Assassin's Blade + 1000 | +45 damage, +12 agility, 30% chance to hit hard. |
| Sky Piercer | legendary | damage | 2800 | 1400 | Marksman Bow + Swift Quiver + 900 | +40 damage, +40% attack speed, 20% chance to hit hard. |
| Dawn Relic | legendary | support | 2450 | 1225 | Banner of Valor + Healer's Censer + 900 | Your heals are 30% stronger, 10% less ability cooldown. Aura: allies near you get +5 armor, +4 health regen and 15% attack speed. |
| Crown of Ages | legendary | mage | 2300 | 1150 | Royal Circlet + Timeworn Tome + 1000 | +15 to all stats, 10% less ability cooldown. |
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
| Trader's Tent | 4 on the map | Healing Potion, Mana Potion, Greater Healing Potion, Greater Mana Potion, Scroll of Return, Watcher Ward, Smoke Bomb, Boots of Haste, Iron Claws, Guard Ring, Swift Gloves, Sage Cloak, Giant Belt, Thief Band, Life Pendant, Mana Stone, Focus Crystal, Hourglass Charm, Mana Pearl, Mage Ring, Warding Cloth, Chain Vest, Heart Stone, Iron Buckler, Keen Dagger, Healer's Herbs |
| Temple Market | 1 on the map | Healing Potion, Greater Healing Potion, Greater Mana Potion, Scroll of Return, Watcher Ward, Ironwood Shield, Warblade, Royal Circlet, Archmage Scepter, Titan Aegis, Kingslayer, Sky Piercer, Dawn Relic, Crown of Ages |
| Relic Hall | 2 on the map | Arcane Staff, Arcane Staff II, Timeworn Tome, Sage's Hourglass, Mana Font, Crystal Heart, Bloodletter Axe, Berserker Mail, Warlord Blade, Giant Maul, Bulwark Plate, Bulwark Plate II, Spellward Cloak, Troll Heart, Guardian Shield, Banner of Valor, Healer's Censer, Soul Lantern, Elder Robe, Marksman Bow, Assassin's Blade, Swift Quiver, Windrunner Boots, Sage Treads |
| Wayfarer Inn | 1 on the map |  |
| Cinder Inn | 1 on the map |  |
<!-- /table -->

- Shops are neutral and can not be attacked.
- Buy: right click the item in the shop panel, or click and press the hotkey. Sell: drag an item onto the shop panel.
- The shop panel opens when you click the shop while your hero is within 6 units (it does not open by itself). It closes when the hero walks away. Buying and selling need the hero within 6 units.

## Neutral camps

<!-- table:camps -->
| Camp | Tier | Monsters | Total HP | Gold (avg) | XP | Respawn | Drops | On map |
|---|---|---|---|---|---|---|---|---|
| green_wolves | green | 3× Grey Wolf | 600 | 42 | 75 | 180 s | 25% (green) | 4 |
| green_bandits | green | 2× Bandit, 1× Bandit Archer | 640 | 46 | 90 | 180 s | 25% (green) | 4 |
| orange_harpies | orange | 2× Harpy, 1× Harpy Matron | 1250 | 84 | 205 | 240 s | 60% (orange) | 4 |
| orange_trolls | orange | 2× Forest Troll, 1× Troll Shaman, 1× Alpha Wolf | 1270 | 86 | 200 | 240 s | 60% (orange) | 4 |
| red_ogres | red | 2× Ogre Brute, 1× Ogre Warlord | 3600 | 180 | 420 | 300 s | 100% (red) | 4 |
| green_spiders | green | 2× Rock Spider | 640 | 36 | 80 | 180 s | 25% (green) | 4 |
| orange_wolf_pack | orange | 2× Alpha Wolf, 3× Grey Wolf | 1500 | 92 | 195 | 240 s | 60% (orange) | 4 |
| orange_spider_nest | orange | 1× Spider Queen, 2× Rock Spider | 1540 | 81 | 195 | 240 s | 60% (orange) | 4 |
| red_spider_brood | red | 2× Spider Queen, 3× Rock Spider | 2760 | 144 | 350 | 300 s | 100% (red) | 4 |
| red_sentinels | red | 2× Stone Sentinel, 2× Rock Spider | 3440 | 171 | 380 | 300 s | 100% (temple) | 4 |
<!-- /table -->

Placement (see [MAP.md](MAP.md)) — every sector has the same set of 10 camps (3 green, 4 orange, 3 red), 40 on the map:
- **Green Wolves** — west of the base, on the forest path from the shop road.
- **Green Bandits** — south-east of the base, in the open field.
- **Green Spiders** — in a forest clearing between the field and the road to the natural expansion.
- **Orange Harpies** — on the way from the base to the temple ring.
- **Orange Trolls** — standing on the natural expansion's Town Hall spot. Must be cleared to expand.
- **Orange Wolf Pack** — at the end of a short forest path from the ring road junction near the shop.
- **Orange Spider Nest** — in the north-west forest, at the end of the path past the Green Wolves.
- **Red Ogres** — standing on the corner expansion's Town Hall spot.
- **Red Spider Brood** — in the middle of the Spider Hollow (the wide glade where the lake used to be), on the flank trail.
- **Red Sentinels** — on the temple plateau, next to the ramp. They guard the center but do not block the way to the Temple Market.

Orange camps have a total monster level of 9–10 and red ones 16–17, so a solo bot hero (it takes camps up to 4 + 2 × its level) starts on orange camps at level 3 and on red camps at level 6–7. The two spider camps and the wolf pack have no flyers, so melee heroes can farm them too (they skip the harpies).

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

Unit and monster skills (names and text in `skills.json`, numbers on each unit in `units.json`). Units use active skills by themselves in a fight; skills on allies (Mend, Faith Ward) also work out of a fight. The player can press the active skills of own units (army and hired soldiers): select the unit, click the skill button in the panel, then click a target for one-target skills. Times are in seconds.

<!-- table:unit-skills -->
| Unit | Group | Skill | Target | What it does | Numbers |
|---|---|---|---|---|---|
| Cleric | faction | Mend | one ally | Heals a hurt ally. Works in and after a fight. | heal 20, mana cost 5, cooldown 2, range 5 |
| Cleric | faction | Faith Ward | one ally | A shield of light gives an ally more armor. | range 6, bonus armor 4, duration 12, mana cost 40, cooldown 15 |
| Alpha Wolf | neutral | Pack Howl | around it | Allies nearby deal more damage for a while. | radius 8, damage pct 15, duration 10, cooldown 30 |
| Forest Troll | neutral | Troll Blood | passive | Wounds close fast: more health back every second. | hp regen 2 |
| Troll Shaman | neutral | Mend | one ally | Heals a hurt ally. Works in and after a fight. | heal 25, mana cost 5, cooldown 2, range 5 |
| Troll Shaman | neutral | Hex Bolt | one enemy | A cursed bolt hurts an enemy. | range 6, damage 60, mana cost 30, cooldown 9 |
| Harpy Matron | neutral | Screech | around it | Slows all enemies nearby. | radius 5, slow pct 25, duration 3, cooldown 12 |
| Rock Spider | neutral | Web | one enemy | Roots an enemy: it can not move for a moment. | range 5, root duration 1, cooldown 18 |
| Spider Queen | neutral | Web | one enemy | Roots an enemy: it can not move for a moment. | range 6, root duration 2, cooldown 14 |
| Ogre Warlord | neutral | Rock Slam | around it | Hits the ground: damages and stuns enemies nearby. | radius 3.5, damage 80, stun duration 1.5, cooldown 15 |
| Stone Sentinel | neutral | Stone Guard | passive | Takes less damage from spells. | spell reduction pct 30 |
| Toadfolk Mystic | mercenary | Mend | one ally | Heals a hurt ally. Works in and after a fight. | heal 30, mana cost 5, cooldown 3, range 6 |
| Toadfolk Mystic | mercenary | Bog Curse | one enemy | Swamp mud slows an enemy, and spells hurt it more. | range 6, slow pct 30, bonus spell damage pct 15, duration 5, mana cost 40, cooldown 12 |
| Shellback Beetle | mercenary | Rock Slam | around it | Hits the ground: damages and stuns enemies nearby. | radius 3, damage 60, stun duration 1, cooldown 14 |
| Ember Wisp | mercenary | Ember Flare | around it | The wisp flares up and burns enemies around it. | radius 3, damage 50, cooldown 12 |
| Frost Adept | faction | Chill Burst | around it | A burst of cold slows all enemies nearby. | radius 4, slow pct 25, duration 3, cooldown 12, mana cost 40 |
| Frost Adept | faction | Ice Shard | one enemy | A shard of ice hurts and slows an enemy. | range 7, damage 75, slow pct 30, duration 2, mana cost 35, cooldown 8 |
| Foundry Golem | faction | Stone Guard | passive | Takes less damage from spells. | spell reduction pct 20 |
| Foundry Golem | faction | Rock Slam | around it | Hits the ground: damages and stuns enemies nearby. | radius 2.5, damage 65, stun duration 0.6, cooldown 12 |
| Chainbreaker | faction | Shatter Armor | one enemy | A maul strike reduces the target armor for a short time. | range 2, bonus armor -5, duration 6, cooldown 9 |
| Rune Gunner | faction | Rune Shot | one enemy | Fires a charged rune bolt at the current enemy. | range 7, damage 95, mana cost 25, cooldown 10 |
| Null Warden | faction | Null Screen | around it | Briefly grants nearby allies resistance to spell damage. | radius 5, spell reduction pct 40, duration 5, mana cost 50, cooldown 15 |
| Reliquary Guard | faction | Reliquary Link | one ally | Takes part of the protected ally damage while the guard stays close. | range 5, duration 8, share pct 30, mana cost 35, cooldown 12 |
| Banner Captain | faction | Captain Banner | passive | Nearby allies gain armor. Equal banners do not stack. | radius 6, bonus armor 2 |
| Lantern Novice | faction | Place Lantern | around it | Places one destroyable healing lantern near the novice. It stays in place and expires. | range 6, duration 24, heal threshold 30, cooldown 18, mana cost 45 |
| Veil Sister | faction | Veil Cleanse | one ally | Removes one harmful effect and grants a short spell barrier. | range 6, spell reduction pct 30, duration 5, mana cost 35, cooldown 9 |
| Bulwark Golem | faction | Stone Guard | passive | Takes less damage from spells. | spell reduction pct 20 |
| Bulwark Golem | faction | Bulwark Cover | passive | Nearby ranged troops take less damage from ranged attacks. | radius 4, ranged reduction pct 25 |
| Siege Golem | faction | Demolition Slam | around it | A hammer shockwave damages and briefly stuns nearby ground enemies. | radius 2.5, damage 75, stun duration 0.5, cooldown 14 |
| Boar Lancer | faction | Boar Charge | one enemy | Charges the current ground target. Roots, stuns and blocked terrain stop it. | range 7, min range 3, damage 60, stun duration 0.5, duration 0.5, cooldown 12 |
| Ram Drummer | faction | Drum Rhythm | passive | Nearby allies attack faster. Equal drum auras do not stack. | radius 6, attack speed pct 15 |
| Covered Ram | faction | Arrow Roof | passive | The covered ram takes much less damage from ranged attacks. | ranged reduction pct 75 |
| Bolt Cart | faction | Piercing Bolt | one enemy | A huge bolt pierces a narrow line of ground enemies. | range 9, radius 0.6, damage 85, cooldown 10 |
| Badger Mercenary | mercenary | Bodyguard | one ally | Shares part of a nearby ally damage while the badger stays close. | range 5, share pct 25, duration 8, cooldown 14 |
| Fox Trailshot | mercenary | Trail Mark | one enemy | A marked shot reduces armor and reveals the enemy. | range 7, damage 40, bonus armor -3, duration 6, mana cost 20, cooldown 9 |
| Coalback Porter | mercenary | Coalback Repair | one ally | Repairs a nearby injured allied construct or siege engine. | range 5, heal 80, cooldown 5 |
| Coalback Porter | mercenary | Stone Guard | passive | Takes less damage from spells. | spell reduction pct 15 |
| Kite Bomber | faction | Bomb Run | one enemy | Drops a short line of bombs on ground enemies. Cannot hit air. | range 6, radius 1.1, damage 85, cooldown 11 |
| Healing Lantern | summon | Lantern Light | passive | Nearby allied units regenerate health. Equal lantern auras do not stack. | radius 4, hp regen 7 |
<!-- /table -->

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
