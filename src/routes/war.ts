import { Router } from 'express';
import { declarePeace, declareWar, getDiplomacy } from '../services/warService.js';
import { requireAuth } from './middleware.js';

export const warRouter: Router = Router();

warRouter.use(requireAuth);

/** Дипломатия и отчеты о боях. */
warRouter.get('/', async (req, res) => {
  res.json(await getDiplomacy(req.userId as string));
});

/** Объявить войну игроку. */
warRouter.post('/declare', async (req, res) => {
  const targetId = (req.body as { targetId?: unknown } | undefined)?.targetId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан противник' });
    return;
  }

  const result = await declareWar(req.userId as string, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заключить мир. */
warRouter.post('/peace', async (req, res) => {
  const targetId = (req.body as { targetId?: unknown } | undefined)?.targetId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан противник' });
    return;
  }

  const result = await declarePeace(req.userId as string, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});
