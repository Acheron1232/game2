// The game lobby: 4 slots (free for all) or 8 (teams: two heroes for each kingdom), chat,
// loading, ready and start. The server owns the room state; this screen only shows it and sends
// what the player changes.

import {
  AI_LEVELS,
  gameData,
  RANDOM_HERO,
  SLOT_COUNT,
  type ClientLobbyMessage,
  type RoomMode,
  type RoomState,
  type SlotState,
} from '@game/shared';
import type { LoadState } from '../loader/loader';
import type { NetState } from '../net/socket';
import { el, setText } from './dom';
import type { Screen } from './router';
import { S } from './strings';

export interface LobbyScreen extends Screen {
  setLoad(state: LoadState): void;
  setNet(state: NetState): void;
  setRoom(room: RoomState, playerId: string | null): void;
  addChat(from: string, text: string, system: boolean): void;
  showError(text: string): void;
}

export const COLOR_NAMES = ['Red', 'Blue', 'Teal', 'Purple'];
const COLOR_CLASS = ['red', 'blue', 'teal', 'purple'];

function select(options: [string, string][], value: string, onChange: (v: string) => void): HTMLSelectElement {
  const s = el('select', { class: 'field small' }, ...options.map(([v, label]) => el('option', { value: v }, label)));
  s.value = value;
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

export function createLobbyScreen(send: (msg: ClientLobbyMessage) => void): LobbyScreen {
  const heroOptions: [string, string][] = [[RANDOM_HERO, S.random], ...gameData.heroes.map((h): [string, string] => [h.id, h.name])];
  const heroName = (id: string) => (id === RANDOM_HERO ? S.random : (gameData.heroes.find((h) => h.id === id)?.name ?? id));

  const title = el('h2', {}, S.lobbyTitle);
  const net = el('span', { class: 'net' });
  const copyBtn = el('button', { class: 'btn small' }, S.copyLink);
  const modeBox = el('span', { class: 'lobby-mode' });
  const tbody = el('tbody');
  const chatLog = el('div', { class: 'chat-log' });
  const chatInput = el('input', { class: 'field', placeholder: S.typeHere, maxlength: '200' });
  const errorLine = el('p', { class: 'lobby-error', hidden: true });
  const groupList = el('ul', { class: 'load-groups' });
  const barFill = el('div', { class: 'bar-fill' });
  const barText = el('div', { class: 'bar-text' }, '0%');
  const readyBtn = el('button', { class: 'btn' }, S.ready);
  const startBtn = el('button', { class: 'btn', disabled: true }, S.startGame);
  const leaveBtn = el('button', { class: 'btn', onclick: () => send({ type: 'leaveRoom' }) }, S.leave);

  let room: RoomState | null = null;
  let me: string | null = null;
  let errorTimer: ReturnType<typeof setTimeout> | null = null;
  let lastKey = '';

  copyBtn.addEventListener('click', () => {
    if (!room) return;
    const url = `${location.origin}${location.pathname}?join=${room.code}`;
    void navigator.clipboard?.writeText(url).then(
      () => setText(copyBtn, S.copied),
      () => setText(copyBtn, room!.code),
    );
    setTimeout(() => setText(copyBtn, S.copyLink), 1500);
  });
  chatInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !chatInput.value.trim()) return;
    send({ type: 'chat', text: chatInput.value.trim() });
    chatInput.value = '';
  });
  readyBtn.addEventListener('click', () => {
    const own = room?.slots.find((s) => s.playerId === me);
    if (own) send({ type: 'ready', ready: !own.ready });
  });
  startBtn.addEventListener('click', () => send({ type: 'start' }));

  const row = (s: SlotState): HTMLTableRowElement => {
    const teams = room!.mode === 'teams';
    const isHost = room!.hostId === me;
    const own = s.playerId === me;
    const editBot = isHost && s.kind === 'bot';
    const canEdit = own || editBot;
    const taken = new Set(room!.slots.filter((o) => o !== s && o.kind !== 'open' && o.kind !== 'closed').map((o) => o.color));
    const update = (patch: Partial<Extract<ClientLobbyMessage, { type: 'updateSlot' }>>) =>
      send({ type: 'updateSlot', slot: s.index, ...patch });

    const who =
      s.kind === 'human'
        ? el(
            'span',
            { class: s.online ? '' : 'muted' },
            s.name,
            s.playerId === room!.hostId ? ` (${S.host})` : '',
            own ? ` (${S.you})` : '',
            s.online ? '' : ` — ${S.offline}`,
          )
        : s.kind === 'bot'
          ? el('span', {}, s.name)
          : el('span', { class: 'muted' }, '—');
    let type: Node | string = { open: S.open, human: S.human, bot: S.bot, closed: S.closed }[s.kind];
    if (isHost && !own && room!.phase === 'lobby') {
      const kindSel = select(
        [
          ['open', S.open],
          ['bot', S.bot],
          ['closed', S.closed],
          ...(s.kind === 'human' ? ([['human', S.human]] as [string, string][]) : []),
        ],
        s.kind,
        (v) => send({ type: 'setSlotKind', slot: s.index, kind: v as 'open' | 'bot' | 'closed' }),
      );
      type =
        s.kind === 'human'
          ? el('span', {}, kindSel, el('button', { class: 'btn tiny', onclick: () => send({ type: 'kick', slot: s.index }) }, S.kick))
          : kindSel;
    }
    const used = s.kind === 'human' || s.kind === 'bot';
    // Team room: team and color are the kingdom's, nobody changes them.
    const team = !used
      ? '—'
      : canEdit && !teams
        ? select(
            [1, 2, 3, 4].map((t) => [String(t), String(t)]),
            String(s.team),
            (v) => update({ team: Number(v) }),
          )
        : String(s.team);
    const color = !used
      ? '—'
      : canEdit && !teams
        ? select(
            COLOR_NAMES.map((n, i): [string, string] => [String(i), taken.has(i) ? `${n} ✕` : n]),
            String(s.color),
            (v) => update({ color: Number(v) }),
          )
        : el('span', { class: `swatch ${COLOR_CLASS[s.color]}` }, COLOR_NAMES[s.color] ?? '');
    if (canEdit && color instanceof HTMLSelectElement) color.classList.add(`swatch-select`, COLOR_CLASS[s.color]!);
    const hero = !used ? '—' : canEdit ? select(heroOptions, s.hero, (v) => update({ hero: v })) : heroName(s.hero);
    const ai =
      s.kind !== 'bot'
        ? '—'
        : editBot
          ? select(
              AI_LEVELS.map((a): [string, string] => [a, S.aiLevels[a] ?? a]),
              s.ai,
              (v) => update({ ai: v as SlotState['ai'] }),
            )
          : (S.aiLevels[s.ai] ?? s.ai);
    const load =
      s.kind === 'human'
        ? el('span', { class: s.load >= 100 ? 'ok' : '' }, `${s.load}%`, s.ready ? ` ✔ ${S.readyShort}` : '')
        : s.kind === 'bot'
          ? '✔'
          : '—';
    const label = teams ? S.teamSlot((s.index % SLOT_COUNT) + 1, s.index < SLOT_COUNT ? 0 : 1) : String(s.index + 1);
    const cls = [own ? 'own' : '', teams && s.index >= SLOT_COUNT ? 'second' : ''].filter(Boolean).join(' ');
    return el('tr', { class: cls }, ...[label, who, type, team, color, hero, ai, load].map((c) => el('td', {}, c)));
  };

  const modeNames: Record<RoomMode, string> = { ffa: S.modeFfa, teams: S.modeTeams };

  const render = () => {
    if (!room) return;
    setText(title, `${S.lobbyTitle} — ${room.code}`);
    const teams = room.mode === 'teams';
    // Team room: the two slots of a kingdom one under the other (1·I, 1·II, 2·I, ...).
    const order = teams ? [...room.slots].sort((a, b) => (a.index % SLOT_COUNT) - (b.index % SLOT_COUNT) || a.index - b.index) : room.slots;
    tbody.replaceChildren(...order.map(row));
    root.classList.toggle('teams', teams);
    const hostNow = room.hostId === me && room.phase === 'lobby';
    modeBox.replaceChildren(
      `${S.mode}: `,
      hostNow ? select(Object.entries(modeNames), room.mode, (v) => send({ type: 'setMode', mode: v as RoomMode })) : modeNames[room.mode],
    );
    modeBox.title = teams ? S.modeTeamsHint : '';
    const own = room.slots.find((s) => s.playerId === me);
    const isHost = room.hostId === me;
    readyBtn.hidden = isHost;
    setText(readyBtn, own?.ready ? S.notReady : S.ready);
    readyBtn.classList.toggle('on', !!own?.ready);
    startBtn.hidden = !isHost;
    const waiting = room.slots.filter(
      (s) => s.kind === 'human' && (s.load < 100 || !s.online || (!s.ready && s.playerId !== room!.hostId)),
    );
    startBtn.disabled = waiting.length > 0;
    startBtn.title = waiting.length ? `${S.waitingFor} ${waiting.map((s) => s.name).join(', ')}` : '';
  };

  const root = el(
    'section',
    { class: 'screen lobby' },
    el(
      'div',
      { class: 'panel ornate lobby-panel' },
      el('header', { class: 'lobby-head' }, title, modeBox, net, copyBtn),
      el('div', { class: 'divider' }),
      el(
        'table',
        { class: 'slots' },
        el('thead', {}, el('tr', {}, ...[S.slot, S.player, S.type, S.team, S.color, S.hero, S.ai, S.load].map((h) => el('th', {}, h)))),
        tbody,
      ),
      errorLine,
      el(
        'div',
        { class: 'lobby-body' },
        el('div', { class: 'panel inset chat' }, el('h3', {}, S.chat), chatLog, chatInput),
        el('div', { class: 'panel inset loading' }, el('h3', {}, S.loading), groupList, el('div', { class: 'bar' }, barFill, barText)),
      ),
      el('footer', { class: 'lobby-foot' }, leaveBtn, readyBtn, startBtn),
    ),
  );

  return {
    root,
    setRoom(r, playerId) {
      // Same state again (for example a load % of someone else that did not change): keep the DOM,
      // so an open drop-down list stays open.
      const key = JSON.stringify(r) + playerId;
      if (key === lastKey) return;
      lastKey = key;
      room = r;
      me = playerId;
      render();
    },
    addChat(from, text, system) {
      chatLog.append(el('p', { class: system ? 'system' : '' }, from ? el('b', {}, `${from}: `) : '', text));
      while (chatLog.childElementCount > 80) chatLog.firstElementChild?.remove();
      chatLog.scrollTop = chatLog.scrollHeight;
    },
    showError(text) {
      errorLine.hidden = false;
      setText(errorLine, text);
      if (errorTimer) clearTimeout(errorTimer);
      errorTimer = setTimeout(() => (errorLine.hidden = true), 4000);
    },
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
    },
    setNet(state) {
      const text = { online: S.netOnline, connecting: S.netConnecting, offline: S.netOffline, outdated: S.netOutdated }[state.status];
      setText(net, state.pingMs !== null ? `${text} · ${S.ping} ${Math.round(state.pingMs)} ms` : text);
      net.className = `net ${state.status}`;
    },
  };
}
