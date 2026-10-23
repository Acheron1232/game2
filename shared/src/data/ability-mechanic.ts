import type { AbilityDef } from './schemas';

/** Several hero kits can share a tested effect while keeping their own data and visuals. */
export function abilityMechanic(a: AbilityDef): string {
  return typeof a.params['effect'] === 'string' ? a.params['effect'] : a.id;
}
