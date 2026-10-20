# Captured game cursor

2026-10-21, branch `codex/captured-game-cursor`. Client-only change; protocol 10.

The browser owns its fullscreen exit controls. The game cannot remove them with CSS. The new **Capture mouse** button in the match header requests Pointer Lock and draws the existing game cursor inside the viewport. Relative mouse motion moves this cursor, so reaching the top edge does not move the physical pointer over browser controls. This is opt-in, works with fullscreen or a normal window, and does not alter graphics quality or the 120 FPS cap.

## Controls and behavior

- Enter fullscreen with the existing button if wanted, then click **Capture mouse**. Browser permission/entry notices may still appear briefly. **Esc** or **Release mouse** releases the cursor.
- The virtual cursor keeps normal map selection, secondary-click orders, HUD buttons, skill learning, item dragging, minimap input and hover tooltips. It sends events to the element under its CSS-pixel position; it does not send extra network commands per frame.
- Edge scrolling uses the virtual position. Middle mouse / Alt + left pan uses relative movement while locked, including after the visible cursor reaches an edge.
- Settings, chat/text editing, another screen, window blur, hidden tabs and leaving fullscreen release the lock. Pressed inventory/camera/minimap drags are canceled on release. Returning to the game requires a fresh click to capture again.
- HUD clicks keep keyboard focus on the canvas while captured, so Space still centers the hero and Enter still opens chat after clicking an ability.
- The browser's standard escape mechanism remains available. Unsupported or denied capture shows a message and leaves ordinary mouse/keyboard controls working.
- The previous branch `codex/hud-mouse-menu` cancels browser context menus throughout the game HUD, including decorative regions. Native text-editing menus remain available in chat, and shop secondary-click handlers still run.

## Verification and limits

The browser test uses the real Pointer Lock API in full Chromium's current headless mode (`channel: chromium`), rather than faking a successful lock. The older headless-shell binary and Codex's embedded browser rejected capture on this Mac; their failure path was checked. The full Chromium test checks fullscreen entry, capture, cursor clamping at the top edge, ability hover/learning, moving a potion between inventory slots, drag cancellation, Settings/chat release and Escape release. A camera regression check verifies that relative panning continues when the visible cursor stops at its edge.

237 logic tests, lint and build pass. The native cursor test and 60-second live-match browser test pass locally. The initial HUD-only CI run timed out while making many UI/trace round trips on its software renderer; context-menu assertions were batched into one browser evaluation, preserving all ten HUD checks and the chat exception. An initial local logic run also exceeded existing timing budgets while browser tests/build were competing for CPU; a separate run passed without weakening those budgets. Screenshot from the real captured-cursor test: [captured cursor](screenshots/captured-game-cursor.png).

The first Linux native-input CI run granted real pointer lock and moved the cursor to its upper bound, but a bounding-box query exceeded its five-second assertion deadline while the software renderer was saturated. The input test now uses a separate browser context with Low/50% graphics, in-viewport driver movement and a 15-second UI assertion deadline; this also verifies CSS-pixel input independent of render resolution. Default game settings and the separate High/native 60-second match smoke are unchanged. Native fullscreen input also passed locally with the original High/native settings before this CI adjustment.

Frontend release `cursor-7f389a3` is live on the existing HTTPS URL. Its HTML hash matches the local build; `/frontend-release.json` identifies the frontend revision. Static files were replaced atomically, retaining prior hashed assets and rollback copies. Server `controls-769607f` and the tunnel were not restarted. A separate public solo match verified the new HUD and left/right panel clicks, then was explicitly left; the existing human match remained running. Public Mac WebGL2 sampled 120/120 FPS at native 2560 × 1440, CPU 1.6 ms, GPU 3.9–4.2 ms with capture off. Embedded-browser capture denial was handled without console warnings/errors. Actual locked input was tested in full Chromium, not in the embedded preview.

Final [CI run 39514474982](https://github.com/Acheron1232/game2/actions/runs/39514474982) passes: data validation, 237 logic tests, lint/build, a full bot match and both Chromium browser tests, including native fullscreen pointer lock on the Linux runner. This verifies the final game code plus the corrected CI input test.

Windows Chrome/Edge, Firefox and Safari still need native-device checks, especially browser permission UI and OS-level transitions. Do not claim that browser notices are removed or that every browser grants Pointer Lock. The game retains ordinary controls when it does not.

References: [Fullscreen UI requirements](https://fullscreen.spec.whatwg.org/#security-and-privacy-considerations), [Pointer Lock API](https://developer.mozilla.org/en-US/docs/Web/API/Pointer_Lock_API).
