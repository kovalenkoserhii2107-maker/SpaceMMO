import type { NextFunction, Request, Response } from 'express';
import { findUserByToken } from '../services/userService.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      username?: string;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
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
