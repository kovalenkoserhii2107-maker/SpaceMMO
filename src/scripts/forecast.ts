/**
 * Прогон мира на настоящих формулах: во что выльется правка экономики.
 *
 * Запуск: `npm run forecast -- 7` (по умолчанию неделя).
 *
 * Зачем он есть. Экономика тут подбирается замером, а не на глаз — так
 * подобраны и показатель добычи, и кривая времени стройки, и отдача фермы.
 * Замерять на живом стенде можно только то, что уже случилось, и только один
 * раз: чтобы сравнить два правила, нужно два одинаковых мира. Здесь они есть.
 *
 * Как сравнивать. Прогон меряет код таким, какой он сейчас: вариантов и
 * переключателей внутри нет нарочно — они разъезжаются с боевым кодом
 * и начинают мерить сами себя. Сравнение делается снаружи и занимает четыре
 * команды:
 *
 *     npm run forecast -- 7            # как есть
 *     git stash push -- src/game/...   # снять правку
 *     npm run forecast -- 7            # как было
 *     git stash pop
 *
 * Расстановка фиксированная, случайности в решениях нет, поэтому два прогона
 * одного кода дают побайтово одинаковый ответ, и вся разница — это правка.
 *
 * Чему он соответствует. Сверено с живым стендом на первых сутках, когда
 * тамошним ботам было столько же:
 *
 *     шахта   прогон 5–11   живые 4–8
 *     верфь   прогон 3–7    живые 3–5
 *     наука   прогон 3–6    живые 3–4
 *     ферма   прогон 0–6    живые 0–2
 *     флот    прогон 22–89  живые 18–106
 *
 * Прогон идет чуть быстрее живого — в нем нет боя, и потерянный флот никто
 * не теряет.
 *
 * Чего в нем нет, и это важно читать вместе с любым его числом:
 *   - боя. Набеги, потери флота и грабеж не моделируются, поэтому за месяц
 *     флот накапливается до тысяч корпусов, чего в живой игре не бывает.
 *     Верить стоит неделе, дальше — только направлению;
 *   - межзвездной логистики. Рейсы на хаб летают по-настоящему (см. «Рейсы»
 *     ниже): время в пути, топливо в трюмах, грузовики, занятые рейсом.
 *     Но все боты живут в одной системе, поэтому гиперпрыжков, Брам и
 *     антиматерии нет;
 *   - синдикатов, колонизации и языковой модели. Боты играют по коду.
 *
 * Решения принимает `decide` — та же чистая функция, которой ходит живой бот,
 * поэтому доли характера, окупаемость шахт, выбор стороны на бирже и пороги
 * фермы работают здесь ровно так же. Стакан сводится по правилам `market.ts`:
 * встречные заявки по средней цене на меньший объем, комиссия с обеих сторон.
 */
import { readFileSync } from 'node:fs';
import {
  decide,
  emptyBotSnapshot,
  testBase,
  type BotIntent,
  type BotMarketOrder,
  type BotSnapshot,
} from '../game/bot/decide.js';
import { type BotCharacter } from '../game/bot/personality.js';
import {
  buildSeconds,
  creditOutput,
  emptyLevels,
  energyEfficiency,
  hasEnoughResources,
  NEUTRAL_MODIFIERS,
  productionPerSecond,
  storageCapacities,
  STORED_RESOURCES,
  subtractResources,
  upgradeCost,
  type BuildingLevels,
  type BuildingType,
  type ResourceAmounts,
} from '../game/rules.js';
import {
  buildSpeedup,
  cryptoBonus,
  economyBonuses,
  emptyTechLevels,
  researchCost,
  researchSeconds,
  TECHNOLOGY_TYPES,
  timeCompressionDrain,
  type TechLevels,
  type TechnologyType,
} from '../game/techTree.js';
import { emptyShipCounts, missingShipRequirements, shipCost, shipLabel, shipUnitSeconds, SHIP_TYPES, type ShipCounts, type ShipType } from '../game/ships.js';
import {
  defenseCost,
  defenseEnergyUsage,
  defenseUnitSeconds,
  emptyDefenseCounts,
  type DefenseCounts,
  type DefenseType,
} from '../game/defenses.js';
import { fleetCapacity, planFlight, validateCargo, validateComposition, type GalaxyPoint } from '../game/fleets.js';
import { cargoShipsFor } from '../game/bot/logistics.js';
import {
  buyerEscrow,
  buyerFee,
  hubRent,
  marketPrice,
  rushPrice,
  matchPrice,
  sellerFee,
  storageCapacity as hubCapacity,
  storageUpgradeCost,
  storageUsed,
  tradeTotal,
  type TradeResource,
} from '../game/market.js';

