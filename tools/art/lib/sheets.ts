// Reads tools/art/sheets.json and fills in cell defaults.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const ROOT = join(import.meta.dirname, '..', '..', '..');
export const ART_DIR = join(ROOT, 'tools', 'art');

export type CellKind = 'tile' | 'sprite' | 'frame' | 'concept' | 'icon' | 'additive';

export interface Cell {
  name: string;
  kind: CellKind;
  size: number;
  /** 'ui', 'concept' or a folder under client/public/assets */
  out: string;
  /** Cells with the same atlas name go into one atlas image. */
  atlas?: string;
  teamColor?: boolean;
}

export interface Sheet {
  id: string;
  /** [columns, rows] */
  grid: [number, number];
  aspect: 'square' | 'landscape';
  prompt: string;
  promptVars?: Record<string, string>;
  cells: Cell[];
}

type RawCell = string | Partial<Cell>;
interface RawGroup extends Partial<Omit<Cell, 'name'>> {
  cells: RawCell[];
}
interface RawSheet extends Omit<Sheet, 'cells'> {
  out?: string;
  cells?: RawCell[];
  cellDefaults?: Partial<Cell>;
  groups?: RawGroup[];
}

export function loadSheets(): Sheet[] {
  const raw = JSON.parse(readFileSync(join(ART_DIR, 'sheets.json'), 'utf8')) as { sheets: RawSheet[] };
  return raw.sheets.map((s) => {
    const groups: RawGroup[] = s.groups ?? [{ ...s.cellDefaults, cells: s.cells ?? [] }];
    const cells = groups.flatMap(({ cells: list, ...defaults }) =>
      list.map((c) => {
        const cell = { out: s.out, ...defaults, ...(typeof c === 'string' ? { name: c } : c) } as Cell;
        if (!cell.name || !cell.kind || !cell.size || !cell.out) throw new Error(`Sheet ${s.id}: cell ${JSON.stringify(c)} needs name, kind, size and out`);
        return cell;
      }),
    );
    if (cells.length !== s.grid[0] * s.grid[1]) throw new Error(`Sheet ${s.id}: ${cells.length} cells but grid is ${s.grid.join('x')}`);
    const names = new Set<string>();
    for (const c of cells) {
      const key = `${c.out}/${c.name}`;
      if (names.has(key)) throw new Error(`Sheet ${s.id}: two cells write ${key}`);
      names.add(key);
    }
    return { id: s.id, grid: s.grid, aspect: s.aspect, prompt: s.prompt, ...(s.promptVars && { promptVars: s.promptVars }), cells };
  });
}

export function findSheet(id: string): Sheet {
  const sheet = loadSheets().find((s) => s.id === id);
  if (!sheet) throw new Error(`No sheet "${id}". Sheets: ${loadSheets().map((s) => s.id).join(', ')}`);
  return sheet;
}
