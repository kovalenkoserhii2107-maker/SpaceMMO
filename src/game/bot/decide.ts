/**
 * Решения бота.
 *
 * Модуль намеренно чистый: на вход снимок мира, на выход список намерений.
 * Ни БД, ни Game Loop, ни времени «сейчас» из системы — все приходит
 * параметрами. Поэтому поведение бота можно гонять сериями в тестах прямо
 * на игровых модулях, как бой и полеты, и проверять не «бот сходил»,
 * а «за неделю бот вышел на правдоподобные уровни и ни разу не встал».
 *
 * Игровых правил здесь тоже нет: цены, время, требования и энергию бот
 * считает теми же функциями, что и интерфейс живого игрока. Если правило
 * изменится, бот узнает об этом сам.
 */
import {
  type StorageCapacities,
  creditOutput,
  BUILDING_TYPES,
  emptyLevels,
  energyEfficiency,
  hasEnoughResources,
  missingBuildingRequirements,
  multiplyResources,
  productionPerSecond,
  MINE_FOR,
  STORAGE_FOR,
  STORED_RESOURCES,
  type StoredResource,
  storageCapacities,
  systemModifiers,
  upgradeCost,
  type BuildingLevels,
  type BuildingType,
  type PlanetRichness,
  type ResourceAmounts,
} from '../rules.js';
import {
  DEFENSE_TYPES,
  defenseCost,
  emptyDefenseCounts,
  missingDefenseRequirements,
  type DefenseCounts,
  type DefenseType,
} from '../defenses.js';
import {
  COMBAT_TYPES,
  SHIP_TYPES,
  emptyShipCounts,
  missingShipRequirements,
  shipCost,
  type ShipCounts,
  type ShipType,
} from '../ships.js';
import { canJump, fleetCapacity, planFlight, type GalaxyPoint } from '../fleets.js';
import { holdForCargo, homeKeep, hubDeliveryLoad } from './logistics.js';
import { hubRent, storageUpgradeCost } from '../market.js';
import { hopeless } from './directives.js';
import {
  cryptoBonus,
  colonySlots,
  economyBonuses,
  missingTechRequirements,
  researchCost,
  timeCompressionDrain,
  type TechLevels,
  type TechnologyType,
} from '../techTree.js';
import { costUnits, spentOnBuildings, spentOnDefense, spentOnFleet, spentOnResearch } from '../score.js';
import {
  NEWBIE_SHIELD_DAYS,
  personality,
  type BotCharacter,
  type BotPersonality,
} from './personality.js';
import {
  isSyndicateTech,
  missingSyndicateRequirements,
  progressLevel,
  syndicateProgress,
  syndicateModuleCost,
  syndicateTechCost,
  type SyndicateModule,
  type SyndicateTech,
  type SyndicateTechLevels,
  type TreasuryCost,
} from '../syndicate.js';
import { BOT_MILESTONE_LABELS, type BotMilestone } from './milestones.js';

/* ------------------------- Снимок мира ------------------------- */

export interface BotBaseSnapshot {
  id: string;
  planetId: string;
  systemId: string;
  /** Орбита самой базы — вторая точка маршрута при расчете топлива. */
  orbit: number;
  /**
   * Антиматерия на базе. В `resources` ее нет — там только то, что лежит
   * на складах под лимитом, — а без нее не выйдет ни одного межзвездного
   * рейса, и это надо знать до того, как рейс запланирован.
   */
  antimatter: number;
  levels: BuildingLevels;
  richness: PlanetRichness;
  anomaly: string;
  resources: ResourceAmounts;
  ships: ShipCounts;
  defenses: DefenseCounts;
  /** Занята ли очередь стройки: второе здание в нее не встанет. */
  building: boolean;
  /** Сколько заказов уже стоит в верфи и на оборонных стапелях. */
  shipQueue: number;
  defenseQueue: number;
}

/** Свободная планета, которую бот может занять. */
export interface BotFreePlanet {
  planetId: string;
  systemId: string;
  /** Расстояние от столицы бота в клетках карты — ближние занимаются первыми. */
  distance: number;
}

/** Чужая колония как возможная цель набега. */
export interface BotRaidTarget {
  planetId: string;
  commanderId: string;
  /** Возраст аккаунта в сутках: щит новичка считается по нему. */
  accountAgeDays: number;
  /** Бот ли это. Щит новичка между ботами не действует. */
  isBot: boolean;
  /**
   * Оценка обороны цели по последней разведке в единицах ресурсов.
   * null — цель не разведана, лететь вслепую бот не станет.
   */
  knownStrength: number | null;
  /**
   * Что из этой оценки приходится на корабли.
   *
   * Нужно отдельно от общей силы: обломки дает только разбитый флот, оборона
   * восстанавливается на месте и в поле не улетает. Цель с турелями на сто
   * тысяч и без единого корабля не оставит после себя ничего.
   */
  knownFleetValue: number | null;
  /**
   * Сколько ресурсов лежало у цели в момент разведки.
   *
   * Это и есть добыча, ради которой летят. null — склад разглядеть не вышло:
   * ступень разведки до него не дотянулась.
   */
  knownStock: number | null;
  /** Орбита цели: внутри системы от нее зависит и время, и расход плазмы. */
  orbit: number;
  distance: number;
}

export interface BotMarketRef {
  resource: 'ORE' | 'POLYMERS';
  /** Рыночная цена: средневзвешенная по последним сделкам между игроками. */
  reference: number;
  /** Сделок еще не было — цена взята из затравки и рынком не подтверждена. */
  seeded: boolean;
  /** Сколько единиц хотят купить и сколько продать: весь стакан по сторонам. */
  demand: number;
  supply: number;
  /** Перекос спроса от -1 (одни продавцы) до +1 (одни покупатели). */
  skew: number | null;
  /**
   * Тот же перекос, но без собственных заявок бота.
   *
   * Нужен только для одного вопроса: сказал ли рынок что-то новое. Стакан
   * тонкий — четыре бота на хабе, — и своей же снятой заявкой бот
   * переворачивал перекос с +1 на -1, читал это как новость и будил модель:
   * семь переворотов за полтора часа у каждого из четверых, 27 поводов
   * из 33 за ночь. Новость — это когда подвинулся кто-то другой.
   *
   * На цену он не влияет: коридор строится по общему стакану, потому что
   * платить приходится в нем, а не в очищенном от себя.
   */
  foreignSkew: number | null;
}

/**
 * Серийный агрессор поблизости.
 *
 * Один набег — это война, дело обычное. Три и больше за сутки по одной жертве
 * — это уже промысел, и в одиночку жертве его не остановить: живой Купець
 * получил шестьдесят один набег подряд, потерял весь флот и всю оборону
 * и только предлагал мир, который агрессор игнорировал.
 *
 * Против такого соседи скидываются. Договора между ними нет и не нужно:
 * согласие — это когда сосед действительно объявил войну, а не строка в базе.
 * Каждый решает сам, по той же оценке сил, по какой решает любой набег.
 */
export interface BotThreat {
  commanderId: string;
  nickname: string;
  /** Планета, по которой можно ударить. */
  planetId: string;
  /** Сколько набегов он совершил за сутки. */
  raids: number;
  /** Бил ли он лично нас: своя обида поднимает готовность вложиться. */
  againstMe: boolean;
  /** Оценка его обороны по разведке. null — не разведан. */
  knownStrength: number | null;
  /** Орбита его планеты — без нее не посчитать, долетим ли до него вообще. */
  planetOrbit: number;
  distance: number;
}

/** Заявка в стакане — своя или чужая. */
export interface BotMarketOrder {
  id: string;
  side: 'BUY' | 'SELL';
  resource: 'ORE' | 'POLYMERS';
  price: number;
  amount: number;
  mine: boolean;
}

/** Поле обломков над планетой: их видно всем и туманом войны не скрывается. */
export interface BotDebrisField {
  planetId: string;
  systemId: string;
  orbit: number;
  ore: number;
  polymers: number;
  distance: number;
}

/** Синдикат, в котором состоит бот: то, от чего зависит его вклад и стройка. */
export interface BotSyndicate {
  id: string;
  name: string;
  tag: string;
  isLeader: boolean;
  /** Права ранга: строить модули Коша, вести Академию, разбирать заявки. */
  canBuild: boolean;
  canResearch: boolean;
  canReview: boolean;
  members: number;
  memberCap: number;
  kishLevel: number;
  treasuryLevel: number;
  academyLevel: number;
  watchLevel: number;
  techs: SyndicateTechLevels;
  bank: { credits: number; ore: number; polymers: number };
  /** Занята ли стройка в Коше и Академия: вторые в очередь не встанут. */
  construction: boolean;
  research: boolean;
  /**
   * Стоит ли Кіш в системе бота. Ресурсы в казну возят только рейсом,
   * а в чужую систему нужен гиперпрыжок с антиматерией, которой у ботов нет.
   */
  kishInMySystem: boolean;
  /** Рейс с грузом в Кіш уже в пути: второй под ту же цель не нужен. */
  deliveringToKish: boolean;
  /** Вносил ли бот гривну за последний час: взнос раз в заход был бы россыпью. */
  donatedRecently: boolean;
  /** Заявки к нам. Решает по ним модель, а видит их только ранг с правом. */
  applications: Array<{ id: string; commanderId: string; nickname: string; isBot: boolean }>;
}

/** Синдикат сервера глазами кандидата: куда можно вступить. */
export interface BotSyndicateListing {
  id: string;
  name: string;
  tag: string;
  leader: string;
  members: number;
  memberCap: number;
  recruitment: 'OPEN' | 'APPLICATION' | 'CLOSED';
  entryFee: number;
  minScore: number;
  /** Сколько в составе живых игроков и ботов. */
  humans: number;
  bots: number;
  /** Кіш в системе бота: только такой синдикат получает от него ресурсы. */
  sameSystem: boolean;
  /** Действующий кодекс: заявка принимает ровно эту версию. */
  codexId: string | null;
  /** Заявка туда уже подана. */
  applied: boolean;
}

export interface BotSnapshot {
  character: BotCharacter;
  credits: number;
  techs: TechLevels;
  /** Идет ли исследование: второе в очередь не встанет. */
  researching: boolean;
  bases: BotBaseSnapshot[];
  /** Сколько кораблей бота уже в полете — по ним видно занятость. */
  fleetsInFlight: number;
  /** Экспедиции занимают отдельные слоты, которые дает астрофизика. */
  expeditionsInFlight: number;
  expeditionSlots: number;
  /** Вторичные лаборатории, которые прямо сейчас могут помочь исследованию. */
  joinableResearchBases: string[];
  freePlanets: BotFreePlanet[];
  raidTargets: BotRaidTarget[];
  market: BotMarketRef[];
  /** Поля обломков поблизости — цель для переработчика. */
  debrisFields: BotDebrisField[];
  /** Серийные агрессоры по соседству: против них скидываются всем миром. */
  threats: BotThreat[];
  /**
   * Самый большой флот, какой у бота был. По нему он видит, что разбит.
   *
   * Чужой флот измерить нечем — разведка показывает оборону, — а свой бот
   * знает точно, и порог отступления считает он сам.
   */
  fleetPeak: number;
  /** Сколько командиров объявили войну нам. Двое и больше — это союз. */
  warsAgainstMe: number;
  /**
   * Весь стакан, свои заявки и чужие.
   *
   * Своих хватало, пока бот умел только выставлять: без них он повторял одну
   * и ту же заявку каждые сорок пять секунд, потому что породившее ее условие
   * держится часами. Чужие нужны затем, что торговля — это не только выставить
   * свою цену, но и взять чужую. Без них три бота на одном хабе висели
   * с непересекающимися заявками и не совершили ни одной сделки.
   */
  orderBook: BotMarketOrder[];
  /**
   * Склад на хабе. Продавать можно только тем, что уже лежит на станции:
   * товар туда возит флот, и решать о продаже по остаткам базы бессмысленно.
   */
  hubStorage: {
    ore: number;
    polymers: number;
    free: number;
    /** Уровень склада и цена следующего: расширение платится криптогривной. */
    level: number;
    upgradeCost: number;
    /** Текущая часовая аренда — часть денег нельзя считать свободной. */
    currentRentPerHour: number;
    /**
     * Во что обойдется следующий уровень в час — навсегда.
     *
     * Цена расширения платится один раз, а место на хабе стоит денег каждую
     * секунду, и растет эта плата вдвое с каждым уровнем. Бот, который смотрит
     * только на цену расширения, покупает себе вечный расход, не спросив,
     * из чего его платить.
     */
    nextRentPerHour: number;
  };
  /** Уже отправлен ли колониальный рейс: два на одну планету не нужны. */
  colonizing: boolean;
  /**
   * Планеты, к которым разведка сейчас бессмысленна.
   *
   * Зонд, сбитый чужой контрразведкой, не оставляет записи: цель остается
   * неразведанной, и следующий заход выбирает ее снова — та же ближайшая,
   * тот же зонд, тот же итог. Живой Хижак сжег так семнадцать зондов за три
   * часа об одну планету, Яструб — восемь, и оба продолжали.
   *
   * Список считает `director` по памяти бота: он знает, когда была попытка
   * и чем кончилась. `decide` остается чистой и просто не выбирает эти цели.
   */
  scoutBlocked: string[];
  /**
   * Разведка не удается вовсе: зонды гибнут один за другим.
   *
   * Закрывать цели по одной мало — бот просто берет следующую и перебирает
   * соседей подряд. Живые Яструб и Беркут с «Шпионажем» 4 при шестерке
   * и восьмерке у соседей потеряли так восемь зондов за семь минут, меняя
   * цель каждый раз. Отстающему нужна не другая планета, а уровень
   * технологии: пока его нет, любой зонд — подарок чужой контрразведке.
   */
  scoutHopeless: boolean;
  /** Свой синдикат. null — бот одиночка. */
  syndicate: BotSyndicate | null;
  /** Все синдикаты сервера: из них модель выбирает, куда вступить. */
  syndicates: BotSyndicateListing[];
  /** Сутки после выхода вступать никуда нельзя. */
  syndicateCooldown: boolean;
}

/* ------------------------- Намерения ------------------------- */

export type BotIntent =
  | { kind: 'BUILD'; baseId: string; building: BuildingType; why: string }
  | { kind: 'RESEARCH'; baseId: string; tech: TechnologyType; why: string }
  | { kind: 'SHIPS'; baseId: string; ship: ShipType; count: number; why: string }
  | { kind: 'DEFENSE'; baseId: string; defense: DefenseType; count: number; why: string }
  | { kind: 'COLONIZE'; baseId: string; planetId: string; why: string }
  | { kind: 'EXPEDITION'; baseId: string; ships: ShipCounts; why: string }
  | { kind: 'HARVEST'; baseId: string; planetId: string; ships: ShipCounts; why: string }
  | { kind: 'JOIN_RESEARCH'; baseId: string; why: string }
  | { kind: 'RAID'; baseId: string; planetId: string; ships: ShipCounts; why: string }
  | { kind: 'SCAN'; baseId: string; planetId: string; why: string }
  /** Исполнить чужую заявку — сделка происходит сразу, а не когда-нибудь. */
  | { kind: 'TAKE'; orderId: string; amount: number; why: string }
  /** Снять собственную заявку: она больше не отвечает намерениям бота. */
  | { kind: 'DROP'; orderId: string; why: string }
  /** Забрать товар с хаба домой: строят из того, что лежит на базе. */
  | { kind: 'PICKUP'; baseId: string; ore: number; polymers: number; why: string }
  | { kind: 'HUB_DELIVERY'; baseId: string; ore: number; polymers: number; why: string }
  /** Расширить склад на хабе — платится криптогривной. */
  | { kind: 'HUB_UPGRADE'; why: string }
  /** Доделать стройку немедленно за криптогривну. */
  | { kind: 'RUSH'; baseId: string; why: string }
  /** Взнос гривной в казну синдиката. */
  | { kind: 'DONATE'; amount: number; why: string }
  /** Рейс с рудой и полимерами в казну Коша. */
  | { kind: 'KISH_DELIVERY'; baseId: string; ore: number; polymers: number; why: string }
  /** Стройка модуля Коша из казны. */
  | { kind: 'SYNDICATE_BUILD'; module: SyndicateModule; why: string }
  /** Изучение технологии синдиката из казны. */
  | { kind: 'SYNDICATE_RESEARCH'; tech: SyndicateTech; why: string }
  /** Призыв к соседям: против серийного агрессора в одиночку не выстоять. */
  | { kind: 'RALLY'; commanderId: string; nickname: string; raids: number; why: string }
  | {
      kind: 'ORDER';
      side: 'BUY' | 'SELL';
      resource: 'ORE' | 'POLYMERS';
      amount: number;
      price: number;
      why: string;
    };

