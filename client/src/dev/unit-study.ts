// Uses the real game world and the same baked/instanced army path as a match.
// This page measures rendering only; the Battle Lab also runs combat and training.
import { SceneInstrumentation } from '@babylonjs/core/Instrumentation/sceneInstrumentation';
import { parseTerrain } from '@game/shared';
import terrainUrl from '@game/shared/data/map-terrain.bin?url';
import treesUrl from '@game/shared/data/map-trees.json?url';
import decorUrl from '@game/shared/data/map-decor.json?url';
import { loadGameAssets } from '../loader/assets';
import { Loader } from '../loader/loader';
import { createEngine } from '../render/engine';
import { GameWorld, type TreeList, type Unit } from '../render/world';
import type { DecorItem } from '../render/decor';

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; background: #17221c; color: #f5efdf; font: 13px system-ui, sans-serif; overflow: hidden; }
  canvas { display: block; width: 100%; height: 100%; outline: none; }
  header { position: fixed; top: 16px; left: 20px; right: 20px; padding: 14px 18px; background: #17221cf0; border: 1px solid #d8c18a44; border-radius: 6px; }
  header strong { color: #e2cd99; letter-spacing: .15em; margin-right: 15px; }
  header span { color: #b7c1b4; }
  nav { margin-top: 10px; display: flex; gap: 8px; flex-wrap: wrap; }
  button { background: #334238; color: #eee; border: 1px solid #70806c; padding: 7px 12px; border-radius: 3px; cursor: pointer; }
  button.on { background: #79623a; border-color: #e2cd99; }
  output { position: fixed; bottom: 16px; left: 20px; padding: 12px 16px; background: #17221ce8; border-radius: 4px; font: 12px/1.5 ui-monospace, monospace; white-space: pre; }
  .label { position: absolute; transform: translate(-50%, 0); background: #142018db; padding: 5px 9px; border: 1px solid #d8c18a55; border-radius: 3px; text-align: center; font-size: 12px; pointer-events: none; }
  .label.new { color: #ffe0a0; border-color: #e8b35d; }
</style>`,
);

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const stats = document.querySelector<HTMLOutputElement>('#stats')!;
const labelsHost = document.querySelector<HTMLElement>('#labels')!;
const loader = new Loader();
loader.onProgress((s) => {
  stats.textContent = `Loading game assets · ${Math.round(s.fraction * 100)}%`;
});
const { engine, kind, adapter } = await createEngine(canvas);
engine.maxFPS = 60;
// Use one render pixel per CSS pixel; both crowd cases share the same viewport size.
engine.setHardwareScalingLevel(1);
const { assets, extra } = await loadGameAssets(loader, [
  { group: 'Map', url: terrainUrl },
  { group: 'Map', url: treesUrl },
  { group: 'Map', url: decorUrl },
]);
const grid = parseTerrain(await (await fetch(extra[0]!)).arrayBuffer());
const trees = ((await (await fetch(extra[1]!)).json()) as { trees: TreeList }).trees;
const decor = (await (await fetch(extra[2]!)).json()) as { types: string[]; decor: DecorItem[] };
const world = await GameWorld.create(engine, canvas, grid, trees, decor, assets);
world.library.bake(['pike_warden', 'frost_adept']);
world.setMenuMode(false);
world.setMenuBase(false);
world.fog.setEnabled(false);
world.camera.enabled = false;
world.camera.lookAt(128, 105);
engine.runRenderLoop(() => world.scene.render());
await world.library.warmUp(['blue']);
await world.scene.whenReadyAsync();
engine.stopRenderLoop();
const instrument = new SceneInstrumentation(world.scene);
const center = { x: 128, y: 105 };
let units: Unit[] = [];
let labels: { unit: Unit; element: HTMLDivElement }[] = [];
let mode = 'compare';
let attacks = false;
let nextAction = 0;
let sampleStart = 0;
let sampleCpu = 0;
let sampleFrames = 0;
let finalSample = '';
let lastStats = 0;
const standard = ['swordsman', 'cleric'];
const added = ['pike_warden', 'frost_adept'];
const expansionHeroes = ['thorn_marshal', 'grave_bellkeeper', 'tidebreaker', 'lantern_monk', 'obsidian_heart'];
const expansionArmy = ['foundry_golem', ...added, 'swordsman', 'archer', 'cleric'];

function resetSample(): void {
  sampleStart = performance.now() + 2500;
  sampleCpu = 0;
  sampleFrames = 0;
  finalSample = '';
}

function place(id: string, x: number, y: number, label?: string): Unit {
  const unit = world.addUnit(id, 'blue', x, y, Math.PI, 3, expansionHeroes.includes(id));
  units.push(unit);
  if (label) {
    const element = document.createElement('div');
    element.className = `label ${added.includes(id) ? 'new' : ''}`;
    element.textContent = label;
    labelsHost.append(element);
    labels.push({ unit, element });
  }
  return unit;
}

function show(next: string): void {
  for (const u of units) world.removeUnit(u);
  units = [];
  labels = [];
  labelsHost.replaceChildren();
  mode = next;
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  const narrow = canvas.clientWidth / canvas.clientHeight < 1.2;
  world.camera.camera.radius = mode === 'compare' ? (narrow ? 21 : 17) : narrow ? 70 : 53;
  world.camera.camera.target.set(center.x, world.terrain.heightAt(center.x, center.y), -center.y);
  if (mode === 'compare') {
    ['archer', 'lancer', 'worker', 'tree_guardian'].forEach((id, i) =>
      place(id, center.x + (narrow ? -3.6 + i * 2.4 : -5.1 + i * 3.4), center.y + (narrow ? 6 : 3.5)),
    );
    ['swordsman', 'pike_warden', 'cleric', 'frost_adept'].forEach((id, i) =>
      place(
        id,
        center.x + (narrow ? (i % 2 === 0 ? -1.7 : 1.7) : -5.1 + i * 3.4),
        center.y + (narrow ? (i < 2 ? 1 : -3.8) : -0.8),
        ['Swordsman · existing', 'U02 · Pike Warden', 'Cleric · existing', 'U06 · Frost Adept'][i],
      ),
    );
  } else {
    for (let i = 0; i < 300; i++) {
      const ids = mode === 'expansion' ? expansionArmy : mode === 'new' ? added : mode === 'standard' ? standard : [...standard, ...added];
      const id = mode === 'expansion' && i < 5 ? expansionHeroes[i]! : ids[i % ids.length]!;
      const u = place(id, center.x + ((i % 20) - 9.5) * 1.45, center.y + (Math.floor(i / 20) - 7) * 1.45);
      u.moving = i % 4 !== 0;
      u.animationStarted -= (i * 173) % 1700;
    }
  }
  nextAction = 0;
  resetSample();
}

document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => {
  b.onclick = () => show(b.dataset.mode!);
});
const action = document.querySelector<HTMLButtonElement>('#action')!;
action.onclick = () => {
  attacks = !attacks;
  action.classList.toggle('on', attacks);
  action.textContent = attacks ? 'Stop attacks' : 'Play attacks';
  for (const u of units) {
    u.moving = !attacks && mode !== 'compare';
    u.actionUntil = 0;
  }
  nextAction = 0;
  resetSample();
};
world.beforeFrame = () => {
  const now = performance.now();
  if (attacks && now >= nextAction) {
    for (const u of units) {
      u.moving = false;
      world.playOnce(u, u.modelId === 'frost_adept' || u.modelId === 'cleric' ? 'cast' : 'attack');
    }
    nextAction = now + 2000;
  }
};
show(new URLSearchParams(location.search).get('mode') || 'compare');
engine.runRenderLoop(() => {
  const start = performance.now();
  world.scene.render();
  const cpu = performance.now() - start;
  if (start >= sampleStart && !finalSample) {
    sampleCpu += cpu;
    sampleFrames++;
    if (start - sampleStart >= 8000) {
      finalSample = `8s sample: ${(sampleFrames / ((start - sampleStart) / 1000)).toFixed(1)} FPS · ${(sampleCpu / sampleFrames).toFixed(2)} ms scene CPU`;
    }
  }
  const p = { x: 0, y: 0 };
  for (const { unit, element } of labels) {
    world.screenPoint(unit.x, unit.y - 0.65, 0, p);
    element.style.left = `${p.x}px`;
    element.style.top = `${p.y}px`;
  }
  if (start - lastStats < 500) return;
  lastStats = start;
  const unitTris = units.reduce((sum, u) => sum + (assets.models[u.modelId]?.triangles ?? 0), 0);
  stats.textContent = [
    `${kind} · ${engine.getRenderWidth()}×${engine.getRenderHeight()} · cap 60 FPS · ${adapter}`,
    `${mode} · ${world.renderStats.visible}/${units.length} visible · ${Math.round(unitTris / 1000)}k unit triangles · ${instrument.drawCallsCounter.current} scene draws`,
    `Army animation: GPU baked + instanced · new models baked: ${world.library.isBaked('pike_warden') && world.library.isBaked('frost_adept')}`,
    finalSample || `Sampling after warm-up… ${sampleFrames} frames`,
    'Visual scene only. No AI, network or combat simulation is included in CPU timing.',
  ].join('\n');
});
