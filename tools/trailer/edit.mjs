// Render title layers with the bundled game fonts, then edit the captured gameplay.
/* global document */
import { chromium } from '@playwright/test';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '../..');
const out = resolve(root, 'media/trailer');
const source = `${out}/source`;
await mkdir(source, { recursive: true });
const font = async (path) => `data:font/woff2;base64,${(await readFile(resolve(root, path))).toString('base64')}`;
const titleFont = await font('client/node_modules/@fontsource/cinzel/files/cinzel-latin-600-normal.woff2');
const bodyFont = await font('client/node_modules/@fontsource/alegreya-sans/files/alegreya-sans-latin-400-normal.woff2');
const crest = `data:image/webp;base64,${(await readFile(`${root}/client/src/assets/ui/crest.webp`)).toString('base64')}`;
const scenes = [
  {
    file: '01-temple',
    seconds: 6,
    label: 'THE BATTLE BEGINS',
    title: 'Four kingdoms.<br>One ancient temple.',
    sub: 'TEMPLE WARS · VERSION 1',
  },
  {
    file: '02-hero',
    seconds: 6,
    label: 'FIND YOUR PLAYSTYLE',
    title: 'Choose your hero.',
    sub: 'Eight heroes. Four skills. One champion to lead.',
  },
  {
    file: '03-kingdom',
    seconds: 6,
    label: 'A KINGDOM AT YOUR SIDE',
    title: 'You lead.<br>Your kingdom rises.',
    sub: 'Your AI ally builds, gathers and trains an army.',
  },
  {
    file: '04-conflict',
    seconds: 6,
    label: 'EARN YOUR POWER',
    title: 'Fight. Grow.<br>Return stronger.',
    sub: 'Clear camps. Find loot. Master your skills.',
  },
  {
    file: '05-armies',
    seconds: 6,
    label: 'HERO ACTION MEETS STRATEGY',
    title: 'Bring an army.',
    sub: 'Strengthen your kingdom. Break their defenses.',
  },
  {
    file: '06-battle',
    seconds: 8,
    label: 'EVERY KINGDOM HAS A CHAMPION',
    title: 'Make your stand.',
    sub: 'Four rival kingdoms. One battlefield.',
  },
  { file: '07-finale', seconds: 7, final: true },
];
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  for (const s of scenes) {
    await page.setContent(`<!doctype html><html><head><style>
      @font-face{font-family:Cinzel;src:url('${titleFont}')}@font-face{font-family:Alegreya;src:url('${bodyFont}')}
      *{box-sizing:border-box}html,body{margin:0;width:1920px;height:1080px;background:transparent;color:#f6edd8}
      .shade{position:absolute;inset:0;background:linear-gradient(0deg,rgba(5,10,10,.94),rgba(5,10,10,.55) 19%,transparent 61%)}
      .bars{position:absolute;inset:0;border-top:86px solid #080c0d;border-bottom:86px solid #080c0d}
      .brand{position:absolute;top:91px;left:116px;font:600 19px Cinzel;letter-spacing:5px;color:#e6d4a9;text-shadow:0 2px 5px #000}
      .counter{position:absolute;right:116px;top:94px;font:18px Alegreya;letter-spacing:4px;color:#e1d9c8}
      .copy{position:absolute;left:116px;bottom:131px;max-width:1450px;text-shadow:0 3px 30px #000}
      .label{font:22px Alegreya;letter-spacing:5px;color:#e4b96e;margin-bottom:22px;display:flex;align-items:center;gap:18px}
      .label:before{content:'';width:53px;height:1px;background:#d3ac65}
      h1{font:600 65px/1.17 Cinzel;margin:0 0 24px;letter-spacing:.5px}
      p{font:29px/1.4 Alegreya;letter-spacing:.6px;color:#e1ddd3;margin:0}
      .end{position:absolute;inset:0;background:radial-gradient(ellipse at 50% 45%,rgba(6,15,15,.62),rgba(3,8,9,.94));display:flex;flex-direction:column;align-items:center;justify-content:center;padding-top:0}
      .crest{width:114px;height:114px;object-fit:contain;filter:drop-shadow(0 0 24px #aa7a3544);margin-bottom:20px}
      .edition{font:22px Alegreya;letter-spacing:9px;color:#d6b477;margin-bottom:32px}
      .end h1{font-size:116px;letter-spacing:8px;line-height:1.05;text-align:center;margin:0;color:#e9d5a6;text-shadow:0 4px 35px #000}
      .rule{width:440px;height:1px;background:linear-gradient(90deg,transparent,#c39f5c,transparent);margin:40px 0 36px}
      .call{font:600 29px Cinzel;letter-spacing:6px;color:#fcf3dd;margin-bottom:26px}
      .end p{font-size:25px;color:#c6c7bd;letter-spacing:2px}
      .bottom{position:absolute;bottom:92px;left:0;right:0;text-align:center;font:17px Alegreya;letter-spacing:4px;color:#a8aa9c}
    </style></head><body>${s.final ? `<div class="end"><img class="crest" src="${crest}"><div class="edition">VERSION 1 · GAMEPLAY TRAILER</div><h1>TEMPLE WARS</h1><div class="rule"></div><div class="call">ENTER THE BATTLE</div><p>Fantasy RTS · 1–4 players · Play in your browser</p><div class="bottom">YOUR HERO. YOUR KINGDOM. YOUR WAR.</div></div>` : `<div class="shade"></div><div class="brand">TEMPLE WARS</div><div class="counter">VERSION 1 / GAMEPLAY</div><div class="copy"><div class="label">${s.label}</div><h1>${s.title}</h1><p>${s.sub}</p></div>`}<div class="bars"></div></body></html>`);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: `${source}/${s.file}-titles.png`, omitBackground: true });
  }
} finally {
  await browser.close();
}

