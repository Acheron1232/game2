import { describe, expect, it } from 'vitest';
import { runHeadlessMatch } from '../src/match/headless';

describe('headless match', () => {
  it('does not call a supply-limited winning army idle just because it could afford another worker', () => {
    // Who wins changes with every AI tuning; that somebody wins (with a maxed army) does not.
    const result = runHeadlessMatch({ seed: 10, slots: 4, maxMinutes: 60 });
    expect(result.winnerTeam).toBeGreaterThan(0);
    expect(result.stuck).toEqual([]);
    // Faction AI pass: every faction summoned its own hero, cleared camps and fought in the field.
    for (const f of result.factions) {
      expect(f.factionHero, `slot ${f.slot} hero`).not.toBe('');
      expect(f.campsCleared, `slot ${f.slot} camps`).toBeGreaterThan(0);
    }
    expect(result.factions.reduce((n, f) => n + f.fieldFights, 0)).toBeGreaterThan(0);
  }, 90_000);

  it('runs three game minutes quickly and records the economy', () => {
    const started = performance.now();
    const result = runHeadlessMatch({ seed: 1, slots: 2, maxMinutes: 3 });

    expect((performance.now() - started) / 1000).toBeLessThan(20);
    expect(result.minutes).toBe(3);
    expect(result.log).toHaveLength(3);
    expect(result.log[2]!.factions[0]!.gold).toBeGreaterThan(result.log[0]!.factions[0]!.gold);
    expect(result.tickMsAvg).toBeGreaterThan(0);
    expect(result.tickMsP99).toBeGreaterThan(0);
    expect(result.tickMsMax).toBeGreaterThan(0);
  });

  it('calls attach once and updates it every tick', () => {
    let attached = 0;
    let updates = 0;
    const result = runHeadlessMatch({
      seed: 2,
      slots: 2,
      maxMinutes: 1 / 60,
      attach: () => {
        attached++;
        return { update: () => updates++ };
      },
    });

    expect(attached).toBe(1);
    expect(updates).toBe(result.ticks);
  });

  it('reports an idle rich faction after 61 seconds', () => {
    const result = runHeadlessMatch({
      seed: 3,
      slots: 2,
      maxMinutes: 62 / 60,
      noAi: true,
      attach: (sim) => {
        const faction = sim.factions!.get(0)!;
        faction.gold = 10_000;
        faction.wood = 10_000;
        for (const id of [...faction.units]) {
          const unit = sim.get(id);
          if (unit?.job) sim.kill(unit, { id: 0, owner: 0, team: faction.team });
        }
      },
    });

    expect(result.stuck).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ slot: 0, seconds: 61, reason: expect.stringContaining('idle with resources') }),
        expect.objectContaining({ slot: 0, seconds: 61, reason: expect.stringContaining('no worker has a job') }),
      ]),
    );
  });
});
