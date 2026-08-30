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

/** Пара «титанит/силикаты» из тела запроса. */
export function amountsOrNull(
  input: { titanite?: unknown; silicate?: unknown } | undefined,
): { titanite: number; silicate: number } | null {
  const titanite = nonNegativeInt(input?.titanite);
  const silicate = nonNegativeInt(input?.silicate);
  if (titanite === null || silicate === null) return null;
  return { titanite, silicate };
}

/** Груз флота: титанит, силикаты и тритий делят один трюм. */
export function cargoOrNull(
  input: { titanite?: unknown; silicate?: unknown; tritium?: unknown } | undefined,
): { titanite: number; silicate: number; tritium: number } | null {
  const amounts = amountsOrNull(input);
  const tritium = nonNegativeInt(input?.tritium);
  if (!amounts || tritium === null) return null;
  return { ...amounts, tritium };
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
