/**
 * Логистика: дальность, время в пути, грузоподъемность и расход топлива.
 * Модуль чистый: только формулы, без обращения к БД.
 */
import { GATE_JUMP_SECONDS, GATE_POSITION, gateAntimatterShare } from './syndicate.js';
import type { ResourceAmounts } from './rules.js';
import type { TechLevels } from './techTree.js';
import { emptyShipCounts, SHIP_TYPES, shipLabel, type ShipCounts, type ShipType } from './ships.js';
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
  'COLONIZE',
  'KISH_DELIVERY',
  'KISH_PICKUP',
  'HOLD',
  'KISH_RAID',
  'GATE_SIEGE',
] as const;
export type FleetMission = (typeof FLEET_MISSIONS)[number];

export function isFleetMission(value: unknown): value is FleetMission {
  return typeof value === 'string' && (FLEET_MISSIONS as readonly string[]).includes(value);
}

/**
 * Рейс в один конец: флот остается на месте назначения и домой не идет.
 * Признак нужен и расчету топлива, и прилету, поэтому живет здесь,
 * а не проверкой на конкретную миссию в трех местах.
 *
 * Колонизация односторонняя по той же причине, что и дислокация: флот
 * остается новой колонии. Если сесть не удалось, обратный путь оплачен не был
 * и флот возвращается даром — это честнее, чем бросить его на орбите.
 */
export function isOneWayMission(mission: FleetMission): boolean {
  return mission === 'DEPLOY' || mission === 'COLONIZE';
}

/** Может ли игрок сам решить, останется ли флот в точке назначения. */
export function allowsOneWayChoice(mission: FleetMission): boolean {
  return mission === 'TRANSPORT';
}

/**
 * Итоговая односторонность рейса.
 *
 * У дислокации и колонизации она свойство самой миссии и выбору не подлежит.
 * Транспорт летит и так, и так: обычная доставка возвращает корабли домой,
 * а помощь союзнику может уйти вместе с ними — именно этим передают флот.
 */
export function resolveOneWay(mission: FleetMission, requested: boolean): boolean {
  if (isOneWayMission(mission)) return true;
  return allowsOneWayChoice(mission) && requested;
}

export const MISSION_LABELS: Record<FleetMission, string> = {
  TRANSPORT: 'Транспортировка',
  SCAN: 'Разведка',
  HUB_DELIVERY: 'Доставка на хаб',
  HUB_PICKUP: 'Вывоз с хаба',
  KISH_DELIVERY: 'Доставка в Кіш',
  KISH_PICKUP: 'Вывоз из казны Коша',
  HOLD: 'Удержание',
  KISH_RAID: 'Налет на Кіш',
  GATE_SIEGE: 'Осада Брамы',
  ATTACK: 'Атака',
  DEPLOY: 'Дислокация',
  EXPEDITION: 'Экспедиция',
  HARVEST: 'Переработка',
  COLONIZE: 'Колонизация',
};

/** Миссии, летящие к торговому хабу, а не к планете. */
export function isHubMission(mission: FleetMission): boolean {
  return mission === 'HUB_DELIVERY' || mission === 'HUB_PICKUP';
}

/** Рейс в Кіш своего синдиката: доставка в казну или вывоз из нее. */
export function isKishMission(mission: FleetMission): boolean {
  return mission === 'KISH_DELIVERY' || mission === 'KISH_PICKUP';
}

interface FlightProfile {
  /** Скорость на обычной тяге, внутри системы: чем выше, тем короче перелет. */
  speed: number;
  /**
   * Скорость в гиперпространстве, между системами. У всех, кроме зонда,
   * она равна обычной; зонд — курьер: систему он пересекает за секунды,
   * а галактику за пару минут, и в состав флота это не переносится —
   * флот идет со скоростью самого медленного.
   */
  warp: number;
  /** Грузоподъемность: руда, полимеры и плазма делят один трюм. */
  cargo: number;
  /** Расход плазмы в секунду полета на один корабль. */
  fuelPerSecond: number;
  /** Расход антиматерии на одну единицу межзвездного расстояния. */
  antimatterPerDistance: number;
}

