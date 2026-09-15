import { Router, type Response } from 'express';
import { isDefenseType } from '../game/defenses.js';
import { gameLoop } from '../game/gameLoop.js';
import { validateBody, validateSubject } from '../services/mailService.js';
import {
  applyToSyndicate,
  assignRank,
  broadcast,
  createRank,
  createSyndicate,
  deleteRank,
  disbandSyndicate,
  donate,
  getCodex,
  getOverview,
  kickMember,
  leaveSyndicate,
  MAX_ENTRY_FEE,
  normalizeName,
  normalizeTag,
  payout,
  reviewApplication,
  setTaxRate,
  transferLeadership,
  updateCodex,
  updateRank,
  updateRules,
  upgradeKish,
  upgradeWatch,
  upgradeTreasury,
  updateDescription,
  getSyndicateProjection,
  buyKishDefense,
  buildGate,
  moveKish,
  upgradeAcademy,
  startSyndicateResearch,
  type RankInput,
  type SyndicateOverview,
  type SyndicateResult,
} from '../services/syndicateService.js';
import {
  isSyndicateModule,
  isSyndicateTech,
  type SyndicateProjection,
  DESCRIPTION_MAX_LENGTH,
  normalizeDescription,
  CODEX_MAX_LENGTH,
  MAX_TAX_RATE,
  isSyndicatePermission,
  normalizeCodex,
  normalizeRankName,
} from '../game/syndicate.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import type { ActionResponse, ErrorResponse } from '../types/api.js';

export const syndicateRouter: Router = Router();

syndicateRouter.use(requireAuth);
syndicateRouter.use(requireCommander);

/** Список синдикатов, свой синдикат и состояние заявки. */
syndicateRouter.get('/', async (req, res: Response<SyndicateOverview>) => {
  res.json(await getOverview(currentCommander(req).id));
});

/** Основать синдикат за криптогривну. */
syndicateRouter.post('/', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { name?: unknown; tag?: unknown };
  const name = normalizeName(body.name);
  const tag = normalizeTag(body.tag);

  if (!name) {
    res.status(400).json({ error: 'Название: от 3 до 32 символов' });
    return;
  }
  if (!tag) {
    res.status(400).json({ error: 'Тег: от 2 до 5 букв или цифр' });
    return;
  }

  const result = await createSyndicate(currentCommander(req).id, name, tag);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/**
 * Целое число из тела запроса. `Number()` здесь нельзя (правило 13): он
 * превращает `null`, пустую строку и `[]` в ноль, и пустое поле формы
 * молча обнуляло бы взнос или налог вместо отказа.
 */
function integerIn(value: unknown, min: number, max: number): number | null {
  if (typeof value !== 'number' || !Number.isInteger(value)) return null;
  return value >= min && value <= max ? value : null;
}

function send(res: Response<ActionResponse | ErrorResponse>, result: SyndicateResult): void {
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
}

/** Кодекс синдиката — кандидат читает его до подачи заявки. */
syndicateRouter.get('/:syndicateId/codex', async (req, res) => {
  res.json({ codex: await getCodex(req.params.syndicateId) });
});

/** Подать заявку на вступление. При открытом наборе — вступить сразу. */
syndicateRouter.post('/:syndicateId/apply', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const codexId = (req.body as { codexId?: unknown } | undefined)?.codexId;
  send(res, await applyToSyndicate(
    currentCommander(req).id,
    req.params.syndicateId,
    typeof codexId === 'string' ? codexId : null,
  ));
});

/** Одобрить заявку. Право лидера и офицеров. */
syndicateRouter.post('/applications/:id/approve', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await reviewApplication(currentCommander(req).id, req.params.id, true);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Отклонить заявку. Право лидера и офицеров. */
syndicateRouter.post('/applications/:id/reject', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await reviewApplication(currentCommander(req).id, req.params.id, false);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Исключить участника: право исключать и ранг выше. */
syndicateRouter.post('/members/:commanderId/kick', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await kickMember(currentCommander(req).id, req.params.commanderId));
});

/** Назначить участнику ранг: право назначать, и ранг ниже своего. */
syndicateRouter.post('/members/:commanderId/rank', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const rankId = (req.body as { rankId?: unknown } | undefined)?.rankId;
  if (typeof rankId !== 'string') {
    res.status(400).json({ error: 'Не указан ранг' });
    return;
  }
  send(res, await assignRank(currentCommander(req).id, req.params.commanderId, rankId));
});

