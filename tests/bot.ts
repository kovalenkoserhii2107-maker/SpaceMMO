/**
 * Боты: решения, щит новичка и правдоподобность развития.
 *
 * Решающая функция чистая, поэтому весь набор считается напрямую на игровых
 * модулях и сервера не требует — как бой, полеты и хранилища. Проверяется
 * не «бот сходил», а два свойства, которые действительно важны: бот не встает
 * в тупик и не обходит правила.
 *
 * Запуск: npm run test:bot
 */
import {
  buildingPlan,
  decide,
  emptyBotSnapshot,
  nextBuilding,
  nextResearch,
  pickRaidTarget,
  testBase,
  type BotRaidTarget,
  type BotSnapshot,
  type BotThreat,
} from '../src/game/bot/decide.js';
import { NEWBIE_SHIELD_DAYS, BOT_PERSONALITIES, personality } from '../src/game/bot/personality.js';
import { parsePlan, withPlan } from '../src/game/bot/plan.js';
import { hopeless, parseDirectives } from '../src/game/bot/directives.js';
import {
  battleShock, markShock, marketShock, readShocks,
  MARKET_SHOCK_TTL_MS, SHOCK_TTL_MS,
} from '../src/game/bot/director.js';
import {
  buildSeconds,
  emptyLevels,
  productionPerSecond,
  storageCapacities,
  storageCapacity,
  storedTotal,
  upgradeCost,
  type BuildingLevels,
} from '../src/game/rules.js';
import {
  buildSpeedup,
  economyBonuses,
  emptyTechLevels,
  researchCost,
  researchSeconds,
  timeCompressionDrain,
  type TechLevels,
} from '../src/game/techTree.js';
import { emptyShipCounts, shipCost, shipUnitSeconds } from '../src/game/ships.js';
import { defenseCost, defenseUnitSeconds, emptyDefenseCounts } from '../src/game/defenses.js';
import { spentOnFleet } from '../src/game/score.js';
import { storageUpgradeCost } from '../src/game/market.js';

const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const RICHNESS = { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 };

const fmtUnits = (value: number) => Math.round(value).toLocaleString('ru-RU');

/* ------------------------- 1. Щит новичка ------------------------- */

console.log('\n=== 1. Щит новичка ===');

function target(overrides: Partial<BotRaidTarget> = {}): BotRaidTarget {
  return {
    planetId: 'p1',
    commanderId: 'victim',
    accountAgeDays: 30,
    isBot: false,
    knownStrength: 100,
    // Цель по умолчанию стоит набега: на складе есть что взять, и флот,
    // который оставит после себя обломки. Без этого набег не выбирается —
    // теперь он должен окупаться, а не просто быть посильным.
    knownFleetValue: 5_000,
    knownStock: 200_000,
    orbit: 4,
    // Своя система: рейс в чужую требует «Гипердвигателя» и антиматерии,
    // а без них цель недостижима и в расчет не идет вовсе.
    distance: 0,
    ...overrides,
  };
}

{
  const newbie = target({ accountAgeDays: NEWBIE_SHIELD_DAYS - 0.5, knownStrength: 0 });
  check(
    'бот не трогает новичка даже с нулевой обороной',
    pickRaidTarget([newbie], 1_000_000, 'AGGRESSOR') === null,
  );
}

{
  const veteran = target({ accountAgeDays: NEWBIE_SHIELD_DAYS + 0.5, knownStrength: 100 });
  check(
    'ветеран целью становится',
    pickRaidTarget([veteran], 1_000_000, 'AGGRESSOR')?.planetId === 'p1',
  );
}

{
  /*
   * Между ботами щита нет. Он защищает человека, который еще не разобрался
   * в правилах; боту разбираться не надо, а от взаимной неприкосновенности
   * мир замирает: живой агрессор с сорока восемью истребителями простоял
   * полсуток, получая на каждый вылет отказ, — все соседи оказались младше
   * трех суток, и воевать было не с кем.
   */
  const youngBot = target({ accountAgeDays: NEWBIE_SHIELD_DAYS - 2, isBot: true, knownStrength: 100 });
  check(
    'молодого бота другой бот атаковать может',
    pickRaidTarget([youngBot], 1_000_000, 'AGGRESSOR')?.planetId === 'p1',
  );

  const youngHuman = target({ accountAgeDays: NEWBIE_SHIELD_DAYS - 2, isBot: false, knownStrength: 100 });
  check(
    'а молодого живого игрока — по-прежнему нет',
    pickRaidTarget([youngHuman], 1_000_000, 'AGGRESSOR') === null,
  );
}

{
  // Граница включительно: ровно на третьи сутки щит уже снят.
  const edge = target({ accountAgeDays: NEWBIE_SHIELD_DAYS });
  check('щит снимается ровно на границе срока', pickRaidTarget([edge], 1_000_000, 'AGGRESSOR') !== null);
}

{
  check(
    'неразведанную цель бот не атакует',
    pickRaidTarget([target({ knownStrength: null })], 1_000_000, 'AGGRESSOR') === null,
  );
}

{
  const strong = target({ knownStrength: 1000 });
  const advantage = personality('AGGRESSOR').raidAdvantage;
  check(
    'без запаса по силе бот не летит',
    pickRaidTarget([strong], 1000 * advantage - 1, 'AGGRESSOR') === null &&
      pickRaidTarget([strong], 1000 * advantage, 'AGGRESSOR') !== null,
    `порог ×${advantage}`,
  );
}

{
  check(
    'торговец не нападает первым ни при каком перевесе',
    pickRaidTarget([target()], 10_000_000, 'TRADER') === null,
  );
}

{
  const near = target({ planetId: 'near', distance: 2 });
  const far = target({ planetId: 'far', distance: 40 });
  check(
    'из подходящих целей выбирается ближняя',
    pickRaidTarget([far, near], 1_000_000, 'AGGRESSOR')?.planetId === 'near',
  );
}

/* ------------------------- 2. Порядок развития ------------------------- */

console.log('\n=== 2. Бот не встает в тупик ===');

{
  // Классическая ловушка жадного алгоритма: руда окупается лучше всех,
  // и бот без явного правила застрял бы на ней, оставшись без полимеров.
  const base = testBase('b', { levels: { ...emptyLevels(), ORE_MINE: 3 } });
  check(
    'без полимерного завода бот ставит именно его',
    nextBuilding(base, emptyTechLevels(), 'AGGRESSOR') === 'POLYMER_PLANT',
  );
}

{
  const levels = { ...emptyLevels(), ORE_MINE: 3, POLYMER_PLANT: 2 };
  check(
    'без плазменного реактора бот ставит его',
    nextBuilding(testBase('b', { levels }), emptyTechLevels(), 'AGGRESSOR') === 'PLASMA_REACTOR',
  );
}

{
  // Полный склад останавливает добычу — расширение важнее любой шахты.
  const levels = { ...emptyLevels(), ORE_MINE: 4, POLYMER_PLANT: 4, PLASMA_REACTOR: 3, POWER_PLANT: 9 };
  const caps = storageCapacities(levels);
  const base = testBase('b', {
    levels,
    // Полон именно рудный склад — его бот и должен тянуть.
    resources: { ore: caps.ore * 0.95, polymers: 0, plasma: 0 },
  });
  check(
    'полный склад руды бот расширяет именно рудным хранилищем',
    nextBuilding(base, emptyTechLevels(), 'TRADER') === 'ORE_STORAGE',
    `${nextBuilding(base, emptyTechLevels(), 'TRADER')}`,
  );
}

{
  // Просевшая энергия режет добычу на всех шахтах разом. Склад базе дан
  // с запасом: иначе первым пунктом станет он, и проверка будет не про энергию.
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 8,
    POLYMER_PLANT: 8,
    PLASMA_REACTOR: 6,
    POWER_PLANT: 1,
    ORE_STORAGE: 12,
    POLYMER_STORAGE: 12,
    PLASMA_STORAGE: 12,
  };
  check(
    'при нехватке энергии бот строит станцию',
    nextBuilding(testBase('b', { levels }), emptyTechLevels(), 'AGGRESSOR') === 'POWER_PLANT',
  );
}

{
  const techs = emptyTechLevels();
  const levels = { ...emptyLevels(), SCIENCE_CENTER: 3 };
  const rich = { ore: 1e9, polymers: 1e9, plasma: 1e9 };
  const first = nextResearch(techs, levels, 'AGGRESSOR', rich);
  const traderFirst = nextResearch(techs, levels, 'TRADER', rich);
  check(
    'характер задает порядок науки',
    first === 'ENERGY_TECH' && traderFirst === 'ENERGY_TECH',
    `агрессор ${first}, торговец ${traderFirst}`,
  );

  // Ветки расходятся сразу за общей энергетикой.
  const withEnergy: TechLevels = { ...techs, ENERGY_TECH: 3 };
  const aggro = nextResearch(withEnergy, levels, 'AGGRESSOR', rich);
  const trade = nextResearch(withEnergy, levels, 'TRADER', rich);
  check('ветки характеров расходятся', aggro !== trade, `агрессор ${aggro}, торговец ${trade}`);
}

/* ------------------------- 3. Решения целиком ------------------------- */

console.log('\n=== 3. Решения ===');

function snapshotWith(overrides: Partial<BotSnapshot> = {}): BotSnapshot {
  return {
    ...emptyBotSnapshot('AGGRESSOR'),
    techs: emptyTechLevels(),
    bases: [testBase('home', { resources: { ore: 5000, polymers: 3000, plasma: 1500 } })],
    // Цену бот получает от планировщика: она средневзвешенная по последним
    // сделкам между игроками. Без нее коридора нет и торговать он не станет.
    // Стакан по умолчанию пуст, поэтому перекоса нет и коридор не сдвинут.
    market: [
      { resource: 'ORE', reference: 10, seeded: false, demand: 0, supply: 0, skew: null },
      { resource: 'POLYMERS', reference: 14, seeded: false, demand: 0, supply: 0, skew: null },
    ],
    ...overrides,
  };
}

{
  const intents = decide(snapshotWith());
  check('со стартовым запасом бот сразу что-то делает', intents.length > 0, `${intents.length} намерений`);
  check(
    'первым делом бот строит',
    intents.some((intent) => intent.kind === 'BUILD'),
  );
}

{
  // Занятая очередь: второе здание в нее не встанет, и бот не должен пытаться.
  const busy = snapshotWith({
    bases: [
      testBase('home', { resources: { ore: 5000, polymers: 3000, plasma: 1500 }, building: true }),
    ],
  });
  check(
    'при занятой стройке бот не заказывает второе здание',
    !decide(busy).some((intent) => intent.kind === 'BUILD'),
  );
}

{
  const researching = snapshotWith({ researching: true });
  check(
    'при идущем исследовании бот не заказывает второе',
    !decide(researching).some((intent) => intent.kind === 'RESEARCH'),
  );
}

{
  // Пустой склад: тратить нечего, и бот обязан промолчать, а не заказать в долг.
  const broke = snapshotWith({
    bases: [testBase('home', { resources: { ore: 0, polymers: 0, plasma: 0 } })],
  });
  const intents = decide(broke);
  check('без ресурсов бот ничего не заказывает', intents.length === 0, `${intents.length} намерений`);
}

{
  // Колонизация: корабль есть, планета есть, слот есть.
  const ships = emptyShipCounts();
  ships.COLONY_SHIP = 1;
  const ready = snapshotWith({
    techs: { ...emptyTechLevels(), ASTROPHYSICS: 9 },
    bases: [testBase('home', { ships, resources: { ore: 1000, polymers: 500, plasma: 200 } })],
    freePlanets: [
      { planetId: 'far', systemId: 's2', distance: 30 },
      { planetId: 'near', systemId: 's1', distance: 3 },
    ],
  });
  const colonize = decide(ready).find((intent) => intent.kind === 'COLONIZE');
  check('бот колонизирует ближайшую свободную планету', colonize?.planetId === 'near');
}

{
  // Рейс уже в пути — второй на ту же цель не нужен.
  const ships = emptyShipCounts();
  ships.COLONY_SHIP = 1;
  const flying = snapshotWith({
    techs: { ...emptyTechLevels(), ASTROPHYSICS: 9 },
    bases: [testBase('home', { ships })],
    freePlanets: [{ planetId: 'near', systemId: 's1', distance: 3 }],
    colonizing: true,
  });
  check(
    'второй колониальный рейс не отправляется',
    !decide(flying).some((intent) => intent.kind === 'COLONIZE'),
  );
}

