/**
 * Пульт гейм-мастера: безопасность и синхронизация с тиком.
 *
 * Главная проверка — обычный игрок не должен попадать в /api/admin/* ни одним
 * методом. Проверяем весь раздел целиком, а не один эндпоинт: защита стоит
 * на роутере, и тест обязан ловить случай, когда новый путь повесили мимо нее.
 *
 * Вторая по важности проверка — выданное не затирается ближайшим тиком:
 * состояние игрока живет в памяти Game Loop и периодически пишется в БД.
 *
 * Запуск: npm run test:admin
 */
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

const ADMIN_EMAIL = 'admiral@spacemmo.local';
const ADMIN_PASSWORD = 'admiral-pass-123';

async function signIn(email: string, password: string): Promise<string | null> {
  const res = await api('POST', '/api/auth/login', { email, password });
  return (res.data['token'] as string) ?? null;
}

const adminToken = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);

const suffix = Date.now().toString(36);
const victimEmail = `commander-${suffix}@spacemmo.local`;
const password = 'admin-test-123';
const registered = await api('POST', '/api/auth/register', { email: victimEmail, password });
const playerToken = registered.data['token'] as string | undefined;
const onboarded = playerToken
  ? await api('POST', '/api/auth/commander', { nickname: `Подопытный-${suffix}`, avatarId: 'nova' }, playerToken)
  : null;