/**
 * Ресурсы, которыми торгует биржа. Список объявлен здесь, а не берется
 * из directives.ts: тот модуль импортирует этот, и обратная ссылка замкнула бы
 * модули в кольцо.
 */
const TRADED = ['ORE', 'POLYMERS'] as const;

/**
 * Сколько часов собственной добычи бот готов копить на один пункт плана,
 * не трогая слот стройки. Дальше цель не ждут, а строят посильное из плана.
 */
const SAVING_HORIZON_HOURS = 6;

/* ------------------------- Кошельки ------------------------- */

/**
 * Доход делится на направления долями характера, и каждое тратит только свою
 * долю склада. Направление, которому не хватает на цель, просто ждет —
 * склад растет, растет и его доля. Так бот развивается сразу по всем фронтам
 * и не уходит в одну ветку до упора, как ушел бы жадный алгоритм «покупай
 * самое окупаемое».
 */
type Direction = 'economy' | 'research' | 'fleet' | 'defense';

export type BotMilestoneStep =
  | { kind: 'BUILD'; building: BuildingType; targetLevel: number; milestone: BotMilestone }
  | { kind: 'RESEARCH'; tech: TechnologyType; targetLevel: number; milestone: BotMilestone }
  | { kind: 'SHIPS'; ship: ShipType; targetCount: number; milestone: BotMilestone }
  | { kind: 'DEFENSE'; defense: DefenseType; targetCount: number; milestone: BotMilestone };

type BareMilestoneStep =
  | { kind: 'BUILD'; building: BuildingType; targetLevel: number }
  | { kind: 'RESEARCH'; tech: TechnologyType; targetLevel: number }
  | { kind: 'SHIPS'; ship: ShipType; targetCount: number }
  | { kind: 'DEFENSE'; defense: DefenseType; targetCount: number };

function buildingMilestoneStep(
  building: BuildingType,
  targetLevel: number,
  levels: BuildingLevels,
): BareMilestoneStep | null {
  if (levels[building] >= targetLevel) return null;
  const prerequisite = missingBuildingRequirements(building, levels)[0];
  if (prerequisite) return buildingMilestoneStep(prerequisite.building, prerequisite.level, levels);
  return { kind: 'BUILD', building, targetLevel };
}

function researchMilestoneStep(
  tech: TechnologyType,
  targetLevel: number,
  levels: BuildingLevels,
  techs: TechLevels,
): BareMilestoneStep | null {
  if (techs[tech] >= targetLevel) return null;
  const prerequisite = missingTechRequirements(tech, levels, techs)[0];
  if (prerequisite?.kind === 'building') {
    return buildingMilestoneStep(prerequisite.key as BuildingType, prerequisite.level, levels);
  }
  if (prerequisite?.kind === 'tech') {
    return researchMilestoneStep(prerequisite.key as TechnologyType, prerequisite.level, levels, techs);
  }
  return { kind: 'RESEARCH', tech, targetLevel };
}

function shipMilestoneStep(
  ship: ShipType,
  targetCount: number,
  base: BotBaseSnapshot,
  techs: TechLevels,
): BareMilestoneStep | null {
  if (base.ships[ship] >= targetCount) return null;
  const prerequisite = missingShipRequirements(ship, base.levels, techs)[0];
  if (prerequisite?.kind === 'building') {
    return buildingMilestoneStep(prerequisite.key as BuildingType, prerequisite.level, base.levels);
  }
  if (prerequisite?.kind === 'tech') {
    return researchMilestoneStep(prerequisite.key as TechnologyType, prerequisite.level, base.levels, techs);
  }
  return { kind: 'SHIPS', ship, targetCount };
}

function defenseMilestoneStep(
  defense: DefenseType,
  targetCount: number,
  base: BotBaseSnapshot,
  techs: TechLevels,
): BareMilestoneStep | null {
  if (base.defenses[defense] >= targetCount) return null;
  const prerequisite = missingDefenseRequirements(defense, base.levels, techs)[0];
  if (prerequisite?.kind === 'building') {
    return buildingMilestoneStep(prerequisite.key as BuildingType, prerequisite.level, base.levels);
  }
  if (prerequisite?.kind === 'tech') {
    return researchMilestoneStep(prerequisite.key as TechnologyType, prerequisite.level, base.levels, techs);
  }
  return { kind: 'DEFENSE', defense, targetCount };
}

/**
 * Первый незавершенный шаг долгого курса.
 *
 * Требования раскрываются рекурсивно теми же функциями правил, что обслуживают
 * игрока. Здесь нет второй копии дерева технологий: если ворота изменятся,
 * бот на следующем решении увидит новые требования автоматически.
 */
export function nextMilestoneStep(snapshot: BotSnapshot, profile: BotPersonality): BotMilestoneStep | null {
  const base = snapshot.bases[0];
  if (!base) return null;

  const stepFor = (milestone: BotMilestone): BareMilestoneStep | null => {
    switch (milestone) {
      case 'EXPEDITION_PROGRAM':
        return (
          researchMilestoneStep('ASTROPHYSICS', 1, base.levels, snapshot.techs) ??
          shipMilestoneStep('SMALL_CARGO', 1, base, snapshot.techs) ??
          shipMilestoneStep('LIGHT_FIGHTER', 2, base, snapshot.techs)
        );
      case 'INTERSTELLAR_REACH':
        return (
          researchMilestoneStep('HYPERDRIVE', 1, base.levels, snapshot.techs) ??
          buildingMilestoneStep('ANTIMATTER_FACTORY', 1, base.levels)
        );
      case 'RECYCLING_CORPS':
        return shipMilestoneStep('RECYCLER', 1, base, snapshot.techs);
      case 'SECOND_COLONY':
      case 'THIRD_COLONY': {
        const target = milestone === 'SECOND_COLONY' ? 2 : 3;
        if (snapshot.bases.length >= target || snapshot.colonizing) return null;
        return shipMilestoneStep('COLONY_SHIP', 1, base, snapshot.techs);
      }
      case 'CRUISER_CORE':
        return shipMilestoneStep('CRUISER', 4, base, snapshot.techs);
      case 'FRIGATE_SCREEN':
        return shipMilestoneStep('FRIGATE', 4, base, snapshot.techs);
      case 'BOMBER_WING':
        return shipMilestoneStep('BOMBER', 2, base, snapshot.techs);
      case 'BATTLESHIP_LINE':
        return shipMilestoneStep('BATTLESHIP', 2, base, snapshot.techs);
      case 'CARRIER_GROUP':
        return shipMilestoneStep('CARRIER', 1, base, snapshot.techs);
      case 'FORTIFIED_CAPITAL':
        return defenseMilestoneStep('GAUSS', 8, base, snapshot.techs);
      // Эти две цели исполняются общими правилами синдиката и Брам, а не
      // личной очередью столицы. Они остаются в курсе и видны модели.
      case 'SYNDICATE_BUILDER':
      case 'GATE_NETWORK':
        return null;
    }
  };

  for (const milestone of profile.milestones) {
    const step = stepFor(milestone);
    if (step) return { ...step, milestone } as BotMilestoneStep;
  }
  return null;
}

function wallet(stock: ResourceAmounts, share: number): ResourceAmounts {
  return {
    ore: stock.ore * share,
    polymers: stock.polymers * share,
    plasma: stock.plasma * share,
  };
}

/**
 * Может ли направление позволить себе покупку.
 *
 * Доля — правило дележа дохода, а не физический потолок. Но если цель дороже,
 * чем помещается в долю даже при забитом под завязку складе, доля превращается
 * в запрет навсегда: копить больше некуда, склад уже не растет, и бот замирает
 * перед зданием, до которого ему не добраться ни при каком терпении. Ровно так
 * он и вставал на пятидесятом часу перед энергостанцией, которая стоила
 * миллион при доле в полмиллиона.
 *
 * Поэтому недостижимая для доли цель оплачивается из общего запаса. Дележ при
 * этом не ломается: такая покупка случается редко и ровно тогда, когда
 * альтернатива — стоять.
 *
 * Считать «недостижимость» надо по каждому ресурсу отдельно, и это не мелочь.
 * Пока сравнение шло с общей вместимостью всех трех складов, спасательный люк
 * не открывался вовсе: сумма трех складов велика, а запирает всегда один
 * из них. Живой стенд встал на этом целиком — все семь ботов замерли и
 * не строили четыре часа подряд, причем у каждого ресурсов на руках хватало
 * с избытком. Крамару доля разрешала тратить, только накопив 63 149 руды,
 * а рудный склад держит 59 800: цель была недостижима физически, и никакое
 * терпение не помогало.
 *
 * Дыра открылась, когда склады разделили по ресурсам, а проверку оставили
 * общей. Полимерная переоценка ее только доломала: цены в полимерах выросли
 * в 1.9 раза и перевалили за потолок сразу у всех.
 */
function canAfford(
  stock: ResourceAmounts,
  capacity: StorageCapacities,
  share: number,
  cost: ResourceAmounts,
  /**
   * Направление выиграло очередь и платит полную цену.
   *
   * Доля делит доход, но до этой правки она делила и сам склад: «сорок
   * процентов на экономику» означало «стройка видит сорок процентов того,
   * что лежит», и копить приходилось не цену здания, а цену, деленную
   * на долю. Живой стенд встал на этом целиком: у Купця 62 800 руды
   * и 78 085 полимеров при цене энергостанции 43 200 и 33 300 — ресурсов
   * вдвое больше нужного, а стройка запрещена, потому что в долю влезало
   * 25 000. Ноль строек у семерых при сотнях тысяч на складах.
   *
   * Теперь доля решает, чья сейчас очередь, а не сколько стоит покупка:
   * самое отставшее от своей доли направление платит полную цену из склада.
   */
  full = false,
): boolean {
  if (full && hasEnoughResources(stock, cost)) return true;
  if (hasEnoughResources(wallet(stock, share), cost)) return true;
  const beyondShare = STORED_RESOURCES.some((resource) => cost[resource] > capacity[resource] * share);
  return beyondShare && hasEnoughResources(stock, cost);
}

/**
 * Сколько ценности уже вложено в каждое направление.
 *
 * Доли характера — это доли портфеля, а не разрешение на отдельную покупку.
 * Без этого счета доля ограничивала бы только состав, но не объем: турель
 * стоит копейки и по кошельку проходит всегда, поэтому агрессор бесконечно
 * клепал бы оборону и не поднимал шахты выше пятого уровня. Проверено
 * прогоном недели: без портфеля бот замирал на 22 уровнях застройки.
 *
 * Считается наличие, а не история трат, — тем же способом, что и рейтинг:
 * потерянный в бою флот перестает занимать свою долю, и бот его отстраивает.
 */
interface Portfolio {
  economy: number;
  research: number;
  fleet: number;
  defense: number;
  total: number;
}

function portfolio(snapshot: BotSnapshot): Portfolio {
  let economy = 0;
  let fleet = 0;
  let defense = 0;
  for (const base of snapshot.bases) {
    economy += spentOnBuildings(base.levels);
    fleet += spentOnFleet(base.ships);
    defense += spentOnDefense(base.defenses);
  }
  const research = spentOnResearch(snapshot.techs);
  return { economy, research, fleet, defense, total: economy + research + fleet + defense };
}

/**
 * Сколько ресурсов отложено под стройку — числами, а не списком имен.
 *
 * Раньше резерв был множеством ресурсов, и не хватающие пять тысяч полимеров
 * запрещали верфи и обороне вообще все, что стоит полимеров, даже когда
 * на складе лежали сотни тысяч. Очередь стройки и верфь встают вместе
 * по причине, которая касается только одной из них.
 *
 * Откладывается накопленная часть цели, а не вся ее цена: то, чего еще нет,
 * отложить нельзя, а то, что уже собрано, тратить на корпуса незачем —
 * иначе накопление не сдвинется никогда.
 */
type ReservedAmounts = ResourceAmounts;

function emptyReserve(): ReservedAmounts {
  return { ore: 0, polymers: 0, plasma: 0 };
}

/** Что остается очередям после того, как отложено накопленное под стройку. */
function availableAfterReserve(stock: ResourceAmounts, reserved: ReservedAmounts): ResourceAmounts {
  return {
    ore: Math.max(0, stock.ore - reserved.ore),
    polymers: Math.max(0, stock.polymers - reserved.polymers),
    plasma: Math.max(0, stock.plasma - reserved.plasma),
  };
}

/* ------------------------- Экономика ------------------------- */

/**
 * План застройки базы: список кандидатов от самого желанного к запасным.
 *
 * Список, а не одно здание, потому что одного мало. Бот может хотеть
 * энергостанцию, которая на своем уровне стоит больше, чем вмещает его склад
 * целиком, — и тогда он копил бы на нее вечно: добыча упирается в потолок,
 * склад никогда не наберет нужного, а расширить его бот не догадается,
 * потому что смотрит только на первый пункт. Ровно этот тупик и ловится
 * прогоном недели в tests/bot.ts.
 *
 * Порядок жесткий там, где он очевиден: пока нет всех трех шахт, бот ставит
 * недостающую — без полимеров и плазмы он через полчаса упрется в тупик,
 * из которого добычей руды не выбраться. Дальше выбор по окупаемости:
 * во сколько ресурсов обходится единица прироста добычи.
 */
