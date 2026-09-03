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
  type StoredResource,
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
import { fleetCapacity } from '../fleets.js';
import { storageUpgradeCost } from '../market.js';
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
  /** Рыночная цена: средневзвешенная по последним сделкам между игроками. */
  reference: number;
  /** Сделок еще не было — цена взята из затравки и рынком не подтверждена. */
  seeded: boolean;
  /** Сколько единиц хотят купить и сколько продать: весь стакан по сторонам. */
  demand: number;
  supply: number;
  /** Перекос спроса от -1 (одни продавцы) до +1 (одни покупатели). */
  skew: number | null;
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
  ore: number;
  polymers: number;
  distance: number;
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
  /** Поля обломков поблизости — цель для переработчика. */
  debrisFields: BotDebrisField[];
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
  };
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
  /** Исполнить чужую заявку — сделка происходит сразу, а не когда-нибудь. */
  | { kind: 'TAKE'; orderId: string; amount: number; why: string }
  /** Снять собственную заявку: она больше не отвечает намерениям бота. */
  | { kind: 'DROP'; orderId: string; why: string }
  /** Забрать товар с хаба домой: строят из того, что лежит на базе. */
  | { kind: 'PICKUP'; baseId: string; ore: number; polymers: number; why: string }
  /** Расширить склад на хабе — платится криптогривной. */
  | { kind: 'HUB_UPGRADE'; why: string }
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

