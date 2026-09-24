import type { BaseStock, BuildingType, ResourceAmounts } from '../game/rules.js';
import type { Requirement, TechLevels, TechnologyType } from '../game/techTree.js';
import type { ShipCounts, ShipType } from '../game/ships.js';
import type { FleetMission } from '../game/fleets.js';
import type { DefenseCounts, DefenseType } from '../game/defenses.js';
import type { PlanetView } from '../game/fogOfWar.js';

/** Один склад: у каждого ресурса свой лимит и свой уровень постройки. */
export interface ResourceStorage {
  capacity: number;
  used: number;
  free: number;
  /** Заполненность 0..1; больше 1, если склад переполнили извне. */
  fill: number;
  /** Добыча этого ресурса остановлена: свободного места нет. */
  full: boolean;
  /** Несгораемый объем — его грабеж не достает. */
  protectedAmount: number;
  /** Излишек сверх несгораемого объема: он уязвим при поражении. */
  vulnerable: number;
}

export interface BuildingCard {
  type: BuildingType;
  label: string;
  level: number;
  nextLevel: number;
  cost: ResourceAmounts;
  seconds: number;
  canAfford: boolean;
  requirements: Requirement[];
  /**
   * Что даст следующий уровень: заполнено там, где эффект неочевиден.
   *
   * Разобрано на значок и текст, а не одной фразой: значок ресурса стоит
   * там, где иначе шло бы существительное, которое ничего не добавляет
   * («добыча» на карточке шахты). Имя значка — из общего спрайта, поэтому
   * тут строка, а не перечисление: список ресурсов знает клиент.
   */
  effect: { icon: string | null; text: string } | null;
  /**
   * Энергия: сколько постройка ест сейчас и сколько станет есть уровнем выше.
   * Отдельным полем, а не строкой в `effect`, потому что показывается всегда
   * и у всех — расход есть даже у тех зданий, чей эффект описать нечем.
   */
  /*
   * Расход и выработка рядом: станция энергию только дает, и строка расхода
   * у нее показывала «не растет» — то есть ничего. Выработка есть у всех,
   * просто у всех, кроме станции, она не меняется с уровнем.
   */
  energy: { usage: number; nextUsage: number; output: number; nextOutput: number };
  /** На базе уже идет стройка. */
  busy: boolean;
}

/** Строка таблицы «что будет дальше»: один уровень постройки. */
export interface BuildingProjectionRow {
  level: number;
  /**
   * Текущий уровень — точка отсчета всей таблицы. Он идет первой строкой,
   * чтобы приросты ниже было с чем сравнивать глазами, а не по памяти.
   */
  current: boolean;
  /** У текущего уровня цены и срока нет: он уже построен и уже оплачен. */
  cost: ResourceAmounts | null;
  seconds: number | null;
  /** Добыча в час на этом уровне: пусто у зданий, которые ничего не добывают. */
  output: number | null;
  /** Прирост добычи относительно текущего уровня, а не предыдущего в таблице. */
  outputGain: number | null;
  energy: number;
  /** Прирост расхода относительно текущего уровня. */
  energyGain: number;
}

/** Карточка постройки в подробностях: описание, арт и десять уровней вперед. */
export interface BuildingProjection {
  type: BuildingType;
  label: string;
  description: string;
  level: number;
  /** Единица измерения выработки: «руда в час», «энергия», «вместимость». */
  outputLabel: string | null;
  rows: BuildingProjectionRow[];
}

/**
 * Карточка технологии в подробностях. Строки те же, что у построек: у уровня
 * технологии тоже есть цена, срок и величина эффекта, и рисует их один
 * и тот же компонент.
 */
export interface TechnologyProjection {
  tech: TechnologyType;
  label: string;
  description: string;
  level: number;
  outputLabel: string | null;
  rows: BuildingProjectionRow[];
}

export interface TechnologyCard {
  tech: TechnologyType;
  label: string;
  description: string;
  level: number;
  nextLevel: number;
  cost: ResourceAmounts;
  seconds: number;
  canAfford: boolean;
  requirements: Requirement[];
  /** У игрока уже идет исследование. */
  busy: boolean;
}

/** Боевой профиль юнита: тип урона и слои защиты. */
/** Боевой профиль юнита для карточки: атака, щит, корпус. */
export interface CombatProfileView {
  attack: number;
  shield: number;
  hull: number;
  /** Множитель урона по щиту: у обычных юнитов равен единице. */
  shieldPiercing: number;
  /** Пояснение к особенности юнита; null — особенностей нет. */
  note: string | null;
}

