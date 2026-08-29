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
  storageCapacity,
  storageCapacityForLevel,
  storageState,
  storedTotal,
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
import { defenseCombatProfile, shipCombatProfile } from './combat.js';
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
  targetKind: 'PLANET' | 'HUB' | 'DEEP_SPACE';
  targetPlanetId: string | null;
  targetHubId: string | null;
  targetName: string;
  ships: ShipCounts;
  cargo: { metal: number; crystal: number; antimatter: number };
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
  commanderId: string;
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

export interface CommanderRuntimeState {
  commanderId: string;
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
 *
 * Добыча упирается в вместимость хранилища. Догон офлайна проходит здесь же,
 * поэтому недельное отсутствие не приносит больше, чем влезает на склад:
 * период уже разбит на отрезки по завершенным стройкам, а на каждом отрезке
 * начисление обрезается по остатку свободного места.
 *
 * Обрезается ровно та доля, которая не влезла, и одинаково для всех трех
 * ресурсов — иначе на полном складе металл вытеснял бы дейтерий просто потому,
 * что его добывают быстрее. Антиматерия под лимит не попадает.
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

  const mined = (perSecond.metal + perSecond.crystal + perSecond.deuterium) * seconds;
  const free = Math.max(0, storageCapacity(state.levels) - storedTotal(state.resources));
  const fit = mined > free ? free / mined : 1;

  const next: BaseStock = {
    metal: state.resources.metal + perSecond.metal * seconds * fit,
    crystal: state.resources.crystal + perSecond.crystal * seconds * fit,
    deuterium: state.resources.deuterium + perSecond.deuterium * seconds * fit,
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

export function toSnapshot(state: BaseRuntimeState, commander: CommanderRuntimeState, now: number): BaseSnapshot {
  const bonuses = economyBonuses(commander.techs);
  const modifiers = systemModifiers(state.anomaly);
  const defenseDrain = defenseEnergyUsage(state.defenses);
  const output = energyOutput(state.levels, state.richness, bonuses);
  const usage = energyUsage(state.levels, defenseDrain);
  const efficiency = energyEfficiency(state.levels, state.richness, bonuses, defenseDrain);
  const storage = storageState(state.resources, storageCapacity(state.levels));

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
    storage: {
      capacity: storage.capacity,
      used: round(storage.used),
      free: round(storage.free),
      fill: Math.round(storage.fill * 1000) / 1000,
      full: storage.full,
      protectedAmount: round(storage.protectedAmount),
      vulnerable: round(storage.vulnerable),
    },
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
    technologies: TECHNOLOGY_TYPES.map((tech) => technologyCard(tech, state, commander)),
    ships: SHIP_TYPES.map((type) => shipCard(type, state, commander)),
    defenseCards: DEFENSE_TYPES.map((type) => defenseCard(type, state, commander)),
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
  commander: CommanderRuntimeState,
): DefenseCard {
  const cost = defenseCost(type);

  return {
    type,
    label: defenseLabel(type),
    description: defenseDescription(type),
    combat: defenseCombatProfile(type),
    cost,
    unitSeconds: defenseUnitSeconds(type, state.levels.SHIPYARD, systemModifiers(state.anomaly)),
    owned: state.defenses[type],
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingDefenseRequirements(type, state.levels, commander.techs),
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
    effect: buildingEffect(type, state.levels[type], nextLevel),
    busy: state.buildJob !== null,
  };
}

/**
 * Короткая подсказка «что даст следующий уровень».
 * Заполняется только там, где эффект не читается из названия: у шахт прирост
 * виден в добыче, а вместимость хранилища иначе узнать неоткуда.
 */
function buildingEffect(type: BuildingType, level: number, nextLevel: number): string | null {
  if (type !== 'STORAGE') return null;
  const now = storageCapacityForLevel(level);
  const next = storageCapacityForLevel(nextLevel);
  return `вместимость ${Math.round(now)} → ${Math.round(next)}`;
}

function technologyCard(
  tech: TechnologyType,
  state: BaseRuntimeState,
  commander: CommanderRuntimeState,
): TechnologyCard {
  const nextLevel = commander.techs[tech] + 1;
  const cost = researchCost(tech, nextLevel);

  return {
    tech,
    label: techLabel(tech),
    description: techDescription(tech),
    level: commander.techs[tech],
    nextLevel,
    cost,
    seconds: researchSeconds(
      tech,
      nextLevel,
      state.levels.RESEARCH_LAB,
      commander.techs,
      systemModifiers(state.anomaly),
    ),
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingTechRequirements(tech, state.levels, commander.techs),
    busy: commander.research !== null,
  };
}

function shipCard(type: ShipType, state: BaseRuntimeState, commander: CommanderRuntimeState): ShipCard {
  const cost = shipCost(type);

  return {
    type,
    label: shipLabel(type),
    description: shipDescription(type),
    combat: shipCombatProfile(type),
    cost,
    unitSeconds: shipUnitSeconds(type, state.levels.SHIPYARD, systemModifiers(state.anomaly)),
    owned: state.ships[type],
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingShipRequirements(type, state.levels, commander.techs),
  };
}

export function researchSnapshot(commander: CommanderRuntimeState, now: number): ResearchSnapshot {
  return {
    techs: { ...commander.techs },
    active: commander.research
      ? {
          tech: commander.research.tech,
          label: techLabel(commander.research.tech),
          targetLevel: commander.research.targetLevel,
          baseId: commander.research.baseId,
          totalSeconds: Math.round((commander.research.finishesAt - commander.research.startedAt) / 1000),
          remainingSeconds: Math.max(0, Math.ceil((commander.research.finishesAt - now) / 1000)),
        }
      : null,
  };
}

/** Снимки флотов в полете: клиент сам плавно двигает маркеры по меткам времени. */
export function fleetSnapshots(commander: CommanderRuntimeState, now: number): FleetSnapshot[] {
  return commander.fleets.map((fleet) => {
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
