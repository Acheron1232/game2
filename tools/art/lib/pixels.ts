// Pixel work on raw RGBA buffers: grid finding, green key-out, team-color mask, seamless tiles.

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const lum = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** A grid line pixel: dark and grey (the prompt asks for #202020 lines). */
function isLinePixel(d: Uint8ClampedArray, i: number): boolean {
  const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
  // Codex sometimes paints a transparent background; transparent black is not a line.
  // Pure black is not a line either (effect sheets use a black background).
  const l = lum(r, g, b);
  return d[i + 3]! > 200 && l > 14 && l < 60 && Math.max(r, g, b) - Math.min(r, g, b) < 30;
}

/**
 * Finds the cell rectangles. Image models do not draw perfect grids, so for each expected
 * line we look near its ideal place for the darkest straight row / column, and fall back
 * to an even split if there is no clear line.
 */
export function findCells(img: Rgba, cols: number, rows: number): Rect[] {
  const { data, width: w, height: h } = img;
  const colDark = new Float32Array(w);
  const rowDark = new Float32Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (isLinePixel(data, (y * w + x) * 4)) {
        colDark[x]! += 1 / h;
        rowDark[y]! += 1 / w;
      }
    }
  }
  const cuts = (dark: Float32Array, size: number, count: number): [number, number][] => {
    // Returns [start, end) of the line band at each boundary 0..count.
    // A real line is much darker-and-greyer than the rows right next to it. Dark art (portraits,
    // black effect cells) is dark everywhere, so we look at the contrast, not the darkness alone.
    const bands: [number, number][] = [];
    const maxBand = Math.max(3, Math.round(size * 0.012));
    for (let i = 0; i <= count; i++) {
      const ideal = Math.round((i * size) / count);
      const win = Math.round(size * 0.045);
      const lo = Math.max(0, ideal - win), hi = Math.min(size - 1, ideal + win);
      const around: number[] = [];
      for (let p = lo; p <= hi; p++) around.push(dark[p]!);
      around.sort((a, b) => a - b);
      const typical = around[Math.floor(around.length / 2)] ?? 0;
      let best = -1, bestScore = 0.35;
      for (let p = lo; p <= hi; p++) {
        const score = dark[p]! - typical;
        if (score > bestScore) { bestScore = score; best = p; }
      }
      if (best < 0) { bands.push([ideal, ideal]); continue; }
      const edge = typical + bestScore * 0.5;
      let a = best, b = best;
      while (a > 0 && best - a < maxBand && dark[a - 1]! > edge) a--;
      while (b < size - 1 && b - best < maxBand && dark[b + 1]! > edge) b++;
      bands.push([a, b + 1]);
    }
    return bands;
  };
  const xb = cuts(colDark, w, cols);
  const yb = cuts(rowDark, h, rows);
  const rects: Rect[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x0 = xb[c]![1], x1 = xb[c + 1]![0];
      const y0 = yb[r]![1], y1 = yb[r + 1]![0];
      // Small extra inset so soft line edges do not stay in the cell.
      const ix = Math.round((x1 - x0) * 0.012) + 1, iy = Math.round((y1 - y0) * 0.012) + 1;
      rects.push({ x: x0 + ix, y: y0 + iy, w: Math.max(1, x1 - x0 - 2 * ix), h: Math.max(1, y1 - y0 - 2 * iy) });
    }
  }
  return rects;
}

export function crop(img: Rgba, r: Rect): Rgba {
  const out = new Uint8ClampedArray(r.w * r.h * 4);
  for (let y = 0; y < r.h; y++) {
    const src = ((r.y + y) * img.width + r.x) * 4;
    out.set(img.data.subarray(src, src + r.w * 4), y * r.w * 4);
  }
  return { data: out, width: r.w, height: r.h };
}

/** True when the image already has a real transparent background (Codex often does this). */
export function hasTransparency(img: Rgba): boolean {
  let clear = 0;
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! < 20) clear++;
  return clear > (img.data.length / 4) * 0.05;
}

