import { expect, test } from '@playwright/test';
import { BinaryReader } from '../shared/src/protocol/binary';
import { MsgId } from '../shared/src/protocol/messages';
import type { MatchClient } from '../client/src/game/match-client';
import type { GameWorld } from '../client/src/render/world';

test.use({ channel: 'chromium' });

test('test mode and held RMB steering work with the portrait picker and recipe hints', async ({ page }, testInfo) => {
  const errors: string[] = [];
  const moves: { x: number; y: number; queue: boolean }[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  // Observe real binary traffic, so this catches losing steering during a UI merge.
  page.on('websocket', (socket) =>
    socket.on('framesent', ({ payload }) => {
      if (typeof payload === 'string') return;
      const reader = new BinaryReader(new Uint8Array(payload).buffer);
      if (reader.u8() !== MsgId.Command) return;
      reader.u16(); // sequence
      if (reader.u8() !== 1) return; // Move command
      moves.push({ x: reader.u16(), y: reader.u16(), queue: (reader.u8() & 1) !== 0 });
    }),
  );
  await page.addInitScript(() =>
    localStorage.setItem('tw-settings', JSON.stringify({ quality: 'low', renderScale: 0.5, shadows: false, effects: 'low' })),
  );
  await page.goto('/?webgl');
  await page.getByRole('button', { name: 'Play', exact: true }).click();
  await page.getByRole('button', { name: 'Create Game', exact: true }).click();
  await page.locator('.lobby-mode select').selectOption('test');
  await expect(page.locator('.lobby-mode')).toHaveAttribute('title', /Everyone gets the test panel/);
  await page
    .locator('.slots tr.own')
    .getByRole('button', { name: /Choose hero/ })
    .click();
  await page.getByRole('dialog', { name: 'Choose hero', exact: true }).getByRole('button', { name: 'Staff Warrior', exact: true }).click();
  const start = page.getByRole('button', { name: 'Start Game', exact: true });
  await expect(start).toBeEnabled({ timeout: 60_000 });
  await start.click();
  const panel = page.getByRole('complementary', { name: 'Test panel', exact: true });
  await expect(panel).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.hud-console')).toBeVisible();
  await expect(page.locator('#debug')).toBeHidden();
  await panel.getByRole('button', { name: 'Level max', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { match: () => MatchClient }).match().player.level)).toBe(15);
  await panel.locator('.test-item[title="Focus Crystal"]').click();
  const slot = page.locator('.inventory .item-slot').first();
  await expect(slot).not.toHaveClass(/empty/);
  await slot.click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'View recipes', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Item recipes', exact: true })).toContainText('Focus Crystal');
  await expect(page.locator('dialog:modal')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  const shake = page.getByLabel('Screen shake on big hits', { exact: true });
  await expect(shake).toBeChecked();
  await shake.uncheck();
  await page.getByRole('button', { name: 'Back', exact: true }).click();
  await expect.poll(() => page.evaluate(() => (window as unknown as { world: GameWorld }).world.camera.shakeEnabled)).toBe(false);
  const emptyPoints = () =>
    page.evaluate(() => {
      const dev = window as unknown as { world: GameWorld; match: () => MatchClient };
      const m = dev.match();
      return [
        [430, 230],
        [720, 310],
        [470, 420],
        [700, 450],
        [550, 200],
      ].filter(([x, y]) => !m.pick(x!, y!) && !m.pickGroundItem(x!, y!) && dev.world.pickGround(x!, y!));
    });
  const points = await emptyPoints();
  expect(points.length).toBeGreaterThanOrEqual(2);
  const [a, b] = points as [number[], number[]];
  moves.length = 0;
  await page.mouse.move(a[0]!, a[1]!);
  await page.mouse.down({ button: 'right' });
  // This duration is the physical hold, beyond the steering throttle interval.
  await page.waitForTimeout(180);
  await page.mouse.move(b[0]!, b[1]!, { steps: 5 });
  await expect.poll(() => moves.length).toBeGreaterThanOrEqual(2);
  await page.mouse.up({ button: 'right' });
  expect(moves.every((cmd) => !cmd.queue)).toBe(true);
  expect(moves[0]!.x !== moves.at(-1)!.x || moves[0]!.y !== moves.at(-1)!.y).toBe(true);
  moves.length = 0;
  const queued = await emptyPoints();
  await page.keyboard.down('Shift');
  await page.mouse.move(queued[0]![0]!, queued[0]![1]!);
  await page.mouse.down({ button: 'right' });
  await page.waitForTimeout(180);
  await page.mouse.move(queued[1]![0]!, queued[1]![1]!, { steps: 5 });
  await page.mouse.up({ button: 'right' });
  await page.keyboard.up('Shift');
  await expect.poll(() => moves.length).toBe(1);
  expect(moves[0]!.queue).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('merged-test-mode.png') });
  expect(errors).toEqual([]);
});
