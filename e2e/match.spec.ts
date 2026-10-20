import { expect, test } from '@playwright/test';

test('loads a lobby and keeps a live match running for sixty seconds', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  await page.goto('/?webgl');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await page
    .locator('select')
    .filter({ has: page.locator('option[value="bot"]') })
    .first()
    .selectOption('bot');
  const start = page.getByRole('button', { name: 'Start Game', exact: true });
  await expect(start).toBeEnabled({ timeout: 45_000 });
  await start.click();
  await expect(page.getByRole('button', { name: 'End Match (test)', exact: true })).toBeVisible({ timeout: 45_000 });
  await expect(page.locator('.game .clock')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Your Kingdom', exact: true })).toBeVisible();
  await expect(page.locator('.ability')).toHaveCount(4);
  for (const skill of await page.locator('.ability').all()) {
    const box = await skill.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y + box!.height).toBeLessThanOrEqual(800);
  }
  const canvas = page.locator('#game-canvas');
  await canvas.click({ position: { x: 780, y: 350 }, button: 'right' });
  // Keep observing the real simulation, rather than passing after a static canvas loads.
  await expect.poll(async () => page.locator('.game .clock').textContent(), { timeout: 70_000 }).toMatch(/01:0[0-9]/);
  await expect(page.getByRole('button', { name: 'End Match (test)', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