/** Летные данные класса. Нужны карточке подробностей: трюм и скорость решают
 * выбор транспорта не меньше цены, а вычислять их на клиенте нельзя (правило 3). */
export function flightProfile(type: ShipType): FlightProfile {
  return { ...FLIGHT_PROFILES[type] };
}

const FLIGHT_PROFILES: Record<ShipType, FlightProfile> = {
  /*
   * Зонд — единственный курьер: через систему за двадцать секунд, через всю
   * галактику за две минуты. Разведка должна успевать раньше флота, который
   * по ней посылают, иначе снимок устаревал бы в пути.
   */
  PROBE: { speed: 6000, warp: 180000, cargo: 0, fuelPerSecond: 0.05, antimatterPerDistance: 0.2 },
  SMALL_CARGO: { speed: 100, warp: 100, cargo: 2000, fuelPerSecond: 0.4, antimatterPerDistance: 1.5 },
  // «Чумак» быстрее «Чайки»: за шестикратный трюм платят не скоростью, а ценой
  // постройки и расходом — иначе большой грузовик не имел бы смысла вовсе.
  LARGE_CARGO: { speed: 140, warp: 140, cargo: 12000, fuelPerSecond: 1.2, antimatterPerDistance: 3.0 },
  LIGHT_FIGHTER: { speed: 150, warp: 150, cargo: 50, fuelPerSecond: 0.2, antimatterPerDistance: 0.8 },
  HEAVY_FIGHTER: { speed: 130, warp: 130, cargo: 100, fuelPerSecond: 0.4, antimatterPerDistance: 1.2 },
  // Тяжелые классы медленнее и прожорливее: за огневую мощь платят логистикой.
  CRUISER: { speed: 90, warp: 90, cargo: 300, fuelPerSecond: 0.8, antimatterPerDistance: 2.5 },
  FRIGATE: { speed: 120, warp: 120, cargo: 150, fuelPerSecond: 0.6, antimatterPerDistance: 2.0 },
  BOMBER: { speed: 70, warp: 70, cargo: 500, fuelPerSecond: 1.5, antimatterPerDistance: 4.0 },
  BATTLESHIP: { speed: 85, warp: 85, cargo: 1500, fuelPerSecond: 2.5, antimatterPerDistance: 6.0 },
  // Авианосец тормозит любой флот, в котором идет: это цена его залпа по мелочи.
  CARRIER: { speed: 60, warp: 60, cargo: 2000, fuelPerSecond: 3.0, antimatterPerDistance: 8.0 },
  // Переработчик: гигантский трюм ценой скорости и расхода плазмы.
  // За один рейс он собирает больше, чем десяток транспортов, но ползет и жжет.
  RECYCLER: { speed: 40, warp: 40, cargo: 20000, fuelPerSecond: 3.0, antimatterPerDistance: 6.0 },
  // Колонизатор везет припасы новой базы, поэтому трюм большой, а скорость
  // низкая: колонию основывают заранее, а не выигрывают гонку к планете.
  COLONY_SHIP: { speed: 55, warp: 55, cargo: 5000, fuelPerSecond: 2.0, antimatterPerDistance: 5.0 },
};

/*
 * Сроки полетов подобраны под темп месяца, а не под минуты.
 *
 * Прежде соседнюю систему флот проходил за три минуты, а свою — меньше чем
 * за минуту: расстояние не значило ничего, и набег через полкарты стоил
 * столько же времени, сколько на соседа. Теперь при скорости 100 без
 * технологий до соседней планеты около пяти минут, через всю систему —
 * двадцать; соседняя система — полчаса-час, самая дальняя — двое с лишним
 * суток, а флот с переработчиком или авианосцем идет туда почти неделю.
 */
/** Разгон и торможение внутри системы, секунды при скорости 100. */
const INTRA_BASE_SECONDS = 240;
/** Секунд на орбиту при скорости 100. */
const INTRA_SECONDS_PER_ORBIT = 64;
/** Прирост скорости флота за уровень реактивного двигателя. */
const DRIVE_SPEED_BONUS = 0.1;

