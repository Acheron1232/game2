// Damage numbers and gold pop-ups that float up over units and fade. A fixed pool of DOM nodes
// (no new nodes per hit), placed every frame from the 3D position.
// Phase 9 may move them to instanced quads with a number atlas; this is enough to read fights.

const POOL = 48;
const LIFE_MS = 900;

interface Item {
  node: HTMLDivElement;
  active: boolean;
  born: number;
  x: number;
  y: number;
  up: number;
}

export class FloatingText {
  private readonly items: Item[] = [];
  private readonly pt = { x: 0, y: 0 };

  constructor(host: HTMLElement) {
    const layer = document.createElement('div');
    layer.className = 'floating-layer';
    host.append(layer);
    for (let i = 0; i < POOL; i++) {
      const node = document.createElement('div');
      node.className = 'float-text';
      node.hidden = true;
      layer.append(node);
      this.items.push({ node, active: false, born: 0, x: 0, y: 0, up: 0 });
    }
  }

  /** kind: CSS class (damage, hurt, heal, gold). */
  /** settings: damage numbers on/off (gold and level-up texts stay) */
  damageNumbers = true;

  show(text: string, kind: string, x: number, y: number, up: number): void {
    if (!this.damageNumbers && (kind === 'damage' || kind === 'hurt' || kind === 'spell' || kind === 'heal')) return;
    // Reuse the oldest one when all are busy.
    let item = this.items.find((i) => !i.active);
    if (!item) item = this.items.reduce((a, b) => (a.born < b.born ? a : b));
    item.active = true;
    item.born = performance.now();
    item.x = x + (Math.random() - 0.5) * 0.6;
    item.y = y;
    item.up = up;
    item.node.textContent = text;
    item.node.className = `float-text ${kind}`;
    item.node.hidden = false;
  }

  update(project: (x: number, y: number, up: number, out: { x: number; y: number }) => boolean): void {
    const now = performance.now();
    for (const i of this.items) {
      if (!i.active) continue;
      const t = (now - i.born) / LIFE_MS;
      if (t >= 1 || !project(i.x, i.y, i.up + t * 1.2, this.pt)) {
        i.active = false;
        i.node.hidden = true;
        continue;
      }
      i.node.style.transform = `translate(${this.pt.x}px, ${this.pt.y}px) translate(-50%, -50%)`;
      i.node.style.opacity = String(t < 0.6 ? 1 : 1 - (t - 0.6) / 0.4);
    }
  }

  clear(): void {
    for (const item of this.items) {
      item.active = false;
      item.node.hidden = true;
    }
  }
}
