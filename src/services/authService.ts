/**
 * Авторизация: локальные аккаунты с паролем и заготовка под OAuth.
 *
 * Пароли хешируются scrypt из стандартной библиотеки: соль на каждый пароль,
 * сравнение постоянным по времени. Сессия — JWT, подписанный секретом сервера.
 */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import jwt from 'jsonwebtoken';
import { prisma } from '../db/prisma.js';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { authConfig, isProviderConfigured, type ExternalProvider } from '../config/auth.js';
import type { User } from '../generated/prisma/client.js';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const SCRYPT_KEY_LENGTH = 64;

export type AuthResult =
  | { ok: true; token: string; user: User }
  | { ok: false; error: string; status: number };

export interface TokenPayload {
  sub: string;
  email: string;
}

/* ------------------------- Пароли ------------------------- */

/** Хеш вида `scrypt$<соль>$<ключ>` — соль хранится рядом с ключом. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const key = await scryptAsync(password, salt, SCRYPT_KEY_LENGTH);
  return `scrypt$${salt}$${key.toString('hex')}`;
}

/** Сравнение постоянным по времени: длина ответа не зависит от того, где различие. */
export async function verifyPassword(password: string, stored: string | null): Promise<boolean> {
  if (!stored) return false;
  const [scheme, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;

  const expected = Buffer.from(hash, 'hex');
  const actual = await scryptAsync(password, salt, expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function validateEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length < 5 || email.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return null;
  return email;
}

export function validatePassword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.length < 8 || value.length > 128) return null;
  return value;
}

/* ------------------------- Токены ------------------------- */

export function issueToken(user: Pick<User, 'id' | 'email'>): string {
  const payload: TokenPayload = { sub: user.id, email: user.email };
  return jwt.sign(payload, authConfig.jwtSecret, { expiresIn: authConfig.tokenTtlSeconds });
}

/** Проверка токена. Возвращает null на любой некорректной или просроченной подписи. */
export function verifyToken(token: string): TokenPayload | null {
  try {
    const decoded = jwt.verify(token, authConfig.jwtSecret);
    if (typeof decoded === 'string' || typeof decoded.sub !== 'string') return null;
    return { sub: decoded.sub, email: String(decoded['email'] ?? '') };
  } catch {
    return null;
  }
}

/* ------------------------- Регистрация и вход ------------------------- */

export async function register(email: string, password: string): Promise<AuthResult> {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { ok: false, error: 'Аккаунт с таким email уже существует', status: 409 };
  }

  const user = await prisma.user.create({
    data: {
      email,
      authProvider: 'LOCAL',
      passwordHash: await hashPassword(password),
      lastLoginAt: new Date(),
    },
  });
  return { ok: true, token: issueToken(user), user };
}

export async function login(email: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { email } });

  // Один и тот же текст ошибки, чтобы нельзя было перебором узнать существующие email.
  const invalid: AuthResult = { ok: false, error: 'Неверный email или пароль', status: 401 };
  if (!user || !(await verifyPassword(password, user.passwordHash))) return invalid;

  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  return { ok: true, token: issueToken(user), user };
}

/* ------------------------- Смена пароля ------------------------- */

export interface ResetRequest {
  /** Токен возвращается в ответе, пока не подключена отправка писем. */
  token: string | null;
  expiresAt: Date | null;
}

/**
 * Запрос смены пароля. Наружу всегда отдаем одинаковый ответ, чтобы нельзя
 * было проверить, зарегистрирован ли email.
 */
export async function requestPasswordReset(email: string): Promise<ResetRequest> {
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || user.authProvider !== 'LOCAL') return { token: null, expiresAt: null };

  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + authConfig.resetTtlMinutes * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetToken: token, passwordResetExpires: expiresAt },
  });
  return { token, expiresAt };
}

export async function resetPassword(token: string, password: string): Promise<AuthResult> {
  const user = await prisma.user.findUnique({ where: { passwordResetToken: token } });
  if (!user || !user.passwordResetExpires || user.passwordResetExpires.getTime() < Date.now()) {
    return { ok: false, error: 'Ссылка смены пароля недействительна или истекла', status: 400 };
  }

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(password),
      passwordResetToken: null,
      passwordResetExpires: null,
      lastLoginAt: new Date(),
    },
  });
  return { ok: true, token: issueToken(updated), user: updated };
}

/* ------------------------- Вход через провайдера ------------------------- */

/**
 * Вход через внешнего провайдера — сейчас только Google.
 *
 * Аккаунт ищется по паре «провайдер + идентификатор у провайдера», а не по email:
 * `sub` у Google неизменен, а адрес человек меняет, и у Workspace его может
 * переиспользовать администратор домена. Email остается справочным полем.
 */
