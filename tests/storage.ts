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
  storageCapacityForLevel,
  storedTotal,
  type BuildingLevels,
} from '../src/game/rules.js';

const BASE_URL = 'http://localhost:3000';
const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const techs = emptyTechLevels();
const richness = { titanite: 1, silicate: 1, tritium: 1, energy: 1, eridium: 1 };

/** Минимальная база: accrue трогает только уровни, богатство, оборону и склад. */
function makeBase(levels: Partial<BuildingLevels>, stock: Partial<BaseRuntimeState['resources']>) {
  return {
    id: 'test-base',
    levels: { ...emptyLevels(), ...levels },
    richness,
    anomaly: 'NONE',
    defenses: emptyDefenseCounts(),
    ships: emptyShipCounts(),
    resources: { titanite: 0, silicate: 0, tritium: 0, eridium: 0, ...stock },
    dirty: false,
  } as unknown as BaseRuntimeState;
}

/** Развитая колония: шахты качают быстрее, чем влезает в маленький склад. */
const MINES: Partial<BuildingLevels> = {
  TITANITE_MINE: 10,
  SILICATE_MINE: 10,
  TRITIUM_MINE: 8,
  SOLAR_PLANT: 14,
};

const DAY = 24 * 3600;
const WEEK = 7 * DAY;

/* ------------------------- 1. Вместимость ------------------------- */

console.log('\n=== 1. Вместимость хранилища ===');

check(
  'уровень 0 дает колониальный резерв',
  storageCapacityForLevel(0) === 5000,
  `${storageCapacityForLevel(0)}`,
);
check(
  'уровень 1 дает базовую вместимость 10 000',
  storageCapacityForLevel(1) === 10000,
  `${storageCapacityForLevel(1)}`,
);
check(
  'вместимость растет по экспоненте ×1.5',
  storageCapacityForLevel(2) === 15000 && storageCapacityForLevel(3) === 22500,
  `ур.2 ${storageCapacityForLevel(2)}, ур.3 ${storageCapacityForLevel(3)}`,
);
check(
  'отрицательный уровень не ломает формулу',
  storageCapacityForLevel(-5) === storageCapacityForLevel(0),
);

/* ------------------------- 2. Ограничение добычи ------------------------- */

console.log('\n=== 2. Добыча упирается в потолок ===');

{
  const base = makeBase({ ...MINES, STORAGE: 1 }, { titanite: 500, silicate: 300, tritium: 100 });
  const capacity = storageCapacityForLevel(1);
  accrue(base, techs, WEEK);
  const used = storedTotal(base.resources);

  check(
    'неделя офлайна не переполняет склад',
    Math.round(used) === capacity,
    `занято ${Math.round(used)} из ${capacity}`,
  );
}

{
  // Тот же потолок, но набранный шагами: Game Loop дробит офлайн на отрезки
  // по завершенным стройкам, и каждый отрезок проходит через accrue отдельно.
  const base = makeBase({ ...MINES, STORAGE: 1 }, { titanite: 500, silicate: 300, tritium: 100 });
  for (let i = 0; i < 7; i += 1) accrue(base, techs, DAY);
  const used = storedTotal(base.resources);

  check(
    'догон по отрезкам дает тот же потолок, что и один вызов',
    Math.round(used) === storageCapacityForLevel(1),
    `занято ${Math.round(used)}`,
  );
}

{
  const base = makeBase({ ...MINES, STORAGE: 1 }, { titanite: 6000, silicate: 4000, tritium: 0 });
  const before = { ...base.resources };
  accrue(base, techs, DAY);

  check(
    'на полном складе добыча полностью остановлена',
    base.resources.titanite === before.titanite &&
      base.resources.silicate === before.silicate &&
      base.resources.tritium === before.tritium,
    `титанит ${base.resources.titanite}`,
  );
}

{
  // Переполнить склад может возвратный рейс или отмена ордера — добыча при этом
  // стоит, но уже лежащие сверх лимита ресурсы никуда не пропадают.
  const base = makeBase({ ...MINES, STORAGE: 1 }, { titanite: 20000, silicate: 8000, tritium: 0 });
  accrue(base, techs, DAY);

  check(
    'переполненный склад не растет и не усыхает',
    base.resources.titanite === 20000 && base.resources.silicate === 8000,
    `${base.resources.titanite} / ${base.resources.silicate}`,
  );
}

