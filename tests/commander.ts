/**
 * Инструменты командира: боевой симулятор, шаблоны флотов и старение разведданных.
 * Плюс логистика трития — он теперь возится в трюмах, а не только жжется как топливо.
 *
 * Чистые формулы проверяются прямо на игровых модулях, симулятор и шаблоны —
 * по живому API: у них есть и валидация, и права доступа.
 *
 * Запуск: npm run test:commander
 */
import { foreignPlanetView, scanFreshness, type ScanPayload } from '../src/game/fogOfWar.js';
import { fleetCapacity, validateCargo } from '../src/game/fleets.js';
import { emptyShipCounts, type ShipCounts } from '../src/game/ships.js';

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

/* ------------------------- 1. Тритий в трюмах ------------------------- */

console.log('\n=== 1. Тритий возится в трюмах ===');

{
  const ships = fleet({ TRANSPORTER: 1 });
  const capacity = fleetCapacity(ships);

  check(
    'тритий занимает трюм наравне с титанитом и силикатами',
    validateCargo(ships, { titanite: 0, silicate: 0, tritium: capacity }) === null,
    `трюм ${capacity}`,
  );
  check(
    'перегруз одним тритием отклоняется',
    validateCargo(ships, { titanite: 0, silicate: 0, tritium: capacity + 1 }) !== null,
  );
  check(
    'три ресурса делят один трюм, а не три отдельных',
    validateCargo(ships, {
      titanite: capacity / 2,
      silicate: capacity / 2,
      tritium: 1,
    }) !== null,
    'половина + половина + 1 уже перегруз',
  );
  check(
    'отрицательный тритий отклоняется',
    validateCargo(ships, { titanite: 0, silicate: 0, tritium: -1 }) !== null,
  );
}

/* ------------------------- 2. Старение разведданных ------------------------- */

console.log('\n=== 2. Старение разведданных ===');

const HOUR = 3600;
const DAY = 24 * HOUR;

check('до часа данные свежие', scanFreshness(0) === 'FRESH' && scanFreshness(HOUR - 1) === 'FRESH');
check(
  'от часа до суток — данные неточны',
  scanFreshness(HOUR) === 'STALE' && scanFreshness(DAY - 1) === 'STALE',
);
check(
  'после суток данные устарели',
  scanFreshness(DAY) === 'OUTDATED' && scanFreshness(DAY * 10) === 'OUTDATED',
);

{
  const payload: ScanPayload = {
    owner: 'Противник',
    colonized: true,
    richness: { titanite: 1, silicate: 1, tritium: 1, energy: 1, eridium: 1 },
    buildings: {
      TITANITE_MINE: 12,
      SILICATE_MINE: 8,
      TRITIUM_MINE: 6,
      SOLAR_PLANT: 14,
      RESEARCH_LAB: 4,
      SHIPYARD: 5,
      ERIDIUM_SYNTH: 1,
      STORAGE: 3,
    },
    resources: { titanite: 5000, silicate: 3000, tritium: 1000, eridium: 10 },
    fleet: fleet({ HEAVY_CRUISER: 20 }),
    defenses: { ROCKET_LAUNCHER: 10, LASER_TURRET: 5 },
  };
  const facts = { planetId: 'p1', name: 'Цель', position: 3, type: 'ROCKY', size: 150 };
  const now = Date.now();
  const view = (ageSeconds: number) =>
    foreignPlanetView(facts, { data: payload, scannedAt: new Date(now - ageSeconds * 1000) }, now);

  const fresh = view(10 * 60);
  check(
    'свежий снимок отдает флот, оборону и склад',
    fresh.freshness === 'FRESH' && !fresh.staleHidden && fresh.fleet !== null && fresh.resources !== null,
  );

  const stale = view(5 * HOUR);
  check(
    'снимок в пределах суток еще показывает цифры',
    stale.freshness === 'STALE' && !stale.staleHidden && stale.fleet !== null,
    `возраст ${stale.scanAgeSeconds} с`,
  );

  const outdated = view(2 * DAY);
  check(
    'после суток флот и склад скрыты сервером, а не только в интерфейсе',
    outdated.staleHidden && outdated.fleet === null && outdated.resources === null && outdated.defenses === null,
  );
  check(
    'уровни построек остаются: здания за сутки не разбирают',
    outdated.buildings !== null && outdated.buildings.TITANITE_MINE === 12,
    `шахта ур.${outdated.buildings?.TITANITE_MINE}`,
  );
  check(
    'владелец и богатство планеты остаются известны',
    outdated.owner === 'Противник' && outdated.richness !== null,
  );
}

