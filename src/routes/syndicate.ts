import { Router, type Response } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { validateBody, validateSubject } from '../services/mailService.js';
import {
  applyToSyndicate,
  broadcast,
  createSyndicate,
  disbandSyndicate,
  donate,
  getOverview,
  kickMember,
  leaveSyndicate,
  normalizeName,
  normalizeTag,
  reviewApplication,
  setRole,
  type SyndicateOverview,
} from '../services/syndicateService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import type { ActionResponse, ErrorResponse } from '../types/api.js';

export const syndicateRouter: Router = Router();

syndicateRouter.use(requireAuth);
syndicateRouter.use(requireCommander);

/** Список синдикатов, свой синдикат и состояние заявки. */
syndicateRouter.get('/', async (req, res: Response<SyndicateOverview>) => {
  res.json(await getOverview(currentCommander(req).id));
});

/** Основать синдикат за криптогривну. */
syndicateRouter.post('/', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { name?: unknown; tag?: unknown };
  const name = normalizeName(body.name);
  const tag = normalizeTag(body.tag);

  if (!name) {
    res.status(400).json({ error: 'Название: от 3 до 32 символов' });
    return;
  }
  if (!tag) {
    res.status(400).json({ error: 'Тег: от 2 до 5 букв или цифр' });
    return;
  }

  const result = await createSyndicate(currentCommander(req).id, name, tag);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Подать заявку на вступление. */
syndicateRouter.post('/:syndicateId/apply', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await applyToSyndicate(currentCommander(req).id, req.params.syndicateId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Одобрить заявку. Право лидера и офицеров. */
syndicateRouter.post('/applications/:id/approve', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await reviewApplication(currentCommander(req).id, req.params.id, true);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Отклонить заявку. Право лидера и офицеров. */
syndicateRouter.post('/applications/:id/reject', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await reviewApplication(currentCommander(req).id, req.params.id, false);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Исключить участника. Право лидера. */
syndicateRouter.post('/members/:commanderId/kick', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await kickMember(currentCommander(req).id, req.params.commanderId);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Назначить офицером или вернуть в участники. Право лидера. */
syndicateRouter.post('/members/:commanderId/role', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const role = (req.body as { role?: unknown } | undefined)?.role;
  if (role !== 'OFFICER' && role !== 'MEMBER' && role !== 'LEADER') {
    res.status(400).json({ error: 'Неизвестная роль' });
    return;
  }

  const result = await setRole(currentCommander(req).id, req.params.commanderId, role);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Рассылка по синдикату: одно письмо всему составу. */
syndicateRouter.post('/broadcast', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { subject?: unknown; body?: unknown };

  const subject = validateSubject(body.subject);
  const text = validateBody(body.body);
  if (!subject) {
    res.status(400).json({ error: 'Тема: от 1 до 120 символов' });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'Текст рассылки: от 1 до 4000 символов' });
    return;
  }

  const result = await broadcast(currentCommander(req).id, subject, text);
  if (result.ok) for (const id of result.recipients) gameLoop.pushUnread(id);
  res.status(result.ok ? 200 : result.status).json(
    result.ok ? { ok: true, message: result.message } : { error: result.error },
  );
});

/** Пожертвование в общий банк. */
syndicateRouter.post('/donate', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const amount = Math.floor(Number((req.body as { amount?: unknown } | undefined)?.amount));
  const result = await donate(currentCommander(req).id, amount);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Выйти из синдиката. */
syndicateRouter.post('/leave', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await leaveSyndicate(currentCommander(req).id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Распустить синдикат. Право лидера. */
syndicateRouter.post('/disband', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await disbandSyndicate(currentCommander(req).id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});
