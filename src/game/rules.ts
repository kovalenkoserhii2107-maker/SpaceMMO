/**
 * Игровые правила: добыча, энергия, стоимость и длительность построек.
 * Модуль чистый (без I/O) — все расчеты выполняются только на сервере.
 */

export const BUILDING_TYPES = [
  'ORE_MINE',
  'POLYMER_PLANT',
  'PLASMA_REACTOR',
  'POWER_PLANT',
  'SCIENCE_CENTER',
  'SHIPYARD',
  'ANTIMATTER_FACTORY',
  'ORE_STORAGE',
  'POLYMER_STORAGE',
  'PLASMA_STORAGE',
  'CRYPTO_FARM',
] as const;

export type BuildingType = (typeof BUILDING_TYPES)[number];

/** Постройки, которые дают ресурсы. */
type MineType = 'ORE_MINE' | 'POLYMER_PLANT' | 'PLASMA_REACTOR' | 'ANTIMATTER_FACTORY';

export function isBuildingType(value: unknown): value is BuildingType {
  return typeof value === 'string' && (BUILDING_TYPES as readonly string[]).includes(value);
}

export interface ResourceAmounts {
  ore: number;
  polymers: number;
  plasma: number;
}

/**
 * Склад базы. Антиматерия хранится отдельно от базовой тройки: она не возится
 * в трюмах, не торгуется на бирже и нужна только как топливо гиперпрыжков.
 */
export interface BaseStock extends ResourceAmounts {
  antimatter: number;
}

export type BuildingLevels = Record<BuildingType, number>;

/** Коэффициенты богатства планеты — множители добычи. */
export interface PlanetRichness {
  ore: number;
  polymers: number;
  plasma: number;
  energy: number;
  antimatter: number;
}

/**
 * Модификаторы системы. У черной дыры «Искажение времени»:
 * синтез антиматерии идет быстрее, а стройка и исследования — медленнее.
 */
export interface SystemModifiers {
  antimatterMultiplier: number;
  buildTimeMultiplier: number;
  researchTimeMultiplier: number;
}

export const NEUTRAL_MODIFIERS: SystemModifiers = {
  antimatterMultiplier: 1,
  buildTimeMultiplier: 1,
  researchTimeMultiplier: 1,
};

/** Эффект «Искажение времени» в системе с черной дырой. */
export const BLACK_HOLE_MODIFIERS: SystemModifiers = {
  antimatterMultiplier: 1.5,
  buildTimeMultiplier: 1.3,
  researchTimeMultiplier: 1.3,
};

export function systemModifiers(anomaly: string | null | undefined): SystemModifiers {
  return anomaly === 'BLACK_HOLE' ? BLACK_HOLE_MODIFIERS : NEUTRAL_MODIFIERS;
}

/** Бонусы от изученных технологий, влияющие на экономику базы. */
export interface EconomyBonuses {
  /** Множитель добычи от «Горного дела». */
  mining: number;
  /** Множитель выработки энергии от «Энергетики». */
  energy: number;
}

const NEUTRAL_BONUSES: EconomyBonuses = { mining: 1, energy: 1 };

/** Базовая выработка энергии колониального реактора — доступна без построек. */
const BASE_ENERGY_OUTPUT = 20;

/** Базовая добыча ресурсов в секунду на 1 уровне при коэффициенте 1.0. */
/*
 * Базовая добыча. Полимеры и плазма подняты относительно руды: доли в ценах
 * построек у них выше, чем были доли в доходе, и ранний игрок упирался
 * не в общий объем добычи, а в перекос между ресурсами.
 */
const BASE_YIELD_PER_SECOND: Record<MineType, number> = {
  ORE_MINE: 0.8,
  POLYMER_PLANT: 0.58,
  PLASMA_REACTOR: 0.36,
  // Антиматерия синтезируется на порядки медленнее: это топливо для прыжков,
  // а не сырье для стройки.
  ANTIMATTER_FACTORY: 0.02,
};

