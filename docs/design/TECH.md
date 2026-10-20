# Technical Design

Stack and code rules are in `CLAUDE.md`. This doc explains **how the parts work together**.

## 1. Big picture

```
 Browser (client)                                  Server (Node.js)
 ┌──────────────────────────────┐                  ┌──────────────────────────────┐
 │ UI (HTML/CSS)  menus, HUD    │                  │ Lobby service (main thread)  │
 │ Loader  manifest → cache → GPU│   WebSocket      │  rooms, slots, chat, ready   │
 │ Net  send commands, get state│ ◄──────────────► │                              │
 │ Prediction (own hero)        │   binary frames  │ Match worker (1 per match)   │
 │ Interpolation (everything)   │                  │  20 Hz tick: commands → sim  │
 │ Render  Babylon.js scene     │                  │  faction AI, hero bots       │
 └──────────────┬───────────────┘                  │  vision → per-player deltas  │
                │ imports                          └──────────────┬───────────────┘
                ▼                                                 │ imports
          shared/  rules, data tables, protocol, movement, nav, math  ◄┘
```

- **The server owns the truth.** Clients send commands. The server runs the simulation and sends back what each player may see.
- `shared/` is plain TypeScript with no DOM, no Babylon and no Node APIs, so it runs in both places and in tests.

## 2. Packages

| Package | What is inside |
|---|---|
| `shared/` | `data/` (JSON + typed loaders), `protocol/` (message ids, binary writer/reader), `sim/` (entities, movement, combat, abilities, buffs, items, camps, economy), `nav/` (grid, A*, flow fields), `math/` (vec2, fixed rand) |
| `server/` | `lobby/` (rooms, slots, chat), `match/` (worker entry, tick loop, command queue, vision, snapshot writer), `ai/` (faction brain, hero bot), `net/` (ws server, rate limits) |
| `client/` | `app/` (screen router, settings), `ui/` (menus, lobby, HUD, tooltips), `loader/` (manifest, download queue, cache, GPU warm-up), `net/` (socket, clock sync, snapshot buffer), `game/` (prediction, interpolation, input, camera), `render/` (scene, terrain, water, instancing, units, effects, fog, minimap), `audio/` |
| `tools/` | `art/` (Codex generation, slicing, packing, compression), `map/` (map layout builder), `data/` (checks, doc tables), `models/` (Phase 4) |

## 3. Simulation

- Fixed tick **20 Hz** (50 ms). Each tick: read queued commands → AI decisions (if due) → abilities and buffs → movement → attacks and projectiles → deaths, XP, gold, drops → camps and respawns → vision → write snapshots.
- Time inside the sim is counted in ticks. Durations from JSON (seconds) are turned into ticks on load.
- Positions are floats inside the sim; they are rounded when sent.
- Random numbers come from a seeded generator per match (replays and tests later).
- **Entity storage:** typed arrays by component (position, velocity, health, owner, ...) with an entity id table. Fast to loop, cheap to snapshot. Keep it simple: no big ECS library.
- **Spatial hash** (4 × 4 unit cells) for "who is near": targets, auras, splash, collisions, vision.
- Budget: a tick must take **under 10 ms** with 4 full armies (~400 units) + 24 camps.

## 4. Movement and pathfinding

- **Nav grid**: 0.5-unit cells (512 × 512). Each cell has: walkable (ground), buildable, tree id, height level, water. Buildings and trees mark cells as blocked; chopped trees and destroyed buildings free them.
- **Heroes and small groups:** A* on the nav grid with path smoothing (string pulling). Re-plan when blocked.
- **Areas:** every connected walkable area has an id (`labelRegions`). A click into an area the unit can not reach goes to the nearest reachable point at once, so A* never searches the whole map for nothing. Rebuild the ids when trees are cut or buildings placed (Phase 7+).
- A* uses search stamps (nothing is cleared per search) and linear string pulling: about 1.5 ms across the whole map, 0.2 ms for a normal click.
- **Armies:** flow fields on a 1-unit grid toward a target area; cached per target and reused by every unit going there.
- **Local steering:** units are circles. Separation keeps them apart, they slide along each other and around obstacles. No full physics.
- **Air and lowAir units** ignore the nav grid (only the map border blocks them). Air units spread out with separation too.
- **Same code on client:** the client runs the same A* and movement for its own hero (prediction).

## 5. Network

### Transport
- One WebSocket per player. Lobby messages: JSON (rare, easy to debug). Match messages: **binary** (`ArrayBuffer`, our own writer/reader in `shared/protocol`).
- Every message starts with `u8 messageId`. Protocol version is checked on connect; old clients are told to reload.

### Client → server (commands)

| Command | Data |
|---|---|
| `move` | target x, y (u16 quantized), queue flag |
| `attack` | target entity id |
| `attackMove` | x, y |
| `stop`, `hold` | — |
| `cast` | ability slot, target entity or point |
| `learn` | ability slot |
| `useItem` | slot, target entity or point |
| `moveItem`, `dropItem`, `pickUp`, `giveItem` | slots / ids |
| `buy`, `sell` | shop id, item id / slot |
| `buyUpgrade` | upgrade id |
| `ping` | client time |
| `chat` | text (also used in match) |