export interface ShipCard {
  type: ShipType;
  label: string;
  description: string;
  combat: CombatProfileView;
  cost: ResourceAmounts;
  unitSeconds: number;
  owned: number;
  canAfford: boolean;
  requirements: Requirement[];
  /**
   * Летные данные: трюм, скорость и расход. В снимке, а не отдельным роутом —
   * они статичны для класса и весят десяток чисел, тогда как проекция построек
   * это восемьдесят строк расчета.
   */
  flight: { speed: number; cargo: number; fuelPerSecond: number; antimatterPerDistance: number };
}

export interface DefenseCard {
  type: DefenseType;
  label: string;
  description: string;
  combat: CombatProfileView;
  cost: ResourceAmounts;
  unitSeconds: number;
  owned: number;
  canAfford: boolean;
  requirements: Requirement[];
}

/** Снимок состояния базы, который сервер шлет клиенту. */
export interface BaseSnapshot {
  baseId: string;
  baseName: string;
  planetId: string;
  planetName: string;
  systemName: string;
  systemId: string;
  /** Аномалия системы: 'NONE' или 'BLACK_HOLE'. */
  anomaly: string;
  position: number;
  planetType: string;
  size: number;
  richness: {
    ore: number;
    polymers: number;
    plasma: number;
    energy: number;
    antimatter: number;
  };
  resources: BaseStock;
  productionPerSecond: BaseStock;
  /** Склад ресурсов: общий лимит на руду, полимеры и плазму. */
  storage: {
    /** Сумма по трем складам — для коротких строк и сводок. */
    capacity: number;
    used: number;
    /** Хотя бы один склад полон: добыча этого ресурса встала. */
    anyFull: boolean;
    ore: ResourceStorage;
    polymers: ResourceStorage;
    plasma: ResourceStorage;
  };
  energy: {
    output: number;
    usage: number;
    available: number;
    /** Доля мощности шахт при дефиците энергии: 1.0 — полная. */
    efficiency: number;
  };
  buildJob: {
    building: BuildingType;
    label: string;
    targetLevel: number;
    totalSeconds: number;
    remainingSeconds: number;
  } | null;
  buildings: BuildingCard[];
  technologies: TechnologyCard[];
  /**
   * Присоединение лаборатории этой базы к идущему исследованию.
   * `null` — предлагать нечего: исследования нет или база уже в нем участвует.
   */
  researchJoin: {
    available: boolean;
    /** Почему нельзя — только при `available: false`. */
    reason: string | null;
    /** Доля всего срока и всей цены, которую возьмет на себя эта лаборатория. */
    share: number;
    labLevel: number;
    savedSeconds: number;
    price: { ore: number; polymers: number; plasma: number };
    canAfford: boolean;
  } | null;
  ships: ShipCard[];
  defenseCards: DefenseCard[];
  fleet: ShipCounts;
  defenses: DefenseCounts;
  /** Бонус синдиката к трюмам: форма отправки считает по нему вместимость. */
  cargoMultiplier: number;
  shipQueue: Array<{
    id: string;
    type: ShipType;
    label: string;
    quantity: number;
    remaining: number;
    unitSeconds: number;
    nextUnitInSeconds: number;
  }>;
  defenseQueue: Array<{
    id: string;
    type: DefenseType;
    label: string;
    quantity: number;
    remaining: number;
    unitSeconds: number;
    nextUnitInSeconds: number;
  }>;
}

export interface ResearchSnapshot {
  techs: TechLevels;
  active: {
    tech: TechnologyType;
    label: string;
    targetLevel: number;
    baseId: string;
    totalSeconds: number;
    remainingSeconds: number;
    /**
     * Кто работает над исследованием: ведущая первой. `share` — доля всего
     * исследования, взятая помощницей (у ведущей ноль).
     */
    participants: Array<{ baseId: string; baseName: string; labLevel: number; share: number; lead: boolean }>;
  } | null;
}

export interface FleetSnapshot {
  id: string;
  mission: FleetMission;
  missionLabel: string;
  status: 'OUTBOUND' | 'RETURNING' | 'HOLDING';
  holdUntil: number | null;
  originPlanetId: string;
  originPlanetName: string;
  /** Системы концов рейса: по ним макро-карта рисует межзвездный перелет. */
  fromSystemId: string;
  toSystemId: string | null;
  targetKind: 'PLANET' | 'HUB' | 'DEEP_SPACE' | 'KISH';
  targetSyndicateId: string | null;
  targetPlanetId: string | null;
  targetHubId: string | null;
  targetName: string;
  ships: ShipCounts;
  composition: string;
  cargo: { ore: number; polymers: number; plasma: number; antimatter: number };
  pickup: { ore: number; polymers: number };
  fuelSpent: number;
  distance: number;
  speed: number;
  /** Метки времени в мс — клиент двигает маркер сам, между тиками. */
  departedAt: number;
  arrivesAt: number;
  returnsAt: number;
  /** Рейс через Браму: доля пути в одну сторону до мгновенного прыжка; `null` — без врат. */
  gateShare: number | null;
  etaSeconds: number;
  progress: number;
}