/** Базовые стоимости постройки 1 уровня и множитель роста цены. */
/*
 * Стоимость уровней.
 *
 * Множитель шахт 1.6 против прежних 1.5: при 1.5 следующий уровень стоил
 * меньше часа добычи вплоть до шестнадцатого, и весь ранний и средний этап
 * пролетал за вечер. Базовые цены подняты вчетверо по той же причине —
 * растягивают именно первые уровни, где прогресс был почти бесплатным.
 *
 * Верфь и лаборатория дороже остальных (2.3): это ворота контента, и их
 * уровень должен быть достижением, а не побочным следствием добычи.
 */
const COSTS: Record<BuildingType, ResourceAmounts & { factor: number }> = {
  ORE_MINE: { ore: 140, polymers: 66, plasma: 0, factor: 1.65 },
  POLYMER_PLANT: { ore: 112, polymers: 105, plasma: 0, factor: 1.65 },
  /*
   * Плазменный реактор. Цена срезана вдвое по замеру, а не на глаз.
   *
   * При 380/130 окупаемость реактора была в пять-шесть раз хуже рудной шахты
   * на каждом уровне: 0.77 против 0.12 на втором, 7.7 против 1.2 на восьмом.
   * Плазма при этом составляет 14% всех затрат в каталоге — спрос ниже, чем
   * на руду, но не вшестеро. Любой считающий окупаемость игрок не строил
   * реактор вовсе, пока плазма не кончалась, и тогда строил в панике.
   * Бот, который считает честно, показал это за шесть часов: реактор второго
   * уровня при шахтах седьмого и девяносто семь единиц плазмы на складе.
   */
  PLASMA_REACTOR: { ore: 190, polymers: 125, plasma: 0, factor: 1.65 },
  POWER_PLANT: { ore: 175, polymers: 135, plasma: 0, factor: 1.65 },
  // Первые уровни верфи и лаборатории намеренно дешевы: это обучающие
  // постройки, и упереться в них в первый час игрок не должен. Крутизну
  // задает множитель — к десятому уровню они стоят миллионы.
  /*
   * Плазмы в первых уровнях верфи и лаборатории нет вовсе, а полимеров
   * вдвое меньше прежнего. Раньше лаборатория стоила 700 полимеров при доходе
   * под две тысячи в час — двенадцать минут простоя на одной постройке,
   * и это в первые полчаса игры.
   */
  SCIENCE_CENTER: { ore: 260, polymers: 720, plasma: 0, factor: 2.3 },
  SHIPYARD: { ore: 320, polymers: 305, plasma: 0, factor: 2.3 },
  ANTIMATTER_FACTORY: { ore: 6000, polymers: 8550, plasma: 2400, factor: 2.3 },
  /*
   * Склады разделены по ресурсам, и цена каждого — примерно треть прежней
   * общей. Суммарное вложение и суммарный объем остались как были: три склада
   * первого уровня стоят столько же и вмещают столько же, сколько вмещал один.
   * Изменилось другое — обильный ресурс больше не отнимает место у дефицитного.
   */
  /*
   * Множитель цены складов равен росту вместимости (1.5), а не общему 1.65.
   *
   * Это делает цену тонны постоянной: каждый уровень дает в полтора раза
   * больше места и стоит в полтора раза дороже. При 1.65 тонна дорожала
   * с каждым уровнем, и после разделения складов на три линии это ударило
   * втройне — прогон месяца показал колонизацию на 24-е сутки вместо вторых
   * и незакрытый лейтгейм: три склада уходили в пятнадцатый уровень и съедали
   * все, что должно было идти в верфь и науку.
   */
  /*
   * Ферма майнинга. Дорогая и прожорливая нарочно: это единственная постройка,
   * которая производит деньги, и она должна конкурировать с шахтами
   * за те же ресурсы и ту же энергию, а не быть бесплатной прибавкой.
   */
  CRYPTO_FARM: { ore: 900, polymers: 1330, plasma: 200, factor: 1.7 },
  ORE_STORAGE: { ore: 240, polymers: 230, plasma: 0, factor: 1.5 },
  POLYMER_STORAGE: { ore: 240, polymers: 230, plasma: 0, factor: 1.5 },
  PLASMA_STORAGE: { ore: 240, polymers: 230, plasma: 0, factor: 1.5 },
};

