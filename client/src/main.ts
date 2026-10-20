import '@fontsource/cinzel/600.css';
import '@fontsource/cinzel/800.css';
import '@fontsource/alegreya-sans/400.css';
import '@fontsource/alegreya-sans/700.css';
import './styles.css';
import './ui-skin.css';
import {
  BuffFlag,
  canStore,
  ENTITY_TYPES,
  gameData,
  isHeroType,
  itemIndex,
  ITEMS,
  lv,
  MAX_LEVEL,
  newCharges,
  NoticeCode,
  parseTerrain,
  sellValue,
  xpForLevel,
  type AbilityDef,
  type ItemDef,
  type ItemStack,
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
import { createEndScreen, createGameScreen, createMenuScreen, showFatalError, toggleFullScreen, type ItemDrop } from './ui/screens';
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
  let useItem: (slot: number) => void = () => {};
  let buyItem: (item: number) => void = () => {};
  let dragItem: (slot: number, to: ItemDrop) => void = () => {};
  let closeShop: () => void = () => {};
  const game = createGameScreen({
    end: () => net.send(room?.hostId === myId ? { type: 'endMatch' } : { type: 'leaveRoom' }),
    cast: (slot) => useAbility(slot),
    learn: (slot) => match?.learn(slot),
    useItem: (slot) => useItem(slot),
    buy: (item) => buyItem(item),
    dragItem: (slot, to) => dragItem(slot, to),
    closeShop: () => closeShop(),
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
    match.onNotice = (code) => game.alert(code === NoticeCode.AllyFull ? S.allyFull : S.inventoryFull);
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

  // ---- items and shops
  const itemIcon = (d: ItemDef) => (assets.has(`icons/${d.id}.webp`) ? assets.url(`icons/${d.id}.webp`) : null);
  const itemTooltip = (d: ItemDef, st: ItemStack | null, slot = -1): string[] => {
    const numbers = [
      st?.charges ? `${S.charges} ${st.charges}` : '',
      d.active?.cooldown ? `${S.cooldown} ${d.active.cooldown} s` : '',
      d.active?.castRange ? `${S.range} ${d.active.castRange}` : '',
      st ? `${S.sellPrice} ${sellValue(st)}` : d.cost === null ? S.dropOnlyItem : `${S.gold} ${d.cost}`,
    ].filter(Boolean);
    return [`${d.name}${slot >= 0 ? ` (${slot + 1})` : ''} — ${S.itemTiers[d.tier] ?? d.tier}`, d.text, numbers.join(' · ')];
  };
  /** Shop on the map (index in map shops) the panel shows; pinned = opened by a click. */
  let shop: { index: number; pinned: boolean } | null = null;
  /** The player closed the panel of this shop while standing near it: do not open it again. */
  let shopClosedNear = -1;
  let selectedItem = 0;
  const shopDefOf = (index: number) => gameData.shops.find((d) => d.id === gameData.map.shops[index]?.type);
  /** Map shop index the own hero stands near, or -1. */
  const shopNear = (): number => {
    const h = match?.ownHero;
    const u = h?.unit;
    if (!h || !u || u.dead) return -1;
    return gameData.map.shops.findIndex((s, i) => {
      const def = shopDefOf(i);
      // A little inside the server's range, so a click near the edge is not refused.
      return !!def && Math.hypot(s.pos[0] - u.x, s.pos[1] - u.y) <= def.useRange - 0.2;
    });
  };
  const updateShop = () => {
    const near = shopNear();
    if (near < 0) shopClosedNear = -1;
    if (near >= 0 && !shop && near !== shopClosedNear) shop = { index: near, pinned: false };
    if (shop && !shop.pinned && near !== shop.index) shop = null;
    const def = shop ? shopDefOf(shop.index) : undefined;
    if (!shop || !def || !match) return game.setShop(null);
    const gold = match.player.gold;
    game.setShop({
      name: def.name,
      inRange: near === shop.index,
      items: def.items.map((id) => {
        const d = ITEMS[itemIndex(id)]!;
        return {
          item: itemIndex(id),
          icon: itemIcon(d),
          cost: d.cost ?? 0,
          canAfford: gold >= (d.cost ?? 0),
          tooltip: itemTooltip(d, null),
        };
      }),
    });
  };
  closeShop = () => {
    if (shop && shopNear() === shop.index) shopClosedNear = shop.index;
    shop = null;
    game.setShop(null);
  };
  /** The inventory as the client knows it (for "is there room?" before asking the server). */
  const myInventory = (): (ItemStack | null)[] =>
    [0, 1, 2, 3, 4, 5].map((i) => {
      const info = match?.item(i);
      return info ? { item: info.index, charges: info.charges } : null;
    });
  buyItem = (item) => {
    if (!match?.ownHero || !shop) return;
    const d = ITEMS[item]!;
    if (shopNear() !== shop.index) return game.alert(S.goToShop);
    if (match.player.gold < (d.cost ?? Infinity)) return game.alert(S.noGold);
    if (!canStore(myInventory(), item, newCharges(item))) return game.alert(S.inventoryFull);
    match.buy(item);
  };

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
            numbers.join(' · '),
          ],
        };
      }),
    );
    game.setItems(
      [0, 1, 2, 3, 4, 5].map((slot) => {
        const info = match!.item(slot);
        if (!info) return null;
        return {
          icon: itemIcon(info.def),
          charges: info.charges,
          cooldownFrac: info.cooldownFrac,
          cooldownLeft: info.cooldownLeft,
          usable: !!info.def.active,
          tooltip: itemTooltip(info.def, { item: info.index, charges: info.charges }, slot),
        };
      }),
    );
    updateShop();
    const sel = selected && match.entities.get(selected.id) === selected ? selected : null;
    const groundSel = selectedItem ? match.groundItems.get(selectedItem) : undefined;
    if (!groundSel) selectedItem = 0;
    game.setSelected(
      groundSel
        ? `${ITEMS[groundSel.item]?.name ?? ''}${groundSel.charges ? ` (${groundSel.charges})` : ''}`
        : sel && sel !== own
          ? `${unitName(sel)} · ${S.level} ${sel.level} · ${sel.hp} / ${sel.maxHp}`
          : null,
    );
  }, 125);

  // ---- mouse and keys: right click = move or attack, A + left click = attack-move,
  // Q W E R = abilities (then left click the target), Ctrl + Q W E R = learn,
  // left click = select, S = stop, H = hold, Space = center on the hero.
  let lastSpace = 0;
  type Aim = { kind: 'attack' } | { kind: 'ability'; slot: number } | { kind: 'item'; slot: number } | null;
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
    const info = match.ability(slot);
    if (!info) return;
    const a = info.def;
    if (info.level === 0) return game.alert(info.canLearn ? S.learn : S.notLearned);
    if (a.kind !== 'active') return game.alert(S.passive);
    if (match.ownHero.buffs & BuffFlag.Stun) return game.alert(S.stunned);
    if (info.cooldownLeft > 0) return game.alert(S.abilityNotReady);
    if (!info.enoughMana) return game.alert(lv(a.params['healthCost'], 1) ? S.noHealth : S.noMana);
    if (a.target === 'none') return match.cast(slot, { kind: 0, id: 0, x: 0, y: 0 });
    setAim({ kind: 'ability', slot });
  };
  useItem = (slot) => {
    if (!match?.ownHero) return;
    const info = match.item(slot);
    if (!info) return;
    const a = info.def.active;
    if (!a) return game.alert(S.itemPassive);
    if (match.ownHero.buffs & BuffFlag.Stun || match.player.respawnTicks > 0) return game.alert(S.stunned);
    if (info.cooldownLeft > 0) return game.alert(S.itemNotReady);
    if (a.target === 'none') return match.useItem(slot, { kind: 0, id: 0, x: 0, y: 0 });
    setAim({ kind: 'item', slot });
  };
  dragItem = (slot, to) => {
    if (!match) return;
    const info = match.item(slot);
    if (!info) return;
    if (to.kind === 'slot') return match.swapItems(slot, to.slot);
    if (to.kind === 'shop') {
      if (!shop || shopNear() !== shop.index) return game.alert(S.goToShop);
      const gold = sellValue({ item: info.index, charges: info.charges });
      return game.confirm(S.sellFor(info.def.name, gold), () => match?.sell(slot));
    }
    const r = canvas.getBoundingClientRect();
    const sx = to.clientX - r.left,
      sy = to.clientY - r.top;
    const hit = match.pick(sx, sy);
    if (hit && hit !== match.ownHero && isHeroType(hit.type) && !match.isEnemy(hit)) return match.giveItem(slot, hit);
    const p = w.pickGround(sx, sy);
    if (p) match.dropItem(slot, p.x, p.y);
  };
  /** A shop building under a screen point (CSS pixels): map shop index, or -1. */
  const pickShop = (sx: number, sy: number): number => {
    const pt = { x: 0, y: 0 };
    return gameData.map.shops.findIndex((s) => w.screenPoint(s.pos[0], s.pos[1], 1.5, pt) && Math.hypot(pt.x - sx, pt.y - sy) < 45);
  };
  const aimShape = (a: AbilityDef, level: number): AimShape => {
    if (a.target === 'unit') return { kind: 'unit' };
    if (a.target === 'cone') return { kind: 'cone', length: lv(a.params['length'], level), angleDeg: lv(a.params['angleDeg'], level) };
    if (a.target === 'line') return { kind: 'line', length: lv(a.params['length'], level), width: lv(a.params['width'], level) };
    return { kind: 'circle', radius: lv(a.params['radius'], level) || 0.8 };
  };
  w.scene.onBeforeRenderObservable.add(() => {
    if (aim?.kind === 'item' && match?.ownHero?.unit) {
      const it = match.item(aim.slot);
      const p = w.pickGround(cursor.x, cursor.y);
      if (!it?.def.active || !p) return;
      const h = match.ownHero.unit;
      indicators.show({ kind: 'circle', radius: 0.8 }, it.def.active.castRange ?? 0, h.x, h.y, p.x, p.y, w.terrain.heightAt, null, false);
      return;
    }
    if (!aim || aim.kind !== 'ability' || !match?.ownHero?.unit) return;
    const info = match.ability(aim.slot);
    const p = w.pickGround(cursor.x, cursor.y);
    if (!info || !p) return;
    const h = match.ownHero.unit;
    const hit = info.def.target === 'unit' ? match.pick(cursor.x, cursor.y) : null;
    const level = Math.max(1, info.level);
    const range = info.def.target === 'line' || info.def.target === 'cone' ? 0 : lv(info.def.castRange, level);
    indicators.show(
      aimShape(info.def, level),
      range,
      h.x,
      h.y,
      p.x,
      p.y,
      w.terrain.heightAt,
      hit?.unit ? { x: hit.unit.x, y: hit.unit.y, r: Math.max(0.9, hit.unit.height * 0.45) } : null,
      !info.enoughMana,
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
      const item = match.pickGroundItem(e.offsetX, e.offsetY);
      if (item) {
        if (!canStore(myInventory(), item.item, item.charges)) return game.alert(S.inventoryFull);
        return match.pickUp(item.id);
      }
      const p = w.pickGround(e.offsetX, e.offsetY);
      if (p) match.moveTo(p.x, p.y, e.shiftKey);
    } else if (e.button === 0) {
      const a = aim;
      if (a?.kind === 'item') {
        const it = match.item(a.slot);
        setAim(null);
        if (!it?.def.active) return;
        if (it.def.active.target === 'unit') {
          if (!hit) return game.alert(S.pickTarget);
          return match.useItem(a.slot, { kind: 1, id: hit.id, x: 0, y: 0 });
        }
        const p = w.pickGround(e.offsetX, e.offsetY);
        if (p) match.useItem(a.slot, { kind: 2, id: 0, x: p.x, y: p.y });
        return;
      }
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
          setAim(null);
          return match.cast(a.slot, { kind: 1, id: hit.id, x: 0, y: 0 });
        }
        const p = w.pickGround(e.offsetX, e.offsetY);
        if (!p) return;
        setAim(null);
        return match.cast(a.slot, { kind: 2, id: 0, x: p.x, y: p.y });
      }
      selectedItem = 0;
      if (!hit) {
        const item = match.pickGroundItem(e.offsetX, e.offsetY);
        if (item) {
          selectedItem = item.id;
          return select(null);
        }
        const s = pickShop(e.offsetX, e.offsetY);
        if (s >= 0) {
          shop = { index: s, pinned: true };
          updateShop();
        }
      }
      select(hit);
    }
  });
  window.addEventListener('keydown', (e) => {
    if (router.screen !== 'game' || e.target instanceof HTMLInputElement || !match) return;
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
    const itemKey = ['1', '2', '3', '4', '5', '6'].indexOf(e.key);
    if (itemKey >= 0) {
      e.preventDefault();
      return useItem(itemKey);
    }
    if (key === 'a') setAim({ kind: 'attack' });
    if (e.key === 'Escape') {
      if (aim) setAim(null);
      else closeShop();
    }
    if (key === 's') match.stop();
    if (key === 'h') match.hold();
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
