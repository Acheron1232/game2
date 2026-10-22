// Cut the late-game 60 FPS takes, keeping the action clear of large text overlays.
/* global document */
import { chromium } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = `${root}/media/trailer-late60`,
  source = `${out}/source`;
const titleFont = `data:font/woff2;base64,${(await readFile(`${root}/client/node_modules/@fontsource/cinzel/files/cinzel-latin-600-normal.woff2`)).toString('base64')}`;
const bodyFont = `data:font/woff2;base64,${(await readFile(`${root}/client/node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-400-normal.woff2`)).toString('base64')}`;
const crest = `data:image/webp;base64,${(await readFile(`${root}/client/src/assets/ui/crest.webp`)).toString('base64')}`;
const scenes = [
  { id: '01-war', take: '04-crossfire', seconds: 6, title: 'War has arrived.', crop: 1.04 },
  { id: '02-kingdom', take: '01-capital', seconds: 5, title: 'Build your kingdom.' },
  { id: '03-citadel', take: '02-citadel', seconds: 4 },
  { id: '04-dragon', take: '03-dragon', seconds: 6, title: 'Lead the charge.' },
  { id: '05-siege', take: '05-siege', seconds: 7 },
  { id: '06-air', take: '06-airborne', seconds: 6 },
  { id: '07-clash', take: '07-laststand', seconds: 5, title: 'Break their lines.' },
  { id: '08-close', take: '07-laststand', seconds: 5, start: 5, crop: 1.26 },
  { id: '09-finale', take: '08-finale', seconds: 6, final: true },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const s of scenes) {
    const html = `<!doctype html><html><head><style>
      @font-face{font-family:Cinzel;src:url('${titleFont}')}@font-face{font-family:Alegreya;src:url('${bodyFont}')}
      *{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;background:transparent;color:#f9eed7}
      .bars{position:absolute;inset:0;border-top:64px solid #05090a;border-bottom:64px solid #05090a}
      .shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(3,7,8,.65),transparent 36%)}
      .copy{position:absolute;left:100px;bottom:111px;text-shadow:0 3px 22px #000}
      .copy h1{font:600 48px/1.2 Cinzel;margin:0;letter-spacing:2px}
      .copy p{font:17px Alegreya;letter-spacing:6px;color:#e6c187;margin:0 0 18px;display:flex;gap:18px;align-items:center}
      .copy p:before{content:'';height:1px;width:45px;background:#d5ad6c}
      .end{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 50%,#020809b8,#020607ed);display:flex;flex-direction:column;justify-content:center;align-items:center}
      .end img{width:115px;height:115px;object-fit:contain;filter:drop-shadow(0 0 30px #d8a33444);margin-bottom:27px}
      .edition{font:20px Alegreya;letter-spacing:9px;color:#d9b779;margin-bottom:25px}
      .end h1{font:600 112px/1.2 Cinzel;letter-spacing:8px;color:#efdbab;margin:0;text-shadow:0 4px 30px #000}
      .line{width:490px;height:1px;background:linear-gradient(90deg,transparent,#b48c43,transparent);margin:35px 0}
      .call{font:600 29px Cinzel;letter-spacing:6px;margin-bottom:22px}
      .end p{font:24px Alegreya;letter-spacing:2px;color:#d6d7cf;margin:0}
    </style></head><body>${s.final ? `<div class="end"><img src="${crest}"><div class="edition">VERSION 1</div><h1>TEMPLE WARS</h1><div class="line"></div><div class="call">YOUR KINGDOM. YOUR WAR.</div><p>Fantasy RTS · Play in your browser</p></div>` : s.title ? `<div class="shade"></div><div class="copy"><p>TEMPLE WARS</p><h1>${s.title}</h1></div>` : ''}</body></html>`;
    await page.setContent(html);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${source}/${s.id}-type.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}
function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 8e6 });
  if (r.status !== 0) throw new Error(r.stderr);
}
for (const s of scenes) {
  console.log('Editing', s.id);
  const crop = s.crop ? `crop=trunc(iw/${s.crop}/2)*2:trunc(ih/${s.crop}/2)*2,scale=1920:1080,` : '';
  const fade = s.final
    ? 'fade=t=in:st=0:d=0.7:alpha=1'
    : s.title
      ? 'fade=t=in:st=0.2:d=0.25:alpha=1,fade=t=out:st=2.9:d=0.45:alpha=1'
      : 'null';
  const ending = s.final ? `,fade=t=out:st=${s.seconds - 0.8}:d=0.8` : s.id === '01-war' ? ',fade=t=in:st=0:d=0.12' : '';
  ffmpeg([
    '-r',
    '60',
    '-i',
    `${source}/${s.take}.h264`,
    '-loop',
    '1',
    '-framerate',
    '60',
    '-i',
    `${source}/${s.id}-type.png`,
    '-filter_complex',
    `[0:v]trim=start=${s.start ?? 0}:duration=${s.seconds},setpts=N/(60*TB),${crop}setsar=1,eq=brightness=0.015:contrast=1.04:saturation=1.06[v];[1:v]format=rgba,${fade}[type];[v][type]overlay=0:0:shortest=1,drawbox=x=0:y=0:w=iw:h=64:color=0x05090a:t=fill,drawbox=x=0:y=ih-64:w=iw:h=64:color=0x05090a:t=fill${ending},format=yuv420p[out]`,
    '-map',
    '[out]',
    '-an',
    '-t',
    String(s.seconds),
    '-c:v',
    'libx264',
    '-preset',
    'fast',
    '-crf',
    '19',
    '-r',
    '60',
    '-video_track_timescale',
    '60000',
    `${source}/${s.id}-edit.mp4`,
  ]);
}
await writeFile(`${source}/late-concat.txt`, scenes.map((s) => `file '${s.id}-edit.mp4'`).join('\n') + '\n');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', `${source}/late-concat.txt`, '-c', 'copy', `${source}/late-picture.mp4`]);

