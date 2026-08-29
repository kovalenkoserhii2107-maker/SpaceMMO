import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(process.argv[2], 'utf8'));

/** Тесты сами проходят авторизацию: сессия теперь JWT, а не токен из БД. */
async function signIn(email, password) {
  const res = await fetch('http://localhost:3000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.token) throw new Error(`Не удалось войти как ${email}: ${JSON.stringify(data)}`);
  return data.token;
}

const ids = {
  ...config,
  admiralToken: await signIn(config.admiralEmail, config.admiralPassword),
  pilotToken: await signIn(config.pilotEmail, config.pilotPassword),
};
const BASE_URL = 'http://localhost:3000';

const H = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

async function api(method, path, token, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: H(token),
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data };
}

const results = [];
function check(name, passed, detail) {
  results.push({ name, passed, detail });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

async function market(token) { return (await api('GET', '/api/market', token)).data; }
async function state(token) { return (await api('GET', '/api/state', token)).data; }

/* ---------- 1. Валидация биржи ---------- */
async function testOrderValidation() {
  const bad = [
    ['отрицательный объем продажи', { side: 'SELL', resource: 'METAL', quantity: -100, pricePerUnit: 2 }],
    ['отрицательный объем покупки', { side: 'BUY', resource: 'METAL', quantity: -100, pricePerUnit: 2 }],
    ['отрицательная цена', { side: 'SELL', resource: 'METAL', quantity: 100, pricePerUnit: -5 }],
    ['нулевой объем', { side: 'SELL', resource: 'METAL', quantity: 0, pricePerUnit: 2 }],
    ['нулевая цена', { side: 'SELL', resource: 'METAL', quantity: 100, pricePerUnit: 0 }],
    ['текст вместо объема', { side: 'SELL', resource: 'METAL', quantity: 'сто', pricePerUnit: 2 }],
    ['Infinity в цене', { side: 'BUY', resource: 'METAL', quantity: 10, pricePerUnit: 1e400 }],
    ['объем больше лимита', { side: 'SELL', resource: 'METAL', quantity: 1e12, pricePerUnit: 1 }],
    ['покупка сверх баланса', { side: 'BUY', resource: 'METAL', quantity: 100000, pricePerUnit: 99 }],
    ['неизвестный ресурс', { side: 'SELL', resource: 'DEUTERIUM', quantity: 10, pricePerUnit: 1 }],
    ['неизвестная сторона', { side: 'STEAL', resource: 'METAL', quantity: 10, pricePerUnit: 1 }],
  ];

  const before = await market(ids.admiralToken);
  for (const [name, body] of bad) {
    const res = await api('POST', '/api/market/orders', ids.admiralToken, body);
    check(`ордер отклонен: ${name}`, res.status >= 400, `HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }
  const after = await market(ids.admiralToken);
  check(
    'баланс и склад не изменились после атак на ордера',
    before.credits === after.credits &&
      before.storage.metal === after.storage.metal &&
      before.storage.crystal === after.storage.crystal,
    `${before.credits}/${before.storage.metal} -> ${after.credits}/${after.storage.metal}`,
  );
}

/* ---------- 2. Валидация исполнения ---------- */
async function testFillValidation() {
  const created = await api('POST', '/api/market/orders', ids.pilotToken, {
    side: 'SELL', resource: 'METAL', quantity: 100, pricePerUnit: 2,
  });
  check('ордер для теста исполнения создан', created.status === 200, JSON.stringify(created.data));

  const book = await market(ids.admiralToken);
  const order = book.book.METAL.sell.find((o) => !o.mine);
  if (!order) { check('ордер найден в стакане', false); return null; }

  const beforeMe = await market(ids.admiralToken);
  const beforeThem = await market(ids.pilotToken);

  for (const [name, quantity] of [
    ['отрицательный объем сделки', -50],
    ['нулевой объем сделки', 0],
    ['текст вместо объема', 'много'],
    ['Infinity', Infinity],
  ]) {
    const res = await api('POST', `/api/market/orders/${order.id}/fill`, ids.admiralToken, { quantity });
    check(`сделка отклонена: ${name}`, res.status >= 400, `HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }

  const afterMe = await market(ids.admiralToken);
  const afterThem = await market(ids.pilotToken);
  check(
    'балансы обеих сторон не поехали после атак на сделку',
    beforeMe.credits === afterMe.credits && beforeThem.credits === afterThem.credits &&
      beforeMe.storage.metal === afterMe.storage.metal && beforeThem.storage.metal === afterThem.storage.metal,
    `me ${beforeMe.credits}->${afterMe.credits}, them ${beforeThem.credits}->${afterThem.credits}`,
  );

  return order;
}

/* ---------- 3. Гонка: одновременный выкуп одного остатка ---------- */
async function testRace() {
  // Новый ордер ровно на 100 единиц.
  await api('POST', '/api/market/orders', ids.pilotToken, {
    side: 'SELL', resource: 'METAL', quantity: 100, pricePerUnit: 2,
  });
  const book = await market(ids.admiralToken);
  const order = book.book.METAL.sell.filter((o) => !o.mine).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!order) { check('ордер для гонки создан', false); return; }

  const beforeBuyer = await market(ids.admiralToken);
  const beforeSeller = await market(ids.pilotToken);

  // 8 параллельных попыток выкупить весь остаток.
  const attempts = await Promise.all(
    Array.from({ length: 8 }, () =>
      api('POST', `/api/market/orders/${order.id}/fill`, ids.admiralToken, { quantity: 100 })),
  );
  const ok = attempts.filter((a) => a.status === 200);

  const afterBuyer = await market(ids.admiralToken);
  const afterSeller = await market(ids.pilotToken);

  const metalGained = afterBuyer.storage.metal - beforeBuyer.storage.metal;
  const metalLost = beforeSeller.storage.metal - afterSeller.storage.metal;
  const creditsPaid = beforeBuyer.credits - afterBuyer.credits;
  const creditsEarned = afterSeller.credits - beforeSeller.credits;

  check(
    'гонка: получено ровно 100 металла, не больше',
    metalGained === 100,
    `успешных ответов ${ok.length}, получено ${metalGained}`,
  );
  check(
    'гонка: деньги и товар сходятся (нет фантомных сделок)',
    creditsPaid === 200 && creditsEarned === 200 && metalLost === 0,
    `оплачено ${creditsPaid} ₴, получено продавцом ${creditsEarned} ₴, списано у продавца сверх залога ${metalLost}`,
  );

  const leftover = (await market(ids.admiralToken)).book.METAL.sell.find((o) => o.id === order.id);
  check('гонка: ордер исчерпан', !leftover, leftover ? `остаток ${leftover.remaining}` : 'ордера нет');
}

/* ---------- 4. Гонка: параллельные ордера сверх запаса ---------- */
async function testEscrowRace() {
  const before = await market(ids.pilotToken);
  const available = before.storage.metal;

  // 6 параллельных ордеров, каждый на весь доступный металл.
  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      api('POST', '/api/market/orders', ids.pilotToken, {
        side: 'SELL', resource: 'METAL', quantity: available, pricePerUnit: 3,
      })),
  );
  const ok = attempts.filter((a) => a.status === 200).length;
  const after = await market(ids.pilotToken);

  check(
    'гонка залога: нельзя заблокировать больше, чем лежит на складе',
    after.storage.metal >= 0 && ok * available <= available + 0.001,
    `успешных ордеров ${ok} по ${available}, на складе осталось ${after.storage.metal}`,
  );

  // Убираем за собой.
  const mine = (await market(ids.pilotToken)).myOrders;
  for (const order of mine) await api('DELETE', `/api/market/orders/${order.id}`, ids.pilotToken);
}

