/**
 * Биржа торгового хаба.
 * Все проверки и переводы — на сервере и в транзакции: товар и криптогривна
 * блокируются в момент выставления ордера, поэтому продать одно и то же дважды нельзя.
 */
import { commanderPacts, syndicateBuffsFor } from './syndicateAccess.js';
import { RESERVE_EMAIL, reserveBand } from '../game/reserve.js';
import { TRADE_PACT_FEE_MULTIPLIER } from '../game/syndicate.js';
import {
  availableAt,
  depositGlobal,
  hubAccount,
  hubStockUsage,
  lockHubStocks,
  refundStock,
  withdrawStock,
} from './hubStock.js';
import { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import {
  RESOURCE_LABELS,
  storageCapacity,
  hubRent,
  storageUpgradeCost,
  tradeTotal,
  validateOrder,
  type OrderSide,
  type TradeResource,
  quote,
  buyerEscrow,
  buyerFee,
  matchPrice,
  sellerFee,
  type Quote,
} from '../game/market.js';

export type MarketResult = { ok: true; message: string } | { ok: false; error: string };

export interface MarketView {
  hub: { hubId: string; name: string } | null;
  credits: number;
  storage: {
    ore: number;
    polymers: number;
    level: number;
    capacity: number;
    free: number;
    /** Сколько доступно на хабе своей системы: его склад и общий. */
    local: { ore: number; polymers: number };
    /** Общий склад: купленное и полученное обменом, забирается с любого хаба. */
    global: { ore: number; polymers: number };
    /** Лежит на складах других хабов — забирать только там. */
    elsewhere: { ore: number; polymers: number };
    used: number;
    /** Расширение склада платится криптогривной. */
    upgradeCost: number;
    nextLevel: number;
    nextCapacity: number;
    /**
     * Аренда места: сколько склад стоит сейчас и сколько будет стоить после
     * расширения. Расширение оплачивается дважды — разово ценой уровня
     * и дальше платой навсегда, — и вторую половину счета игрок обязан
     * видеть до нажатия кнопки, а не узнавать из убывающего баланса.
     */
    rentPerHour: number;
    nextRentPerHour: number;
  } | null;
  book: Record<TradeResource, { buy: PublicOrder[]; sell: PublicOrder[] }>;
  /** Что происходит с ценой: рыночная, лучшие заявки, спред, перекос. */
  quotes: Record<TradeResource, Quote>;
  /**
   * Сводка по рынку за сутки.
   *
   * Считает сервер, а не клиент: цена и обороты — игровые величины, и клиент
   * их не выводит (правило 3). Заодно это единственный способ показать
   * изменение за сутки: у клиента нет вчерашних сделок, их незачем ему возить.
   */
  stats: Record<TradeResource, ResourceStats>;
  /**
   * Бартер отдельной строкой: он живет по своим правилам и денег не трогает.
   *
   * Числа сделок здесь нет намеренно. Принятое предложение удаляется, журнала
   * обменов в базе не существует, и «обменов за сутки» пришлось бы либо
   * выдумать, либо заводить под это таблицу. Показываем то, что знаем точно:
   * сколько предложений висит и сколько товара в них заперто.
   */
  barterStats: { open: number; unitsOffered: number };
  /** Бартерные предложения хаба: обмен ресурса на ресурс, без денег. */
  barters: BarterView[];
  /**
   * Резерв хаба — открыто: коридор и фонд. Игрок должен знать, в каких
   * пределах вообще может ходить цена и чем резерв держит нижнюю границу,
   * а не догадываться по стакану, откуда взялась стена заявок.
   */
  reserve: { bands: Record<TradeResource, { floor: number; ceiling: number }>; fund: number };
  myOrders: PublicOrder[];
  trades: Array<{
    id: string;
    resource: TradeResource;
    quantity: number;
    pricePerUnit: number;
    total: number;
    buyer: string;
    seller: string;
    createdAt: number;
    mine: boolean;
  }>;
}

const DAY_MS = 86_400_000;

/**
 * Сколько сделок отдается за раз.
 *
 * Их накапливается много: три бота за четыре часа наторговали 139, за месяц
 * это десятки тысяч. Отдавать все разом нельзя — страница не отрисует,
 * а канал забьется тем, чего никто не прочтет.
 */
export const HISTORY_PAGE = 50;

/**
 * Сводка по ресурсу за сутки.
 *
 * Изменение цены считается сравнением двух средневзвешенных: за последние
 * сутки и за сутки до них. Не «первая сделка против последней» — одна
 * случайная сделка по кривой цене сдвинула бы показатель на десятки
 * процентов, ничего не сказав о рынке.
 */
function statsFor(
  resource: TradeResource,
  recent: ReadonlyArray<{ resource: string; quantity: number; pricePerUnit: number; createdAt: Date }>,
  openOrders: number,
): ResourceStats {
  const edge = Date.now() - DAY_MS;
  const today = recent.filter((t) => t.resource === resource && t.createdAt.getTime() >= edge);
  const before = recent.filter((t) => t.resource === resource && t.createdAt.getTime() < edge);

  const vwap = (rows: typeof today) => {
    let volume = 0;
    let total = 0;
    for (const row of rows) {
      if (row.quantity <= 0 || row.pricePerUnit <= 0) continue;
      volume += row.quantity;
      total += row.quantity * row.pricePerUnit;
    }
    return volume > 0 ? total / volume : null;
  };

  const now = vwap(today);
  const then = vwap(before);

  return {
    volumeToday: Math.round(today.reduce((sum, t) => sum + Math.max(0, t.quantity), 0)),
    tradesToday: today.length,
    openOrders,
    change: now !== null && then !== null && then > 0 ? Math.round(((now - then) / then) * 100) / 100 : null,
  };
}

/** Что рынок сделал с ресурсом за последние сутки. */
export interface ResourceStats {
  /** Сколько единиц перешло из рук в руки. */
  volumeToday: number;
  /** Сколько сделок прошло. */
  tradesToday: number;
  /** Открытых заявок по этому ресурсу — обе стороны вместе. */
  openOrders: number;
  /**
   * Изменение цены за сутки, доля: 0.12 — подорожало на двенадцать процентов.
   * null — сравнивать не с чем, сделок сутки назад не было.
   */
  change: number | null;
}

export interface PublicOrder {
  id: string;
  side: OrderSide;
  resource: TradeResource;
  pricePerUnit: number;
  remaining: number;
  quantity: number;
  trader: string;
  mine: boolean;
  createdAt: number;
}

/** Хаб системы, в которой стоит база игрока. */
async function findHubForUser(commanderId: string) {
  return prisma.tradeHub.findFirst({
    where: { system: { planets: { some: { base: { commanderId } } } } },
  });
}

/** Хаб системы игрока внутри транзакции. */
async function homeHubOf(tx: Prisma.TransactionClient, commanderId: string) {
  return tx.tradeHub.findFirst({
    where: { system: { planets: { some: { base: { commanderId } } } } },
    select: { id: true },
  });
}


async function ensureStorage(commanderId: string, hubId: string) {
  return prisma.hubStorage.upsert({
    where: { commanderId_hubId: { commanderId, hubId } },
    create: { commanderId, hubId },
    update: {},
  });
}

async function reserveView(): Promise<MarketView['reserve']> {
  const fund = await prisma.commander.findFirst({
    where: { user: { email: RESERVE_EMAIL } },
    select: { credits: true },
  });
  return {
    bands: { ORE: reserveBand('ORE'), POLYMERS: reserveBand('POLYMERS') },
    fund: round2(fund?.credits ?? 0),
  };
}

export async function getMarketView(commanderId: string): Promise<MarketView> {
  const commander = await prisma.commander.findUnique({ where: { id: commanderId } });
  const hub = await findHubForUser(commanderId);
  const reserve = await reserveView();

  if (!commander || !hub) {
    return {
      reserve,
      hub: null,
      credits: commander?.credits ?? 0,
      storage: null,
      book: { ORE: { buy: [], sell: [] }, POLYMERS: { buy: [], sell: [] } },
      quotes: {
        ORE: quote('ORE', null, null, null),
        POLYMERS: quote('POLYMERS', null, null, null),
      },
      stats: {
        ORE: { volumeToday: 0, tradesToday: 0, openOrders: 0, change: null },
        POLYMERS: { volumeToday: 0, tradesToday: 0, openOrders: 0, change: null },
      },
      barterStats: { open: 0, unitsOffered: 0 },
      barters: [],
      myOrders: [],
      trades: [],
    };
  }

  const [storage, orders, trades, barters, recent, barterOpen] = await Promise.all([
    prisma.hubStorage.findUnique({ where: { commanderId_hubId: { commanderId, hubId: hub.id } } }),
    prisma.marketOrder.findMany({
      where: { remaining: { gt: 0 } },
      include: { commander: { select: { nickname: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.trade.findMany({
      include: { buyer: { select: { nickname: true } }, seller: { select: { nickname: true } } },
      orderBy: { createdAt: 'desc' },
      // Первая страница истории. Дальше игрок подкачивает сам: за месяц сделок
      // накопятся десятки тысяч, и отрисовать их разом страница не сможет.
      take: HISTORY_PAGE,
    }),
    prisma.barterOffer.findMany({
      include: { commander: { select: { nickname: true } } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    }),
    /*
     * Сделки за двое суток — на них считается и оборот за сегодня,
     * и цена сутки назад, с которой сравнивается нынешняя. Двое суток,
     * а не одни: чтобы найти вчерашнюю цену, нужны сделки старше суток.
     */
    prisma.trade.findMany({
      where: { createdAt: { gte: new Date(Date.now() - 2 * DAY_MS) } },
      select: { resource: true, quantity: true, pricePerUnit: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 2000,
    }),
    prisma.barterOffer.count(),
  ]);

  const toPublic = (order: (typeof orders)[number]): PublicOrder => ({
    id: order.id,
    side: order.side,
    resource: order.resource,
    pricePerUnit: order.pricePerUnit,
    remaining: order.remaining,
    quantity: order.quantity,
    trader: order.commander.nickname,
    mine: order.commanderId === commanderId,
    createdAt: order.createdAt.getTime(),
  });

  const book: MarketView['book'] = {
    ORE: { buy: [], sell: [] },
    POLYMERS: { buy: [], sell: [] },
  };

  for (const order of orders) {
    const bucket = book[order.resource];
    if (order.side === 'BUY') bucket.buy.push(toPublic(order));
    else bucket.sell.push(toPublic(order));
  }
  // Лучшие цены сверху: покупка — дороже, продажа — дешевле.
  for (const resource of Object.values(book)) {
    resource.buy.sort((a, b) => b.pricePerUnit - a.pricePerUnit);
    resource.sell.sort((a, b) => a.pricePerUnit - b.pricePerUnit);
  }

  const usage = await hubStockUsage(prisma, commanderId);
  const level = usage.level;
  const here = { ore: storage?.ore ?? 0, polymers: storage?.polymers ?? 0 };

  return {
    reserve,
    hub: { hubId: hub.id, name: hub.name },
    credits: round2(commander.credits),
    storage: {
      ore: Math.round(here.ore + usage.global.ore),
      polymers: Math.round(here.polymers + usage.global.polymers),
      local: { ore: Math.round(here.ore), polymers: Math.round(here.polymers) },
      global: { ore: Math.round(usage.global.ore), polymers: Math.round(usage.global.polymers) },
      elsewhere: {
        ore: Math.round(Math.max(0, usage.local.ore - here.ore)),
        polymers: Math.round(Math.max(0, usage.local.polymers - here.polymers)),
      },
      used: Math.round(usage.used),
      level,
      capacity: usage.capacity,
      free: Math.round(usage.free),
      upgradeCost: storageUpgradeCost(level + 1),
      nextLevel: level + 1,
      nextCapacity: storageCapacity(level + 1),
      rentPerHour: Math.round(hubRent(level) * 3600),
      nextRentPerHour: Math.round(hubRent(level + 1) * 3600),
    },
    book,
    // Считает сервер: цена — игровая величина, и клиент ее не выводит (правило 3).
    stats: {
      ORE: statsFor('ORE', recent, book.ORE.buy.length + book.ORE.sell.length),
      POLYMERS: statsFor('POLYMERS', recent, book.POLYMERS.buy.length + book.POLYMERS.sell.length),
    },
    barterStats: {
      open: barterOpen,
      unitsOffered: Math.round(barters.reduce((sum, offer) => sum + offer.giveQuantity, 0)),
    },
    quotes: {
      ORE: quoteFor('ORE', book.ORE, trades),
      POLYMERS: quoteFor('POLYMERS', book.POLYMERS, trades),
    },
    barters: barters.map((offer) => ({
      id: offer.id,
      trader: offer.commander.nickname,
      mine: offer.commanderId === commanderId,
      giveResource: offer.giveResource,
      giveQuantity: offer.giveQuantity,
      wantResource: offer.wantResource,
      wantQuantity: offer.wantQuantity,
      createdAt: offer.createdAt.getTime(),
    })),
    myOrders: orders.filter((order) => order.commanderId === commanderId).map(toPublic),
    trades: trades.map((trade) => ({
      id: trade.id,
      resource: trade.resource,
      quantity: trade.quantity,
      pricePerUnit: trade.pricePerUnit,
      total: trade.total,
      buyer: trade.buyer.nickname,
      seller: trade.seller.nickname,
      createdAt: trade.createdAt.getTime(),
      mine: trade.buyerId === commanderId || trade.sellerId === commanderId,
    })),
  };
}

/* ------------------------- Бартер ------------------------- */

export interface BarterView {
  id: string;
  trader: string;
  mine: boolean;
  giveResource: TradeResource;
  giveQuantity: number;
  wantResource: TradeResource;
  wantQuantity: number;
  createdAt: number;
}

/**
 * Бартер: ресурс за ресурс, без криптогривны.
 *
 * Деньги в игре дефицитны по устройству — их создает только станция, — а
 * обменять избыток полимеров на нужную руду хочется и без них. Берется
 * предложение целиком: дробить обмен незачем, а частичное исполнение усложнило
 * бы расчет вдвое ради удобства, которое всегда достигается вторым
 * предложением.
 *
 * Отдаваемый товар блокируется на складе сразу, как у обычной продажи: иначе
 * предложение можно было бы выставить, ничего не имея, и сорвать чужую сделку.
 */
export async function offerBarter(
  commanderId: string,
  input: { giveResource: TradeResource; giveQuantity: number; wantResource: TradeResource; wantQuantity: number },
): Promise<MarketResult> {
  const give = Math.floor(input.giveQuantity);
  const want = Math.floor(input.wantQuantity);
  if (!Number.isFinite(give) || give <= 0 || !Number.isFinite(want) || want <= 0) {
    return { ok: false, error: 'Объемы обмена должны быть больше нуля' };
  }
  if (input.giveResource === input.wantResource) {
    return { ok: false, error: 'Менять ресурс на него же незачем' };
  }

  const hub = await findHubForUser(commanderId);
  if (!hub) return { ok: false, error: 'Торговый хаб не найден' };
  await ensureStorage(commanderId, hub.id);

  const field = input.giveResource === 'ORE' ? 'ore' : 'polymers';
  try {
    await prisma.$transaction(async (tx) => {
      // В залог — сначала со склада хаба, потом с общего; долю хаба запоминаем для отмены.
      const locked = await withdrawStock(tx, commanderId, hub.id, field, give);
      if (!locked) throw new MarketError('На складе хаба и на общем складе не хватает товара');

      await tx.barterOffer.create({
        data: {
          commanderId, hubId: hub.id, localPart: locked.local,
          giveResource: input.giveResource, giveQuantity: give,
          wantResource: input.wantResource, wantQuantity: want,
        },
      });
    });
  } catch (error) {
    return toError(error, 'Не удалось выставить обмен');
  }
  return { ok: true, message: `Обмен выставлен: ${give} за ${want}` };
}

/** Принять чужой обмен целиком. */
export async function acceptBarter(commanderId: string, offerId: string): Promise<MarketResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const offer = await tx.barterOffer.findUnique({ where: { id: offerId } });
      if (!offer) throw new MarketError('Обмен уже принят или снят');
      if (offer.commanderId === commanderId) throw new MarketError('Нельзя меняться с самим собой');

      // Удаляем первым делом: два одновременных согласия не должны
      // исполнить один обмен дважды.
      const taken = await tx.barterOffer.deleteMany({ where: { id: offerId } });
      if (taken.count === 0) throw new MarketError('Обмен уже принят');

      // Свою часть отдаем со склада хаба своей системы, а не хватит — с общего.
      const homeHub = await homeHubOf(tx, commanderId);
      if (!homeHub) throw new MarketError('Торговый хаб не найден');
      await lockHubStocks(tx, [commanderId, offer.commanderId]);
      const wantField = offer.wantResource === 'ORE' ? 'ore' : 'polymers';
      const giveField = offer.giveResource === 'ORE' ? 'ore' : 'polymers';

      const paid = await withdrawStock(tx, commanderId, homeHub.id, wantField, offer.wantQuantity);
      if (!paid) throw new MarketError('На складе хаба и на общем складе не хватает товара — обмен не по карману');

      // Полученное обменом — как купленное: обеим сторонам на общий склад.
      if (!(await depositGlobal(tx, commanderId, giveField, offer.giveQuantity))) {
        throw new MarketError('На складе не хватает места под обмен');
      }
      if (!(await depositGlobal(tx, offer.commanderId, wantField, offer.wantQuantity))) {
        throw new MarketError('У автора обмена не хватает места на складе');
      }
    });
  } catch (error) {
    return toError(error, 'Не удалось принять обмен');
  }
  return { ok: true, message: 'Обмен состоялся' };
}

/** Снять свой обмен: залог возвращается без оглядки на лимит склада. */
export async function cancelBarter(commanderId: string, offerId: string): Promise<MarketResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const offer = await tx.barterOffer.findUnique({ where: { id: offerId } });
      if (!offer || offer.commanderId !== commanderId) throw new MarketError('Обмен не найден');

      const removed = await tx.barterOffer.deleteMany({ where: { id: offerId, commanderId } });
      if (removed.count === 0) throw new MarketError('Обмен уже снят');

      const field = offer.giveResource === 'ORE' ? 'ore' : 'polymers';
      // Свой же товар возвращается поверх лимита и туда, откуда ушел: иначе снятие
      // обмена стало бы способом перенести привезенное на общий склад.
      const local = Math.min(offer.giveQuantity, offer.localPart ?? offer.giveQuantity);
      await refundStock(tx, commanderId, offer.hubId, field, local, offer.giveQuantity - local);
    });
  } catch (error) {
    return toError(error, 'Не удалось снять обмен');
  }
  return { ok: true, message: 'Обмен снят, товар вернулся' };
}

