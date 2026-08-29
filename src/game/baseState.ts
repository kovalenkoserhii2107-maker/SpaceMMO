/** Состояние игрока и его баз в памяти Game Loop + снимки для клиента. */
import type {
  BaseSnapshot,
  BuildingCard,
  DefenseCard,
  FleetSnapshot,
  ResearchSnapshot,
  ShipCard,
  TechnologyCard,
} from '../types/socket.js';
import {
  BUILDING_LABELS,
  BUILDING_TYPES,
  buildSeconds,
  systemModifiers,
  type BaseStock,
  energyEfficiency,
  energyOutput,
  energyUsage,
  hasEnoughResources,
  missingBuildingRequirements,
  productionPerSecond,
  upgradeCost,
  type BuildingLevels,
  type BuildingType,
  type PlanetRichness,
} from './rules.js';
import {
  economyBonuses,
  missingTechRequirements,
  researchCost,
  researchSeconds,
  techDescription,
  techLabel,
  TECHNOLOGY_TYPES,
  type Requirement,
  type TechLevels,
  type TechnologyType,
} from './techTree.js';
import { describeComposition, MISSION_LABELS, type FleetMission } from './fleets.js';
import {
  DEFENSE_TYPES,
  defenseCost,
  defenseDescription,
  defenseEnergyUsage,
  defenseLabel,
  defenseUnitSeconds,
  missingDefenseRequirements,
  type DefenseCounts,
  type DefenseType,
} from './defenses.js';
import {
  missingShipRequirements,
  shipCost,
  shipDescription,
  shipLabel,
  SHIP_TYPES,
  shipUnitSeconds,
  type ShipCounts,
  type ShipType,
} from './ships.js';

export interface BuildJobState {
  building: BuildingType;
  targetLevel: number;
  startedAt: number;
  finishesAt: number;
}

export interface DefenseJobState {
  id: string;
  type: DefenseType;
  quantity: number;
  remaining: number;
  unitSeconds: number;
  nextUnitAt: number;
  createdAt: number;
}

export interface ShipJobState {
  id: string;
  type: ShipType;
  quantity: number;
  remaining: number;
  unitSeconds: number;
  /** Время выхода следующего корабля; тикает только у первого заказа очереди. */
  nextUnitAt: number;
  createdAt: number;
}

export interface FleetRuntimeState {
  id: string;
  mission: FleetMission;
  status: 'OUTBOUND' | 'RETURNING';
  originBaseId: string;
  originPlanetId: string;
  originPlanetName: string;
  /// Цель — планета или торговый хаб.
  targetKind: 'PLANET' | 'HUB';
  targetPlanetId: string | null;
  targetHubId: string | null;
  targetName: string;
  ships: ShipCounts;
  cargo: { metal: number; crystal: number };
  pickup: { metal: number; crystal: number };
  fuelSpent: number;
  distance: number;
  speed: number;
  departedAt: number;
  arrivesAt: number;
  returnsAt: number;
}

export interface ResearchJobState {
  tech: TechnologyType;
  targetLevel: number;
  /** База, с которой запущено исследование. */
  baseId: string;
  startedAt: number;
  finishesAt: number;
}

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
  systemId: string;
  /** Координаты системы на макро-карте — нужны для расчета прыжков. */
  galaxy: { galaxyX: number; galaxyY: number };
  /** Аномалия системы: у черной дыры искажается время. */
  anomaly: string;
  richness: PlanetRichness;
  resources: BaseStock;
  levels: BuildingLevels;
  buildJob: BuildJobState | null;
  shipJobs: ShipJobState[];
  ships: ShipCounts;
  defenseJobs: DefenseJobState[];
  defenses: DefenseCounts;
  lastTickAt: number;
  /** Изменились ресурсы/уровни — нужна периодическая запись. */
  dirty: boolean;
  /** Изменились очереди или флот — нужна немедленная запись. */
  jobsDirty: boolean;
}

export interface UserRuntimeState {
  userId: string;
  /** Баланс криптогривны. Меняется только через биржу, тик его не трогает. */
  credits: number;
  /** Последнее обращение — по нему выгружаются игроки без активных сокетов. */
  lastAccessAt: number;
  techs: TechLevels;
  research: ResearchJobState | null;
  /** Уровни технологий или активное исследование изменились. */
  researchDirty: boolean;
  bases: Map<string, BaseRuntimeState>;
  /** Флоты игрока в полете. Источник правды — БД, здесь кэш для отрисовки. */
  fleets: FleetRuntimeState[];
}

