import { Router, type Response } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { isBuildingType } from '../game/rules.js';
import { isTechnologyType } from '../game/techTree.js';
import { emptyShipCounts, isShipType, SHIP_TYPES } from '../game/ships.js';
import { isDefenseType } from '../game/defenses.js';
import { isFleetMission, planFlight } from '../game/fleets.js';
import { buildGalaxyMap, buildSystemMap } from '../services/mapService.js';
import { currentUser, requireAuth } from './middleware.js';
import { amountsOrNull, nonNegativeInt, positiveInt } from './validation.js';
import type {
  ActionResponse,
  ErrorResponse,
  FlightPreviewResponse,
  GalaxyResponse,
  MapResponse,
  StateResponse,
} from '../types/api.js';

export const gameRouter: Router = Router();

gameRouter.use(requireAuth);

/** Текущее состояние игрока: базы, очереди, технологии, флот. */
gameRouter.get('/state', async (req, res: Response<StateResponse | ErrorResponse>) => {
  const user = currentUser(req);
  await gameLoop.getUser(user.id);
  const payload = gameLoop.getSnapshot(user.id);

  if (!payload) {
    res.status(404).json({ error: 'Состояние игрока не найдено' });
    return;
  }
  res.json({ user: { id: user.id, username: user.username }, ...payload });
});

/** Поставить здание в стройку. */
gameRouter.post('/bases/:baseId/build', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const type = (req.body as { type?: unknown } | undefined)?.type;
  if (!isBuildingType(type)) {
    res.status(400).json({ error: 'Неизвестный тип постройки' });
    return;
  }

  const result = await gameLoop.startBuild(currentUser(req).id, req.params.baseId, type);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Запустить исследование в лаборатории базы. */
gameRouter.post('/bases/:baseId/research', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const tech = (req.body as { tech?: unknown } | undefined)?.tech;
  if (!isTechnologyType(tech)) {
    res.status(400).json({ error: 'Неизвестная технология' });
    return;
  }

  const result = await gameLoop.startResearch(currentUser(req).id, req.params.baseId, tech);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Карта системы с учетом тумана войны. */
/** Макро-карта галактики: все системы с координатами. */
gameRouter.get('/galaxy', async (req, res: Response<GalaxyResponse | ErrorResponse>) => {
  const galaxy = await buildGalaxyMap(currentUser(req).id);
  if (!galaxy) {
    res.status(404).json({ error: 'Галактика не найдена' });
    return;
  }
  res.json(galaxy);
});

/** Карта системы. Без параметра — родная система игрока. */
gameRouter.get('/map', async (req, res: Response<MapResponse | ErrorResponse>) => {
  const systemId = typeof req.query.systemId === 'string' ? req.query.systemId : undefined;
  const map = await buildSystemMap(currentUser(req).id, systemId);
  if (!map) {
    res.status(404).json({ error: 'Система не найдена' });
    return;
  }
  res.json(map);
});

/** Заказать корабли на верфи. */
gameRouter.post('/bases/:baseId/ships', async (req, res: Response<ActionResponse | ErrorResponse>) => {
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

  const result = await gameLoop.orderShips(currentUser(req).id, req.params.baseId, body.type, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заказать стационарную оборону на верфи. */
gameRouter.post('/bases/:baseId/defenses', async (req, res: Response<ActionResponse | ErrorResponse>) => {
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

  const result = await gameLoop.orderDefenses(currentUser(req).id, req.params.baseId, body.type, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

interface FleetRequestBody {
  targetPlanetId?: unknown;
  targetHubId?: unknown;
  targetSystemId?: unknown;
  mission?: unknown;
  ships?: Record<string, unknown>;
  cargo?: { metal?: unknown; crystal?: unknown };
  pickup?: { metal?: unknown; crystal?: unknown };
}

function readTarget(body: FleetRequestBody): { planetId?: string; hubId?: string; systemId?: string } {
  const target: { planetId?: string; hubId?: string; systemId?: string } = {};
  if (typeof body.targetPlanetId === 'string') target.planetId = body.targetPlanetId;
  if (typeof body.targetHubId === 'string') target.hubId = body.targetHubId;
  if (typeof body.targetSystemId === 'string') target.systemId = body.targetSystemId;
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
gameRouter.post('/bases/:baseId/fleets/preview', async (req, res: Response<FlightPreviewResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as FleetRequestBody;
  const user = await gameLoop.getUser(currentUser(req).id);
  const base = user?.bases.get(req.params.baseId);
  if (!user || !base) {
    res.status(404).json({ error: 'База не найдена' });
    return;
  }

  const target = await gameLoop.getTargetLocation(readTarget(body));
  if (!target) {
    res.status(404).json({ error: 'Цель полета не найдена' });
    return;
  }

  const ships = readShips(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Некорректный состав флота' });
    return;
  }

  res.json(planFlight(ships, user.techs, { position: base.position, system: base.galaxy }, target));
});

/** Отправить флот с базы на другую планету. */
gameRouter.post('/bases/:baseId/fleets', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as FleetRequestBody;

  if (!isFleetMission(body.mission)) {
    res.status(400).json({ error: 'Неизвестный тип миссии' });
    return;
  }

  // Экспедиция без явной цели уходит в глубокий космос родной системы.
  const target = readTarget(body);
  const targetless = !target.planetId && !target.hubId && !target.systemId;
  if (targetless && body.mission !== 'EXPEDITION') {
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
    currentUser(req).id,
    req.params.baseId,
    target,
    body.mission,
    ships,
    cargo,
    pickup,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
