/** Downsample RGBA array layers independently. Runs once during loading, never in a frame. */
export function downsampleArrayMip(source: Uint8Array, size: number, layers: number): Uint8Array<ArrayBuffer> {
  const nextSize = size / 2;
  const result = new Uint8Array(nextSize * nextSize * 4 * layers);
  for (let layer = 0; layer < layers; layer++) {
    const sourceOffset = layer * size * size * 4;
    const targetOffset = layer * nextSize * nextSize * 4;
    for (let y = 0; y < nextSize; y++) {
      for (let x = 0; x < nextSize; x++) {
        const p = sourceOffset + (y * 2 * size + x * 2) * 4;
        const out = targetOffset + (y * nextSize + x) * 4;
        for (let c = 0; c < 4; c++) {
          result[out + c] = Math.round(
            (source[p + c]! + source[p + 4 + c]! + source[p + size * 4 + c]! + source[p + size * 4 + 4 + c]!) / 4,
          );
        }
      }
    }
  }
  return result;
}