/** Секунд игрового времени за шаг. Минуты хватает: тик решает раз в 45 секунд. */
const STEP = 60;
/** Как часто ходит планировщик — тот же такт, что у живого директора. */
const DECIDE_EVERY = 60;
/** Все боты в одной системе: хаб на нулевой орбите, как в живом генераторе. */
const SYSTEM: GalaxyPoint = { galaxyX: 0, galaxyY: 0 };
const HUB_POSITION = 0;
/** Дни, на которых печатается строка сводки. */
const MARKS = [1, 2, 3, 5, 7, 14, 21, 31];

interface PlanetRichness {
  ore: number;
  polymers: number;
  plasma: number;
  energy: number;
  antimatter: number;
}

/**
 * Расстановка. Богатство недр у каждого свое, и это не украшение: двум
 * одинаково развитым ботам на одинаковых планетах торговать нечем — у них один
 * и тот же избыток и один и тот же дефицит, и стакан стоит намертво. Рынок жив
 * именно разницей планет.
 */
/*
 * Орбиты разные нарочно: дорога до хаба — это время и топливо, и дальний
 * бот платит за торговлю больше ближнего. На живом сервере так и есть.
 */
const ROSTER: ReadonlyArray<{ name: string; character: BotCharacter; richness: PlanetRichness; position: number }> = [
  { name: 'Рудный', character: 'TRADER', position: 3, richness: { ore: 1.35, polymers: 0.7, plasma: 0.9, energy: 1.0, antimatter: 1 } },
  { name: 'Полимерный', character: 'TRADER', position: 5, richness: { ore: 0.65, polymers: 1.4, plasma: 1.0, energy: 1.1, antimatter: 1 } },
  { name: 'Ровный', character: 'TRADER', position: 7, richness: { ore: 1.1, polymers: 1.15, plasma: 0.7, energy: 0.9, antimatter: 1 } },
  { name: 'Плазменный', character: 'TRADER', position: 4, richness: { ore: 0.8, polymers: 0.85, plasma: 1.35, energy: 1.2, antimatter: 1 } },
  { name: 'Боевой', character: 'AGGRESSOR', position: 6, richness: { ore: 1.25, polymers: 0.9, plasma: 1.1, energy: 0.85, antimatter: 1 } },
  { name: 'Бедный', character: 'AGGRESSOR', position: 8, richness: { ore: 0.7, polymers: 1.3, plasma: 0.85, energy: 1.05, antimatter: 1 } },
  { name: 'Средний', character: 'AGGRESSOR', position: 2, richness: { ore: 1.0, polymers: 0.75, plasma: 1.2, energy: 0.95, antimatter: 1 } },
];

/** Рейс на хаб или с хаба. Корабли в полете из ангара вычтены. */
interface Flight {
  mission: 'HUB_DELIVERY' | 'HUB_PICKUP';
  ships: ShipCounts;
  /** Что в трюмах сейчас: груз туда, добыча обратно. */
  cargo: { ore: number; polymers: number };
  /** Что просили забрать с хаба. */
  request: { ore: number; polymers: number };
  arriveAt: number;
  returnAt: number;
  arrived: boolean;
}

/** Учет логистики: без него прогон не отличал бы рейс от отказа. */
interface Logistics {
  sent: number;
  delivered: number;
  picked: number;
  fuel: number;
  refused: Record<string, number>;
}

interface Bot {
  name: string;
  character: BotCharacter;
  richness: PlanetRichness;
  /** Орбита базы: хаб на нулевой, расстояние до него — это она и есть. */
  position: number;
  flights: Flight[];
  logistics: Logistics;
  levels: BuildingLevels;
  techs: TechLevels;
  stock: ResourceAmounts;
  credits: number;
  ships: ShipCounts;
  defenses: DefenseCounts;
  hub: { ore: number; polymers: number; level: number };
  build: { type: BuildingType; left: number; total: number } | null;
  research: { tech: TechnologyType; left: number } | null;
  shipJobs: Array<{ type: ShipType; count: number; left: number }>;
  defenseJobs: Array<{ type: DefenseType; count: number; left: number }>;
  mined: number;
  earned: number;
  /** Сколько уплачено за место на хабе — второй постоянный сток денег. */
  rentPaid: number;
  /** Сколько потрачено на спешку — третий сток, и единственный по своей воле. */
  rushed: number;
}

interface Order {
  id: string;
  owner: string;
  side: 'BUY' | 'SELL';
  resource: TradeResource;
  price: number;
  remaining: number;
}

interface Snapshot {
  day: number;
  money: number;
  goods: number;
  ore: number;
  polymers: number;
  trades: number;
  farms: string;
}

/** Стартовое состояние — то же, что у настоящей новой колонии. */
function emptyLogistics(): Logistics {
  return { sent: 0, delivered: 0, picked: 0, fuel: 0, refused: {} };
}

