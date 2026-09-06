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

/**
 * Стоимость расширения склада на хабе — в криптогривне.
 *
 * Платилось товаром, лежащим на самом складе, и это оказалось тупиком:
 * склад забивался тем, что не продается, расширить его было нужно как раз
 * тогда, когда места нет, а платить приходилось ресурсом, которого в этой
 * куче могло не быть вовсе. Живой бот стоял с двумя миллионами гривны,
 * полным складом полимеров и полутора тысячами руды при цене расширения
 * в восемь тысяч руды — деньги были, выхода не было.
 *
 * Деньгами это чинится само, и заодно у криптогривны появляется второй сток,
 * которого экономике не хватало: кроме комиссии биржи ее больше ничто
 * не изымало, а печатает ее ферма без остановки.
 *
 * Величина — прежняя цена, посчитанная по затравочным ценам: тысяча руды
 * и пятьсот полимеров за уровень, то есть 17 000 ₴ на первом шаге
 * и удвоение на каждом следующем.
 */
export function storageUpgradeCost(targetLevel: number): number {
  const scale = Math.pow(2, targetLevel - 2);
  return Math.round((1000 * SEED_PRICE.ORE + 500 * SEED_PRICE.POLYMERS) * scale);
}

/**
 * Плата за место на хабе — криптогривна в секунду.
 *
 * Это второй постоянный сток денег, и до него их было ноль: комиссия биржи
 * берется со сделок, расширение склада платится один раз, а криптогривна
 * капает с фермы каждую секунду. Масса от этого росла без предела —
 * на живом стенде она удвоилась за девять часов, ₴20.6 млн против ₴39 млн,
 * и цена руды пошла за ней с 5 до 19 при том же количестве товара.
 *
 * Платится за вместимость, а не за занятое: место арендуется целиком,
 * пустая полка стоит столько же, сколько полная. Иначе плата превращалась бы
 * в налог на запас, и выгодно было бы держать огромный пустой склад про запас.
 *
 * Первый уровень бесплатен: это стартовая полка, которую никто не выбирал,
 * и брать за нее плату значит облагать новичка ни за что.
 *
 * Ставка задана долей от цены самого места. Расширение с уровня на уровень
 * стоит вдвое дороже предыдущего, и плата растет тем же шагом — держать
 * большой склад дорого ровно настолько, насколько дорого он достался.
 *
 * Три процента в час подобраны прогоном недели, а не на глаз, и вместе
 * с отдачей фермы: два рычага работают в одну сторону, и крутить их порознь
 * бессмысленно.
 *
 *     ставка  ферма   масса за неделю   ₴ на единицу   средняя верфь
 *     нет      12          ₴341 млн         6.59            6.4
 *     2%       12          ₴176 млн         3.49            6.6
 *     3%       12          ₴140 млн         2.91            6.1
 *     3%        9          ₴148 млн         3.13            6.4
 *
 * Взято 3% при отдаче фермы 9: масса вдвое ниже прежней, а прогресс остается
 * на исходных 6.4 уровня верфи. Фермы при этом строиться не перестают —
 * к седьмым суткам они все равно доходят до девятого-десятого уровня,
 * то есть кран не пересушен и в дефляцию мир не скатывается.
 *
 * Прогон здесь шумный: ставка меняет уровни хабов, те меняют поведение,
 * и разница между соседними строками местами меньше этого шума. Поэтому
 * выбирать стоит по краям таблицы, а не по третьему знаку.
 */
const HUB_RENT_SHARE_PER_HOUR = 0.03;

export function hubRent(level: number): number {
  if (level <= 1) return 0;
  return (storageUpgradeCost(level) * HUB_RENT_SHARE_PER_HOUR) / 3600;
}

/**
 * Цена спешки: сколько криптогривны стоит доделать работу немедленно.
 *
 * Третий сток денег и первый, который игрок выбирает сам. Первые два —
 * комиссия и плата за место — берутся сами; тратить криптогривну по своей воле
 * было решительно не на что, и она копилась: на живом стенде масса росла
 * на ₴1.5 млн в час при стоках в четверть этого.
 *
 * Цена привязана к рыночной стоимости самой работы, а не к константе, и это
 * главное свойство. Дорожает товар — дорожает и спешка, поэтому сток растет
 * вместе с инфляцией сам. Любая постоянная цена устарела бы за сутки: руда
 * за день прошла путь от 5 до 23.
 *
 * Множитель — доля оставшегося времени: доделать почти готовое почти ничего
 * не стоит, а перескочить всю стройку целиком стоит ровно тех же денег,
 * что и материалы на нее по нынешнему рынку. Платится дважды за одно —
 * сперва ресурсами, потом гривной, — и в этом смысл: спешка обязана быть
 * дорогой, иначе время в игре перестает что-либо значить.
 *
 * Плазма считается по цене руды: биржа ею не торгует, а в рейтинге все ресурсы
 * идут один к одному, и другого источника правды о ее цене в игре нет.
 */
export function rushPrice(
  cost: { ore: number; polymers: number; plasma: number },
  remainingSeconds: number,
  totalSeconds: number,
  prices: { ore: number; polymers: number },
): number {
  if (remainingSeconds <= 0 || totalSeconds <= 0) return 0;
  const share = Math.min(1, remainingSeconds / totalSeconds);
  const value = (cost.ore + cost.plasma) * prices.ore + cost.polymers * prices.polymers;
  return Math.max(1, Math.round(value * share));
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
