import type { NextFunction, Request, Response } from 'express';
import { findUserByToken } from '../services/userService.js';
import type { ErrorResponse } from '../types/api.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
    }
  }
}

/**
 * Пользователь защищенного роута.
 * Приведение типа безопасно: за всеми такими роутами стоит `requireAuth`,
 * который иначе не пустил бы запрос дальше.
 */
export function currentUser(req: Request): { id: string; username: string } {
  return { id: req.userId as string, username: req.username as string };
}

export async function requireAuth(
  req: Request,
  res: Response<ErrorResponse>,
  next: NextFunction,
): Promise<void> {
  const header = req.header('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  const user = await findUserByToken(token);

  if (!user) {
    res.status(401).json({ error: 'Требуется авторизация' });
    return;
  }

  req.userId = user.id;
  req.username = user.username;
  next();
}
