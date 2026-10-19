# Progress

The AI updates this file at the end of every phase. Newest notes go on top of each section.

## Current state

- **Phase 3 is done** (2026-10-19). Next: **Phase 4 — 3D models and animation**.
- Notes for Phase 4:
  - First ask the user to pick the model source (A Blender scripts / B CC0 packs / C code-only). Blender is not installed yet.
  - Model references: `art/source/heroes_concept/` (8 heroes × front / side / back) and `art/source/world_concept/` (units, monsters, buildings). Material swatches: `client/public/assets/materials/` (32 × 128 px, team parts have `_team` masks).
  - Codex painted some magenta where it should not (Trader's Tent, Temple Market, Spider Queen crystals): treat those parts as normal color when modeling.
- The user gave a server for deploys (details kept outside the repo). Use it in Phase 10, or earlier for online tests after Phase 6. Ask before changing anything on it.

## Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Design and tech spec | **Done** | 8 design docs, 11 JSON data files, map data + preview |
| 2 | Project skeleton | **Done** | pnpm monorepo, Babylon client with WebGPU/WebGL2, ws server, binary protocol, typed data, 17 tests |
| 3 | 2D art with Codex | **Done** | 7 Codex images → 340 assets, 2.7 MB WebP; UI skin in menu / lobby |
| 4 | 3D models and animation | Not started | Model source A / B / C not chosen yet |
| 5 | Client engine and loading | Not started | |
| 6 | Server and multiplayer | Not started | |
| 7 | Combat, heroes, camps, items | Not started | |
| 8 | Faction AI and bots | Not started | |
| 9 | UI, effects, sound, fog | Not started | |
| 10 | Speed, tests, release | Not started | |

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

- Model source for Phase 4 (Blender scripts / CC0 packs / code-only). Asked at the start of Phase 4.
- Game title: "Temple Wars" is a working title.
- Hosting for the server (Phase 10).

## Budgets (measured)

| What | Target | Now |
|---|---|---|
| First download | < 100 MB | 2D art 2.7 MB (no models yet) |
| All assets | < 500 MB | — |
| FPS (laptop, 300 units) | 60 | — |
| Server tick (4 players, full armies) | < 10 ms | — |
| Bandwidth per player | < 20 KB/s down | — |
| Codex image calls used | 7 planned + 1–2 fixes | 7 (+2 refused, no image), no fix sheets needed |

## Known bugs

(none yet)
