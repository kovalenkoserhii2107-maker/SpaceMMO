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

export interface ShipCard {
  type: ShipType;
  label: string;
  description: string;
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
    metal: number;
    crystal: number;
    deuterium: number;
    energy: number;
    antimatter: number;
  };
  resources: BaseStock;
  productionPerSecond: BaseStock;
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
  targetKind: 'PLANET' | 'HUB';
  targetPlanetId: string | null;
  targetHubId: string | null;
  targetName: string;
  ships: ShipCounts;
  composition: string;
  cargo: { metal: number; crystal: number };
  pickup: { metal: number; crystal: number };
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
  storage: { metal: number; crystal: number; level: number; capacity: number; free: number } | null;
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
  'session:ready': (payload: { userId: string; username: string }) => void;
  'state:update': (payload: StateUpdatePayload) => void;
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
  userId: string;
  username: string;
}
