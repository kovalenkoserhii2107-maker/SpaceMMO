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
  buildingEnergyUsage,
  energyOutput,
  energyUsage,
  hasEnoughResources,
  missingBuildingRequirements,
  productionPerSecond,
  storageCapacities,
  type ResourceStorageState,
  storageCapacityForLevel,
  storageState,
  upgradeCost,
  type BuildingLevels,
  type BuildingType,
  type PlanetRichness,
} from './rules.js';
import {
  economyBonuses,
  missingTechRequirements,
  buildSpeedup,
  researchCost,
  timeCompressionDrain,
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
  cargo: { ore: number; polymers: number; plasma: number; antimatter: number };
  pickup: { ore: number; polymers: number };
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
 * ресурсов — иначе на полном складе руда вытесняла бы плазму просто потому,
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
    // Тот же расход, что и в снимке для клиента: иначе интерфейс показывал бы
    // просевшую добычу, а тик начислял бы полную.
    timeCompressionDrain(techs),
  );

  /*
   * Каждый ресурс упирается в свой собственный потолок.
   *
   * Пропорциональная обрезка по общему лимиту создавала тупик без выхода:
   * обильный ресурс занимал место, дефицитный переставал добываться вместе
   * с ним, а все постройки требовали именно дефицитного. Теперь полный склад
   * полимеров останавливает только полимеры — руда идет дальше.
   */
  const caps = storageCapacities(state.levels);
  const capped = (held: number, rate: number, capacity: number) =>
    Math.min(Math.max(held, capacity), held + rate * seconds);

  const next: BaseStock = {
    ore: capped(state.resources.ore, perSecond.ore, caps.ore),
    polymers: capped(state.resources.polymers, perSecond.polymers, caps.polymers),
    plasma: capped(state.resources.plasma, perSecond.plasma, caps.plasma),
    // Антиматерия хранится вне складов: у нее магнитные ловушки, а не ангары.
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
  // «Сжатие времени» ест энергию постоянно, наравне с постройками и обороной:
  // без этого его ускорение было бы бесплатным, а оно должно упираться в добычу.
  const techDrain = timeCompressionDrain(commander.techs);
  const usage = energyUsage(state.levels, defenseDrain, techDrain);
  const efficiency = energyEfficiency(state.levels, state.richness, bonuses, defenseDrain, techDrain);
  const storage = storageState(state.resources, storageCapacities(state.levels));

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
      ore: round(state.resources.ore),
      polymers: round(state.resources.polymers),
      plasma: round(state.resources.plasma),
      antimatter: Math.round(state.resources.antimatter * 1000) / 1000,
    },
    productionPerSecond: roundAll(
      productionPerSecond(state.levels, state.richness, bonuses, defenseDrain, modifiers, techDrain),
    ),
    storage: {
      capacity: storage.capacity,
      used: round(storage.used),
      anyFull: storage.anyFull,
      // По ресурсам — то, ради чего склады и разделены: игроку нужно видеть,
      // какой именно из трех уперся в потолок, а не что «место кончилось».
      ore: shortStorage(storage.ore),
      polymers: shortStorage(storage.polymers),
      plasma: shortStorage(storage.plasma),
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
    buildings: BUILDING_TYPES.map((type) => buildingCard(type, state, commander)),
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
    unitSeconds: defenseUnitSeconds(
      type,
      state.levels.SHIPYARD,
      systemModifiers(state.anomaly),
      buildSpeedup(commander.techs),
    ),
    owned: state.defenses[type],
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missingDefenseRequirements(type, state.levels, commander.techs),
  };
}

function buildingCard(
  type: BuildingType,
  state: BaseRuntimeState,
  commander: CommanderRuntimeState,
): BuildingCard {
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
    seconds: buildSeconds(type, nextLevel, systemModifiers(state.anomaly), buildSpeedup(commander.techs)),
    canAfford: hasEnoughResources(state.resources, cost),
    requirements: missing,
    effect: buildingEffect(type, state, commander, nextLevel),
    energy: {
      usage: round(buildingEnergyUsage(type, state.levels[type])),
      nextUsage: round(buildingEnergyUsage(type, nextLevel)),
    },
    busy: state.buildJob !== null,
  };
}

/**
 * Короткая подсказка «что даст следующий уровень».
 * Заполняется только там, где эффект не читается из названия: у шахт прирост
 * виден в добыче, а вместимость хранилища иначе узнать неоткуда.
 */
/**
 * Что даст следующий уровень — в тех же единицах, что игрок видит в интерфейсе.
 *
 * Раньше строка была только у склада, и по остальным карточкам нельзя было
 * понять, зачем вообще улучшать: цена и время есть, а выгода — нет. Считается
 * разница между текущим и следующим уровнем на реальных формулах, поэтому
 * богатство планеты и технологии в число уже заложены.
 */
