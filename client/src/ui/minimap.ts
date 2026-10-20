// Minimap in the HUD: the ground is drawn once from the terrain grid, units are dots drawn a few
// times per second, and a box shows what the camera sees. Left click moves the camera there,
// right click sends the hero there.

import { GROUND_TYPES, TerrainFlag, type MapLayout, type TerrainGrid } from '@game/shared';
import { buildFogOverlayPixels, type FogGrid } from '../render/fog';
import { GROUND_COLORS } from '../render/terrain-colors';

export interface MinimapDot {
  x: number;
  y: number;
  color: string;
  size: number;
}

export class Minimap {
  readonly canvas: HTMLCanvasElement;
  private readonly base: HTMLCanvasElement;
  private readonly fogOverlay: HTMLCanvasElement;
  private readonly size: number;
  private fogState: Uint8Array | null = null;
  private fogPixels: ImageData | null = null;
  private hasFog = false;

  constructor(
    host: HTMLElement,
    grid: TerrainGrid,
    layout: MapLayout,
    private readonly onLook: (x: number, y: number) => void,
    private readonly onOrder: (x: number, y: number) => void,
  ) {
    this.size = grid.cols * grid.cellSize;
    const px = 192;
    this.base = document.createElement('canvas');
    this.base.width = this.base.height = px;
    this.fogOverlay = document.createElement('canvas');
    const ctx = this.base.getContext('2d')!;
    const img = ctx.createImageData(px, px);
    for (let py = 0; py < px; py++) {
      for (let pxx = 0; pxx < px; pxx++) {
        const gx = ((pxx + 0.5) / px) * this.size,
          gy = this.size - ((py + 0.5) / px) * this.size;
        const i = Math.floor(gy / grid.cellSize) * grid.cols + Math.floor(gx / grid.cellSize);
        const g = GROUND_TYPES[grid.ground[i] ?? 0] ?? 'grass';
        let [r, gg, b] = GROUND_COLORS[g];
        const f = grid.flags[i] ?? 0;
        if (f & TerrainFlag.Forest) [r, gg, b] = [28, 62, 30];
        if (f & TerrainFlag.High) [r, gg, b] = [r * 1.12, gg * 1.12, b * 1.12];
        const o = (py * px + pxx) * 4;
        img.data.set([r, gg, b, 255], o);
      }
    }
    ctx.putImageData(img, 0, 0);
    // Gold mines and shops never move: draw them into the base picture.
    const toPx = (x: number, y: number) => [(x / this.size) * px, (1 - y / this.size) * px] as const;
    ctx.fillStyle = '#f2c615';
    for (const m of layout.goldMines) {
      const [x, y] = toPx(m.pos[0], m.pos[1]);
      ctx.fillRect(x - 2, y - 2, 4, 4);
    }
    ctx.fillStyle = '#ffffff';
    for (const s of layout.shops) {
      const [x, y] = toPx(s.pos[0], s.pos[1]);
      ctx.fillRect(x - 1.5, y - 1.5, 3, 3);
    }

    this.canvas = document.createElement('canvas');
    this.canvas.width = this.canvas.height = px;
    this.canvas.className = 'minimap-canvas';
    host.replaceChildren(this.canvas);
    const toGame = (e: MouseEvent) => {
      const r = this.canvas.getBoundingClientRect();
      return [((e.clientX - r.left) / r.width) * this.size, (1 - (e.clientY - r.top) / r.height) * this.size] as const;
    };
    let dragging = false;
    this.canvas.addEventListener('pointerdown', (e) => {
      const [x, y] = toGame(e);
      if (e.button === 0) {
        dragging = true;
        this.onLook(x, y);
      } else if (e.button === 2) this.onOrder(x, y);
    });
    this.canvas.addEventListener('pointermove', (e) => dragging && this.onLook(...toGame(e)));
    window.addEventListener('pointerup', () => (dragging = false));
    window.addEventListener('pointercancel', () => (dragging = false));
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  setFog(grid: FogGrid | null): void {
    if (!grid) {
      this.hasFog = false;
      return;
    }
    const cells = grid.cols * grid.cols;
    if (grid.visible.length < cells || grid.explored.length < cells) throw new RangeError('Fog grid data is too small.');
    let changed = !this.hasFog || this.fogState?.length !== cells;
    if (!this.fogState || this.fogState.length !== cells) this.fogState = new Uint8Array(cells);
    for (let i = 0; i < cells; i++) {
      const state = grid.visible[i] ? 2 : grid.explored[i] ? 1 : 0;
      if (this.fogState[i] !== state) {
        this.fogState[i] = state;
        changed = true;
      }
    }
    this.hasFog = true;
    if (!changed) return;
    if (!this.fogPixels || this.fogOverlay.width !== grid.cols) {
      this.fogOverlay.width = this.fogOverlay.height = grid.cols;
      this.fogPixels = this.fogOverlay.getContext('2d')!.createImageData(grid.cols, grid.cols);
    }
    buildFogOverlayPixels(grid, this.fogPixels.data);
    this.fogOverlay.getContext('2d')!.putImageData(this.fogPixels, 0, 0);
  }

  draw(dots: MinimapDot[], view: { x: number; y: number; w: number; h: number }): void {
    const ctx = this.canvas.getContext('2d')!;
    const px = this.canvas.width;
    ctx.drawImage(this.base, 0, 0);
    if (this.hasFog) {
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(this.fogOverlay, 0, 0, px, px);
    }
    for (const d of dots) {
      const x = (d.x / this.size) * px,
        y = (1 - d.y / this.size) * px;
      ctx.fillStyle = '#000';
      ctx.fillRect(x - d.size / 2 - 1, y - d.size / 2 - 1, d.size + 2, d.size + 2);
      ctx.fillStyle = d.color;
      ctx.fillRect(x - d.size / 2, y - d.size / 2, d.size, d.size);
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      ((view.x - view.w / 2) / this.size) * px,
      (1 - (view.y + view.h / 2) / this.size) * px,
      (view.w / this.size) * px,
      (view.h / this.size) * px,
    );
  }
}
