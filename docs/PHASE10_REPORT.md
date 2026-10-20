# Phase 10 — release verification

Historical Phase 10 evidence. The deployed release is now superseded by [the controls and unit interaction update](CONTROLS_AND_UNIT_INTERACTION.md); its report records the current release and verification.

Branch: `codex/phase-10-release`, based on Phase 9 commit `1b45193`, including the follow-up resource fixes. Preserve High/native rendering and the 120 FPS game cap.

## Changes

- Bounded movement command history independently of corrections; covered full sequence reuse.
- Disposed cloned skeletons and bone buffers, including warm-up and summon copies.
- Skipped empty health-bar GPU uploads and hidden debug GPU timing queries.
- Reused navigation region/stack buffers when blockers change (two 1 MiB arrays on the 512 × 512 grid no longer allocated on every rebuild).
- Deduplicated identical sight sources per team/cell/layer/radius without changing visible cells. A controlled 300-source cluster benchmark went from **0.316 to 0.068 ms/update**; this is not the cost of an entire frame or match.
- Corrected rooted/stunned movement animation state, lost-room reconnect timeout, auto-play/watch reconnect and persistent end-screen routing.
- Spectator results show the winning team instead of calling the spectator defeated.
- Production rejects test termination, mass spawns, speed overrides and cheats. The production button leaves the match instead of ending everyone's game.
- Added locked Docker runtime packaging, HTTPS/static/WebSocket proxy, cache headers, versioned release/rollback scripts, health release ID, CI, a 60-second Playwright smoke test, network profile, CPU/heap soak tooling and release/bug checklists.

## Bot matches

Seeds 1–10, four Normal AI factions and hero bots, no human commands: **10/10 winners, 0 stuck reports after correcting the detector**. Durations: 44.73, 22.53, 34.92, 49.95, 30.03, 45.57, 35.53, 32.30, 50.40, 35.00 game minutes. Seven meet 20–45 minutes; three still run longer.

The original seed-10 report was a detector false positive: 16 workers, 99/100 supply and an 83-supply army attacking the last opponent. The checker counted the possibility of training another one-supply worker although the bot already had its worker target. The same seed still wins at minute 35 after the detector fix. AI balance/stats were not changed to hide a stalled game.

In the final batch, average simulation ticks were 0.143–0.238 ms and p99 4.026–4.624 ms. Single maximum ticks still reached 13–67 ms on this host. These are accelerated headless simulation timings; they exclude browser rendering and normal network serialization. Do not claim all maximum-tick spikes are fixed.

## Network and assets

A deterministic four-team combat profile (seed 9, minutes 15–20, 20 snapshots/s, real visibility) measured **3.125 / 3.728 / 0.491 / 2.984 KiB/s** of snapshot payload per player. Largest snapshots: 487 / 478 / 274 / 408 bytes. This includes the actual bot combat simulation and team views, not real human input or socket headers. The old 300-unit crowded walking test and the 10× all-seeing spectator are different workloads; their higher traffic is not claimed solved.

Static client package: **21,234,133 bytes** before compression, manifest **14,403,575 bytes**, 334 manifest entries. Both are below the 100 MB download target. Existing WebP/GLB/Opus assets were retained; there was no quality/resolution reduction or unnecessary art conversion. Caddy compresses text and sets immutable caching on content-hashed URLs while HTML, SW and manifest revalidate.

## Memory

A 45-game-minute four-bot run (seed 9) completed without a stuck report. Full V8 heap snapshots were saved locally at minute 5 and 40. After explicit GC, used heap was 20,315,392 bytes at minute 5, 19,934,584 at minute 40 and 20,023,536 at minute 45. This shows bounded retained server heap in that run, not zero allocation or a 45-minute real-time browser/GPU memory guarantee. Large snapshots/CPU profiles remain under ignored `server/logs/`.

## CPU profile priorities

The sampled server profile identified these ten areas by self samples (sampling counts are not precise wall time): flow-field construction (1891), A* (1521), region labeling (1053), separation (388), simulation step (350), mover step (132), movement helpers (115), spatial-grid rebuild (111), line walkability (109), worker resource drop-off (104). Region allocations were removed; shared field/path scratch buffers already exist. Further flow-field/A* algorithm changes were deferred rather than changing routes/combat behavior without validation. The top-ten profiling task is recorded; all ten algorithms have **not** been rewritten or proven optimal.

## Release status and limits

- All **228 local tests** pass (151 shared, 51 client, 17 server, 9 tools), along with typechecks/build, lint and data validation.
- [GitHub CI run 39498040421](https://github.com/Acheron1232/game2/actions/runs/39498040421) is **green** for commit `63253b1`: install/data validation, all 228 tests, lint, build, a complete headless bot match and Chromium lobby → load → movement → 60 seconds of game time. The first run timed out starting Vite through `localhost`; the test configuration now starts server/client separately with explicit IPv4 binding. That CI-only change does not alter the deployed game bundle from `f8066cd`.
- First bot watch reached at least minute 44:48 at 120/120 FPS, native 1362 × 1544, about 4 ms sampled CPU; before that ~6 ms and ~193 draws in the inspected base view. This is a short Mac sample, not an integrated-GPU 300-unit qualification.
- Direct HTTPS is prepared for `temple-wars.92-5-107-107.nip.io`, but provider ingress for 80/443 timed out in both external curl and Let's Encrypt validation. The user explicitly chose to keep temporary HTTPS access rather than change Oracle ingress.
- Accepted live URL: https://render-telecom-pending-elizabeth.trycloudflare.com/ . Release **`phase10-f8066cd`** runs on the supplied VPS behind Caddy and a Cloudflare Quick Tunnel. HTTPS certificate validation and WSS are working. The URL can change when the tunnel restarts; this is not a permanent production domain.
- Production browser check: two real clients, WebGPU and WebGL2, joined room `N2Y9W`, selected Arcane Huntress / Stone Golem and played for two minutes. Movement, learning Q and target selection responded. Both reloaded and returned to the same running match with their hero/learned ability intact; no captured warning/error console entries. Leaving one client handed it to a bot while the other kept playing. Leaving both removed the room and match (`/health`: 0 rooms, 0 matches). A complete production PvP ability duel was not repeated in this release check.
- Browser bot-only watch at **10×** finished naturally: **Team 4 won at 34:25**, with kills/deaths, camp and upgrade statistics. The result stayed visible after the following room update. Evidence: [bot result](screenshots/phase10-bots-finished.jpg), [live production match](screenshots/phase10-live.jpg).
- Public cache headers checked: HTML and manifest `no-cache`; versioned asset `public, max-age=31536000, immutable`. Cached reloads returned to the live match, but an isolated cold/warm stopwatch benchmark was not made. The two hidden production tabs sampled 30 rendered FPS with the **120 game cap** and native 2560 × 1440 framebuffer; this is not a foreground performance qualification.
- Server container is healthy. A short two-client sample used about 81.5 MiB container memory and 2.15% CPU in Docker's accounting; this is not a full-army peak or a Mac thermal measurement.
- Remaining hardware qualification: long real-time browser/GPU heap soak, weak-laptop 300-unit rendering, fan/power/temperature measurements and forced GPU device loss.
- Server sessions/matches are in memory and do not survive a server restart. Existing unrelated VPS services were not replaced.

See [DEPLOY.md](DEPLOY.md), [TEST_CHECKLIST.md](TEST_CHECKLIST.md), [PLAYTEST_FOLLOWUP.md](PLAYTEST_FOLLOWUP.md).
