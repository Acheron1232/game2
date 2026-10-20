# Visibility and render budget

2026-10-21 · Branch `codex/visibility-render-budget`

Scope: requested priorities 1, 2, 3, 6 and 7. No grass chunk changes or baked soldier animation/instancing (priorities 4 and 5). The match keeps its 120 FPS cap, native High resolution, HDR color grading, FXAA and shadow quality.

## Changes

- Keep logical/interpolated positions current for prediction, vision, sound, targeting and the minimap. Skip model transforms and skeletal evaluation outside a conservative camera frustum with an extra margin for tall models, jumps, particles and shadow casters. Remove stopped off-camera clips from Babylon's active animatable list; restore their wall-clock phase on return. Expired one-shots clamp to their end; logical death/mining/respawn state remains independent of camera visibility.
- Suspend off-camera hero ambience and glow updates. Hidden menu Town Hall/mine copies also stop their idle clips during matches. Visible combat effects retain their existing quality.
- Omit off-camera ground areas/contact shadows, buff markers and health bars. Ground-instance buffers upload only when Float32 matrix values change. Count/visibility changes still apply, including clearing all instances and toggling shadows.
- Scissor the main 3D draw under the top HUD, without changing the canvas, viewport, projection or picking coordinates. The textured top bar has an opaque dark base; eight CSS pixels of overlap protect filtering at its bottom edge. Its ~80 px height skips ~72 px of main-scene shading (10% of a 720 px view). The transparent bottom gaps, shadow target and full-screen post-process passes remain rendered. This is not a 10% whole-frame/GPU promise.
- Cache the shadow map when the light projection and all casters are unchanged. Invalidate for view changes, additions/removals, scale/construction/hidden-state changes and shadow settings. Visible skeleton casters always refresh, even while idle, so their shadows do not freeze. Babylon's refresh-rate setter resets the counter even when assigned the same value; it is therefore set only once rather than every frame.
- F3 shows visible/total unit counts plus CPU animation and render-target time. Its tooltip separates shadow, image-processing and FXAA CPU/driver submission measurements. Pipeline-owned camera passes are included and target wrappers are deduplicated for the existing approximate WebGPU GPU sum. These are not CPU measurements of GPU execution. Hidden diagnostics stop their queries and timing samples.
- Settings renders the underlying live match at 30 FPS. Online ticks continue; returning restores 120 FPS. Menu stays at 30; hidden tabs already skip scene rendering.

## Measurements

Manual full-Chromium hardware test on Apple M5 / ANGLE Metal, WebGL2, 1280×800 native, High, 120 cap. Added 300 **independent real skeletal swordsmen**, all well outside the camera. Froze visual logical sampling for the comparison; server continued normally. Toggled only the visibility predicate to compare all-unit visual work against camera culling. This is an isolated A/B of the culling change, not two full production releases or a 300-unit visible battle.

Each case discards 120 warm-up frames and averages 240 complete scene frames (before animations through after post-processing). Repeat order A/B/A:

| Case | Mean scene CPU | Active animation targets | Visually updated units |
| --- | ---: | ---: | ---: |
| Culling bypassed A | 6.158 ms | 19,221 | 311 |
| Camera culling B | 2.757 ms | 2,121 | 11 |
| Culling bypassed A again | 5.598 ms | 19,278 | 312 |

B is about **53% less CPU scene time** than the mean of A runs; active target count drops about 89%. One additional normal server unit arrived before the final A sample. These numbers do not estimate whole-system energy, temperature, fan speed or the result of 300 visible units.

Run again: `GAME_PROFILE=1 pnpm exec playwright test e2e/render-profile.spec.ts`. This manual profile is skipped in normal CI; timing is not a flaky pass/fail threshold.

Native in-app Mac checks at 2560×1440: both WebGL2 and WebGPU reached a displayed 120/120. Camera away showed 0/11 visual units; returning restored them. Settings showed 30/30 and returned to a 120 cap. A WebGPU sample showed shadow CPU submission ~0.14 ms and image-processing / FXAA ~0.01 ms each. GPU execution for those individual passes was **not** separately measured. Do not interpret these small CPU figures as GPU cost.

The main-draw scissor initially clipped the wrong edge on WebGPU RTTs. Corrected for Babylon's RTT Y-flip and visually checked both backends; the final screenshot has no blank strip at the bottom. The same projection and native dimensions are retained.

## Verification

- Logic coverage: real Babylon frustum/camera teleport, stopped/resumed clip phase, scale, hidden-unit state, one-shot end pose, unchanged mark buffers, empty/reused marks and shadow toggle; actual RenderTargetTexture refresh-rate setter and invalidation; scissor scope/native coordinates on both backend paths.
- Browser regression: real loaded models move out of and back into the camera, off-camera animations stop, returned transforms/meshes restore, Settings retains advancing server ticks at 30 FPS and returning restores 120/native. Both default and forced-WebGL URLs checked.
- 244 logic tests pass (154 shared, 64 client, 17 server, 9 tools). Lint and build pass. Four browser regressions pass, including native captured input and the High/native 60-second match; the separate manual hardware profile also passes.
- Screenshot: [WebGPU match](screenshots/visibility-render-budget.png).

## Limits

No claim that Mac heating is eliminated: no power or temperature measurement was made. Full-screen HDR/FXAA inputs change every match frame, so their output is not cached or disabled. Static shadow caching is deliberately conservative and has little benefit while a visible hero casts an animated shadow. Ordinary off-camera logical position sampling still runs because simulation-facing consumers need it. Native Windows/RTX and a long crowded live battle remain useful follow-up measurements.

## Publication

Frontend `visibility-4ce621f` is published at the accepted temporary HTTPS address. New dependencies were copied before atomic entry-point replacement; previous hashed assets remain available for already-open clients. Rollback copies are retained in the release directory. Server `controls-769607f`, web container and tunnel were not restarted. Public index SHA-256 matches the local build: `bb2e44def29949797d78fa9ce741b8f3a94f481825bd61e0f0a768c723181645`.

Public WebGL2 and WebGPU matches both started and reached displayed 120/120 at 2560×1440. WebGL camera culling, return, Settings 30/30 and return to 120 were checked; WebGPU has no blank scissor strip and its captured warning/error log is empty. Test clients explicitly left their rooms. Health returned to the prior 0 players / 1 room / 1 match with continuous server uptime. [Public WebGL check](screenshots/visibility-render-budget-live.png).

CI [39517594041](https://github.com/Acheron1232/game2/actions/runs/39517594041) **passes** on source commit `4ce621f`, including data checks, all logic tests, lint/build, the full bot match and all four browser regressions.
