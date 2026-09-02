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
 * Сводка по ресурсу: по ней игрок понимает, что происходит с ценой.
 *
 * Голое число в стакане не с чем сравнить — ровно та же беда, что была
 * у множителя богатства недр. Здесь сравнивать есть с чем: справочная цена,
 * лучшие заявки с обеих сторон, спред и цена последней сделки.
 */
export interface Quote {
  reference: number;
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
