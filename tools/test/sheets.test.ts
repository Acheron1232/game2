import { describe, expect, it } from 'vitest';
import { loadSheets } from '../art/lib/sheets';

describe('art sheets', () => {
  it('every sheet has exactly one cell per grid slot and a known output', () => {
    const sheets = loadSheets();
    expect(sheets.length).toBeGreaterThanOrEqual(7);
    for (const s of sheets) {
      expect(s.cells).toHaveLength(s.grid[0] * s.grid[1]);
      for (const c of s.cells) expect(c.out).toMatch(/^[a-z_]+$/);
    }
  });

  it('uses about 6 calls for the rest of the 2D art', () => {
    const cells = loadSheets()
      .filter((s) => s.id !== 'ui_kit_a' && !s.id.startsWith('skin_'))
      .reduce((n, s) => n + s.cells.length, 0);
    // 324 + 8 for the tavern mercenaries' concept sheet + 36 skill icons + 42 item icons (2 sheets)
    // + 6 Earth Spirit ability icons
    expect(cells).toBe(416);
  });
});
