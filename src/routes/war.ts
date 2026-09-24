import { Router, type Response } from 'express';
import {
  declarePeace,
  declareSyndicatePeace,
  declareSyndicateWar,
  declareWar,
  getDiplomacy,
} from '../services/warService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import { cancelPact, proposePact, respondPact } from '../services/pactService.js';
import {
  cancelGateLease,
  getGateLeases,
  offerGateLease,
  respondGateLease,
  type GateLeaseOverview,
} from '../services/gateLeaseService.js';
import { nonNegativeInt } from './validation.js';
import { isPactKind } from '../game/syndicate.js';
import type { ActionResponse, DiplomacyResponse, ErrorResponse } from '../types/api.js';

export const warRouter: Router = Router();

warRouter.use(requireAuth);
warRouter.use(requireCommander);

/** Дипломатия и отчеты о боях. */
warRouter.get('/', async (req, res: Response<DiplomacyResponse>) => {
  res.json(await getDiplomacy(currentCommander(req).id));
});

/** Объявить войну игроку. */
warRouter.post('/declare', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const targetId = (req.body as { targetId?: unknown } | undefined)?.targetId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан противник' });
    return;
  }

  const result = await declareWar(currentCommander(req).id, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Объявить войну вражескому синдикату. Право лидера и офицеров. */
warRouter.post('/syndicate/declare', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const targetId = (req.body as { targetSyndicateId?: unknown } | undefined)?.targetSyndicateId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан вражеский синдикат' });
    return;
  }

  const result = await declareSyndicateWar(currentCommander(req).id, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заключить мир между синдикатами. */
warRouter.post('/syndicate/peace', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const targetId = (req.body as { targetSyndicateId?: unknown } | undefined)?.targetSyndicateId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан синдикат' });
    return;
  }

  const result = await declareSyndicatePeace(currentCommander(req).id, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Заключить мир. */
warRouter.post('/peace', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const targetId = (req.body as { targetId?: unknown } | undefined)?.targetId;
  if (typeof targetId !== 'string') {
    res.status(400).json({ error: 'Не указан противник' });
    return;
  }

  const result = await declarePeace(currentCommander(req).id, targetId);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Предложить пакт другому синдикату. */
warRouter.post('/syndicate/pact/propose', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { targetSyndicateId?: unknown; type?: unknown };
  if (typeof body.targetSyndicateId !== 'string' || !isPactKind(body.type)) {
    res.status(400).json({ error: 'Укажи синдикат и вид пакта' });
    return;
  }
  const result = await proposePact(currentCommander(req).id, body.targetSyndicateId, body.type);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Принять или отклонить предложение пакта. */
warRouter.post('/syndicate/pact/respond', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { pactId?: unknown; accept?: unknown };
  if (typeof body.pactId !== 'string' || typeof body.accept !== 'boolean') {
    res.status(400).json({ error: 'Укажи предложение и ответ' });
    return;
  }
  const result = await respondPact(currentCommander(req).id, body.pactId, body.accept);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Отозвать предложение или расторгнуть пакт. */
warRouter.post('/syndicate/pact/cancel', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const pactId = (req.body as { pactId?: unknown } | undefined)?.pactId;
  if (typeof pactId !== 'string') {
    res.status(400).json({ error: 'Не указан пакт' });
    return;
  }
  const result = await cancelPact(currentCommander(req).id, pactId);
  res.status(result.ok ? 200 : 409).json(result);
});

/* ------------------------- Аренда Брам ------------------------- */

/** Договоры аренды: сданные своим синдикатом и взятые смотрящим или его синдикатом. */
warRouter.get('/gates/leases', async (req, res: Response<GateLeaseOverview>) => {
  res.json(await getGateLeases(currentCommander(req).id));
});

warRouter.post('/gates/leases', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { tenantKind?: unknown; tenant?: unknown; hours?: unknown; price?: unknown };
  const price = nonNegativeInt(body.price, Number.NaN);
  const hours = nonNegativeInt(body.hours, Number.NaN);
  if (
    (body.tenantKind !== 'PLAYER' && body.tenantKind !== 'SYNDICATE') ||
    typeof body.tenant !== 'string' || !body.tenant.trim() ||
    price === null || hours === null
  ) {
    res.status(400).json({ error: 'Укажи арендатора, срок и плату' });
    return;
  }
  const result = await offerGateLease(currentCommander(req).id, { tenantKind: body.tenantKind, tenant: body.tenant, hours, price });
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

warRouter.post('/gates/leases/:id/respond', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const accept = (req.body as { accept?: unknown } | undefined)?.accept;
  if (typeof accept !== 'boolean') {
    res.status(400).json({ error: 'Не указан ответ' });
    return;
  }
  const result = await respondGateLease(currentCommander(req).id, String(req.params.id), accept);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});

warRouter.post('/gates/leases/:id/cancel', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await cancelGateLease(currentCommander(req).id, String(req.params.id));
  if (!result.ok) {
    res.status(result.status).json({ error: result.error });
    return;
  }
  res.json(result);
});
