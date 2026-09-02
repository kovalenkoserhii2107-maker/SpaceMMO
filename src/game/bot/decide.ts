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
  BUILDING_TYPES,
  emptyLevels,
  energyEfficiency,
  hasEnoughResources,
  missingBuildingRequirements,
  multiplyResources,
  productionPerSecond,
  STORAGE_FOR,
  STORED_RESOURCES,
  storageCapacities,
  storageCapacity,
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
  SHIP_TYPES,
  emptyShipCounts,
  missingShipRequirements,
  shipCost,
  type ShipCounts,
  type ShipType,
} from '../ships.js';
import {
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

/* ------------------------- Снимок мира ------------------------- */

export interface BotBaseSnapshot {
  id: string;
  planetId: string;
  systemId: string;
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
  /**
   * Оценка обороны цели по последней разведке в единицах ресурсов.
   * null — цель не разведана, лететь вслепую бот не станет.
   */
  knownStrength: number | null;
  distance: number;
}

export interface BotMarketRef {
  resource: 'ORE' | 'POLYMERS';
  /** Справочная цена, вокруг которой бот держит свой коридор. */
  reference: number;
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
  freePlanets: BotFreePlanet[];
  raidTargets: BotRaidTarget[];
  market: BotMarketRef[];
  /**
   * Заявки бота, которые уже стоят в стакане.
   *
   * Без них бот выставлял бы одну и ту же заявку каждые сорок пять секунд:
   * условие «запас ниже четверти склада» держится часами, а ордер его
   * не меняет. За сутки это десятки одинаковых заявок и вся касса в залоге.
   */
  openOrders: Array<{ side: 'BUY' | 'SELL'; resource: 'ORE' | 'POLYMERS' }>;
  /** Уже отправлен ли колониальный рейс: два на одну планету не нужны. */
  colonizing: boolean;
}

/* ------------------------- Намерения ------------------------- */

export type BotIntent =
  | { kind: 'BUILD'; baseId: string; building: BuildingType; why: string }
  | { kind: 'RESEARCH'; baseId: string; tech: TechnologyType; why: string }
  | { kind: 'SHIPS'; baseId: string; ship: ShipType; count: number; why: string }
  | { kind: 'DEFENSE'; baseId: string; defense: DefenseType; count: number; why: string }
  | { kind: 'COLONIZE'; baseId: string; planetId: string; why: string }
  | { kind: 'RAID'; baseId: string; planetId: string; ships: ShipCounts; why: string }
  | { kind: 'SCAN'; baseId: string; planetId: string; why: string }
  | {
      kind: 'ORDER';
      side: 'BUY' | 'SELL';
      resource: 'ORE' | 'POLYMERS';
      amount: number;
      price: number;
      why: string;
    };

/* ------------------------- Кошельки ------------------------- */

/**
 * Доход делится на направления долями характера, и каждое тратит только свою
 * долю склада. Направление, которому не хватает на цель, просто ждет —
 * склад растет, растет и его доля. Так бот развивается сразу по всем фронтам
 * и не уходит в одну ветку до упора, как ушел бы жадный алгоритм «покупай
 * самое окупаемое».
 */
type Direction = 'economy' | 'research' | 'fleet' | 'defense';

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
 */
function canAfford(
  stock: ResourceAmounts,
  capacity: number,
  share: number,
  cost: ResourceAmounts,
): boolean {
  if (hasEnoughResources(wallet(stock, share), cost)) return true;
  const beyondShare = costUnits(cost) > capacity * share;
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
  const beforeRate = before.ore + before.polymers + before.plasma;

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
   * Склады разделены, поэтому и решение поресурсное: тянем тот, который
   * действительно жмет. Раньше приходилось гадать по общей сумме, и бот
   * расширял хранилище, когда место кончалось вовсе не у того ресурса.
   */
  for (const resource of STORED_RESOURCES) {
    const building = STORAGE_FOR[resource];
    const room = caps[resource];
    const held = Math.max(0, base.resources[resource]);
    const rate = before[resource];
    if (held >= room * 0.9 || room < rate * 3600) want(building);
  }

  // Просевшая энергия режет добычу на всех шахтах разом, поэтому станция
  // важнее любого следующего уровня шахты.
  if (energyEfficiency(levels, base.richness, bonuses, 0, drain) < 0.95) want('POWER_PLANT');

  if (levels.SCIENCE_CENTER === 0) want('SCIENCE_CENTER');
  if (levels.SHIPYARD === 0) want('SHIPYARD');

  // Характер подтягивает свои здания, пока они отстают от шахт вдвое.
  for (const focus of profile.buildingFocus) {
    if (levels[focus] * 2 < levels.ORE_MINE) want(focus);
  }

  // Шахты по окупаемости: во сколько ресурсов обходится единица прироста добычи.
  const ranked: Array<{ type: BuildingType; payback: number }> = [];
  for (const type of mines) {
    if (!available(type)) continue;
    const raised: BuildingLevels = { ...levels, [type]: levels[type] + 1 };
    const after = productionPerSecond(raised, base.richness, bonuses, 0, modifiers, drain);
    const gain = after.ore + after.polymers + after.plasma - beforeRate;
    if (gain <= 0) continue;
    ranked.push({ type, payback: costUnits(upgradeCost(type, levels[type] + 1)) / gain });
  }
  ranked.sort((a, b) => a.payback - b.payback);
  for (const entry of ranked) want(entry.type);

  // Хвост запасных вариантов: они дешевле целей выше и всегда осмысленны,
  // поэтому боту есть чем заняться, пока он копит на главное.
  want('ORE_STORAGE');
  want('POLYMER_STORAGE');
  want('PLASMA_STORAGE');
  want('SCIENCE_CENTER');
  want('SHIPYARD');
  want('POWER_PLANT');

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
    const quota = lead - index;
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
function laggingShip(
  ships: ShipCounts,
  mix: Partial<Record<ShipType, number>>,
  levels: BuildingLevels,
  techs: TechLevels,
  stock: ResourceAmounts,
  budget: { capacity: number; share: number },
): { ship: ShipType; count: number } | null {
  const purse = wallet(stock, budget.share);
  const totalValue = spentOnFleet(ships);
  let worst: ShipType | null = null;
  let worstGap = 0;

  for (const type of SHIP_TYPES) {
    const share = mix[type];
    if (!share) continue;
    if (missingShipRequirements(type, levels, techs).length > 0) continue;
    if (!canAfford(stock, budget.capacity, budget.share, shipCost(type))) continue;

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
      if (!canAfford(stock, budget.capacity, budget.share, shipCost(type))) continue;
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
  budget: { capacity: number; share: number },
): { defense: DefenseType; count: number } | null {
  const purse = wallet(stock, budget.share);
  const totalValue = spentOnDefense(defenses);
  let worst: DefenseType | null = null;
  let worstGap = 0;

  for (const type of DEFENSE_TYPES) {
    const share = mix[type];
    if (!share) continue;
    if (missingDefenseRequirements(type, levels, techs).length > 0) continue;
    if (!canAfford(stock, budget.capacity, budget.share, defenseCost(type))) continue;

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
      if (!canAfford(stock, budget.capacity, budget.share, defenseCost(type))) continue;
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
export function pickRaidTarget(
  targets: BotRaidTarget[],
  ownFleetValue: number,
  character: BotCharacter,
  override?: BotPersonality,
): BotRaidTarget | null {
  const profile = override ?? personality(character);
  if (!profile.raids) return null;

  const reachable = targets
    .filter((target) => target.accountAgeDays >= NEWBIE_SHIELD_DAYS)
    .filter((target) => target.knownStrength !== null)
    .filter((target) => ownFleetValue >= (target.knownStrength ?? 0) * profile.raidAdvantage);

  if (reachable.length === 0) return null;

  // Из подходящих — ближайшая: дорога тоже стоит топлива и времени.
  return reachable.reduce((best, target) => (target.distance < best.distance ? target : best));
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
  const profile = override ?? personality(snapshot.character);
  const intents: BotIntent[] = [];
  if (snapshot.bases.length === 0) return intents;

  const capital = snapshot.bases[0]!;
  const held = portfolio(snapshot);
  /** Добрало ли направление свою долю портфеля. */
  const saturated = (direction: Direction): boolean =>
    held.total > 0 && held[direction] >= held.total * profile.budget[direction];

  /* --- Наука: одна на командира, поэтому считается от столицы --- */
  if (!snapshot.researching) {
    const purse = wallet(capital.resources, profile.budget.research);
    const tech = nextResearch(snapshot.techs, capital.levels, snapshot.character, purse, profile);
    if (tech) {
      intents.push({
        kind: 'RESEARCH',
        baseId: capital.id,
        tech,
        why: `по плану характера «${profile.label}»`,
      });
    }
  }

  for (const base of snapshot.bases) {
    const stock = base.resources;
    const capacity = storageCapacity(base.levels);

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
    const share = (direction: Direction) => (pressure ? 1 : profile.budget[direction]);

    /* --- Стройка --- */
    if (!base.building) {
      const plan = buildingPlan(base, snapshot.techs, snapshot.character, profile);

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
        if (blocked.has(type)) return hasEnoughResources(stock, cost);
        return canAfford(stock, capacity, share('economy'), cost);
      };

      /*
       * Обычно бот копит на самое желанное и не разменивается. Но под давлением
       * склада копить некуда: добыча упирается в потолок, и следующая единица
       * ресурсов не появится никогда. Тогда бот идет по плану до первого
       * посильного — иначе цель дороже склада заморозила бы базу навсегда.
       */
      const building = pressure ? plan.find(affordable) : plan[0] && affordable(plan[0]) ? plan[0] : undefined;

      if (building) {
        intents.push({
          kind: 'BUILD',
          baseId: base.id,
          building,
          why: pressure ? 'склад полон, копить некуда' : 'развитие базы',
        });
      }
    }

    /* --- Верфь --- */
    if (base.shipQueue < 3 && base.levels.SHIPYARD > 0 && !saturated('fleet')) {
      const order = laggingShip(base.ships, profile.fleetMix, base.levels, snapshot.techs, stock, {
        capacity,
        share: share('fleet'),
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
    if (base.defenseQueue < 3 && base.levels.SHIPYARD > 0 && !saturated('defense')) {
      const order = laggingDefense(base.defenses, profile.defenseMix, base.levels, snapshot.techs, stock, {
        capacity,
        share: share('defense'),
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
  const ownFleet = snapshot.bases.reduce((sum, base) => sum + spentOnFleet(base.ships), 0);
  const target = pickRaidTarget(snapshot.raidTargets, ownFleet, snapshot.character, profile);
  if (target) {
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
    // Трюмы под добычу: без грузовиков трофеи придется бросить на месте.
    strike.LARGE_CARGO = Math.floor(striker.ships.LARGE_CARGO / 2);

    if (spentOnFleet(strike) > 0) {
      intents.push({
        kind: 'RAID',
        baseId: striker.id,
        planetId: target.planetId,
        ships: strike,
        why: 'цель разведана и слабее эскадры',
      });
    }
  } else if (profile.raids) {
    // Целей нет, потому что никто не разведан — бот отправляет зонд.
    // Разведка ему нужна не меньше флота: без нее он летал бы вслепую.
    const blind = snapshot.raidTargets.find(
      (candidate) => candidate.knownStrength === null && candidate.accountAgeDays >= NEWBIE_SHIELD_DAYS,
    );
    const scout = snapshot.bases.find((base) => base.ships.PROBE > 0);
    if (blind && scout) {
      intents.push({
        kind: 'SCAN',
        baseId: scout.id,
        planetId: blind.planetId,
        why: 'цель не разведана',
      });
    }
  }

  /* --- Биржа --- */
  if (profile.trade.active) {
    intents.push(...tradeIntents(snapshot, capital, profile));
  }

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
function tradeIntents(
  snapshot: BotSnapshot,
  capital: BotBaseSnapshot,
  profile: BotPersonality,
): BotIntent[] {
  const intents: BotIntent[] = [];
  const capacity = storageCapacity(capital.levels);
  const stock = capital.resources;

  /** Заявка этой стороны по этому ресурсу уже стоит в стакане. */
  const standing = (side: 'BUY' | 'SELL', resource: 'ORE' | 'POLYMERS'): boolean =>
    snapshot.openOrders.some((order) => order.side === side && order.resource === resource);

  for (const ref of snapshot.market) {
    if (ref.reference <= 0) continue;
    const held = ref.resource === 'ORE' ? stock.ore : stock.polymers;

    // Продаем то, чего накопилось больше половины склада: это уже излишек,
    // и он рискует упереться в потолок и остановить добычу.
    const surplus = held - capacity * 0.5;
    if (surplus > 0 && !standing('SELL', ref.resource)) {
      const amount = Math.floor(surplus * profile.trade.sellShare);
      if (amount > 0) {
        intents.push({
          kind: 'ORDER',
          side: 'SELL',
          resource: ref.resource,
          amount,
          price: Math.round(ref.reference * (1 + profile.trade.margin)),
          why: 'излишек сверх половины склада',
        });
      }
    }

    // Покупаем на криптогривну то, чего меньше четверти склада, — но только
    // в пределах трети баланса, чтобы один ордер не выгреб всю кассу.
    if (held < capacity * 0.25 && snapshot.credits > 0 && !standing('BUY', ref.resource)) {
      const price = Math.round(ref.reference * (1 - profile.trade.margin));
      const amount = Math.floor(Math.min(snapshot.credits / 3 / Math.max(price, 1), capacity * 0.25));
      if (amount > 0 && price > 0) {
        intents.push({
          kind: 'ORDER',
          side: 'BUY',
          resource: ref.resource,
          amount,
          price,
          why: 'запас ниже четверти склада',
        });
      }
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
    freePlanets: [],
    raidTargets: [],
    market: [],
    openOrders: [],
    colonizing: false,
  };
}

/** Заготовка базы для тестов: столица первого уровня без очередей. */
export function testBase(id: string, overrides: Partial<BotBaseSnapshot> = {}): BotBaseSnapshot {
  return {
    id,
    planetId: `${id}-planet`,
    systemId: `${id}-system`,
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