function freshBot(row: (typeof ROSTER)[number]): Bot {
  return {
    name: row.name,
    character: row.character,
    richness: row.richness,
    position: row.position,
    flights: [],
    logistics: emptyLogistics(),
    levels: { ...emptyLevels(), ORE_MINE: 1, POLYMER_PLANT: 1 },
    techs: emptyTechLevels(),
    stock: { ore: 1500, polymers: 800, plasma: 400 },
    credits: 1000,
    ships: emptyShipCounts(),
    defenses: emptyDefenseCounts(),
    hub: { ore: 0, polymers: 0, level: 1 },
    build: null,
    research: null,
    shipJobs: [],
    defenseJobs: [],
    mined: 0,
    earned: 0,
    rentPaid: 0,
    rushed: 0,
  };
}

/* ------------------------- Биржа ------------------------- */

class Exchange {
  private seq = 0;
  private readonly book: Order[] = [];
  private readonly log: Array<{ resource: string; pricePerUnit: number; quantity: number }> = [];
  count = 0;

  /** Последние сделки: по ним `marketPrice` и считает рыночную цену. */
  get trades(): ReadonlyArray<{ resource: string; pricePerUnit: number; quantity: number }> {
    return this.log;
  }

  get orders(): ReadonlyArray<Order> {
    return this.book;
  }

  /** Сделки живого мира, от свежих к старым: по ним стартовая цена. В счет сделок не идут. */
  seed(rows: ReadonlyArray<{ resource: TradeResource; pricePerUnit: number; quantity: number }>): void {
    this.log.push(...rows.slice(0, 400));
  }

  private record(resource: TradeResource, price: number, quantity: number): void {
    this.count += 1;
    this.log.unshift({ resource, pricePerUnit: price, quantity });
    if (this.log.length > 400) this.log.length = 400;
  }

  private free(bot: Bot): number {
    return Math.max(0, hubCapacity(bot.hub.level) - storageUsed(bot.hub));
  }

  /** Сведение по правилам `market.ts`: средняя цена, меньший из объемов. */
  private match(fresh: Order, byName: Map<string, Bot>): void {
    const counter = this.book
      .filter((row) => row.resource === fresh.resource && row.side !== fresh.side && row.owner !== fresh.owner)
      .filter((row) => (fresh.side === 'BUY' ? row.price <= fresh.price : row.price >= fresh.price))
      .sort((a, b) => (fresh.side === 'BUY' ? a.price - b.price : b.price - a.price));

    for (const other of counter) {
      if (fresh.remaining <= 0) break;
      const volume = Math.min(fresh.remaining, other.remaining);
      const price = matchPrice(fresh.price, other.price);
      const total = tradeTotal(volume, price);

      const buyerOrder = fresh.side === 'BUY' ? fresh : other;
      const buyer = byName.get(buyerOrder.owner);
      const seller = byName.get(fresh.side === 'BUY' ? other.owner : fresh.owner);
      if (!buyer || !seller || this.free(buyer) < volume) continue;

      buyer.hub[fresh.resource === 'ORE' ? 'ore' : 'polymers'] += volume;
      // Залог покупателя списан по его цене, сделка прошла по средней:
      // переплата возвращается.
      buyer.credits += buyerEscrow(volume, buyerOrder.price) - total - buyerFee(total);
      seller.credits += total - sellerFee(total);
      fresh.remaining -= volume;
      other.remaining -= volume;
      this.record(fresh.resource, price, volume);
    }
    this.sweep();
  }

  private sweep(): void {
    for (let index = this.book.length - 1; index >= 0; index -= 1) {
      if ((this.book[index]?.remaining ?? 0) <= 0) this.book.splice(index, 1);
    }
  }

  place(bot: Bot, side: 'BUY' | 'SELL', resource: TradeResource, amount: number, price: number, byName: Map<string, Bot>): void {
    const field = resource === 'ORE' ? 'ore' : 'polymers';
    if (side === 'SELL') {
      if (bot.hub[field] < amount) return;
      bot.hub[field] -= amount;
    } else {
      const escrow = buyerEscrow(amount, price);
      if (bot.credits < escrow) return;
      bot.credits -= escrow;
    }
    this.seq += 1;
    const order: Order = { id: `o${this.seq}`, owner: bot.name, side, resource, price, remaining: amount };
    this.match(order, byName);
    if (order.remaining > 0) this.book.push(order);
  }

  /** Снятие заявки возвращает залог: товар на склад, деньги на счет. */
  drop(bot: Bot, id: string): void {
    const index = this.book.findIndex((row) => row.id === id && row.owner === bot.name);
    if (index < 0) return;
    const order = this.book.splice(index, 1)[0];
    if (!order) return;
    if (order.side === 'SELL') bot.hub[order.resource === 'ORE' ? 'ore' : 'polymers'] += order.remaining;
    else bot.credits += buyerEscrow(order.remaining, order.price);
  }

