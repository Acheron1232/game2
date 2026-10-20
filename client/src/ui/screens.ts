// Main Menu, Game HUD frame and End screen. The lobby is in lobby-screen.ts.
// The real HUD comes in Phase 9.

import { gameData, type RoomSummary } from '@game/shared';
import { el, setText } from './dom';
import type { Router, Screen } from './router';
import { S } from './strings';

export function toggleFullScreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
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
      el('button', { class: 'btn big', disabled: true, title: S.comingSoon }, S.settings),
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
  /** tooltip lines: name line, text, numbers */
  tooltip: string[];
}

export interface GameScreen extends Screen {
  setAbilities(views: (AbilityButtonView | null)[]): void;
  /** Short message in the middle of the screen ("Not enough mana."). */
  alert(text: string): void;
  setClock(seconds: number): void;
  setPing(ms: number | null): void;
  setStatus(text: string): void;
  setHero(v: HeroView): void;
  /** Info line for a selected unit that is not your hero, or null. */
  setSelected(text: string | null): void;
}

export interface GameActions {
  end(): void;
  cast(slot: number): void;
  learn(slot: number): void;
}

export function createGameScreen(actions: GameActions): GameScreen {
  const onEnd = actions.end;
  const clock = el('span', { class: 'clock' }, '00:00');
  const ping = el('span', { class: 'hud-ping' }, '');
  const status = el('p', {}, S.aiIdle);
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
  const deathNote = el('div', { class: 'death-note', hidden: true });
  const selInfo = el('div', { class: 'sel-info', hidden: true });
  let portraitUrl: string | null = null;
  const tooltip = el('div', { class: 'tooltip', hidden: true });
  const alertBox = el('div', { class: 'hud-alert', hidden: true });
  let alertTimer: ReturnType<typeof setTimeout> | null = null;
  let views: (AbilityButtonView | null)[] = [];
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
    const root = el('div', { class: 'ability' }, icon, cd, cdText, el('span', { class: 'key' }, k), pips, plus);
    root.addEventListener('click', () => actions.cast(slot));
    root.addEventListener('mouseenter', () => {
      const v = views[slot];
      if (!v) return;
      tooltip.replaceChildren(...v.tooltip.map((line, i) => el(i === 0 ? 'b' : 'p', {}, line)));
      tooltip.hidden = false;
    });
    root.addEventListener('mouseleave', () => (tooltip.hidden = true));
    return { root, icon, cd, cdText, pips, plus, iconUrl: '' as string | null, pipKey: '' };
  });
  const abilityButtons = abilityParts.map((p) => p.root);
  const items = Array.from({ length: 6 }, (_, i) => el('div', { class: 'item-slot' }, el('span', { class: 'key' }, String(i + 1))));
  const root = el(
    'section',
    { class: 'screen game' },
    el('header', { class: 'hud-top' }, clock, ping, gold, el('button', { class: 'btn small', onclick: onEnd }, S.endMatchTest)),
    el('aside', { class: 'panel ai-status' }, el('h3', {}, S.yourKingdom), status),
    deathNote,
    selInfo,
    alertBox,
    tooltip,
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
        ),
        el('div', { class: 'abilities' }, ...abilityButtons),
      ),
      el('div', { class: 'panel inventory' }, ...items),
    ),
  );
  return {
    root,
    setClock(seconds) {
      const m = Math.floor(seconds / 60),
        sec = Math.floor(seconds % 60);
      setText(clock, `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`);
    },
    setPing(ms) {
      setText(ping, ms === null ? '' : `${S.ping} ${Math.round(ms)} ms`);
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
      deathNote.hidden = v.respawn <= 0;
      if (v.respawn > 0) setText(deathNote, S.youDied(v.respawn));
    },
    setAbilities(v) {
      views = v;
      abilityParts.forEach((p, i) => {
        const a = v[i];
        p.root.classList.toggle('empty', !a);
        if (!a) return;
        if (a.icon !== p.iconUrl) {
          p.iconUrl = a.icon;
          p.icon.style.backgroundImage = a.icon ? `url(${a.icon})` : '';
        }
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
    alert(text) {
      setText(alertBox, text);
      alertBox.hidden = false;
      if (alertTimer) clearTimeout(alertTimer);
      alertTimer = setTimeout(() => (alertBox.hidden = true), 1800);
    },
    setSelected(text) {
      selInfo.hidden = !text;
      if (text) setText(selInfo, text);
    },
  };
}

export function createEndScreen(router: Router): Screen {
  const root = el(
    'section',
    { class: 'screen end' },
    el(
      'div',
      { class: 'panel ornate end-panel' },
      el('div', { class: 'crest' }),
      el('h1', { class: 'title' }, S.victory),
      el('div', { class: 'divider' }),
      el(
        'div',
        { class: 'row' },
        el('button', { class: 'btn', onclick: () => router.show('lobby') }, S.backToLobby),
        el('button', { class: 'btn', onclick: () => router.show('menu') }, S.mainMenu),
      ),
    ),
  );
  return { root };
}

export function showFatalError(host: HTMLElement, message: string): void {
  host.replaceChildren(
    el('section', { class: 'screen end' }, el('div', { class: 'panel end-panel' }, el('h2', {}, S.errorTitle), el('p', {}, message))),
  );
}
