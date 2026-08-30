/**
 * Логистика: дальность, время в пути, грузоподъемность и расход топлива.
 * Модуль чистый: только формулы, без обращения к БД.
 */
import type { ResourceAmounts } from './rules.js';
import type { TechLevels } from './techTree.js';
import { SHIP_TYPES, shipLabel, type ShipCounts, type ShipType } from './ships.js';
import { hasWeapons } from './combat.js';

const FLEET_MISSIONS = [
  'TRANSPORT',
  'SCAN',
  'HUB_DELIVERY',
  'HUB_PICKUP',
  'ATTACK',
  'DEPLOY',
  'EXPEDITION',
  'HARVEST',
] as const;
export type FleetMission = (typeof FLEET_MISSIONS)[number];

export function isFleetMission(value: unknown): value is FleetMission {
  return typeof value === 'string' && (FLEET_MISSIONS as readonly string[]).includes(value);
}

/**
 * Рейс в один конец: флот остается на месте назначения и домой не идет.
 * Пока такая миссия одна, но признак нужен и расчету топлива, и прилету,
 * поэтому живет здесь, а не проверкой `=== 'DEPLOY'` в трех местах.
 */
export function isOneWayMission(mission: FleetMission): boolean {
  return mission === 'DEPLOY';
}

export const MISSION_LABELS: Record<FleetMission, string> = {
  TRANSPORT: 'Транспортировка',
  SCAN: 'Разведка',
  HUB_DELIVERY: 'Доставка на хаб',
  HUB_PICKUP: 'Вывоз с хаба',
  ATTACK: 'Атака',
  DEPLOY: 'Дислокация',
  EXPEDITION: 'Экспедиция',
  HARVEST: 'Переработка',
};

/** Миссии, летящие к торговому хабу, а не к планете. */
export function isHubMission(mission: FleetMission): boolean {
  return mission === 'HUB_DELIVERY' || mission === 'HUB_PICKUP';
}

interface FlightProfile {
  /** Базовая скорость: чем выше, тем короче перелет. */
  speed: number;
  /** Грузоподъемность: руда, полимеры и плазма делят один трюм. */
  cargo: number;
  /** Расход плазмы в секунду полета на один корабль. */
  fuelPerSecond: number;
  /** Расход антиматерии на одну единицу межзвездного расстояния. */
  antimatterPerDistance: number;
}

const FLIGHT_PROFILES: Record<ShipType, FlightProfile> = {
  PROBE: { speed: 200, cargo: 0, fuelPerSecond: 0.05, antimatterPerDistance: 0.2 },
  TRANSPORTER: { speed: 100, cargo: 2000, fuelPerSecond: 0.4, antimatterPerDistance: 1.5 },
  LIGHT_FIGHTER: { speed: 150, cargo: 50, fuelPerSecond: 0.2, antimatterPerDistance: 0.8 },
  // Тяжелые классы медленнее и прожорливее: за огневую мощь платят логистикой.
  HEAVY_CRUISER: { speed: 90, cargo: 300, fuelPerSecond: 0.8, antimatterPerDistance: 2.5 },
  ION_FRIGATE: { speed: 120, cargo: 150, fuelPerSecond: 0.6, antimatterPerDistance: 2.0 },
  // Переработчик: гигантский трюм ценой скорости и расхода плазмы.
  // За один рейс он собирает больше, чем десяток транспортов, но ползет и жжет.
  RECYCLER: { speed: 40, cargo: 20000, fuelPerSecond: 3.0, antimatterPerDistance: 6.0 },
};

/** Базовое время перелета между соседними орбитами, секунды. */
const BASE_FLIGHT_SECONDS = 20;
const SECONDS_PER_ORBIT = 25;
/** Прирост скорости флота за уровень реактивного двигателя. */
const DRIVE_SPEED_BONUS = 0.1;

