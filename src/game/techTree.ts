/**
 * Дерево технологий. Технологии общие для игрока, изучаются в лаборатории.
 * Модуль чистый: только определения и формулы.
 */
import {
  NEUTRAL_MODIFIERS,
  type BuildingLevels,
  type EconomyBonuses,
  type ResourceAmounts,
  type SystemModifiers,
} from './rules.js';

export const TECHNOLOGY_TYPES = [
  'ENERGY_TECH',
  'COMPUTING_TECH',
  'MINING_TECH',
  'COMBUSTION_DRIVE',
  'HYPERSPACE_PHYSICS',
  'HYPERDRIVE',
  'ASTROPHYSICS',
] as const;

export type TechnologyType = (typeof TECHNOLOGY_TYPES)[number];

export type TechLevels = Record<TechnologyType, number>;

export function isTechnologyType(value: unknown): value is TechnologyType {
  return typeof value === 'string' && (TECHNOLOGY_TYPES as readonly string[]).includes(value);
}

export function emptyTechLevels(): TechLevels {
  return {
    ENERGY_TECH: 0,
    COMPUTING_TECH: 0,
    MINING_TECH: 0,
    COMBUSTION_DRIVE: 0,
    HYPERSPACE_PHYSICS: 0,
    HYPERDRIVE: 0,
    ASTROPHYSICS: 0,
  };
}

interface TechDefinition {
  label: string;
  description: string;
  /** Стоимость 1 уровня и множитель роста. */
  cost: ResourceAmounts & { factor: number };
  /** Базовая длительность изучения 1 уровня в секундах и множитель роста. */
  baseSeconds: number;
  timeFactor: number;
  /** Минимальный уровень лаборатории. */
  labLevel: number;
  /** Требования по другим технологиям. */
  requires: Partial<Record<TechnologyType, number>>;
}

const TECHNOLOGIES: Record<TechnologyType, TechDefinition> = {
  ENERGY_TECH: {
    label: 'Энергетика',
    description: '+2% к выработке энергии базы за уровень. Открывает путь к остальным технологиям.',
    cost: { metal: 0, crystal: 200, deuterium: 100, factor: 2.0 },
    baseSeconds: 90,
    timeFactor: 1.8,
    labLevel: 1,
    requires: {},
  },
  COMPUTING_TECH: {
    label: 'Вычислительная техника',
    description: '-3% к времени исследований за уровень. Нужна для постройки зондов.',
    cost: { metal: 0, crystal: 100, deuterium: 75, factor: 2.0 },
    baseSeconds: 60,
    timeFactor: 1.8,
    labLevel: 1,
    requires: {},
  },
  MINING_TECH: {
    label: 'Горное дело',
    description: '+2% к добыче всех шахт за уровень.',
    cost: { metal: 200, crystal: 100, deuterium: 0, factor: 1.8 },
    baseSeconds: 75,
    timeFactor: 1.7,
    labLevel: 2,
    requires: { ENERGY_TECH: 1 },
  },
  COMBUSTION_DRIVE: {
    label: 'Реактивный двигатель',
    description: 'Открывает постройку транспортников и легких истребителей.',
    cost: { metal: 100, crystal: 0, deuterium: 60, factor: 1.9 },
    baseSeconds: 80,
    timeFactor: 1.7,
    labLevel: 2,
    requires: { ENERGY_TECH: 1 },
  },
  HYPERSPACE_PHYSICS: {
    label: 'Гиперпространственная физика',
    description: 'Открывает постройку синтезатора антиматерии.',
    cost: { metal: 800, crystal: 1200, deuterium: 600, factor: 2.1 },
    baseSeconds: 240,
    timeFactor: 1.8,
    labLevel: 3,
    requires: { ENERGY_TECH: 2, COMPUTING_TECH: 1 },
  },
  ASTROPHYSICS: {
    label: 'Астрофизика',
    description:
      'Открывает экспедиции в глубокий космос. Уровень задает число одновременных ' +
      'экспедиций (1 → 1, 4 → 2, 9 → 3), увеличивает находки и помогает уходить от засад.',
    cost: { metal: 400, crystal: 800, deuterium: 400, factor: 1.9 },
    baseSeconds: 180,
    timeFactor: 1.75,
    labLevel: 2,
    requires: { COMPUTING_TECH: 1 },
  },
  HYPERDRIVE: {
    label: 'Гипердвигатель',
    description:
      'Открывает межзвездные прыжки на антиматерии. Каждый уровень ускоряет прыжок ' +
      'и снижает расход топлива.',
    cost: { metal: 1500, crystal: 1000, deuterium: 900, factor: 2.0 },
    baseSeconds: 300,
    timeFactor: 1.8,
    labLevel: 3,
    requires: { HYPERSPACE_PHYSICS: 1 },
  },
};

export function techLabel(tech: TechnologyType): string {
  return TECHNOLOGIES[tech].label;
}

export function techDescription(tech: TechnologyType): string {
  return TECHNOLOGIES[tech].description;
}

export function researchCost(tech: TechnologyType, targetLevel: number): ResourceAmounts {
  const { cost } = TECHNOLOGIES[tech];
  const scale = Math.pow(cost.factor, targetLevel - 1);
  return {
    metal: Math.floor(cost.metal * scale),
    crystal: Math.floor(cost.crystal * scale),
    deuterium: Math.floor(cost.deuterium * scale),
  };
}

/**
 * Длительность изучения: ускоряется уровнем лаборатории и «Вычислительной техникой»,
 * замедляется модификаторами системы (искажение времени у черной дыры).
 */
export function researchSeconds(
  tech: TechnologyType,
  targetLevel: number,
  labLevel: number,
  techs: TechLevels,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
): number {
  const definition = TECHNOLOGIES[tech];
  const raw = definition.baseSeconds * Math.pow(definition.timeFactor, targetLevel - 1);
  const labSpeedup = 1 + Math.max(0, labLevel) * 0.5;
  const computingSpeedup = Math.max(0.5, 1 - techs.COMPUTING_TECH * 0.03);
  return Math.max(
    5,
    Math.round((raw / labSpeedup) * computingSpeedup * modifiers.researchTimeMultiplier),
  );
}

export interface Requirement {
  kind: 'building' | 'tech';
  key: string;
  label: string;
  level: number;
}

/** Невыполненные требования для изучения следующего уровня технологии. */
export function missingTechRequirements(
  tech: TechnologyType,
  levels: BuildingLevels,
  techs: TechLevels,
): Requirement[] {
  const definition = TECHNOLOGIES[tech];
  const missing: Requirement[] = [];

  if (levels.RESEARCH_LAB < definition.labLevel) {
    missing.push({
      kind: 'building',
      key: 'RESEARCH_LAB',
      label: 'Исследовательская лаборатория',
      level: definition.labLevel,
    });
  }

  for (const [required, level] of Object.entries(definition.requires) as Array<[TechnologyType, number]>) {
    if (techs[required] < level) {
      missing.push({ kind: 'tech', key: required, label: TECHNOLOGIES[required].label, level });
    }
  }

  return missing;
}

/** Экономические бонусы от изученных технологий. */
export function economyBonuses(techs: TechLevels): EconomyBonuses {
  return {
    mining: 1 + techs.MINING_TECH * 0.02,
    energy: 1 + techs.ENERGY_TECH * 0.02,
  };
}
