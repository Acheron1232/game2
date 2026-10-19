// Placeholder screens: Main Menu, Lobby (with the real loading panel), Game HUD frame, End.
// Real lobby logic comes in Phase 6, the real HUD in Phase 9.

import { gameData } from '@game/shared';
import type { LoadState } from '../loader/loader';
import type { NetState } from '../net/socket';
import { el, setText } from './dom';
import type { Router, Screen } from './router';
import { S } from './strings';

export function toggleFullScreen(): void {
  if (document.fullscreenElement) void document.exitFullscreen();
  else void document.documentElement.requestFullscreen().catch(() => undefined);
}

export function createMenuScreen(router: Router, getName: () => string, setName: (n: string) => void): Screen {
  const nameInput = el('input', { class: 'field', maxlength: '24', value: getName(), 'aria-label': S.yourName });
  nameInput.addEventListener('change', () => setName(nameInput.value.trim() || 'Player'));
  const playPanel = el(
    'div',
    { class: 'panel ornate play-panel', hidden: true },
    el('label', { class: 'field-label' }, S.yourName, nameInput),
    el(
      'div',
      { class: 'row' },
      el('button', { class: 'btn', onclick: () => router.show('lobby') }, S.createGame),
      el('button', { class: 'btn', disabled: true, title: S.comingSoon }, S.joinGame),
      el('input', { class: 'field code', placeholder: S.code, maxlength: '6', disabled: true }),
    ),
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
      el('button', { class: 'btn big', onclick: () => (playPanel.hidden = !playPanel.hidden) }, S.play),
      el('button', { class: 'btn big', disabled: true, title: S.comingSoon }, S.settings),
      el('button', { class: 'btn big', disabled: true, title: S.comingSoon }, S.credits),
    ),
    playPanel,
    el('button', { class: 'btn small corner', onclick: toggleFullScreen }, `⛶ ${S.fullScreen}`),
  );
  return { root };
}

export interface LobbyScreen extends Screen {
  setLoad(state: LoadState): void;
  setNet(state: NetState): void;
}

