/**
 * Проверка id_token Google.
 *
 * Настоящий вход ходит за ключами к Google, поэтому проверка принимает
 * верификатор параметром: здесь подставляется своя пара ключей, и каждый
 * отказ проверяется точно, а не «как-нибудь не пустило». Сервер не нужен.
 *
 * Запуск: npm run test:oauth
 */
import { SignJWT, exportJWK, generateKeyPair, type JWK } from 'jose';
import { createHmac } from 'node:crypto';
import {
  verifyGoogleIdToken,
  verifyTelegramInitData,
  type GoogleVerifier,
} from '../src/services/authService.js';

const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const CLIENT_ID = '123-test.apps.googleusercontent.com';

const google = await generateKeyPair('RS256', { extractable: true });
const stranger = await generateKeyPair('RS256', { extractable: true });

const verifier: GoogleVerifier = { keys: google.publicKey, clientId: CLIENT_ID };
const publicJwk: JWK = await exportJWK(google.publicKey);

interface Claims {
  sub?: string;
  email?: string;
  emailVerified?: unknown;
  audience?: string;
  issuer?: string;
  expiresIn?: string;
  key?: CryptoKey;
}

/** Токен, какой выписал бы Google, с точечными подменами под конкретный случай. */
function idToken(claims: Claims = {}): Promise<string> {
  const payload: Record<string, unknown> = {
    email: claims.email ?? 'commander@gmail.com',
    email_verified: 'emailVerified' in claims ? claims.emailVerified : true,
  };
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'RS256' })
    .setSubject(claims.sub ?? '1234567890')
    .setIssuer(claims.issuer ?? 'https://accounts.google.com')
    .setAudience(claims.audience ?? CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(claims.expiresIn ?? '5m')
    .sign(claims.key ?? google.privateKey);
}

console.log('\n=== 1. Честный токен ===');

{
  const profile = await verifyGoogleIdToken(await idToken(), verifier);
  check(
    'токен Google принимается и дает sub с email',
    profile?.providerId === '1234567890' && profile?.email === 'commander@gmail.com',
    JSON.stringify(profile),
  );

  // Адрес приходит от людей в любом регистре, а ищем мы по нему точным равенством.
  const upper = await verifyGoogleIdToken(await idToken({ email: '  Commander@GMail.com ' }), verifier);
  check('email приводится к нижнему регистру и обрезается', upper?.email === 'commander@gmail.com');

  const shortIssuer = await verifyGoogleIdToken(await idToken({ issuer: 'accounts.google.com' }), verifier);
  check('издатель без схемы тоже валиден', shortIssuer !== null);
}

console.log('\n=== 2. Отказы ===');

{
  // Главная проверка: без сверки aud подошел бы токен, выписанный Google
  // любому другому сайту, и вход стал бы «предъяви любой гугловый токен».
  const foreign = await verifyGoogleIdToken(await idToken({ audience: 'other-app.apps.googleusercontent.com' }), verifier);
  check('токен, выписанный другому приложению, отклонен', foreign === null);

  const forged = await verifyGoogleIdToken(await idToken({ key: stranger.privateKey }), verifier);
  check('подпись чужим ключом отклонена', forged === null);

  const expired = await verifyGoogleIdToken(await idToken({ expiresIn: '-1m' }), verifier);
  check('протухший токен отклонен', expired === null);

  const wrongIssuer = await verifyGoogleIdToken(await idToken({ issuer: 'https://evil.example' }), verifier);
  check('чужой издатель отклонен', wrongIssuer === null);

  const unverified = await verifyGoogleIdToken(await idToken({ emailVerified: false }), verifier);
  check('неподтвержденный email отклонен', unverified === null);

  const missingFlag = await verifyGoogleIdToken(await idToken({ emailVerified: undefined }), verifier);
  check('токен без email_verified отклонен', missingFlag === null);

  // Google иногда шлет флаг строкой — истинность должна быть строгой.
  const stringFlag = await verifyGoogleIdToken(await idToken({ emailVerified: 'true' }), verifier);
  check('email_verified строкой не считается подтверждением', stringFlag === null);

  const noEmail = await verifyGoogleIdToken(await idToken({ email: '' }), verifier);
  check('токен без email отклонен', noEmail === null);

  check('пустой токен отклонен', (await verifyGoogleIdToken('', verifier)) === null);
  check('мусор вместо токена отклонен', (await verifyGoogleIdToken('not-a-jwt', verifier)) === null);
}

