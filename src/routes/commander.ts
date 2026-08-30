/**
 * Инструменты командира: боевой симулятор и шаблоны флотов.
 *
 * Симулятор ничего не пишет в БД — это чистый расчет по тем же формулам,
 * что и настоящий бой. Шаблоны хранятся у командира и от базы не зависят.
 */
import { Router, type Response } from 'express';
import { emptyDefenseCounts, DEFENSE_TYPES, isDefenseType } from '../game/defenses.js';
import { fleetSize } from '../game/fleets.js';
import {
  createTemplate,
  deleteTemplate,
  listTemplates,
  updateTemplate,
  validateTemplateName,
} from '../services/fleetTemplateService.js';
import { listEspionageTargets } from '../services/mapService.js';
import { simulateBattle, type SimulationStock } from '../services/simulationService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import { nonNegativeInt, shipCountsOrNull } from './validation.js';
import type {
  ActionResponse,
  ErrorResponse,
  EspionageResponse,
  FleetTemplatesResponse,
  SimulationResponse,
} from '../types/api.js';

export const commanderRouter = Router();

commanderRouter.use(requireAuth);
commanderRouter.use(requireCommander);

/* ------------------------- Боевой симулятор ------------------------- */

interface SimulationBody {
  attacker?: { ships?: unknown };
  defender?: { ships?: unknown; defenses?: unknown; stock?: unknown };
}

/** Стационарная оборона из тела запроса: только известные типы. */
function readDefenses(input: unknown): ReturnType<typeof emptyDefenseCounts> | null {
  const source = (input ?? {}) as Record<string, unknown>;
  const defenses = emptyDefenseCounts();

  for (const key of Object.keys(source)) {
    if (!isDefenseType(key)) return null;
  }
  for (const type of DEFENSE_TYPES) {
    const count = nonNegativeInt(source[type]);
    if (count === null) return null;
    defenses[type] = count;
  }
  return defenses;
}

/** Склад защитника: необязателен, но без него нельзя посчитать добычу. */
function readStock(input: unknown): SimulationStock | null | 'INVALID' {
  if (input === undefined || input === null) return null;
  const source = input as Record<string, unknown>;

  const titanite = nonNegativeInt(source['titanite']);
  const silicate = nonNegativeInt(source['silicate']);
  const tritium = nonNegativeInt(source['tritium']);
  const storageLevel = nonNegativeInt(source['storageLevel']);
  if (titanite === null || silicate === null || tritium === null || storageLevel === null) {
    return 'INVALID';
  }
  return { titanite, silicate, tritium, storageLevel };
}

/**
 * Прогон боя без записи в БД.
 * Ограничений по «своим» кораблям нет намеренно: симулятор — это калькулятор
 * планирования, в нем считают и тот флот, который еще только собираются строить.
 */
commanderRouter.post('/simulate', (req, res: Response<SimulationResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as SimulationBody;

  const attackerShips = shipCountsOrNull(body.attacker?.ships);
  const defenderShips = shipCountsOrNull(body.defender?.ships);
  if (!attackerShips || !defenderShips) {
    res.status(400).json({ error: 'Состав флота: нужны целые неотрицательные значения' });
    return;
  }

  const defenderDefenses = readDefenses(body.defender?.defenses);
  if (!defenderDefenses) {
    res.status(400).json({ error: 'Состав обороны: нужны целые неотрицательные значения' });
    return;
  }

  const stock = readStock(body.defender?.stock);
  if (stock === 'INVALID') {
    res.status(400).json({ error: 'Склад защитника: нужны целые неотрицательные значения' });
    return;
  }

  if (fleetSize(attackerShips) <= 0) {
    res.status(400).json({ error: 'Атакующий флот пуст: некого отправлять' });
    return;
  }

  res.json(simulateBattle(attackerShips, defenderShips, defenderDefenses, stock));
});

/* ------------------------- Шаблоны флотов ------------------------- */

commanderRouter.get('/fleet-templates', async (req, res: Response<FleetTemplatesResponse>) => {
  res.json({ templates: await listTemplates(currentCommander(req).id) });
});

commanderRouter.post('/fleet-templates', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { name?: unknown; ships?: unknown };

  const name = validateTemplateName(body.name);
  if (!name) {
    res.status(400).json({ error: 'Название шаблона: от 2 до 32 символов' });
    return;
  }

  const ships = shipCountsOrNull(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Состав шаблона: нужны целые неотрицательные значения' });
    return;
  }

  const result = await createTemplate(currentCommander(req).id, name, ships);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

commanderRouter.put('/fleet-templates/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { name?: unknown; ships?: unknown };

  const name = validateTemplateName(body.name);
  if (!name) {
    res.status(400).json({ error: 'Название шаблона: от 2 до 32 символов' });
    return;
  }

  const ships = shipCountsOrNull(body.ships);
  if (!ships) {
    res.status(400).json({ error: 'Состав шаблона: нужны целые неотрицательные значения' });
    return;
  }

  const result = await updateTemplate(currentCommander(req).id, req.params.id, name, ships);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

commanderRouter.delete('/fleet-templates/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await deleteTemplate(currentCommander(req).id, req.params.id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/* ------------------------- Разведданные для симулятора ------------------------- */

/**
 * Разведанные колонии: то, что можно подставить в симулятор одним кликом.
 * Отдаем только снимки, где данные еще не устарели, — по устаревшим
 * флот и оборона все равно скрыты.
 */
commanderRouter.get('/espionage', async (req, res: Response<EspionageResponse>) => {
  res.json({ targets: await listEspionageTargets(currentCommander(req).id) });
});
