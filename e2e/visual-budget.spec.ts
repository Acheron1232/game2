import { expect, test } from '@playwright/test';
import type { GameWorld } from '../client/src/render/world';

test.use({ channel: 'chromium' });

for (const query of ['?play&webgl', '?play'])
  test(`camera culling (${query}) restores models, animation phase and marks; Settings keeps simulation alive at 30 FPS`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (e) => {
      if (e.type() === 'error') errors.push(e.text());
    });
    await page.goto('/' + query);
    await expect(page.getByRole('button', { name: 'End Match (test)', exact: true })).toBeVisible({ timeout: 45_000 });
    // A local-only test fixture: actual loaded models, camera, skeletons and GPU buffers.
    const read = () =>
      page.evaluate(() => {
        const w = (window as unknown as { world: GameWorld }).world;
        const units = [...w.units];
        return {
          visible: w.renderStats.visible,
          total: w.renderStats.total,
          animatedOffscreen: units.filter((u) => !u.visualVisible && [...u.model.animations.values()].some((g) => g.isPlaying)).length,
          renderSize: [w.engine.getRenderWidth(), w.engine.getRenderHeight()],
          fps: w.engine.maxFPS,
        };
      });
    const initial = await read();
    expect(initial.renderSize).toEqual([1280, 800]);
    expect(initial.fps).toBe(120);
    await page.evaluate(() => {
      const w = (window as unknown as { world: GameWorld }).world;
      w.camera.follow = null;
      w.camera.lookAt(128, 128);
    });
    await expect.poll(async () => (await read()).visible, { timeout: 15000 }).toBe(0);
    expect((await read()).animatedOffscreen).toBe(0);
    await page.getByRole('button', { name: 'Your Kingdom', exact: true }).click();
    await expect.poll(async () => (await read()).visible, { timeout: 15000 }).toBeGreaterThan(0);
    const restored = await page.evaluate(() => {
      const w = (window as unknown as { world: GameWorld }).world;
      const visible = [...w.units].filter((u) => u.visualVisible);
      return visible.every((u) => u.model.meshes.every((m) => m.isVisible) && Math.abs(u.model.root.position.x - u.x) < 0.01);
    });
    expect(restored).toBe(true);
    await page.locator('button[title="Settings"]').click();
    await expect.poll(async () => (await read()).fps).toBe(30);
    const tick = () => page.evaluate(() => (window as unknown as { match: () => { tick: number } }).match().tick);
    const before = await tick();
    await expect.poll(tick, { timeout: 15000 }).toBeGreaterThan(before + 20);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await expect.poll(async () => (await read()).fps).toBe(120);
    expect((await read()).renderSize).toEqual(initial.renderSize);
    expect(errors).toEqual([]);
  });
