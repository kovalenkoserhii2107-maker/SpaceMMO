/**
 * Логистика (Этап 3): дальность, время в пути, грузоподъемность и расход топлива.
 * Модуль чистый: только формулы, без обращения к БД.
 */
import type { ResourceAmounts } from './rules.js';
import type { TechLevels } from './techTree.js';
import { SHIP_TYPES, shipLabel, type ShipCounts, type ShipType } from './ships.js';

export const FLEET_MISSIONS = ['TRANSPORT', 'SCAN', 'HUB_DELIVERY', 'HUB_PICKUP', 'ATTACK'] as const;
export type FleetMission = (typeof FLEET_MISSIONS)[number];

export function isFleetMission(value: unknown): value is FleetMission {
  return typeof value === 'string' && (FLEET_MISSIONS as readonly string[]).includes(value);
}

export const MISSION_LABELS: Record<FleetMission, string> = {
  TRANSPORT: 'Транспортировка',
  SCAN: 'Разведка',
  HUB_DELIVERY: 'Доставка на хаб',
  HUB_PICKUP: 'Вывоз с хаба',
  ATTACK: 'Атака',
};

/** Миссии, летящие к торговому хабу, а не к планете. */
export function isHubMission(mission: FleetMission): boolean {
  return mission === 'HUB_DELIVERY' || mission === 'HUB_PICKUP';
}

interface FlightProfile {
  /** Базовая скорость: чем выше, тем короче перелет. */
  speed: number;
  /** Грузоподъемность (металл + кристаллы). */
  cargo: number;
  /** Расход дейтерия в секунду полета на один корабль. */
  fuelPerSecond: number;
}

const FLIGHT_PROFILES: Record<ShipType, FlightProfile> = {
  PROBE: { speed: 200, cargo: 0, fuelPerSecond: 0.05 },
  TRANSPORTER: { speed: 100, cargo: 2000, fuelPerSecond: 0.4 },
  LIGHT_FIGHTER: { speed: 150, cargo: 50, fuelPerSecond: 0.2 },
};

/** Базовое время перелета между соседними орбитами, секунды. */
const BASE_FLIGHT_SECONDS = 20;
const SECONDS_PER_ORBIT = 25;
/** Прирост скорости флота за уровень реактивного двигателя. */
const DRIVE_SPEED_BONUS = 0.1;

export function shipSpeed(type: ShipType): number {
  return FLIGHT_PROFILES[type].speed;
}

export function shipCargo(type: ShipType): number {
  return FLIGHT_PROFILES[type].cargo;
}

export function shipFuelPerSecond(type: ShipType): number {
  return FLIGHT_PROFILES[type].fuelPerSecond;
}

/** Расстояние в орбитах внутри системы. */
export function orbitDistance(fromPosition: number, toPosition: number): number {
  return Math.abs(fromPosition - toPosition);
}

export function fleetSize(ships: ShipCounts): number {
  return SHIP_TYPES.reduce((total, type) => total + ships[type], 0);
}

/** Скорость флота определяется самым медленным кораблем и двигателем. */
export function fleetSpeed(ships: ShipCounts, techs: TechLevels): number {
  let slowest = Number.POSITIVE_INFINITY;
  for (const type of SHIP_TYPES) {
    if (ships[type] > 0) slowest = Math.min(slowest, FLIGHT_PROFILES[type].speed);
  }
  if (!Number.isFinite(slowest)) return 0;
  return slowest * (1 + techs.COMBUSTION_DRIVE * DRIVE_SPEED_BONUS);
}

/** Время полета в одну сторону, секунды. */
export function flightSeconds(ships: ShipCounts, techs: TechLevels, distance: number): number {
  const speed = fleetSpeed(ships, techs);
  if (speed <= 0) return 0;
  const raw = ((BASE_FLIGHT_SECONDS + SECONDS_PER_ORBIT * distance) * 100) / speed;
  return Math.max(5, Math.round(raw));
}

/** Суммарная грузоподъемность флота. */
export function fleetCapacity(ships: ShipCounts): number {
  return SHIP_TYPES.reduce((total, type) => total + ships[type] * FLIGHT_PROFILES[type].cargo, 0);
}

/**
 * Расход дейтерия за весь маршрут (туда и обратно).
 * Зависит от состава флота и времени в пути, как и требует ТЗ.
 */
export function fuelCost(ships: ShipCounts, seconds: number): number {
  const perSecond = SHIP_TYPES.reduce(
    (total, type) => total + ships[type] * FLIGHT_PROFILES[type].fuelPerSecond,
    0,
  );
  const total = perSecond * seconds * 2;
  return total <= 0 ? 0 : Math.max(1, Math.ceil(total));
}

export interface FlightPlan {
  distance: number;
  speed: number;
  flightSeconds: number;
  capacity: number;
  fuel: number;
}

/** Полный расчет маршрута — используется и при проверке, и для предпросмотра в UI. */
export function planFlight(
  ships: ShipCounts,
  techs: TechLevels,
  fromPosition: number,
  toPosition: number,
): FlightPlan {
  const distance = orbitDistance(fromPosition, toPosition);
  const seconds = flightSeconds(ships, techs, distance);
  return {
    distance,
    speed: Math.round(fleetSpeed(ships, techs)),
    flightSeconds: seconds,
    capacity: fleetCapacity(ships),
    fuel: fuelCost(ships, seconds),
  };
}

/** Проверка состава флота под задачу. Возвращает текст ошибки или null. */
export function validateComposition(mission: FleetMission, ships: ShipCounts): string | null {
  if (fleetSize(ships) <= 0) return 'Не выбран ни один корабль';
  if (mission === 'SCAN' && ships.PROBE <= 0) return 'Для разведки нужен хотя бы один зонд';
  if (mission === 'ATTACK' && ships.LIGHT_FIGHTER <= 0 && ships.TRANSPORTER <= 0) {
    return 'Для атаки нужны боевые корабли или транспорты';
  }
  if (isHubMission(mission) && fleetCapacity(ships) <= 0) {
    return 'Для рейса на хаб нужен корабль с трюмом';
  }
  return null;
}

/** Проверка груза: только металл и кристаллы, в пределах трюма. */
export function validateCargo(
  ships: ShipCounts,
  cargo: Pick<ResourceAmounts, 'metal' | 'crystal'>,
): string | null {
  if (cargo.metal < 0 || cargo.crystal < 0) return 'Некорректный объем груза';
  const total = cargo.metal + cargo.crystal;
  if (total <= 0) return null;

  const capacity = fleetCapacity(ships);
  if (total > capacity) {
    return `Трюмы вмещают ${capacity}, а загружено ${Math.round(total)}`;
  }
  return null;
}

export function describeComposition(ships: ShipCounts): string {
  return SHIP_TYPES.filter((type) => ships[type] > 0)
    .map((type) => `${shipLabel(type)} ×${ships[type]}`)
    .join(', ');
}
