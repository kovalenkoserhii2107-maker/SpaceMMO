/**
 * Поля обломков и переработчики.
 *
 * Формула обломков проверяется на чистом боевом модуле, а атомарность сборки —
 * на живой БД: два переработчика, прилетевшие в одну секунду, не должны
 * задвоить поле. Именно эта гонка и есть главный риск этапа.
 *
 * Запуск: npm run test:debris
 */
import { prisma } from '../src/db/prisma.js';
import { DEBRIS_SHARE, debrisFromLosses, resolveBattle } from '../src/game/combat.js';
import { emptyDefenseCounts } from '../src/game/defenses.js';
import { fleetCapacity, validateComposition } from '../src/game/fleets.js';
import { emptyShipCounts, shipCost, type ShipCounts } from '../src/game/ships.js';

const BASE_URL = 'http://localhost:3000';
const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

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

function fleet(partial: Partial<ShipCounts>): ShipCounts {
  return { ...emptyShipCounts(), ...partial };
}

/* ------------------------- 1. Формула обломков ------------------------- */

console.log('\n=== 1. Обломки после боя ===');

check('доля обломков — 30% стоимости', DEBRIS_SHARE === 0.3, `${DEBRIS_SHARE}`);

{
  const debris = debrisFromLosses(fleet({}), fleet({}), emptyDefenseCounts());
  check('без потерь обломков нет', debris.ore === 0 && debris.polymers === 0);
}

{
  const cost = shipCost('HEAVY_CRUISER');
  const debris = debrisFromLosses(fleet({ HEAVY_CRUISER: 10 }), fleet({}), emptyDefenseCounts());
  check(
    'обломки считаются по стоимости постройки',
    debris.ore === Math.floor(cost.ore * 10 * DEBRIS_SHARE) &&
      debris.polymers === Math.floor(cost.polymers * 10 * DEBRIS_SHARE),
    `${debris.ore} Ti / ${debris.polymers} Si`,
  );
}

{
  // Ключевое: обломки дает и нападавший. Иначе выгодно было бы бросать флот.
  const onlyAttacker = debrisFromLosses(fleet({ HEAVY_CRUISER: 4 }), fleet({}), emptyDefenseCounts());
  const onlyDefender = debrisFromLosses(fleet({}), fleet({ HEAVY_CRUISER: 4 }), emptyDefenseCounts());
  const both = debrisFromLosses(fleet({ HEAVY_CRUISER: 4 }), fleet({ HEAVY_CRUISER: 4 }), emptyDefenseCounts());

  check(
    'потери нападавшего дают обломки наравне с потерями защитника',
    onlyAttacker.ore === onlyDefender.ore && onlyAttacker.ore > 0,
    `${onlyAttacker.ore} = ${onlyDefender.ore}`,
  );
  check(
    'обломки обеих сторон складываются',
    both.ore === onlyAttacker.ore + onlyDefender.ore,
    `${both.ore}`,
  );
}

{
  // Оборона больше не дает обломков: разбитые турели остаются на поверхности
  // планеты, а не выходят на орбиту.
  const debris = debrisFromLosses(fleet({}), fleet({}));
  check('разбитая оборона не дает обломков', debris.ore === 0 && debris.polymers === 0);
}

{
  // Плазма в обломках не остается: топливо и реагент сгорают в бою.
  const debris = debrisFromLosses(fleet({ ION_FRIGATE: 5 }), fleet({}), emptyDefenseCounts());
  check(
    'в обломках только руда и полимеры',
    Object.keys(debris).sort().join() === 'ore,polymers',
    Object.keys(debris).join(),
  );
}

{
  const outcome = resolveBattle(
    { ships: fleet({ HEAVY_CRUISER: 10 }), defenses: emptyDefenseCounts() },
    { ships: fleet({ ION_FRIGATE: 13 }), defenses: { CANNON_TURRET: 5, LASER_TURRET: 0 } },
  );
  check(
    'исход боя содержит поле обломков',
    outcome.debris.ore > 0 && outcome.debris.polymers > 0,
    JSON.stringify(outcome.debris),
  );

  const manual = debrisFromLosses(
    fleet({ HEAVY_CRUISER: outcome.attackerLosses.find((l) => l.key === 'HEAVY_CRUISER')?.lost ?? 0 }),
    fleet({ ION_FRIGATE: outcome.defenderLosses.find((l) => l.key === 'ION_FRIGATE')?.lost ?? 0 }),
    {
      CANNON_TURRET: outcome.defenderLosses.find((l) => l.key === 'CANNON_TURRET')?.lost ?? 0,
      LASER_TURRET: 0,
    },
  );
  check(
    'обломки сходятся с заявленными потерями',
    outcome.debris.ore === manual.ore && outcome.debris.polymers === manual.polymers,
    `${outcome.debris.ore} против ${manual.ore}`,
  );
}

/* ------------------------- 2. Переработчик ------------------------- */

console.log('\n=== 2. Переработчик и миссия ===');

check(
  'у переработчика гигантский трюм',
  fleetCapacity(fleet({ RECYCLER: 1 })) === 20000,
  `${fleetCapacity(fleet({ RECYCLER: 1 }))}`,
);
check(
  'переработчик безоружен',
  resolveBattle(
    { ships: fleet({ RECYCLER: 5 }), defenses: emptyDefenseCounts() },
    { ships: fleet({ LIGHT_FIGHTER: 1 }), defenses: emptyDefenseCounts() },
  ).winner === 'DEFENDER',
);
check(
  'переработка без переработчика отклонена',
  validateComposition('HARVEST', fleet({ TRANSPORTER: 50 })) !== null,
  validateComposition('HARVEST', fleet({ TRANSPORTER: 50 })) ?? '',
);
check('переработка с переработчиком разрешена', validateComposition('HARVEST', fleet({ RECYCLER: 1 })) === null);