{
  const base = makeBase({ ...MINES, STORAGE: 1 }, { titanite: 500, silicate: 300, tritium: 100 });
  const perSecond = productionPerSecond(base.levels, richness, undefined, 0);

  // Минута добычи заведомо влезает в свободное место, поэтому обрезать нечего
  // и начисление должно совпасть с формулой до последнего знака.
  const seconds = 60;
  const mined = (perSecond.titanite + perSecond.silicate + perSecond.tritium) * seconds;
  const free = storageCapacityForLevel(1) - storedTotal(base.resources);
  accrue(base, techs, seconds);

  const expectedTitanite = 500 + perSecond.titanite * seconds;
  check(
    'пока место есть, добыча идет в полную силу',
    mined < free && Math.abs(base.resources.titanite - expectedTitanite) < 0.000001,
    `${base.resources.titanite.toFixed(2)} против ${expectedTitanite.toFixed(2)} (добыто ${Math.round(mined)} при свободных ${Math.round(free)})`,
  );
}

{
  // Обрезка одинаковой долей: иначе быстрый титанит вытеснил бы тритий.
  const base = makeBase({ ...MINES, STORAGE: 1 }, { titanite: 0, silicate: 0, tritium: 0 });
  const perSecond = productionPerSecond(base.levels, richness, undefined, 0);
  const mix = perSecond.titanite / perSecond.tritium;
  accrue(base, techs, WEEK);
  const gotMix = base.resources.titanite / base.resources.tritium;

  check(
    'обрезка сохраняет пропорцию между ресурсами',
    Math.abs(mix - gotMix) < 0.001,
    `ожидали ${mix.toFixed(3)}, получили ${gotMix.toFixed(3)}`,
  );
}

{
  const base = makeBase(
    { ...MINES, ERIDIUM_SYNTH: 4, RESEARCH_LAB: 3, STORAGE: 1 },
    { titanite: 6000, silicate: 4000, tritium: 0, eridium: 0 },
  );
  accrue(base, techs, DAY);

  check(
    'эридий копится и на полном складе',
    base.resources.eridium > 0,
    `${base.resources.eridium.toFixed(3)}`,
  );
}

{
  const base = makeBase({ ...MINES }, { titanite: 500, silicate: 300, tritium: 100 });
  accrue(base, techs, WEEK);

  check(
    'база без хранилища упирается в колониальный резерв',
    Math.round(storedTotal(base.resources)) === storageCapacityForLevel(0),
    `занято ${Math.round(storedTotal(base.resources))}`,
  );
}

/* ------------------------- 3. Механика сейфа ------------------------- */

console.log('\n=== 3. Грабеж: несгораемый объем ===');

const CAPACITY = storageCapacityForLevel(1);
const HOLDS = 1_000_000;

{
  const loot = plunderAmount({ titanite: 3000, silicate: 2000, tritium: 0 }, CAPACITY, HOLDS);
  check(
    'полупустой склад не теряет ничего',
    loot.titanite === 0 && loot.silicate === 0 && loot.surplus === 0,
    `защищено ${loot.protectedAmount}`,
  );
}

{
  const loot = plunderAmount({ titanite: 5400, silicate: 3600, tritium: 0 }, CAPACITY, HOLDS);
  check(
    'ровно на границе 90% вместимости грабить нечего',
    loot.titanite === 0 && loot.silicate === 0,
    `лежало ${loot.stored}, излишек ${loot.surplus}`,
  );
}

{
  const loot = plunderAmount({ titanite: 6000, silicate: 4000, tritium: 0 }, CAPACITY, HOLDS);
  check(
    'полный склад отдает 90% от последних 10% вместимости',
    loot.surplus === 1000 && loot.titanite === 540 && loot.silicate === 360,
    `излишек ${loot.surplus} → ${loot.titanite} Ti + ${loot.silicate} Si`,
  );
}

{
  const loot = plunderAmount({ titanite: 12000, silicate: 8000, tritium: 0 }, CAPACITY, HOLDS);
  check(
    'переполненный склад отдает 90% всего излишка',
    loot.surplus === 11000 && loot.titanite + loot.silicate === 9900,
    `излишек ${loot.surplus} → ${loot.titanite + loot.silicate}`,
  );
  check(
    'вывоз пропорционален долям ресурсов на складе',
    loot.titanite === 5940 && loot.silicate === 3960,
    `${loot.titanite} Ti + ${loot.silicate} Si при складе 12000/8000`,
  );
}

