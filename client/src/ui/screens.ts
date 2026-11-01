// Main Menu, Game HUD frame and End screen. The lobby is in lobby-screen.ts.
// The real HUD comes in Phase 9.

import { gameData, KINGDOM_ORDERS, ORDER_NAMES, upkeepStep, type RoomSummary } from '@game/shared';
import type { NetStatus } from '../net/socket';
import type { BuffView } from './buff-view';
import { el, setText } from './dom';
import type { Router, Screen } from './router';
import { S } from './strings';
import { createItemContextMenu } from './item-context-menu';

export function toggleFullScreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
  else if (document.documentElement.requestFullscreen) void document.documentElement.requestFullscreen().catch(() => undefined);
}

export interface MenuScreen extends Screen {
  showError(text: string): void;
  setOnline(online: boolean): void;
  setRooms(rooms: RoomSummary[]): void;
}

export interface MenuActions {
  getName(): string;
  setName(n: string): void;
  create(): void;
  join(code: string): void;
  refreshRooms(): void;
  settings(): void;
}

export function createMenuScreen(actions: MenuActions): MenuScreen {
  const nameInput = el('input', { class: 'field', maxlength: '24', value: actions.getName(), 'aria-label': S.yourName });
  nameInput.addEventListener('change', () => actions.setName(nameInput.value.trim() || 'Player'));
  const codeInput = el('input', { class: 'field code', placeholder: S.code, maxlength: '5' });
  const createBtn = el('button', { class: 'btn', onclick: () => actions.create() }, S.createGame);
  const joinBtn = el('button', { class: 'btn', onclick: () => codeInput.value.trim() && actions.join(codeInput.value.trim()) }, S.joinGame);
  codeInput.addEventListener('keydown', (e) => e.key === 'Enter' && joinBtn.click());
  codeInput.addEventListener('input', () => (codeInput.value = codeInput.value.toUpperCase()));
  const errorLine = el('p', { class: 'lobby-error', hidden: true });

  // ---- game list: every game on this server, with a search by host name or code
  let rooms: RoomSummary[] = [];
  const countLine = el('span', { class: 'muted' }, '');
  const search = el('input', { class: 'field', placeholder: S.searchGames, maxlength: '24' });
  const list = el('ul', { class: 'room-list' });
  const renderRooms = () => {
    const q = search.value.trim().toLowerCase();
    const shown = rooms.filter((r) => !q || r.host.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    const open = rooms.filter((r) => r.phase === 'lobby').length;
    setText(countLine, S.gamesCount(open, rooms.length - open));
    list.replaceChildren(
      ...(shown.length
        ? shown.map((r) => {
            const players = `${r.humans + r.bots} / ${r.humans + r.bots + r.open}`;
            const canJoin = r.phase === 'lobby' && r.open > 0;
            return el(
              'li',
              { class: canJoin ? '' : 'full' },
              el('span', { class: 'room-name' }, S.gameOf(r.host)),
              el('span', { class: 'room-code' }, r.code),
              el('span', { class: 'room-players' }, players),
              canJoin
                ? el('button', { class: 'btn tiny', onclick: () => actions.join(r.code) }, S.join)
                : el('span', { class: 'muted' }, r.phase === 'playing' ? S.inGame : S.full),
            );
          })
        : [el('li', { class: 'muted empty' }, rooms.length ? S.noGamesFound : S.noGames)]),
    );
  };
  search.addEventListener('input', renderRooms);
  const gamesPanel = el(
    'div',
    { class: 'games' },
    el(
      'div',
      { class: 'games-head' },
      el('h3', {}, S.games),
      countLine,
      el('button', { class: 'btn tiny', onclick: () => actions.refreshRooms() }, S.refresh),
    ),
    search,
    list,
  );
  renderRooms();
  // Keep the list fresh while the menu is open.
  setInterval(() => {
    if (!root.hidden && !playPanel.hidden) actions.refreshRooms();
  }, 3000);
  const playPanel = el(
    'div',
    { class: 'panel ornate play-panel', hidden: true },
    el('label', { class: 'field-label' }, S.yourName, nameInput),
    el('div', { class: 'row' }, createBtn, joinBtn, codeInput),
    errorLine,
    gamesPanel,
  );
  const root = el(
    'section',
    { class: 'screen menu' },
    el('div', { class: 'banner left' }),
    el('div', { class: 'banner right' }),
    el('div', { class: 'crest' }),
    el('h1', { class: 'title' }, S.gameTitle),
    el('div', { class: 'divider' }),
    el(
      'nav',
      { class: 'menu-buttons' },
      el(
        'button',
        {
          class: 'btn big',
          onclick: () => {
            playPanel.hidden = !playPanel.hidden;
            if (!playPanel.hidden) actions.refreshRooms();
          },
        },
        S.play,
      ),
      el('button', { class: 'btn big', onclick: () => actions.settings() }, S.settings),
      el('button', { class: 'btn big', disabled: true, title: S.comingSoon }, S.credits),
    ),
    playPanel,
    el('button', { class: 'btn small corner', onclick: toggleFullScreen }, `⛶ ${S.fullScreen}`),
  );
  return {
    root,
    showError(text) {
      playPanel.hidden = false;
      errorLine.hidden = false;
      setText(errorLine, text);
    },
    setOnline(online) {
      createBtn.disabled = joinBtn.disabled = !online;
      createBtn.title = joinBtn.title = online ? '' : S.netOffline;
    },
    setRooms(r) {
      rooms = r;
      renderRooms();
    },
  };
}

export interface HeroView {
  name: string;
  portrait: string | null;
  level: number;
  /** 0..1 of the way to the next level */
  xpFrac: number;
  hp: number;
  maxHp: number;
  mana: number;
  maxMana: number;
  gold: number;
  /** seconds until back, 0 when alive */
  respawn: number;
  skillPoints: number;
  /** "Str 28 · Agi 21 · Int 40 · Dmg 47-53 · Armor 4" (tooltip of the stats box) */
  statsLine: string;
  stats: HeroStatsView;
}

/** The small stats box left of the portrait (with items). */
export interface HeroStatsView {
  strength: number;
  agility: number;
  intelligence: number;
  main: 'strength' | 'agility' | 'intelligence';
  damageMin: number;
  damageMax: number;
  armor: number;
  moveSpeed: number;
}

export interface AbilityButtonView {
  icon: string | null;
  name: string;
  level: number;
  maxLevel: number;
  /** 0..1 still to wait */
  cooldownFrac: number;
  cooldownLeft: number;
  noMana: boolean;
  passive: boolean;
  canLearn: boolean;
  stateLabel?: string;
  blocked?: string | null;
  /** tooltip lines: name line, text, numbers */
  tooltip: string[];
}

/** One ability of the selected hero or unit (any owner): icon and tooltip only, no button. */
export interface InspectIconView {
  icon: string | null;
  /** Q W E R, or empty for unit skills */
  key: string;
  /** first letter shown when there is no icon */
  letter: string;
  passive: boolean;
  tooltip: string[];
  /** an own unit's active skill: a button (GameActions.useUnitSkill with its index) */
  usable?: boolean;
  /** seconds until it is ready again (0 = ready) */
  cooldownLeft?: number;
  /** 0..1 still to wait */
  cooldownFrac?: number;
  noMana?: boolean;
  /** a hero's skill: its level now (0 = not learned) and the most it can get */
  level?: number;
  maxLevel?: number;
}

/** What the selected unit carries and what works on it (heroes: items too). */
export interface SelectedExtra {
  buffs?: BuffView[];
  /** 6 slots of a hero, null = empty slot */
  items?: ({ icon: string | null; tooltip: string[] } | null)[];
}

export interface ItemSlotView {
  item: number;
  icon: string | null;
  /** 0 = no number on the slot */
  charges: number;
  cooldownFrac: number;
  cooldownLeft: number;
  /** can be used with a click or its key */
  usable: boolean;
  tooltip: string[];
}

export interface ShopItemView {
  /** index in items.json (or in upgrades.json for the Town Hall) */
  item: number;
  icon: string | null;
  cost: number;
  /** shown instead of the price ("Done") */
  label?: string | undefined;
  canAfford: boolean;
  tooltip: string[];
}

export interface ShopView {
  name: string;
  /** line under the grid (default: buy / sell hint) */
  hint?: string;
  items: ShopItemView[];
  /** the hero is close enough to buy and sell */
  inRange: boolean;
}

/** Where an inventory item was dragged to. */
export type ItemDrop = { kind: 'slot'; slot: number } | { kind: 'shop' } | { kind: 'world'; clientX: number; clientY: number };

export interface GameScreen extends Screen {
  setAbilities(views: (AbilityButtonView | null)[]): void;
  setItems(views: (ItemSlotView | null)[]): void;
  /** The shop panel above the inventory, or null to close it. */
  setShop(view: ShopView | null): void;
  /** A yes / no question in the shop panel ("Sell for 125 gold?"). */
  confirm(text: string, onYes: () => void): void;
  /** Short message in the middle of the screen ("Not enough mana."). */
  alert(text: string): void;
  setClock(seconds: number): void;
  setPing(ms: number | null, status?: NetStatus): void;
  setStatus(text: string): void;
  setHero(v: HeroView): void;
  /** Info line for a selected unit that is not your hero, or null. */
  setSelected(text: string | null, details?: string[], portrait?: string, abilities?: InspectIconView[], extra?: SelectedExtra): void;
  /** The own hero's buffs and debuffs, above the console. */
  setBuffs(views: BuffView[]): void;
  /** Small card next to the mouse over a unit in the world (null hides it). */
  setHoverCard(lines: string[] | null, x?: number, y?: number): void;
  /** The player's AI faction, or null before the first faction data. */
  setFaction(v: FactionView | null): void;
  /** the kingdom order panel (null: hidden, e.g. when watching) */
  setOrders(v: OrdersView | null): void;
  /** Big line in the middle: Victory / Defeat. null hides it. */
  setResult(title: string | null, text?: string): void;
  /** Tab scoreboard rows (null hides it). */
  setScores(rows: ScoreRow[] | null): void;
  /** One line in the kill feed (top right, fades after a few seconds). */
  killFeed(text: string): void;
  /** Heroes in the top bar: allies left of the clock, enemies right of it. */
  setTeam(allies: TeamHeroView[], enemies?: TeamHeroView[]): void;
  /** Every frame: smooth cooldown sweeps (the views come only a few times per second). */
  animate(now: number): void;
  /** A chat line in the match (fades after a while). */
  chatLine(from: string, text: string, system: boolean): void;
  /** Enter: open the chat box, or send what is typed. */
  toggleChat(): void;
}

export interface ScoreRow {
  name: string;
  hero: string;
  color: string;
  level: number;
  kills: number;
  deaths: number;
  gold: number;
  camps: number;
  army: number;
  tier: number;
  own: boolean;
  out: boolean;
}

export interface TeamHeroView {
  name: string;
  color: string;
  level: number;
  /** 0..1, or -1 when not known */
  hp: number;
  portrait: string | null;
  /** waiting to respawn */
  dead?: boolean;
}

export interface FactionView {
  gold: number;
  wood: number;
  supplyUsed: number;
  supplyCap: number;
  tier: number;
  workers: number;
  army: number;
  status: string;
}

/** An enemy kingdom the players can order an attack on. */
export interface OrderEnemy {
  slot: number;
  name: string;
  color: string;
}

/** The kingdom's order panel: the order now (index in KINGDOM_ORDERS) and who can be attacked. */
export interface OrdersView {
  order: number;
  target: number;
  enemies: OrderEnemy[];
}

export interface GameActions {
  end(): void;
  cast(slot: number): void;
  learn(slot: number): void;
  useItem(slot: number): void;
  dropItem(slot: number): void;
  itemIcon(item: number): string | null;
  buy(item: number): void;
  dragItem(slot: number, to: ItemDrop): void;
  closeShop(): void;
  settings(): void;
  /** click on the "Your Kingdom" panel: the camera goes to the base */
  showBase(): void;
  /** an order to the kingdom AI (index in KINGDOM_ORDERS; target = kingdom slot for attack) */
  kingdomOrder(order: number, target: number): void;
  /** press skill `index` of the selected own unit */
  useUnitSkill(index: number): void;
  chat(text: string): void;
  captureMouse(): void;
}

/** A cooldown sweep: the game sends the time left a few times a second, the HUD draws it every frame. */
interface Sweep {
  /** performance.now() when it is ready, 0 = ready */
  end: number;
  /** full length in ms */
  total: number;
  /** last drawn fraction (to skip DOM writes) */
  shown: number;
}

const newSweep = (): Sweep => ({ end: 0, total: 0, shown: -1 });

/** Small differences are clock noise between two updates; keep the old end so the sweep never jumps back. */
const SWEEP_SNAP_MS = 150;

function armSweep(s: Sweep, left: number, frac: number, now: number): void {
  if (left <= 0 || frac <= 0) {
    s.end = 0;
    return;
  }
  const end = now + left * 1000;
  if (Math.abs(end - s.end) > SWEEP_SNAP_MS) s.end = end;
  s.total = (left / frac) * 1000;
}

function drawSweep(s: Sweep, cd: HTMLElement, text: HTMLElement, now: number): void {
  const left = s.end - now;
  const frac = left > 0 && s.total > 0 ? Math.min(1, left / s.total) : 0;
  // 1/500 of a turn is less than one pixel on the icon.
  const step = Math.round(frac * 500) / 500;
  if (step === s.shown) return;
  s.shown = step;
  cd.hidden = step <= 0;
  cd.style.setProperty('--cd', String(step));
  setText(text, left > 0 ? String(Math.ceil(left / 1000)) : '');
}

/** Bars scale on the GPU (transform) and ease between updates in CSS. */
function setFill(fill: HTMLElement, frac: number): void {
  const value = `scaleX(${Math.max(0, Math.min(1, frac)).toFixed(4)})`;
  if (fill.style.transform !== value) fill.style.transform = value;
}

export function createGameScreen(actions: GameActions): GameScreen {
  const onEnd = actions.end;
  const clock = el('span', { class: 'clock' }, '00:00');
  const ping = el('span', { class: 'hud-ping' }, '');
  const status = el('p', { class: 'kingdom-status' }, S.aiIdle);
  /** One number with its icon in the top bar ("res gold" + "25"). */
  const resource = (icon: string, title: string) => {
    const value = el('b', {}, '0');
    const root = el('span', { class: 'res', title }, el('i', { class: `res-icon ${icon}` }), value);
    return { root, value };
  };
  const kGold = resource('gold', S.kingdomGoldTip);
  const kWood = resource('wood', S.kingdomWoodTip);
  const kSupply = resource('supply', S.supply);
  const kArmy = resource('army', S.army);
  const kTier = el('span', { class: 'res tier', title: S.tier }, '');
  const facRes = el('span', { class: 'faction-res', hidden: true }, kGold.root, kWood.root, kSupply.root, kArmy.root, kTier);
  const orders = el('div', { class: 'kingdom-orders', hidden: true });
  let ordersKey = '';
  const resultTitle = el('h1', { class: 'title' });
  const resultText = el('p', {});
  const result = el('div', { class: 'hud-result', hidden: true }, resultTitle, resultText);
  const scoreBody = el('tbody');
  const scoreboard = el(
    'div',
    { class: 'panel scoreboard', hidden: true },
    el(
      'table',
      {},
      el(
        'thead',
        {},
        el('tr', {}, ...[S.player, S.hero, S.levelShort, S.kills, S.deaths, S.gold, S.camps, S.army, S.tier].map((t) => el('th', {}, t))),
      ),
      scoreBody,
    ),
  );
  const feed = el('div', { class: 'kill-feed' });
  const chatLog = el('div', { class: 'hud-chat-log' });
  const chatInput = el('input', { class: 'hud-chat-input', maxlength: '200', placeholder: S.chatHint, hidden: true });
  chatInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      chatInput.value = '';
      chatInput.hidden = true;
      chatInput.blur();
    }
    if (e.key === 'Enter') {
      const text = chatInput.value.trim();
      if (text) actions.chat(text);
      chatInput.value = '';
      chatInput.hidden = true;
      chatInput.blur();
    }
  });
  const team = el('span', { class: 'hud-team allies' });
  const enemyTeam = el('span', { class: 'hud-team enemies' });
  let teamKey = '';
  const goldValue = el('b', {}, String(gameData.rules.gold.startGold));
  const gold = el('span', { class: 'gold', title: S.heroGoldTip }, el('i', { class: 'res-icon gold' }), goldValue);
  const portraitImg = el('div', { class: 'portrait-img' });
  const portraitLevel = el('span', { class: 'portrait-level' }, '1');
  const points = el('span', { class: 'skill-points', hidden: true });
  const xpFill = el('div', { class: 'xp-fill' });
  const portrait = el('div', { class: 'portrait' }, portraitImg, portraitLevel, points, el('div', { class: 'xp-track' }, xpFill));
  const heroName = el('span', { class: 'hero-name' });
  const heroLevel = el('span', { class: 'hero-level' });
  const hpFill = el('div', { class: 'fill' });
  const hpText = el('span', { class: 'bar-label' });
  const mpFill = el('div', { class: 'fill' });
  const mpText = el('span', { class: 'bar-label' });
  /** One row of the stats box: icon + number. */
  const statRow = (icon: string, title: string) => {
    const value = el('b', {}, '');
    const root = el('span', { class: `stat ${icon}`, title }, el('i', { class: `stat-icon ${icon}` }), value);
    return { root, value };
  };
  const sDamage = statRow('damage', S.statDamageTip);
  const sArmor = statRow('armor', S.statArmorTip);
  const sSpeed = statRow('speed', S.statSpeedTip);
  const sStr = statRow('strength', S.statStrTip);
  const sAgi = statRow('agility', S.statAgiTip);
  const sInt = statRow('intelligence', S.statIntTip);
  const statLine = el(
    'div',
    { class: 'hero-stats' },
    el('div', { class: 'stat-col' }, sDamage.root, sArmor.root, sSpeed.root),
    el('div', { class: 'stat-col' }, sStr.root, sAgi.root, sInt.root),
  );
  let mainStat = '';
  const deathNote = el('div', { class: 'death-note', hidden: true });
  const selectedTitle = el('strong');
  const selectedDetails = el('div', { class: 'selected-details' });
  const selectedPortrait = el('div', { class: 'selected-portrait' });
  const selectedAbilities = el('div', { class: 'sel-abilities' });
  const selItems = el('div', { class: 'sel-items', hidden: true });
  let selItemsKey = '';
  const selInfo = el(
    'aside',
    { class: 'sel-info', hidden: true, 'aria-label': 'Selected unit' },
    selectedPortrait,
    selectedTitle,
    selectedDetails,
    selectedAbilities,
    selItems,
  );
  /** Tooltips of the selected panel open above it, so they do not cover it. */
  const tipAboveSel = (lines: string[]) => {
    showTip(lines);
    tooltip.style.bottom = `${window.innerHeight - selInfo.getBoundingClientRect().top + 6}px`;
  };
  const hoverCard = el('div', { class: 'hover-card', hidden: true });
  /** The ability icons of the selected unit; own units' active skills are buttons. */
  const buildSelAbilities = (abilities: InspectIconView[], key: string) => {
    selectedAbilitiesKey = key;
    selectedAbilities.hidden = !abilities.length;
    selParts = abilities.map((a, index) => {
      const icon = el('div', { class: 'ability-icon' }, a.icon ? '' : a.letter);
      if (a.icon) icon.style.backgroundImage = `url(${a.icon})`;
      const cd = el('div', { class: 'cooldown' });
      const cdText = el('span', { class: 'cooldown-text' });
      const unlearned = a.level === 0;
      const cls = `sel-ability${a.passive ? ' passive' : ''}${a.usable ? ' usable' : ''}${unlearned ? ' unlearned' : ''}`;
      const pips =
        a.maxLevel !== undefined
          ? el(
              'div',
              { class: 'pips' },
              ...Array.from({ length: a.maxLevel }, (_, n) => el('i', { class: n < (a.level ?? 0) ? 'on' : '' })),
            )
          : null;
      const root = el('div', { class: cls, 'aria-label': a.tooltip[0] ?? '' }, icon, cd, cdText, el('span', { class: 'key' }, a.key), pips);
      if (a.usable) {
        root.setAttribute('role', 'button');
        root.addEventListener('click', () => actions.useUnitSkill(index));
      }
      // Above the panel, so the tooltip does not cover it.
      root.addEventListener('mouseenter', () => {
        showTip(a.usable ? [...a.tooltip, S.clickToUse] : a.tooltip);
        tooltip.style.bottom = `${window.innerHeight - selInfo.getBoundingClientRect().top + 6}px`;
      });
      root.addEventListener('mouseleave', hideTip);
      return { root, cd, cdText };
    });
    selectedAbilities.replaceChildren(...selParts.map((p) => p.root));
    // The hovered icon is gone when the selection changes.
    if (!tooltip.hidden && tooltip.style.bottom) hideTip();
  };
  let hoverKey = '';
  let selectedKey = '';
  let selectedAbilitiesKey = '';
  let selParts: { root: HTMLElement; cd: HTMLElement; cdText: HTMLElement }[] = [];
  let portraitUrl: string | null = null;
  const tooltip = el('div', { class: 'tooltip', hidden: true });
  const alertBox = el('div', { class: 'hud-alert', hidden: true });
  let alertTimer: ReturnType<typeof setTimeout> | null = null;
  let views: (AbilityButtonView | null)[] = [];
  let hoveredAbility = -1;
  let tooltipKey = '';
  const refreshTooltip = () => {
    const view = views[hoveredAbility];
    if (!view) return;
    const key = view.tooltip.join('\n');
    if (key !== tooltipKey) {
      tooltipKey = key;
      tooltip.replaceChildren(...view.tooltip.map((line, i) => el(i === 0 ? 'b' : 'p', {}, line)));
    }
    tooltip.hidden = false;
  };
  const showTip = (lines: string[]) => {
    tooltipKey = '';
    tooltip.replaceChildren(...lines.map((line, i) => el(i === 0 ? 'b' : 'p', {}, line)));
    tooltip.hidden = false;
  };
  const hideTip = () => {
    tooltip.hidden = true;
    tooltip.style.bottom = '';
  };

  /** A row of buff icons: rebuilt when the set changes, the time left is updated in place. */
  const buffRow = (cls: string, tip: (lines: string[]) => void) => {
    const root = el('div', { class: `buff-row ${cls}`, hidden: true });
    let key = '';
    let views: BuffView[] = [];
    let parts: HTMLElement[] = [];
    const timeText = (b: BuffView) => (b.left <= 0 ? '' : b.left < 10 ? b.left.toFixed(1).replace(/\.0$/, '') : String(Math.ceil(b.left)));
    return {
      root,
      set(v: BuffView[]) {
        views = v;
        root.hidden = !v.length;
        const k = v.map((b) => `${b.key}:${b.stacks}:${b.icon ?? ''}`).join(',');
        if (k !== key) {
          key = k;
          parts = v.map((b, i) => {
            const icon = el('i', { class: 'buff-icon' }, b.icon ? '' : b.letter);
            if (b.icon) icon.style.backgroundImage = `url(${b.icon})`;
            const left = el('span', { class: 'buff-left' });
            const node = el(
              'div',
              { class: `buff ${b.harmful ? 'bad' : 'good'}` },
              icon,
              b.stacks > 1 ? el('span', { class: 'buff-stacks' }, String(b.stacks)) : null,
              left,
            );
            node.addEventListener('mouseenter', () => {
              const cur = views[i];
              if (cur) tip(cur.left > 0 ? [...cur.tooltip, `${Math.ceil(cur.left)} s left.`] : cur.tooltip);
            });
            node.addEventListener('mouseleave', hideTip);
            return left;
          });
          root.replaceChildren(...parts.map((p) => p.parentElement!));
        }
        v.forEach((b, i) => {
          const p = parts[i];
          if (p) setText(p, timeText(b));
        });
      },
    };
  };
  const ownBuffs = buffRow('own', showTip);
  const selBuffs = buffRow('sel', tipAboveSel);
  selInfo.append(selBuffs.root);

  const abilityParts = ['Q', 'W', 'E', 'R', 'D', 'F'].map((k, slot) => {
    const icon = el('div', { class: 'ability-icon' });
    const cd = el('div', { class: 'cooldown' });
    const cdText = el('span', { class: 'cooldown-text' });
    const pips = el('div', { class: 'pips' });
    const plus = el('button', { class: 'learn', hidden: true, title: S.learn }, '+');
    plus.addEventListener('click', (e) => {
      e.stopPropagation();
      actions.learn(slot);
    });
    const state = el('span', { class: 'ability-state' });
    const root = el(
      'div',
      { class: 'ability', role: 'button', tabindex: '0', 'aria-label': `Ability ${k}` },
      icon,
      cd,
      cdText,
      el('span', { class: 'key' }, k),
      state,
      pips,
      plus,
    );
    root.addEventListener('keydown', (e) => {
      if (e.target !== root) return;
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        actions.cast(slot);
      }
    });
    root.addEventListener('click', () => actions.cast(slot));
    root.addEventListener('mouseenter', () => {
      hoveredAbility = slot;
      refreshTooltip();
    });
    root.addEventListener('mouseleave', () => {
      hoveredAbility = -1;
      hideTip();
    });
    return { root, icon, cd, cdText, pips, plus, state, iconUrl: '' as string | null, pipKey: '', sweep: newSweep() };
  });
  const abilityButtons = abilityParts.map((p) => p.root);
  // ---- inventory: click or key = use, drag = move / drop / give / sell
  let itemViews: (ItemSlotView | null)[] = [];
  const itemMenu = createItemContextMenu(actions.dropItem, actions.itemIcon);
  const ghost = el('div', { class: 'item-ghost', hidden: true });
  const itemParts = Array.from({ length: 6 }, (_, slot) => {
    const icon = el('div', { class: 'ability-icon' });
    const cd = el('div', { class: 'cooldown', hidden: true });
    const cdText = el('span', { class: 'cooldown-text' });
    const count = el('span', { class: 'charges' });
    const root = el(
      'div',
      { class: 'item-slot empty', tabindex: '0', 'aria-label': `Item slot ${slot + 1}`, 'aria-haspopup': 'menu' },
      icon,
      cd,
      cdText,
      el('span', { class: 'key' }, String(slot + 1)),
      count,
    );
    root.dataset['slot'] = String(slot);
    let down: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !itemViews[slot]) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
      if (!document.pointerLockElement) root.setPointerCapture(e.pointerId);
    });
    root.addEventListener('pointermove', (e) => {
      if (!down || e.pointerId !== down.id) return;
      if (!dragging && Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) {
        dragging = true;
        hideTip();
        ghost.style.backgroundImage = icon.style.backgroundImage;
        ghost.hidden = false;
      }
      if (dragging) ghost.style.transform = `translate(${e.clientX - 22}px, ${e.clientY - 22}px)`;
    });
    const finish = (e: PointerEvent, cancel: boolean) => {
      if (!down || e.pointerId !== down.id) return;
      down = null;
      ghost.hidden = true;
      if (cancel) return;
      if (!dragging) return actions.useItem(slot);
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const other = under?.closest<HTMLElement>('.item-slot');
      if (other?.dataset['slot']) {
        const to = Number(other.dataset['slot']);
        if (to !== slot) actions.dragItem(slot, { kind: 'slot', slot: to });
      } else if (under?.closest('.shop-panel')) actions.dragItem(slot, { kind: 'shop' });
      else if (under instanceof HTMLCanvasElement || under?.closest('.floating-layer'))
        actions.dragItem(slot, { kind: 'world', clientX: e.clientX, clientY: e.clientY });
    };
    root.addEventListener('pointerup', (e) => finish(e, false));
    root.addEventListener('pointercancel', (e) => finish(e, true));
    root.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const view = itemViews[slot];
      if (!view) return;
      hideTip();
      itemMenu.open(slot, view.item, root);
    });
    root.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        actions.useItem(slot);
      }
    });
    root.addEventListener('mouseenter', () => {
      const v = itemViews[slot];
      if (v && !down) showTip(v.tooltip);
    });
    root.addEventListener('mouseleave', hideTip);
    return { root, icon, cd, cdText, count, iconUrl: '' as string | null, sweep: newSweep() };
  });
  const items = itemParts.map((p) => p.root);

  // ---- shop panel above the inventory
  const shopName = el('h3', {});
  const shopGrid = el('div', { class: 'shop-grid' });
  const shopHint = el('p', { class: 'shop-hint' }, S.shopHint);
  const askText = el('span', {});
  let askYes: (() => void) | null = null;
  const ask = el(
    'div',
    { class: 'shop-ask', hidden: true },
    askText,
    el(
      'button',
      {
        class: 'btn tiny',
        onclick: () => {
          ask.hidden = true;
          askYes?.();
        },
      },
      S.yes,
    ),
    el('button', { class: 'btn tiny', onclick: () => (ask.hidden = true) }, S.no),
  );
  const shopPanel = el(
    'div',
    { class: 'panel shop-panel', hidden: true },
    el(
      'div',
      { class: 'shop-head' },
      shopName,
      el('button', { class: 'btn tiny', title: S.close, onclick: () => actions.closeShop() }, '✕'),
    ),
    shopGrid,
    shopHint,
    ask,
  );
  let shopKey = '';
  let shopViews: ShopItemView[] = [];
  const shopButtons = new Map<number, HTMLElement>();
  const endLabel = import.meta.env.DEV ? S.endMatchTest : S.leave;
  const root = el(
    'section',
    { class: 'screen game' },
    // A thin strip: kingdom numbers left, clock and heroes in the middle, own gold and menu right.
    el(
      'header',
      { class: 'hud-top' },
      el(
        'div',
        { class: 'top-left' },
        el('button', { class: 'kingdom-base', title: S.goToBase, onclick: () => actions.showBase() }, S.yourKingdom),
        facRes,
      ),
      el('div', { class: 'top-center' }, team, el('span', { class: 'top-clock' }, clock), enemyTeam),
      el(
        'div',
        { class: 'top-right' },
        gold,
        ping,
        el(
          'button',
          {
            class: 'hud-icon-btn capture-mouse',
            'aria-pressed': 'false',
            'aria-label': 'Capture mouse',
            title: 'Keep the mouse inside the game. Esc: release.',
            onclick: () => actions.captureMouse(),
          },
          '◎',
        ),
        el('button', { class: 'hud-icon-btn', 'aria-label': 'Full screen', title: 'Toggle full screen', onclick: toggleFullScreen }, '⛶'),
        el('button', { class: 'hud-icon-btn', 'aria-label': S.settings, title: S.settings, onclick: () => actions.settings() }, '⚙'),
        el('button', { class: 'hud-icon-btn leave', 'aria-label': endLabel, title: endLabel, onclick: onEnd }, '✕'),
      ),
    ),
    // What the kingdom does and the order buttons: small, under the strip, the world shows around it.
    el('div', { class: 'hud-kingdom' }, status, orders),
    scoreboard,
    feed,
    el('div', { class: 'hud-chat' }, chatLog, chatInput),
    result,
    deathNote,
    selInfo,
    hoverCard,
    alertBox,
    shopPanel,
    itemMenu.menu,
    itemMenu.recipes,
    tooltip,
    ghost,
    // Separate pieces like in classic hero games: the map in the corner and one small console
    // in the middle. The world stays visible (and clickable) between them.
    el(
      'footer',
      { class: 'hud-bottom' },
      el('div', { class: 'panel minimap' }, el('span', { class: 'muted' }, S.minimap)),
      el(
        'div',
        { class: 'hud-console' },
        ownBuffs.root,
        statLine,
        portrait,
        el(
          'div',
          { class: 'console-mid hero-panel' },
          el('div', { class: 'hero-line' }, heroName, heroLevel),
          el('div', { class: 'abilities' }, ...abilityButtons),
          el(
            'div',
            { class: 'bars' },
            el('div', { class: 'bar-track hp' }, hpFill, hpText),
            el('div', { class: 'bar-track mp' }, mpFill, mpText),
          ),
        ),
        el('div', { class: 'inventory' }, ...items),
      ),
    ),
  );
  new MutationObserver(() => {
    if (root.hidden) itemMenu.close();
  }).observe(root, { attributes: true, attributeFilter: ['hidden'] });
  // Windows can request a context menu through a secondary click, a held primary
  // click or the keyboard. Suppress the browser action across the whole HUD, while
  // keeping chat editing and the shop's own secondary-click purchase handler.
  root.addEventListener('contextmenu', (event) => {
    if (event.target instanceof Element && event.target.closest('input, textarea, [contenteditable="true"]')) return;
    event.preventDefault();
  });
  return {
    root,
    setClock(seconds) {
      const m = Math.floor(seconds / 60),
        sec = Math.floor(seconds % 60);
      setText(clock, `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    },
    setPing(ms, connection = 'online') {
      const offline = connection === 'outdated' ? S.netOutdated : S.netConnecting;
      setText(ping, connection !== 'online' ? offline : ms === null ? '' : `${S.ping} ${Math.round(ms)} ms`);
    },
    setStatus(text) {
      setText(status, text);
    },
    setHero(v) {
      if (v.portrait !== portraitUrl) {
        portraitUrl = v.portrait;
        portraitImg.style.backgroundImage = v.portrait ? `url(${v.portrait})` : '';
      }
      setText(heroName, v.name);
      setText(heroLevel, `${S.level} ${v.level}`);
      setText(portraitLevel, String(v.level));
      points.hidden = v.skillPoints <= 0;
      setText(points, `+${v.skillPoints}`);
      points.title = S.skillPointsTip;
      setFill(xpFill, v.xpFrac);
      setFill(hpFill, v.maxHp ? v.hp / v.maxHp : 0);
      setText(hpText, `${Math.ceil(v.hp)} / ${v.maxHp}`);
      setFill(mpFill, v.maxMana ? v.mana / v.maxMana : 0);
      setText(mpText, `${Math.floor(v.mana)} / ${v.maxMana}`);
      setText(goldValue, String(v.gold));
      const st = v.stats;
      setText(sDamage.value, `${Math.round(st.damageMin)}–${Math.round(st.damageMax)}`);
      setText(sArmor.value, String(Math.round(st.armor)));
      setText(sSpeed.value, st.moveSpeed.toFixed(1));
      setText(sStr.value, String(st.strength));
      setText(sAgi.value, String(st.agility));
      setText(sInt.value, String(st.intelligence));
      if (st.main !== mainStat) {
        mainStat = st.main;
        for (const s of [sStr, sAgi, sInt]) s.root.classList.toggle('main', s.root.classList.contains(st.main));
      }
      statLine.title = v.statsLine;
      deathNote.hidden = v.respawn <= 0;
      portrait.classList.toggle('dead', v.respawn > 0);
      if (v.respawn > 0) setText(deathNote, S.youDied(v.respawn));
    },
    setAbilities(v) {
      views = v;
      if (hoveredAbility >= 0) refreshTooltip();
      abilityParts.forEach((p, i) => {
        const a = v[i];
        p.root.classList.toggle('empty', !a);
        p.root.hidden = !a;
        if (!a) return;
        if (a.icon !== p.iconUrl) {
          p.iconUrl = a.icon;
          p.icon.style.backgroundImage = a.icon ? `url(${a.icon})` : '';
        }
        setText(p.state, a.stateLabel ?? '');
        p.state.hidden = !a.stateLabel;
        p.root.setAttribute('aria-label', `${'QWERDF'[i]}: ${a.name}${a.stateLabel ? ` — ${a.stateLabel}` : ''}`);
        p.root.title = a.blocked ?? `${a.name}: ready`;
        p.plus.setAttribute('aria-label', `Learn ${a.name}`);
        p.root.classList.toggle('unlearned', a.level === 0);
        p.root.classList.toggle('passive', a.passive);
        p.root.classList.toggle('no-mana', a.noMana && !a.passive && a.level > 0);
        armSweep(p.sweep, a.cooldownLeft, a.cooldownFrac, performance.now());
        p.plus.hidden = !a.canLearn;
        const key = `${a.level}/${a.maxLevel}`;
        if (key !== p.pipKey) {
          p.pipKey = key;
          p.pips.replaceChildren(...Array.from({ length: a.maxLevel }, (_, n) => el('i', { class: n < a.level ? 'on' : '' })));
        }
      });
    },
    setItems(v) {
      itemViews = v;
      itemMenu.update(v);
      itemParts.forEach((p, i) => {
        const it = v[i];
        p.root.classList.toggle('empty', !it);
        const url = it?.icon ?? null;
        if (url !== p.iconUrl) {
          p.iconUrl = url;
          p.icon.style.backgroundImage = url ? `url(${url})` : '';
        }
        p.root.classList.toggle('passive', !!it && !it.usable);
        armSweep(p.sweep, it?.cooldownLeft ?? 0, it?.cooldownFrac ?? 0, performance.now());
        setText(p.count, it && it.charges > 0 ? String(it.charges) : '');
      });
    },
    setShop(view) {
      shopPanel.hidden = !view;
      if (!view) {
        ask.hidden = true;
        return;
      }
      shopPanel.classList.toggle('far', !view.inRange);
      setText(shopHint, view.hint ?? S.shopHint);
      // Prices and labels change with upgrade levels: they are part of the key.
      const key = `${view.name}|${view.items.map((i) => `${i.item}:${i.label ?? i.cost}`).join(',')}`;
      shopViews = view.items;
      if (key !== shopKey) {
        shopKey = key;
        setText(shopName, view.name);
        shopButtons.clear();
        shopGrid.replaceChildren(
          ...view.items.map((it, n) => {
            const b = el(
              'button',
              { class: 'shop-item' },
              el('div', { class: 'ability-icon', style: it.icon ? `background-image:url(${it.icon})` : '' }),
              el('span', { class: 'price' }, it.label ?? String(it.cost)),
            );
            const buy = (e: Event) => {
              e.preventDefault();
              actions.buy(shopViews[n]!.item);
            };
            b.addEventListener('click', buy);
            b.addEventListener('contextmenu', buy);
            b.addEventListener('mouseenter', () => showTip(shopViews[n]!.tooltip));
            b.addEventListener('mouseleave', hideTip);
            shopButtons.set(n, b);
            return b;
          }),
        );
      }
      view.items.forEach((it, n) => shopButtons.get(n)?.classList.toggle('dim', !it.canAfford || !view.inRange));
    },
    confirm(text, onYes) {
      setText(askText, text);
      askYes = onYes;
      ask.hidden = false;
    },
    alert(text) {
      setText(alertBox, text);
      alertBox.hidden = false;
      if (alertTimer) clearTimeout(alertTimer);
      alertTimer = setTimeout(() => (alertBox.hidden = true), 1800);
    },
    setBuffs(views) {
      ownBuffs.set(views);
    },
    setSelected(text, details = [], portrait, abilities = [], extra = {}) {
      selInfo.hidden = !text;
      selBuffs.set(text ? (extra.buffs ?? []) : []);
      const items = text ? extra.items : undefined;
      const itemsKey = items ? items.map((it) => it?.tooltip[0] ?? '-').join('|') : '';
      if (itemsKey !== selItemsKey) {
        selItemsKey = itemsKey;
        selItems.hidden = !items;
        selItems.replaceChildren(
          ...(items ?? []).map((it) => {
            const slot = el('div', { class: `sel-item${it ? '' : ' empty'}` });
            if (it?.icon) slot.style.backgroundImage = `url(${it.icon})`;
            if (it) {
              slot.addEventListener('mouseenter', () => tipAboveSel(it.tooltip));
              slot.addEventListener('mouseleave', hideTip);
            }
            return slot;
          }),
        );
      }
      const key = `${text}/${details.join('/')}/${portrait ?? ''}`;
      if (key !== selectedKey) {
        selectedKey = key;
        setText(selectedTitle, text ?? '');
        selectedDetails.replaceChildren(...details.map((line) => el('p', {}, line)));
        selectedPortrait.style.backgroundImage = portrait ? `url(${portrait})` : '';
        selectedPortrait.hidden = !portrait;
      }
      // Health changes often; the icons only when the selected unit changes.
      const abilitiesKey = abilities.map((a) => `${a.usable ? 1 : 0}${a.level ?? ''}${a.tooltip.join('|')}`).join('/');
      if (abilitiesKey !== selectedAbilitiesKey) buildSelAbilities(abilities, abilitiesKey);
      // Cooldown and mana change all the time: only the overlay, no rebuild.
      abilities.forEach((a, i) => {
        const p = selParts[i];
        if (!p || !a.usable) return;
        p.cd.style.setProperty('--cd', String(a.cooldownFrac ?? 0));
        setText(p.cdText, a.cooldownLeft ? String(Math.ceil(a.cooldownLeft)) : '');
        p.root.classList.toggle('no-mana', !!a.noMana);
      });
    },
    setHoverCard(lines, x = 0, y = 0) {
      hoverCard.hidden = !lines;
      if (!lines) {
        hoverKey = '';
        return;
      }
      const key = lines.join('\n');
      if (key !== hoverKey) {
        hoverKey = key;
        hoverCard.replaceChildren(...lines.map((line, i) => el(i === 0 ? 'b' : 'p', {}, line)));
      }
      // Next to the mouse, kept inside the window.
      const w = hoverCard.offsetWidth,
        h = hoverCard.offsetHeight;
      hoverCard.style.left = `${Math.min(x + 18, window.innerWidth - w - 8)}px`;
      hoverCard.style.top = `${Math.max(8, Math.min(y + 18, window.innerHeight - h - 8))}px`;
    },
    setFaction(v) {
      facRes.hidden = !v;
      if (!v) return;
      setText(kGold.value, String(v.gold));
      setText(kWood.value, String(v.wood));
      setText(kSupply.value, `${v.supplyUsed}/${v.supplyCap}`);
      const upkeep = upkeepStep(v.supplyUsed);
      kSupply.root.title = `${S.supply} · ${S.upkeep(upkeep.name, upkeep.goldPct)} · ${S.workers} ${v.workers}`;
      kSupply.root.classList.toggle('upkeep', upkeep.goldPct < 100);
      setText(kArmy.value, String(v.army));
      setText(kTier, `${S.tier} ${v.tier}`);
      setText(status, v.status);
      status.title = v.status.startsWith('Attacking')
        ? 'Your army is fighting. Join it or pressure another lane.'
        : v.status.startsWith('Defending')
          ? 'Your base needs help.'
          : 'Your army is preparing. Farm camps nearby and watch its supply target. Attack timing changes with losses, defense and income.';
    },
    setOrders(v) {
      orders.hidden = !v;
      if (!v) {
        ordersKey = '';
        return;
      }
      const key = `${v.order}/${v.target}/${v.enemies.map((e) => e.slot).join('.')}`;
      if (key === ordersKey) return;
      ordersKey = key;
      const attack = KINGDOM_ORDERS.indexOf('attack');
      const button = (order: number, target: number, label: string, tip: string, color?: string) =>
        el(
          'button',
          {
            class: `order-btn${v.order === order && (order !== attack || v.target === target) ? ' on' : ''}`,
            title: tip,
            onclick: () => actions.kingdomOrder(order, target),
          },
          ...(color ? [el('i', { class: 'swatch-dot', style: `background:${color}` })] : []),
          label,
        );
      const others = KINGDOM_ORDERS.map((id, i) => (id === 'attack' ? null : button(i, 255, ORDER_NAMES[id], S.orderTips[id] ?? '')));
      orders.replaceChildren(
        el('span', { class: 'orders-label' }, S.orders),
        others[0]!,
        ...v.enemies.map((e) => button(attack, e.slot, `${ORDER_NAMES.attack} ${e.name}`, S.orderAttackTip(e.name), e.color)),
        ...others.slice(1).filter((b): b is HTMLButtonElement => !!b),
      );
    },
    setScores(rows) {
      scoreboard.hidden = !rows;
      if (!rows) return;
      scoreBody.replaceChildren(
        ...rows.map((r) =>
          el(
            'tr',
            { class: `${r.own ? 'own' : ''} ${r.out ? 'out' : ''}` },
            el('td', {}, el('i', { class: 'swatch-dot', style: `background:${r.color}` }), r.name),
            ...[r.hero, r.level, r.kills, r.deaths, r.gold.toLocaleString('en-US'), r.camps, r.army, r.tier].map((v) =>
              el('td', {}, String(v)),
            ),
          ),
        ),
      );
    },
    killFeed(text) {
      const line = el('div', { class: 'feed-line' }, text);
      feed.prepend(line);
      while (feed.children.length > 5) feed.lastElementChild!.remove();
      setTimeout(() => line.classList.add('fade'), 5000);
      setTimeout(() => line.remove(), 6000);
    },
    setTeam(allies, enemies = []) {
      const keyOf = (list: TeamHeroView[]) => list.map((h) => `${h.name}${h.level}${Math.round(h.hp * 20)}${h.dead ? 'd' : ''}`).join('|');
      const key = `${keyOf(allies)}/${keyOf(enemies)}`;
      if (key === teamKey) return;
      teamKey = key;
      const face = (h: TeamHeroView) =>
        el(
          'span',
          { class: `team-hero${h.dead ? ' dead' : ''}`, title: `${h.name} · ${S.level} ${h.level}` },
          el(
            'i',
            { class: 'team-face', style: `${h.portrait ? `background-image:url(${h.portrait});` : ''}border-color:${h.color}` },
            el('b', {}, String(h.level)),
          ),
          el('i', { class: 'team-hp' }, h.hp >= 0 ? el('i', { style: `width:${Math.round(h.hp * 100)}%` }) : null),
        );
      team.replaceChildren(...allies.map(face));
      enemyTeam.replaceChildren(...enemies.map(face));
    },
    animate(now) {
      for (const p of abilityParts) drawSweep(p.sweep, p.cd, p.cdText, now);
      for (const p of itemParts) drawSweep(p.sweep, p.cd, p.cdText, now);
    },
    chatLine(from, text, system) {
      const line = el('div', { class: `chat-line ${system ? 'system' : ''}` }, system ? '' : el('b', {}, `${from}: `), text);
      chatLog.append(line);
      while (chatLog.children.length > 6) chatLog.firstElementChild!.remove();
      setTimeout(() => line.classList.add('fade'), 9000);
      setTimeout(() => line.remove(), 10000);
    },
    toggleChat() {
      if (chatInput.hidden) {
        chatInput.hidden = false;
        chatInput.focus();
      }
    },
    setResult(title, text = '') {
      result.hidden = !title;
      if (!title) return;
      setText(resultTitle, title);
      setText(resultText, text);
    },
  };
}

export interface EndRow {
  name: string;
  hero: string;
  team: number;
  level: number;
  kills: number;
  deaths: number;
  gold: number;
  camps: number;
  upgrades: number;
  own: boolean;
}

export interface EndScreen extends Screen {
  /** won: true / false, null for a spectator; line: "Team 1 wins — 31:07" */
  set(won: boolean | null, line: string, rows: EndRow[]): void;
}

export function createEndScreen(router: Router): EndScreen {
  const title = el('h1', { class: 'title' }, S.victory);
  const line = el('p', { class: 'end-line' });
  const head = el(
    'tr',
    {},
    ...[S.player, S.hero, S.levelShort, S.kills, S.deaths, S.gold, S.camps, S.upgradesCol].map((t) => el('th', {}, t)),
  );
  const body = el('tbody');
  const root = el(
    'section',
    { class: 'screen end' },
    el(
      'div',
      { class: 'panel ornate end-panel' },
      el('div', { class: 'crest' }),
      title,
      line,
      el('table', { class: 'end-table' }, el('thead', {}, head), body),
      el('div', { class: 'divider' }),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', onclick: () => router.show('lobby') }, S.backToLobby),
        el('button', { class: 'btn', onclick: () => router.show('menu') }, S.mainMenu),
      ),
    ),
  );
  return {
    root,
    set(won, text, rows) {
      setText(title, won === null ? S.matchFinished : won ? S.victory : S.defeat);
      title.classList.toggle('defeat', won === false);
      setText(line, text);
      body.replaceChildren(
        ...rows.map((r) =>
          el(
            'tr',
            { class: r.own ? 'own' : '' },
            ...[r.name, r.hero, r.level, r.kills, r.deaths, r.gold.toLocaleString('en-US'), r.camps, r.upgrades].map((v) =>
              el('td', {}, String(v)),
            ),
          ),
        ),
      );
    },
  };
}

export function showFatalError(host: HTMLElement, message: string): void {
  host.replaceChildren(
    el('section', { class: 'screen end' }, el('div', { class: 'panel end-panel' }, el('h2', {}, S.errorTitle), el('p', {}, message))),
  );
}