/**
 * Начисление ресурсов за прошедшие секунды (тик и догон офлайна).
 * Нечисловой результат отбрасывается: одно NaN иначе навсегда испортило бы склад базы.
 */
export function accrue(state: BaseRuntimeState, techs: TechLevels, seconds: number): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;

  const perSecond = productionPerSecond(
    state.levels,
    state.richness,
    economyBonuses(techs),
    defenseEnergyUsage(state.defenses),
    systemModifiers(state.anomaly),
  );
  const next: BaseStock = {
    metal: state.resources.metal + perSecond.metal * seconds,
    crystal: state.resources.crystal + perSecond.crystal * seconds,
    deuterium: state.resources.deuterium + perSecond.deuterium * seconds,
    antimatter: state.resources.antimatter + perSecond.antimatter * seconds,
  };

  if (Object.values(next).some((value) => !Number.isFinite(value))) {
    console.error(`[game-loop] некорректное начисление на базе ${state.id}, склад не изменен`, {
      perSecond,
      seconds,
      levels: state.levels,
    });
    return;
  }

  state.resources = next;
  state.dirty = true;
}

export function toSnapshot(state: BaseRuntimeState, user: UserRuntimeState, now: number): BaseSnapshot {
  const bonuses = economyBonuses(user.techs);
  const modifiers = systemModifiers(state.anomaly);
  const defenseDrain = defenseEnergyUsage(state.defenses);
  const output = energyOutput(state.levels, state.richness, bonuses);
  const usage = energyUsage(state.levels, defenseDrain);
  const efficiency = energyEfficiency(state.levels, state.richness, bonuses, defenseDrain);

  return {
    baseId: state.id,
    baseName: state.name,
    planetId: state.planetId,
    planetName: state.planetName,
    systemName: state.systemName,
    systemId: state.systemId,
    anomaly: state.anomaly,
    position: state.position,
    planetType: state.planetType,
    size: state.size,
    richness: { ...state.richness },
    resources: {
      metal: round(state.resources.metal),
      crystal: round(state.resources.crystal),
      deuterium: round(state.resources.deuterium),
      antimatter: Math.round(state.resources.antimatter * 1000) / 1000,
    },
    productionPerSecond: roundAll(
      productionPerSecond(state.levels, state.richness, bonuses, defenseDrain, modifiers),
    ),
    energy: {
      output: round(output),
      usage: round(usage),
      available: round(output - usage),
      efficiency: Math.round(efficiency * 1000) / 1000,
    },
    buildJob: state.buildJob
      ? {
          building: state.buildJob.building,
          label: BUILDING_LABELS[state.buildJob.building],
          targetLevel: state.buildJob.targetLevel,
          totalSeconds: Math.round((state.buildJob.finishesAt - state.buildJob.startedAt) / 1000),
          remainingSeconds: Math.max(0, Math.ceil((state.buildJob.finishesAt - now) / 1000)),
        }
      : null,
    buildings: BUILDING_TYPES.map((type) => buildingCard(type, state)),
    technologies: TECHNOLOGY_TYPES.map((tech) => technologyCard(tech, state, user)),
    ships: SHIP_TYPES.map((type) => shipCard(type, state, user)),
    defenseCards: DEFENSE_TYPES.map((type) => defenseCard(type, state, user)),
    fleet: { ...state.ships },
    defenses: { ...state.defenses },
    shipQueue: state.shipJobs.map((job) => ({
      id: job.id,
      type: job.type,
      label: shipLabel(job.type),
      quantity: job.quantity,
      remaining: job.remaining,
      unitSeconds: job.unitSeconds,
      nextUnitInSeconds: Math.max(0, Math.ceil((job.nextUnitAt - now) / 1000)),
    })),
    defenseQueue: state.defenseJobs.map((job) => ({
      id: job.id,
      type: job.type,
      label: defenseLabel(job.type),
      quantity: job.quantity,
      remaining: job.remaining,
      unitSeconds: job.unitSeconds,
      nextUnitInSeconds: Math.max(0, Math.ceil((job.nextUnitAt - now) / 1000)),
    })),
  };
}

function defenseCard(
  type: DefenseType,
  state: BaseRuntimeState,
  user: UserRuntimeState,
): DefenseCard {
  const cost = defenseCost(type);

  return {
    type,
    label: defenseLabel(type),
    description: defenseDescription(type),
    cost,
    unitSeconds: defenseUnitSeconds(type, state.levels.SHIPYARD),
    owned: state.defenses[type],
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingDefenseRequirements(type, state.levels, user.techs),
  };
}