/** Передать лидерство. Право главаря. */
syndicateRouter.post('/members/:commanderId/leader', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await transferLeadership(currentCommander(req).id, req.params.commanderId));
});

/** Выдать участнику криптогривну из казны в пределах дневного лимита ранга. */
syndicateRouter.post('/members/:commanderId/payout', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const amount = integerIn((req.body as { amount?: unknown } | undefined)?.amount, 1, 1_000_000_000);
  if (amount === null) {
    res.status(400).json({ error: 'Сумма: целое число больше нуля' });
    return;
  }
  send(res, await payout(currentCommander(req).id, req.params.commanderId, amount));
});

function parseRank(body: unknown): RankInput | string {
  const raw = (body ?? {}) as { name?: unknown; position?: unknown; permissions?: unknown; dailyWithdrawLimit?: unknown };
  const name = normalizeRankName(raw.name);
  if (!name) return 'Название ранга: от 2 до 24 букв, цифр, пробелов или дефисов';
  const position = integerIn(raw.position, 0, 99);
  if (position === null) return 'Место ранга: целое число от 0 до 99';
  if (!Array.isArray(raw.permissions) || !raw.permissions.every(isSyndicatePermission)) {
    return 'Неизвестное право в списке';
  }
  const dailyWithdrawLimit = integerIn(raw.dailyWithdrawLimit, 0, 1_000_000_000);
  if (dailyWithdrawLimit === null) return 'Дневной лимит выдачи: целое число от нуля';
  return { name, position, permissions: [...new Set(raw.permissions)], dailyWithdrawLimit };
}

/** Ранги правит главарь. */
syndicateRouter.post('/ranks', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const input = parseRank(req.body);
  if (typeof input === 'string') {
    res.status(400).json({ error: input });
    return;
  }
  send(res, await createRank(currentCommander(req).id, input));
});

syndicateRouter.post('/ranks/:rankId', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const input = parseRank(req.body);
  if (typeof input === 'string') {
    res.status(400).json({ error: input });
    return;
  }
  send(res, await updateRank(currentCommander(req).id, req.params.rankId, input));
});

syndicateRouter.post('/ranks/:rankId/delete', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await deleteRank(currentCommander(req).id, req.params.rankId));
});

/** Правила набора: режим, минимальный рейтинг, вступительный взнос. */
syndicateRouter.post('/rules', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { recruitment?: unknown; minScore?: unknown; entryFee?: unknown };
  if (body.recruitment !== 'OPEN' && body.recruitment !== 'APPLICATION' && body.recruitment !== 'CLOSED') {
    res.status(400).json({ error: 'Неизвестный режим набора' });
    return;
  }
  const minScore = integerIn(body.minScore, 0, 1_000_000_000_000);
  const entryFee = integerIn(body.entryFee, 0, MAX_ENTRY_FEE);
  if (minScore === null) {
    res.status(400).json({ error: 'Минимальный рейтинг: целое число от нуля' });
    return;
  }
  if (entryFee === null) {
    res.status(400).json({ error: `Взнос: целое число от 0 до ${MAX_ENTRY_FEE}` });
    return;
  }
  send(res, await updateRules(currentCommander(req).id, { recruitment: body.recruitment, minScore, entryFee }));
});

/** Уровни вперед у модуля Коша; у Брамы — по системе, где она стоит или встанет. */
syndicateRouter.get('/projection/module/:module', async (req, res: Response<SyndicateProjection | ErrorResponse>) => {
  const module = req.params.module;
  if (!isSyndicateModule(module)) {
    res.status(400).json({ error: 'Неизвестный модуль Коша' });
    return;
  }
  const systemId = typeof req.query['systemId'] === 'string' ? req.query['systemId'] : null;
  const result = await getSyndicateProjection(currentCommander(req).id, { module, systemId });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.projection);
});

/** Уровни вперед у технологии синдиката. */
syndicateRouter.get('/projection/tech/:tech', async (req, res: Response<SyndicateProjection | ErrorResponse>) => {
  const tech = req.params.tech;
  if (!isSyndicateTech(tech)) {
    res.status(400).json({ error: 'Неизвестная технология синдиката' });
    return;
  }
  const result = await getSyndicateProjection(currentCommander(req).id, { tech });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result.projection);
});

/** Описание синдиката под названием. */
syndicateRouter.post('/description', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const text = normalizeDescription((req.body as { text?: unknown } | undefined)?.text);
  if (text === null) {
    res.status(400).json({ error: `Описание: текст до ${DESCRIPTION_MAX_LENGTH} знаков` });
    return;
  }
  send(res, await updateDescription(currentCommander(req).id, text));
});

