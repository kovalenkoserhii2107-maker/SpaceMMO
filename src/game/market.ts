/**
 * Биржа и торговые склады. Модуль чистый: только формулы и проверки.
 * Валюта — криптогривна, товар физически лежит на складе хаба.
 */

const TRADE_RESOURCES = ['ORE', 'POLYMERS'] as const;
export type TradeResource = (typeof TRADE_RESOURCES)[number];

const ORDER_SIDES = ['BUY', 'SELL'] as const;
export type OrderSide = (typeof ORDER_SIDES)[number];

export function isTradeResource(value: unknown): value is TradeResource {
  return typeof value === 'string' && (TRADE_RESOURCES as readonly string[]).includes(value);
}

export function isOrderSide(value: unknown): value is OrderSide {
  return typeof value === 'string' && (ORDER_SIDES as readonly string[]).includes(value);
}

export const RESOURCE_LABELS: Record<TradeResource, string> = {
  ORE: 'Руда',
  POLYMERS: 'Полимеры',
};

/**
 * Затравочная цена: с нее рынок начинается и больше нигде не участвует.
 *
 * Своей цены у игры нет — стакан целиком игрокский, и цену назначает он.
 * Но в пустом мире сделок еще не было, а число в стакане без точки отсчета
 * ничего не значит: «14 за полимеры» дорого это или дешево, сказать не по чему.
 * Отношение взято из относительной скорости добычи: полимеры добываются
 * примерно в полтора раза медленнее руды, значит и стоить должны во столько же
 * дороже.
 *
 * Как только сделки пошли, затравка перестает влиять на что-либо: цену
 * считает `marketPrice` по тому, за сколько реально сходились.
 */
export const SEED_PRICE: Record<TradeResource, number> = { ORE: 10, POLYMERS: 14 };

/**
 * Сколько последних сделок формируют цену.
 *
 * Окно нужно короткое: цена должна отзываться на дефицит, а не размазывать
 * его по всей истории торгов. И достаточно длинное, чтобы одна крупная сделка
 * по случайной цене не двигала рынок целиком.
 */
const PRICE_WINDOW = 20;

/**
 * Рыночная цена ресурса — средневзвешенная по объему за последние сделки.
 *
 * Взвешивание по объему обязательно: сделка на десять тысяч единиц говорит
 * о цене больше, чем сделка на сто, и без веса мелкая случайная сделка
 * двигала бы курс наравне с крупной.
 *
 * Пока сделок нет, возвращается затравка. Отличить одно от другого можно
 * по `seeded` в сводке — это разные вещи: «рынок оценил в 10» и «рынок еще
 * ничего не сказал».
 */
export function marketPrice(
  resource: TradeResource,
  trades: ReadonlyArray<{ resource: string; pricePerUnit: number; quantity: number }>,
): { price: number; seeded: boolean } {
  let volume = 0;
  let total = 0;
  let counted = 0;
  // Список приходит от свежих к старым, поэтому окно отсчитывается с начала.
  for (const trade of trades) {
    if (counted >= PRICE_WINDOW) break;
    if (trade.resource !== resource) continue;
    if (!Number.isFinite(trade.pricePerUnit) || !Number.isFinite(trade.quantity)) continue;
    if (trade.pricePerUnit <= 0 || trade.quantity <= 0) continue;
    volume += trade.quantity;
    total += trade.pricePerUnit * trade.quantity;
    counted += 1;
  }
  if (volume <= 0) return { price: SEED_PRICE[resource], seeded: true };
  return { price: Math.round((total / volume) * 100) / 100, seeded: false };
}

/**
 * Комиссия биржи со сделок между игроками.
 *
 * Второй сток денег и единственный, который работает на больших оборотах:
 * покупки у станции редки, а сделок между игроками со временем будет много.
 * Проценты намеренно малы — они не должны мешать торговать, только не давать
 * массе раздуваться без предела.
 *
 * С покупателя чуть больше, чем с продавца: покупатель уносит товар, который
 * будет работать, продавец — деньги, которые сами по себе не работают.
 */
export const SELLER_FEE = 0.005;
export const BUYER_FEE = 0.006;

export function sellerFee(total: number): number {
  return Math.round(total * SELLER_FEE * 100) / 100;
}

export function buyerFee(total: number): number {
  return Math.round(total * BUYER_FEE * 100) / 100;
}

/**
 * Сколько криптогривны блокируется под заявку на покупку.
 *
 * Комиссия входит в залог сразу. Иначе при сведении по цене, равной заявке,
 * на комиссию не хватило бы: залог считался по цене, а списать надо цену
 * плюс сбор.
 */
export function buyerEscrow(quantity: number, pricePerUnit: number): number {
  const total = tradeTotal(quantity, pricePerUnit);
  return Math.round((total + buyerFee(total)) * 100) / 100;
}

