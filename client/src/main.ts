import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './styles.css';
import './ui-skin.css';
import { gameData, parseTerrain } from '@game/shared';
import terrainUrl from '@game/shared/data/map-terrain.bin?url';
import treesUrl from '@game/shared/data/map-trees.json?url';
import decorUrl from '@game/shared/data/map-decor.json?url';
import { loadGameAssets, registerAssetCache } from './loader/assets';
import { Loader } from './loader/loader';
import { defaultServerUrl, GameSocket } from './net/socket';
import { createEngine } from './render/engine';
import { GAME_FPS, MENU_FPS } from './render/render-budget';
import type { DecorItem } from './render/decor';
import { GameWorld, TEAMS, type TreeList } from './render/world';
import { Minimap } from './ui/minimap';
import { startDebugOverlay } from './ui/debug-overlay';
import { Router } from './ui/router';
import { createEndScreen, createGameScreen, createLobbyScreen, createMenuScreen, showFatalError, toggleFullScreen } from './ui/screens';

const NAME_KEY = 'tw.playerName';
function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Player';
  } catch {
    return 'Player';
  }
}
let playerName = readName();
const setName = (n: string) => {
  playerName = n;
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    // private mode: name is kept for this visit only
  }
};

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiHost = document.getElementById('ui')!;
  const debugNode = document.getElementById('debug')!;

  const router = new Router(uiHost);
  router.add(
    'menu',
    createMenuScreen(router, () => playerName, setName),
  );
  const lobby = createLobbyScreen(router, () => playerName);
  router.add('lobby', lobby);
  router.add('game', createGameScreen(router));
  router.add('end', createEndScreen(router));
  router.show('menu');

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F11') {
      ev.preventDefault();
      toggleFullScreen();
    }
  });

  const net = new GameSocket(defaultServerUrl(), () => playerName);
  net.onChange((s) => lobby.setNet(s));
  net.connect();

  const { engine, kind } = await createEngine(canvas);
  registerAssetCache();

  // Loading starts at once, so it is done (or nearly) when the player reaches the lobby.
  const loader = new Loader();
  loader.onProgress((s) => lobby.setLoad(s));
  const shadersDone = loader.addStep('Shaders');
  // UI images are fetched here too, so they are in the browser cache before the lobby needs them.
  const uiUrls = Object.values(
    import.meta.glob('./assets/ui/*.{webp,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  );
  const { assets, extra } = await loadGameAssets(loader, [
    ...uiUrls.map((url) => ({ group: 'Interface' as const, url })),
    { group: 'Map', url: terrainUrl },
    { group: 'Map', url: treesUrl },
    { group: 'Map', url: decorUrl },
  ]);
  const [terrainUrlBlob, treesUrlBlob, decorUrlBlob] = extra.slice(-3);
  await document.fonts.ready;
  const terrain = parseTerrain(await (await fetch(terrainUrlBlob!)).arrayBuffer());
  const trees = ((await (await fetch(treesUrlBlob!)).json()) as { trees: TreeList }).trees;
  const decor = (await (await fetch(decorUrlBlob!)).json()) as { types: string[]; decor: DecorItem[] };

  const world = await GameWorld.create(engine, canvas, terrain, trees, decor, assets);
  if (import.meta.env.DEV) (window as unknown as { world: GameWorld }).world = world; // for debugging in the console
  // Compile every material and model now, not when the match starts.
  await world.library.warmUp(TEAMS);
  await world.scene.whenReadyAsync();
  shadersDone();
  startDebugOverlay(debugNode, engine, kind, net.state, world.scene);

  // ---- game screen wiring (local play until Phase 6)
  const params = new URLSearchParams(location.search);
  const heroId = params.get('hero') ?? 'staff_warrior';
  const start = gameData.map.starts[0]!;
  world.spawnHero(heroId, start.heroSpawn[0], start.heroSpawn[1], 'red');
  const minimapHost = uiHost.querySelector<HTMLElement>('.minimap')!;
  const minimap = new Minimap(
    minimapHost,
    terrain,
    gameData.map,
    (x, y) => world.camera.lookAt(x, y),
    (x, y) => world.moveHero(x, y),
  );
  const townHalls = gameData.map.starts.map((s, i) => ({ x: s.townHall[0], y: s.townHall[1], color: TEAM_HEX[i]!, size: 6 }));
  setInterval(() => {
    if (router.screen !== 'game') return;
    const h = world.hero!.mover;
    const view = { x: world.camera.target.x, y: world.camera.target.y + 4, w: 46, h: 30 };
    minimap.draw([...townHalls, { x: h.x, y: h.y, color: '#ffffff', size: 5 }], view);
  }, 120);

  let lastSpace = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (router.screen !== 'game' || e.button !== 2) return;
    const p = world.pickGround(e.offsetX, e.offsetY);
    if (p) world.moveHero(p.x, p.y);
  });
  window.addEventListener('keydown', (e) => {
    if (router.screen !== 'game') return;
    if (e.key === ' ' || e.key === 'F1') {
      e.preventDefault();
      const h = world.hero!.mover;
      const now = performance.now();
      world.camera.follow = now - lastSpace < 350 ? () => world.hero!.mover : null;
      lastSpace = now;
      world.camera.lookAt(h.x, h.y, true);
    }
    if (e.key === 'F4') {
      e.preventDefault();
      world.toggleStress(300);
    }
  });

  router.onChange((name) => {
    engine.maxFPS = name === 'game' ? GAME_FPS : MENU_FPS;
    world.setMenuMode(name !== 'game');
  });
  // Dev shortcut: ?play opens the game screen as soon as loading is done.
  if (params.has('play')) router.show('game');
  engine.runRenderLoop(() => {
    if (!document.hidden) world.scene.render();
  });
}

const TEAM_HEX = ['#D42A2A', '#2A5BD4', '#1FB5A8', '#7B2FBF'];

main().catch((err: unknown) => {
  console.error(err);
  showFatalError(document.getElementById('ui')!, err instanceof Error ? err.message : String(err));
});
