import { ABILITIES, abilityIndex } from '@game/shared';
import { describe, expect, it } from 'vitest';
import { abilityDetails } from '../src/ui/ability-details';

describe('ability tooltip numbers', () => {
  it('shows the learned damage and previews level 1 before learning', () => {
    const breath = ABILITIES[abilityIndex('fire_breath')]!;
    expect(abilityDetails(breath, 0).join('\n')).toContain('Level 1 preview');
    expect(abilityDetails(breath, 0).join('\n')).toContain('Damage 85');
    expect(abilityDetails(breath, 3).join('\n')).toContain('Damage 205');
    expect(abilityDetails(breath, 3).join('\n')).not.toContain('preview');
  });

  it('includes the important effects for every current kit', () => {
    for (const ability of ABILITIES) {
      const lines = abilityDetails(ability, 1);
      expect(lines.length, ability.id).toBeGreaterThan(0);
      expect(lines.join('\n'), ability.id).not.toMatch(/undefined|NaN|Projectile speed|Draw scale/);
    }
    const bleed = abilityDetails(ABILITIES[abilityIndex('bleed')]!, 2).join('\n');
    expect(bleed).toContain('Damage/s 35');
    expect(bleed).toContain('Duration 5 s');
    expect(bleed).toContain('Slow 25%');
  });
});
