import { Router } from 'express';
import { loginOrRegister, NoFreePlanetError, normalizeUsername } from '../services/userService.js';

export const authRouter: Router = Router();

authRouter.post('/login', async (req, res) => {
  const username = normalizeUsername((req.body as { username?: unknown } | undefined)?.username);
  if (!username) {
    res.status(400).json({ error: 'Ник должен быть от 3 до 24 символов (буквы, цифры, пробел, - и _)' });
    return;
  }

  try {
    const user = await loginOrRegister(username);
    res.json({ token: user.sessionToken, user: { id: user.id, username: user.username } });
  } catch (error) {
    if (error instanceof NoFreePlanetError) {
      res.status(503).json({ error: error.message });
      return;
    }
    console.error('[auth] ошибка входа:', error);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  }
});
