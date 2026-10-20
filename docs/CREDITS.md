# Credits and licenses

Every third-party asset, font or library that ships with the game is listed here.

## Fonts

| Font | Author | License | How we use it |
|---|---|---|---|
| Cinzel | Natanael Gama | SIL Open Font License 1.1 | Titles and buttons. Bundled from the `@fontsource/cinzel` npm package. |
| Alegreya Sans | Huerta Tipográfica | SIL Open Font License 1.1 | Body text and numbers. Bundled from the `@fontsource/alegreya-sans` npm package. |

## Libraries (shipped to players)

| Library | License |
|---|---|
| Babylon.js (`@babylonjs/core`) | Apache 2.0 |
| zod | MIT |
| ws (server) | MIT |

## Art and sound

All 2D art is made for this project with Codex image generation (see `tools/art/generation-log.md` for every call). No third-party art.

### Sound (Phase 9c)

Third-party sounds, all **CC0** (public domain: free for any use, no credit needed — we credit them anyway). Download links: `tools/audio/sources.json`; how each one is used: `tools/audio/sounds.json`.

| Sound | Author | License | Used for |
|---|---|---|---|
| [Impact Sounds](https://kenney.nl/assets/impact-sounds) | Kenney (kenney.nl) | CC0 1.0 | Hits (melee, armor, arrows, buildings, siege), chopping, falling buildings |
| [Cure Magic](https://opengameart.org/content/cure-magic) | Someoneman (OpenGameArt) | CC0 1.0 | Heals |
| [Battle Theme A](https://opengameart.org/content/battle-theme-a) | cynicmusic (OpenGameArt) | CC0 1.0 | Match music |

Made for this project by code (`client/src/audio/synth.ts`): button clicks, the error buzz, coins, level-up, spell cast and impact, the base alarm horn, victory and defeat tunes.
