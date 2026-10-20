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
  footprintOf,
  rectDistance,
  upgradeStatus,
  UPGRADE_IDS,
  UPGRADES,
  type FactionTech,
  isBuildingType,
  isMineType,
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
  UnitState,
  type AbilityDef,
  type ItemDef,
  type ItemStack,
  type MatchStartInfo,
  type RoomState,
  type PlayerSummary,
  heroAttributes,
  heroStats,
  statsOf,
  buildingDefOf,
  itemBonus,
  type HeroDef,
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
import { GAME_FPS, MENU_FPS, renderScale } from './render/render-budget';
import type { DecorItem } from './render/decor';
import { GameWorld, TEAMS, type TreeList } from './render/world';
import { startDebugOverlay } from './ui/debug-overlay';
import { createSettingsScreen } from './ui/settings-screen';
import { GameSound } from './audio/sound';
import { actionOf, loadSettings, saveSettings } from './game/settings';
import { createLobbyScreen, COLOR_NAMES } from './ui/lobby-screen';
import { Minimap } from './ui/minimap';
import { Router } from './ui/router';
import {
  createEndScreen,
  createGameScreen,
  createMenuScreen,
  showFatalError,
  toggleFullScreen,
  type ItemDrop,
  type ShopView,
  type TeamHeroView,
} from './ui/screens';
import { S } from './ui/strings';
import { abilityDetails } from './ui/ability-details';
import { isTextEntry } from './render/rts-camera';
import { abilityBlockReason } from './ui/ability-feedback';

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
  // ?watch=5 (dev): bots play all four slots, we watch at 5x speed. ?fps=30 caps the frame rate.
  const watchSpeed = Math.max(0, Math.min(10, Number(params.get('watch')) || 0));
  const gameFps = Math.max(10, Number(params.get('fps')) || GAME_FPS);
  let autoPlay = params.has('play') || watchSpeed > 0;
  let roomCheck: ReturnType<typeof setTimeout> | null = null;

  const router = new Router(uiHost);
  const floating = new FloatingText(uiHost);
  const sound = new GameSound();
  /** Tab scoreboard: latest rows from the server, shown while Tab is held */
  let scores: PlayerSummary[] = [];
  let scoresShown = false;
  let showScores = () => {};
  let lastBaseAlert = 0;
  const settings = loadSettings();
  /** Set once the engine and the world exist (applies graphics, camera and HUD settings). */
  let applySettings = () => {};
  let selected: NetEntity | null = null;
  const menu = createMenuScreen({
    getName: () => playerName,
    setName: (n) => {
      saveName(n);
      net.send({ type: 'setName', name: n });
    },
    create: () => net.send({ type: 'createRoom' }),
    join: (code) => net.send({ type: 'joinRoom', code }),
    settings: () => openSettings(),
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
    end: () => net.send(import.meta.env.DEV && room?.hostId === myId ? { type: 'endMatch' } : { type: 'leaveRoom' }),
    cast: (slot) => useAbility(slot),
    settings: () => openSettings(),
    chat: (text) => net.send({ type: 'chat', text }),
    showBase: () => {
      const hall = match && [...match.entities.values()].find((e) => e.owner === match!.slot && HALL_TYPES.has(e.type) && e.unit);
      if (hall?.unit) {
        w.camera.follow = null;
        w.camera.lookAt(hall.unit.x, hall.unit.y);
      }
    },
    learn: (slot) => match?.learn(slot),
    useItem: (slot) => useItem(slot),
    buy: (item) => buyItem(item),
    dragItem: (slot, to) => dragItem(slot, to),
    closeShop: () => closeShop(),
  });
  router.add('menu', menu);
  router.add('lobby', lobby);
  router.add('game', game);
  const endScreen = createEndScreen(router);
  router.add('end', endScreen);
  // Alerts: the horn for an attack on the base, a short buzz for the rest ("Not enough gold.").
  const showAlert = game.alert.bind(game);
  game.alert = (text) => {
    showAlert(text);
    sound.play(text === S.baseAttacked ? 'horn' : 'error', text === S.baseAttacked ? 'voice' : 'ui');
  };
  // A click sound for every button and shop slot in the menus and the HUD.
  uiHost.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('button, .shop-item')) sound.play('click', 'ui');
  });
  const settingsScreen = createSettingsScreen(settings, () => {
    saveSettings(settings);
    applySettings();
  });
  router.add('settings', settingsScreen);
  const openSettings = () => {
    const prev = router.screen ?? 'menu';
    settingsScreen.backTo = () => router.show(prev === 'settings' ? 'menu' : prev);
    router.show('settings');
  };
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
    if (watchSpeed) {
      for (const s of room.slots) if (s.kind === 'open') net.send({ type: 'setSlotKind', slot: s.index, kind: 'bot' });
      net.send({ type: 'start', watch: { speed: watchSpeed } });
    } else net.send({ type: 'start' });
  };
  const endMatch = () => {
    sound.stopMusic();
    match?.dispose();
    match = null;
    pendingMatch = null;
  };
  const startMatchIfReady = () => {
    if (!world || !pendingMatch) return;
    match?.dispose();
    const m = new MatchClient(world, net, pendingMatch, floating);
    match = m;
    m.allBars = settings.healthBars === 'always';
    m.sound = sound;
    sound.playMusic('battle');
    m.onNotice = (code) => game.alert(code === NoticeCode.AllyFull ? S.allyFull : S.inventoryFull);
    game.setResult(null);
    game.setFaction(null);
    const nameOf = (slot: number) => m.info.slots.find((s) => s.index === slot)?.name ?? '';
    m.onDefeated = (slot) => {
      if (slot === m.slot) game.setResult(S.defeat, S.youLose);
      else game.alert(S.playerLost(nameOf(slot)));
    };
    m.onHeroKilled = (victim, killerId) => {
      const nameOf2 = (slot: number) => m.info.slots.find((s) => s.index === slot)?.name ?? '';
      const heroName = (e: NetEntity) => gameData.heroes.find((h) => h.id === ENTITY_TYPES[e.type])?.name ?? '';
      const killer = m.entities.get(killerId);
      const victimText = S.heroOf(nameOf2(victim.owner), heroName(victim));
      if (killer && killer.owner < 4 && killer.owner !== victim.owner) game.killFeed(S.killedBy(nameOf2(killer.owner), victimText));
      else game.killFeed(S.diedTo(victimText, killer && killer.owner < 4 ? nameOf2(killer.owner) : S.monsters));
    };
    m.onMatchOver = (team) => {
      const won = team === m.myTeam;
      game.setResult(m.spectator ? S.teamWins(team) : won ? S.victory : S.defeat, `${won ? S.youWin : S.teamWins(team)} ${S.backSoon}`);
      sound.stopMusic();
      sound.play(won || m.spectator ? 'victory' : 'defeat', 'voice');
    };
    selected = null;
    pendingMatch = null;
    game.setStatus(matchGoing ? S.matchRunning : S.matchWaiting);
    router.show('game');
    net.send({ type: 'matchReady' });
  };

  net.onChange((s) => {
    lobby.setNet(s);
    menu.setOnline(s.status === 'online');
    game.setPing(s.pingMs, s.status);
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
            // A restored room cancels this timer in the room handler below.
            // `room` was cleared while waiting; that is precisely the lost-session case.
            roomCheck = null;
            room = null;
            endMatch();
            router.show('menu');
          }, 1500);
          room = null;
        }
        if (joinCode) net.send({ type: 'joinRoom', code: joinCode });
        joinCode = null;
        // A rejoin already has a room/match on its way. Creating another room here gets
        // rejected and its error screen used to hide the restored match (?play/?watch).
        if (msg.inRoom) autoPlay = false;
        if (autoPlay) net.send({ type: 'createRoom' });
        net.send({ type: 'listRooms' });
        break;
      case 'room':
        if (roomCheck) clearTimeout(roomCheck);
        room = msg.room;
        lobby.setRoom(room, myId);
        if (room.phase === 'lobby' && !match && router.screen !== 'lobby' && router.screen !== 'end') router.show('lobby');
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
        if (router.screen === 'game') game.chatLine(msg.from, msg.text, !!msg.system);
        break;
      case 'error':
        if (router.screen === 'lobby') lobby.showError(msg.text);
        else menu.showError(msg.text);
        break;
      case 'scores':
        scores = msg.scores;
        if (scoresShown) showScores();
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
      case 'matchEnd': {
        const info = match?.info;
        const myTeam = match?.myTeam ?? 0;
        const spectator = match?.spectator ?? false;
        endMatch();
        // A won match shows the end screen with the stats; "Back to Lobby" leads on.
        if (msg.summary && msg.winnerTeam && info) {
          const s = msg.summary;
          const time = `${Math.floor(s.seconds / 60)}:${String(s.seconds % 60).padStart(2, '0')}`;
          endScreen.set(
            spectator ? null : msg.winnerTeam === myTeam,
            S.teamWinsAt(msg.winnerTeam, time),
            s.players.map((p) => ({
              name: info.slots.find((x) => x.index === p.slot)?.name ?? '',
              hero: gameData.heroes.find((h) => h.id === p.hero)?.name ?? p.hero,
              team: p.team,
              level: p.level,
              kills: p.kills,
              deaths: p.deaths,
              gold: p.gold,
              camps: p.camps,
              upgrades: p.upgrades,
              own: p.slot === info.yourSlot,
            })),
          );
          router.show('end');
        } else router.show('lobby');
        break;
      }
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

  // Decoding sounds can not fail the game: it just stays silent.
  await sound.load(assets).catch((err: unknown) => console.warn('Sounds not loaded:', err));
  const w = await GameWorld.create(engine, canvas, terrain, trees, decor, assets);
  world = w;
  if (import.meta.env.DEV) Object.assign(window as object, { world: w, net, sound, match: () => match }); // for debugging in the console
  // Compile every material and model now, not when the match starts.
  await w.library.warmUp(TEAMS);
  await w.warmUpGroundMarks();
  await w.scene.whenReadyAsync();
  sceneReady = true;
  shadersDone();
  loadPct = 100;
  sendLoad();
  clearInterval(loadTimer);
  maybeAutoStart();
  applySettings = () => {
    // Native pixels at render scale 1 (see render-budget), fewer pixels below it.
    engine.setHardwareScalingLevel(renderScale(window.devicePixelRatio) / settings.renderScale);
    w.scene.shadowsEnabled = settings.shadows;
    debugNode.hidden = !settings.showFps;
    w.camera.edgeScroll = settings.edgeScroll;
    w.camera.speedScale = settings.cameraSpeed;
    floating.damageNumbers = settings.damageNumbers;
    w.combat.setQuality(settings.effects);
    sound.setVolumes(settings.master, settings.music, settings.sfx, settings.voice);
    if (match) match.allBars = settings.healthBars === 'always';
  };
  applySettings();
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
  const dots: { x: number; y: number; color: string; size: number }[] = [];
  setInterval(() => {
    if (router.screen !== 'game') return;
    if (match) game.setClock(match.seconds);
    dots.length = 0;
    for (const e of match?.entities.values() ?? []) {
      const u = e.unit;
      if (!u || e.state & UnitState.Hidden) continue;
      if (isMineType(e.type)) dots.push({ x: u.x, y: u.y, color: '#ffd24a', size: 5 });
      else if (isBuildingType(e.type)) dots.push({ x: u.x, y: u.y, color: TEAM_HEX[e.color]!, size: footprintOf(e.type)[0] >= 5 ? 7 : 5 });
      else dots.push({ x: u.x, y: u.y, color: e === match!.ownHero ? '#ffffff' : TEAM_HEX[e.color]!, size: e === match!.ownHero ? 5 : 3 });
    }
    minimap.setFog(match?.fogGrid ?? null);
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
  // ---- Town Hall upgrades: the same panel, when the hero stands at its own finished Town Hall.
  /** the panel shows the Town Hall upgrades (not a shop) */
  let hallShown = false;
  /** closed by the player while standing there: do not open again until the hero leaves */
  let hallClosed = false;
  const HALL_TYPES = new Set(['town_hall', 'stronghold', 'citadel'].map((id) => ENTITY_TYPES.indexOf(id)));
  const hallNear = (): boolean => {
    const u = match?.ownHero?.unit;
    if (!match || !u || u.dead) return false;
    for (const e of match.entities.values()) {
      if (e.owner !== match.slot || !HALL_TYPES.has(e.type) || e.state & (UnitState.Constructing | UnitState.Dead) || !e.unit) continue;
      const [w, h] = footprintOf(e.type);
      if (rectDistance(u.x, u.y, e.unit.x, e.unit.y, w, h) <= gameData.upgrades.useRange - 0.2) return true;
    }
    return false;
  };
  const buildingName = (id: string) => gameData.buildings.buildings.find((b) => b.id === id)?.name ?? id;
  const hallView = (): ShopView => {
    const f = match!.faction;
    const tech: FactionTech = {
      tier: Math.max(1, Math.min(3, f.tier)) as 1 | 2 | 3,
      buildings: new Set(f.tech.map((t) => ENTITY_TYPES[t]!)),
      levels: Object.fromEntries(UPGRADE_IDS.map((id, i) => [id, f.upgrades[i] ?? 0])),
      readyAt: Object.fromEntries(UPGRADE_IDS.map((id, i) => [id, f.upgradeReady[i] ?? 0])),
    };
    const now = match!.clock.serverTick();
    return {
      name: S.hallUpgrades,
      hint: S.hallHint,
      inRange: true,
      items: UPGRADES.map((d, i) => {
        const st = upgradeStatus(UPGRADE_IDS[i]!, tech, match!.player.gold, now);
        const lines = [d.name, d.text, d.repeatable ? '' : S.upgradeLevel(st.level, st.maxLevel)];
        if (st.cost !== null && st.problem !== 'max') lines.push(`${S.gold}: ${st.cost}`);
        // The reason it can not be bought comes last: the alert shows it.
        const why =
          st.problem === 'needs'
            ? S.upgradeNeeds(st.needs.map(buildingName).join(', '))
            : st.problem === 'cooldown'
              ? S.upgradeReady(Math.ceil(((f.upgradeReady[i] ?? 0) - now) / 20))
              : st.problem === 'citadel'
                ? S.upgradeCitadel
                : st.problem === 'gold'
                  ? S.noGold
                  : st.problem === 'max'
                    ? S.upgradeMax
                    : '';
        if (why) lines.push(why);
        return {
          item: i,
          icon: assets.has(`icons/up_${d.id}.webp`) ? assets.url(`icons/up_${d.id}.webp`) : null,
          cost: st.cost ?? 0,
          label: st.problem === 'max' ? S.upgradeMax : undefined,
          canAfford: st.ok,
          tooltip: lines.filter(Boolean),
        };
      }),
    };
  };
  const updateShop = () => {
    const near = shopNear();
    // No map shop open: the Town Hall panel when the hero is at its own hall.
    if (!shop && near < 0 && match?.hasFaction) {
      const atHall = hallNear();
      if (!atHall) hallClosed = false;
      hallShown = atHall && !hallClosed;
      if (hallShown) return game.setShop(hallView());
    } else hallShown = false;
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
    if (hallShown) {
      hallClosed = true;
      hallShown = false;
      return game.setShop(null);
    }
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
    if (hallShown && match) {
      if (!hallNear()) return game.alert(S.goToHall);
      const view = hallView().items[item];
      if (view && !view.canAfford) return game.alert(view.tooltip[view.tooltip.length - 1] ?? S.noGold);
      // (the last tooltip line is the reason: needs, cooldown, gold, done)
      return match.buyUpgrade(item);
    }
    if (!match?.ownHero || !shop) return;
    const d = ITEMS[item]!;
    if (shopNear() !== shop.index) return game.alert(S.goToShop);
    if (match.player.gold < (d.cost ?? Infinity)) return game.alert(S.noGold);
    if (!canStore(myInventory(), item, newCharges(item))) return game.alert(S.inventoryFull);
    match.buy(item);
  };

  /** The hero's attributes, damage and armor with its items (same math as the server). */
  const heroStatsLine = (def: HeroDef, level: number): string => {
    const bonus = itemBonus(myInventory());
    const base = heroAttributes(def, level);
    const st = heroStats(def, level, bonus);
    const str = base.strength + (bonus.strength ?? 0),
      agi = base.agility + (bonus.agility ?? 0),
      int = base.intelligence + (bonus.intelligence ?? 0);
    return `${S.strShort} ${str} · ${S.agiShort} ${agi} · ${S.intShort} ${int} · ${S.damageShort} ${Math.round(st.damageMin)}-${Math.round(st.damageMax)} · ${S.armor} ${Math.round(st.armor)}`;
  };
  // Hero panel and the info line of a selected unit, a few times per second.
  const unitName = (e: NetEntity) => {
    const id = ENTITY_TYPES[e.type] ?? '';
    const hero = gameData.heroes.find((h) => h.id === id);
    const owner = match?.info.slots.find((s) => s.index === e.owner)?.name;
    return hero
      ? `${hero.name}${owner ? ` (${owner})` : ''}`
      : (gameData.units.find((u) => u.id === id)?.name ?? buildingDefOf(e.type)?.name ?? (isMineType(e.type) ? 'Gold Mine' : id));
  };
  setInterval(() => {
    if (router.screen !== 'game' || !match) return;
    const own = match.ownHero;
    if (match.spectator) {
      // Watch mode: one line per faction.
      game.setFaction(null);
      const lines: string[] = [`${S.watching} ×${match.info.watch ?? 1}`];
      for (const s of match.info.slots) {
        const f = match.factions.get(s.index);
        if (f)
          lines.push(
            `${COLOR_NAMES[s.color] ?? s.index}: ${f.gold}g ${f.wood}w · ${f.supplyUsed}/${f.supplyCap} · T${f.tier} · ${f.workers}w ${f.army}a · ${f.status}`,
          );
      }
      game.setStatus(lines.join('\n'));
    } else {
      game.setFaction(match.hasFaction ? match.faction : null);
      // "Your base is under attack!" when the AI starts defending (not more than every 20 s).
      const now = performance.now();
      if (match.faction.status.startsWith('Defending') && now - lastBaseAlert > 20_000) {
        lastBaseAlert = now;
        game.alert(S.baseAttacked);
      }
    }
    // Allied heroes in the top bar: level from the scoreboard, health from what we see.
    const allies: TeamHeroView[] = [];
    for (const s of match.info.slots) {
      if (s.index === match.slot || match.info.slots.find((x) => x.index === match!.slot)?.team !== s.team) continue;
      const hero = [...match.entities.values()].find((e) => e.owner === s.index && isHeroType(e.type));
      const row = scores.find((r) => r.slot === s.index);
      const def = gameData.heroes.find((h) => h.id === s.hero);
      allies.push({
        name: s.name,
        color: TEAM_HEX[s.color] ?? '#fff',
        level: row?.level ?? hero?.level ?? 1,
        hp: hero && hero.maxHp ? hero.hp / hero.maxHp : -1,
        portrait: def && assets.has(`portraits/${def.id}.webp`) ? assets.url(`portraits/${def.id}.webp`) : null,
      });
    }
    game.setTeam(allies);
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
        statsLine: heroStatsLine(def, p.level),
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
          stateLabel:
            info.level === 0
              ? info.canLearn
                ? 'Learn +'
                : slot === 3 && p.level < 6
                  ? 'Level 6'
                  : 'Not learned'
              : a.kind !== 'active'
                ? 'Passive'
                : '',
          blocked: abilityBlockReason(info, own?.state ?? 0, own?.buffs ?? 0),
          tooltip: [
            `${a.name} (${'QWER'[slot]}) — ${S.abilityKinds[a.kind] ?? a.kind} [${info.level}/${a.maxLevel}]`,
            a.text,
            info.level === 0
              ? info.canLearn
                ? 'Use + or Ctrl + key to learn this skill first.'
                : 'Gain a skill point and meet the level requirement to learn.'
              : a.kind !== 'active'
                ? 'Works automatically. No cast needed.'
                : 'Press the key or click the icon, then choose a target.',
            ...abilityDetails(a, info.level),
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
      sel && sel !== own
        ? (() => {
            const st = isHeroType(sel.type) ? heroStats(gameData.heroes[sel.type]!, sel.level) : statsOf(sel.type);
            const relation = sel.owner === 255 ? 'Neutral' : match.isEnemy(sel) ? 'Enemy' : 'Ally';
            const owner = match.info.slots.find((slot) => slot.index === sel.owner);
            return [
              `${relation}${owner ? ` · ${owner.name} · ${COLOR_NAMES[owner.color]}` : ''} · ${st.layer === 'ground' ? 'Ground' : 'Flying'}`,
              `Health ${Math.ceil(sel.hp)}/${sel.maxHp}${sel.maxMana ? ` · Mana ${Math.floor(sel.mana)}/${sel.maxMana}` : ''}`,
              `Base damage ${st.damageMin}–${st.damageMax} · Base armor ${st.armor.toFixed(1)} · Range ${st.attackRange} · Speed ${st.moveSpeed}`,
              match.isEnemy(sel)
                ? 'Right-click the unit or its marker to attack.'
                : 'Right-click the unit or its marker to follow. S: stop.',
            ];
          })()
        : undefined,
      sel && assets.has(`portraits/${ENTITY_TYPES[sel.type]}.webp`) ? assets.url(`portraits/${ENTITY_TYPES[sel.type]}.webp`) : undefined,
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
    const blocked = abilityBlockReason(info, match.ownHero.state, match.ownHero.buffs);
    if (blocked) return game.alert(blocked);
    if (a.target === 'none') return match.cast(slot, { kind: 0, id: 0, x: 0, y: 0 });
    setAim({ kind: 'ability', slot });
    if (settings.quickCast) fireAim(cursor.x, cursor.y);
  };
  const aimShapes = {
    unit: { kind: 'unit' } as const,
    circle: { kind: 'circle' as const, radius: 0.8 },
    cone: { kind: 'cone' as const, length: 0, angleDeg: 0 },
    line: { kind: 'line' as const, length: 0, width: 0 },
  };
  const aimTarget = { x: 0, y: 0, r: 1 };
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
    if (settings.quickCast) fireAim(cursor.x, cursor.y);
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
      !!abilityBlockReason(info, match.ownHero.state, match.ownHero.buffs) || (!!hit && !match.canTarget(info.def, hit)),
    );
  });
  /** Fires the aimed order at a screen point (left click, or at once with quick cast). */
  const fireAim = (x: number, y: number, hit: NetEntity | null = match?.pick(x, y) ?? null): void => {
    if (!match) return;
    const a = aim;
    if (a?.kind === 'item') {
      const it = match.item(a.slot);
      setAim(null);
      if (!it?.def.active) return;
      if (it.def.active.target === 'unit') {
        if (!hit) return game.alert(S.pickTarget);
        return match.useItem(a.slot, { kind: 1, id: hit.id, x: 0, y: 0 });
      }
      const p = w.pickGround(x, y);
      if (p) match.useItem(a.slot, { kind: 2, id: 0, x: p.x, y: p.y });
      return;
    }
    if (a?.kind === 'attack') {
      setAim(null);
      if (hit && match.isEnemy(hit)) return match.attack(hit);
      if (hit && hit !== match.ownHero && !isBuildingType(hit.type)) {
        match.follow(hit);
        return game.alert(`Following ${unitName(hit)}. S: stop.`);
      }
      const p = w.pickGround(x, y);
      if (p) match.attackMove(p.x, p.y);
      return;
    }
    if (a?.kind === 'ability') {
      const info = match.ability(a.slot);
      if (!info) return setAim(null);
      const own = match.ownHero;
      if (!own) return setAim(null);
      const blocked = abilityBlockReason(info, own.state, own.buffs);
      if (blocked) return game.alert(blocked);
      if (info.def.target === 'unit') {
        if (!hit) return game.alert(S.pickTarget);
        if (!match.canTarget(info.def, hit)) return game.alert(info.def.filter.includes('enemy') ? S.pickEnemy : S.pickAlly);
        setAim(null);
        return match.cast(a.slot, { kind: 1, id: hit.id, x: 0, y: 0 });
      }
      const p = w.pickGround(x, y);
      if (!p) return;
      setAim(null);
      return match.cast(a.slot, { kind: 2, id: 0, x: p.x, y: p.y });
    }
  };
  canvas.addEventListener('pointermove', (e) => {
    cursor.x = e.offsetX;
    cursor.y = e.offsetY;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointerdown', (e) => {
    if (router.screen !== 'game' || !match || w.camera.dragging || e.altKey || e.button === 1) return;
    const hit = match.pick(e.offsetX, e.offsetY);
    if (e.button === 2) {
      if (aim) return setAim(null);
      if (hit && match.isEnemy(hit)) return match.attack(hit);
      if (hit && hit !== match.ownHero && !isBuildingType(hit.type)) {
        match.follow(hit);
        return game.alert(`Following ${unitName(hit)}. S: stop.`);
      }
      const item = match.pickGroundItem(e.offsetX, e.offsetY);
      if (item) {
        if (!canStore(myInventory(), item.item, item.charges)) return game.alert(S.inventoryFull);
        return match.pickUp(item.id);
      }
      const p = w.pickGround(e.offsetX, e.offsetY);
      if (p) match.moveTo(p.x, p.y, e.shiftKey);
    } else if (e.button === 0) {
      if (aim) return fireAim(e.offsetX, e.offsetY, hit);
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
    if (router.screen !== 'game' || isTextEntry(e.target) || !match) return;
    // Held keys must not flood the server with casts or toggle follow repeatedly.
    if (e.repeat) return;
    if (e.key === 'Enter') {
      e.preventDefault();
      return game.toggleChat();
    }
    const action = actionOf(settings, e.code);
    if (action === 'hero' || e.key === 'F1') {
      e.preventDefault();
      const h = match.ownHero?.unit;
      if (!h) return;
      const now = performance.now();
      w.camera.follow = now - lastSpace < 350 ? () => match?.ownHero?.unit ?? h : null;
      lastSpace = now;
      w.camera.lookAt(h.x, h.y, true);
    }
    const slot = action ? ['ability1', 'ability2', 'ability3', 'ability4'].indexOf(action) : -1;
    if (slot >= 0) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) match.learn(slot);
      else useAbility(slot);
      return;
    }
    const itemKey = action ? ['item1', 'item2', 'item3', 'item4', 'item5', 'item6'].indexOf(action) : -1;
    if (itemKey >= 0) {
      e.preventDefault();
      return useItem(itemKey);
    }
    if (action === 'attack') setAim({ kind: 'attack' });
    if (e.key === 'Escape') {
      if (aim) setAim(null);
      else closeShop();
    }
    if (action === 'stop') match.stop();
    if (action === 'hold') match.hold();
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

  // ---- Tab scoreboard: shown while Tab is held.
  showScores = () => {
    if (!match) return game.setScores(null);
    const info = match.info;
    game.setScores(
      scores.map((r) => ({
        name: info.slots.find((x) => x.index === r.slot)?.name ?? '',
        hero: gameData.heroes.find((h) => h.id === r.hero)?.name ?? r.hero,
        color: TEAM_HEX[r.color] ?? '#fff',
        level: r.level,
        kills: r.kills,
        deaths: r.deaths,
        gold: r.gold,
        camps: r.camps,
        army: r.army,
        tier: r.tier,
        own: r.slot === info.yourSlot,
        out: r.defeated,
      })),
    );
  };
  window.addEventListener('keydown', (e) => {
    if (e.code !== 'Tab' || router.screen !== 'game' || isTextEntry(e.target)) return;
    e.preventDefault();
    if (scoresShown) return;
    scoresShown = true;
    showScores();
  });
  window.addEventListener('keyup', (e) => {
    if (e.code !== 'Tab' || !scoresShown) return;
    scoresShown = false;
    game.setScores(null);
  });
  window.addEventListener('blur', () => {
    scoresShown = false;
    game.setScores(null);
  });

  router.onChange((name) => {
    // Settings keep what is behind them (a running match stays a match).
    if (name === 'settings') {
      w.camera.enabled = false;
      return setAim(null);
    }
    if (name !== 'game') setAim(null);
    engine.maxFPS = name === 'game' ? gameFps : MENU_FPS;
    w.setMenuMode(name !== 'game');
  });
  w.setMenuMode(router.screen !== 'game');
  engine.maxFPS = router.screen === 'game' ? gameFps : MENU_FPS;
  engine.runRenderLoop(() => {
    if (!document.hidden) w.scene.render();
  });
}

main().catch((err: unknown) => {
  console.error(err);
  showFatalError(document.getElementById('ui')!, err instanceof Error ? err.message : String(err));
});
