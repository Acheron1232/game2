# Progress

The AI updates this file at the end of every phase. Newest notes go on top of each section.

## Current state

- **Phase 2 is done** (2026-10-19). Next: **Phase 3 — 2D art with Codex**.
- Notes for Phase 3:
  - Ask the user: keep raw Codex images in git LFS or outside git (`art/raw/` is not ignored yet).
  - Show the sheet list and the number of Codex calls before generating anything.
  - The placeholder ground in the client uses flat colors from `client/src/render/terrain-colors.ts`; the terrain atlas replaces them in Phase 5.
- The user gave a server for deploys (details kept outside the repo). Use it in Phase 10, or earlier for online tests after Phase 6. Ask before changing anything on it.

## Phases

| # | Phase | Status | Notes |
|---|---|---|---|
| 1 | Design and tech spec | **Done** | 8 design docs, 11 JSON data files, map data + preview |
| 2 | Project skeleton | **Done** | pnpm monorepo, Babylon client with WebGPU/WebGL2, ws server, binary protocol, typed data, 17 tests |
| 3 | 2D art with Codex | Not started | |
| 4 | 3D models and animation | Not started | Model source A / B / C not chosen yet |
| 5 | Client engine and loading | Not started | |
| 6 | Server and multiplayer | Not started | |
| 7 | Combat, heroes, camps, items | Not started | |
| 8 | Faction AI and bots | Not started | |
| 9 | UI, effects, sound, fog | Not started | |
| 10 | Speed, tests, release | Not started | |

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
- Where to keep raw generated images: git LFS or outside git. Ask at the start of Phase 3.
- Game title: "Temple Wars" is a working title.
- Hosting for the server (Phase 10).

## Budgets (measured)

| What | Target | Now |
|---|---|---|
| First download | < 100 MB | — |
| All assets | < 500 MB | — |
| FPS (laptop, 300 units) | 60 | — |
| Server tick (4 players, full armies) | < 10 ms | — |
| Bandwidth per player | < 20 KB/s down | — |
| Codex image calls used | as few as possible | 0 |

## Known bugs

(none yet)
