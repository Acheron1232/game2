# Release checklist

## Automated gates

- `pnpm install --frozen-lockfile`
- `pnpm data:check`, `pnpm test`, `pnpm lint`, `pnpm build`
- `pnpm exec playwright test`: lobby loading, movement and 60 seconds of real match time.
- `pnpm --filter @game/server sim:matches -- --matches 10 --minutes 60 --slots 4`: inspect winners, economy, army growth and stuck reports.
- `pnpm --filter @game/server exec node --expose-gc --import tsx scripts/soak.ts`: 45 simulated minutes, heap snapshots at minute 5 and 40.
- `pnpm --filter @game/server load-test -- --units 300 --area center --seconds 20`: run separately from builds/tests; record tick, snapshot rate and bandwidth.
- `node deploy/package-release.mjs`: enforce the client download budget.

## Browser

- Fresh load and cached reload both reach a usable lobby; no failed assets or shader errors.
- WebGPU and `?webgl`: sharp native rendering at High, 120 FPS cap; record actual FPS separately.
- Two players join one room, ready, start, move, fight, use abilities/items, die and respawn.
- Settings, minimap, HUD, scoreboard, chat and result screen remain usable.
- Drop/rejoin a player; restart the test server: show reconnecting and return to menu when the old room no longer exists.
- Dev `?watch=10`: all four slots controlled by bots, economies progress, armies fight, defeated bases stop, winner and end statistics appear.
- Production rejects XP/gold/position cheats, watch acceleration, mass-test spawns and debug match termination.
- Leave a match and start another: no leftover model skeletons, particles, health bars or stale effects.
- Check narrow and wide windows, maximum/minimum zoom and terrain color.

## Deployment

- `/health` returns JSON through public HTTPS; `/ws` negotiates WSS and binary snapshots.
- Worker-backed production match starts (not just the HTTP health endpoint).
- Client index, service worker and manifest revalidate; content-hashed assets get immutable caching.
- Docker health is healthy; app runs as the Node user; backend has no published port.
- Existing unrelated VPS services remain healthy and listening on their original ports.
- Record release image, public URL, rollback directory and known limitations.

## Separate hardware qualification

An accelerated server test does not prove a 45-minute real-time browser/GPU memory soak. A short 120 FPS sample does not prove integrated-GPU performance with 300 fighting models, thermal behavior or fan noise. These require the actual device and a longer run.
