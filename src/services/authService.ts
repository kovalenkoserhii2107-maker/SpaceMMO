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
import { authConfig, isProviderConfigured } from '../config/auth.js';
import type { AuthProvider, User } from '../generated/prisma/client.js';

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
 * Вход через Google/Apple/Facebook.
 *
 * Ключи еще не подключены, поэтому проверка токена провайдера вынесена в
 * отдельный шаг: когда появятся реальные client id, достаточно реализовать
 * `verifyProviderToken` — остальной флоу (поиск аккаунта, выдача JWT,
 * требование создать командира) уже готов и не изменится.
 */
export async function loginWithProvider(
  provider: Exclude<AuthProvider, 'LOCAL'>,
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

  const user = await prisma.user.upsert({
    where: { authProvider_providerId: { authProvider: provider, providerId: profile.providerId } },
    create: {
      email: profile.email,
      authProvider: provider,
      providerId: profile.providerId,
      lastLoginAt: new Date(),
    },
    update: { lastLoginAt: new Date() },
  });
  return { ok: true, token: issueToken(user), user };
}

interface ProviderProfile {
  providerId: string;
  email: string;
}

/**
 * Здесь будет реальная проверка подписи id_token у провайдера.
 * До подключения ключей функция недостижима: `loginWithProvider` отсекает
 * запрос раньше по `isProviderConfigured`.
 */
async function verifyProviderToken(
  _provider: Exclude<AuthProvider, 'LOCAL'>,
  _idToken: string,
): Promise<ProviderProfile | null> {
  return null;
}