export function buildingPlan(
  base: BotBaseSnapshot,
  techs: TechLevels,
  character: BotCharacter,
  /** План от языковой модели, если он есть: иначе статичный характер. */
  override?: BotPersonality,
): BuildingType[] {
  const profile = override ?? personality(character);
  const levels = base.levels;
  const available = (type: BuildingType) => missingBuildingRequirements(type, levels).length === 0;

  const plan: BuildingType[] = [];
  const want = (type: BuildingType): void => {
    if (available(type) && !plan.includes(type)) plan.push(type);
  };

  const mines: BuildingType[] = ['ORE_MINE', 'POLYMER_PLANT', 'PLASMA_REACTOR'];
  for (const mine of mines) {
    if (levels[mine] === 0) want(mine);
  }

  const bonuses = economyBonuses(techs);
  const drain = timeCompressionDrain(techs);
  const caps = storageCapacities(levels);

  const modifiers = systemModifiers(base.anomaly);
  const before = productionPerSecond(levels, base.richness, bonuses, 0, modifiers, drain);

  /*
   * Склад тянем заранее, а не когда он уже забит.
   *
   * Реакция по факту переполнения — ловушка. На полном складе добыча режется
   * пропорционально по всем трем ресурсам, поэтому руда, которой как раз
   * и не хватает на расширение, перестает идти именно тогда, когда нужна.
   * Живой бот просидел так час: семь тысяч полимеров при вместимости десять
   * тысяч и восемьсот руды при цене расширения в тысячу с лишним.
   *
   * Час добычи — запас, которого хватает, чтобы не упереться в потолок между
   * заходами. Больше брать нельзя: вместимость растет в полтора раза за
   * уровень, а добыча быстрее, поэтому на поздних уровнях склад стал бы
   * вечным первым пунктом и заслонил бы сами шахты.
   */
  /*
   * Склад, который уже уперся в потолок, — единственный по-настоящему срочный:
   * добыча этого ресурса встала прямо сейчас. Решение поресурсное, потому что
   * склады раздельные: раньше приходилось гадать по общей сумме и бот расширял
   * хранилище, когда место кончалось вовсе не у того ресурса.
   *
   * Склад «на вырост» сюда не попадает нарочно — он уходит в хвост плана.
   * Слот стройки на базе один, а условие «вместимость меньше часа добычи»
   * на высоких уровнях шахт верно почти всегда: стоя в начале очереди, склад
   * монополизировал ее и не пускал ни лабораторию, ни верфь. Прогон месяца
   * показал цену этой ошибки — колонизация на 19-е сутки вместо вторых
   * и незакрытый лейтгейм.
   */
  /*
   * Полный склад, вместимости которого хватает на часы добычи, расширять
   * бессмысленно: узкое место не в нем.
   *
   * Замер по живому боту: склад растет в полтора раза за уровень, а добыча
   * медленнее, поэтому склад догоняет шахту сам. При шахте седьмого уровня
   * и складе одиннадцатого запас — шесть часов добычи, и он все равно был
   * полон: Крамар добывал 23 800 полимеров в час и вывозил их двадцатью
   * пятью малыми грузовиками. Следующий уровень склада купил бы еще девять
   * часов и ничего не решил, а слот стройки на базе один — и он уходил
   * именно туда, круг за кругом.
   *
   * Два часа — вдвое больше запаса «на вырост» ниже по плану. Меньше значило
   * бы объявлять узким местом вывоз там, где склад просто мал.
   */
  const buffered = (resource: StoredResource) =>
    before[resource] > 0 && caps[resource] / (before[resource] * 3600) >= 2;

  for (const resource of STORED_RESOURCES) {
    if (Math.max(0, base.resources[resource]) < caps[resource] * 0.9) continue;
    if (buffered(resource)) continue;
    want(STORAGE_FOR[resource]);
  }

  /*
   * Ресурс, которого хронически нет, добывают, а не ждут.
   *
   * Запас меряется не долей склада, а часами собственной добычи: склад растет
   * уровнями, добыча — тоже, и «мало» здесь значит «расходуем быстрее, чем
   * производим». Перекос считается против самого обильного ресурса, иначе
   * правило срабатывало бы на старте, когда мало всего сразу.
   *
   * Без него семеро живых ботов встали одновременно. Руда — универсальный
   * вход: следующий уровень шахты стоит вчетверо больше руды, чем полимеров,
   * а добывались они поровну. К вечеру у всех склады были забиты полимерами,
   * руды оставалось шесть-девять процентов, и все семеро выставили заявки
   * на покупку руды. Продавать ее было некому: не было ни у кого. Рынок
   * встал — четырнадцать сделок за шесть часов, — а Крамар держал рудную
   * шахту четвертым пунктом плана, имея 3 839 руды при цели в 43 187.
   */
  const hours = (resource: StoredResource) =>
    before[resource] > 0 ? Math.max(0, base.resources[resource]) / (before[resource] * 3600) : Infinity;
  const starved = STORED_RESOURCES.filter((resource) => hours(resource) < 1);
  const plenty = STORED_RESOURCES.some((resource) => hours(resource) > 3);
  if (plenty && starved.length > 0) {
    // Самый голодный первым: он и есть узкое место.
    const worst = starved.reduce((a, b) => (hours(a) <= hours(b) ? a : b));
    want(MINE_FOR[worst]);
  }

  // Просевшая энергия режет добычу на всех шахтах разом, поэтому станция
  // важнее любого следующего уровня шахты.
  if (energyEfficiency(levels, base.richness, bonuses, 0, drain) < 0.95) want('POWER_PLANT');

  if (levels.SCIENCE_CENTER === 0) want('SCIENCE_CENTER');
  if (levels.SHIPYARD === 0) want('SHIPYARD');

  /*
   * Крипто-ферма: когда добывать больше уже некуда.
   *
   * На единицу энергии ферма дает 40-50% того, что дает шахта по рыночной
   * цене, — то есть пока добытое доезжает до хаба, шахта лучше всегда.
   * (Прежняя оценка «две трети» считалась против фиксированной цены станции;
   * станции больше нет, замер сделан заново.) Проверка живым ботом показала,
   * где это перестает быть верным:
   * Крамар при шахтах седьмого уровня добывал 23 800 полимеров в час
   * при вместимости склада около сорока тысяч, то есть забивал его за два
   * часа, а вывозил двадцатью пятью малыми грузовиками с рейсом в обе стороны.
   * Все, что не влезло, срезалось потолком и не стоило ничего. Половина
   * больше нуля.
   *
   * Признак именно этот: ресурс уперся в потолок, а его хранилище уже обогнало
   * шахту — значит расширять склад бессмысленно, узкое место не в нем,
   * а в вывозе. Криптогривна не переполняется и рейсов не требует.
   */
  const wasted = STORED_RESOURCES.some(
    (resource) => Math.max(0, base.resources[resource]) >= caps[resource] * 0.9 && buffered(resource),
  );
  if (wasted) want('CRYPTO_FARM');

  /*
   * Характер подтягивает свои здания, пока они отстают от шахт.
   *
   * Отношение полтора, а не два. При двойном верфь упиралась в половину
   * уровня шахты, а ворота контента требуют верфи одиннадцатой и двенадцатой —
   * значит шахту двадцать вторую и двадцать четвертую. Прогон месяца показал
   * цену: к тридцать пятым суткам верфь замирала на десятой, и ни линкор,
   * ни авианосец, ни «Перун» не открывались вовсе. Ворота ставились не туда,
   * куда бот идет, а туда, куда он попадет случайно.
   */
  for (const focus of profile.buildingFocus) {
    if (levels[focus] * 1.5 < levels.ORE_MINE) want(focus);
  }

  /*
   * Шахты по окупаемости, но прирост взвешен по дефициту.
   *
   * Раньше приросты складывались в штуках, и шестьдесят тысяч полимеров,
   * которые некуда девать, весили столько же, сколько шестьдесят тысяч нужной
   * руды. Живой бот на этом простоял шесть часов с плазменным реактором
   * второго уровня при шахтах седьмого: реактор дороже шахты втрое и дает
   * вдвое меньше единиц, поэтому по «штукам» он проигрывает всегда — и это
   * верно ровно до того момента, когда плазма кончается и флот перестает
   * летать. У бота к тому часу оставалось девяносто семь единиц плазмы.
   *
   * Вес — это свободное место на складе ресурса: забитый склад означает, что
   * следующая добытая единица будет просто срезана потолком и не стоит ничего,
   * а пустой — что ресурс в дефиците и каждая единица на счету.
   */
  const ranked: Array<{ type: BuildingType; payback: number }> = [];
  for (const type of mines) {
    if (!available(type)) continue;
    const raised: BuildingLevels = { ...levels, [type]: levels[type] + 1 };
    const after = productionPerSecond(raised, base.richness, bonuses, 0, modifiers, drain);

    let value = 0;
    for (const resource of STORED_RESOURCES) {
      const gain = after[resource] - before[resource];
      if (gain <= 0) continue;
      const room = caps[resource];
      // Пол в 5% оставлен нарочно: даже забитый склад однажды разгрузится,
      // и обнулять добычу совсем значило бы навсегда вычеркнуть ресурс.
      const scarcity = Math.max(0.05, 1 - Math.max(0, base.resources[resource]) / Math.max(room, 1));
      value += gain * scarcity;
    }
    if (value <= 0) continue;

    ranked.push({ type, payback: costUnits(upgradeCost(type, levels[type] + 1)) / value });
  }
  ranked.sort((a, b) => a.payback - b.payback);
  for (const entry of ranked) want(entry.type);

  /*
   * Склады «на вырост»: вместимости уже меньше часа добычи, но потолок еще
   * не достигнут. Это полезно и это стоит делать — но только когда очередь
   * свободна от вещей, которые двигают игру вперед.
   */
  for (const resource of STORED_RESOURCES) {
    if (caps[resource] < before[resource] * 3600) want(STORAGE_FOR[resource]);
  }

  // Хвост запасных вариантов: они дешевле целей выше и всегда осмысленны,
  // поэтому боту есть чем заняться, пока он копит на главное.
  want('ORE_STORAGE');
  want('POLYMER_STORAGE');
  want('PLASMA_STORAGE');
  want('SCIENCE_CENTER');
  want('SHIPYARD');
  want('POWER_PLANT');
  // Ферма замыкает хвост: она осмысленна всегда — деньги нужны и на бирже,
  // и под будущие покупки, — но уступает всему, что растит саму добычу.
  want('CRYPTO_FARM');

  /*
   * Если на главную цель не хватит даже полного склада, узкое место — сам склад,
   * и копить бессмысленно: нужной суммы просто некуда положить. Ставим вперед
   * то хранилище, которого не хватает, — теперь это видно точно, по ресурсу.
   */
  const primary = plan[0];
  if (primary) {
    const cost = upgradeCost(primary, levels[primary] + 1);
    for (const resource of STORED_RESOURCES) {
      const building = STORAGE_FOR[resource];
      if (primary === building || !available(building)) continue;
      if (cost[resource] > caps[resource]) {
        plan.unshift(building);
        break;
      }
    }
  }

  return plan;
}

/** Самое желанное здание. Оставлено для наглядности и тестов. */
export function nextBuilding(
  base: BotBaseSnapshot,
  techs: TechLevels,
  character: BotCharacter,
  override?: BotPersonality,
): BuildingType | null {
  return buildingPlan(base, techs, character, override)[0] ?? null;
}

/* ------------------------- Наука ------------------------- */

/*
 * Лесенка имеет дно, и без него она запирает лейтгейм намертво.
 *
 * Ступенька в уровень на каждую строку списка означает, что десятая ветка
 * навсегда на девять уровней ниже ведущей. Ворота тяжелых кораблей стоят как
 * раз в хвосте — «Гипердвигатель» 7 на линкор, «Астрофизика» 9 на колонизатор
 * и 11 на авианосец, — и добраться до них можно было бы, только разогнав
 * ведущую ветку до восемнадцатого уровня. Прогон месяца это и показывал:
 * тяга 15 при астрофизике 8, и ни одного открытого тяжелого класса
 * ни у одного бота.
 *
 * Дно превращает хвост списка в ровную площадку: приоритет остается у первых
 * веток, а все, что глубже, держится на постоянном отставании и растет вместе
 * с ведущей. Порядок при этом продолжает работать — внутри площадки бот
 * подтягивает отставших сверху вниз.
 *
 * Глубина подобрана прогоном месяца, а не на глаз: при тройке сделок вдвое
 * больше и рынок перестает умирать после третьей недели, при двойке проседает
 * добыча, при шестерке не меняется ничего.
 */
const LADDER_DEPTH = 3;

/**
 * Следующая технология.
 *
 * Порядок характера задает не «что изучать первым», а лесенку: у ведущей ветки
 * уровень выше всех, у каждой следующей на единицу ниже. Бот подтягивает первую,
 * которая от лесенки отстала, и только когда все на месте — поднимает ведущую
 * и тем самым поднимает всю лесенку.
 *
 * Без лесенки список выродился бы в одну технологию: «первая доступная из
 * списка» — это всегда первая строка, и бот качал бы энергетику до бесконечности,
 * никогда не добравшись до ворот, за которыми стоят корабли.
 *
 * Жадный по цене выбор здесь тоже не годится: дешевые ветки всегда обгоняли бы
 * дорогие, а дорогие как раз и открывают лейтгейм.
 */
export function nextResearch(
  techs: TechLevels,
  levels: BuildingLevels,
  character: BotCharacter,
  purse: ResourceAmounts,
  override?: BotPersonality,
): TechnologyType | null {
  const order = (override ?? personality(character)).researchOrder;
  if (order.length === 0) return null;

  const lead = techs[order[0]!];
  const affordable = (tech: TechnologyType): boolean =>
    missingTechRequirements(tech, levels, techs).length === 0 &&
    hasEnoughResources(purse, researchCost(tech, techs[tech] + 1));

  // Отставшие от лесенки — по порядку приоритета.
  for (let index = 1; index < order.length; index += 1) {
    const tech = order[index]!;
    // Квота может уйти в ноль и ниже — это и значит «до этой ветки очередь
    // еще не дошла». На старте, пока ведущая на нуле, отставших нет вовсе,
    // и бот начинает именно с ведущей.
    const quota = lead - Math.min(index, LADDER_DEPTH);
    if (techs[tech] < quota && affordable(tech)) return tech;
  }

  // Лесенка ровная — поднимаем ведущую ветку, и следом подтянутся остальные.
  const leader = order[0]!;
  if (affordable(leader)) return leader;

  /*
   * На ведущую не хватает или она закрыта требованиями — берем первую
   * доступную из порядка. Лесенка задает приоритет, а не запрет: без этого
   * шага бот, чья ведущая ветка уперлась в непройденный пререквизит, не изучал
   * бы вообще ничего и держал лабораторию пустой при полном складе.
   */
  for (let index = 1; index < order.length; index += 1) {
    const tech = order[index]!;
    if (affordable(tech)) return tech;
  }

  return null;
}

/* ------------------------- Флот и оборона ------------------------- */

/**
 * Чего в эскадре не хватает относительно долей характера.
 *
 * Бот считает не «что дешевле», а «какой класс отстал сильнее всех» —
 * иначе эскадра выродилась бы в тысячу истребителей, потому что они
 * дешевые, и первый же крейсер противника выкосил бы ее целиком.
 */
/**
 * Прикрыт ли командир щитом новичка.
 *
 * Щит защищает человека, который еще не разобрался в правилах: бот ищет цели
 * со скоростью машины и разграбил бы новичка в первые же сутки, ровно тогда,
 * когда терять обиднее всего.
 *
 * Между ботами он не действует. Боту не обидно, разбираться в правилах ему
 * не надо, а мир от взаимной неприкосновенности замирает: живой агрессор
 * с сорока восемью истребителями простоял полсуток, получая на каждый вылет
 * отказ, — воевать было не с кем, потому что все соседи оказались младше
 * трех суток.
 */
export function shielded(target: { accountAgeDays: number; isBot: boolean }): boolean {
  return !target.isBot && target.accountAgeDays < NEWBIE_SHIELD_DAYS;
}

function laggingShip(
  ships: ShipCounts,
  mix: Partial<Record<ShipType, number>>,
  levels: BuildingLevels,
  techs: TechLevels,
  stock: ResourceAmounts,
  budget: { capacity: StorageCapacities; share: number; reserved: ReservedAmounts; full?: boolean },
): { ship: ShipType; count: number } | null {
  // Из склада вычтено отложенное под стройку: очередям достается остаток,
  // а не запрет на весь ресурс.
  const free = availableAfterReserve(stock, budget.reserved);
  const purse = budget.full ? free : wallet(free, budget.share);
  const totalValue = spentOnFleet(ships);
  let worst: ShipType | null = null;
  let worstGap = 0;

  for (const type of SHIP_TYPES) {
    const share = mix[type];
    if (!share) continue;
    if (missingShipRequirements(type, levels, techs).length > 0) continue;
    if (!canAfford(free, budget.capacity, budget.share, shipCost(type), budget.full)) continue;

    const have = ships[type] * costUnits(shipCost(type));
    const want = Math.max(totalValue, 1) * share;
    const gap = (want - have) / want;
    if (gap > worstGap) {
      worstGap = gap;
      worst = type;
    }
  }

  /*
   * Отстающих нет — значит пропорции уже сошлись, но это не повод перестать
   * строить: сколько флота держать, решает доля портфеля, а состав отвечает
   * только на вопрос «чего именно». Без этой ветки флот замирал на первом же
   * сошедшемся составе, и агрессор всю неделю строил турели вместо кораблей,
   * потому что доступные ему классы были «в норме», а недостающие доли висели
   * на бомбардировщике и линкоре, до которых он еще не дорос.
   */
  if (!worst) {
    let heaviest = 0;
    for (const type of SHIP_TYPES) {
      const share = mix[type];
      if (!share || share <= heaviest) continue;
      if (missingShipRequirements(type, levels, techs).length > 0) continue;
      if (!canAfford(free, budget.capacity, budget.share, shipCost(type), budget.full)) continue;
      heaviest = share;
      worst = type;
    }
  }

  if (!worst) return null;

  // Партия по кошельку, но не больше десятка за раз: верфь собирает заказ
  // подряд, и один жадный заказ на сотню кораблей занял бы ее на сутки,
  // оставив базу без обороны и без грузовиков.
  const unit = shipCost(worst);
  const affordable = Math.min(
    Math.floor(purse.ore / Math.max(unit.ore, 1)),
    Math.floor(purse.polymers / Math.max(unit.polymers, 1)),
    unit.plasma > 0 ? Math.floor(purse.plasma / unit.plasma) : Number.MAX_SAFE_INTEGER,
  );
  const count = Math.max(1, Math.min(10, affordable));
  return { ship: worst, count };
}