export async function loginWithProvider(
  provider: ExternalProvider,
  idToken: string,
): Promise<AuthResult> {
  if (!isProviderConfigured(provider)) {
    return {
      ok: false,
      error: `Вход через ${provider} появится позже: ключи провайдера еще не подключены`,
      status: 501,
    };
  }

  const profile = await verifyProviderToken(provider, idToken);
  if (!profile) return { ok: false, error: 'Провайдер отклонил токен', status: 401 };

  // Уже привязанный аккаунт — самый частый путь, и проверяется он первым.
  // Иначе сменивший адрес игрок упирался бы в чужой аккаунт с его старым email.
  const linked = await prisma.user.findUnique({
    where: { authProvider_providerId: { authProvider: provider, providerId: profile.providerId } },
  });
  if (linked) {
    const updated = await prisma.user.update({
      where: { id: linked.id },
      data: { lastLoginAt: new Date() },
    });
    return { ok: true, token: issueToken(updated), user: updated };
  }

  /*
   * Привязки нет. Автоматически связывать по совпавшему email нельзя: мы email
   * при регистрации не подтверждаем, поэтому кто угодно может заранее завести
   * аккаунт на чужой адрес. Владелец адреса потом войдет через Google, получит
   * этот подставленный аккаунт — и злоумышленник останется в нем с паролем,
   * который он же и задал. Поэтому здесь честный отказ, а привязка делается
   * только изнутри сессии, где владение аккаунтом уже доказано входом.
   */
  const taken = await prisma.user.findUnique({ where: { email: profile.email } });
  if (taken) {
    return {
      ok: false,
      error:
        'Этот email уже занят аккаунтом с паролем. Войди паролем — ' +
        'привязать вход через Google можно будет из настроек.',
      status: 409,
    };
  }

  try {
    const user = await prisma.user.create({
      data: {
        email: profile.email,
        authProvider: provider,
        providerId: profile.providerId,
        lastLoginAt: new Date(),
      },
    });
    return { ok: true, token: issueToken(user), user };
  } catch (error) {
    // Между проверкой и вставкой этот же email мог занять параллельный запрос.
    // Окно узкое, но ответ должен быть тем же понятным отказом, а не пятисоткой.
    if (isUniqueViolation(error)) {
      return { ok: false, error: 'Этот email уже занят другим аккаунтом', status: 409 };
    }
    throw error;
  }
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'P2002';
}

export interface ProviderProfile {
  providerId: string;
  email: string;
}

/*
 * Ключи Google для проверки подписи id_token.
 *
 * `createRemoteJWKSet` сам кеширует набор и перечитывает его при незнакомом
 * `kid` — Google ротирует ключи регулярно, и держать их копию у себя значит
 * однажды начать отвергать честные токены. Объект создается один раз на
 * процесс: на каждый вход новый набор означал бы поход в сеть за ключами.
 */
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

/** Оба варианта издателя, которые Google ставит в id_token. */
const GOOGLE_ISSUERS = ['https://accounts.google.com', 'accounts.google.com'];

/**
 * Чем проверять подпись и с каким client id сверять `aud`.
 *
 * Вынесено параметром по той же причине, что и генератор случайных чисел
 * в бою: настоящий вход ходит за ключами к Google, а тест подставляет свою
 * пару ключей и проверяет ровно те отказы, ради которых проверка и написана.
 */
export interface GoogleVerifier {
  keys: Parameters<typeof jwtVerify>[1];
  clientId: string;
}

function googleVerifier(): GoogleVerifier {
  return { keys: GOOGLE_JWKS, clientId: authConfig.providers.GOOGLE.clientId };
}

/**
 * Проверка id_token Google.
 *
 * Проверяется подпись, издатель, срок и — обязательно — `aud`: без сверки
 * с нашим client id подошел бы токен, выписанный Google любому другому сайту,
 * и вход превратился бы в «предъяви любой гугловый токен».
 *
 * `email_verified` тоже обязателен. Google ставит его не всегда, и адрес
 * без подтверждения не годится даже как справочное поле: по нему мы отказываем
 * в регистрации другим, то есть он влияет на чужие аккаунты.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  verifier: GoogleVerifier = googleVerifier(),
): Promise<ProviderProfile | null> {
  if (!idToken || !verifier.clientId) return null;

  try {
    const { payload } = await jwtVerify(idToken, verifier.keys, {
      issuer: GOOGLE_ISSUERS,
      audience: verifier.clientId,
    });

    if (payload.email_verified !== true) return null;

    const providerId = typeof payload.sub === 'string' ? payload.sub : '';
    const email = typeof payload.email === 'string' ? payload.email.trim().toLowerCase() : '';
    if (!providerId || !email) return null;

    return { providerId, email };
  } catch {
    // Разбирать причину незачем: неверная подпись, чужой aud и протухший токен
    // для входящего одинаково означают «не пущен», а подробности — подсказка.
    return null;
  }
}

async function verifyProviderToken(
  provider: ExternalProvider,
  idToken: string,
): Promise<ProviderProfile | null> {
  if (provider !== 'GOOGLE') return null;
  return verifyGoogleIdToken(idToken);
}
