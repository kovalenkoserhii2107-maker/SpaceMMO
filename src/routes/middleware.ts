import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../db/prisma.js';
import { verifyToken } from '../services/authService.js';
import type { UserRole } from '../generated/prisma/enums.js';
import type { ErrorResponse } from '../types/api.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      email?: string;
      commanderId?: string;
      nickname?: string;
      role?: UserRole;
    }
  }
}

/**
 * Учетная запись защищенного роута.
 * Приведение типа безопасно: за такими роутами стоит `requireAuth`.
 */
export function currentAccount(req: Request): { id: string; email: string } {
  return { id: req.userId as string, email: req.email as string };
}

/**
 * Командир защищенного роута.
 * Безопасно за `requireCommander`, который иначе вернул бы 409.
 */
export function currentCommander(req: Request): { id: string; nickname: string } {
  return { id: req.commanderId as string, nickname: req.nickname as string };
}

/**
 * Проверка JWT. Токен выдается и локальным входом, и (в будущем) OAuth —
 * дальше по коду разницы нет, поэтому middleware один на все способы входа.
 */
export async function requireAuth(
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction,
): Promise<void> {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const payload = token ? verifyToken(token) : null;

  if (!payload) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { commander: { select: { id: true, nickname: true } } },
  });
  if (!user) {
    res.status(401).json({ error: 'Учетная запись не найдена' });
    return;
  }

  /*
   * Блокировка проверяется на каждом запросе, а не при выдаче токена: токен
   * живет неделю, и заблокированный игрок иначе продолжал бы играть до его
   * истечения. Цена — то же чтение пользователя, которое здесь уже идет.
   */
  if (user.blockedAt) {
    res.status(403).json({ error: 'Учетная запись заблокирована. Обратись к администрации.' });
    return;
  }

  req.userId = user.id;
  req.email = user.email;
  req.role = user.role;
  if (user.commander) {
    req.commanderId = user.commander.id;
    req.nickname = user.commander.nickname;
  }
  next();
}

/**
 * Онбординг: авторизованный игрок без командира в игру не попадает.
 * Клиент по коду `COMMANDER_REQUIRED` открывает экран создания профиля.
 */
export function requireCommander(
  req: Request,
  res: Response<ErrorResponse & { code?: string }>,
  next: NextFunction,
): void {
  if (!req.commanderId) {
    res.status(409).json({ error: 'Сначала создай командира', code: 'COMMANDER_REQUIRED' });
    return;
  }
  next();
}

/**
 * Пульт гейм-мастера. Роль читается из БД в `requireAuth` при каждом запросе,
 * а не из токена: снятая роль должна действовать сразу, а не после истечения JWT.
 *
 * Отказ намеренно одинаков и для анонима, и для авторизованного игрока —
 * по ответу нельзя определить, существует ли админский раздел вообще.
 */
export function requireAdmin(
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction,
): void {
  if (req.role !== 'ADMIN') {
    console.error(
      `[admin] отказано в доступе: ${req.email ?? 'аноним'} → ${req.method} ${req.originalUrl}`,
    );
    res.status(403).json({ error: 'Доступ запрещен' });
    return;
  }
  next();
}