/** Вход в гиперпространство и выход из него, секунды при скорости 100. */
const JUMP_BASE_SECONDS = 1200;
/**
 * Секунд на квадрат расстояния между системами при скорости 100.
 *
 * Квадрат, а не прямая: соседние системы остаются соседями — полчаса-час,
 * — а дальние становятся по-настоящему дальними. Прямая, откалиброванная
 * под соседей, давала бы через всю галактику полдня, а откалиброванная
 * под дальние — делала бы недельным поход к соседу.
 */
const JUMP_SECONDS_PER_DISTANCE_SQ = 300;
/** Короче этого не бывает ни один прыжок, даже у зонда. */
const JUMP_MIN_SECONDS = 20;
/** Ускорение прыжка за уровень гипердвигателя. */
const HYPERDRIVE_BONUS = 0.15;
/*
 * Экономия антиматерии — «Гиперпространственная физика».
 *
 * Прежде ветка открывала синтезатор и дальше была тупиковой, а экономию
 * топлива давал гипердвигатель вместе со скоростью. Теперь у каждой своя
 * роль: гипердвигатель — быстрее, физика — дешевле, и дальние перелеты
 * на сутки требуют обеих. Пол в треть: прыжок совсем без антиматерии
 * сделал бы бессмысленным ее синтез.
 */
export const JUMP_ECONOMY_PER_LEVEL = 0.06;
export const JUMP_ECONOMY_FLOOR = 0.3;

/** Во сколько обходится антиматерия прыжка: единица без физики, треть на пределе. */
export function jumpFuelFactor(techs: TechLevels): number {
  return Math.max(JUMP_ECONOMY_FLOOR, 1 - Math.max(0, techs.HYPERSPACE_PHYSICS) * JUMP_ECONOMY_PER_LEVEL);
}

/*
 * Топливо считается по пройденному пути, а не по часам в полете.
 *
 * Сроки выросли впятеро, и с расходом «в секунду» так же выросла бы плазма
 * на каждый рейс — вся логистика и экономика подобраны под прежний расход.
 * Поэтому путь меряется прежней мерой: те же двадцать секунд разгона
 * и двадцать пять на орбиту при скорости 100, — и расход не изменился
 * ни у одного рейса, кроме зондов, которые стали быстрее и жгут меньше.
 */
const FUEL_BASE_UNITS = 20;
const FUEL_UNITS_PER_ORBIT = 25;

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

/** Гиперскорость флота: тоже по самому медленному, но от гиперскорости класса. */
function fleetWarp(ships: ShipCounts): number {
  let slowest = Number.POSITIVE_INFINITY;
  for (const type of SHIP_TYPES) {
    if (ships[type] > 0) slowest = Math.min(slowest, FLIGHT_PROFILES[type].warp);
  }
  return Number.isFinite(slowest) ? slowest : 0;
}

/** Время полета внутри системы в одну сторону, секунды. */
function flightSeconds(ships: ShipCounts, techs: TechLevels, distance: number): number {
  const speed = fleetSpeed(ships, techs);
  if (speed <= 0) return 0;
  const raw = ((INTRA_BASE_SECONDS + INTRA_SECONDS_PER_ORBIT * distance) * 100) / speed;
  return Math.max(5, Math.round(raw));
}

/** Путь внутри системы в прежней мере — по нему считается плазма. */
function fuelPathSeconds(ships: ShipCounts, techs: TechLevels, distance: number): number {
  const speed = fleetSpeed(ships, techs);
  if (speed <= 0) return 0;
  return Math.max(5, Math.round(((FUEL_BASE_UNITS + FUEL_UNITS_PER_ORBIT * distance) * 100) / speed));
}