export function createLobbyScreen(router: Router, getName: () => string): LobbyScreen {
  const heroNames = gameData.heroes.map((h) => h.name);
  const youName = el('span');
  const youLoad = el('span', { class: 'load-cell' }, '0%');
  const slotRow = (n: number, who: Node | string, type: string, team: string, color: string, hero: string, load: Node | string) =>
    el(
      'tr',
      {},
      ...[String(n), who, type, team, el('span', { class: `swatch ${color.toLowerCase()}` }, color), hero, S.normal, load].map((c) =>
        el('td', {}, c),
      ),
    );

  const groupList = el('ul', { class: 'load-groups' });
  const barFill = el('div', { class: 'bar-fill' });
  const barText = el('div', { class: 'bar-text' }, '0%');
  const startBtn = el('button', { class: 'btn', disabled: true, onclick: () => router.show('game') }, S.startGame);
  const readyBtn = el('button', { class: 'btn' }, S.ready);
  let ready = false;
  let loaded = false;
  const refreshStart = () => {
    startBtn.disabled = !(ready && loaded);
    startBtn.title = !loaded ? S.waitingForLoad(Math.round(Number(barText.textContent?.replace('%', '') ?? 0))) : !ready ? S.ready : '';
  };
  readyBtn.addEventListener('click', () => {
    ready = !ready;
    setText(readyBtn, ready ? S.notReady : S.ready);
    readyBtn.classList.toggle('on', ready);
    refreshStart();
  });
  const net = el('span', { class: 'net' });

  const root = el(
    'section',
    { class: 'screen lobby' },
    el(
      'div',
      { class: 'panel ornate lobby-panel' },
      el(
        'header',
        { class: 'lobby-head' },
        el('h2', {}, `${S.lobbyTitle} — TEST`),
        net,
        el('button', { class: 'btn small', disabled: true, title: S.comingSoon }, S.copyLink),
      ),
      el('div', { class: 'divider' }),
      el(
        'table',
        { class: 'slots' },
        el('thead', {}, el('tr', {}, ...[S.slot, S.player, S.type, S.team, S.color, S.hero, S.ai, S.load].map((h) => el('th', {}, h)))),
        el(
          'tbody',
          {},
          slotRow(1, el('span', {}, youName, ` (${S.host})`), S.human, '1', 'Red', heroNames[0] ?? S.random, youLoad),
          slotRow(2, '—', S.open, '2', 'Blue', S.random, '—'),
          slotRow(3, '—', S.open, '3', 'Teal', S.random, '—'),
          slotRow(4, '—', S.open, '4', 'Purple', S.random, '—'),
        ),
      ),
      el(
        'div',
        { class: 'lobby-body' },
        el(
          'div',
          { class: 'panel inset chat' },
          el('h3', {}, S.chat),
          el('p', { class: 'muted' }, S.chatSoon),
          el('input', { class: 'field', placeholder: S.typeHere, disabled: true }),
        ),
        el('div', { class: 'panel inset loading' }, el('h3', {}, S.loading), groupList, el('div', { class: 'bar' }, barFill, barText)),
      ),
      el(
        'footer',
        { class: 'lobby-foot' },
        el('button', { class: 'btn', onclick: () => router.show('menu') }, S.leave),
        readyBtn,
        startBtn,
      ),
    ),
  );

  return {
    root,
    onShow: () => setText(youName, getName()),
    setLoad(state) {
      groupList.replaceChildren(
        ...state.groups.map((g) =>
          el(
            'li',
            { class: g.done >= g.total && !g.waiting ? 'done' : '' },
            el('span', {}, S.groupNames[g.group] ?? g.group),
            el('span', {}, g.waiting ? S.loadWaiting : `${g.done} / ${g.total}${g.done >= g.total ? ' ✔' : ''}`),
          ),
        ),
      );
      const pct = Math.floor(state.fraction * 100);
      barFill.style.width = `${pct}%`;
      setText(barText, pct >= 100 ? S.loadReady : `${pct}%`);
      setText(youLoad, `${pct}%`);
      loaded = pct >= 100;
      refreshStart();
    },
    setNet(state) {
      const text = { online: S.netOnline, connecting: S.netConnecting, offline: S.netOffline, outdated: S.netOutdated }[state.status];
      setText(net, state.pingMs !== null ? `${text} · ${S.ping} ${Math.round(state.pingMs)} ms` : text);
      net.className = `net ${state.status}`;
    },
  };
}

export function createGameScreen(router: Router): Screen {
  const abilityButtons = ['Q', 'W', 'E', 'R'].map((k) => el('div', { class: 'ability' }, el('span', { class: 'key' }, k)));
  const items = Array.from({ length: 6 }, (_, i) => el('div', { class: 'item-slot' }, el('span', { class: 'key' }, String(i + 1))));
  const root = el(
    'section',
    { class: 'screen game' },
    el(
      'header',
      { class: 'hud-top' },
      el('span', { class: 'clock' }, '00:00'),
      el('span', { class: 'gold' }, `${S.gold}: ${gameData.rules.gold.startGold}`),
      el('button', { class: 'btn small', onclick: () => router.show('end') }, S.endMatchTest),
    ),
    el('aside', { class: 'panel ai-status' }, el('h3', {}, S.yourKingdom), el('p', {}, S.aiIdle)),
    el(
      'footer',
      { class: 'hud-bottom' },
      el('div', { class: 'panel minimap' }, el('span', { class: 'muted' }, S.minimap)),
      el(
        'div',
        { class: 'panel hero-panel' },
        el('div', { class: 'portrait' }),
        el('div', { class: 'bars' }, el('div', { class: 'hp' }), el('div', { class: 'mp' })),
        el('div', { class: 'abilities' }, ...abilityButtons),
      ),
      el('div', { class: 'panel inventory' }, ...items),
    ),
  );
  return { root };
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