  /** Исполнение чужой заявки целиком или частью. */
  take(bot: Bot, id: string, amount: number, byName: Map<string, Bot>): void {
    const order = this.book.find((row) => row.id === id && row.owner !== bot.name);
    if (!order) return;
    const other = byName.get(order.owner);
    if (!other) return;

    const volume = Math.min(amount, order.remaining);
    if (volume <= 0) return;
    const total = tradeTotal(volume, order.price);
    const field = order.resource === 'ORE' ? 'ore' : 'polymers';

    if (order.side === 'SELL') {
      if (bot.credits < total || this.free(bot) < volume) return;
      bot.credits -= total;
      bot.hub[field] += volume;
      other.credits += total - sellerFee(total);
    } else {
      if (bot.hub[field] < volume || this.free(other) < volume) return;
      bot.hub[field] -= volume;
      other.hub[field] += volume;
      bot.credits += total - sellerFee(total);
    }
    order.remaining -= volume;
    this.record(order.resource, order.price, volume);
    this.sweep();
  }

  /** Перекос сторон: общий и очищенный от собственных заявок бота. */
  skew(resource: TradeResource, owner: string): { demand: number; supply: number; skew: number | null; foreign: number | null } {
    const sum = (side: 'BUY' | 'SELL', own: boolean): number =>
      this.book
        .filter((row) => row.resource === resource && row.side === side && (own || row.owner !== owner))
        .reduce((total, row) => total + row.remaining, 0);
    const ratio = (demand: number, supply: number): number | null => {
      const both = demand + supply;
      return both > 0 ? Math.round(((demand - supply) / both) * 100) / 100 : null;
    };
    const demand = sum('BUY', true);
    const supply = sum('SELL', true);
    return { demand, supply, skew: ratio(demand, supply), foreign: ratio(sum('BUY', false), sum('SELL', false)) };
  }
}

/* ------------------------- Мир ------------------------- */

function snapshotOf(bot: Bot, exchange: Exchange): BotSnapshot {
  const base = testBase(bot.name, {
    levels: bot.levels,
    richness: bot.richness,
    anomaly: 'NONE',
    resources: { ...bot.stock },
    ships: { ...bot.ships },
    defenses: { ...bot.defenses },
    building: bot.build !== null,
    shipQueue: bot.shipJobs.length,
    defenseQueue: bot.defenseJobs.length,
  });

  const orderBook: BotMarketOrder[] = exchange.orders.map((row) => ({
    id: row.id,
    side: row.side,
    resource: row.resource,
    price: row.price,
    amount: row.remaining,
    mine: row.owner === bot.name,
  }));

  const market = (['ORE', 'POLYMERS'] as const).map((resource) => {
    const sides = exchange.skew(resource, bot.name);
    const { price, seeded } = marketPrice(resource, exchange.trades);
    return {
      resource,
      reference: price,
      seeded,
      demand: Math.round(sides.demand),
      supply: Math.round(sides.supply),
      skew: sides.skew,
      foreignSkew: sides.foreign,
    };
  });

  return {
    ...emptyBotSnapshot(bot.character),
    credits: bot.credits,
    // Живой директор считает флоты в полете, и `decide` по ним решает,
    // заказывать ли грузовик: пустой ангар — не всегда отсутствие транспорта.
    fleetsInFlight: bot.flights.length,
    techs: { ...bot.techs },
    researching: bot.research !== null,
    bases: [base],
    market,
    orderBook,
    hubStorage: {
      ore: bot.hub.ore,
      polymers: bot.hub.polymers,
      free: Math.max(0, hubCapacity(bot.hub.level) - storageUsed(bot.hub)),
      level: bot.hub.level,
      upgradeCost: storageUpgradeCost(bot.hub.level + 1),
      currentRentPerHour: hubRent(bot.hub.level) * 3600,
      nextRentPerHour: hubRent(bot.hub.level + 1) * 3600,
    },
  };
}

