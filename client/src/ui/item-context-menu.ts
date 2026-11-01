import { gameData } from '@game/shared';
import { el } from './dom';

export function createItemContextMenu(drop: (slot: number) => void, icon: (item: number) => string | null) {
  let slot = -1;
  let item = -1;
  let opener: HTMLElement | null = null;
  const dismiss = (restoreFocus: boolean) => {
    menu.hidden = recipes.hidden = true;
    if (restoreFocus && opener?.isConnected) opener.focus();
  };
  const close = () => dismiss(true);
  const recipeBody = el('div', { class: 'recipe-body' });
  const closeButton = el('button', { class: 'hint-close', onclick: close, 'aria-label': 'Close recipes' }, '×');
  const recipes = el(
    'div',
    { class: 'recipe-panel', role: 'dialog', 'aria-modal': 'false', 'aria-label': 'Item recipes', hidden: true },
    el('header', { class: 'recipe-head' }, el('span', {}, 'Recipes'), closeButton),
    recipeBody,
  );

  const place = (panel: HTMLElement) => {
    if (!opener?.isConnected) return dismiss(false);
    const anchor = opener.getBoundingClientRect();
    const rect = panel.getBoundingClientRect();
    let left = anchor.left - rect.width - 10;
    if (left < 8) left = anchor.right + 10;
    panel.style.left = `${Math.max(8, Math.min(left, innerWidth - rect.width - 8))}px`;
    panel.style.top = `${Math.max(8, Math.min(anchor.bottom - rect.height, innerHeight - rect.height - 8))}px`;
  };
  const showRecipe = (index: number) => {
    const def = gameData.items[index];
    if (!def) return;
    const card = (id: string) => {
      const i = gameData.items.findIndex((d) => d.id === id);
      const d = gameData.items[i]!;
      return el(
        'button',
        { class: 'recipe-item', onclick: () => showRecipe(i), type: 'button' },
        el('img', { src: icon(i) ?? undefined, alt: '' }),
        el('span', {}, d.name, el('small', {}, `${d.cost} gold`)),
      );
    };
    const usedIn = gameData.items.filter((d) => d.recipe?.components.includes(def.id));
    recipeBody.replaceChildren(
      el('h3', {}, def.name),
      el('p', { class: 'recipe-price' }, def.cost === null ? 'Drop only' : `${def.cost} gold`),
      el('h4', {}, 'Made from'),
      def.recipe
        ? el('div', { class: 'recipe-list' }, ...def.recipe.components.map(card))
        : el('p', { class: 'muted' }, def.cost === null ? 'Found in drops.' : 'Buy from a shop.'),
      ...(def.recipe ? [el('p', { class: 'recipe-fee' }, `Recipe fee: ${def.recipe.fee} gold`)] : []),
      el('h4', {}, 'Used in'),
      usedIn.length
        ? el('div', { class: 'recipe-list' }, ...usedIn.map((d) => card(d.id)))
        : el('p', { class: 'muted' }, 'No further recipes.'),
    );
    recipes.scrollTop = 0;
    if (!recipes.hidden) {
      place(recipes);
      closeButton.focus({ preventScroll: true });
    }
  };
  const title = el('strong');
  const dropButton = el(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        const chosen = slot;
        close();
        drop(chosen);
      },
    },
    'Drop item',
  );
  const recipeButton = el(
    'button',
    {
      type: 'button',
      role: 'menuitem',
      onclick: () => {
        menu.hidden = true;
        showRecipe(item);
        recipes.hidden = false;
        place(recipes);
        closeButton.focus({ preventScroll: true });
      },
    },
    'View recipes',
  );
  const menu = el(
    'div',
    { class: 'panel item-context-menu', role: 'menu', 'aria-label': 'Item actions', hidden: true },
    title,
    dropButton,
    recipeButton,
  );
  menu.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (document.activeElement === dropButton ? recipeButton : dropButton).focus();
    }
    if (e.key === 'Tab') close();
  });
  recipes.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });
  recipes.addEventListener(
    'wheel',
    (e) => {
      // Pointer lock routes synthetic wheel events, which do not scroll native elements.
      if (!e.isTrusted) {
        const step = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? recipes.clientHeight : 1;
        recipes.scrollTop += e.deltaY * step;
        e.preventDefault();
      }
      e.stopPropagation();
    },
    { passive: false },
  );
  document.addEventListener(
    'pointerdown',
    (e) => {
      // Captured native clicks target the canvas; handle GameCursor's routed event instead.
      if (document.pointerLockElement && e.isTrusted) return;
      if (e.target instanceof Node && !menu.contains(e.target) && !recipes.contains(e.target)) dismiss(false);
    },
    true,
  );
  window.addEventListener('resize', () => {
    if (!recipes.hidden) place(recipes);
    if (!menu.hidden) place(menu);
  });
  window.addEventListener('blur', () => dismiss(false));
  return {
    menu,
    recipes,
    close,
    open(index: number, itemIndex: number, target: HTMLElement) {
      dismiss(false);
      slot = index;
      item = itemIndex;
      opener = target;
      title.textContent = gameData.items[item]?.name ?? 'Item';
      menu.hidden = false;
      place(menu);
      dropButton.focus({ preventScroll: true });
    },
    update(items: readonly ({ item: number } | null)[]) {
      if ((!menu.hidden || !recipes.hidden) && items[slot]?.item !== item) dismiss(false);
    },
  };
}