{
  // Снимки, снятые до появления новых классов, не должны отдавать undefined.
  const legacy = {
    owner: 'Ветеран',
    colonized: true,
    richness: { titanite: 1, silicate: 1, tritium: 1 },
    buildings: null,
    resources: null,
    fleet: { PROBE: 1, TRANSPORTER: 2, LIGHT_FIGHTER: 3 },
  } as unknown as ScanPayload;

  const view = foreignPlanetView(
    { planetId: 'p2', name: 'Старый снимок', position: 1, type: 'ICE', size: 100 },
    { data: legacy, scannedAt: new Date(Date.now() - 60_000) },
    Date.now(),
  );

  check(
    'старый снимок дополняется нулями, а не undefined',
    view.fleet?.HEAVY_CRUISER === 0 && view.fleet?.ION_FRIGATE === 0,
    JSON.stringify(view.fleet),
  );
  check(
    'богатство старого снимка тоже дополняется',
    view.richness?.eridium === 0 && view.richness?.energy === 0,
  );
}

/* ------------------------- 3. Живой сервер ------------------------- */

console.log('\n=== 3. Симулятор и шаблоны по API ===');

const suffix = Date.now().toString(36);
const email = `commander-${suffix}@spacemmo.local`;
const password = 'commander-pass-123';

const registered = await api('POST', '/api/auth/register', { email, password });
const token = registered.data['token'] as string | undefined;