/** Суммарная грузоподъемность флота. */
/** Вместимость трюмов. Множитель — «Обозные трюмы» синдиката; без синдиката единица. */
export function fleetCapacity(ships: ShipCounts, multiplier = 1): number {
  const base = SHIP_TYPES.reduce((total, type) => total + ships[type] * FLIGHT_PROFILES[type].cargo, 0);
  return Math.floor(base * multiplier);
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
  /** Сколько трюмов занимает само топливо рейса. */
  fuelLoad: number;
  /** Что остается под груз: вместимость за вычетом топлива. */
  usable: number;
  /** Прыжок через Браму синдиката, а не гипердвигателем. */
  viaGate?: boolean;
}

/*
 * Топливо едет в тех же трюмах, что и груз.
 *
 * Отдельных баков у флота нет: плазма и антиматерия — такой же товар,
 * который возят кораблями, и место они занимают наравне с рудой. Отсюда
 * следует то, ради чего правило и заведено: чем больше флот, тем больше
 * топлива он берет с собой и тем меньше остается под груз, — и «взять
 * побольше кораблей на всякий случай» перестает быть бесплатным.
 *
 * Считается по всему рейсу, включая обратный путь: топливо на возвращение
 * грузится при вылете, а не появляется у цели.
 */
function withHold(plan: Omit<FlightPlan, 'fuelLoad' | 'usable'>): FlightPlan {
  const fuelLoad = plan.fuel + plan.antimatter;
  return { ...plan, fuelLoad, usable: Math.max(0, plan.capacity - fuelLoad) };
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
  options: { oneWay?: boolean; cargoMultiplier?: number; viaGate?: boolean; gateLevel?: number } = {},
): FlightPlan {
  // Дислокация не возвращается, поэтому и топливо за обратный путь не берем.
  const trips = options.oneWay ? 1 : 2;
  const interstellar =
    from.system.galaxyX !== to.system.galaxyX || from.system.galaxyY !== to.system.galaxyY;

  if (!interstellar) {
    const distance = orbitDistance(from.position, to.position);
    const seconds = flightSeconds(ships, techs, distance);
    return withHold({
      kind: 'INTRA',
      distance,
      speed: Math.round(fleetSpeed(ships, techs)),
      flightSeconds: seconds,
      capacity: fleetCapacity(ships, options.cargoMultiplier),
      fuel: fuelCost(ships, fuelPathSeconds(ships, techs, distance), trips),
      antimatter: 0,
    });
  }

  const distance = galaxyDistance(from.system, to.system);

  /*
   * Через Браму: до врат своей системы по орбитам на плазме, короткий прыжок
   * и от врат по орбитам к цели. Антиматерии — треть обычного прыжка,
   * гипердвигатель не нужен и не ускоряет: прыжок делают врата, а не корабль.
   */
  if (options.viaGate) {
    const toGate = flightSeconds(ships, techs, orbitDistance(from.position, GATE_POSITION));
    const fromGate = flightSeconds(ships, techs, orbitDistance(GATE_POSITION, to.position));
    const seconds = toGate + GATE_JUMP_SECONDS + fromGate;
    const share = gateAntimatterShare(options.gateLevel ?? 1);
    const fuelPath =
      fuelPathSeconds(ships, techs, orbitDistance(from.position, GATE_POSITION)) +
      fuelPathSeconds(ships, techs, orbitDistance(GATE_POSITION, to.position));

    return withHold({
      kind: 'INTERSTELLAR',
      distance,
      speed: Math.round(fleetSpeed(ships, techs)),
      flightSeconds: seconds,
      capacity: fleetCapacity(ships, options.cargoMultiplier),
      fuel: fuelCost(ships, fuelPath, trips),
      antimatter: Math.max(1, Math.ceil(jumpAntimatterCost(ships, techs, distance, trips) * share)),
      viaGate: true,
    });
  }

  const seconds = jumpSeconds(ships, techs, distance);
  return withHold({
    kind: 'INTERSTELLAR',
    distance,
    speed: Math.round(fleetSpeed(ships, techs)),
    flightSeconds: seconds,
    capacity: fleetCapacity(ships, options.cargoMultiplier),
    fuel: 0,
    antimatter: jumpAntimatterCost(ships, techs, distance, trips),
  });
}