/** Потребление энергии постройками. Солнечная станция энергию не тратит. */
const ENERGY_DRAIN: Record<BuildingType, number> = {
  ORE_MINE: 1.0,
  POLYMER_PLANT: 1.0,
  PLASMA_REACTOR: 1.4,
  POWER_PLANT: 0,
  SCIENCE_CENTER: 1.2,
  SHIPYARD: 1.5,
  // Фабрика антиматерии — самый прожорливый объект базы.
  ANTIMATTER_FACTORY: 8,
  // Вычисления жрут электричество больше всего на базе, кроме антиматерии.
  CRYPTO_FARM: 4,
  // Климат-контроль ангаров: хранилище почти не ест энергию.
  // Складов теперь три, поэтому расход каждого втрое меньше прежнего.
  ORE_STORAGE: 0.1,
  POLYMER_STORAGE: 0.1,
  PLASMA_STORAGE: 0.1,
};

/**
 * Добыча криптогривны фермой майнинга.
 *
 * Ровно та же форма, что у шахт: уровень на экспоненту, богатство планеты
 * ни при чем — вычисления от недр не зависят. Криптоинженерия множит отдачу
 * так же, как горное дело множит руду.
 *
 * Это единственный источник денег на самой базе. Без него денежная масса
 * росла бы только через продажи станции, то есть зависела бы от того, много ли
 * игрок торгует, а не от того, насколько развита его колония.
 */
/*
 * Базовая отдача подобрана замером, а не на глаз.
 *
 * Ферма конкурирует с шахтой за одну и ту же энергию, поэтому и мерить надо
 * тем же: сколько ценности дает единица энергии. Шахта дает около двух тысяч
 * единиц руды в час на единицу энергии; ферма при первой прикидке давала
 * сорок пять в эквиваленте по цене станции — разница в пятьдесят раз, то есть
 * ферму не построил бы никто и никогда.
 *
 * Базовая отдача срезана с двенадцати до девяти вместе с введением платы
 * за место на хабе: два рычага против одной беды — денежная масса на живом
 * стенде удваивалась за девять часов, и цена руды шла за ней с 5 до 19.
 * Отдача снижена с девяти до шести вместе с подъемом платы за хаб: это один
 * рычаг, разведенный на две константы, и крутить их порознь бессмысленно.
 * Замер на живом стенде показал, что при девяти семь ферм печатали ₴2.12 млн
 * в час против ₴718 тыс. стока — кран обгонял сток втрое, и все деньги мира
 * стекались к одному боту. Прогон недели при шести и ставке 4.5%: масса
 * ₴24.6 млн против ₴54.9 млн, ₴0.48 на единицу товара против ₴1.09, сделок
 * 13 738 против 6 427 — вдвое больше, — а средняя верфь даже подросла
 * с 6.0 до 6.1. Фермы при этом доходят до десятого уровня, кран не пересушен.
 *
 * Целимся не в паритет, а в заметную долю от шахты с продажей на бирже.
 * Ферма дает меньше, но не требует ни рейсов на хаб, ни места на складе,
 * ни удачи на рынке: это выбор между деньгами сразу и сырьем с логистикой,
 * а не бесплатная прибавка.
 *
 * Равновесие держится само и без коридора: отдача фермы задана в гривне,
 * а ценность шахты — в товаре по рыночной цене. Дешевеет товар — ферма
 * выгоднее; дорожает — выгоднее шахта. Но работает это только при живом
 * стоке денег: без него масса растет, цены идут за ней, и весы ломаются.
 * Сток — комиссия биржи и плата за место на хабе (см. `hubRent`).
 */
const CREDIT_BASE_PER_SECOND = 6;

