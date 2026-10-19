// Dev page (open /dev/atlas.html with `pnpm dev`): shows every generated 2D asset.
// Tiles are shown 4 x 4 so seams are easy to see. Images with a _team mask are shown in 4 team colors.

const TEAM_COLORS = ['#D42A2A', '#2A5BD4', '#1FB5A8', '#7B2FBF'];
const TILE_NAMES = /^(wood_dark|stone_dark|parchment|iron_plate)$/;

const uiImages = import.meta.glob('../assets/ui/*.webp', { eager: true, query: '?url', import: 'default' }) as Record<string, string>;

interface ManifestFile {
  path: string;
  bytes: number;
  hash: string;
  group: string;
}

document.head.insertAdjacentHTML(
  'beforeend',
  `<style>
    body { margin: 0; padding: 20px; background: #1d1a16; color: #eee; font: 14px system-ui, sans-serif; }
    h2 { margin: 28px 0 10px; font-weight: 600; color: #f0d58a; }
    .grid { display: flex; flex-wrap: wrap; gap: 14px; }
    .card { background: repeating-conic-gradient(#3a3a3a 0 25%, #2c2c2c 0 50%) 0 0 / 16px 16px; padding: 8px; border-radius: 6px; width: 220px; }
    .card img, .card canvas { display: block; max-width: 100%; max-height: 180px; margin: auto; image-rendering: auto; }
    .card .name { margin-top: 6px; font: 12px ui-monospace, monospace; color: #ddd; background: #0008; padding: 2px 4px; border-radius: 3px; }
    .repeat { width: 204px; height: 204px; background-size: 51px 51px; }
    .teams { display: grid; grid-template-columns: repeat(2, 1fr); gap: 4px; }
  </style>`,
);

function card(name: string, ...content: HTMLElement[]): HTMLElement {
  const div = document.createElement('div');
  div.className = 'card';
  div.append(...content);
  const label = document.createElement('div');
  label.className = 'name';
  label.textContent = name;
  div.append(label);
  return div;
}

function img(src: string): HTMLImageElement {
  const i = new Image();
  i.src = src;
  return i;
}

function repeatBox(src: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'repeat';
  d.style.backgroundImage = `url(${src})`;
  return d;
}

/** Color image + grey mask -> the team-colored image (like the shader will do). */
async function tinted(src: string, maskSrc: string, color: string): Promise<HTMLCanvasElement> {
  const [a, b] = await Promise.all(
    [src, maskSrc].map((s) =>
      img(s)
        .decode()
        .then(() => s),
    ),
  );
  const base = img(a!),
    mask = img(b!);
  await Promise.all([base.decode(), mask.decode()]);
  const c = document.createElement('canvas');
  c.width = base.naturalWidth;
  c.height = base.naturalHeight;
  const ctx = c.getContext('2d')!;
  ctx.drawImage(base, 0, 0);
  const tint = document.createElement('canvas');
  tint.width = c.width;
  tint.height = c.height;
  const t = tint.getContext('2d')!;
  t.drawImage(mask, 0, 0, c.width, c.height);
  t.globalCompositeOperation = 'source-in';
  t.fillStyle = color;
  t.fillRect(0, 0, c.width, c.height);
  // Multiply the team color over the grey shading only where the mask is white.
  const shade = ctx.getImageData(0, 0, c.width, c.height);
  const col = t.getImageData(0, 0, c.width, c.height);
  const m = document.createElement('canvas').getContext('2d')!;
  m.canvas.width = c.width;
  m.canvas.height = c.height;
  m.drawImage(mask, 0, 0, c.width, c.height);
  const md = m.getImageData(0, 0, c.width, c.height).data;
  for (let i = 0; i < shade.data.length; i += 4) {
    const k = md[i]! / 255;
    for (let j = 0; j < 3; j++)
      shade.data[i + j] = shade.data[i + j]! * (1 - k) + ((shade.data[i + j]! * col.data[i + j]!) / 255) * 1.6 * k;
  }
  ctx.putImageData(shade, 0, 0);
  return c;
}

async function section(title: string, entries: [string, string][], isTile: (name: string) => boolean): Promise<void> {
  if (!entries.length) return;
  const h = document.createElement('h2');
  h.textContent = `${title} (${entries.length})`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  document.body.append(h, grid);
  const masks = new Map(entries.filter(([n]) => n.endsWith('_team')).map(([n, s]) => [n.replace(/_team$/, ''), s]));
  for (const [name, src] of entries) {
    if (name.endsWith('_team')) continue;
    if (isTile(name)) grid.append(card(`${name} (4×4)`, repeatBox(src)));
    else grid.append(card(name, img(src)));
    const mask = masks.get(name);
    if (mask) {
      const box = document.createElement('div');
      box.className = 'teams';
      for (const color of TEAM_COLORS) box.append(await tinted(src, mask, color));
      grid.append(card(`${name} — team colors`, box));
    }
  }
}

const nameOf = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.(webp|png)$/, '');

await section(
  'Interface (client/src/assets/ui)',
  Object.entries(uiImages).map(([p, url]) => [nameOf(p), url]),
  (n) => TILE_NAMES.test(n),
);

try {
  const manifest = (await (await fetch('/assets/manifest.json')).json()) as { files: ManifestFile[] };
  const byFolder = new Map<string, [string, string][]>();
  for (const f of manifest.files.filter((f) => /\.(webp|png)$/.test(f.path))) {
    const folder = f.path.split('/')[0]!;
    byFolder.set(folder, [...(byFolder.get(folder) ?? []), [nameOf(f.path), `/assets/${f.path}?v=${f.hash}`]]);
  }
  for (const [folder, entries] of byFolder) await section(`Game: ${folder}`, entries, () => folder === 'terrain' || folder === 'materials');
} catch {
  // No game assets yet.
}
