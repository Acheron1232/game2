# Heroes

14 heroes, including five concept expansion heroes and the requested Earth Spirit kit. Data: `shared/data/heroes.json` and `shared/data/abilities.json`.
Ability numbers below are filled from the JSON. "A / B / C / D" means level 1 / 2 / 3 / 4 of a basic ability; an ultimate has 2 levels ("A / B").

Design rules:
- Every hero has one clear job and one "wow" moment (the ultimate).
- Every hero is readable from far away: shape first, then color, then weapon.
- Every hero has at least one way to help the AI army (aura, heal, stun, push, tank). The game is about fighting **with** your army.
- Abilities are simple to read: one sentence, few numbers.

## Overview

<!-- table:hero-base -->
| Hero | Role | Main stat | Str (+/lvl) | Agi (+/lvl) | Int (+/lvl) | Attack | Moves |
|---|---|---|---|---|---|---|---|
| Blood Witch | Caster, drain | intelligence | 17 (+1.8) | 14 (+1.2) | 22 (+3) | ranged 6 | ground |
| Staff Warrior | Melee fighter | agility | 19 (+2.2) | 22 (+2.6) | 14 (+1.4) | melee | ground |
| Sky Dragon | Flying ranged bruiser | strength | 23 (+2.6) | 14 (+1.5) | 15 (+1.6) | ranged 5 | flying (low air) |
| Stone Golem | Tank | strength | 25 (+3) | 10 (+1) | 13 (+1.2) | melee | ground |
| Light Healer | Support | intelligence | 16 (+1.6) | 13 (+1.2) | 21 (+3) | ranged 6 | ground |
| Arcane Huntress | Ranged magic damage | agility | 15 (+1.6) | 22 (+2.8) | 17 (+1.8) | ranged 7 | ground |
| Centaur Raider | Mobile bruiser | strength | 22 (+2.6) | 17 (+1.8) | 14 (+1.4) | melee | ground |
| Forest Elf | Ranger, nature | agility | 16 (+1.8) | 20 (+2.4) | 18 (+2) | ranged 7 | ground |
| Thorn Marshal | Front, control | strength | 22 (+2.6) | 17 (+1.8) | 14 (+1.4) | melee | ground |
| Grave Bellkeeper | Caster, drain | intelligence | 17 (+1.8) | 14 (+1.2) | 22 (+3) | ranged 6 | ground |
| Tidebreaker | Front, assault | strength | 25 (+3) | 10 (+1) | 13 (+1.2) | melee | ground |
| Lantern Monk | Support, melee | agility | 19 (+2.2) | 22 (+2.6) | 19 (+2.2) | melee | ground |
| Obsidian Heart | Front, volcanic caster | strength | 25 (+3) | 10 (+1) | 18 (+2) | melee | ground |
| Earth Spirit | Stone combos, control | strength | 22 (+3.2) | 17 (+1.7) | 18 (+2.1) | melee | ground |
<!-- /table -->

## Stats at level 1, 10 and 15

