/**
 * Биржа и торговые склады. Модуль чистый: только формулы и проверки.
 * Валюта — криптогривна, товар физически лежит на складе хаба.
 */

const TRADE_RESOURCES = ['METAL', 'CRYSTAL'] as const;
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
  METAL: 'Металл',
  CRYSTAL: 'Кристаллы',
};

/** Вместимость личного склада на хабе (общая на металл и кристаллы). */
export function storageCapacity(level: number): number {
  if (level <= 0) return 0;
  return Math.round(5000 * Math.pow(1.6, level - 1));
}

/** Стоимость расширения склада — платится товаром, лежащим на самом складе. */
export function storageUpgradeCost(targetLevel: number): { metal: number; crystal: number } {
  const scale = Math.pow(2, targetLevel - 2);
  return {
    metal: Math.round(1000 * scale),
    crystal: Math.round(500 * scale),
  };
}

export function storageUsed(storage: { metal: number; crystal: number }): number {
  return storage.metal + storage.crystal;
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
