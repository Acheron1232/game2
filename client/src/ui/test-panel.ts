// Test panel of a test mode match (and of dev matches): try anything at once, in the real game.
// Every button sends one `cheat` lobby message; the server checks that the match allows it.
// Places on the map (enemies, a dummy, a jump) are picked with the next left click (main.ts).

import { el, setText } from './dom';

/** What the panel sends (the `cheat` message without its type). */
export interface TestCommand {
  xp?: number;
  levelUp?: boolean;
  gold?: number;
  item?: string;
  god?: boolean;
  freeCasts?: boolean;
  reveal?: boolean;
  speed?: 1 | 2 | 4;
  clear?: boolean;
}

export type TestPlace = { kind: 'enemy' | 'dummy'; unit: string; count: number } | { kind: 'teleport' };

export interface TestPanelActions {
  send(c: TestCommand): void;
  /** wait for a left click on the map, then spawn or jump there */
  place(p: TestPlace): void;
}

export interface TestPanelItem {
  id: string;
  name: string;
  icon: string | null;
  /** consumable, basic, advanced, rare, legendary */
  tier: string;
}

export interface TestPanelUnit {
  id: string;
  name: string;
  group: string;
}

export interface TestPanel {
  root: HTMLElement;
  setVisible(on: boolean): void;
  /** "Click on the ground to place 5 Ogre Brutes." while waiting for the click, null when done */
  setPlacing(text: string | null): void;
}

const GROUP_NAMES: Record<string, string> = {
  neutral: 'Camp monsters',
  faction: 'Army units',
  mercenary: 'Mercenaries',
  summon: 'Summons',
};