<!-- table:hero-stats -->
| Hero | Lvl | Str / Agi / Int | HP | Mana | Armor | Damage | Range | Attacks/s | Speed |
|---|---|---|---|---|---|---|---|---|---|
| **Blood Witch** | 1 | 17 / 14 / 22 | 490 | 264 | 3.1 | 28-34 | 6 | 0.60 | 3 |
|  | 10 | 33 / 24 / 49 | 810 | 588 | 4.6 | 55-61 | 6 | 0.65 | 3 |
|  | 15 | 42 / 30 / 64 | 990 | 768 | 5.5 | 70-76 | 6 | 0.68 | 3 |
| **Staff Warrior** | 1 | 19 / 22 / 14 | 530 | 168 | 5.3 | 27-33 | 1.2 | 0.76 | 3.2 |
|  | 10 | 38 / 45 / 26 | 910 | 312 | 8.8 | 50-56 | 1.2 | 0.91 | 3.2 |
|  | 15 | 49 / 58 / 33 | 1130 | 396 | 10.7 | 63-69 | 1.2 | 0.99 | 3.2 |
| **Sky Dragon** | 1 | 23 / 14 / 15 | 560 | 180 | 4.1 | 29-35 | 5 | 0.60 | 3 |
|  | 10 | 46 / 27 / 29 | 1020 | 348 | 6.0 | 52-58 | 5 | 0.67 | 3 |
|  | 15 | 59 / 35 / 37 | 1280 | 444 | 7.3 | 65-71 | 5 | 0.71 | 3 |
| **Stone Golem** | 1 | 25 / 10 / 13 | 650 | 156 | 4.5 | 32-40 | 1.4 | 0.55 | 2.8 |
|  | 10 | 52 / 19 / 23 | 1190 | 276 | 5.8 | 59-67 | 1.4 | 0.59 | 2.8 |
|  | 15 | 67 / 24 / 29 | 1490 | 348 | 6.6 | 74-82 | 1.4 | 0.62 | 2.8 |
| **Light Healer** | 1 | 16 / 13 / 21 | 470 | 252 | 3.0 | 25-31 | 6 | 0.59 | 3 |
|  | 10 | 30 / 23 / 48 | 750 | 576 | 4.4 | 52-58 | 6 | 0.65 | 3 |
|  | 15 | 38 / 29 / 63 | 910 | 756 | 5.3 | 67-73 | 6 | 0.68 | 3 |
| **Arcane Huntress** | 1 | 15 / 22 / 17 | 450 | 204 | 4.3 | 26-32 | 7 | 0.76 | 3.1 |
|  | 10 | 29 / 47 / 33 | 730 | 396 | 8.1 | 51-57 | 7 | 0.92 | 3.1 |
|  | 15 | 37 / 61 / 42 | 890 | 504 | 10.2 | 65-71 | 7 | 1.01 | 3.1 |
| **Centaur Raider** | 1 | 22 / 17 / 14 | 590 | 168 | 4.5 | 28-34 | 1.5 | 0.65 | 3.4 |
|  | 10 | 45 / 33 / 26 | 1050 | 312 | 7.0 | 51-57 | 1.5 | 0.74 | 3.4 |
|  | 15 | 58 / 42 / 33 | 1310 | 396 | 8.3 | 64-70 | 1.5 | 0.79 | 3.4 |
| **Forest Elf** | 1 | 16 / 20 / 18 | 470 | 216 | 4.0 | 25-31 | 7 | 0.71 | 3.1 |
|  | 10 | 32 / 41 / 36 | 790 | 432 | 7.1 | 46-52 | 7 | 0.83 | 3.1 |
|  | 15 | 41 / 53 / 46 | 970 | 552 | 8.9 | 58-64 | 7 | 0.90 | 3.1 |
| **Thorn Marshal** | 1 | 22 / 17 / 14 | 590 | 168 | 4.5 | 28-34 | 1.6 | 0.65 | 3 |
|  | 10 | 45 / 33 / 26 | 1050 | 312 | 7.0 | 51-57 | 1.6 | 0.74 | 3 |
|  | 15 | 58 / 42 / 33 | 1310 | 396 | 8.3 | 64-70 | 1.6 | 0.79 | 3 |
| **Grave Bellkeeper** | 1 | 17 / 14 / 22 | 530 | 264 | 3.1 | 28-34 | 6 | 0.60 | 3 |
|  | 10 | 33 / 24 / 49 | 850 | 588 | 4.6 | 55-61 | 6 | 0.65 | 3 |
|  | 15 | 42 / 30 / 64 | 1030 | 768 | 5.5 | 70-76 | 6 | 0.68 | 3 |
| **Tidebreaker** | 1 | 25 / 10 / 13 | 650 | 156 | 4.5 | 32-40 | 1.4 | 0.55 | 2.8 |
|  | 10 | 52 / 19 / 23 | 1190 | 276 | 5.8 | 59-67 | 1.4 | 0.59 | 2.8 |
|  | 15 | 67 / 24 / 29 | 1490 | 348 | 6.6 | 74-82 | 1.4 | 0.62 | 2.8 |
| **Lantern Monk** | 1 | 19 / 22 / 19 | 530 | 228 | 5.3 | 27-33 | 1.2 | 0.76 | 3.2 |
|  | 10 | 38 / 45 / 38 | 910 | 456 | 8.8 | 50-56 | 1.2 | 0.91 | 3.2 |
|  | 15 | 49 / 58 / 49 | 1130 | 588 | 10.7 | 63-69 | 1.2 | 0.99 | 3.2 |
| **Obsidian Heart** | 1 | 25 / 10 / 18 | 650 | 216 | 4.5 | 32-40 | 1.4 | 0.55 | 2.8 |
|  | 10 | 52 / 19 / 36 | 1190 | 432 | 5.8 | 59-67 | 1.4 | 0.59 | 2.8 |
|  | 15 | 67 / 24 / 46 | 1490 | 552 | 6.6 | 74-82 | 1.4 | 0.62 | 2.8 |
| **Earth Spirit** | 1 | 22 / 17 / 18 | 630 | 216 | 4.5 | 31-37 | 1.5 | 0.69 | 3.1 |
|  | 10 | 50 / 32 / 36 | 1190 | 432 | 6.8 | 59-65 | 1.5 | 0.78 | 3.1 |
|  | 15 | 66 / 40 / 47 | 1510 | 564 | 8.0 | 75-81 | 1.5 | 0.82 | 3.1 |
<!-- /table -->

