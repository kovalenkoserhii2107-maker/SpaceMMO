/**
 * Склады командира на бирже: частные склады хабов и общий склад купленного.
 *
 * Привезенное флотом лежит на складе того хаба, куда его привезли, и забрать
 * его можно только там. Купленное и полученное обменом ложится на общий
 * склад, и его можно забрать с любого хаба. Размер склада один на все —
 * частные склады всех хабов и общий вместе.
 *
 * Так торговля общая на весь сервер, а бесплатно переслать ресурсы между
 * системами нельзя: из частного склада в общий товар попадает только
 * сделкой, то есть через другого игрока и комиссию биржи.
 *
 * Все изменения идут под advisory-блокировкой командира: вместимость
 * считается суммой по нескольким строкам, и условным UPDATE одной строки
 * ее не проверить.
 */
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import { storageCapacity } from '../game/market.js';

type Tx = Prisma.TransactionClient;
type Client = Tx | typeof prisma;
export type StockField = 'ore' | 'polymers';

/**
 * Торговый счет командира. Создается при первом обращении: у тех, кто торговал
 * до общего склада, уровень берется с самого развитого из прежних складов —
 * тогда размер был у каждого хаба свой, и расширенное не должно пропасть.
 */
export async function hubAccount(client: Client, commanderId: string) {
  const existing = await client.hubAccount.findUnique({ where: { commanderId } });
  if (existing) return existing;
  const best = await client.hubStorage.aggregate({ where: { commanderId }, _max: { level: true } });
  return client.hubAccount.upsert({
    where: { commanderId },
    create: { commanderId, level: Math.max(1, best._max.level ?? 1) },
    update: {},
  });
}

/** Блокировки берутся по возрастанию id: иначе две встречные сделки могли бы запереть друг друга. */
export async function lockHubStocks(tx: Tx, commanderIds: string[]): Promise<void> {
  for (const id of [...new Set(commanderIds)].sort()) {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${'hub:' + id}))::text AS locked`;
  }
}

export interface HubStockUsage {
  accountId: string;
  level: number;
  capacity: number;
  used: number;
  free: number;
  global: { ore: number; polymers: number };
  /** Сумма частных складов всех хабов. */
  local: { ore: number; polymers: number };
}

export async function hubStockUsage(client: Client, commanderId: string): Promise<HubStockUsage> {
  const account = await hubAccount(client, commanderId);
  const local = await client.hubStorage.aggregate({
    where: { commanderId },
    _sum: { ore: true, polymers: true },
  });
  const localOre = local._sum.ore ?? 0;
  const localPolymers = local._sum.polymers ?? 0;
  const used = account.ore + account.polymers + localOre + localPolymers;
  const capacity = storageCapacity(account.level);
  return {
    accountId: account.id,
    level: account.level,
    capacity,
    used,
    free: Math.max(0, capacity - used),
    global: { ore: account.ore, polymers: account.polymers },
    local: { ore: localOre, polymers: localPolymers },
  };
}

/** Купленное — на общий склад. `false` — места нет, и ничего не записано. */
export async function depositGlobal(tx: Tx, commanderId: string, field: StockField, amount: number): Promise<boolean> {
  if (amount <= 0) return true;
  await lockHubStocks(tx, [commanderId]);
  const usage = await hubStockUsage(tx, commanderId);
  if (usage.free < amount) return false;
  await tx.hubAccount.update({ where: { id: usage.accountId }, data: { [field]: { increment: amount } } });
  return true;
}

/** Привезенное — на склад хаба, в пределах свободного места. Возвращает, сколько легло. */
export async function depositLocal(
  tx: Tx,
  commanderId: string,
  hubId: string,
  cargo: { ore: number; polymers: number },
): Promise<{ ore: number; polymers: number }> {
  await lockHubStocks(tx, [commanderId]);
  const usage = await hubStockUsage(tx, commanderId);
  const ore = Math.max(0, Math.min(cargo.ore, usage.free));
  const polymers = Math.max(0, Math.min(cargo.polymers, usage.free - ore));
  if (ore > 0 || polymers > 0) {
    await tx.hubStorage.upsert({
      where: { commanderId_hubId: { commanderId, hubId } },
      create: { commanderId, hubId, ore, polymers },
      update: { ore: { increment: ore }, polymers: { increment: polymers } },
    });
  }
  return { ore, polymers };
}

/** Сколько доступно на хабе: его частный склад и общий. */
export async function availableAt(client: Client, commanderId: string, hubId: string): Promise<{ ore: number; polymers: number }> {
  const [account, storage] = await Promise.all([
    hubAccount(client, commanderId),
    client.hubStorage.findUnique({ where: { commanderId_hubId: { commanderId, hubId } } }),
  ]);
  return {
    ore: Math.max(0, storage?.ore ?? 0) + Math.max(0, account.ore),
    polymers: Math.max(0, storage?.polymers ?? 0) + Math.max(0, account.polymers),
  };
}

/**
 * Списание в залог или на вывоз: сначала склад хаба, потом общий.
 *
 * Возвращает, сколько взято со склада хаба, — по этой доле отмена вернет
 * товар туда, откуда он ушел. Иначе привезенное можно было бы выставить
 * на продажу, снять и получить уже на общем складе. `null` — не хватает.
 */
export async function withdrawStock(
  tx: Tx,
  commanderId: string,
  hubId: string,
  field: StockField,
  amount: number,
): Promise<{ local: number; global: number } | null> {
  await lockHubStocks(tx, [commanderId]);
  const account = await hubAccount(tx, commanderId);
  const storage = await tx.hubStorage.findUnique({ where: { commanderId_hubId: { commanderId, hubId } } });
  const local = Math.min(amount, Math.max(0, storage?.[field] ?? 0));
  const global = amount - local;
  if (global > Math.max(0, account[field])) return null;
  if (local > 0 && storage) {
    await tx.hubStorage.update({ where: { id: storage.id }, data: { [field]: { decrement: local } } });
  }
  if (global > 0) {
    await tx.hubAccount.update({ where: { id: account.id }, data: { [field]: { decrement: global } } });
  }
  return { local, global };
}

/**
 * Возврат своего товара туда, откуда он ушел, — без оглядки на лимит.
 * Это не новый товар, а свой же из снятой заявки: проверка места запирала бы
 * игрока в собственных заявках на полном складе.
 */
export async function refundStock(
  tx: Tx,
  commanderId: string,
  hubId: string,
  field: StockField,
  local: number,
  global: number,
): Promise<void> {
  if (local > 0) {
    await tx.hubStorage.upsert({
      where: { commanderId_hubId: { commanderId, hubId } },
      create: { commanderId, hubId, [field]: local },
      update: { [field]: { increment: local } },
    });
  }
  if (global > 0) {
    const account = await hubAccount(tx, commanderId);
    await tx.hubAccount.update({ where: { id: account.id }, data: { [field]: { increment: global } } });
  }
}
