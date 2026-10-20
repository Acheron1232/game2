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

## Cycle 4 — four browser clients, leaps, rejoin and zones

- Four real browser clients joined one room: Huntress, Staff Warrior, Forest Elf and Light Healer; three WebGPU clients and one WebGL2. Staff Warrior used 100 ms simulated round trip plus 2% delayed messages. Movement and skill learning were issued together. All four later showed `fixes 0/0`, confirming the cycle-3 fix in the browser. Death and respawn were observed for Huntress and Forest Elf; level, skills and HUD survived.
- **Leap attachments (fixed).** Sky Pillar exposed a health bar left down near the ground while the model jumped. The model, bar, buff markers, picking and homing projectile targets now share the visual altitude, including the leap arc and flying bob. Compared screenshots: `screenshots/playtest-sky-pillar.jpg` and `screenshots/playtest-sky-pillar-fixed.jpg`.
- **Rejoin during a walk (fixed).** A new client has no local path history. A moving own hero now starts in server-motion mode until its next local move, rather than correcting an idle predictor every snapshot. A snapshot-to-command regression test covers this handover. A WebGL2 client was reloaded during a walk and rejoined with `fixes 0/0`. Disconnect still sends the hero home, as in Phase 6.
- **Ground zones are easier to read.** Thinner edges and less opaque fills keep the ground and units visible. Arcane Storm was cast and cancelled by a move in the browser; the zone disappeared. A timed render-resource test confirms that ending a caster's zone hides it within 0.3 s rather than its full four-second life. Before/after: `screenshots/playtest-arcane-storm.jpg` and `screenshots/playtest-arcane-storm-refined.jpg`.
- **Latency queues across reconnect (fixed).** Regression tests reproduced an old snapshot delivered after disconnect and an outdated client trying to reconnect after a delayed protocol error. Incoming/outgoing delayed queues now clear on disconnect, replaced sockets cannot update the new connection, and the handshake finishes before game latency simulation starts. A third test verifies that old commands never leak into a replacement socket.
- **Terrain rebuild metadata.** Babylon's per-mip upload also replaced its base-data reference with the final tiny mip. The terrain keeps the full upload reference ready before device rebuilds. An actual GPU device-loss/recovery cycle has not been forced or verified.

Validation: 96 tests, production build (including typechecks) and lint pass. Browser consoles checked during the four-client session had no warnings/errors. Native buffers and the 120 FPS match limit remain unchanged. The extra browser tabs are test clients, so their combined load is not a single-player thermal benchmark.

## Cycle 5 — target feedback, projection and minimap control

- **Wrong targets no longer fail silently.** Client aiming uses the same ally/enemy/self and air-layer filter as the server. Invalid unit targets keep aiming active, tint the ring red and say `Pick an enemy.` or `Pick an ally.`. Dead and silenced heroes get a short message. Aiming clears on death. Shared tests cover healing allies/self, rejecting enemies/self and ground/air/low-air rules.
- **Projection regression caught and fixed.** The no-allocation screen projection from cycle 2 chained `Viewport.toGlobalToRef`, but Babylon returns the original normalized viewport rather than the filled target. Picking and floating numbers were projected near the screen corner. The target viewport is now passed explicitly. Three regression cases check real Babylon projection in CSS pixels at DPR 1, 2 and 3, including a raised point. Browser picking was retested on the own hero and camp enemies.
- **Minimap control.** Clicking the minimap now leaves camera-follow mode. Right-clicking it while aiming cancels aim, matching the main view. The camera stayed on the temple after a minimap click while following a hero.
- **Less aiming and team-lookup allocation.** Reused aim shapes, target point, mesh lists and tint colors. Cached the fixed owner/team lookup and floating-text projection callback instead of rebuilding callbacks during frame work. Entity movement layers no longer require a temporary full stats object.

Browser proof: Huntress level 1 cast Mana Mark on herself: `Pick an enemy.`, red rings, no mana spent. A real bandit accepted the cast, showed the mark and cooldown, and spent mana. Camp combat showed **120/120 FPS**, native **1362 × 1544**, about **2.4–2.5 ms CPU**, 0.5 KB/s and `fixes 0/0` in the sampled view. The earlier 30 FPS observations were made with multiple browser surfaces running; they were not a lowered game limit. These are short observations, not a weak-laptop or temperature guarantee. Screenshots: `screenshots/playtest-invalid-target.jpg`, `screenshots/playtest-camp-combat.jpg`.

Validation: **100 tests pass** (47 shared, 34 client, 10 server, 9 tools), production build/typechecks and lint pass. All changes remain in the isolated branch.

## Cycle 6 — Blink departure and late ability checks

- **Blink departure effect (fixed).** Local prediction could already draw the hero toward the destination when the cast event reached the render timeline. The departure burst now uses the caster position captured at the server cast tick. Before/after: `screenshots/playtest-blink-before.jpg` and `screenshots/playtest-blink-fixed.jpg`. The level-3 browser cast spent 50 mana (396 to 346), started its eight-second cooldown and kept `fixes 0/0` at 120 FPS.
- **Availability can change while aiming (fixed).** Hotkeys, aim coloring and the final target click share the same readiness checks. A caster who becomes stunned, silenced, dead, short of resources or on cooldown gets feedback before a command is sent. Two tests cover those transitions. In a real two-player duel, Golem stunned an already-aiming Huntress: the next click showed `Can't do that now.`, kept the red aim rings and spent no mana or cooldown. Screenshot: `screenshots/playtest-stunned-aim.jpg`.

Final validation: **102 tests pass** (47 shared, 36 client, 10 server, 9 tools), lint and production build/typechecks pass. The final sampled two-player view showed native 1362 × 1544, 120/120 FPS, 3.7 ms CPU, 0.4 KB/s and `fixes 0/0`. The own test match was ended and the extra player tab closed. The audit stopped at the user's request; no new phase features or textures were added, and the branch has not been pushed or merged.

## Remaining findings and limits

- The crowded 300-unit **server-only** load case exceeds the downstream target: 23.65 KB/s versus 20 KB/s. It does not measure browser rendering of 300 fighting units.
- No sustained temperature, fan or power measurement, weak-laptop run, or long soak test was completed. Short 120 FPS samples do not establish a thermal improvement.
- Actual GPU device loss/recovery was not forced; only the terrain rebuild metadata was corrected.
- Final code inspection found that predictor command-history pruning depends on reaching the correction path. A long session with near-perfect prediction may retain old entries; memory bounds and sequence-wrap behavior deserve a focused regression test. This is an inspection finding, not a reproduced or fixed gameplay bug.
- The existing ability visuals are still provisional. This pass fixes timing, alignment and readability; a complete art, sound and effects pass remains future work.
- The snapshot protocol is now version 6. Client and server must be updated together when these changes are deployed.
