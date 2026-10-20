# Current-game playtest — 2026-10-20

Branch: `codex/continuous-playtest-polish`. Scope: fix and polish the current game. No items, faction AI or other missing phase features.

## Cycle 1 — zoom, repeated matches, long walks

- **Dark ground when zooming out (fixed).** Reproduced in WebGPU, with and without shadows. WebGL2 showed the correct ground in the same two-player match. Babylon 9.29 generates raw array mipmaps for layer 0 only; the other layers were empty. During loading, the client now uploads all layers of every smaller mip on WebGPU. Trilinear and anisotropic filtering stay enabled. No extra frame work, texture reads or GPU storage. Compared near/far views in WebGPU and WebGL2; dirt, forest floor and temple stone keep their color. Screenshot: `screenshots/playtest-zoom-webgpu-fixed.jpg`.
- **Resources left behind after each match (fixed).** Ability meshes, ten burst systems, buff templates, projectile layers and health bars had no disposal path. Delayed casts could also run after leaving. Match disposal now cancels those timers, frees its render resources and clears floating numbers. Hero and ability particle systems keep the scene-owned shared atlas alive when disposed. A regression test runs five full combat-render setup/cleanup cycles and checks that meshes, materials, particles and textures return to the baseline.
- **Empty instance layers (fixed).** A zero thin-instance count can render the source mesh. Empty health/projectile layers are now disabled. Reused line bolts are placed before their first frame instead of flashing at the old position.
- **Repeated motion corrections on a perfect connection (fixed in logic tests).** Two browser players walking to the temple exposed increasing correction counts. A deterministic 60-second test reproduced it: a spawn on a nav-cell boundary rounds into a neighboring cell in a snapshot, so client and server choose different A* routes. Ground paths now plan from the same quantized start coordinates. Prediction also allows the wire's drift plus rounding before correcting. The long-route test now has zero corrections and zero snaps, both without latency and with 100 ms round trip plus jitter. Browser retest follows in the next cycle.

Validation: all 77 tests passed (44 shared, 14 client, 10 server, 9 tools), typecheck, production build and lint passed. Browser testing used two real WebSocket players and native render buffers (1362 × 1544 and 2560 × 1440). The match limit remains 120 FPS; these background browser surfaces reported about 30 rendered FPS, so this run does not establish foreground 120 FPS or a temperature/fan improvement.

## Still checking

- Combat animation timing and cast interruption.
- Ability feedback and descriptions at each learned level.
- Repeated multiplayer fights, respawn, reconnect and lag.
