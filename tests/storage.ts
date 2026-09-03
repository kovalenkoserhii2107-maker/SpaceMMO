/**
 * Хранилища: лимит склада, остановка добычи и механика «сейфа» при грабеже.
 *
 * Формулы проверяются напрямую на игровых модулях — это те же функции, которые
 * зовет Game Loop и боевой модуль, и они детерминированы. Живой сервер нужен
 * только для последней секции: там сверяется, что состояние склада реально
 * доезжает до клиента.
 *
 * Запуск: npm run test:storage
 */
import { accrue, type BaseRuntimeState } from '../src/game/baseState.js';
import { plunderAmount } from '../src/game/combat.js';
import { emptyDefenseCounts } from '../src/game/defenses.js';
import { emptyShipCounts } from '../src/game/ships.js';
import { emptyTechLevels } from '../src/game/techTree.js';
import {
  emptyLevels,
  productionPerSecond,
  storageCapacities,
  storageCapacity,
  storageCapacityForLevel,
  type BuildingLevels,
} from '../src/game/rules.js';

const BASE_URL = 'http://localhost:3000';
const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const techs = emptyTechLevels();
const richness = { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 };

/** Минимальная база: accrue трогает только уровни, богатство, оборону и склад. */
function makeBase(levels: Partial<BuildingLevels>, stock: Partial<BaseRuntimeState['resources']>) {
  return {
    id: 'test-base',
    levels: { ...emptyLevels(), ...levels },
    richness,
    anomaly: 'NONE',
    defenses: emptyDefenseCounts(),
    ships: emptyShipCounts(),
    resources: { ore: 0, polymers: 0, plasma: 0, antimatter: 0, ...stock },
    dirty: false,
  } as unknown as BaseRuntimeState;
}

/** Развитая колония: шахты качают быстрее, чем влезает в маленький склад. */
/** Все три склада первого уровня: базовый набор для проверок добычи. */
const FULL_STORAGE: Partial<BuildingLevels> = {
  ORE_STORAGE: 1,
  POLYMER_STORAGE: 1,
  PLASMA_STORAGE: 1,
};

const MINES: Partial<BuildingLevels> = {
  ORE_MINE: 10,
  POLYMER_PLANT: 10,
  PLASMA_REACTOR: 8,
  POWER_PLANT: 14,
};

const DAY = 24 * 3600;
const WEEK = 7 * DAY;

/* ------------------------- 1. Вместимость ------------------------- */

console.log('\n=== 1. Вместимость хранилищ ===');

check(
  'уровень 0 дает колониальный резерв на каждый ресурс',
  storageCapacityForLevel(0) === 2500,
  `${storageCapacityForLevel(0)}`,
);
check(
  'уровень 1 дает 3 500 на свой ресурс',
  storageCapacityForLevel(1) === 3500,
  `${storageCapacityForLevel(1)}`,
);
check(
  'вместимость растет по экспоненте ×1.5',
  storageCapacityForLevel(2) === 5250 && storageCapacityForLevel(3) === 7875,
  `ур.2 ${storageCapacityForLevel(2)}, ур.3 ${storageCapacityForLevel(3)}`,
);
check(
  'отрицательный уровень не ломает формулу',
  storageCapacityForLevel(-5) === storageCapacityForLevel(0),
);

{
  // Три склада первого уровня в сумме дают примерно то же, что давал один
  // общий: разделение убрало ловушку, а не раздало место даром.
  const levels = { ...emptyLevels(), ORE_STORAGE: 1, POLYMER_STORAGE: 1, PLASMA_STORAGE: 1 };
  check(
    'суммарный объем трех складов сопоставим с прежним общим',
    storageCapacity(levels) === 10500,
    `${storageCapacity(levels)} против прежних 10 000`,
  );
}

{
  const levels = { ...emptyLevels(), ORE_STORAGE: 3, POLYMER_STORAGE: 1, PLASMA_STORAGE: 0 };
  const caps = storageCapacities(levels);
  check(
    'склады качаются вразнобой и считаются независимо',
    caps.ore === 7875 && caps.polymers === 3500 && caps.plasma === 2500,
    `руда ${caps.ore}, полимеры ${caps.polymers}, плазма ${caps.plasma}`,
  );
}

/* ------------------------- 2. Ограничение добычи ------------------------- */

