/**
 * Биржа торгового хаба (Этап 4).
 * Все проверки и переводы — на сервере и в транзакции: товар и криптогривна
 * блокируются в момент выставления ордера, поэтому продать одно и то же дважды нельзя.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import {
  RESOURCE_LABELS,
  storageCapacity,
  storageUpgradeCost,
  storageUsed,
  tradeTotal,
  validateOrder,
  type OrderSide,
  type TradeResource,
} from '../game/market.js';

export type MarketResult = { ok: true; message: string } | { ok: false; error: string };

export interface MarketView {
  hub: { hubId: string; name: string } | null;
  credits: number;
  storage: {
    metal: number;
    crystal: number;
    level: number;
    capacity: number;
    free: number;
    upgradeCost: { metal: number; crystal: number };
    nextLevel: number;
    nextCapacity: number;
  } | null;
  book: Record<TradeResource, { buy: PublicOrder[]; sell: PublicOrder[] }>;
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

async function ensureStorage(commanderId: string, hubId: string) {
  return prisma.hubStorage.upsert({
    where: { commanderId_hubId: { commanderId, hubId } },
    create: { commanderId, hubId },
    update: {},
  });
}

export async function getMarketView(commanderId: string): Promise<MarketView> {
  const commander = await prisma.commander.findUnique({ where: { id: commanderId } });
  const hub = await findHubForUser(commanderId);

  if (!commander || !hub) {
    return {
      hub: null,
      credits: commander?.credits ?? 0,
      storage: null,
      book: { METAL: { buy: [], sell: [] }, CRYSTAL: { buy: [], sell: [] } },
      myOrders: [],
      trades: [],
    };
  }

  const [storage, orders, trades] = await Promise.all([
    prisma.hubStorage.findUnique({ where: { commanderId_hubId: { commanderId, hubId: hub.id } } }),
    prisma.marketOrder.findMany({
      where: { hubId: hub.id, remaining: { gt: 0 } },
      include: { commander: { select: { nickname: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.trade.findMany({
      where: { hubId: hub.id },
      include: { buyer: { select: { nickname: true } }, seller: { select: { nickname: true } } },
      orderBy: { createdAt: 'desc' },
      take: 15,
    }),
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
    METAL: { buy: [], sell: [] },
    CRYSTAL: { buy: [], sell: [] },
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

  const level = storage?.level ?? 1;

  return {
    hub: { hubId: hub.id, name: hub.name },
    credits: round2(commander.credits),
    storage: {
      metal: Math.round(storage?.metal ?? 0),
      crystal: Math.round(storage?.crystal ?? 0),
      level,
      capacity: storageCapacity(level),
      free: Math.max(0, storageCapacity(level) - storageUsed(storage ?? { metal: 0, crystal: 0 })),
      upgradeCost: storageUpgradeCost(level + 1),
      nextLevel: level + 1,
      nextCapacity: storageCapacity(level + 1),
    },
    book,
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

/** Расширение личного склада на хабе — платится товаром, который уже лежит на складе. */
export async function upgradeStorage(commanderId: string): Promise<MarketResult> {
  const hub = await findHubForUser(commanderId);
  if (!hub) return { ok: false, error: 'Торговый хаб не найден' };

  const storage = await ensureStorage(commanderId, hub.id);
  const cost = storageUpgradeCost(storage.level + 1);

  if (storage.metal < cost.metal || storage.crystal < cost.crystal) {
    return {
      ok: false,
      error: `Нужно ${cost.metal} металла и ${cost.crystal} кристаллов на складе хаба`,
    };
  }

  const updated = await prisma.hubStorage.update({
    where: { id: storage.id },
    data: {
      metal: { decrement: cost.metal },
      crystal: { decrement: cost.crystal },
      level: { increment: 1 },
    },
  });

  return {
    ok: true,
    message: `Склад расширен до уровня ${updated.level}: вместимость ${storageCapacity(updated.level)}`,
  };
}

/**
 * Выставление ордера в стакан.
 *
 * Товар (для продажи) или криптогривна (для покупки) списываются в залог
 * сразу — иначе один и тот же металл можно было бы выставить в десяти ордерах.
 *
 * Списание идет условным `UPDATE ... WHERE поле >= сумма`: обычная схема
 * «прочитать остаток → сравнить → записать» под параллельными запросами
 * уводила склад и баланс в минус (см. tests/stress-market-fleet.mjs).
 */
