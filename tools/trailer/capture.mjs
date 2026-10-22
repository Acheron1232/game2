// Capture the running game with a separate local server. No production files are changed.
/* global fetch, setTimeout, window, world, match, document, performance, MediaRecorder, Blob, FileReader */
import { chromium } from '@playwright/test';
import { createGameServer } from '../../server/src/server.ts';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'media/trailer');
await mkdir(`${out}/source`, { recursive: true });
const server = createGameServer({ matchMode: 'inline', allowTestOptions: true });
await new Promise((r) => server.http.listen(8790, '127.0.0.1', r));
const vite = spawn('pnpm', ['--filter', '@game/client', 'dev', '--host', '127.0.0.1', '--port', '5180'], {
  cwd: root,
  env: { ...process.env, GAME_SERVER: 'http://127.0.0.1:8790' },
  stdio: 'ignore',
});
let browser;
try {
  for (let n = 0; n < 100; n++) {
    try {
      if ((await fetch('http://127.0.0.1:5180')).ok) break;
    } catch {
      /* Vite is starting. */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--enable-webgl', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on('pageerror', (e) => console.error('Browser:', e.message));
  await page.goto('http://127.0.0.1:5180/?webgl&watch=1&fps=30');
  await page.waitForFunction(() => window.match?.()?.entities.size > 30, {}, { timeout: 90000 });
  const room = [...server.lobby.rooms.values()][0];
  const runner = room.match.runner;
  console.log('Match ready:', room.code, 'Factions:', !!runner.sim.factions);
  await page.addStyleTag({
    content: '#ui, #debug, .floating-text, #cursor, .game-cursor {visibility:hidden!important} *{cursor:none!important}',
  });
  await page.evaluate(() => {
    world.engine.renderEvenInBackground = true;
    world.camera.enabled = false;
    window.shot = { x: 128, y: 128, radius: 54, beta: 0.72, alpha: Math.PI / 2, drift: 0, born: performance.now(), follow: null };
    world.scene.onBeforeRenderObservable.add(() => {
      const s = window.shot,
        t = (performance.now() - s.born) / 1000;
      const u = s.follow ? match().entities.get(s.follow)?.unit : null;
      const x = u?.x ?? s.x,
        y = u?.y ?? s.y;
      world.camera.target.x = x;
      world.camera.target.y = y;
      const c = world.camera.camera;
      c.target.set(x + Math.sin(t * 0.12) * s.drift, world.terrain.heightAt(x, y) + 0.6, -y);
      c.radius = s.radius - t * 0.35;
      c.beta = s.beta;
      c.alpha = s.alpha + t * 0.018;
    });
  });
  const report = [];
  async function capture(name, seconds, config) {
    await page.evaluate((s) => {
      window.shot = { alpha: Math.PI / 2, beta: 0.72, drift: 1.5, follow: null, ...s, born: performance.now() };
    }, config);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/source/${name}.jpg` });
    const base64 = await page.evaluate(async (seconds) => {
      const canvas = document.querySelector('#game-canvas');
      const stream = canvas.captureStream(30);
      const recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp8', videoBitsPerSecond: 16000000 });
      const chunks = [];
      const done = new Promise((r) => {
        recorder.onstop = r;
      });
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data);
      };
      recorder.start(500);
      await new Promise((r) => setTimeout(r, seconds * 1000));
      recorder.stop();
      await done;
      stream.getTracks().forEach((t) => t.stop());
      const blob = new Blob(chunks, { type: 'video/webm' });
      return await new Promise((r) => {
        const f = new FileReader();
        f.onload = () => r(f.result.split(',')[1]);
        f.readAsDataURL(blob);
      });
    }, seconds);
    await writeFile(`${out}/source/${name}.webm`, Buffer.from(base64, 'base64'));
    const stats = await page.evaluate(() => ({ fps: world.engine.getFps(), units: world.units.size }));
    report.push({ name, seconds, ...config, ...stats, tick: runner.sim.tick });
    console.log('Captured', name, stats);
  }
  await capture('01-temple', 6, { x: 128, y: 128, radius: 75, beta: 0.68 });
  const hero = await page.evaluate(
    () => [...match().entities.values()].find((e) => e.owner < 4 && e.unit && !e.unit.building && !['worker'].includes(e.unit.modelId))?.id,
  );
  await capture('02-hero', 6, { follow: hero, radius: 22, x: 128, y: 128, beta: 0.92 });
  runner.speed = 10;
  await page.waitForTimeout(22000);
  runner.speed = 1;
  await page.evaluate(() => {
    match().clock.offset = null;
  });
  await page.waitForTimeout(1500);
  console.log(
    'Warm match',
    runner.sim.tick,
    await page.evaluate(() => ({ count: world.units.size, types: [...new Set([...world.units].map((u) => u.modelId))] })),
  );
  const base = await page.evaluate(() => {
    const u =
      [...world.units].find((u) => ['town_hall', 'stronghold', 'citadel'].includes(u.modelId)) ?? [...world.units].find((u) => u.building);
    return { x: u?.x ?? 40, y: u?.y ?? 40 };
  });
  await capture('03-kingdom', 6, { ...base, radius: 48, beta: 0.68 });
  async function action(armyOnly = false) {
    return page.evaluate((armyOnly) => {
      const es = [...match().entities.values()].filter(
        (e) => e.hp > 0 && e.unit && !e.unit.building && (!armyOnly || (e.owner < 4 && e.unit.modelId !== 'worker')),
      );
      let best = null,
        score = -1;
      for (const e of es) {
        let s = 0;
        for (const o of es) {
          const d = Math.hypot(o.unit.x - e.unit.x, o.unit.y - e.unit.y);
          if (d < 22) s += (o.state & 2 ? 5 : 1) + (o.owner !== e.owner ? 2 : 0);
        }
        if (s > score) {
          score = s;
          best = e;
        }
      }
      return { x: best.unit.x, y: best.unit.y, score, follow: best.id };
    }, armyOnly);
  }
  let a = await action();
  await capture('04-conflict', 6, { ...a, follow: null, radius: 38, beta: 0.76 });
  runner.speed = 10;
  await page.waitForTimeout(45000);
  runner.speed = 1;
  await page.evaluate(() => {
    match().clock.offset = null;
  });
  await page.waitForTimeout(1200);
  a = await action(true);
  await capture('05-armies', 6, { ...a, follow: null, radius: 46, beta: 0.68 });
  a = await action();
  await capture('06-battle', 8, { ...a, follow: null, radius: 31, beta: 0.78, alpha: 1.25 });
  await capture('07-finale', 7, { x: 128, y: 128, radius: 83, beta: 0.64, alpha: 1.1 });
  await writeFile(`${out}/source/capture.json`, JSON.stringify(report, null, 2));
  console.log('Capture complete:', out);
} finally {
  await browser?.close();
  vite.kill('SIGTERM');
  await server.close();
}
// Lobby reconnect timers may outlive the isolated capture server.
process.exit(0);
