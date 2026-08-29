/**
 * Проверки авторизации, онбординга и достижений.
 * Запуск: node tests/auth.mjs
 */
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
const email = `test-${unique}@spacemmo.local`;
const password = 'test-password-1';

/* ---------- Регистрация и вход ---------- */
const badEmail = await api('POST', '/api/auth/register', { email: 'broken', password });
check('регистрация с кривым email отклонена', badEmail.status === 400, JSON.stringify(badEmail.data));

const shortPass = await api('POST', '/api/auth/register', { email, password: 'short' });
check('короткий пароль отклонен', shortPass.status === 400, JSON.stringify(shortPass.data));

const registered = await api('POST', '/api/auth/register', { email, password });
check('регистрация выдает токен', registered.status === 200 && Boolean(registered.data.token));

const duplicate = await api('POST', '/api/auth/register', { email, password });
check('повторная регистрация отклонена', duplicate.status === 409, JSON.stringify(duplicate.data));

const wrongPass = await api('POST', '/api/auth/login', { email, password: 'wrong-password' });
const unknownUser = await api('POST', '/api/auth/login', { email: `ghost-${unique}@x.local`, password });
check(
  'ошибка входа не раскрывает существование аккаунта',
  wrongPass.status === 401 && unknownUser.status === 401 && wrongPass.data.error === unknownUser.data.error,
  `«${wrongPass.data.error}» / «${unknownUser.data.error}»`,
);

const token = registered.data.token;

/* ---------- Защита игровых роутов ---------- */
const noToken = await api('GET', '/api/state');
check('игра закрыта без токена', noToken.status === 401, JSON.stringify(noToken.data));

const badToken = await api('GET', '/api/state', undefined, 'not-a-real-jwt');
check('подделанный токен отклонен', badToken.status === 401, JSON.stringify(badToken.data));

const noCommander = await api('GET', '/api/state', undefined, token);
check(
  'игра закрыта без командира и просит онбординг',
  noCommander.status === 409 && noCommander.data.code === 'COMMANDER_REQUIRED',
  JSON.stringify(noCommander.data),
);

const marketBlocked = await api('GET', '/api/market', undefined, token);
const warBlocked = await api('GET', '/api/war', undefined, token);
check(
  'биржа и дипломатия тоже требуют командира',
  marketBlocked.status === 409 && warBlocked.status === 409,
  `market ${marketBlocked.status}, war ${warBlocked.status}`,
);

/* ---------- Онбординг ---------- */
const session = await api('GET', '/api/auth/me', undefined, token);
check(
  'сессия отдает аккаунт, пустого командира и список аватаров',
  session.status === 200 && session.data.commander === null && session.data.avatars.length >= 3,
  `аватаров ${session.data.avatars?.length}`,
);

const shortNick = await api('POST', '/api/auth/commander', { nickname: 'ы', avatarId: 'nova' }, token);
check('слишком короткий позывной отклонен', shortNick.status === 400, JSON.stringify(shortNick.data));

const nickname = `Тестер-${unique}`;
const created = await api('POST', '/api/auth/commander', { nickname, avatarId: 'kobzar' }, token);
check(
  'командир создан и получил стартовую планету',
  created.status === 200 && created.data.commander?.homePlanet,
  `планета ${created.data.commander?.homePlanet}`,
);

check(
  'достижение «Первый шаг» выдано при создании',
  (created.data.commander?.achievements ?? []).some((a) => a.code === 'FIRST_STEP' && a.unlockedAt),
);

const twice = await api('POST', '/api/auth/commander', { nickname: `${nickname}-2`, avatarId: 'nova' }, token);
check('второй командир на аккаунт не создается', twice.status === 409, JSON.stringify(twice.data));

const gameOpen = await api('GET', '/api/state', undefined, token);
check(
  'после онбординга игра открывается',
  gameOpen.status === 200 && gameOpen.data.commander?.nickname === nickname,
  `командир ${gameOpen.data.commander?.nickname}`,
);

/* ---------- Занятый позывной ---------- */
const otherEmail = `other-${unique}@spacemmo.local`;
const other = await api('POST', '/api/auth/register', { email: otherEmail, password });
const takenNick = await api('POST', '/api/auth/commander', { nickname, avatarId: 'nova' }, other.data.token);
check('занятый позывной отклонен', takenNick.status === 409, JSON.stringify(takenNick.data));

/* ---------- Смена пароля ---------- */
const resetRequest = await api('POST', '/api/auth/password/reset-request', { email });
check('запрос смены пароля принят', resetRequest.status === 200 && Boolean(resetRequest.data.devToken));

const ghostRequest = await api('POST', '/api/auth/password/reset-request', { email: `ghost-${unique}@x.local` });
check(
  'запрос для несуществующего email не раскрывает данные',
  ghostRequest.status === 200 && ghostRequest.data.devToken === null,
  JSON.stringify(ghostRequest.data),
);

const resetToken = resetRequest.data.devToken;
const newPassword = 'brand-new-password-9';
const reset = await api('POST', '/api/auth/password/reset', { token: resetToken, password: newPassword });
check('пароль сменен и выдан новый токен', reset.status === 200 && Boolean(reset.data.token));

const reused = await api('POST', '/api/auth/password/reset', { token: resetToken, password: 'yet-another-1' });
check('токен смены пароля одноразовый', reused.status === 400, JSON.stringify(reused.data));

const loginNew = await api('POST', '/api/auth/login', { email, password: newPassword });
check('вход новым паролем работает', loginNew.status === 200 && Boolean(loginNew.data.token));

const loginOld = await api('POST', '/api/auth/login', { email, password });
check('старый пароль больше не работает', loginOld.status === 401);

/* ---------- OAuth ---------- */
for (const provider of ['google', 'apple', 'facebook']) {
  const oauth = await api('POST', `/api/auth/oauth/${provider}`, { idToken: 'stub' });
  check(`${provider}: вход отвечает «ключи не подключены»`, oauth.status === 501, JSON.stringify(oauth.data));
}
const unknownProvider = await api('POST', '/api/auth/oauth/steam', { idToken: 'stub' });
check('неизвестный провайдер отклонен', unknownProvider.status === 400, JSON.stringify(unknownProvider.data));

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
for (const f of failed) console.log(`  СЛОМАНО: ${f.name}`);
