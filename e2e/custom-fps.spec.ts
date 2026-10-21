import { expect, test } from '@playwright/test';

test.use({ channel: 'chromium' });
test('custom FPS applies on return, validates empty input and survives reload', async ({ page }) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('tw-settings'))
      localStorage.setItem(
        'tw-settings',
        JSON.stringify({ quality: 'low', renderScale: 0.5, shadows: false, effects: 'low', showFps: false }),
      );
  });
  await page.goto('/?play&webgl');
  const ready = page.getByRole('button', { name: 'End Match (test)', exact: true });
  await expect(ready).toBeVisible({ timeout: 45000 });
  const cap = () => page.evaluate(() => (window as unknown as { world: { engine: { maxFPS: number } } }).world.engine.maxFPS);
  await expect.poll(cap).toBe(120);
  await page.locator('button[title="Settings"]').click();
  const fps = page.getByRole('spinbutton', { name: 'FPS limit', exact: true });
  await expect(fps).toHaveValue('120');
  await fps.fill('90');
  await fps.press('Enter');
  await expect.poll(cap).toBe(30);
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(cap).toBe(90);
  await page.locator('button[title="Settings"]').click();
  await fps.fill('');
  await fps.press('Enter');
  await expect(fps).toHaveValue('90');
  await fps.fill('165');
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(cap).toBe(165);
  await page.reload();
  await expect(ready).toBeVisible({ timeout: 45000 });
  await expect.poll(cap).toBe(165);
  await page.locator('button[title="Settings"]').click();
  await expect(fps).toHaveValue('165');
});