/** Требует ли покупка ресурс, отложенный под стройку. */
function needsReserved(cost: ResourceAmounts, reserved: Set<StoredResource>): boolean {
  return STORED_RESOURCES.some((resource) => reserved.has(resource) && cost[resource] > 0);
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

  // Просевшая энергия режет добычу на всех шахтах разом, поэтому станция
  // важнее любого следующего уровня шахты.
  if (energyEfficiency(levels, base.richness, bonuses, 0, drain) < 0.95) want('POWER_PLANT');

  if (levels.SCIENCE_CENTER === 0) want('SCIENCE_CENTER');
  if (levels.SHIPYARD === 0) want('SHIPYARD');

  /*
   * Крипто-ферма: когда добывать больше уже некуда.
   *
   * На единицу энергии ферма дает около двух третей того, что дает шахта
   * с продажей станции, — то есть пока добытое доезжает до хаба, шахта лучше
   * всегда. Проверка живым ботом показала, где это перестает быть верным:
   * Крамар при шахтах седьмого уровня добывал 23 800 полимеров в час
   * при вместимости склада около сорока тысяч, то есть забивал его за два
   * часа, а вывозил двадцатью пятью малыми грузовиками с рейсом в обе стороны.
   * Все, что не влезло, срезалось потолком и не стоило ничего. Две трети
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
  budget: { capacity: number; share: number; reserved: Set<StoredResource> },
): { ship: ShipType; count: number } | null {
  const purse = wallet(stock, budget.share);
  const totalValue = spentOnFleet(ships);
  let worst: ShipType | null = null;
  let worstGap = 0;

  for (const type of SHIP_TYPES) {
    const share = mix[type];
    if (!share) continue;
    if (missingShipRequirements(type, levels, techs).length > 0) continue;
    if (needsReserved(shipCost(type), budget.reserved)) continue;
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
  budget: { capacity: number; share: number; reserved: Set<StoredResource> },
): { defense: DefenseType; count: number } | null {
  const purse = wallet(stock, budget.share);
  const totalValue = spentOnDefense(defenses);
  let worst: DefenseType | null = null;
  let worstGap = 0;

  for (const type of DEFENSE_TYPES) {
    const share = mix[type];
    if (!share) continue;
    if (missingDefenseRequirements(type, levels, techs).length > 0) continue;
    if (needsReserved(defenseCost(type), budget.reserved)) continue;
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

  /*
   * Чего боту не хватает на его же ближайшие цели.
   *
   * Это то, ради чего он идет на рынок. Ситуация обычная: полимеров вдоволь,
   * а целевое здание требует руды, и добыть ее быстрее нельзя — шахта уже
   * стоит. Продать избыток и купить недостающее — единственный способ
   * не встать на месте, и именно это отличает торговлю от накопительства.
   */
  const shortfall = new Set<StoredResource>();

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
    } else {
      /*
       * Технология не выбрана — либо ворота закрыты, либо не хватает ресурсов.
       * Второе рынок лечит, первое нет, поэтому ищем первую ветку, которой
       * мешают именно ресурсы, и записываем недостающее.
       */
      for (const candidate of profile.researchOrder) {
        if (missingTechRequirements(candidate, capital.levels, snapshot.techs).length > 0) continue;
        const cost = researchCost(candidate, snapshot.techs[candidate] + 1);
        for (const resource of STORED_RESOURCES) {
          if (cost[resource] > capital.resources[resource]) shortfall.add(resource);
        }
        break;
      }
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

    /** Ресурсы, которые база копит на постройку и потому не тратит на флот. */
    const reserved = new Set<StoredResource>();
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
      /*
       * Копим на первый пункт и не разменивается на дешевое — это проверено
       * замером, а не принято на веру. Прогон месяца с правилом «строй первое
       * посильное» дал «Перун» на 34-е сутки против 12-х: бот расползался
       * по дешевым шахтам вместо того, чтобы дойти до ворот контента.
       */
      let building = pressure ? plan.find(affordable) : plan[0] && affordable(plan[0]) ? plan[0] : undefined;

      /*
       * Денег нет, а без них не обойтись — значит первым делом ферма.
       *
       * Криптогривна берется единственным способом: с крипто-фермы. Станция
       * ничего не покупает, все сделки между игроками — переводы, и бот
       * без денег не купит недостающее ни за какую цену. При этом в общем
       * плане ферма стоит последней из десяти, а слот стройки на базе один, —
       * то есть до нее не доходит очередь никогда. Проверено на живых ботах:
       * у всех троих ферма нулевого уровня при шахтах до седьмого.
       *
       * Порог — цена того, чего не хватает, по нынешнему рынку. Это не догадка
       * о «достаточной» сумме, а ровно тот вопрос, который решается покупкой:
       * хватит ли денег закрыть дефицит, если купить его прямо сейчас.
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
        if (
          needed > 0 &&
          snapshot.credits < needed &&
          missingBuildingRequirements('CRYPTO_FARM', base.levels).length === 0 &&
          affordable('CRYPTO_FARM')
        ) {
          building = 'CRYPTO_FARM';
        }
      }

      if (building) {
        intents.push({
          kind: 'BUILD',
          baseId: base.id,
          building,
          why:
            building === 'CRYPTO_FARM' && plan[0] !== 'CRYPTO_FARM'
              ? 'на покупку недостающего не хватает криптогривны'
              : pressure
                ? 'склад полон, копить некуда'
                : 'развитие базы',
        });
      } else if (plan[0]) {
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
        const cost = upgradeCost(plan[0], base.levels[plan[0]] + 1);
        for (const resource of STORED_RESOURCES) {
          if (cost[resource] > 0 && stock[resource] < cost[resource]) {
            reserved.add(resource);
            // То же самое, но на весь снимок: за недостающим бот пойдет на рынок.
            shortfall.add(resource);
          }
        }
      }
    }

    /* --- Верфь --- */
    if (base.shipQueue < 3 && base.levels.SHIPYARD > 0 && !saturated('fleet')) {
      const order = laggingShip(base.ships, profile.fleetMix, base.levels, snapshot.techs, stock, {
        capacity,
        share: share('fleet'),
        reserved,
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
        reserved,
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
    intents.push(...tradeIntents(snapshot, profile, shortfall));
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
  if (
    hubCapacity > 0 &&
    hubTotal >= hubCapacity * 0.8 &&
    liquid &&
    snapshot.credits >= snapshot.hubStorage.upgradeCost
  ) {
    intents.push({ kind: 'HUB_UPGRADE', why: 'склад на хабе забит ходовым товаром' });
  }

  /*
   * Везем недостающее домой.
   *
   * Купленное на бирже лежит на хабе, а строят из того, что на базе, — без
   * этого рейса покупка не превращается ни во что. Забираем только то, чего
   * не хватает на цель: везти домой излишек, который сами же и привезли
   * продавать, значит гонять флот по кругу.
   */
  const homeward = snapshot.bases[0];
  if (homeward) {
    const hold = fleetCapacity({
      ...emptyShipCounts(),
      LARGE_CARGO: homeward.ships.LARGE_CARGO,
      SMALL_CARGO: homeward.ships.SMALL_CARGO,
    });
    let ore = shortfall.has('ore') ? Math.floor(snapshot.hubStorage.ore) : 0;
    let polymers = shortfall.has('polymers') ? Math.floor(snapshot.hubStorage.polymers) : 0;
    if (ore + polymers > hold) {
      const scale = hold / (ore + polymers);
      ore = Math.floor(ore * scale);
      polymers = Math.floor(polymers * scale);
    }
    // Мелочь рейса не стоит: транспорт уйдет надолго, а привезет ничто.
    if (hold > 0 && ore + polymers >= 100) {
      intents.push({
        kind: 'PICKUP',
        baseId: homeward.id,
        ore,
        polymers,
        why: 'недостающее лежит на хабе, а строят из того, что на базе',
      });
    }
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
   * между ними нет. Их контрагент — станция, и это правильно: она для того
   * и стоит.
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

  /* --- Берем чужое --- */

  // Дешевле всех — первым: если денег хватит не на все, тратим их с толком.
  const cheapest = foreign
    .filter((order) => order.side === 'SELL' && !selling(order.resource) && order.price <= buyCeiling(order.resource))
    .sort((a, b) => a.price - b.price);

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
    if (!selling(ref.resource) && snapshot.credits > 0 && hub.free > 0 && !standing('BUY', ref.resource)) {
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
    debrisFields: [],
    orderBook: [],
    hubStorage: { ore: 0, polymers: 0, free: 0, level: 1, upgradeCost: storageUpgradeCost(2) },
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