{
  const loot = plunderAmount({ titanite: 0, silicate: 20000, tritium: 0 }, CAPACITY, HOLDS);
  check(
    'склад из одних силикатов отдает только силикаты',
    loot.titanite === 0 && loot.silicate === 9900,
    `${loot.silicate} Si`,
  );
}

{
  // Тритий занимает место в хранилище и вывозится наравне с остальными:
  // трюмы транспортов принимают его как обычный груз.
  const loot = plunderAmount({ titanite: 5000, silicate: 0, tritium: 5000 }, CAPACITY, HOLDS);
  check(
    'тритий считается в лимите склада',
    loot.stored === 10000 && loot.surplus === 1000,
    `лежало ${loot.stored}, излишек ${loot.surplus}`,
  );
  check(
    'тритий вывозится наравне с титанитом и силикатами',
    loot.titanite === 450 && loot.tritium === 450 && loot.silicate === 0,
    `${loot.titanite} Ti + ${loot.tritium} Tr`,
  );
  check(
    'суммарно увезли 90% излишка',
    loot.titanite + loot.silicate + loot.tritium === 900,
    `${loot.titanite + loot.silicate + loot.tritium} из излишка ${loot.surplus}`,
  );
}

{
  // Трюмы забиваются по порядку, поэтому при нехватке места тритий грузят
  // последним — но склад защитника теряет ровно то, что уехало.
  const loot = plunderAmount({ titanite: 6000, silicate: 6000, tritium: 8000 }, CAPACITY, 900);
  check(
    'при нехватке трюмов тритий грузится последним',
    loot.titanite === 900 && loot.silicate === 0 && loot.tritium === 0 && loot.cargoLimited,
    `${loot.titanite} Ti + ${loot.silicate} Si + ${loot.tritium} Tr при трюмах 900`,
  );
}

{
  const loot = plunderAmount({ titanite: 0, silicate: 0, tritium: 20000 }, CAPACITY, HOLDS);
  check(
    'склад из одного трития отдает тритий',
    loot.tritium === 9900 && loot.titanite === 0,
    `${loot.tritium} Tr`,
  );
}

{
  const loot = plunderAmount({ titanite: 12000, silicate: 8000, tritium: 0 }, CAPACITY, 1000);
  check(
    'трюмы уцелевших жестко ограничивают вывоз',
    loot.titanite + loot.silicate === 1000 && loot.cargoLimited,
    `увезли ${loot.titanite + loot.silicate} из ${loot.takeable}`,
  );
}

{
  const loot = plunderAmount({ titanite: 12000, silicate: 8000, tritium: 0 }, CAPACITY, 0);
  check(
    'без уцелевших трюмов не увозится ничего',
    loot.titanite === 0 && loot.silicate === 0 && loot.cargoLimited,
    `могли взять ${loot.takeable}`,
  );
}

{
  const big = plunderAmount({ titanite: 12000, silicate: 8000, tritium: 0 }, storageCapacityForLevel(3), HOLDS);
  check(
    'хранилище побольше прячет больше',
    big.protectedAmount === 20000 && big.titanite + big.silicate === 0,
    `вместимость 22500 защитила всё (${big.protectedAmount})`,
  );
}

{
  const loot = plunderAmount({ titanite: -5, silicate: 0, tritium: 0 }, CAPACITY, HOLDS);
  check(
    'отрицательный склад не создает добычу из воздуха',
    loot.titanite === 0 && loot.silicate === 0 && loot.stored === 0,
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
    const expected = storageCapacityForLevel(0);
    check(
      'вместимость новой колонии совпадает с формулой',
      base.storage.capacity === expected,
      `${base.storage.capacity} против ${expected}`,
    );
    check(
      'занятый объем равен сумме титанита, силикатов и трития',
      Math.abs(
        base.storage.used - (base.resources.titanite + base.resources.silicate + base.resources.tritium),
      ) < 1,
      `занято ${base.storage.used}`,
    );
    check(
      'новая колония еще не под угрозой грабежа',
      base.storage.vulnerable === 0 && !base.storage.full,
      `уязвимо ${base.storage.vulnerable}`,
    );
  }

  const storage = (base?.buildings as any[])?.find((item) => item.type === 'STORAGE');
  check('хранилище доступно к постройке с первого уровня', Boolean(storage) && storage.requirements.length === 0);
  check(
    'карточка хранилища объясняет прирост вместимости',
    typeof storage?.effect === 'string' && storage.effect.includes('10000'),
    storage?.effect,
  );
}

/* ------------------------- Итог ------------------------- */

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
if (passed !== results.length) process.exitCode = 1;