function laggingDefense(
  defenses: DefenseCounts,
  mix: Partial<Record<DefenseType, number>>,
  levels: BuildingLevels,
  techs: TechLevels,
  stock: ResourceAmounts,
  budget: { capacity: StorageCapacities; share: number; reserved: ReservedAmounts; full?: boolean },
): { defense: DefenseType; count: number } | null {
  const free = availableAfterReserve(stock, budget.reserved);
  const purse = budget.full ? free : wallet(free, budget.share);
  const totalValue = spentOnDefense(defenses);
  let worst: DefenseType | null = null;
  let worstGap = 0;

  for (const type of DEFENSE_TYPES) {
    const share = mix[type];
    if (!share) continue;
    if (missingDefenseRequirements(type, levels, techs).length > 0) continue;
    if (!canAfford(free, budget.capacity, budget.share, defenseCost(type), budget.full)) continue;

    const have = defenses[type] * costUnits(defenseCost(type));
    const want = Math.max(totalValue, 1) * share;
    const gap = (want - have) / want;
    if (gap > worstGap) {
      worstGap = gap;
      worst = type;
    }
  }

  // Та же логика, что и у флота: пропорции сошлись — растем дальше по самой
  // весомой доступной позиции. Объем ограничивает доля портфеля, а не состав.
  if (!worst) {
    let heaviest = 0;
    for (const type of DEFENSE_TYPES) {
      const share = mix[type];
      if (!share || share <= heaviest) continue;
      if (missingDefenseRequirements(type, levels, techs).length > 0) continue;
      if (!canAfford(free, budget.capacity, budget.share, defenseCost(type), budget.full)) continue;
      heaviest = share;
      worst = type;
    }
  }

  if (!worst) return null;

  const unit = defenseCost(worst);
  const affordable = Math.min(
    Math.floor(purse.ore / Math.max(unit.ore, 1)),
    Math.floor(purse.polymers / Math.max(unit.polymers, 1)),
    unit.plasma > 0 ? Math.floor(purse.plasma / unit.plasma) : Number.MAX_SAFE_INTEGER,
  );
  return { defense: worst, count: Math.max(1, Math.min(10, affordable)) };
}

/**
 * Самый дешевый доступный корабль — размыкатель тупика на полном складе.
 *
 * Считаем по сумме ресурсов, а не по дефицитному: цель не «сэкономить»,
 * а освободить место минимальной тратой того, чего меньше всего.
 */
function cheapestAffordable(base: BotBaseSnapshot, techs: TechLevels): ShipType | null {
  if (base.levels.SHIPYARD <= 0) return null;

  let best: ShipType | null = null;
  let bestCost = Infinity;
  for (const type of SHIP_TYPES) {
    if (missingShipRequirements(type, base.levels, techs).length > 0) continue;
    const cost = shipCost(type);
    if (!hasEnoughResources(base.resources, cost)) continue;
    const units = costUnits(cost);
    if (units < bestCost) {
      bestCost = units;
      best = type;
    }
  }
  return best;
}

/* ------------------------- Набег ------------------------- */

/**
 * Стоит ли лететь на цель.
 *
 * Три условия, и щит новичка среди них первый: бот находит жертву за секунды
 * и разграбил бы новичка в первые же сутки — ровно тогда, когда игрок еще
 * не понял правил. Дальше — только разведанные цели: вслепую бот не летает,
 * потому что за туманом войны может стоять «Перун». И запас по силе:
 * размен один в один боту невыгоден, флот он копил неделю.
 */
/**
 * Долетим ли вообще.
 *
 * Проверка появилась не от хорошей жизни. Живой Хижак каждый заход выбирал
 * разведать соседа, рейс молча отваливался, и так по кругу: все неразведанные
 * соседи оказались в других системах, а гиперпрыжок требует и «Гипердвигателя»,
 * и антиматерии — у него не было ни того, ни другого. Планировать полет,
 * которого не будет, значит не делать ничего и не знать об этом.
 */
export function reachable(
  target: { orbit: number; distance: number },
  ships: ShipCounts,
  techs: TechLevels,
  from: { orbit: number; antimatter: number },
): boolean {
  if (target.distance === 0) return true;
  if (!canJump(techs)) return false;
  const plan = planFlight(
    ships,
    techs,
    { position: from.orbit, system: { galaxyX: 0, galaxyY: 0 } },
    { position: target.orbit, system: { galaxyX: target.distance, galaxyY: 0 } },
  );
  return from.antimatter >= plan.antimatter;
}

/**
 * Что набег принесет и во что обойдется.
 *
 * Считается в единицах ресурсов — все они идут один к одному, как в рейтинге:
 * другого источника правды об их относительной ценности в игре нет, а биржа
 * торгует лишь двумя из четырех.
 */
export interface RaidValue {
  /** Сколько удастся увезти: меньшее из чужого склада и своих трюмов. */
  loot: number;
  /** Обломки разбитого флота — их подберет переработчик, если он есть. */
  debris: number;
  /** Топливо на дорогу туда и обратно. */
  fuel: number;
  /** Чистая выгода: добыча с обломками за вычетом топлива. */
  net: number;
}

/**
 * Какая доля чужого склада реально уносится.
 *
 * Грабеж берет 90% излишка сверх несгораемой доли, а несгораемая доля — пятая
 * часть вместимости каждого хранилища. Вместимость чужих складов разведка
 * показывает не всегда, поэтому здесь грубая, но честно заниженная оценка:
 * половина увиденного запаса. Ошибаться лучше в меньшую сторону — тогда бот
 * не полетит за добычей, которой не окажется.
 */
const LOOT_SHARE = 0.5;

/** Доля стоимости разбитых кораблей, оседающая в поле обломков. */
const DEBRIS_SHARE = 0.3;

/**
 * Оценка набега до вылета.
 *
 * Раньше ее не было вовсе, и это дорого стоило: живой Хижак ходил на Купця
 * раз в три минуты, привозил по 104–739 единиц и жег около 930 плазмы
 * за вылет. Каждый набег был прямым убытком, и остановить его было нечем —
 * правило проверяло только «слабее ли цель», но не «стоит ли лететь».
 */
export function raidValue(
  target: BotRaidTarget,
  strike: ShipCounts,
  techs: TechLevels,
  from: { orbit: number; systemId: string },
  /** Своя система по координатам — по ним видно, нужен ли прыжок. */
  home: GalaxyPoint,
  there: GalaxyPoint,
  /** Обломки имеют цену только тогда, когда их есть чем забрать. */
  collectDebris = true,
): RaidValue {
  const plan = planFlight(
    strike,
    techs,
    { position: from.orbit, system: home },
    { position: target.orbit, system: there },
  );

  const loot = Math.min(plan.capacity, Math.max(0, target.knownStock ?? 0) * LOOT_SHARE);
  const debris = collectDebris ? Math.max(0, target.knownFleetValue ?? 0) * DEBRIS_SHARE : 0;
  // Антиматерия дороже плазмы по добыче на порядки, но в единицах ресурсов
  // считается так же — как и везде, где ресурсы складываются.
  const fuel = plan.fuel + plan.antimatter;
  return { loot, debris, fuel, net: loot + debris - fuel };
}

/**
 * Выбор цели: не ближайшая из посильных, а самая выгодная из посильных.
 *
 * Порогов два, и они про разное. Первый — не лететь в убыток: добыча
 * с обломками должна перекрывать топливо. Второй — соразмерность: набег
 * ссорит с соседом и зовет ответный визит, поэтому он должен стоить ссоры.
 * Мерой служит собственная часовая добыча — величина, которая растет вместе
 * с ботом сама. Молодому и тысяча ресурсов заметна; у Хижака час добычи
 * это десятки тысяч, и лететь за двумя сотнями ему бессмысленно, даже если
 * формально выходит в плюс.
 */
export function pickRaidTarget(
  targets: BotRaidTarget[],
  ownFleetValue: number,
  character: BotCharacter,
  override?: BotPersonality,
  /** Чем и откуда летим и сколько сами добываем за час. Без этого — как раньше. */
  economy?: {
    strike: ShipCounts;
    techs: TechLevels;
    from: { orbit: number; systemId: string; antimatter: number };
    home: GalaxyPoint;
    systemOf: (target: BotRaidTarget) => GalaxyPoint;
    hourlyOutput: number;
    collectDebris?: boolean;
  },
): BotRaidTarget | null {
  const profile = override ?? personality(character);
  if (!profile.raids) return null;

  const candidates = targets
    .filter((target) => !shielded(target))
    .filter((target) => target.knownStrength !== null)
    .filter((target) => ownFleetValue >= (target.knownStrength ?? 0) * profile.raidAdvantage)
    // Недостижимая цель — не цель: без гипердвигателя и антиматерии рейс
    // не улетит, а решение будет приниматься заново каждый заход.
    .filter(
      (target) =>
        !economy ||
        reachable(target, economy.strike, economy.techs, { orbit: economy.from.orbit, antimatter: economy.from.antimatter }),
    );

  if (candidates.length === 0) return null;
  if (!economy) {
    // Из подходящих — ближайшая: дорога тоже стоит топлива и времени.
    return candidates.reduce((best, target) => (target.distance < best.distance ? target : best));
  }

  const worth = candidates
    .map((target) => ({
      target,
      value: raidValue(
        target,
        economy.strike,
        economy.techs,
        economy.from,
        economy.home,
        economy.systemOf(target),
        economy.collectDebris ?? true,
      ),
    }))
    .filter((row) => row.value.net > 0 && row.value.net >= economy.hourlyOutput);

  if (worth.length === 0) return null;
  return worth.reduce((best, row) => (row.value.net > best.value.net ? row : best)).target;
}

/* ------------------------- Главная функция ------------------------- */

/**
 * Что бот делает в этот заход.
 *
 * Возвращается список намерений, а не одно действие: за 45 секунд между
 * решениями бот успевает и поставить стройку, и запустить исследование,
 * и отправить флот — это разные очереди, и занимать их по одной значило бы
 * развиваться втрое медленнее живого игрока при тех же ценах.
 */
