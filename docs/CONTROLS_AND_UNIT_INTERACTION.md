# Browser controls and unit interaction

Later client updates: [captured game cursor and HUD context-menu handling](CAPTURED_GAME_CURSOR.md), [GPU adapter diagnostics](WINDOWS_RENDER_PERFORMANCE.md).

Branch: `codex/camera-unit-interaction`. Game commit: `769607f`. Protocol: **10**; deploy client and server together.

## Changes

- Camera bounds now account for the rendered 64-unit mountain apron. The old clamp pushed the camera inward and prevented looking left at the west base. Wider 32 px edge zones avoid having to hit the browser's exact content boundary.
- Middle-mouse drag and **Alt + left drag** capture the pointer, work inside a normal browser window and cancel follow. Arrow keys, wheel zoom, Space / double Space and the minimap remain available. Editable fields keep their keys. Blur, pointer cancellation and Settings clear camera input.
- The hero panel has an explicit skill row; four skills stay inside the window. Skills show **Learn +**, **Level 6**, **Not learned** or **Passive**, with an accessible name and current blocking reason. Unlearned skills still need a skill point and `+` or Ctrl + key. Passive/aura skills work automatically after learning; they are not missing casts.
- Music starts at **0%**, including a one-time migration of older saved music settings. A music level explicitly saved with the new version is preserved.
- Moving units have soft contact shadows, including flying units. They use one shared instanced layer and respect the Shadows setting. Existing directional shadows remain for heroes/buildings; ordinary soldiers do not add shadow-map caster draws.
- Units have soft translucent ground areas in their owner color; neutral monsters use muted brown. Layers are batched by color. Materials are warmed after post-processing is configured, while loading, rather than compiling on the first spawn.
- Left-click either the body or its ground area to inspect name, owner/relation, actual health/mana and base combat stats. Base stats are labeled because the network does not expose every enemy item/buff modifier. Hidden miners and dead units cannot be selected.
- Right-click enemies to attack; right-click living allied units/heroes to follow. Follow runs on the server, updates paths at most twice per second, keeps a gap, and ends on a new order or lost/dead/hidden target. It never grants orders to the AI unit. This adds one command, not a stream of client move requests.
- **Your Kingdom** now sits in the top HUD with match time, hero gold, faction resources, supply, tier, workers, army and current AI task. The AI also sends its actual army-supply target for the next attack, even while saving for a building. There is no fabricated attack countdown: defense, casualties, travel and income can change the timing. Click Your Kingdom to view the base; hover the task for a short suggestion.
- Fullscreen is available in Settings and the match header, as well as the menu / F11.
- Added an installable web manifest and icons derived from the existing original crest. Supported browsers offer an Install button; otherwise Settings explains Safari Add to Dock and Chrome/Edge installation. Standalone mode removes browser chrome; online matches still require the server. This is a PWA, not a native desktop executable.

## Verification

- **232 local tests**, lint and build/typechecks pass. Camera regression covers all four edge directions, the west-base clamp, Alt drag, pointer release and stale input after Settings. Server tests cover following a moving ally, hold cancellation, invalid enemies, visibility and target death; the follow command has a binary round-trip test. Settings tests cover the music migration.
- Local browser, WebGL2, native **2560 × 1440**, **120 FPS cap**: left pan now reaches the mountain edge and shows the base; worker ground selection shows the info card; right-click reports Following Worker and moves the hero; Stone Golem W consumed mana and started its cooldown; Sky Dragon Q consumed mana, while E correctly shows Passive. Fullscreen changed the framebuffer to 3024 × 1898 and back; Settings showed music at 0%.
- A short local view sampled 120/120 FPS, CPU 2.0–2.4 ms and GPU 1.9–2.7 ms. These are individual views, not a full-army or thermal benchmark. Long-running solo base view reached ~215 draws, CPU 3.8 ms and GPU 2.9 ms at 120/120.
- Cold WebGL2 load with marker preparation completes without captured shader errors. An early warm-up placement was corrected before release.
- Screenshot: [Dragon, shadows and ability HUD](screenshots/controls-dragon-hud.jpg).

## Deployment and remaining checks

Release **`controls-769607f`** is live at https://render-telecom-pending-elizabeth.trycloudflare.com/ on the supplied VPS. Both client and server use protocol 10. The server container is healthy and the existing unrelated services are still active. Full static client package: **21,913,788 bytes** before compression; asset manifest: 14,403,575 bytes.

[Final CI run 39506521172](https://github.com/Acheron1232/game2/actions/runs/39506521172) is green: 232 tests, lint, data validation, build, a full headless bot match and 60 seconds of Chromium play. The browser regression also checks that all four ability slots remain within the viewport and fails on console errors.

Production checks: WebGPU + WebGL2 clients joined a three-slot match (two allied humans and one enemy bot), loaded and started over WSS. Forest Spirit learned through the UI and summoned a tree guardian; health/mana/cooldown and allied-hero HUD updated. The final WebGPU release was rechecked in a fresh match: native 2560 × 1440, about 120/120 FPS, CPU 2.6–3.0 ms in the inspected base view; left edge scrolling, complete west-base camera view, Worker selection/card, right-click Follow and S to stop worked. Final Settings show Music 0%, High/native render scale and fullscreen. No new warning/error entries after the final reload. Leaving removed the test room/match.

WebGPU verification caught an incomplete manual loading frame (destroyed swapchain texture and black models). The warm-up now brackets the loading render with engine beginFrame/endFrame. The final public view shows normal hero/building materials; the discarded intermediate deployment is not the delivered release.

Evidence: [live unit card and summoned guardian](screenshots/controls-live-unit-info.jpg), [settings](screenshots/controls-settings.jpg).

The accepted temporary HTTPS/WSS address is retained. Restarting the Cloudflare tunnel can change its hostname, which also changes the installed app's origin.

Actual app installation on Windows and Safari Add to Dock were not automated; installation UI depends on the browser. The native middle/Alt drag path has input regression coverage, while the browser interaction check used arrows and screen-edge movement. A 300-unit GPU/temperature soak and every hero's full PvP kit remain separate qualification work.

References: [Safari Add to Dock](https://support.apple.com/en-gb/104996), [Edge website apps](https://support.microsoft.com/en-us/edge/install-manage-or-uninstall-apps-in-microsoft-edge), [installable PWAs](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable).
