/**
 * Игровые правила: добыча, энергия, стоимость и длительность построек.
 * Модуль чистый (без I/O) — все расчеты выполняются только на сервере.
 */

export const BUILDING_TYPES = [
  'METAL_MINE',
  'CRYSTAL_MINE',
  'DEUTERIUM_MINE',
  'SOLAR_PLANT',
  'RESEARCH_LAB',
  'SHIPYARD',
  'ANTIMATTER_SYNTH',
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number];

/** Постройки, которые дают ресурсы. */
type MineType = 'METAL_MINE' | 'CRYSTAL_MINE' | 'DEUTERIUM_MINE' | 'ANTIMATTER_SYNTH';

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && (BUILDING_TYPES as readonly string[]).includes(value);
}

export interface ResourceAmounts {
  metal: number;
  crystal: number;
  deuterium: number;
}

/**
 * Склад базы. Антиматерия хранится отдельно от базовой тройки: она не возится
 * в трюмах, не торгуется на бирже и нужна только как топливо гиперпрыжков.
 */
export interface BaseStock extends ResourceAmounts {
  antimatter: number;
}

export type BuildingLevels = Record<BuildingType, number>;

/** Коэффициенты богатства планеты — множители добычи. */
export interface PlanetRichness {
  metal: number;
  crystal: number;
  deuterium: number;
  energy: number;
  antimatter: number;
}

/**
 * Модификаторы системы (Этап 6). У черной дыры «Искажение времени»:
 * синтез антиматерии идет быстрее, а стройка и исследования — медленнее.
 */
export interface SystemModifiers {
  antimatterMultiplier: number;
  buildTimeMultiplier: number;
  researchTimeMultiplier: number;
}

export const NEUTRAL_MODIFIERS: SystemModifiers = {
  antimatterMultiplier: 1,
  buildTimeMultiplier: 1,
  researchTimeMultiplier: 1,
};

/** Эффект «Искажение времени» в системе с черной дырой. */
export const BLACK_HOLE_MODIFIERS: SystemModifiers = {
  antimatterMultiplier: 1.5,
  buildTimeMultiplier: 1.3,
  researchTimeMultiplier: 1.3,
};

export function systemModifiers(anomaly: string | null | undefined): SystemModifiers {
  return anomaly === 'BLACK_HOLE' ? BLACK_HOLE_MODIFIERS : NEUTRAL_MODIFIERS;
}

/** Бонусы от изученных технологий, влияющие на экономику базы. */
export interface EconomyBonuses {
  /** Множитель добычи от «Горного дела». */
  mining: number;
  /** Множитель выработки энергии от «Энергетики». */
  energy: number;
}

const NEUTRAL_BONUSES: EconomyBonuses = { mining: 1, energy: 1 };

/** Базовая выработка энергии колониального реактора — доступна без построек. */
const BASE_ENERGY_OUTPUT = 20;

/** Базовая добыча ресурсов в секунду на 1 уровне при коэффициенте 1.0. */
const BASE_YIELD_PER_SECOND: Record<MineType, number> = {
  METAL_MINE: 0.8,
  CRYSTAL_MINE: 0.5,
  DEUTERIUM_MINE: 0.25,
  // Антиматерия синтезируется на порядки медленнее: это топливо для прыжков,
  // а не сырье для стройки.
  ANTIMATTER_SYNTH: 0.02,
};

/** Базовые стоимости постройки 1 уровня и множитель роста цены. */
const COSTS: Record<BuildingType, ResourceAmounts & { factor: number }> = {
  METAL_MINE: { metal: 60, crystal: 15, deuterium: 0, factor: 1.5 },
  CRYSTAL_MINE: { metal: 48, crystal: 24, deuterium: 0, factor: 1.6 },
  DEUTERIUM_MINE: { metal: 225, crystal: 75, deuterium: 0, factor: 1.5 },
  SOLAR_PLANT: { metal: 75, crystal: 30, deuterium: 0, factor: 1.5 },
  RESEARCH_LAB: { metal: 200, crystal: 400, deuterium: 100, factor: 2.0 },
  SHIPYARD: { metal: 400, crystal: 200, deuterium: 100, factor: 2.0 },
  ANTIMATTER_SYNTH: { metal: 2000, crystal: 1500, deuterium: 800, factor: 2.2 },
};

/** Потребление энергии постройками. Солнечная станция энергию не тратит. */
const ENERGY_DRAIN: Record<BuildingType, number> = {
  METAL_MINE: 1.0,
  CRYSTAL_MINE: 1.0,
  DEUTERIUM_MINE: 1.4,
  SOLAR_PLANT: 0,
  RESEARCH_LAB: 1.2,
  SHIPYARD: 1.5,
  // Синтезатор — самый прожорливый объект базы.
  ANTIMATTER_SYNTH: 8,
};

/** Требования к уровню других построек (Этап 2). */
const BUILDING_REQUIREMENTS: Partial<Record<BuildingType, Partial<Record<BuildingType, number>>>> = {
  SHIPYARD: { METAL_MINE: 2 },
  RESEARCH_LAB: { METAL_MINE: 2 },
  ANTIMATTER_SYNTH: { RESEARCH_LAB: 3, SOLAR_PLANT: 5 },
};