if (!adminToken || !playerToken || onboarded?.status !== 200) {
  check('стенд поднялся: админ и обычный игрок', false, JSON.stringify(onboarded?.data));
} else {
  const victimId = (onboarded.data['commander'] as any).id as string;

  /* ------------------------- 1. Доступ ------------------------- */

  console.log('\n=== 1. Доступ к разделу ===');

  // Весь раздел разом: защита висит на роутере, и ни один путь не должен утечь.
  const guarded: Array<[string, string, unknown]> = [
    ['GET', '/api/admin/schema', undefined],
    ['GET', '/api/admin/commanders', undefined],
    ['GET', `/api/admin/commanders/${victimId}`, undefined],
    ['PATCH', `/api/admin/commanders/${victimId}`, { credits: 999999 }],
  ];

  for (const [method, path, body] of guarded) {
    const anonymous = await api(method, path, body);
    check(`${method} ${path}: аноним получает 401`, anonymous.status === 401, `${anonymous.status}`);

    const player = await api(method, path, body, playerToken);
    check(
      `${method} ${path}: обычный игрок получает 403`,
      player.status === 403,
      JSON.stringify(player.data),
    );
  }

  const forgedRole = await api('GET', '/api/admin/commanders', undefined, playerToken);
  check(
    'отказ не раскрывает содержимое раздела',
    forgedRole.status === 403 && !('commanders' in forgedRole.data),
    JSON.stringify(forgedRole.data),
  );

  const session = await api('GET', '/api/auth/me', undefined, playerToken);
  check(
    'обычный игрок видит у себя роль USER',
    (session.data['user'] as any)?.role === 'USER',
    JSON.stringify((session.data['user'] as any)?.role),
  );

  const adminSession = await api('GET', '/api/auth/me', undefined, adminToken);
  check(
    'администратор видит у себя роль ADMIN',
    (adminSession.data['user'] as any)?.role === 'ADMIN',
  );

  // Роль нельзя выдать себе через игровое API: эндпоинта для этого нет вовсе.
  const selfPromote = await api(
    'PATCH',
    `/api/admin/commanders/${victimId}`,
    { role: 'ADMIN' },
    playerToken,
  );
  check('игрок не может повысить себя до админа', selfPromote.status === 403);

  /* ------------------------- 2. Чтение и правка ------------------------- */

  console.log('\n=== 2. God Mode ===');

  const list = await api('GET', '/api/admin/commanders', undefined, adminToken);
  check('админ получает список командиров', Array.isArray(list.data['commanders']));
  const victimRow = (list.data['commanders'] as any[]).find((c) => c.commanderId === victimId);
  check('в сводке есть колония, баланс и синдикат', Boolean(victimRow) && 'homePlanet' in victimRow);

  const search = await api(
    'GET',
    `/api/admin/commanders?search=${encodeURIComponent(`Подопытный-${suffix}`)}`,
    undefined,
    adminToken,
  );
  check(
    'поиск по позывному сужает список',
    (search.data['commanders'] as any[]).length === 1,
    `${(search.data['commanders'] as any[]).length}`,
  );

  const detail = await api('GET', `/api/admin/commanders/${victimId}`, undefined, adminToken);
  const base = (detail.data['bases'] as any[])[0];
  check('детальный стейт содержит базы, технологии и флот', Boolean(base?.buildings && base?.ships));

  const missing = await api('GET', '/api/admin/commanders/no-such-id', undefined, adminToken);
  check('несуществующий командир дает 404', missing.status === 404);

  const patched = await api(
    'PATCH',
    `/api/admin/commanders/${victimId}`,
    {
      credits: 555000,
      technologies: { MINING_TECH: 7 },
      bases: [
        {
          baseId: base.baseId,
          resources: { ore: 99000, plasma: 4000 },
          buildings: { SHIPYARD: 9 },
          ships: { HEAVY_CRUISER: 12 },
          defenses: { LASER_TURRET: 5 },
        },
      ],
    },
    adminToken,
  );
  check('правка применена', patched.status === 200, JSON.stringify(patched.data));

  const after = await api('GET', `/api/admin/commanders/${victimId}`, undefined, adminToken);
  const afterBase = (after.data['bases'] as any[])[0];
  check('криптогривна выставлена', after.data['credits'] === 555000, `${after.data['credits']}`);
  check('технология выставлена', (after.data['technologies'] as any).MINING_TECH === 7);
  check(
    'ресурсы, здания, корабли и оборона выставлены',
    afterBase.resources.ore === 99000 &&
      afterBase.resources.plasma === 4000 &&
      afterBase.buildings.SHIPYARD === 9 &&
      afterBase.ships.HEAVY_CRUISER === 12 &&
      afterBase.defenses.LASER_TURRET === 5,
    JSON.stringify({ res: afterBase.resources.ore, ship: afterBase.ships.HEAVY_CRUISER }),
  );

  /* ------------------------- 3. Синхронизация с тиком ------------------------- */

  console.log('\n=== 3. Синхронизация с Game Loop ===');

  // Держим игрока в памяти тика, потом правим и ждем сброса состояния в БД.
  await api('GET', '/api/state', undefined, playerToken);
  const forced = await api(
    'PATCH',
    `/api/admin/commanders/${victimId}`,
    { bases: [{ baseId: base.baseId, resources: { ore: 777000 } }] },
    adminToken,
  );
  check('правка онлайн-игрока принята', forced.status === 200);

  const immediately = await api('GET', '/api/state', undefined, playerToken);
  check(
    'игрок сразу видит новое значение',
    Math.round((immediately.data['bases'] as any[])[0].resources.ore) === 777000,
    `${Math.round((immediately.data['bases'] as any[])[0].resources.ore)}`,
  );

  // Тик пишет состояние в БД пачкой раз в несколько секунд: если бы выгрузки
  // из памяти не было, здесь всплыло бы старое значение.
  await new Promise((resolve) => setTimeout(resolve, 13000));
  const afterTicks = await api('GET', `/api/admin/commanders/${victimId}`, undefined, adminToken);
  const value = Math.round((afterTicks.data['bases'] as any[])[0].resources.ore);
  check(
    'через десяток тиков выданное не затерто',
    value >= 777000,
    `${value} (могло вырасти от добычи, но не откатиться)`,
  );

  /* ------------------------- 4. Валидация ------------------------- */

  console.log('\n=== 4. Валидация ===');

  const cases: Array<[string, unknown]> = [
    ['отрицательные ресурсы', { bases: [{ baseId: base.baseId, resources: { ore: -5 } }] }],
    ['дробные корабли', { bases: [{ baseId: base.baseId, ships: { HEAVY_CRUISER: 1.5 } }] }],
    ['неизвестный тип корабля', { bases: [{ baseId: base.baseId, ships: { DEATH_STAR: 1 } }] }],
    ['неизвестное здание', { bases: [{ baseId: base.baseId, buildings: { CASINO: 1 } }] }],
    ['неизвестная технология', { technologies: { WARP_DRIVE: 1 } }],
    ['запредельный уровень', { bases: [{ baseId: base.baseId, buildings: { SHIPYARD: 9999 } }] }],
    ['нечисловое значение', { credits: 'много' }],
    // JSON сериализует Infinity как null, а Number(null) — это ноль:
    // без явной проверки такой патч молча обнулил бы счет игрока.
    ['Infinity (доезжает как null)', { credits: Number.MAX_VALUE * 2 }],
    ['null', { credits: null }],
    ['пустая строка', { credits: '' }],
    ['пустой массив', { bases: [{ baseId: base.baseId, resources: { ore: [] } }] }],
    ['NaN-строка', { bases: [{ baseId: base.baseId, ships: { HEAVY_CRUISER: 'abc' } }] }],
  ];

  for (const [label, body] of cases) {
    const res = await api('PATCH', `/api/admin/commanders/${victimId}`, body, adminToken);
    check(`${label} отклонены`, res.status === 400, `${res.status}`);
  }

  const foreignBase = await api(
    'PATCH',
    `/api/admin/commanders/${victimId}`,
    { bases: [{ baseId: 'not-his-base', resources: { ore: 1 } }] },
    adminToken,
  );
  check(
    'чужую базу через профиль игрока не поправить',
    foreignBase.status === 400,
    JSON.stringify(foreignBase.data),
  );

  const empty = await api('PATCH', `/api/admin/commanders/${victimId}`, {}, adminToken);
  check('пустой патч отклонен', empty.status === 400, JSON.stringify(empty.data));
}

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);
