import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './styles.css';
import './ui-skin.css';
import {
  BuffFlag,
  ENTITY_TYPES,
  gameData,
  lv,
  MAX_LEVEL,
  parseTerrain,
  xpForLevel,
  UnitState,
  type AbilityDef,
  type MatchStartInfo,
  type RoomState,
} from '@game/shared';
import { AimIndicators, type AimShape } from './render/aim-indicators';
import terrainUrl from '@game/shared/data/map-terrain.bin?url';
import treesUrl from '@game/shared/data/map-trees.json?url';
import decorUrl from '@game/shared/data/map-decor.json?url';
import { MatchClient } from './game/match-client';
import type { NetEntity } from './game/net-entity';
import { FloatingText } from './ui/floating-text';
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
import { abilityDetails } from './ui/ability-details';

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
  const floating = new FloatingText(uiHost);
  let selected: NetEntity | null = null;
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
  // Set up below, once the 3D world exists.
  let useAbility: (slot: number) => void = () => {};
  const game = createGameScreen({
    end: () => net.send(room?.hostId === myId ? { type: 'endMatch' } : { type: 'leaveRoom' }),
    cast: (slot) => useAbility(slot),
    learn: (slot) => match?.learn(slot),
  });
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
    match = new MatchClient(world, net, pendingMatch, floating);
    selected = null;
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
    (x, y) => {
      w.camera.follow = null;
      w.camera.lookAt(x, y);
    },
    (x, y) => {
      if (aim) return setAim(null);
      match?.moveTo(x, y, false);
    },
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

  // Hero panel and the info line of a selected unit, a few times per second.
  const unitName = (e: NetEntity) => {
    const id = ENTITY_TYPES[e.type] ?? '';
    const hero = gameData.heroes.find((h) => h.id === id);
    const owner = match?.info.slots.find((s) => s.index === e.owner)?.name;
    return hero ? `${hero.name}${owner ? ` (${owner})` : ''}` : (gameData.units.find((u) => u.id === id)?.name ?? id);
  };
  setInterval(() => {
    if (router.screen !== 'game' || !match) return;
    const own = match.ownHero;
    if (aim && own && own.state & UnitState.Dead) setAim(null);
    const p = match.player;
    const def = gameData.heroes.find((h) => h.id === ENTITY_TYPES[own?.type ?? -1]);
    if (own && def) {
      const prev = xpForLevel(p.level),
        next = p.level >= MAX_LEVEL ? prev : xpForLevel(p.level + 1);
      game.setHero({
        name: def.name,
        portrait: assets.has(`portraits/${def.id}.webp`) ? assets.url(`portraits/${def.id}.webp`) : null,
        level: p.level,
        xpFrac: next > prev ? (p.xp - prev) / (next - prev) : 1,
        hp: own.hp,
        maxHp: own.maxHp,
        mana: own.mana,
        maxMana: own.maxMana,
        gold: p.gold,
        respawn: Math.ceil(p.respawnTicks / 20),
        skillPoints: p.skillPoints,
      });
    }
    game.setAbilities(
      [0, 1, 2, 3].map((slot) => {
        const info = match!.ability(slot);
        if (!info) return null;
        const a = info.def;
        const level = Math.max(1, info.level);
        const numbers = [
          lv(a.manaCost, level) ? `${S.mana} ${lv(a.manaCost, level)}` : '',
          lv(a.params['healthCost'], level) ? `${S.healthCost} ${lv(a.params['healthCost'], level)}` : '',
          lv(a.cooldown, level) ? `${S.cooldown} ${lv(a.cooldown, level)} s` : '',
          lv(a.castRange, level) ? `${S.range} ${lv(a.castRange, level)}` : '',
        ].filter(Boolean);
        return {
          icon: assets.has(`icons/${a.id}.webp`) ? assets.url(`icons/${a.id}.webp`) : null,
          name: a.name,
          level: info.level,
          maxLevel: a.maxLevel,
          cooldownFrac: info.cooldownFrac,
          cooldownLeft: info.cooldownLeft,
          noMana: !info.enoughMana,
          passive: a.kind !== 'active',
          canLearn: info.canLearn,
          tooltip: [
            `${a.name} (${'QWER'[slot]}) — ${S.abilityKinds[a.kind] ?? a.kind} [${info.level}/${a.maxLevel}]`,
            a.text,
            ...abilityDetails(a, info.level),
            numbers.join(' · '),
          ],
        };
      }),
    );
    const sel = selected && match.entities.get(selected.id) === selected ? selected : null;
    game.setSelected(sel && sel !== own ? `${unitName(sel)} · ${S.level} ${sel.level} · ${sel.hp} / ${sel.maxHp}` : null);
  }, 125);

  // ---- mouse and keys: right click = move or attack, A + left click = attack-move,
  // Q W E R = abilities (then left click the target), Ctrl + Q W E R = learn,
  // left click = select, S = stop, H = hold, Space = center on the hero.
  let lastSpace = 0;
  type Aim = { kind: 'attack' } | { kind: 'ability'; slot: number } | null;
  let aim: Aim = null;
  const cursor = { x: 0, y: 0 };
  const indicators = new AimIndicators(w.scene);
  const setAim = (a: Aim) => {
    aim = a;
    document.body.classList.toggle('aiming', !!a);
    if (!a) indicators.hide();
  };
  const select = (e: NetEntity | null) => {
    selected = e;
    w.select(e?.unit ?? match?.ownHero?.unit ?? null);
  };
  /** Client-side check first, so the player gets a message at once. */
  useAbility = (slot) => {
    if (!match?.ownHero) return;
    if (match.ownHero.state & UnitState.Dead) return game.alert(S.deadAbility);
    const info = match.ability(slot);
    if (!info) return;
    const a = info.def;
    if (info.level === 0) return game.alert(info.canLearn ? S.learn : S.notLearned);
    if (a.kind !== 'active') return game.alert(S.passive);
    if (match.ownHero.buffs & BuffFlag.Stun) return game.alert(S.stunned);
    if (match.ownHero.buffs & BuffFlag.Silence) return game.alert(S.silenced);
    if (info.cooldownLeft > 0) return game.alert(S.abilityNotReady);
    if (!info.enoughMana) return game.alert(lv(a.params['healthCost'], 1) ? S.noHealth : S.noMana);
    if (a.target === 'none') return match.cast(slot, { kind: 0, id: 0, x: 0, y: 0 });
    setAim({ kind: 'ability', slot });
  };
  const aimShapes = {
    unit: { kind: 'unit' } as const,
    circle: { kind: 'circle' as const, radius: 0.8 },
    cone: { kind: 'cone' as const, length: 0, angleDeg: 0 },
    line: { kind: 'line' as const, length: 0, width: 0 },
  };
  const aimTarget = { x: 0, y: 0, r: 1 };
  const aimShape = (a: AbilityDef, level: number): AimShape => {
    if (a.target === 'unit') return aimShapes.unit;
    if (a.target === 'cone') {
      aimShapes.cone.length = lv(a.params['length'], level);
      aimShapes.cone.angleDeg = lv(a.params['angleDeg'], level);
      return aimShapes.cone;
    }
    if (a.target === 'line') {
      aimShapes.line.length = lv(a.params['length'], level);
      aimShapes.line.width = lv(a.params['width'], level);
      return aimShapes.line;
    }
    aimShapes.circle.radius = lv(a.params['radius'], level) || 0.8;
    return aimShapes.circle;
  };
  w.scene.onBeforeRenderObservable.add(() => {
    if (!aim || aim.kind !== 'ability' || !match?.ownHero?.unit) return;
    const info = match.ability(aim.slot);
    const p = w.pickGround(cursor.x, cursor.y);
    if (!info || !p) return;
    const h = match.ownHero.unit;
    const hit = info.def.target === 'unit' ? match.pick(cursor.x, cursor.y) : null;
    const level = Math.max(1, info.level);
    const range = info.def.target === 'line' || info.def.target === 'cone' ? 0 : lv(info.def.castRange, level);
    if (hit?.unit) {
      aimTarget.x = hit.unit.x;
      aimTarget.y = hit.unit.y;
      aimTarget.r = Math.max(0.9, hit.unit.height * hit.unit.model.root.scaling.y * 0.45);
    }
    indicators.show(
      aimShape(info.def, level),
      range,
      h.x,
      h.y,
      p.x,
      p.y,
      w.terrain.heightAt,
      hit?.unit ? aimTarget : null,
      !info.enoughMana || (!!hit && !match.canTarget(info.def, hit)),
    );
  });
  canvas.addEventListener('pointermove', (e) => {
    cursor.x = e.offsetX;
    cursor.y = e.offsetY;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (router.screen !== 'game' || !match) return;
    const hit = match.pick(e.offsetX, e.offsetY);
    if (e.button === 2) {
      if (aim) return setAim(null);
      if (hit && match.isEnemy(hit)) return match.attack(hit);
      const p = w.pickGround(e.offsetX, e.offsetY);
      if (p) match.moveTo(p.x, p.y, e.shiftKey);
    } else if (e.button === 0) {
      const a = aim;
      if (a?.kind === 'attack') {
        setAim(null);
        if (hit && match.isEnemy(hit)) return match.attack(hit);
        const p = w.pickGround(e.offsetX, e.offsetY);
        if (p) match.attackMove(p.x, p.y);
        return;
      }
      if (a?.kind === 'ability') {
        const info = match.ability(a.slot);
        if (!info) return setAim(null);
        if (info.def.target === 'unit') {
          if (!hit) return game.alert(S.pickTarget);
          if (!match.canTarget(info.def, hit)) return game.alert(info.def.filter.includes('enemy') ? S.pickEnemy : S.pickAlly);
          setAim(null);
          return match.cast(a.slot, { kind: 1, id: hit.id, x: 0, y: 0 });
        }
        const p = w.pickGround(e.offsetX, e.offsetY);
        if (!p) return;
        setAim(null);
        return match.cast(a.slot, { kind: 2, id: 0, x: p.x, y: p.y });
      }
      select(hit);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (router.screen !== 'game' || e.target instanceof HTMLInputElement || !match) return;
    // Held keys must not flood the server with casts or toggle follow repeatedly.
    if (e.repeat) return;
    const key = e.key.toLowerCase();
    if (e.key === ' ' || e.key === 'F1') {
      e.preventDefault();
      const h = match.ownHero?.unit;
      if (!h) return;
      const now = performance.now();
      w.camera.follow = now - lastSpace < 350 ? () => match?.ownHero?.unit ?? h : null;
      lastSpace = now;
      w.camera.lookAt(h.x, h.y, true);
    }
    const slot = ['q', 'w', 'e', 'r'].indexOf(key);
    if (slot >= 0) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) match.learn(slot);
      else useAbility(slot);
      return;
    }
    if (key === 'a') setAim({ kind: 'attack' });
    if (e.key === 'Escape') setAim(null);
    if (key === 's') match.stop();
    if (key === 'h') match.hold();
    if (e.key === 'F4') {
      e.preventDefault();
      w.toggleStress(300);
    }
    if (import.meta.env.DEV && e.key === 'F6') {
      e.preventDefault();
      net.send({ type: 'cheat', xp: 6000 });
      game.alert('Test: level 10, health, mana and cooldowns restored.');
    }
  });

  router.onChange((name) => {
    if (name !== 'game') setAim(null);
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