---

## 1. Blood Witch — caster, drain

**How she plays.** Fragile caster who trades her own health for damage, then heals it back. Strong in long fights next to her army: her aura makes allied units heal on hit. Weak if caught alone.
**Good with:** big armies (Crimson Pact), Light Healer. **Weak to:** fast heroes that jump on her (Centaur, Staff Warrior).

<!-- table:abilities-blood_witch -->
**Q — Blood Bolt** (active, target: unit) — Throw a bolt of blood at an enemy. Costs health, not mana.
- range 7; cooldown 8 s; cast time 0.3 s; damage 90 / 150 / 210 / 270; health cost 40 / 55 / 70 / 85; projectile speed 16

**W — Bleed** (active, target: unit) — Open the enemy's wounds. Deals damage over time and slows.
- range 7; mana 75; cooldown 14 s; cast time 0.3 s; damage per sec 20 / 35 / 50 / 65; duration 5; slow pct 20 / 25 / 30 / 35

**E — Crimson Pact** (aura) — Aura. Nearby allies heal for part of the attack damage they deal.
- radius 9; life steal pct 8 / 14 / 20 / 26

**R — Blood Moon** (active, target: point) — A red moon drains all enemies in an area. The witch heals for half the damage.
- range 8; mana 200 / 250; cooldown 120 / 95 s; cast time 0.5 s; radius 5; damage per sec 60 / 90; duration 5; heal factor 0.5
<!-- /table -->

## 2. Staff Warrior — melee fighter

**How he plays.** Fast melee fighter who dives into enemy groups. Flurry makes him a strong farmer and duelist. Iron Stance lets him survive the first burst.
**Good with:** stuns from allies. **Weak to:** slows and roots (Forest Elf), being kited.

<!-- table:abilities-staff_warrior -->
**Q — Sweep** (active) — Swing the staff in a full circle. Hits and pushes back all enemies around.
- mana 70; cooldown 10 s; cast time 0.25 s; radius 3; damage 70 / 120 / 170 / 220; knockback 2

**W — Iron Stance** (active) — Brace yourself. Block most damage for a short time, but move slower.
- mana 60; cooldown 16 s; duration 3; damage block pct 50 / 65 / 80 / 90; self slow pct 50

**E — Flurry** (passive) — Passive. Each attack has a chance to hit twice.
- chance pct 15 / 20 / 25 / 30

