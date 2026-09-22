/**
 * Резерв хаба — центральный банк биржи.
 *
 * Биржа без станции оказалась рынком без опоры: боты продают то, чего больше
 * половины склада, и покупают то, чего не хватает на цель, — независимо
 * от цены. У такого рынка нет равновесия, и цена катится в сторону перекоса
 * стакана без предела: прогон недели с настоящими рейсами уводил руду
 * с 36 до 11 781 за трое суток, а правки котировок либо оставляли пузырь,
 * либо роняли цену до 0.04.
 *
 * Резерв держит коридор и только коридор. Внутри него рынок свободен,
 * и резерва там нет. На границах стоят его заявки — обычные заявки
 * в стакане, с которыми торгуют по тем же правилам, что друг с другом:
 *
 *   - потолок — «импорт»: продажа без предела запаса. Товар появляется
 *     из ничего, как у шахты, а деньги покупателя уходят из мира в фонд,
 *     то есть это сток, а не печать денег;
 *   - пол — выкуп на деньги фонда, и только на них. Денег резерв не печатает
 *     никогда: фонд — выручка от импорта и половина аренды складов, которая
 *     иначе сгорала бы. Кончились деньги — пол не держится, рынок свободен.
 *
 * Чем он не станция, которую сняли. Станция печатала деньги, покупая товар
 * по твердой цене, и цены при ней не существовало — был коридор ±20%.
 * Резерв не покупает ни на что, кроме собранного, а коридор у него —
 * в четыре раза: внутри цена ходит как хочет.
 *
 * Работает он против цикла, как центральный банк: в пузыре продает дорого
 * и забирает деньги из оборота, в обвале покупает дешево и возвращает их.
 *
 * Границы — от производства. Ферма и шахты растут по одной формуле
 * (`база × L × 1.07^L`), поэтому отношение гривны фермы к добыче шахты того
 * же уровня от уровня не зависит. Пол — паритет: при такой цене шахта
 * приносит ровно столько, сколько ферма, и дешевле добывать бессмысленно.
 * Потолок — вчетверо выше.
 *
 * Подобрано прогоном недели с настоящими рейсами (`npm run forecast -- 7`):
 * при потолке втрое выше паритета импорт выкачивает у ботов деньги
 * до ₴5 тысяч на всех на второй день, вшестеро — полимеры встают на 61,
 * фрегат открыт у четверых из семи. Вчетверо — сделок 38 тысяч против
 * 15 тысяч без резерва, руда 10–18 вместо 11 781, колонизатор впервые открыт.
 */
import type { TradeResource } from './market.js';
import { BASE_YIELD_PER_SECOND, CREDIT_BASE_PER_SECOND } from './rules.js';

/** Учетная запись резерва: служебная, с ролью бота — войти в нее нельзя. */
export const RESERVE_EMAIL = 'reserve@hub.local';
export const RESERVE_NICKNAME = 'Резерв хаба';

/**
 * Уровень склада резерва на хабе. Места ему нужно под импорт и выкупленное,
 * а аренду он не платит — фонд не платит сам себе.
 */
export const RESERVE_ACCOUNT_LEVEL = 40;

/** Доля аренды складов, которая идет в фонд, а не сгорает. */
export const RESERVE_RENT_SHARE = 0.5;
/** Потолок коридора — во столько раз выше паритета с фермой. */
export const RESERVE_CEILING = 4;
/** Импорт на один ход: сколько товара резерв держит выставленным по потолку. */
export const RESERVE_IMPORT_LOT = 100_000;
/** Доля фонда на выкуп за один ход — на оба ресурса вместе. */
export const RESERVE_BUY_SHARE = 0.2;

const MINE_YIELD_PER_SECOND: Record<TradeResource, number> = {
  ORE: BASE_YIELD_PER_SECOND.ORE_MINE,
  POLYMERS: BASE_YIELD_PER_SECOND.POLYMER_PLANT,
};

const cents = (value: number): number => Math.round(value * 100) / 100;

/** Паритет: цена, при которой шахта приносит столько же, сколько ферма того же уровня. */
export function farmParity(resource: TradeResource): number {
  return CREDIT_BASE_PER_SECOND / MINE_YIELD_PER_SECOND[resource];
}

export function reserveBand(resource: TradeResource): { floor: number; ceiling: number } {
  const parity = farmParity(resource);
  return { floor: cents(parity), ceiling: cents(parity * RESERVE_CEILING) };
}

export interface ReserveQuote {
  side: 'BUY' | 'SELL';
  resource: TradeResource;
  price: number;
  amount: number;
}

/** Заявки резерва на ход: импорт по потолку и выкуп по полу на деньги фонда. */
export function reserveQuotes(fundCredits: number): ReserveQuote[] {
  const quotes: ReserveQuote[] = [];
  for (const resource of ['ORE', 'POLYMERS'] as const) {
    const { floor, ceiling } = reserveBand(resource);
    quotes.push({ side: 'SELL', resource, price: ceiling, amount: RESERVE_IMPORT_LOT });
    const buying = Math.floor((Math.max(0, fundCredits) * RESERVE_BUY_SHARE) / 2 / floor);
    if (buying > 0) quotes.push({ side: 'BUY', resource, price: floor, amount: buying });
  }
  return quotes;
}
