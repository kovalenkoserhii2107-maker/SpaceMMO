/** Состояние игрока и его баз в памяти Game Loop + снимки для клиента. */
import {
  NEUTRAL_SYNDICATE_BUFFS,
  effectiveSyndicateTechs,
  syndicateBuffs,
  type SyndicateBuffs,
  type SyndicateTech,
  type SyndicateTechLevels,
} from './syndicate.js';
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
  creditOutput,
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
  cryptoBonus,
  economyBonuses,
  missingTechRequirements,
  buildSpeedup,
  researchCost,
  timeCompressionDrain,
  vaultBonus,
  researchJoinQuote,
  researchSeconds,
  type ResearchJoinQuote,
  techDescription,
  techLabel,
  TECHNOLOGY_TYPES,
  type Requirement,
  type TechLevels,
  type TechnologyType,
} from './techTree.js';
import { describeComposition, flightProfile, MISSION_LABELS, type FleetMission } from './fleets.js';
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
  fromSystemId: string;
  toSystemId: string | null;
  originPlanetName: string;
  /// Цель — планета или торговый хаб.
  targetKind: 'PLANET' | 'HUB' | 'DEEP_SPACE' | 'KISH';
  targetSyndicateId: string | null;
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

export interface ResearchHelperState {
  baseId: string;
  /** Уровень лаборатории на момент присоединения: вклад фиксируется им. */
  labLevel: number;
  /** Уплачено за присоединение — при отмене возвращается этой же базе. */
  paid: { ore: number; polymers: number; plasma: number };
  /** Сколько секунд срезала: из них восстанавливается полный срок исследования. */
  savedSeconds: number;
}