**R — Sky Pillar** (active, target: point) — Leap high on the staff and crash down. Damages and stuns all enemies where you land.
- range 8; mana 150 / 200; cooldown 90 / 70 s; cast time 0.2 s; leap time 0.6; radius 4; damage 200 / 300; stun duration 2 / 2.5
<!-- /table -->

## 3. Sky Dragon — flying ranged bruiser

**How it plays.** Flies over trees, water and cliffs (`lowAir` layer): the best hero for surprise attacks and fast moves between fights. Melee can still hit it. Less base health (−50) is the price for flying.
**Good with:** attacking bases from behind. **Weak to:** archers and towers, focused stuns.

Flying rules: the dragon hovers about 3 units above the ground, has a clear ground shadow and a team-color circle, ignores ground pathing, and can not be body-blocked. It still can not fly over the map border.

<!-- table:abilities-sky_dragon -->
**Q — Fire Breath** (active, target: cone) — Breathe fire in a cone in front of you.
- range 7; mana 80; cooldown 9 s; cast time 0.3 s; length 7; angle deg 45; damage 85 / 145 / 205 / 265

**W — Wing Gust** (active) — Beat your wings. Pushes enemies away and slows them.
- mana 70; cooldown 13 s; cast time 0.2 s; radius 4; damage 40 / 70 / 100 / 130; knockback 3; slow pct 30; slow duration 2

**E — Dragon Scales** (passive) — Passive. Thick scales give armor and less spell damage taken.
- bonus armor 2 / 4 / 6 / 8; spell reduction pct 10 / 15 / 20 / 25

**R — Inferno Dive** (active, target: point) — Dive at a point, hit everything there and leave the ground burning.
- range 10; mana 175 / 225; cooldown 100 / 80 s; cast time 0.2 s; dive time 0.5; radius 4.5; impact damage 120 / 180; burn damage per sec 40 / 60; burn duration 4
<!-- /table -->

## 4. Stone Golem — tank

**How it plays.** Slow, very tough front line. Starts fights with Boulder Toss, holds enemies with Tremor and Mountain Form so the AI army can hit them.
**Good with:** any damage hero. **Weak to:** magic attacks and kiting.

<!-- table:abilities-stone_golem -->
**Q — Boulder Toss** (active, target: unit) — Throw a big rock at an enemy. Deals damage and stuns.
- range 7; mana 90; cooldown 11 s; cast time 0.4 s; damage 75 / 125 / 175 / 225; stun duration 1 / 1.5 / 2 / 2.5; projectile speed 12

**W — Stone Skin** (active) — Harden your body. Take less damage for a while.
- mana 75; cooldown 20 s; duration 8; damage reduction pct 20 / 30 / 40 / 50

**E — Tremor** (active) — Slam the ground. Damages and slows enemies around you.
- mana 80; cooldown 12 s; cast time 0.3 s; radius 4.5; damage 30 / 50 / 70 / 90; slow pct 30 / 40 / 50 / 60; slow duration 3

**R — Mountain Form** (active) — Grow huge. Gain a lot of health and force nearby enemies to attack you.
- mana 150 / 200; cooldown 120 / 95 s; cast time 0.5 s; duration 15 / 20; bonus max hp pct 50 / 75; scale 1.4; taunt radius 6; taunt duration 3 / 3.5
<!-- /table -->

## 5. Light Healer — support

**How she plays.** Keeps heroes **and the AI army** alive. Radiant Touch and Sanctuary work on faction units too, so a Healer makes her army win trades. Dawn Shield saves an ally at the last second.
**Good with:** Stone Golem, big pushes. **Weak to:** silence-like burst, being alone.

<!-- table:abilities-light_healer -->
**Q — Radiant Touch** (active, target: unit) — Heal an ally hero or unit, or yourself.
- range 8; mana 70; cooldown 7 s; cast time 0.3 s; heal 120 / 200 / 280 / 360

**W — Blessing** (active, target: unit) — Bless an ally. More armor and faster movement for a while.
- range 8; mana 60; cooldown 10 s; cast time 0.2 s; duration 10; bonus armor 4 / 6 / 8 / 10; move speed pct 15