/**
 * Pure green background -> transparent, with soft edges and green spill removed.
 * edgesOnly: the background is already transparent, so only clean the half-transparent
 * fringe and keep opaque green things (a green arrow, a green check mark, leaves).
 */
export function keyOutGreen(img: Rgba, edgesOnly = false): Rgba {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    if (edgesOnly && d[i + 3]! > 200) continue;
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    const spill = g - Math.max(r, b);
    if (spill > 70 && g > 110) {
      d[i + 3] = 0;
    } else if (spill > 25) {
      d[i + 3] = Math.round(d[i + 3]! * Math.min(1, (70 - spill) / 45));
      d[i + 1] = Math.max(r, b); // remove green fringe
    }
  }
  return { ...img, data: d };
}

/** Black background -> alpha from brightness (for glow effects). */
export function alphaFromBrightness(img: Rgba): Rgba {
  const d = new Uint8ClampedArray(img.data);
  for (let i = 0; i < d.length; i += 4) {
    const m = Math.max(d[i]!, d[i + 1]!, d[i + 2]!);
    d[i + 3] = m < 12 ? 0 : m;
  }
  return { ...img, data: d };
}

/**
 * Magenta team color -> grey shading in the color image + a separate mask.
 * Returns null for the mask if there was almost no magenta.
 */
export function splitTeamColor(img: Rgba): { color: Rgba; mask: Rgba | null } {
  const d = new Uint8ClampedArray(img.data);
  const m = new Uint8ClampedArray(img.width * img.height * 4);
  let count = 0;
  for (let i = 0, p = 0; i < d.length; i += 4, p += 4) {
    const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
    // Magenta by hue, so dark folds and bright highlights both count: red and blue high
    // together, green clearly lower, and not too dark to tell.
    const hi = Math.max(r, b), lo = Math.min(r, b);
    const magenta = hi > 45 && lo > g * 1.5 + 12 && Math.abs(r - b) < hi * 0.45;
    if (magenta && d[i + 3]! > 0) {
      count++;
      // Keep the painted light and dark as grey, so the shader can tint it.
      const shade = Math.min(255, Math.round(((r + b) / 2) * 1.05));
      d[i] = d[i + 1] = d[i + 2] = shade;
      // White and opaque where the team color goes, transparent elsewhere:
      // works as a CSS mask (alpha) and as a shader mask (red channel).
      m[p] = m[p + 1] = m[p + 2] = m[p + 3] = 255;
    }
  }
  const enough = count > img.width * img.height * 0.002;
  return { color: { ...img, data: d }, mask: enough ? { data: m, width: img.width, height: img.height } : null };
}

/** Bounding box of pixels with alpha above a threshold, with padding. */
export function opaqueBounds(img: Rgba, pad = 2): Rect | null {
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > 10) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  if (x1 < 0) return null;
  x0 = Math.max(0, x0 - pad);
  y0 = Math.max(0, y0 - pad);
  x1 = Math.min(img.width - 1, x1 + pad);
  y1 = Math.min(img.height - 1, y1 + pad);
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/**
 * Makes a texture tile without seams: blend the image with copies shifted by half,
 * so every edge comes from the (continuous) middle of the picture.
 */
export function makeSeamless(img: Rgba, margin = 0.22): Rgba {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data.length);
  const weight = (t: number) => {
    // 0 at the edge, 1 after `margin` of the size, smooth in between.
    const e = Math.min(t, 1 - t) / margin;
    const k = Math.min(1, Math.max(0, e));
    return k * k * (3 - 2 * k);
  };
  const hw = Math.floor(w / 2), hh = Math.floor(h / 2);
  for (let y = 0; y < h; y++) {
    const wy = weight((y + 0.5) / h);
    const ys = (y + hh) % h;
    for (let x = 0; x < w; x++) {
      const wx = weight((x + 0.5) / w);
      const xs = (x + hw) % w;
      const a = wx * wy, bx = (1 - wx) * wy, by = wx * (1 - wy), bxy = (1 - wx) * (1 - wy);
      const i0 = (y * w + x) * 4, i1 = (y * w + xs) * 4, i2 = (ys * w + x) * 4, i3 = (ys * w + xs) * 4;
      for (let k = 0; k < 4; k++) out[i0 + k] = data[i0 + k]! * a + data[i1 + k]! * bx + data[i2 + k]! * by + data[i3 + k]! * bxy;
    }
  }
  return { ...img, data: out };
}