export function decide(snapshot: BotSnapshot, override?: BotPersonality): BotIntent[] {
  /*
   * План от языковой модели заменяет числа характера, но не подменяет правила:
   * он задает приоритеты, а цены, сроки и бой по-прежнему считает сервер.
   * Испорченный план может заставить бота играть глупо — и только.
   */
  let profile = override ?? personality(snapshot.character);
  const intents: BotIntent[] = [];
  if (snapshot.bases.length === 0) return intents;

  const capital = snapshot.bases[0]!;
  const strategicStep = nextMilestoneStep(snapshot, profile);
  const strategicWhy = strategicStep
    ? `этап курса: ${BOT_MILESTONE_LABELS[strategicStep.milestone]}`
    : null;
  /*
   * Мобилизация против серийного агрессора.
   *
   * Пока он бьет соседей, мирное развитие подождет: доля флота и обороны
   * поднимается, но развитие не опускается ниже трети — того самого предела,
   * за которым бот ломает сам себя. Это и есть «вложились в атакующий флот
   * и оборону»: не декларация, а сдвинутые доли, по которым код и решает,
   * что заказывать.
   *
   * Долю берет и жертва, и сосед. Разница в готовности: своя обида поднимает
   * ставку выше, чем чужая.
   */
  /*
   * Перегруппировка: флот разбит или против нас союз. Пока так, доход идет
   * в оборону и восстановление, а не в новые набеги — иначе бот скармливает
   * противнику свой же флот по частям.
   */
  const fleetNow = snapshot.bases.reduce((sum, base) => {
    const fighting = emptyShipCounts();
    for (const type of COMBAT_TYPES) fighting[type] = base.ships[type];
    return sum + spentOnFleet(fighting);
  }, 0);
  if (snapshot.fleetPeak > 0 && fleetNow < snapshot.fleetPeak * 0.2) {
    profile = { ...profile, budget: { economy: 0.4, research: 0.15, fleet: 0.25, defense: 0.2 } };
  } else if (snapshot.warsAgainstMe >= 2) {
    profile = { ...profile, budget: { economy: 0.35, research: 0.15, fleet: 0.2, defense: 0.3 } };
  }

  const threat = snapshot.threats[0] ?? null;
  if (threat) {
    const zeal = threat.againstMe ? 1 : 0.6;
    const fleet = profile.budget.fleet + 0.2 * zeal;
    const defense = profile.budget.defense + 0.15 * zeal;
    const rest = Math.max(0.33, 1 - fleet - defense);
    const total = fleet + defense + rest;
    profile = {
      ...profile,
      budget: {
        economy: (rest * profile.budget.economy) / (profile.budget.economy + profile.budget.research) / total,
        research: (rest * profile.budget.research) / (profile.budget.economy + profile.budget.research) / total,
        fleet: fleet / total,
        defense: defense / total,
      },
    };
  }

  /*
   * Доля синдиката снимается сверху и только у участника.
   *
   * Четыре доли ниже делят остаток, поэтому одиночка играет ровно так же,
   * как до синдикатов, — и прогон экономики, где синдикатов нет, эту правку
   * не замечает вовсе. Снимается после мобилизации: война важнее казны,
   * но и в войну синдикат не остается без вклада.
   */
  const syndicateShare = snapshot.syndicate ? Math.min(0.3, Math.max(0, profile.budget.syndicate ?? 0)) : 0;
  if (syndicateShare > 0) {
    const keep = 1 - syndicateShare;
    profile = {
      ...profile,
      budget: {
        ...profile.budget,
        economy: profile.budget.economy * keep,
        research: profile.budget.research * keep,
        fleet: profile.budget.fleet * keep,
        defense: profile.budget.defense * keep,
      },
    };
  }

  const held = portfolio(snapshot);
  /** Добрало ли направление свою долю портфеля. */
  const saturated = (direction: Direction): boolean =>
    held.total > 0 && held[direction] >= held.total * profile.budget[direction];

  /*
   * Чья сейчас очередь тратить полной ценой.
   *
   * Доля — правило дележа дохода, и делить она должна очередь, а не склад.
   * Самое отставшее от своей доли направление получает право заплатить
   * полную цену из запаса; остальные тратят свою долю, как раньше. Так
   * доли по-прежнему держат пропорции портфеля — их считает `portfolio`, —
   * но перестают требовать «накопи цену, деленную на долю».
   *
   * Отставание меряется разницей долей, а не отношением: при пустом портфеле
   * отношение делить не на что, а разница честно показывает, кому не досталось.
   */
  const DIRECTIONS: Direction[] = ['economy', 'research', 'fleet', 'defense'];
  const lagging = DIRECTIONS.reduce((worst, direction) => {
    const gap = (d: Direction) => profile.budget[d] - (held.total > 0 ? held[d] / held.total : 0);
    return gap(direction) > gap(worst) ? direction : worst;
  }, 'economy' as Direction);
  /** Платит ли это направление полную цену в текущем заходе. */
  const fullPrice = (direction: Direction): boolean => direction === lagging;

  /*
   * Чего боту не хватает на его же ближайшие цели.
   *
   * Это то, ради чего он идет на рынок. Ситуация обычная: полимеров вдоволь,
   * а целевое здание требует руды, и добыть ее быстрее нельзя — шахта уже
   * стоит. Продать избыток и купить недостающее — единственный способ
   * не встать на месте, и именно это отличает торговлю от накопительства.
   */
  const shortfall = new Set<StoredResource>();

  /*
   * Сколько каждого ресурса требуют цели столицы — целиком, а не только
   * недостающее. Это держится дома и не уходит на хаб: иначе руду, которой
   * уже хватает на здание, ждущее полимеров, рейс увозил бы на продажу,
   * и обратный рейс возвращал бы ее, как только она стала бы дефицитом.
   */
  const need = { ore: 0, polymers: 0 };
  const rememberNeed = (cost: ResourceAmounts): void => {
    need.ore = Math.max(need.ore, cost.ore);
    need.polymers = Math.max(need.polymers, cost.polymers);
  };

  const rememberShortfall = (stock: ResourceAmounts, cost: ResourceAmounts): void => {
    rememberNeed(cost);
    for (const resource of STORED_RESOURCES) {
      if (cost[resource] > stock[resource]) shortfall.add(resource);
    }
  };

  /* --- Наука: одна на командира, поэтому считается от столицы --- */
  if (!snapshot.researching) {
    const strategicTech = strategicStep?.kind === 'RESEARCH' ? strategicStep.tech : null;
    const strategicCost = strategicTech
      ? researchCost(strategicTech, snapshot.techs[strategicTech] + 1)
      : null;
    // Очередь науки — значит полная цена из запаса, а не доля от склада.
    const purse = fullPrice('research')
      ? capital.resources
      : wallet(capital.resources, profile.budget.research);
    const tech =
      strategicTech && strategicCost
        ? hasEnoughResources(capital.resources, strategicCost)
          ? strategicTech
          : null
        : nextResearch(snapshot.techs, capital.levels, snapshot.character, purse, profile);
    if (tech) {
      intents.push({
        kind: 'RESEARCH',
        baseId: capital.id,
        tech,
        why: tech === strategicTech ? strategicWhy! : `по плану характера «${profile.label}»`,
      });
    } else {
      /*
       * Технология не выбрана — либо ворота закрыты, либо не хватает ресурсов.
       * Второе рынок лечит, первое нет, поэтому ищем первую ветку, которой
       * мешают именно ресурсы, и записываем недостающее.
       */
      for (const candidate of profile.researchOrder) {
        if (missingTechRequirements(candidate, capital.levels, snapshot.techs).length > 0) continue;
        const cost = researchCost(candidate, snapshot.techs[candidate] + 1);
        rememberNeed(cost);
        for (const resource of STORED_RESOURCES) {
          if (cost[resource] > capital.resources[resource]) shortfall.add(resource);
        }
        break;
      }
    }
    if (strategicCost && !hasEnoughResources(capital.resources, strategicCost)) {
      rememberShortfall(capital.resources, strategicCost);
    }
  }

  for (const base of snapshot.bases) {
    const stock = base.resources;
    const capacity = storageCapacities(base.levels);

    /*
     * Порог, за которым копить уже бессмысленно: хотя бы один склад у потолка,
     * и добыча этого ресурса встала. Раз склады раздельные, смотрим по каждому:
     * полный склад полимеров при пустом рудном — это не «места нет», а вполне
     * рабочее положение, и объявлять аврал из-за него незачем.
     */
    const caps = storageCapacities(base.levels);

    /*
     * Аврал — это когда копить больше нечего вообще: все три склада у потолка,
     * добыча остановлена целиком, и следующей единицы ресурсов не будет.
     *
     * Раньше здесь стояло «хотя бы один», и с общим лимитом это было верно.
     * С раздельными складами полный склад одного ресурса — рядовое положение:
     * полимеры стоят, руда идет как шла. Живой бот на этом условии объявлял
     * аврал непрерывно и настроил двадцать пять зондов, вычерпав руду, которой
     * ему как раз и не хватало на расширение полимерного склада.
     */
    const pressure = STORED_RESOURCES.every((resource) => stock[resource] >= caps[resource] * 0.9);

    /** Сколько уже накоплено под ближайшую постройку: это верфи не достается. */
    const reserved = emptyReserve();
    const share = (direction: Direction) => (pressure ? 1 : profile.budget[direction]);

    /* --- Стройка --- */
    if (!base.building) {
      const ordinaryPlan = buildingPlan(base, snapshot.techs, snapshot.character, profile);
      const strategicBuilding =
        base.id === capital.id && strategicStep?.kind === 'BUILD' ? strategicStep.building : null;
      const plan = strategicBuilding
        ? [strategicBuilding, ...ordinaryPlan.filter((building) => building !== strategicBuilding)]
        : ordinaryPlan;

      /** Склад ресурса, добыча которого уже остановлена потолком. */
      const blocked = new Set(
        STORED_RESOURCES.filter((resource) => stock[resource] >= caps[resource] * 0.9).map(
          (resource) => STORAGE_FOR[resource],
        ),
      );

      const affordable = (type: BuildingType) => {
        const cost = upgradeCost(type, base.levels[type] + 1);
        /*
         * Переполненный склад оплачивается из всего запаса, а не из доли.
         *
         * Доля делит доход между направлениями, но остановленная добыча —
         * это не вопрос приоритетов, а потеря дохода, и ждать своей очереди
         * тут нечего. Живой бот стоял с полным складом полимеров, имея на руках
         * достаточно руды на расширение: в долю она просто не влезала.
         */
        if (blocked.has(type) || type === strategicBuilding) return hasEnoughResources(stock, cost);
        return canAfford(stock, capacity, share('economy'), cost, fullPrice('economy'));
      };

      /*
       * Обычно бот копит на самое желанное и не разменивается. Но под давлением
       * склада копить некуда: добыча упирается в потолок, и следующая единица
       * ресурсов не появится никогда. Тогда бот идет по плану до первого
       * посильного — иначе цель дороже склада заморозила бы базу навсегда.
       */
      /*
       * Копим на первый пункт и не разменивается на дешевое — это проверено
       * замером, а не принято на веру. Прогон месяца с правилом «строй первое
       * посильное» дал «Перун» на 34-е сутки против 12-х: бот расползался
       * по дешевым шахтам вместо того, чтобы дойти до ворот контента.
       */
      /*
       * Копить на первый пункт можно, только пока есть куда копить.
       *
       * Склад, уперевшийся в потолок, выбрасывает добычу этого ресурса каждую
       * секунду, и ожидание перестает быть накоплением — оно становится
       * простоем. Тогда бот строит первое посильное: это всегда лучше, чем
       * смотреть, как пропадает добыча.
       *
       * `pressure` для этого не годится: он требует, чтобы у потолка стояли
       * все три склада разом, а плазма горит топливом на каждом рейсе
       * и держится у нуля — условие не выполняется никогда. Живой Яструб
       * простоял так двое суток с полным рудным складом на 681 тысячу: первым
       * пунктом плана стоял плазменный реактор семнадцатого уровня за 573
       * тысячи руды и 377 тысяч полимеров, которых не было, а три более
       * дешевых пункта были ему по карману.
       *
       * Прогон этого не ловил и поймать не мог: рейсов в нем нет, плазме
       * тратиться не на что, и все три склада наполняются честно.
       */
      const wasting = STORED_RESOURCES.some((resource) => stock[resource] >= caps[resource] * 0.9);

      /*
       * Копить на первый пункт стоит, пока он в пределах видимости.
       *
       * Правило «не разменивайся на дешевое» верно для цели, до которой
       * несколько часов добычи. Для цели в сутки и дальше оно превращается
       * в простой: слот стройки пустует все это время, а дешевые пункты,
       * которые растят ту же добычу, ждут вместе с ним. Живой стенд встал так
       * целиком — шестеро из семи копили на плазменный реактор 14–17 уровня
       * за 130–570 тысяч руды, у Купця это тридцать часов добычи, и ни один
       * не строил ничего. Хуже того: недостающее на такую цель уходило
       * в дефицит, и бот спускал весь доход фермы на руду по любой цене.
       *
       * Горизонт считается по собственной добыче базы и по каждому ресурсу
       * отдельно: запирает всегда один.
       */
      const rate = productionPerSecond(
        base.levels,
        base.richness,
        economyBonuses(snapshot.techs),
        0,
        systemModifiers(base.anomaly),
        timeCompressionDrain(snapshot.techs),
      );
      const hoursAway = (type: BuildingType): number => {
        const cost = upgradeCost(type, base.levels[type] + 1);
        let hours = 0;
        for (const resource of STORED_RESOURCES) {
          const gap = cost[resource] - Math.max(0, stock[resource]);
          if (gap <= 0) continue;
          hours = Math.max(hours, rate[resource] > 0 ? gap / (rate[resource] * 3600) : Infinity);
        }
        return hours;
      };
      const distant = plan[0] !== undefined && !affordable(plan[0]) && hoursAway(plan[0]) > SAVING_HORIZON_HOURS;
      /** На что копим: первый пункт, а если он за горизонтом — первый в его пределах. */
      const goal = distant ? (plan.find((type) => hoursAway(type) <= SAVING_HORIZON_HOURS) ?? plan[0]) : plan[0];

      let building = pressure
        ? plan.find(affordable)
        : plan[0] && affordable(plan[0])
          ? plan[0]
          : wasting || distant
            ? plan.find(affordable)
            : undefined;
      /** Почему ферма вышла вперед плана: порогов два, и они про разное. */
      let farmReason: string | null = null;

      /*
       * Денег нет — значит первым делом ферма. Порогов у этого два.
       *
       * Криптогривна берется единственным способом: с крипто-фермы. Станция
       * ничего не покупает, все сделки между игроками — переводы, и бот
       * без денег не купит недостающее ни за какую цену. При этом в общем
       * плане ферма стоит последней из десяти, а слот стройки на базе один, —
       * то есть до нее не доходит очередь никогда. Проверено на живых ботах:
       * у всех троих ферма нулевого уровня при шахтах до седьмого.
       *
       * Первый порог — цена того, чего не хватает, по нынешнему рынку. Это
       * не догадка о «достаточной» сумме, а ровно тот вопрос, который решается
       * покупкой: хватит ли денег закрыть дефицит прямо сейчас.
       *
       * Одного его оказалось мало. Он спрашивает «хватит ли на дефицит»,
       * а дефицита может не быть вовсе: ресурсы на ближайшее здание есть,
       * покупать нечего, порог молчит — и ферма не строится никогда. Так живут
       * ровно те, у кого недра богатые и склад не переполняется: у живых
       * Яструба и Беркута ферма нулевого уровня на вторые сутки, причем
       * у Яструба при этом ₴7 835 на счету. Деньги ему нужны не на дефицит,
       * а чтобы вообще торговать и расширять склад, и взять их неоткуда.
       *
       * Отсюда второй порог: цена следующего расширения склада на хабе. Он
       * не выдуман — это единственная покупка бота помимо закрытия дефицита
       * и второй сток криптогривны. Не хватает на нее — бот беден
       * по-настоящему, а не занят.
       *
       * Замерено прогоном недели на семи ботах, до и после правила при одной
       * и той же расстановке (`npm run forecast -- 7`, правка снимается
       * `git stash`): денежная масса ₴75.1 млн против ₴132.7 млн,
       * то есть ₴1.67 против ₴2.48 на единицу добытого товара. Добыча при
       * этом не падает, а растет — 45.1 млн против 53.5 млн единиц: бедный
       * бот перестает стоять и начинает докупать недостающее. Ворота контента
       * не сдвинулись: средняя верфь 6.0 в обоих прогонах, лучшая 8 против 7.
       * И главное — исчезает нулевая ферма: без второго порога бот с богатой
       * рудой не строит ее за неделю ни разу.
       *
       * Доля характера при этом не обходится: ферма проходит тот же
       * `affordable`, что и любая другая стройка. Прогон с обходом доли
       * показал, чем это кончается — денег втрое больше, но добыча падает
       * на пятую часть, потому что ферма начинает объедать шахты.
       */
      if (!pressure && plan[0] && plan[0] !== 'CRYPTO_FARM') {
        const cost = upgradeCost(plan[0], base.levels[plan[0]] + 1);
        let needed = 0;
        for (const resource of TRADED) {
          const field = resource === 'ORE' ? 'ore' : 'polymers';
          const gap = cost[field] - stock[field];
          if (gap <= 0) continue;
          needed += gap * (snapshot.market.find((ref) => ref.resource === resource)?.reference ?? 0);
        }
        const cannotBuyDeficit = needed > 0 && snapshot.credits < needed;
        const broke = snapshot.hubStorage.upgradeCost > 0 && snapshot.credits < snapshot.hubStorage.upgradeCost;
        if (
          (cannotBuyDeficit || broke) &&
          missingBuildingRequirements('CRYPTO_FARM', base.levels).length === 0 &&
          affordable('CRYPTO_FARM')
        ) {
          building = 'CRYPTO_FARM';
          farmReason = cannotBuyDeficit
            ? 'на покупку недостающего не хватает криптогривны'
            : 'денег нет даже на расширение склада';
        }
      }

      if (building) {
        intents.push({
          kind: 'BUILD',
          baseId: base.id,
          building,
          why:
            (building === strategicBuilding ? strategicWhy : null) ??
            farmReason ??
            (pressure
              ? 'склад полон, копить некуда'
              : building === plan[0]
                ? 'развитие базы'
                : wasting
                  ? 'склад у потолка — копить дальше некуда'
                  : `${plan[0]} за горизонтом накопления — строим посильное`),
        });
      } else if (goal) {
        /*
         * Копим на здание — значит не тратим то, чего для него не хватает.
         *
         * Кошельки считаются от текущего запаса, и направления тратят
         * одновременно. Дорогая постройка из-за этого не накапливалась никогда:
         * пока лаборатория ждала семь тысяч руды, флот со своей долей спокойно
         * покупал истребителей по полторы, и руда не поднималась выше порога.
         * Живой бот простоял так с лабораторией и верфью четвертого уровня
         * при шахтах седьмого полсуток. Оговорка: прогон месяца разницы почти
         * не показал — в нем нет вывоза товара на хаб, и руды там хватает.
         * Правило бьет по живому дефициту, и подтвердить его может только
         * живой бот.
         *
         * Резерв снимается сам, как только на постройку хватило: это не запрет
         * на флот, а очередь — сначала то, что дороже и ждет дольше.
         */
        const cost = upgradeCost(goal, base.levels[goal] + 1);
        // Дом и хаб у бота — это столица; цели других колоний туда не везут.
        if (base.id === capital.id) rememberNeed(cost);
        for (const resource of STORED_RESOURCES) {
          if (cost[resource] > 0 && stock[resource] < cost[resource]) {
            /*
             * Откладываем накопленное под цель, а не весь ресурс: верфи
             * достается излишек сверх этой суммы. Отложить больше, чем есть,
             * нельзя — недостающее еще предстоит добыть или купить.
             */
            reserved[resource] = Math.min(cost[resource], Math.max(0, stock[resource]));
            // То же самое, но на весь снимок: за недостающим бот пойдет на рынок.
            shortfall.add(resource);
          }
        }
      }
    }

    /* --- Верфь --- */
    /*
     * Грузовик впереди боевых кораблей, если своего добра не на чем привезти.
     *
     * Бот без транспортов отрезан от собственного склада на хабе: строят
     * из того, что на базе, а перевезти нечем. Живой Купець просидел так
     * с 45 555 руды на станции при трех тысячах дома — Хижак сжег ему весь
     * грузовой флот, и для правил это выглядело как рядовое «класс отстает
     * от состава эскадры», наравне с истребителями.
     *
     * Транспорт — инструмент под задачу, как зонд: заказывается тогда, когда
     * задача есть. Задача здесь — свой же запас, до которого не дотянуться.
     */
    const hold = fleetCapacity({
      ...emptyShipCounts(),
      LARGE_CARGO: base.ships.LARGE_CARGO,
      SMALL_CARGO: base.ships.SMALL_CARGO,
    });
    const strandedAtHub = snapshot.hubStorage.ore + snapshot.hubStorage.polymers;
    const strategicShip =
      base.id === capital.id && strategicStep?.kind === 'SHIPS' ? strategicStep : null;
    const affordableShips = (type: ShipType): number => {
      const unit = shipCost(type);
      return Math.min(
        Math.floor(stock.ore / Math.max(1, unit.ore)),
        Math.floor(stock.polymers / Math.max(1, unit.polymers)),
        unit.plasma > 0 ? Math.floor(stock.plasma / unit.plasma) : Number.MAX_SAFE_INTEGER,
      );
    };
    if (
      strategicShip &&
      base.shipQueue === 0 &&
      missingShipRequirements(strategicShip.ship, base.levels, snapshot.techs).length === 0 &&
      affordableShips(strategicShip.ship) > 0
    ) {
      intents.push({
        kind: 'SHIPS',
        baseId: base.id,
        ship: strategicShip.ship,
        count: Math.max(
          1,
          Math.min(10, affordableShips(strategicShip.ship), strategicShip.targetCount - base.ships[strategicShip.ship]),
        ),
        why: strategicWhy!,
      });
    } else if (
      base.shipQueue < 3 &&
      base.levels.SHIPYARD > 0 &&
      hold <= 0 &&
      /*
       * Пустой ангар — не всегда отсутствие транспорта: он мог уйти в рейс,
       * а в составе базы числится только то, что стоит на земле. Живой Хижак
       * заказал лишний грузовик ровно так — его восемьдесят два транспорта
       * в ту минуту везли товар с хаба.
       */
      snapshot.fleetsInFlight === 0 &&
      strandedAtHub >= 100 &&
      missingShipRequirements('SMALL_CARGO', base.levels, snapshot.techs).length === 0 &&
      hasEnoughResources(stock, shipCost('SMALL_CARGO'))
    ) {
      intents.push({
        kind: 'SHIPS',
        baseId: base.id,
        ship: 'SMALL_CARGO',
        count: 1,
        why: 'свой запас лежит на хабе, а вывезти нечем',
      });
    } else if (base.shipQueue < 3 && base.levels.SHIPYARD > 0 && !saturated('fleet')) {
      const order = laggingShip(base.ships, profile.fleetMix, base.levels, snapshot.techs, stock, {
        capacity,
        share: share('fleet'),
        reserved,
        full: fullPrice('fleet'),
      });
      if (order) {
        intents.push({
          kind: 'SHIPS',
          baseId: base.id,
          ship: order.ship,
          count: order.count,
          why: 'класс отстает от состава эскадры',
        });
      }
    }

    /* --- Аварийный выход: все склады полны, а купить нечего --- */
    if (pressure && !intents.some((intent) => 'baseId' in intent && intent.baseId === base.id)) {
      /*
       * Полное безветрие: копить некуда, строить не на что. Единственный
       * способ сдвинуться — потратить хоть что-нибудь и освободить место,
       * поэтому берем самое дешевое доступное, не глядя на состав эскадры.
       *
       * Условие намеренно строгое (все склады, а не один): с раздельными
       * лимитами полный склад одного ресурса ничего не блокирует, и объявлять
       * из-за него аврал значит жечь дефицитный ресурс на бесполезные корпуса.
       */
      const escape = cheapestAffordable(base, snapshot.techs);
      if (escape) {
        intents.push({
          kind: 'SHIPS',
          baseId: base.id,
          ship: escape,
          count: 1,
          why: 'склад забит, нужно освободить место',
        });
      }
    }

    /* --- Оборона --- */
    const strategicDefense =
      base.id === capital.id && strategicStep?.kind === 'DEFENSE' ? strategicStep : null;
    const affordableDefenses = (type: DefenseType): number => {
      const unit = defenseCost(type);
      return Math.min(
        Math.floor(stock.ore / Math.max(1, unit.ore)),
        Math.floor(stock.polymers / Math.max(1, unit.polymers)),
        unit.plasma > 0 ? Math.floor(stock.plasma / unit.plasma) : Number.MAX_SAFE_INTEGER,
      );
    };
    if (
      strategicDefense &&
      base.defenseQueue === 0 &&
      missingDefenseRequirements(strategicDefense.defense, base.levels, snapshot.techs).length === 0 &&
      affordableDefenses(strategicDefense.defense) > 0
    ) {
      intents.push({
        kind: 'DEFENSE',
        baseId: base.id,
        defense: strategicDefense.defense,
        count: Math.max(
          1,
          Math.min(
            10,
            affordableDefenses(strategicDefense.defense),
            strategicDefense.targetCount - base.defenses[strategicDefense.defense],
          ),
        ),
        why: strategicWhy!,
      });
    } else if (base.defenseQueue < 3 && base.levels.SHIPYARD > 0 && !saturated('defense')) {
      const order = laggingDefense(base.defenses, profile.defenseMix, base.levels, snapshot.techs, stock, {
        capacity,
        share: share('defense'),
        reserved,
        full: fullPrice('defense'),
      });
      if (order) {
        intents.push({
          kind: 'DEFENSE',
          baseId: base.id,
          defense: order.defense,
          count: order.count,
          why: 'позиция отстает от плана обороны',
        });
      }
    }
  }

  /* --- Совместная наука колоний --- */
  for (const baseId of snapshot.joinableResearchBases) {
    intents.push({
      kind: 'JOIN_RESEARCH',
      baseId,
      why: 'свободная лаборатория ускорит общее исследование',
    });
  }

  /* --- Переработка обломков --- */
  const harvestBase = snapshot.bases.find((base) => base.ships.RECYCLER > 0);
  if (harvestBase && snapshot.debrisFields.length > 0) {
    const oneRecycler = { ...emptyShipCounts(), RECYCLER: 1 };
    const field = [...snapshot.debrisFields]
      .filter((candidate) =>
        reachable(candidate, oneRecycler, snapshot.techs, {
          orbit: harvestBase.orbit,
          antimatter: harvestBase.antimatter,
        }),
      )
      .sort((a, b) => {
        const valueA = a.ore + a.polymers;
        const valueB = b.ore + b.polymers;
        return valueB / Math.max(1, b.distance + 1) - valueA / Math.max(1, a.distance + 1);
      })[0];
    if (field) {
      const capacity = fleetCapacity(oneRecycler);
      const count = Math.max(
        1,
        Math.min(harvestBase.ships.RECYCLER, Math.ceil((field.ore + field.polymers) / Math.max(1, capacity))),
      );
      intents.push({
        kind: 'HARVEST',
        baseId: harvestBase.id,
        planetId: field.planetId,
        ships: { ...emptyShipCounts(), RECYCLER: count },
        why: `поле обломков на ${Math.round(field.ore + field.polymers)} ресурсов`,
      });
    }
  }

  /* --- Экспедиции --- */
  if (snapshot.expeditionsInFlight < snapshot.expeditionSlots) {
    const explorer = snapshot.bases.find(
      (base) =>
        base.ships.SMALL_CARGO + base.ships.LARGE_CARGO > 0 &&
        COMBAT_TYPES.some((type) => base.ships[type] > 0),
    );
    if (explorer) {
      const ships = emptyShipCounts();
      if (explorer.ships.LARGE_CARGO > 0) ships.LARGE_CARGO = 1;
      else ships.SMALL_CARGO = 1;

      // Эскорт — четверть одного сильнейшего доступного класса, минимум один.
      // Экспедиция не оголяет базу и не отправляет всю армаду за случайной
      // находкой, но и не дарит грузовик первой пиратской засаде.
      for (const type of [...COMBAT_TYPES].reverse()) {
        if (explorer.ships[type] <= 0) continue;
        ships[type] = Math.max(1, Math.floor(explorer.ships[type] / 4));
        break;
      }
      intents.push({
        kind: 'EXPEDITION',
        baseId: explorer.id,
        ships,
        why: `свободных экспедиционных слотов ${snapshot.expeditionSlots - snapshot.expeditionsInFlight}`,
      });
    }
  }

  /* --- Экспансия --- */
  const wantColonies = Math.min(profile.colonyAmbition + 1, colonySlots(snapshot.techs));
  if (!snapshot.colonizing && snapshot.bases.length < wantColonies && snapshot.freePlanets.length > 0) {
    const carrier = snapshot.bases.find((base) => base.ships.COLONY_SHIP > 0);
    if (carrier) {
      const nearest = snapshot.freePlanets.reduce((best, planet) =>
        planet.distance < best.distance ? planet : best,
      );
      intents.push({
        kind: 'COLONIZE',
        baseId: carrier.id,
        planetId: nearest.planetId,
        why: `колоний ${snapshot.bases.length} из ${wantColonies}`,
      });
    } else {
      // Колониального корабля нет — его надо заказать вне долей характера:
      // он одноразовый и в состав эскадры не входит.
      const yard = snapshot.bases.find(
        (base) =>
          missingShipRequirements('COLONY_SHIP', base.levels, snapshot.techs).length === 0 &&
          base.shipQueue < 3 &&
          hasEnoughResources(base.resources, shipCost('COLONY_SHIP')),
      );
      if (yard) {
        intents.push({
          kind: 'SHIPS',
          baseId: yard.id,
          ship: 'COLONY_SHIP',
          count: 1,
          why: 'под экспансию нужен колониальный корабль',
        });
      }
    }
  }

  /* --- Набег --- */
  /*
   * В бою считается только то, что дерется.
   *
   * Транспорт возит груз и не стреляет, поэтому его стоимость не говорит
   * о силе ничего — а весит она много. Живой агрессор с семью десятками
   * грузовиков и шестью истребителями выглядел по общей стоимости как флот
   * в 44% от лучшей формы и продолжал ходить в набеги, проигрывая подряд.
   */
  const combatValue = (base: BotBaseSnapshot) => {
    const fighting = emptyShipCounts();
    for (const type of COMBAT_TYPES) fighting[type] = base.ships[type];
    return spentOnFleet(fighting);
  };
  const ownFleet = snapshot.bases.reduce((sum, base) => sum + combatValue(base), 0);

  /*
   * Против серийного агрессора летят и торговцы, и не в одиночку.
   *
   * Порог перевеса здесь ниже обычного: бьют вместе, и полуторакратного
   * превосходства каждого по отдельности ждать неоткуда — именно поэтому
   * жертва в одиночку и не отбивалась. Пол безнадежности при этом остается:
   * лететь на цель втрое сильнее нельзя никому и ни при какой обиде.
   *
   * Никакого договора между союзниками нет. Согласие — это когда сосед
   * действительно поднял флот, а не строка в базе: каждый решает сам,
   * по своей оценке сил, и передумать может в любой момент.
   */
  /*
   * Разбит — значит воевать больше нечем, и надо уходить копить силы.
   *
   * Порог — пятая часть от лучшего своего флота: потеряв четыре пятых,
   * агрессор перестает быть угрозой и становится мишенью. Живой Хижак дошел
   * до этого сам и не заметил: сжег пятьдесят три истребителя из пятидесяти
   * трех и продолжал слать набеги транспортами — только потому, что жертве
   * уже нечем было отвечать. Против первого же, кому есть чем, он потерял бы
   * и транспорты.
   *
   * Второй признак — союз: двое и больше объявили войну одновременно.
   * Поодиночке они бы не решились, значит скинулись, и драться разом
   * со всеми нельзя.
   */
  const beaten = snapshot.fleetPeak > 0 && ownFleet < snapshot.fleetPeak * 0.2;
  /*
   * Коалиция: двое и больше воюющих одновременно.
   *
   * Что с ней делать — не арифметика, а выбор, и он оставлен модели. По
   * умолчанию бот отходит, зализывает раны и копит силы: это решение почти
   * всегда лучше, и оно же прежнее поведение. Захотела драться до конца —
   * пусть дерется, это ее право и ее ответственность.
   *
   * Разбитому выбора не оставляют ни при каком ответе: стоять насмерть
   * нечем, а скормить агрессорам остатки флота — верный способ не подняться
   * уже никогда.
   */
  const besieged = snapshot.warsAgainstMe >= 2;
  const regrouping = beaten || (besieged && !profile.standGround);

  const rally =
    threat &&
    !regrouping &&
    !hopeless(ownFleet, threat.knownStrength) &&
    ownFleet >= (threat.knownStrength ?? 0)
      ? threat
      : null;

  const striker = snapshot.bases.reduce((best, base) =>
    spentOnFleet(base.ships) > spentOnFleet(best.ships) ? base : best,
  );
  // В набег идет только боевая часть: грузовики, зонды, переработчики
  // и колониальный корабль остаются дома, им в бою делать нечего.
  const strike = emptyShipCounts();
  for (const type of SHIP_TYPES) {
    if (type === 'PROBE' || type === 'RECYCLER' || type === 'COLONY_SHIP') continue;
    if (type === 'SMALL_CARGO' || type === 'LARGE_CARGO') continue;
    strike[type] = striker.ships[type];
  }
  /*
   * Трюмы под добычу — половина транспортов, и малых тоже.
   *
   * Малые не брали вовсе, и с расчетом выгоды это стало видно сразу: у живого
   * Хижака восемьдесят два малых транспорта и ни одного большого, поэтому
   * увезти он мог ровно столько, сколько влезало в трюмы истребителей —
   * пять тысяч единиц. Любой набег при таком потолке не окупался в принципе,
   * сколько бы ни лежало у цели на складе. Половина, а не все: вторая
   * половина продолжает возить на хаб, пока эта воюет.
   */
  strike.LARGE_CARGO = Math.floor(striker.ships.LARGE_CARGO / 2);
  strike.SMALL_CARGO = Math.floor(striker.ships.SMALL_CARGO / 2);

  /*
   * Час собственной добычи — мера соразмерности набега.
   *
   * Величина растет вместе с ботом сама, и в этом ее смысл: молодому и тысяча
   * ресурсов заметна, а развитому она не стоит ни топлива, ни испорченных
   * отношений с соседом. Постоянного порога тут быть не может — он устарел бы
   * к третьим суткам.
   */
  const output = productionPerSecond(
    striker.levels,
    striker.richness,
    economyBonuses(snapshot.techs),
    0,
    systemModifiers(striker.anomaly),
    timeCompressionDrain(snapshot.techs),
  );
  const hourlyOutput = (output.ore + output.polymers + output.plasma) * 3600;

  /*
   * Координаты подставные, и это точно, а не приблизительно: `planFlight`
   * смотрит на них ровно дважды — совпадают ли системы и каково расстояние
   * между ними. Обе величины из `distance` восстанавливаются без потерь.
   */
  const home: GalaxyPoint = { galaxyX: 0, galaxyY: 0 };
  const systemOf = (item: BotRaidTarget): GalaxyPoint => ({ galaxyX: item.distance, galaxyY: 0 });

  const target = regrouping
    ? null
    : rally
      ? snapshot.raidTargets.find((item) => item.planetId === rally.planetId) ?? null
      : pickRaidTarget(snapshot.raidTargets, ownFleet, snapshot.character, profile, {
          strike,
          techs: snapshot.techs,
          from: { orbit: striker.orbit, systemId: striker.systemId, antimatter: striker.antimatter },
          home,
          systemOf,
          hourlyOutput,
          collectDebris: snapshot.bases.some((base) => base.ships.RECYCLER > 0),
        });
  if (target) {
    if (spentOnFleet(strike) > 0) {
      intents.push({
        kind: 'RAID',
        baseId: striker.id,
        planetId: target.planetId,
        ships: strike,
        why: rally
          ? `${rally.nickname} бьет соседей: набегов за сутки ${rally.raids}`
          : `добыча окупает вылет: ${Math.round(
              raidValue(
                target,
                strike,
                snapshot.techs,
                { orbit: striker.orbit, systemId: striker.systemId },
                home,
                systemOf(target),
                snapshot.bases.some((base) => base.ships.RECYCLER > 0),
              ).net,
            )} чистыми`,
      });
    }
  }

  {
    /** Долетит ли туда зонд: рейс в чужую систему требует прыжка. */
    const canFly = (candidate: { orbit: number; distance: number }): boolean => {
      const probe = emptyShipCounts();
      probe.PROBE = 1;
      return reachable(candidate, probe, snapshot.techs, {
        orbit: striker.orbit,
        antimatter: striker.antimatter,
      });
    };

    /*
     * Разведка идет своим чередом, а не «когда лететь некуда».
     *
     * Раньше она стояла в ветке «цели нет»: бот, у которого набег выбрался,
     * не смотрел по сторонам вовсе. На живом стенде это выглядело так —
     * семьдесят пять колоний вокруг, разведаны две, и обе разведаны месяц
     * назад. Выбор из двух целей выбором не является, а решение «стоит ли
     * лететь» без чужого склада вообще не считается: набег теперь окупается
     * или не летит.
     *
     * Зонд и ударный флот — разные корабли и разные очереди, лететь им
     * ничто не мешает одновременно.
     *
     * Разведка нужна не только агрессору.
     *
     * Неразведанная цель безнадежна по определению — это правило, и оно
     * верное. Но пока разведка висела на `profile.raids`, торговец не мог
     * разведать вообще никого, а значит и подняться на серийного соседа
     * не мог никогда, сколько бы у него ни было флота. Правило «против
     * серийного агрессора соседи скидываются» при этом обещает обратное:
     * летят и торговцы.
     *
     * Так оно и вышло на живом стенде: «Хижак» сделал 376 набегов на одного
     * «Купця», тот разослал призыв, а «Крамар» со ста тридцатью двумя
     * истребителями и ста сорока турелями — сильнее агрессора — даже
     * не посмотрел в его сторону. Не потому что не захотел, а потому что
     * торговцу нечем смотреть.
     *
     * Поэтому зонд под серийного соседа заказывает и отправляет кто угодно,
     * а под обычную добычу — по-прежнему только тот, кто вообще ходит
     * в набеги.
     */
    const blocked = new Set(snapshot.scoutBlocked);
    const blindThreat =
      threat &&
      threat.knownStrength === null &&
      !blocked.has(threat.planetId) &&
      canFly({ orbit: threat.planetOrbit, distance: threat.distance })
        ? { planetId: threat.planetId, why: `${threat.nickname} бьет соседей, а мы его не видели` }
        : null;
    /*
     * Кого смотреть первым: ближнего. Дорога зонду тоже чего-то стоит,
     * а неразведанных вокруг больше, чем зондов за всю жизнь бота.
     */
    const blindPrey = profile.raids
      ? snapshot.raidTargets
          .filter(
            (candidate) =>
              candidate.knownStrength === null &&
              !shielded(candidate) &&
              !blocked.has(candidate.planetId) &&
              canFly(candidate),
          )
          .reduce<BotRaidTarget | undefined>(
            (best, candidate) => (best === undefined || candidate.distance < best.distance ? candidate : best),
            undefined,
          )
      : undefined;
    // Пока «Шпионаж» не подтянут, зонд не долетает ни до кого: смены цели
    // тут не помогают, помогает только технология.
    const blind = snapshot.scoutHopeless
      ? null
      : blindThreat ?? (blindPrey ? { planetId: blindPrey.planetId, why: 'цель не разведана' } : null);

    const scout = snapshot.bases.find((base) => base.ships.PROBE > 0);
    if (blind && scout) {
      intents.push({
        kind: 'SCAN',
        baseId: scout.id,
        planetId: blind.planetId,
        why: blind.why,
      });
    }

    /*
     * Зондов нет — заказываем: без них агрессор не воюет вообще.
     *
     * Зонд не входит в постоянный состав и потому не попадает в `fleetMix`
     * (`SQUADRON_TYPES` его исключает) — иначе модель ставила его в половину
     * эскадры, и живой бот однажды настроил девяносто четыре штуки. Но другого
     * пути заказать его в коде не осталось вовсе, и получился тупик: без
     * разведки у цели нет оценки силы, без оценки набег не выбирается,
     * а разведать нечем.
     *
     * Живой агрессор простоял в нем с пятьюдесятью тремя истребителями:
     * замысел «наращиваем ударный флот для завоевания соседей», войн ноль,
     * боев ноль. Зонд — инструмент под задачу, и заказывается он тогда,
     * когда задача есть: цель невыяснена, а смотреть нечем. Задача эта
     * бывает и у торговца — серийный сосед по соседству, — поэтому условие
     * тут про зонды и цель, а не про характер.
     */
    /*
     * Заказываем зонды только под собственную добычу, но не под серийного
     * соседа.
     *
     * Разница в том, чем кончается неудача. Обычную цель бот рано или поздно
     * разглядит. Агрессора с «Шпионажем» выше своего не разглядит никогда:
     * при отставании на два уровня дрон гибнет с вероятностью 99% и записи
     * о вылете не оставляет, поэтому цель остается неразведанной, а заказ
     * повторяется — получилась бы мясорубка на пару зондов в минуту.
     * У живого «Крамара» «Шпионаж» 2 против 5 у «Хижака» — ровно этот случай.
     *
     * Силу такого соседа бот и так узнает, когда отобьет его набег:
     * отчет о бое показывает приведенный флот целиком.
     */
    const yard = snapshot.bases.find((base) => base.levels.SHIPYARD > 0 && base.shipQueue < 3);
    if (
      blindPrey &&
      !scout &&
      !snapshot.scoutHopeless &&
      yard &&
      missingShipRequirements('PROBE', yard.levels, snapshot.techs).length === 0
    ) {
      // Пара штук: зонд одноразовый, но заказывать их десятками незачем —
      // разведывают по одной цели за раз.
      intents.push({
        kind: 'SHIPS',
        baseId: yard.id,
        ship: 'PROBE',
        count: 2,
        why: 'разведывать нечем, а цели не выяснены',
      });
    }
  }

  /*
   * Призыв о помощи.
   *
   * Шлет его только жертва и только про того, кто бьет ее саму: рассылать
   * тревогу за чужой счет — верный способ превратить почту в шум. Текст
   * собирает код, не модель: это не переговоры, а сигнал, и стоить он должен
   * ноль. Кто откликнется, решает каждый сам — согласие видно по поднятому
   * флоту, а не по ответному письму.
   */
  if (threat?.againstMe) {
    intents.push({
      kind: 'RALLY',
      commanderId: threat.commanderId,
      nickname: threat.nickname,
      raids: threat.raids,
      why: `${threat.nickname} бьет меня раз за разом: набегов за сутки ${threat.raids}`,
    });
  }

  /* --- Биржа --- */
  if (profile.trade.active) {
    intents.push(...tradeIntents(snapshot, profile, shortfall));
  }

  /*
   * Спешка за криптогривну: единственное, на что бот тратит деньги по своей
   * воле, и потому единственный сток, который зависит от его решения.
   *
   * Условие не про жадность, а про смысл: спешить стоит, когда деньги
   * все равно лежат без дела. Мерой служит собственный часовой доход
   * с фермы — если стройку можно доделать дешевле, чем ферма приносит за час,
   * а на счету при этом больше суток такого дохода, то держать эти деньги
   * незачем: время дороже.
   *
   * Без этого правила сток остался бы нулевым: боты копили миллионы
   * и не тратили их ни на что, кроме редкого расширения склада.
   */
  const hourlyCredits = creditOutput(capital.levels, cryptoBonus(snapshot.techs)) * 3600;
  if (capital.building && hourlyCredits > 0 && snapshot.credits > hourlyCredits * 24) {
    intents.push({ kind: 'RUSH', baseId: capital.id, why: 'деньги лежат без дела, а стройка идет' });
  }

  /*
   * Склад хаба тесен — расширяем, благо теперь это вопрос денег.
   *
   * Без этого бот запирался намертво: продать некому, значит место
   * не освобождается, значит купить нельзя, значит и предложить в обмен
   * нечего. Три живых бота встали так одновременно, и рынок замер — ноль
   * сделок за двадцать минут при полутора миллионах на счетах.
   *
   * Порог по заполненности, а не по свободному месту в штуках: у большого
   * склада тысяча свободных единиц это запас, у маленького — предел.
   */
  const hubTotal = snapshot.hubStorage.ore + snapshot.hubStorage.polymers;
  const hubCapacity = hubTotal + Math.max(0, snapshot.hubStorage.free);
  /*
   * Расширяем, только если забит он ходовым товаром.
   *
   * Иначе бот платит за хранение неликвида, и каждый следующий уровень вдвое
   * дороже предыдущего: живой бот поднял склад с четвертого до восьмого,
   * сжег 1.9 млн ₴ и все ради 56 тысяч полимеров, которых никто не берет.
   * Место под неликвид освобождается не расширением, а вывозом домой.
   */
  const liquid = TRADED.some((resource) => {
    const onHub = resource === 'ORE' ? snapshot.hubStorage.ore : snapshot.hubStorage.polymers;
    const demand = snapshot.market.find((ref) => ref.resource === resource)?.demand ?? 0;
    return onHub > 0 && demand > 0;
  });
  /*
   * Расширение оплачивается дважды: разово и потом всегда.
   *
   * Место на хабе стоит криптогривны каждую секунду, и плата удваивается
   * с каждым уровнем — на десятом это ₴87 тысяч в час. Бот, который смотрит
   * только на цену расширения, покупает себе вечный расход, не спросив,
   * из чего его платить.
   *
   * Проверка простая: денег должно хватать и на само расширение, и на сутки
   * его содержания. Сутки — потому что это горизонт, на котором бот сам себя
   * видит: за это время он успевает и продать, и построить, и пересмотреть
   * план. Привязывать проверку к отдаче фермы нельзя — у торговца ее может
   * не быть вовсе, а живет он с продаж, и тогда правило запретило бы ему
   * расширяться навсегда.
   */
  const yearOfRent = snapshot.hubStorage.nextRentPerHour * 24;
  const affordableRent = snapshot.credits >= snapshot.hubStorage.upgradeCost + yearOfRent;

  if (hubCapacity > 0 && hubTotal >= hubCapacity * 0.8 && liquid && affordableRent) {
    intents.push({ kind: 'HUB_UPGRADE', why: 'склад на хабе забит ходовым товаром' });
  }

  /*
   * Везем домой все свое, что влезет, а не только сегодняшний дефицит.
   *
   * Строят из того, что лежит на базе, и запас на хабе в планировании стройки
   * не участвует вовсе. Пока рейс забирал только недостающее на ближайшую
   * цель, собственное добро лежало на станции мертвым грузом: у живого Купця
   * на хабе было 45 555 руды при трех тысячах дома и месте под двадцать три
   * тысячи. Он не «решил не везти» — правило просто не срабатывало, потому
   * что в ту минуту он не копил, а строил.
   *
   * Дома ресурс работает, на хабе он только занимает место и толкает платить
   * за расширение склада. Поэтому забираем все, подо что есть место дома,
   * — а недостающее на цель грузим первым, если трюмов на все не хватает.
   */
  const homeward = snapshot.bases[0];
  if (homeward) {
    /*
     * Трюмы за вычетом топлива: оно едет в них же, и вылет проверяется
     * по остатку. Запрос на всю вместимость ангара сервер отклонял —
     * «Трюмы вмещают 19 688, а запрошено 20 000», — и бот, которому для
     * вывоза нужен весь ангар, не вывозил ничего и повторял это каждый ход.
     */
    const hold = holdForCargo({
      ...emptyShipCounts(),
      LARGE_CARGO: homeward.ships.LARGE_CARGO,
      SMALL_CARGO: homeward.ships.SMALL_CARGO,
    });
    const caps = storageCapacities(homeward.levels);

    /*
     * Рейс на хаб — здесь, а не отдельным ходом директора: только здесь
     * известно, на что бот копит, и этого он не вывозит.
     * Идет первым — вывоз с хаба берет трюмы, оставшиеся после него.
     */
    const export_ = hubDeliveryLoad(snapshot, need);
    if (export_) {
      intents.push({
        kind: 'HUB_DELIVERY',
        baseId: homeward.id,
        ore: export_.ore,
        polymers: export_.polymers,
        why: 'излишек сверх половины склада — на продажу',
      });
    }

    /*
     * Домой — ровно до границы вывоза: выше нее привезенное тут же ушло бы
     * обратно следующим рейсом. Граница уже включает то, что требует цель.
     */
    const keep = homeKeep(caps, need);
    const room = (resource: 'ore' | 'polymers'): number =>
      Math.max(0, keep[resource] - Math.max(0, homeward.resources[resource]));

    // Порядок погрузки: сначала то, чего не хватает на цель.
    const queue: Array<'ore' | 'polymers'> = shortfall.has('polymers') && !shortfall.has('ore')
      ? ['polymers', 'ore']
      : ['ore', 'polymers'];

    let left = hold - (export_ ? export_.ore + export_.polymers : 0);
    const take = { ore: 0, polymers: 0 };
    for (const resource of queue) {
      const available = Math.floor(resource === 'ore' ? snapshot.hubStorage.ore : snapshot.hubStorage.polymers);
      const amount = Math.max(0, Math.min(available, Math.floor(room(resource)), Math.floor(left)));
      take[resource] = amount;
      left -= amount;
    }

    // Мелочь рейса не стоит: транспорт уйдет надолго, а привезет ничто.
    if (take.ore + take.polymers >= 100) {
      intents.push({
        kind: 'PICKUP',
        baseId: homeward.id,
        ore: take.ore,
        polymers: take.polymers,
        why: 'свое лежит на хабе, а строят из того, что на базе',
      });
    }
  }

  intents.push(...syndicateIntents(snapshot, profile, syndicateShare, shortfall));

  return intents;
}

