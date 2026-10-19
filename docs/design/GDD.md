# Game Design Document

Game: **Temple Wars** (working title). Map: **Elder Temple**.
Numbers live in `shared/data/*.json`. Tables in these docs are filled from that data by `node tools/data/fill-doc-tables.mjs`. If a doc and a JSON file disagree, the JSON wins — fix the doc.

Related docs: [HEROES](HEROES.md) · [FACTION](FACTION.md) · [ITEMS_AND_CAMPS](ITEMS_AND_CAMPS.md) · [MAP](MAP.md) · [TECH](TECH.md) · [ART_BIBLE](ART_BIBLE.md) · [UI](UI.md)

---

## 1. Pitch

You are a hero inside a living RTS war. Your own AI faction builds a base and sends armies on its own. You fight next to it, farm monster camps, get gold, items and levels, and spend your gold to make your faction stronger. The last team with a Town Hall wins.

## 2. Core loop

```
farm camps / fight  ──►  gold + XP + items  ──►  stronger hero
        ▲                       │
        │                       ▼
   your AI army  ◄──  Town Hall upgrades for your faction
        │
        ▼
 push enemy bases  ──►  destroy all enemy Town Halls  ──►  win
```

A typical match:
- **0–5 min.** Faction builds its base. Hero farms green camps near home, gets to level 3–4, buys first items.
- **5–15 min.** First AI attacks (about minute 6–8). Hero takes orange camps, joins fights, buys the first Town Hall upgrades. Factions take their natural expansion.
- **15–30 min.** Tier 3 armies, red camps, temple fights. Heroes at level 8–10 with rare items.
- **25–45 min.** Bases fall. Last team with a Town Hall wins.

## 3. Match setup

- 4 slots, one per start spot (north, east, south, west). Start spots are given at random at match start, so nobody picks the "best" spot.
- Each slot = one hero + one AI faction. A slot is `Open`, `Human`, `Bot` (bot hero + AI faction) or `Closed` (nobody).
- The host sets each slot's **team** (1–4). Same team = allies: shared vision, can not hurt each other, can use each other's shops and fountains (everyone can anyway), can **not** buy upgrades for an ally's faction.
- Allowed setups: free for all (4 teams), 2v2, 3v1, 1v1 (2 slots closed).
- Colors: the host or the player picks from Red, Blue, Teal, Purple, Yellow, Orange, Green, Pink. No two slots share a color.
- Each slot has a **faction AI difficulty** (Easy / Normal / Hard). A `Bot` slot also has a **hero bot difficulty** and a hero pick.
- Each human picks a hero. Two players may not pick the same hero. "Random" picks a free one at match start.

## 4. Winning and losing

- A team **loses** when none of its players has a Town Hall (any tier) left.
- The **last team** that still has a Town Hall **wins**.
- Players whose team lost become spectators (see everything, can chat).
- If a human leaves for good, their faction AI keeps playing and the hero stands at base. After the 2-minute reconnect window a hero bot (Normal) takes over the hero.
- No time limit in the MVP. Later we can add "sudden death" after 50 minutes.

## 5. Heroes

- One hero per slot. Levels 1–10. A skill point every level.
- Basic abilities (Q W E) have 3 levels, needing hero level 1 / 3 / 5. The ultimate (R) has 1 level and needs level 6. 10 levels = 10 points = everything learned at level 10.
- Attributes: Strength → health and health regen. Agility → armor and attack speed. Intelligence → mana and mana regen. The **main stat** also adds attack damage.
- Full kits: [HEROES.md](HEROES.md).

| Attribute | Per point |
|---|---|
| Strength | +20 HP, +0.05 HP regen/s |
| Agility | +0.15 armor, +1% attack speed |
| Intelligence | +12 mana, +0.04 mana regen/s |
| Main stat | +1 damage |

Base hero values: 150 HP, 0 mana, 0.25 HP regen, 0.1 mana regen, 6 item slots, sight 16.

## 6. Experience

- Heroes get XP when an enemy or neutral unit dies near them (12 units), even if a faction unit made the kill.
- The XP is split equally between allied heroes in range.
- Heroes of level 6–7 get 70% XP from neutral monsters, level 8+ get 50%. This pushes strong heroes to fight enemies, not only farm.

<!-- table:xp -->
| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Total XP needed | 0 | 200 | 500 | 900 | 1400 | 2000 | 2700 | 3500 | 4400 | 5400 |
| XP for killing a unit of this level | 25 | 40 | 60 | 85 | 115 | 150 | 190 | 235 | 285 | 340 |
| XP for killing a hero of this level | 100 | 150 | 200 | 250 | 300 | 350 | 400 | 450 | 500 | 550 |
| Respawn time (s) | 8 | 11 | 14 | 17 | 20 | 23 | 26 | 29 | 32 | 35 |
<!-- /table -->

## 7. Gold

- The **hero's gold** and the **faction's gold** are separate. The hero never spends faction gold. The faction never spends hero gold.
- Hero income:
  - 250 gold at start;
  - +1 gold every second (passive);
  - bounty for every kill where the hero lands the **last hit** (monsters, enemy units, enemy buildings);
  - allied heroes within 12 units of a kill share 50% of the bounty extra (the killer still gets 100%);
  - enemy hero kill: 150 + 15 × victim level.
- Death: lose 15 × your level gold (never below 0).
- Selling: half of the item value.

## 8. Death and respawn

- Respawn time: 5 + 3 × level seconds (8 s at level 1, 35 s at level 10).
- You come back at your start spot. If your main Town Hall is gone, at the nearest Town Hall you still have.
- Items stay in your inventory. Buffs end.

