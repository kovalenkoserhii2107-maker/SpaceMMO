/**
 * Логистика бота: сколько грузовиков брать и что везти.
 *
 * Модуль чистый — ни базы, ни игрового цикла, — и это его смысл. Эти правила
 * нужны двоим: живому директору, который шлет флот, и прогону экономики,
 * который теперь моделирует рейсы. Копия правила в прогоне разъехалась бы
 * с боевым кодом при первой правке и начала бы мерить сама себя.
 */
import { emptyShipCounts, type ShipCounts } from '../ships.js';
import { fleetCapacity } from '../fleets.js';
import { storageCapacities } from '../rules.js';
import type { BotSnapshot } from './decide.js';

/**
 * Грузовики ровно под груз, а не весь транспортный флот.
 *
 * Топливо платится за каждый корабль в рейсе, груз он везет или нет. Бот
 * посылал за товаром все, что стояло в ангаре, и это съедало плазму целиком:
 * живой Крамар гонял 659 транспортов за пятью тысячами руды, которые
 * помещаются в три малых, а Беркут делал так 129 рейсов за сутки. Плазма
 * держалась у нуля при реакторе, дающем 23 тысячи в час, — и дальше правило
 * «ресурс, которого хронически нет, идут добывать» ставило первым пунктом
 * плана реактор за полмиллиона руды, на который бот копил сутками.
 *
 * Большие берутся первыми: у них на единицу трюма вдвое меньше расхода.
 * Трюмы считаются без бонуса синдиката — с ним места только больше.
 *
 * Запас в пятую часть — под топливо: оно едет в тех же трюмах, и рейс,
 * набранный трюмо в трюмо, не прошел бы проверку вылета вовсе. Доля
 * расхода к трюму у обоих грузовиков одна (0.0002 в секунду на единицу
 * места), поэтому одного числа хватает на любой состав, а пятой части —
 * на любой внутрисистемный перелет.
 */
export const CARGO_FUEL_MARGIN = 1.25;

/** Под груз идет не весь трюм: топливо рейса едет в нем же. */
export function holdForCargo(ships: ShipCounts): number {
  return Math.floor(fleetCapacity(ships) / CARGO_FUEL_MARGIN);
}

export function cargoShipsFor(amount: number, available: { LARGE_CARGO: number; SMALL_CARGO: number }): ShipCounts {
  const ships = emptyShipCounts();
  const large = fleetCapacity({ ...emptyShipCounts(), LARGE_CARGO: 1 });
  const small = fleetCapacity({ ...emptyShipCounts(), SMALL_CARGO: 1 });

  let left = Math.max(0, amount) * CARGO_FUEL_MARGIN;
  ships.LARGE_CARGO = Math.min(available.LARGE_CARGO, Math.floor(left / large));
  left -= ships.LARGE_CARGO * large;
  ships.SMALL_CARGO = Math.min(available.SMALL_CARGO, Math.ceil(left / small));
  left -= ships.SMALL_CARGO * small;
  // Малых не хватило на остаток — докрываем большим, если он еще есть.
  if (left > 0 && ships.LARGE_CARGO < available.LARGE_CARGO) ships.LARGE_CARGO += 1;
  return ships;
}

/*
 * Граница вывоза: на хаб уходит то, что сверх половины своего склада и сверх
 * того, что требуют цели бота, и домой с хаба возвращается ровно до нее же.
 *
 * Одна граница на оба рейса — это и есть защита от насоса. Прежде вывоз
 * брал все сверх половины склада, а обратный рейс забирал домой все, что
 * влезет, и один и тот же груз ходил по кругу. Прогон с настоящими рейсами
 * показал это сразу: за неделю 138 млн единиц туда и 137 млн обратно при
 * добыче в 57 млн, 10 млн плазмы на топливо и 38 тысяч рейсов, отмененных
 * за нехваткой плазмы.
 *
 * Граница «только дефицит не вывозим» насос не снимала, а лишь вдвое
 * уменьшала. Цели нужно 70% склада руды, руды уже хватает, но цель ждет
 * полимеров: руда «не в дефиците», рейс вывозит ее до половины склада,
 * она становится дефицитом, обратный рейс ее возвращает — и так по кругу.
 * Поэтому граница считается от того, сколько цель требует, а не от того,
 * чего не хватает прямо сейчас.
 */
export const HUB_EXPORT_SHARE = 0.5;

