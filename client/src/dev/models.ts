// Dev page (open /dev/models.html with `pnpm dev`): every model from the manifest, with its
// animations, the 4 team colors, triangle count and file size. ?model=<id> opens one model.

import '@babylonjs/loaders/glTF/2.0';
import { ArcRotateCamera } from '@babylonjs/core/Cameras/arcRotateCamera';
import { DirectionalLight } from '@babylonjs/core/Lights/directionalLight';
import { HemisphericLight } from '@babylonjs/core/Lights/hemisphericLight';
import { ImportMeshAsync } from '@babylonjs/core/Loading/sceneLoader';
import { StandardMaterial } from '@babylonjs/core/Materials/standardMaterial';
import { Color3, Color4 } from '@babylonjs/core/Maths/math.color';
import { Vector3 } from '@babylonjs/core/Maths/math.vector';
import { CreateGround } from '@babylonjs/core/Meshes/Builders/groundBuilder';
import type { AbstractMesh } from '@babylonjs/core/Meshes/abstractMesh';
import type { AnimationGroup } from '@babylonjs/core/Animations/animationGroup';
import { Scene } from '@babylonjs/core/scene';
import { createEngine } from '../render/engine';
import { attachHeroEffects, type HeroEffects } from '../render/hero-effects';
import { applyModelMaterials, createModelMaterials, loadModelTextures, TEAM_COLORS, type ModelMaterials } from '../render/team-material';