/** Сводка по ресурсу из уже отсортированного стакана и списка сделок. */
function quoteFor(
  resource: TradeResource,
  side: { buy: PublicOrder[]; sell: PublicOrder[] },
  trades: Array<{ resource: string; pricePerUnit: number; quantity: number }>,
): Quote {
  // Стакан уже отсортирован: покупка по убыванию, продажа по возрастанию.
  const bestBuy = side.buy[0]?.pricePerUnit ?? null;
  const bestSell = side.sell[0]?.pricePerUnit ?? null;
  const last = trades.find((trade) => trade.resource === resource)?.pricePerUnit ?? null;
  // Спрос и предложение — весь стакан по сторонам, а не только лучшие цены:
  // перекос считается по объему, и одна дорогая заявка на сто единиц
  // не должна весить столько же, сколько десять тысяч по рыночной.
  const volume = (rows: PublicOrder[]) => rows.reduce((sum, row) => sum + row.remaining, 0);
  return quote(resource, bestBuy, bestSell, last, trades, {
    demand: volume(side.buy),
    supply: volume(side.sell),
  });
}

/** Расширение личного склада на хабе — платится товаром, который уже лежит на складе. */
export async function upgradeStorage(commanderId: string): Promise<MarketResult> {
  const account = await hubAccount(prisma, commanderId);
  const cost = storageUpgradeCost(account.level + 1);

  let level = account.level;
  try {
    await prisma.$transaction(async (tx) => {
      // Списание и расширение одной транзакцией: проверка баланса отдельно
      // от списания дала бы гонку, вычерпывающую счет дважды (правило 2).
      const paid = await tx.commander.updateMany({
        where: { id: commanderId, credits: { gte: cost } },
        data: { credits: { decrement: cost } },
      });
      if (paid.count === 0) throw new MarketError(`Нужно ${cost} ₴ — столько стоит расширение`);

      const raised = await tx.hubAccount.updateMany({
        where: { id: account.id, level: account.level },
        data: { level: { increment: 1 } },
      });
      if (raised.count === 0) throw new MarketError('Склад уже расширили');
      level = account.level + 1;
    });
  } catch (error) {
    return toError(error, 'Расширить склад не удалось');
  }

  await syncCredits(commanderId);
  return {
    ok: true,
    message: `Склад расширен до уровня ${level}: вместимость ${storageCapacity(level)} на все хабы`,
  };
}