function buildingCard(type: BuildingType, state: BaseRuntimeState): BuildingCard {
  const nextLevel = state.levels[type] + 1;
  const cost = upgradeCost(type, nextLevel);
  const missing = missingBuildingRequirements(type, state.levels).map<Requirement>((item) => ({
    kind: 'building',
    key: item.building,
    label: BUILDING_LABELS[item.building],
    level: item.level,
  }));

  return {
    type,
    label: BUILDING_LABELS[type],
    level: state.levels[type],
    nextLevel,
    cost,
    seconds: buildSeconds(type, nextLevel, systemModifiers(state.anomaly)),
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missing,
    busy: state.buildJob !== null,
  };
}

function technologyCard(
  tech: TechnologyType,
  state: BaseRuntimeState,
  user: UserRuntimeState,
): TechnologyCard {
  const nextLevel = user.techs[tech] + 1;
  const cost = researchCost(tech, nextLevel);

  return {
    tech,
    label: techLabel(tech),
    description: techDescription(tech),
    level: user.techs[tech],
    nextLevel,
    cost,
    seconds: researchSeconds(
      tech,
      nextLevel,
      state.levels.RESEARCH_LAB,
      user.techs,
      systemModifiers(state.anomaly),
    ),
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingTechRequirements(tech, state.levels, user.techs),
    busy: user.research !== null,
  };
}

function shipCard(type: ShipType, state: BaseRuntimeState, user: UserRuntimeState): ShipCard {
  const cost = shipCost(type);

  return {
    type,
    label: shipLabel(type),
    description: shipDescription(type),
    cost,
    unitSeconds: shipUnitSeconds(type, state.levels.SHIPYARD),
    owned: state.ships[type],
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingShipRequirements(type, state.levels, user.techs),
  };
}

export function researchSnapshot(user: UserRuntimeState, now: number): ResearchSnapshot {
  return {
    techs: { ...user.techs },
    active: user.research
      ? {
          tech: user.research.tech,
          label: techLabel(user.research.tech),
          targetLevel: user.research.targetLevel,
          baseId: user.research.baseId,
          totalSeconds: Math.round((user.research.finishesAt - user.research.startedAt) / 1000),
          remainingSeconds: Math.max(0, Math.ceil((user.research.finishesAt - now) / 1000)),
        }
      : null,
  };
}

/** Снимки флотов в полете: клиент сам плавно двигает маркеры по меткам времени. */
export function fleetSnapshots(user: UserRuntimeState, now: number): FleetSnapshot[] {
  return user.fleets.map((fleet) => {
    const outbound = fleet.status === 'OUTBOUND';
    const legStart = outbound ? fleet.departedAt : fleet.arrivesAt;
    const legEnd = outbound ? fleet.arrivesAt : fleet.returnsAt;
    const legTotal = Math.max(1, legEnd - legStart);

    return {
      id: fleet.id,
      mission: fleet.mission,
      missionLabel: MISSION_LABELS[fleet.mission],
      status: fleet.status,
      originPlanetId: fleet.originPlanetId,
      originPlanetName: fleet.originPlanetName,
      targetKind: fleet.targetKind,
      targetPlanetId: fleet.targetPlanetId,
      targetHubId: fleet.targetHubId,
      targetName: fleet.targetName,
      ships: { ...fleet.ships },
      composition: describeComposition(fleet.ships),
      cargo: { ...fleet.cargo },
      pickup: { ...fleet.pickup },
      fuelSpent: fleet.fuelSpent,
      distance: fleet.distance,
      speed: fleet.speed,
      departedAt: fleet.departedAt,
      arrivesAt: fleet.arrivesAt,
      returnsAt: fleet.returnsAt,
      etaSeconds: Math.max(0, Math.ceil((legEnd - now) / 1000)),
      progress: Math.min(1, Math.max(0, (now - legStart) / legTotal)),
    };
  });
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundAll(amounts: BaseStock): BaseStock {
  return {
    metal: Math.round(amounts.metal * 1000) / 1000,
    crystal: Math.round(amounts.crystal * 1000) / 1000,
    deuterium: Math.round(amounts.deuterium * 1000) / 1000,
    antimatter: Math.round(amounts.antimatter * 100000) / 100000,
  };
}
