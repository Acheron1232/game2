// Wind: grass, flowers, bushes and tree tops sway. It is done in the vertex shader of their
// materials (no CPU work, no extra draw calls); the higher a vertex sits on its plant, the more it
// moves (height squared: trunks stay, tops swing). Only what is on screen is drawn, so only the
// trees in view move. Slow gusts roll over the map, so the forest does not move as one.

import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import type { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { Scene } from '@babylonjs/core/scene';

const GLSL = 0;
const WGSL = 1;

/** Wind direction on the ground (world x, z) and its speed. */
const DIR = '0.85, 0.5';
const SPEED = '1.6';

const WIND_GLSL = `
float windH = max(positionUpdated.y, 0.0);
float windPhase = windTime * ${SPEED} + worldPos.x * 0.23 + worldPos.z * 0.19;
float windGust = 0.55 + 0.45 * sin(windTime * 0.37 + worldPos.x * 0.021 - worldPos.z * 0.017);
float windWave = (sin(windPhase) * 0.7 + sin(windPhase * 2.7 + 1.3) * 0.3) * windGust;
worldPos.xz += vec2(${DIR}) * windWave * min(windH * windH * windStrength, windMax);
`;
const WIND_WGSL = `
let windH = max(positionUpdated.y, 0.0);
let windPhase = uniforms.windTime * ${SPEED} + worldPos.x * 0.23 + worldPos.z * 0.19;
let windGust = 0.55 + 0.45 * sin(uniforms.windTime * 0.37 + worldPos.x * 0.021 - worldPos.z * 0.017);
let windWave = (sin(windPhase) * 0.7 + sin(windPhase * 2.7 + 1.3) * 0.3) * windGust;
let windMove = vec2f(${DIR}) * windWave * min(windH * windH * uniforms.windStrength, uniforms.windMax);
worldPos = vec4f(worldPos.x + windMove.x, worldPos.y, worldPos.z + windMove.y, worldPos.w);
`;

export class WindPlugin extends MaterialPluginBase {
  /**
   * @param strength sway (game units) per squared unit of height
   * @param max the most a vertex moves (game units), so tall cards and trees do not swing wildly
   */
  constructor(
    material: StandardMaterial,
    private readonly strength: number,
    private readonly max: number,
  ) {
    super(material, 'Wind', 120, { WIND: true });
    this._enable(true);
  }

  override getClassName(): string {
    return 'WindPlugin';
  }

  override isCompatible(lang: number): boolean {
    return lang === GLSL || lang === WGSL;
  }

  override getUniforms(lang?: number) {
    return {
      ubo: [
        { name: 'windTime', size: 1, type: 'float' },
        { name: 'windStrength', size: 1, type: 'float' },
        { name: 'windMax', size: 1, type: 'float' },
      ],
      vertex: lang === WGSL ? '' : 'uniform float windTime;\nuniform float windStrength;\nuniform float windMax;',
    };
  }

  override bindForSubMesh(ubo: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _sub: SubMesh): void {
    // Wrapped to stay exact in f32 (sin of a big number jitters).
    ubo.updateFloat('windTime', (performance.now() / 1000) % 3600);
    ubo.updateFloat('windStrength', this.strength);
    ubo.updateFloat('windMax', this.max);
  }

  override getCustomCode(shaderType: string, lang?: number): Record<string, string> | null {
    if (shaderType !== 'vertex') return null;
    return { CUSTOM_VERTEX_UPDATE_WORLDPOS: lang === WGSL ? WIND_WGSL : WIND_GLSL };
  }
}
