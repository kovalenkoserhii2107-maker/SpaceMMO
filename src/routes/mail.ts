/**
 * Центр связи: чтение ящика и личная переписка.
 *
 * Каждый роут работает только с ящиком текущего командира — идентификатор
 * получателя берется из токена, а не из запроса. Прочитать или удалить чужое
 * письмо нельзя даже по прямому id: владелец стоит в условии самой выборки.
 */
import { Router, type Response } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import {
  deleteMessage,
  getMailbox,
  isMessageType,
  markAllRead,
  markRead,
  sendToNickname,
  validateBody,
  validateSubject,
} from '../services/mailService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import type { ActionResponse, ErrorResponse, MailboxResponse } from '../types/api.js';

export const mailRouter = Router();

mailRouter.use(requireAuth);
mailRouter.use(requireCommander);

/** Ящик с необязательным фильтром по типу письма. */
mailRouter.get('/', async (req, res: Response<MailboxResponse | ErrorResponse>) => {
  const raw = req.query['type'];
  if (raw !== undefined && !isMessageType(raw)) {
    res.status(400).json({ error: 'Неизвестный тип письма' });
    return;
  }

  res.json(await getMailbox(currentCommander(req).id, isMessageType(raw) ? raw : undefined));
});

/** Личное письмо другому командиру по позывному. */
mailRouter.post('/', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { to?: unknown; subject?: unknown; body?: unknown };

  const nickname = typeof body.to === 'string' ? body.to.trim() : '';
  if (!nickname) {
    res.status(400).json({ error: 'Не указан позывной получателя' });
    return;
  }

  const subject = validateSubject(body.subject);
  const text = validateBody(body.body);
  if (!subject) {
    res.status(400).json({ error: 'Тема: от 1 до 120 символов' });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'Текст письма: от 1 до 4000 символов' });
    return;
  }

  const result = await sendToNickname(currentCommander(req).id, nickname, subject, text);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }

  // Идентификатор получателя наружу не отдаем: отправителю он не нужен,
  // а внутренние id чужих командиров — лишнее знание.
  if (result.recipientId) gameLoop.pushUnread(result.recipientId);
  res.json({ ok: true, message: result.message });
});

mailRouter.post('/read-all', async (req, res: Response<ActionResponse>) => {
  const result = await markAllRead(currentCommander(req).id);
  res.json(result);
});

mailRouter.post('/:id/read', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await markRead(currentCommander(req).id, req.params.id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

mailRouter.delete('/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await deleteMessage(currentCommander(req).id, req.params.id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});
