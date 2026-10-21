# Performance and heat pass (Mac) + Windows graphics card

2026-10-21. Mac: Apple M5, Chrome 156, WebGPU, native 3024 × 1562, on battery.

## How it was measured

- **Heat and power** (no sudo needed): die temperature from the Apple HID sensors, whole-system power from the battery (voltage × current), GPU "Device Utilization" from IOKit, CPU per process from `ps`. A 60-second sample after 20 seconds of a fresh solo match at the home base. The Claude desktop app itself used a lot of GPU/CPU during these tests (baseline with Chrome on a blank page: **19.4 W, GPU 58%, die ~64 °C**), so whole-system numbers are noisy.
- **Frame cost**: F3 numbers, and for a fair test a Chrome without vsync (`--disable-gpu-vsync --disable-frame-rate-limit`, `maxFPS` 2000). Then FPS shows the real throughput and A/B changes are made **in the same scene** without a reload (a reload changes the match: more units and buildings each minute).
- **CPU**: Chrome DevTools CPU profile of the game page, 6–8 s.

Important: the WebGPU "GPU passes" number in F3 sums timestamps per render pass. On Apple GPUs passes overlap, so this sum can count time twice. Example: it said the shadow map cost ~3.5 ms, but freezing the shadow map did not raise the uncapped FPS at all, and the map size (512 vs 2048) changed nothing. Use uncapped FPS for A/B decisions, not the pass sum alone.

## Where the time went

| Part | Finding |
|---|---|
| Post-process (HDR target + color grading + FXAA) | The biggest GPU cost. The scene was drawn into a full-screen half-float texture, then two more full-screen passes. Uncapped A/B in one scene: **132 FPS** with it, **~185 FPS** without it (7.5 → 5.4 ms per frame). |
| Shadows | Cheap in practice (map is 21k triangles). Not changed. |
| Trees / decor | Little GPU cost at this view. Not changed. |
| Skeletal animation (CPU) | ~14% of the main thread at 120 FPS: every unit and building with a skeleton was posed 120 times a second. |
| Many army units | Each unit is its own skinned draw. With 84 army units at the base, FPS fell to ~95 even on the M5 (main thread ~50%, Chrome GPU process ~65%). |
| Main menu | Draws the whole map: ~550 draws, 1.7 M triangles, ~5–8 ms GPU per frame at 30 FPS. Costs ~2 W while a player waits in the menu or lobby. |

## Changes

1. **Color grading in the material shaders** (`render/world.ts`, `setupColorGrading`). Same ACES tone map, exposure, contrast, vignette and color curves, but applied at the end of every material shader (Babylon `imageProcessingConfiguration` with `applyByPostProcess = false`). No full-screen copy and no extra passes. Fog of war still runs before it (same order as before).
2. **MSAA instead of FXAA** (`render/engine.ts`, `antialias: true` on WebGPU and WebGL2). On tile-based GPUs (Apple, phones) MSAA is almost free; it also keeps textures sharper than FXAA. Measured cost on the M5: about +0.2 ms.
3. **Skeleton poses at most ~80 times a second** (`main.ts` render loop, `ANIMATION_MIN_STEP_MS = 12`). At 120 FPS poses update every second frame; units, camera and effects still move every frame. Babylon times animations by the wall clock, so speed is unchanged. Same-scene A/B: main thread busy **50% → 41%**.
4. HUD scissor still cuts the top bar correctly on WebGPU (checked with the HUD hidden). The top bar now cuts the swap chain, not a render target; Babylon flips the rectangle for the swap chain.

## Results (60 s each, fresh match at base, 120 FPS cap)

| Run | System power | Chrome CPU | GPU passes (F3) | Die temp avg / max |
|---|---|---|---|---|
| Before (old code) | 33.8 W | 89% | 6.5 ms | 77.4 / 85.7 °C |
| After, run 1 | 33.6 W | 74% | 4.4 ms | 74.3 / 82.8 °C |
| After, run 2 | 32.8 W | 79% | 4.9 ms | 75.9 / 83.4 °C |
| After, **60 FPS cap** | **23.0 W** | **50%** | 5.2 ms | **64.3 / 71.4 °C** |
| Chrome on a blank page | 19.4 W | 3% | — | 64.4 / 73.1 °C |

What this means in plain words:
- Each frame is now clearly cheaper (GPU ~25–30% less, main thread ~18% less). This gives room for big fights and for weaker PCs.
- At 120 FPS the Mac still works hard: the game adds ~13–14 W. The work per frame went down, but the GPU and the 120 Hz display stay busy, so total power dropped only ~1 W in these samples (inside the noise).
- **The FPS limit is the biggest switch for heat**: at 60 FPS the game adds only ~4 W, and the chip is ~11 °C cooler. The user chose 120 FPS earlier; the limit is in Settings → Graphics.

## Windows: the game uses the built-in Intel GPU

Checked in the Chromium source (2026-10):
- `gpu/command_buffer/service/webgpu_decoder_impl.cc`: on Windows, WebGPU always uses the adapter (LUID) of ANGLE's D3D11 device, i.e. the GPU that the whole browser uses. `powerPreference` from the page can not change this.
- `gpu/ipc/service/gles2_command_buffer_stub.cc`: a separate high-performance display for WebGL exists only for ANGLE/Metal (Mac). On Windows WebGL also uses the browser's default GPU.
- `content/browser/gpu/gpu_process_host.cc` + `gpu/ipc/service/gpu_init.cc`: the browser switch `--force-high-performance-gpu` (also `chrome://flags/#force-high-performance-gpu`, Windows only) makes the whole GPU process use the high-performance adapter. Then WebGPU and WebGL both run on the NVIDIA/AMD card.

So **no website code can pick the RTX** in Chrome/Edge on Windows. What we added instead (no Windows settings change):
- `client/src/ui/gpu-hint.ts`: on Windows, when the adapter is Intel (not Arc) or an AMD APU, the main menu shows a small notice "Low FPS on this PC?" with **Get launcher** and **Hide**.
- **Get launcher** downloads `Temple Wars.cmd`, made in the browser with the current server address. It starts Chrome (or Edge, which every Windows 10/11 has) as an app window with `--force-high-performance-gpu` and its own profile in `%LocalAppData%\TempleWars\Browser`. The own profile is needed: switches are ignored when the browser is already running.
- When the game is opened by the launcher (`?from=launcher`) and still runs on Intel, the notice says the PC may not have another graphics card and suggests Low quality.
- Also worth checking on a desktop PC: the monitor cable must be in the graphics card, not in the motherboard. Otherwise Windows treats the Intel chip as the main GPU.

**Not tested on Windows** (no Windows PC here). The source code shows the switch works this way, but the user must confirm: run the launcher, press F3, the adapter should say NVIDIA.

Next options if the user wants no extra step at all: a real desktop app (Electron, ~100 MB, can set the switch itself; needs code signing to avoid the Windows "unknown app" warning, which costs money). This is the user's choice.

## Next steps (not done)

- **Baked vertex animation + instancing for army units** (CLAUDE.md asks for it): one draw per unit type instead of one per unit, no CPU skeleton work. This is the fix for big fights and for weak PCs.
- Cheaper main menu background (lower resolution or fewer FPS behind the menu).
- Optional "60 FPS on battery" setting (Chrome has `navigator.getBattery()`).