// An original low drum accent, with a short noise transient and a decaying tail.
const rate = 48000,
  samples = rate * 2,
  pcm = Buffer.alloc(samples * 2);
let random = 971;
for (let i = 0; i < samples; i++) {
  const t = i / rate;
  random = (Math.imul(random, 1664525) + 1013904223) | 0;
  const n = random / 2147483648;
  const drum = Math.sin(2 * Math.PI * (34 * t + (27 * (1 - Math.exp(-t * 14))) / 14)) * Math.exp(-t * 3.6);
  const air = n * Math.exp(-t * 15) * 0.14;
  pcm.writeInt16LE(Math.round(Math.tanh((drum * 0.72 + air) * 1.2) * 26000), i * 2);
}
const wav = Buffer.alloc(44);
wav.write('RIFF');
wav.writeUInt32LE(36 + pcm.length, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(rate, 24);
wav.writeUInt32LE(rate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcm.length, 40);
await writeFile(`${source}/trailer-drum.wav`, Buffer.concat([wav, pcm]));
const cuts = [0, 6, 11, 15, 21, 28, 34, 39, 44];
const drumFilters = cuts.map((t, i) => `[d${i}]adelay=${t * 1000}|${t * 1000}[hit${i}]`).join(';');
const hits = cuts.map((_, i) => `[hit${i}]`).join('');
const audio = `${root}/client/public/assets/audio`;
ffmpeg([
  '-i',
  `${source}/late-picture.mp4`,
  '-ss',
  '18',
  '-i',
  `${audio}/music_battle.ogg`,
  '-i',
  `${source}/trailer-drum.wav`,
  '-i',
  `${audio}/hit_siege_2.ogg`,
  '-i',
  `${audio}/building_fall_1.ogg`,
  '-filter_complex',
  `[1:a]atrim=0:50,asetpts=PTS-STARTPTS,volume=.78,afade=t=in:st=0:d=0.35,afade=t=out:st=46:d=4[m];[2:a]volume=.7,asplit=${cuts.length}${cuts.map((_, i) => `[d${i}]`).join('')};${drumFilters};[3:a]volume=.55,adelay=22400|22400[siege];[4:a]volume=.35,adelay=40500|40500[fall];[m]${hits}[siege][fall]amix=inputs=${cuts.length + 3}:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=10,aresample=48000[mix]`,
  '-map',
  '0:v',
  '-map',
  '[mix]',
  '-c:v',
  'copy',
  '-c:a',
  'aac',
  '-b:a',
  '192k',
  '-t',
  '50',
  '-movflags',
  '+faststart',
  `${out}/temple-wars-late-game-60fps.mp4`,
]);
ffmpeg(['-ss', '47', '-i', `${out}/temple-wars-late-game-60fps.mp4`, '-frames:v', '1', '-q:v', '2', `${out}/poster.jpg`]);
await writeFile(
  `${out}/README.md`,
  `# Temple Wars — Late-game trailer\n\n50 seconds · 1920 × 1080 · 60 FPS · H.264 / AAC audio\n\nAll takes come from a real four-player Hard bot match, seed ${20261021}, from 15:00 through 28:51 game time. Cities reach tier 3, 22 buildings and 100 supply. Selected fights have 39–63 nearby troops, including heroes, cavalry, healers, siege and flying units. There are no extra spawned armies or changes to game rules.\n\nEvery frame is rendered independently with a 1/60-second game clock and encoded using WebCodecs. The original 20 Hz server simulation supplies a snapshot every three rendered frames, using the game's normal interpolation, spell effects and animations. The 60 FPS video does not duplicate the previous trailer's 30 FPS frames or use optical interpolation.\n\nThe HUD is hidden and a free camera is used for filming. The final edit puts the first siege before the city shots and uses two crops from the last battle.\n\n## Rebuild\n\npnpm --filter @game/server exec tsx ../tools/trailer/scout-late.mjs\n\npnpm --filter @game/server exec tsx ../tools/trailer/capture-late.mjs\n\nnode tools/trailer/edit-late.mjs\n\nCapture needs macOS / Chromium Metal, WebCodecs H.264 and free ports 8790 and 5180. Editing needs FFmpeg. Original trailer and sources remain in media/trailer.\n\n## Audio and fonts\n\nBattle Theme A — cynicmusic, CC0. Impact and building sounds — Kenney, CC0. Cinzel and Alegreya Sans — SIL OFL 1.1. Existing project assets and their licenses are listed in docs/CREDITS.md. The low drum accents are synthesized in edit-late.mjs. Audio is a trailer mix, not a live game audio recording.\n`,
);
console.log('Finished', `${out}/temple-wars-late-game-60fps.mp4`);
