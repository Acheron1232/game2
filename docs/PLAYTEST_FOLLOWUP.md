# Follow-up playtest — 2026-10-20

Branch: `codex/playtest-followup-polish`, based on `2c6d75b`. The working copy had no additional changes when this pass started. Scope: further fixes to the existing game; no missing phase systems, new textures or lighting redesign.

## Verified fixes

1. **Bounded prediction command history.** The previous pass flagged this for investigation. A new test reproduced 2,000 retained command entries with zero position corrections. Pruning now happens when new movement input runs, independently of errors. The latest movement clock remains available through idle time and learning. Tests cover the retained-history bound, idle reconciliation and an entire 65,535-command sequence cycle followed by reuse. Reused sequence keys take their new chronological position.
2. **Cloned skeleton lifetime.** A real Babylon AssetContainer/NullEngine regression test reproduced a skeleton left in the scene after disposing a model. Model instances now dispose their complete instantiated entries, including skeletons and bone buffers, rather than only their root and animation groups. Ten repeated spawn/play/dispose cycles return meshes, transform nodes, skeletons and animation groups to baseline; shared materials survive. This also applies to loading warm-up copies and summons. It is not a long-session heap measurement.
3. **No GPU upload for empty health-bar layers.** Empty layers remain hidden and skip their matrix-buffer upload. A test checks that empty layers upload nothing and upload again when populated. Resolution, bar detail and frame cap are unchanged.
4. **No walking in place while rooted/stunned.** Two simulation tests reproduced `Moving` remaining set because a frozen hero still had a queued path. Snapshot state now separates an immobilized hero from its preserved route. The route resumes after the effect expires. Crowd-control flags are collected in one buff pass.

## Validation

- All **108 tests pass**: 49 shared, 40 client, 10 server and 9 tools. Lint and production build/typechecks pass.
- Browser sessions used WebGPU at native 1362 × 1544 and WebGL2 at native 2560 × 1440 with `lag=100&loss=2`. This dev option delays some messages; it does not drop reliable WebSocket messages.
- Forest Elf level-3 Forest Spirit created two guardians. The 300-copy client render stress mode was exercised; this is shared-animation test geometry, not 300 simulated fighting units.
- Centaur Raider and Blood Witch walked to the temple while learning, then fought. Initial walks had `fixes 0/0`; approaching into contact later showed two and one small corrections respectively, with zero snaps. Ordinary duel traffic was about 0.4–0.5 KB/s. Do not interpret collision corrections as a promise of zero corrections in combat.
- This browser environment reported about 30 rendered FPS while the game cap remained 120, both before and after the changes. This pass does **not** establish foreground 120 FPS. Native rendering and `GAME_FPS = 120` were preserved.

## Performance findings still open

The 300-unit center load test uses four real WebSocket test clients and 384 total server entities. A run concurrent with build/tests was contaminated by CPU contention: average tick 9.847 ms, max 320.222 ms, snapshots 18/s, downstream max 23.05 KB/s. It is not a fair before/after benchmark.

A repeat after build/tests finished, with the game browser sessions still open, measured average tick **4.312 ms**, maximum **130.697 ms**, snapshots **18.9/s**, downstream maximum **23.39 KB/s**. The maximum tick exceeds the 10 ms target and downstream exceeds the 20 KB/s target. This differs from the previous pass's lighter run; there is no established cause or controlled same-seed comparison yet. Do not claim that the server tick or crowded traffic budget is solved. An isolated, repeatable profile is still needed.

Other limits: no sustained temperature/fan/power measurement, no weak-laptop or long soak test, and no forced GPU device-loss recovery. Remote animation speed under changing buffs and the range preview for clamped movement abilities remain candidates for another pass; they were not fixed here. The wire format remains protocol 6.