{
  // В набег не идут грузовики под завязку, зонды и колониальный корабль.
  const ships = emptyShipCounts();
  ships.CRUISER = 50;
  ships.PROBE = 5;
  ships.COLONY_SHIP = 2;
  ships.RECYCLER = 3;
  ships.LARGE_CARGO = 10;
  ships.SMALL_CARGO = 8;

  const raid = decide(
    snapshotWith({
      bases: [testBase('home', { ships, resources: { ore: 0, polymers: 0, plasma: 0 } })],
      raidTargets: [target({ knownStrength: 1000 })],
    }),
  ).find((intent) => intent.kind === 'RAID');

  check('набег отправляется', raid !== undefined);
  if (raid && raid.kind === 'RAID') {
    check(
      'зонды, переработчики и колониальные корабли остаются дома',
      raid.ships.PROBE === 0 && raid.ships.RECYCLER === 0 && raid.ships.COLONY_SHIP === 0,
    );
    check('боевой костяк уходит целиком', raid.ships.CRUISER === 50);
    /*
     * Половина трюмов уходит за добычей, половина продолжает возить на хаб.
     * Малые транспорты считаются наравне с большими: без них у бота, у кого
     * больших нет вовсе, потолок добычи — трюмы истребителей, и набег
     * не окупается никогда.
     */
    check(
      'часть трюмов идет под добычу, часть остается дома',
      raid.ships.LARGE_CARGO === 5 && raid.ships.SMALL_CARGO === 4,
      `большие ${raid.ships.LARGE_CARGO} из 10, малые ${raid.ships.SMALL_CARGO} из 8`,
    );
  }
}

{
  // Целей нет, потому что никто не разведан — бот должен отправить зонд.
  const ships = emptyShipCounts();
  ships.PROBE = 3;
  const scan = decide(
    snapshotWith({
      bases: [testBase('home', { ships, resources: { ore: 0, polymers: 0, plasma: 0 } })],
      raidTargets: [target({ knownStrength: null })],
    }),
  ).find((intent) => intent.kind === 'SCAN');
  check('вслепую бот не летит, а разведывает', scan !== undefined);
}

{
  /*
   * Ферма была недостижима вовсе: `buildingPlan` не предлагал ее ни в одном
   * пункте, и единственный путь к единственному источнику криптогривны шел
   * через приоритеты языковой модели. У трех живых ботов она стояла на нуле.
   */
  const levels = { ...emptyLevels(), ORE_MINE: 7, POLYMER_PLANT: 7, POWER_PLANT: 8, SCIENCE_CENTER: 4, SHIPYARD: 4 };
  const plan = buildingPlan(
    testBase('home', { levels, resources: { ore: 1000, polymers: 1000, plasma: 1000 } }),
    emptyTechLevels(),
    'TRADER',
  );
  check('крипто-ферма вообще достижима в плане', plan.includes('CRYPTO_FARM'), plan.join(' → '));
}

{
  // Склад полон, но его вместимости хватает на шесть часов добычи: расширять
  // бессмысленно, узкое место в вывозе. Добытое сверх потолка стоит ноль,
  // и две трети отдачи фермы больше этого нуля.
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 7, POLYMER_PLANT: 7, POWER_PLANT: 9,
    SCIENCE_CENTER: 4, SHIPYARD: 4, POLYMER_STORAGE: 11, ORE_STORAGE: 7,
  };
  const caps = storageCapacities(levels);
  const plan = buildingPlan(
    testBase('home', { levels, resources: { ore: 100, polymers: caps.polymers, plasma: 100 } }),
    emptyTechLevels(),
    'TRADER',
  );
  const farm = plan.indexOf('CRYPTO_FARM');
  const storage = plan.indexOf('POLYMER_STORAGE');
  check(
    'при полном складе с запасом на часы ферма идет вперед хвоста',
    farm >= 0 && farm < plan.length - 1,
    plan.join(' → '),
  );
  check(
    'и склад, которого хватает на часы добычи, бот не расширяет: узкое место не в нем',
    storage < 0 || farm < storage,
    plan.join(' → '),
  );
}

{
  /*
   * Список модели дополняет характерный, а не заменяет его. Замена целиком
   * стоила живому боту всего флота: назвав три ветки, модель выбросила
   * реактивный двигатель — ворота под любой базовый корабль, — и Купець
   * простоял с 92 000 ₴ и пустым ангаром, не имея даже грузовика.
   */
  const plan = parsePlan(
    { researchOrder: ['ENERGY_TECH', 'MINING_TECH', 'COMPUTING_TECH'], buildingFocus: ['ORE_MINE'] },
    'TRADER',
  );
  const merged = withPlan('TRADER', plan);
  check(
    'приоритеты модели идут первыми',
    merged.researchOrder.slice(0, 3).join() === 'ENERGY_TECH,MINING_TECH,COMPUTING_TECH',
    merged.researchOrder.slice(0, 3).join(' → '),
  );
  check(
    'но ворота под корабли из списка не исчезают',
    merged.researchOrder.includes('COMBUSTION_DRIVE'),
    merged.researchOrder.join(' → '),
  );
  check(
    'повторов при сведении не появляется',
    new Set(merged.researchOrder).size === merged.researchOrder.length,
  );
}

{
  /*
   * Ради этого на рынок и ходят. Полимеров вдоволь, а целевое здание требует
   * руды, и добыть ее быстрее нельзя — шахта уже стоит. Продать избыток
   * и купить недостающее.
   */
  const lopsided = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    // Руды почти нет, полимеров полный склад: на постройку не хватает руды.
    bases: [testBase('home', { resources: { ore: 5, polymers: 6000, plasma: 1500 } })],
    hubStorage: { ore: 0, polymers: 4000, free: 2000 },
    orderBook: [
      { id: 'руда', side: 'SELL', resource: 'ORE', price: 10, amount: 500, mine: false },
      { id: 'полимеры', side: 'BUY', resource: 'POLYMERS', price: 14, amount: 500, mine: false },
    ],
  });
  const intents = decide(lopsided);
  const takes = intents.filter((i) => i.kind === 'TAKE').map((i) => (i.kind === 'TAKE' ? i.orderId : ''));
  check(
    'недостающую руду бот покупает',
    takes.includes('руда'),
    takes.join(', ') || 'ничего',
  );
  check(
    'а избыточные полимеры продает',
    takes.includes('полимеры') ||
      intents.some((i) => i.kind === 'ORDER' && i.side === 'SELL' && i.resource === 'POLYMERS'),
  );
  check(
    'и полимеры при этом не покупает',
    !intents.some((i) => i.kind === 'ORDER' && i.side === 'BUY' && i.resource === 'POLYMERS'),
  );
}

{
  /*
   * Дефляционная ловушка, которую открыло удаление станции: криптогривна
   * берется единственным способом — с фермы, — а ферма в общем плане стоит
   * последней из десяти при одном слоте стройки. У трех живых ботов она была
   * нулевого уровня при шахтах до седьмого, то есть до нее не доходила
   * очередь никогда.
   */
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 10, POLYMER_PLANT: 10, PLASMA_REACTOR: 8, POWER_PLANT: 14,
    SCIENCE_CENTER: 7, SHIPYARD: 7, ORE_STORAGE: 10, POLYMER_STORAGE: 10, PLASMA_STORAGE: 8,
  };
  // Руды не хватает на следующий уровень шахты, зато хватает на ферму:
  // купить недостающее не на что, а добыть быстрее нельзя.
  const broke = snapshotWith({
    character: 'TRADER',
    credits: 0,
    bases: [testBase('home', { levels, resources: { ore: 10_000, polymers: 30_000, plasma: 12_000 } })],
  });
  const build = decide(broke).find((i) => i.kind === 'BUILD');
  check(
    'без денег на покупку недостающего бот строит ферму',
    build?.kind === 'BUILD' && build.building === 'CRYPTO_FARM',
    build?.kind === 'BUILD' ? build.building : 'не строит',
  );
}

{
  // С деньгами покупка закрывает дефицит, и ферма ждет своей очереди.
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 10, POLYMER_PLANT: 10, PLASMA_REACTOR: 8, POWER_PLANT: 14,
    SCIENCE_CENTER: 7, SHIPYARD: 7, ORE_STORAGE: 10, POLYMER_STORAGE: 10, PLASMA_STORAGE: 8,
  };
  const rich = snapshotWith({
    character: 'TRADER',
    credits: 10_000_000,
    bases: [testBase('home', { levels, resources: { ore: 10_000, polymers: 30_000, plasma: 12_000 } })],
  });
  const build = decide(rich).find((i) => i.kind === 'BUILD');
  check(
    'с деньгами ферма очередь не занимает: недостающее проще купить',
    !(build?.kind === 'BUILD' && build.building === 'CRYPTO_FARM'),
    build?.kind === 'BUILD' ? build.building : 'копит на цель',
  );
}

{
  /*
   * Второй порог фермы: бот беден, но не заблокирован.
   *
   * Первый порог спрашивает «хватит ли денег закрыть дефицит», и когда
   * дефицита нет вовсе, он молчит. Так и живут боты на богатых недрах:
   * ресурсы на очередное здание есть всегда, склад не переполняется, ферма
   * не строится никогда. Живой Яструб простоял так двое суток с ₴7 835
   * на счету и фермой нулевого уровня.
   */
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 10, POLYMER_PLANT: 10, PLASMA_REACTOR: 8, POWER_PLANT: 14,
    SCIENCE_CENTER: 7, SHIPYARD: 7, ORE_STORAGE: 14, POLYMER_STORAGE: 14, PLASMA_STORAGE: 12,
  };
  // Ресурсов вдоволь: на следующее здание хватает, покупать нечего,
  // и первый порог не срабатывает.
  const resources = { ore: 200_000, polymers: 200_000, plasma: 60_000 };

  const poor = snapshotWith({
    character: 'TRADER',
    // Меньше, чем стоит расширение склада на хабе: торговать и расти не на что.
    credits: 1_000,
    bases: [testBase('home', { levels, resources })],
  });
  const poorBuild = decide(poor).find((i) => i.kind === 'BUILD');
  check(
    'без денег на расширение склада бот строит ферму',
    poorBuild?.kind === 'BUILD' && poorBuild.building === 'CRYPTO_FARM',
    poorBuild?.kind === 'BUILD' ? `${poorBuild.building} — ${poorBuild.why}` : 'не строит',
  );

  const solvent = snapshotWith({
    character: 'TRADER',
    credits: 5_000_000,
    bases: [testBase('home', { levels, resources })],
  });
  const solventBuild = decide(solvent).find((i) => i.kind === 'BUILD');
  check(
    'с деньгами очередь застройки ферма не занимает',
    !(solventBuild?.kind === 'BUILD' && solventBuild.building === 'CRYPTO_FARM'),
    solventBuild?.kind === 'BUILD' ? solventBuild.building : 'копит на цель',
  );

  // Порог — цена расширения склада, а не константа: он растет вместе с хабом.
  const bigHub = snapshotWith({
    character: 'TRADER',
    credits: 5_000_000,
    bases: [testBase('home', { levels, resources })],
    hubStorage: { ore: 0, polymers: 0, free: 0, level: 12, upgradeCost: storageUpgradeCost(13) },
  });
  const bigHubBuild = decide(bigHub).find((i) => i.kind === 'BUILD');
  check(
    'с большим хабом та же сумма уже считается бедностью',
    bigHubBuild?.kind === 'BUILD' && bigHubBuild.building === 'CRYPTO_FARM',
    bigHubBuild?.kind === 'BUILD' ? bigHubBuild.building : 'не строит',
  );
}