/** Ставка налога с крипто-фермы. */
syndicateRouter.post('/tax', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const rate = integerIn((req.body as { rate?: unknown } | undefined)?.rate, 0, MAX_TAX_RATE);
  if (rate === null) {
    res.status(400).json({ error: `Налог: целое число от 0 до ${MAX_TAX_RATE}` });
    return;
  }
  send(res, await setTaxRate(currentCommander(req).id, rate));
});

/** Новая редакция кодекса. Пустой текст снимает кодекс. */
syndicateRouter.post('/codex', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const text = normalizeCodex((req.body as { text?: unknown } | undefined)?.text);
  if (text === null) {
    res.status(400).json({ error: `Кодекс: текст до ${CODEX_MAX_LENGTH} знаков` });
    return;
  }
  send(res, await updateCodex(currentCommander(req).id, text));
});

/** Повысить Кіш из казны. */
syndicateRouter.post('/kish/upgrade', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await upgradeKish(currentCommander(req).id));
});

/** Повысить Скарбницю. */
syndicateRouter.post('/treasury/upgrade', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await upgradeTreasury(currentCommander(req).id));
});

/** Поставить оборону у Коша из казны. */
syndicateRouter.post('/kish/defenses', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { type?: unknown; quantity?: unknown };
  if (!isDefenseType(body.type)) {
    res.status(400).json({ error: 'Неизвестный тип обороны' });
    return;
  }
  const quantity = integerIn(body.quantity, 1, 100);
  if (quantity === null) {
    res.status(400).json({ error: 'Количество: целое число от 1 до 100' });
    return;
  }
  send(res, await buyKishDefense(currentCommander(req).id, body.type, quantity));
});

/** Построить или повысить Браму в системе. */
syndicateRouter.post('/gates', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const systemId = (req.body as { systemId?: unknown } | undefined)?.systemId;
  if (typeof systemId !== 'string') {
    res.status(400).json({ error: 'Не указана система' });
    return;
  }
  send(res, await buildGate(currentCommander(req).id, systemId));
});

/** Перенести Кіш в систему со своей Брамой. */
syndicateRouter.post('/kish/move', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const systemId = (req.body as { systemId?: unknown } | undefined)?.systemId;
  if (typeof systemId !== 'string') {
    res.status(400).json({ error: 'Не указана система' });
    return;
  }
  send(res, await moveKish(currentCommander(req).id, systemId));
});

/** Построить или повысить Академию из казны. */
syndicateRouter.post('/academy/upgrade', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await upgradeAcademy(currentCommander(req).id));
});

/** Начать изучение технологии синдиката. */
syndicateRouter.post('/research', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const tech = (req.body as { tech?: unknown } | undefined)?.tech;
  if (!isSyndicateTech(tech)) {
    res.status(400).json({ error: 'Неизвестная технология синдиката' });
    return;
  }
  send(res, await startSyndicateResearch(currentCommander(req).id, tech));
});

/** Построить или повысить Дозор из казны. */
syndicateRouter.post('/watch/upgrade', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  send(res, await upgradeWatch(currentCommander(req).id));
});

/** Рассылка по синдикату: одно письмо всему составу. */
syndicateRouter.post('/broadcast', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { subject?: unknown; body?: unknown };

  const subject = validateSubject(body.subject);
  const text = validateBody(body.body);
  if (!subject) {
    res.status(400).json({ error: 'Тема: от 1 до 120 символов' });
    return;
  }
  if (!text) {
    res.status(400).json({ error: 'Текст рассылки: от 1 до 4000 символов' });
    return;
  }

  const result = await broadcast(currentCommander(req).id, subject, text);
  if (result.ok) for (const id of result.recipients) gameLoop.pushUnread(id);
  res.status(result.ok ? 200 : result.status).json(
    result.ok ? { ok: true, message: result.message } : { error: result.error },
  );
});

/** Пожертвование в общий банк. */
syndicateRouter.post('/donate', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const amount = Math.floor(Number((req.body as { amount?: unknown } | undefined)?.amount));
  const result = await donate(currentCommander(req).id, amount);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Выйти из синдиката. */
syndicateRouter.post('/leave', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await leaveSyndicate(currentCommander(req).id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});

/** Распустить синдикат. Право лидера. */
syndicateRouter.post('/disband', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await disbandSyndicate(currentCommander(req).id);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});
