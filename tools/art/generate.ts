// Generates one sheet image with Codex (ChatGPT image generation).
//   pnpm art:gen <sheetId>          make the image -> art/raw/<sheetId>.png
//   pnpm art:gen <sheetId> --dry    only print the full prompt (costs nothing)
// Every real call is logged in tools/art/generation-log.md. Codex usage is limited: think before you run it.

import { spawnSync } from 'node:child_process';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, relative } from 'node:path';
import { gameData } from '@game/shared';
import { ART_DIR, findSheet, ROOT } from './lib/sheets';

const [sheetId, ...flags] = process.argv.slice(2);
if (!sheetId) {
  console.error('Usage: pnpm art:gen <sheetId> [--dry]');
  process.exit(1);
}
const sheet = findSheet(sheetId);
const dry = flags.includes('--dry');

function buildPrompt(): string {
  const style = readFileSync(join(ART_DIR, 'prompts', '_style.md'), 'utf8').replace(/<!--[\s\S]*?-->\s*/g, '');
  let body = readFileSync(join(ART_DIR, 'prompts', sheet.prompt), 'utf8');
  // {heroA}, {heroA.look} come from promptVars + heroes.json, so prompts stay in sync with the design.
  for (const [key, heroId] of Object.entries(sheet.promptVars ?? {})) {
    const hero = gameData.heroes.find((h) => h.id === heroId);
    if (!hero) throw new Error(`promptVars.${key}: unknown hero ${heroId}`);
    const look = `${hero.look.silhouette} Colors: ${hero.look.palette} Team color parts: ${hero.look.teamColorParts}`;
    body = body.replaceAll(`{${key}.look}`, look).replaceAll(`{${key}}`, hero.name);
  }
  // {hero_id.look} anywhere in a prompt is the hero's look from heroes.json.
  for (const hero of gameData.heroes) {
    const look = `${hero.look.silhouette} Colors: ${hero.look.palette} Team color parts: ${hero.look.teamColorParts}`;
    body = body.replaceAll(`{${hero.id}.look}`, look);
  }
  if (/\{[a-zA-Z_.]+\}/.test(body)) throw new Error(`Prompt ${sheet.prompt} still has a {placeholder}`);
  const shape = sheet.aspect === 'landscape' ? 'a wide landscape image (3:2)' : 'a square image (1:1)';
  return `${style.trim()}\n\nMake ${shape}.\n\n${body.trim()}`;
}

const prompt = buildPrompt();
if (dry) {
  console.log(prompt);
  console.log(`\n(${prompt.length} characters, grid ${sheet.grid.join(' x ')}, ${sheet.cells.length} cells)`);
  process.exit(0);
}

const rawDir = join(ROOT, 'art', 'raw');
mkdirSync(rawDir, { recursive: true });
mkdirSync(join(ART_DIR, 'logs'), { recursive: true });
const target = join(rawDir, `${sheet.id}.png`);
const started = Date.now();
// The user's default Codex model is refused for image calls on a ChatGPT account, and newer ones need a newer CLI.
// This one works with Codex CLI 0.149. Override with CODEX_MODEL=... if needed.
const model = process.env['CODEX_MODEL'] ?? 'gpt-5.6-sol';

const instruction =
  `Use your image generation tool to create exactly one image from the prompt below. Do not change the prompt. ` +
  `Do not write any code. When the image is ready, save it as a PNG file at ${relative(ROOT, target)} and stop.\n\nPROMPT:\n${prompt}`;

console.log(`Generating ${sheet.id} with Codex (this can take a few minutes)...`);
const run = spawnSync(
  'codex',
  ['exec', '-m', model, '--skip-git-repo-check', '-s', 'workspace-write', '-C', ROOT, '-o', join(ART_DIR, 'logs', `${sheet.id}.txt`), instruction],
  { stdio: ['ignore', 'inherit', 'inherit'], timeout: 15 * 60 * 1000 },
);
if (run.status !== 0) console.warn(`codex exited with status ${run.status}`);

// Codex may not copy the file itself; then take the newest image it made after we started.
if (!existsSync(target) || statSync(target).mtimeMs < started) {
  const base = join(homedir(), '.codex', 'generated_images');
  const newest = existsSync(base)
    ? readdirSync(base)
        .flatMap((dir) => {
          const full = join(base, dir);
          return statSync(full).isDirectory() ? readdirSync(full).map((f) => join(full, f)) : [];
        })
        .filter((f) => f.endsWith('.png') && statSync(f).mtimeMs >= started)
        .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0]
    : undefined;
  if (!newest) {
    console.error('No image was made. Check tools/art/logs/' + sheet.id + '.txt');
    process.exit(1);
  }
  copyFileSync(newest, target);
}

const seconds = Math.round((Date.now() - started) / 1000);
appendFileSync(
  join(ART_DIR, 'generation-log.md'),
  `\n## ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC — ${sheet.id}\n- Output: \`${relative(ROOT, target)}\` (${Math.round(statSync(target).size / 1024)} KB, ${seconds} s)\n- Prompt file: \`tools/art/prompts/${sheet.prompt}\`${sheet.promptVars ? ` with ${JSON.stringify(sheet.promptVars)}` : ''}\n`,
);
console.log(`Saved ${relative(ROOT, target)} in ${seconds} s. Next: pnpm art:process ${sheet.id}`);