/**
 * Выставление ордера в стакан.
 *
 * Товар (для продажи) или криптогривна (для покупки) списываются в залог
 * сразу — иначе одну и ту же руду можно было бы выставить в десяти ордерах.
 *
 * Списание идет условным `UPDATE ... WHERE поле >= сумма`: обычная схема
 * «прочитать остаток → сравнить → записать» под параллельными запросами
 * уводила склад и баланс в минус (см. tests/stress-market-fleet.mjs).
 */
export async function placeOrder(
  commanderId: string,
  input: { side: OrderSide; resource: TradeResource; quantity: number; pricePerUnit: number },
  /*
   * Хаб задается явно только резервом: колонии у него нет, и хаб «своей
   * системы» не находится. Стакан общий на весь сервер, поэтому какой именно
   * хаб — для сделок неважно, он решает лишь, чей склад держит залог.
   */
  options: { hubId?: string } = {},
): Promise<MarketResult> {
  const invalid = validateOrder(input);
  if (invalid) return { ok: false, error: invalid };

  const hub = options.hubId
    ? await prisma.tradeHub.findUnique({ where: { id: options.hubId } })
    : await findHubForUser(commanderId);
  if (!hub) return { ok: false, error: 'Торговый хаб не найден' };
  await ensureStorage(commanderId, hub.id);

  const field = input.resource === 'ORE' ? 'ore' : 'polymers';
  const total = tradeTotal(input.quantity, input.pricePerUnit);
  let matched: { quantity: number; total: number } = { quantity: 0, total: 0 };
  let localPart: number | null = null;

  try {
    await prisma.$transaction(async (tx) => {
      if (input.side === 'SELL') {
        // В залог — сначала со склада хаба, потом с общего, под блокировкой складов
        // командира; долю хаба запоминаем, чтобы отмена вернула товар туда же.
        const locked = await withdrawStock(tx, commanderId, hub.id, field, input.quantity);
        if (!locked) {
          const available = await availableAt(tx, commanderId, hub.id);
          throw new MarketError(
            `На складе хаба и на общем складе только ${Math.floor(available[field])} — ${RESOURCE_LABELS[input.resource]}`,
          );
        }
        localPart = locked.local;
      } else {
        // Залог включает комиссию: иначе при сведении по своей же цене
        // на сбор бы не хватило.
        const escrow = buyerEscrow(input.quantity, input.pricePerUnit);
        const paid = await tx.commander.updateMany({
          where: { id: commanderId, credits: { gte: escrow } },
          data: { credits: { decrement: escrow } },
        });
        if (paid.count === 0) {
          throw new MarketError(`Не хватает криптогривны: нужно ${escrow} ₴ вместе с комиссией`);
        }
      }

      const created = await tx.marketOrder.create({
        data: {
          hubId: hub.id,
          localPart,
          commanderId,
          side: input.side,
          resource: input.resource,
          pricePerUnit: input.pricePerUnit,
          quantity: input.quantity,
          remaining: input.quantity,
        },
      });

      matched = await matchOrder(tx, created);
    });
  } catch (error) {
    return toError(error, 'Не удалось выставить ордер');
  }

  await syncCredits(commanderId);

  // Сведение — обычный исход, а не исключение: если встречная заявка была,
  // сделка уже прошла, и молчать об этом было бы странно.
  if (matched.quantity > 0) {
    const rest = input.quantity - matched.quantity;
    return {
      ok: true,
      message:
        `Сведено ${matched.quantity} на ${matched.total} ₴` +
        (rest > 0 ? `, в стакане осталось ${rest}` : ' — заявка закрыта целиком'),
    };
  }

  return {
    ok: true,
    message:
      input.side === 'SELL'
        ? `Ордер на продажу выставлен: ${input.quantity} × ${input.pricePerUnit} ₴`
        : `Ордер на покупку выставлен: заблокировано ${total} ₴`,
  };
}

