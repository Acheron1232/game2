# Quality of life implementation plan

Goal: make the existing game menus and commands clearer and easier to use.
Style: retain dark stone, wood and gold, as chosen by the user.

- [x] Keep lobby row controls mounted during load/ready updates. Replace the hero dropdown with a dialog containing three portrait cards per row, names and Random. Keep host bot editing and server rules.
- [x] Give the title a readable gold fill. Style settings choices, sliders, switches and focus states. Keep native keyboard input and saved settings. Hide diagnostics by default; retain F3.
- [x] Add one reusable green ground ring with an arrow on move clicks, including the minimap. Warm its material during loading and fade it without frame allocations.
- [x] Open a backpack context menu on RMB. Offer drop at the hero's feet and a recipe view with parts and direct upgrades. Recipe browsing is read-only; existing server commands handle drops. Close stale menus and support Escape/outside click.
- [x] Verify loading controls with a held asset request, test recipes and drop in a real match, inspect screenshots, run build/lint/tests and browser smoke checks. Record results and remaining limits in PROGRESS.md. Suggest one commit; do not deploy.

Review focus: loading must not reset controls; only own/bot heroes are editable; recipe-only browsing must not buy/use; empty or changed slots must close menus; markers must use game-to-world Y inversion and expire.

## Follow-up: smaller feedback

- [x] Research the Dota 2 move click and build an original small three-arrowhead flash.
- [x] Replace recipe modal with a compact hint anchored beside the inventory slot, keeping capture, scrolling and game input.
- [x] Verify final browser views, build, lint and all logic tests; update progress.
