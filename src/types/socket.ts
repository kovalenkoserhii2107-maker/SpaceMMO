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
  energy: { usage: number; nextUsage: number };
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
  ships: ShipCard[];
  defenseCards: DefenseCard[];
  fleet: ShipCounts;
  defenses: DefenseCounts;
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
  } | null;
}

export interface FleetSnapshot {
  id: string;
  mission: FleetMission;
  missionLabel: string;
  status: 'OUTBOUND' | 'RETURNING';
  originPlanetId: string;
  originPlanetName: string;
  targetKind: 'PLANET' | 'HUB' | 'DEEP_SPACE';
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
