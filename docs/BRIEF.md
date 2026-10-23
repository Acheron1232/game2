# Game Brief

Working title: **Temple Wars** (change it any time).

A browser game. You open a website, join a lobby, and play a 3D fantasy match in the style of classic early-2000s RTS custom maps. Inspired by Warcraft 3 (the Lost Temple map), Dota and the WoW universe — but with our own art, names and rules.

---

## 1. The big idea

- One map. Four bases. Each base belongs to a **team package**:
  - **one hero**, played by a human (or by a bot if the slot has no human);
  - **one AI faction** — a computer player that builds its own base, trains an army and fights.
- The human controls **only the hero**. The human can **not** give orders to the AI faction.
- The AI faction plays its own RTS game. It is your ally, not your servant.
- The hero helps the team: kills neutral camps, gets gold, items and levels, fights next to the AI army, and buys upgrades for the AI at the Town Hall.
- A team wins when every enemy Town Hall is destroyed.

Why it is fun: you feel like a hero inside a living RTS war. The armies clash on their own, and your choices (what to farm, what to upgrade, where to fight) tip the war.

## 2. Match flow

1. **Main menu** → "Play", "Settings", "Credits". Full screen button.
2. **Lobby.** The host creates a game, others join by code or link.
   - 4 slots. Each slot: `Open` / `Human` / `Bot` / `Closed`.
   - Host sets the **team** of each slot (free for all, 2v2, 3v1, ...) and the **color**.
   - Each human picks a **hero** (or Random).
   - For a `Bot` slot, the host picks the bot hero (or Random) and the difficulty.
   - Host picks the **faction AI difficulty** for each slot: Easy / Normal / Hard.
   - Every player has a **Ready** button.
3. **Loading happens in the lobby.** From the moment you enter the lobby, the game downloads and prepares everything. A progress panel shows:
   - Textures — 34 / 52
   - Models — 12 / 40
   - Sounds — 80 / 120
   - Shaders — preparing...
   - Map — ready
   - Total — 71%
   - Each player sees the others' load % next to their names.
4. The host can press **Start** only when all players are at 100% and Ready.
5. **Match.** About 25–45 minutes.
6. **End screen.** Winner, stats (kills, gold, camps, damage, upgrades bought), "Back to lobby".

## 3. The map

Inspired by the classic 4-player temple map. Put the reference picture in `docs/reference/map.png` — Phase 1 turns it into map data.

- Four main bases, one near each corner.
- Each base has a gold mine and trees close by. Each base has a **natural expansion** (second gold mine) a short walk away.
- A raised **temple plateau** in the center with 4 ramps. Strong (red) neutral camps guard it, and the Temple Market shop stands in the middle.
- Roads between bases, plus narrow paths through the forest.
- Water: only the 4 small temple pools (they block ground units, not flying ones). The first map had a lake in each sector; it became a glade with camps, so there is more room to level up.
- **Neutral camps** in three tiers:
  - Green (weak) — near bases.
  - Orange (medium) — between bases and at expansions.
  - Red (strong) — the temple center and a couple of hidden spots.
- **Side shops** (2–4) between bases, owned by nobody, anyone can buy.
- 4 **Fountains of Life** on the ring road around the temple (heal health and mana over time when you stand close).
- Optional for later: mercenary camp (hire neutral units and send them to your AI), a boss with a rare drop.
- The map is fixed (not random): **Elder Temple**, 192×192 game units, exact 4-way symmetry. Details: `docs/design/MAP.md`.

## 4. Heroes (8 to start)

Every hero has: Strength / Agility / Intelligence, a main stat, health, mana, armor, attack damage, attack range, attack speed, move speed, 3 normal abilities + 1 ultimate, levels 1–15 (ultimate at level 6, its second level at 11), and 6 item slots.

Kits below are the short version. Full numbers: `docs/design/HEROES.md`. All names are ours.

| # | Hero | Role | Attack | Q | W | E | R (ultimate) |
|---|---|---|---|---|---|---|---|
| 1 | **Blood Witch** | Caster, drain | Ranged magic | Blood Bolt — damage, costs some HP instead of mana | Bleed — damage over time + slow | Crimson Pact — aura, allies heal on hit | Blood Moon — big area drain, heals her |
| 2 | **Staff Warrior** | Melee fighter | Melee | Sweep — area hit, short knockback | Iron Stance — blocks damage for a short time | Flurry (passive) — chance to hit twice | Sky Pillar — jumps to a point, stuns all around |
| 3 | **Sky Dragon** | Flying ranged bruiser | Ranged fire | Fire Breath — cone damage | Wing Gust — pushes enemies away | Dragon Scales (passive) — armor | Inferno Dive — dives to a point, burns the ground |
| 4 | **Stone Golem** | Tank | Melee | Boulder Toss — damage + stun | Stone Skin — less damage taken | Tremor — area slow | Mountain Form — grows big, taunts enemies around |
| 5 | **Light Healer** | Support | Ranged magic | Radiant Touch — heal an ally (also AI units) | Blessing — armor + move speed buff | Sanctuary — healing zone | Dawn Shield — ally can't die for a few seconds |
| 6 | **Arcane Huntress** | Ranged magic damage | Ranged magic | Arcane Arrow — long range shot | Blink — short teleport | Mana Mark — marked enemy takes more magic damage | Arcane Storm — rain of bolts in an area |
| 7 | **Centaur Raider** | Mobile bruiser | Melee | Spear Throw — damage line | Trample — area stun around him | Herd Call — aura, allies move faster | Great Charge — long charge, knocks enemies aside |
| 8 | **Forest Elf** | Ranger / nature | Ranged physical | Vine Snare — roots one enemy | Forest Spirit — summons a tree guardian | Nature's Gift — aura, health regen | Wrath of the Grove — vines hit all enemies in a big area |

