/**
 * Планировщик ботов: будит их по расписанию и исполняет решения.
 *
 * Единственное место, где бот касается мира, — и касается он его ровно теми же
 * методами, что и живой игрок: `gameLoop.startBuild`, `orderShips`, `sendFleet`,
 * `marketService.placeOrder`. Прямых UPDATE по игровому состоянию здесь нет
 * ни одного, и это не стилистика: тик держит командиров в памяти и периодически
 * сбрасывает их в БД, поэтому запись мимо него живет до ближайшего сброса
 * (правило 12 в CLAUDE.md).
 *
 * Бот не висит в памяти постоянно. Планировщик грузит его на время решения
 * через `getCommander` — с обычным догоном офлайна, — а дальше бота выселяет
 * штатный таймер простоя. Десять ботов стоят примерно как один онлайновый
 * игрок, и офлайн им начисляется по тем же правилам, что и живым.
 */
import { prisma } from '../../db/prisma.js';
import { gameLoop, type ActionResult } from '../gameLoop.js';
import { cancelOrder, fillOrder, placeOrder } from '../../services/marketService.js';
import {
  DAILY_BUDGET,
  mayAsk,
  mayWrite,
  readSpend,
  spentToday,
  withAttempt,
  withLetter,
  type BotSpend,
} from './budget.js';
// Справочная цена одна на всех: бот держит коридор вокруг нее, а интерфейс
// той же величиной показывает игроку, дорого сейчас или дешево.
import { marketPrice } from '../market.js';
import { deliver } from '../../services/mailService.js';
import { SHIP_TYPES, SQUADRON_TYPES, emptyShipCounts, type ShipCounts } from '../ships.js';
import { fleetCapacity } from '../fleets.js';
import { storageCapacities } from '../rules.js';
import { storageCapacity as hubCapacity } from '../market.js';
import { normalizeDefenses, normalizeShips } from '../fogOfWar.js';
import { spentOnDefense, spentOnFleet } from '../score.js';
import type { CommanderRuntimeState } from '../baseState.js';
import {
  decide,
  type BotFreePlanet,
  type BotIntent,
  type BotRaidTarget,
  type BotSnapshot,
} from './decide.js';
import {
  DECISION_INTERVAL_MS,
  DECISION_JITTER_MS,
  NEWBIE_SHIELD_DAYS,
  isBotCharacter,
  type BotCharacter,
} from './personality.js';
import { askReply, askStrategy, llmEnabled, type BotBrief } from './mind.js';
import { hopeless, type BotDirective } from './directives.js';
import { declarePeace } from '../../services/warService.js';
import { PLAN_TTL_MS, readStoredPlan, withPlan, type BotPlan } from './plan.js';

/** Сколько ботов планировщик обрабатывает за один заход. */
const BATCH = 5;

/** Как часто планировщик просыпается сам. */
const SWEEP_MS = 10_000;

function jitteredNext(now: number): Date {
  return new Date(now + DECISION_INTERVAL_MS + Math.floor(Math.random() * DECISION_JITTER_MS));
}

/* ------------------------- Сбор снимка ------------------------- */

/** Расстояние между системами на макро-карте. */
function distance(a: { galaxyX: number; galaxyY: number }, b: { galaxyX: number; galaxyY: number }): number {
  return Math.hypot(a.galaxyX - b.galaxyX, a.galaxyY - b.galaxyY);
}

/**
 * Что бот знает о мире.
 *
 * Все, что здесь читается, бот мог бы увидеть и сам: свободные планеты и чужие
 * колонии видны на карте, состав обороны — только по своей же разведке.
 * Заглядывать в чужие базы напрямую бот не должен, иначе он играет с картами
 * на столе, а живой игрок — вслепую.
 */
