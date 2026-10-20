# Heroes

8 heroes for the MVP. Data: `shared/data/heroes.json` and `shared/data/abilities.json`.
Ability numbers below are filled from the JSON. "A / B / C" means level 1 / 2 / 3.

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
<!-- /table -->

## Stats at level 1 and 10

<!-- table:hero-stats -->
| Hero | Lvl | Str / Agi / Int | HP | Mana | Armor | Damage | Range | Attacks/s | Speed |
|---|---|---|---|---|---|---|---|---|---|
| **Blood Witch** | 1 | 17 / 14 / 22 | 490 | 264 | 3.1 | 28-34 | 6 | 0.60 | 3 |
|  | 10 | 33 / 24 / 49 | 810 | 588 | 4.6 | 55-61 | 6 | 0.65 | 3 |
| **Staff Warrior** | 1 | 19 / 22 / 14 | 530 | 168 | 5.3 | 27-33 | 1.2 | 0.76 | 3.2 |
|  | 10 | 38 / 45 / 26 | 910 | 312 | 8.8 | 50-56 | 1.2 | 0.91 | 3.2 |
| **Sky Dragon** | 1 | 23 / 14 / 15 | 560 | 180 | 4.1 | 29-35 | 5 | 0.60 | 3 |
|  | 10 | 46 / 27 / 29 | 1020 | 348 | 6.0 | 52-58 | 5 | 0.67 | 3 |
| **Stone Golem** | 1 | 25 / 10 / 13 | 650 | 156 | 4.5 | 32-40 | 1.4 | 0.55 | 2.8 |
|  | 10 | 52 / 19 / 23 | 1190 | 276 | 5.8 | 59-67 | 1.4 | 0.59 | 2.8 |
| **Light Healer** | 1 | 16 / 13 / 21 | 470 | 252 | 3.0 | 25-31 | 6 | 0.59 | 3 |
|  | 10 | 30 / 23 / 48 | 750 | 576 | 4.4 | 52-58 | 6 | 0.65 | 3 |
| **Arcane Huntress** | 1 | 15 / 22 / 17 | 450 | 204 | 4.3 | 26-32 | 7 | 0.76 | 3.1 |
|  | 10 | 29 / 47 / 33 | 730 | 396 | 8.1 | 51-57 | 7 | 0.92 | 3.1 |
| **Centaur Raider** | 1 | 22 / 17 / 14 | 590 | 168 | 4.5 | 28-34 | 1.5 | 0.65 | 3.4 |
|  | 10 | 45 / 33 / 26 | 1050 | 312 | 7.0 | 51-57 | 1.5 | 0.74 | 3.4 |
| **Forest Elf** | 1 | 16 / 20 / 18 | 470 | 216 | 4.0 | 25-31 | 7 | 0.71 | 3.1 |
|  | 10 | 32 / 41 / 36 | 790 | 432 | 7.1 | 46-52 | 7 | 0.83 | 3.1 |
<!-- /table -->

---

## 1. Blood Witch — caster, drain

**How she plays.** Fragile caster who trades her own health for damage, then heals it back. Strong in long fights next to her army: her aura makes allied units heal on hit. Weak if caught alone.
**Good with:** big armies (Crimson Pact), Light Healer. **Weak to:** fast heroes that jump on her (Centaur, Staff Warrior).

<!-- table:abilities-blood_witch -->
**Q — Blood Bolt** (active, target: unit) — Throw a bolt of blood at an enemy. Costs health, not mana.
- range 7; cooldown 8 s; cast time 0.3 s; damage 90 / 150 / 210; health cost 40 / 55 / 70; projectile speed 16

**W — Bleed** (active, target: unit) — Open the enemy's wounds. Deals damage over time and slows.
- range 7; mana 75; cooldown 14 s; cast time 0.3 s; damage per sec 20 / 35 / 50; duration 5; slow pct 20 / 25 / 30

**E — Crimson Pact** (aura) — Aura. Nearby allies heal for part of the attack damage they deal.
- radius 9; life steal pct 8 / 14 / 20

**R — Blood Moon** (active, target: point) — A red moon drains all enemies in an area. The witch heals for half the damage.
- range 8; mana 200; cooldown 120 s; cast time 0.5 s; radius 5; damage per sec 60; duration 5; heal factor 0.5
<!-- /table -->

## 2. Staff Warrior — melee fighter

**How he plays.** Fast melee fighter who dives into enemy groups. Flurry makes him a strong farmer and duelist. Iron Stance lets him survive the first burst.
**Good with:** stuns from allies. **Weak to:** slows and roots (Forest Elf), being kited.

<!-- table:abilities-staff_warrior -->
**Q — Sweep** (active) — Swing the staff in a full circle. Hits and pushes back all enemies around.
- mana 70; cooldown 10 s; cast time 0.25 s; radius 3; damage 70 / 120 / 170; knockback 2