/**
 * Ордера бота.
 *
 * Бот держит заявки только в коридоре вокруг справочной цены: без коридора
 * он стал бы либо бесплатным насосом ресурсов для того, кто его переиграет,
 * либо пылесосом, высасывающим стакан. Продает излишек сверх собственных
 * нужд, покупает то, чего не хватает на ближайшую цель.
 */
/**
 * Торговля.
 *
 * Три бота на одном хабе не совершили ни одной сделки: каждый выставлял свою
 * пассивную заявку, спред не пересекался, и стакан стоял мертвым. Потому что
 * бот умел только выставлять — брать чужое он не умел вовсе.
 *
 * Теперь порядок обратный: сперва смотрим, что уже лежит в стакане и что можно
 * взять прямо сейчас, и только потом выставляем свое. Взять выгодное всегда
 * лучше, чем ждать у моря погоды: сделка происходит сразу, а заявка может
 * провисеть сутки.
 */
function tradeIntents(
  snapshot: BotSnapshot,
  profile: BotPersonality,
  /** Ресурсы, которых не хватает на ближайшую постройку или технологию. */
  shortfall: ReadonlySet<StoredResource>,
): BotIntent[] {
  const intents: BotIntent[] = [];
  const hub = snapshot.hubStorage;
  const reference = new Map(snapshot.market.map((ref) => [ref.resource, ref.reference]));
  const foreign = snapshot.orderBook.filter((order) => !order.mine && order.amount > 0);

  /*
   * Что считать выгодным.
   *
   * Коридор строится вокруг рыночной цены — средневзвешенной по последним
   * сделкам между игроками, — а не вокруг константы. Это принципиально:
   * пока цена была прибита к справочным десяти, бот не дал бы за руду больше
   * 10.6, как бы ее ни не хватало, и спроса с предложением не возникало
   * вовсе — был бы фиксированный курс без станции, которая его держит.
   *
   * Коридор целиком сдвигается перекосом стакана. Спрос больше предложения —
   * покупатель вынужден платить дороже, а продавец может не спешить, и обе
   * границы едут вверх; завались товара — вниз. Сдвиг ограничен той же
   * маржой, поэтому цена ходит, но не улетает с одной сделки.
   */
  const shift = (resource: 'ORE' | 'POLYMERS') => {
    const ref = snapshot.market.find((item) => item.resource === resource);
    return 1 + (ref?.skew ?? 0) * profile.trade.margin;
  };
  const buyCeiling = (resource: 'ORE' | 'POLYMERS') =>
    (reference.get(resource) ?? 0) * (1 + profile.trade.margin) * shift(resource);
  const sellFloor = (resource: 'ORE' | 'POLYMERS') =>
    (reference.get(resource) ?? 0) * (1 - profile.trade.margin) * shift(resource);

  /*
   * По каждому ресурсу бот выбирает одну сторону: он либо продавец, либо
   * покупатель, но не оба сразу.
   *
   * Без этого правила боты гоняли товар по кругу. Коридоры перекрываются —
   * покупать не дороже 10.6 и продавать не дешевле 9.4 означает, что цена 11
   * одновременно «выгодно купить» и «выгодно продать», — и три бота на одном
   * хабе за двадцать минут совершили 111 встречных сделок, симметричных
   * до единицы: семнадцать туда, шестнадцать обратно. Не изменилось ничего,
   * кроме комиссии биржи, которая эти круги и оплачивала.
   *
   * Сторону задает заполненность складов баз, а не запас на хабе. Хаб —
   * следствие: он переворачивается после каждой сделки, и сторона вместе
   * с ним, так что боты продолжали бы пинг-понг, просто медленнее. Склады
   * баз отражают перекос добычи — то, из-за чего торговать вообще есть смысл,
   * — и меняются они со скоростью стройки шахт, а не сделок.
   *
   * Отсюда же следует, что два одинаково развитых бота друг с другом
   * не торгуют вовсе: у них один и тот же избыток, и встречного интереса
   * между ними нет. Раньше их контрагентом была станция; она снята, и теперь
   * такой стакан просто стоит — все на одной стороне, встречной заявки нет
   * ни у кого. Разводит их не биржа, а разная застройка: у кого шахта
   * обогнала завод, тот и продает руду.
   */
  const fill = new Map<'ORE' | 'POLYMERS', number>();
  for (const resource of TRADED) {
    const field = resource === 'ORE' ? 'ore' : 'polymers';
    let held = 0;
    let capacity = 0;
    for (const base of snapshot.bases) {
      held += Math.max(0, base.resources[field]);
      capacity += storageCapacities(base.levels)[field];
    }
    fill.set(resource, capacity > 0 ? held / capacity : 0);
  }

  /*
   * Сторону решает нужда, и только потом запас.
   *
   * Ресурс, которого не хватает на ближайшую цель, бот покупает, даже если
   * склады им полны наполовину: полный склад полимеров ничего не значит,
   * когда целевое здание требует руды, а рудная шахта уже стоит и быстрее
   * добывать не станет. Ровно за этим на рынок и ходят — продать одно
   * и купить другое, а не копить то, чего и так вдоволь.
   *
   * Остальное решает запас: половина склада — избыток, его продаем.
   */
  const stored = (resource: 'ORE' | 'POLYMERS') => (resource === 'ORE' ? 'ore' : 'polymers') as StoredResource;
  const selling = (resource: 'ORE' | 'POLYMERS') =>
    !shortfall.has(stored(resource)) && (fill.get(resource) ?? 0) >= 0.5;

  /*
   * Не покупаем то, чего на хабе уже больше, чем база способна принять.
   *
   * Сторону решают склады баз, а не хаб, и это верно — привязка стороны
   * к хабу давала петлю на 111 встречных сделок. Но у правила была обратная
   * сторона: хаб не учитывался вовсе, и бот покупал ресурс, которого у него
   * там уже лежала гора. Живой «Купець» дошел до предела этой логики —
   * 146 тысяч полимеров на хабе, восемь тысяч на базе, и он спускает
   * последние два миллиона гривны на покупку еще полимеров, оставшись
   * с тремя гривнами на счету.
   *
   * Порог не выдуман: домой можно увезти только то, что влезет в склад базы.
   * Если на хабе уже больше свободного места дома, следующая купленная
   * единица не превратится ни во что — ее некуда положить даже теоретически.
   * Продавать при этом ничто не мешает, и вывоз домой тоже: тормоз стоит
   * только на покупке.
   */
  const glutted = (resource: 'ORE' | 'POLYMERS'): boolean => {
    const field = resource === 'ORE' ? 'ore' : 'polymers';
    let room = 0;
    for (const base of snapshot.bases) {
      room += Math.max(0, storageCapacities(base.levels)[field] - Math.max(0, base.resources[field]));
    }
    return (resource === 'ORE' ? hub.ore : hub.polymers) >= room;
  };

  /* --- Берем чужое --- */

  // Дешевле всех — первым: если денег хватит не на все, тратим их с толком.
  const cheapest = foreign
    .filter(
      (order) =>
        order.side === 'SELL' &&
        !selling(order.resource) &&
        !glutted(order.resource) &&
        order.price <= buyCeiling(order.resource),
    )
    .sort((a, b) => a.price - b.price);

  /*
   * Часть денег не свободна: место на хабе стоит каждую секунду.
   *
   * Бот начинал закупку с полного баланса и выгребал его до нуля, а потом
   * не платил аренду, не расширял склад и не мог доделать стройку. На живом
   * стенде это видно по счетам: пятеро с ₴1–5 тыс. при ферме в четверть
   * миллиона в час. Сутки нынешней аренды — тот минимум, который нельзя
   * унести на рынок.
   */
  /*
   * Денежный резерв здесь пробовали и сняли.
   *
   * Казалось очевидным: оставить сутки аренды хаба, чтобы бот не выгребал
   * счет до нуля. Прогон недели показал обратное — сделок 1 399 против
   * 22 038, денежная масса ₴15.8 млн против ₴6.5 млн, сток спешки упал
   * с ₴53 до ₴35 млн. Деньги, которые бот не потратил на рынке, не уходят
   * никуда: они копятся, и масса растет. Это третий рыночный эксперимент
   * подряд с одним исходом — рынок этой игры держится на мелких частых
   * сделках, и любое их удержание бьет по стоку сильнее, чем помогает балансу.
   */
  let purse = snapshot.credits;
  let room = hub.free;
  for (const order of cheapest) {
    if (purse <= 0 || room <= 0) break;
    // Берем по максимуму: сколько позволяют касса, место на складе и сама
    // заявка. Держать криптогривну мертвым грузом смысла нет — ресурс,
    // купленный дешево, работает, а деньги на счету не работают никак.
    const affordable = Math.floor(purse / Math.max(order.price, 1));
    const amount = Math.min(order.amount, affordable, Math.floor(room));
    if (amount <= 0) continue;

    intents.push({
      kind: 'TAKE',
      orderId: order.id,
      amount,
      why: `берем ${order.resource === 'ORE' ? 'руду' : 'полимеры'} по ${order.price} при справочной ${Math.round(reference.get(order.resource) ?? 0)}`,
    });
    purse -= amount * order.price;
    room -= amount;
  }

  // Дороже всех — первым: продаем тому, кто больше дает.
  const richest = foreign
    .filter((order) => order.side === 'BUY' && selling(order.resource) && order.price >= sellFloor(order.resource))
    .sort((a, b) => b.price - a.price);

  const onHand = { ORE: hub.ore, POLYMERS: hub.polymers };
  for (const order of richest) {
    const have = Math.floor(onHand[order.resource]);
    if (have <= 0) continue;
    const amount = Math.min(order.amount, have);
    if (amount <= 0) continue;

    intents.push({
      kind: 'TAKE',
      orderId: order.id,
      amount,
      why: `отдаем ${order.resource === 'ORE' ? 'руду' : 'полимеры'} по ${order.price} при справочной ${Math.round(reference.get(order.resource) ?? 0)}`,
    });
    onHand[order.resource] -= amount;
  }

  /* --- Выставляем свое --- */

  /*
   * Заявка нужна там, где брать нечего. Считаем и свои, и чужие: если на этой
   * стороне уже висит десяток заявок, еще одна ничего не изменит, а место
   * в собственном потолке займет.
   */
  const mine = snapshot.orderBook.filter((order) => order.mine);
  /*
   * Снимаем свои заявки на стороне, которую бот больше не занимает.
   *
   * Заявка живет до исполнения и переживает смену намерений: живой бот
   * держал покупку полимеров по 15, выставленную старой логикой, и одновременно
   * продавал полимеры — петля крутилась через собственную же стоячую заявку,
   * хотя новых таких он уже не ставил. Правило стороны без этого неполно:
   * оно решает, что бот делает сейчас, но не убирает того, что он обещал раньше.
   */
  for (const order of mine) {
    const wrongSide = order.side === (selling(order.resource) ? 'BUY' : 'SELL');
    if (wrongSide) {
      intents.push({
        kind: 'DROP',
        orderId: order.id,
        why: `${order.resource === 'ORE' ? 'по руде' : 'по полимерам'} мы теперь на другой стороне`,
      });
    }
  }

  // Потолок считается после снятия: иначе бот с пятью устаревшими заявками
  // выходил бы отсюда раньше, чем успел снять хоть одну, и застревал навсегда.
  if (mine.length - intents.filter((intent) => intent.kind === 'DROP').length >= 5) return intents;

  const standing = (side: 'BUY' | 'SELL', resource: 'ORE' | 'POLYMERS') =>
    mine.some((order) => order.side === side && order.resource === resource);


  for (const ref of snapshot.market) {
    if (ref.reference <= 0) continue;
    const held = ref.resource === 'ORE' ? hub.ore : hub.polymers;
    const best = foreign.filter((o) => o.resource === ref.resource);

    // Продаем излишек: то, что лежит на хабе и не нужно на выкуп.
    if (selling(ref.resource) && !standing('SELL', ref.resource)) {
      const amount = Math.floor(held * profile.trade.sellShare);
      if (amount > 0) {
        // Встаем чуть ниже лучшей чужой продажи, иначе очередь до нас
        // не дойдет никогда. Ниже пола не опускаемся.
        // Округляем вверх: вниз — значит выйти за собственный пол.
        const rival = Math.min(...best.filter((o) => o.side === 'SELL').map((o) => o.price), Infinity);
        const price = Math.max(
          Math.ceil(sellFloor(ref.resource)),
          Number.isFinite(rival) ? Math.round(rival) - 1 : Math.ceil(ref.reference * (1 + profile.trade.margin)),
        );
        intents.push({ kind: 'ORDER', side: 'SELL', resource: ref.resource, amount, price, why: 'излишек на хабе' });
      }
    }

    // Покупаем впрок: криптогривна сама по себе ничего не производит.
    // Но не в кучу, которую и так некуда девать, — тот же тормоз, что и выше.
    if (
      !selling(ref.resource) &&
      !glutted(ref.resource) &&
      snapshot.credits > 0 &&
      hub.free > 0 &&
      !standing('BUY', ref.resource)
    ) {
      // Округляем вниз: вверх — значит перебить собственный потолок.
      // Именно на этом бот ставил покупку по 11 при потолке 10.6.
      const rival = Math.max(...best.filter((o) => o.side === 'BUY').map((o) => o.price), 0);
      const price = Math.min(
        Math.floor(buyCeiling(ref.resource)),
        rival > 0 ? Math.round(rival) + 1 : Math.floor(ref.reference),
      );
      const amount = Math.floor(
        Math.min((snapshot.credits * 0.4) / Math.max(price, 1), hub.free),
      );
      if (amount > 0 && price > 0) {
        intents.push({ kind: 'ORDER', side: 'BUY', resource: ref.resource, amount, price, why: 'копим запас впрок' });
      }
    }
  }

  return intents;
}