Rules of thumb:
- Each hero must be easy to tell apart from far away: shape, size, color, weapon.
- The **Sky Dragon** flies: ignores cliffs, water and trees. To be fair it has less health and can be hit by all ranged attacks. It must be visible from far away (shadow on the ground).
- Hero death: respawn at your base after `5 + 3 × level` seconds (tune). Lose a little gold.

### Hero bots
A `Bot` slot gets an AI-controlled hero. It farms camps that fit its level, joins its faction's attacks, retreats on low health, buys items from a simple list, and uses abilities in a sensible way. Easy / Normal / Hard change reaction time and decision quality, not stats.

## 5. AI faction (your ally)

MVP: **one faction** for all four bases ("The Kingdom" — a generic human-like fantasy faction), recolored per team. More factions after MVP.

The faction AI:
- has its own gold and wood, earned by real workers that mine and chop (you see a living base);
- builds in a sensible order (houses for supply, barracks, towers, tech buildings);
- upgrades its Town Hall in tiers (Tier 1 → 2 → 3) to unlock better units;
- trains units and groups them into armies;
- defends when its base is attacked;
- scouts, then attacks the weakest or closest enemy;
- takes its natural expansion when it is safe;
- runs on the server, about 2–4 decisions per second (not every tick).

MVP units: Worker, Swordsman, Archer, Cleric (heals), Lancer (fast heavy rider), Catapult (siege), Hawk Rider (flying, Tier 3).
MVP buildings: Town Hall → Stronghold → Citadel (3 tiers), House (supply), Barracks, Archery Range, Forge, Chapel, Workshop, Watchtower, Hawk Roost (Tier 3). Details: `docs/design/FACTION.md`.

AI difficulty: Easy (slow build, small armies), Normal, Hard (good build order, good timing, focuses weak targets).

## 6. Town Hall upgrades (how the hero helps the AI)

When the hero stands near **its own** Town Hall, a panel opens. The hero spends **their own gold** on upgrades for the AI faction:

- Sharper Blades — melee unit damage (3 levels)
- Better Arrows — ranged unit damage (3 levels)
- Iron Plates — unit armor (3 levels)
- Training Drills — units train faster
- Stone Walls — towers and buildings get more armor and health
- Siege Works — catapult damage vs buildings
- Rich Veins — workers mine faster
- War Banner — next army gets a short damage + speed buff
- Tier Up Fund — gives gold toward the next Town Hall tier

Upgrades show their level and cost. The AI must use them (for example, it trains more knights if the hero bought armor upgrades). The AI does **not** spend the player's gold.

## 7. Neutral camps, gold, experience, items

- Camps are shared by everyone. Monsters stay near their camp and go back if pulled too far.
- Killing camp monsters gives: experience (to heroes near), gold (to the last hitter and a smaller part to near allies), and a chance for a random item from the camp's tier table.
- Camps respawn after some minutes if nobody is near.
- Monster types: Wolves, Bandits, Forest Trolls, Harpies (flying), Rock Spiders, Ogres, Stone Sentinels (temple). A temple boss is a post-MVP idea. Details: `docs/design/ITEMS_AND_CAMPS.md`.
- The AI faction armies also fight camps sometimes (for experience-free clearing of paths), but the hero gets the rewards only if it is near.
- Heroes also get gold and experience for killing enemy units, buildings and heroes.

### Items (first set, ~20 — names are ours)
- Consumables: Healing Potion, Mana Potion, Scroll of Return (teleport home), Ward (vision), Smoke Bomb.
- Basic: Boots of Haste (+move speed), Iron Claws (+damage), Guard Ring (+armor), Swift Gloves (+attack speed), Sage Cloak (+int), Giant Belt (+str), Thief Band (+agi), Life Pendant (+regen).
- Drop-only rare items from orange/red camps: Vampire Fang (lifesteal), Frost Orb (attacks slow), Storm Hammer (chance to chain lightning), Phoenix Feather (revive once), Temple Crown (all stats).
- Items with an active effect use hotkeys.
- 6 slots. Items can be dropped, given to an ally hero, and sold in a shop for half the price.

