import { entityTypeIndex } from '@game/shared';
import { describe, expect, it } from 'vitest';
import { inspectAbilities } from '../src/ui/inspect';

describe('looking at any hero or unit', () => {
  it('shows a hero its 4 abilities with icon names, text and the numbers of every level', () => {
    const list = inspectAbilities(entityTypeIndex('blood_witch'));
    expect(list.map((a) => a.key)).toEqual(['Q', 'W', 'E', 'R']);
    const bolt = list[0]!;
    expect(bolt.iconIds[0]).toBe('blood_bolt');
    expect(bolt.tooltip[0]).toBe('Blood Bolt (Q) — Active');
    expect(bolt.tooltip[1]).toBe(bolt.summary);
    expect(bolt.tooltip.join('\n')).toContain('Damage 90 / 150 / 210 / 270');
    // No learned level: the player only sees what the ability does.
    expect(bolt.tooltip.join('\n')).not.toMatch(/\[|Learned|level \d of/i);
    expect(list[3]!.tooltip.join('\n')).toContain('Cooldown 120 / 95 s');
  });

  it('an expansion hero falls back to the icon of the base ability it reuses', () => {
    const [lance] = inspectAbilities(entityTypeIndex('thorn_marshal'));
    expect(lance!.iconIds).toEqual(['briar_lance', 'spear_throw']);
  });

  it('shows unit skills with their name, text and numbers', () => {
    const [mend] = inspectAbilities(entityTypeIndex('cleric'));
    expect(mend!.name).toBe('Mend');
    expect(mend!.passive).toBe(false);
    expect(mend!.tooltip.join('\n')).toContain('Heal 20');
    expect(mend!.tooltip.join('\n')).toContain('Cooldown 2 s');
    const guard = inspectAbilities(entityTypeIndex('foundry_golem'));
    expect(guard.map((a) => a.name)).toEqual(['Stone Guard', 'Rock Slam']);
    expect(guard[0]!.passive).toBe(true);
  });

  it('a unit without skills or a building has nothing to show', () => {
    expect(inspectAbilities(entityTypeIndex('swordsman'))).toEqual([]);
    expect(inspectAbilities(entityTypeIndex('town_hall'))).toEqual([]);
  });
});
