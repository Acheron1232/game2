# Build Plan — 10 Phases

How to use: start a new Claude Code session in this folder and type the short prompt of the phase, for example:

> Do Phase 3.

Claude reads `CLAUDE.md`, `docs/BRIEF.md`, this file and `docs/PROGRESS.md` on its own. You do not need to paste the whole brief.

If you want to add a wish to a phase, just write it after the prompt:

> Do Phase 7. Also make the Blood Witch ultimate look more red.

Each phase has:
- **Goal** — what we get at the end.
- **Tasks** — what to build.
- **Done when** — checks the AI must pass before it says the phase is done.
- **Not in this phase** — so the AI does not run ahead.

| # | Phase | Main result |
|---|---|---|
| 1 | Design and tech spec | All rules, numbers and the map written down |
| 2 | Project skeleton | Repo that builds and runs, empty screens, WebSocket "hello" |
| 3 | 2D art with Codex | Texture atlases, icons, UI art, concept sheets |
| 4 | 3D models and animation | Heroes, units, monsters, buildings, trees as GLB |
| 5 | Client engine and loading | Map on screen, camera, hero moves, lobby preload with progress |
| 6 | Server and multiplayer | Real lobby, server-run match, smooth sync for 4 players |
| 7 | Combat, heroes, camps, items | 8 heroes with kits, camps, drops, shops, inventory |
| 8 | Faction AI and bots | AI bases that build and fight, hero bots, Town Hall upgrades, win/lose |
| 9 | UI, effects, sound, fog | Final HUD, spell effects, sound, fog of war, end screen |
| 10 | Speed, tests, release | Fast load, stable 60 FPS, tests, deploy |

---

## Phase 1 — Design and tech spec

**Prompt:** `Do Phase 1.` (put the map picture in `docs/reference/map.png` first)

**Goal:** a clear design that every later phase follows. No code yet.

**Tasks**
1. Read `docs/BRIEF.md`. List anything unclear or in conflict and ask the user (max 10 short questions, with your suggested answer for each).
2. Write `docs/design/GDD.md` — game rules: match flow, win rules, economy, XP curve, gold rewards, respawn, damage and armor types (simple table like normal / pierce / siege / magic vs light / medium / heavy / fortified / hero), aura and buff rules.
3. Write `docs/design/HEROES.md` — final 8 hero kits: stats per level, every ability with numbers per level, cast range, cooldown, mana, target type. Keep each hero unique and easy to read.
4. Write `docs/design/FACTION.md` — units, buildings, tech tree, costs, build times, and the AI's build order for each difficulty.
5. Write `docs/design/ITEMS_AND_CAMPS.md` — items, shop lists, prices, camp list (place, tier, monsters, gold, XP, drop table), respawn rules.
6. Write `docs/design/MAP.md` from the reference picture: map size, base spots, mines, camps, shops, fountains, ramps, water, cliffs, temple, paths. Also make `shared/data/map-layout.json` with all those points (positions in game units). Give the map our own name.
7. Write `docs/design/TECH.md` — architecture: client / server / shared, tick loop, protocol outline, prediction and interpolation, pathfinding (grid + A* for heroes, flow fields for armies), fog of war, asset pipeline, loading flow, caching, folder structure.
8. Write `docs/design/ART_BIBLE.md` — style rules, palette, team colors (hex), poly and texture budgets, camera angle and zoom, how readable things must be.
9. Write `docs/design/UI.md` — every screen and HUD part with a simple text wireframe, all UI text strings.
10. Put every game number into first-draft JSON tables in `shared/data/` (heroes, abilities, units, buildings, items, camps, upgrades).

**Done when**
- All the docs above exist and do not contradict each other or the brief.
- Every hero has 4 abilities with full numbers for every level.
- The JSON files are valid and match the docs.
- No Blizzard or Valve names are used.
- `docs/PROGRESS.md` lists open questions and decisions.

**Not in this phase:** code, art generation.

---

## Phase 2 — Project skeleton

**Prompt:** `Do Phase 2.`

**Goal:** a repo that installs, builds, runs and tests with one command each.

