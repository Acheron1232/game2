# Task: fog of war on screen and on the minimap

Write `client/src/render/fog.ts` and `client/test/fog.test.ts`, and change `client/src/ui/minimap.ts` (add fog drawing). Do not edit other files.

## Background
The client is Babylon.js 9 (`client/src/render/world.ts`, `terrain.ts`, `team-material.ts`, `decor.ts`). Every material in the game scene is a `StandardMaterial`; `terrain.ts` and `team-material.ts` already extend materials with `MaterialPluginBase` plugins — read them to see how plugins add uniforms, samplers and fragment code in this project (WebGPU and WebGL2 both must work; look at how they write shader code for both, e.g. `CUSTOM_FRAGMENT_DEFINITIONS`, `CUSTOM_FRAGMENT_BEFORE_FOG` and `getUniforms`/`getSamplers`/`bindForSubMesh`). Game coordinates: map 256 × 256 units; world position = (x, height, -y) (Babylon is right-handed here: game y goes to world -z).

The fog data comes from shared code (another task writes it): per team a 128 × 128 grid (`cell` = 2 units, row-major, row 0 = game y 0) with `visible` (1 = seen now) and `explored` (1 = seen once) bytes. Write against this interface (do not import the shared class):
```ts
export interface FogGrid { cols: number; cell: number; visible: Uint8Array; explored: Uint8Array }
```

## API (exact)
```ts
export class FogOfWar {
  constructor(scene: Scene, mapSize: number, cols: number);
  /** Adds the fog to a material (call for every StandardMaterial in the scene; new ones too). */
  attach(material: StandardMaterial): void;
  /** Attach to all current scene materials and to every StandardMaterial created later. */
  attachAll(): void;
  /** New grid data (call a few times per second). Values fade smoothly toward it in update(). */
  setGrid(grid: FogGrid): void;
  /** Per frame: fade and upload when something changed. No allocations. */
  update(dt: number): void;
  /** Off in the menu: everything fully lit. */
  setEnabled(on: boolean): void;
  dispose(): void;
}
```

## Look
- Seen now: normal colors. Explored but not seen now: darker and a little desaturated (about 45% brightness). Never seen: dark (about 15% brightness), not pure black.
- Soft edges: sample the fog texture with linear filtering (one texel = 2 units) and fade values over about 0.3 s when cells change (CPU-side lerp on a Float32 or Uint8 copy, then upload one `RawTexture` (R8 or RGBA8), only when something changed).
- The fog is applied in the fragment shader by world position (x, -z) / mapSize → uv; outside the map: like explored.
- Must not create new shaders after the match starts: the plugin must be part of every material from the start (compiled in the lobby). When disabled, a uniform turns the effect off (no recompile).
- Minimap (`minimap.ts`): add `setFog(grid: FogGrid | null)`; `draw()` darkens the ground image the same way (cache an overlay canvas, rebuild it only when the grid changed, at most a few times per second). Dots are drawn by the caller; the caller will only pass visible enemies anyway.

## Tests (`client/test/fog.test.ts`)
Vitest without a GPU: test the pure parts (put them in exported functions in `fog.ts`): the fade step (values move toward targets, stop exactly, return "changed" flags), the brightness mapping (visible / explored / never), and the minimap overlay pixel values for a tiny 4 × 4 grid.
Run `pnpm --filter @game/client typecheck`, `pnpm --filter @game/client exec vitest run test/fog.test.ts`, eslint and prettier on your files.
