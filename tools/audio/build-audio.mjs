// Builds the game sounds: art/raw/audio/* -> client/public/assets/audio/*.ogg (Ogg Opus) and
// client/public/assets/audio/audio.json (what the client loads). Needs ffmpeg with libopus.
// Usage: pnpm --filter @game/tools audio:build

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const raw = join(root, 'art', 'raw', 'audio');
const out = join(root, 'client', 'public', 'assets', 'audio');
const list = JSON.parse(readFileSync(join(here, 'sounds.json'), 'utf8'));

/** "a_00{0-4}.ogg" -> a_000.ogg ... a_004.ogg */
function expand(pattern) {
  const m = pattern.match(/\{(\d+)-(\d+)\}/);
  if (!m) return [pattern];
  const files = [];
  for (let i = Number(m[1]); i <= Number(m[2]); i++) files.push(pattern.replace(m[0], String(i)));
  return files;
}

function opus(src, dst, { mono, kbps, maxSec }) {
  const args = ['-v', 'error', '-y', '-i', src];
  if (maxSec) args.push('-t', String(maxSec), '-af', `afade=t=out:st=${Math.max(0, maxSec - 0.25)}:d=0.25`);
  args.push('-ac', mono ? '1' : '2', '-ar', '48000', '-c:a', 'libopus', '-b:a', `${kbps}k`, '-vbr', 'on', dst);
  execFileSync('ffmpeg', args);
}

if (!existsSync(raw)) {
  console.error(`No ${raw}: download the files listed in tools/audio/sources.json first.`);
  process.exit(1);
}
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
const manifest = { sounds: {}, music: {} };
let bytes = 0;
for (const [id, def] of Object.entries(list.sounds)) {
  const files = def.files.flatMap(expand);
  manifest.sounds[id] = { files: [], volume: def.volume ?? 1 };
  files.forEach((f, i) => {
    const name = `${id}_${i}.ogg`;
    opus(join(raw, f), join(out, name), { mono: true, kbps: 40, maxSec: def.maxSec });
    bytes += statSync(join(out, name)).size;
    manifest.sounds[id].files.push(`audio/${name}`);
  });
}
for (const [id, def] of Object.entries(list.music)) {
  const name = `music_${id}.ogg`;
  opus(join(raw, def.file), join(out, name), { mono: false, kbps: 80 });
  bytes += statSync(join(out, name)).size;
  manifest.music[id] = { file: `audio/${name}`, volume: def.volume ?? 1 };
}
writeFileSync(join(out, 'audio.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(
  `Audio: ${Object.keys(manifest.sounds).length} sounds, ${Object.keys(manifest.music).length} music, ${(bytes / 1024).toFixed(0)} KB`,
);