/*
 * Показатель тот же, что у шахт, — 1.07, а не 1.1.
 *
 * Ферма конкурирует с шахтой за одну и ту же энергию, значит и расти должна
 * с той же крутизной: при 1.1 она обгоняла шахту с каждым уровнем, и разрыв
 * копился. На шестом уровне это еще 15% разницы, на пятнадцатом — уже
 * в полтора раза.
 *
 * Замерено на живом стенде: за ночь фермы у семи ботов дошли до 4–6 уровня
 * и стали печатать ₴2.1 млн в час, денежная масса удвоилась за девять часов
 * с ₴20.6 до ₴39 млн, а цена руды выросла с 5 до 19. Товара при этом
 * не прибавилось — выросли только цены.
 */
export function creditOutput(levels: BuildingLevels, cryptoBonus = 1): number {
  const level = levels.CRYPTO_FARM;
  if (level <= 0) return 0;
  return CREDIT_BASE_PER_SECOND * level * Math.pow(1.07, level) * cryptoBonus;
}

/** Требования к уровню других построек. */
const BUILDING_REQUIREMENTS: Partial<Record<BuildingType, Partial<Record<BuildingType, number>>>> = {
  SHIPYARD: { ORE_MINE: 2 },
  SCIENCE_CENTER: { ORE_MINE: 2 },
  // Ферма требует вычислительной базы и электричества под нее.
  CRYPTO_FARM: { SCIENCE_CENTER: 2, POWER_PLANT: 3 },
  ANTIMATTER_FACTORY: { SCIENCE_CENTER: 3, POWER_PLANT: 5 },
};

export const BUILDING_LABELS: Record<BuildingType, string> = {
  ORE_MINE: 'Рудная шахта',
  POLYMER_PLANT: 'Полимерный завод',
  PLASMA_REACTOR: 'Плазменный реактор',
  POWER_PLANT: 'Энергетическая станция',
  SCIENCE_CENTER: 'Научный центр',
  SHIPYARD: 'Верфь',
  ANTIMATTER_FACTORY: 'Фабрика антиматерии',
  CRYPTO_FARM: 'Крипто-ферма',
  ORE_STORAGE: 'Рудный склад',
  POLYMER_STORAGE: 'Склад полимеров',
  PLASMA_STORAGE: 'Плазмохранилище',
};

/**
 * Описания построек: одна фраза о том, зачем здание нужно.
 *
 * Живут рядом с правилами, а не в клиенте, по той же причине, что и названия:
 * клиент рисует то, что ему прислали, и не должен знать игру.
 */
export const BUILDING_DESCRIPTIONS: Record<BuildingType, string> = {
  ORE_MINE: 'Открытая разработка породы. Руда — основа всего: корпуса, стены, орбитальные доки.',
  POLYMER_PLANT:
    'Синтез длинных цепей из планетарной органики. Полимеры идут на обшивку, оптику и электронику.',
  PLASMA_REACTOR:
    'Удержание горячей плазмы в магнитной ловушке. Топливо внутрисистемных двигателей и сырье для тяжелых сплавов.',
  POWER_PLANT:
    'Питает всю колонию. Когда мощности не хватает, шахты работают вполсилы — и падает добыча всех ресурсов сразу.',
  SCIENCE_CENTER: 'Лаборатории и вычислительные кластеры. Каждый уровень ускоряет исследования.',
  SHIPYARD: 'Орбитальные стапели. Каждый уровень ускоряет сборку кораблей и оборонных установок.',
  ANTIMATTER_FACTORY:
    'Ловушки для антивещества. Самый прожорливый объект колонии, но без антиматерии нет гиперпрыжков.',
  CRYPTO_FARM:
    'Вычислительные стойки, намывающие криптогривну. Единственный источник денег на самой базе — и самый прожорливый по энергии после фабрики антиматерии.',
  ORE_STORAGE: 'Отвалы и бункеры под породу. Держат лимит руды и прячут часть запаса от грабежа.',
  POLYMER_STORAGE:
    'Климатические ангары. Держат лимит полимеров и прячут часть запаса от грабежа.',
  PLASMA_STORAGE:
    'Криогенные резервуары. Держат лимит плазмы и прячут часть запаса от грабежа.',
};

