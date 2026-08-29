import { Router, type Response } from 'express';
import { declarePeace, declareWar, getDiplomacy } from '../services/warService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import type { ActionResponse, DiplomacyResponse, ErrorResponse } from '../types/api.js';

export const warRouter: Router = Router();

warRouter.use(requireAuth);
warRouter.use(requireCommander);

/** Дипломатия и отчеты о боях. */
warRouter.get('/', async (req, res: Response<DiplomacyResponse>) => {
  res.json(await getDiplomacy(currentCommander(req).id));
});

/** Объявить войну игроку. */
warRouter.post('/declare', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const targetId = (req.body as { targetId?: unknown } | undefined)?.targetId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан противник' });
    return;
  }

  const result = await declareWar(currentCommander(req).id, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заключить мир. */
warRouter.post('/peace', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const targetId = (req.body as { targetId?: unknown } | undefined)?.targetId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан противник' });
    return;
  }

  const result = await declarePeace(currentCommander(req).id, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});