**Tasks**
1. `git init`, `.gitignore`, pnpm workspace with `client/`, `server/`, `shared/`, `tools/`.
2. TypeScript strict config, ESLint, Prettier, Vitest.
3. Client: Vite + Babylon.js. Engine start picks WebGPU, falls back to WebGL2, shows which one in a debug corner.
4. Screens as simple HTML/CSS (placeholders, but already in the medieval style): Main Menu, Lobby, Loading panel inside the lobby, Game (canvas + empty HUD frame), End screen. A tiny screen router.
5. Bundle the fonts (Cinzel + Alegreya, OFL). Add `docs/CREDITS.md`.
6. Server: Node + `ws`. Lobby server on one port. Health check endpoint. "Ping/pong" with round-trip time shown on the client.
7. `shared/`: protocol folder with a binary writer/reader (`DataView`), message ids, version number. One test that writes and reads a message.
8. Load the JSON data from Phase 1 in `shared/data/` with type checks (zod or hand-written guards) on startup.
9. Scripts: `pnpm dev` (client + server with hot reload), `pnpm build`, `pnpm test`, `pnpm lint`.
10. `README.md` with setup steps. Fill the "Commands" section of `CLAUDE.md`.

**Done when**
- `pnpm install && pnpm build && pnpm test && pnpm lint` all pass.
- `pnpm dev` opens the menu in the browser; you can go Menu → Lobby → Game → End.
- The client shows ping to the server.
- The debug corner says WebGPU or WebGL2.

**Not in this phase:** gameplay, real art.

---

## Phase 3 — 2D art with Codex

**Prompt:** `Do Phase 3.`

**Goal:** all 2D art for the MVP, generated with as few Codex calls as possible, cut and ready for the game.

**Tasks**
1. Make `docs/design/ASSET_LIST.md` — every 2D asset the MVP needs, grouped into **sheets**. Example groups:
   - Terrain tiles (grass ×3, dirt ×2, rough dirt, stone tiles, temple floor, sand, cliff, shore, road) — seamless, top-down.
   - Foliage cards with alpha (grass tufts, flowers, bushes, ferns, leaf clusters for tree crowns).
   - Bark, rock and cliff surfaces.
   - Building materials (wood planks, stone wall, roof tiles, thatch, iron, banners with magenta team parts).
   - Character materials (steel, gold trim, leather, cloth, fur, skin tones, dragon scales, stone skin, wood, glow).
   - Concept sheets: each hero front/side/back (1 hero per half sheet), units, monsters, buildings — used as model references.
   - Icons: 32 abilities, 25 items, 9 upgrades, unit/building portraits, status icons.
   - UI kit: panel frames, buttons (normal / hover / pressed / disabled), bars, slot frames, cursors, minimap frame, tooltip parchment.
   - Effects: fire, smoke, sparks, magic runes, heal glow, blood, dust, water splash (as flipbook strips).
2. Write each sheet's prompt in `tools/art/prompts/<sheet>.md`. Rules for every prompt:
   - strict grid (say rows × columns), thin dark lines between cells, every cell fully filled;
   - same top light, same hand-painted low-res RTS style, no text, no logos, no watermarks;
   - tiles: "seamless tileable, flat top-down, no perspective, no shadows baked in";
   - sprites, cards, icons: background pure green #00FF00;
   - team parts: pure magenta #FF00FF.
3. Show the user the list: number of sheets, cells per sheet, total Codex calls. Wait for OK.
4. Build `tools/art/`:
   - `generate.ts` — calls `codex exec` for one sheet (see `CLAUDE.md`), saves to `art/raw/`, logs it;
   - `slice.ts` — finds the grid, cuts cells, trims, resizes to the target size (power of two);
   - `make-seamless.ts` — fixes tile edges (offset + blend);
   - `key-out.ts` — green → alpha, magenta → team mask (stored in a separate mask channel);
   - `pack-atlas.ts` — packs cells into atlases + a JSON with UV rects;
   - `compress.ts` — PNG → KTX2 (Basis), with a fallback if the tool is missing;
   - `manifest.ts` — writes `client/public/assets/manifest.json` (every file, size, type, group) for the loader.
