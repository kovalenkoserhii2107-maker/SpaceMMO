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

  const result = await placeOrder(req.userId as string, {
    side: body.side,
    resource: body.resource,
    quantity: Math.floor(Number(body.quantity)),
    pricePerUnit: Math.round(Number(body.pricePerUnit) * 100) / 100,
  });
  res.status(result.ok ? 200 : 409).json(result);
});

/** Исполнить чужой ордер целиком или частично. */
marketRouter.post('/orders/:orderId/fill', async (req, res) => {
  const quantity = Math.floor(Number((req.body as { quantity?: unknown } | undefined)?.quantity));
  const result = await fillOrder(req.userId as string, req.params.orderId, quantity);
  res.status(result.ok ? 200 : 409).json(result);
});

/** Снять свой ордер. */
marketRouter.delete('/orders/:orderId', async (req, res) => {
  const result = await cancelOrder(req.userId as string, req.params.orderId);
  res.status(result.ok ? 200 : 409).json(result);
});
