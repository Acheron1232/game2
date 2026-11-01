import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium' });

test('menu title is readable, diagnostics are opt-in and settings controls match the UI', async ({ page }, testInfo) => {
  await page.goto('/?webgl');
  const title = page.locator('.menu .title');
  await expect(title).toHaveCSS('color', 'rgb(240, 213, 138)');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('Show FPS')).not.toBeChecked();
  const quality = page.getByRole('group', { name: 'Quality', exact: true });
  await quality.getByRole('button', { name: 'Low', exact: true }).click();
  await expect(quality.getByRole('button', { name: 'Low', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.settings select')).toHaveCount(0);
  await expect(page.locator('.settings input[type="range"]').first()).toHaveCSS('appearance', 'none');
  await page.screenshot({ path: testInfo.outputPath('settings.png') });
});

test('lobby stays interactive during loading and shows three hero portraits per row', async ({ page }, testInfo) => {
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route('**/assets/models/models.json*', async (route) => {
    await held;
    await route.continue();
  });
  await page.addInitScript(() => {
    const Original = WebSocket;
    window.WebSocket = class extends Original {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols);
        (window as unknown as { sendTestLoad: (pct: number) => void }).sendTestLoad = (pct) =>
          super.send(JSON.stringify({ type: 'load', pct }));
      }
      override send(data: Parameters<WebSocket['send']>[0]) {
        if (typeof data === 'string' && (JSON.parse(data) as { type?: string }).type === 'load') return;
        super.send(data);
      }
    };
  });
  try {
    await page.goto('/?webgl');
    await page.getByRole('button', { name: 'Play', exact: true }).click();
    await page.getByRole('button', { name: 'Create Game', exact: true }).click();
    const own = page.locator('.slots tr.own');
    await expect(own).toBeVisible();
    const color = own.locator('select.swatch-select');
    await color.evaluate((node) => node.setAttribute('data-kept-control', 'yes'));
    await page.evaluate(() => (window as unknown as { sendTestLoad: (pct: number) => void }).sendTestLoad(17));
    await expect(own.locator('td').last()).toContainText('17%');
    await expect(color).toHaveAttribute('data-kept-control', 'yes');
    await own.getByRole('button', { name: /Choose hero/ }).click();
    const picker = page.getByRole('dialog', { name: 'Choose hero', exact: true });
    await expect(picker).toBeVisible();
    const cards = picker.locator('.hero-choice');
    const positions = await cards.evaluateAll((nodes) => nodes.slice(0, 4).map((node) => node.getBoundingClientRect().top));
    expect(positions[0]).toBe(positions[1]);
    expect(positions[1]).toBe(positions[2]);
    expect(positions[3]).toBeGreaterThan(positions[2]!);
    await page.screenshot({ path: testInfo.outputPath('hero-picker.png') });
    await picker.getByRole('button', { name: 'Staff Warrior', exact: true }).click();
    await expect(own.getByRole('button', { name: /Choose hero: Staff Warrior/ })).toBeVisible();
    const bot = page.locator('.slots tbody tr').nth(1);
    await bot.locator('select').first().selectOption('bot');
    await bot.getByRole('button', { name: /Choose hero/ }).click();
    await picker.getByRole('button', { name: 'Stone Golem', exact: true }).click();
    await expect(bot.getByRole('button', { name: /Choose hero: Stone Golem/ })).toBeVisible();
    await bot.getByRole('button', { name: /Choose hero/ }).click();
    await picker.getByRole('button', { name: 'Random', exact: true }).click();
    await expect(bot.getByRole('button', { name: /Choose hero: Random/ })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Start Game', exact: true })).toBeDisabled();
    await page.screenshot({ path: testInfo.outputPath('loading-lobby.png') });
  } finally {
    release();
  }
});

test('move clicks show a marker and backpack menus browse recipes and drop items', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() =>
    localStorage.setItem('tw-settings', JSON.stringify({ quality: 'low', renderScale: 0.5, shadows: false, effects: 'low' })),
  );
  await page.goto('/?play&webgl');
  await expect(page.getByRole('button', { name: 'End Match (test)', exact: true })).toBeVisible({ timeout: 60_000 });
  await expect(page.locator('#debug')).toBeHidden();
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeVisible();
  await page.keyboard.press('F3');
  await expect(page.locator('#debug')).toBeHidden();
  await page.locator('#game-canvas').click({ position: { x: 730, y: 350 }, button: 'right' });
  const markerVisible = () =>
    page.evaluate(() => {
      const dev = window as unknown as { world: { scene: { getMeshByName(name: string): { isEnabled(): boolean } | null } } };
      return dev.world.scene.getMeshByName('move-order-marker')?.isEnabled() ?? false;
    });
  await expect.poll(markerVisible).toBe(true);
  // Hold only the screenshot's animation clock so the brief flash is visible in the image.
  await page.evaluate(() => {
    const clock = window as unknown as { markerClock: () => number };
    clock.markerClock = performance.now.bind(performance);
    const frame = performance.now();
    performance.now = () => frame;
  });
  await page.screenshot({ path: testInfo.outputPath('move-marker.png') });
  await page.evaluate(() => {
    performance.now = (window as unknown as { markerClock: () => number }).markerClock;
  });
  await expect.poll(markerVisible).toBe(false);
  await page.locator('.minimap canvas').click({ position: { x: 80, y: 80 }, button: 'right' });
  await expect.poll(markerVisible).toBe(true);
  await page.evaluate(() =>
    (window as unknown as { net: { send(message: unknown): void } }).net.send({ type: 'cheat', item: 'focus_crystal' }),
  );
  const slot = page.locator('.item-slot[data-slot="0"]');
  await expect(slot).not.toHaveClass(/empty/);
  const recipeRequests: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('/assets/icons/')) recipeRequests.push(request.url());
  });
  await slot.click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Item actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'View recipes', exact: true }).click();
  const recipes = page.getByRole('dialog', { name: 'Item recipes', exact: true });
  await expect(recipes).toContainText('Focus Crystal');
  await expect(recipes).toContainText('Used in');
  const anchor = (await slot.boundingBox())!;
  const hint = (await recipes.boundingBox())!;
  expect(hint.width).toBeLessThanOrEqual(320);
  expect(hint.height).toBeLessThanOrEqual(340);
  expect(hint.x + hint.width).toBeLessThanOrEqual(anchor.x + 2);
  expect(anchor.x - hint.x - hint.width).toBeLessThanOrEqual(24);
  expect(hint.y).toBeLessThan(anchor.y + anchor.height);
  expect(hint.y + hint.height).toBeGreaterThan(anchor.y);
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await recipes
    .getByRole('button', { name: /Arcane Staff/ })
    .first()
    .click();
  await expect(recipes.getByRole('button', { name: 'Close recipes', exact: true })).toBeFocused();
  await recipes.getByRole('button', { name: 'Close recipes', exact: true }).press('Tab');
  await expect(page.locator('.scoreboard')).toBeHidden();
  await expect(recipes).toContainText('Made from');
  await expect(recipes).toContainText('Focus Crystal');
  await page.screenshot({ path: testInfo.outputPath('item-recipes.png') });
  await page.keyboard.press('Escape');
  await expect(recipes).toBeHidden();
  await expect(slot).not.toHaveClass(/empty/);
  await slot.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'View recipes', exact: true }).click();
  await page.locator('#game-canvas').click({ position: { x: 730, y: 350 }, button: 'right' });
  await expect(recipes).toBeHidden();
  await slot.focus();
  await slot.press('Enter');
  await expect(page.locator('.hud-chat-input')).toBeHidden();
  await slot.click({ button: 'right' });
  await page.evaluate(() => (window as unknown as { match: () => { swapItems(a: number, b: number): void } }).match().swapItems(0, 1));
  await expect(menu).toBeHidden();
  await expect(slot).toHaveClass(/empty/);
  const movedSlot = page.locator('.item-slot[data-slot="1"]');
  await expect(movedSlot).not.toHaveClass(/empty/);
  await movedSlot.click({ button: 'right' });
  await menu.getByRole('menuitem', { name: 'Drop item', exact: true }).click();
  await expect(movedSlot).toHaveClass(/empty/);
  await slot.click({ button: 'right' });
  await expect(menu).toBeHidden();
  expect(recipeRequests).toEqual([]);
  expect(errors).toEqual([]);
});