/** Постоянные затраты на разгон и выход из гиперпространства, секунды. */
const JUMP_BASE_SECONDS = 120;
/** Секунд полета на единицу расстояния между системами. */
const JUMP_SECONDS_PER_DISTANCE = 30;
/** Ускорение прыжка и экономия топлива за уровень гипердвигателя. */
const HYPERDRIVE_BONUS = 0.15;

/** Координаты системы на макро-карте. */
export interface GalaxyPoint {
  galaxyX: number;
  galaxyY: number;
}

/** Расстояние между системами на макро-карте (евклидово, в единицах сетки). */
export function galaxyDistance(from: GalaxyPoint, to: GalaxyPoint): number {
  const dx = from.galaxyX - to.galaxyX;
  const dy = from.galaxyY - to.galaxyY;
  return Math.round(Math.sqrt(dx * dx + dy * dy) * 100) / 100;
}

/** Множитель гипердвигателя: чем выше уровень, тем быстрее и дешевле прыжок. */
function hyperdriveFactor(techs: TechLevels): number {
  return 1 + Math.max(0, techs.HYPERDRIVE) * HYPERDRIVE_BONUS;
}

/** Расстояние в орбитах внутри системы. */
function orbitDistance(fromPosition: number, toPosition: number): number {
  return Math.abs(fromPosition - toPosition);
}

export function fleetSize(ships: ShipCounts): number {
  return SHIP_TYPES.reduce((total, type) => total + ships[type], 0);
}

/** Скорость флота определяется самым медленным кораблем и двигателем. */
function fleetSpeed(ships: ShipCounts, techs: TechLevels): number {
  let slowest = Number.POSITIVE_INFINITY;
  for (const type of SHIP_TYPES) {
    if (ships[type] > 0) slowest = Math.min(slowest, FLIGHT_PROFILES[type].speed);
  }
  if (!Number.isFinite(slowest)) return 0;
  return slowest * (1 + techs.COMBUSTION_DRIVE * DRIVE_SPEED_BONUS);
}

