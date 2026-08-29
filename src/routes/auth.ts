import { Router, type Response } from 'express';
import { AVATARS, createCommander, getCommanderProfile, isKnownAvatar, normalizeNickname } from '../services/commanderService.js';
import {
  login,
  loginWithProvider,
  register,
  requestPasswordReset,
  resetPassword,
  validateEmail,
  validatePassword,
} from '../services/authService.js';
import { currentAccount, requireAuth } from './middleware.js';
import type { AuthResponse, ErrorResponse, SessionResponse } from '../types/api.js';

export const authRouter: Router = Router();

/** Регистрация локального аккаунта. Командира игрок создает отдельным шагом. */
authRouter.post('/register', async (req, res: Response<AuthResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const email = validateEmail(body.email);
  const password = validatePassword(body.password);

  if (!email) {
    res.status(400).json({ error: 'Некорректный email' });
    return;
  }
  if (!password) {
    res.status(400).json({ error: 'Пароль должен быть от 8 до 128 символов' });
    return;
  }

  const result = await register(email, password);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ token: result.token, user: { id: result.user.id, email: result.user.email }, commander: null });
});

/** Вход по email и паролю. */
authRouter.post('/login', async (req, res: Response<AuthResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { email?: unknown; password?: unknown };
  const email = validateEmail(body.email);
  const password = typeof body.password === 'string' ? body.password : '';

  if (!email || !password) {
    res.status(400).json({ error: 'Укажи email и пароль' });
    return;
  }

  const result = await login(email, password);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  const commander = await getCommanderProfile(result.user.id).catch(() => null);
  res.json({
    token: result.token,
    user: { id: result.user.id, email: result.user.email },
    commander: null,
    hasCommander: Boolean(commander),
  });
});

/** Вход через стороннего провайдера. Пока ключи не подключены — 501. */
authRouter.post('/oauth/:provider', async (req, res: Response<AuthResponse | ErrorResponse>) => {
  const provider = String(req.params.provider).toUpperCase();
  if (provider !== 'GOOGLE' && provider !== 'APPLE' && provider !== 'FACEBOOK') {
    res.status(400).json({ error: 'Неизвестный провайдер' });
    return;
  }

  const idToken = String((req.body as { idToken?: unknown } | undefined)?.idToken ?? '');
  const result = await loginWithProvider(provider, idToken);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ token: result.token, user: { id: result.user.id, email: result.user.email }, commander: null });
});

/** Запрос смены пароля. Ответ одинаков независимо от того, есть ли такой email. */
authRouter.post('/password/reset-request', async (req, res) => {
  const email = validateEmail((req.body as { email?: unknown } | undefined)?.email);
  if (!email) {
    res.status(400).json({ error: 'Некорректный email' });
    return;
  }

  const request = await requestPasswordReset(email);
  res.json({
    ok: true,
    message: 'Если аккаунт существует, ссылка для смены пароля отправлена',
    // Пока нет почтовой отправки, токен возвращается прямо в ответе.
    devToken: request.token,
    expiresAt: request.expiresAt ? request.expiresAt.getTime() : null,
  });
});

/** Установка нового пароля по токену. */
authRouter.post('/password/reset', async (req, res: Response<AuthResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { token?: unknown; password?: unknown };
  const token = typeof body.token === 'string' ? body.token : '';
  const password = validatePassword(body.password);

  if (!token || !password) {
    res.status(400).json({ error: 'Нужен токен и пароль от 8 символов' });
    return;
  }

  const result = await resetPassword(token, password);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json({ token: result.token, user: { id: result.user.id, email: result.user.email }, commander: null });
});

/** Текущая сессия: аккаунт и его командир, если тот уже создан. */
authRouter.get('/me', requireAuth, async (req, res: Response<SessionResponse>) => {
  const account = currentAccount(req);
  const commander = req.commanderId ? await getCommanderProfile(req.commanderId) : null;
  res.json({
    user: { id: account.id, email: account.email },
    commander,
    avatars: AVATARS.map((avatar) => ({ ...avatar })),
  });
});

/** Создание командира — второй шаг онбординга. */
authRouter.post('/commander', requireAuth, async (req, res: Response<SessionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { nickname?: unknown; avatarId?: unknown };
  const nickname = normalizeNickname(body.nickname);
  const avatarId = isKnownAvatar(body.avatarId) ? body.avatarId : AVATARS[0].id;

  if (!nickname) {
    res.status(400).json({ error: 'Позывной: от 3 до 24 символов (буквы, цифры, пробел, - и _)' });
    return;
  }

  const account = currentAccount(req);
  const result = await createCommander(account.id, nickname, avatarId);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  res.json({
    user: { id: account.id, email: account.email },
    commander: result.commander,
    avatars: AVATARS.map((avatar) => ({ ...avatar })),
  });
});