/**
 * Сведение встречных заявок.
 *
 * Заявка, пересекающаяся с чужой, исполняется сразу и по средней цене: продавец
 * хочет дороже, покупатель дешевле, оба уже согласились на свою цену, и середина
 * делит разницу поровну. Отдать сделку по цене одной из сторон значило бы
 * подарить весь выигрыш тому, кто выставился вторым.
 *
 * Объем берется по меньшей заявке, остаток большей продолжает висеть по своей
 * прежней цене. Непересекающиеся заявки не трогаются вовсе — они ждут, пока
 * кто-нибудь не подвинется.
 *
 * Идем от лучшей встречной цены: покупателю — самая дешевая продажа, продавцу —
 * самая дорогая покупка.
 */
async function matchOrder(
  tx: Prisma.TransactionClient,
  order: { id: string; hubId: string; commanderId: string; side: OrderSide; resource: TradeResource; pricePerUnit: number; remaining: number },
): Promise<{ quantity: number; total: number }> {
  const field = order.resource === 'ORE' ? 'ore' : 'polymers';
  const counter = await tx.marketOrder.findMany({
    where: {
      resource: order.resource,
      side: order.side === 'SELL' ? 'BUY' : 'SELL',
      remaining: { gt: 0 },
      commanderId: { not: order.commanderId },
      // Пересечение: покупатель дает не меньше, чем просит продавец.
      pricePerUnit: order.side === 'SELL' ? { gte: order.pricePerUnit } : { lte: order.pricePerUnit },
    },
    orderBy: { pricePerUnit: order.side === 'SELL' ? 'desc' : 'asc' },
    take: 20,
  });

  let left = order.remaining;
  let filled = 0;
  let paidTotal = 0;

  for (const other of counter) {
    if (left <= 0) break;
    const volume = Math.min(left, other.remaining);
    if (volume <= 0) continue;

    const price = matchPrice(order.pricePerUnit, other.pricePerUnit);
    const total = tradeTotal(volume, price);

    const sellerId = order.side === 'SELL' ? order.commanderId : other.commanderId;
    const buyerId = order.side === 'SELL' ? other.commanderId : order.commanderId;
    const buyerBid = order.side === 'SELL' ? other.pricePerUnit : order.pricePerUnit;
    // «Торговые связи» синдиката снижают комиссию каждой стороне по-своему.
    // В журнал сделка пишется на хаб, где выставлена продажа.
    const tradeHubId = order.side === 'SELL' ? order.hubId : other.hubId;
    const [sellerBuffs, buyerBuffs, pacts] = await Promise.all([
      syndicateBuffsFor(sellerId),
      syndicateBuffsFor(buyerId),
      commanderPacts(sellerId, buyerId),
    ]);
    // Торговое соглашение синдикатов снижает комиссию обеим сторонам сделки.
    const pactFee = pacts.includes('TRADE') ? TRADE_PACT_FEE_MULTIPLIER : 1;

    // Товар уже в залоге у продавца, деньги — у покупателя. Осталось развести.
    /*
     * Купленное ложится на общий склад покупателя — его можно забрать с любого хаба.
     * Места нет — встречная заявка пропускается, а не роняет всю: в общем стакане
     * покупатель не может заранее подготовить место под каждую сделку.
     */
    if (!(await depositGlobal(tx, buyerId, field, volume))) continue;

    await tx.commander.update({
      where: { id: sellerId },
      data: { credits: { increment: total - sellerFee(total, sellerBuffs.tradeFee * pactFee) } },
    });

    /*
     * Покупатель заложил деньги по своей цене, а сделка прошла по средней —
     * значит он переплатил в залог, и разницу надо вернуть. Без этого
     * выставившийся дороже терял бы всю выгоду от встречи посередине.
     */
    const refund = buyerEscrow(volume, buyerBid) - (total + buyerFee(total, buyerBuffs.tradeFee * pactFee));
    if (refund > 0) {
      await tx.commander.update({ where: { id: buyerId }, data: { credits: { increment: refund } } });
    }

    await tx.marketOrder.update({
      where: { id: other.id },
      data: { remaining: { decrement: volume } },
    });
    await tx.marketOrder.deleteMany({ where: { id: other.id, remaining: { lte: 0 } } });

    await tx.trade.create({
      data: { hubId: tradeHubId, buyerId, sellerId, resource: order.resource, quantity: volume, pricePerUnit: price, total },
    });

    left -= volume;
    filled += volume;
    paidTotal += total;
  }

  if (filled > 0) {
    await tx.marketOrder.update({ where: { id: order.id }, data: { remaining: { decrement: filled } } });
    await tx.marketOrder.deleteMany({ where: { id: order.id, remaining: { lte: 0 } } });
  }

  return { quantity: filled, total: Math.round(paidTotal * 100) / 100 };
}