{
  /*
   * Односторонний клапан, из-за которого рынок встал целиком: боты возили
   * товар на хаб и не забирали обратно никогда. Купленное на бирже нельзя
   * пустить в дело — строят из того, что на базе, — а непроданное копилось,
   * пока склад не забился. Три живых хаба вышли за вместимость, сделок
   * за двадцать минут стало ноль, и Крамар с 2.36 млн ₴ не мог купить
   * ни единицы руды, которой ему не хватало на постройку.
   */
  const bought = snapshotWith({
    character: 'TRADER',
    credits: 0,
    // Руды на базе нет — она нужна на цель и лежит на хабе.
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 10, POLYMER_PLANT: 10, POWER_PLANT: 14, SCIENCE_CENTER: 7, SHIPYARD: 7 },
        resources: { ore: 10, polymers: 30_000, plasma: 12_000 },
        ships: { ...emptyShipCounts(), SMALL_CARGO: 20 },
      }),
    ],
    hubStorage: { ore: 5000, polymers: 0, free: 1000, level: 4, upgradeCost: 136_000 },
  });
  const pickup = decide(bought).find((i) => i.kind === 'PICKUP');
  check(
    'недостающее с хаба бот везет домой',
    pickup?.kind === 'PICKUP' && pickup.ore > 0,
    pickup?.kind === 'PICKUP' ? `руда ${pickup.ore}` : 'не везет',
  );
}

{
  // Излишек, который сами же привезли продавать, домой не возим:
  // это гоняло бы флот по кругу.
  const selling = snapshotWith({
    character: 'TRADER',
    bases: [
      testBase('home', {
        resources: { ore: 5000, polymers: 3000, plasma: 1500 },
        ships: { ...emptyShipCounts(), SMALL_CARGO: 20 },
      }),
    ],
    hubStorage: { ore: 5000, polymers: 5000, free: 1000, level: 4, upgradeCost: 136_000 },
  });
  check('излишек с хаба домой не возится', !decide(selling).some((i) => i.kind === 'PICKUP'));
}

{
  // Забитый склад хаба запирает торговлю целиком: продать некому, значит
  // место не освободится, значит и купить нельзя. Теперь это вопрос денег.
  const jammed = snapshotWith({
    character: 'TRADER',
    credits: 500_000,
    hubStorage: { ore: 19_000, polymers: 1000, free: 480, level: 4, upgradeCost: 136_000 },
    market: [
      { resource: 'ORE', reference: 10, seeded: false, demand: 8000, supply: 0, skew: 1 },
      { resource: 'POLYMERS', reference: 14, seeded: false, demand: 0, supply: 0, skew: null },
    ],
  });
  check(
    'забитый ходовым товаром склад бот расширяет за криптогривну',
    decide(jammed).some((i) => i.kind === 'HUB_UPGRADE'),
  );

  /*
   * А под неликвид — не расширяет. Живой бот поднял склад с четвертого
   * уровня до восьмого и сжег 1.9 млн ₴ ради 56 тысяч полимеров, которых
   * никто не берет: каждое расширение вдвое дороже предыдущего, а спроса
   * от этого не появляется.
   */
  const deadStock = snapshotWith({
    character: 'TRADER',
    credits: 500_000,
    hubStorage: { ore: 0, polymers: 20_000, free: 480, level: 4, upgradeCost: 136_000 },
    market: [
      { resource: 'ORE', reference: 10, seeded: false, demand: 0, supply: 0, skew: null },
      { resource: 'POLYMERS', reference: 14, seeded: false, demand: 0, supply: 30_000, skew: -1 },
    ],
  });
  check(
    'под неликвид склад не расширяется: место освобождает вывоз, а не деньги',
    !decide(deadStock).some((i) => i.kind === 'HUB_UPGRADE'),
  );

  const broke = snapshotWith({
    character: 'TRADER',
    credits: 1000,
    hubStorage: { ore: 19_000, polymers: 1000, free: 480, level: 4, upgradeCost: 136_000 },
  });
  check('без денег расширение не заказывается', !decide(broke).some((i) => i.kind === 'HUB_UPGRADE'));
}

{
  /*
   * Тупик, из-за которого агрессор не воевал вовсе. Зонд исключен
   * из `SQUADRON_TYPES` нарочно — иначе модель ставила его в половину
   * эскадры, — но другого пути заказать его не осталось: без разведки
   * у цели нет оценки силы, без оценки набег не выбирается, а разведать
   * нечем. Живой Хижак простоял в нем с пятьюдесятью тремя истребителями,
   * с замыслом «наращиваем ударный флот для завоевания соседей»
   * и с нулем войн.
   */
  const blind = snapshotWith({
    character: 'AGGRESSOR',
    // Зонд — шпионский дрон: без «Шпионажа» его не собрать, и заказывать
    // его бессмысленно.
    techs: { ...emptyTechLevels(), COMPUTING_TECH: 2, ESPIONAGE: 1 },
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), LIGHT_FIGHTER: 53 },
      }),
    ],
    raidTargets: [
      target({ commanderId: 'сосед', knownStrength: null, knownFleetValue: null, knownStock: null }),
    ],
  });
  const order = decide(blind).find((i) => i.kind === 'SHIPS' && i.ship === 'PROBE');
  check(
    'без зондов агрессор их заказывает, а не стоит слепым',
    order?.kind === 'SHIPS' && order.count > 0,
    order?.kind === 'SHIPS' ? `${order.ship} ${order.count}` : 'не заказал',
  );
}

{
  // А без вычислительной технологии зонда не собрать, и заказывать его
  // бессмысленно: отказ пришел бы с верфи.
  const ungated = snapshotWith({
    character: 'AGGRESSOR',
    techs: emptyTechLevels(),
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), LIGHT_FIGHTER: 53 },
      }),
    ],
    raidTargets: [
      target({ commanderId: 'сосед', knownStrength: null, knownFleetValue: null, knownStock: null }),
    ],
  });
  check(
    'без «Шпионажа» зонд не заказывается',
    !decide(ungated).some((i) => i.kind === 'SHIPS' && i.ship === 'PROBE'),
  );
}

{
  // Зонд есть — летит разведка, а не новый заказ: он одноразовый,
  // но копить их незачем, разведывают по одной цели за раз.
  const eyed = snapshotWith({
    character: 'AGGRESSOR',
    techs: { ...emptyTechLevels(), COMPUTING_TECH: 2, ESPIONAGE: 1 },
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), LIGHT_FIGHTER: 53, PROBE: 2 },
      }),
    ],
    raidTargets: [
      target({ commanderId: 'сосед', knownStrength: null, knownFleetValue: null, knownStock: null }),
    ],
  });
  const intents = decide(eyed);
  check('с зондом бот разведывает', intents.some((i) => i.kind === 'SCAN'));
  check(
    'и новых зондов не заказывает',
    !intents.some((i) => i.kind === 'SHIPS' && i.ship === 'PROBE'),
  );
}

{
  /*
   * Тупик, в который встали семеро живых ботов одновременно. Руда —
   * универсальный вход: следующий уровень шахты стоит вчетверо больше руды,
   * чем полимеров, а добывались они поровну. К вечеру склады были забиты
   * полимерами, руды оставалось шесть процентов, и все семеро выставили
   * заявки на ее покупку — продавать было некому. Рынок встал: четырнадцать
   * сделок за шесть часов.
   */
  const starved = testBase('home', {
    levels: { ...emptyLevels(), ORE_MINE: 7, POLYMER_PLANT: 7, PLASMA_REACTOR: 6, POWER_PLANT: 11,
      SCIENCE_CENTER: 4, SHIPYARD: 4, ORE_STORAGE: 8, POLYMER_STORAGE: 11, PLASMA_STORAGE: 9 },
    // Руды на час добычи, полимеров на много часов — перекос, который бот
    // создал себе сам. Плазмы вдоволь и склад не полон, иначе сработало бы
    // правило остановленной добычи, и оно тут право.
    resources: { ore: 3839, polymers: 106_970, plasma: 40_000 },
  });
  const plan = buildingPlan(starved, emptyTechLevels(), 'TRADER');
  check(
    'ресурс, которого хронически нет, бот идет добывать',
    plan[0] === 'ORE_MINE',
    plan.slice(0, 3).join(' → '),
  );
}

{
  // Ровный запас правило не трогает: мало всего сразу — это старт игры,
  // а не перекос.
  const even = testBase('home', {
    levels: { ...emptyLevels(), ORE_MINE: 5, POLYMER_PLANT: 5, PLASMA_REACTOR: 4, POWER_PLANT: 7 },
    resources: { ore: 500, polymers: 500, plasma: 300 },
  });
  const plan = buildingPlan(even, emptyTechLevels(), 'TRADER');
  check(
    'при ровном голоде шахта вперед не лезет',
    plan[0] !== 'ORE_MINE' || plan.length === 1,
    plan.slice(0, 3).join(' → '),
  );
}

{
  /*
   * Не покупаем то, чего на хабе уже гора.
   *
   * Сторону решают склады баз, а не хаб, — и это верно, привязка к хабу
   * когда-то дала петлю на 111 встречных сделок. Но хаб не учитывался вовсе,
   * и живой «Купець» дошел до предела: 146 тысяч полимеров на хабе, восемь
   * на базе, и он спускает последние два миллиона на покупку еще полимеров,
   * оставшись с тремя гривнами. Домой их не увезти — склад базы меньше
   * впятеро, — и превратиться им не во что.
   */
  const levels = { ...emptyLevels(), ORE_MINE: 6, POLYMER_PLANT: 4, POWER_PLANT: 6, SCIENCE_CENTER: 4, SHIPYARD: 4, POLYMER_STORAGE: 1, ORE_STORAGE: 4 };
  const offer = { id: 'дешево', side: 'SELL' as const, resource: 'POLYMERS' as const, price: 5, amount: 5000, mine: false };
  const world = (hubPolymers: number) =>
    snapshotWith({
      character: 'TRADER',
      credits: 1_000_000,
      // Полимеров на базе меньше половины склада — значит бот их покупатель,
      // а не продавец: сторону решает заполненность своих складов.
      bases: [testBase('home', { levels, resources: { ore: 5_000, polymers: 1_000, plasma: 3_000 } })],
      orderBook: [offer],
      hubStorage: { ore: 0, polymers: hubPolymers, free: 100_000, level: 6, upgradeCost: storageUpgradeCost(7) },
    });

  const takes = (snapshot: BotSnapshot) =>
    decide(snapshot).some((i) => i.kind === 'TAKE' && i.orderId === 'дешево');
  const orders = (snapshot: BotSnapshot) =>
    decide(snapshot).some((i) => i.kind === 'ORDER' && i.side === 'BUY' && i.resource === 'POLYMERS');

  check('пока дома есть место, дешевый товар бот берет', takes(world(0)));
  check('и заявку на покупку выставляет', orders(world(0)));

  // На хабе больше, чем влезет домой: следующая купленная единица
  // не превратится ни во что.
  check('с забитым хабом чужую продажу не выкупает', !takes(world(200_000)));
  check('и своей заявки на покупку не ставит', !orders(world(200_000)));
}