function apply(bot: Bot, intents: BotIntent[], exchange: Exchange, byName: Map<string, Bot>, now: number): void {
  const speed = buildSpeedup(bot.techs);
  const units = (cost: ResourceAmounts, count: number): ResourceAmounts => ({
    ore: cost.ore * count,
    polymers: cost.polymers * count,
    plasma: cost.plasma * count,
  });

  for (const intent of intents) {
    switch (intent.kind) {
      case 'BUILD': {
        if (bot.build) break;
        const cost = upgradeCost(intent.building, bot.levels[intent.building] + 1);
        if (!hasEnoughResources(bot.stock, cost)) break;
        subtractResources(bot.stock, cost);
        const seconds = buildSeconds(intent.building, bot.levels[intent.building] + 1, NEUTRAL_MODIFIERS, speed);
        bot.build = { type: intent.building, left: seconds, total: seconds };
        break;
      }
      case 'RESEARCH': {
        if (bot.research) break;
        const cost = researchCost(intent.tech, bot.techs[intent.tech] + 1);
        if (!hasEnoughResources(bot.stock, cost)) break;
        subtractResources(bot.stock, cost);
        bot.research = {
          tech: intent.tech,
          left: researchSeconds(intent.tech, bot.techs[intent.tech] + 1, bot.levels.SCIENCE_CENTER, bot.techs, NEUTRAL_MODIFIERS),
        };
        break;
      }
      case 'SHIPS': {
        const cost = units(shipCost(intent.ship), intent.count);
        if (!hasEnoughResources(bot.stock, cost)) break;
        subtractResources(bot.stock, cost);
        bot.shipJobs.push({
          type: intent.ship,
          count: intent.count,
          left: shipUnitSeconds(intent.ship, bot.levels.SHIPYARD, NEUTRAL_MODIFIERS, speed) * intent.count,
        });
        break;
      }
      case 'DEFENSE': {
        const cost = units(defenseCost(intent.defense), intent.count);
        if (!hasEnoughResources(bot.stock, cost)) break;
        subtractResources(bot.stock, cost);
        bot.defenseJobs.push({
          type: intent.defense,
          count: intent.count,
          left: defenseUnitSeconds(intent.defense, bot.levels.SHIPYARD, NEUTRAL_MODIFIERS, speed) * intent.count,
        });
        break;
      }
      case 'ORDER':
        exchange.place(bot, intent.side, intent.resource, intent.amount, intent.price, byName);
        break;
      case 'DROP':
        exchange.drop(bot, intent.orderId);
        break;
      case 'TAKE':
        exchange.take(bot, intent.orderId, intent.amount, byName);
        break;
      case 'HUB_DELIVERY': {
        // Как `deliverToHub`: грузовики из нынешнего ангара ровно под груз.
        const ships = cargoShipsFor(intent.ore + intent.polymers, bot.ships);
        dispatch(bot, 'HUB_DELIVERY', ships, { ore: intent.ore, polymers: intent.polymers }, { ore: 0, polymers: 0 }, now);
        break;
      }
      case 'PICKUP': {
        // Как `pickupFromHub`: грузовики из ангара ровно под запрос.
        const ships = cargoShipsFor(intent.ore + intent.polymers, bot.ships);
        dispatch(bot, 'HUB_PICKUP', ships, { ore: 0, polymers: 0 }, { ore: intent.ore, polymers: intent.polymers }, now);
        break;
      }
      case 'RUSH': {
        /*
         * Спешка: срок стройки схлопывается, а деньги уходят из мира.
         * Цена та же, что в бою, — по нынешнему рынку, поэтому сток растет
         * вместе с инфляцией сам.
         */
        if (!bot.build) break;
        const cost = upgradeCost(bot.build.type, bot.levels[bot.build.type] + 1);
        const price = rushPrice(cost, bot.build.left, bot.build.total, {
          ore: marketPrice('ORE', exchange.trades).price,
          polymers: marketPrice('POLYMERS', exchange.trades).price,
        });
        if (bot.credits < price) break;
        bot.credits -= price;
        bot.rushed += price;
        bot.build.left = 0;
        break;
      }

      case 'HUB_UPGRADE': {
        const price = storageUpgradeCost(bot.hub.level + 1);
        if (bot.credits < price) break;
        bot.credits -= price;
        bot.hub.level += 1;
        break;
      }
      default:
        // Набеги, разведка, колонизация и призывы требуют мира и боя,
        // которых здесь нет. Молча пропускаем — это заявленное упрощение.
        break;
    }
  }
}

/* ------------------------- Рейсы ------------------------- */

/*
 * Рейс на хаб — тот же, что у живого бота, и считается теми же функциями:
 * `planFlight` дает время и топливо, `validateCargo` — отказ по трюмам
 * с топливом внутри, а проверки ниже повторяют `sendFleet` в той части,
 * что касается хаба своей системы. Прежде излишек переезжал на хаб раз
 * в игровой час сам собой, без топлива, без времени в пути и без занятых
 * грузовиков, — и любая правка логистики в прогоне не видна была вовсе.
 * Так прошла и правка «топливо едет в трюмах»: побайтово тот же ответ,
 * хотя вывоз с хаба у живых ботов она ломала.
 */
function refuse(bot: Bot, reason: string): false {
  bot.logistics.refused[reason] = (bot.logistics.refused[reason] ?? 0) + 1;
  return false;
}