/* ---------- 5. Гонка: параллельная трата криптогривны ---------- */
async function testCreditRace() {
  const before = await market(ids.pilotToken);
  const budget = before.credits;
  const quantity = Math.floor(budget / 2);

  const attempts = await Promise.all(
    Array.from({ length: 6 }, () =>
      api('POST', '/api/market/orders', ids.pilotToken, {
        side: 'BUY', resource: 'CRYSTAL', quantity, pricePerUnit: 1,
      })),
  );
  const ok = attempts.filter((a) => a.status === 200).length;
  const after = await market(ids.pilotToken);

  check(
    'гонка баланса: криптогривна не уходит в минус',
    after.credits >= 0 && ok * quantity <= budget + 0.001,
    `успешных ордеров ${ok} по ${quantity} ₴, баланс ${before.credits} -> ${after.credits}`,
  );

  const mine = (await market(ids.pilotToken)).myOrders;
  for (const order of mine) await api('DELETE', `/api/market/orders/${order.id}`, ids.pilotToken);
}

/* ---------- 6. Логистические аномалии ---------- */
async function testFleetValidation() {
  const before = await state(ids.admiralToken);
  const base = before.bases[0];

  const bad = [
    ['нулевой флот с грузом', { targetHubId: ids.hubId, mission: 'HUB_DELIVERY', ships: {}, cargo: { metal: 1000, crystal: 1000 } }],
    ['отрицательный груз', { targetHubId: ids.hubId, mission: 'HUB_DELIVERY', ships: { TRANSPORTER: 1 }, cargo: { metal: -5000, crystal: -5000 } }],
    ['отрицательные корабли', { targetHubId: ids.hubId, mission: 'HUB_DELIVERY', ships: { TRANSPORTER: -3 }, cargo: { metal: 0, crystal: 0 } }],
    ['дробные корабли', { targetHubId: ids.hubId, mission: 'HUB_DELIVERY', ships: { TRANSPORTER: 1.7 }, cargo: { metal: 10, crystal: 0 } }],
    ['груз больше склада планеты', { targetHubId: ids.hubId, mission: 'HUB_DELIVERY', ships: { TRANSPORTER: 4 }, cargo: { metal: 999999, crystal: 0 } }],
    ['вывоз с отрицательным объемом', { targetHubId: ids.hubId, mission: 'HUB_PICKUP', ships: { TRANSPORTER: 1 }, pickup: { metal: -1000, crystal: -1000 } }],
    ['зонды без трюмов на хаб', { targetHubId: ids.hubId, mission: 'HUB_DELIVERY', ships: { PROBE: 1 }, cargo: { metal: 0, crystal: 0 } }],
    ['неизвестная миссия', { targetHubId: ids.hubId, mission: 'PLUNDER', ships: { TRANSPORTER: 1 }, cargo: {} }],
    ['полет в никуда', { mission: 'TRANSPORT', ships: { TRANSPORTER: 1 }, cargo: {} }],
  ];

  for (const [name, body] of bad) {
    const res = await api('POST', `/api/bases/${ids.admiralBase}/fleets`, ids.admiralToken, body);
    check(`вылет отклонен: ${name}`, res.status >= 400, `HTTP ${res.status} ${JSON.stringify(res.data)}`);
  }

  const after = await state(ids.admiralToken);
  const afterBase = after.bases[0];
  check(
    'ресурсы и ангар не пострадали от аномальных вылетов',
    afterBase.fleet.TRANSPORTER === base.fleet.TRANSPORTER &&
      afterBase.resources.metal >= base.resources.metal - 1 &&
      afterBase.resources.crystal >= base.resources.crystal - 1,
    `транспорты ${base.fleet.TRANSPORTER} -> ${afterBase.fleet.TRANSPORTER}`,
  );
  check(
    'флотов в полете не появилось',
    after.fleets.length === before.fleets.length,
    `${before.fleets.length} -> ${after.fleets.length}`,
  );
}