**E — Sanctuary** (active, target: point) — Make a circle of light on the ground. Allies inside heal every second.
- range 8; mana 100; cooldown 18 s; cast time 0.4 s; radius 4; heal per sec 15 / 25 / 35 / 45; duration 6

**R — Dawn Shield** (active, target: unit) — An ally can not die for a few seconds, then gets a big heal.
- range 8; mana 150 / 200; cooldown 100 / 80 s; cast time 0.2 s; duration 4 / 5; min hp 1; heal at end 300 / 450
<!-- /table -->

## 6. Arcane Huntress — ranged magic damage

**How she plays.** Long-range skill shots. Mana Mark sets up her own and allies' spells. Blink saves her or chases. Arcane Storm wipes groups that stay inside it — she must stand still to channel it.
**Good with:** stuns (Golem, Centaur) to land the storm. **Weak to:** divers, she has low health.

<!-- table:abilities-arcane_huntress -->
**Q — Arcane Arrow** (active, target: line) — Shoot a long magic arrow in a line. Hits the first enemy.
- range 12; mana 75; cooldown 9 s; cast time 0.3 s; length 12; width 1; damage 90 / 150 / 210 / 270; projectile speed 22; hits first only true

**W — Blink** (active, target: point) — Teleport a short distance.
- range 8 / 10 / 12 / 14; mana 50; cooldown 12 / 10 / 8 / 6 s; min range 1

**E — Mana Mark** (active, target: unit) — Mark an enemy. It takes more spell damage and can be seen.
- range 8; mana 50; cooldown 10 s; cast time 0.2 s; duration 8; bonus spell damage pct 12 / 18 / 24 / 30; reveals true

**R — Arcane Storm** (active, target: point) — Call a storm of magic bolts on an area. You must stand still while it lasts.
- range 10; mana 200 / 250; cooldown 120 / 95 s; cast time 0.3 s; radius 5; channel time 4; waves 8; damage per wave 40 / 60
<!-- /table -->

## 7. Centaur Raider — mobile bruiser

**How he plays.** Fastest hero. Starts fights from far away with Great Charge, stuns with Trample. Herd Call makes the whole army faster — great for pushes and retreats.
**Good with:** armies (aura), Arcane Huntress. **Weak to:** roots, being focused after the charge.

<!-- table:abilities-centaur_raider -->
**Q — Spear Throw** (active, target: line) — Throw a spear in a line. Hits every enemy on its way.
- range 9; mana 80; cooldown 10 s; cast time 0.3 s; length 9; width 1.5; damage 80 / 130 / 180 / 230; projectile speed 20; hits first only false

**W — Trample** (active) — Rear up and stomp. Damages and stuns enemies around you.
- mana 90; cooldown 13 s; cast time 0.3 s; radius 3.5; damage 50 / 80 / 110 / 140; stun duration 1 / 1.25 / 1.5 / 1.75

**E — Herd Call** (aura) — Aura. Nearby allies move and attack faster.
- radius 9; move speed pct 6 / 9 / 12 / 15; attack speed pct 5 / 8 / 11 / 14

**R — Great Charge** (active, target: point) — Charge far ahead. Enemies in the way are hit, thrown aside and stunned.
- range 14; mana 150 / 200; cooldown 90 / 70 s; cast time 0.2 s; charge speed 9; width 2.5; damage 150 / 225; side knockback 2.5; stun duration 1 / 1.5
<!-- /table -->

## 8. Forest Elf — ranger, nature

**How she plays.** Steady ranged damage with control. Vine Snare holds one target, Forest Spirit adds bodies to the fight and tanks camps early, Nature's Gift heals the army over time. Wrath of the Grove holds a whole army in place.
**Good with:** anyone. **Weak to:** burst damage on her.

<!-- table:abilities-forest_elf -->
**Q — Vine Snare** (active, target: unit) — Vines grab an enemy. It can not move and takes damage.
- range 8; mana 70; cooldown 12 s; cast time 0.3 s; root duration 1.5 / 2.25 / 3 / 3.75; damage per sec 15

