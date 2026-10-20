import { expect, test } from '@playwright/test';
import type { GameWorld } from '../client/src/render/world';

test.use({ channel: 'chromium' });
test.skip(process.env['GAME_PROFILE'] !== '1', 'Manual hardware profile; timing is not a CI assertion.');
test('profiles 300 real skeletal units outside the camera at the same native quality', async ({ page }) => {
  await page.goto('/?play&webgl');
  await expect(page.getByRole('button', { name: 'End Match (test)', exact: true })).toBeVisible({ timeout: 45_000 });
  const result = await page.evaluate(async () => {
    const w = (window as unknown as { world: GameWorld }).world;
    const original = w.inView;
    // Freeze logical poses so both cases use the same scene; the online server is untouched.
    const frame = w.beforeFrame;
    w.beforeFrame = null;
    const added = Array.from({ length: 300 }, (_, i) =>
      w.addUnit('swordsman', 'red', 210 + (i % 15), 20 + Math.floor(i / 15), 0, 3, false),
    );
    const measure = async (culling: boolean) => {
      w.inView = culling ? original : () => true;
      return new Promise<{ cpu: number; activeAnimations: number; visible: number; frames: number }>((resolve) => {
        let started = 0,
          n = 0,
          total = 0;
        const before = w.scene.onBeforeAnimationsObservable.add(() => {
          started = performance.now();
        });
        const after = w.scene.onAfterRenderObservable.add(() => {
          n++;
          if (n > 120) total += performance.now() - started;
          if (n < 360) return;
          w.scene.onBeforeAnimationsObservable.remove(before);
          w.scene.onAfterRenderObservable.remove(after);
          resolve({ cpu: total / 240, activeAnimations: w.scene.animatables.length, visible: w.renderStats.visible, frames: 240 });
        });
      });
    };
    try {
      const baseline = await measure(false);
      const optimized = await measure(true);
      const baselineAgain = await measure(false);
      return {
        adapter: w.engine.getInfo(),
        size: [w.engine.getRenderWidth(), w.engine.getRenderHeight()],
        cap: w.engine.maxFPS,
        baseline,
        optimized,
        baselineAgain,
      };
    } finally {
      w.inView = original;
      for (const u of added) w.removeUnit(u);
      w.beforeFrame = frame;
    }
  });
  console.log(JSON.stringify(result));
  expect(result.optimized.activeAnimations).toBeLessThan(result.baseline.activeAnimations);
  expect(result.optimized.visible).toBeLessThan(result.baseline.visible);
});