/** Торговый хаб на карте системы. */
export interface HubView {
  hubId: string;
  name: string;
  position: number;
  storage: { ore: number; polymers: number; level: number; capacity: number; free: number } | null;
}

/**
 * Кіш синдиката на карте системы. Чужой Кіш виден как станция, но казна
 * у него скрыта: сколько лежит у соседей, знают только сами соседи.
 */
export interface KishView {
  syndicateId: string;
  name: string;
  tag: string;
  level: number;
  position: number;
  own: boolean;
  treasury: { ore: number; polymers: number; plasma: number } | null;
  /** Может ли зритель вывозить из казны — есть ли у его ранга право выдачи. */
  canPickup: boolean;
  /** Осколки у Коша видны всем, как и поле у планеты. */
  debris: { ore: number; polymers: number };
}

/** Карта системы с учетом тумана войны. */
export interface SystemMap {
  systemId: string;
  systemName: string;
  starClass: string;
  /** 'NONE' или 'BLACK_HOLE'. */
  anomaly: string;
  galaxyX: number;
  galaxyY: number;
  /** Родная система игрока. */
  isHome: boolean;
  planets: PlanetView[];
  hub: HubView | null;
  kishes: KishView[];
  /** Брамы в системе: чьи, какого уровня и можно ли смотрящему через них прыгать. */
  gates: GateView[];
}

/** Брама на карте системы. `access` — основание доступа смотрящего; `null` — чужая. */
export interface GateView {
  syndicateId: string;
  tag: string;
  level: number;
  position: number;
  access: 'OWN' | 'ALLY' | 'LEASED' | null;
}

/** Система на макро-карте галактики. */
export interface GalaxySystemView {
  systemId: string;
  name: string;
  galaxyX: number;
  galaxyY: number;
  starClass: string;
  anomaly: string;
  planetCount: number;
  isHome: boolean;
  hasOwnColony: boolean;
  /** В системе есть хоть одна колония (видно по излучению баз). */
  colonized: boolean;
  /** Сколько планет системы игрок успел разведать. */
  scannedPlanets: number;
  /** Уровень Брамы, через которую смотрящий может прыгать отсюда; `null` — такой нет. */
  syndicateGate: number | null;
  /** Чья это Брама для смотрящего: своя, союзника или арендованная. */
  gateAccess: 'OWN' | 'ALLY' | 'LEASED' | null;
  /** Здесь стоит Кіш своего синдиката. */
  ownKish: boolean;
}

export interface GalaxyMap {
  homeSystemId: string;
  systems: GalaxySystemView[];
}

/** Слоты под колонии: сколько занято и сколько открыто астрофизикой. */
export interface ColonySnapshot {
  used: number;
  slots: number;
}

export interface StateUpdatePayload {
  bases: BaseSnapshot[];
  research: ResearchSnapshot;
  fleets: FleetSnapshot[];
  /** Баланс криптогривны игрока. */
  credits: number;
  /** Предел расширения: без него игрок узнает о нем только отказом на вылете. */
  colonies: ColonySnapshot;
  serverTime: number;
}

/**
 * События сервер → клиент.
 * `state:update` уходит каждый тик и содержит полное состояние игрока:
 * клиент ничего не досчитывает сам, кроме плавной интерполяции маркеров флотов.
 */
export interface ServerToClientEvents {
  'session:ready': (payload: { commanderId: string; nickname: string }) => void;
  'state:update': (payload: StateUpdatePayload) => void;
  /** Счетчик непрочитанных писем: приходит в момент доставки, а не по опросу. */
  'mail:unread': (payload: { unread: number }) => void;
}

/**
 * События клиент → сервер.
 * Намеренно одно: все изменяющие действия идут через REST, где их удобнее
 * валидировать и возвращать понятную ошибку. По сокету клиент может только
 * попросить внеочередной снимок состояния (например, сразу после действия).
 */
export interface ClientToServerEvents {
  'state:request': () => void;
}

/** Обмен между узлами Socket.IO не используется: сервер работает в одном процессе. */
export type InterServerEvents = Record<string, never>;

/** Данные, которые сервер держит на сокете после авторизации по токену. */
export interface SocketData {
  commanderId: string;
  nickname: string;
}
