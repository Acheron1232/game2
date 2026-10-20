# Windows graphics investigation

2026-10-21, branch `codex/windows-render-performance`.

The user reports stable 120 FPS on a Mac and 40–54 FPS in Windows Chrome on a PC with an RTX 3060. Reported Windows sample: 1920 × 868, scene CPU 5.0 ms, 160 draws, 544k triangles, ping 46 ms. After trying the WebGL comparison URL, the user reports GPU 15 ms with unchanged FPS. The renderer name and selected adapter still need confirmation.

15 ms of measured GPU work exceeds the 8.33 ms budget for 120 FPS. The CPU number measures scene rendering, not the whole browser main thread; it cannot rule out other CPU work. Neither the triangle count nor the installed graphics card proves which adapter Chrome is using. No Windows hardware was available for direct testing. **The Windows FPS issue is still open.**

## Changes

- Request `high-performance` in both engine paths. WebGL already had this Babylon default; WebGPU previously supplied no preference. This is a browser hint, not a guarantee that the discrete GPU will be selected.
- Request only the optional `timestamp-query` WebGPU feature. Babylon 9.29 filters unsupported requested features before creating the device. Do not enable all optional features.
- Use WebGPU render-pass counters. Babylon's legacy whole-frame counter depends on `GPUCommandEncoder.writeTimestamp`, which is unavailable in the tested browser. Merely requesting the timestamp feature still produced no frame timing. F3 now labels the sum as **GPU passes**; it is an approximate sum of render-target/main-pass averages, excluding uploads, compute work, presentation and browser scheduling. WebGL retains its whole-frame timer. Hidden diagnostics stop querying in both paths.
- Show the adapter information exposed by the actual engine in F3. Long descriptions are shortened on screen; the complete text is in the tooltip. A browser may redact the exact GPU model.
- Keep the selected resolution scale across resize/fullscreen/monitor DPR changes. Previously the resize handler silently restored native scale even after selecting Medium/Low. High remains native resolution. The 120 FPS match cap is unchanged.
- Try disposing failed WebGPU initialization before WebGL fallback; partial-initialization cleanup errors do not prevent fallback.

## Verification

- 237 Vitest tests (154 shared, 57 client, 17 server, 9 tools), including adapter options, forced WebGL, resolution retention across DPR changes and failed-device cleanup/fallback.
- Build/typecheck and lint pass.
- Local Mac WebGPU: native 2560 × 1440, 120/120 FPS, scene CPU 3.2 ms, GPU passes 5.3 ms in a base sample. Adapter `apple / metal-3`. No captured warnings/errors.
- Local Mac WebGL2: native 2560 × 1440, 120/120 FPS, scene CPU 2.1–2.5 ms, GPU 2.0–2.3 ms. Adapter exposes Apple M5 via ANGLE. No captured warnings/errors.
- These are startup/regression samples, not identical-scene cross-platform benchmarks or a measured Windows speedup.

## Next Windows check

After reloading the updated frontend, record the complete F3 line including renderer and adapter. Compare the same camera, match time and army on WebGPU and `?webgl`. If the adapter is integrated or software, inspect Chrome's graphics acceleration and the Windows app GPU preference before changing visual quality. If it is the RTX 3060, use GPU profiling and controlled shadow/render-scale comparisons to find the expensive pass. Do not infer that the issue is fixed from a successful Mac check.

Reference: [MDN: requestAdapter and powerPreference](https://developer.mozilla.org/en-US/docs/Web/API/GPU/requestAdapter).