export async function placeOrder(
  commanderId: string,
  input: { side: OrderSide; resource: TradeResource; quantity: number; pricePerUnit: number },
): Promise<MarketResult> {
  const invalid = validateOrder(input);
  if (invalid) return { ok: false, error: invalid };

  const hub = await findHubForUser(commanderId);
  if (!hub) return { ok: false, error: 'Торговый хаб не найден' };
  await ensureStorage(commanderId, hub.id);

  const field = input.resource === 'METAL' ? 'metal' : 'crystal';
  const total = tradeTotal(input.quantity, input.pricePerUnit);

  try {
    await prisma.$transaction(async (tx) => {
      if (input.side === 'SELL') {
        // Условное списание: товар уходит в залог только если он реально есть.
        // Обычный read-modify-write здесь давал гонку и уводил склад в минус.
        const locked = await tx.hubStorage.updateMany({
          where: { commanderId, hubId: hub.id, [field]: { gte: input.quantity } },
          data: { [field]: { decrement: input.quantity } },
        });
        if (locked.count === 0) {
          const storage = await tx.hubStorage.findUnique({
            where: { commanderId_hubId: { commanderId, hubId: hub.id } },
          });
          throw new MarketError(
            `На складе хаба только ${Math.floor(storage?.[field] ?? 0)} — ${RESOURCE_LABELS[input.resource]}`,
          );
        }
      } else {
        const paid = await tx.commander.updateMany({
          where: { id: commanderId, credits: { gte: total } },
          data: { credits: { decrement: total } },
        });
        if (paid.count === 0) {
          throw new MarketError(`Не хватает криптогривны: нужно ${total} ₴`);
        }
      }

      await tx.marketOrder.create({
        data: {
          hubId: hub.id,
          commanderId,
          side: input.side,
          resource: input.resource,
          pricePerUnit: input.pricePerUnit,
          quantity: input.quantity,
          remaining: input.quantity,
        },
      });
    });
  } catch (error) {
    return toError(error, 'Не удалось выставить ордер');
  }

  await syncCredits(commanderId);
  return {
    ok: true,
    message:
      input.side === 'SELL'
        ? `Ордер на продажу выставлен: ${input.quantity} × ${input.pricePerUnit} ₴`
        : `Ордер на покупку выставлен: заблокировано ${total} ₴`,
  };
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
        const field = order.resource === 'METAL' ? 'metal' : 'crystal';
        const storage = await tx.hubStorage.findUniqueOrThrow({
          where: { commanderId_hubId: { commanderId, hubId: order.hubId } },
        });
        await incrementStorage(tx, storage.id, field, order.remaining, storageCapacity(storage.level),
          'На складе хаба не хватает места, чтобы вернуть товар');
      } else {
        await tx.commander.update({
          where: { id: commanderId },
          data: { credits: { increment: tradeTotal(order.remaining, order.pricePerUnit) } },
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
      const field = order.resource === 'METAL' ? 'metal' : 'crystal';

      // Захватываем объем в самом ордере условным списанием: если параллельный
      // запрос успел раньше, count будет 0 и фантомной сделки не случится.
      const taken = await tx.marketOrder.updateMany({
        where: { id: order.id, remaining: { gte: executed } },
        data: { remaining: { decrement: executed } },
      });
      if (taken.count === 0) throw new MarketError('Ордер разобрали, попробуй меньший объем');

      const myStorage = await tx.hubStorage.upsert({
        where: { commanderId_hubId: { commanderId, hubId: order.hubId } },
        create: { commanderId, hubId: order.hubId },
        update: {},
      });

      if (order.side === 'SELL') {
        // Мы покупаем: платим криптогривну, товар ложится на наш склад хаба.
        const paid = await tx.commander.updateMany({
          where: { id: commanderId, credits: { gte: total } },
          data: { credits: { decrement: total } },
        });
        if (paid.count === 0) throw new MarketError(`Не хватает криптогривны: нужно ${total} ₴`);

        await incrementStorage(tx, myStorage.id, field, executed, storageCapacity(myStorage.level),
          `На складе хаба свободно только ${Math.floor(storageCapacity(myStorage.level) - storageUsed(myStorage))}`);
        await tx.commander.update({ where: { id: order.commanderId }, data: { credits: { increment: total } } });
      } else {
        // Мы продаем: товар уходит со склада, криптогривна покупателя уже в залоге.
        const shipped = await tx.hubStorage.updateMany({
          where: { id: myStorage.id, [field]: { gte: executed } },
          data: { [field]: { decrement: executed } },
        });
        if (shipped.count === 0) {
          throw new MarketError(`На складе хаба только ${Math.floor(myStorage[field])}`);
        }

        const buyerStorage = await tx.hubStorage.upsert({
          where: { commanderId_hubId: { commanderId: order.commanderId, hubId: order.hubId } },
          create: { commanderId: order.commanderId, hubId: order.hubId },
          update: {},
        });
        await incrementStorage(tx, buyerStorage.id, field, executed, storageCapacity(buyerStorage.level),
          'У покупателя не хватает места на складе хаба');
        await tx.commander.update({ where: { id: commanderId }, data: { credits: { increment: total } } });
      }

      await tx.marketOrder.deleteMany({ where: { id: order.id, remaining: { lte: 0 } } });

      await tx.trade.create({
        data: {
          hubId: order.hubId,
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

/**
 * Пополнение склада хаба с проверкой вместимости прямо в UPDATE:
 * арифметику «занято + приход <= вместимость» нельзя выразить фильтром Prisma,
 * поэтому используем условный SQL — иначе параллельные зачисления переполняют склад.
 */
async function incrementStorage(
  tx: Pick<typeof prisma, '$executeRaw'>,
  storageId: string,
  field: 'metal' | 'crystal',
  amount: number,
  capacity: number,
  errorMessage: string,
): Promise<void> {
  if (amount <= 0) return;

  const updated =
    field === 'metal'
      ? await tx.$executeRaw`UPDATE hub_storages SET metal = metal + ${amount}
          WHERE id = ${storageId} AND metal + crystal + ${amount} <= ${capacity}`
      : await tx.$executeRaw`UPDATE hub_storages SET crystal = crystal + ${amount}
          WHERE id = ${storageId} AND metal + crystal + ${amount} <= ${capacity}`;

  if (updated === 0) throw new MarketError(errorMessage);
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