console.log('\n=== 2. Добыча упирается в свой потолок ===');

{
  const base = makeBase({ ...MINES, ...FULL_STORAGE }, { ore: 500, polymers: 300, plasma: 100 });
  const caps = storageCapacities(base.levels);
  accrue(base, techs, WEEK);

  check(
    'неделя офлайна упирает каждый ресурс в его собственный потолок',
    Math.round(base.resources.ore) === caps.ore &&
      Math.round(base.resources.polymers) === caps.polymers &&
      Math.round(base.resources.plasma) === caps.plasma,
    `руда ${Math.round(base.resources.ore)}/${caps.ore}, полимеры ${Math.round(base.resources.polymers)}/${caps.polymers}, плазма ${Math.round(base.resources.plasma)}/${caps.plasma}`,
  );
}

{
  // Game Loop дробит офлайн на отрезки по завершенным стройкам, и каждый
  // отрезок проходит через accrue отдельно.
  const base = makeBase({ ...MINES, ...FULL_STORAGE }, { ore: 500, polymers: 300, plasma: 100 });
  for (let i = 0; i < 7; i += 1) accrue(base, techs, DAY);
  const caps = storageCapacities(base.levels);

  check(
    'догон по отрезкам дает тот же потолок, что и один вызов',
    Math.round(base.resources.ore) === caps.ore &&
      Math.round(base.resources.polymers) === caps.polymers,
    `руда ${Math.round(base.resources.ore)}, полимеры ${Math.round(base.resources.polymers)}`,
  );
}

{
  /*
   * Ради этого свойства склады и разделили.
   *
   * Раньше лимит был общим, и полный склад полимеров останавливал добычу руды
   * вместе со своей. Игрок с восемью тысячами полимеров и пятью сотнями руды
   * не мог добыть руду ни при каких условиях, а все постройки требовали именно
   * ее — состояние без выхода. Теперь полный склад останавливает только свой
   * ресурс.
   */
  const levels = { ...MINES, ...FULL_STORAGE };
  const caps = storageCapacities(levels);
  const base = makeBase(levels, { ore: 10, polymers: caps.polymers, plasma: 0 });
  const oreBefore = base.resources.ore;
  accrue(base, techs, 600);

  check(
    'полный склад полимеров не останавливает добычу руды',
    base.resources.ore > oreBefore,
    `руда ${Math.round(oreBefore)} → ${Math.round(base.resources.ore)}`,
  );
  check(
    'а сами полимеры при этом стоят на потолке',
    Math.round(base.resources.polymers) === caps.polymers,
    `${Math.round(base.resources.polymers)}/${caps.polymers}`,
  );
}

{
  const levels = { ...MINES, ...FULL_STORAGE };
  const caps = storageCapacities(levels);
  const base = makeBase(levels, { ore: caps.ore, polymers: caps.polymers, plasma: caps.plasma });
  const before = { ...base.resources };
  accrue(base, techs, DAY);

  check(
    'когда полны все три, добыча остановлена полностью',
    base.resources.ore === before.ore &&
      base.resources.polymers === before.polymers &&
      base.resources.plasma === before.plasma,
    `руда ${Math.round(base.resources.ore)}`,
  );
}

{
  // Переполнить склад может возвратный рейс или отмена ордера — добыча при этом
  // стоит, но уже лежащие сверх лимита ресурсы никуда не пропадают.
  const levels = { ...MINES, ...FULL_STORAGE };
  const base = makeBase(levels, { ore: 90000, polymers: 80000, plasma: 0 });
  accrue(base, techs, DAY);

  check(
    'переполненный склад не растет и не усыхает',
    base.resources.ore === 90000 && base.resources.polymers === 80000,
    `${base.resources.ore} / ${base.resources.polymers}`,
  );
}

{
  const levels = { ...MINES, ...FULL_STORAGE };
  const base = makeBase(levels, { ore: 500, polymers: 300, plasma: 100 });
  const perSecond = productionPerSecond(base.levels, richness, undefined, 0);

  // Минута добычи заведомо влезает в свободное место, поэтому обрезать нечего
  // и начисление должно совпасть с формулой до последнего знака.
  const seconds = 60;
  accrue(base, techs, seconds);
  const expectedOre = 500 + perSecond.ore * seconds;

  check(
    'пока место есть, добыча идет в полную силу',
    Math.abs(base.resources.ore - expectedOre) < 0.000001,
    `${base.resources.ore.toFixed(2)} против ${expectedOre.toFixed(2)}`,
  );
}

