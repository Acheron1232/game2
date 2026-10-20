# Progress

The AI updates this file at the end of every phase. Newest notes go on top of each section.

## Current state

- **Phase 5 map rework finished** (2026-10-20), user feedback "map is small, flat, empty": map 256 × 256 with hills, a watch hill, a lake dip and a mountain wall at the edge (plus 64 units of mountains with pines outside the map). 7,451 trees and 6,735 decor items (plants, rocks, stumps, ruins, fences, crates), all drawn as thin instances in 48-unit chunks. New temple plaza ruins: pillar gates at the ramp tops, a pillar ring around the market, statues on the diagonals, blocks around the pools. Fight zones and tactics written in [design/MAP.md](design/MAP.md#fight-zones-and-tactics), with measured walk times. Checked in the browser: WebGPU 120 FPS, 115–121 draws, 203–263k tris; WebGL2 120 FPS, GPU 4.0 ms, 118 draws. Build, lint, data check and 36 tests pass.
- **Terrain and lighting pass** (2026-10-19), branch `codex/terrain-lighting-polish`: checkpointed the existing working tree, generated six quieter ground textures in one ImageGen call, softened transitions and adjusted sun/sky colors. Terrain sampling now merges duplicate layers instead of reading the same tile four times. 120 FPS and native resolution retained; no added geometry, draw calls or render passes. Both WebGL2 and WebGPU checked. See [TERRAIN_POLISH.md](TERRAIN_POLISH.md) for assets, measured readings and tradeoffs.
- **Display preference restored** (2026-10-19): the user wants 120 FPS in game and a sharp hero. Removed the 1080p/1.5-DPR drawing-buffer limits and restored native display resolution. Menus remain at 30 FPS; background rendering still stops. Earlier 60 FPS energy measurements below are historical and do not describe the current configuration.
- **Input and energy pass** (2026-10-19): fixed north/south edge scrolling over HUD panels; game/menu caps are 60/30 FPS, background rendering is off, and Retina rendering has a 1080p pixel budget. Removed duplicate MSAA and full-screen bloom, focused a smaller shadow map near the camera, and toned down yellow grading/vignette. Added GPU time and resolution to F3. 36 tests pass, including camera input and render-budget tests. A short whole-system GPU sample fell from 75% to 57% median; this is not a temperature or fan guarantee. Details in [CLIENT_AUDIT.md](CLIENT_AUDIT.md).
- **Client audit and polish** (2026-10-19): current working map is 256 × 256, with 7,451 baked trees, 6,679 decor objects and 58 model entries. These additions follow the original Phase 5 snapshot below. Fixed HUD clipping, minimap sizing, camera bounds, per-frame allocations, shader warm-up error handling and blocked-corner navigation. WebGPU and WebGL2 checked in the browser; build, typecheck, 30 tests and lint passed. See [CLIENT_AUDIT.md](CLIENT_AUDIT.md) for sampled performance numbers, limits and remaining visual work. Earlier Phase 5 numbers below describe the earlier map.
- **Phase 5 is done** (2026-10-19). Next: **Phase 6 — Server and multiplayer**.
- Notes for Phase 6:
  - The hero moves on the client with `shared/src/nav/nav-grid.ts` (A*) and `shared/src/sim/movement.ts`. Phase 6 runs the same code on the server; the client keeps it for prediction.
  - `GameWorld` (`client/src/render/world.ts`) is the scene: `spawnHero`, `moveHero`, `pickGround`, units list. Game coordinates: x east, y north; world: x, height, -y (right-handed scene).
  - The lobby is still the Phase 2 placeholder; `?play` opens the game screen right after loading, `?hero=<id>` picks the hero.
- The user gave a server for deploys (details kept outside the repo). Use it in Phase 10, or earlier for online tests after Phase 6. Ask before changing anything on it.

## Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Design and tech spec | **Done** | 8 design docs, 11 JSON data files, map data + preview |
| 2 | Project skeleton | **Done** | pnpm monorepo, Babylon client with WebGPU/WebGL2, ws server, binary protocol, typed data, 17 tests |
| 3 | 2D art with Codex | **Done** | 7 Codex images → 340 assets, 2.7 MB WebP; UI skin in menu / lobby |
| 4 | 3D models and animation | **Done** | 48 models (8 heroes, 8 units, 13 monsters, 14 buildings, 5 nature) with Codex skins, 11 MB |
| 5 | Client engine and loading | **Done** | 256 map with hills and mountain wall, blended tiles, 7,451 trees + 6,735 decor in chunks, RTS camera, click-to-move hero, minimap, lobby preload + cache, 120 FPS |
| 6 | Server and multiplayer | Not started | |
| 7 | Combat, heroes, camps, items | Not started | |
| 8 | Faction AI and bots | Not started | |
| 9 | UI, effects, sound, fog | Not started | |
| 10 | Speed, tests, release | Not started | |

## Phase 5 — what was made

- **Loading** (`client/src/loader/`): reads `assets/manifest.json`, downloads everything during the lobby into blob URLs with byte progress per group (Interface, Map, Units, Heroes, Effects, Shaders), 6 parallel downloads, retries; `public/sw.js` keeps assets in the Cache API (hashed URLs). After download: all models load into containers and every model x team material is compiled (`ModelLibrary.warmUp`) before the bar reaches 100%.
- **Terrain** (`render/terrain.ts`): 36 chunks of a 1-unit height mesh from the baked grid (temple 2.2 units high, cliffs, lake beds), a material plugin (GLSL + WGSL) that blends the 4 nearest cells' tiles from a texture array of the Phase 3 ground tiles, painted shade under forests, animated water discs for lakes and temple pools.
- **World** (`render/world.ts`): right-handed scene, sun + sky light, PCF shadows (hero and buildings), fog at the edges, 2,755 trees as thin instances (4 draw calls), town halls in 4 team colors, gold mines, shops, fountains; buildings block the nav grid.
- **RTS camera** (`render/rts-camera.ts`): 48 degrees down, smooth edge scroll, arrow keys, middle-mouse drag, small wheel zoom, clamped to the map; Space = center on hero, double Space = follow.
- **Hero**: right click on the ground -> A* path (`shared/src/nav/nav-grid.ts`) -> walk with turning (`shared/src/sim/movement.ts`), idle / walk animations with blending, team selection ring, hero effects.
- **Minimap** (`ui/minimap.ts`): terrain drawn once, town halls, mines, shops, hero dot, camera box; left click moves the camera, right click moves the hero.
- **Debug corner** (F3): renderer, FPS, frame ms, draw calls, triangles, ping. F4 = 300-unit stress test.
- Fixes found on the way: quantized GLBs keep their scale on the mesh node (must be baked into thin-instance matrices); instantiated clips are renamed (`id:walk`).

How it was checked (browser, WebGPU and `?webgl` WebGL2): menu shows the real map; lobby loading reaches 100% per group (Interface 161, Map 36, Units 110, Heroes 32, Effects 2, Shaders); game opens on the hero; right click walks with the walk animation; minimap draws; **120 FPS, ~1.5 ms frame, 43 draw calls, 610k triangles**; with 300 extra animated swordsmen **120 FPS, 2.0 ms, 44 draws, 792k triangles** (shared animation instances); 277 files in the Cache API after the first visit, service worker active. Tests: 29 pass (3 new nav / movement tests: every spawn reaches every other spawn and the market). No console errors from the new code.
Not checked: a real weak laptop (the dev machine is an M5, 120 Hz cap); Firefox / Safari; the "no hitch in the first 30 seconds" was checked by eye and frame time only.
Not done: wind sway on trees, small props (rocks, fences, ruins), LODs (Phase 10).

## Phase 4b — what was made (user feedback: classic RTS hero look, better hands and weapon grip, light effects)

- Style from the user's reference (a classic RTS hero model): angular faceted shapes, heroic hunched pose, huge shoulders and hands, team bands everywhere.
- `tools/models/blender/chunky.py`: shared body kit — torso, faceted head, arms with deltoid / elbow / bracer / team band, closed fist around a grip point (weapons pass through the fist), open spell hand with fingers, legs with knee knob and big feet, belt, loincloth, spiked shoulder pads, beads, cape.
- `humanoid.py`: elbow bend (arms ready to hold weapons). `rigs.py`: four-legged rig (wolves, horses) and clips.
- **Animation direction fix** (user: "he hits backward"): all X rotations are flipped in one place (`kit.Model.action`); checked with a test rig and the side-view attack render (the swing now goes forward).
- 8 heroes rebuilt, each with its own 20-cell Codex skin: Staff Warrior, Blood Witch (open horned hood), Sky Dragon (redone: heavy chest, S-neck, horned head with a fire mouth, big wings with sagging membranes, spiked tail), Stone Golem (+ a carved stone head with glowing eyes and a crystal horn, user asked), Light Healer (sun halo), Arcane Huntress (light bow), Centaur Raider (redone: real horse barrel, haunches, hocks, flowing tail), Forest Elf (antlers, leaf cloak).
- Hero effects (user liked the staff ring sparks): 3-5 small particle emitters per hero on bone sockets + a slow glow pulse (`client/src/render/hero-effects.ts`).
- Units (8): swordsman, archer, cleric, worker, lancer (knight on a horse), hawk rider, catapult, tree guardian. Monsters (13): grey / alpha wolf, bandit / bandit archer, forest troll / troll shaman, harpy / matron, rock spider / spider queen, ogre brute / warlord, stone sentinel. Buildings (14): town hall, stronghold, citadel, house, barracks, archery range, forge, chapel, workshop, hawk roost, watchtower, trader's tent, temple market, fountain. Units / monsters / buildings use compact 8-cells-per-model skins (2 models per Codex image).
- `client/public/assets/models/models.json`: model index (skin, height, triangles, sockets, clips).
- Codex calls in Phase 4: 8 hero skins + 11 unit / monster / building skins (+1 first Staff Warrior test). Rate limits (429) happened; the batch script waits and retries.

How it was checked: every model built in Blender with a preview (RTS / front / side / attack / walk / death) and looked at; viewer (WebGPU) loads heroes, units and buildings with their atlases and team colors, effects run on sockets, no console errors; `pnpm build`, `pnpm lint`, `pnpm test` (26) pass. Total models + skins: **11 MB**.

Not done (moved to Phase 10): LOD meshes, baked vertex animation for mass units, meshopt compression. Known weak spots: hawk body is thin, lancer horse head is simple, some building walls repeat their texture.

## Phase 4a — what was made

- `tools/models/blender/kit.py`: build models from rounded parts (sphere, cylinder, cone, rounded box, lathe profile, torus), lay a texture slot on each part (`box`, `front` + `back`, `wrap`, `top`, shared `frame`, `sub` area), painted light in vertex colors (top lighter, feet darker), rigid binding to bones, join into one mesh (one draw call), GLB export with all clips.
- `tools/models/blender/humanoid.py`: 20-bone humanoid rig with proportions, clips `idle, walk, attack, attack2, cast, hit, death, victory` in 3 styles (melee, caster, ranged).
- Models: `staff_warrior` (own painted skin, 2,076 tris), `blood_witch` (palette version, 1,816 tris), `tree_pine` 96, `tree_oak` 360, `tree_dead` 88, `bush` 192, `gold_mine` 796 tris.
- `tools/models/build-palette.ts`: shared palette atlas (43 slots of 128 px) + team mask for models without their own skin.
- Model skins: new sheet kind `skin` → 1024² atlas (4×4 × 256 px) + team mask + red-team preview for Blender. First sheet: `skin_staff_warrior` (1 Codex image).
- `tools/models/build.ts`: runs Blender, removes the embedded texture (the game sets textures itself), converts vertex colors to sRGB (our material is gamma space), dedup + prune + KHR_mesh_quantization, checks UVs / colors / clips, updates the manifest.
- `client/src/render/team-material.ts`: StandardMaterial + team-color plugin (GLSL and WGSL), glow material, loaders for palette or own skin. `client/dev/models.html` viewer: model list, clips, 4 team colors, RTS / front / side camera, triangles and file size.

How it was checked: every model built in Blender and rendered (RTS, front, side, attack, walk, death) to `art/source/models/<id>.png`; in the browser viewer (WebGPU) Staff Warrior loads with its own skin, all 8 clips play, team color switches red → blue. Sizes: hero ~200 KB (8 clips), trees 5–18 KB.
Known issues: a seam where the belly and chest parts meet; the viewer light is a bit darker than the Blender preview; Blood Witch still uses the plain palette (gets her skin in 4b).

## Phase 3b — what was made

- 6 dense sheets generated (user's wish: many small pictures per image): `textures` 8×8, `sprites` 8×8, `icons` 9×8, `portraits_effects` 8×8, `heroes_concept` 6×4, `world_concept` 6×6. Every sheet came back with the exact grid asked for.
- Shipped: 32 terrain tiles + 32 materials (128 px, seamless), 36 more UI pieces + cursors, foliage atlas (28 cards), 72 icons (abilities, commands, items, upgrades), 24 portraits, effects atlas (10 effects × 4 frames). Team masks for team cloth / armor, flag, selection ring, war banner icon, unit portraits.
- Model references (not shipped): 24 hero views + 36 units / monsters / buildings in `art/source/`.
- Tool fixes found on the way: grid lines are found by contrast (dark portraits and black effect cells no longer confuse it); line leftovers at cell borders are removed; when Codex returns a transparent background, opaque green things (arrow, check mark, leaves) are kept; flat backdrops are removed by their sampled color (green leaves on a green backdrop stay); magenta is found by hue (dark folds count too).

How it was checked:
- Every sheet's `_contact.png` reviewed by eye after cutting; all earlier sheets re-cut and re-checked after each tool fix.
- `/dev/atlas.html`: 146 images, 0 broken; tiles shown 4×4 without visible seams; team-mask images recolor in 4 team colors.
- `pnpm build`, `pnpm lint`, `pnpm test` (26 tests) pass.
- Sizes: all shipped 2D art **2.7 MB** (WebP), raw Codex images 19 MB in `art/raw/`.
Done-when list: every asset in `ASSET_LIST.md` exists ✔; tiles tile without visible seams ✔ (4×4 preview; seam score down 2–10×); team mask recolors ✔; every call logged in `tools/art/generation-log.md` ✔ (7 images); size written here ✔.
Not perfect: soft smoke over green backdrops keeps a green tint in two concept pictures (reference only); the hover button glow from Codex is green, so CSS makes the gold glow.

## Phase 3a — what was made

- `tools/art/`: `sheets.json` (17 sheets, ~330 cells), `prompts/` (shared `_style.md` + one prompt per sheet; hero prompts pull looks from `heroes.json`), `generate.ts` (Codex call + log), `process.ts` (grid finding, green / transparent background, magenta → grey + alpha team mask, seamless tiles, atlases, contact sheet), `manifest.ts` (`client/public/assets/manifest.json` with sizes, hashes, load groups), `lib/pixels.ts`.
- `docs/design/ASSET_LIST.md` — all sheets, what is in them, where files go.
- `ui_kit_a` generated (1 Codex image, 66 s) and cut into 16 UI images, ~280 KB WebP in `client/src/assets/ui/`.
- `client/src/ui-skin.css`: wood panels in carved gold frames, gold corner ornaments, painted wooden buttons (pressed state, gold glow on hover), stone inset panels, parchment fields, framed loading bar, crest + divider on menu and end screen, red and blue team banners (tinted by the team mask), iron HUD top bar, framed ability / item slots, gauntlet cursor.
- UI images now load in the lobby "Interface" group (18 files).
- `/dev/atlas.html` preview page: every image, tiles shown 4×4, team-mask images shown in 4 team colors.
- 5 new tests for the art tools (22 tests in total).

How it was checked: `pnpm build`, `pnpm test` (22 pass), `pnpm lint` all pass. Menu, lobby and the atlas page checked in the browser at 1280 × 800 (WebGPU, 120 FPS, no console errors). Tile seams after the fix: 16 → 7, 20 → 8, 15 → 5, 17 → 6 (average edge difference, 0–255).
Not checked yet: Firefox / Safari (CSS `mask` on the banners needs a recent browser), the final look of the hover glow (Codex painted it green; we use a CSS gold glow instead).

## Phase 2 — what was made

- pnpm workspace: `shared/`, `server/`, `client/`, `tools/`. TypeScript 6.0 strict, ESLint 10 + typescript-eslint, Prettier, Vitest 5. `git init` done (branch `main`).
- `shared/`: binary writer/reader + ping/pong messages + lobby JSON messages (`src/protocol/`), zod schemas and loaders for every data file + cross-file checks (`src/data/`), terrain file reader (`src/map/terrain.ts`). Lint rule: no Node imports in `shared/src`.
- `server/`: HTTP `/health` + WebSocket `/ws` on one port, hello with protocol version check, binary ping → pong, rate limit (60 msg/s), heartbeat, refuses to start if game data is broken. Built with esbuild to `server/dist/main.js`.
- `client/`: Vite + Babylon 9.29. WebGPU first, WebGL2 fallback (`?webgl` forces it). Screens in CSS medieval style with bundled Cinzel + Alegreya Sans: Main Menu, Lobby (placeholder slots + **real** loading panel: Interface, Map, Shaders), Game (HUD frame), End. Menu background is a 3D view of the baked map with 2,755 trees as thin instances (one draw call). Socket with auto-reconnect and smoothed ping. Debug corner (F3).
- Map rework (user asked "the map looks like shapes"): `tools/map/bake-terrain.mjs` bakes the layout into a real terrain grid with natural edges, 2,755 trees and a new `docs/design/map-preview.png`.
- `tools/data/check-data.mjs` was replaced by `pnpm data:check` (the TypeScript checks in `shared/`).
- `README.md`, `docs/CREDITS.md`, "Commands" in `CLAUDE.md`, `.claude/launch.json` for the browser preview.

How it was checked:
- `pnpm install && pnpm build && pnpm test && pnpm lint` — all pass. Tests: 13 in shared (protocol round trips, data shapes and links, banned names, map symmetry, key points on open ground, trees on forest), 4 in server (health, hello → welcome, ping → pong, old protocol and early binary are refused).
- `node server/dist/main.js` starts and `/health` answers.
- In the browser (`pnpm dev`): Menu → Lobby → Ready → Start Game → Game → End Match → Back to Lobby → Leave all work. Debug corner shows "WebGPU · FPS 120 · Ping 1 ms" and with `?webgl` "WebGL2 · FPS 120 · Ping 3 ms". Lobby loading panel reaches 100% and the Start button unlocks only when loaded and ready.
- Not checked: Firefox and Safari (only the built-in Chromium browser was used); the HUD below 1280 px wide (the bottom bar overflows at 700 px; the UI target is 1280 × 720 and up); a real low-end laptop.

## Phase 1 — what was made

- `docs/design/`: GDD, HEROES, FACTION, ITEMS_AND_CAMPS, MAP (+ `map-preview.png`), TECH, ART_BIBLE, UI.
- `shared/data/`: rules, heroes, abilities, units, buildings, items, shops, camps, upgrades, ai, map-layout.
- `tools/map/make-map-layout.mjs` — builds the map layout from one sector (4-way symmetry).
- `tools/map/bake-terrain.mjs` — bakes the layout into the terrain grid, the trees and `docs/design/map-preview.png`.
- `tools/data/check-data.mjs` — checks JSON and links between files, and bans Blizzard/Valve names. `--stats` prints hero stats.
- `tools/data/fill-doc-tables.mjs` — fills the number tables in the design docs from the JSON.
- How it was checked: `node tools/data/check-data.mjs` passes (8 heroes, 32 abilities, 21 units, 11 buildings, 23 items, 6 camp types, 9 upgrades, 24 camps on the map). The baked map is exactly symmetric (0 different cells) and every start, mine, camp, shop and fountain stands on open ground. The map preview was rendered and compared with `docs/reference/map.png` by eye.
- Not checked: balance. All numbers are a first draft until Phase 7 and 8 tests.

## Decisions

- 2026-10-20 — Map size 256 × 256 (was 192). The layout is still written on the 192 grid and scaled by 4/3, so all old positions keep their shape. Walk times in MAP.md; keep their order when changing the layout.
- 2026-10-20 — Map edge = mountain wall (8 units, blocked) + mountains drawn outside the map. No black edge, the camera stays inside.
- 2026-10-20 — Decor never blocks movement and is not part of the nav grid; it is looks only. Hand-placed decor (base props, temple ruins) lives in `bake-terrain.mjs`.
- 2026-10-20 — Trees and decor: thin instances split into 48-unit chunks, so the camera skips what it can not see (2M → ~260k drawn tris, ~20 more draw calls).
- 2026-10-20 — High ground rules (sight, miss chance from below) are a Phase 7 decision; the map already has the watch hill and temple for it.
- 2026-10-19 — Models: Blender 5.2 + Python scripts (user's choice). Rigid binding (one bone per part), like classic RTS models.
- 2026-10-19 — Heroes (and later units) get their own Codex-painted texture sheet; the shared palette stays for trees, rocks and props.
- 2026-10-19 — GLB compression: KHR_mesh_quantization only (no decoder needed in the browser). Meshopt later with a bundled decoder (the default Babylon decoder loads from a CDN).
- 2026-10-19 — Vertex colors in our GLBs are stored as sRGB (not linear as glTF says), because the game material is Babylon StandardMaterial (gamma space).

- 2026-10-19 — Dense sheets (user's wish): 8×8 / 9×8 grids, ~150 px cells, textures and icons ship at 128 px, small UI at 96 px. 6 calls instead of 16 for the rest of the 2D art.

- 2026-10-19 — Codex model for images: `gpt-5.6-sol` (the user's default `gpt-6.1-sol` is refused for ChatGPT accounts; `gpt-6-astra` needs a newer CLI). Override with `CODEX_MODEL`. Updating the Codex CLI is the user's call.
- 2026-10-19 — Textures ship as **WebP** for now (no `toktx` / `basisu` installed). Switch to KTX2 when the tool is installed (Phase 10 at the latest).
- 2026-10-19 — Raw Codex images (`art/raw/`) are kept in normal git (no git-lfs installed; ~2 MB each, ~40 MB for all sheets). Move to LFS later if the repo gets heavy.
- 2026-10-19 — Team mask files are white + alpha (`<name>_team.webp`), so they work as CSS masks and as shader masks (red channel).
- 2026-10-19 — UI images live in `client/src/assets/ui/` (Vite adds hashes); game assets in `client/public/assets/` with `manifest.json` (loader asks `file?v=hash`).

- 2026-10-19 — TypeScript 6.0.3, not 7.x: typescript-eslint does not support TS 7 yet.
- 2026-10-19 — Server port variable is `GAME_PORT` (default 8787), because dev tools set `PORT` for the web server.
- 2026-10-19 — Client and server talk over the same origin: in dev Vite passes `/ws` to the server; in production a reverse proxy will do the same.
- 2026-10-19 — Menus and HUD frame are made with CSS only until the painted UI kit exists (Phase 3 / 9).

Decisions made by the AI in Phase 1. The user can change any of them.

- 2026-10-19 — Map is baked into a real terrain grid (`map-terrain.bin`, 0.5-unit cells) and a tree list, with natural bent edges. Exact symmetry is kept and checked.
- 2026-10-19 — Map name **Elder Temple**, 192 × 192 units, exact 4-way rotation symmetry (the reference is almost symmetric; exact is fairer). Start spots are random at match start.
- 2026-10-19 — Each base has 3 mines: main (15k), natural (10k, guarded by Orange Trolls), corner (12k, guarded by Red Ogres, only reachable through the natural).
- 2026-10-19 — 24 camps: 6 per sector (2 green, 2 orange, 2 red). The reference picture shows no camps, so places are ours.
- 2026-10-19 — Shops: 4 Trader's Tents (where the reference has its 4 side shops) + Temple Market in the center (where the reference has its center shop).
- 2026-10-19 — 4 Fountains of Life on the ring road between bases. They heal health and mana (not one of each, so the map stays symmetric).
- 2026-10-19 — No temple boss in the MVP (the shop is in the center). Post-MVP idea.
- 2026-10-19 — Sky Dragon flies in a "low air" layer: ignores terrain, but melee can still hit it. It has 50 less base health.
- 2026-10-19 — Hero levels 1–10, 3 basic abilities × 3 levels + ultimate at level 6, like classic RTS heroes.
- 2026-10-19 — Hero gold and faction gold are separate. Hero gets 250 start gold + 1 gold/s + bounties. The hero helps the faction only through Town Hall upgrades.
- 2026-10-19 — Some upgrade levels need faction buildings (Forge, Stronghold, Citadel, Workshop), so hero help and AI progress are linked.
- 2026-10-19 — Faction unit and building names changed to our own: Cleric, Lancer, Hawk Rider, Forge, Chapel, Watchtower, Hawk Roost, Stronghold, Citadel.
- 2026-10-19 — Difficulty changes AI decisions only, never stats or income.
- 2026-10-19 — If a human leaves for more than 2 minutes, a Normal hero bot takes over the hero.
- 2026-10-19 — Fonts: Cinzel + Alegreya Sans (OFL), bundled.
- 2026-10-19 — TypeScript on both client and server (shared rules and movement code for prediction). Java / Spring Boot was the other option; not chosen because the rules would have to be written twice.
- 2026-10-19 — Babylon.js, WebGPU with WebGL2 fallback.
- 2026-10-19 — 2D art from Codex image generation, many assets per image, magenta = team color, green = background.

## Open questions

- Game title: "Temple Wars" is a working title.
- Hosting for the server (Phase 10).

## Budgets (measured)

| What | Target | Now |
|---|---|---|
| First download | < 100 MB | ~14 MB (2D art 2.7 MB + models and skins 11 MB) |
| All assets | < 500 MB | — |
| FPS (laptop, 300 units) | 60 | 120 (capped) on M5; normal view 115–121 draws, ~260k tris (no 300-unit run after the map rework) |
| Server tick (4 players, full armies) | < 10 ms | — |
| Bandwidth per player | < 20 KB/s down | — |
| Codex image calls used | — | 27 images in total (Phase 3: 7, Phase 4: 20) |

## Known bugs

- Temple paving and plain grass still repeat a lot at the RTS camera distance (art pass, see CLIENT_AUDIT.md).
- The minimap camera box is a fixed 46 × 30 rectangle; it does not follow zoom or screen shape.