async function buildSnapshot(
  commander: CommanderRuntimeState,
  character: BotCharacter,
): Promise<BotSnapshot | null> {
  const bases = [...commander.bases.values()];
  if (bases.length === 0) return null;

  const home = bases[0]!;
  const homeGalaxy = home.galaxy;

  const [freeRows, foreignRows, scans, orders, debrisRows, recentTrades, hubStock] = await Promise.all([
    prisma.planet.findMany({
      where: { base: null },
      select: { id: true, systemId: true, system: { select: { galaxyX: true, galaxyY: true } } },
      take: 200,
    }),
    prisma.base.findMany({
      where: { commanderId: { not: commander.commanderId } },
      select: {
        planetId: true,
        commanderId: true,
        commander: { select: { createdAt: true } },
        planet: { select: { system: { select: { galaxyX: true, galaxyY: true } } } },
      },
      take: 200,
    }),
    prisma.planetScan.findMany({
      where: { commanderId: commander.commanderId },
      select: { planetId: true, data: true },
    }),
    // Открытые заявки: без них бот выставлял бы одну и ту же каждые
    // сорок пять секунд — условие, которое ее породило, держится часами.
    // Весь стакан своего хаба: свои заявки и чужие. Чужие нужны затем, что
    // торговля — это не только выставить цену, но и взять чужую.
    prisma.marketOrder.findMany({
      where: { remaining: { gt: 0 }, hub: { system: { planets: { some: { base: { commanderId: commander.commanderId } } } } } },
      select: { id: true, commanderId: true, side: true, resource: true, remaining: true, pricePerUnit: true },
      take: 40,
    }),
    // Поля обломков видны всем и туманом войны не скрываются — иначе гонка
    // за крупным полем была бы невозможна.
    prisma.planet.findMany({
      where: { OR: [{ debrisOre: { gt: 0 } }, { debrisPolymers: { gt: 0 } }] },
      select: {
        id: true,
        debrisOre: true,
        debrisPolymers: true,
        system: { select: { galaxyX: true, galaxyY: true } },
      },
      take: 20,
    }),
    // Последние сделки: цену ресурса назначает рынок, а не константа.
    prisma.trade.findMany({
      orderBy: { createdAt: 'desc' },
      select: { resource: true, pricePerUnit: true, quantity: true },
      take: 60,
    }),
    prisma.hubStorage.findFirst({
      where: { commanderId: commander.commanderId },
      select: { ore: true, polymers: true, level: true },
    }),
  ]);

  const scanned = new Map<string, number>();
  for (const scan of scans) {
    const payload = scan.data as Record<string, unknown> | null;
    // Снимок разведки — данные из прошлого и переживает изменения игры,
    // поэтому состав нормализуется, а не читается как есть (правило 8).
    const ships = normalizeShips(payload?.['ships'] as never);
    const defenses = normalizeDefenses(payload?.['defenses'] as never);
    scanned.set(scan.planetId, spentOnFleet(ships) + spentOnDefense(defenses));
  }

  const now = Date.now();
  const freePlanets: BotFreePlanet[] = freeRows.map((row) => ({
    planetId: row.id,
    systemId: row.systemId,
    distance: distance(homeGalaxy, row.system),
  }));

  const raidTargets: BotRaidTarget[] = foreignRows.map((row) => ({
    planetId: row.planetId,
    commanderId: row.commanderId,
    accountAgeDays: (now - row.commander.createdAt.getTime()) / 86_400_000,
    knownStrength: scanned.has(row.planetId) ? (scanned.get(row.planetId) as number) : null,
    distance: distance(homeGalaxy, row.planet.system),
  }));

  return {
    character,
    credits: commander.credits,
    techs: commander.techs,
    researching: commander.research !== null,
    bases: bases.map((base) => ({
      id: base.id,
      planetId: base.planetId,
      systemId: base.systemId,
      levels: base.levels,
      richness: base.richness,
      anomaly: base.anomaly,
      resources: base.resources,
      ships: base.ships,
      defenses: base.defenses,
      building: base.buildJob !== null,
      shipQueue: base.shipJobs.length,
      defenseQueue: base.defenseJobs.length,
    })),
    fleetsInFlight: commander.fleets.length,
    freePlanets,
    raidTargets,
    // Цену назначает рынок: она средневзвешенная по последним сделкам,
    // а перекос стакана говорит, чего не хватает и во что стоит вкладываться.
    market: (['ORE', 'POLYMERS'] as const).map((resource) => {
      const side = (want: 'BUY' | 'SELL') =>
        orders
          .filter((order) => order.resource === resource && order.side === want)
          .reduce((sum, order) => sum + order.remaining, 0);
      const demand = side('BUY');
      const supply = side('SELL');
      const both = demand + supply;
      const { price, seeded } = marketPrice(resource, recentTrades);
      return {
        resource,
        reference: price,
        seeded,
        demand: Math.round(demand),
        supply: Math.round(supply),
        skew: both > 0 ? Math.round(((demand - supply) / both) * 100) / 100 : null,
      };
    }),
    debrisFields: debrisRows.map((row) => ({
      planetId: row.id,
      ore: row.debrisOre,
      polymers: row.debrisPolymers,
      distance: distance(homeGalaxy, row.system),
    })),
    orderBook: orders.map((order) => ({
      id: order.id,
      side: order.side as 'BUY' | 'SELL',
      resource: order.resource as 'ORE' | 'POLYMERS',
      price: order.pricePerUnit,
      amount: order.remaining,
      mine: order.commanderId === commander.commanderId,
    })),
    hubStorage: {
      ore: hubStock?.ore ?? 0,
      polymers: hubStock?.polymers ?? 0,
      free: Math.max(0, hubCapacity(hubStock?.level ?? 1) - ((hubStock?.ore ?? 0) + (hubStock?.polymers ?? 0))),
    },
    colonizing: commander.fleets.some((fleet) => fleet.mission === 'COLONIZE'),
  };
}

/* ------------------------- Исполнение ------------------------- */

/**
 * Одно намерение — один вызов того же метода, которым ходит живой игрок.
 * Отказ здесь штатен и ничего не ломает: бот принимал решение по снимку,
 * а за секунды между снимком и вызовом ресурсы мог съесть завершившийся
 * заказ. Следующий заход просто решит заново.
 */
async function execute(commanderId: string, intent: BotIntent): Promise<ActionResult> {
  switch (intent.kind) {
    case 'BUILD':
      return gameLoop.startBuild(commanderId, intent.baseId, intent.building);

    case 'RESEARCH':
      return gameLoop.startResearch(commanderId, intent.baseId, intent.tech);

    case 'SHIPS':
      return gameLoop.orderShips(commanderId, intent.baseId, intent.ship, intent.count);

    case 'DEFENSE':
      return gameLoop.orderDefenses(commanderId, intent.baseId, intent.defense, intent.count);

    case 'COLONIZE': {
      const ships = emptyShipCounts();
      ships.COLONY_SHIP = 1;
      return gameLoop.sendFleet(
        commanderId,
        intent.baseId,
        { planetId: intent.planetId },
        'COLONIZE',
        ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );
    }

    case 'SCAN': {
      const ships = emptyShipCounts();
      ships.PROBE = 1;
      return gameLoop.sendFleet(
        commanderId,
        intent.baseId,
        { planetId: intent.planetId },
        'SCAN',
        ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );
    }

    case 'RAID':
      return gameLoop.sendFleet(
        commanderId,
        intent.baseId,
        { planetId: intent.planetId },
        'ATTACK',
        intent.ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );

    case 'TAKE': {
      // Сделка по чужой заявке. Отказ штатен: заявку могли разобрать
      // за секунды между решением и вызовом.
      const result = await fillOrder(commanderId, intent.orderId, intent.amount);
      return result;
    }

    case 'DROP': {
      const result = await cancelOrder(commanderId, intent.orderId);
      return result;
    }

    case 'ORDER': {
      const result = await placeOrder(commanderId, {
        side: intent.side,
        resource: intent.resource,
        quantity: intent.amount,
        pricePerUnit: intent.price,
      });
      return result;
    }

    default: {
      // Исчерпывающая проверка: новый вид намерения не проедет молча.
      const never: never = intent;
      return { ok: false, error: `Неизвестное намерение ${JSON.stringify(never)}` };
    }
  }
}