/**
 * Какую долю пути в одну сторону рейс через Браму проходит до прыжка.
 *
 * Оба участка идут на одной скорости, а прыжок мгновенный, поэтому доля
 * зависит только от орбит — и карта по ней ставит флот в систему вылета
 * или в систему цели, а не тащит его по прямой через всю галактику.
 */
export function gateLegShare(fromPosition: number, toPosition: number): number {
  const before = INTRA_BASE_SECONDS + INTRA_SECONDS_PER_ORBIT * orbitDistance(fromPosition, GATE_POSITION);
  const after = INTRA_BASE_SECONDS + INTRA_SECONDS_PER_ORBIT * orbitDistance(GATE_POSITION, toPosition);
  return before / (before + after);
}

/**
 * Время гиперпрыжка в одну сторону: квадрат расстояния по макро-карте,
 * гиперскорость самого медленного класса и гипердвигатель. Реактивный
 * двигатель здесь не участвует: в гиперпространстве идут не на тяге.
 */
function jumpSeconds(ships: ShipCounts, techs: TechLevels, distance: number): number {
  const warp = fleetWarp(ships);
  if (warp <= 0) return 0;
  const raw =
    ((JUMP_BASE_SECONDS + JUMP_SECONDS_PER_DISTANCE_SQ * distance * distance) * 100) / warp / hyperdriveFactor(techs);
  return Math.max(JUMP_MIN_SECONDS, Math.round(raw));
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
  const total = perDistance * distance * trips * jumpFuelFactor(techs);
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
  // Удержание — это защита: грузовики на чужой орбите никого не прикроют.
  if (mission === 'KISH_RAID' && !hasWeapons(ships)) {
    return 'Для налета на Кіш нужен хотя бы один вооруженный корабль';
  }
  if (mission === 'GATE_SIEGE' && !hasWeapons(ships)) {
    return 'Для осады Брамы нужен хотя бы один вооруженный корабль';
  }
  if (mission === 'HOLD' && !hasWeapons(ships)) {
    return 'Для удержания нужен хотя бы один вооруженный корабль';
  }
  if (mission === 'EXPEDITION' && ships.PROBE === fleetSize(ships)) {
    return 'Одни зонды не выдержат экспедицию — нужен хотя бы один корабль с трюмом';
  }
  if (isHubMission(mission) && fleetCapacity(ships) <= 0) {
    return 'Для рейса на хаб нужен корабль с трюмом';
  }
  if (isKishMission(mission) && fleetCapacity(ships) <= 0) {
    return 'Для рейса в Кіш нужен корабль с трюмом';
  }
  // Обломки собирает только специализированный корабль: обычные трюмы
  // для этого не приспособлены, иначе переработчик был бы не нужен.
  if (mission === 'HARVEST' && ships.RECYCLER <= 0) {
    return 'Для сборки обломков нужен хотя бы один переработчик';
  }
  // Колонию основывает сам корабль-основатель, конвой лишь прикрывает рейс.
  if (mission === 'COLONIZE' && ships.COLONY_SHIP <= 0) {
    return 'Для колонизации нужен колониальный транспорт';
  }
  return null;
}

/**
 * Проверка груза: три ресурса делят один трюм.
 * Плазма возится наравне с рудой и полимерами — она и топливо, и товар,
 * поэтому колонии умеют перебрасывать ее между собой.
 */
export function validateCargo(
  ships: ShipCounts,
  cargo: ResourceAmounts,
  cargoMultiplier = 1,
  fuelLoad = 0,
): string | null {
  if (cargo.ore < 0 || cargo.polymers < 0 || cargo.plasma < 0) {
    return 'Некорректный объем груза';
  }
  const total = cargo.ore + cargo.polymers + cargo.plasma;
  if (total <= 0) return null;

  // Топливо рейса уже лежит в трюмах, поэтому грузу остается остаток.
  const capacity = Math.max(0, fleetCapacity(ships, cargoMultiplier) - fuelLoad);
  if (total > capacity) {
    return fuelLoad > 0
      ? `Трюмы вмещают ${capacity} (топливо занимает ${Math.round(fuelLoad)}), а загружено ${Math.round(total)}`
      : `Трюмы вмещают ${capacity}, а загружено ${Math.round(total)}`;
  }
  return null;
}