/* ---------- 7. Бой и дипломатия ---------- */
async function testCombatGuards() {
  const mine = await state(ids.admiralToken);
  const myPlanet = mine.bases[0].planetId;
  const map = (await api('GET', '/api/map', ids.admiralToken)).data;
  const enemy = map.planets.find((p) => !p.isOwn);

  const attack = (body) => api('POST', `/api/bases/${ids.admiralBase}/fleets`, ids.admiralToken, body);

  const self = await attack({ targetPlanetId: myPlanet, mission: 'ATTACK', ships: { LIGHT_FIGHTER: 1 }, cargo: {} });
  check('атака собственной планеты отклонена', self.status >= 400, JSON.stringify(self.data));

  const probes = await attack({ targetPlanetId: enemy.planetId, mission: 'ATTACK', ships: { PROBE: 2 }, cargo: {} });
  check('атака одними зондами отклонена', probes.status >= 400, JSON.stringify(probes.data));

  // Убеждаемся, что войны нет, и проверяем запрет атаки.
  const diplomacy = (await api('GET', '/api/war', ids.admiralToken)).data;
  const target = diplomacy.players.find((p) => p.planetName === enemy.name);
  if (target?.atWar) {
    await api('POST', '/api/war/peace', ids.admiralToken, { targetId: target.commanderId });
  }

  const noWar = await attack({ targetPlanetId: enemy.planetId, mission: 'ATTACK', ships: { LIGHT_FIGHTER: 1 }, cargo: {} });
  check('атака без объявления войны отклонена', noWar.status >= 400, JSON.stringify(noWar.data));

  const myId = mine.commander.id;
  const selfWar = await api('POST', '/api/war/declare', ids.admiralToken, { targetId: myId });
  check('война самому себе отклонена', selfWar.status >= 400, JSON.stringify(selfWar.data));

  const badTarget = await api('POST', '/api/war/declare', ids.admiralToken, { targetId: 'нет-такого' });
  check('война несуществующему игроку отклонена', badTarget.status >= 400, JSON.stringify(badTarget.data));

  const badDefense = await api('POST', `/api/bases/${ids.admiralBase}/defenses`, ids.admiralToken, { type: 'DEATH_RAY', quantity: 1 });
  check('неизвестный тип обороны отклонен', badDefense.status >= 400, JSON.stringify(badDefense.data));

  const negDefense = await api('POST', `/api/bases/${ids.admiralBase}/defenses`, ids.admiralToken, { type: 'ROCKET_LAUNCHER', quantity: -5 });
  check('отрицательный заказ обороны отклонен', negDefense.status >= 400, JSON.stringify(negDefense.data));
}

