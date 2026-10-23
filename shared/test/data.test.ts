import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gameData, validateGameData } from '../src/index';

const ROOT = join(import.meta.dirname, '..', '..');

describe('game data', () => {
  it('loads with the expected content', () => {
    expect(gameData.heroes).toHaveLength(14);
    expect(gameData.abilities).toHaveLength(58);
    expect(gameData.map.starts).toHaveLength(4);
  });

  it('files agree with each other', () => {
    expect(validateGameData(gameData)).toEqual([]);
  });

  it('rejects unknown, chained or incompatible shared ability mechanics', () => {
    for (const effect of ['missing_effect', 'briar_lance', 'stone_skin']) {
      const copy = structuredClone(gameData);
      copy.abilities.find((a) => a.id === 'briar_lance')!.params['effect'] = effect;
      expect(validateGameData(copy).some((e) => e.includes('briar_lance: effect'))).toBe(true);
    }
  });

  it('uses none of the banned Blizzard / Valve names', () => {
    const banned = [
      /lost temple/i,
      /footman/i,
      /peasant/i,
      /holy light/i,
      /war ?stomp/i,
      /starfall/i,
      /gryphon/i,
      /goblin merchant/i,
      /mountain king/i,
      /blademaster/i,
      /tauren/i,
      /ancient of/i,
      /roshan/i,
      /blizzard/i,
    ];
    const files = [
      ...readdirSync(join(ROOT, 'shared', 'data'))
        .filter((f) => f.endsWith('.json'))
        .map((f) => join(ROOT, 'shared', 'data', f)),
      ...readdirSync(join(ROOT, 'docs', 'design'))
        .filter((f) => f.endsWith('.md'))
        .map((f) => join(ROOT, 'docs', 'design', f)),
    ];
    const hits = files.flatMap((f) => banned.filter((re) => re.test(readFileSync(f, 'utf8'))).map((re) => `${f}: ${re}`));
    expect(hits).toEqual([]);
  });
});