{
  /*
   * Набег — предприятие, а не рефлекс.
   *
   * Живой Хижак ходил на Купця раз в три минуты, привозил по 104–739 единиц
   * и жег около 930 плазмы за вылет. Каждый вылет был прямым убытком, и
   * остановить его было нечем: правило спрашивало «слабее ли цель», но
   * не «стоит ли лететь».
   */
  const raider = (targets: BotRaidTarget[]) =>
    snapshotWith({
      character: 'AGGRESSOR',
      bases: [
        testBase('home', {
          levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SHIPYARD: 5, SCIENCE_CENTER: 4 },
          resources: { ore: 30_000, polymers: 20_000, plasma: 9_000 },
          ships: { ...emptyShipCounts(), LIGHT_FIGHTER: 90, LARGE_CARGO: 10 },
        }),
      ],
      raidTargets: targets,
    });

  const raidOn = (targets: BotRaidTarget[]) => {
    const intent = decide(raider(targets)).find((i) => i.kind === 'RAID');
    return intent?.kind === 'RAID' ? intent : null;
  };

  // Пустая цель: взять нечего, флота нет, значит и обломков не будет.
  check(
    'за гроши бот не летит',
    raidOn([target({ knownStock: 1_000, knownFleetValue: 0 })]) === null,
  );

  check(
    'за настоящей добычей летит',
    raidOn([target({ knownStock: 400_000, knownFleetValue: 40_000 })]) !== null,
  );

  // Склад разведка не разглядела — лететь наугад незачем.
  check(
    'к цели с неразведанным складом не летит',
    raidOn([target({ knownStock: null, knownFleetValue: 0 })]) === null,
  );

  /*
   * Соразмерность: выбирается не ближайшая цель, а самая выгодная. Раньше
   * бот брал ближайшую из посильных и мог годами возить копейки от соседа
   * по орбите, не замечая склада вчетверо толще через полсистемы.
   */
  const chosen = raidOn([
    target({ planetId: 'рядом', orbit: 5, distance: 0, knownStock: 30_000, knownFleetValue: 0 }),
    target({ planetId: 'далеко', orbit: 9, distance: 0, knownStock: 500_000, knownFleetValue: 60_000 }),
  ]);
  check('из двух целей выбирается жирная, а не ближняя', chosen?.planetId === 'далеко', chosen?.planetId);

  /*
   * Полет, которого не будет, не планируется.
   *
   * Живой Хижак каждый заход выбирал разведать соседа, рейс молча отваливался,
   * и так по кругу: все неразведанные соседи оказались в других системах,
   * а гиперпрыжок требует и «Гипердвигателя», и антиматерии — не было ни того,
   * ни другого. Планировать недостижимое значит не делать ничего и не знать
   * об этом.
   */
  check(
    'в чужую систему без гипердвигателя не летят',
    raidOn([target({ distance: 4, knownStock: 900_000, knownFleetValue: 90_000 })]) === null,
  );

  const jumper = snapshotWith({
    character: 'AGGRESSOR',
    techs: { ...emptyTechLevels(), HYPERSPACE_PHYSICS: 3, HYPERDRIVE: 2 },
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SHIPYARD: 5, SCIENCE_CENTER: 4 },
        resources: { ore: 30_000, polymers: 20_000, plasma: 9_000 },
        antimatter: 100_000,
        ships: { ...emptyShipCounts(), LIGHT_FIGHTER: 90, LARGE_CARGO: 10 },
      }),
    ],
    raidTargets: [target({ distance: 4, knownStock: 900_000, knownFleetValue: 90_000 })],
  });
  check(
    'с гипердвигателем и антиматерией — летят',
    decide(jumper).some((i) => i.kind === 'RAID'),
  );
}

{
  /*
   * Свой запас на хабе — не товар в пути, а материал, до которого надо
   * дотянуться. Живой Купець просидел с 45 555 руды на станции при трех
   * тысячах дома: Хижак сжег ему весь грузовой флот, а правила видели
   * в грузовике рядовой «класс, отстающий от состава эскадры».
   */
  const levels = { ...emptyLevels(), ORE_MINE: 6, POLYMER_PLANT: 5, POWER_PLANT: 7, SHIPYARD: 4, SCIENCE_CENTER: 4, ORE_STORAGE: 6, POLYMER_STORAGE: 6 };
  const stranded = (ships: Partial<Record<'SMALL_CARGO' | 'LIGHT_FIGHTER', number>>) =>
    snapshotWith({
      character: 'TRADER',
      // Транспорт без «Реактивного двигателя» не собрать вовсе.
      techs: { ...emptyTechLevels(), COMBUSTION_DRIVE: 2 },
      bases: [testBase('home', { levels, resources: { ore: 20_000, polymers: 10_000, plasma: 4_000 }, ships: { ...emptyShipCounts(), ...ships } })],
      hubStorage: { ore: 45_000, polymers: 20_000, free: 10_000, level: 8, upgradeCost: storageUpgradeCost(9) },
    });

  const cut = decide(stranded({ LIGHT_FIGHTER: 13 })).find((i) => i.kind === 'SHIPS');
  check(
    'без трюмов бот заказывает грузовик, а не истребитель',
    cut?.kind === 'SHIPS' && cut.ship === 'SMALL_CARGO',
    cut?.kind === 'SHIPS' ? `${cut.ship} — ${cut.why}` : 'ничего не заказал',
  );

  // Трюмы есть — грузовик вперед не лезет, работает обычный состав эскадры.
  const fine = decide(stranded({ SMALL_CARGO: 20, LIGHT_FIGHTER: 13 })).find((i) => i.kind === 'SHIPS');
  check(
    'с трюмами очередь верфи обычная',
    !(fine?.kind === 'SHIPS' && fine.why.includes('вывезти нечем')),
    fine?.kind === 'SHIPS' ? fine.ship : 'ничего',
  );

  /*
   * И вывоз домой теперь забирает свое, а не только сегодняшний дефицит:
   * дома ресурс работает, на хабе он занимает место и толкает платить
   * за расширение склада.
   */
  const haul = decide(stranded({ SMALL_CARGO: 20 })).find((i) => i.kind === 'PICKUP');
  check(
    'вывоз забирает свое с хаба, даже когда дефицита нет',
    haul?.kind === 'PICKUP' && haul.ore + haul.polymers > 0,
    haul?.kind === 'PICKUP' ? `руда ${haul.ore}, полимеры ${haul.polymers}` : 'не везет',
  );
}

/* --------------------- Коалиция против агрессора --------------------- */

console.log('\n=== Коалиция: против серийного агрессора скидываются ===');

function threat(overrides: Partial<BotThreat> = {}): BotThreat {
  return {
    commanderId: 'хижак',
    nickname: 'Хижак',
    planetId: 'логово',
    raids: 5,
    againstMe: false,
    knownStrength: 1000,
    planetOrbit: 6,
    distance: 0,
    ...overrides,
  };
}

function armed(overrides: Record<string, unknown> = {}) {
  return snapshotWith({
    character: 'TRADER',
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), CRUISER: 30 },
      }),
    ],
    raidTargets: [
      { planetId: 'логово', commanderId: 'хижак', accountAgeDays: 30, isBot: true, knownStrength: 1000, distance: 3 },
    ],
    ...overrides,
  });
}

{
  /*
   * Ради этого коалиция и написана. Живой Купець получил шестьдесят один
   * набег подряд, потерял весь флот и всю оборону и только предлагал мир,
   * который агрессор игнорировал. В одиночку жертве такого не остановить.
   */
  const raid = decide(armed({ threats: [threat()] })).find((i) => i.kind === 'RAID');
  check(
    'торговец летит на серийного агрессора, хотя сам не воюет',
    raid?.kind === 'RAID' && raid.planetId === 'логово',
    raid?.kind === 'RAID' ? raid.why : 'не полетел',
  );
}

{
  /*
   * Недостающее звено, из-за которого коалиция не собиралась ни разу.
   *
   * Проверка выше подсовывает уже разведанного агрессора, и на фикстуре все
   * сходилось. В живом мире разведка висела на признаке `raids`, которого
   * у торговца нет: он не мог послать зонд, значит сила агрессора оставалась
   * неизвестной, значит цель считалась безнадежной — и торговец не летел
   * никогда. «Хижак» сделал 376 набегов на «Купця», пока «Крамар» со ста
   * тридцатью двумя истребителями стоял рядом и не смотрел в его сторону.
   */
  /*
   * Зонды под серийного соседа не заказываем, и это не забывчивость.
   * Агрессора со «Шпионажем» выше своего не разглядеть в принципе: дрон
   * гибнет и записи не оставляет, цель остается неразведанной, а заказ
   * повторяется — вышла бы мясорубка. Силу такого соседа дает бой.
   */
  const blind = armed({
    threats: [threat({ knownStrength: null })],
    raidTargets: [],
    techs: { ...emptyTechLevels(), ESPIONAGE: 1 },
  });
  check(
    'зонды под серийного соседа бот не штампует',
    !decide(blind).some((i) => i.kind === 'SHIPS' && i.ship === 'PROBE'),
  );

  const withProbe = armed({
    threats: [threat({ knownStrength: null })],
    raidTargets: [],
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), CRUISER: 30, PROBE: 2 },
      }),
    ],
  });
  const scan = decide(withProbe).find((i) => i.kind === 'SCAN');
  check(
    'и отправляет его именно на агрессора',
    scan?.kind === 'SCAN' && scan.planetId === 'логово',
    scan?.kind === 'SCAN' ? scan.why : 'не разведывает',
  );

  // Разведчиками при этом все не становятся: нет серийного соседа —
  // нет и разведки, торговец по-прежнему не ходит в набеги по своей воле.
  check(
    'без серийного соседа торговец никого не разведывает',
    !decide(armed({ raidTargets: [] })).some((i) => i.kind === 'SCAN'),
  );
}

{
  // Порог здесь ниже обычного — бьют вместе, — но пол безнадежности остается:
  // лететь на цель втрое сильнее нельзя никому и ни при какой обиде.
  const hopelessOne = armed({ threats: [threat({ knownStrength: 10_000_000 })] });
  check(
    'на заведомо более сильного не летят даже коалицией',
    !decide(hopelessOne).some((i) => i.kind === 'RAID'),
  );
}

{
  const victim = armed({ threats: [threat({ againstMe: true })] });
  const rally = decide(victim).find((i) => i.kind === 'RALLY');
  check(
    'жертва рассылает призыв о помощи',
    rally?.kind === 'RALLY' && rally.commanderId === 'хижак',
    rally?.kind === 'RALLY' ? rally.why : 'молчит',
  );
  check(
    'а свидетель чужой беды почту не засоряет',
    !decide(armed({ threats: [threat({ againstMe: false })] })).some((i) => i.kind === 'RALLY'),
  );
}

{
  /*
   * Транспорт не воюет, и в пороге отступления не считается.
   *
   * Живой Хижак потерял пятьдесят три истребителя из пятидесяти трех
   * и остался с семью десятками грузовиков. По общей стоимости флота это
   * выглядело как 44% от лучшей формы — порог не срабатывал, и он ходил
   * в набеги с одними транспортами, проиграв тридцать четыре боя подряд.
   */
  const hauler = snapshotWith({
    character: 'AGGRESSOR',
    fleetPeak: 100_000,
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        // Грузовиков на целое состояние, боевого — почти ничего.
        ships: { ...emptyShipCounts(), SMALL_CARGO: 72, LIGHT_FIGHTER: 6 },
      }),
    ],
    raidTargets: [
      { planetId: 'жертва', commanderId: 'купець', accountAgeDays: 30, isBot: true, knownStrength: 1, distance: 2 },
    ],
  });
  check(
    'разбитый агрессор не ходит в набег с одними грузовиками',
    !decide(hauler).some((i) => i.kind === 'RAID'),
  );
}

{
  /*
   * Отступление. Живой Хижак сжег пятьдесят три истребителя из пятидесяти
   * трех и продолжал слать набеги транспортами — только потому, что жертве
   * уже нечем было отвечать.
   */
  const beaten = snapshotWith({
    character: 'AGGRESSOR',
    fleetPeak: 100_000,
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), LIGHT_FIGHTER: 1 },
      }),
    ],
    raidTargets: [
      { planetId: 'жертва', commanderId: 'купець', accountAgeDays: 30, isBot: true, knownStrength: 1, distance: 2 },
    ],
  });
  check(
    'потеряв четыре пятых флота, агрессор в набеги не ходит',
    !decide(beaten).some((i) => i.kind === 'RAID'),
  );
}

{
  // Двое и больше воюющих против нас — это союз, а не совпадение.
  const besieged = snapshotWith({
    character: 'AGGRESSOR',
    warsAgainstMe: 2,
    bases: [
      testBase('home', {
        levels: { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 7, POWER_PLANT: 9, SCIENCE_CENTER: 5, SHIPYARD: 5 },
        resources: { ore: 40_000, polymers: 20_000, plasma: 8000 },
        ships: { ...emptyShipCounts(), CRUISER: 30 },
      }),
    ],
    raidTargets: [
      { planetId: 'жертва', commanderId: 'купець', accountAgeDays: 30, isBot: true, knownStrength: 1, distance: 2 },
    ],
  });
  check(
    'против союза агрессор не воюет, а окапывается',
    !decide(besieged).some((i) => i.kind === 'RAID'),
  );
}

/* ------------------------- 4. Биржа ------------------------- */

console.log('\n=== 4. Торговля: берем чужое, выставляем свое ===');

