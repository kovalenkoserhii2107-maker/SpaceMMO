import { Router } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { isBuildingType } from '../game/rules.js';
import { isTechnologyType } from '../game/techTree.js';
import { emptyShipCounts, isShipType, SHIP_TYPES } from '../game/ships.js';
import { isDefenseType } from '../game/defenses.js';
import { isFleetMission, planFlight } from '../game/fleets.js';
import { buildSystemMap } from '../services/mapService.js';
import { requireAuth } from './middleware.js';
import { amountsOrNull, nonNegativeInt, positiveInt } from './validation.js';

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

  const quantity = positiveInt(body?.quantity ?? 1);
  if (quantity === null) {
    res.status(400).json({ error: 'Количество должно быть целым положительным числом' });
    return;
  }

  const result = await gameLoop.orderShips(req.userId as string, req.params.baseId, body.type, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заказать стационарную оборону на верфи. */
gameRouter.post('/bases/:baseId/defenses', async (req, res) => {
  const body = req.body as { type?: unknown; quantity?: unknown } | undefined;
  if (!isDefenseType(body?.type)) {
    res.status(400).json({ error: 'Неизвестный тип обороны' });
    return;
  }

  const quantity = positiveInt(body?.quantity ?? 1);
  if (quantity === null) {
    res.status(400).json({ error: 'Количество должно быть целым положительным числом' });
    return;
  }

  const result = await gameLoop.orderDefenses(req.userId as string, req.params.baseId, body.type, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

interface FleetRequestBody {
  targetPlanetId?: unknown;
  targetHubId?: unknown;
  mission?: unknown;
  ships?: Record<string, unknown>;
  cargo?: { metal?: unknown; crystal?: unknown };
  pickup?: { metal?: unknown; crystal?: unknown };
}

function readTarget(body: FleetRequestBody): { planetId?: string; hubId?: string } {
  const target: { planetId?: string; hubId?: string } = {};
  if (typeof body.targetPlanetId === 'string') target.planetId = body.targetPlanetId;
  if (typeof body.targetHubId === 'string') target.hubId = body.targetHubId;
  return target;
}

/** Состав флота: только целые неотрицательные значения, иначе запрос отклоняется. */
function readShips(input: Record<string, unknown> | undefined) {
  const ships = emptyShipCounts();
  for (const type of SHIP_TYPES) {
    const count = nonNegativeInt(input?.[type]);
    if (count === null) return null;
    ships[type] = count;
  }
  return ships;
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

  const target = await gameLoop.getTargetPosition(readTarget(body));
  if (target === null) {
    res.status(404).json({ error: 'Цель полета не найдена' });
    return;
  }

  const ships = readShips(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Некорректный состав флота' });
    return;
  }

  res.json(planFlight(ships, user.techs, base.position, target));
});

/** Отправить флот с базы на другую планету. */
gameRouter.post('/bases/:baseId/fleets', async (req, res) => {
  const body = (req.body ?? {}) as FleetRequestBody;

  if (!isFleetMission(body.mission)) {
    res.status(400).json({ error: 'Неизвестный тип миссии' });
    return;
  }

  const target = readTarget(body);
  if (!target.planetId && !target.hubId) {
    res.status(400).json({ error: 'Не указана цель полета' });
    return;
  }

  const ships = readShips(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Некорректный состав флота: нужны целые неотрицательные значения' });
    return;
  }

  const cargo = amountsOrNull(body.cargo);
  const pickup = amountsOrNull(body.pickup);
  if (!cargo || !pickup) {
    res.status(400).json({ error: 'Объем груза должен быть целым неотрицательным числом' });
    return;
  }

  const result = await gameLoop.sendFleet(
    req.userId as string,
    req.params.baseId,
    target,
    body.mission,
    ships,
    cargo,
    pickup,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
