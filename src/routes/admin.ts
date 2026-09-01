/**
 * Пульт гейм-мастера.
 *
 * Весь раздел закрыт `requireAdmin`, и проверка стоит на самом роутере,
 * а не на отдельных путях: новый эндпоинт наследует защиту автоматически
 * и не может оказаться открытым по забывчивости.
 */
import { Router, type Response } from 'express';
import {
  adminSchema,
  applyPatch,
  deleteAccount,
  getCommanderDetail,
  getDashboard,
  issuePasswordReset,
  listCommanders,
  messagePlayer,
  parsePatch,
  setAccountBlocked,
} from '../services/adminService.js';
import {
  botCharacterCatalog,
  createBot,
  deleteBot,
  listBots,
  nudgeBot,
  setBotActive,
} from '../services/botService.js';
import { currentAccount, requireAdmin, requireAuth } from './middleware.js';
import type {
  ActionResponse,
  AdminBotsResponse,
  AdminDashboardResponse,
  AdminDetailResponse,
  AdminListResponse,
  AdminResetResponse,
  ErrorResponse,
} from '../types/api.js';

/** Строка из тела запроса: чего нет или что не строка — пустая строка. */
function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

/** Справочник ключей для формы: клиент не хардкодит перечисления. */
adminRouter.get('/schema', (_req, res) => {
  res.json(adminSchema());
});

/** Сводка по серверу: игроки, онлайн, активность за сутки. */
adminRouter.get('/dashboard', async (_req, res: Response<AdminDashboardResponse>) => {
  res.json(await getDashboard());
});

/** Список командиров с поиском по позывному. */
adminRouter.get('/commanders', async (req, res: Response<AdminListResponse>) => {
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
  res.json({ commanders: await listCommanders(search) });
});

/** Полный стейт игрока: ресурсы, здания, технологии, флот, склады хаба. */
adminRouter.get('/commanders/:id', async (req, res: Response<AdminDetailResponse | ErrorResponse>) => {
  const detail = await getCommanderDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: 'Командир не найден' });
    return;
  }
  res.json(detail);
});

/** God Mode: принудительная правка состояния игрока. */
adminRouter.patch('/commanders/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const patch = parsePatch(req.body);
  if (!patch) {
    res.status(400).json({ error: 'Некорректный набор изменений' });
    return;
  }

  const result = await applyPatch(currentAccount(req).email, req.params.id, patch);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/**
 * Выдать код смены пароля. Пароль пульт не задает и не показывает:
 * админ передает игроку одноразовый код, новый пароль игрок вводит сам.
 */
adminRouter.post(
  '/commanders/:id/password-reset',
  async (req, res: Response<AdminResetResponse | ErrorResponse>) => {
    const result = await issuePasswordReset(req.params.id);
    if (!result.ok) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    res.json({
      ok: true,
      message: result.message,
      token: result.token ?? '',
      expiresAt: result.expiresAt ?? 0,
    });
  },
);

/** Закрыть или вернуть доступ. Игровое состояние при этом не трогается. */
adminRouter.post('/commanders/:id/block', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const blocked = (req.body as { blocked?: unknown } | undefined)?.blocked === true;
  const result = await setAccountBlocked(req.params.id, blocked);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Письмо игроку от гейм-мастера. */
adminRouter.post('/commanders/:id/message', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { subject?: unknown; body?: unknown };
  const result = await messagePlayer(req.params.id, text(body.subject), text(body.body));
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/**
 * Удаление учетной записи. Необратимо и уносит каскадом колонии, флоты
 * и синдикат, если игрок им руководил, поэтому требует подтверждения позывным.
 */
adminRouter.delete('/commanders/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const confirm = text((req.body as { confirm?: unknown } | undefined)?.confirm);
  const result = await deleteAccount(req.params.id, confirm);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});


/* ------------------------- Боты ------------------------- */

/** Список ботов и каталог характеров: описания живут на сервере. */
adminRouter.get('/bots', async (_req, res: Response<AdminBotsResponse>) => {
  res.json({ bots: await listBots(), characters: botCharacterCatalog() });
});

/** Завести бота: позывной и характер. Стартовая колония выдается как игроку. */
adminRouter.post('/bots', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { nickname?: unknown; character?: unknown };
  const result = await createBot(body.nickname, body.character);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Пауза и возобновление: бот остается в мире, но перестает решать. */
adminRouter.post('/bots/:id/active', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const active = (req.body as { active?: unknown } | undefined)?.active === true;
  const result = await setBotActive(req.params.id, active);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Разбудить немедленно — чтобы не ждать расписания при проверке поведения. */
adminRouter.post('/bots/:id/nudge', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await nudgeBot(req.params.id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Удаление: каскад уносит колонии и флоты, как и у живого аккаунта. */
adminRouter.delete('/bots/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await deleteBot(req.params.id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});