/* ------------------------- Синдикат ------------------------- */

export type SyndicateFocus = SyndicateModule | SyndicateTech;

export interface SyndicateGoal {
  kind: 'module' | 'tech';
  key: SyndicateFocus;
  cost: TreasuryCost;
}

/**
 * Ближайшая цель синдиката: первое по порядку плана, что можно начать.
 *
 * Цель одна на весь синдикат, а не на бота, и не зависит от прав смотрящего:
 * рядовой участник копит под то же, что строит главарь, иначе каждый возил бы
 * в казну под свое, и не набиралось бы ни на что.
 *
 * Два пункта сами по себе не заканчиваются, поэтому у них свои условия.
 * Кіш — это места в составе, и тянуть его стоит, только когда тесно: состав
 * вместе с заявками уперся в предел. Академия — потолок уровня технологий,
 * и тянуть ее стоит, только когда потолок достигнут хотя бы одной
 * технологией из плана; иначе она съедала бы казну раньше самих технологий.
 */
export function syndicateGoal(syndicate: BotSyndicate, focus: readonly SyndicateFocus[]): SyndicateGoal | null {
  const progress = syndicateProgress(syndicate, syndicate.techs);
  const ceiling = focus.some((key) => isSyndicateTech(key) && syndicate.techs[key] >= syndicate.academyLevel);

  /*
   * Первое, что можно начать ради пункта плана: сам пункт, а если он заперт
   * требованиями — его недостающее требование, и так вглубь.
   *
   * Без этого цепь запирала бы план: «Инженерный корпус» первым пунктом при
   * нулевой артели стоял бы вечно, а копить было бы не на что — цель
   * недоступна. Подтянутое требование строится и тогда, когда само по себе
   * не прошло бы: Кіш тянут не ради мест, а потому что без него не взять
   * Академию, и Академию — не ради потолка, а ради того, что стоит на ней.
   * Глубина ограничена: цепь неглубокая, и счетчик лишь страхует от ошибки
   * в таблице требований.
   */
  const reach = (key: SyndicateFocus, pulled: boolean, depth: number): SyndicateGoal | null => {
    if (key === 'BRAMA' || depth > 8) return null;
    // Нужен ли пункт вообще — раньше требований: ненужная Академия не должна
    // тянуть за собой Кіш, а тот — Скарбницю.
    if (!pulled && key === 'KISH' && syndicate.members + syndicate.applications.length < syndicate.memberCap) return null;
    if (!pulled && key === 'AKADEMIIA' && !ceiling) return null;

    const target = progressLevel(progress, key) + 1;
    const missing = missingSyndicateRequirements(key, target, progress);
    if (missing.length > 0) {
      for (const req of missing) {
        const found = reach(req.key, true, depth + 1);
        if (found) return found;
      }
      return null;
    }
    if (isSyndicateTech(key)) {
      return syndicate.research ? null : { kind: 'tech', key, cost: syndicateTechCost(target) };
    }
    return syndicate.construction ? null : { kind: 'module', key, cost: syndicateModuleCost(key, target) };
  };

  for (const key of focus) {
    const goal = reach(key, false, 0);
    if (goal) return goal;
  }
  return null;
}

