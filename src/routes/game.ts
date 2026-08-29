import { Router, type Response } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { isBuildingType } from '../game/rules.js';
import { isTechnologyType } from '../game/techTree.js';
import { isShipType } from '../game/ships.js';
import { isDefenseType } from '../game/defenses.js';
import { isFleetMission, planFlight } from '../game/fleets.js';
import { buildGalaxyMap, buildSystemMap } from '../services/mapService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import { amountsOrNull, cargoOrNull, positiveInt, shipCountsOrNull } from './validation.js';
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
gameRouter.use(requireCommander);

/** Текущее состояние игрока: базы, очереди, технологии, флот. */
gameRouter.get('/state', async (req, res: Response<StateResponse | ErrorResponse>) => {
  const commander = currentCommander(req);
  await gameLoop.getCommander(commander.id);
  const payload = gameLoop.getSnapshot(commander.id);

  if (!payload) {
    res.status(404).json({ error: 'Состояние игрока не найдено' });
    return;
  }
  res.json({ commander: { id: commander.id, nickname: commander.nickname }, ...payload });
});

/** Поставить здание в стройку. */
gameRouter.post('/bases/:baseId/build', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const type = (req.body as { type?: unknown } | undefined)?.type;
  if (!isBuildingType(type)) {
    res.status(400).json({ error: 'Неизвестный тип постройки' });
    return;
  }

  const result = await gameLoop.startBuild(currentCommander(req).id, req.params.baseId, type);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Запустить исследование в лаборатории базы. */
gameRouter.post('/bases/:baseId/research', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const tech = (req.body as { tech?: unknown } | undefined)?.tech;
  if (!isTechnologyType(tech)) {
    res.status(400).json({ error: 'Неизвестная технология' });
    return;
  }

  const result = await gameLoop.startResearch(currentCommander(req).id, req.params.baseId, tech);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Карта системы с учетом тумана войны. */
/** Макро-карта галактики: все системы с координатами. */
gameRouter.get('/galaxy', async (req, res: Response<GalaxyResponse | ErrorResponse>) => {
  const galaxy = await buildGalaxyMap(currentCommander(req).id);
  if (!galaxy) {
    res.status(404).json({ error: 'Галактика не найдена' });
    return;
  }
  res.json(galaxy);
});

/** Карта системы. Без параметра — родная система игрока. */
gameRouter.get('/map', async (req, res: Response<MapResponse | ErrorResponse>) => {
  const systemId = typeof req.query.systemId === 'string' ? req.query.systemId : undefined;
  const map = await buildSystemMap(currentCommander(req).id, systemId);
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

  const result = await gameLoop.orderShips(currentCommander(req).id, req.params.baseId, body.type, quantity);
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

  const result = await gameLoop.orderDefenses(currentCommander(req).id, req.params.baseId, body.type, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

interface FleetRequestBody {
  targetPlanetId?: unknown;
  targetHubId?: unknown;
  targetSystemId?: unknown;
  mission?: unknown;
  ships?: Record<string, unknown>;
  cargo?: { metal?: unknown; crystal?: unknown; deuterium?: unknown };
  pickup?: { metal?: unknown; crystal?: unknown };
}

function readTarget(body: FleetRequestBody): { planetId?: string; hubId?: string; systemId?: string } {
  const target: { planetId?: string; hubId?: string; systemId?: string } = {};
  if (typeof body.targetPlanetId === 'string') target.planetId = body.targetPlanetId;
  if (typeof body.targetHubId === 'string') target.hubId = body.targetHubId;
  if (typeof body.targetSystemId === 'string') target.systemId = body.targetSystemId;
  return target;
}



/** Предрасчет маршрута: время, топливо, трюмы. Формулы остаются на сервере. */
gameRouter.post('/bases/:baseId/fleets/preview', async (req, res: Response<FlightPreviewResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as FleetRequestBody;
  const commander = await gameLoop.getCommander(currentCommander(req).id);
  const base = commander?.bases.get(req.params.baseId);
  if (!commander || !base) {
    res.status(404).json({ error: 'База не найдена' });
    return;
  }

  const target = await gameLoop.getTargetLocation(readTarget(body));
  if (!target) {
    res.status(404).json({ error: 'Цель полета не найдена' });
    return;
  }

  const ships = shipCountsOrNull(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Некорректный состав флота' });
    return;
  }

  res.json(planFlight(ships, commander.techs, { position: base.position, system: base.galaxy }, target));
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

  const ships = shipCountsOrNull(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Некорректный состав флота: нужны целые неотрицательные значения' });
    return;
  }

  const cargo = cargoOrNull(body.cargo);
  const pickup = amountsOrNull(body.pickup);
  if (!cargo || !pickup) {
    res.status(400).json({ error: 'Объем груза должен быть целым неотрицательным числом' });
    return;
  }

  const result = await gameLoop.sendFleet(
    currentCommander(req).id,
    req.params.baseId,
    target,
    body.mission,
    ships,
    cargo,
    pickup,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