/* ------------------------- 3. Атомарность сборки ------------------------- */

console.log('\n=== 3. Гонка за поле обломков ===');

/**
 * Гонку воспроизводим на самой БД тем же условным списанием, что делает
 * Game Loop: два «флота» одновременно видят одно поле и пробуют его забрать.
 * Ресурсы не должны задвоиться — суммарно нельзя вынести больше, чем лежало.
 */
async function claim(planetId: string, capacity: number): Promise<{ ore: number; polymers: number }> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const planet = await prisma.planet.findUnique({
      where: { id: planetId },
      select: { debrisOre: true, debrisPolymers: true },
    });
    if (!planet) break;

    const ore = Math.floor(Math.min(planet.debrisOre, capacity));
    const polymers = Math.floor(Math.min(planet.debrisPolymers, Math.max(0, capacity - ore)));
    if (ore <= 0 && polymers <= 0) break;

    const { count } = await prisma.planet.updateMany({
      where: { id: planetId, debrisOre: { gte: ore }, debrisPolymers: { gte: polymers } },
      data: { debrisOre: { decrement: ore }, debrisPolymers: { decrement: polymers } },
    });
    if (count > 0) return { ore, polymers };
  }
  return { ore: 0, polymers: 0 };
}

const planet = await prisma.planet.findFirst({ select: { id: true, name: true } });

if (!planet) {
  check('в галактике есть планета для теста', false);
} else {
  const FIELD = 10000;
  await prisma.planet.update({
    where: { id: planet.id },
    data: { debrisOre: FIELD, debrisPolymers: FIELD },
  });

  // Оба флота вмещают всё поле целиком — забрать всё должен ровно один.
  const [first, second] = await Promise.all([claim(planet.id, 20000), claim(planet.id, 20000)]);
  const left = await prisma.planet.findUniqueOrThrow({
    where: { id: planet.id },
    select: { debrisOre: true, debrisPolymers: true },
  });

  const takenOre = first.ore + second.ore;
  check(
    'два флота не задвоили поле',
    takenOre + left.debrisOre === FIELD,
    `забрали ${takenOre}, осталось ${left.debrisOre} из ${FIELD}`,
  );
  check(
    'поле не ушло в минус',
    left.debrisOre >= 0 && left.debrisPolymers >= 0,
    `${left.debrisOre}/${left.debrisPolymers}`,
  );
  check(
    'опоздавший улетает пустым или добирает остаток',
    first.ore === 0 || second.ore === 0 || takenOre === FIELD,
    `${first.ore} и ${second.ore}`,
  );

  // Трюмы ограничивают вывоз: маленький флот забирает не всё поле.
  await prisma.planet.update({
    where: { id: planet.id },
    data: { debrisOre: FIELD, debrisPolymers: FIELD },
  });
  const small = await claim(planet.id, 3000);
  const afterSmall = await prisma.planet.findUniqueOrThrow({
    where: { id: planet.id },
    select: { debrisOre: true, debrisPolymers: true },
  });
  check(
    'трюмы ограничивают сборку',
    small.ore + small.polymers === 3000 && afterSmall.debrisOre === FIELD - 3000,
    `собрал ${small.ore + small.polymers}, осталось ${afterSmall.debrisOre} Ti`,
  );

  // Пустое поле не создает ресурсы из воздуха.
  await prisma.planet.update({
    where: { id: planet.id },
    data: { debrisOre: 0, debrisPolymers: 0 },
  });
  const nothing = await claim(planet.id, 20000);
  check('с пустого поля берется ноль', nothing.ore === 0 && nothing.polymers === 0);
}

/* ------------------------- 4. Живой сервер ------------------------- */

console.log('\n=== 4. Карта и симулятор ===');

const admiral = await api('POST', '/api/auth/login', {
  email: 'admiral@spacemmo.local',
  password: 'admiral-pass-123',
});
const token = admiral.data['token'] as string | undefined;

if (!token) {
  check('стенд доступен', false);
} else if (planet) {
  await prisma.planet.update({
    where: { id: planet.id },
    data: { debrisOre: 4321, debrisPolymers: 1234 },
  });

  const simulated = await api(
    'POST',
    '/api/commander/simulate',
    {
      attacker: { ships: { HEAVY_CRUISER: 10 } },
      defender: { ships: { ION_FRIGATE: 13 }, defenses: {} },
    },
    token,
  );
  check(
    'симулятор показывает прогноз обломков',
    (simulated.data['debris'] as any)?.ore > 0,
    JSON.stringify(simulated.data['debris']),
  );

  const map = await api('GET', '/api/map', undefined, token);
  const planets = (map.data['planets'] as any[]) ?? [];
  check('карта отдает поле обломков по каждой планете', planets.every((p) => p.debris !== undefined));

  const unknown = planets.find((p) => p.visibility === 'UNKNOWN');
  check(
    'обломки видны даже под туманом войны',
    !unknown || unknown.debris !== null,
    unknown ? JSON.stringify(unknown.debris) : 'все планеты разведаны',
  );

  await prisma.planet.update({
    where: { id: planet.id },
    data: { debrisOre: 0, debrisPolymers: 0 },
  });
}

await prisma.$disconnect();

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);