/** Мельче этого взнос и рейс в Кіш не делаются: россыпь по сотне ничего не строит. */
const MIN_DONATION = 1000;
const MIN_KISH_LOAD = 1000;

/**
 * Вклад и развитие синдиката.
 *
 * Хватает казны на цель — бот с правом ее начинает. Не хватает — каждый
 * участник докладывает недостающее в пределах своей доли: гривну взносом,
 * руду и полимеры рейсом. Под цель, а не впрок: казна без цели — это деньги,
 * снятые с базы ради ничего, и при роспуске они сгорают.
 *
 * Ресурс, которого самому боту не хватает на стройку, в казну не уходит:
 * синдикат силен участниками, и разорять базу ради модуля незачем.
 */
function syndicateIntents(
  snapshot: BotSnapshot,
  profile: BotPersonality,
  share: number,
  shortfall: ReadonlySet<StoredResource>,
): BotIntent[] {
  const syndicate = snapshot.syndicate;
  if (!syndicate) return [];
  const goal = syndicateGoal(syndicate, profile.syndicateFocus ?? []);
  if (!goal) return [];

  const intents: BotIntent[] = [];
  const bank = syndicate.bank;
  const covered = bank.credits >= goal.cost.credits && bank.ore >= goal.cost.ore && bank.polymers >= goal.cost.polymers;

  if (covered) {
    if (goal.kind === 'tech' && syndicate.canResearch && isSyndicateTech(goal.key)) {
      intents.push({ kind: 'SYNDICATE_RESEARCH', tech: goal.key, why: 'казны хватает на технологию' });
    } else if (goal.kind === 'module' && !isSyndicateTech(goal.key)) {
      const allowed = goal.key === 'AKADEMIIA' ? syndicate.canResearch : syndicate.canBuild;
      if (allowed) intents.push({ kind: 'SYNDICATE_BUILD', module: goal.key, why: 'казны хватает на модуль' });
    }
    return intents;
  }
  if (share <= 0) return intents;

  const creditGap = goal.cost.credits - bank.credits;
  if (creditGap > 0 && !syndicate.donatedRecently) {
    const amount = Math.floor(Math.min(creditGap, snapshot.credits * share));
    if (amount >= MIN_DONATION) intents.push({ kind: 'DONATE', amount, why: `в казну под ${goal.key}` });
  }

  const capital = snapshot.bases[0];
  if (capital && syndicate.kishInMySystem && !syndicate.deliveringToKish) {
    const give = (resource: 'ore' | 'polymers'): number =>
      shortfall.has(resource)
        ? 0
        : Math.max(0, Math.floor(Math.min(goal.cost[resource] - bank[resource], Math.max(0, capital.resources[resource]) * share)));
    let ore = give('ore');
    let polymers = give('polymers');
    // Трюмы за вычетом топлива — по той же причине, что у вывоза с хаба.
    const hold = holdForCargo({
      ...emptyShipCounts(),
      LARGE_CARGO: capital.ships.LARGE_CARGO,
      SMALL_CARGO: capital.ships.SMALL_CARGO,
    });
    if (ore + polymers > hold) {
      const scale = hold / (ore + polymers);
      ore = Math.floor(ore * scale);
      polymers = Math.floor(polymers * scale);
    }
    if (ore + polymers >= MIN_KISH_LOAD) {
      intents.push({ kind: 'KISH_DELIVERY', baseId: capital.id, ore, polymers, why: `в казну под ${goal.key}` });
    }
  }
  return intents;
}

/* ------------------------- Утилиты для тестов ------------------------- */

/** Пустой снимок: тесты собирают из него нужную ситуацию точечно. */
export function emptyBotSnapshot(character: BotCharacter): BotSnapshot {
  return {
    character,
    credits: 0,
    techs: {} as TechLevels,
    researching: false,
    bases: [],
    fleetsInFlight: 0,
    expeditionsInFlight: 0,
    expeditionSlots: 0,
    joinableResearchBases: [],
    freePlanets: [],
    raidTargets: [],
    market: [],
    debrisFields: [],
    threats: [],
    fleetPeak: 0,
    warsAgainstMe: 0,
    orderBook: [],
    hubStorage: {
      ore: 0,
      polymers: 0,
      free: 0,
      level: 1,
      upgradeCost: storageUpgradeCost(2),
      currentRentPerHour: hubRent(1) * 3600,
      nextRentPerHour: hubRent(2) * 3600,
    },
    colonizing: false,
    scoutBlocked: [],
    scoutHopeless: false,
    syndicate: null,
    syndicates: [],
    syndicateCooldown: false,
  };
}

/** Заготовка базы для тестов: столица первого уровня без очередей. */
export function testBase(id: string, overrides: Partial<BotBaseSnapshot> = {}): BotBaseSnapshot {
  return {
    id,
    planetId: `${id}-planet`,
    systemId: `${id}-system`,
    orbit: 1,
    antimatter: 0,
    levels: emptyLevels(),
    richness: { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 },
    anomaly: 'NONE',
    resources: { ore: 0, polymers: 0, plasma: 0 },
    ships: emptyShipCounts(),
    defenses: emptyDefenseCounts(),
    building: false,
    shipQueue: 0,
    defenseQueue: 0,
    ...overrides,
  };
}

/** Полный список типов зданий — тестам удобнее брать его отсюда. */
export const BOT_BUILDINGS = BUILDING_TYPES;
export { multiplyResources };
