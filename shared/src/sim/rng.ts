// Seeded random numbers (mulberry32). Same seed = same match, for tests and replays later.

export class Rng {
  private s: number;

  constructor(seed: number) {
    this.s = seed >>> 0;
  }

  /** 0 <= n < 1 */
  next(): number {
    let t = (this.s = (this.s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Whole number, min <= n <= max */
  int(min: number, max: number): number {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.next() * list.length)]!;
  }

  shuffle<T>(list: T[]): T[] {
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [list[i], list[j]] = [list[j]!, list[i]!];
    }
    return list;
  }
}
