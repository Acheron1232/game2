// Materials for all game models (Phase 4 pipeline):
//   palette  — StandardMaterial: shared palette texture x vertex colors, plus team color where the
//              team mask is white (team cloth / armor slots). Works with skinning, WebGL2 and WebGPU.
//   glow     — unlit vertex color (eyes, crystals, runes).
// One palette material per team color keeps draw calls low: 4 teams = 4 materials.

import type { Scene } from '@babylonjs/core/scene';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import type { SubMesh } from '@babylonjs/core/Meshes/subMesh';
import type { UniformBuffer } from '@babylonjs/core/Materials/uniformBuffer';
import type { BaseTexture } from '@babylonjs/core/Materials/Textures/baseTexture';
import { MaterialPluginBase } from '@babylonjs/core/Materials/materialPluginBase';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3 } from '@babylonjs/core/Maths/math.color';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';

const GLSL = 0;
const WGSL = 1;

/** Team colors from docs/design/ART_BIBLE.md. */
export const TEAM_COLORS: Record<string, string> = {
  red: '#D42A2A',
  blue: '#2A5BD4',
  teal: '#1FB5A8',
  purple: '#7B2FBF',
  yellow: '#F2C615',
  orange: '#F07A1A',
  green: '#2FA83A',
  pink: '#E56BB0',
};

/** How bright the team color is painted over the grey team parts. */
const TEAM_STRENGTH = 1.75;

/**
 * Rim light: a warm light on the model's outline, stronger on edges that face up. It separates
 * heroes and units from the ground the way classic hero games do, without more triangles.
 * Added before the fog of war (fog.ts, priority 300), so it fades in the fog too.
 */
const RIM_GLSL = `
float rimNV = clamp(1.0 - max(dot(normalW, viewDirectionW), 0.0), 0.0, 1.0);
float rimLight = rimNV * rimNV * rimNV * (0.45 + 0.55 * clamp(normalW.y * 0.5 + 0.5, 0.0, 1.0));
color.rgb += rimLight * vec3(0.62, 0.56, 0.46) * 0.55;
`;
const RIM_WGSL = `
let rimNV = clamp(1.0 - max(dot(normalW, viewDirectionW), 0.0), 0.0, 1.0);
let rimLight = rimNV * rimNV * rimNV * (0.45 + 0.55 * clamp(normalW.y * 0.5 + 0.5, 0.0, 1.0));
color = vec4f(color.rgb + rimLight * vec3f(0.62, 0.56, 0.46) * 0.55, color.a);
`;

/**
 * Hit flash: a struck model lights up warm white for a moment. Army units (instanced) carry the
 * amount per copy in the instanced buffer HIT_FLASH; a hero has its own material, so its amount
 * is the material uniform `teamFlash`. Before the fog of war too: nothing flashes in the dark.
 */
export const HIT_FLASH = 'hitFlash';
const FLASH_COLOR = '1.0, 0.94, 0.84';
const FLASH_STRENGTH = 0.62;
const FLASH_GLSL = `
float hitFlashAmount = teamFlash;
#ifdef HITFLASH
hitFlashAmount = max(hitFlashAmount, vHitFlash);
#endif
color.rgb = mix(color.rgb, vec3(${FLASH_COLOR}), hitFlashAmount * ${FLASH_STRENGTH});
`;
const FLASH_WGSL = `
var hitFlashAmount: f32 = uniforms.teamFlash;
#ifdef HITFLASH
hitFlashAmount = max(hitFlashAmount, fragmentInputs.vHitFlash);
#endif
color = vec4f(mix(color.rgb, vec3f(${FLASH_COLOR}), hitFlashAmount * ${FLASH_STRENGTH}), color.a);
`;

export class TeamColorPlugin extends MaterialPluginBase {
  color = new Color3(1, 1, 1);
  mask: BaseTexture | null = null;
  /** hit flash of the whole material, 0..1 (heroes: one material each) */
  flash = 0;

  constructor(material: StandardMaterial) {
    super(material, 'TeamColor', 200, { TEAMCOLOR: false, HITFLASH: false });
    this._enable(true);
  }

  override getClassName(): string {
    return 'TeamColorPlugin';
  }