**W — Forest Spirit** (active, target: point) — Wake a tree guardian that fights for you for a while.
- range 4; mana 100; cooldown 30 s; cast time 0.5 s; summon unit tree_guardian; count 1 / 1 / 2 / 2; duration 40; summon hp 400 / 600 / 800 / 1000; summon damage 15 / 25 / 35 / 45

**E — Nature's Gift** (aura) — Aura. Nearby allies get health back faster.
- radius 9; bonus hp regen 1.5 / 3 / 4.5 / 6

**R — Wrath of the Grove** (active) — Vines burst from the ground all around you. Hit and hold every enemy in a big area.
- mana 200 / 250; cooldown 120 / 95 s; cast time 0.6 s; radius 10; damage 150 / 225; root duration 1.5 / 2
<!-- /table -->

---

## 9. Thorn Marshal — front, control

An armored stag who holds a line with his spear, bark armor and rooting ultimate.

<!-- table:abilities-thorn_marshal -->
**Q — Briar Lance** (active, target: line) — Send a piercing briar lance through enemies.
- range 9; mana 80; cooldown 10 s; cast time 0.3 s; length 9; width 1.5; damage 75 / 125 / 175 / 225; projectile speed 20; hits first only false; effect spear_throw

**W — Ironbark Mantle** (active) — Bark armor reduces incoming damage.
- mana 75; cooldown 20 s; duration 8; damage reduction pct 20 / 30 / 40 / 50; effect stone_skin

**E — Grove Vigor** (aura) — Aura. Nearby allies heal faster.
- radius 9; bonus hp regen 1.5 / 3 / 4.5 / 6; effect natures_gift

**R — Thorn Dominion** (active) — Thorns strike and root nearby enemies.
- mana 175 / 225; cooldown 100 / 80 s; cast time 0.6 s; radius 10; damage 150 / 225; root duration 1.5 / 2; effect wrath_of_the_grove
<!-- /table -->

## 10. Grave Bellkeeper — caster, drain

A slow bell caster who stuns targets and keeps his army alive through draining attacks.

<!-- table:abilities-grave_bellkeeper -->
**Q — Dread Toll** (active, target: unit) — A spirit bolt damages and stuns an enemy.
- range 7; mana 90; cooldown 11 s; cast time 0.4 s; damage 75 / 125 / 175 / 225; stun duration 1 / 1.5 / 2 / 2.5; projectile speed 12; effect boulder_toss

**W — Mourning Field** (active, target: point) — A spirit field drains enemies and heals the keeper.
- range 8; mana 80 / 100 / 120 / 140; cooldown 20 s; cast time 0.5 s; radius 4; damage per sec 18 / 28 / 38 / 48; duration 4; heal factor 0.5; effect blood_moon

**E — Soul Choir** (aura) — Aura. Allies heal from their attack damage.
- radius 9; life steal pct 8 / 14 / 20 / 26; effect crimson_pact

**R — Last Toll** (active) — Ring the great bell. Damage and stun enemies around you.
- mana 175 / 225; cooldown 100 / 80 s; cast time 0.3 s; radius 7; damage 220 / 330; stun duration 2 / 2.5; effect trample
<!-- /table -->

## 11. Tidebreaker — front, assault

A broad walrus fighter. His anchor and wave open a path for a charge.

<!-- table:abilities-tidebreaker -->
**Q — Anchor Hurl** (active, target: unit) — Throw an anchor to damage and stun an enemy.
- range 7; mana 90; cooldown 11 s; cast time 0.4 s; damage 75 / 125 / 175 / 225; stun duration 1 / 1.5 / 2 / 2.5; projectile speed 12; effect boulder_toss

**W — Breaker Wave** (active, target: cone) — A crashing wave hits enemies in a cone.
- range 7; mana 80; cooldown 9 s; cast time 0.3 s; length 7; angle deg 45; damage 80 / 135 / 190 / 245; effect fire_breath

