import type { BaseSnapshot } from '../types/socket.js';
import {
  BUILDING_LABELS,
  BUILDING_TYPES,
  energyOutput,
  energyUsage,
  hasEnoughResources,
  levelsAfterUpgrade,
  productionPerSecond,
  upgradeCost,
  type BuildingLevels,
  type PlanetRichness,
  type ResourceAmounts,
} from './rules.js';

/** Состояние базы в памяти Game Loop. */
export interface BaseRuntimeState {
  id: string;
  name: string;
  userId: string;
  planetId: string;
  planetName: string;
  planetType: string;
  position: number;
  size: number;
  systemName: string;
  richness: PlanetRichness;
  resources: ResourceAmounts;
  levels: BuildingLevels;
  lastTickAt: number;
  dirty: boolean;
}

/** Начисление ресурсов за прошедшие секунды (используется тиком и догоном офлайна). */
export function accrue(state: BaseRuntimeState, seconds: number): void {
  if (seconds <= 0) return;
  const perSecond = productionPerSecond(state.levels, state.richness);
  state.resources.metal += perSecond.metal * seconds;
  state.resources.crystal += perSecond.crystal * seconds;
  state.resources.deuterium += perSecond.deuterium * seconds;
  state.dirty = true;
}

export function toSnapshot(state: BaseRuntimeState): BaseSnapshot {
  const output = energyOutput(state.levels, state.richness);
  const usage = energyUsage(state.levels);

  return {
    baseId: state.id,
    baseName: state.name,
    planetId: state.planetId,
    planetName: state.planetName,
    systemName: state.systemName,
    position: state.position,
    planetType: state.planetType,
    size: state.size,
    richness: { ...state.richness },
    resources: {
      metal: round(state.resources.metal),
      crystal: round(state.resources.crystal),
      deuterium: round(state.resources.deuterium),
    },
    productionPerSecond: roundAll(productionPerSecond(state.levels, state.richness)),
    energy: {
      output: round(output),
      usage: round(usage),
      available: round(output - usage),
    },
    buildings: BUILDING_TYPES.map((type) => {
      const nextLevel = state.levels[type] + 1;
      const cost = upgradeCost(type, nextLevel);
      const nextLevels = levelsAfterUpgrade(state.levels, type);
      const energyDelta =
        energyOutput(nextLevels, state.richness) -
        energyUsage(nextLevels) -
        (output - usage);

      return {
        type,
        label: BUILDING_LABELS[type],
        level: state.levels[type],
        nextLevel,
        cost,
        energyDelta: round(energyDelta),
        canAfford: hasEnoughResources(state.resources, cost),
        hasEnergy: energyOutput(nextLevels, state.richness) >= energyUsage(nextLevels),
      };
    }),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundAll(amounts: ResourceAmounts): ResourceAmounts {
  return {
    metal: Math.round(amounts.metal * 1000) / 1000,
    crystal: Math.round(amounts.crystal * 1000) / 1000,
    deuterium: Math.round(amounts.deuterium * 1000) / 1000,
  };
}