Commands carry a client sequence number. The server answers with the last processed number in each snapshot, so the client knows which predictions are confirmed.

### Server → client

- `snapshot` every tick (20/s), built in Phase 6 (`shared/src/protocol/game.ts`, `client-view.ts`):
  - Header: `u8 id, u32 tick, u16 ackSeq` (last command of this player the server ran), `u16 ticksSinceAck`, `u8 flags` (1 = full: drop all entities not in it).
  - `spawns`: entities that came into view (id, type, owner, color, position, velocity, facing, state, hp, max hp; 22 bytes).
  - `updates`: id, field mask, then only the fields in the mask (motion = x, y as u16 + vx, vy as i16; facing u8; state u8; hp, max hp u16).
  - `gone`: ids that left the view or the game.
  - **Motion, not positions:** the server sends a position with a velocity. The client keeps the unit moving on that line. The server works out the client's guess and sends a new motion only when the guess drifts by more than 0.05 units (0.01 for the player's own hero) or the velocity changes (start, stop, turn). A unit walking straight costs nothing. WebSocket is TCP, so nothing is lost and "changes since the last snapshot sent" is safe.
  - Position u16 over 256 units (≈ 0.004 unit steps). Velocity i16 in 1/2000 units per second.
- Measured (load test, 4 players, 300 walking units): 0.8 KB/s per player when units walk around their own bases, 1.8 KB/s when all 300 walk in the temple and everyone sees everyone. Up: a ping every 2 s and a 7-byte command per click.
- `event` for one-time things: ability cast, hit, death, level up, item drop, gold gained (for effects and sounds).
- `playerState` for the player's own private data (gold, inventory, cooldowns, XP) when it changes.

### Smooth feel
- **Interpolation:** the client draws other entities **2 ticks (100 ms) in the past**: between two motion keys, or on from the last key with its velocity (at most 10 ticks past the newest snapshot). The server tick "now" is guessed from snapshot arrival times (`client/src/game/tick-clock.ts`): early snapshots move the guess fast, late ones slowly, so one slow message does not shake everything.
- **Prediction** (`client/src/game/hero-predictor.ts`): a click runs the same `applyCommand` + `stepMover` in the same 20 Hz steps on the client at once. Each snapshot says "after `ticksSinceAck` ticks since command N, the hero was here"; we compare with our own state after the same number of steps since we ran N. If a newer command already ran there, we wait. If the server got there first, we check when our step runs. Error → our real state moves onto the server's line and the drawn hero slides over ~100 ms. Over 2 units → snap. The steps follow the real clock, not frames, so a hidden tab stays in step. Tested offline with 100 ms ping + jitter: 0 fixes (`client/test/net-sync.test.ts`).
- **Abilities** show the cast animation at once on the client; the real effect waits for the server event (no damage prediction).
- Ping every 2 s (smoothed round-trip time, shown in the HUD and F3).
- **Lag tool (dev):** `?lag=100&loss=2` adds 100 ms to the round trip and makes 2% of messages late by a resend time (≥ 200 ms), keeping their order, like TCP does.
- Bandwidth target: < 20 KB/s down per player in a big fight. If we go over: lower the update rate for far-away units (every 2nd–4th tick), drop unchanged fields, add compression on big spawn bursts.

### Lobby flow

```
client connects → hello(version, name)
host: createRoom → room code
others: joinRoom(code)
everyone: slot / team / color / hero / ready changes → room state broadcast
everyone: loadProgress(%) every 0.5 s → shown next to names
host: start (all ready, all 100%) → server makes a match worker → matchStart(start spots, seed)
clients: build the scene from already-loaded assets → "ready to play" → server starts ticking after all ready (or 10 s timeout)
```

### Reconnect
The server keeps a session token per player. The tab keeps its own token in sessionStorage (a reload takes the same player back, even before the server noticed the old socket closed). All recent tokens of the browser are in localStorage: a reopened tab offers them, and the server gives back one whose player is **offline** right now (so several open tabs stay different players). A dropped player's hero walks back to its start spot and waits. Coming back within 2 minutes: room state + `matchStart` (rejoin) + a full snapshot (also sent again on `matchReady`, in case the scene was still loading). After 2 minutes the slot becomes a bot (the hero bot itself comes in Phase 8).

### Game list
`listRooms` → `roomList`: every room on the server (host name, code, phase, players, open slots), open lobbies first, at most 50. The menu shows "N open · M playing", a search by host name or code, and a Join button. It refreshes every 3 s while the play panel is open.

### Safety
- Validate every command: owner, target alive and visible, range, cooldown, mana, gold, item slots.
- Rate limit: max 30 commands per second per player (dropped in the match), max 60 messages per second per socket (closed above that).
- The client never decides damage, gold or XP.
- Fog of war on the server: clients do not get hidden enemy data, so map hacks show nothing.

