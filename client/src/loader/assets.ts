// The game asset list (client/public/assets/manifest.json) -> lobby loading groups -> blob URLs.

import type { LoadGroup, LoadItem, Loader } from './loader';

interface ManifestFile {
  path: string;
  bytes: number;
  hash: string;
  group: string;
}

export interface ModelInfo {
  skin: string | null;
  height: number;
  triangles: number;
  sockets: string[];
  clips: string[];
}

export interface GameAssets {
  /** Blob URL for an asset path like "models/staff_warrior.glb". */
  url(path: string): string;
  has(path: string): boolean;
  models: Record<string, ModelInfo>;
}

/** Concept art and dev-only files are not needed in the game. */
const SKIP = /^(concept)\//;

export async function loadGameAssets(loader: Loader, extra: LoadItem[] = []): Promise<{ assets: GameAssets; extra: string[] }> {
  const manifest = (await (await fetch('/assets/manifest.json', { cache: 'no-cache' })).json()) as { files: ManifestFile[] };
  const files = manifest.files.filter((f) => !SKIP.test(f.path));
  const groupOf = (f: ManifestFile): LoadGroup => {
    if (f.path.startsWith('models/')) {
      const heroIds = [
        'staff_warrior',
        'blood_witch',
        'sky_dragon',
        'stone_golem',
        'light_healer',
        'arcane_huntress',
        'centaur_raider',
        'forest_elf',
      ];
      return heroIds.some((h) => f.path.startsWith(`models/${h}`)) ? 'Heroes' : 'Units';
    }
    return (['Interface', 'Map', 'Units', 'Heroes', 'Effects', 'Sounds'].includes(f.group) ? f.group : 'Interface') as LoadGroup;
  };
  const items: LoadItem[] = [...extra, ...files.map((f) => ({ group: groupOf(f), url: `/assets/${f.path}?v=${f.hash}`, bytes: f.bytes }))];
  const urls = await loader.loadAll(items);
  const byPath = new Map<string, string>();
  files.forEach((f, i) => byPath.set(f.path, urls[extra.length + i]!));
  const modelsUrl = byPath.get('models/models.json');
  const models = modelsUrl ? ((await (await fetch(modelsUrl)).json()) as Record<string, ModelInfo>) : {};
  return {
    assets: {
      url(path) {
        const u = byPath.get(path);
        if (!u) throw new Error(`Asset not loaded: ${path}`);
        return u;
      },
      has: (path) => byPath.has(path),
      models,
    },
    extra: urls.slice(0, extra.length),
  };
}

/** Keeps downloaded game files on disk for the next visit (Cache API). */
export function registerAssetCache(): void {
  if (!('serviceWorker' in navigator) || location.hostname === '') return;
  navigator.serviceWorker.register('/sw.js').catch(() => {
    // Not available (private window, file://): the game still works, it just downloads again.
  });
}
