import { gameData, RANDOM_HERO } from '@game/shared';
import { el } from './dom';

/** One picker serves both the player's hero and host-controlled bots. */
export function createHeroPicker(onPick: (slot: number, hero: string) => void) {
  let slot = -1;
  let opener: HTMLElement | null = null;
  const choices = [{ id: RANDOM_HERO, name: 'Random' }, ...gameData.heroes].map((hero) => {
    const portrait =
      hero.id === RANDOM_HERO
        ? el('span', { class: 'hero-choice-portrait random-portrait' }, '?')
        : el('img', { class: 'hero-choice-portrait', src: `/assets/portraits/${hero.id}.webp`, alt: '', loading: 'lazy' });
    return el(
      'button',
      {
        type: 'button',
        class: 'hero-choice',
        'aria-label': hero.name,
        onclick: () => {
          onPick(slot, hero.id);
          root.close();
        },
      },
      portrait,
      el('span', {}, hero.name),
    );
  });
  const root = el(
    'dialog',
    { class: 'panel hero-picker', 'aria-label': 'Choose hero' },
    el(
      'header',
      { class: 'picker-head' },
      el('h2', {}, 'Choose hero'),
      el('button', { class: 'key-bind', onclick: () => root.close(), 'aria-label': 'Close hero picker' }, '×'),
    ),
    el('div', { class: 'hero-grid' }, ...choices),
  );
  root.addEventListener('click', (e) => {
    if (e.target !== root) return;
    const r = root.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) root.close();
  });
  root.addEventListener('close', () => {
    if (opener?.isConnected) opener.focus();
  });
  return {
    root,
    open(index: number, hero: string, button: HTMLElement) {
      slot = index;
      opener = button;
      choices.forEach((choice, i) =>
        choice.setAttribute('aria-pressed', String((i === 0 ? RANDOM_HERO : gameData.heroes[i - 1]!.id) === hero)),
      );
      root.showModal();
      choices.find((choice) => choice.getAttribute('aria-pressed') === 'true')?.focus();
    },
    close: () => root.close(),
    get slot() {
      return slot;
    },
  };
}
