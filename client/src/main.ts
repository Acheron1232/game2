import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './styles.css';
import './ui-skin.css';
import { gameData, parseTerrain } from '@game/shared';
import terrainUrl from '@game/shared/data/map-terrain.bin?url';
import treesUrl from '@game/shared/data/map-trees.json?url';
import { Loader } from './loader/loader';
import { defaultServerUrl, GameSocket } from './net/socket';
import { createEngine } from './render/engine';
import { createMapPreviewScene, type TreeList } from './render/map-preview-scene';
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
  window.addEventListener('resize', () => engine.resize());
  startDebugOverlay(debugNode, engine, kind, net.state);

  // Loading starts at once, so it is done (or nearly) when the player reaches the lobby.
  const loader = new Loader();
  loader.onProgress((s) => lobby.setLoad(s));
  const shadersDone = loader.addStep('Shaders');
  // UI images are fetched here too, so they are in the browser cache before the lobby needs them.
  const uiUrls = Object.values(
    import.meta.glob('./assets/ui/*.{webp,png}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>,
  );
  const loaded = await loader.loadAll([
    ...uiUrls.map((url) => ({ group: 'Interface' as const, url })),
    { group: 'Map', url: terrainUrl },
    { group: 'Map', url: treesUrl },
  ]);
  const [terrainBytes, treesBytes] = loaded.slice(-2);
  await document.fonts.ready;
  const terrain = parseTerrain(terrainBytes!);
  const trees = (JSON.parse(new TextDecoder().decode(treesBytes!)) as { trees: TreeList }).trees;

  const preview = createMapPreviewScene(engine, terrain, trees);
  preview.useMenuCamera();
  // Compile every material now, not when the match starts.
  await preview.scene.whenReadyAsync();
  shadersDone();

  const firstStart = gameData.map.starts[0]!.heroSpawn;
  router.onChange((name) => (name === 'game' ? preview.useGameCamera(firstStart) : name === 'menu' && preview.useMenuCamera()));
  engine.runRenderLoop(() => preview.scene.render());
}

main().catch((err: unknown) => {
  console.error(err);
  showFatalError(document.getElementById('ui')!, err instanceof Error ? err.message : String(err));
});
