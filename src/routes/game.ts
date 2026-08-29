import { Router } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { isBuildingType } from '../game/rules.js';
import { isTechnologyType } from '../game/techTree.js';
import { emptyShipCounts, isShipType, SHIP_TYPES } from '../game/ships.js';
import { isFleetMission, planFlight } from '../game/fleets.js';
import { buildSystemMap } from '../services/mapService.js';
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

/** Карта системы с учетом тумана войны. */
gameRouter.get('/map', async (req, res) => {
  const map = await buildSystemMap(req.userId as string);
  if (!map) {
    res.status(404).json({ error: 'Система не найдена' });
    return;
  }
  res.json(map);
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

interface FleetRequestBody {
  targetPlanetId?: unknown;
  mission?: unknown;
  ships?: Record<string, unknown>;
  cargo?: { metal?: unknown; crystal?: unknown };
}

/** Предрасчет маршрута: время, топливо, трюмы. Формулы остаются на сервере. */
gameRouter.post('/bases/:baseId/fleets/preview', async (req, res) => {
  const body = (req.body ?? {}) as FleetRequestBody;
  const user = await gameLoop.getUser(req.userId as string);
  const base = user?.bases.get(req.params.baseId);
  if (!user || !base) {
    res.status(404).json({ error: 'База не найдена' });
    return;
  }

  const target = await gameLoop.getPlanetPosition(String(body.targetPlanetId ?? ''));
  if (target === null) {
    res.status(404).json({ error: 'Планета не найдена' });
    return;
  }

  const ships = emptyShipCounts();
  for (const type of SHIP_TYPES) {
    ships[type] = Math.max(0, Math.floor(Number(body.ships?.[type] ?? 0)));
  }

  res.json(planFlight(ships, user.techs, base.position, target));
});

/** Отправить флот с базы на другую планету. */
gameRouter.post('/bases/:baseId/fleets', async (req, res) => {
  const body = (req.body ?? {}) as FleetRequestBody;

  if (typeof body.targetPlanetId !== 'string') {
    res.status(400).json({ error: 'Не указана планета назначения' });
    return;
  }
  if (!isFleetMission(body.mission)) {
    res.status(400).json({ error: 'Неизвестный тип миссии' });
    return;
  }

  const ships = emptyShipCounts();
  for (const type of SHIP_TYPES) {
    const raw = Number(body.ships?.[type] ?? 0);
    if (!Number.isFinite(raw) || raw < 0) {
      res.status(400).json({ error: 'Некорректный состав флота' });
      return;
    }
    ships[type] = Math.floor(raw);
  }

  const cargo = {
    metal: Math.max(0, Math.floor(Number(body.cargo?.metal ?? 0))),
    crystal: Math.max(0, Math.floor(Number(body.cargo?.crystal ?? 0))),
  };
  if (!Number.isFinite(cargo.metal) || !Number.isFinite(cargo.crystal)) {
    res.status(400).json({ error: 'Некорректный груз' });
    return;
  }

  const result = await gameLoop.sendFleet(
    req.userId as string,
    req.params.baseId,
    body.targetPlanetId,
    body.mission,
    ships,
    cargo,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