/**
 * Довезти излишек до хаба.
 *
 * Продавать на бирже можно только со склада хаба, а добывается все на базе,
 * поэтому торговля бота — это рейс, а не одна кнопка. Рейс отправляется
 * отдельно от ордеров: пока груз летит, продавать нечего.
 */
async function deliverToHub(
  commanderId: string,
  snapshot: BotSnapshot,
  hubId: string,
): Promise<string | null> {
  const base = snapshot.bases[0];
  if (!base) return null;

  const cargoShips = base.ships.LARGE_CARGO + base.ships.SMALL_CARGO;
  if (cargoShips === 0) return null;

  const ships = emptyShipCounts();
  ships.LARGE_CARGO = base.ships.LARGE_CARGO;
  ships.SMALL_CARGO = base.ships.SMALL_CARGO;

  /*
   * Везем долю излишка, но не больше, чем влезает в трюмы.
   *
   * Без этой обрезки рейс просто не улетал: доля считалась от склада, легко
   * перекрывала вместимость одного транспорта, и sendFleet отвечал отказом.
   * Молча — потому что отказ здесь штатен, — и торговля бота не работала вовсе.
   */
  const hold = fleetCapacity(ships);
  if (hold <= 0) return null;

  /*
   * Вывозим только излишек — то, чего накопилось больше половины своего склада.
   *
   * Раньше в рейс уходило по сорок процентов и руды, и полимеров, независимо
   * от того, много их или мало. Бот на этом сам себя обкрадывал: полимеров
   * у него было под завязку, а руды на четверть склада, и именно руду он
   * увозил на станцию — ту самую, которой не хватало на лабораторию.
   * Живой бот простоял так с лабораторией четвертого уровня при шахтах
   * седьмого несколько часов.
   */
  const caps = storageCapacities(base.levels);
  const surplus = (held: number, cap: number) => Math.max(0, held - cap * 0.5);

  let ore = Math.floor(surplus(base.resources.ore, caps.ore) * 0.8);
  let polymers = Math.floor(surplus(base.resources.polymers, caps.polymers) * 0.8);
  if (ore + polymers > hold) {
    // Режем пропорционально, чтобы не вывезти один ресурс целиком.
    const scale = hold / (ore + polymers);
    ore = Math.floor(ore * scale);
    polymers = Math.floor(polymers * scale);
  }
  if (ore + polymers < 100) return null;

  const result = await gameLoop.sendFleet(
    commanderId,
    base.id,
    { hubId },
    'HUB_DELIVERY',
    ships,
    { ore, polymers, plasma: 0 },
  );
  return result.ok ? `отвез в хаб ${ore + polymers}` : null;
}

/* ------------------------- Роли языковой модели ------------------------- */

/**
 * Короткая сводка для стратега.
 *
 * Только то, от чего зависит стратегия: полный снимок базы это сотни чисел,
 * из которых модели нужны единицы, а платим мы за каждое.
 */
async function buildBrief(
  commander: CommanderRuntimeState,
  snapshot: BotSnapshot,
  memory: unknown,
): Promise<BotBrief> {
  const capital = snapshot.bases[0]!;
  const positive = (source: Record<string, number>) =>
    Object.fromEntries(Object.entries(source).filter(([, value]) => value > 0));

  // Соседи глазами бота: позывной, сила и есть ли война. Точный состав чужой
  // обороны сюда не идет — его бот знает только по своей же разведке.
  const wars = await prisma.warDeclaration.findMany({
    // Мир снимает саму запись, поэтому отдельного признака «война окончена»
    // в ней нет: есть строка — есть война.
    where: { OR: [{ aggressorId: commander.commanderId }, { targetId: commander.commanderId }] },
    select: { aggressorId: true, targetId: true },
  });
  const enemies = new Set(
    wars.flatMap((war) => [war.aggressorId, war.targetId]).filter((id) => id !== commander.commanderId),
  );

  const neighbours = await prisma.commander.findMany({
    where: { id: { in: [...new Set(snapshot.raidTargets.map((target) => target.commanderId))] } },
    select: { id: true, nickname: true },
    take: 10,
  });
  return {
    nickname: (await prisma.commander.findUnique({
      where: { id: commander.commanderId },
      select: { nickname: true },
    }))?.nickname ?? 'бот',
    colonies: snapshot.bases.length,
    credits: Math.round(commander.credits),
    stock: {
      ore: Math.round(capital.resources.ore),
      polymers: Math.round(capital.resources.polymers),
      plasma: Math.round(capital.resources.plasma),
    },
    levels: positive(capital.levels as unknown as Record<string, number>),
    techs: positive(commander.techs as unknown as Record<string, number>),
    ships: positive(capital.ships as unknown as Record<string, number>),
    defenses: positive(capital.defenses as unknown as Record<string, number>),
    neighbours: neighbours.map((row) => {
      const target = snapshot.raidTargets.find((item) => item.commanderId === row.id);
      return {
        id: row.id,
        nickname: row.nickname,
        strength: target?.knownStrength ?? null,
        atWar: enemies.has(row.id),
        planetId: target?.planetId ?? '',
        distance: Math.round((target?.distance ?? 0) * 10) / 10,
      };
    }),
    // Ближайшая десятка: список всех свободных планет галактики модели незачем,
    // а платим мы за каждую строку.
    freePlanets: [...snapshot.freePlanets]
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 6)
      .map((planet) => ({ planetId: planet.planetId, distance: Math.round(planet.distance * 10) / 10 })),
    debris: snapshot.debrisFields.map((field) => ({
      planetId: field.planetId,
      ore: Math.round(field.ore),
      polymers: Math.round(field.polymers),
      distance: Math.round(field.distance * 10) / 10,
    })),
    ready: {
      colonyShip: capital.ships.COLONY_SHIP,
      recycler: capital.ships.RECYCLER,
      warships: SQUADRON_TYPES.reduce((sum, type) => sum + capital.ships[type], 0),
    },
    hub: {
      ore: Math.round(snapshot.hubStorage.ore),
      polymers: Math.round(snapshot.hubStorage.polymers),
      free: Math.round(snapshot.hubStorage.free),
    },
    market: await marketBrief(commander.commanderId, snapshot.market),
    battles: await battleBrief(commander.commanderId),
    events: await recentEvents(commander.commanderId),
    journal: readJournal(memory),
  };
}