/**
 * Потребление энергии одной постройкой на заданном уровне.
 *
 * Вынесено наружу, потому что интерфейс показывает расход по каждому зданию
 * отдельно: суммарного числа мало, чтобы понять, кто именно съел мощность.
 */
export function buildingEnergyUsage(type: BuildingType, level: number): number {
  return drain(ENERGY_DRAIN[type], level);
}

export function emptyLevels(): BuildingLevels {
  return {
    ORE_MINE: 0,
    POLYMER_PLANT: 0,
    PLASMA_REACTOR: 0,
    POWER_PLANT: 0,
    SCIENCE_CENTER: 0,
    SHIPYARD: 0,
    ANTIMATTER_FACTORY: 0,
    CRYPTO_FARM: 0,
    ORE_STORAGE: 0,
    POLYMER_STORAGE: 0,
    PLASMA_STORAGE: 0,
  };
}

/** Стоимость апгрейда до уровня targetLevel (>= 1). */
export function upgradeCost(type: BuildingType, targetLevel: number): ResourceAmounts {
  const cost = COSTS[type];
  const scale = Math.pow(cost.factor, targetLevel - 1);
  return {
    ore: Math.floor(cost.ore * scale),
    polymers: Math.floor(cost.polymers * scale),
    plasma: Math.floor(cost.plasma * scale),
  };
}

/**
 * Длительность стройки в секундах: зависит от суммарной стоимости уровня
 * и от модификаторов системы (в черной дыре время течет медленнее).
 */
/** Коэффициенты кривой времени постройки: минута на старте, сутки в конце. */
const BUILD_TIME_SCALE = 1.81;
const BUILD_TIME_EXPONENT = 0.64;

export function buildSeconds(
  type: BuildingType,
  targetLevel: number,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
  /**
   * Во сколько раз быстрее идет стройка: робототехника и «Сжатие времени».
   * Передается числом, а не уровнями технологий: `rules.ts` о дереве
   * технологий ничего не знает и знать не должен — оно импортирует правила,
   * и обратная зависимость замкнула бы модули в кольцо.
   */
  speedup = 1,
): number {
  const cost = upgradeCost(type, targetLevel);
  const total = cost.ore + cost.polymers + cost.plasma;
  /*
   * Степенной закон, а не доля цены. Цена растет множителем 1.6 за уровень,
   * и линейное `цена / 10` давало бы на двадцать втором уровне стройку
   * длиной в месяц. Показатель 0.64 подобран так, чтобы первые уровни
   * ставились за минуту-две, а поздние занимали часы и сутки.
   */
  const raw = BUILD_TIME_SCALE * Math.pow(total, BUILD_TIME_EXPONENT);
  return Math.max(5, Math.round((raw * modifiers.buildTimeMultiplier) / Math.max(1, speedup)));
}

/** Невыполненные требования по другим постройкам. */
export function missingBuildingRequirements(
  type: BuildingType,
  levels: BuildingLevels,
): Array<{ building: BuildingType; level: number }> {
  const requirements = BUILDING_REQUIREMENTS[type];
  if (!requirements) return [];

  const missing: Array<{ building: BuildingType; level: number }> = [];
  for (const [building, level] of Object.entries(requirements) as Array<[BuildingType, number]>) {
    if (levels[building] < level) missing.push({ building, level });
  }
  return missing;
}

/** Суммарная выработка энергии базы с учетом технологии «Энергетика». */
export function energyOutput(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
): number {
  const solar =
    levels.POWER_PLANT <= 0
      ? 0
      : 2 * levels.POWER_PLANT * Math.pow(1.1, levels.POWER_PLANT) * richness.energy;
  return (BASE_ENERGY_OUTPUT + solar) * bonuses.energy;
}

