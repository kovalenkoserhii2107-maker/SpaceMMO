/**
 * Стационарная оборона (Этап 5). Строится на верфи, летать не может,
 * потребляет энергию и гибнет в бою безвозвратно.
 */
import type { BuildingLevels, ResourceAmounts } from './rules.js';
import type { Requirement, TechLevels, TechnologyType } from './techTree.js';
import { techLabel } from './techTree.js';

export const DEFENSE_TYPES = ['ROCKET_LAUNCHER', 'LASER_TURRET'] as const;
export type DefenseType = (typeof DEFENSE_TYPES)[number];
export type DefenseCounts = Record<DefenseType, number>;

export function isDefenseType(value: unknown): value is DefenseType {
  return typeof value === 'string' && (DEFENSE_TYPES as readonly string[]).includes(value);
}

export function emptyDefenseCounts(): DefenseCounts {
  return { ROCKET_LAUNCHER: 0, LASER_TURRET: 0 };
}

interface DefenseDefinition {
  label: string;
  description: string;
  cost: ResourceAmounts;
  baseSeconds: number;
  /** Постоянное потребление энергии одной установкой. */
  energyDrain: number;
  shipyardLevel: number;
  requires: Partial<Record<TechnologyType, number>>;
}

const DEFENSES: Record<DefenseType, DefenseDefinition> = {
  ROCKET_LAUNCHER: {
    label: 'Ракетная установка',
    description: 'Дешевый заслон против легких кораблей.',
    cost: { metal: 200, crystal: 0, deuterium: 0 },
    baseSeconds: 20,
    energyDrain: 0.5,
    shipyardLevel: 1,
    requires: {},
  },
  LASER_TURRET: {
    label: 'Лазерное орудие',
    description: 'Мощная турель, требует энергетики.',
    cost: { metal: 300, crystal: 150, deuterium: 0 },
    baseSeconds: 35,
    energyDrain: 1.2,
    shipyardLevel: 2,
    requires: { ENERGY_TECH: 1 },
  },
};

export const MAX_DEFENSE_ORDER = 100;

export function defenseLabel(type: DefenseType): string {
  return DEFENSES[type].label;
}

export function defenseDescription(type: DefenseType): string {
  return DEFENSES[type].description;
}

export function defenseCost(type: DefenseType): ResourceAmounts {
  return { ...DEFENSES[type].cost };
}

/** Постройка ускоряется уровнем верфи — как и у кораблей. */
export function defenseUnitSeconds(type: DefenseType, shipyardLevel: number): number {
  const speedup = 1 + Math.max(0, shipyardLevel) * 0.4;
  return Math.max(3, Math.round(DEFENSES[type].baseSeconds / speedup));
}

/** Суммарное потребление энергии всей обороной базы. */
export function defenseEnergyUsage(defenses: DefenseCounts): number {
  return DEFENSE_TYPES.reduce((total, type) => total + defenses[type] * DEFENSES[type].energyDrain, 0);
}

export function missingDefenseRequirements(
  type: DefenseType,
  levels: BuildingLevels,
  techs: TechLevels,
): Requirement[] {
  const definition = DEFENSES[type];
  const missing: Requirement[] = [];

  if (levels.SHIPYARD < definition.shipyardLevel) {
    missing.push({ kind: 'building', key: 'SHIPYARD', label: 'Верфь', level: definition.shipyardLevel });
  }
  for (const [tech, level] of Object.entries(definition.requires) as Array<[TechnologyType, number]>) {
    if (techs[tech] < level) {
      missing.push({ kind: 'tech', key: tech, label: techLabel(tech), level });
    }
  }
  return missing;
}