/**
 * Биржа глазами бота: свои заявки, чужой стакан и последние сделки.
 *
 * Без последних сделок цена — пустой звук: справочная стоит в коде, а живой
 * рынок может уйти от нее в разы, и решать «продавать сейчас или ждать»
 * не по чему.
 */
async function marketBrief(
  commanderId: string,
  prices: BotSnapshot['market'],
): Promise<BotBrief['market']> {
  const [mine, book, trades] = await Promise.all([
    prisma.marketOrder.findMany({
      where: { commanderId, remaining: { gt: 0 } },
      select: { side: true, resource: true, remaining: true, pricePerUnit: true },
    }),
    // Идентификатор идет вместе с заявкой: по нему модель ее и исполняет.
    prisma.marketOrder.findMany({
      where: { commanderId: { not: commanderId }, remaining: { gt: 0 } },
      select: { id: true, side: true, resource: true, remaining: true, pricePerUnit: true },
      orderBy: { pricePerUnit: 'asc' },
      take: 8,
    }),
    prisma.trade.findMany({
      select: { resource: true, quantity: true, pricePerUnit: true },
      orderBy: { createdAt: 'desc' },
      take: 6,
    }),
  ]);

  const row = (o: { side: string; resource: string; remaining: number; pricePerUnit: number }) => ({
    side: o.side,
    resource: o.resource,
    amount: Math.round(o.remaining),
    price: Math.round(o.pricePerUnit),
  });

  return {
    prices: prices.map((ref) => ({
      resource: ref.resource,
      price: ref.reference,
      seeded: ref.seeded,
      demand: ref.demand,
      supply: ref.supply,
      skew: ref.skew,
    })),
    myOrders: mine.map(row),
    book: book.map((order) => ({ orderId: order.id, ...row(order) })),
    lastTrades: trades.map((t) => ({
      resource: t.resource,
      amount: Math.round(t.quantity),
      price: Math.round(t.pricePerUnit),
    })),
  };
}

/**
 * Свои бои с исходом и добычей.
 *
 * Это единственное место, где модель узнает, чем кончились ее собственные
 * решения: состояние показывает, что флота нет, а отчет — что его разбили
 * и при какой попытке.
 */
