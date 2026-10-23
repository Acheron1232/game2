// The faction AI's decision numbers (ai.json faction.difficulties, army, unitMix) and a way to
// change some of them for one faction in one match. Only the self-play tuning tool
// (tools/ai/tune.ts) uses the override: MatchSetup.aiTuning, never set by the lobby or protocol.

import { gameData } from '../../data/index';
import type { Difficulty } from './faction';

export interface DifficultyRules {
  thinkDelaySec: number;
  workerTarget: number;
  maxProductionBuildings: number;
  firstAttackArmySupply: number;
  attackArmySupply: number;
  retreatAtArmyPct: number;
  expandAtMinute: number | null;
  towersAtBase: number;
  targetChoice: 'closest' | 'closest_or_weakest' | 'weakest_or_where_our_hero_fights';
  focusFire: boolean;
  pullWoundedUnits: boolean;
  buildOrderDelaySec: number;
}

export type ArmyRules = typeof gameData.ai.faction.army;
export type MixTier = 'tier1' | 'tier2' | 'tier3';
export type UnitMix = Record<MixTier, Record<string, number>>;

/** Numbers that replace ai.json values for one faction (every field optional). */
export interface FactionTuning {
  difficulty?: Partial<DifficultyRules>;
  army?: Partial<ArmyRules>;
  /** a tier given here replaces that tier's whole mix */
  unitMix?: Partial<UnitMix>;
}

export interface FactionRules {
  rules: DifficultyRules;
  army: ArmyRules;
  unitMix: UnitMix;
}

const AI = gameData.ai.faction as unknown as {
  difficulties: Record<Difficulty, DifficultyRules>;
  army: ArmyRules;
  unitMix: UnitMix;
};

export function difficultyRules(d: Difficulty): DifficultyRules {
  return AI.difficulties[d];
}

/** ai.json numbers for a faction of this difficulty, with its tuning on top. */
export function factionRules(d: Difficulty, tuning?: FactionTuning): FactionRules {
  if (!tuning) return { rules: AI.difficulties[d], army: AI.army, unitMix: AI.unitMix };
  return {
    rules: { ...AI.difficulties[d], ...tuning.difficulty },
    army: { ...AI.army, ...tuning.army },
    unitMix: { ...AI.unitMix, ...tuning.unitMix },
  };
}
