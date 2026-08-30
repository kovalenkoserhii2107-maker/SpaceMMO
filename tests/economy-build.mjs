/**
 * Проверки экономики: очереди строительства, стоимость, требования.
 * Запуск: node tests/economy-build.mjs
 */
import { readFileSync } from 'node:fs';

const BASE_URL = 'http://localhost:3000';
const results = [];

function check(name, passed, detail) {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

async function api(method, path, body, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let data = null;
  try { data = await res.json(); } catch { data = null; }
  return { status: res.status, data: data || {} };
}

const unique = Date.now().toString(36);
const email = `builder-${unique}@spacemmo.local`;
const password = 'builder-password-1';

// 1. Регистрация и онбординг
const registered = await api('POST', '/api/auth/register', { email, password });
const token = registered.data.token;
const commanderRes = await api('POST', '/api/auth/commander', { nickname: `Прораб-${unique}`, avatarId: 'nova' }, token);
if (commanderRes.status !== 200) {
  console.error('Не удалось создать командира:', commanderRes);
  process.exit(1);
}

// 2. Получаем состояние (находим базу)
const stateRes = await api('GET', '/api/state', undefined, token);
const state = stateRes.data;
if (!state.bases || state.bases.length === 0) {
  console.error('База не найдена! Ответ:', stateRes);
  process.exit(1);
}
const base = state.bases[0];

// 3. Стройка невозможного (Фабрика антиматерии — слишком дорого, и нет требований)
const synthRes = await api('POST', `/api/bases/${base.baseId}/build`, { type: 'ANTIMATTER_FACTORY' }, token);
check('нельзя построить без ресурсов', synthRes.status === 409, JSON.stringify(synthRes.data));

// 4. Требования (Верфь требует Шахту руды 2)
const shipyardRes = await api('POST', `/api/bases/${base.baseId}/build`, { type: 'SHIPYARD' }, token);
check('нельзя построить без требований', shipyardRes.status === 409, JSON.stringify(shipyardRes.data));

// 5. Успешная стройка (Шахта руды)
const beforeOre = base.resources.ore;
const buildRes = await api('POST', `/api/bases/${base.baseId}/build`, { type: 'ORE_MINE' }, token);
check('заказ на постройку шахты принят', buildRes.status === 200, JSON.stringify(buildRes.data));

const stateAfter = (await api('GET', '/api/state', undefined, token)).data.bases[0];
const oreSpent = beforeOre - stateAfter.resources.ore;

check('ресурсы списались', oreSpent > 0, `было ${beforeOre}, стало ${stateAfter.resources.ore}`);
check('постройка появилась в активной задаче', stateAfter.buildJob && stateAfter.buildJob.building === 'ORE_MINE', `buildJob: ${JSON.stringify(stateAfter.buildJob)}`);

// 6. Вторая стройка того же типа отклоняется (очередей нет, можно строить только одно здание)
const buildRes2 = await api('POST', `/api/bases/${base.baseId}/build`, { type: 'ORE_MINE' }, token);
check('заказ во время активной стройки отклоняется', buildRes2.status === 409, JSON.stringify(buildRes2.data));

const stateAfter2 = (await api('GET', '/api/state', undefined, token)).data.bases[0];
check('активная стройка не изменилась', stateAfter2.buildJob && stateAfter2.buildJob.building === 'ORE_MINE', `buildJob: ${JSON.stringify(stateAfter2.buildJob)}`);

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
for (const f of failed) console.log(`  СЛОМАНО: ${f.name}`);
