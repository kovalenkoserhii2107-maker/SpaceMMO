import { Router } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { toSnapshot } from '../game/baseState.js';
import { isBuildingType } from '../game/rules.js';
import { requireAuth } from './middleware.js';

export const gameRouter: Router = Router();

gameRouter.use(requireAuth);

/** Текущее состояние всех баз игрока. */
gameRouter.get('/state', async (req, res) => {
  const userId = req.userId as string;
  const bases = await gameLoop.loadUserBases(userId);
  res.json({
    user: { id: userId, username: req.username },
    bases: bases.map(toSnapshot),
    serverTime: Date.now(),
  });
});

/** Постройка/улучшение здания на базе. Все проверки — на сервере. */
gameRouter.post('/bases/:baseId/build', async (req, res) => {
  const userId = req.userId as string;
  const baseId = req.params.baseId;
  const type = (req.body as { type?: unknown } | undefined)?.type;

  if (!isBuildingType(type)) {
    res.status(400).json({ error: 'Неизвестный тип постройки' });
    return;
  }

  const result = await gameLoop.upgrade(userId, baseId, type);
  if (!result.ok) {
    res.status(409).json(result);
    return;
  }
  res.json(result);
});
