import { Router } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { isBuildingType } from '../game/rules.js';
import { isTechnologyType } from '../game/techTree.js';
import { isShipType } from '../game/ships.js';
import { requireAuth } from './middleware.js';

export const gameRouter: Router = Router();

gameRouter.use(requireAuth);

/** Текущее состояние игрока: базы, очереди, технологии, флот. */
gameRouter.get('/state', async (req, res) => {
  const userId = req.userId as string;
  await gameLoop.getUser(userId);
  const payload = gameLoop.getSnapshot(userId);

  if (!payload) {
    res.status(404).json({ error: 'Состояние игрока не найдено' });
    return;
  }
  res.json({ user: { id: userId, username: req.username }, ...payload });
});

/** Поставить здание в стройку. */
gameRouter.post('/bases/:baseId/build', async (req, res) => {
  const type = (req.body as { type?: unknown } | undefined)?.type;
  if (!isBuildingType(type)) {
    res.status(400).json({ error: 'Неизвестный тип постройки' });
    return;
  }

  const result = await gameLoop.startBuild(req.userId as string, req.params.baseId, type);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Запустить исследование в лаборатории базы. */
gameRouter.post('/bases/:baseId/research', async (req, res) => {
  const tech = (req.body as { tech?: unknown } | undefined)?.tech;
  if (!isTechnologyType(tech)) {
    res.status(400).json({ error: 'Неизвестная технология' });
    return;
  }

  const result = await gameLoop.startResearch(req.userId as string, req.params.baseId, tech);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заказать корабли на верфи. */
gameRouter.post('/bases/:baseId/ships', async (req, res) => {
  const body = req.body as { type?: unknown; quantity?: unknown } | undefined;
  if (!isShipType(body?.type)) {
    res.status(400).json({ error: 'Неизвестный класс корабля' });
    return;
  }

  const quantity = Number(body?.quantity ?? 1);
  const result = await gameLoop.orderShips(req.userId as string, req.params.baseId, body.type, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});