## 9. Combat

### Attacks
- Each attack has a **wind-up** (35% of the attack cooldown) and then the hit. Moving during the wind-up cancels the attack (classic "attack cancel"). Ranged attacks fire a projectile that flies to the target and always hits.
- Attacking a unit on higher ground from below: 25% chance to miss.
- Melee attacks can not hit units in the `air` layer (Hawk Riders, Harpies). The Sky Dragon flies **low** (`lowAir`): it ignores pathing, but melee can still hit it.

### Armor
Damage taken = damage × type multiplier × armor factor.
Armor factor: each point of armor blocks a bit less than the one before — `reduction = 0.06 × armor / (1 + 0.06 × armor)`. 5 armor = 23% less damage, 10 armor = 38% less.

### Damage types

<!-- table:damage -->
| Attack \ Armor | unarmored | light | medium | heavy | fortified | hero |
|---|---|---|---|---|---|---|
| normal | 100% | 100% | 150% | 100% | 70% | 100% |
| pierce | 150% | 200% | 75% | 90% | 35% | 50% |
| siege | 150% | 100% | 50% | 100% | 150% | 50% |
| magic | 100% | 125% | 75% | 200% | 35% | 50% |
| hero | 100% | 100% | 100% | 100% | 50% | 100% |
<!-- /table -->

Simple meaning: **pierce** (arrows) is good against light units, bad against buildings. **Siege** kills buildings. **Magic** is great against heavy armor. **Hero** attacks are good against everything except buildings.

### Spell damage
Spell damage ignores armor and damage types. Heroes take 75% spell damage. Spells do not hurt buildings unless the ability says so.

### Crowd control
- **Stun**: can not move, attack or cast. **Root**: can not move. **Silence**: can not cast. **Slow**: slower move (and attack if the ability says so). **Knockback**: pushed along the ground, stops at walls. **Taunt**: must attack the taunter.
- The strongest slow counts; slows do not add up.
- The same buff from the same source refreshes its time instead of stacking.

## 10. Neutral camps

- 24 camps on the map in 3 tiers: green (weak, near bases), orange (expansions and side paths), red (corner expansions and the temple).
- Monsters stand still until an enemy comes within 5 units or attacks them. They chase up to 14 units from home, then run back and heal fast.
- When the **whole camp** dies, there is one roll on its drop table. The item drops where the last monster died. Anyone can pick it up.
- A camp comes back after its respawn time, but only when no hero is within 15 units.
- Faction armies also fight camps that block their way or their expansion. The XP still goes to heroes nearby, gold to the last hitter.
- Full lists: [ITEMS_AND_CAMPS.md](ITEMS_AND_CAMPS.md).

## 11. Items and shops

- 6 inventory slots. Drag to move. Right click to use or drop. Items can be given to an allied hero next to you.
- 5 shops: 4 Trader's Tents on the sides and the Temple Market in the center. A hero must be within 6 units to buy or sell.
- Consumables stack in one slot (potions up to 5).
- Some items are drop-only (rare). They can only come from orange and red camps.

## 12. Town Hall upgrades

- When your hero is within 6 units of your **own** Town Hall, the upgrade panel opens.
- Upgrades are paid with hero gold and work right away for the whole faction, even for units that are already alive.
- Some levels need buildings (for example Sharper Blades level 2 needs a Forge and a Stronghold). This ties the hero's help to the faction's progress.
- War Banner and Tier Up Fund can be bought again after a cooldown.
- Full list: [FACTION.md](FACTION.md#town-hall-upgrades).

## 13. Fountains

4 Fountains of Life on the ring road between bases. Standing within 4 units heals 2.5% max health and 2% max mana per second. Works for heroes and faction units of all teams, not for monsters.

## 14. Vision and fog of war

- Each player sees what their units, buildings and their allies' units see.
- Black mask: never seen. Grey fog: seen before (shows terrain and buildings as last seen, no units). Clear: seen now.
- Trees and higher ground block sight. From high ground you see low ground.
- The server sends a player only the units they can see.
- No day / night cycle in the MVP.

## 15. Controls

| Input | Action |
|---|---|
| Right click ground | Move |
| Right click enemy | Attack |
| Right click item on ground | Pick up |
| Left click | Select (any unit to see its info; only your hero takes orders) |
| Q W E R | Abilities (then left click the target; right click or Esc cancels) |
| Ctrl + Q W E R | Learn ability (or click the "+" on the button) |
| 1 – 6 | Use item in slot |
| A + left click | Attack-move |
| S | Stop |
| H | Hold position |
| Space or F1 | Center camera on hero (double press = follow) |
| Arrow keys, screen edge, middle mouse drag | Move camera |
| Mouse wheel | Zoom (small range) |
| Tab | Scoreboard |
| Enter | Chat (Shift+Enter = all chat) |
| F10 / Esc | Menu |
| F11 | Full screen |

Options: quick cast (cast at the cursor at once on key press), item keys Z X C V B N instead of 1–6, edge scroll on/off.

## 16. Match length and pacing targets

| Moment | Target time |
|---|---|
| First AI attack | 6–8 min |
| Natural expansion taken | 8–12 min |
| Tier 3 | 15–18 min |
| Heroes at level 10 | 25–30 min |
| Match end | 25–45 min |

Phase 8 checks these with bot-only matches.

## 17. Balance notes

- The first numbers are a draft. They are set so a level 1 hero can kill a green camp alone with one potion, and a level 5 hero can kill an orange camp.
- Faction armies must matter more than one hero: a full Tier 2 army should beat a level 10 hero alone. The hero wins fights by **joining** their army.
- Everything can be changed in JSON without touching code.
