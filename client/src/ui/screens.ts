// Main Menu, Game HUD frame and End screen. The lobby is in lobby-screen.ts.
// The real HUD comes in Phase 9.

import { gameData, type RoomSummary } from '@game/shared';
import type { NetStatus } from '../net/socket';
import { el, setText } from './dom';
import type { Router, Screen } from './router';
import { S } from './strings';

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
  /** "Str 28 · Agi 21 · Int 40 · Dmg 47-53 · Armor 4" */
  statsLine: string;
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

export interface ItemSlotView {
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
  setSelected(text: string | null, details?: string[], portrait?: string): void;
  /** The player's AI faction, or null before the first faction data. */
  setFaction(v: FactionView | null): void;
  /** Big line in the middle: Victory / Defeat. null hides it. */
  setResult(title: string | null, text?: string): void;
  /** Tab scoreboard rows (null hides it). */
  setScores(rows: ScoreRow[] | null): void;
  /** One line in the kill feed (top right, fades after a few seconds). */
  killFeed(text: string): void;
  /** Allied heroes in the top bar. */
  setTeam(heroes: TeamHeroView[]): void;
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

export interface GameActions {
  end(): void;
  cast(slot: number): void;
  learn(slot: number): void;
  useItem(slot: number): void;
  buy(item: number): void;
  dragItem(slot: number, to: ItemDrop): void;
  closeShop(): void;
  settings(): void;
  /** click on the "Your Kingdom" panel: the camera goes to the base */
  showBase(): void;
  chat(text: string): void;
}

export function createGameScreen(actions: GameActions): GameScreen {
  const onEnd = actions.end;
  const clock = el('span', { class: 'clock' }, '00:00');
  const ping = el('span', { class: 'hud-ping' }, '');
  const status = el('p', {}, S.aiIdle);
  const facRes = el('p', { class: 'faction-line', hidden: true });
  const facSupply = el('p', { class: 'faction-line', hidden: true });
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
  const team = el('span', { class: 'hud-team' });
  let teamKey = '';
  const gold = el('span', { class: 'gold' }, `${S.gold}: ${gameData.rules.gold.startGold}`);
  const portraitImg = el('div', { class: 'portrait-img' });
  const portrait = el('div', { class: 'portrait' }, portraitImg);
  const heroName = el('span', { class: 'hero-name' });
  const heroLevel = el('span', { class: 'hero-level' });
  const points = el('span', { class: 'skill-points', hidden: true });
  const xpFill = el('div', { class: 'xp-fill' });
  const hpFill = el('div', { class: 'fill' });
  const hpText = el('span', { class: 'bar-label' });
  const mpFill = el('div', { class: 'fill' });
  const mpText = el('span', { class: 'bar-label' });
  const statLine = el('div', { class: 'hero-stats' });
  const deathNote = el('div', { class: 'death-note', hidden: true });
  const selectedTitle = el('strong');
  const selectedDetails = el('div', { class: 'selected-details' });
  const selectedPortrait = el('div', { class: 'selected-portrait' });
  const selInfo = el(
    'aside',
    { class: 'sel-info', hidden: true, 'aria-label': 'Selected unit' },
    selectedPortrait,
    selectedTitle,
    selectedDetails,
  );
  let selectedKey = '';
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
  const hideTip = () => (tooltip.hidden = true);

  const abilityParts = ['Q', 'W', 'E', 'R'].map((k, slot) => {
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
    return { root, icon, cd, cdText, pips, plus, state, iconUrl: '' as string | null, pipKey: '' };
  });
  const abilityButtons = abilityParts.map((p) => p.root);
  // ---- inventory: click or key = use, drag = move / drop / give / sell
  let itemViews: (ItemSlotView | null)[] = [];
  const ghost = el('div', { class: 'item-ghost', hidden: true });
  const itemParts = Array.from({ length: 6 }, (_, slot) => {
    const icon = el('div', { class: 'ability-icon' });
    const cd = el('div', { class: 'cooldown', hidden: true });
    const cdText = el('span', { class: 'cooldown-text' });
    const count = el('span', { class: 'charges' });
    const root = el('div', { class: 'item-slot empty' }, icon, cd, cdText, el('span', { class: 'key' }, String(slot + 1)), count);
    root.dataset['slot'] = String(slot);
    let down: { x: number; y: number; id: number } | null = null;
    let dragging = false;
    root.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !itemViews[slot]) return;
      down = { x: e.clientX, y: e.clientY, id: e.pointerId };
      dragging = false;
      root.setPointerCapture(e.pointerId);
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
    root.addEventListener('contextmenu', (e) => e.preventDefault());
    root.addEventListener('mouseenter', () => {
      const v = itemViews[slot];
      if (v && !down) showTip(v.tooltip);
    });
    root.addEventListener('mouseleave', hideTip);
    return { root, icon, cd, cdText, count, iconUrl: '' as string | null };
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
  const root = el(
    'section',
    { class: 'screen game' },
    el(
      'header',
      { class: 'hud-top' },
      clock,
      ping,
      team,
      gold,
      el('button', { class: 'btn small', title: 'Toggle full screen', onclick: toggleFullScreen }, '⛶'),
      el('button', { class: 'btn small', title: S.settings, onclick: () => actions.settings() }, '⚙'),
      el('button', { class: 'btn small', onclick: onEnd }, import.meta.env.DEV ? S.endMatchTest : S.leave),
      el(
        'div',
        { class: 'hud-kingdom' },
        el('button', { class: 'kingdom-base', title: S.goToBase, onclick: () => actions.showBase() }, S.yourKingdom),
        facRes,
        facSupply,
        status,
      ),
    ),
    scoreboard,
    feed,
    el('div', { class: 'hud-chat' }, chatLog, chatInput),
    result,
    deathNote,
    selInfo,
    alertBox,
    shopPanel,
    tooltip,
    ghost,
    el(
      'footer',
      { class: 'hud-bottom' },
      el('div', { class: 'panel minimap' }, el('span', { class: 'muted' }, S.minimap)),
      el(
        'div',
        { class: 'panel hero-panel' },
        portrait,
        el(
          'div',
          { class: 'bars' },
          el('div', { class: 'hero-line' }, heroName, heroLevel, points),
          el('div', { class: 'xp-track' }, xpFill),
          el('div', { class: 'bar-track hp' }, hpFill, hpText),
          el('div', { class: 'bar-track mp' }, mpFill, mpText),
          statLine,
        ),
        el('div', { class: 'abilities' }, ...abilityButtons),
      ),
      el('div', { class: 'panel inventory' }, ...items),
    ),
  );
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
      points.hidden = v.skillPoints <= 0;
      setText(points, `+${v.skillPoints}`);
      points.title = S.skillPointsTip;
      xpFill.style.width = `${Math.round(v.xpFrac * 100)}%`;
      hpFill.style.width = `${v.maxHp ? (100 * v.hp) / v.maxHp : 0}%`;
      setText(hpText, `${Math.ceil(v.hp)} / ${v.maxHp}`);
      mpFill.style.width = `${v.maxMana ? (100 * v.mana) / v.maxMana : 0}%`;
      setText(mpText, `${Math.floor(v.mana)} / ${v.maxMana}`);
      setText(gold, `${S.gold}: ${v.gold}`);
      setText(statLine, v.statsLine);
      deathNote.hidden = v.respawn <= 0;
      if (v.respawn > 0) setText(deathNote, S.youDied(v.respawn));
    },
    setAbilities(v) {
      views = v;
      if (hoveredAbility >= 0) refreshTooltip();
      abilityParts.forEach((p, i) => {
        const a = v[i];
        p.root.classList.toggle('empty', !a);
        if (!a) return;
        if (a.icon !== p.iconUrl) {
          p.iconUrl = a.icon;
          p.icon.style.backgroundImage = a.icon ? `url(${a.icon})` : '';
        }
        setText(p.state, a.stateLabel ?? '');
        p.state.hidden = !a.stateLabel;
        p.root.setAttribute('aria-label', `${'QWER'[i]}: ${a.name}${a.stateLabel ? ` — ${a.stateLabel}` : ''}`);
        p.root.title = a.blocked ?? `${a.name}: ready`;
        p.plus.setAttribute('aria-label', `Learn ${a.name}`);
        p.root.classList.toggle('unlearned', a.level === 0);
        p.root.classList.toggle('passive', a.passive);
        p.root.classList.toggle('no-mana', a.noMana && !a.passive && a.level > 0);
        p.cd.style.setProperty('--cd', String(a.cooldownFrac));
        p.cd.hidden = a.cooldownFrac <= 0;
        setText(p.cdText, a.cooldownLeft > 0 ? String(Math.ceil(a.cooldownLeft)) : '');
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
      itemParts.forEach((p, i) => {
        const it = v[i];
        p.root.classList.toggle('empty', !it);
        const url = it?.icon ?? null;
        if (url !== p.iconUrl) {
          p.iconUrl = url;
          p.icon.style.backgroundImage = url ? `url(${url})` : '';
        }
        p.root.classList.toggle('passive', !!it && !it.usable);
        const frac = it?.cooldownFrac ?? 0;
        p.cd.style.setProperty('--cd', String(frac));
        p.cd.hidden = frac <= 0;
        setText(p.cdText, it && it.cooldownLeft > 0 ? String(Math.ceil(it.cooldownLeft)) : '');
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
    setSelected(text, details = [], portrait) {
      selInfo.hidden = !text;
      const key = `${text}/${details.join('/')}/${portrait ?? ''}`;
      if (key === selectedKey) return;
      selectedKey = key;
      setText(selectedTitle, text ?? '');
      selectedDetails.replaceChildren(...details.map((line) => el('p', {}, line)));
      selectedPortrait.style.backgroundImage = portrait ? `url(${portrait})` : '';
      selectedPortrait.hidden = !portrait;
    },
    setFaction(v) {
      facRes.hidden = facSupply.hidden = !v;
      if (!v) return;
      setText(facRes, `${S.gold} ${v.gold} · ${S.wood} ${v.wood}`);
      setText(
        facSupply,
        `${S.supply} ${v.supplyUsed}/${v.supplyCap} · ${S.tier} ${v.tier} · ${S.workers} ${v.workers} · ${S.army} ${v.army}`,
      );
      setText(status, v.status);
      status.title = v.status.startsWith('Attacking')
        ? 'Your army is fighting. Join it or pressure another lane.'
        : v.status.startsWith('Defending')
          ? 'Your base needs help.'
          : 'Your army is preparing. Farm camps nearby and watch its supply target. Attack timing changes with losses, defense and income.';
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
    setTeam(heroes) {
      const key = heroes.map((h) => `${h.name}${h.level}${Math.round(h.hp * 20)}`).join('|');
      if (key === teamKey) return;
      teamKey = key;
      team.replaceChildren(
        ...heroes.map((h) =>
          el(
            'span',
            { class: 'team-hero', title: h.name },
            el('i', { class: 'team-face', style: `${h.portrait ? `background-image:url(${h.portrait});` : ''}border-color:${h.color}` }),
            el('b', {}, `${S.levelShort} ${h.level}`),
            h.hp >= 0 ? el('i', { class: 'team-hp' }, el('i', { style: `width:${Math.round(h.hp * 100)}%` })) : null,
          ),
        ),
      );
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