function dispatch(
  bot: Bot,
  mission: Flight['mission'],
  ships: ShipCounts,
  cargo: { ore: number; polymers: number },
  request: { ore: number; polymers: number },
  now: number,
): boolean {
  if (validateComposition(mission, ships)) return refuse(bot, 'состав');
  if (SHIP_TYPES.some((type) => ships[type] > bot.ships[type])) return refuse(bot, 'нет кораблей');

  const plan = planFlight(
    ships,
    bot.techs,
    { position: bot.position, system: SYSTEM },
    { position: HUB_POSITION, system: SYSTEM },
  );
  if (mission === 'HUB_DELIVERY') {
    if (validateCargo(ships, { ...cargo, plasma: 0 }, 1, plan.fuelLoad)) return refuse(bot, 'трюмы');
    if (cargo.ore > bot.stock.ore || cargo.polymers > bot.stock.polymers) return refuse(bot, 'груз');
  } else {
    const requested = request.ore + request.polymers;
    if (requested <= 0) return refuse(bot, 'пустой запрос');
    if (requested > plan.usable) return refuse(bot, 'трюмы');
  }
  if (bot.stock.plasma < plan.fuel) return refuse(bot, 'плазма');

  bot.stock.plasma -= plan.fuel;
  bot.stock.ore -= cargo.ore;
  bot.stock.polymers -= cargo.polymers;
  for (const type of SHIP_TYPES) bot.ships[type] -= ships[type];
  bot.flights.push({
    mission,
    ships: { ...ships },
    cargo: { ...cargo },
    request: { ...request },
    arriveAt: now + plan.flightSeconds,
    returnAt: now + plan.flightSeconds * 2,
    arrived: false,
  });
  bot.logistics.sent += 1;
  bot.logistics.fuel += plan.fuel;
  return true;
}

/** Прилет и возврат: разгрузка по `unloadToHub`, погрузка по `loadFromHub`. */
function advanceFlights(bot: Bot, now: number): void {
  for (const flight of bot.flights) {
    if (flight.arrived || flight.arriveAt > now) continue;
    flight.arrived = true;
    if (flight.mission === 'HUB_DELIVERY') {
      // Что не влезло на склад хаба, остается в трюме и летит домой.
      let room = Math.max(0, hubCapacity(bot.hub.level) - storageUsed(bot.hub));
      for (const field of ['ore', 'polymers'] as const) {
        const stored = Math.min(flight.cargo[field], room);
        bot.hub[field] += stored;
        flight.cargo[field] -= stored;
        room -= stored;
        bot.logistics.delivered += stored;
      }
    } else {
      // Погрузка по полным трюмам: к прилету половина топлива уже сожжена.
      let room = fleetCapacity(flight.ships);
      for (const field of ['ore', 'polymers'] as const) {
        const taken = Math.max(0, Math.floor(Math.min(flight.request[field], bot.hub[field], room)));
        bot.hub[field] -= taken;
        flight.cargo[field] += taken;
        room -= taken;
        bot.logistics.picked += taken;
      }
    }
  }

  const landed = bot.flights.filter((flight) => flight.returnAt <= now);
  for (const flight of landed) {
    // Груз садится на базу без оглядки на склад — так же, как `landFleet`.
    bot.stock.ore += flight.cargo.ore;
    bot.stock.polymers += flight.cargo.polymers;
    for (const type of SHIP_TYPES) bot.ships[type] += flight.ships[type];
  }
  if (landed.length) bot.flights = bot.flights.filter((flight) => flight.returnAt > now);
}

function tick(bot: Bot): void {
  const bonuses = economyBonuses(bot.techs);
  const drain = timeCompressionDrain(bot.techs);
  const defenseDrain = defenseEnergyUsage(bot.defenses);
  const rate = productionPerSecond(bot.levels, bot.richness, bonuses, defenseDrain, NEUTRAL_MODIFIERS, drain);
  const caps = storageCapacities(bot.levels);

  /*
   * Потолок склада останавливает добычу, но не отнимает уже лежащее — так же,
   * как в живом `accrue`. Прежняя обрезка `min(потолок, …)` срезала до потолка
   * все сверх него, в том числе привезенное с хаба: груз садится на базу без
   * оглядки на склад, и в прогоне он исчезал на следующем же шаге.
   */
  for (const resource of STORED_RESOURCES) {
    const before = bot.stock[resource];
    bot.stock[resource] = Math.min(Math.max(before, caps[resource]), before + rate[resource] * STEP);
    bot.mined += Math.max(0, bot.stock[resource] - before);
  }

  const efficiency = energyEfficiency(bot.levels, bot.richness, bonuses, defenseDrain, drain);
  const money = creditOutput(bot.levels, cryptoBonus(bot.techs)) * efficiency * STEP;
  bot.credits += money;
  bot.earned += money;

  /*
   * Плата за место на хабе. Не хватило на всю — не платим ничего: долгов
   * в игре нет, а склад не отбирается. Так же считает и живой цикл.
   */
  const rent = hubRent(bot.hub.level) * STEP;
  if (rent > 0 && bot.credits >= rent) {
    bot.credits -= rent;
    bot.rentPaid += rent;
  }

  if (bot.build) {
    bot.build.left -= STEP;
    if (bot.build.left <= 0) {
      bot.levels[bot.build.type] += 1;
      bot.build = null;
    }
  }
  if (bot.research) {
    bot.research.left -= STEP;
    if (bot.research.left <= 0) {
      bot.techs[bot.research.tech] += 1;
      bot.research = null;
    }
  }
  for (const job of bot.shipJobs) job.left -= STEP;
  for (const job of bot.shipJobs) if (job.left <= 0) bot.ships[job.type] += job.count;
  bot.shipJobs = bot.shipJobs.filter((job) => job.left > 0);

  for (const job of bot.defenseJobs) job.left -= STEP;
  for (const job of bot.defenseJobs) if (job.left <= 0) bot.defenses[job.type] += job.count;
  bot.defenseJobs = bot.defenseJobs.filter((job) => job.left > 0);
}

