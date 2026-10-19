// Placeholder 3D scene of the map: a flat ground painted from the baked terrain grid,
// a raised temple and all trees as thin instances (one draw call).
// It is the menu background and the game view until Phase 5 builds the real terrain.

import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import type { AbstractEngine } from '@babylonjs/core/Engines/abstractEngine';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { DynamicTexture } from '@babylonjs/core/Materials/Textures/dynamicTexture';
import { Texture } from '@babylonjs/core/Materials/Textures/texture';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Matrix, Quaternion, Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateCylinder } from '@babylonjs/core/Meshes/Builders/cylinderBuilder';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import '@babylonjs/core/Meshes/thinInstanceMesh';
import { Scene } from '@babylonjs/core/scene';
import { GROUND_TYPES, TerrainFlag, type TerrainGrid } from '@game/shared';
import { GROUND_COLORS, TREE_COLORS } from './terrain-colors';

export type TreeList = [number, number, number, number][];

export interface MapPreviewScene {
  scene: Scene;
  /** Slow circling view for the main menu. */
  useMenuCamera(): void;
  /** Fixed RTS view over a start spot for the game screen. */
  useGameCamera(at: [number, number]): void;
}

/** Height of one terrain level in world units (placeholder; Phase 5 decides). */
const LEVEL_HEIGHT = 2.5;

export function createMapPreviewScene(engine: AbstractEngine, terrain: TerrainGrid, trees: TreeList): MapPreviewScene {
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.05, 0.04, 0.03, 1);
  scene.fogMode = Scene.FOGMODE_LINEAR;
  scene.fogColor = new Color3(0.32, 0.36, 0.3);
  scene.fogStart = 140;
  scene.fogEnd = 320;

  const size = terrain.cols * terrain.cellSize;
  const center = new Vector3(size / 2, 0, size / 2);

  // World axes: x = east, z = north, y = up. Game y (north) maps to world z.
  const camera = new ArcRotateCamera('camera', -Math.PI / 2, 0.95, 70, center.clone(), scene);
  camera.minZ = 0.5;
  camera.maxZ = 600;

  const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
  sky.intensity = 0.55;
  sky.groundColor = new Color3(0.25, 0.27, 0.32);
  const sun = new DirectionalLight('sun', new Vector3(0.5, -1, 0.6), scene);
  sun.intensity = 0.85;
  sun.diffuse = new Color3(1, 0.95, 0.82);

  // Ground painted from the terrain grid, one texel per cell.
  const texture = new DynamicTexture(
    'terrain-colors',
    { width: terrain.cols, height: terrain.rows },
    scene,
    false,
    Texture.BILINEAR_SAMPLINGMODE,
  );
  const ctx = texture.getContext() as CanvasRenderingContext2D;
  const image = ctx.createImageData(terrain.cols, terrain.rows);
  for (let row = 0; row < terrain.rows; row++) {
    for (let col = 0; col < terrain.cols; col++) {
      const i = row * terrain.cols + col;
      const type = GROUND_TYPES[terrain.ground[i] ?? 0] ?? 'grass';
      const [r, g, b] = GROUND_COLORS[type];
      const shade = ((terrain.flags[i] ?? 0) & TerrainFlag.High) !== 0 ? 1.08 : 1;
      // Canvas rows go top-down; texture v goes up, so the north edge (last row) is drawn first.
      const o = ((terrain.rows - 1 - row) * terrain.cols + col) * 4;
      image.data[o] = r * shade;
      image.data[o + 1] = g * shade;
      image.data[o + 2] = b * shade;
      image.data[o + 3] = 255;
    }
  }
  ctx.putImageData(image, 0, 0);
  texture.update(false);

  const ground = CreateGround('ground', { width: size, height: size, subdivisions: 1 }, scene);
  ground.position.copyFrom(center);
  const groundMat = new StandardMaterial('ground-mat', scene);
  groundMat.diffuseTexture = texture;
  groundMat.specularColor = Color3.Black();
  ground.material = groundMat;
  ground.freezeWorldMatrix();

  // Trees: one cone mesh, thousands of thin instances with their own color.
  const tree = CreateCylinder('tree', { height: 4, diameterTop: 0, diameterBottom: 2.4, tessellation: 7 }, scene);
  const treeMat = new StandardMaterial('tree-mat', scene);
  treeMat.specularColor = Color3.Black();
  tree.material = treeMat;
  const matrices = new Float32Array(trees.length * 16);
  const colors = new Float32Array(trees.length * 4);
  const m = new Matrix();
  trees.forEach(([x, y, type, scale], i) => {
    const s = type === 3 ? scale * 0.55 : scale;
    Matrix.ComposeToRef(new Vector3(s, s * (type === 2 ? 0.8 : 1), s), Quaternion.Identity(), new Vector3(x, 2 * s, y), m);
    m.copyToArray(matrices, i * 16);
    const [r, g, b] = TREE_COLORS[type] ?? TREE_COLORS[0]!;
    colors.set([r / 255, g / 255, b / 255, 1], i * 4);
  });
  tree.thinInstanceSetBuffer('matrix', matrices, 16, true);
  tree.thinInstanceSetBuffer('color', colors, 4, true);
  tree.freezeWorldMatrix();

  // Temple top as a raised slab, so the high ground reads in 3D.
  const temple = CreateCylinder('temple', { height: LEVEL_HEIGHT, diameter: 76, tessellation: 8 }, scene);
  temple.rotation.y = Math.PI / 8;
  temple.position.set(center.x, LEVEL_HEIGHT / 2 - 0.05, center.z);
  const templeMat = new StandardMaterial('temple-mat', scene);
  templeMat.diffuseColor = new Color3(0.6, 0.58, 0.5);
  templeMat.specularColor = Color3.Black();
  temple.material = templeMat;
  temple.freezeWorldMatrix();

  let menuSpin = true;
  scene.onBeforeRenderObservable.add(() => {
    if (menuSpin) camera.alpha += 0.0006 * scene.getEngine().getDeltaTime() * 0.06;
  });

  return {
    scene,
    useMenuCamera() {
      menuSpin = true;
      camera.target.copyFrom(center);
      camera.beta = 0.95;
      camera.radius = 150;
    },
    useGameCamera([x, y]) {
      menuSpin = false;
      camera.target.set(x, 0, y);
      camera.alpha = -Math.PI / 2;
      // About 56 degrees down from the horizon, as in the art bible.
      camera.beta = (34 * Math.PI) / 180;
      camera.radius = 40;
    },
  };
}
