import { Router } from 'express';
import { isOrderSide, isTradeResource } from '../game/market.js';
import {
  cancelOrder,
  fillOrder,
  getMarketView,
  placeOrder,
  upgradeStorage,
} from '../services/marketService.js';
import { requireAuth } from './middleware.js';
import { positiveInt, positivePrice } from './validation.js';

export const marketRouter: Router = Router();

marketRouter.use(requireAuth);

/** Состояние биржи: склад на хабе, стакан, свои ордера и история сделок. */
marketRouter.get('/', async (req, res) => {
  res.json(await getMarketView(req.userId as string));
});

/** Расширение личного склада на хабе. */
marketRouter.post('/storage/upgrade', async (req, res) => {
  const result = await upgradeStorage(req.userId as string);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Выставить ордер на покупку или продажу. */
marketRouter.post('/orders', async (req, res) => {
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

  const result = await placeOrder(req.userId as string, {
    side: body.side,
    resource: body.resource,
    quantity,
    pricePerUnit,
  });
  res.status(result.ok ? 200 : 409).json(result);
});

/** Исполнить чужой ордер целиком или частично. */
marketRouter.post('/orders/:orderId/fill', async (req, res) => {
  const quantity = positiveInt((req.body as { quantity?: unknown } | undefined)?.quantity);
  if (quantity === null) {
    res.status(400).json({ error: 'Объем сделки должен быть целым положительным числом' });
    return;
  }

  const result = await fillOrder(req.userId as string, req.params.orderId, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Снять свой ордер. */
marketRouter.delete('/orders/:orderId', async (req, res) => {
  const result = await cancelOrder(req.userId as string, req.params.orderId);
  res.status(result.ok ? 200 : 409).json(result);
});