if (!token) {
  check('сервер доступен и принимает регистрацию', false, JSON.stringify(registered.data));
} else {
  const noCommander = await api('POST', '/api/commander/simulate', {}, token);
  check(
    'без командира инструменты закрыты',
    noCommander.status === 409,
    JSON.stringify(noCommander.data),
  );

  const onboarded = await api(
    'POST',
    '/api/auth/commander',
    { nickname: `Штабист-${suffix}`, avatarId: 'nova' },
    token,
  );
  check('командир создан', onboarded.status === 200, JSON.stringify(onboarded.data));

  /* --- Симулятор --- */

  const anonymous = await api('POST', '/api/commander/simulate', {});
  check('симулятор требует авторизации', anonymous.status === 401);

  const emptyFleet = await api(
    'POST',
    '/api/commander/simulate',
    { attacker: { ships: {} }, defender: { ships: {} } },
    token,
  );
  check('пустой атакующий флот отклонен', emptyFleet.status === 400, JSON.stringify(emptyFleet.data));

  const fractional = await api(
    'POST',
    '/api/commander/simulate',
    { attacker: { ships: { LIGHT_FIGHTER: 1.5 } }, defender: { ships: {} } },
    token,
  );
  check('дробный состав отклонен', fractional.status === 400);

  const unknownDefense = await api(
    'POST',
    '/api/commander/simulate',
    { attacker: { ships: { LIGHT_FIGHTER: 1 } }, defender: { ships: {}, defenses: { DEATH_STAR: 1 } } },
    token,
  );
  check('неизвестный тип обороны отклонен', unknownDefense.status === 400);

  const win = await api(
    'POST',
    '/api/commander/simulate',
    {
      attacker: { ships: { HEAVY_CRUISER: 50, TRANSPORTER: 20 } },
      defender: { ships: { LIGHT_FIGHTER: 1 }, defenses: {} },
    },
    token,
  );
  check('явный перевес дает победу атакующему', win.data['attackerWins'] === true, JSON.stringify(win.data['winner']));
  check(
    'отчет содержит разбор урона по слоям',
    Boolean(win.data['attackerDamageReport']) && Boolean(win.data['defenderDamageReport']),
  );

  const loss = await api(
    'POST',
    '/api/commander/simulate',
    {
      attacker: { ships: { LIGHT_FIGHTER: 1 } },
      defender: { ships: { HEAVY_CRUISER: 50 }, defenses: { LASER_TURRET: 20 } },
    },
    token,
  );
  check('безнадежная атака проигрывает', loss.data['attackerWins'] === false);
  check('у проигравшего добычи нет', loss.data['plunder'] === null);

  // Симулятор детерминирован ровно как боевой модуль.
  const repeat = await api(
    'POST',
    '/api/commander/simulate',
    {
      attacker: { ships: { HEAVY_CRUISER: 10 } },
      defender: { ships: { ION_FRIGATE: 13 }, defenses: {} },
    },
    token,
  );
  const repeatAgain = await api(
    'POST',
    '/api/commander/simulate',
    {
      attacker: { ships: { HEAVY_CRUISER: 10 } },
      defender: { ships: { ION_FRIGATE: 13 }, defenses: {} },
    },
    token,
  );
  check(
    'повторный прогон дает тот же результат',
    JSON.stringify(repeat.data) === JSON.stringify(repeatAgain.data),
  );

  const withStock = await api(
    'POST',
    '/api/commander/simulate',
    {
      attacker: { ships: { HEAVY_CRUISER: 50, TRANSPORTER: 20 } },
      defender: {
        ships: { LIGHT_FIGHTER: 1 },
        defenses: {},
        stock: { titanite: 12000, silicate: 8000, tritium: 0, storageLevel: 1 },
      },
    },
    token,
  );
  const plunder = withStock.data['plunder'];
  check(
    'добыча считается по механике сейфа',
    plunder && plunder.protectedAmount === 9000 && plunder.surplus === 11000,
    JSON.stringify(plunder),
  );

  /* --- Шаблоны флотов --- */

  const emptyTemplate = await api(
    'POST',
    '/api/commander/fleet-templates',
    { name: 'Пустышка', ships: {} },
    token,
  );
  check('шаблон без кораблей отклонен', emptyTemplate.status === 400, JSON.stringify(emptyTemplate.data));

  const shortName = await api(
    'POST',
    '/api/commander/fleet-templates',
    { name: 'A', ships: { PROBE: 1 } },
    token,
  );
  check('слишком короткое название отклонено', shortName.status === 400);

  const created = await api(
    'POST',
    '/api/commander/fleet-templates',
    { name: 'Фарм-отряд', ships: { HEAVY_CRUISER: 10, TRANSPORTER: 5 } },
    token,
  );
  check('шаблон создан', created.status === 200, JSON.stringify(created.data));

  const duplicate = await api(
    'POST',
    '/api/commander/fleet-templates',
    { name: 'Фарм-отряд', ships: { PROBE: 1 } },
    token,
  );
  check('дубль названия отклонен', duplicate.status === 409);

  const listed = await api('GET', '/api/commander/fleet-templates', undefined, token);
  const saved = ((listed.data['templates'] as any[]) ?? [])[0];
  if (!saved) {
    check('список шаблонов доступен', false, JSON.stringify(listed.data));
    reportAndExit();
  }
  check(
    'шаблон отдается с полным составом и размером',
    saved?.ships?.HEAVY_CRUISER === 10 && saved?.ships?.PROBE === 0 && saved?.size === 15,
    JSON.stringify(saved?.ships),
  );

  const updated = await api(
    'PUT',
    `/api/commander/fleet-templates/${saved.id}`,
    { name: 'Фарм-отряд II', ships: { HEAVY_CRUISER: 20 } },
    token,
  );
  check('шаблон обновлен', updated.status === 200, JSON.stringify(updated.data));

  // Чужой шаблон не должен быть доступен даже по прямому id.
  const strangerEmail = `stranger-${suffix}@spacemmo.local`;
  const stranger = await api('POST', '/api/auth/register', { email: strangerEmail, password }, undefined);
  const strangerToken = stranger.data['token'] as string;
  await api('POST', '/api/auth/commander', { nickname: `Чужак-${suffix}`, avatarId: 'nova' }, strangerToken);

  const foreignEdit = await api(
    'PUT',
    `/api/commander/fleet-templates/${saved.id}`,
    { name: 'Захвачено', ships: { PROBE: 1 } },
    strangerToken,
  );
  check('чужой шаблон нельзя править', foreignEdit.status === 404, JSON.stringify(foreignEdit.data));

  const foreignDelete = await api(
    'DELETE',
    `/api/commander/fleet-templates/${saved.id}`,
    undefined,
    strangerToken,
  );
  check('чужой шаблон нельзя удалить', foreignDelete.status === 404);

  const strangerList = await api('GET', '/api/commander/fleet-templates', undefined, strangerToken);
  check('чужие шаблоны не видны в списке', (strangerList.data['templates'] as any[]).length === 0);

  const removed = await api(
    'DELETE',
    `/api/commander/fleet-templates/${saved.id}`,
    undefined,
    token,
  );
  check('свой шаблон удаляется', removed.status === 200);

  const afterDelete = await api('GET', '/api/commander/fleet-templates', undefined, token);
  check('после удаления список пуст', (afterDelete.data['templates'] as any[]).length === 0);

  /* --- Разведданные --- */

  const espionage = await api('GET', '/api/commander/espionage', undefined, token);
  check(
    'разведданные отдаются списком',
    Array.isArray(espionage.data['targets']),
    `целей ${(espionage.data['targets'] as any[])?.length}`,
  );
}

/* ------------------------- Итог ------------------------- */

reportAndExit();

function reportAndExit(): never {
  const passed = results.filter((item) => item.passed).length;
  console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
  process.exit(passed === results.length ? 0 : 1);
}