async function battleBrief(commanderId: string): Promise<BotBrief['battles']> {
  const rows = await prisma.battleReport.findMany({
    where: { OR: [{ attackerId: commanderId }, { defenderId: commanderId }] },
    select: {
      attackerId: true,
      winner: true,
      plunderOre: true,
      plunderPolymers: true,
      plunderPlasma: true,
      attacker: { select: { nickname: true } },
      defender: { select: { nickname: true } },
    },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  return rows.map((row) => {
    const mine = row.attackerId === commanderId;
    const won = (mine && row.winner === 'ATTACKER') || (!mine && row.winner === 'DEFENDER');
    return {
      role: mine ? 'нападал' : 'оборонялся',
      against: mine ? row.defender.nickname : row.attacker.nickname,
      // Ничьей в исходе нет: поле остается за защитником, и движок пишет его.
      outcome: won ? 'победа' : 'поражение',
      loot: Math.round(row.plunderOre + row.plunderPolymers + row.plunderPlasma),
    };
  });
}

/**
 * Что случилось с ботом за последние часы — по его же почтовому ящику.
 *
 * Отдельного журнала для этого заводить незачем: все, что с ботом происходит,
 * и так приходит ему письмом, как приходило бы живому игроку.
 */
async function recentEvents(commanderId: string): Promise<string[]> {
  const since = new Date(Date.now() - PLAN_TTL_MS);
  const rows = await prisma.message.findMany({
    where: { recipientId: commanderId, createdAt: { gte: since } },
    select: { subject: true },
    orderBy: { createdAt: 'desc' },
    take: 8,
  });
  return rows.map((row) => row.subject);
}

/**
 * Журнал решений: кольцевой буфер прямо в памяти бота.
 *
 * Отдельная таблица для двадцати строк не нужна, а без журнала модель видит
 * только «как сейчас» и не может ответить на «сработало ли то, что я решила
 * в прошлый раз». Состояние показывает, что флота нет; журнал — что его
 * потеряли в набеге, который сама же и назначила.
 */
const JOURNAL_LIMIT = 20;

function readJournal(memory: unknown): string[] {
  if (typeof memory !== 'object' || memory === null) return [];
  const rows = (memory as Record<string, unknown>)['journal'];
  if (!Array.isArray(rows)) return [];
  return rows.filter((row): row is string => typeof row === 'string').slice(-JOURNAL_LIMIT);
}

function appendJournal(memory: unknown, entries: string[]): string[] {
  if (entries.length === 0) return readJournal(memory);
  const stamp = new Date().toISOString().slice(11, 16);
  return [...readJournal(memory), ...entries.map((entry) => `${stamp} ${entry}`)].slice(-JOURNAL_LIMIT);
}

async function savePlan(
  botId: string,
  plan: BotPlan,
  journal: string[],
  /** Каким рынок был в момент решения — по нему сверяется, стоит ли будить снова. */
  market: BotSnapshot['market'],
  spend: BotSpend,
): Promise<void> {
  await prisma.bot.update({
    where: { id: botId },
    data: {
      memory: {
        plan: plan as unknown as object,
        planMadeAt: Date.now(),
        journal,
        market: market.map((ref) => ({ resource: ref.resource, price: ref.reference, skew: ref.skew })),
        spend: spend as unknown as object,
      },
    },
  });
}

/**
 * Записать счетчик расхода, не трогая план.
 *
 * Нужен отдельно, потому что попытка засчитывается и тогда, когда ответа
 * не пришло: план в этом случае не сохраняется, а запрос провайдер уже
 * посчитал. Без этой записи неудачные вызовы были бы бесплатны в наших
 * книгах и платны в чужих.
 */
async function saveSpend(botId: string, spend: BotSpend): Promise<void> {
  const bot = await prisma.bot.findUnique({ where: { id: botId }, select: { memory: true } });
  const memory = (typeof bot?.memory === 'object' && bot.memory !== null ? bot.memory : {}) as Record<
    string,
    unknown
  >;
  await prisma.bot.update({
    where: { id: botId },
    data: { memory: { ...memory, spend: spend as unknown as object } },
  });
}

/**
 * Сдвинулся ли рынок настолько, что об этом стоит спросить модель.
 *
 * Опрашивать рынок по часам не годится: код отрабатывает стакан каждые
 * сорок пять секунд сам — берет дешевое, держит коридор, покупает
 * недостающее, — и модель на частом такте почти всегда подтверждала бы уже
 * сделанное. Считать это подтверждение дорого: три бота с пятиминутным
 * опросом дают 864 запроса в сутки при дневном лимите в 500 на всех.
 *
 * Поэтому не опрос, а повод. Цена ушла заметно или перекос сменил знак —
 * это новость, ради которой стоит пересмотреть, во что вкладываться.
 * На спокойном рынке лишних вызовов нет вовсе.
 */
const PRICE_SHOCK = 0.15;

function marketShock(memory: unknown, now: BotSnapshot['market']): string | null {
  const saved = (memory as Record<string, unknown> | null)?.['market'];
  if (!Array.isArray(saved)) return null;

  for (const ref of now) {
    // Цене из затравки верить нечего: сделок еще не было.
    if (ref.seeded) continue;
    const was = saved.find(
      (row): row is { resource: string; price: number; skew: number | null } =>
        typeof row === 'object' && row !== null && (row as { resource?: unknown }).resource === ref.resource,
    );
    if (!was || typeof was.price !== 'number' || was.price <= 0) continue;

    const move = (ref.reference - was.price) / was.price;
    if (Math.abs(move) >= PRICE_SHOCK) {
      const name = ref.resource === 'ORE' ? 'руда' : 'полимеры';
      return `${name} ${move > 0 ? 'подорожала' : 'подешевела'} на ${Math.round(Math.abs(move) * 100)}% — теперь ${ref.reference}`;
    }

    // Смена знака перекоса — это разворот рынка: то, чего было завались,
    // стало нарасхват. Ноль за разворот не считаем, иначе будило бы
    // всякое дрожание вокруг равновесия.
    const before = was.skew;
    if (typeof before === 'number' && ref.skew !== null && before * ref.skew < 0) {
      const name = ref.resource === 'ORE' ? 'руду' : 'полимеры';
      return ref.skew > 0
        ? `${name} стали разбирать: спрос обогнал предложение`
        : `${name} перестали брать: предложение обогнало спрос`;
    }
  }

  return null;
}

/**
 * Ответить на письма живых игроков.
 *
 * Отвечаем только на личные письма и только на непрочитанные: системные отчеты
 * бот получает пачками, и отвечать на собственный боевой отчет незачем.
 * Письмо помечается прочитанным в любом случае — молчание модели не должно
 * приводить к тому, что бот пытается ответить на него снова и снова.
 */
async function answerMail(
  commanderId: string,
  character: BotCharacter,
  spend: BotSpend,
  /** Сколько обращений к модели уже сделали все боты за сегодня. */
  spentAll: number,
): Promise<{ sent: number; spend: BotSpend }> {
  // Норма кончилась — бот молчит. Неотвеченное письмо лучше, чем бот,
  // который выбрал дневную норму на переписке и перестал играть.
  if (!llmEnabled() || spentAll >= DAILY_BUDGET) return { sent: 0, spend };

  const letters = await prisma.message.findMany({
    where: { recipientId: commanderId, isRead: false, type: 'PLAYER', senderId: { not: null } },
    select: { id: true, subject: true, body: true, senderId: true, sender: { select: { nickname: true } } },
    orderBy: { createdAt: 'asc' },
    // Потолок на заход: если бота завалили письмами, отвечать на все разом
    // значит и заход растянуть, и токены сжечь.
    take: 3,
  });
  if (letters.length === 0) return { sent: 0, spend };

  await prisma.message.updateMany({
    where: { id: { in: letters.map((letter) => letter.id) }, recipientId: commanderId },
    data: { isRead: true },
  });

  let sent = 0;
  let ledger = spend;
  for (const letter of letters) {
    if (!letter.senderId) continue;
    /*
     * Потолок на переписку жесткий и стоит в коде, а не в промпте.
     *
     * Просьба «не чаще пары писем в сутки одному» — это просьба, и модель
     * ее выполняет ровно настолько, насколько захочет. Бот, которому пишут
     * каждую минуту, отвечал бы каждую минуту: каждое письмо это вызов
     * модели, а норма у нас общая на всех.
     *
     * Письмо все равно помечается прочитанным выше: молчание не должно
     * приводить к тому, что бот пытается ответить на него снова и снова.
     */
    if (!mayWrite(ledger, letter.senderId)) continue;

    ledger = withAttempt(ledger);
    const text = await askReply(
      character,
      letter.sender?.nickname ?? 'неизвестный',
      letter.subject,
      letter.body,
    );
    if (!text) continue;

    await deliver([
      {
        recipientId: letter.senderId,
        senderId: commanderId,
        type: 'PLAYER',
        subject: `Re: ${letter.subject}`.slice(0, 120),
        body: text,
      },
    ]);
    ledger = withLetter(ledger, letter.senderId);
    sent += 1;
  }
  return { sent, spend: ledger };
}

/**
 * Что вырвало бота из расписания.
 *
 * Модель зовется не только по будильнику: бой, объявленная война или потеря
 * колонии — это ровно те нестандартные ситуации, ради которых она здесь.
 * В спокойные часы функция возвращает null, и лишнего вызова не будет.
 */
async function recentShock(commanderId: string, since: number): Promise<string | null> {
  const after = new Date(Math.max(since, Date.now() - 6 * 3600_000));

  const battle = await prisma.battleReport.findFirst({
    where: {
      OR: [{ attackerId: commanderId }, { defenderId: commanderId }],
      createdAt: { gt: after },
    },
    select: {
      attackerId: true,
      winner: true,
      plunderOre: true,
      plunderPolymers: true,
      plunderPlasma: true,
      attacker: { select: { nickname: true } },
      defender: { select: { nickname: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  if (battle) {
    const mine = battle.attackerId === commanderId;
    const won = (mine && battle.winner === 'ATTACKER') || (!mine && battle.winner === 'DEFENDER');
    const other = mine ? battle.defender.nickname : battle.attacker.nickname;
    const loot = Math.round(battle.plunderOre + battle.plunderPolymers + battle.plunderPlasma);
    return mine
      ? `мой набег на «${other}» — ${won ? 'победа' : 'поражение'}, добыча ${loot}`
      : `на меня напал «${other}» — ${won ? 'отбился' : 'разбит'}, унесли ${loot}`;
  }

  const war = await prisma.warDeclaration.findFirst({
    where: { targetId: commanderId, declaredAt: { gt: after } },
    select: { aggressor: { select: { nickname: true } } },
    orderBy: { declaredAt: 'desc' },
  });
  if (war) return `«${war.aggressor.nickname}» объявил мне войну`;

  return null;
}

/**
 * Исполнение поручения модели.
 *
 * Каждое идет теми же методами, что и решения кода: правила не обходятся,
 * ресурсы списываются, бой считает движок. Отказ здесь штатен — обстановка
 * могла измениться между решением и исполнением, — и пишется в журнал наравне
 * с успехом: модели полезно знать, что ее поручение не прошло.
 */
async function applyDirective(
  commanderId: string,
  snapshot: BotSnapshot,
  directive: BotDirective,
  /** Счетчик переписки: письма живым игрокам ограничены и по своей директиве. */
  spend: BotSpend,
): Promise<{ line: string; spend: BotSpend }> {
  const note = (text: string) => ({ line: `${directive.kind}: ${text}`, spend });

  switch (directive.kind) {
    case 'ATTACK': {
      const target = snapshot.raidTargets.find((item) => item.planetId === directive.planetId);
      if (!target) return note('цель пропала из виду');
      if (target.accountAgeDays < NEWBIE_SHIELD_DAYS) return note('под щитом новичка — отказ');

      const own = snapshot.bases.reduce((sum, base) => sum + spentOnFleet(base.ships), 0);
      if (hopeless(own, target.knownStrength)) return note('безнадежно, флот бы не вернулся');

      const striker = snapshot.bases.reduce((best, base) =>
        spentOnFleet(base.ships) > spentOnFleet(best.ships) ? base : best,
      );
      const strike = emptyShipCounts();
      for (const type of SHIP_TYPES) {
        if (type === 'PROBE' || type === 'RECYCLER' || type === 'COLONY_SHIP') continue;
        if (type === 'SMALL_CARGO') continue;
        strike[type] = striker.ships[type];
      }
      strike.LARGE_CARGO = Math.floor(striker.ships.LARGE_CARGO / 2);
      if (spentOnFleet(strike) <= 0) return note('нечем лететь');

      const result = await gameLoop.sendFleet(
        commanderId,
        striker.id,
        { planetId: directive.planetId },
        'ATTACK',
        strike,
        { ore: 0, polymers: 0, plasma: 0 },
      );
      return note(result.ok ? `набег отправлен — ${directive.why}` : result.error);
    }

    case 'PEACE': {
      const result = await declarePeace(commanderId, directive.commanderId);
      return note(result.ok ? `мир предложен — ${directive.why}` : result.error);
    }

    case 'COLONIZE': {
      const carrier = snapshot.bases.find((base) => base.ships.COLONY_SHIP > 0);
      if (!carrier) return note('колониального корабля нет');
      const ships = emptyShipCounts();
      ships.COLONY_SHIP = 1;
      const result = await gameLoop.sendFleet(
        commanderId,
        carrier.id,
        { planetId: directive.planetId },
        'COLONIZE',
        ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );
      return note(result.ok ? `рейс к планете — ${directive.why}` : result.error);
    }

    case 'HARVEST': {
      const yard = snapshot.bases.find((base) => base.ships.RECYCLER > 0);
      if (!yard) return note('переработчика нет');
      const ships = emptyShipCounts();
      ships.RECYCLER = yard.ships.RECYCLER;
      const result = await gameLoop.sendFleet(
        commanderId,
        yard.id,
        { planetId: directive.planetId },
        'HARVEST',
        ships,
        { ore: 0, polymers: 0, plasma: 0 },
      );
      return note(result.ok ? `сбор обломков — ${directive.why}` : result.error);
    }

    case 'FILL': {
      const result = await fillOrder(commanderId, directive.orderId, directive.amount);
      return note(result.ok ? `сделка прошла — ${directive.why}` : result.error);
    }

    case 'CANCEL': {
      const mine = await prisma.marketOrder.findMany({
        where: { commanderId, resource: directive.resource, remaining: { gt: 0 } },
        select: { id: true },
      });
      let cut = 0;
      for (const order of mine) {
        const result = await cancelOrder(commanderId, order.id);
        if (result.ok) cut += 1;
      }
      return note(cut > 0 ? `снято заявок ${cut} — ${directive.why}` : 'снимать нечего');
    }

    case 'SELL':
    case 'BUY': {
      /*
       * Дубли не выставляем. Заявки кода такую проверку проходят, а директивы
       * шли мимо нее: живой бот набрал три продажи полимеров, две из них
       * по одной цене, потому что рынок пуст и ни одна не исполнялась.
       * Пять открытых заявок — потолок: дальше это уже не торговля,
       * а замороженный в залоге склад.
       */
      const standing = await prisma.marketOrder.findMany({
        where: { commanderId, remaining: { gt: 0 } },
        select: { side: true, resource: true, pricePerUnit: true },
      });
      if (standing.length >= 5) return note('открытых заявок и так пять');
      const same = standing.some(
        (order) =>
          order.side === directive.kind &&
          order.resource === directive.resource &&
          Math.round(order.pricePerUnit) === directive.price,
      );
      if (same) return note('такая заявка уже стоит');

      const result = await placeOrder(commanderId, {
        side: directive.kind,
        resource: directive.resource,
        quantity: directive.amount,
        pricePerUnit: directive.price,
      });
      return note(result.ok ? `заявка выставлена — ${directive.why}` : result.error);
    }

    case 'MESSAGE': {
      /*
       * Потолок переписки стоит и здесь, а не только на ответах.
       *
       * Своей волей бот пишет по поводу — объявил войну, предлагает мир, —
       * но повод для модели величина растяжимая, и просьба в промпте писать
       * «не чаще пары писем в сутки одному» ее ни к чему не обязывает.
       * Живому игроку ящик забивать нельзя, и решать это должен код.
       */
      if (!mayWrite(spend, directive.commanderId)) {
        return note('потолок писем на сутки исчерпан');
      }
      await deliver([
        {
          recipientId: directive.commanderId,
          senderId: commanderId,
          type: 'PLAYER',
          subject: directive.subject,
          body: directive.body,
        },
      ]);
      return {
        line: `MESSAGE: письмо отправлено — ${directive.why}`,
        spend: withLetter(spend, directive.commanderId),
      };
    }

    default: {
      const never: never = directive;
      return note(`неизвестное поручение ${JSON.stringify(never)}`);
    }
  }
}

/* ------------------------- Заход бота ------------------------- */

export interface BotTurn {
  commanderId: string;
  nickname: string;
  actions: string[];
}

/**
 * Один заход одного бота: снимок → решения → исполнение.
 *
 * Экспортируется отдельно от планировщика, чтобы админка могла разбудить
 * бота вручную и сразу показать, что он сделал.
 */
/**
 * Боты, чей ход идет прямо сейчас.
 *
 * Заход бота длится секунды — в нем поход к модели и несколько записей в БД, —
 * и за это время его может подхватить кто-то еще: планировщик просыпается
 * каждые десять секунд, а кнопка «Ход» в пульте зовет тот же метод напрямую.
 * Два параллельных хода исполнили бы поручения модели дважды.
 */
const busy = new Set<string>();

export async function runBotTurn(botId: string): Promise<BotTurn | null> {
  if (busy.has(botId)) return null;
  busy.add(botId);
  try {
    return await turn(botId);
  } finally {
    busy.delete(botId);
  }
}

async function turn(botId: string): Promise<BotTurn | null> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: {
      id: true,
      character: true,
      commanderId: true,
      memory: true,
      commander: { select: { nickname: true } },
    },
  });
  if (!bot || !isBotCharacter(bot.character)) return null;

  const commander = await gameLoop.getCommander(bot.commanderId);
  if (!commander) return null;

  const snapshot = await buildSnapshot(commander, bot.character);
  if (!snapshot) return null;

  const actions: string[] = [];

  /*
   * Стратегию бот переосмысливает редко — раз в несколько часов. Спрашивать
   * модель на каждом заходе значило бы отдавать ей арифметику, которую код
   * считает точнее, и платить за это в сотни раз больше: план раз в шесть
   * часов стоит около четырех тысяч токенов в сутки, вызов на каждый заход —
   * почти два миллиона.
   */
  let plan = readStoredPlan(bot.memory, bot.character);
  let journal = readJournal(bot.memory);

  /*
   * Модель зовется по расписанию или когда случилось нестандартное: бой,
   * объявленная война, потерянная колония. В спокойные часы она молчит.
   * Спрашивать ее на каждом заходе значило бы отдавать ей арифметику, которую
   * код считает точнее, и платить в сотни раз больше.
   */
  const overdue = !plan || Date.now() - plan.madeAt > PLAN_TTL_MS;
  const shock =
    (await recentShock(bot.commanderId, plan?.madeAt ?? 0)) ?? marketShock(bot.memory, snapshot.market);

  /*
   * Норма запросов общая на всех ботов и считается по попыткам: отказ сервиса
   * стоит у провайдера столько же, сколько удачный ответ. Кончилась норма —
   * бот доигрывает сутки по коду, и это штатный режим, а не авария.
   */
  let spend = readSpend(bot.memory);
  // Общий расход читается один раз за заход: он нужен и стратегу, и почте.
  const spentAll = llmEnabled() ? await spentToday() : Number.MAX_SAFE_INTEGER;
  const wanted = llmEnabled() && (overdue || shock !== null);
  if (wanted && mayAsk(spend, spentAll)) {
    spend = withAttempt(spend);
    const brief = await buildBrief(commander, snapshot, bot.memory);
    const answer = await askStrategy(bot.character, brief, snapshot, shock);

    if (!answer) {
      // Ответа нет, но попытка была: записываем расход отдельно, иначе
      // неудачные вызовы не попадут в счетчик вовсе.
      await saveSpend(bot.id, spend);
    }

    if (answer) {
      plan = { plan: answer.plan, madeAt: Date.now() };
      actions.push(`ПЛАН: ${answer.plan.note || 'стратегия обновлена'}`);
      if (shock) journal = appendJournal({ journal }, [`повод: ${shock}`]);

      /*
       * Директивы — то, ради чего модель здесь. Исполняются они теми же
       * методами, что и решения кода, поэтому правила остаются в силе:
       * ресурсы списываются, требования проверяются, бой считает движок.
       */
      for (const directive of answer.directives) {
        const done = await applyDirective(bot.commanderId, snapshot, directive, spend);
        spend = done.spend;
        actions.push(done.line);
        journal = appendJournal({ journal }, [done.line]);
      }

      await savePlan(bot.id, answer.plan, journal, snapshot.market, spend);
    }
  }

  const profile = withPlan(bot.character, plan?.plan ?? null);
  for (const intent of decide(snapshot, profile)) {
    const result = await execute(bot.commanderId, intent);
    if (result.ok) actions.push(`${intent.kind}: ${intent.why}`);
  }

  // Дипломат: ответы на письма живых игроков.
  const mail = await answerMail(bot.commanderId, bot.character, spend, spentAll);
  if (mail.sent > 0) {
    actions.push(`ОТВЕТ: писем ${mail.sent}`);
    await saveSpend(bot.id, mail.spend);
  }

  // Торговый рейс идет после решений: ордера бот выставляет с того, что уже
  // лежит в хабе, а этот рейс наполняет хаб к следующему заходу.
  const hub = await prisma.tradeHub.findFirst({
    where: { system: { planets: { some: { base: { commanderId: bot.commanderId } } } } },
    select: { id: true },
  });
  if (hub) {
    const delivery = await deliverToHub(bot.commanderId, snapshot, hub.id);
    if (delivery) actions.push(delivery);
  }

  const last = actions[actions.length - 1] ?? null;
  await prisma.bot.update({
    where: { id: bot.id },
    data: {
      nextDecisionAt: jitteredNext(Date.now()),
      ...(last ? { lastAction: last, lastActionAt: new Date() } : {}),
    },
  });

  return { commanderId: bot.commanderId, nickname: bot.commander.nickname, actions };
}

/* ------------------------- Планировщик ------------------------- */

class BotDirector {
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      void this.sweep();
    }, SWEEP_MS);
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /** Заход планировщика: берет подошедших по расписанию и водит их по очереди. */
  private async sweep(): Promise<void> {
    if (this.running) return;
    this.running = true;

    try {
      const due = await prisma.bot.findMany({
        where: { active: true, nextDecisionAt: { lte: new Date() } },
        select: { id: true },
        orderBy: { nextDecisionAt: 'asc' },
        take: BATCH,
      });

      for (const bot of due) {
        try {
          await runBotTurn(bot.id);
        } catch (error) {
          // Один сорвавшийся бот не должен останавливать остальных: расписание
          // все равно сдвигаем, иначе он застрянет и будет выбираться каждый заход.
          console.error(`[bot] заход ${bot.id} сорвался`, error);
          await prisma.bot
            .update({ where: { id: bot.id }, data: { nextDecisionAt: jitteredNext(Date.now()) } })
            .catch(() => undefined);
        }
      }
    } catch (error) {
      console.error('[bot] заход планировщика сорвался', error);
    } finally {
      this.running = false;
    }
  }
}

export const botDirector = new BotDirector();
export type { ShipCounts };
