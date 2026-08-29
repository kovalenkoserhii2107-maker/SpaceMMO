/**
 * Игровые правила Этапа 1: добыча базовых ресурсов и стоимость построек.
 * Модуль чистый (без I/O) — все расчеты выполняются только на сервере.
 */

export const BUILDING_TYPES = ['METAL_MINE', 'CRYSTAL_MINE', 'DEUTERIUM_MINE', 'SOLAR_PLANT'] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number];

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && (BUILDING_TYPES as readonly string[]).includes(value);
}

export interface ResourceAmounts {
  metal: number;
  crystal: number;
  deuterium: number;
}

/** Уровни инфраструктуры базы (Этап 1). */
export interface BuildingLevels {
  METAL_MINE: number;
  CRYSTAL_MINE: number;
  DEUTERIUM_MINE: number;
  SOLAR_PLANT: number;
}

/** Коэффициенты богатства планеты — множители добычи. */
export interface PlanetRichness {
  metal: number;
  crystal: number;
  deuterium: number;
  energy: number;
}

/** Базовая выработка энергии колониального реактора — доступна без построек. */
export const BASE_ENERGY_OUTPUT = 20;

/** Базовая добыча ресурсов в секунду на 1 уровне при коэффициенте 1.0. */
const BASE_YIELD_PER_SECOND: Record<Exclude<BuildingType, 'SOLAR_PLANT'>, number> = {
  METAL_MINE: 0.8,
  CRYSTAL_MINE: 0.5,
  DEUTERIUM_MINE: 0.25,
};

/** Базовые стоимости постройки 1 уровня и множитель роста цены. */
const COSTS: Record<BuildingType, { metal: number; crystal: number; factor: number }> = {
  METAL_MINE: { metal: 60, crystal: 15, factor: 1.5 },
  CRYSTAL_MINE: { metal: 48, crystal: 24, factor: 1.6 },
  DEUTERIUM_MINE: { metal: 225, crystal: 75, factor: 1.5 },
  SOLAR_PLANT: { metal: 75, crystal: 30, factor: 1.5 },
};

/** Потребление энергии шахтами (солнечная станция энергию не тратит). */
const ENERGY_DRAIN: Record<Exclude<BuildingType, 'SOLAR_PLANT'>, number> = {
  METAL_MINE: 1.0,
  CRYSTAL_MINE: 1.0,
  DEUTERIUM_MINE: 1.4,
};

export const BUILDING_LABELS: Record<BuildingType, string> = {
  METAL_MINE: 'Шахта металла',
  CRYSTAL_MINE: 'Кристаллический рудник',
  DEUTERIUM_MINE: 'Синтезатор дейтерия',
  SOLAR_PLANT: 'Солнечная электростанция',
};

/** Стоимость апгрейда до уровня targetLevel (>= 1). */
export function upgradeCost(type: BuildingType, targetLevel: number): ResourceAmounts {
  const cost = COSTS[type];
  const scale = Math.pow(cost.factor, targetLevel - 1);
  return {
    metal: Math.floor(cost.metal * scale),
    crystal: Math.floor(cost.crystal * scale),
    deuterium: 0,
  };
}

/** Добыча ресурсов в секунду для текущих уровней и богатства планеты. */
export function productionPerSecond(levels: BuildingLevels, richness: PlanetRichness): ResourceAmounts {
  return {
    metal: mineOutput(BASE_YIELD_PER_SECOND.METAL_MINE, levels.METAL_MINE, richness.metal),
    crystal: mineOutput(BASE_YIELD_PER_SECOND.CRYSTAL_MINE, levels.CRYSTAL_MINE, richness.crystal),
    deuterium: mineOutput(BASE_YIELD_PER_SECOND.DEUTERIUM_MINE, levels.DEUTERIUM_MINE, richness.deuterium),
  };
}

function mineOutput(base: number, level: number, richness: number): number {
  if (level <= 0) return 0;
  return base * level * Math.pow(1.1, level) * richness;
}

/** Суммарная выработка энергии базы. */
export function energyOutput(levels: BuildingLevels, richness: PlanetRichness): number {
  const solar = levels.SOLAR_PLANT <= 0
    ? 0
    : 2 * levels.SOLAR_PLANT * Math.pow(1.1, levels.SOLAR_PLANT) * richness.energy;
  return BASE_ENERGY_OUTPUT + solar;
}

/** Суммарное потребление энергии шахтами базы. */
export function energyUsage(levels: BuildingLevels): number {
  return (
    drain(ENERGY_DRAIN.METAL_MINE, levels.METAL_MINE) +
    drain(ENERGY_DRAIN.CRYSTAL_MINE, levels.CRYSTAL_MINE) +
    drain(ENERGY_DRAIN.DEUTERIUM_MINE, levels.DEUTERIUM_MINE)
  );
}

function drain(base: number, level: number): number {
  if (level <= 0) return 0;
  return base * level * Math.pow(1.1, level);
}

/** Уровни базы после апгрейда указанной постройки. */
export function levelsAfterUpgrade(levels: BuildingLevels, type: BuildingType): BuildingLevels {
  return { ...levels, [type]: levels[type] + 1 };
}

export function hasEnoughResources(stock: ResourceAmounts, cost: ResourceAmounts): boolean {
  return stock.metal >= cost.metal && stock.crystal >= cost.crystal && stock.deuterium >= cost.deuterium;
}