**W — Iron Stance** (active) — Brace yourself. Block most damage for a short time, but move slower.
- mana 60; cooldown 16 s; duration 3; damage block pct 50 / 65 / 80; self slow pct 50

**E — Flurry** (passive) — Passive. Each attack has a chance to hit twice.
- chance pct 15 / 20 / 25

**R — Sky Pillar** (active, target: point) — Leap high on the staff and crash down. Damages and stuns all enemies where you land.
- range 8; mana 150; cooldown 90 s; cast time 0.2 s; leap time 0.6; radius 4; damage 200; stun duration 2
<!-- /table -->

## 3. Sky Dragon — flying ranged bruiser

**How it plays.** Flies over trees, water and cliffs (`lowAir` layer): the best hero for surprise attacks and fast moves between fights. Melee can still hit it. Less base health (−50) is the price for flying.
**Good with:** attacking bases from behind. **Weak to:** archers and towers, focused stuns.

Flying rules: the dragon hovers about 3 units above the ground, has a clear ground shadow and a team-color circle, ignores ground pathing, and can not be body-blocked. It still can not fly over the map border.

<!-- table:abilities-sky_dragon -->
**Q — Fire Breath** (active, target: cone) — Breathe fire in a cone in front of you.
- range 7; mana 80; cooldown 9 s; cast time 0.3 s; length 7; angle deg 45; damage 85 / 145 / 205

**W — Wing Gust** (active) — Beat your wings. Pushes enemies away and slows them.
- mana 70; cooldown 13 s; cast time 0.2 s; radius 4; damage 40 / 70 / 100; knockback 3; slow pct 30; slow duration 2

**E — Dragon Scales** (passive) — Passive. Thick scales give armor and less spell damage taken.
- bonus armor 2 / 4 / 6; spell reduction pct 10 / 15 / 20

**R — Inferno Dive** (active, target: point) — Dive at a point, hit everything there and leave the ground burning.
- range 10; mana 175; cooldown 100 s; cast time 0.2 s; dive time 0.5; radius 4.5; impact damage 120; burn damage per sec 40; burn duration 4
<!-- /table -->

## 4. Stone Golem — tank

**How it plays.** Slow, very tough front line. Starts fights with Boulder Toss, holds enemies with Tremor and Mountain Form so the AI army can hit them.
**Good with:** any damage hero. **Weak to:** magic attacks and kiting.

<!-- table:abilities-stone_golem -->
**Q — Boulder Toss** (active, target: unit) — Throw a big rock at an enemy. Deals damage and stuns.
- range 7; mana 90; cooldown 11 s; cast time 0.4 s; damage 75 / 125 / 175; stun duration 1 / 1.5 / 2; projectile speed 12

**W — Stone Skin** (active) — Harden your body. Take less damage for a while.
- mana 75; cooldown 20 s; duration 8; damage reduction pct 20 / 30 / 40

**E — Tremor** (active) — Slam the ground. Damages and slows enemies around you.
- mana 80; cooldown 12 s; cast time 0.3 s; radius 4.5; damage 30 / 50 / 70; slow pct 30 / 40 / 50; slow duration 3

**R — Mountain Form** (active) — Grow huge. Gain a lot of health and force nearby enemies to attack you.
- mana 150; cooldown 120 s; cast time 0.5 s; duration 15; bonus max hp pct 50; scale 1.4; taunt radius 6; taunt duration 3
<!-- /table -->

## 5. Light Healer — support

**How she plays.** Keeps heroes **and the AI army** alive. Radiant Touch and Sanctuary work on faction units too, so a Healer makes her army win trades. Dawn Shield saves an ally at the last second.
**Good with:** Stone Golem, big pushes. **Weak to:** silence-like burst, being alone.

<!-- table:abilities-light_healer -->
**Q — Radiant Touch** (active, target: unit) — Heal an ally hero or unit, or yourself.
- range 8; mana 70; cooldown 7 s; cast time 0.3 s; heal 120 / 200 / 280

**W — Blessing** (active, target: unit) — Bless an ally. More armor and faster movement for a while.
- range 8; mana 60; cooldown 10 s; cast time 0.2 s; duration 10; bonus armor 4 / 6 / 8; move speed pct 15

**E — Sanctuary** (active, target: point) — Make a circle of light on the ground. Allies inside heal every second.
- range 8; mana 100; cooldown 18 s; cast time 0.4 s; radius 4; heal per sec 15 / 25 / 35; duration 6

**R — Dawn Shield** (active, target: unit) — An ally can not die for a few seconds, then gets a big heal.
- range 8; mana 150; cooldown 100 s; cast time 0.2 s; duration 4; min hp 1; heal at end 300
<!-- /table -->

## 6. Arcane Huntress — ranged magic damage

**How she plays.** Long-range skill shots. Mana Mark sets up her own and allies' spells. Blink saves her or chases. Arcane Storm wipes groups that stay inside it — she must stand still to channel it.
**Good with:** stuns (Golem, Centaur) to land the storm. **Weak to:** divers, she has low health.

