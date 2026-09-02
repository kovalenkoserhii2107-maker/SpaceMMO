import { Router, type Response } from 'express';
import { gameLoop } from '../game/gameLoop.js';
import { isBuildingType } from '../game/rules.js';
import { isTechnologyType } from '../game/techTree.js';
import { isShipType } from '../game/ships.js';
import { isDefenseType } from '../game/defenses.js';
import { isFleetMission, planFlight, resolveOneWay } from '../game/fleets.js';
import { buildGalaxyMap, buildSystemMap } from '../services/mapService.js';
import { prisma } from '../db/prisma.js';
import { attackWarning } from '../services/warService.js';
import { getLeaderboard } from '../services/scoreService.js';
import { getBuildingProjection } from '../services/buildingService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import { amountsOrNull, cargoOrNull, positiveInt, shipCountsOrNull } from './validation.js';
import type { BuildingProjection } from '../types/socket.js';
import type {
  ActionResponse,
  ErrorResponse,
  FlightPreviewResponse,
  LeaderboardResponse,
  GalaxyResponse,
  MapResponse,
  PlanetLookupResponse,
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
/**
 * Подробности постройки: описание и десять уровней вперед.
 *
 * Отдельным запросом, а не полем снимка: таблица нужна только на открытой
 * карточке, а снимок уходит в сокет каждую секунду.
 */
gameRouter.get(
  '/bases/:baseId/buildings/:type',
  async (req, res: Response<BuildingProjection | ErrorResponse>) => {
    const type = req.params.type;
    if (!isBuildingType(type)) {
      res.status(400).json({ error: 'Неизвестная постройка' });
      return;
    }

    const projection = await getBuildingProjection(currentCommander(req).id, req.params.baseId, type);
    if (!projection) {
      res.status(404).json({ error: 'База не найдена' });
      return;
    }
    res.json(projection);
  },
);

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
  cargo?: { ore?: unknown; polymers?: unknown; plasma?: unknown };
  pickup?: { ore?: unknown; polymers?: unknown };
  /** Оставить флот у цели. Действует только там, где выбор вообще есть. */
  oneWay?: unknown;
}

function readTarget(body: FleetRequestBody): { planetId?: string; hubId?: string; systemId?: string } {
  const target: { planetId?: string; hubId?: string; systemId?: string } = {};
  if (typeof body.targetPlanetId === 'string') target.planetId = body.targetPlanetId;
  if (typeof body.targetHubId === 'string') target.hubId = body.targetHubId;
  if (typeof body.targetSystemId === 'string') target.systemId = body.targetSystemId;
  return target;
}



/**
 * Рейтинг: командиры и синдикаты по вложенным ресурсам.
 * Требует командира — таблица показывает и собственную строку игрока.
 */
gameRouter.get('/leaderboard', async (req, res: Response<LeaderboardResponse>) => {
  res.json(await getLeaderboard(currentCommander(req).id));
});

/**
 * Поиск планеты по координатам «система X:Y, орбита N».
 *
 * Нужен шагу «Цель» в отправке флота: набрать координаты быстрее, чем искать
 * планету на карте галактики, а для чужих систем карта еще и не открыта.
 * Отдаем только опознание цели — имя и владельца, — то есть ровно то, что и так
 * видно на карте системы. Содержимое колонии остается за туманом войны.
 */
gameRouter.get('/planets/at', async (req, res: Response<PlanetLookupResponse | ErrorResponse>) => {
  const x = Number.parseInt(String(req.query['x'] ?? ''), 10);
  const y = Number.parseInt(String(req.query['y'] ?? ''), 10);
  const position = Number.parseInt(String(req.query['position'] ?? ''), 10);

  if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(position)) {
    res.status(400).json({ error: 'Координаты задаются целыми числами: X:Y:орбита' });
    return;
  }

  const planet = await prisma.planet.findFirst({
    where: { system: { galaxyX: x, galaxyY: y }, position },
    include: { system: true, base: { include: { commander: { select: { nickname: true } } } } },
  });
  if (!planet) {
    res.status(404).json({ error: `По координатам ${x}:${y}:${position} планеты нет` });
    return;
  }

  res.json({
    planetId: planet.id,
    planetName: planet.name,
    systemId: planet.systemId,
    systemName: planet.system.name,
    position: planet.position,
    galaxyX: planet.system.galaxyX,
    galaxyY: planet.system.galaxyY,
    owner: planet.base?.commander.nickname ?? null,
    isOwn: planet.base?.commanderId === currentCommander(req).id,
  });
});

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

  // Миссия влияет на расход: рейс в один конец не платит за обратный путь.
  // Ее может не быть — тогда считаем обычный рейс туда и обратно.
  const oneWay =
    isFleetMission(body.mission) && resolveOneWay(body.mission, body.oneWay === true);

  const plan = planFlight(
    ships,
    commander.techs,
    { position: base.position, system: base.galaxy },
    target,
    { oneWay },
  );

  // Предупреждение считается только для атаки и только по живой цели:
  // на остальных миссиях предупреждать не о чем, а лишний запрос к БД
  // предпросмотр дергает на каждое изменение состава.
  const defenderId = body.mission === 'ATTACK' ? await gameLoop.planetOwner(readTarget(body)) : null;
  const warning = defenderId ? await attackWarning(currentCommander(req).id, defenderId) : null;

  res.json({ ...plan, warning });
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
    body.oneWay === true,
  );
  res.status(result.ok ? 200 : 409).json(result);
});
