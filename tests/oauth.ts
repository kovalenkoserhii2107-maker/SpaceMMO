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
import { verifyGoogleIdToken, type GoogleVerifier } from '../src/services/authService.js';

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

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
for (const f of failed) console.log(`  СЛОМАНО: ${f.name}`);
if (failed.length > 0) process.exit(1);
