// Downloads every game file with byte progress, grouped for the lobby loading panel.
// Files are kept in memory as blob URLs, so Babylon later loads them with no network wait.
// The service worker (public/sw.js) also keeps them in the Cache API for the next visit.

export type LoadGroup = 'Interface' | 'Map' | 'Units' | 'Heroes' | 'Effects' | 'Sounds' | 'Shaders';

const GROUP_ORDER: LoadGroup[] = ['Interface', 'Map', 'Units', 'Heroes', 'Effects', 'Sounds', 'Shaders'];

export interface LoadItem {
  group: LoadGroup;
  url: string;
  /** Known size in bytes (from the manifest), so progress is right from the start. */
  bytes?: number;
}

export interface GroupProgress {
  group: LoadGroup;
  done: number;
  total: number;
  /** Shaders have no files: they are marked done by the caller. */
  waiting?: boolean;
}

export interface LoadState {
  groups: GroupProgress[];
  /** 0..1 for everything, by bytes where we know them. */
  fraction: number;
}

type Listener = (state: LoadState) => void;

const MAX_PARALLEL = 6;
const RETRIES = 3;

export class Loader {
  private readonly listeners = new Set<Listener>();
  private readonly groups = new Map<LoadGroup, GroupProgress>();
  private bytesLoaded = 0;
  private bytesTotal = 0;
  private extraSteps = 0;
  private extraDone = 0;
  private emitQueued = false;

  onProgress(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => this.listeners.delete(fn);
  }

  state(): LoadState {
    const fileFraction = this.bytesTotal > 0 ? Math.min(1, this.bytesLoaded / this.bytesTotal) : 1;
    // Files are 85% of the bar, the extra steps (shader compile) the last 15%.
    const extra = this.extraSteps ? this.extraDone / this.extraSteps : 1;
    const groups = [...this.groups.values()].sort((a, b) => GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group));
    return { groups, fraction: this.extraSteps ? fileFraction * 0.85 + extra * 0.15 : fileFraction };
  }

  /** A loading step without a file (like shader compiling). Call the returned function when it is done. */
  addStep(group: LoadGroup): () => void {
    this.extraSteps++;
    this.groups.set(group, { group, done: 0, total: 1, waiting: true });
    this.emit();
    return () => {
      this.extraDone++;
      this.groups.set(group, { group, done: 1, total: 1 });
      this.emit();
    };
  }

  /** Downloads all items; resolves to blob URLs in the same order. */
  async loadAll(items: LoadItem[]): Promise<string[]> {
    for (const item of items) {
      const g = this.groups.get(item.group) ?? { group: item.group, done: 0, total: 0 };
      g.total++;
      this.groups.set(item.group, g);
      this.bytesTotal += item.bytes ?? 0;
    }
    this.emit();
    const results: string[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index]!;
        const blob = await this.fetchWithRetry(item);
        results[index] = URL.createObjectURL(blob);
        this.groups.get(item.group)!.done++;
        this.emit();
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, worker));
    return results;
  }

  private async fetchWithRetry(item: LoadItem): Promise<Blob> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchWithProgress(item);
      } catch (err) {
        if (attempt + 1 >= RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  private async fetchWithProgress(item: LoadItem): Promise<Blob> {
    const res = await fetch(item.url);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${item.url} (${res.status})`);
    const known = item.bytes ?? 0;
    if (!known) this.bytesTotal += Number(res.headers.get('content-length') ?? 0);
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value as Uint8Array<ArrayBuffer>);
      received += value.byteLength;
      this.bytesLoaded += value.byteLength;
      this.emit();
    }
    // Keep the totals right if the server sent a compressed body or no size.
    if (known && received !== known) this.bytesTotal += received - known;
    return new Blob(chunks, { type: res.headers.get('content-type') ?? '' });
  }

  /** Progress updates are many per frame; send them to the UI once per frame. */
  private emit(): void {
    if (this.emitQueued) return;
    this.emitQueued = true;
    requestAnimationFrame(() => {
      this.emitQueued = false;
      const s = this.state();
      for (const fn of this.listeners) fn(s);
    });
  }
}