{
  /*
   * Ради этого свойства торговля и переписана. Три бота на одном хабе
   * не совершили ни одной сделки: каждый выставлял свою пассивную заявку,
   * спред не пересекался, стакан стоял мертвым. Брать чужое бот не умел вовсе.
   */
  const cheap = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    // Руды на базе мало — бот по ней покупатель, а не продавец.
    bases: [testBase('home', { resources: { ore: 200, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [
      { id: 'дешевая-руда', side: 'SELL', resource: 'ORE', price: 8, amount: 400, mine: false },
    ],
  });

  const take = decide(cheap).find((intent) => intent.kind === 'TAKE');
  check(
    'дешевую чужую заявку бот исполняет, а не ждет',
    take?.kind === 'TAKE' && take.orderId === 'дешевая-руда',
    take?.kind === 'TAKE' ? `взял ${take.amount}` : 'не взял',
  );
  check(
    'берет по максимуму, сколько лежит в заявке',
    take?.kind === 'TAKE' && take.amount === 400,
    take?.kind === 'TAKE' ? `${take.amount} из 400` : '',
  );
}

{
  // Дорогую чужую продажу брать незачем: коридор на то и коридор.
  const pricey = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [{ id: 'дорого', side: 'SELL', resource: 'ORE', price: 40, amount: 400, mine: false }],
  });
  check(
    'дорогую заявку бот не берет',
    !decide(pricey).some((intent) => intent.kind === 'TAKE'),
  );
}

{
  // Своя заявка — не сделка: торговать с самим собой нельзя.
  const own = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [{ id: 'моя', side: 'SELL', resource: 'ORE', price: 8, amount: 400, mine: true }],
  });
  check('свою заявку бот не исполняет', !decide(own).some((intent) => intent.kind === 'TAKE'));
}

{
  // Кассы нет — брать не на что, как бы дешево ни лежало.
  const broke = snapshotWith({
    character: 'TRADER',
    credits: 0,
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [{ id: 'дешево', side: 'SELL', resource: 'ORE', price: 8, amount: 400, mine: false }],
  });
  check('без криптогривны бот не покупает', !decide(broke).some((intent) => intent.kind === 'TAKE'));
}

{
  // Продажа идет с хаба: товар на базе для биржи не существует.
  const seller = snapshotWith({
    character: 'TRADER',
    hubStorage: { ore: 3000, polymers: 0, free: 2000 },
    orderBook: [{ id: 'щедрый', side: 'BUY', resource: 'ORE', price: 12, amount: 1000, mine: false }],
  });
  const take = decide(seller).find((intent) => intent.kind === 'TAKE');
  check(
    'щедрую чужую покупку бот исполняет со склада хаба',
    take?.kind === 'TAKE' && take.orderId === 'щедрый' && take.amount === 1000,
    take?.kind === 'TAKE' ? `отдал ${take.amount}` : 'не отдал',
  );
}

{
  const empty = snapshotWith({
    character: 'TRADER',
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [{ id: 'щедрый', side: 'BUY', resource: 'ORE', price: 12, amount: 1000, mine: false }],
  });
  check(
    'пустой склад хаба продавать нечем',
    !decide(empty).some((intent) => intent.kind === 'TAKE'),
  );
}

{
  /*
   * Петля, из-за которой два бота за два часа совершили почти три сотни
   * встречных сделок, не сдвинувших ничего, кроме комиссии биржи. Коридоры
   * перекрываются: покупать не дороже 10.6 и продавать не дешевле 9.4
   * означает, что цена 11 одновременно выгодна с обеих сторон. Теперь по
   * каждому ресурсу бот выбирает одну сторону.
   */
  const rich = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    hubStorage: { ore: 4000, polymers: 0, free: 1000 },
    orderBook: [
      { id: 'дешево', side: 'SELL', resource: 'ORE', price: 9, amount: 400, mine: false },
      { id: 'дорого', side: 'BUY', resource: 'ORE', price: 11, amount: 400, mine: false },
    ],
  });
  const intents = decide(rich).filter((i) => i.kind === 'TAKE' || i.kind === 'ORDER');
  const buysOre = intents.some(
    (i) => (i.kind === 'TAKE' && i.orderId === 'дешево') || (i.kind === 'ORDER' && i.side === 'BUY' && i.resource === 'ORE'),
  );
  const sellsOre = intents.some(
    (i) => (i.kind === 'TAKE' && i.orderId === 'дорого') || (i.kind === 'ORDER' && i.side === 'SELL' && i.resource === 'ORE'),
  );
  check(
    'при избытке руды бот только продает ее, но не покупает',
    sellsOre && !buysOre,
    `продает ${sellsOre}, покупает ${buysOre}`,
  );
}

