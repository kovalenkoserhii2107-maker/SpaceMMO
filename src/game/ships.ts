/**
 * Верфь и классы кораблей.
 *
 * У каждого класса есть боевой профиль — тип урона и слои защиты.
 * Экономика (цена, время, требования) живет здесь, а математика боя — в combat.ts.
 */
import {
  NEUTRAL_MODIFIERS,
  type BuildingLevels,
  type ResourceAmounts,
  type SystemModifiers,
} from './rules.js';
import type { Requirement, TechLevels, TechnologyType } from './techTree.js';
import { techLabel } from './techTree.js';

export const SHIP_TYPES = [
  'PROBE',
  'SMALL_CARGO',
  'LARGE_CARGO',
  'LIGHT_FIGHTER',
  'HEAVY_FIGHTER',
  'CRUISER',
  'FRIGATE',
  'BOMBER',
  'BATTLESHIP',
  'CARRIER',
  'RECYCLER',
  'COLONY_SHIP',
] as const;

export type ShipType = (typeof SHIP_TYPES)[number];

export type ShipCounts = Record<ShipType, number>;

/**
 * Классы, из которых складывается эскадра.
 *
 * Зонд, переработчик и колонизатор сюда не входят: это инструменты под задачу,
 * а не доля постоянного состава. Их заказывают, когда нужно разведать, собрать
 * поле или занять планету, — держать их «в пропорции» бессмысленно.
 *
 * Различие не косметическое. Языковой модели показывают текущий состав флота,
 * и она зеркалит его в желаемый: увидев полсотни зондов, она ставит зондам
 * половину доли, код честно достраивает до нее, в следующей сводке зондов
 * становится больше — петля кормит сама себя. Живой бот довел так до девяноста
 * четырех штук.
 */
export const SQUADRON_TYPES = SHIP_TYPES.filter(
  (type) => type !== 'PROBE' && type !== 'RECYCLER' && type !== 'COLONY_SHIP',
);

/**
 * Классы, которые действительно дерутся.
 *
 * Отдельно от `SQUADRON_TYPES`, куда входят и грузовики: там речь о составе
 * заказа, а здесь — о боевой силе. Смешивать их нельзя. Живой агрессор потерял
 * пятьдесят три истребителя из пятидесяти трех, оставшись с семью десятками
 * транспортов, — по общей стоимости флота это выглядело как 44% от лучшей
 * формы, и порог отступления не срабатывал. Он ходил в набеги с одними
 * грузовиками и проигрывал тридцать четыре боя подряд.
 */
export const COMBAT_TYPES = SHIP_TYPES.filter(
  (type) =>
    type !== 'PROBE' &&
    type !== 'RECYCLER' &&
    type !== 'COLONY_SHIP' &&
    type !== 'SMALL_CARGO' &&
    type !== 'LARGE_CARGO',
);

export function isShipType(value: unknown): value is ShipType {
  return typeof value === 'string' && (SHIP_TYPES as readonly string[]).includes(value);
}

export function emptyShipCounts(): ShipCounts {
  return {
    PROBE: 0,
    SMALL_CARGO: 0,
    LARGE_CARGO: 0,
    LIGHT_FIGHTER: 0,
    HEAVY_FIGHTER: 0,
    CRUISER: 0,
    FRIGATE: 0,
    BOMBER: 0,
    BATTLESHIP: 0,
    CARRIER: 0,
    RECYCLER: 0,
    COLONY_SHIP: 0,
  };
}

interface ShipDefinition {
  label: string;
  description: string;
  cost: ResourceAmounts;
  /** Базовая длительность постройки одного корабля в секундах. */
  baseSeconds: number;
  shipyardLevel: number;
  requires: Partial<Record<TechnologyType, number>>;
}

/*
 * Арсенал. Каждый класс занимает свою роль, и роли намеренно не пересекаются:
 * два корабля с одинаковой задачей означают, что один из них всегда хуже.
 *
 * Легкая линия — расходники и грузовики, средняя — рабочие лошадки боя,
 * тяжелая (бомбардировщик, линкор, авианосец) закрывает лейтгейм и стоит
 * соответственно: один линкор дороже двадцати истребителей.
 */
