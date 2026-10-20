# Current-game playtest — 2026-10-20

Branch: `codex/continuous-playtest-polish`. Scope: fix and polish the current game. No items, faction AI or other missing phase features.

## Cycle 1 — zoom, repeated matches, long walks

- **Dark ground when zooming out (fixed).** Reproduced in WebGPU, with and without shadows. WebGL2 showed the correct ground in the same two-player match. Babylon 9.29 generates raw array mipmaps for layer 0 only; the other layers were empty. During loading, the client now uploads all layers of every smaller mip on WebGPU. Trilinear and anisotropic filtering stay enabled. No extra frame work, texture reads or GPU storage. Compared near/far views in WebGPU and WebGL2; dirt, forest floor and temple stone keep their color. Screenshot: `screenshots/playtest-zoom-webgpu-fixed.jpg`.
- **Resources left behind after each match (fixed).** Ability meshes, ten burst systems, buff templates, projectile layers and health bars had no disposal path. Delayed casts could also run after leaving. Match disposal now cancels those timers, frees its render resources and clears floating numbers. Hero and ability particle systems keep the scene-owned shared atlas alive when disposed. A regression test runs five full combat-render setup/cleanup cycles and checks that meshes, materials, particles and textures return to the baseline.
- **Empty instance layers (fixed).** A zero thin-instance count can render the source mesh. Empty health/projectile layers are now disabled. Reused line bolts are placed before their first frame instead of flashing at the old position.
- **Repeated motion corrections on a perfect connection (fixed in logic tests).** Two browser players walking to the temple exposed increasing correction counts. A deterministic 60-second test reproduced it: a spawn on a nav-cell boundary rounds into a neighboring cell in a snapshot, so client and server choose different A* routes. Ground paths now plan from the same quantized start coordinates. Prediction also allows the wire's drift plus rounding before correcting. The long-route test now has zero corrections and zero snaps, both without latency and with 100 ms round trip plus jitter. Browser retest follows in the next cycle.

Validation: all 77 tests passed (44 shared, 14 client, 10 server, 9 tools), typecheck, production build and lint passed. Browser testing used two real WebSocket players and native render buffers (1362 × 1544 and 2560 × 1440). The match limit remains 120 FPS; these background browser surfaces reported about 30 rendered FPS, so this run does not establish foreground 120 FPS or a temperature/fan improvement.

## Cycle 2 — combat timing and ability feedback

- **Cast visuals now follow the server.** The old client started local timers on wind-up, even if the player cancelled the cast. Protocol 5 adds a completed-cast event, including the learned level. Ground zones, bursts and jumps now start only for successful casts. Impact radii use the actual ability level too. Server tests cover cancelled wind-ups and packed indices/levels for all 32 abilities.
- **Animations share the motion timeline.** Combat events wait for the same render tick as interpolated unit poses. Previously a new swing could arrive while the unit still looked like it was walking, so the world cancelled it immediately. The event queue reuses its slots. Casts are no longer cancelled just because the unit is moving during a leap. Growth easing uses elapsed time; own-hero walk speed follows current buffs. Health bars and click targets follow the visible model scale.
- **Tooltips show actual effects.** Added damage, healing, duration, slow, armor, radius and other useful numbers from the shared data at the learned level. Unlearned abilities say `Level 1 preview`. A hovered tooltip updates when the ability level changes. Held hotkeys no longer flood commands or toggle camera follow repeatedly; aiming clears when leaving the game.
- **Less combat allocation.** Screen projection reuses its vector and viewport. Homing projectiles write their target into one reusable point instead of allocating one per projectile per frame. Empty layers and native resolution remain unchanged.
- **Dev testing:** F6 gives level 10 and refills health, mana and cooldowns through the existing dev-only server cheat. Production does not bind it.

Browser checks: a second two-player session used Stone Golem and Sky Dragon at level 10, with `?lag=100&loss=2` on the second client. Both long walks to the temple ended at `fixes 0/0`. Cancelling Fire Breath kept mana at 348 with no fire effect; a successful level-3 cast spent 80 mana, showed fire and dealt 154 damage after hero reduction. Mountain Form gave 1785 max HP; Boulder Toss and ordinary attacks dealt damage. Both browser consoles had no warnings/errors at that check. Screenshot: `screenshots/playtest-fire-breath.jpg`.

Validation: 82 tests pass (46 shared, 17 client, 10 server, 9 tools), lint and production build pass. The build also typechecks client/server/shared.

Load-test finding: four real WebSocket test clients, 300 units all around the temple, 20 seconds: average server tick 0.881 ms, maximum 2.857 ms, snapshots 19.4/s, maximum downstream 23.65 KB/s. The tick is comfortably below 10 ms, but this crowded case exceeds the 20 KB/s target. This is a finding, not a fixed bandwidth claim. The ordinary two-hero duel showed about 0.4–0.5 KB/s per browser.

## Cycle 3 — learning while moving

The next two-player session found another movement case: Staff Warrior showed 21 small corrections after learning during the walk, while Huntress stayed at zero. A regression test reproduced a correction without combat. `Learn` was replacing the move command's acknowledgement clock even though the hero kept walking. Protocol 6 now sends a separate movement acknowledgement (two extra bytes per snapshot); learning and server-driven orders cannot reset it. The predictor also finds the next movement command across skipped learning sequence numbers and the 65535 wrap. Delayed acknowledgements cannot overwrite a newer path.

Checks: 60-second walks from all four bases, with and without 100 ms round trip/jitter; learning during the walk; immediate/deferred older acknowledgements across a Learn and sequence wrap. All have zero corrections/snaps in the deterministic tests. The network test harness now preserves TCP command order under jitter. Total: 91 tests, lint and production build pass. Browser retest of this new movement-ack case is still pending.

Ability burst pools now start only when used and stop themselves after their particles fade. They no longer keep ten empty systems updating throughout a match. Native resolution and the 120 FPS limit are unchanged.

The numeric Arcane Arrow tooltip was checked in the browser at level 3: damage 210, length 12, width 1, mana 75, cooldown 9 s. The new HUD text is visible and readable in the narrow viewport too.

## Still checking

- Repeated multiplayer fights, respawn and reconnect.
- Channel interruption, blink, leap visuals and hover descriptions in the browser.
- Crowded-match bandwidth, without lowering snapshot frequency or precision.
