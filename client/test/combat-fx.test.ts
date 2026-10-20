import { describe, expect, it } from 'vitest';
import {
  LEVEL_UP_LIFE,
  combatParticleCount,
  levelUpRingCurve,
  pickPoolSlot,
  type CombatParticleKind,
  type LevelUpRingSample,
  type PoolTimeSlot,
} from '../src/render/combat-fx';

describe('combat effect pool selection', () => {
  it('uses idle slots in round-robin order', () => {
    const slots: PoolTimeSlot[] = [
      { startedAt: 1, activeUntil: 2 },
      { startedAt: 0, activeUntil: 0 },
      { startedAt: 0, activeUntil: 0 },
    ];
    expect(pickPoolSlot(slots, 1, 2)).toBe(2);
    expect(pickPoolSlot(slots, 1, 0)).toBe(1);
  });

  it('reuses the oldest effect when every slot is busy', () => {
    const slots: PoolTimeSlot[] = [
      { startedAt: 8, activeUntil: 20 },
      { startedAt: 3, activeUntil: 12 },
      { startedAt: 6, activeUntil: 16 },
    ];
    expect(pickPoolSlot(slots, 10, 2)).toBe(1);

    const tied = slots.map((slot) => ({ ...slot, startedAt: 3 }));
    expect(pickPoolSlot(tied, 10, 2)).toBe(2);
  });
});

describe('combat effect quality', () => {
  it('halves normal particle counts and removes building debris on low', () => {
    const kinds: CombatParticleKind[] = ['attack', 'spell', 'siege', 'miss', 'level-up', 'gold', 'death', 'building-dust', 'build-dust'];
    for (const kind of kinds) {
      expect(combatParticleCount(kind, 'low')).toBe(Math.ceil(combatParticleCount(kind, 'high') / 2));
    }
    expect(combatParticleCount('building-debris', 'high')).toBeGreaterThan(0);
    expect(combatParticleCount('building-debris', 'low')).toBe(0);
    expect(combatParticleCount('gold', 'high')).toBe(6);
    expect(combatParticleCount('gold', 'low')).toBe(3);
  });
});

describe('level-up ring curve', () => {
  it('rises while it fades and reaches zero alpha at its lifetime', () => {
    const sample: LevelUpRingSample = { height: 0, alpha: 0, scale: 0 };
    levelUpRingCurve(0, sample);
    expect(sample).toEqual({ height: 0, alpha: 1, scale: 0.65 });

    levelUpRingCurve(LEVEL_UP_LIFE / 2, sample);
    expect(sample.height).toBeCloseTo(1.3);
    expect(sample.alpha).toBeCloseTo(0.5);
    expect(sample.scale).toBeCloseTo(1.15);

    levelUpRingCurve(LEVEL_UP_LIFE, sample);
    expect(sample.height).toBeCloseTo(2.6);
    expect(sample.alpha).toBe(0);

    levelUpRingCurve(LEVEL_UP_LIFE * 2, sample);
    expect(sample.alpha).toBe(0);
    expect(sample.height).toBeCloseTo(2.6);
  });
});
