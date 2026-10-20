import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './styles.css';
import './ui-skin.css';
import { gameData, parseTerrain, type MatchStartInfo, type RoomState } from '@game/shared';
import terrainUrl from '@game/shared/data/map-terrain.bin?url';
import treesUrl from '@game/shared/data/map-trees.json?url';
import decorUrl from '@game/shared/data/map-decor.json?url';
import { MatchClient } from './game/match-client';
import { loadGameAssets, registerAssetCache } from './loader/assets';
import { Loader } from './loader/loader';
import { defaultServerUrl, GameSocket } from './net/socket';
import { createEngine } from './render/engine';
import { GAME_FPS, MENU_FPS } from './render/render-budget';
import type { DecorItem } from './render/decor';
import { GameWorld, TEAMS, type TreeList } from './render/world';
import { startDebugOverlay } from './ui/debug-overlay';
import { createLobbyScreen } from './ui/lobby-screen';
import { Minimap } from './ui/minimap';
import { Router } from './ui/router';
import { createEndScreen, createGameScreen, createMenuScreen, showFatalError, toggleFullScreen } from './ui/screens';
import { S } from './ui/strings';

const NAME_KEY = 'tw.playerName';
function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) || 'Player';
  } catch {
    return 'Player';
  }
}
let playerName = readName();
const saveName = (n: string) => {
  playerName = n;
  try {
    localStorage.setItem(NAME_KEY, n);
  } catch {
    // private mode: name is kept for this visit only
  }
};

const TEAM_HEX = ['#D42A2A', '#2A5BD4', '#1FB5A8', '#7B2FBF'];