<!-- table:abilities-arcane_huntress -->
**Q — Arcane Arrow** (active, target: line) — Shoot a long magic arrow in a line. Hits the first enemy.
- range 12; mana 75; cooldown 9 s; cast time 0.3 s; length 12; width 1; damage 90 / 150 / 210; projectile speed 22; hits first only true

**W — Blink** (active, target: point) — Teleport a short distance.
- range 8 / 10 / 12; mana 50; cooldown 12 / 10 / 8 s; min range 1

**E — Mana Mark** (active, target: unit) — Mark an enemy. It takes more spell damage and can be seen.
- range 8; mana 50; cooldown 10 s; cast time 0.2 s; duration 8; bonus spell damage pct 12 / 18 / 24; reveals true

**R — Arcane Storm** (active, target: point) — Call a storm of magic bolts on an area. You must stand still while it lasts.
- range 10; mana 200; cooldown 120 s; cast time 0.3 s; radius 5; channel time 4; waves 8; damage per wave 40
<!-- /table -->

## 7. Centaur Raider — mobile bruiser

**How he plays.** Fastest hero. Starts fights from far away with Great Charge, stuns with Trample. Herd Call makes the whole army faster — great for pushes and retreats.
**Good with:** armies (aura), Arcane Huntress. **Weak to:** roots, being focused after the charge.

<!-- table:abilities-centaur_raider -->
**Q — Spear Throw** (active, target: line) — Throw a spear in a line. Hits every enemy on its way.
- range 9; mana 80; cooldown 10 s; cast time 0.3 s; length 9; width 1.5; damage 80 / 130 / 180; projectile speed 20; hits first only false

**W — Trample** (active) — Rear up and stomp. Damages and stuns enemies around you.
- mana 90; cooldown 13 s; cast time 0.3 s; radius 3.5; damage 50 / 80 / 110; stun duration 1 / 1.25 / 1.5

**E — Herd Call** (aura) — Aura. Nearby allies move and attack faster.
- radius 9; move speed pct 6 / 9 / 12; attack speed pct 5 / 8 / 11

**R — Great Charge** (active, target: point) — Charge far ahead. Enemies in the way are hit, thrown aside and stunned.
- range 14; mana 150; cooldown 90 s; cast time 0.2 s; charge speed 9; width 2.5; damage 150; side knockback 2.5; stun duration 1
<!-- /table -->

## 8. Forest Elf — ranger, nature

**How she plays.** Steady ranged damage with control. Vine Snare holds one target, Forest Spirit adds bodies to the fight and tanks camps early, Nature's Gift heals the army over time. Wrath of the Grove holds a whole army in place.
**Good with:** anyone. **Weak to:** burst damage on her.

<!-- table:abilities-forest_elf -->
**Q — Vine Snare** (active, target: unit) — Vines grab an enemy. It can not move and takes damage.
- range 8; mana 70; cooldown 12 s; cast time 0.3 s; root duration 1.5 / 2.25 / 3; damage per sec 15

**W — Forest Spirit** (active, target: point) — Wake a tree guardian that fights for you for a while.
- range 4; mana 100; cooldown 30 s; cast time 0.5 s; summon unit tree_guardian; count 1 / 1 / 2; duration 40; summon hp 400 / 600 / 800; summon damage 15 / 25 / 35

**E — Nature's Gift** (aura) — Aura. Nearby allies get health back faster.
- radius 9; bonus hp regen 1.5 / 3 / 4.5

**R — Wrath of the Grove** (active) — Vines burst from the ground all around you. Hit and hold every enemy in a big area.
- mana 200; cooldown 120 s; cast time 0.6 s; radius 10; damage 150; root duration 1.5
<!-- /table -->

---

## Summon

<!-- table:units-summon -->
| Unit | Lvl | HP | Armor | Attack | Damage | Range | Hits | Speed | Cost (g/w) | Supply | Time | From | Needs | Bounty |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Tree Guardian | 2 | 400 | 2 heavy | normal | 15-15 | 1.2 | ground | 2.8 | — | — | — | — | — | 10-10 |
| Watcher Ward | 1 | 60 | 0 unarmored | normal | 0-0 | 0 |  | 0 | — | — | — | — | — | 15-15 |
<!-- /table -->

## Hero bots

Bot heroes use the same kits. Item lists per hero are in `shared/data/ai.json` (`heroBot.heroBuild`). Skill order for bots: ultimate when possible, then the main damage or control ability first, then the others in turn.

## Draft balance — what Phase 7 must test

- Blood Bolt can not kill the witch: if her health is not more than the cost, it can not be cast.
- Iron Stance at level 3 (80% block) must not make the Staff Warrior unkillable in towers. Watch it.
- Sky Dragon flying + Inferno Dive range 10 — check it can not escape everything; if too strong, more cooldown.
- Mountain Form + Stone Skin together (−40% damage, +50% health) — check against towers.
- Arcane Storm 8 × 40 = 320 total damage per target — strongest ultimate on paper, but channeled.