/* ---------- 8. Экспедиции ---------- */
async function testExpeditionGuards() {
  // У пилота астрофизики нет — экспедиция должна отклоняться.
  const noTech = await api('POST', `/api/bases/${ids.pilotBase}/fleets`, ids.pilotToken, {
    mission: 'EXPEDITION', ships: { TRANSPORTER: 1 }, cargo: {},
  });
  check('экспедиция без «Астрофизики» отклонена', noTech.status >= 400, JSON.stringify(noTech.data));

  const probesOnly = await api('POST', `/api/bases/${ids.admiralBase}/fleets`, ids.admiralToken, {
    mission: 'EXPEDITION', ships: { PROBE: 2 }, cargo: {},
  });
  check('экспедиция одними зондами отклонена', probesOnly.status >= 400, JSON.stringify(probesOnly.data));

  const empty = await api('POST', `/api/bases/${ids.admiralBase}/fleets`, ids.admiralToken, {
    mission: 'EXPEDITION', ships: {}, cargo: {},
  });
  check('экспедиция без кораблей отклонена', empty.status >= 400, JSON.stringify(empty.data));

  const negative = await api('POST', `/api/bases/${ids.admiralBase}/fleets`, ids.admiralToken, {
    mission: 'EXPEDITION', ships: { TRANSPORTER: -2 }, cargo: {},
  });
  check('экспедиция с отрицательным флотом отклонена', negative.status >= 400, JSON.stringify(negative.data));

  const diplomacy = (await api('GET', '/api/war', ids.admiralToken)).data;
  check(
    'API отдает лимит экспедиционных слотов',
    typeof diplomacy.expeditionSlots?.total === 'number' && Array.isArray(diplomacy.expeditions),
    `слоты ${JSON.stringify(diplomacy.expeditionSlots)}`,
  );
}

