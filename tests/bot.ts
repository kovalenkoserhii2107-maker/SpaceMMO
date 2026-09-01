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
} from '../src/game/bot/decide.js';
import { NEWBIE_SHIELD_DAYS, BOT_PERSONALITIES, personality } from '../src/game/bot/personality.js';
import {
  buildSeconds,
  emptyLevels,
  productionPerSecond,
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

const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const RICHNESS = { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 };

/* ------------------------- 1. Щит новичка ------------------------- */

console.log('\n=== 1. Щит новичка ===');

function target(overrides: Partial<BotRaidTarget> = {}): BotRaidTarget {
  return {
    planetId: 'p1',
    commanderId: 'victim',
    accountAgeDays: 30,
    knownStrength: 100,
    distance: 1,
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
  const capacity = storageCapacity(levels);
  const base = testBase('b', {
    levels,
    resources: { ore: capacity * 0.95, polymers: 0, plasma: 0 },
  });
  check('на полном складе бот расширяет хранилище', nextBuilding(base, emptyTechLevels(), 'TRADER') === 'STORAGE');
}

{
  // Просевшая энергия режет добычу на всех шахтах разом.
  const levels = { ...emptyLevels(), ORE_MINE: 8, POLYMER_PLANT: 8, PLASMA_REACTOR: 6, POWER_PLANT: 1 };
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
    // Справочные цены бот получает от планировщика: без них коридора нет
    // и торговать он не станет вовсе.
    market: [
      { resource: 'ORE', reference: 10 },
      { resource: 'POLYMERS', reference: 14 },
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
    check(
      'часть трюмов идет под добычу, часть остается дома',
      raid.ships.LARGE_CARGO === 5,
      `${raid.ships.LARGE_CARGO} из 10`,
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

/* ------------------------- 4. Биржа ------------------------- */

console.log('\n=== 4. Ордера в коридоре ===');

{
  const levels = { ...emptyLevels(), STORAGE: 3 };
  const capacity = storageCapacity(levels);
  const rich = snapshotWith({
    character: 'TRADER',
    credits: 100_000,
    bases: [
      testBase('home', {
        levels,
        // Руды больше половины склада — излишек; полимеров почти нет — надо купить.
        resources: { ore: capacity * 0.8, polymers: capacity * 0.05, plasma: 0 },
      }),
    ],
  });

  const orders = decide(rich).filter((intent) => intent.kind === 'ORDER');
  const sell = orders.find((o) => o.kind === 'ORDER' && o.side === 'SELL');
  const buy = orders.find((o) => o.kind === 'ORDER' && o.side === 'BUY');

  check('излишек выставляется на продажу', sell !== undefined);
  check('нехватка выставляется на покупку', buy !== undefined);

  if (sell?.kind === 'ORDER' && buy?.kind === 'ORDER') {
    const margin = BOT_PERSONALITIES.TRADER.trade.margin;
    check(
      'продает дороже справочной, покупает дешевле',
      sell.price > 10 && buy.price < 14,
      `продажа ${sell.price}, покупка ${buy.price}, коридор ±${Math.round(margin * 100)}%`,
    );
    check('ордера положительного объема', sell.amount > 0 && buy.amount > 0);
  }
}

{
  // Кассы нет — покупать не на что, и бот не должен выставлять пустой ордер.
  const levels = { ...emptyLevels(), STORAGE: 3 };
  const broke = snapshotWith({
    character: 'TRADER',
    credits: 0,
    bases: [testBase('home', { levels, resources: { ore: 0, polymers: 0, plasma: 0 } })],
  });
  check(
    'без криптогривны бот не покупает',
    !decide(broke).some((intent) => intent.kind === 'ORDER' && intent.side === 'BUY'),
  );
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

    if (midway === null && time >= (days * 86400) / 2) midway = { ...levels };
  }

  return { levels, techs, ships, defenses, idle, time, worstStall, midway: midway ?? levels };
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
  check(
    `${label}: продолжает расти во второй половине недели`,
    totalLevels(run.levels) > totalLevels(run.midway),
    `${totalLevels(run.midway)} → ${totalLevels(run.levels)} уровней`,
  );
  // Порог не «сколько ждать не обидно», а «не замер ли бот насовсем».
  // На девятнадцатом уровне шахты один апгрейд стоит больше суток добычи,
  // так что ожидание в сутки-полтора — норма; сто часов подряд были тупиком.
  check(
    `${label}: не замирает насовсем`,
    run.worstStall < 48 * 3600,
    `худший простой ${(run.worstStall / 3600).toFixed(1)} ч, всего ${Math.round((run.idle / run.time) * 100)}%`,
  );
}

{
  // Характеры должны расходиться, иначе смысла в выборе нет.
  const aggro = simulate('AGGRESSOR', 7);
  const trader = simulate('TRADER', 7);
  check(
    'агрессор уходит в верфь дальше торговца',
    aggro.levels.SHIPYARD > trader.levels.SHIPYARD,
    `верфь ${aggro.levels.SHIPYARD} против ${trader.levels.SHIPYARD}`,
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

/* ------------------------- Итог ------------------------- */

const passed = results.filter((entry) => entry.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
if (passed !== results.length) process.exitCode = 1;
