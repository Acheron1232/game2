// What a player sees about any hero or unit (own, ally, enemy, neutral): its abilities with an
// icon, the text and the numbers. How far a hero has learned them is not shown (user's choice).
// Unit skill names and text are in skills.json, their numbers on the unit in units.json.

import { abilityIndex, abilityMechanic, ABILITIES, ENTITY_TYPES, gameData } from '@game/shared';
import { abilityAllLevels, skillDetails } from './ability-details';
import { S } from './strings';

export interface InspectAbilityView {
  /** Q W E R for heroes, empty for unit skills */
  key: string;
  name: string;
  /** icon names to try, best first (an expansion ability may reuse its base ability's icon) */
  iconIds: string[];
  passive: boolean;
  /** first line is the title */
  tooltip: string[];
  /** the ability's text, for the hover card */
  summary: string;
}

const KEYS = ['Q', 'W', 'E', 'R'];
const SKILL_KINDS: Record<string, string> = { active: 'Auto', passive: 'Passive', work: 'Work' };

/** Abilities of an entity type. Empty: none (most buildings, simple soldiers). */
export function inspectAbilities(type: number): InspectAbilityView[] {
  const id = ENTITY_TYPES[type] ?? '';
  const hero = gameData.heroes.find((h) => h.id === id);
  if (hero)
    return hero.abilities.map((aid, slot) => {
      const a = ABILITIES[abilityIndex(aid)]!;
      return {
        key: KEYS[slot]!,
        name: a.name,
        iconIds: [a.id, abilityMechanic(a)],
        passive: a.kind !== 'active',
        tooltip: [`${a.name} (${KEYS[slot]}) — ${S.abilityKinds[a.kind] ?? a.kind}`, a.text, ...abilityAllLevels(a)],
        summary: a.text,
      };
    });
  const unit = gameData.units.find((u) => u.id === id);
  if (!unit) return [];
  return unit.skills.map((sk) => {
    const info = gameData.skills.find((s) => s.id === sk.id);
    const name = info?.name ?? sk.id;
    return {
      key: '',
      name,
      iconIds: [sk.id],
      passive: info?.kind !== 'active',
      tooltip: [`${name} — ${SKILL_KINDS[info?.kind ?? ''] ?? ''}`, info?.text ?? '', ...skillDetails(sk)].filter(Boolean),
      summary: info?.text ?? '',
    };
  });
}