/**
 * Отмена своего ордера с возвратом залога.
 *
 * Удаление идет первым: если две отмены пришли одновременно, вернуть залог
 * сможет только тот запрос, чей DELETE реально удалил строку. Иначе залог
 * вернулся бы дважды.
 */
export async function cancelOrder(commanderId: string, orderId: string): Promise<MarketResult> {
  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.marketOrder.findUnique({ where: { id: orderId } });
      if (!order || order.commanderId !== commanderId) throw new MarketError('Ордер не найден');

      // Удаляем первым делом: если два запроса на отмену пришли разом,
      // вернуть залог сможет только тот, чей DELETE реально сработал.
      const removed = await tx.marketOrder.deleteMany({ where: { id: order.id, commanderId } });
      if (removed.count === 0) throw new MarketError('Ордер уже снят');

      if (order.side === 'SELL') {
        const field = order.resource === 'ORE' ? 'ore' : 'polymers';
        /*
         * Возврат залога кладется на склад без оглядки на лимит.
         *
         * Проверка вместимости здесь запирала игрока в собственных заявках:
         * склад полон — снять ордер нельзя, потому что товару некуда лечь;
         * освободить место нечем, потому что товар заперт в ордере. Живой бот
         * попал в это ровно так и остался с пятью неснимаемыми заявками.
         *
         * Лимит при этом не обходится: это не новая добыча, а свой же товар,
         * который вернулся, — ровно тот случай, для которого переполнение
         * склада и предусмотрено, как у возвратного рейса на колонии.
         */
        // Продажи съедают сначала долю с общего склада, поэтому остаток заявки —
        // прежде всего то, что взято со склада хаба. Туда он и возвращается.
        const local = Math.min(order.remaining, order.localPart ?? order.remaining);
        await refundStock(tx, commanderId, order.hubId, field, local, order.remaining - local);
      } else {
        // Возвращаем залог целиком, вместе с заложенной комиссией:
        // сделки не было, значит и сбора нет.
        await tx.commander.update({
          where: { id: commanderId },
          data: { credits: { increment: buyerEscrow(order.remaining, order.pricePerUnit) } },
        });
      }
    });
  } catch (error) {
    return toError(error, 'Не удалось отменить ордер');
  }

  await syncCredits(commanderId);
  return { ok: true, message: 'Ордер отменен, заблокированное вернулось' };
}