**E — Deep Hide** (passive) — Passive. Gain armor and resist spell damage.
- bonus armor 2 / 4 / 6 / 8; spell reduction pct 10 / 15 / 20 / 25; effect dragon_scales

**R — Tidal Rush** (active, target: point) — Rush forward, throwing enemies aside.
- range 14; mana 175 / 225; cooldown 100 / 80 s; cast time 0.2 s; charge speed 9; width 2.5; damage 150 / 225; side knockback 2.5; stun duration 1 / 1.5; effect great_charge
<!-- /table -->

## 12. Lantern Monk — support, melee

A red panda monk who heals allies, pushes foes away and leads an army with lantern light.

<!-- table:abilities-lantern_monk -->
**Q — Lantern Mend** (active, target: unit) — Lantern light heals an ally or yourself.
- range 8; mana 70; cooldown 7 s; cast time 0.3 s; heal 110 / 180 / 250 / 320; effect radiant_touch

**W — Bamboo Sweep** (active) — Sweep the staff around you and push enemies away.
- mana 70; cooldown 10 s; cast time 0.25 s; radius 3; damage 70 / 120 / 170 / 220; knockback 2; effect sweep

**E — Guiding Light** (aura) — Aura. Allies move and attack faster.
- radius 9; move speed pct 6 / 9 / 12 / 15; attack speed pct 5 / 8 / 11 / 14; effect herd_call

**R — Lantern Refuge** (active, target: point) — A warm lantern circle heals nearby allies.
- range 8; mana 175 / 225; cooldown 100 / 80 s; cast time 0.4 s; radius 6; heal per sec 55 / 80; duration 8; effect sanctuary
<!-- /table -->

## 13. Obsidian Heart — front, volcanic caster

A floating stone construct with a molten core. It slows enemies and crashes into a molten field.

<!-- table:abilities-obsidian_heart -->
**Q — Magma Shard** (active, target: unit) — A molten shard damages and stuns an enemy.
- range 7; mana 90; cooldown 11 s; cast time 0.4 s; damage 85 / 140 / 195 / 250; stun duration 0.6 / 1 / 1.4 / 1.8; projectile speed 12; effect boulder_toss

**W — Heat Shell** (active) — Harden volcanic plates to reduce damage.
- mana 75; cooldown 20 s; duration 8; damage reduction pct 20 / 30 / 40 / 50; effect stone_skin

**E — Furnace Pulse** (active) — A heat pulse damages and slows nearby enemies.
- mana 80; cooldown 12 s; cast time 0.3 s; radius 4.5; damage 30 / 50 / 70 / 90; slow pct 30 / 40 / 50 / 60; slow duration 3; effect tremor

**R — Caldera Drop** (active, target: point) — Crash into the ground and leave a molten field.
- range 10; mana 175 / 225; cooldown 100 / 80 s; cast time 0.2 s; dive time 0.5; radius 4.5; impact damage 120 / 180; burn damage per sec 40 / 60; burn duration 4; effect inferno_dive
<!-- /table -->

Expansion kits share tested base mechanics through `params.effect`; each has its own numbers, name, owner, cooldown and visual theme. Their balance is a first playable draft.

## Earth Spirit

