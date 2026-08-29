/** Разбор пользовательского ввода: некорректные значения отклоняем, а не подгоняем молча. */
import { emptyShipCounts, SHIP_TYPES, type ShipCounts } from '../game/ships.js';

/** Целое число >= 0. Дробное, отрицательное или нечисловое — null. */
export function nonNegativeInt(value: unknown, fallback = 0): number | null {
  if (value === undefined || value === null || value === '') return fallback;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}

/** Целое число > 0. */
export function positiveInt(value: unknown): number | null {
  const parsed = nonNegativeInt(value, Number.NaN);
  if (parsed === null || !Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

/** Положительная цена с точностью до сотых. */
export function positivePrice(value: unknown): number | null {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return Math.round(parsed * 100) / 100;
}

/** Пара «металл/кристаллы» из тела запроса. */
export function amountsOrNull(
  input: { metal?: unknown; crystal?: unknown } | undefined,
): { metal: number; crystal: number } | null {
  const metal = nonNegativeInt(input?.metal);
  const crystal = nonNegativeInt(input?.crystal);
  if (metal === null || crystal === null) return null;
  return { metal, crystal };
}

/** Груз флота: металл, кристаллы и дейтерий делят один трюм. */
export function cargoOrNull(
  input: { metal?: unknown; crystal?: unknown; deuterium?: unknown } | undefined,
): { metal: number; crystal: number; deuterium: number } | null {
  const amounts = amountsOrNull(input);
  const deuterium = nonNegativeInt(input?.deuterium);
  if (!amounts || deuterium === null) return null;
  return { ...amounts, deuterium };
}

/** Состав флота: только целые неотрицательные значения, иначе запрос отклоняется. */
export function shipCountsOrNull(input: unknown): ShipCounts | null {
  const source = (input ?? {}) as Record<string, unknown>;
  const ships = emptyShipCounts();
  for (const type of SHIP_TYPES) {
    const count = nonNegativeInt(source[type]);
    if (count === null) return null;
    ships[type] = count;
  }
  return ships;
}
