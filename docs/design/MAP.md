# Map — Elder Temple

Reference picture: `docs/reference/map.png` (the classic 4-player temple map layout).
Our map data (all generated, edit the scripts, not the files):
- `shared/data/map-layout.json` — points and shapes (bases, mines, camps, shops, roads, lakes, temple). Made by `node tools/map/make-map-layout.mjs`.
- `shared/data/map-terrain.bin` — the real terrain grid, 384 × 384 cells of 0.5 units. Made by `node tools/map/bake-terrain.mjs`.
- `shared/data/map-trees.json` — every tree (2,750 trees). Made by the same script.
- [map-preview.png](map-preview.png) — top-down picture of the baked map, also made by the same script.

![Map preview](map-preview.png)

Preview legend: colored square = Town Hall (start spot), yellow circle = gold mine, yellow house = shop, light blue circle = Fountain of Life, small dots = camps (green / orange / red), grey = temple high ground with cliff edges.

## Big picture

- Size **192 × 192** game units (1 unit ≈ 1 meter). A hero (speed 3) walks from one base to the next in about 40–50 seconds and crosses the whole map in about 60–70 seconds.
- **Exact 4-fold rotation symmetry** around the center (96, 96). We describe the north sector once, and the script turns it by 90°, 180° and 270°. The reference map is almost symmetric in the same way; we made it exact so all four spots are equal.
- Start spots form a "pinwheel": each base sits a bit off the middle of its map side, like in the reference.
- Coordinates: origin in the south-west corner, x goes east, y goes north.

## What is in one sector (north shown, same for all four)

| Thing | Position (north) | Notes |
|---|---|---|
| Town Hall | (76, 177) | Start spot. Hero spawns at (80, 168). |
| Base build area | circle (78, 171), r 15 | AI places buildings here. Trees around it for wood. |
| Main gold mine | (68, 183) | 15,000 gold. About 10 units from the Town Hall. |
| Natural expansion | mine (136, 182), Town Hall spot (133, 174) | 10,000 gold. Guarded by Orange Trolls standing on the spot. |
| Corner expansion | mine (185, 185), Town Hall spot (178, 178) | 12,000 gold. Guarded by Red Ogres. Only reachable along the road from the natural. |
| Trader's Tent (side shop) | (56, 158) | Between the base and the lake. |
| Lake | ellipse at (37, 158), 13 × 11 | Blocks ground units. Flying units cross it. |
| Green Wolves | (50, 174) | West of the base. |
| Green Bandits | (106, 160) | South-east of the base, near the natural road. |
| Orange Harpies | (70, 148) | On the way to the temple ring. |
| Red Sentinels | (107, 121) | On the temple plateau near the north ramp. |
| Temple ramp | from (96, 141) up to (96, 130), width 10 | One per side, 4 in total. |
| Fountain of Life | (133, 133) | On the ring road, between north and east. 4 in total. |

## The center

- **Temple plateau** — high ground (level 1), an octagon about 72 × 72 units: a square with the corners cut off. Edges are cliffs except the 4 ramps (N, E, S, W).
- Stone paving in a big **cross** shape on the plateau, like the reference.
- 4 small **temple pools** in the plateau corners (decoration, they block walking).
- **Temple Market** shop exactly in the middle (96, 96).
- 4 Red Sentinel camps, one near the top of each ramp, off to the side so the way to the market stays open.
- **Ring road** around the plateau, radius 48, width 7. All base roads join it.

## Roads and paths (per sector)

| Road | Width | Joins |
|---|---|---|
| Base → ring | 7 | Base south side → ring near the ramp |
| Base → natural | 7 | Base east side → natural expansion |
| Natural → corner | 6 | Natural → corner expansion (only way in) |
| Natural → ring | 6 | Natural → ring |
| Base → shop | 6 | Base west side → Trader's Tent |
| Shop → ring | 6 | Trader's Tent → ring |
| Trail | 4 | Shop → past the lake → the next sector's natural expansion (narrow forest path, rough dirt) |

## Terrain data (baked)

`tools/map/bake-terrain.mjs` turns the simple shapes of the layout into a natural-looking map:
- Edges of lakes, roads, open areas and forest are bent with noise, so nothing looks like a perfect circle or line. Roads are smooth curves.
- The noise is made rotation-safe (same result after turning the map by 90°), so the baked grid is still **exactly** 4-way symmetric. The bake checks this: 0 different cells.
- Forest fills everything that is not open. A thin, uneven grass edge sits between roads and forest.
- Temple: high ground (level 1) with a 1.8-unit cliff edge, stone cross paving, 4 pools, 4 ramps.
- Lakes have a sand shore and get deeper toward the middle.

### `map-terrain.bin` format (little endian)

| Part | Type | Notes |
|---|---|---|
| magic | 4 chars | `ETRN` |
| version | u16 | 1 |
| cols, rows | u16, u16 | 384, 384 |
| cellSize | f32 | 0.5 game units |
| ground | u8 × cols × rows | index into: grass, grass_lush, grass_dry, dirt, rough_dirt, temple_stone, sand, cliff, water_bed, forest_floor |
| flags | u8 × cols × rows | bits: 1 passable, 2 buildable, 4 forest, 8 border (trees can not be cut), 16 cliff, 32 water, 64 ramp, 128 high ground |
| height | u8 × cols × rows | level = byte / 100 − 1 (water bed −1, ground 0, temple top 1, ramps in between) |

Row 0 is the south edge (y = 0), column 0 is the west edge (x = 0).
`passable` means the ground can be walked on **if no tree or building stands there**. Forest cells are passable ground with trees on them; trees block movement until they are chopped.

### `map-trees.json`

`[x, y, type, scale]` per tree. Types: pine, oak, dead (near the temple), bush (forest edges). Trees are placed on a jittered 2.1-unit grid in one quarter of the map and turned 4 times, so they are symmetric too.

### Still for Phase 5
- Turn the grid into terrain mesh chunks and the splat map, height in world units (1 level = 2.5 units, decided in Phase 5).
- Small props (rocks, fences, ruins near the temple).

## Fairness checks (Phase 5 must test)

- Same walk distance base → natural, base → shop, base → temple for all 4 spots (true by symmetry, but test the nav grid result).
- No start spot can see another start spot.
- The corner expansion can only be reached by ground through the natural expansion road.
- Flying units can reach every point except the border.

## Differences from the reference map (on purpose)

- Exact symmetry instead of "almost".
- Our own names: Elder Temple, Trader's Tent, Temple Market, Fountain of Life.
- Fountains on the ring road (the reference picture does not show any).
- The strongest camps guard the temple ramps and the corner expansions.
- No boss in the MVP (a temple boss is a post-MVP idea).
