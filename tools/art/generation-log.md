# Codex image generation log

Every `pnpm art:gen` call. Failed calls that made no image (and cost nothing) are noted too.

## 2026-10-19 — ui_kit_a, failed tries (no image)
- Default model `gpt-6.1-sol`: refused ("not supported when using Codex with a ChatGPT account").
- `gpt-6-astra`: refused ("requires a newer version of Codex").
- Then `gpt-5.6-sol` worked (below). `pnpm art:gen` now uses `gpt-5.6-sol` by default.

## 2026-10-19 17:03 UTC — ui_kit_a
- Output: `art/raw/ui_kit_a.png` (2229 KB, 66 s)
- Prompt file: `tools/art/prompts/ui_kit_a.md`

## 2026-10-19 17:16 UTC — textures
- Output: `art/raw/textures.png` (3497 KB, 99 s)
- Prompt file: `tools/art/prompts/textures.md`

## 2026-10-19 17:18 UTC — sprites
- Output: `art/raw/sprites.png` (2897 KB, 68 s)
- Prompt file: `tools/art/prompts/sprites.md`

## 2026-10-19 17:20 UTC — icons
- Output: `art/raw/icons.png` (3446 KB, 113 s)
- Prompt file: `tools/art/prompts/icons.md`

## 2026-10-19 17:21 UTC — portraits_effects
- Output: `art/raw/portraits_effects.png` (2355 KB, 102 s)
- Prompt file: `tools/art/prompts/portraits_effects.md`

## 2026-10-19 17:23 UTC — heroes_concept
- Output: `art/raw/heroes_concept.png` (2403 KB, 99 s)
- Prompt file: `tools/art/prompts/heroes_concept.md`

## 2026-10-19 17:25 UTC — world_concept
- Output: `art/raw/world_concept.png` (2772 KB, 94 s)
- Prompt file: `tools/art/prompts/world_concept.md`
