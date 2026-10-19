# 2D Asset List (Phase 3)

All 2D art for the MVP, grouped into **sheets**. One sheet = one Codex image call.
Machine-readable list: `tools/art/sheets.json`. Prompts: `tools/art/prompts/` (every prompt starts with `_style.md`).

**Rule: more pictures per sheet, smaller pictures.** Codex always returns about a 1254 × 1254 image, so a denser grid means smaller cells and fewer calls. Cells of ~150 px are enough for a low-poly game in the classic RTS style (textures and icons ship at 128 px, small UI pieces at 96 px). This keeps the Codex usage low and the download small.

## How a sheet becomes game files

```
pnpm --filter @game/tools art:gen <sheet>       Codex makes art/raw/<sheet>.png        (costs one image call)
pnpm --filter @game/tools art:process <sheet>   cut the grid → clean each cell → WebP  (free, can run again any time)
```

- Cutting: the tool looks for the dark grid lines near where they should be; if it can not see one, it splits evenly.
- `tile` cells are made seamless, `sprite` / `frame` / `concept` cells lose the background (green or transparent), magenta becomes grey + a `_team` mask (white + alpha).
- Clean full-size cells: `art/source/<sheet>/<cell>.png` + `_contact.png` (all cells on a checkerboard, for review).
- Game files: UI → `client/src/assets/ui/` (bundled by Vite), everything else → `client/public/assets/<folder>/` + `manifest.json`. Foliage and effects are packed into atlases.
- Format: **WebP** for now (KTX2 tools are not installed; switch when `toktx` is available).

## Sheets

| # | Sheet | Grid | Cells | Cell size → shipped | What | Goes to |
|---|---|---|---|---|---|---|
| 1 | `ui_kit_a` ✔ done | 4×4 | 16 | ~310 → 64–256 px | Wood, stone, parchment, iron textures; panel frame; buttons; slot and bar frames; ornaments; banner; crest; cursor; gem | `client/src/assets/ui` |
| 2 | `textures` ✔ done | 8×8 | 64 | ~155 → 128 px | 32 ground tiles (grass ×8, dirt ×8, stone / sand / water ×8, rock ×8), 16 building and tree materials, 16 character materials | `assets/terrain`, `assets/materials` |
| 3 | `sprites` ✔ done | 8×8 | 64 | ~155 → 96 / 128 px | 36 UI pieces (frames, tooltip, 6 cursors, resource and stat icons, bars, rings, lock) + 28 nature cards (grass, flowers, bushes, leaf clusters, rocks, stump, log, decals) | `client/src/assets/ui`, `assets/foliage` (atlas) |
| 4 | `icons` ✔ done | 9×8 | 72 | ~140 → 128 px | 32 hero abilities + 4 commands + 23 items + 9 upgrades + 4 service icons | `assets/icons` |
| 5 | `portraits_effects` ✔ done | 8×8 | 64 | ~155 → 128 px | 24 portraits (8 heroes, 8 units, 8 monsters) + 10 effects × 4 frames (fire, smoke, spark, arcane, heal, blood, dust, nature, frost, lightning) | `assets/portraits`, `assets/effects` (atlas) |
| 6 | `heroes_concept` ✔ done | 6×4 | 24 | ~210 × 310 | 8 heroes × front / side / back | `art/source` only (model reference) |
| 7 | `world_concept` ✔ done | 6×6 | 36 | ~210 | 8 army units, 12 monsters, 16 buildings | `art/source` only |

**Total: 7 Codex image calls** (was 17 before we made the grids denser) for 340 assets, all done 2026-10-19, no fix sheets needed. Shipped 2D art: 2.7 MB.

Portraits that share a picture: Alpha Wolf uses Grey Wolf, Bandit Archer uses Bandit, Troll Shaman uses Forest Troll, Harpy Matron uses Harpy, Ogre Warlord uses Ogre Brute (tinted / framed differently in the HUD).

## Risks of dense grids

- With 64–72 cells the model may miscount a row or column. The cutter finds lines that are a bit off, but not a missing row. **Check `_contact.png` after every sheet**; if the count is wrong, fix the prompt and run that sheet again.
- We start with `textures` (the most regular sheet) as the next test.

## Not in this list (on purpose)

- Unique UV textures for 3D models — image models can not paint to a UV layout. Models use the material swatches (sheet 2) through a small palette atlas (Phase 4).
- Sound — Phase 9.