const SHIPS: Record<ShipType, ShipDefinition> = {
  PROBE: {
    label: 'Зонд «Око»',
    description: 'Дешевый разведывательный дрон. Без оружия и защиты.',
    cost: { ore: 100, polymers: 76, plasma: 20 },
    baseSeconds: 20,
    shipyardLevel: 1,
    // Зонд — шпионский дрон, а не телескоп: без «Шпионажа» его не собрать.
    // Следствие принято сознательно: ранняя разведка отодвигается на всю
    // ветку, и первые сутки агрессор не воюет вовсе.
    requires: { ESPIONAGE: 1 },
  },
  SMALL_CARGO: {
    label: 'Малый транспорт «Чайка»',
    description: 'Грузовое судно. Без оружия, только корпус.',
    cost: { ore: 900, polymers: 570, plasma: 100 },
    baseSeconds: 60,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  LARGE_CARGO: {
    label: 'Большой транспорт «Чумак»',
    description: 'Тяжелый грузовик: трюм вшестеро больше «Чайки» и при этом быстрее нее.',
    cost: { ore: 9000, polymers: 6650, plasma: 1200 },
    baseSeconds: 300,
    shipyardLevel: 6,
    requires: { COMBUSTION_DRIVE: 6 },
  },
  LIGHT_FIGHTER: {
    label: 'Легкий истребитель «Сокіл»',
    description: 'Лазерный урон, только корпус. Дешев и универсален.',
    cost: { ore: 1400, polymers: 950, plasma: 100 },
    baseSeconds: 45,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  HEAVY_FIGHTER: {
    label: 'Тяжелый истребитель «Гайдамака»',
    description: 'Втрое живучее «Сокола» и косит мелочь: рой истребителей ему не страшен.',
    cost: { ore: 5000, polymers: 3800, plasma: 400 },
    baseSeconds: 120,
    shipyardLevel: 4,
    requires: { WEAPONS_TECH: 4 },
  },
  CRUISER: {
    label: 'Тяжелый крейсер «Отаман»',
    description: 'Кинетический урон и толстая броня. Ломает броню, вязнет в щитах.',
    cost: { ore: 18000, polymers: 11400, plasma: 1800 },
    baseSeconds: 300,
    shipyardLevel: 5,
    requires: { COMBUSTION_DRIVE: 5 },
  },
  FRIGATE: {
    label: 'Ионный фрегат «Характерник»',
    description: 'Ионный урон и сильные щиты. Разбирает щиты, буксует против брони.',
    cost: { ore: 6000, polymers: 13300, plasma: 1500 },
    baseSeconds: 260,
    shipyardLevel: 7,
    requires: { HYPERSPACE_PHYSICS: 4 },
  },
  BOMBER: {
    label: 'Бомбардировщик «Булава»',
    description: 'Специализируется на обороне планет: выносит турели быстрее любого флота.',
    cost: { ore: 90000, polymers: 85500, plasma: 18000 },
    baseSeconds: 600,
    shipyardLevel: 9,
    requires: { WEAPONS_TECH: 10 },
  },
  BATTLESHIP: {
    label: 'Линкор «Гетьман»',
    description: 'Основа линейного флота. Пробивает крейсера и бомбардировщики насквозь.',
    cost: { ore: 420000, polymers: 323000, plasma: 80000 },
    baseSeconds: 1200,
    shipyardLevel: 11,
    requires: { HYPERDRIVE: 7 },
  },
  CARRIER: {
    label: 'Авианосец «Січ»',
    description:
      'Летающая крепость: гигантский корпус и щит, а залп раскладывается по мелочи — ' +
      'рои истребителей и крейсеров тают за раунд.',
    cost: { ore: 2200000, polymers: 2470000, plasma: 600000 },
    baseSeconds: 2400,
    shipyardLevel: 12,
    requires: { ASTROPHYSICS: 11 },
  },
  RECYCLER: {
    label: 'Переработчик',
    description:
      'Сборщик обломков. Без оружия, медленный и прожорливый, зато трюм больше, чем у десяти транспортов.',
    cost: { ore: 45000, polymers: 41800, plasma: 9000 },
    baseSeconds: 400,
    shipyardLevel: 8,
    // Тяжелый корпус под гигантский трюм требует развитой тяги.
    requires: { COMBUSTION_DRIVE: 8 },
  },
  COLONY_SHIP: {
    label: 'Колонизатор «Обрій»',
    description:
      'Одноразовый корабль-основатель: садится на свободную планету и разбирается ' +
      'на первую инфраструктуру колонии. Обратно не возвращается.',
    cost: { ore: 70000, polymers: 76000, plasma: 18000 },
    baseSeconds: 500,
    shipyardLevel: 9,
    // Астрофизика нужна и на сам полет к чужой звезде, и на выбор пригодной планеты.
    requires: { ASTROPHYSICS: 9, COMBUSTION_DRIVE: 5 },
  },
};

export const MAX_SHIP_ORDER = 100;

export function shipLabel(type: ShipType): string {
  return SHIPS[type].label;
}

export function shipDescription(type: ShipType): string {
  return SHIPS[type].description;
}

export function shipCost(type: ShipType): ResourceAmounts {
  return { ...SHIPS[type].cost };
}

/**
 * Длительность постройки одного корабля: ускоряется уровнем верфи
 * и замедляется искажением времени в системе с черной дырой.
 */
export function shipUnitSeconds(
  type: ShipType,
  shipyardLevel: number,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
  /**
   * Ускорение от технологий: робототехника и «Сжатие времени». Числом,
   * а не уровнями, — модуль о дереве технологий не знает.
   */
  techSpeedup = 1,
): number {
  const speedup = (1 + Math.max(0, shipyardLevel) * 0.4) * Math.max(1, techSpeedup);
  return Math.max(3, Math.round((SHIPS[type].baseSeconds / speedup) * modifiers.buildTimeMultiplier));
}

/** Невыполненные требования для постройки корабля. */
export function missingShipRequirements(
  type: ShipType,
  levels: BuildingLevels,
  techs: TechLevels,
): Requirement[] {
  const definition = SHIPS[type];
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