/** Largest difference between opposite edges, 0..255. Small means it tiles well. */
export function seamScore(img: Rgba): number {
  const { width: w, height: h, data } = img;
  let total = 0, n = 0;
  for (let y = 0; y < h; y++) {
    for (let k = 0; k < 3; k++) total += Math.abs(data[(y * w) * 4 + k]! - data[(y * w + w - 1) * 4 + k]!);
    n += 3;
  }
  for (let x = 0; x < w; x++) {
    for (let k = 0; k < 3; k++) total += Math.abs(data[x * 4 + k]! - data[((h - 1) * w + x) * 4 + k]!);
    n += 3;
  }
  return total / n;
}

/** Removes leftover grid-line pixels (dark grey, opaque) in a thin band along the cell border. */
export function clearBorderLines(img: Rgba, band = 0.05): Rgba {
  const d = new Uint8ClampedArray(img.data);
  const bw = Math.max(2, Math.round(img.width * band)), bh = Math.max(2, Math.round(img.height * band));
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (x >= bw && x < img.width - bw && y >= bh && y < img.height - bh) continue;
      const i = (y * img.width + x) * 4;
      const r = d[i]!, g = d[i + 1]!, b = d[i + 2]!;
      // Line remains are dark grey, often half transparent after the model's own cut-out.
      if (lum(r, g, b) < 75 && Math.max(r, g, b) - Math.min(r, g, b) < 35) d[i + 3] = 0;
    }
  }
  return { ...img, data: d };
}

/**
 * Removes a flat background by its real color, sampled from the cell border.
 * Safer than "remove all green": green leaves and armor stay, only the backdrop goes.
 * Returns the image unchanged if the border is not one flat color.
 */
export function keyOutBackground(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const band = Math.max(2, Math.round(Math.min(w, h) * 0.03));
  const samples: [number, number, number][] = [];
  for (let y = 0; y < h; y += 2) {
    for (let x = 0; x < w; x += 2) {
      if (x >= band && x < w - band && y >= band && y < h - band) continue;
      const i = (y * w + x) * 4;
      if (data[i + 3]! > 200) samples.push([data[i]!, data[i + 1]!, data[i + 2]!]);
    }
  }
  if (samples.length < 20) return img;
  const median = (k: 0 | 1 | 2) => samples.map((s) => s[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)]!;
  const bg: [number, number, number] = [median(0), median(1), median(2)];
  const close = samples.filter((s) => Math.hypot(s[0] - bg[0], s[1] - bg[1], s[2] - bg[2]) < 40).length;
  if (close < samples.length * 0.6) return img; // the border is busy art, not a backdrop
  const d = new Uint8ClampedArray(data);
  const NEAR = 55, FAR = 110;
  for (let i = 0; i < d.length; i += 4) {
    const dist = Math.hypot(d[i]! - bg[0], d[i + 1]! - bg[1], d[i + 2]! - bg[2]);
    if (dist < NEAR) d[i + 3] = 0;
    else if (dist < FAR) {
      const a = (dist - NEAR) / (FAR - NEAR);
      d[i + 3] = Math.round(d[i + 3]! * a);
      // Take the backdrop color out of the soft edge, so no green halo is left.
      for (let k = 0; k < 3; k++) d[i + k] = Math.max(0, Math.min(255, (d[i + k]! - bg[k]! * (1 - a)) / Math.max(a, 0.2)));
    }
  }
  return { ...img, data: d };
}