/**
 * Исполнение чужого ордера. Для SELL-ордера вызывающий покупает товар,
 * для BUY-ордера — продает свой товар со склада хаба.
 *
 * Порядок шагов в транзакции выбран так, чтобы гонки не создавали товар
 * из воздуха:
 * 1. объем захватывается условным списанием `remaining` у самого ордера —
 *    это единственная строка, за которую конкурируют все покупатели;
 * 2. деньги и товар переводятся тоже условными запросами;
 * 3. исчерпанный ордер удаляется, сделка пишется в журнал.
 *
 * Проигравший гонку получает отказ «ордер разобрали» и ничего не теряет:
 * транзакция откатывается целиком.
 *
 * Криптогривна покупателя при BUY-ордере уже лежит в залоге с момента
 * выставления, поэтому продавцу она просто начисляется.
 */
export async function fillOrder(
  commanderId: string,
  orderId: string,
  quantity: number,
): Promise<MarketResult> {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return { ok: false, error: 'Объем должен быть больше нуля' };
  }

  let executed = 0;
  let total = 0;
  let counterpartId = '';

  try {
    await prisma.$transaction(async (tx) => {
      const order = await tx.marketOrder.findUnique({ where: { id: orderId } });
      if (!order || order.remaining <= 0) throw new MarketError('Ордер уже исполнен или снят');
      if (order.commanderId === commanderId) throw new MarketError('Нельзя торговать с самим собой');

      counterpartId = order.commanderId;
      executed = Math.min(quantity, order.remaining);
      total = tradeTotal(executed, order.pricePerUnit);
      const field = order.resource === 'ORE' ? 'ore' : 'polymers';

      // Продаем со склада хаба своей системы, а не хватит — с общего; купленное — на общий склад.
      const homeHub = await homeHubOf(tx, commanderId);
      if (!homeHub) throw new MarketError('Торговый хаб не найден');
      await lockHubStocks(tx, [commanderId, order.commanderId]);

      // Захватываем объем в самом ордере условным списанием: если параллельный
      // запрос успел раньше, count будет 0 и фантомной сделки не случится.
      const taken = await tx.marketOrder.updateMany({
        where: { id: order.id, remaining: { gte: executed } },
        data: { remaining: { decrement: executed } },
      });
      if (taken.count === 0) throw new MarketError('Ордер разобрали, попробуй меньший объем');
      // Торговое соглашение синдикатов снижает комиссию и в сделке по клику.
      const pactFee = (await commanderPacts(commanderId, order.commanderId)).includes('TRADE') ? TRADE_PACT_FEE_MULTIPLIER : 1;

      if (order.side === 'SELL') {
        // Мы покупаем: платим криптогривну, товар ложится на наш общий склад.
        const paid = await tx.commander.updateMany({
          where: { id: commanderId, credits: { gte: total } },
          data: { credits: { decrement: total } },
        });
        if (paid.count === 0) throw new MarketError(`Не хватает криптогривны: нужно ${total} ₴`);

        if (!(await depositGlobal(tx, commanderId, field, executed))) {
          const usage = await hubStockUsage(tx, commanderId);
          throw new MarketError(`На складе свободно только ${Math.floor(usage.free)}`);
        }
        // Комиссия биржи исчезает из оборота: это второй сток денег
        // и единственный, работающий на больших оборотах.
        await tx.commander.update({
          where: { id: order.commanderId },
          data: { credits: { increment: total - sellerFee(total, (await syndicateBuffsFor(order.commanderId)).tradeFee * pactFee) } },
        });
      } else {
        // Мы продаем: товар уходит со склада, криптогривна покупателя уже в залоге.
        const shipped = await withdrawStock(tx, commanderId, homeHub.id, field, executed);
        if (!shipped) {
          const available = await availableAt(tx, commanderId, homeHub.id);
          throw new MarketError(`На складе хаба и на общем складе только ${Math.floor(available[field])}`);
        }
        if (!(await depositGlobal(tx, order.commanderId, field, executed))) {
          throw new MarketError('У покупателя не хватает места на складе');
        }
        await tx.commander.update({
          where: { id: commanderId },
          data: { credits: { increment: total - sellerFee(total, (await syndicateBuffsFor(commanderId)).tradeFee * pactFee) } },
        });
      }

      await tx.marketOrder.deleteMany({ where: { id: order.id, remaining: { lte: 0 } } });

      await tx.trade.create({
        data: {
          hubId: order.side === 'SELL' ? order.hubId : homeHub.id,
          buyerId: order.side === 'SELL' ? commanderId : order.commanderId,
          sellerId: order.side === 'SELL' ? order.commanderId : commanderId,
          resource: order.resource,
          quantity: executed,
          pricePerUnit: order.pricePerUnit,
          total,
        },
      });
    });
  } catch (error) {
    return toError(error, 'Сделка не прошла');
  }

  await syncCredits(commanderId);
  if (counterpartId) await syncCredits(counterpartId);

  return { ok: true, message: `Сделка исполнена: ${executed} единиц на ${total} ₴` };
}


