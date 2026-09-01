/**
 * Стационарная оборона. Строится на верфи, летать не может,
 * потребляет энергию и гибнет в бою безвозвратно.
 */
import { NEUTRAL_MODIFIERS, type BuildingLevels, type ResourceAmounts, type SystemModifiers } from './rules.js';
import type { Requirement, TechLevels, TechnologyType } from './techTree.js';
import { techLabel } from './techTree.js';

export const DEFENSE_TYPES = ['CANNON', 'LASER', 'GAUSS', 'PLASMA', 'SUPER_WEAPON'] as const;
export type DefenseType = (typeof DEFENSE_TYPES)[number];
export type DefenseCounts = Record<DefenseType, number>;

export function isDefenseType(value: unknown): value is DefenseType {
  return typeof value === 'string' && (DEFENSE_TYPES as readonly string[]).includes(value);
}

export function emptyDefenseCounts(): DefenseCounts {
  return { CANNON: 0, LASER: 0, GAUSS: 0, PLASMA: 0, SUPER_WEAPON: 0 };
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

/*
 * Оборона дешевле флота за единицу мощи, но не летает и обломков не дает.
 * Линия построена по возрастанию: от массового заслона до одной установки,
 * которая стоит дороже эскадры и требует под себя отдельную энергетику.
 */
const DEFENSES: Record<DefenseType, DefenseDefinition> = {
  CANNON: {
    label: 'Турель «Град»',
    description: 'Дешевый заслон против легких кораблей.',
    cost: { ore: 1500, polymers: 0, plasma: 0 },
    baseSeconds: 20,
    energyDrain: 0.5,
    shipyardLevel: 1,
    requires: {},
  },
  LASER: {
    label: 'Лазер «Промінь»',
    description: 'Мощная турель, требует энергетики.',
    cost: { ore: 3200, polymers: 1700, plasma: 0 },
    baseSeconds: 40,
    energyDrain: 1.2,
    shipyardLevel: 2,
    requires: { ENERGY_TECH: 2 },
  },
  GAUSS: {
    label: 'Гаусс-пушка «Скіф»',
    description: 'Рельсовое орудие: пробивает броню крейсеров, но прожорливо по энергии.',
    cost: { ore: 22000, polymers: 12000, plasma: 1500 },
    baseSeconds: 200,
    energyDrain: 3.0,
    shipyardLevel: 6,
    requires: { ARMOR_TECH: 5 },
  },
  PLASMA: {
    label: 'Плазменная батарея «Сварог»',
    description: 'Тяжелая батарея планетарной обороны. Держит удар линейного флота.',
    cost: { ore: 160000, polymers: 95000, plasma: 32000 },
    baseSeconds: 700,
    energyDrain: 8.0,
    shipyardLevel: 9,
    requires: { WEAPONS_TECH: 8 },
  },
  SUPER_WEAPON: {
    label: 'Ионный излучатель «Перун»',
    description:
      'Ультимативная защита планеты. Бьет раз в раунд и только по одной цели — ' +
      'зато залпа хватает, чтобы снять линкор. Требует энергетику целой колонии.',
    cost: { ore: 1400000, polymers: 1000000, plasma: 350000 },
    baseSeconds: 1800,
    energyDrain: 50.0,
    shipyardLevel: 12,
    requires: { COMPUTING_TECH: 12 },
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

/** Постройка ускоряется уровнем верфи и замедляется искажением времени. */
export function defenseUnitSeconds(
  type: DefenseType,
  shipyardLevel: number,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
  /**
   * Ускорение от технологий: робототехника и «Сжатие времени». Числом,
   * а не уровнями, — модуль о дереве технологий не знает.
   */
  techSpeedup = 1,
): number {
  const speedup = (1 + Math.max(0, shipyardLevel) * 0.4) * Math.max(1, techSpeedup);
  return Math.max(3, Math.round((DEFENSES[type].baseSeconds / speedup) * modifiers.buildTimeMultiplier));
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