## 8. Controls

- **Mouse** moves the hero: right click on ground = move, right click on enemy = attack. Left click = select (can select any unit to see its info, but only the hero takes orders).
- Abilities: **Q W E R**. Click the target after pressing the key. Option for "quick cast" (cast at cursor right away).
- Items: **1–6** (option: Z X C V B N).
- **A** + click = attack-move. **S** = stop. **H** = hold.
- Camera: move mouse to screen edge, arrow keys, or middle-mouse drag. Mouse wheel = zoom (in a small range). **Space** or **F1** = center on hero. Double tap = follow hero.
- Minimap click = move camera there. Right click on minimap = move hero there.
- Full screen button in menu and **F11**.
- Learn a skill on level up: Ctrl + Q/W/E/R or click "+".
- All keys can be changed in Settings later.

Movement must feel **instant and smooth**: on click, the hero starts turning and moving at once on the client (prediction), and the server agrees a moment later.

## 9. Visual style

- Looks like a classic early-2000s fantasy RTS: low-poly, colorful, hand-painted textures, strong silhouettes, a slightly tilted top-down camera.
- **Not** blocky. Models are low-poly but smooth and rounded (good silhouettes, soft normals), like RTS models from that time.
- Big readable shapes: heroes are bigger than units, with big shoulder pads, weapons and capes.
- **Team color** on every hero, unit and building: shoulder pads, armor trim, banners, capes, roofs flags. Red, Blue, Teal, Purple (then Yellow, Orange, Green, Pink later). A soft team-color circle under the selected unit.
- Hand-painted textures, low resolution (256–512 px per character), simple materials, no heavy realism.
- Warm sun, soft shadows (one directional light, simple shadow map for heroes and buildings only), slight fog at the edges.
- Terrain: grass, dirt, rough dirt, stone tiles (temple), sand near water, cliffs. Blended with a splat map.
- Trees: a few types (pine, oak, dead tree, bush) with wind sway in the shader.
- Effects: simple and bright (particles + textured quads), easy to read in a fight.

## 10. UI style

- Medieval fantasy: carved dark wood, stone and iron frames, gold trim, parchment tooltips.
- Our own design — familiar feel, not a copy of the Warcraft 3 UI.
- Fonts (free, OFL license, bundled with the game, not loaded from Google at runtime): **Cinzel** or **Cinzel Decorative** for titles, **Alegreya** or **Alegreya Sans** for body text, numbers easy to read.
- In-game HUD:
  - bottom bar: hero portrait, health/mana bars, level and XP, stats, 4 ability buttons with cooldowns, 6 item slots, gold;
  - minimap bottom-left;
  - top bar: game time, gold, team panel (allied heroes and AI status);
  - **AI status panel**: what your AI faction is doing ("Building Barracks", "Attacking Blue", "Defending"), army size, Town Hall tier;
  - floating health bars over units, damage numbers, kill feed, chat;
  - Tab = scoreboard.
- Simple English text everywhere. Short tooltips: name, one line of what it does, numbers.

## 11. Sound (later phase, but plan for it)

Short punchy sounds for attacks, spells, item use, level up, "Your base is under attack", gold coin. Simple fantasy music for menu and match. Original or free-licensed only.

## 12. Tech goals

- Runs in Chrome, Edge, Firefox and Safari on Windows, macOS and Linux. No install.
- WebGPU when the browser has it, WebGL2 otherwise.
- Server authoritative (the server decides everything), 20 ticks per second.
- Client: interpolates other units about 100 ms behind, predicts own hero movement, so it feels smooth even at 80–120 ms ping.
- The server sends only what each player can see (fog of war) — saves bandwidth and stops map hacks.
- Assets are cached in the browser (Cache API / service worker), so the second visit loads almost at once.
- Built so we can add more heroes, items, factions and maps later just by adding data files and assets.

Note on "smooth": smoothness comes from a fixed tick + interpolation + prediction, not from sending as many packets as possible. 20 snapshots per second is the target; more only if tests show we need it.

## 13. MVP — what must be in the first playable version

- Lobby with 4 slots, teams, colors, hero pick, bots, ready, load progress for everyone.
- The full map with bases, camps, shops, fountains.
- 8 heroes with full kits and levels 1–10.
- One AI faction that builds, trains, defends and attacks on its own.
- Hero bots for empty slots.
- Neutral camps with gold, XP and item drops.
- ~20 items, side shops, Town Hall upgrades.
- Fog of war, minimap, HUD, scoreboard, end screen.
- Multiplayer for up to 4 humans over the internet.

## 14. After MVP (ideas)

More factions (undead, orc-like, elves), more heroes, ranked games, accounts and match history, 8-player map, replays, spectator mode, more maps, mercenary camps, day/night cycle, hero skins.