/**
 * Суммарное потребление энергии базой: постройки плюс стационарная оборона.
 * Расход обороны приходит числом, чтобы модуль правил не зависел от модуля обороны.
 */
export function energyUsage(
  levels: BuildingLevels,
  defenseDrain = 0,
  /** Расход сверх построек и обороны: «Сжатие времени» питается постоянно. */
  techDrain = 0,
): number {
  let total = Math.max(0, defenseDrain) + Math.max(0, techDrain);
  for (const type of BUILDING_TYPES) {
    total += drain(ENERGY_DRAIN[type], levels[type]);
  }
  return total;
}

function drain(base: number, level: number): number {
  if (level <= 0 || base <= 0) return 0;
  return base * level * Math.pow(1.1, level);
}

/**
 * Коэффициент эффективности базы: если энергии не хватает,
 * добыча всех шахт падает пропорционально дефициту.
 */
export function energyEfficiency(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
  defenseDrain = 0,
  techDrain = 0,
): number {
  const usage = energyUsage(levels, defenseDrain, techDrain);
  if (usage <= 0) return 1;
  const output = energyOutput(levels, richness, bonuses);
  return Math.min(1, output / usage);
}

/** Добыча в секунду с учетом богатства планеты, технологий и дефицита энергии. */
export function productionPerSecond(
  levels: BuildingLevels,
  richness: PlanetRichness,
  bonuses: EconomyBonuses = NEUTRAL_BONUSES,
  defenseDrain = 0,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
  /** Расход энергии сверх построек: «Сжатие времени» питается постоянно. */
  techDrain = 0,
): BaseStock {
  const efficiency = energyEfficiency(levels, richness, bonuses, defenseDrain, techDrain);
  return {
    ore: mineOutput('ORE_MINE', levels, richness.ore, bonuses) * efficiency,
    polymers: mineOutput('POLYMER_PLANT', levels, richness.polymers, bonuses) * efficiency,
    plasma: mineOutput('PLASMA_REACTOR', levels, richness.plasma, bonuses) * efficiency,
    antimatter:
      mineOutput('ANTIMATTER_FACTORY', levels, richness.antimatter, bonuses) *
      efficiency *
      modifiers.antimatterMultiplier,
  };
}

function mineOutput(
  type: MineType,
  levels: BuildingLevels,
  richness: number,
  bonuses: EconomyBonuses,
): number {
  const level = levels[type];
  if (level <= 0) return 0;
  // «Горное дело» ускоряет обычные шахты, но не синтез антиматерии.
  const techBonus = type === 'ANTIMATTER_FACTORY' ? 1 : bonuses.mining;
  /*
   * Показатель 1.07, а не 1.1. При 1.1 добыча обгоняла цену: расхождение
   * множителей 1.5 и 1.1 гасилось линейным ростом уровня, и кривая становилась
   * «идловой» только после двадцатого уровня — куда игрок приходил на второй день.
   */
  return BASE_YIELD_PER_SECOND[type] * level * Math.pow(1.07, level) * richness * techBonus;
}

/* ------------------------- Хранилище ------------------------- */

/**
 * Вместимость склада базы.
 *
 * Лимит общий на руду, полимеры и плазму: базы копят «тоннаж», а не три
 * независимых кучи. Антиматерия под лимит не попадает — она хранится в отдельных
 * магнитных ловушках и в трюмах не возится.
 *
 * Уровень 0 — колониальный резерв без постройки: небольшой запас, чтобы новая
 * колония успела отстроить первое хранилище. Дальше вместимость растет по
 * экспоненте: 10 000 → 15 000 → 22 500 → …
 */
/**
 * Колониальный резерв: место под ресурс, пока склад не построен.
 *
 * Две с половиной тысячи, а не треть прежних общих пяти: стартовый запас руды
 * — полторы тысячи, и при резерве в 1 700 новая колония открывалась с рудным
 * складом, забитым на 88%. Первое, что видел игрок, — предупреждение
 * о переполнении.
 */