User-requested Earth Spirit adaptation, with original Blender geometry and a painted atlas based on the supplied concept. Six buttons: Q/W/E/R plus innate Stone Remnant on D and Enchant Remnant on F (free at level 6). Values are adapted to this game’s 15 hero levels: four basic levels and two ultimate levels. No Dota assets are imported. Reference: [Valve hero page](https://www.dota2.com/hero/earthspirit).

<!-- table:abilities-earth_spirit -->
**Q — Boulder Smash** (active, target: point) — Kick a nearby unit or stone toward the chosen point. Stones travel farther, damage and slow enemies they cross. Slows spread through Magnetize.
- range 20; mana 100; cooldown 20 / 16 / 12 / 12 s; cast time 0.1 s; damage 120 / 180 / 240 / 300; slow pct 50; slow duration 2 / 3 / 4 / 5; pick radius 2; stone distance 20; unit distance 6; speed 15; width 1.4

**W — Rolling Boulder** (active, target: point) — Curl into stone and roll in a direction, damaging enemies and stopping to stun the first enemy hero. A stone in the path doubles range and speed and extends the stun.
- range 16; mana 50; cooldown 16 / 12 / 8 / 8 s; cast time 0.6 s; distance 8; stone distance 16; speed 8; stone speed 16; width 1.4; damage 70 / 110 / 150 / 190; strength factor 1; stun duration 0.6 / 0.9 / 1.2 / 1.5; stone stun bonus 0.6

**E — Geomagnetic Grip** (active, target: point) — Pull a stone or allied unit to you. Stones damage and silence enemies along their path. Silences spread through Magnetize.
- range 11; mana 75; cooldown 13 / 11 / 9 / 9 s; cast time 0.1 s; damage 80 / 140 / 200 / 260; silence duration 2 / 2.75 / 3.5 / 4.25; pick radius 1.6; ally range 6; speed 9; ally speed 6; width 1.4

**R — Magnetize** (active) — Magnetize nearby enemies for six seconds. Nearby stones shatter, spreading and refreshing the effect. Boulder Smash slows and Geomagnetic Grip silences spread between magnetized enemies.
- mana 100 / 150; cooldown 100 / 90 s; cast time 0.1 s; radius 3.5; dps 60 / 120; duration 6; refresh radius 4; spread radius 6; stone delay 0.5

**D — Stone Remnant** (active, target: point) — Place an invulnerable stone for your combos. Charges recover over time. Unused charges grant attack damage; using a stone grants a short damage bonus.
- range 11; innate true; charges 7; charge level step 5; recharge sec 18; duration 60; damage per charge pct 3; used damage pct 7.5; used duration 10

**F — Enchant Remnant** (active, target: unit) — Turn a unit into an invulnerable stone for 2.4 seconds. Kick or pull it before it shatters, releasing the unit and damaging nearby enemies. Also enchants a stone. Free unlock at hero level 6.
- range 5; mana 150; cooldown 45 s; cast time 0.1 s; innate true; unlock level 6; enemy range 1.75; duration 2.4; damage 450; radius 4.5; stone cooldown 5
<!-- /table -->

## Summon

<!-- table:units-summon -->
| Unit | Lvl | HP | Armor | Attack | Damage | Range | Hits | Speed | Cost (g/w) | Supply | Time | From | Needs | Bounty |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tree Guardian | 2 | 400 | 2 heavy | normal | 15-15 | 1.2 | ground | 2.8 | — | — | — | — | — | 10-10 |
| Watcher Ward | 1 | 60 | 0 unarmored | normal | 0-0 | 0 |  | 0 | — | — | — | — | — | 15-15 |
| Healing Lantern | 1 | 140 | 0 light | magic | 0-0 | 0 | ground | 0 | — | — | — | — | — | 0-0 |
| Stone Remnant | 1 | 1 | 0 fortified | magic | 0-0 | 0 | ground | 0 | — | — | — | — | — | 0-0 |
<!-- /table -->

## Hero bots

Bot heroes use the same kits. Item lists per hero are in `shared/data/ai.json` (`heroBot.heroBuild`). Skill order for bots: ultimate when possible, then the main damage or control ability first, then the others in turn.

## Draft balance — what Phase 7 must test

- Blood Bolt can not kill the witch: if her health is not more than the cost, it can not be cast.
- Iron Stance at level 3 (80% block) must not make the Staff Warrior unkillable in towers. Watch it.
- Sky Dragon flying + Inferno Dive range 10 — check it can not escape everything; if too strong, more cooldown.
- Mountain Form + Stone Skin together (−40% damage, +50% health) — check against towers.
- Arcane Storm 8 × 40 = 320 total damage per target — strongest ultimate on paper, but channeled.