{
  /*
   * Заявка переживает смену стороны: живой бот держал покупку полимеров,
   * выставленную старой логикой, и продавал полимеры одновременно — круг
   * шел через собственную стоячую заявку.
   */
  const stale = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [testBase('home', { resources: { ore: 5000, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 4000, polymers: 0, free: 1000 },
    orderBook: [{ id: 'старая', side: 'BUY', resource: 'ORE', price: 11, amount: 900, mine: true }],
  });
  const drop = decide(stale).find((i) => i.kind === 'DROP');
  check(
    'заявку на чужой стороне бот снимает',
    drop?.kind === 'DROP' && drop.orderId === 'старая',
    drop?.kind === 'DROP' ? 'сняли' : 'оставили',
  );
}

{
  // Пять устаревших заявок не должны запирать бота: потолок считается
  // после снятия, иначе он выходил бы раньше, чем успел снять хоть одну.
  const jammed = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [testBase('home', { resources: { ore: 5000, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 4000, polymers: 0, free: 1000 },
    orderBook: [1, 2, 3, 4, 5].map((n) => ({
      id: `старая-${n}`,
      side: 'BUY' as const,
      resource: 'ORE' as const,
      price: 11,
      amount: 100,
      mine: true,
    })),
  });
  check(
    'пять устаревших заявок бот снимает, а не упирается в потолок',
    decide(jammed).filter((i) => i.kind === 'DROP').length === 5,
  );
}

{
  /*
   * Гарантия от возврата петли. Хаб пуст — товар только что продали, — но
   * склады базы по-прежнему полны руды, значит бот остается продавцом
   * и не выкупает обратно то, что продал. Привязка стороны к хабу давала
   * ровно этот переворот после каждой сделки.
   */
  const sold = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [testBase('home', { resources: { ore: 5000, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [
      { id: 'дешево', side: 'SELL', resource: 'ORE', price: 8, amount: 400, mine: false },
    ],
  });
  const intents = decide(sold);
  check(
    'опустевший хаб не переворачивает сторону: руду обратно бот не выкупает',
    !intents.some(
      (i) => (i.kind === 'TAKE' && i.orderId === 'дешево') || (i.kind === 'ORDER' && i.side === 'BUY' && i.resource === 'ORE'),
    ),
  );
}

{
  const poor = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [testBase('home', { resources: { ore: 200, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    orderBook: [
      { id: 'дешево', side: 'SELL', resource: 'ORE', price: 9, amount: 400, mine: false },
      { id: 'дорого', side: 'BUY', resource: 'ORE', price: 11, amount: 400, mine: false },
    ],
  });
  const intents = decide(poor).filter((i) => i.kind === 'TAKE');
  check(
    'без запаса бот только покупает',
    intents.length === 1 && intents[0]?.kind === 'TAKE' && intents[0].orderId === 'дешево',
    intents.map((i) => (i.kind === 'TAKE' ? i.orderId : i.kind)).join(', ') || 'ничего',
  );
}

{
  // Брать нечего — выставляем свое.
  const posting = snapshotWith({
    character: 'TRADER',
    credits: 50_000,
    hubStorage: { ore: 4000, polymers: 0, free: 1000 },
  });
  const orders = decide(posting).filter((intent) => intent.kind === 'ORDER');
  check('на пустом стакане бот выставляет заявки', orders.length > 0, `${orders.length} заявок`);
  check(
    'продает то, что лежит на хабе',
    orders.some((o) => o.kind === 'ORDER' && o.side === 'SELL' && o.resource === 'ORE'),
  );
}

{
  /*
   * Условие, породившее заявку, держится часами, а сама заявка его не меняет.
   * Без учета уже стоящих бот выставлял новую каждые сорок пять секунд
   * и за сутки замораживал в залоге всю кассу.
   */
  const situation = {
    character: 'TRADER' as const,
    credits: 50_000,
    hubStorage: { ore: 4000, polymers: 500, free: 500 },
  };
  const fresh = decide(snapshotWith(situation)).filter((i) => i.kind === 'ORDER');
  const repeat = decide(
    snapshotWith({
      ...situation,
      orderBook: [
        { id: 'a', side: 'SELL', resource: 'ORE', price: 11, amount: 100, mine: true },
        { id: 'b', side: 'SELL', resource: 'POLYMERS', price: 15, amount: 100, mine: true },
        { id: 'c', side: 'BUY', resource: 'ORE', price: 9, amount: 100, mine: true },
        { id: 'd', side: 'BUY', resource: 'POLYMERS', price: 13, amount: 100, mine: true },
      ],
    }),
  ).filter((i) => i.kind === 'ORDER');

  check(
    'заявка, которая уже стоит в стакане, не дублируется',
    fresh.length > 0 && repeat.length === 0,
    `без заявок ${fresh.length}, с заявками ${repeat.length}`,
  );
}

{
  // Пять открытых заявок — потолок: дальше это не торговля, а замороженный залог.
  const full = snapshotWith({
    character: 'TRADER',
    credits: 50_000,
    hubStorage: { ore: 4000, polymers: 4000, free: 1000 },
    orderBook: Array.from({ length: 5 }, (_, i) => ({
      id: `свой-${i}`, side: 'SELL' as const, resource: 'ORE' as const, price: 20 + i, amount: 10, mine: true,
    })),
  });
  check(
    'на потолке заявок новые не выставляются',
    !decide(full).some((intent) => intent.kind === 'ORDER'),
  );
}

{
  /*
   * Рынок двигает цену перекосом стакана. Пока цена была прибита к константе,
   * коридор бота стоял намертво: он не дал бы за руду больше 10.6, как бы ее
   * ни не хватало, — то есть спроса и предложения не возникало вовсе.
   */
  const hungry = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [testBase('home', { resources: { ore: 200, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    // Одни покупатели: перекос предельный, руду рвут из рук.
    market: [
      { resource: 'ORE', reference: 10, seeded: false, demand: 9000, supply: 0, skew: 1 },
      { resource: 'POLYMERS', reference: 14, seeded: false, demand: 0, supply: 0, skew: null },
    ],
    orderBook: [{ id: 'дорогая-руда', side: 'SELL', resource: 'ORE', price: 11, amount: 400, mine: false }],
  });
  const take = decide(hungry).find((intent) => intent.kind === 'TAKE');
  check(
    'при дефиците бот платит выше прежнего потолка',
    take?.kind === 'TAKE' && take.orderId === 'дорогая-руда',
    take?.kind === 'TAKE' ? `взял по 11` : 'не взял',
  );
}

{
  const glut = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [testBase('home', { resources: { ore: 200, polymers: 3000, plasma: 1500 } })],
    hubStorage: { ore: 0, polymers: 0, free: 5000 },
    // Одни продавцы: товара завались, переплачивать незачем.
    market: [
      { resource: 'ORE', reference: 10, seeded: false, demand: 0, supply: 9000, skew: -1 },
      { resource: 'POLYMERS', reference: 14, seeded: false, demand: 0, supply: 0, skew: null },
    ],
    orderBook: [{ id: 'дорогая-руда', side: 'SELL', resource: 'ORE', price: 11, amount: 400, mine: false }],
  });
  check(
    'при избытке на рынке бот ту же цену не платит',
    !decide(glut).some((intent) => intent.kind === 'TAKE'),
  );
}

{
  // Пока есть щедрый покупатель, станция не нужна: она платит меньше всех.
  const better = snapshotWith({
    character: 'TRADER',
    hubStorage: { ore: 4000, polymers: 0, free: 1000 },
    orderBook: [{ id: 'щедрый', side: 'BUY', resource: 'ORE', price: 12, amount: 4000, mine: false }],
  });
  const intents = decide(better);
  check(
    'при живом покупателе бот идет к нему, а не к станции',
    intents.some((i) => i.kind === 'TAKE') && !intents.some((i) => i.kind === 'STATION'),
    intents.map((i) => i.kind).join(', '),
  );
}

{
  // Мелочь сдавать не стоит: рейс на хаб дороже выручки.
  const crumbs = snapshotWith({
    character: 'TRADER',
    hubStorage: { ore: 100, polymers: 0, free: 4900 },
  });
  check('мелочь станции не сдается', !decide(crumbs).some((i) => i.kind === 'STATION'));
}

/* ------------------------- 5. Прогон недели ------------------------- */

console.log('\n=== 5. Неделя жизни бота ===');

/**
 * Симуляция без БД: те же формулы, что и у живого игрока, и те же решения,
 * что примет director. Проверяется главное свойство — бот не встает
 * и развивается темпом, похожим на человеческий.
 */
function simulate(character: 'AGGRESSOR' | 'TRADER', days: number) {
  const levels: BuildingLevels = emptyLevels();
  const techs = emptyTechLevels();
  let stock = { ore: 1500, polymers: 800, plasma: 400 };
  let time = 0;
  let buildFree = 0;
  let labFree = 0;
  // Верфь собирает заказы подряд, а не разом: без этой очереди симуляция
  // позволяла бы боту скупать корабли каждые полминуты и съедать всю экономику.
  let yardFree = 0;
  let idle = 0;
  let stall = 0;
  let worstStall = 0;
  let midway: BuildingLevels | null = null;
  let midwayTechs = 0;
  const ships = emptyShipCounts();
  const defenses = emptyDefenseCounts();
  const step = 30;

  for (let elapsed = 0; elapsed < days * 86400; elapsed += step) {
    const perSecond = productionPerSecond(
      levels,
      RICHNESS,
      economyBonuses(techs),
      0,
      undefined,
      timeCompressionDrain(techs),
    );
    const capacity = storageCapacity(levels);
    const room = Math.max(0, capacity - storedTotal(stock));
    const mined = (perSecond.ore + perSecond.polymers + perSecond.plasma) * step;
    const scale = mined > room && mined > 0 ? room / mined : 1;
    stock = {
      ore: stock.ore + perSecond.ore * step * scale,
      polymers: stock.polymers + perSecond.polymers * step * scale,
      plasma: stock.plasma + perSecond.plasma * step * scale,
    };
    time += step;

    let acted = false;

    if (time >= buildFree) {
      const base = testBase('sim', { levels, resources: stock });
      const plan = buildingPlan(base, techs, character);
      const pressure = storedTotal(stock) >= capacity * 0.9;
      const share = pressure ? 1 : personality(character).budget.economy;
      const affordable = (type: (typeof plan)[number]) => {
        const cost = upgradeCost(type, levels[type] + 1);
        const fits =
          stock.ore * share >= cost.ore &&
          stock.polymers * share >= cost.polymers &&
          stock.plasma * share >= cost.plasma;
        if (fits) return true;
        // Та же поблажка, что и в decide: цель, недостижимую для доли даже при
        // полном складе, бот оплачивает из общего запаса.
        const beyondShare = cost.ore + cost.polymers + cost.plasma > capacity * share;
        return (
          beyondShare &&
          stock.ore >= cost.ore &&
          stock.polymers >= cost.polymers &&
          stock.plasma >= cost.plasma
        );
      };
      // Та же развилка, что и в decide: копим на главное, но на забитом складе
      // берем первое посильное.
      const next = pressure ? plan.find(affordable) : plan[0] && affordable(plan[0]) ? plan[0] : undefined;

      if (next) {
        const cost = upgradeCost(next, levels[next] + 1);
        stock = {
          ore: stock.ore - cost.ore,
          polymers: stock.polymers - cost.polymers,
          plasma: stock.plasma - cost.plasma,
        };
        buildFree = time + buildSeconds(next, levels[next] + 1, undefined, buildSpeedup(techs));
        levels[next] += 1;
        acted = true;
      }
    }

    // Верфь и оборона: без них у плазмы нет стока, она забивает общий лимит
    // склада и душит добычу руды — тупик, которого у живого бота нет, потому
    // что он строит корабли теми же намерениями, что и здания.
    if (levels.SHIPYARD > 0 && time >= yardFree) {
      const snapshot = {
        ...emptyBotSnapshot(character),
        techs,
        market: [],
        bases: [testBase('sim', { levels, ships, defenses, resources: stock })],
      };
      for (const intent of decide(snapshot)) {
        if (intent.kind === 'SHIPS') {
          const cost = shipCost(intent.ship);
          const affordableCount = Math.min(
            intent.count,
            Math.floor(stock.ore / Math.max(cost.ore, 1)),
            Math.floor(stock.polymers / Math.max(cost.polymers, 1)),
            cost.plasma > 0 ? Math.floor(stock.plasma / cost.plasma) : intent.count,
          );
          if (affordableCount > 0) {
            stock = {
              ore: stock.ore - cost.ore * affordableCount,
              polymers: stock.polymers - cost.polymers * affordableCount,
              plasma: stock.plasma - cost.plasma * affordableCount,
            };
            ships[intent.ship] += affordableCount;
            yardFree =
              time +
              shipUnitSeconds(intent.ship, levels.SHIPYARD, undefined, buildSpeedup(techs)) *
                affordableCount;
            acted = true;
          }
        }
        if (intent.kind === 'DEFENSE') {
          const cost = defenseCost(intent.defense);
          const affordableCount = Math.min(
            intent.count,
            Math.floor(stock.ore / Math.max(cost.ore, 1)),
            Math.floor(stock.polymers / Math.max(cost.polymers, 1)),
            cost.plasma > 0 ? Math.floor(stock.plasma / cost.plasma) : intent.count,
          );
          if (affordableCount > 0) {
            stock = {
              ore: stock.ore - cost.ore * affordableCount,
              polymers: stock.polymers - cost.polymers * affordableCount,
              plasma: stock.plasma - cost.plasma * affordableCount,
            };
            defenses[intent.defense] += affordableCount;
            yardFree =
              time +
              defenseUnitSeconds(intent.defense, levels.SHIPYARD, undefined, buildSpeedup(techs)) *
                affordableCount;
            acted = true;
          }
        }
      }
    }

    if (time >= labFree && levels.SCIENCE_CENTER > 0) {
      const share = personality(character).budget.research;
      const purse = { ore: stock.ore * share, polymers: stock.polymers * share, plasma: stock.plasma * share };
      const tech = nextResearch(techs, levels, character, purse);
      if (tech) {
        const cost = researchCost(tech, techs[tech] + 1);
        stock = {
          ore: stock.ore - cost.ore,
          polymers: stock.polymers - cost.polymers,
          plasma: stock.plasma - cost.plasma,
        };
        labFree = time + researchSeconds(tech, techs[tech] + 1, levels.SCIENCE_CENTER, techs);
        techs[tech] += 1;
        acted = true;
      }
    }

    if (acted) {
      stall = 0;
    } else if (time >= buildFree) {
      idle += step;
      stall += step;
      if (stall > worstStall) worstStall = stall;
    }

    if (midway === null && time >= (days * 86400) / 2) {
      midway = { ...levels };
      midwayTechs = Object.values(techs).reduce((sum, level) => sum + level, 0);
    }
  }

  return { levels, techs, ships, defenses, idle, time, worstStall, midway: midway ?? levels, midwayTechs };
}

/** Суммарный уровень всей инфраструктуры — по нему видно, растет ли база. */
function totalLevels(levels: BuildingLevels): number {
  return Object.values(levels).reduce((sum, level) => sum + level, 0);
}

for (const character of ['AGGRESSOR', 'TRADER'] as const) {
  const run = simulate(character, 7);
  const label = BOT_PERSONALITIES[character].label;

  check(
    `${label}: за неделю поднял шахты`,
    run.levels.ORE_MINE >= 10,
    `руда ${run.levels.ORE_MINE}, полимеры ${run.levels.POLYMER_PLANT}, плазма ${run.levels.PLASMA_REACTOR}`,
  );
  check(
    `${label}: не забыл ни один ресурс`,
    run.levels.POLYMER_PLANT > 0 && run.levels.PLASMA_REACTOR > 0,
  );
  check(
    `${label}: поставил лабораторию и верфь`,
    run.levels.SCIENCE_CENTER > 0 && run.levels.SHIPYARD > 0,
    `лаб ${run.levels.SCIENCE_CENTER}, верфь ${run.levels.SHIPYARD}`,
  );
  check(
    `${label}: наука ушла дальше первого уровня`,
    Object.values(run.techs).reduce((sum, level) => sum + level, 0) >= 8,
    `суммарно ${Object.values(run.techs).reduce((sum, level) => sum + level, 0)} уровней`,
  );
  // Простой сам по себе ни о чем не говорит: на восемнадцатом уровне шахты
  // следующий стоит часов добычи, и живой игрок ждет ровно так же. Важно
  // другое — что бот не встал насовсем.
  // Прогресс — это не только застройка: бот, ушедший во второй половине
  // недели в науку и флот, не стоит на месте. Замирание насмерть ловит
  // отдельная проверка ниже, по самому долгому простою.
  const midway = totalLevels(run.midway) + run.midwayTechs;
  const finish = totalLevels(run.levels) + Object.values(run.techs).reduce((a, b) => a + b, 0);
  check(
    `${label}: продолжает расти во второй половине недели`,
    finish > midway,
    `${midway} → ${finish} уровней всего`,
  );
  /*
   * Порог не «сколько ждать не обидно», а «не замер ли бот насовсем».
   * На восемнадцатом уровне шахты один апгрейд стоит десятки часов добычи,
   * а направление тратит только свою долю — умножьте одно на другое, и пауза
   * в двое суток окажется обычной арифметикой. Настоящие тупики, которые эта
   * проверка ловила, выглядели иначе: сто с лишним часов подряд и нулевой
   * прирост за половину недели.
   */
  check(
    `${label}: не замирает насовсем`,
    run.worstStall < 72 * 3600,
    `худший простой ${(run.worstStall / 3600).toFixed(1)} ч, всего ${Math.round((run.idle / run.time) * 100)}%`,
  );
}

{
  // Характеры должны расходиться, иначе смысла в выборе нет.
  const aggro = simulate('AGGRESSOR', 7);
  const trader = simulate('TRADER', 7);
  // Уровень верфи у обоих доходит до потолка, который задает экономика,
  // поэтому характер виден не в нем, а в том, сколько вложено во флот.
  check(
    'агрессор вкладывает во флот больше торговца',
    spentOnFleet(aggro.ships) > spentOnFleet(trader.ships),
    `${fmtUnits(spentOnFleet(aggro.ships))} против ${fmtUnits(spentOnFleet(trader.ships))}`,
  );
  check(
    'торговец все же поднимает верфь выше первого уровня',
    trader.levels.SHIPYARD >= 5,
    `верфь ${trader.levels.SHIPYARD}: крейсерам нужен пятый`,
  );
}

/* ------------------------- 6. Состав эскадры ------------------------- */

console.log('\n=== 6. Эскадра не вырождается ===');

{
  // Жадный по цене бот настроил бы тысячу истребителей: они дешевле всех.
  // Доли характера должны этому мешать.
  const ships = emptyShipCounts();
  ships.LIGHT_FIGHTER = 500;

  // База развита: иначе пятьсот истребителей сами по себе перебирают долю
  // флота в портфеле, и бот справедливо откажется строить что-либо еще.
  const intents = decide(
    snapshotWith({
      techs: { ...emptyTechLevels(), COMBUSTION_DRIVE: 6, WEAPONS_TECH: 6, SHIELDS_TECH: 4, ARMOR_TECH: 4 },
      bases: [
        testBase('home', {
          levels: {
            ...emptyLevels(),
            ORE_MINE: 20,
            POLYMER_PLANT: 20,
            PLASMA_REACTOR: 16,
            POWER_PLANT: 20,
            SHIPYARD: 8,
          },
          ships,
          defenses: emptyDefenseCounts(),
          resources: { ore: 400_000, polymers: 300_000, plasma: 120_000 },
        }),
      ],
    }),
  );

  const order = intents.find((intent) => intent.kind === 'SHIPS');
  check(
    'перекос в истребителях лечится другим классом',
    order?.kind === 'SHIPS' && order.ship !== 'LIGHT_FIGHTER',
    order?.kind === 'SHIPS' ? `заказал ${order.ship}` : 'заказа нет',
  );
  check(
    'заказ не превышает разумную партию',
    order?.kind === 'SHIPS' ? order.count <= 10 : true,
    order?.kind === 'SHIPS' ? `${order.count} шт.` : '',
  );
}

{
  const ships = emptyShipCounts();
  ships.CRUISER = 10;
  check(
    'оценка силы эскадры считается по стоимости',
    spentOnFleet(ships) > 0,
    `${spentOnFleet(ships)} ед.`,
  );
}

/* ------------------------- 6б. Полный склад ------------------------- */

console.log('\n=== 6б. Полный склад лечится своим хранилищем ===');

{
  /*
   * Прежний тупик: склад забит полимерами, дефицитной руды меньше, чем стоит
   * самое дешевое здание, а добыча на полном складе равнялась нулю сразу
   * по всем трем ресурсам — значит руда не появилась бы уже никогда.
   *
   * С раздельными складами такого состояния не существует: полный склад
   * полимеров останавливает только полимеры. Проверяем, что бот при этом
   * делает осмысленное — расширяет то хранилище, которое действительно жмет.
   */
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 4,
    POLYMER_PLANT: 5,
    PLASMA_REACTOR: 1,
    POWER_PLANT: 3,
    SCIENCE_CENTER: 2,
    SHIPYARD: 2,
    // Рудный и плазменный с запасом: иначе бот справедливо возьмется за них —
    // они малы для его же добычи, — и проверка будет не про полный склад.
    ORE_STORAGE: 8,
    POLYMER_STORAGE: 1,
    PLASMA_STORAGE: 8,
  };
  const caps = storageCapacities(levels);
  const base = testBase('home', {
    levels,
    resources: { ore: 576, polymers: caps.polymers, plasma: 1025 },
  });

  check(
    'бот расширяет именно тот склад, который полон',
    nextBuilding(base, emptyTechLevels(), 'TRADER') === 'POLYMER_STORAGE',
    `${nextBuilding(base, emptyTechLevels(), 'TRADER')}`,
  );

  const intents = decide(snapshotWith({ character: 'TRADER', researching: true, bases: [base] }));
  check(
    'и делает это, а не стоит',
    intents.some((intent) => intent.kind === 'BUILD' && intent.building === 'POLYMER_STORAGE'),
    intents.map((i) => i.kind).join(', ') || 'ничего',
  );
}

{
  /*
   * Аварийный выход нужен и после разделения складов, но случай стал редким:
   * поздняя игра, где добыча давно переросла хранилища. Все три склада полны,
   * а любая постройка стоит больше, чем они вмещают вместе, — копить физически
   * некуда, и без выхода бот стоял бы, имея полные закрома.
   */
  const levels = {
    ...emptyLevels(),
    ORE_MINE: 25,
    POLYMER_PLANT: 25,
    PLASMA_REACTOR: 25,
    POWER_PLANT: 30,
    SCIENCE_CENTER: 20,
    SHIPYARD: 2,
    ORE_STORAGE: 3,
    POLYMER_STORAGE: 3,
    PLASMA_STORAGE: 3,
  };
  const caps = storageCapacities(levels);
  const stuck = snapshotWith({
    character: 'TRADER',
    // Зонду нужна вычислительная техника — без нее выхода не нашлось бы.
    techs: { ...emptyTechLevels(), ENERGY_TECH: 2, COMBUSTION_DRIVE: 3, COMPUTING_TECH: 2, MINING_TECH: 1 },
    researching: true,
    bases: [
      testBase('home', {
        levels,
        resources: { ore: caps.ore, polymers: caps.polymers, plasma: caps.plasma },
      }),
    ],
  });

  const intents = decide(stuck);
  check(
    'при полных складах и неподъемных постройках бот не стоит',
    intents.some((intent) => intent.kind === 'SHIPS'),
    intents.map((i) => (i.kind === 'SHIPS' ? `SHIPS:${i.ship}` : i.kind)).join(', ') || 'ничего',
  );

  /*
   * Проверяем свойство, а не конкретный корпус. С полными складами бот богат,
   * и чаще всего его разблокирует обычная ветка верфи — до аварийного выхода
   * дело не доходит. Выход остается последним рубежом на случай, когда и она
   * упрется в долю портфеля; настаивать в тесте на зонде значило бы проверять
   * реализацию вместо поведения.
   */
  const spending = intents.filter((intent) => intent.kind !== 'ORDER');
  check(
    'трата освобождает место на складе',
    spending.length > 0,
    spending.map((i) => i.kind).join(', ') || 'ничего',
  );
}

/* ------------------------- 7. План от языковой модели ------------------------- */

console.log('\n=== 7. План модели проверяется как недоверенные данные ===');

{
  const base = personality('AGGRESSOR');

  check('мусор вместо объекта отвергается', parsePlan('привет', 'AGGRESSOR') === null);
  check('null отвергается', parsePlan(null, 'AGGRESSOR') === null);
}

{
  // Выдуманные названия — самый вероятный способ уронить исполнителя:
  // несуществующий класс корабля дошел бы до orderShips и до БД.
  const plan = parsePlan(
    {
      researchOrder: ['ВЫДУМАННАЯ_ТЕХНОЛОГИЯ', 'ENERGY_TECH', 'МАГИЯ'],
      fleetMix: { ЗВЕЗДА_СМЕРТИ: 0.9, CRUISER: 0.1 },
      defenseMix: { ЩИТ_ПЛАНЕТЫ: 1 },
    },
    'AGGRESSOR',
  );

  check(
    'неизвестные технологии отброшены, известная осталась',
    plan !== null && plan.researchOrder.length === 1 && plan.researchOrder[0] === 'ENERGY_TECH',
    plan ? plan.researchOrder.join(', ') : 'плана нет',
  );
  check(
    'выдуманный класс корабля не проходит',
    plan !== null && !Object.keys(plan.fleetMix).includes('ЗВЕЗДА_СМЕРТИ'),
    plan ? Object.keys(plan.fleetMix).join(', ') : '',
  );
  check(
    'состав обороны без единого известного класса откатывается к характеру',
    plan !== null &&
      JSON.stringify(plan.defenseMix) === JSON.stringify(personality('AGGRESSOR').defenseMix),
  );
}

{
  // Доли обязаны сводиться к единице: сумма больше означала бы, что каждое
  // направление считает себя недофинансированным всегда, и бот не копил бы ни на что.
  const plan = parsePlan(
    { budget: { economy: 5, research: 5, fleet: 5, defense: 5 } },
    'TRADER',
  );
  const sum = plan ? plan.budget.economy + plan.budget.research + plan.budget.fleet + plan.budget.defense : 0;
  check('доли бюджета сводятся к единице', Math.abs(sum - 1) < 0.0001, `сумма ${sum.toFixed(4)}`);
}

{
  const plan = parsePlan(
    { budget: { economy: -3, research: null, fleet: 'много', defense: Infinity } },
    'TRADER',
  );
  const ok =
    plan !== null &&
    Object.values(plan.budget).every((value) => Number.isFinite(value) && value >= 0 && value <= 1);
  check('отрицательные, пустые и бесконечные доли не проходят', ok, JSON.stringify(plan?.budget));
}

{
  /*
   * Самоубийственный бюджет модель выбирает охотно: в первом же живом ответе
   * она запросила 0.2 на экономику и 0.6 на флот — ровно ту конфигурацию,
   * при которой бот к седьмому дню застревает на двенадцатом уровне шахт
   * и перестает расти. Границы должны это вылавливать.
   */
  const suicidal = parsePlan(
    { budget: { economy: 0.2, research: 0.1, fleet: 0.6, defense: 0.1 } },
    'AGGRESSOR',
  );
  check(
    'флот не может съесть экономику бота',
    suicidal !== null && suicidal.budget.economy >= 0.3 && suicidal.budget.fleet <= 0.5,
    suicidal
      ? `экономика ${suicidal.budget.economy.toFixed(2)}, флот ${suicidal.budget.fleet.toFixed(2)}`
      : 'плана нет',
  );
}

{
  // Перевес меньше единицы — это не смелость, а слив флота, который бот копил неделю.
  const reckless = parsePlan({ raidAdvantage: 0.1, colonyAmbition: 9999 }, 'AGGRESSOR');
  check(
    'порог набега не опускается ниже единицы',
    reckless !== null && reckless.raidAdvantage >= 1,
    `${reckless?.raidAdvantage}`,
  );
  check(
    'амбиции по колониям зажаты',
    reckless !== null && reckless.colonyAmbition <= 12,
    `${reckless?.colonyAmbition}`,
  );
}

{
  // Осмысленный план должен доезжать до решений целиком.
  const plan = parsePlan(
    {
      budget: { economy: 0.5, research: 0.2, fleet: 0.2, defense: 0.1 },
      researchOrder: ['MINING_TECH', 'ENERGY_TECH'],
      fleetMix: { LARGE_CARGO: 1 },
      defenseMix: { CANNON: 1 },
      colonyAmbition: 4,
      raidAdvantage: 2,
      note: 'Копим экономику, воевать не спешим.',
    },
    'AGGRESSOR',
  );
  const profile = withPlan('AGGRESSOR', plan);

  // Доли сравниваем с допуском: они проходят нормировку, и 0.5 после деления
  // на сумму дробей — это 0.5000000000000001.
  check(
    'план заменяет числа характера',
    Math.abs(profile.budget.economy - 0.5) < 0.001 &&
      profile.colonyAmbition === 4 &&
      profile.raidAdvantage === 2,
    `экономика ${profile.budget.economy.toFixed(3)}, колоний ${profile.colonyAmbition}`,
  );
  check(
    'но не трогает то, чего в нем нет',
    profile.label === personality('AGGRESSOR').label && profile.raids === personality('AGGRESSOR').raids,
  );

  // «Горное дело» требует энергетику первого уровня, поэтому по плану,
  // ведущему с него, бот сперва берет пререквизит — и это правильно:
  // порядок задает приоритет, а не право обойти требования.
  const levels = { ...emptyLevels(), SCIENCE_CENTER: 3 };
  const rich = { ore: 1e9, polymers: 1e9, plasma: 1e9 };
  const gated = nextResearch(emptyTechLevels(), levels, 'AGGRESSOR', rich, profile);
  check('закрытая требованиями ветка не стопорит бота', gated === 'ENERGY_TECH', `${gated}`);

  const opened = nextResearch(
    { ...emptyTechLevels(), ENERGY_TECH: 1 },
    levels,
    'AGGRESSOR',
    rich,
    profile,
  );
  check('как только требование выполнено, план ведет свою ветку', opened === 'MINING_TECH', `${opened}`);
}

{
  /*
   * Приоритеты модели идут впереди характерных, но не вместо них. Полная
   * замена выглядела логично и вышла боком: назвав три здания, модель молча
   * выбрасывала лабораторию и верфь, и живой бот простоял с ними
   * на четвертом уровне при шахтах седьмого несколько часов.
   */
  const plan = parsePlan({ buildingFocus: ['PLASMA_REACTOR', 'POWER_PLANT'] }, 'TRADER');
  const profile = withPlan('TRADER', plan);
  const base = personality('TRADER').buildingFocus;

  check(
    'названное моделью идет первым',
    profile.buildingFocus[0] === 'PLASMA_REACTOR' && profile.buildingFocus[1] === 'POWER_PLANT',
    profile.buildingFocus.join(', '),
  );
  check(
    'а приоритеты характера не пропадают',
    base.every((building) => profile.buildingFocus.includes(building)),
    `характер: ${base.join(', ')} → итог: ${profile.buildingFocus.join(', ')}`,
  );
}

{
  // Без плана поведение обязано остаться ровно прежним: ИИ — надстройка,
  // а не условие работы бота.
  const empty = withPlan('TRADER', null);
  check(
    'без плана бот играет по статичному характеру',
    JSON.stringify(empty) === JSON.stringify(personality('TRADER')),
  );
}

/* ------------------------- 7б. Состав эскадры ------------------------- */

console.log('\n=== 7б. Инструменты не входят в состав эскадры ===');

{
  /*
   * Петля, которую поймало наблюдение. Модели показывают текущий состав флота,
   * и она зеркалит его в желаемый: увидев полсотни зондов, ставит зондам
   * половину доли, код достраивает до нее, в следующей сводке зондов больше.
   * Живой бот дошел так до девяноста четырех разведывательных дронов
   * при пустом боевом составе.
   */
  const mirrored = parsePlan(
    { fleetMix: { PROBE: 0.5, SMALL_CARGO: 0.5, RECYCLER: 0.3, COLONY_SHIP: 0.2 } },
    'TRADER',
  );
  check(
    'зонд, переработчик и колонизатор в состав не попадают',
    mirrored !== null &&
      !('PROBE' in mirrored.fleetMix) &&
      !('RECYCLER' in mirrored.fleetMix) &&
      !('COLONY_SHIP' in mirrored.fleetMix),
    mirrored ? Object.keys(mirrored.fleetMix).join(', ') : 'плана нет',
  );
  check(
    'а грузовик остается',
    mirrored !== null && mirrored.fleetMix.SMALL_CARGO === 0.5,
    mirrored ? JSON.stringify(mirrored.fleetMix) : '',
  );
}

{
  // Состав из одних инструментов равносилен пустому: откатываемся к характеру.
  const onlyTools = parsePlan({ fleetMix: { PROBE: 1, RECYCLER: 1 } }, 'AGGRESSOR');
  check(
    'состав из одних инструментов откатывается к характеру',
    onlyTools !== null &&
      JSON.stringify(onlyTools.fleetMix) === JSON.stringify(personality('AGGRESSOR').fleetMix),
  );
}

/* ------------------------- 8. Директивы модели ------------------------- */

console.log('\n=== 8. Поручения модели проверяются по сводке ===');

{
  const world = snapshotWith({
    raidTargets: [
      { planetId: 'враг-1', commanderId: 'сосед-1', accountAgeDays: 30, knownStrength: 500, distance: 2 },
    ],
    freePlanets: [{ planetId: 'пустая-1', systemId: 's1', distance: 3 }],
    debrisFields: [{ planetId: 'враг-1', ore: 5000, polymers: 3000, distance: 2 }],
  });

  /*
   * Главное свойство: модель распоряжается только тем, что ей показали.
   * Выдуманная планета не доедет до боя, потому что ее не с чем сопоставить.
   */
  const invented = parseDirectives(
    [
      { kind: 'ATTACK', planetId: 'планета-которой-нет', why: 'хочу' },
      { kind: 'PEACE', commanderId: 'кто-то-выдуманный', why: 'хочу' },
      { kind: 'COLONIZE', planetId: 'тоже-выдумка', why: 'хочу' },
      { kind: 'MESSAGE', commanderId: 'призрак', subject: 'привет', body: 'текст', why: 'хочу' },
    ],
    world,
  );
  check('выдуманные цели и адресаты отброшены', invented.length === 0, `осталось ${invented.length}`);

  const real = parseDirectives(
    [
      { kind: 'ATTACK', planetId: 'враг-1', why: 'слабее меня' },
      { kind: 'COLONIZE', planetId: 'пустая-1', why: 'рядом' },
      { kind: 'HARVEST', planetId: 'враг-1', why: 'поле обломков' },
      { kind: 'MESSAGE', commanderId: 'сосед-1', subject: 'Ультиматум', body: 'Уходи', why: 'давлю' },
    ],
    world,
  );
  check('названное в сводке проходит', real.length === 4, real.map((d) => d.kind).join(', '));
}

{
  const world = snapshotWith({
    raidTargets: [
      { planetId: 'p', commanderId: 'c', accountAgeDays: 30, knownStrength: 100, distance: 1 },
    ],
  });
  const many = parseDirectives(
    Array.from({ length: 12 }, () => ({ kind: 'ATTACK', planetId: 'p', why: 'еще' })),
    world,
  );
  check('список поручений ограничен', many.length <= 4, `${many.length} штук`);
}

{
  /*
   * Новые поручения проверяются как все прочие: назвать можно только того,
   * кого показали. Помощь — решение модели, но адресат должен существовать.
   */
  const world = snapshotWith({
    raidTargets: [target({ planetId: 'логово', commanderId: 'сосед' })],
  });
  const aid = parseDirectives(
    [
      { kind: 'AID', commanderId: 'сосед', ore: 5000, polymers: 2000, why: 'разорили' },
      { kind: 'REINFORCE', commanderId: 'сосед', why: 'не выстоит один' },
      { kind: 'SCOUT', planetId: 'логово', why: 'надо знать' },
    ],
    world,
  );
  check('помощь и разведка проходят проверку', aid.length === 3, `${aid.length} из 3`);

  const strangers = parseDirectives(
    [
      { kind: 'AID', commanderId: 'выдуманный', ore: 5000, polymers: 0, why: '' },
      { kind: 'REINFORCE', commanderId: 'выдуманный', why: '' },
      { kind: 'SCOUT', planetId: 'выдуманная', why: '' },
      { kind: 'AID', commanderId: 'сосед', ore: 0, polymers: 0, why: 'пустой караван' },
    ],
    world,
  );
  check('помощь выдуманному соседу отбрасывается', strangers.length === 0, `${strangers.length} штук`);
}

{
  const world = snapshotWith({});
  const junk = parseDirectives(
    [
      { kind: 'SELL', resource: 'ЗОЛОТО', amount: 100, price: 5, why: '' },
      { kind: 'SELL', resource: 'ORE', amount: -50, price: 5, why: '' },
      { kind: 'SELL', resource: 'ORE', amount: 100, price: 0, why: '' },
      { kind: 'ВЗОРВАТЬ_ВСЕ', why: '' },
      'не объект',
    ],
    world,
  );
  check('мусор в заявках не проходит', junk.length === 0, `${junk.length} штук`);

  const good = parseDirectives([{ kind: 'SELL', resource: 'ORE', amount: 100, price: 12, why: 'излишек' }], world);
  check('корректная заявка проходит', good.length === 1 && good[0]?.kind === 'SELL');
}

{
  /*
   * Риск модели позволен — игрок тоже рискует, и бот, который никогда
   * не проигрывает, выглядит машиной. Но пол есть.
   */
  check('втрое сильнее — безнадежно', hopeless(1000, 3001));
  check('вдвое сильнее — можно рискнуть', !hopeless(1000, 2000));
  check('без флота лететь нельзя', hopeless(0, 1));
  check('неразведанная цель безнадежна по определению', hopeless(1_000_000, null));
}

/* ------------------------- 9. Повод для вызова модели ------------------------- */

console.log('\n=== 9. Повторный повод не будит модель заново ===');

{
  /*
   * Ключ повода не несет чисел, и это ровно то, на чем защита сломалась.
   *
   * Сравнение шло по тексту, а в тексте стояла добыча набега: «разбит,
   * унесли 1271», следом «унесли 2700» — для строкового сравнения это разные
   * новости, хотя новость одна. Живая война шла набегом в минуту, и двое
   * воюющих сожгли 177 вызовов из 389 за сутки, докладывая одно и то же.
   */
  const first = battleShock(false, false, 'Хижак', 1271);
  const second = battleShock(false, false, 'Хижак', 2700);
  check('добыча меняет текст повода', first.text !== second.text, second.text);
  check('добыча не меняет ключ повода', first.key === second.key, first.key);

  const won = battleShock(false, true, 'Хижак', 0);
  check('отбитый набег — другая новость', won.key !== first.key, won.key);

  const other = battleShock(false, false, 'Крамар', 1271);
  check('другой противник — другая новость', other.key !== first.key, other.key);

  const raid = battleShock(true, true, 'Купець', 660);
  const raidAgain = battleShock(true, true, 'Купець', 580);
  check('свой набег тоже сводится к одному ключу', raid.key === raidAgain.key, raid.key);
  check('свой набег отличается от чужого', raid.key !== battleShock(false, true, 'Купець', 660).key);
}

{
  // Цена в поводе тоже меняется каждый раз, а новость все та же:
  // рынок поехал вниз.
  const was = { market: [{ resource: 'ORE', price: 10, skew: 0.5 }] };
  // Перекос в снимке двойной: общий идет в цену, чужой — в решение о побудке.
  const market = (price: number, skew: number | null, foreignSkew = skew) => [
    { resource: 'ORE' as const, reference: price, seeded: false, demand: 0, supply: 0, skew, foreignSkew },
  ];

  const drop = marketShock(was, market(8, 0.5));
  const deeper = marketShock(was, market(7, 0.5));
  check('цена ушла — повод есть', drop !== null, drop?.text);
  check('разная просадка — один ключ', drop?.key === deeper?.key, drop?.key);
  check('текст просадки несет саму цену', drop?.text !== deeper?.text);

  /*
   * Направление в ключ не идет. Цена ходит туда-обратно, перекос тем более:
   * четверо ботов на одном тонком хабе переворачивали его друг другу за пять
   * минут, и «стали разбирать» / «перестали брать» шли как две разные новости.
   */
  const rise = marketShock({ market: [{ resource: 'ORE', price: 10, skew: 0.5 }] }, market(13, 0.5));
  check('подорожание — та же новость, что и просадка', rise?.key === drop?.key, rise?.key);
  check('текст подорожания все же свой', rise?.text !== drop?.text, rise?.text);

  const flip = marketShock(was, market(10, -0.5));
  check('разворот перекоса — та же новость про руду', flip?.key === 'market:ORE', flip?.key);
  check('рынок отработан на такт плана', flip?.ttl === MARKET_SHOCK_TTL_MS);
  check('происшествие отработано на час', battleShock(false, false, 'Хижак', 1).ttl === SHOCK_TTL_MS);

  const polymers = marketShock(
    { market: [{ resource: 'POLYMERS', price: 10, skew: 0.5 }] },
    [{ resource: 'POLYMERS' as const, reference: 8, seeded: false, demand: 0, supply: 0, skew: 0.5, foreignSkew: 0.5 }],
  );
  check('другой ресурс — другая новость', polymers?.key === 'market:POLYMERS', polymers?.key);

  const quiet = marketShock(was, market(10.2, 0.5));
  check('дрожание вокруг цены не будит', quiet === null);

  /*
   * Стакан тонкий, и своей же снятой заявкой бот переворачивал перекос
   * с плюса на минус, читал это как новость и будил модель — 27 поводов
   * из 33 за ночь. Разворот считается по чужим заявкам.
   */
  const ownFlip = marketShock(was, market(10, -0.5, 0.5));
  check('свой разворот не будит', ownFlip === null);

  const alien = marketShock(was, market(10, 0.5, -0.5));
  check('чужой разворот будит', alien?.key === 'market:ORE', alien?.key);

  const alone = marketShock(was, market(10, -0.5, null));
  check('без чужих заявок разворота нет', alone === null);
}

{
  /*
   * Память на один повод: чередующиеся события проходили ее насквозь.
   * Живого Купця одна и та же вражда будила пять раз за ночь — война, бой,
   * война, бой, — потому что каждый следующий ключ затирал предыдущий.
   */
  const now = 1_000_000_000;
  const war = 'war:Хижак';
  const lost = 'battle:defense:Хижак:lost';

  let shocks = markShock({}, war, SHOCK_TTL_MS, now);
  shocks = markShock(shocks, lost, SHOCK_TTL_MS, now + 60_000);
  const memory = { shocks };

  const seen = readShocks(memory, now + 120_000);
  check('оба повода помнятся разом', seen[war] !== undefined && seen[lost] !== undefined);

  const later = readShocks(memory, now + SHOCK_TTL_MS + 60_001);
  check('просроченные поводы забываются', Object.keys(later).length === 0);

  const half = readShocks(memory, now + SHOCK_TTL_MS + 30_000);
  check('забывается по своему сроку, а не разом', half[lost] !== undefined && half[war] === undefined);

  // Срок хранится у каждого ключа свой: рынок живет дольше происшествия.
  const mixed = { shocks: markShock(markShock({}, 'market:ORE', MARKET_SHOCK_TTL_MS, now), lost, SHOCK_TTL_MS, now) };
  const between = readShocks(mixed, now + SHOCK_TTL_MS + 1000);
  check('рынок помнится дольше боя', between['market:ORE'] !== undefined && between[lost] === undefined);

  check('мусор в памяти читается как пусто', Object.keys(readShocks({ shocks: 'не объект' })).length === 0);
  check('битая отметка времени не проходит', Object.keys(readShocks({ shocks: { x: 'вчера' } })).length === 0);
}

/* ------------------------- Итог ------------------------- */

const passed = results.filter((entry) => entry.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
if (passed !== results.length) process.exitCode = 1;