interface ManifestFile {
  path: string;
  bytes: number;
  hash: string;
}

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #1d1a16; color: #eee; font: 14px system-ui, sans-serif; }
    #view { width: 100%; height: 100%; display: block; outline: none; }
    #panel { position: fixed; left: 12px; top: 12px; width: 260px; background: #000b; padding: 12px; border-radius: 8px; }
    #panel h3 { margin: 10px 0 6px; font-size: 13px; color: #f0d58a; }
    #panel button, #panel select { font: 13px system-ui; margin: 2px; padding: 4px 8px; border-radius: 4px; border: 1px solid #666; background: #2b2b2b; color: #eee; cursor: pointer; }
    #panel button.on { background: #6b5320; border-color: #f0d58a; }
    #panel select { width: 100%; }
    #stats { font: 12px ui-monospace, monospace; color: #cfe; white-space: pre; margin-top: 8px; }
  </style>`,
);

const canvas = document.getElementById('view') as HTMLCanvasElement;
const panel = document.getElementById('panel')!;
const { engine, kind } = await createEngine(canvas);
window.addEventListener('resize', () => engine.resize());

const scene = new Scene(engine);
// Right-handed like glTF and Blender: models load without mirroring (see applyModelMaterials).
scene.useRightHandedSystem = true;
// Dev page only: handy for checking things from the browser console.
(window as unknown as { scene: Scene }).scene = scene;
scene.clearColor = new Color4(0.36, 0.42, 0.33, 1);
// Models face +Z (glTF front): the camera starts in front of them.
const camera = new ArcRotateCamera('cam', Math.PI / 2 - 0.5, 1.05, 6, new Vector3(0, 1, 0), scene);
camera.attachControl(canvas, true);
camera.wheelPrecision = 40;
camera.lowerRadiusLimit = 1.5;
const sky = new HemisphericLight('sky', new Vector3(0, 1, 0), scene);
sky.intensity = 0.85;
sky.groundColor = new Color3(0.3, 0.3, 0.35);
const sun = new DirectionalLight('sun', new Vector3(0.4, -1, 0.5), scene);
sun.intensity = 1.25;
sun.diffuse = new Color3(1, 0.95, 0.85);
const ground = CreateGround('ground', { width: 12, height: 12 }, scene);
const groundMat = new StandardMaterial('ground', scene);
groundMat.diffuseColor = new Color3(0.32, 0.45, 0.24);
groundMat.specularColor = Color3.Black();
ground.material = groundMat;

let team = 'red';
let materials: ModelMaterials | null = null;

const manifest = (await (await fetch('/assets/manifest.json')).json()) as { files: ManifestFile[] };
const models = manifest.files.filter((f) => f.path.startsWith('models/') && f.path.endsWith('.glb'));
const modelIndex = (await (await fetch('/assets/models/models.json')).json()) as Record<string, { skin: string | null }>;

let meshes: AbstractMesh[] = [];
let groups: AnimationGroup[] = [];
let current: AnimationGroup | null = null;
let effects: HeroEffects | null = null;

const select = document.createElement('select');
for (const f of models) select.append(new Option(f.path.replace('models/', '').replace('.glb', ''), f.path));
const clipBox = document.createElement('div');
const teamBox = document.createElement('div');
const stats = document.createElement('div');
stats.id = 'stats';
const viewBox = document.createElement('div');
const h = (t: string) => Object.assign(document.createElement('h3'), { textContent: t });
panel.append(h('Model'), select, h('Animation'), clipBox, h('Team color'), teamBox, h('Camera'), viewBox, stats);

function teamPick(t: string) {
  team = t;
  materials?.setTeam(t);
}
for (const team of ['red', 'blue', 'teal', 'purple']) {
  const b = document.createElement('button');
  b.textContent = team;
  b.style.borderColor = TEAM_COLORS[team]!;
  b.onclick = () => {
    teamPick(team);
    for (const x of teamBox.children) x.classList.toggle('on', x === b);
  };
  if (team === 'red') b.classList.add('on');
  teamBox.append(b);
}
const viewButton = (label: string, alpha: number, beta: number) => {
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => {
    camera.alpha = alpha;
    camera.beta = beta;
  };
  viewBox.append(b);
};
viewButton('RTS', Math.PI / 2 - 0.5, (34 * Math.PI) / 180);
viewButton('Front', Math.PI / 2, Math.PI / 2 - 0.05);
viewButton('Side', 0, Math.PI / 2 - 0.05);

function play(group: AnimationGroup) {
  current?.stop();
  current = group;
  group.start(true, 1);
  for (const x of clipBox.children) x.classList.toggle('on', x.textContent === group.name);
}

async function load(path: string) {
  effects?.dispose();
  effects = null;
  for (const m of meshes) m.dispose();
  for (const g of groups) g.dispose();
  current = null;
  const f = models.find((m) => m.path === path)!;
  const id = path.replace('models/', '').replace('.glb', '');
  const skin = modelIndex[id]?.skin ?? null;
  const skinFile = skin ? manifest.files.find((m) => m.path === `models/${skin}.webp`) : undefined;
  materials?.palette.dispose();
  materials?.glow.dispose();
  const tex = loadModelTextures(scene, skinFile ? skin : null, skinFile?.hash);
  materials = createModelMaterials(scene, tex.palette, tex.teamMask, team);
  const result = await ImportMeshAsync(`/assets/${path}?v=${f.hash}`, scene);
  meshes = result.meshes;
  groups = result.animationGroups;
  let triangles = 0;
  let top = 0;
  applyModelMaterials(meshes, materials);
  effects = attachHeroEffects(scene, id, result.transformNodes, materials.glow);
  for (const m of meshes) {
    if (!m.material) continue;
    m.isPickable = false;
    triangles += (m.getTotalIndices?.() ?? 0) / 3;
    m.refreshBoundingInfo({ applySkeleton: true });
    top = Math.max(top, m.getBoundingInfo().boundingBox.maximumWorld.y);
  }
  camera.target.set(0, top * 0.45, 0);
  camera.radius = Math.max(3, top * 2.4);
  clipBox.replaceChildren();
  for (const g of groups) {
    g.stop();
    const b = document.createElement('button');
    b.textContent = g.name;
    b.onclick = () => play(g);
    clipBox.append(b);
  }
  if (!groups.length) clipBox.textContent = '(no animations)';
  const idle = groups.find((g) => g.name === 'idle') ?? groups[0];
  if (idle) play(idle);
  stats.textContent = `${kind}\ntexture ${skinFile ? skin : 'palette'}\ntriangles ${Math.round(triangles)}\nfile ${(f.bytes / 1024).toFixed(0)} KB\nheight ${top.toFixed(2)} m\nclips ${groups.length}`;
  history.replaceState(null, '', `?model=${encodeURIComponent(path.replace('models/', '').replace('.glb', ''))}`);
}

select.onchange = () => void load(select.value);
const wanted = new URLSearchParams(location.search).get('model');
if (wanted) select.value = `models/${wanted}.glb`;
await load(select.value);
engine.runRenderLoop(() => scene.render());