function buildingEffect(
  type: BuildingType,
  state: BaseRuntimeState,
  commander: CommanderRuntimeState,
  nextLevel: number,
): string | null {
  const level = state.levels[type];
  const bonuses = economyBonuses(commander.techs);
  const modifiers = systemModifiers(state.anomaly);
  const drain = defenseEnergyUsage(state.defenses);
  const techDrain = timeCompressionDrain(commander.techs);
  const next = { ...state.levels, [type]: nextLevel };
  const perHour = (value: number) => Math.round(value * 3600).toLocaleString('ru-RU');

  if (type === 'ORE_STORAGE' || type === 'POLYMER_STORAGE' || type === 'PLASMA_STORAGE') {
    const now = storageCapacityForLevel(level);
    const after = storageCapacityForLevel(nextLevel);
    return `вместимость ${Math.round(now).toLocaleString('ru-RU')} → ${Math.round(after).toLocaleString('ru-RU')}`;
  }

  if (type === 'POWER_PLANT') {
    const now = energyOutput(state.levels, state.richness, bonuses);
    const after = energyOutput(next, state.richness, bonuses);
    return `энергия ${Math.round(now)} → ${Math.round(after)}`;
  }

  if (type === 'SCIENCE_CENTER') {
    // Лаборатория ускоряет исследования: показываем на конкретной технологии,
    // иначе «ускорение ×1.25» ничего не говорит о реальном сроке.
    const now = researchSeconds('ENERGY_TECH', commander.techs.ENERGY_TECH + 1, level, commander.techs, modifiers);
    const after = researchSeconds('ENERGY_TECH', commander.techs.ENERGY_TECH + 1, nextLevel, commander.techs, modifiers);
    return `исследования: ${fmtSeconds(now)} → ${fmtSeconds(after)}`;
  }

  if (type === 'SHIPYARD') {
    const speedup = buildSpeedup(commander.techs);
    const now = shipUnitSeconds('LIGHT_FIGHTER', level, modifiers, speedup);
    const after = shipUnitSeconds('LIGHT_FIGHTER', nextLevel, modifiers, speedup);
    // Формулировка короткая намеренно: в три строки она ломала выравнивание
    // ряда карточек, а мерится эффект все равно на истребителе.
    return `сборка кораблей: ${fmtSeconds(now)} → ${fmtSeconds(after)}`;
  }

  const production = (levels: BuildingLevels) =>
    productionPerSecond(levels, state.richness, bonuses, drain, modifiers, techDrain);

  if (type === 'ANTIMATTER_FACTORY') {
    const now = production(state.levels).antimatter;
    const after = production(next).antimatter;
    return `антиматерия ${perHour(now)} → ${perHour(after)} в час`;
  }

  const key = type === 'ORE_MINE' ? 'ore' : type === 'POLYMER_PLANT' ? 'polymers' : 'plasma';
  if (key === 'ore' || key === 'polymers' || key === 'plasma') {
    const now = production(state.levels)[key];
    const after = production(next)[key];
    return `добыча ${perHour(now)} → ${perHour(after)} в час`;
  }
  return null;
}

/** Состояние одного склада для клиента: округленное и без лишних знаков. */
function shortStorage(state: ResourceStorageState) {
  return {
    capacity: state.capacity,
    used: round(state.used),
    free: round(state.free),
    fill: Math.round(state.fill * 1000) / 1000,
    full: state.full,
    protectedAmount: round(state.protectedAmount),
    vulnerable: round(state.vulnerable),
  };
}

/** Короткая длительность для строки эффекта: минуты и часы, без секунд там, где их не читают. */
function fmtSeconds(value: number): string {
  if (value < 60) return `${Math.round(value)} с`;
  if (value < 3600) return `${Math.round(value / 60)} мин`;
  if (value < 86400) return `${(value / 3600).toFixed(1)} ч`;
  return `${(value / 86400).toFixed(1)} дн`;
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
      state.levels.SCIENCE_CENTER,
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
    unitSeconds: shipUnitSeconds(
      type,
      state.levels.SHIPYARD,
      systemModifiers(state.anomaly),
      buildSpeedup(commander.techs),
    ),
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
    ore: Math.round(amounts.ore * 1000) / 1000,
    polymers: Math.round(amounts.polymers * 1000) / 1000,
    plasma: Math.round(amounts.plasma * 1000) / 1000,
    antimatter: Math.round(amounts.antimatter * 100000) / 100000,
  };
}
