import type { BuildingType, ResourceAmounts } from '../game/rules.js';
import type { Requirement, TechLevels, TechnologyType } from '../game/techTree.js';
import type { ShipCounts, ShipType } from '../game/ships.js';
import type { FleetMission } from '../game/fleets.js';
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

/** Снимок состояния базы, который сервер шлет клиенту. */
export interface BaseSnapshot {
  baseId: string;
  baseName: string;
  planetId: string;
  planetName: string;
  systemName: string;
  position: number;
  planetType: string;
  size: number;
  richness: {
    metal: number;
    crystal: number;
    deuterium: number;
    energy: number;
  };
  resources: ResourceAmounts;
  productionPerSecond: ResourceAmounts;
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
  fleet: ShipCounts;
  shipQueue: Array<{
    id: string;
    type: ShipType;
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
  targetPlanetId: string;
  targetPlanetName: string;
  ships: ShipCounts;
  composition: string;
  cargo: { metal: number; crystal: number };
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

/** Карта системы с учетом тумана войны. */
export interface SystemMap {
  systemId: string;
  systemName: string;
  starClass: string;
  planets: PlanetView[];
}

export interface StateUpdatePayload {
  bases: BaseSnapshot[];
  research: ResearchSnapshot;
  fleets: FleetSnapshot[];
  serverTime: number;
}

export interface ServerToClientEvents {
  'session:ready': (payload: { userId: string; username: string }) => void;
  'state:update': (payload: StateUpdatePayload) => void;
}

export interface ClientToServerEvents {
  'state:request': () => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  userId: string;
  username: string;
}
