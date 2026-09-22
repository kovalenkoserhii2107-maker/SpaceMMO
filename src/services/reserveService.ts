/**
 * Резерв хаба на живом сервере: правила — в чистом `game/reserve.ts`,
 * здесь только учетная запись, склад и заявки.
 *
 * Резерв — служебный командир с ролью бота: войти в него нельзя, колонии
 * у него нет, в рейтинге его нет, аренду он не платит. Заявки он ставит
 * тем же `placeOrder`, что и все, — поэтому залоги, сведение, комиссия
 * и склады у него ровно те же, и отдельной торговой механики нет.
 *
 * Раз в минуту он снимает свои заявки, доводит запас под импорт до нормы
 * и ставит заново: продажу по потолку и выкуп по полу на деньги фонда.
 * Снимать и ставить заново проще, чем править: фонд меняется между ходами,
 * а заявка, частично исполненная за минуту, все равно требует пересчета.
 */
import { prisma } from '../db/prisma.js';
import {
  RESERVE_ACCOUNT_LEVEL,
  RESERVE_EMAIL,
  RESERVE_IMPORT_LOT,
  RESERVE_NICKNAME,
  reserveQuotes,
} from '../game/reserve.js';
import { cancelOrder, placeOrder } from './marketService.js';

interface ReserveIdentity {
  commanderId: string;
  hubId: string;
}

let identity: ReserveIdentity | null = null;
let running = false;

/** Учетная запись резерва: заводится при первом ходе и дальше берется из памяти. */
export async function ensureReserve(): Promise<ReserveIdentity | null> {
  if (identity) return identity;
  // Какой хаб держит залог резерва, неважно: стакан общий. Берется первый
  // по id, чтобы после перезапуска он был тем же самым.
  const hub = await prisma.tradeHub.findFirst({ orderBy: { id: 'asc' }, select: { id: true } });
  if (!hub) return null;

  const user = await prisma.user.upsert({
    where: { email: RESERVE_EMAIL },
    create: { email: RESERVE_EMAIL, role: 'BOT', passwordHash: null },
    update: {},
  });
  const commander = await prisma.commander.upsert({
    where: { userId: user.id },
    // Фонд стартует пустым: денег резерв не печатает, наполняет его рынок.
    create: { userId: user.id, nickname: RESERVE_NICKNAME, credits: 0 },
    update: {},
  });
  await prisma.hubAccount.upsert({
    where: { commanderId: commander.id },
    create: { commanderId: commander.id, level: RESERVE_ACCOUNT_LEVEL },
    update: { level: RESERVE_ACCOUNT_LEVEL },
  });
  identity = { commanderId: commander.id, hubId: hub.id };
  return identity;
}

/** Ход резерва: снять свои заявки, довести импорт до нормы, выставить заново. */
export async function runReserve(): Promise<void> {
  if (running) return;
  running = true;
  try {
    const reserve = await ensureReserve();
    if (!reserve) return;

    const mine = await prisma.marketOrder.findMany({
      where: { commanderId: reserve.commanderId },
      select: { id: true },
    });
    for (const order of mine) await cancelOrder(reserve.commanderId, order.id);

    /*
     * Импорт: товар под продажу по потолку появляется из ничего — как у шахты.
     * Деньги при этом не создаются: они приходят от покупателя и уходят в фонд.
     */
    const account = await prisma.hubAccount.findUnique({
      where: { commanderId: reserve.commanderId },
      select: { id: true, ore: true, polymers: true },
    });
    if (!account) return;
    const topUp = {
      ore: Math.max(0, RESERVE_IMPORT_LOT - account.ore),
      polymers: Math.max(0, RESERVE_IMPORT_LOT - account.polymers),
    };
    if (topUp.ore > 0 || topUp.polymers > 0) {
      await prisma.hubAccount.update({
        where: { id: account.id },
        data: { ore: { increment: topUp.ore }, polymers: { increment: topUp.polymers } },
      });
    }

    const fund = await prisma.commander.findUnique({
      where: { id: reserve.commanderId },
      select: { credits: true },
    });
    for (const quote of reserveQuotes(fund?.credits ?? 0)) {
      const result = await placeOrder(
        reserve.commanderId,
        { side: quote.side, resource: quote.resource, quantity: quote.amount, pricePerUnit: quote.price },
        { hubId: reserve.hubId },
      );
      if (!result.ok) console.error(`[reserve] заявка не встала: ${result.error}`);
    }
  } catch (error) {
    console.error('[reserve] ход резерва сорвался', error);
  } finally {
    running = false;
  }
}
