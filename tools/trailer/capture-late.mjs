// Render genuine late-game simulation frames at exactly 60 FPS with WebCodecs.
/* global fetch, setTimeout, window, world, match, document, performance, VideoEncoder, VideoFrame, Blob, FileReader */
import { chromium } from '@playwright/test';
import { createGameServer } from '../../server/src/server.ts';
import { MatchRunner } from '../../server/src/match/match-runner.ts';
import { entitySources, ENTITY_TYPES } from '../../shared/src/index.ts';
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = `${root}/media/trailer-late60`;
const source = `${out}/source`;
await mkdir(source, { recursive: true });
const scout = JSON.parse(await readFile(`${source}/scout.json`, 'utf8'));
const terrain = new Uint8Array(await readFile(`${root}/shared/data/map-terrain.bin`));
const { trees } = JSON.parse(await readFile(`${root}/shared/data/map-trees.json`, 'utf8'));
const server = createGameServer({ matchMode: 'inline', allowTestOptions: true });
await new Promise((r) => server.http.listen(8790, '127.0.0.1', r));
const vite = spawn('pnpm', ['--filter', '@game/client', 'dev', '--host', '127.0.0.1', '--port', '5180', '--strictPort'], {
  cwd: root,
  env: { ...process.env, GAME_SERVER: 'http://127.0.0.1:8790' },
  stdio: 'ignore',
  detached: true,
});
let browser;
const shots = [
  { name: '01-capital', tick: 18000, seconds: 5, kind: 'city', slot: 1, radius: 66, beta: 0.76, alpha: 2.15, turn: -0.045 },
  { name: '02-citadel', tick: 18140, seconds: 4, kind: 'city', slot: 1, radius: 36, beta: 1.0, alpha: 1.62, turn: -0.055 },
  { name: '03-dragon', tick: 18560, seconds: 6, kind: 'fight', x: 31, y: 120, radius: 42, beta: 0.86, alpha: 1.4, turn: 0.024 },
  { name: '04-crossfire', tick: 21960, seconds: 6, kind: 'fight', x: 32, y: 95, radius: 44, beta: 0.78, alpha: 1.12, turn: 0.026 },
  { name: '05-siege', tick: 25060, seconds: 7, kind: 'fight', x: 93, y: 215, radius: 48, beta: 0.82, alpha: 1.65, turn: -0.027 },
  { name: '06-airborne', tick: 27660, seconds: 6, kind: 'fight', x: 173, y: 43, radius: 46, beta: 0.78, alpha: 2.0, turn: -0.025 },
  { name: '07-laststand', tick: 34260, seconds: 10, kind: 'fight', x: 110, y: 221, radius: 44, beta: 0.83, alpha: 1.0, turn: 0.023 },
  { name: '08-finale', tick: 34500, seconds: 6, kind: 'fight', x: 110, y: 221, radius: 65, beta: 0.7, alpha: 1.45, turn: 0.02 },
];
try {
  for (let n = 0; n < 150; n++) {
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
  await page.goto('http://127.0.0.1:5180/?webgl&watch=1&fps=60');
  await page.waitForFunction(() => window.match?.()?.entities.size > 30, {}, { timeout: 90000 });
  const room = [...server.lobby.rooms.values()][0];
  room.match.stop();
  const runner = new MatchRunner(scout.setup, terrain, trees);
  const advanceOne = () => {
    if (runner.sim.tick % 10 === 0) runner.tick();
    else runner.sim.step();
  };
  const packet = (reset = false) => {
    const view = runner.views.get(-1);
    if (reset) view.reset();
    runner.vision.update(entitySources(runner.sim.entities));
    return [...view.write(runner.sim, runner.vision, runner.sw, runner.w).slice()];
  };
  await page.addStyleTag({ content: '#ui,#debug,.floating-text,#cursor,.game-cursor{display:none!important} *{cursor:none!important}' });
  const support = await page.evaluate(async () => {
    const cfg = {
      codec: 'avc1.64002a',
      width: 1920,
      height: 1080,
      bitrate: 22000000,
      framerate: 60,
      avc: { format: 'annexb' },
      hardwareAcceleration: 'prefer-hardware',
      latencyMode: 'realtime',
    };
    const supported = await VideoEncoder.isConfigSupported(cfg);
    if (!supported.supported) throw new Error('60 FPS H.264 encoding is unavailable.');
    window.encodeConfig = cfg;
    world.engine.stopRenderLoop();
    world.engine.renderEvenInBackground = true;
    world.camera.enabled = false;
    world.fog.setEnabled(false);
    world.engine.getDeltaTime = () => 1000 / 60;
    window.filmNow = performance.now();
    Object.defineProperty(performance, 'now', { value: () => window.filmNow, configurable: true });
    window.filmFrame = 0;
    return supported;
  });
  console.log('Encoder ready:', support);
  const report = [];
  for (const s of shots) {
    while (runner.sim.tick < s.tick) advanceOne();
    const cityEntities = runner.sim.entities.filter(
      (e) => e.alive && e.owner === s.slot && e.building?.done && ENTITY_TYPES[e.type] !== 'gold_mine',
    );
    if (s.kind === 'city') {
      const f = runner.sim.factions.list[s.slot];
      const hall = cityEntities.find((e) => e.id === f.homeHallId);
      const near = cityEntities.filter((e) => Math.hypot(e.mover.x - hall.mover.x, e.mover.y - hall.mover.y) < 35);
      s.x = s.name === '02-citadel' ? hall.mover.x : near.reduce((v, e) => v + e.mover.x, 0) / near.length;
      s.y = s.name === '02-citadel' ? hall.mover.y : near.reduce((v, e) => v + e.mover.y, 0) / near.length;
    }
    const army = runner.sim.entities.filter(
      (e) => e.alive && e.owner < 4 && !e.building && !e.job && Math.hypot(e.mover.x - s.x, e.mover.y - s.y) < 26,
    );
    console.log('Rendering', s.name, 'minute', (runner.sim.tick / 1200).toFixed(2), 'troops', army.length, 'city', cityEntities.length);
    const startTick = runner.sim.tick;
    await page.evaluate(
      ({ s, data }) => {
        window.filmNow += 3000;
        match().clock.offset = null;
        match().onSnapshot(Uint8Array.from(data).buffer);
        window.filmShot = { ...s, started: window.filmNow };
        window.encoded = [];
        window.encodeError = null;
        window.encodedFrames = 0;
        window.encoder = new VideoEncoder({
          output: (chunk) => {
            const b = new Uint8Array(chunk.byteLength);
            chunk.copyTo(b);
            window.encoded.push(b);
            window.encodedFrames++;
          },
          error: (e) => (window.encodeError = e.message),
        });
        window.encoder.configure(window.encodeConfig);
        window.localFrame = 0;
      },
      { s, data: packet(true) },
    );
    for (let frame = 0; frame < s.seconds * 60; frame += 3) {
      advanceOne();
      const data = packet();
      await page.evaluate(
        async ({ data, frame }) => {
          const m = match();
          m.onSnapshot(Uint8Array.from(data).buffer);
          for (let k = 0; k < 3; k++) {
            const f = frame + k;
            window.filmNow += 1000 / 60;
            const s = window.filmShot,
              t = f / 60;
            const c = world.camera.camera;
            const x = s.x + Math.sin(t * 0.23) * 1.6,
              y = s.y + t * 0.2;
            world.camera.target.x = x;
            world.camera.target.y = y;
            c.target.set(x, world.terrain.heightAt(x, y) + 0.8, -y);
            c.radius = s.radius - t * 0.38;
            c.beta = s.beta;
            c.alpha = s.alpha + t * s.turn;
            world.engine.beginFrame();
            world.scene.render();
            const image = new VideoFrame(document.querySelector('#game-canvas'), {
              timestamp: Math.round((f * 1000000) / 60),
              duration: Math.round(1000000 / 60),
            });
            window.encoder.encode(image, { keyFrame: f % 120 === 0 });
            image.close();
            world.engine.endFrame();
          }
          if (frame % 30 === 27) await window.encoder.flush();
          if (window.encodeError) throw new Error(window.encodeError);
        },
        { data, frame },
      );
      if (frame === 60) await page.screenshot({ path: `${source}/${s.name}.jpg` });
    }
    const result = await page.evaluate(async () => {
      await window.encoder.flush();
      window.encoder.close();
      const blob = new Blob(window.encoded, { type: 'video/h264' });
      const base64 = await new Promise((r) => {
        const f = new FileReader();
        f.onload = () => r(f.result.split(',')[1]);
        f.readAsDataURL(blob);
      });
      return { base64, frames: window.encodedFrames, visible: world.renderStats.visible, total: world.units.size };
    });
    if (result.frames !== s.seconds * 60) throw new Error(`Dropped frames: ${s.name} ${result.frames}`);
    await writeFile(`${source}/${s.name}.h264`, Buffer.from(result.base64, 'base64'));
    report.push({
      ...s,
      startTick,
      endTick: runner.sim.tick,
      frames: result.frames,
      visible: result.visible,
      total: result.total,
      nearbyArmy: army.length,
      cityBuildings: cityEntities.length,
    });
    await writeFile(
      `${source}/capture.json`,
      JSON.stringify(
        {
          fps: 60,
          method:
            'Each frame rendered and encoded at an explicit 1/60-second game clock step. No repeated frames or optical interpolation.',
          seed: scout.seed,
          shots: report,
        },
        null,
        2,
      ),
    );
    console.log('Saved', s.name, result.frames, 'frames');
  }
} finally {
  await browser?.close();
  try {
    process.kill(-vite.pid, 'SIGTERM');
  } catch {
    /* Vite already stopped. */
  }
  await server.close();
}
process.exit(0);