5. Generate one test sheet. Check it. Fix the prompt. Then generate the rest.
6. Make a simple preview page in the client (`/dev/atlas`) that shows every atlas and every icon.

**Done when**
- Every asset in `ASSET_LIST.md` exists, or the list says why not.
- Tiles tile without visible seams (check in the preview page with a 4×4 repeat).
- Team mask works: the preview page can recolor team parts red / blue / teal / purple.
- `tools/art/generation-log.md` lists every Codex call; the total is shown in `PROGRESS.md`.
- The final 2D asset size (compressed) is written in `PROGRESS.md`.

**Not in this phase:** 3D models, gameplay.

---

## Phase 4 — 3D models and animation

**Prompt:** `Do Phase 4.`

**Goal:** every 3D model for the MVP as GLB, with animations and team color, viewable in a model viewer.

**First, ask the user to pick the model source (explain cost and quality of each):**
- **A. Blender + Python scripts (recommended).** Install Blender (free). Claude writes `bpy` scripts that build each model from shapes, smooth it, UV it onto the palette atlas, rig it and animate it, then export GLB. Fully original. Repeatable: change a script, rebuild.
- **B. Free CC0 model packs as a base** (for example low-poly fantasy character packs with a CC0 license), changed and re-textured with our atlases and team color. Fastest and best looking at first, but less unique. Check every license, write it into `CREDITS.md`.
- **C. Code-only procedural models** in TypeScript (no Blender). Fully original, but the lowest quality of the three.

**Tasks**
1. Model list from Phase 1: 8 heroes, 7 faction units, 7 monster types + boss, 8 buildings (+ tier variants and "under construction" and "destroyed" states), shops, fountains, 4–6 tree types, rocks, props (crates, fences, banners, torches), gold mine.
2. Animations: heroes — idle, walk/run, attack (×2), cast, hit, death, victory; units — idle, walk, attack, death; buildings — simple (flag wave, build progress). Flying units have fly idle and fly move.
3. Team color: magenta areas in the palette atlas → team mask → shader recolor. Every hero and unit has it on shoulders / trim / cape / banner.
4. Use the Phase 3 concept sheets as the reference for shape and color.
5. Export GLB, compress with meshopt (gltf-transform), add LODs for units and trees (LOD1 at ~50% triangles).
6. For mass units: bake animations to vertex animation textures for Babylon's baked animation system.
7. Add the models to the asset manifest.
8. Model viewer page (`/dev/models`): pick a model, play each animation, switch team color, show triangle count and file size.

**Done when**
- Every model loads in the viewer with all its animations and switches team color.
- Every model is inside the triangle budget in `CLAUDE.md`.
- From the RTS camera angle you can tell every hero apart in a screenshot (save one to `docs/screenshots/`).
- Models look smooth and rounded, not like boxes.
- Total model size is written in `PROGRESS.md`.

**Not in this phase:** gameplay logic.

---

## Phase 5 — Client engine and loading

**Prompt:** `Do Phase 5.`

**Goal:** the map on screen, the camera feels like an RTS, the hero moves on click, and all loading happens in the lobby.

**Tasks**
1. **Loader:** reads `manifest.json`, downloads in groups (UI first, then map, then models, sounds), shows progress per group and total, uses parallel downloads with a limit, retries on error, saves files in the Cache API (service worker) so the second visit is fast.
2. **GPU warm-up:** after download, upload all textures, create all materials, and render every material once off-screen so shaders compile before the match. Show "Preparing shaders" in the progress panel.
3. **Terrain:** height map + cliff levels from `map-layout.json`, splat-map blending of terrain tiles, water with a simple animated shader, cliffs and ramps.
4. Place trees, rocks, props with thin instances. Wind sway in the vertex shader.
5. **Camera:** tilted RTS view, edge scroll, arrow keys, middle-mouse drag, small zoom range, smooth easing, stays inside the map.
6. **Hero on map:** right click = move with local A* on the nav grid, smooth turning, walk animation blending.
7. Selection: left click select, selection circle in team color, info in the HUD.
8. Minimap: draw terrain once to a texture, draw units as dots each frame (cheap), click to move camera.
9. Light: one sun, shadow map for heroes and buildings only, soft fog at map edges.
10. Debug overlay: FPS, frame time, draw calls, triangle count, memory (toggle with F3).

