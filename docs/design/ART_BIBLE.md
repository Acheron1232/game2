# Art Bible

The look: **classic early-2000s fantasy RTS**. Low-poly, hand-painted, colorful, strong silhouettes, readable from a high camera. Our own designs — familiar feeling, not copies.

## 1. Five rules

1. **Shape first.** Every hero and unit must be clear as a black silhouette at RTS distance.
2. **Big and bold.** Big shoulder pads, big weapons, big heads and hands (about 10–20% larger than real).
3. **Painted, not lit.** Light and shadow are painted into textures softly (top light). The engine adds one sun and soft shadows.
4. **Smooth low-poly.** Few polygons, but rounded shapes and smooth normals. No boxy "cube" look.
5. **Team color everywhere.** Every faction unit, hero and building shows its team color in big areas.

## 2. Camera

- Angle: about 56° down from the horizon. Field of view about 45°.
- Default view shows about 40 units wide. Zoom range: 0.8× to 1.25× of default.
- Everything is judged from this camera. Details smaller than ~0.15 units are not visible — do not model them.

## 3. Sizes (game units)

| Thing | Height |
|---|---|
| Worker | 1.3 |
| Swordsman, Archer, Cleric | 1.7 |
| Heroes (human size) | 2.0 (scale in heroes.json) |
| Lancer, Centaur Raider | 2.4 – 2.8 |
| Stone Golem | 3.0 |
| Sky Dragon | 3.2 wingspan 5, flies 3 above ground |
| House | 3 |
| Town Hall | 7 – 9 |
| Trees | 4 – 7 |

## 4. Color

### Base palette
- Grass: warm yellow-green to deep green. Dirt: orange-brown. Stone: warm grey. Water: deep teal-blue.
- Kingdom faction: warm wood browns, cream stone, dark iron, gold trim.
- Monsters: earth colors with one accent color (wolves grey + white, trolls green + bone, ogres tan + brown, harpies purple-grey, spiders stone + crystal, sentinels stone + gold light).
- Heroes: each hero owns one main color (see heroes.json `look.palette`) so they stand apart.

### Team colors

| Team color | Hex |
|---|---|
| Red | `#D42A2A` |
| Blue | `#2A5BD4` |
| Teal | `#1FB5A8` |
| Purple | `#7B2FBF` |
| Yellow | `#F2C615` |
| Orange | `#F07A1A` |
| Green | `#2FA83A` |
| Pink | `#E56BB0` |

### Team color in art
- In generated images and textures, **team color areas are painted pure magenta `#FF00FF`** with painted shading (darker and lighter magenta). The tool turns them into a grey mask (keeps the shading), and the shader multiplies the mask by the team color.
- Team color areas: heroes — see `teamColorParts` in heroes.json; units — shields, shoulder pads, capes, tabards, horse cloth; buildings — roof flags, banners, awnings, door cloth.
- At least 10–15% of the visible surface should be team color, so the team is clear at a glance.

## 5. Polygons and textures

| Thing | Triangles | Texture |
|---|---|---|
| Hero | 1,500 – 3,000 | material swatches (128 px each) through a palette atlas, plus small unique parts |
| Unit | 500 – 1,500 | material swatches (128 px) |
| Monster | 500 – 2,000 | material swatches (128 px) |
| Building | 300 – 2,000 | uses building material atlas (tiling swatches) |
| Tree | 100 – 400 | foliage card atlas + bark swatch |
| Prop | 50 – 300 | prop atlas |
| LOD1 | ~50% of LOD0 | same texture |

- Texture style: hand-painted, soft gradients, some painted edge highlights, low noise. No photo textures.
- Texture density about 32–40 px per unit for terrain tiles (a 128 px tile covers about 3–4 units). Small, painted textures are part of the classic look and keep the download small.
- No normal maps on units in the MVP (painted look). Terrain may use a simple normal map.

## 6. Terrain

| Layer | Look |
|---|---|
| Grass ×3 | Lush, dry, and flower grass |
| Dirt | Packed orange-brown road |
| Rough dirt | Dirt with pebbles and roots (trails, camp spots) |
| Temple stone | Big worn stone tiles with cracks and moss |
| Sand | Light sand near water |
| Cliff | Layered rock faces, mossy top edge |

- Blend layers with soft painted edges (splat map with noise).
- Grass tufts and flowers as small instanced cards near paths and in open areas (not in dense forest).

## 7. Lighting and mood

- Warm afternoon sun from the south-west, slightly yellow. Soft blue sky light (hemispheric).
- Soft, short shadows. Shadow color slightly blue, never black.
- Light distance fog at the map edges, none in the middle.
- Small glow (emissive) for magic, fountains, runes — no heavy bloom.

## 8. Effects

- Bright, simple, short. Every ability has a clear start (cast), travel (projectile or area marker) and hit.
- One color family per hero: Blood Witch red, Staff Warrior gold-white, Sky Dragon orange fire, Stone Golem brown dust + blue runes, Light Healer warm yellow, Arcane Huntress violet-cyan, Centaur Raider dust + red war paint, Forest Elf green-gold.
- Area abilities show their area on the ground while they last.

## 9. UI art

See [UI.md](UI.md). Materials: dark carved wood, dark iron with rivets, warm gold trim, parchment for tooltips and panels. Fonts: Cinzel (titles), Alegreya Sans (text and numbers).

## 10. Codex image sheet rules (for Phase 3)

Every prompt follows these:
- One image = one **sheet**, a strict dense grid (8 × 8 or 9 × 8 cells, about 150 px each), thin dark lines between cells. More small pictures per sheet is better than fewer big ones.
- Same style words in every prompt: "hand-painted, low-resolution fantasy RTS game texture, early-2000s style, soft top light, painterly, no text, no logo, no watermark".
- Terrain tiles: "seamless tileable, flat top-down view, no perspective, no shadows".
- Sprites, foliage cards, icons, concept views: background **pure green `#00FF00`**.
- Team color parts: **pure magenta `#FF00FF`** with shading.
- Concept sheets: front, side and back view of one model, T-pose-like neutral pose, plus a row of color swatches.
