/**
 * Игровые правила: добыча, энергия, стоимость и длительность построек.
 * Модуль чистый (без I/O) — все расчеты выполняются только на сервере.
 */

export const BUILDING_TYPES = [
  'ORE_MINE',
  'POLYMER_PLANT',
  'PLASMA_REACTOR',
  'POWER_PLANT',
  'SCIENCE_CENTER',
  'SHIPYARD',
  'ANTIMATTER_FACTORY',
  'STORAGE',
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number];

/** Постройки, которые дают ресурсы. */
type MineType = 'ORE_MINE' | 'POLYMER_PLANT' | 'PLASMA_REACTOR' | 'ANTIMATTER_FACTORY';

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && (BUILDING_TYPES as readonly string[]).includes(value);
}

export interface ResourceAmounts {
  ore: number;
  polymers: number;
  plasma: number;
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
  ore: number;
  polymers: number;
  plasma: number;
  energy: number;
  antimatter: number;
}

/**
 * Модификаторы системы. У черной дыры «Искажение времени»:
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
  ORE_MINE: 0.8,
  POLYMER_PLANT: 0.5,
  PLASMA_REACTOR: 0.25,
  // Антиматерия синтезируется на порядки медленнее: это топливо для прыжков,
  // а не сырье для стройки.
  ANTIMATTER_FACTORY: 0.02,
};

/** Базовые стоимости постройки 1 уровня и множитель роста цены. */
const COSTS: Record<BuildingType, ResourceAmounts & { factor: number }> = {
  ORE_MINE: { ore: 60, polymers: 15, plasma: 0, factor: 1.5 },
  POLYMER_PLANT: { ore: 48, polymers: 24, plasma: 0, factor: 1.6 },
  PLASMA_REACTOR: { ore: 225, polymers: 75, plasma: 0, factor: 1.5 },
  POWER_PLANT: { ore: 75, polymers: 30, plasma: 0, factor: 1.5 },
  SCIENCE_CENTER: { ore: 200, polymers: 400, plasma: 100, factor: 2.0 },
  SHIPYARD: { ore: 400, polymers: 200, plasma: 100, factor: 2.0 },
  ANTIMATTER_FACTORY: { ore: 2000, polymers: 1500, plasma: 800, factor: 2.2 },
  STORAGE: { ore: 500, polymers: 250, plasma: 0, factor: 1.6 },
};

/** Потребление энергии постройками. Солнечная станция энергию не тратит. */
const ENERGY_DRAIN: Record<BuildingType, number> = {
  ORE_MINE: 1.0,
  POLYMER_PLANT: 1.0,
  PLASMA_REACTOR: 1.4,
  POWER_PLANT: 0,
  SCIENCE_CENTER: 1.2,
  SHIPYARD: 1.5,
  // Фабрика антиматерии — самый прожорливый объект базы.
  ANTIMATTER_FACTORY: 8,
  // Климат-контроль ангаров: хранилище почти не ест энергию.
  STORAGE: 0.3,
};

/** Требования к уровню других построек. */
const BUILDING_REQUIREMENTS: Partial<Record<BuildingType, Partial<Record<BuildingType, number>>>> = {
  SHIPYARD: { ORE_MINE: 2 },
  SCIENCE_CENTER: { ORE_MINE: 2 },
  ANTIMATTER_FACTORY: { SCIENCE_CENTER: 3, POWER_PLANT: 5 },
};

export const BUILDING_LABELS: Record<BuildingType, string> = {
  ORE_MINE: 'Рудная шахта',
  POLYMER_PLANT: 'Полимерный завод',
  PLASMA_REACTOR: 'Плазменный реактор',
  POWER_PLANT: 'Энергетическая станция',
  SCIENCE_CENTER: 'Научный центр',
  SHIPYARD: 'Верфь',
  ANTIMATTER_FACTORY: 'Фабрика антиматерии',
  STORAGE: 'Склад ресурсов',
};

export function emptyLevels(): BuildingLevels {
  return {
    ORE_MINE: 0,
    POLYMER_PLANT: 0,
    PLASMA_REACTOR: 0,
    POWER_PLANT: 0,
    SCIENCE_CENTER: 0,
    SHIPYARD: 0,
    ANTIMATTER_FACTORY: 0,
    STORAGE: 0,
  };
}