**Done when**
- From lobby, loading goes to 100% with correct numbers per group, then the map opens with **no hitch** in the first 30 seconds (check frame times in the debug overlay).
- Second visit loads from cache (check in DevTools network tab).
- 60 FPS on the whole map with all trees and 300 test units (spawn them with a debug key).
- Hero movement looks smooth, no sliding or jitter.

**Not in this phase:** server control of the hero, combat.

---

## Phase 6 — Server and multiplayer

**Prompt:** `Do Phase 6.`

**Goal:** real online matches. The server runs the game; 4 players see the same world, smooth, at normal ping.

**Tasks**
1. **Lobby server:** create game (gets a short code + link), join, leave, kick, slots (Open / Human / Bot / Closed), team, color, hero pick, AI difficulty, ready, chat. Each player sends their load %; everyone sees it. Host can start only when all are 100% and ready.
2. **Match server:** each match in its own worker thread. Fixed 20 Hz tick. Commands from clients go into a queue and run at the next tick.
3. Shared movement code in `shared/` used by server and client.
4. **Snapshots:** each tick send changed entity data only (delta), positions quantized (for example 16-bit), sent only for entities the player can see (simple vision for now, full fog in Phase 9).
5. **Client:** interpolation buffer ~100 ms for other units; prediction for own hero movement with smooth correction when the server disagrees (no snapping).
6. Clock sync and ping display. Lag simulation tool (add 100 ms delay + 2% packet loss in dev) to test.
7. Reconnect: if a player drops, they can come back in 2 minutes and continue. Their hero stands at base meanwhile.
8. Basic cheat safety: check every command (is it your hero, is the target valid, is the cooldown ready), rate limit messages.
9. Load test script: 4 fake clients + bots, measure server tick time and bandwidth.

**Done when**
- 4 browser tabs can make a lobby, pick heroes, load and play; all see the same thing.
- With 100 ms simulated ping the own hero still starts moving at once and does not snap.
- Server tick time stays under 10 ms with 4 players and 300 units.
- Bandwidth per player is under the budget in `CLAUDE.md` (write the numbers in `PROGRESS.md`).
- Closing and reopening a tab rejoins the match.

**Not in this phase:** abilities, AI factions.

---

## Phase 7 — Combat, heroes, camps, items

**Prompt:** `Do Phase 7.`

**Goal:** the hero part of the game is fully playable and fun.

**Tasks**
1. Combat core in `shared/` + server: attack wind-up and back-swing, projectiles, damage and armor types, health/mana regen, buffs/debuffs (stun, slow, root, silence, shields, auras), death and respawn.
2. Ability system: data-driven (target types: none / unit / point / area / passive / aura / toggle), cast range and cast time, cooldowns, mana, levels, indicators on the ground while aiming.
3. All 8 hero kits from `docs/design/HEROES.md`. Sky Dragon uses an air movement layer.
4. Levels 1–10, XP sharing in range, skill points, stat growth.
5. Neutral camps: spawn from map data, idle, aggro, leash back home, respawn timers, gold + XP + item drops from tier tables.
6. Items: inventory (6 slots), passives, actives on hotkeys, drop / pick up / give / sell, stacking potions.
7. Side shops: buy panel when near, stock and prices from data.
8. Fountains.
9. Placeholder effects for every ability (final look in Phase 9), but every ability must be clearly visible.
10. Unit tests for damage math, ability numbers, XP curve, drop tables.

**Done when**
- In a 2-player test, each of the 8 heroes can farm camps, level to 10, use all 4 abilities, buy and use items, die and respawn.
- Ability numbers in game match `HEROES.md` (tested in code).
- No ability can be cast through the server's checks when it should not be (cooldown, mana, range, stun).

**Not in this phase:** the AI factions.

---

## Phase 8 — Faction AI and bots

**Prompt:** `Do Phase 8.`

**Goal:** four living AI bases that build, fight and can win or lose; bots fill empty hero slots.

