import type { BuildingType, ResourceAmounts } from '../game/rules.js';

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
  };
  buildings: Array<{
    type: BuildingType;
    label: string;
    level: number;
    nextLevel: number;
    cost: ResourceAmounts;
    energyDelta: number;
    canAfford: boolean;
    hasEnergy: boolean;
  }>;
}

export interface ServerToClientEvents {
  'session:ready': (payload: { userId: string; username: string }) => void;
  'state:update': (payload: { bases: BaseSnapshot[]; serverTime: number }) => void;
  'build:result': (payload: { ok: boolean; baseId: string; type?: BuildingType; level?: number; error?: string }) => void;
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