/**
 * Цена встречной сделки — середина между заявками.
 *
 * Продавец хочет дороже, покупатель дешевле, и оба уже согласились на свою
 * цену. Отдать сделку по цене одной из сторон значило бы подарить всю разницу
 * тому, кто выставился вторым. Середина делит выигрыш поровну и не зависит
 * от того, кто пришел раньше.
 */
export function matchPrice(a: number, b: number): number {
  return Math.round(((a + b) / 2) * 100) / 100;
}

/**
 * Сводка по ресурсу: по ней игрок понимает, что происходит с ценой.
 *
 * Голое число в стакане не с чем сравнить — ровно та же беда, что была
 * у множителя богатства недр. Здесь сравнивать есть с чем: цена рынка,
 * лучшие заявки с обеих сторон, спред, последняя сделка и перекос спроса.
 */
export interface Quote {
  /** Рыночная цена: средневзвешенная по последним сделкам. */
  reference: number;
  /** Сделок еще не было — цена взята из затравки и рынком не подтверждена. */
  seeded: boolean;
  /** Лучшая цена покупки: дороже всех готовы взять. */
  bestBuy: number | null;
  /** Лучшая цена продажи: дешевле всех готовы отдать. */
  bestSell: number | null;
  /** Разрыв между ними. Пусто, если одной из сторон в стакане нет. */
  spread: number | null;
  /** Цена последней сделки — единственная цена, по которой реально сошлись. */
  last: number | null;
  /** Отклонение последней сделки от рыночной, доля: 0.2 — на пятую часть дороже. */
  drift: number | null;
  /** Сколько единиц хотят купить и сколько продать — весь стакан по сторонам. */
  demand: number;
  supply: number;
  /**
   * Перекос спроса: от -1 (одни продавцы) до +1 (одни покупатели).
   *
   * Это то, ради чего рынок вообще нужен как сигнал. Положительный перекос
   * означает, что ресурс нарасхват, и вкладываться выгоднее именно в его
   * добычу — цена пойдет вверх. Отрицательный говорит обратное: этого добра
   * и так завались.
   *
   * Отношение, а не разность: разность мерялась бы в единицах товара
   * и на большом рынке всегда выглядела бы огромной.
   */
  skew: number | null;
}

export function quote(
  resource: TradeResource,
  bestBuy: number | null,
  bestSell: number | null,
  last: number | null,
  trades: ReadonlyArray<{ resource: string; pricePerUnit: number; quantity: number }> = [],
  book: { demand: number; supply: number } = { demand: 0, supply: 0 },
): Quote {
  const { price: reference, seeded } = marketPrice(resource, trades);
  const both = book.demand + book.supply;
  return {
    reference,
    seeded,
    bestBuy,
    bestSell,
    spread: bestBuy !== null && bestSell !== null ? Math.round((bestSell - bestBuy) * 100) / 100 : null,
    last,
    drift: last !== null && reference > 0 ? Math.round(((last - reference) / reference) * 100) / 100 : null,
    demand: Math.round(book.demand),
    supply: Math.round(book.supply),
    skew: both > 0 ? Math.round(((book.demand - book.supply) / both) * 100) / 100 : null,
  };
}

/** Вместимость личного склада на хабе (общая на руду и полимеры). */
export function storageCapacity(level: number): number {
  if (level <= 0) return 0;
  return Math.round(5000 * Math.pow(1.6, level - 1));
}

/** Стоимость расширения склада — платится товаром, лежащим на самом складе. */
export function storageUpgradeCost(targetLevel: number): { ore: number; polymers: number } {
  const scale = Math.pow(2, targetLevel - 2);
  return {
    ore: Math.round(1000 * scale),
    polymers: Math.round(500 * scale),
  };
}

export function storageUsed(storage: { ore: number; polymers: number }): number {
  return storage.ore + storage.polymers;
}

/** Максимальные разумные пределы ордера, чтобы нельзя было сломать биржу вводом. */
const MAX_ORDER_QUANTITY = 1_000_000;
const MAX_ORDER_PRICE = 100_000;

export interface OrderInput {
  side: OrderSide;
  resource: TradeResource;
  quantity: number;
  pricePerUnit: number;
}

/** Проверка параметров ордера. Возвращает текст ошибки или null. */
export function validateOrder(input: OrderInput): string | null {
  if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
    return 'Объем должен быть больше нуля';
  }
  if (input.quantity > MAX_ORDER_QUANTITY) {
    return `Объем не может превышать ${MAX_ORDER_QUANTITY}`;
  }
  if (!Number.isFinite(input.pricePerUnit) || input.pricePerUnit <= 0) {
    return 'Цена должна быть больше нуля';
  }
  if (input.pricePerUnit > MAX_ORDER_PRICE) {
    return `Цена не может превышать ${MAX_ORDER_PRICE} ₴`;
  }
  return null;
}

/** Стоимость сделки в криптогривне. */
export function tradeTotal(quantity: number, pricePerUnit: number): number {
  return Math.round(quantity * pricePerUnit * 100) / 100;
}