**Tasks**
1. Faction economy: workers walk to the mine and trees and back, gold and wood income, supply from houses.
2. Building placement on a build grid around the base (pre-planned spots from map data are fine), build progress, repairs.
3. AI brain (runs 2–4 times per second, not every tick): build order per difficulty, tech up, train units, keep a defense group, form armies, scout, choose a target (weakest / closest / where its hero is), retreat when losing, take the expansion when safe.
4. Army movement with flow fields + group formation, units do not stack into one point (simple separation).
5. Unit combat rules and target priority (attack units that attack you, focus low health, catapults hit buildings).
6. Towers and buildings attack.
7. Town Hall upgrades panel for the hero (from `docs/design/FACTION.md`), paid with the hero's gold, used by the AI right away.
8. AI status panel data ("Attacking Blue", "Defending", army size, tier).
9. Hero bots for `Bot` slots (see brief): farm, join attacks, retreat, buy items, use abilities.
10. Win / lose: a team loses when all its Town Halls are gone; its players become spectators. The last team standing wins.
11. Test: run 10 full bot-only matches fast (server headless, no clients, sped-up time) and log length, winner, army sizes. Fix stuck AIs.

**Done when**
- A bot-only 4-team match finishes on its own with a winner in 20–45 game minutes, in most of 10 runs.
- No AI gets stuck (no idle base for more than 60 seconds with resources).
- Buying an upgrade at the Town Hall changes the AI units' stats right away.
- Server tick stays under the budget with 4 full armies.

**Not in this phase:** final visuals.

---

## Phase 9 — UI, effects, sound, fog of war

**Prompt:** `Do Phase 9.`

**Goal:** the game looks and sounds finished.

**Tasks**
1. Final HUD with the Phase 3 UI kit: portrait, bars, abilities with cooldown sweep, items, gold, minimap frame, AI status panel, team panel, kill feed, chat, scoreboard (Tab), tooltips.
2. Settings: graphics quality (low / medium / high: shadows, effects, grass density, resolution scale), sound volume, key binds, quick cast on/off.
3. Fog of war: server vision grid (by unit sight range, blocked by trees and high ground), client renders fog smoothly on terrain and minimap. Server already sends only visible units.
4. Final spell and combat effects (pooled particles, flipbooks), hit flashes, damage numbers, level-up and gold effects.
5. Sound: attack, hit, spells, UI clicks, alerts ("Your base is under attack", "Hero level up"), ambient, music. Sound generation: suggest a way (free libraries with CC0, or a tool) and ask the user.
6. End screen with stats and "Back to lobby".
7. Main menu polish: background scene of the map, animated logo.

**Done when**
- Every HUD part works with real data and matches `docs/design/UI.md`.
- Low graphics setting runs at 60 FPS on a weak laptop.
- Fog of war hides enemies outside vision, on screen and on the minimap.
- All in-game text is simple English and fits its boxes.

---

## Phase 10 — Speed, tests, release

**Prompt:** `Do Phase 10.`

**Goal:** fast, stable, online.

**Tasks**
1. Profile the client (Chrome performance tab, Babylon inspector) and the server. Fix the top 10 slow spots. Write the before/after numbers.
2. Asset size: check every texture and model, compress more where it does not hurt the look, remove unused files. Report final first-download size.
3. Network: measure bandwidth in a full 4-player fight, tune snapshot rate and delta encoding if needed.
4. Memory: check for leaks over a 45-minute match (heap snapshots at 5 and 40 minutes).
5. Tests: unit tests for rules, a full headless bot match in CI, a Playwright test that opens lobby → loads → plays 60 seconds.
6. Test checklist `docs/TEST_CHECKLIST.md` and bug template `docs/BUG_TEMPLATE.md`.
7. Production build: client as static files (CDN, long cache with hashed names), server as a Docker image, HTTPS + WSS, server region notes.
8. Deploy guide `docs/DEPLOY.md` (cheap VPS option first). Ask before deploying anything.

**Done when**
- First load under 100 MB, second load from cache in a few seconds.
- 45-minute full match without crashes, memory leaks or FPS drops.
- All tests pass in CI.
- A friend can open a link and play.