export function createTestPanel(actions: TestPanelActions, items: TestPanelItem[], units: TestPanelUnit[], maxXp: number): TestPanel {
  const button = (label: string, title: string, onclick: () => void) => el('button', { class: 'test-btn', title, onclick }, label);
  /** A switch: shows on / off and sends its new value. */
  const toggle = (label: string, title: string, send: (on: boolean) => TestCommand) => {
    let on = false;
    const b = el('button', { class: 'test-btn toggle', title, 'aria-pressed': 'false' }, label);
    b.addEventListener('click', () => {
      on = !on;
      b.setAttribute('aria-pressed', String(on));
      actions.send(send(on));
    });
    return b;
  };

  const speedButtons = ([1, 2, 4] as const).map((speed) => {
    const b = el('button', { class: `test-btn speed${speed === 1 ? ' on' : ''}`, title: `Game speed ×${speed}` }, `×${speed}`);
    b.addEventListener('click', () => {
      for (const o of speedButtons) o.classList.toggle('on', o === b);
      actions.send({ speed });
    });
    return b;
  });

  // Items: a filter box and a grid of icons, the rarest last. Click: the item goes to the bag.
  const filter = el('input', { class: 'test-filter', placeholder: 'Find an item...', maxlength: '24' });
  filter.addEventListener('keydown', (e) => e.stopPropagation());
  const grid = el(
    'div',
    { class: 'test-items' },
    ...items.map((it) => {
      const b = el(
        'button',
        { class: `test-item tier-${it.tier}`, title: it.name, 'data-name': it.name.toLowerCase() },
        it.icon ? '' : it.name.charAt(0),
      );
      if (it.icon) b.style.backgroundImage = `url(${it.icon})`;
      b.addEventListener('click', () => actions.send({ item: it.id }));
      return b;
    }),
  );
  filter.addEventListener('input', () => {
    const q = filter.value.trim().toLowerCase();
    for (const b of grid.children) (b as HTMLElement).hidden = !!q && !(b as HTMLElement).dataset['name']!.includes(q);
  });

  // Enemies: unit kind and count, then a click on the map.
  const unitSelect = el(
    'select',
    { class: 'test-select' },
    ...Object.keys(GROUP_NAMES).map((group) =>
      el(
        'optgroup',
        { label: GROUP_NAMES[group]! },
        ...units.filter((u) => u.group === group).map((u) => el('option', { value: u.id }, u.name)),
      ),
    ),
  );
  const countSelect = el(
    'select',
    { class: 'test-select count' },
    ...[1, 3, 5, 10, 20].map((n) => el('option', { value: String(n) }, `×${n}`)),
  );
  for (const s of [unitSelect, countSelect]) s.addEventListener('keydown', (e) => e.stopPropagation());

  const placing = el('p', { class: 'test-placing', hidden: true });
  const body = el(
    'div',
    { class: 'test-body' },
    el('h4', {}, 'Hero'),
    el(
      'div',
      { class: 'test-row' },
      button('Level +1', 'Up to the next level', () => actions.send({ levelUp: true })),
      button('Level max', 'Highest level (learn skills with Ctrl + Q W E R)', () => actions.send({ xp: maxXp })),
      button('+1000 gold', 'Gold for the shops', () => actions.send({ gold: 1000 })),
      button('+10k gold', 'A lot of gold', () => actions.send({ gold: 10000 })),
      button('Refresh', 'Full health and mana, all cooldowns ready', () => actions.send({})),
      button('Jump', 'Click on the map: the hero appears there', () => actions.place({ kind: 'teleport' })),
    ),
    el('h4', {}, 'Switches'),
    el(
      'div',
      { class: 'test-row' },
      toggle('Can not die', 'Your hero keeps at least 1 health', (god) => ({ god })),
      toggle('No cooldowns', 'Skills and items are always ready, mana stays full', (freeCasts) => ({ freeCasts })),
      toggle('See the map', 'No fog of war: you see every unit', (reveal) => ({ reveal })),
    ),
    el('div', { class: 'test-row' }, el('span', { class: 'test-label' }, 'Speed'), ...speedButtons),
    el('h4', {}, 'Enemies'),
    el('div', { class: 'test-row' }, unitSelect, countSelect),
    el(
      'div',
      { class: 'test-row' },
      button('Place enemies', 'Click on the map: neutral units that attack everyone', () =>
        actions.place({ kind: 'enemy', unit: unitSelect.value, count: Number(countSelect.value) }),
      ),
      button('Place dummy', 'Click on the map: a target that stands still and never dies (to test damage)', () =>
        actions.place({ kind: 'dummy', unit: unitSelect.value, count: 1 }),
      ),
      button('Remove all', 'Remove every unit placed with this panel', () => actions.send({ clear: true })),
    ),
    placing,
    el('h4', {}, 'Items'),
    filter,
    grid,
  );
  const collapse = el('button', { class: 'test-collapse', title: 'Hide or show the panel (F7)' }, '−');
  const root = el(
    'aside',
    { class: 'test-panel', hidden: true, 'aria-label': 'Test panel' },
    el('div', { class: 'test-head' }, el('b', {}, 'Test panel'), collapse),
    body,
  );
  const fold = () => {
    body.hidden = !body.hidden;
    setText(collapse, body.hidden ? '+' : '−');
  };
  collapse.addEventListener('click', fold);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'F7' && !root.hidden) {
      e.preventDefault();
      fold();
    }
  });
  // The world under the panel must not get these clicks or the wheel.
  root.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });
  return {
    root,
    setVisible(on) {
      root.hidden = !on;
    },
    setPlacing(text) {
      placing.hidden = !text;
      setText(placing, text ?? '');
    },
  };
}

/** "5 Ogre Brutes" style label for the placing line. */
export function placeLabel(p: TestPlace, unitName: string): string {
  if (p.kind === 'teleport') return 'Click on the map to jump there. Esc: cancel.';
  if (p.kind === 'dummy') return `Click on the map to place a dummy (${unitName}). Esc: cancel.`;
  return `Click on the map to place ${p.count} × ${unitName}. Esc: cancel.`;
}