export type HomeNeed = { ore: number; polymers: number };

/** Сколько держать дома: половина склада или больше, если столько требует цель. */
export function homeKeep(
  caps: { ore: number; polymers: number },
  need: HomeNeed,
): HomeNeed {
  return {
    ore: Math.max(caps.ore * HUB_EXPORT_SHARE, Math.min(caps.ore, need.ore)),
    polymers: Math.max(caps.polymers * HUB_EXPORT_SHARE, Math.min(caps.polymers, need.polymers)),
  };
}

/**
 * Что везти на хаб и чем: груз и грузовики под него, или null — рейс не нужен.
 *
 * `need` — сколько каждого ресурса требуют цели бота: это остается дома.
 * Иначе бот продавал бы то, что тут же пошел бы покупать, а обратный рейс
 * возвращал бы вывезенное.
 */
export function hubDeliveryLoad(
  snapshot: BotSnapshot,
  need: HomeNeed = { ore: 0, polymers: 0 },
): { ore: number; polymers: number; ships: ShipCounts } | null {
  const base = snapshot.bases[0];
  if (!base) return null;

  const cargoShips = base.ships.LARGE_CARGO + base.ships.SMALL_CARGO;
  if (cargoShips === 0) return null;

  const ships = emptyShipCounts();
  ships.LARGE_CARGO = base.ships.LARGE_CARGO;
  ships.SMALL_CARGO = base.ships.SMALL_CARGO;

  /*
   * Везем долю излишка, но не больше, чем влезает в трюмы.
   *
   * Без этой обрезки рейс просто не улетал: доля считалась от склада, легко
   * перекрывала вместимость одного транспорта, и sendFleet отвечал отказом.
   * Молча — потому что отказ здесь штатен, — и торговля бота не работала вовсе.
   */
  const hold = holdForCargo(ships);
  if (hold <= 0) return null;

  /*
   * Вывозим только излишек — то, чего накопилось больше половины своего склада.
   *
   * Раньше в рейс уходило по сорок процентов и руды, и полимеров, независимо
   * от того, много их или мало. Бот на этом сам себя обкрадывал: полимеров
   * у него было под завязку, а руды на четверть склада, и именно руду он
   * увозил на станцию — ту самую, которой не хватало на лабораторию.
   * Живой бот простоял так с лабораторией четвертого уровня при шахтах
   * седьмого несколько часов.
   */
  const keep = homeKeep(storageCapacities(base.levels), need);
  const surplus = (held: number, kept: number) => Math.max(0, held - kept);

  /*
   * Не везем то, что уже лежит на хабе непроданным.
   *
   * Без этого тормоза получался насос в пустоту: полимеров на рынке избыток,
   * их никто не берет, но бот исправно возил новые — склад хаба забивался,
   * и бот платил за расширение, каждый раз вдвое дороже предыдущего.
   * Живой бот сжег так 1.9 млн ₴, подняв склад с четвертого уровня
   * до восьмого ради 56 тысяч полимеров, которые никому не нужны.
   *
   * Порог — нынешний спрос в стакане плюс один трюм про запас: держать товар
   * на хабе имеет смысл ровно настолько, насколько его готовы купить, плюс
   * немного на случай, если покупатель появится до следующего рейса.
   */
  const demandFor = (resource: 'ORE' | 'POLYMERS') =>
    snapshot.market.find((ref) => ref.resource === resource)?.demand ?? 0;
  const glutted = (resource: 'ORE' | 'POLYMERS', onHub: number) =>
    onHub > demandFor(resource) + hold;

  let ore = glutted('ORE', snapshot.hubStorage.ore)
    ? 0
    : Math.floor(surplus(base.resources.ore, keep.ore) * 0.8);
  let polymers = glutted('POLYMERS', snapshot.hubStorage.polymers)
    ? 0
    : Math.floor(surplus(base.resources.polymers, keep.polymers) * 0.8);
  if (ore + polymers > hold) {
    // Режем пропорционально, чтобы не вывезти один ресурс целиком.
    const scale = hold / (ore + polymers);
    ore = Math.floor(ore * scale);
    polymers = Math.floor(polymers * scale);
  }
  if (ore + polymers < 100) return null;

  // Трюмы всего флота нужны были только для обрезки груза; летят те, кто везет.
  return { ore, polymers, ships: cargoShipsFor(ore + polymers, ships) };
}