  override isCompatible(shaderLanguage: number): boolean {
    return shaderLanguage === GLSL || shaderLanguage === WGSL;
  }

  override prepareDefines(defines: Record<string, unknown>, _scene: Scene, mesh: AbstractMesh): void {
    defines['TEAMCOLOR'] = !!this.mask;
    defines['HITFLASH'] = hasHitFlash(mesh);
  }

  override getAttributes(attributes: string[], _scene: Scene, mesh: AbstractMesh): void {
    if (hasHitFlash(mesh)) attributes.push(HIT_FLASH);
  }

  override getSamplers(samplers: string[]): void {
    samplers.push('teamMaskSampler');
  }

  override getUniforms(shaderLanguage?: number) {
    return {
      ubo: [
        { name: 'teamColor', size: 3, type: 'vec3' },
        { name: 'teamFlash', size: 1, type: 'float' },
      ],
      fragment: shaderLanguage === WGSL ? '' : '#ifdef TEAMCOLOR\nuniform vec3 teamColor;\n#endif\nuniform float teamFlash;',
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer, _scene: Scene, _engine: AbstractEngine, _subMesh: SubMesh): void {
    uniformBuffer.updateFloat('teamFlash', this.flash);
    if (!this.mask) return;
    uniformBuffer.updateColor3('teamColor', this.color);
    uniformBuffer.setTexture('teamMaskSampler', this.mask);
  }

  override getCustomCode(shaderType: string, shaderLanguage?: number): Record<string, string> | null {
    if (shaderType === 'vertex') {
      if (shaderLanguage === WGSL)
        return {
          CUSTOM_VERTEX_DEFINITIONS: '#ifdef HITFLASH\nattribute hitFlash: f32;\nvarying vHitFlash: f32;\n#endif',
          CUSTOM_VERTEX_MAIN_END: '#ifdef HITFLASH\nvertexOutputs.vHitFlash = vertexInputs.hitFlash;\n#endif',
        };
      return {
        CUSTOM_VERTEX_DEFINITIONS: '#ifdef HITFLASH\nattribute float hitFlash;\nvarying float vHitFlash;\n#endif',
        CUSTOM_VERTEX_MAIN_END: '#ifdef HITFLASH\nvHitFlash = hitFlash;\n#endif',
      };
    }
    if (shaderType !== 'fragment') return null;
    if (shaderLanguage === WGSL) {
      return {
        CUSTOM_FRAGMENT_DEFINITIONS:
          '#ifdef TEAMCOLOR\nvar teamMaskSamplerSampler: sampler;\nvar teamMaskSampler: texture_2d<f32>;\n#endif\n#ifdef HITFLASH\nvarying vHitFlash: f32;\n#endif',
        CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#if defined(TEAMCOLOR) && defined(DIFFUSE)
let teamMask: f32 = textureSample(teamMaskSampler, teamMaskSamplerSampler, fragmentInputs.vDiffuseUV).r;
baseColor = vec4f(mix(baseColor.rgb, baseColor.rgb * uniforms.teamColor * ${TEAM_STRENGTH}, teamMask), baseColor.a);
#endif`,
        CUSTOM_FRAGMENT_BEFORE_FOG: RIM_WGSL + FLASH_WGSL,
      };
    }
    return {
      CUSTOM_FRAGMENT_DEFINITIONS:
        '#ifdef TEAMCOLOR\nuniform sampler2D teamMaskSampler;\n#endif\n#ifdef HITFLASH\nvarying float vHitFlash;\n#endif',
      CUSTOM_FRAGMENT_UPDATE_DIFFUSE: `#if defined(TEAMCOLOR) && defined(DIFFUSE)
float teamMask = texture2D(teamMaskSampler, vDiffuseUV).r;
baseColor.rgb = mix(baseColor.rgb, baseColor.rgb * teamColor * ${TEAM_STRENGTH}, teamMask);
#endif`,
      CUSTOM_FRAGMENT_BEFORE_FOG: RIM_GLSL + FLASH_GLSL,
    };
  }
}

/** The mesh (or the source of instanced copies) carries a per-copy hit flash. */
function hasHitFlash(mesh: AbstractMesh): boolean {
  return !!mesh.instancedBuffers && HIT_FLASH in mesh.instancedBuffers;
}

export interface ModelMaterials {
  palette: StandardMaterial;
  glow: StandardMaterial;
  setTeam(color: string): void;
  /** hit flash of everything drawn with this material (0..1) */
  setFlash(amount: number): void;
}

/** Texture + team mask for a model: its own skin atlas when it has one, else the shared palette. */
export function loadModelTextures(scene: Scene, skin: string | null, version = ''): { palette: Texture; teamMask: Texture } {
  if (!skin) return loadPaletteTextures(scene);
  const v = version ? `?v=${version}` : '';
  const opts = { noMipmap: false, invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE };
  return {
    palette: new Texture(`/assets/models/${skin}.webp${v}`, scene, opts),
    teamMask: new Texture(`/assets/models/${skin}_team.webp${v}`, scene, { ...opts, samplingMode: Texture.BILINEAR_SAMPLINGMODE }),
  };
}

/** Color texture + team mask from two URLs (blob URLs in the game). */
export function loadTexturePair(scene: Scene, colorUrl: string, teamUrl: string): { palette: Texture; teamMask: Texture } {
  const opts = { noMipmap: false, invertY: false, samplingMode: Texture.TRILINEAR_SAMPLINGMODE, forcedExtension: '.webp' };
  return {
    palette: new Texture(colorUrl, scene, opts),
    teamMask: new Texture(teamUrl, scene, { ...opts, samplingMode: Texture.BILINEAR_SAMPLINGMODE }),
  };
}

export function loadPaletteTextures(scene: Scene, baseUrl = '/assets/models'): { palette: Texture; teamMask: Texture } {
  // glTF UVs have v = 0 at the top, so the textures must not be flipped.
  const palette = new Texture(`${baseUrl}/palette.webp`, scene, {
    noMipmap: false,
    invertY: false,
    samplingMode: Texture.TRILINEAR_SAMPLINGMODE,
  });
  const teamMask = new Texture(`${baseUrl}/palette_team.webp`, scene, {
    noMipmap: false,
    invertY: false,
    samplingMode: Texture.BILINEAR_SAMPLINGMODE,
  });
  return { palette, teamMask };
}

export function createModelMaterials(scene: Scene, palette: Texture, teamMask: Texture, team = 'red'): ModelMaterials {
  const mat = new StandardMaterial(`palette-${team}`, scene);
  mat.diffuseTexture = palette;
  mat.specularColor = Color3.Black();
  const plugin = new TeamColorPlugin(mat);
  plugin.mask = teamMask;
  plugin.color = Color3.FromHexString(TEAM_COLORS[team] ?? team);

  // Glow parts (eyes, crystals, runes): the same texture x vertex color, but not lit, so they
  // stay bright in shadow. hero-effects.ts pulses diffuseColor for a slow breathing light.
  const glow = new StandardMaterial(`glow-${team}`, scene);
  glow.disableLighting = true;
  glow.diffuseTexture = palette;
  glow.diffuseColor = Color3.White();
  // With lighting disabled, a black emissive term multiplies the textured surface by zero.
  // White gives the unlit texture its own light while retaining its vertex tint.
  glow.emissiveColor = Color3.White();

  return {
    palette: mat,
    glow,
    setTeam(color) {
      plugin.color = Color3.FromHexString(TEAM_COLORS[color] ?? color);
    },
    setFlash(amount) {
      plugin.flash = amount;
    },
  };
}

/**
 * Puts our materials on freshly loaded model meshes (from ImportMeshAsync).
 * Scenes that show models must use `scene.useRightHandedSystem = true` (same as glTF and Blender):
 * then the loader does not mirror the model, faces are not turned inside out, and every model
 * faces +Z with its right hand on its right.
 */
export function applyModelMaterials(meshes: AbstractMesh[], materials: ModelMaterials): void {
  for (const m of meshes) {
    if (!m.material) continue;
    m.material = m.material.name === 'glow' ? materials.glow : materials.palette;
    // COLOR_0 has an alpha channel, so Babylon would treat the model as see-through and draw it
    // in the transparent pass (parts added later in the mesh then show through the body).
    m.hasVertexAlpha = false;
  }
}
