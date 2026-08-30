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
  'TRANSPORTER',
  'LIGHT_FIGHTER',
  'HEAVY_CRUISER',
  'ION_FRIGATE',
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
    TRANSPORTER: 0,
    LIGHT_FIGHTER: 0,
    HEAVY_CRUISER: 0,
    ION_FRIGATE: 0,
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

const SHIPS: Record<ShipType, ShipDefinition> = {
  PROBE: {
    label: 'Зонд-разведчик',
    description: 'Дешевый разведывательный дрон. Без оружия и защиты.',
    cost: { ore: 60, polymers: 20, plasma: 10 },
    baseSeconds: 20,
    shipyardLevel: 1,
    requires: { COMPUTING_TECH: 1 },
  },
  TRANSPORTER: {
    label: 'Малый транспорт',
    description: 'Грузовое судно. Без оружия, только корпус.',
    cost: { ore: 200, polymers: 60, plasma: 20 },
    baseSeconds: 60,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  LIGHT_FIGHTER: {
    label: 'Легкий истребитель',
    description: 'Лазерный урон, только корпус. Дешев и универсален.',
    cost: { ore: 300, polymers: 100, plasma: 0 },
    baseSeconds: 45,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  HEAVY_CRUISER: {
    label: 'Тяжелый крейсер',
    description: 'Кинетический урон и толстая броня. Ломает броню, вязнет в щитах.',
    cost: { ore: 1200, polymers: 400, plasma: 100 },
    baseSeconds: 180,
    shipyardLevel: 3,
    requires: { COMBUSTION_DRIVE: 2 },
  },
  ION_FRIGATE: {
    label: 'Ионный фрегат',
    description: 'Ионный урон и сильные щиты. Разбирает щиты, буксует против брони.',
    cost: { ore: 500, polymers: 600, plasma: 150 },
    baseSeconds: 150,
    shipyardLevel: 4,
    requires: { HYPERSPACE_PHYSICS: 1 },
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
    label: 'Колониальный транспорт',
    description:
      'Одноразовый корабль-основатель: садится на свободную планету и разбирается ' +
      'на первую инфраструктуру колонии. Обратно не возвращается.',
    // Дороже переработчика: это не рейс за обломками, а новая база навсегда.
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
