# CLAUDE.md — Project rules for the AI

You are the lead game engineer, technical artist and game designer on this project.
Read this file fully at the start of every session. Then read:

1. `docs/BRIEF.md` — what the game is (the vision, the systems, the art style).
2. `docs/PHASES.md` — the build plan, split into 10 phases.
3. `docs/PROGRESS.md` — what is already done, open decisions, known problems.

## How we work

- The user asks for **one phase at a time** ("Do Phase 4"). Do only that phase.
- If a phase is too big for one session, split it into parts (4a, 4b, ...), finish part one fully, write the rest into `docs/PROGRESS.md`, and stop.
- Before you start a phase: re-read the phase in `docs/PHASES.md`, check `docs/PROGRESS.md`, and post a short plan.
- When you finish a phase:
  - run the build, linter and tests, and fix what fails;
  - check every item in the phase's **Done when** list, and say how you checked it;
  - update `docs/PROGRESS.md` (done / not done / decisions / known bugs / next step);
  - propose one git commit for the phase.
- Never say a thing works if you did not run it. If you could not test something, say so.
- If a choice is really the user's (big scope change, money, look and feel), ask. For small technical choices, pick the sensible option and write it into `docs/PROGRESS.md` under "Decisions".
- Keep the earlier phases working. If a later phase needs to change an earlier design, update the docs too.

## Language and text

- All code, comments, docs, commit messages and in-game text are in **English**.
- Use **simple English**, like in games: short words, short sentences. "Not enough gold." not "Insufficient currency reserves."
- The user reads English as a second language. Explain decisions to them in plain words.

## Legal and originality

- The game is **inspired by** Warcraft 3 custom maps (Lost Temple), Dota and the WoW universe. It must **not copy** them.
- Never use Blizzard or Valve assets, models, sounds, icons, UI art, fonts, map files, or exact names (no "Lost Temple", "Footman", "Holy Light", "War Stomp", "Starfall", etc.). Make up our own names.
- Copying the general layout idea of a 4-player map (bases in corners, temple in the middle) is fine. Copying the exact map file is not.
- Third-party assets or fonts: only with a clear free license (CC0, OFL, MIT). Write each one into `docs/CREDITS.md` with its license.

## Tech stack (decided — change only after asking the user)

| Part | Choice |
|---|---|
| Language | TypeScript everywhere (strict mode) |
| Monorepo | pnpm workspaces: `client/`, `server/`, `shared/`, `tools/` |
| Client build | Vite |
| 3D engine | Babylon.js — WebGPU first, WebGL2 fallback |
| HUD / menus | HTML + CSS overlay above the canvas (no React in the game loop; Preact is OK for menus) |
| Server | Node.js + TypeScript, `ws` (or uWebSockets.js if we need more speed), one worker thread per match |
| Shared code | `shared/` holds game rules, data tables, protocol, and the movement code used by both server and client prediction |
| Network format | Binary messages (our own `DataView` writer/reader), not JSON, for game traffic. JSON is OK for lobby messages. |
| Models | glTF 2.0 / GLB, meshopt compressed |
| Textures | PNG source → KTX2 (Basis Universal) for the game |
| Audio | Ogg Opus |
| Tests | Vitest for logic, Playwright for a browser smoke test |

Why TypeScript on the server: the client and the server must run the **same** movement and rules code, so client-side prediction matches the server. Doing that in two languages means writing everything twice.

## Code rules

- The server is the boss. It runs the game simulation. Clients send **commands** ("move here", "cast Q at this point"), never results ("I hit him for 200").
- The simulation code in `shared/` does not touch the DOM, Babylon, or the network. It is plain logic that can be tested.
- All game numbers (hero stats, ability damage, item cost, unit stats, camp rewards) live in data files in `shared/data/`, not inside code.
- Fixed simulation tick: 20 ticks per second on the server. The client renders at the screen's frame rate and interpolates.
- No new objects created per frame in hot loops. Use pools for projectiles, effects, damage numbers, and network messages.
- Small, clear modules. File names in `kebab-case.ts`. Classes in `PascalCase`. Constants in `UPPER_SNAKE_CASE`.
- Add a comment when the "why" is not obvious. Do not add comments that only repeat the code.