export function describeComposition(ships: ShipCounts): string {
  return SHIP_TYPES.filter((type) => ships[type] > 0)
    .map((type) => `${shipLabel(type)} ×${ships[type]}`)
    .join(', ');
}

/** Сроки удержания на выбор, в часах. */
export const HOLD_HOURS = [1, 4, 8, 24] as const;

export function isHoldHours(value: unknown): value is (typeof HOLD_HOURS)[number] {
  return typeof value === 'number' && (HOLD_HOURS as readonly number[]).includes(value);
}

/**
 * Дележ уцелевших защитников между базой и флотами на удержании.
 *
 * Бой считает защитника одной стороной, а корабли у нее разных владельцев.
 * Уцелевшие каждого класса делятся пропорционально вкладу, округление
 * вниз, а остаток отдается тем, у кого этого класса было больше всего:
 * так сумма совпадает с итогом боя до корабля, и никто не получает
 * больше, чем привел.
 */
export function splitSurvivors(survivors: ShipCounts, parts: ShipCounts[]): ShipCounts[] {
  const result = parts.map(() => emptyShipCounts());
  for (const type of SHIP_TYPES) {
    const total = parts.reduce((sum, part) => sum + part[type], 0);
    if (total <= 0) continue;
    const alive = Math.min(total, Math.max(0, Math.floor(survivors[type])));
    let given = 0;
    parts.forEach((part, index) => {
      const share = Math.floor((part[type] * alive) / total);
      result[index]![type] = share;
      given += share;
    });
    let rest = alive - given;
    const order = parts.map((_, index) => index).sort((a, b) => parts[b]![type] - parts[a]![type]);
    for (const index of order) {
      if (rest <= 0) break;
      if (result[index]![type] < parts[index]![type]) {
        result[index]![type] += 1;
        rest -= 1;
      }
    }
  }
  return result;
}

/** Сколько флотов, считая ведущий, может идти в одной совместной атаке. */
export const MAX_JOINT_FLEETS = 8;
/**
 * Присоединиться можно, пока ведущему лететь дольше этого срока: иначе
 * присоединившийся рискует прилететь уже после боя и драться в одиночку.
 */
export const JOINT_MIN_LEAD_MS = 10_000;

export interface Loot {
  ore: number;
  polymers: number;
  plasma: number;
}

/**
 * Дележ добычи совместной атаки по трюмам уцелевших.
 *
 * Добыча посчитана по общей вместимости группы, поэтому делится
 * пропорционально трюмам каждого флота, округление вниз. Остаток уходит
 * тем, у кого больше свободного места, и никто не везет сверх своих трюмов.
 * Если места не хватило даже на остаток, он остается у защитника: списывать
 * со склада надо ровно то, что увезли.
 */
export function splitLoot(loot: Loot, capacities: number[]): Loot[] {
  const result = capacities.map(() => ({ ore: 0, polymers: 0, plasma: 0 }));
  const caps = capacities.map((capacity) => Math.max(0, Math.floor(capacity)));
  const total = caps.reduce((sum, capacity) => sum + capacity, 0);
  if (total <= 0) return result;
  const used = caps.map(() => 0);
  for (const field of ['ore', 'polymers', 'plasma'] as const) {
    const amount = Math.max(0, Math.floor(loot[field]));
    let given = 0;
    caps.forEach((capacity, index) => {
      const share = Math.min(capacity - used[index]!, Math.floor((amount * capacity) / total));
      result[index]![field] = share;
      used[index]! += share;
      given += share;
    });
    let rest = amount - given;
    const order = caps.map((_, index) => index).sort((a, b) => caps[b]! - used[b]! - (caps[a]! - used[a]!));
    for (const index of order) {
      if (rest <= 0) break;
      const take = Math.min(rest, caps[index]! - used[index]!);
      if (take <= 0) continue;
      result[index]![field] += take;
      used[index]! += take;
      rest -= take;
    }
  }
  return result;
}