{
  const base = makeBase(
    { ...MINES, ...FULL_STORAGE, ANTIMATTER_FACTORY: 4, SCIENCE_CENTER: 3 },
    { ore: 90000, polymers: 80000, plasma: 90000, antimatter: 0 },
  );
  accrue(base, techs, DAY);

  check(
    'антиматерия копится и на полных складах',
    base.resources.antimatter > 0,
    `${base.resources.antimatter.toFixed(3)}`,
  );
}

{
  const base = makeBase({ ...MINES }, { ore: 500, polymers: 300, plasma: 100 });
  accrue(base, techs, WEEK);

  check(
    'база без хранилищ упирается в колониальный резерв по каждому ресурсу',
    Math.round(base.resources.ore) === storageCapacityForLevel(0) &&
      Math.round(base.resources.polymers) === storageCapacityForLevel(0),
    `руда ${Math.round(base.resources.ore)}, полимеры ${Math.round(base.resources.polymers)}`,
  );
}

/* ------------------------- 3. Механика сейфа ------------------------- */

console.log('\n=== 3. Грабеж: несгораемый объем ===');

const CAPS = { ore: 3500, polymers: 3500, plasma: 3500 };
const HOLDS = 1_000_000;

{
  // 20% от 3 500 — это 700 на каждый склад.
  const loot = plunderAmount({ ore: 700, polymers: 700, plasma: 0 }, CAPS, HOLDS);
  check(
    'ровно на границе несгораемой доли грабить нечего',
    loot.ore === 0 && loot.polymers === 0,
    `лежало ${Math.round(loot.stored)}, излишек ${Math.round(loot.surplus)}`,
  );
}

{
  /*
   * Ради этого сейф и переделан. Прежние 90% вместимости давали полный
   * иммунитет всем, у кого склад заполнен меньше чем на девять десятых, —
   * то есть почти всем. Живой агрессор провел восемь набегов подряд, выиграл
   * все восемь и не унес ни единицы: у жертвы склады стояли на 38%, 74% и 29%.
   */
  const loot = plunderAmount({ ore: 1000, polymers: 800, plasma: 0 }, CAPS, HOLDS);
  check(
    'полупустой склад больше не дает полного иммунитета',
    loot.ore > 0 && loot.polymers > 0,
    `увезли ${loot.ore} Ti + ${loot.polymers} Si`,
  );
}

{
  // «Бункерование» поднимает защиту по два процента за уровень: на десятом
  // сейф — 40% вместимости, то есть 1 400 из 3 500.
  const bare = plunderAmount({ ore: 1400, polymers: 0, plasma: 0 }, CAPS, HOLDS);
  const bunkered = plunderAmount({ ore: 1400, polymers: 0, plasma: 0 }, CAPS, HOLDS, 0.2);
  check(
    'бункерование прикрывает то, что без него отдали бы',
    bare.ore > 0 && bunkered.ore === 0,
    `без технологии ${bare.ore}, с ней ${bunkered.ore}`,
  );
}

{
  /*
   * Защита теперь поресурсная, и это меняет исход по существу. По общему лимиту
   * полный склад полимеров прикрывал собой руду, которой почти не было, —
   * ограбить ее было нельзя. Теперь пустой рудный склад свою защиту полимерам
   * не одалживает.
   */
  const loot = plunderAmount({ ore: 0, polymers: 3500, plasma: 0 }, CAPS, HOLDS);
  check(
    'полный склад полимеров грабится, даже когда руды нет вовсе',
    loot.polymers > 0,
    `увезли полимеров ${loot.polymers}`,
  );
}

{
  const loot = plunderAmount({ ore: 3500, polymers: 3500, plasma: 3500 }, CAPS, HOLDS);
  check(
    'с полных складов забирают 90% излишка сверх защиты',
    loot.ore > 0 && loot.polymers > 0 && loot.plasma > 0,
    `${loot.ore} Ti + ${loot.polymers} Si + ${loot.plasma} Tr`,
  );
}

