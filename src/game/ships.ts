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
] as const;

export type ShipType = (typeof SHIP_TYPES)[number];

export type ShipCounts = Record<ShipType, number>;

export function isShipType(value: unknown): value is ShipType {
  return typeof value === 'string' && (SHIP_TYPES as readonly string[]).includes(value);
}

export function emptyShipCounts(): ShipCounts {
  return { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 0, HEAVY_CRUISER: 0, ION_FRIGATE: 0 };
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
    cost: { metal: 60, crystal: 20, deuterium: 10 },
    baseSeconds: 20,
    shipyardLevel: 1,
    requires: { COMPUTING_TECH: 1 },
  },
  TRANSPORTER: {
    label: 'Малый транспорт',
    description: 'Грузовое судно. Без оружия, только корпус.',
    cost: { metal: 200, crystal: 60, deuterium: 20 },
    baseSeconds: 60,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  LIGHT_FIGHTER: {
    label: 'Легкий истребитель',
    description: 'Лазерный урон, только корпус. Дешев и универсален.',
    cost: { metal: 300, crystal: 100, deuterium: 0 },
    baseSeconds: 45,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  HEAVY_CRUISER: {
    label: 'Тяжелый крейсер',
    description: 'Кинетический урон и толстая броня. Ломает броню, вязнет в щитах.',
    cost: { metal: 1200, crystal: 400, deuterium: 100 },
    baseSeconds: 180,
    shipyardLevel: 3,
    requires: { COMBUSTION_DRIVE: 2 },
  },
  ION_FRIGATE: {
    label: 'Ионный фрегат',
    description: 'Ионный урон и сильные щиты. Разбирает щиты, буксует против брони.',
    cost: { metal: 500, crystal: 600, deuterium: 150 },
    baseSeconds: 150,
    shipyardLevel: 4,
    requires: { HYPERSPACE_PHYSICS: 1 },
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