/** Время полета в одну сторону, секунды. */
function flightSeconds(ships: ShipCounts, techs: TechLevels, distance: number): number {
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
 * Расход плазмы за маршрут. `trips` — число концов пути: обычный рейс
 * возвращается домой и платит за два, дислокация остается на месте и платит
 * за один.
 */
function fuelCost(ships: ShipCounts, seconds: number, trips: number): number {
  const perSecond = SHIP_TYPES.reduce(
    (total, type) => total + ships[type] * FLIGHT_PROFILES[type].fuelPerSecond,
    0,
  );
  const total = perSecond * seconds * trips;
  return total <= 0 ? 0 : Math.max(1, Math.ceil(total));
}

export interface FlightPlan {
  /** Внутрисистемный полет или межзвездный прыжок. */
  kind: 'INTRA' | 'INTERSTELLAR';
  /** Орбиты для внутрисистемного полета, единицы сетки — для прыжка. */
  distance: number;
  speed: number;
  flightSeconds: number;
  capacity: number;
  /** Расход плазмы (внутри системы). */
  fuel: number;
  /** Расход антиматерии (межзвездный прыжок). */
  antimatter: number;
}

/**
 * Полный расчет маршрута — используется и при проверке вылета, и для предпросмотра в UI.
 *
 * Логика раздвоена:
 * - внутри системы флот идет на обычной тяге и жжет плазма, время зависит от орбит;
 * - между системами выполняется гиперпрыжок на антиматерии, а время и расход
 *   зависят от расстояния между системами на макро-карте и уровня гипердвигателя.
 */
export function planFlight(
  ships: ShipCounts,
  techs: TechLevels,
  from: { position: number; system: GalaxyPoint },
  to: { position: number; system: GalaxyPoint },
  options: { oneWay?: boolean } = {},
): FlightPlan {
  // Дислокация не возвращается, поэтому и топливо за обратный путь не берем.
  const trips = options.oneWay ? 1 : 2;
  const interstellar =
    from.system.galaxyX !== to.system.galaxyX || from.system.galaxyY !== to.system.galaxyY;

  if (!interstellar) {
    const distance = orbitDistance(from.position, to.position);
    const seconds = flightSeconds(ships, techs, distance);
    return {
      kind: 'INTRA',
      distance,
      speed: Math.round(fleetSpeed(ships, techs)),
      flightSeconds: seconds,
      capacity: fleetCapacity(ships),
      fuel: fuelCost(ships, seconds, trips),
      antimatter: 0,
    };
  }

  const distance = galaxyDistance(from.system, to.system);
  const seconds = jumpSeconds(ships, techs, distance);
  return {
    kind: 'INTERSTELLAR',
    distance,
    speed: Math.round(fleetSpeed(ships, techs)),
    flightSeconds: seconds,
    capacity: fleetCapacity(ships),
    fuel: 0,
    antimatter: jumpAntimatterCost(ships, techs, distance, trips),
  };
}

/** Время гиперпрыжка в одну сторону: расстояние по макро-карте и гипердвигатель. */
function jumpSeconds(ships: ShipCounts, techs: TechLevels, distance: number): number {
  const speed = fleetSpeed(ships, techs);
  if (speed <= 0) return 0;
  const raw =
    ((JUMP_BASE_SECONDS + JUMP_SECONDS_PER_DISTANCE * distance) * 100) / speed / hyperdriveFactor(techs);
  return Math.max(30, Math.round(raw));
}

/** Расход антиматерии за маршрут; `trips` — как и у плазмы, число концов пути. */
function jumpAntimatterCost(
  ships: ShipCounts,
  techs: TechLevels,
  distance: number,
  trips: number,
): number {
  const perDistance = SHIP_TYPES.reduce(
    (total, type) => total + ships[type] * FLIGHT_PROFILES[type].antimatterPerDistance,
    0,
  );
  const total = (perDistance * distance * trips) / hyperdriveFactor(techs);
  return total <= 0 ? 0 : Math.max(1, Math.ceil(total));
}

/** Гиперпрыжок возможен только с изученным гипердвигателем. */
export function canJump(techs: TechLevels): boolean {
  return techs.HYPERDRIVE >= 1;
}

/** Проверка состава флота под задачу. Возвращает текст ошибки или null. */
export function validateComposition(mission: FleetMission, ships: ShipCounts): string | null {
  if (fleetSize(ships) <= 0) return 'Не выбран ни один корабль';
  if (mission === 'SCAN' && ships.PROBE <= 0) return 'Для разведки нужен хотя бы один зонд';
  // Что считается вооруженным, знает боевой модуль — списка классов здесь нет.
  if (mission === 'ATTACK' && !hasWeapons(ships)) {
    return 'Для атаки нужен хотя бы один вооруженный корабль';
  }
  if (mission === 'EXPEDITION' && ships.PROBE === fleetSize(ships)) {
    return 'Одни зонды не выдержат экспедицию — нужен хотя бы один корабль с трюмом';
  }
  if (isHubMission(mission) && fleetCapacity(ships) <= 0) {
    return 'Для рейса на хаб нужен корабль с трюмом';
  }
  // Обломки собирает только специализированный корабль: обычные трюмы
  // для этого не приспособлены, иначе переработчик был бы не нужен.
  if (mission === 'HARVEST' && ships.RECYCLER <= 0) {
    return 'Для сборки обломков нужен хотя бы один переработчик';
  }
  return null;
}

/**
 * Проверка груза: три ресурса делят один трюм.
 * Плазма возится наравне с рудой и полимерами — она и топливо, и товар,
 * поэтому колонии умеют перебрасывать ее между собой.
 */
export function validateCargo(ships: ShipCounts, cargo: ResourceAmounts): string | null {
  if (cargo.ore < 0 || cargo.polymers < 0 || cargo.plasma < 0) {
    return 'Некорректный объем груза';
  }
  const total = cargo.ore + cargo.polymers + cargo.plasma;
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