/**
 * Старт с живого мира вместо новой расстановки.
 *
 * Прогон с нуля не видит ловушек, в которые боты попадают через неделю
 * живой игры: склады, уровни и цены там другие, и правка, безвредная для
 * первой недели, может ничего не менять для застрявшего бота — или наоборот.
 * Дамп пишет `npm run bot:diag -- --dump <файл>` по копии базы; цены берутся
 * из последних сделок, чужих заявок живых игроков в прогоне нет.
 */
interface StartFile {
  bots: Array<
    Omit<Bot, 'mined' | 'earned' | 'rentPaid' | 'rushed' | 'position' | 'flights' | 'logistics'> & { position?: number }
  >;
  trades: Array<{ resource: TradeResource; pricePerUnit: number; quantity: number }>;
}

function run(days: number, start: StartFile | null): { bots: Bot[]; log: Snapshot[] } {
  const bots: Bot[] = start
    ? start.bots.map((row) => ({
        ...row,
        // Дампы, снятые до рейсов в прогоне, орбиты не несут: середина системы.
        position: row.position ?? 5,
        flights: [],
        logistics: emptyLogistics(),
        mined: 0,
        earned: 0,
        rentPaid: 0,
        rushed: 0,
      }))
    : ROSTER.map(freshBot);
  const byName = new Map(bots.map((bot) => [bot.name, bot]));
  const exchange = new Exchange();
  if (start) exchange.seed(start.trades);
  const log: Snapshot[] = [];

  let sinceDecide = 0;

  for (let step = 1; step <= (days * 86400) / STEP; step += 1) {
    const now = step * STEP;
    for (const bot of bots) {
      tick(bot);
      advanceFlights(bot, now);
    }

    sinceDecide += STEP;
    if (sinceDecide >= DECIDE_EVERY) {
      sinceDecide = 0;
      for (const bot of bots) {
        apply(bot, decide(snapshotOf(bot, exchange)), exchange, byName, now);
      }
    }

    if ((step * STEP) % 86400 === 0) {
      log.push({
        day: (step * STEP) / 86400,
        money: bots.reduce((sum, bot) => sum + bot.credits, 0),
        goods: bots.reduce((sum, bot) => sum + bot.mined, 0),
        ore: marketPrice('ORE', exchange.trades).price,
        polymers: marketPrice('POLYMERS', exchange.trades).price,
        trades: exchange.count,
        farms: bots.map((bot) => bot.levels.CRYPTO_FARM).join('/'),
      });
    }
  }

  return { bots, log };
}

/* ------------------------- Отчет ------------------------- */

const days = Math.max(1, Math.min(60, Number(process.argv[2] ?? 7) || 7));
const fromAt = process.argv.indexOf('--from');
const startPath = fromAt > 0 ? process.argv[fromAt + 1] : undefined;
const start = startPath ? (JSON.parse(readFileSync(startPath, 'utf8')) as StartFile) : null;
const { bots, log } = run(days, start);
const money = (value: number): string => Math.round(value).toLocaleString('ru-RU');

console.log(`=== Прогон ${days} сут, ${bots.length} ботов${start ? `, старт с ${startPath}` : ''} ===\n`);
/** Короткие ярлыки технологий: полные названия в строку прогона не помещаются. */
const TECH_SHORT: Record<TechnologyType, string> = {
  ENERGY_TECH: 'энерг',
  COMPUTING_TECH: 'выч',
  WEAPONS_TECH: 'оруж',
  SHIELDS_TECH: 'щит',
  ARMOR_TECH: 'брон',
  MINING_TECH: 'горн',
  COMBUSTION_DRIVE: 'тяга',
  HYPERSPACE_PHYSICS: 'гипф',
  HYPERDRIVE: 'гипд',
  ASTROPHYSICS: 'астр',
  ROBOTICS: 'робо',
  CRYPTO_TECH: 'крип',
  VAULT_TECH: 'бунк',
  ESPIONAGE: 'шпио',
  TIME_COMPRESSION: 'врем',
};