export interface ResearchJobState {
  tech: TechnologyType;
  targetLevel: number;
  /** База, с которой запущено исследование. */
  baseId: string;
  startedAt: number;
  finishesAt: number;
  /** Уровень ведущей лаборатории на момент запуска — по нему считался срок. */
  labLevel: number;
  /** Лаборатории других колоний, присоединившиеся к работе. */
  helpers: ResearchHelperState[];
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
  /**
   * Намытая, но еще не записанная криптогривна.
   *
   * Отдельный счетчик, а не прямая правка баланса: деньги лежат у командира,
   * а добываются на базе, и биржа меняет тот же баланс из другого процесса.
   * Абсолютная запись затерла бы чужую сделку, поэтому накопленное уходит
   * в БД инкрементом.
   */
  minedCredits: number;
  /**
   * Синдикат и его расписание налога. Держится в памяти ради сброса:
   * налог удерживается в той же транзакции, что и намытое, и ходить
   * за ставкой в базу на каждом сбросе незачем. Смену членства и ставки
   * сервис синдиката сообщает тику сам.
   */
  syndicate: {
    id: string;
    tax: { taxRate: number; pendingTaxRate: number | null; taxEffectiveAt: number | null };
    /** Когда командир вступил: бонусы технологий действуют через двое суток. */
    joinedAt: number | null;
    techs: SyndicateTechLevels;
    research: { tech: SyndicateTech; targetLevel: number; finishesAt: number } | null;
  } | null;
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
export function accrue(
  state: BaseRuntimeState,
  techs: TechLevels,
  seconds: number,
  /**
   * Куда сложить намытую криптогривну. Деньги живут у командира, а добываются
   * на базе, поэтому база их не хранит, а только досыпает в общий счетчик.
   */
  commander?: { minedCredits: number },
  /** Множитель добычи от технологий синдиката: у командира без синдиката единица. */
  miningMultiplier = 1,
): void {
  if (!Number.isFinite(seconds) || seconds <= 0) return;

  if (commander) {
    // Криптогривна в склад не кладется и потолком не режется: это не тоннаж,
    // а запись в реестре.
    commander.minedCredits += creditOutput(state.levels, cryptoBonus(techs)) * seconds;
  }

  const perSecond = productionPerSecond(
    state.levels,
    state.richness,
    { ...economyBonuses(techs), mining: economyBonuses(techs).mining * miningMultiplier },
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

function researchJoinSnapshot(
  commander: CommanderRuntimeState,
  state: BaseRuntimeState,
  now: number,
): BaseSnapshot['researchJoin'] {
  const check = researchJoinCheck(commander, state, now);
  if (check.kind === 'none') return null;
  if (check.kind === 'blocked') {
    return {
      available: false,
      reason: check.reason,
      share: 0,
      labLevel: state.levels.SCIENCE_CENTER,
      savedSeconds: 0,
      price: { ore: 0, polymers: 0, plasma: 0 },
      canAfford: false,
    };
  }
  return {
    available: true,
    reason: null,
    share: check.quote.share,
    labLevel: state.levels.SCIENCE_CENTER,
    savedSeconds: check.quote.savedSeconds,
    price: check.quote.price,
    canAfford: hasEnoughResources(state.resources, check.quote.price),
  };
}


/**
 * Бонусы технологий синдиката для командира в памяти тика.
 *
 * Завершенное по сроку изучение уже действует, даже если его еще никто
 * не записал в базу: синдикаты тик в памяти не держит и завершает их лениво.
 */
export function commanderSyndicateBuffs(commander: CommanderRuntimeState, now = Date.now()): SyndicateBuffs {
  const syndicate = commander.syndicate;
  if (!syndicate) return NEUTRAL_SYNDICATE_BUFFS;
  return syndicateBuffs(effectiveSyndicateTechs(syndicate.techs, syndicate.research, now), syndicate.joinedAt, now);
}

/** Экономические бонусы командира: свои технологии и технологии синдиката. */
export function commanderEconomyBonuses(commander: CommanderRuntimeState, now = Date.now()): ReturnType<typeof economyBonuses> {
  const bonuses = economyBonuses(commander.techs);
  return { ...bonuses, mining: bonuses.mining * commanderSyndicateBuffs(commander, now).mining };
}

/** Ускорение стройки и сборки: робототехника, сжатие времени и артель синдиката. */
export function commanderBuildSpeedup(commander: CommanderRuntimeState, now = Date.now()): number {
  return buildSpeedup(commander.techs) * commanderSyndicateBuffs(commander, now).construction;
}

export function toSnapshot(state: BaseRuntimeState, commander: CommanderRuntimeState, now: number): BaseSnapshot {
  const bonuses = commanderEconomyBonuses(commander);
  const modifiers = systemModifiers(state.anomaly);
  const defenseDrain = defenseEnergyUsage(state.defenses);
  const output = energyOutput(state.levels, state.richness, bonuses);
  // «Сжатие времени» ест энергию постоянно, наравне с постройками и обороной:
  // без этого его ускорение было бы бесплатным, а оно должно упираться в добычу.
  const techDrain = timeCompressionDrain(commander.techs);
  const usage = energyUsage(state.levels, defenseDrain, techDrain);
  const efficiency = energyEfficiency(state.levels, state.richness, bonuses, defenseDrain, techDrain);
  const storage = storageState(state.resources, storageCapacities(state.levels), vaultBonus(commander.techs));

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
    researchJoin: researchJoinSnapshot(commander, state, now),
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
      commanderBuildSpeedup(commander),
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
    seconds: buildSeconds(type, nextLevel, systemModifiers(state.anomaly), commanderBuildSpeedup(commander)),
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
/**
 * Строка эффекта постройки: что изменится после улучшения.
 *
 * Возвращается разобранной на значок и текст, а не одной фразой. Слово
 * «добыча» на карточке рудной шахты не сообщало ничего — что шахта добывает,
 * сказано в ее названии, — зато занимало место и переносило строку. Значок
 * ресурса на его месте отвечает на вопрос, которого текст не касался вовсе:
 * чего именно столько-то. Там, где существительное несет смысл сверх ресурса
 * («вместимость», «выработка»), оно остается: без него склад и шахта читались
 * бы одинаково.
 */
function buildingEffect(
  type: BuildingType,
  state: BaseRuntimeState,
  commander: CommanderRuntimeState,
  nextLevel: number,
): { icon: string | null; text: string } | null {
  const level = state.levels[type];
  const bonuses = commanderEconomyBonuses(commander);
  const modifiers = systemModifiers(state.anomaly);
  const drain = defenseEnergyUsage(state.defenses);
  const techDrain = timeCompressionDrain(commander.techs);
  const next = { ...state.levels, [type]: nextLevel };
  const perHour = (value: number) => Math.round(value * 3600).toLocaleString('ru-RU');

  if (type === 'ORE_STORAGE' || type === 'POLYMER_STORAGE' || type === 'PLASMA_STORAGE') {
    const now = storageCapacityForLevel(level);
    const after = storageCapacityForLevel(nextLevel);
    const stored = type === 'ORE_STORAGE' ? 'ore' : type === 'POLYMER_STORAGE' ? 'polymers' : 'plasma';
    return {
      icon: stored,
      text: `вместимость ${Math.round(now).toLocaleString('ru-RU')} → ${Math.round(after).toLocaleString('ru-RU')}`,
    };
  }

  if (type === 'CRYPTO_FARM') {
    const bonus = cryptoBonus(commander.techs);
    const now = creditOutput(state.levels, bonus);
    const after = creditOutput(next, bonus);
    return { icon: 'credits', text: `${perHour(now)} → ${perHour(after)} в час` };
  }

  if (type === 'POWER_PLANT') {
    const now = energyOutput(state.levels, state.richness, bonuses);
    const after = energyOutput(next, state.richness, bonuses);
    // Именно «выработка»: на карточке рядом стоит строка расхода, и один
    // значок молнии в обеих не отвечал бы, дается энергия или тратится.
    return { icon: 'energy', text: `выработка ${Math.round(now)} → ${Math.round(after)}` };
  }

  if (type === 'SCIENCE_CENTER') {
    // Лаборатория ускоряет исследования: показываем на конкретной технологии,
    // иначе «ускорение ×1.25» ничего не говорит о реальном сроке.
    const now = researchSeconds('ENERGY_TECH', commander.techs.ENERGY_TECH + 1, level, commander.techs, modifiers);
    const after = researchSeconds('ENERGY_TECH', commander.techs.ENERGY_TECH + 1, nextLevel, commander.techs, modifiers);
    return { icon: null, text: `исследования: ${fmtSeconds(now)} → ${fmtSeconds(after)}` };
  }

  if (type === 'SHIPYARD') {
    const speedup = commanderBuildSpeedup(commander);
    const now = shipUnitSeconds('LIGHT_FIGHTER', level, modifiers, speedup);
    const after = shipUnitSeconds('LIGHT_FIGHTER', nextLevel, modifiers, speedup);
    // Формулировка короткая намеренно: в три строки она ломала выравнивание
    // ряда карточек, а мерится эффект все равно на истребителе.
    return { icon: null, text: `сборка кораблей: ${fmtSeconds(now)} → ${fmtSeconds(after)}` };
  }

  const production = (levels: BuildingLevels) =>
    productionPerSecond(levels, state.richness, bonuses, drain, modifiers, techDrain);

  if (type === 'ANTIMATTER_FACTORY') {
    const now = production(state.levels).antimatter;
    const after = production(next).antimatter;
    return { icon: 'antimatter', text: `${perHour(now)} → ${perHour(after)} в час` };
  }

  const key = type === 'ORE_MINE' ? 'ore' : type === 'POLYMER_PLANT' ? 'polymers' : 'plasma';
  if (key === 'ore' || key === 'polymers' || key === 'plasma') {
    const now = production(state.levels)[key];
    const after = production(next)[key];
    return { icon: key, text: `${perHour(now)} → ${perHour(after)} в час` };
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
    flight: flightProfile(type),
    cost,
    unitSeconds: shipUnitSeconds(
      type,
      state.levels.SHIPYARD,
      systemModifiers(state.anomaly),
      commanderBuildSpeedup(commander),
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
          participants: [
            { baseId: commander.research.baseId, labLevel: commander.research.labLevel, share: 0, lead: true },
            ...commander.research.helpers.map((helper) => ({
              baseId: helper.baseId,
              labLevel: helper.labLevel,
              share: fullResearchSeconds(commander.research!) > 0
                ? helper.savedSeconds / fullResearchSeconds(commander.research!)
                : 0,
              lead: false,
            })),
          ].map((row) => ({ ...row, baseName: commander.bases.get(row.baseId)?.name ?? '—' })),
        }
      : null,
  };
}

/**
 * Полный срок исследования на момент запуска, до всякой помощи.
 *
 * Отдельно не хранится: он складывается из нынешнего срока и того, что срезали
 * помощницы. Доля каждой следующей меряется от него же, иначе вторая
 * помощница считала бы свою четверть от уже урезанного срока и получала
 * меньше, чем заплатила.
 */
export function fullResearchSeconds(job: ResearchJobState): number {
  return (job.finishesAt - job.startedAt) / 1000 + job.helpers.reduce((sum, helper) => sum + helper.savedSeconds, 0);
}

export type ResearchJoinCheck =
  | { kind: 'none' }
  | { kind: 'blocked'; reason: string }
  | { kind: 'ready'; quote: ResearchJoinQuote };

/**
 * Может ли лаборатория этой базы присоединиться к идущему исследованию.
 *
 * Одна проверка на снимок и на само действие: иначе интерфейс однажды
 * предложил бы кнопку, на которую сервер ответит отказом, или цену,
 * которая разойдется со списанной.
 *
 * «Нечего показывать» и «нельзя» — разные ответы. Ведущей и уже
 * присоединившейся лаборатории предлагать нечего; базе без лаборатории
 * и почти готовому исследованию есть что объяснить.
 */
export function researchJoinCheck(
  commander: CommanderRuntimeState,
  base: BaseRuntimeState,
  now: number,
): ResearchJoinCheck {
  const job = commander.research;
  if (!job) return { kind: 'none' };
  if (job.baseId === base.id || job.helpers.some((helper) => helper.baseId === base.id)) {
    return { kind: 'none' };
  }
  if (base.levels.SCIENCE_CENTER < 1) {
    return { kind: 'blocked', reason: 'На этой базе нет лаборатории' };
  }
  const quote = researchJoinQuote({
    tech: job.tech,
    targetLevel: job.targetLevel,
    leadLevel: job.labLevel,
    joiningLevel: base.levels.SCIENCE_CENTER,
    remainingSeconds: (job.finishesAt - now) / 1000,
    totalSeconds: fullResearchSeconds(job),
  });
  if (quote.savedSeconds < 1) {
    return { kind: 'blocked', reason: 'Исследование почти готово — ускорять нечего' };
  }
  return { kind: 'ready', quote };
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
      fromSystemId: fleet.fromSystemId,
      toSystemId: fleet.toSystemId,
      targetKind: fleet.targetKind,
      targetSyndicateId: fleet.targetSyndicateId,
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