/* ---------- 9. Классы кораблей и типы урона ---------- */
async function testCombatClasses() {
  const mine = await state(ids.admiralToken);
  const base = mine.bases[0];
  const byType = Object.fromEntries(base.ships.map((s) => [s.type, s]));

  check(
    'новые классы доступны на верфи',
    Boolean(byType.HEAVY_CRUISER && byType.ION_FRIGATE),
    Object.keys(byType).join(', '),
  );

  check(
    'у крейсера кинетический урон и броня',
    byType.HEAVY_CRUISER?.combat?.damageType === 'KINETIC' && byType.HEAVY_CRUISER?.combat?.armor > 0,
    JSON.stringify(byType.HEAVY_CRUISER?.combat),
  );
  check(
    'у ионного фрегата ионный урон и щиты',
    byType.ION_FRIGATE?.combat?.damageType === 'ION' && byType.ION_FRIGATE?.combat?.shield > 0,
    JSON.stringify(byType.ION_FRIGATE?.combat),
  );
  check(
    'истребитель лазерный и без щитов с броней',
    byType.LIGHT_FIGHTER?.combat?.damageType === 'LASER' &&
      byType.LIGHT_FIGHTER?.combat?.shield === 0 &&
      byType.LIGHT_FIGHTER?.combat?.armor === 0,
    JSON.stringify(byType.LIGHT_FIGHTER?.combat),
  );
  check(
    'транспорт и зонд без оружия',
    byType.TRANSPORTER?.combat?.damage === 0 && byType.PROBE?.combat?.damage === 0,
  );

  const defenses = Object.fromEntries(base.defenseCards.map((d) => [d.type, d]));
  check(
    'ракетная установка кинетическая, лазерное орудие со щитами',
    defenses.ROCKET_LAUNCHER?.combat?.damageType === 'KINETIC' &&
      defenses.LASER_TURRET?.combat?.damageType === 'LASER' &&
      defenses.LASER_TURRET?.combat?.shield > 0,
    JSON.stringify(defenses.LASER_TURRET?.combat),
  );

  const map = (await api('GET', '/api/map', ids.admiralToken)).data;
  const enemy = map.planets.find((p) => !p.isOwn);
  const unarmed = await api('POST', `/api/bases/${ids.admiralBase}/fleets`, ids.admiralToken, {
    targetPlanetId: enemy.planetId, mission: 'ATTACK', ships: { TRANSPORTER: 1 }, cargo: {},
  });
  check(
    'атака безоружным флотом отклонена',
    unarmed.status >= 400 && /вооруженный/.test(unarmed.data.error || ''),
    JSON.stringify(unarmed.data),
  );
}

async function main() {
  console.log('=== 1. Валидация ордеров ===');
  await testOrderValidation();
  console.log('\n=== 2. Валидация сделок ===');
  await testFillValidation();
  console.log('\n=== 3. Гонка: двойной выкуп остатка ===');
  await testRace();
  console.log('\n=== 4. Гонка: залог товара ===');
  await testEscrowRace();
  console.log('\n=== 5. Гонка: залог криптогривны ===');
  await testCreditRace();
  console.log('\n=== 6. Логистические аномалии ===');
  await testFleetValidation();
  console.log('\n=== 7. Бой и дипломатия ===');
  await testCombatGuards();
  console.log('\n=== 8. Экспедиции ===');
  await testExpeditionGuards();
  console.log('\n=== 9. Классы кораблей и типы урона ===');
  await testCombatClasses();

  const failed = results.filter((r) => !r.passed);
  console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
  for (const f of failed) console.log(`  СЛОМАНО: ${f.name} :: ${f.detail}`);
}

await main();