## Performance budget (check this in every phase that touches the client)

- 60 FPS at 1080p on a normal laptop with integrated graphics (e.g. Apple M1 or Intel Iris Xe) with ~300 units on screen.
- Fewer than ~300 draw calls in a normal fight. Use instancing / thin instances for trees, grass, rocks, and same-type units.
- Triangle budget: hero 1,500–3,000; unit 500–1,500; building 300–2,000; tree 100–400.
- Texture size: 256–512 px per hero/unit, atlases up to 2048 px. Nothing bigger without a reason.
- Many units of the same type: use baked vertex animation (Babylon `BakedVertexAnimationManager`) instead of full skeletons.
- First download target: **under 100 MB**. Hard limit for all game assets: 500 MB.
- After the match starts there must be **no loading hitches**: all textures uploaded, all materials and shaders compiled during the lobby.
- Network target: under 20 KB/s per player down, under 2 KB/s up.

## Art generation with Codex (ChatGPT image generation)

The user has the Codex CLI installed. It can create images. Use it for all 2D art: texture atlases, foliage cards, icons, UI frames, and concept sheets for models.

How to call it (non-interactive):

```bash
codex exec -m gpt-5.6-sol --skip-git-repo-check -s workspace-write -C "$PWD" \
  -o tools/art/logs/<sheet-name>.txt \
  "Use your image generation tool to create one image. <PROMPT>. Save the final PNG to art/raw/<sheet-name>.png"
```

- Use `pnpm art:gen <sheet>` (it runs this command). The user's default Codex model (`gpt-6.1-sol`) is refused for image calls on their ChatGPT account and `gpt-6-astra` needs a newer CLI, so we pass `-m gpt-5.6-sol` (override with `CODEX_MODEL`).
- Codex often returns a **transparent** background instead of green. The tools handle both (transparent: only soft edges are cleaned; flat backdrop: removed by its sampled color).
- After every `art:process`, look at `art/source/<sheet>/_contact.png`. If you change `tools/art/lib/pixels.ts`, re-run `art:process` for **all** sheets and look again.
- If the PNG is not in `art/raw/`, take the newest file from `~/.codex/generated_images/` (each run has its own folder) and copy it.
- Images come back at about 1024–2200 px, not in an exact size. The slicing tool must handle any size.
- **Save usage.** The user's Codex limit is small:
  - Put **many assets in one image**: a strict grid (for example 4×4 or 6×6 cells), thin solid lines between cells, same lighting in every cell.
  - Write all prompts into `tools/art/prompts/*.md` first. Show the user the full list of sheets and the number of images before you generate.
  - Generate **one test sheet first**, check it, fix the prompt, then do the rest.
  - If one cell is bad, regenerate only a small fix sheet, never the whole sheet.
  - Log every call (prompt, date, output file) in `tools/art/generation-log.md`.