{
  const loot = plunderAmount({ ore: 30000, polymers: 20000, plasma: 0 }, CAPS, 1000);
  check(
    'трюмы ограничивают вывоз',
    loot.ore + loot.polymers + loot.plasma === 1000 && loot.cargoLimited,
    `увезли ${loot.ore + loot.polymers + loot.plasma}`,
  );
}

{
  const loot = plunderAmount({ ore: -100, polymers: -50, plasma: 0 }, CAPS, HOLDS);
  check(
    'отрицательный склад не создает добычу из воздуха',
    loot.ore === 0 && loot.polymers === 0 && loot.plasma === 0,
  );
}

{
  const big = { ore: 100000, polymers: 100000, plasma: 100000 };
  const loot = plunderAmount({ ore: 20000, polymers: 0, plasma: 0 }, big, HOLDS);
  check(
    'склад побольше прячет больше',
    loot.ore === 0,
    `вместимость ${big.ore} защитила все ${20000}`,
  );
}

/* ------------------------- 4. Живой сервер ------------------------- */

console.log('\n=== 4. Состояние склада доезжает до клиента ===');

async function api(method: string, path: string, body?: unknown, token?: string) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, any> };
}

const suffix = Date.now().toString(36);
const email = `storage-${suffix}@spacemmo.local`;
const password = 'storage-pass-123';

const registered = await api('POST', '/api/auth/register', { email, password });
if (registered.status !== 200 && registered.status !== 201) {
  check('сервер доступен и принимает регистрацию', false, JSON.stringify(registered.data));
} else {
  const token = registered.data['token'] as string;
  await api('POST', '/api/auth/commander', { nickname: `Кладовщик-${suffix}`, avatarId: 'nova' }, token);
  const state = await api('GET', '/api/state', undefined, token);
  const base = (state.data['bases'] as any[])?.[0];

  check('сервер отдает состояние склада', Boolean(base?.storage), JSON.stringify(base?.storage));

  if (base?.storage) {
    const perResource = storageCapacityForLevel(0);
    check(
      'сервер отдает вместимость по каждому ресурсу',
      base.storage.ore?.capacity === perResource &&
        base.storage.polymers?.capacity === perResource &&
        base.storage.plasma?.capacity === perResource,
      `руда ${base.storage.ore?.capacity}, полимеры ${base.storage.polymers?.capacity}`,
    );
    check(
      'суммарная вместимость равна сумме трех складов',
      base.storage.capacity === perResource * 3,
      `${base.storage.capacity} против ${perResource * 3}`,
    );
    check(
      'занятый объем равен сумме руды, полимеров и плазмы',
      Math.abs(
        base.storage.used - (base.resources.ore + base.resources.polymers + base.resources.plasma),
      ) < 1,
      `занято ${base.storage.used}`,
    );
    /*
     * При сейфе в пятую часть вместимости стартовая колония уязвима сразу:
     * из полутора тысяч руды несгораемы пятьсот. Это осознанная цена
     * за то, чтобы грабеж вообще работал, — прежние 90% давали иммунитет
     * почти всем и всегда. Живого новичка прикрывает щит новичка, а не склад.
     */
    check(
      'у новой колонии несгораема пятая часть вместимости',
      Math.abs(base.storage.ore.protectedAmount - base.storage.ore.capacity * 0.2) < 1,
      `защищено ${Math.round(base.storage.ore.protectedAmount)} из ${base.storage.ore.capacity}`,
    );
    check(
      'склад при этом не переполнен',
      !base.storage.anyFull,
    );
  }

  const cards = (base?.buildings as any[]) ?? [];
  const storages = ['ORE_STORAGE', 'POLYMER_STORAGE', 'PLASMA_STORAGE'].map((type) =>
    cards.find((item) => item.type === type),
  );
  check(
    'все три склада доступны к постройке с первого уровня',
    storages.every((card) => card && card.requirements.length === 0),
    storages.map((card) => card?.type ?? 'нет').join(', '),
  );
  check(
    'карточка склада объясняет прирост вместимости',
    // Карточка печатает числа с разрядными пробелами, поэтому сверяем цифры,
    // а не форматирование.
    storages.every(
      (card) => typeof card?.effect === 'string' && card.effect.replace(/\s/gu, '').includes('3500'),
    ),
    storages[0]?.effect,
  );
}

/* ------------------------- Итог ------------------------- */

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
if (passed !== results.length) process.exitCode = 1;
