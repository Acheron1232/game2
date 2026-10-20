import { expect as baseExpect, test } from '@playwright/test';

const expect = baseExpect.configure({ timeout: 15_000 });

test.use({ channel: 'chromium' });

test('captured mouse routes hover and HUD clicks and releases for settings, chat and Escape', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // This test exercises native input, not GPU speed. Keep the software-only CI
  // renderer responsive and verify CSS-pixel input at a different render scale.
  // The separate live-match smoke still uses the default High/native settings.
  await page.addInitScript(() =>
    localStorage.setItem(
      'tw-settings',
      JSON.stringify({
        quality: 'low',
        renderScale: 0.5,
        shadows: false,
        effects: 'low',
        showFps: false,
      }),
    ),
  );
  await page.goto('/?play&webgl');
  const capture = page.getByRole('button', { name: 'Capture mouse', exact: true });
  await expect(capture).toBeVisible({ timeout: 45_000 });
  // Use the real browser lock API. The older headless-shell binary rejects it on
  // macOS, so this file uses full Chromium's current headless mode instead.
  await page.getByRole('button', { name: '⛶', exact: true }).click();
  await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(true);
  let mouseX = 0;
  let mouseY = 0;
  const lock = async () => {
    const box = (await capture.boundingBox())!;
    mouseX = box.x + box.width / 2;
    mouseY = box.y + box.height / 2;
    await capture.click();
    await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
    await expect(page.locator('.game-cursor')).toBeVisible();
  };
  const moveTo = async (selector: string) => {
    const target = (await page.locator(selector).first().boundingBox())!;
    const cursor = await page.locator('.game-cursor').evaluate((node) => {
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return { x: rect.x - parseFloat(style.left), y: rect.y - parseFloat(style.top) };
    });
    mouseX += target.x + target.width / 2 - cursor.x;
    mouseY += target.y + target.height / 2 - cursor.y;
    await page.mouse.move(mouseX, mouseY);
  };
  await page.evaluate(() => {
    const dev = window as unknown as { net: { send(message: { type: 'cheat'; item: string }): void } };
    dev.net.send({ type: 'cheat', item: 'healing_potion' });
  });
  await expect(page.locator('.item-slot').nth(0)).not.toHaveClass(/empty/);
  await lock();
  // CDP discards out-of-viewport mouse positions on some Linux hosts, even with
  // pointer lock. Sweep full in-viewport ranges to align the driver and virtual
  // cursor at the same corner before sending normal HUD coordinates.
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.mouse.move(0, 0);
  await page.mouse.move(viewport.width - 1, viewport.height - 1);
  mouseX = mouseY = 0;
  await page.mouse.move(mouseX, mouseY);
  await expect.poll(async () => (await page.locator('.game-cursor').boundingBox())!.y).toBe(-3);
  await moveTo('.ability');
  await expect(page.locator('.tooltip')).toBeVisible();
  await moveTo('.ability .learn');
  await page.mouse.click(mouseX, mouseY);
  await expect(page.locator('.ability .learn').first()).toBeHidden();
  await page.screenshot({ path: testInfo.outputPath('captured-game-cursor.png') });
  await moveTo('.item-slot[data-slot="0"]');
  await page.mouse.down();
  await moveTo('.item-slot[data-slot="1"]');
  await expect(page.locator('.item-ghost')).toBeVisible();
  await page.mouse.up();
  await expect(page.locator('.item-slot').nth(0)).toHaveClass(/empty/);
  await expect(page.locator('.item-slot').nth(1)).not.toHaveClass(/empty/);
  await expect(page.locator('.item-ghost')).toBeHidden();
  await moveTo('button[title="Settings"]');
  await page.mouse.click(mouseX, mouseY);
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await lock();
  await moveTo('.ability');
  await page.mouse.click(mouseX, mouseY);
  await expect(page.locator('#game-canvas')).toBeFocused();
  await page.keyboard.press('Space');
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(true);
  await moveTo('.item-slot[data-slot="1"]');
  await page.mouse.down();
  await moveTo('.item-slot[data-slot="2"]');
  await expect(page.locator('.item-ghost')).toBeVisible();
  await page.keyboard.press('Enter');
  await expect(page.locator('.hud-chat-input')).toBeFocused();
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await expect(page.locator('.item-ghost')).toBeHidden();
  await page.mouse.up();
  await page.keyboard.press('Escape');
  await lock();
  await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => !!document.pointerLockElement)).toBe(false);
  await expect(page.locator('.game-cursor')).toBeHidden();
  await page.getByRole('button', { name: 'End Match (test)', exact: true }).click();
  expect(errors).toEqual([]);
});