/** Стоимость апгрейда до уровня targetLevel (>= 1). */
export function upgradeCost(type: BuildingType, targetLevel: number): ResourceAmounts {
  const cost = COSTS[type];
  const scale = Math.pow(cost.factor, targetLevel - 1);
  return {
    ore: Math.floor(cost.ore * scale),
    polymers: Math.floor(cost.polymers * scale),
    plasma: Math.floor(cost.plasma * scale),
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
  /**
   * Во сколько раз быстрее идет стройка: робототехника и «Сжатие времени».
   * Передается числом, а не уровнями технологий: `rules.ts` о дереве
   * технологий ничего не знает и знать не должен — оно импортирует правила,
   * и обратная зависимость замкнула бы модули в кольцо.
   */
  speedup = 1,
): number {
  const cost = upgradeCost(type, targetLevel);
  const total = cost.ore + cost.polymers + cost.plasma;
  return Math.max(5, Math.round(((total / 10) * modifiers.buildTimeMultiplier) / Math.max(1, speedup)));
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
    levels.POWER_PLANT <= 0
      ? 0
      : 2 * levels.POWER_PLANT * Math.pow(1.1, levels.POWER_PLANT) * richness.energy;
  return (BASE_ENERGY_OUTPUT + solar) * bonuses.energy;
}

/**
 * Суммарное потребление энергии базой: постройки плюс стационарная оборона.
 * Расход обороны приходит числом, чтобы модуль правил не зависел от модуля обороны.
 */
export function energyUsage(
  levels: BuildingLevels,
  defenseDrain = 0,
  /** Расход сверх построек и обороны: «Сжатие времени» питается постоянно. */
  techDrain = 0,
): number {
  let total = Math.max(0, defenseDrain) + Math.max(0, techDrain);
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
 * Коэффициент эффективности базы: если энергии не хватает,
 * добыча всех шахт падает пропорционально дефициту.
 */
export function energyEfficiency(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
  defenseDrain = 0,
  techDrain = 0,
): number {
  const usage = energyUsage(levels, defenseDrain, techDrain);
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
  /** Расход энергии сверх построек: «Сжатие времени» питается постоянно. */
  techDrain = 0,
): BaseStock {
  const efficiency = energyEfficiency(levels, richness, bonuses, defenseDrain, techDrain);
  return {
    ore: mineOutput('ORE_MINE', levels, richness.ore, bonuses) * efficiency,
    polymers: mineOutput('POLYMER_PLANT', levels, richness.polymers, bonuses) * efficiency,
    plasma: mineOutput('PLASMA_REACTOR', levels, richness.plasma, bonuses) * efficiency,
    antimatter:
      mineOutput('ANTIMATTER_FACTORY', levels, richness.antimatter, bonuses) *
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
  const techBonus = type === 'ANTIMATTER_FACTORY' ? 1 : bonuses.mining;
  return BASE_YIELD_PER_SECOND[type] * level * Math.pow(1.1, level) * richness * techBonus;
}

/* ------------------------- Хранилище ------------------------- */

/**
 * Вместимость склада базы.
 *
 * Лимит общий на руду, полимеры и плазму: базы копят «тоннаж», а не три
 * независимых кучи. Антиматерия под лимит не попадает — она хранится в отдельных
 * магнитных ловушках и в трюмах не возится.
 *
 * Уровень 0 — колониальный резерв без постройки: небольшой запас, чтобы новая
 * колония успела отстроить первое хранилище. Дальше вместимость растет по
 * экспоненте: 10 000 → 15 000 → 22 500 → …
 */
export const BASE_STORAGE_CAPACITY = 5_000;
const STORAGE_LEVEL_ONE_CAPACITY = 10_000;
const STORAGE_GROWTH = 1.5;

/** Доля вместимости, которую хранилище прячет от грабежа. */
export const PROTECTED_STORAGE_SHARE = 0.9;

export function storageCapacityForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return BASE_STORAGE_CAPACITY;
  return Math.floor(STORAGE_LEVEL_ONE_CAPACITY * Math.pow(STORAGE_GROWTH, level - 1));
}

export function storageCapacity(levels: BuildingLevels): number {
  return storageCapacityForLevel(levels.STORAGE);
}

/** Сколько «тоннажа» занято: антиматерия в лимит не входит. */
export function storedTotal(stock: ResourceAmounts): number {
  return Math.max(0, stock.ore) + Math.max(0, stock.polymers) + Math.max(0, stock.plasma);
}

export interface StorageState {
  capacity: number;
  used: number;
  free: number;
  /** Заполненность 0..1; больше 1, если склад успели переполнить извне. */
  fill: number;
  /** Добыча остановлена: свободного места не осталось. */
  full: boolean;
  /** Несгораемый объем — его грабеж не достает. */
  protectedAmount: number;
  /** Излишек сверх несгораемого объема: именно он уязвим при поражении. */
  vulnerable: number;
}

/**
 * Состояние склада для интерфейса и для расчета грабежа.
 *
 * Переполнение — штатная ситуация: добыча в потолок упирается, но флот с добычей,
 * возврат залога с биржи или трофеи экспедиции могут занести ресурсы сверх лимита.
 * Такой излишек не исчезает, но и не защищен.
 */
export function storageState(stock: ResourceAmounts, capacity: number): StorageState {
  const used = storedTotal(stock);
  const protectedAmount = Math.min(used, capacity * PROTECTED_STORAGE_SHARE);

  return {
    capacity,
    used,
    free: Math.max(0, capacity - used),
    fill: capacity > 0 ? used / capacity : 1,
    full: used >= capacity,
    protectedAmount,
    vulnerable: Math.max(0, used - protectedAmount),
  };
}

export function hasEnoughResources(stock: ResourceAmounts, cost: ResourceAmounts): boolean {
  return stock.ore >= cost.ore && stock.polymers >= cost.polymers && stock.plasma >= cost.plasma;
}

export function subtractResources(stock: ResourceAmounts, cost: ResourceAmounts): void {
  stock.ore -= cost.ore;
  stock.polymers -= cost.polymers;
  stock.plasma -= cost.plasma;
}

export function multiplyResources(cost: ResourceAmounts, factor: number): ResourceAmounts {
  return {
    ore: cost.ore * factor,
    polymers: cost.polymers * factor,
    plasma: cost.plasma * factor,
  };
}
