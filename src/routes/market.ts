import { Router, type Response } from 'express';
import { isOrderSide, isTradeResource } from '../game/market.js';
import {
  acceptBarter,
  cancelBarter,
  cancelOrder,
  fillOrder,
  getMarketView,
  offerBarter,
  placeOrder,
  tradeWithStation,
  upgradeStorage,
} from '../services/marketService.js';
import { currentCommander, requireAuth, requireCommander } from './middleware.js';
import { positiveInt, positivePrice } from './validation.js';
import type { ActionResponse, ErrorResponse, MarketResponse } from '../types/api.js';

export const marketRouter: Router = Router();

marketRouter.use(requireAuth);
marketRouter.use(requireCommander);

/** Состояние биржи: склад на хабе, стакан, свои ордера и история сделок. */
marketRouter.get('/', async (req, res: Response<MarketResponse>) => {
  res.json(await getMarketView(currentCommander(req).id));
});

/** Расширение личного склада на хабе. */
marketRouter.post('/storage/upgrade', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await upgradeStorage(currentCommander(req).id);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Выставить ордер на покупку или продажу. */
marketRouter.post('/orders', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as {
    side?: unknown;
    resource?: unknown;
    quantity?: unknown;
    pricePerUnit?: unknown;
  };

  if (!isOrderSide(body.side)) {
    res.status(400).json({ error: 'Неизвестная сторона ордера' });
    return;
  }
  if (!isTradeResource(body.resource)) {
    res.status(400).json({ error: 'Этим ресурсом торговать нельзя' });
    return;
  }

  const quantity = positiveInt(body.quantity);
  const pricePerUnit = positivePrice(body.pricePerUnit);
  if (quantity === null) {
    res.status(400).json({ error: 'Объем должен быть целым положительным числом' });
    return;
  }
  if (pricePerUnit === null) {
    res.status(400).json({ error: 'Цена должна быть положительным числом' });
    return;
  }

  const result = await placeOrder(currentCommander(req).id, {
    side: body.side,
    resource: body.resource,
    quantity,
    pricePerUnit,
  });
  res.status(result.ok ? 200 : 409).json(result);
});

/** Исполнить чужой ордер целиком или частично. */
marketRouter.post('/orders/:orderId/fill', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const quantity = positiveInt((req.body as { quantity?: unknown } | undefined)?.quantity);
  if (quantity === null) {
    res.status(400).json({ error: 'Объем сделки должен быть целым положительным числом' });
    return;
  }

  const result = await fillOrder(currentCommander(req).id, req.params.orderId, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Снять свой ордер. */
marketRouter.delete('/orders/:orderId', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await cancelOrder(currentCommander(req).id, req.params.orderId);
  res.status(result.ok ? 200 : 409).json(result);
});


/**
 * Сделка со станцией. Она всегда готова купить и продать по своему коридору —
 * это единственный источник и сток криптогривны в игре.
 */
marketRouter.post('/station', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as { side?: unknown; resource?: unknown; quantity?: unknown };
  if (!isOrderSide(body.side) || !isTradeResource(body.resource)) {
    res.status(400).json({ error: 'Некорректная сделка' });
    return;
  }
  const quantity = positiveInt(body.quantity);
  if (quantity === null) {
    res.status(400).json({ error: 'Объем должен быть больше нуля' });
    return;
  }

  const result = await tradeWithStation(currentCommander(req).id, body.side, body.resource, quantity);
  res.status(result.ok ? 200 : 400).json(result.ok ? result : { error: result.error });
});

/** Выставить обмен ресурса на ресурс. Отдаваемое блокируется на складе. */
marketRouter.post('/barter', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const body = (req.body ?? {}) as Record<string, unknown>;
  if (!isTradeResource(body['giveResource']) || !isTradeResource(body['wantResource'])) {
    res.status(400).json({ error: 'Некорректные ресурсы обмена' });
    return;
  }
  const give = positiveInt(body['giveQuantity']);
  const want = positiveInt(body['wantQuantity']);
  if (give === null || want === null) {
    res.status(400).json({ error: 'Объемы обмена должны быть больше нуля' });
    return;
  }

  const result = await offerBarter(currentCommander(req).id, {
    giveResource: body['giveResource'],
    giveQuantity: give,
    wantResource: body['wantResource'],
    wantQuantity: want,
  });
  res.status(result.ok ? 200 : 400).json(result.ok ? result : { error: result.error });
});

/** Принять чужой обмен целиком. */
marketRouter.post('/barter/:offerId/accept', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await acceptBarter(currentCommander(req).id, req.params.offerId);
  res.status(result.ok ? 200 : 400).json(result.ok ? result : { error: result.error });
});

/** Снять свой обмен: залог возвращается на склад. */
marketRouter.delete('/barter/:offerId', async (req, res: Response<ActionResponse | ErrorResponse>) => {
  const result = await cancelBarter(currentCommander(req).id, req.params.offerId);
  res.status(result.ok ? 200 : 400).json(result.ok ? result : { error: result.error });
});
