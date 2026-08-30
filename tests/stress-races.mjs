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
const H = (t) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${t}` });

async function api(method, path, token, body) {
  const res = await fetch(`http://localhost:3000${path}`, {
    method, headers: H(token), ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = null; try { data = await res.json(); } catch {}
  return { status: res.status, data };
}
const market = async (t) => (await api('GET', '/api/market', t)).data;
const results = [];
const check = (name, ok, detail) => { results.push({ name, ok }); console.log(`${ok ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`); };

/* Частичные конкурентные сделки: 8 запросов по 30 единиц на ордер из 100. */
async function partialRace() {
  await api('POST', '/api/market/orders', ids.pilotToken, { side: 'SELL', resource: 'TITANITE', quantity: 100, pricePerUnit: 2 });
  const book = await market(ids.admiralToken);
  const order = book.book.TITANITE.sell.filter((o) => !o.mine).sort((a, b) => b.createdAt - a.createdAt)[0];
  if (!order) return check('частичная гонка: ордер создан', false);

  const b1 = await market(ids.admiralToken), b2 = await market(ids.pilotToken);
  const attempts = await Promise.all(Array.from({ length: 8 }, () =>
    api('POST', `/api/market/orders/${order.id}/fill`, ids.admiralToken, { quantity: 30 })));
  const ok = attempts.filter((a) => a.status === 200).length;

  const a1 = await market(ids.admiralToken), a2 = await market(ids.pilotToken);
  const got = a1.storage.titanite - b1.storage.titanite;
  const paid = b1.credits - a1.credits;
  const earned = a2.credits - b2.credits;
  const left = (await market(ids.admiralToken)).book.TITANITE.sell.find((o) => o.id === order.id);
  const remaining = left ? left.remaining : 0;

  check('частичная гонка: товар не создается из воздуха', got + remaining === 100,
    `успешных ${ok}, получено ${got}, остаток ордера ${remaining}`);
  check('частичная гонка: деньги сходятся с товаром', paid === got * 2 && earned === got * 2,
    `оплачено ${paid} ₴, получено продавцом ${earned} ₴ за ${got} единиц`);

  if (left) await api('DELETE', `/api/market/orders/${order.id}`, ids.pilotToken);
}

/* Двойная отмена одного ордера: залог должен вернуться ровно один раз. */
async function cancelRace() {
  const created = await api('POST', '/api/market/orders', ids.pilotToken, { side: 'SELL', resource: 'SILICATE', quantity: 500, pricePerUnit: 2 });
  if (created.status !== 200) return check('гонка отмены: ордер создан', false, JSON.stringify(created.data));

  const mine = (await market(ids.pilotToken)).myOrders.find((o) => o.resource === 'SILICATE');
  const before = await market(ids.pilotToken);

  const attempts = await Promise.all(Array.from({ length: 6 }, () =>
    api('DELETE', `/api/market/orders/${mine.id}`, ids.pilotToken)));
  const ok = attempts.filter((a) => a.status === 200).length;

  const after = await market(ids.pilotToken);
  check('гонка отмены: залог вернулся ровно один раз',
    after.storage.silicate - before.storage.silicate === 500 && ok === 1,
    `успешных отмен ${ok}, силикаты ${before.storage.silicate} -> ${after.storage.silicate}`);
}

/* Двойная покупка на грани баланса: два ордера, каждый почти на весь баланс. */
async function creditEdge() {
  const before = await market(ids.pilotToken);
  const budget = Math.floor(before.credits);
  if (budget < 10) return check('граница баланса: пропущено (нет денег)', true, `баланс ${budget}`);

  const attempts = await Promise.all([
    api('POST', '/api/market/orders', ids.pilotToken, { side: 'BUY', resource: 'TITANITE', quantity: budget, pricePerUnit: 1 }),
    api('POST', '/api/market/orders', ids.pilotToken, { side: 'BUY', resource: 'TITANITE', quantity: budget, pricePerUnit: 1 }),
  ]);
  const ok = attempts.filter((a) => a.status === 200).length;
  const after = await market(ids.pilotToken);
  check('граница баланса: прошел ровно один ордер', ok === 1 && after.credits >= 0,
    `успешных ${ok}, баланс ${before.credits} -> ${after.credits}`);

  for (const o of (await market(ids.pilotToken)).myOrders) await api('DELETE', `/api/market/orders/${o.id}`, ids.pilotToken);
}

await partialRace();
await cancelRace();
await creditEdge();
const failed = results.filter((r) => !r.ok);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