- Team color: in every sheet with heroes, units or buildings, paint the team-color parts (shoulders, armor trim, banners, cloth) in **pure magenta #FF00FF**. Our tool turns magenta into a team-color mask, and the shader paints it in the player's color.
- Background of sprite/card/icon sheets: one flat color that is not used in the art (pure green #00FF00), so the tool can cut it out.
- Image models cannot paint a texture that fits a 3D model's UV layout. So for heroes and units, the image sheets are **concept sheets** (front / side / back views + color palette) plus small tileable material swatches (metal, leather, cloth, skin, scales). The 3D model uses these swatches through a small palette atlas.

## Folders (target layout)

```
client/        browser game (Babylon.js, HUD, loader)
server/        match server and lobby server
shared/        rules, data tables, protocol, movement, math
tools/         asset tools: generation scripts, slicer, packer, compressor
art/raw/       images straight from Codex (kept in git LFS or ignored; ask the user)
art/source/    cleaned sheets, masks, model source files
client/public/assets/   final compressed game assets + manifest.json
docs/          brief, phases, progress, design docs, credits
```

## Commands

Keep this section current. Node 24+, pnpm 10+.

| Command | What it does |
|---|---|
| `pnpm install` | Install everything |
| `pnpm dev` | Client (Vite, port 5173) + game server (port 8787) with hot reload. Vite passes `/ws` and `/health` on to the server |
| `pnpm build` | Type check + build all packages (`client/dist`, `server/dist/main.js`) |
| `pnpm test` | All Vitest tests |
| `pnpm lint` | ESLint + Prettier check (must pass before a phase is done) |
| `pnpm format` | Prettier write |
| `pnpm typecheck` | `tsc` in every package |
| `pnpm data:check` | Zod shape check + cross-file links of `shared/data/*.json` |
| `pnpm --filter @game/server load-test -- --units 300 --area bases\|center --seconds 20` | 4 fake players + test units: prints server tick time and KB/s per player |
| `pnpm map:build` | `make-map-layout.mjs` → `bake-terrain.mjs` (layout, terrain grid, trees, `docs/design/map-preview.png`) |
| `pnpm docs:tables` | Refill `<!-- table:... -->` blocks in `docs/design/*.md` from the JSON |
| `pnpm --filter @game/tools art:gen <sheet> [--dry]` | One Codex image for a sheet → `art/raw/<sheet>.png` (`--dry` only prints the prompt, free) |
| `pnpm --filter @game/tools art:process <sheet>\|--all` | Cut and clean a sheet → `art/source/<sheet>/` + WebP in `client/src/assets/ui` or `client/public/assets/...` + manifest |
| `pnpm --filter @game/tools art:manifest` | Rewrite `client/public/assets/manifest.json` |
| `pnpm --filter @game/tools models:build [ids] [--preview]` | Blender scripts → GLB (quantized) + `models.json` + manifest; `--preview` renders `art/source/models/<id>.png` |
| `pnpm --filter @game/tools models:palette` | Rebuild the shared model palette atlas |
| `pnpm --filter @game/server sim:matches [--matches 10 --minutes 60 --slots 4 --difficulty normal --verbose]` | Headless bot-only matches (no browser): winner, stuck reports, tick times; JSON report in `server/logs/` |

Notes:
- The server reads `GAME_PORT` / `GAME_HOST` (not `PORT`, which dev tools often set for Vite).
- `?play` makes a room and starts a match alone as soon as loading is done (Vite reloads repeat it). `?join=<CODE>` joins a room. `/dev/models.html` is the model viewer, F4 in game = 300-unit render stress test (client only).
- Dev cheat in the browser console (dev servers only): `net.send({ type: 'cheat', xp: 6000 })` gives XP (level 10); also `gold: 1000`, `item: 'storm_hammer'` (an item id), `pos: [x, y]` (put the hero there). Every `cheat` refills health, mana and cooldowns (abilities and items).
- F6 in a dev match runs that same cheat: level 10, full health/mana and ready cooldowns. Learn skills with Ctrl + Q/W/E/R; F6 does not spend skill points.
- Node 22 (the cloud sandbox): the dev match worker can not load `.ts` files, so matches never start. Run `MATCH_INLINE=1 pnpm dev` there (Node 24 works without it).
- `?lag=100&loss=2` (dev) adds 100 ms round trip and 2% late messages. `MATCH_INLINE=1` runs matches on the server main thread (debugging). Load-test options in `start` work only when `NODE_ENV` is not `production`.
- Matches run in a worker thread: `server/src/match/match-worker.ts` (dev, via tsx) / `server/dist/match-worker.js` (build). The server reads `shared/data/map-terrain.bin` from disk (`GAME_DATA_DIR` to override).
- `?webgl` in the client URL forces the WebGL2 fallback. F3 toggles the debug corner. `/dev/atlas.html` shows all generated 2D art (tiles 4×4, team colors).
- Browser preview: `.claude/launch.json` has a `dev` entry that runs `pnpm dev` on port 5173.
- After changing any JSON in `shared/data/`, run `pnpm data:check`, `pnpm docs:tables` and `pnpm test`.