function ffmpeg(args) {
  const r = spawnSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args], { encoding: 'utf8', maxBuffer: 8e6 });
  if (r.status !== 0) throw new Error(r.stderr);
}
for (const s of scenes) {
  console.log('Editing', s.file);
  const fadeOut = s.seconds - 0.18;
  ffmpeg([
    '-i',
    `${source}/${s.file}.webm`,
    '-loop',
    '1',
    '-i',
    `${source}/${s.file}-titles.png`,
    '-filter_complex',
    `[0:v]fps=30,scale=1920:1080,setsar=1,tpad=stop_mode=clone:stop_duration=2,trim=duration=${s.seconds},setpts=PTS-STARTPTS,eq=saturation=1.06:contrast=1.025[v];[v][1:v]overlay=0:0:shortest=1,fade=t=in:st=0:d=0.18,fade=t=out:st=${fadeOut}:d=0.18,format=yuv420p[out]`,
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
    '18',
    '-r',
    '30',
    `${source}/${s.file}-edit.mp4`,
  ]);
}
await writeFile(`${source}/concat.txt`, scenes.map((s) => `file '${s.file}-edit.mp4'`).join('\n') + '\n');
ffmpeg(['-f', 'concat', '-safe', '0', '-i', `${source}/concat.txt`, '-c', 'copy', `${source}/picture.mp4`]);
const audio = `${root}/client/public/assets/audio`;
ffmpeg([
  '-i',
  `${source}/picture.mp4`,
  '-i',
  `${audio}/music_battle.ogg`,
  '-i',
  `${audio}/hit_siege_0.ogg`,
  '-i',
  `${audio}/building_fall_0.ogg`,
  '-filter_complex',
  '[1:a]atrim=0:45,asetpts=PTS-STARTPTS,volume=0.8,afade=t=in:st=0:d=1.2,afade=t=out:st=41:d=4[m];[2:a]volume=0.7,asplit=4[a][b][c][d];[a]adelay=6000|6000[a1];[b]adelay=18000|18000[b1];[c]adelay=30000|30000[c1];[d]adelay=38000|38000[d1];[3:a]volume=0.35,adelay=24000|24000[e];[m][a1][b1][c1][d1][e]amix=inputs=6:duration=first:normalize=0,loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000[mix]',
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
  '45',
  '-movflags',
  '+faststart',
  `${out}/temple-wars-v1-trailer.mp4`,
]);
ffmpeg(['-ss', '41', '-i', `${out}/temple-wars-v1-trailer.mp4`, '-frames:v', '1', '-q:v', '2', `${out}/temple-wars-v1-poster.jpg`]);
await writeFile(
  `${out}/README.md`,
  `# Temple Wars — Version 1 trailer\n\n45 seconds · 1920 × 1080 · 30 FPS · H.264 / AAC · 16:9\n\nThe video uses real gameplay recorded from a separate local four-bot match, with a free camera and hidden HUD. The simulation is advanced between takes; recorded takes run at normal game speed. Titles are in English to match the game.\n\n## Files\n\n- temple-wars-v1-trailer.mp4 — final video, ready to share\n- temple-wars-v1-poster.jpg — cover image\n- source/ — gameplay takes, title layers, intermediate edits and capture metadata\n\n## Rebuild\n\nFrom the repository root, with the existing project dependencies and FFmpeg installed:\n\n\`\`\`sh\npnpm --filter @game/server exec tsx ../tools/trailer/capture.mjs\nnode tools/trailer/edit.mjs\n\`\`\`\n\nCapture uses ports 8790 and 5180 and Chromium's Metal backend on macOS. It does not edit game code or use the regular game server.\n\n## Sound and fonts\n\nBattle Theme A by cynicmusic (CC0), impact sounds by Kenney (CC0). Existing project assets; sources and licenses are recorded in docs/CREDITS.md. Cinzel and Alegreya Sans (SIL OFL 1.1), bundled with the game. Impact sounds are timed for the edit; this is not a recording of live game audio.\n`,
);
console.log('Final video:', `${out}/temple-wars-v1-trailer.mp4`);