class MarketError extends Error {}

function toError(error: unknown, fallback: string): MarketResult {
  if (error instanceof MarketError) return { ok: false, error: error.message };
  console.error('[market] ошибка операции:', error);
  return { ok: false, error: fallback };
}

/** Баланс изменился — обновляем кэш игрока в Game Loop, если он в сети. */
async function syncCredits(commanderId: string): Promise<void> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { credits: true },
  });
  if (commander) gameLoop.syncCredits(commanderId, commander.credits);
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Средняя цена ресурса по дням — для графика в шапке.
 *
 * Ленивый запрос, а не часть общей сводки: график смотрят по клику и редко,
 * а рынок опрашивается постоянно, и таскать тридцать точек в каждом ответе
 * значило бы платить за них всегда ради тех случаев, когда их читают.
 *
 * День берется средневзвешенным по объему, как и рыночная цена: одна крупная
 * сделка говорит о цене больше, чем десять мелких, и без веса случайная
 * мелочь двигала бы дневную отметку наравне с настоящим оборотом.
 */
export async function priceHistory(
  // Биржа общая на сервер, и график у всех один; командир остается в сигнатуре
  // ради роута, который зовет все торговые чтения одинаково.
  _commanderId: string,
  resource: TradeResource,
  days = 30,
): Promise<Array<{ day: string; price: number; volume: number }>> {
  const since = new Date(Date.now() - days * DAY_MS);
  const rows = await prisma.trade.findMany({
    where: { resource, createdAt: { gte: since } },
    select: { quantity: true, pricePerUnit: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const byDay = new Map<string, { volume: number; total: number }>();
  for (const row of rows) {
    if (row.quantity <= 0 || row.pricePerUnit <= 0) continue;
    const day = row.createdAt.toISOString().slice(0, 10);
    const bucket = byDay.get(day) ?? { volume: 0, total: 0 };
    bucket.volume += row.quantity;
    bucket.total += row.quantity * row.pricePerUnit;
    byDay.set(day, bucket);
  }

  // Дни без сделок пропускаются, а не рисуются нулем: ноль на графике цены
  // означал бы «отдавали даром», а не «не торговали».
  return [...byDay.entries()].map(([day, bucket]) => ({
    day,
    price: Math.round((bucket.total / bucket.volume) * 100) / 100,
    volume: Math.round(bucket.volume),
  }));
}

/**
 * Страница истории сделок.
 *
 * Отдельно от общей сводки затем, что подкачка не должна тащить с собой
 * стакан, склад и котировки: игрок листает историю, а не перезагружает рынок.
 */
export async function tradeHistory(
  commanderId: string,
  options: { before?: number | undefined; resource?: TradeResource | undefined; mineOnly?: boolean } = {},
): Promise<MarketView['trades']> {
  const rows = await prisma.trade.findMany({
    where: {
      ...(options.resource ? { resource: options.resource } : {}),
      ...(options.before ? { createdAt: { lt: new Date(options.before) } } : {}),
      ...(options.mineOnly ? { OR: [{ buyerId: commanderId }, { sellerId: commanderId }] } : {}),
    },
    include: { buyer: { select: { nickname: true } }, seller: { select: { nickname: true } } },
    orderBy: { createdAt: 'desc' },
    take: HISTORY_PAGE,
  });

  return rows.map((trade) => ({
    id: trade.id,
    resource: trade.resource,
    quantity: trade.quantity,
    pricePerUnit: trade.pricePerUnit,
    total: Math.round(trade.quantity * trade.pricePerUnit * 100) / 100,
    buyer: trade.buyer.nickname,
    seller: trade.seller.nickname,
    createdAt: trade.createdAt.getTime(),
    mine: trade.buyerId === commanderId || trade.sellerId === commanderId,
  }));
}
