// Downloads files with byte progress, grouped for the lobby loading panel.
// Phase 5 extends this with the asset manifest, caching and more groups.

export type LoadGroup = 'Interface' | 'Map' | 'Shaders';

export interface LoadItem {
  group: LoadGroup;
  url: string;
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

  onProgress(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state());
    return () => this.listeners.delete(fn);
  }

  state(): LoadState {
    const fileFraction = this.bytesTotal > 0 ? this.bytesLoaded / this.bytesTotal : 1;
    const steps = 1 + this.extraSteps;
    const order: LoadGroup[] = ['Interface', 'Map', 'Shaders'];
    const groups = [...this.groups.values()].sort((a, b) => order.indexOf(a.group) - order.indexOf(b.group));
    return { groups, fraction: (fileFraction + this.extraDone) / steps };
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

  async loadAll(items: LoadItem[]): Promise<ArrayBuffer[]> {
    for (const item of items) {
      const g = this.groups.get(item.group) ?? { group: item.group, done: 0, total: 0 };
      g.total++;
      this.groups.set(item.group, g);
    }
    this.emit();
    const results: ArrayBuffer[] = new Array(items.length);
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next++;
        const item = items[index]!;
        results[index] = await this.fetchWithRetry(item.url);
        this.groups.get(item.group)!.done++;
        this.emit();
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, items.length) }, worker));
    return results;
  }

  private async fetchWithRetry(url: string): Promise<ArrayBuffer> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await this.fetchWithProgress(url);
      } catch (err) {
        if (attempt + 1 >= RETRIES) throw err;
        await new Promise((r) => setTimeout(r, 500 * 2 ** attempt));
      }
    }
  }

  private async fetchWithProgress(url: string): Promise<ArrayBuffer> {
    const res = await fetch(url);
    if (!res.ok || !res.body) throw new Error(`Download failed: ${url} (${res.status})`);
    const size = Number(res.headers.get('content-length') ?? 0);
    this.bytesTotal += size;
    const reader = res.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      received += value.byteLength;
      if (size) this.bytesLoaded += value.byteLength;
      this.emit();
    }
    if (!size) {
      // No size header (compressed in dev): count the file when it is complete.
      this.bytesTotal += received;
      this.bytesLoaded += received;
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out.buffer;
  }

  private emit(): void {
    const s = this.state();
    for (const fn of this.listeners) fn(s);
  }
}