for (const bot of bots) {
  const fleet = Object.entries(bot.ships)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${type}×${count}`)
    .join(' ');
  console.log(
    `  ${bot.name.padEnd(11)} ферма ${String(bot.levels.CRYPTO_FARM).padStart(2)} | шахта ${String(bot.levels.ORE_MINE).padStart(2)}` +
      ` завод ${String(bot.levels.POLYMER_PLANT).padStart(2)} реактор ${String(bot.levels.PLASMA_REACTOR).padStart(2)}` +
      ` энерг ${String(bot.levels.POWER_PLANT).padStart(2)} верфь ${String(bot.levels.SHIPYARD).padStart(2)}` +
      ` наука ${String(bot.levels.SCIENCE_CENTER).padStart(2)} | ₴${money(bot.credits).padStart(12)}\n` +
      `              флот ${fleet || '—'}\n` +
      /*
       * Наука объявлена главными воротами месяца, а в прогоне ее не было видно
       * вовсе: по составу флота не понять, чего именно не хватает классу —
       * уровня верфи или технологии.
       */
      `              наука ${TECHNOLOGY_TYPES.filter((tech) => bot.techs[tech] > 0)
        .map((tech) => `${TECH_SHORT[tech]}${bot.techs[tech]}`)
        .join(' ') || '—'}`,
  );
}

const last = log[log.length - 1];
const yards = bots.map((bot) => bot.levels.SHIPYARD);
console.log(
  `\n  ИТОГ: верфь лучшая ${Math.max(...yards)} / средняя ${(yards.reduce((a, b) => a + b, 0) / yards.length).toFixed(1)}` +
    ` | масса ₴${money(last?.money ?? 0)} | добыто ${money(last?.goods ?? 0)} ед` +
    ` | ₴ на единицу ${((last?.money ?? 0) / Math.max(1, last?.goods ?? 1)).toFixed(2)}`,
);
/*
 * Ворота контента — главное, чего прогон долго не показывал.
 *
 * Состав флота для этого не годится: переработчик, колонизатор и зонд
 * заказываются под задачу, а не долей эскадры, и их отсутствие в списке
 * не значит, что класс недоступен. Мерить надо открытость самого класса.
 */
const unlocked = new Map<string, number>();
for (const bot of bots) {
  for (const type of SHIP_TYPES) {
    if (missingShipRequirements(type, bot.levels, bot.techs).length === 0) {
      unlocked.set(type, (unlocked.get(type) ?? 0) + 1);
    }
  }
}
console.log(
  '  ВОРОТА: ' +
    SHIP_TYPES.map((type) => `${shipLabel(type)} ${unlocked.get(type) ?? 0}/${bots.length}`)
      .join(' · '),
);

console.log(
  `  ДЕНЬГИ: намыто ₴${money(bots.reduce((sum, bot) => sum + bot.earned, 0))}` +
    ` | уплачено за хаб ₴${money(bots.reduce((sum, bot) => sum + bot.rentPaid, 0))}` +
    ` | на спешку ₴${money(bots.reduce((sum, bot) => sum + bot.rushed, 0))}` +
    ` | хабы ${bots.map((bot) => bot.hub.level).join('/')}`,
);

/*
 * Логистика отдельной строкой: отказы — это рейсы, которых бот хотел,
 * а живой сервер бы не выпустил. Их рост после правки — первый признак,
 * что правило разошлось с тем, как бот набирает флот.
 */
const refusals = new Map<string, number>();
for (const bot of bots) {
  for (const [reason, count] of Object.entries(bot.logistics.refused)) {
    refusals.set(reason, (refusals.get(reason) ?? 0) + count);
  }
}
console.log(
  `  РЕЙСЫ: ${money(bots.reduce((sum, bot) => sum + bot.logistics.sent, 0))}` +
    ` | на хаб ${money(bots.reduce((sum, bot) => sum + bot.logistics.delivered, 0))} ед` +
    ` | с хаба ${money(bots.reduce((sum, bot) => sum + bot.logistics.picked, 0))} ед` +
    ` | плазмы сожжено ${money(bots.reduce((sum, bot) => sum + bot.logistics.fuel, 0))}` +
    ` | отказов ${[...refusals].map(([reason, count]) => `${reason} ${money(count)}`).join(', ') || 'нет'}`,
);

console.log('\n  день |      масса ₴ |   добыто ед | ₴/ед | руда | полимеры | сделок | фермы');
for (const row of log) {
  if (!MARKS.includes(row.day) && row.day !== days) continue;
  console.log(
    `  ${String(row.day).padStart(4)} | ${money(row.money).padStart(12)} | ${money(row.goods).padStart(11)}` +
      ` | ${(row.money / Math.max(1, row.goods)).toFixed(2).padStart(4)} | ${String(row.ore).padStart(4)}` +
      ` | ${String(row.polymers).padStart(8)} | ${String(row.trades).padStart(6)} | ${row.farms}`,
  );
}
