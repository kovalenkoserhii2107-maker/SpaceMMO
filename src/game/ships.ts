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
    cost: { ore: 60, polymers: 20, plasma: 10 },
    baseSeconds: 20,
    shipyardLevel: 1,
    requires: { COMPUTING_TECH: 1 },
  },
  SMALL_CARGO: {
    label: 'Малый транспорт «Чайка»',
    description: 'Грузовое судно. Без оружия, только корпус.',
    cost: { ore: 200, polymers: 60, plasma: 20 },
    baseSeconds: 60,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  LARGE_CARGO: {
    label: 'Большой транспорт «Чумак»',
    description: 'Тяжелый грузовик: трюм вшестеро больше «Чайки» и при этом быстрее нее.',
    cost: { ore: 1000, polymers: 400, plasma: 100 },
    baseSeconds: 180,
    shipyardLevel: 4,
    requires: { COMBUSTION_DRIVE: 3 },
  },
  LIGHT_FIGHTER: {
    label: 'Легкий истребитель «Сокіл»',
    description: 'Лазерный урон, только корпус. Дешев и универсален.',
    cost: { ore: 300, polymers: 100, plasma: 0 },
    baseSeconds: 45,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  HEAVY_FIGHTER: {
    label: 'Тяжелый истребитель «Гайдамака»',
    description: 'Втрое живучее «Сокола» и косит мелочь: рой истребителей ему не страшен.',
    cost: { ore: 800, polymers: 300, plasma: 50 },
    baseSeconds: 100,
    shipyardLevel: 3,
    requires: { WEAPONS_TECH: 2 },
  },
  CRUISER: {
    label: 'Тяжелый крейсер «Отаман»',
    description: 'Кинетический урон и толстая броня. Ломает броню, вязнет в щитах.',
    cost: { ore: 2000, polymers: 600, plasma: 150 },
    baseSeconds: 240,
    shipyardLevel: 3,
    requires: { COMBUSTION_DRIVE: 2 },
  },
  FRIGATE: {
    label: 'Ионный фрегат «Характерник»',
    description: 'Ионный урон и сильные щиты. Разбирает щиты, буксует против брони.',
    cost: { ore: 600, polymers: 800, plasma: 150 },
    baseSeconds: 180,
    shipyardLevel: 4,
    requires: { HYPERSPACE_PHYSICS: 1 },
  },
  BOMBER: {
    label: 'Бомбардировщик «Булава»',
    description: 'Специализируется на обороне планет: выносит турели быстрее любого флота.',
    cost: { ore: 4000, polymers: 2000, plasma: 800 },
    baseSeconds: 450,
    shipyardLevel: 6,
    requires: { WEAPONS_TECH: 6 },
  },
  BATTLESHIP: {
    label: 'Линкор «Гетьман»',
    description: 'Основа линейного флота. Пробивает крейсера и бомбардировщики насквозь.',
    cost: { ore: 10000, polymers: 4000, plasma: 2000 },
    baseSeconds: 900,
    shipyardLevel: 7,
    requires: { HYPERDRIVE: 1 },
  },
  CARRIER: {
    label: 'Авианосец «Січ»',
    description:
      'Летающая крепость: гигантский корпус и щит, а залп раскладывается по мелочи — ' +
      'рои истребителей и крейсеров тают за раунд.',
    cost: { ore: 25000, polymers: 15000, plasma: 5000 },
    baseSeconds: 1800,
    shipyardLevel: 8,
    requires: { ASTROPHYSICS: 3 },
  },
  RECYCLER: {
    label: 'Переработчик',
    description:
      'Сборщик обломков. Без оружия, медленный и прожорливый, зато трюм больше, чем у десяти транспортов.',
    cost: { ore: 8000, polymers: 4000, plasma: 2000 },
    baseSeconds: 300,
    shipyardLevel: 4,
    // Тяжелый корпус под гигантский трюм требует развитой тяги.
    requires: { COMBUSTION_DRIVE: 4 },
  },
  COLONY_SHIP: {
    label: 'Колонизатор «Обрій»',
    description:
      'Одноразовый корабль-основатель: садится на свободную планету и разбирается ' +
      'на первую инфраструктуру колонии. Обратно не возвращается.',
    cost: { ore: 10000, polymers: 6000, plasma: 2000 },
    baseSeconds: 400,
    shipyardLevel: 4,
    // Астрофизика нужна и на сам полет к чужой звезде, и на выбор пригодной планеты.
    requires: { ASTROPHYSICS: 1, COMBUSTION_DRIVE: 3 },
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
): number {
  const speedup = 1 + Math.max(0, shipyardLevel) * 0.4;
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
