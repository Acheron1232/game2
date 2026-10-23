import { describe, expect, it } from 'vitest';
import { gameData, Rng } from '@game/shared';
import { ARMY_GENES, baselineCandidate, crossover, DIFFICULTY_GENES, describeChanges, mutate, scoreMatch } from '../ai/lib/genes';

describe('AI tuning genes', () => {
  it('starts from the ai.json numbers', () => {
    const c = baselineCandidate();
    expect(c.difficulty.attackArmySupply).toBe(gameData.ai.faction.difficulties.normal['attackArmySupply']);
    expect(c.army.trainUpToSupply).toBe(gameData.ai.faction.army.trainUpToSupply);
    expect(describeChanges(c, baselineCandidate())).toEqual([]);
  });

  it('keeps mutated and mixed numbers in range, and every mix adds up to 1', () => {
    const rng = new Rng(5);
    let c = baselineCandidate();
    for (let i = 0; i < 200; i++) {
      c = crossover(mutate(c, rng, 0.3, 0.8), mutate(baselineCandidate(), rng), rng);
      for (const [gene, range] of Object.entries(DIFFICULTY_GENES)) {
        const v = c.difficulty[gene as keyof typeof DIFFICULTY_GENES];
        expect(v).toBeGreaterThanOrEqual(range.low);
        expect(v).toBeLessThanOrEqual(range.high);
      }
      for (const [gene, range] of Object.entries(ARMY_GENES)) {
        if (gene === 'trainUpToSupply') continue; // pushed above attackAtSupplyUsed + 10
        const v = c.army[gene as keyof typeof ARMY_GENES];
        expect(v).toBeGreaterThanOrEqual(range.low);
        expect(v).toBeLessThanOrEqual(range.high);
      }
      expect(c.army.trainUpToSupply).toBeGreaterThanOrEqual(c.army.attackAtSupplyUsed + 10);
      for (const mix of Object.values(c.unitMix)) {
        const sum = Object.values(mix).reduce((a, b) => a + b, 0);
        expect(Math.abs(sum - 1)).toBeLessThan(0.001);
        for (const share of Object.values(mix)) expect(share).toBeGreaterThan(0);
      }
    }
    expect(describeChanges(baselineCandidate(), c).length).toBeGreaterThan(0);
  });

  it('scores a match for the candidate slots', () => {
    const alive = [false, false, false, false];
    expect(scoreMatch({ winnerTeam: 3, defeated: alive }, [0, 2])).toBe(1);
    expect(scoreMatch({ winnerTeam: 2, defeated: alive }, [0, 2])).toBe(0);
    expect(scoreMatch({ winnerTeam: 0, defeated: alive }, [0, 2])).toBe(0.5);
    expect(scoreMatch({ winnerTeam: 0, defeated: [true, false, false, true] }, [0, 1])).toBe(0.5);
    expect(scoreMatch({ winnerTeam: 0, defeated: [false, false, true, false] }, [0, 1])).toBeCloseTo(2 / 3);
  });
});