export const BASE_STORAGE_CAPACITY = 2_500;
const STORAGE_LEVEL_ONE_CAPACITY = 3_500;
const STORAGE_GROWTH = 1.5;

/**
 * Доля вместимости, которую хранилище прячет от грабежа без технологий.
 *
 * Было 0.9, и это делало грабеж бессмысленным. Порог считается от вместимости,
 * а не от запаса, поэтому склад, заполненный меньше чем на девять десятых,
 * не отдавал вообще ничего: живой агрессор провел восемь набегов подряд,
 * выиграл все восемь и не унес ни единицы — у жертвы склады стояли
 * на 38%, 74% и 29%. А поскольку и бот, и разумный игрок расширяют склад
 * с запасом, заполненность выше девяноста процентов — редкость, и выходило,
 * что ограбить нельзя никого и никогда.
 *
 * Пятая часть оставляет неприкосновенным ровно тот запас, который жалко
 * потерять новичку, и не превращает склад в броню сам по себе. Дальше защита
 * покупается наукой, а не выдается даром.
 */
export const PROTECTED_STORAGE_SHARE = 0.2;

/**
 * Какую долю вместимости прячет хранилище с учетом «Бункерования».
 *
 * Правила о дереве технологий не знают и знать не должны — `techTree.ts`
 * импортирует правила, и обратная зависимость замкнула бы модули в кольцо
 * (та же причина, по которой ускорение стройки передается числом). Поэтому
 * сюда приходит уже посчитанная надбавка, а не уровень технологии.
 */
export function protectedShare(vaultBonus = 0): number {
  return PROTECTED_STORAGE_SHARE + Math.max(0, vaultBonus);
}

export function storageCapacityForLevel(level: number): number {
  if (!Number.isFinite(level) || level <= 0) return BASE_STORAGE_CAPACITY;
  return Math.floor(STORAGE_LEVEL_ONE_CAPACITY * Math.pow(STORAGE_GROWTH, level - 1));
}

/** Ресурсы, у которых есть свой склад. Антиматерия хранится вне лимитов. */
export const STORED_RESOURCES = ['ore', 'polymers', 'plasma'] as const;
export type StoredResource = (typeof STORED_RESOURCES)[number];

/** Какой склад держит какой ресурс. */
export const STORAGE_FOR: Record<StoredResource, BuildingType> = {
  ore: 'ORE_STORAGE',
  polymers: 'POLYMER_STORAGE',
  plasma: 'PLASMA_STORAGE',
};

/** Какая шахта добывает ресурс: обратная сторона `STORAGE_FOR`. */
export const MINE_FOR: Record<StoredResource, BuildingType> = {
  ore: 'ORE_MINE',
  polymers: 'POLYMER_PLANT',
  plasma: 'PLASMA_REACTOR',
};

export type StorageCapacities = Record<StoredResource, number>;

/**
 * Вместимость по каждому ресурсу отдельно.
 *
 * Общий лимит на три ресурса создавал тупик без выхода: обильный ресурс
 * вытеснял дефицитный, на полном складе добыча вставала сразу по всем трем,
 * и дефицитный уже не мог появиться никогда — а все постройки требовали
 * именно его. Раздельные лимиты убирают саму возможность такого состояния.
 */
export function storageCapacities(levels: BuildingLevels): StorageCapacities {
  return {
    ore: storageCapacityForLevel(levels.ORE_STORAGE),
    polymers: storageCapacityForLevel(levels.POLYMER_STORAGE),
    plasma: storageCapacityForLevel(levels.PLASMA_STORAGE),
  };
}

/** Суммарная вместимость всех трех складов — для сводок и оценок. */
export function storageCapacity(levels: BuildingLevels): number {
  const caps = storageCapacities(levels);
  return caps.ore + caps.polymers + caps.plasma;
}

/** Сколько «тоннажа» занято: антиматерия в лимит не входит. */
export function storedTotal(stock: ResourceAmounts): number {
  return Math.max(0, stock.ore) + Math.max(0, stock.polymers) + Math.max(0, stock.plasma);
}