export const BUILDING_LABELS: Record<BuildingType, string> = {
  METAL_MINE: 'Шахта металла',
  CRYSTAL_MINE: 'Кристаллический рудник',
  DEUTERIUM_MINE: 'Синтезатор дейтерия',
  SOLAR_PLANT: 'Солнечная электростанция',
  RESEARCH_LAB: 'Исследовательская лаборатория',
  SHIPYARD: 'Верфь',
  ANTIMATTER_SYNTH: 'Синтезатор антиматерии',
};

export function emptyLevels(): BuildingLevels {
  return {
    METAL_MINE: 0,
    CRYSTAL_MINE: 0,
    DEUTERIUM_MINE: 0,
    SOLAR_PLANT: 0,
    RESEARCH_LAB: 0,
    SHIPYARD: 0,
    ANTIMATTER_SYNTH: 0,
  };
}

/** Стоимость апгрейда до уровня targetLevel (>= 1). */
export function upgradeCost(type: BuildingType, targetLevel: number): ResourceAmounts {
  const cost = COSTS[type];
  const scale = Math.pow(cost.factor, targetLevel - 1);
  return {
    metal: Math.floor(cost.metal * scale),
    crystal: Math.floor(cost.crystal * scale),
    deuterium: Math.floor(cost.deuterium * scale),
  };
}

/**
 * Длительность стройки в секундах: зависит от суммарной стоимости уровня
 * и от модификаторов системы (в черной дыре время течет медленнее).
 */
export function buildSeconds(
  type: BuildingType,
  targetLevel: number,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
): number {
  const cost = upgradeCost(type, targetLevel);
  const total = cost.metal + cost.crystal + cost.deuterium;
  return Math.max(5, Math.round((total / 10) * modifiers.buildTimeMultiplier));
}

/** Невыполненные требования по другим постройкам. */
export function missingBuildingRequirements(
  type: BuildingType,
  levels: BuildingLevels,
): Array<{ building: BuildingType; level: number }> {
  const requirements = BUILDING_REQUIREMENTS[type];
  if (!requirements) return [];

  const missing: Array<{ building: BuildingType; level: number }> = [];
  for (const [building, level] of Object.entries(requirements) as Array<[BuildingType, number]>) {
    if (levels[building] < level) missing.push({ building, level });
  }
  return missing;
}

/** Суммарная выработка энергии базы с учетом технологии «Энергетика». */
export function energyOutput(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
): number {
  const solar =
    levels.SOLAR_PLANT <= 0
      ? 0
      : 2 * levels.SOLAR_PLANT * Math.pow(1.1, levels.SOLAR_PLANT) * richness.energy;
  return (BASE_ENERGY_OUTPUT + solar) * bonuses.energy;
}

/**
 * Суммарное потребление энергии базой: постройки плюс стационарная оборона.
 * Расход обороны приходит числом, чтобы модуль правил не зависел от модуля обороны.
 */
export function energyUsage(levels: BuildingLevels, defenseDrain = 0): number {
  let total = Math.max(0, defenseDrain);
  for (const type of BUILDING_TYPES) {
    total += drain(ENERGY_DRAIN[type], levels[type]);
  }
  return total;
}

function drain(base: number, level: number): number {
  if (level <= 0 || base <= 0) return 0;
  return base * level * Math.pow(1.1, level);
}

/**
 * Коэффициент эффективности базы (Этап 2): если энергии не хватает,
 * добыча всех шахт падает пропорционально дефициту.
 */
export function energyEfficiency(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
  defenseDrain = 0,
): number {
  const usage = energyUsage(levels, defenseDrain);
  if (usage <= 0) return 1;
  const output = energyOutput(levels, richness, bonuses);
  return Math.min(1, output / usage);
}

/** Добыча в секунду с учетом богатства планеты, технологий и дефицита энергии. */
export function productionPerSecond(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
  defenseDrain = 0,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
): BaseStock {
  const efficiency = energyEfficiency(levels, richness, bonuses, defenseDrain);
  return {
    metal: mineOutput('METAL_MINE', levels, richness.metal, bonuses) * efficiency,
    crystal: mineOutput('CRYSTAL_MINE', levels, richness.crystal, bonuses) * efficiency,
    deuterium: mineOutput('DEUTERIUM_MINE', levels, richness.deuterium, bonuses) * efficiency,
    antimatter:
      mineOutput('ANTIMATTER_SYNTH', levels, richness.antimatter, bonuses) *
      efficiency *
      modifiers.antimatterMultiplier,
  };
}

function mineOutput(
  type: MineType,
  levels: BuildingLevels,
  richness: number,
  bonuses: EconomyBonuses,
): number {
  const level = levels[type];
  if (level <= 0) return 0;
  // «Горное дело» ускоряет обычные шахты, но не синтез антиматерии.
  const techBonus = type === 'ANTIMATTER_SYNTH' ? 1 : bonuses.mining;
  return BASE_YIELD_PER_SECOND[type] * level * Math.pow(1.1, level) * richness * techBonus;
}

export function hasEnoughResources(stock: ResourceAmounts, cost: ResourceAmounts): boolean {
  return stock.metal >= cost.metal && stock.crystal >= cost.crystal && stock.deuterium >= cost.deuterium;
}

export function subtractResources(stock: ResourceAmounts, cost: ResourceAmounts): void {
  stock.metal -= cost.metal;
  stock.crystal -= cost.crystal;
  stock.deuterium -= cost.deuterium;
}

export function multiplyResources(cost: ResourceAmounts, factor: number): ResourceAmounts {
  return {
    metal: cost.metal * factor,
    crystal: cost.crystal * factor,
    deuterium: cost.deuterium * factor,
  };
}
