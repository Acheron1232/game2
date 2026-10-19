# Temple Wars

A browser multiplayer fantasy RTS / hero game. Each team is one hero played by a human and one AI faction that builds its own base and army. Inspired by classic 4-player temple maps from early-2000s RTS custom games — with our own art, names and rules.

- What the game is: [docs/BRIEF.md](docs/BRIEF.md)
- Design docs: [docs/design/](docs/design/)
- Build plan: [docs/PHASES.md](docs/PHASES.md) · Progress: [docs/PROGRESS.md](docs/PROGRESS.md)

## Setup

You need **Node.js 24+** and **pnpm 10+**.

```bash
pnpm install
pnpm dev
```

Then open http://localhost:5173. `pnpm dev` starts both parts:
- the client (Vite) on port **5173**,
- the game server on port **8787** (Vite passes `/ws` and `/health` on to it).

Add `?webgl` to the URL to test the WebGL2 fallback instead of WebGPU. Press **F3** to hide or show the debug corner (renderer, FPS, ping).

## Commands

| Command | What it does |
|---|---|
| `pnpm dev` | Client + server with hot reload |
| `pnpm build` | Type check and build everything (`client/dist`, `server/dist`) |
| `pnpm test` | All unit tests (Vitest) |
| `pnpm lint` | ESLint + Prettier check |
| `pnpm format` | Format all files with Prettier |
| `pnpm typecheck` | Type check all packages |
| `pnpm data:check` | Check the game data files and the links between them |
| `pnpm map:build` | Rebuild the map: layout → terrain grid, trees and preview picture |
| `pnpm docs:tables` | Refill the number tables in `docs/design/*.md` from the data |

Run the built server: `node server/dist/main.js` (env: `GAME_PORT`, default 8787; `GAME_HOST`, default 0.0.0.0).

## Folders

```
client/   browser game: Babylon.js scene, HTML/CSS screens, loader, network
server/   game server: HTTP /health + WebSocket /ws
shared/   code and data used by both: protocol, data loaders, map reader
  data/   all game numbers (JSON) and the baked map
tools/    map builder, data checks, doc tables (art tools come in Phase 3)
docs/     brief, phase plan, progress, design docs, credits
```

## Rules for working on the code

See [CLAUDE.md](CLAUDE.md): simple English, all game numbers in `shared/data/`, the server decides everything, no Blizzard or Valve names or assets.