/** Состояние одного склада. */
export interface ResourceStorageState {
  capacity: number;
  used: number;
  free: number;
  /** Заполненность 0..1; больше 1, если склад успели переполнить извне. */
  fill: number;
  /** Добыча этого ресурса остановлена: свободного места не осталось. */
  full: boolean;
  /** Несгораемый объем — его грабеж не достает. */
  protectedAmount: number;
  /** Излишек сверх несгораемого объема: именно он уязвим при поражении. */
  vulnerable: number;
}

export interface StorageState extends Record<StoredResource, ResourceStorageState> {
  /** Суммарные числа — для сводок, рейтинга и коротких строк интерфейса. */
  capacity: number;
  used: number;
  /** Хотя бы один склад полон: добыча этого ресурса встала. */
  anyFull: boolean;
}

/**
 * Состояние склада для интерфейса и для расчета грабежа.
 *
 * Переполнение — штатная ситуация: добыча в потолок упирается, но флот с добычей,
 * возврат залога с биржи или трофеи экспедиции могут занести ресурсы сверх лимита.
 * Такой излишек не исчезает, но и не защищен.
 */
function oneStorage(used: number, capacity: number, vaultBonus: number): ResourceStorageState {
  const held = Math.max(0, used);
  const protectedAmount = Math.min(held, capacity * protectedShare(vaultBonus));

  return {
    capacity,
    used: held,
    free: Math.max(0, capacity - held),
    fill: capacity > 0 ? held / capacity : 1,
    full: held >= capacity,
    protectedAmount,
    vulnerable: Math.max(0, held - protectedAmount),
  };
}

export function storageState(
  stock: ResourceAmounts,
  capacities: StorageCapacities,
  /** Надбавка «Бункерования» к несгораемой доле: приходит числом, не уровнем. */
  vaultBonus = 0,
): StorageState {
  const ore = oneStorage(stock.ore, capacities.ore, vaultBonus);
  const polymers = oneStorage(stock.polymers, capacities.polymers, vaultBonus);
  const plasma = oneStorage(stock.plasma, capacities.plasma, vaultBonus);

  return {
    ore,
    polymers,
    plasma,
    capacity: capacities.ore + capacities.polymers + capacities.plasma,
    used: ore.used + polymers.used + plasma.used,
    anyFull: ore.full || polymers.full || plasma.full,
  };
}

export function hasEnoughResources(stock: ResourceAmounts, cost: ResourceAmounts): boolean {
  return stock.ore >= cost.ore && stock.polymers >= cost.polymers && stock.plasma >= cost.plasma;
}

/**
 * Возврат ресурсов на склад с учетом потолка.
 *
 * Отмена возвращает то, что было списано, но склад за это время мог
 * наполниться: добыча шла, пока стройка стояла. Излишек девать некуда,
 * и он теряется — но не молча: функция возвращает потерянное, чтобы
 * интерфейс сказал об этом прямо, а не оставил игрока гадать, почему
 * вернулось меньше обещанного.
 */
export function refundToStore(
  stock: ResourceAmounts,
  capacity: StorageCapacities,
  refund: ResourceAmounts,
): ResourceAmounts {
  const lost: ResourceAmounts = { ore: 0, polymers: 0, plasma: 0 };
  for (const resource of STORED_RESOURCES) {
    const room = Math.max(0, capacity[resource] - stock[resource]);
    const fits = Math.min(refund[resource], room);
    stock[resource] += fits;
    lost[resource] = refund[resource] - fits;
  }
  return lost;
}

export function subtractResources(stock: ResourceAmounts, cost: ResourceAmounts): void {
  stock.ore -= cost.ore;
  stock.polymers -= cost.polymers;
  stock.plasma -= cost.plasma;
}

export function multiplyResources(cost: ResourceAmounts, factor: number): ResourceAmounts {
  return {
    ore: cost.ore * factor,
    polymers: cost.polymers * factor,
    plasma: cost.plasma * factor,
  };
}
