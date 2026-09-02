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
 * Справочная цена ресурса в криптогривне.
 *
 * Своей цены у игры нет — стакан целиком игрокский. Но без точки отсчета
 * число в стакане ничего не значит: «14 за полимеры» дорого это или дешево,
 * сказать не по чему. Отношение взято из относительной скорости добычи:
 * полимеры добываются примерно в полтора раза медленнее руды, значит
 * и стоить должны во столько же дороже.
 *
 * Той же величиной пользуется бот, когда держит свои заявки в коридоре, —
 * и она должна быть одна на всех, иначе интерфейс и бот считают по-разному.
 */
export const REFERENCE_PRICE: Record<TradeResource, number> = { ORE: 10, POLYMERS: 14 };

/**
 * Станция как маркетмейкер: она всегда готова купить и продать.
 *
 * Без нее у криптогривны нет ни источника, ни стока. Все сделки между игроками
 * — переводы, денежная масса равна стартовой тысяче на командира и не растет
 * никогда, а добыча растет экспоненциально. Курс гривны обязан улететь в небо,
 * и торговля встанет: продавать некому, потому что покупать не на что.
 *
 * Станция это чинит с обеих сторон. Продал ей — деньги появились, купил у нее
 * — исчезли. Масса растет вместе с добычей и сама сжимается, когда денег
 * становится слишком много: тогда цены упираются в потолок и покупать
 * у станции выгоднее, чем у игроков.
 *
 * Заодно коридор держит курс в берегах и дает ликвидность одиночке: продать
 * можно всегда, даже когда на сервере больше никого нет.
 *
 * Замкнутого цикла нет по построению: купить у станции и продать ей же —
 * всегда убыток в размере коридора.
 */
export const STATION_SPREAD = 0.2;

/** Почем станция купит у игрока. Всегда ниже справочной. */
export function stationBuyPrice(resource: TradeResource): number {
  return Math.round(REFERENCE_PRICE[resource] * (1 - STATION_SPREAD) * 100) / 100;
}

/** Почем станция продаст игроку. Всегда выше справочной. */
export function stationSellPrice(resource: TradeResource): number {
  return Math.round(REFERENCE_PRICE[resource] * (1 + STATION_SPREAD) * 100) / 100;
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
 * у множителя богатства недр. Здесь сравнивать есть с чем: справочная цена,
 * лучшие заявки с обеих сторон, спред и цена последней сделки.
 */
export interface Quote {
  reference: number;
  /** Почем станция купит и продаст: коридор, за который цена не выйдет. */
  stationBuy: number;
  stationSell: number;
  /** Лучшая цена покупки: дороже всех готовы взять. */
  bestBuy: number | null;
  /** Лучшая цена продажи: дешевле всех готовы отдать. */
  bestSell: number | null;
  /** Разрыв между ними. Пусто, если одной из сторон в стакане нет. */
  spread: number | null;
  /** Цена последней сделки — единственная цена, по которой реально сошлись. */
  last: number | null;
  /** Отклонение последней сделки от справочной, доля: 0.2 — на пятую часть дороже. */
  drift: number | null;
}

export function quote(
  resource: TradeResource,
  bestBuy: number | null,
  bestSell: number | null,
  last: number | null,
): Quote {
  const reference = REFERENCE_PRICE[resource];
  return {
    reference,
    stationBuy: stationBuyPrice(resource),
    stationSell: stationSellPrice(resource),
    bestBuy,
    bestSell,
    spread: bestBuy !== null && bestSell !== null ? Math.round((bestSell - bestBuy) * 100) / 100 : null,
    last,
    drift: last !== null && reference > 0 ? Math.round(((last - reference) / reference) * 100) / 100 : null,
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