console.log('\n=== 3. Незаданный client id ===');

{
  // Без ключа сервер отвечает 501 раньше, но проверка не должна пускать
  // никого и сама по себе: пустой aud иначе совпал бы с пустым client id.
  const blind = await verifyGoogleIdToken(await idToken(), { keys: google.publicKey, clientId: '' });
  check('без настроенного client id не пускает никого', blind === null);
  check('ключ проверки экспортируется как JWK', typeof publicJwk.n === 'string');
}

/* --------------------- Telegram: подпись initData --------------------- */

console.log('\n=== Telegram ===');

const BOT_TOKEN = '1234567:test-bot-token';

/** Собирает `initData` ровно так, как его подписывает Telegram. */
function initData(
  fields: Record<string, string>,
  token = BOT_TOKEN,
): string {
  const checkString = Object.entries(fields)
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');
  const secretKey = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secretKey).update(checkString).digest('hex');
  const params = new URLSearchParams(fields);
  params.set('hash', hash);
  return params.toString();
}

const now = Date.now();
const fresh = () => ({
  auth_date: String(Math.floor(now / 1000)),
  query_id: 'AAH1',
  user: JSON.stringify({ id: 42, first_name: 'Сергій', username: 'lorawan' }),
});

{
  const ok = verifyTelegramInitData(initData(fresh()), BOT_TOKEN, now);
  check('честная подпись принимается', ok?.providerId === '42', ok?.providerId);
  check(
    'почта собирается служебная, как у ботов',
    ok?.email === 'tg-42@telegram.local',
    ok?.email,
  );
}

{
  // Подпись чужим токеном — самый важный отказ: без него вход превращается
  // в «предъяви любую строку с полем hash».
  const alien = verifyTelegramInitData(initData(fresh(), 'другой-токен'), BOT_TOKEN, now);
  check('подпись чужим токеном не проходит', alien === null);

  const tampered = initData(fresh()).replace('id%22%3A42', 'id%22%3A43');
  check('подмена пользователя ломает подпись', verifyTelegramInitData(tampered, BOT_TOKEN, now) === null);

  check('без hash не пускает', verifyTelegramInitData('auth_date=1&user=%7B%7D', BOT_TOKEN, now) === null);
  check('пустая строка не пускает', verifyTelegramInitData('', BOT_TOKEN, now) === null);
}

{
  // Просроченная подпись — это чужая сохраненная ссылка, а не длинная сессия:
  // Telegram выдает свежий initData при каждом открытии приложения.
  const old = initData({ ...fresh(), auth_date: String(Math.floor(now / 1000) - 60 * 60 * 25) });
  check('вчерашняя подпись не принимается', verifyTelegramInitData(old, BOT_TOKEN, now) === null);

  const edge = initData({ ...fresh(), auth_date: String(Math.floor(now / 1000) - 60 * 60 * 23) });
  check('вчерашняя, но в пределах суток — принимается', verifyTelegramInitData(edge, BOT_TOKEN, now) !== null);
}

{
  // Без токена в окружении проверка не должна пускать никого сама по себе:
  // сервер отвечает 501 раньше, но полагаться на один заслон нельзя.
  check('без токена бота не пускает никого', verifyTelegramInitData(initData(fresh()), '', now) === null);

  const noUser = initData({ auth_date: String(Math.floor(now / 1000)), query_id: 'AAH1' });
  check('без пользователя в нагрузке не пускает', verifyTelegramInitData(noUser, BOT_TOKEN, now) === null);
}

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
for (const f of failed) console.log(`  СЛОМАНО: ${f.name}`);
if (failed.length > 0) process.exit(1);