async function main(): Promise<void> {
  const canvas = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiHost = document.getElementById('ui')!;
  const debugNode = document.getElementById('debug')!;
  const params = new URLSearchParams(location.search);

  const net = new GameSocket(defaultServerUrl(), () => playerName);
  let myId: string | null = null;
  let room: RoomState | null = null;
  let world: GameWorld | null = null;
  let match: MatchClient | null = null;
  let pendingMatch: MatchStartInfo | null = null;
  let matchGoing = false;
  let loadPct = 0;
  let sceneReady = false;
  let sentLoad = -1;
  let joinCode = params.get('join')?.trim().toUpperCase() || null;
  // Dev shortcut: ?play makes a room and starts a match alone as soon as loading is done.
  let autoPlay = params.has('play');
  let roomCheck: ReturnType<typeof setTimeout> | null = null;

  const router = new Router(uiHost);
  const menu = createMenuScreen({
    getName: () => playerName,
    setName: (n) => {
      saveName(n);
      net.send({ type: 'setName', name: n });
    },
    create: () => net.send({ type: 'createRoom' }),
    join: (code) => net.send({ type: 'joinRoom', code }),
    refreshRooms: () => net.send({ type: 'listRooms' }),
  });
  const lobby = createLobbyScreen((msg) => net.send(msg));
  const game = createGameScreen(() => net.send(room?.hostId === myId ? { type: 'endMatch' } : { type: 'leaveRoom' }));
  router.add('menu', menu);
  router.add('lobby', lobby);
  router.add('game', game);
  router.add('end', createEndScreen(router));
  router.show('menu');

  window.addEventListener('keydown', (ev) => {
    if (ev.key === 'F11') {
      ev.preventDefault();
      toggleFullScreen();
    }
  });

  const sendLoad = () => {
    if (!room || room.phase !== 'lobby' || loadPct === sentLoad) return;
    sentLoad = loadPct;
    net.send({ type: 'load', pct: loadPct });
  };
  const maybeAutoStart = () => {
    if (!autoPlay || !room || room.phase !== 'lobby' || room.hostId !== myId) return;
    if (room.slots.find((s) => s.playerId === myId)?.load !== 100) return;
    autoPlay = false;
    net.send({ type: 'start' });
  };
  const endMatch = () => {
    match?.dispose();
    match = null;
    pendingMatch = null;
  };
  const startMatchIfReady = () => {
    if (!world || !pendingMatch) return;
    match?.dispose();
    match = new MatchClient(world, net, pendingMatch);
    pendingMatch = null;
    game.setStatus(matchGoing ? S.matchRunning : S.matchWaiting);
    router.show('game');
    net.send({ type: 'matchReady' });
  };

  net.onChange((s) => {
    lobby.setNet(s);
    menu.setOnline(s.status === 'online');
    game.setPing(s.pingMs);
  });
  net.onLobby((msg) => {
    switch (msg.type) {
      case 'welcome':
        myId = msg.playerId;
        sentLoad = -1;
        // We were in a room but the server does not know us any more (it restarted): back to the menu.
        if (room) {
          if (roomCheck) clearTimeout(roomCheck);
          roomCheck = setTimeout(() => {
            if (!room) return;
            room = null;
            endMatch();
            router.show('menu');
          }, 1500);
          room = null;
        }
        if (joinCode) net.send({ type: 'joinRoom', code: joinCode });
        joinCode = null;
        if (autoPlay) net.send({ type: 'createRoom' });
        net.send({ type: 'listRooms' });
        break;
      case 'room':
        if (roomCheck) clearTimeout(roomCheck);
        room = msg.room;
        lobby.setRoom(room, myId);
        if (room.phase === 'lobby' && !match && router.screen !== 'lobby') router.show('lobby');
        sendLoad();
        maybeAutoStart();
        break;
      case 'roomLeft':
        room = null;
        endMatch();
        router.show('menu');
        if (msg.reason === 'kicked') menu.showError(S.kicked);
        if (msg.reason === 'closed') menu.showError(S.roomClosed);
        net.send({ type: 'listRooms' });
        break;
      case 'chat':
        lobby.addChat(msg.from, msg.text, !!msg.system);
        break;
      case 'error':
        if (router.screen === 'lobby') lobby.showError(msg.text);
        else menu.showError(msg.text);
        break;
      case 'roomList':
        menu.setRooms(msg.rooms);
        break;
      case 'matchStart':
        matchGoing = false;
        pendingMatch = msg.match;
        startMatchIfReady();
        break;
      case 'matchGo':
        matchGoing = true;
        game.setStatus(S.matchRunning);
        break;
      case 'matchEnd':
        endMatch();
        router.show('lobby');
        break;
    }
  });
  net.connect();

  const { engine, kind } = await createEngine(canvas);
  registerAssetCache();

  // Loading starts at once, so it is done (or nearly) when the player reaches the lobby.
  const loader = new Loader();
  loader.onProgress((s) => {
    lobby.setLoad(s);
    // 100% only when the scene is built and the shaders are compiled (below).
    loadPct = sceneReady ? 100 : Math.min(99, Math.floor(s.fraction * 100));
  });
  const loadTimer = setInterval(sendLoad, 500);
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

  const w = await GameWorld.create(engine, canvas, terrain, trees, decor, assets);
  world = w;
  if (import.meta.env.DEV) Object.assign(window as object, { world: w, net, match: () => match }); // for debugging in the console
  // Compile every material and model now, not when the match starts.
  await w.library.warmUp(TEAMS);
  await w.scene.whenReadyAsync();
  sceneReady = true;
  shadersDone();
  loadPct = 100;
  sendLoad();
  clearInterval(loadTimer);
  maybeAutoStart();
  startDebugOverlay(debugNode, engine, kind, net.state, w.scene, () => {
    const lag = net.state.lag.lagMs || net.state.lag.lossPct ? ` · lag +${net.state.lag.lagMs} ms ${net.state.lag.lossPct}%` : '';
    const p = match?.predictor?.stats;
    const fix = p ? ` · fixes ${p.corrections}/${p.snaps}` : '';
    return ` · down ${(net.state.downBps / 1024).toFixed(1)} KB/s${lag}${fix}`;
  });
  startMatchIfReady();

  // ---- game screen input
  const minimapHost = uiHost.querySelector<HTMLElement>('.minimap')!;
  const minimap = new Minimap(
    minimapHost,
    terrain,
    gameData.map,
    (x, y) => w.camera.lookAt(x, y),
    (x, y) => match?.moveTo(x, y, false),
  );
  const townHalls = gameData.map.starts.map((s) => ({ x: s.townHall[0], y: s.townHall[1], color: '#e8dcc0', size: 6 }));
  setInterval(() => {
    if (router.screen !== 'game') return;
    if (match) game.setClock(match.seconds);
    const dots = [...townHalls];
    for (const e of match?.entities.values() ?? []) {
      const u = e.unit;
      if (u)
        dots.push({ x: u.x, y: u.y, color: e === match!.ownHero ? '#ffffff' : TEAM_HEX[e.color]!, size: e === match!.ownHero ? 5 : 3 });
    }
    minimap.draw(dots, { x: w.camera.target.x, y: w.camera.target.y + 4, w: 46, h: 30 });
  }, 120);

  let lastSpace = 0;
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (router.screen !== 'game' || e.button !== 2) return;
    const p = w.pickGround(e.offsetX, e.offsetY);
    if (p) match?.moveTo(p.x, p.y, e.shiftKey);
  });
  window.addEventListener('keydown', (e) => {
    if (router.screen !== 'game' || e.target instanceof HTMLInputElement) return;
    if (e.key === ' ' || e.key === 'F1') {
      e.preventDefault();
      const h = w.selected;
      if (!h) return;
      const now = performance.now();
      w.camera.follow = now - lastSpace < 350 ? () => w.selected ?? h : null;
      lastSpace = now;
      w.camera.lookAt(h.x, h.y, true);
    }
    if (e.key === 's' || e.key === 'S') match?.stop();
    if (e.key === 'F4') {
      e.preventDefault();
      w.toggleStress(300);
    }
  });

  router.onChange((name) => {
    engine.maxFPS = name === 'game' ? GAME_FPS : MENU_FPS;
    w.setMenuMode(name !== 'game');
  });
  w.setMenuMode(router.screen !== 'game');
  engine.maxFPS = router.screen === 'game' ? GAME_FPS : MENU_FPS;
  engine.runRenderLoop(() => {
    if (!document.hidden) w.scene.render();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  showFatalError(document.getElementById('ui')!, err instanceof Error ? err.message : String(err));
});