## 6. Vision and fog of war

- Phase 6 (built): 4-unit cells (64 × 64) per team, circle around every unit by its sight, every 2 ticks; no line of sight yet. Only entities in a visible cell are sent.
- Phase 9 target: 1-unit cells (256 × 256) per team, updated every 2 ticks (10 Hz).
- Each unit marks cells inside its sight radius. Line of sight is blocked by trees and by higher ground (simple height check along the ray; precomputed per cell height).
- The server sends the client a compressed vision bit map (only changed rows) for the fog render, plus spawn/despawn of entities.
- The client renders fog as a low-res texture, blurred and blended over terrain, and on the minimap.

## 7. AI

- **Faction AI** runs in the match worker, every 300–1000 ms depending on difficulty, spread over different ticks so not all four think at once.
- It uses the same command system as players (it "presses buttons" through the sim), so it can not cheat on rules.
- Structure: managers (economy, build, production, army, target, defense, expansion) reading a shared "blackboard" (known enemy positions, threats, money). Simple rules and scores, no machine learning.
- **Hero bots** use a small state machine: farm → fight → retreat → shop → join attack. Threat check every think.
- **Headless runs:** the match worker can run without clients and faster than real time, for AI tests and balance (Phase 8).

## 8. Rendering

- Babylon.js engine: try `WebGPUEngine`, fall back to `Engine` (WebGL2). No WebGL1.
- **Camera:** fixed angle (about 56° down), small zoom range, never rotates in the MVP. This lets us cull hard and keep draw calls low.
- **Terrain:** one mesh per 32 × 32 unit chunk (36 chunks), height from the map data, splat map (4 ground layers per chunk from the terrain atlas). Cliffs as separate low-poly meshes along level edges.
- **Water:** flat planes with a cheap animated normal map and shore fade.
- **Trees, rocks, grass:** thin instances, one draw call per type. Wind sway in the vertex shader. Chopped trees are hidden by setting their instance scale to 0.
- **Units:** GLB models. Many same-type units use baked vertex animation (Babylon `BakedVertexAnimationManager`) with thin instances. Heroes use normal skeletons.
- **Team color:** one shared shader (node material or custom) that reads the team mask and mixes in the player color from a per-instance attribute.
- **Shadows:** one directional light, one shadow map (2048) for heroes, buildings and big units only; blob shadows (a soft dark decal) for small units and trees.
- **Effects:** a pool of particle systems and textured quads per effect type; GPU particles when WebGPU is on.
- **Health bars and selection circles:** instanced quads, not DOM.
- **Damage numbers:** a small pool of instanced text quads using a number atlas.
- Graphics settings: Low / Medium / High change shadow size, effects amount, grass density, render scale (0.75 / 1 / native).

## 9. Assets and loading

### Pipeline (Phase 3 and 4)
```
Codex image → art/raw/*.png → slice → seamless / key-out / team mask → pack atlas → KTX2 → client/public/assets/
Blender script (or chosen source) → GLB → gltf-transform (meshopt, prune, dedupe) → client/public/assets/
tools/art/manifest.ts → client/public/assets/manifest.json (path, bytes, hash, group, type)
```

### Load groups (in order)
1. `boot` — fonts, UI kit, menu background (< 5 MB). Loaded before the menu shows.
2. `map` — terrain atlas, foliage, props, map data.
3. `units` — faction units, monsters, buildings.
4. `heroes` — all 8 heroes (everyone can see every hero).
5. `effects` — particles, flipbooks.
6. `audio` — sounds and music (music streams, it does not block start).

### Loader rules
- Starts as soon as the player opens the **lobby**.
- 6 parallel downloads, retry 3 times with back-off, progress by bytes (not file count) so the bar moves evenly; the panel shows file counts per group too.
- All files have a hash in the name (`terrain-atlas.4f2a9c.ktx2`), so they can be cached forever. The service worker stores them in the Cache API; the second visit loads from disk.
- After download: decode, upload textures to the GPU, create every material, and render every material once in a hidden render target (forces shader compile). For WebGPU this also builds the pipelines. Then report "Ready".
- The host can only start when everyone reports 100%.

### Size targets
- `boot` < 5 MB, whole game first download < 100 MB, total < 500 MB.
- Textures in KTX2 (Basis UASTC for UI and normal maps, ETC1S for color), models with meshopt, audio in Opus.

## 10. Testing

- Vitest: data loaders, damage math, ability numbers, XP, drop tables, protocol round trips, A*.
- Headless match test: 4 bot teams play a full match at max speed; check it ends and no AI gets stuck.
- Playwright smoke test: open → lobby → load → play 60 s with a bot.
- Lag tool: dev-only setting to add delay, jitter and packet loss on the server socket.

## 11. Deploy (Phase 10)

- Client: static files on a CDN, long cache for hashed files, short cache for `index.html` and `manifest.json`.
- Server: one Node process per machine with match workers; a small VPS can run several matches. HTTPS + WSS behind a reverse proxy.
- Later: a room directory service and more regions.
