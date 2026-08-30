import type { BaseStock, BuildingType, ResourceAmounts } from '../game/rules.js';
import type { Requirement, TechLevels, TechnologyType } from '../game/techTree.js';
import type { ShipCounts, ShipType } from '../game/ships.js';
import type { FleetMission } from '../game/fleets.js';
import type { DefenseCounts, DefenseType } from '../game/defenses.js';
import type { PlanetView } from '../game/fogOfWar.js';

export interface BuildingCard {
  type: BuildingType;
  label: string;
  level: number;
  nextLevel: number;
  cost: ResourceAmounts;
  seconds: number;
  canAfford: boolean;
  requirements: Requirement[];
  /** Что даст следующий уровень: заполнено там, где эффект неочевиден. */
  effect: string | null;
  /** На базе уже идет стройка. */
  busy: boolean;
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
export interface CombatProfileView {
  damage: number;
  damageType: string;
  damageLabel: string;
  shield: number;
  armor: number;
  hull: number;
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
    capacity: number;
    used: number;
    free: number;
    /** Заполненность 0..1; больше 1, если склад переполнили извне. */
    fill: number;
    /** Добыча остановлена: свободного места нет. */
    full: boolean;
    /** Несгораемый объем — его грабеж не достает. */
    protectedAmount: number;
    /** Излишек сверх несгораемого объема: он уязвим при поражении. */
    vulnerable: number;
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

export interface StateUpdatePayload {
  bases: BaseSnapshot[];
  research: ResearchSnapshot;
  fleets: FleetSnapshot[];
  /** Баланс криптогривны игрока. */
  credits: number;
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
