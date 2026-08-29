/**
 * Верфь и базовые классы кораблей (Этап 2).
 * Перемещение флота, грузоподъемность и бой — следующие этапы, здесь только постройка.
 */
import type { BuildingLevels, ResourceAmounts } from './rules.js';
import type { Requirement, TechLevels, TechnologyType } from './techTree.js';
import { techLabel } from './techTree.js';

export const SHIP_TYPES = ['PROBE', 'TRANSPORTER', 'LIGHT_FIGHTER'] as const;

export type ShipType = (typeof SHIP_TYPES)[number];

export type ShipCounts = Record<ShipType, number>;

export function isShipType(value: unknown): value is ShipType {
  return typeof value === 'string' && (SHIP_TYPES as readonly string[]).includes(value);
}

export function emptyShipCounts(): ShipCounts {
  return { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 0 };
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
    description: 'Дешевый разведывательный дрон.',
    cost: { metal: 60, crystal: 20, deuterium: 10 },
    baseSeconds: 20,
    shipyardLevel: 1,
    requires: { COMPUTING_TECH: 1 },
  },
  TRANSPORTER: {
    label: 'Малый транспорт',
    description: 'Грузовое судно для перевозки ресурсов.',
    cost: { metal: 200, crystal: 60, deuterium: 20 },
    baseSeconds: 60,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
  },
  LIGHT_FIGHTER: {
    label: 'Легкий истребитель',
    description: 'Базовый боевой корабль сопровождения.',
    cost: { metal: 300, crystal: 100, deuterium: 0 },
    baseSeconds: 45,
    shipyardLevel: 2,
    requires: { COMBUSTION_DRIVE: 1 },
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

/** Длительность постройки одного корабля: ускоряется уровнем верфи. */
export function shipUnitSeconds(type: ShipType, shipyardLevel: number): number {
  const speedup = 1 + Math.max(0, shipyardLevel) * 0.4;
  return Math.max(3, Math.round(SHIPS[type].baseSeconds / speedup));
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
