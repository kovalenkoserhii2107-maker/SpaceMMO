/**
 * Пульт гейм-мастера.
 *
 * Весь раздел закрыт `requireAdmin`, и проверка стоит на самом роутере,
 * а не на отдельных путях: новый эндпоинт наследует защиту автоматически
 * и не может оказаться открытым по забывчивости.
 */
import { Router, type Response } from 'express';
import {
  adminSchema,
  applyPatch,
  getCommanderDetail,
  listCommanders,
  parsePatch,
} from '../services/adminService.js';
import { currentAccount, requireAdmin, requireAuth } from './middleware.js';
import type { ActionResponse, AdminDetailResponse, AdminListResponse, ErrorResponse } from '../types/api.js';

export const adminRouter = Router();

adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

/** Справочник ключей для формы: клиент не хардкодит перечисления. */
adminRouter.get('/schema', (_req, res) => {
  res.json(adminSchema());
});

/** Список командиров с поиском по позывному. */
adminRouter.get('/commanders', async (req, res: Response<AdminListResponse>) => {
  const search = typeof req.query['search'] === 'string' ? req.query['search'] : undefined;
  res.json({ commanders: await listCommanders(search) });
});

/** Полный стейт игрока: ресурсы, здания, технологии, флот, склады хаба. */
adminRouter.get('/commanders/:id', async (req, res: Response<AdminDetailResponse | ErrorResponse>) => {
  const detail = await getCommanderDetail(req.params.id);
  if (!detail) {
    res.status(404).json({ error: 'Командир не найден' });
    return;
  }
  res.json(detail);
});

/** God Mode: принудительная правка состояния игрока. */
adminRouter.patch('/commanders/:id', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const patch = parsePatch(req.body);
  if (!patch) {
    res.status(400).json({ error: 'Некорректный набор изменений' });
    return;
  }

  const result = await applyPatch(currentAccount(req).email, req.params.id, patch);
  res.status(result.ok ? 200 : result.status).json(result.ok ? result : { error: result.error });
});
