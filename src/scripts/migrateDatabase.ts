/**
 * Перенос базы целиком из одной PostgreSQL в другую.
 *
 * Написан на Prisma, а не на `pg_dump`, по двум причинам. Первая житейская:
 * клиентских утилит Postgres на машине может не быть вовсе, а Node и схема
 * есть всегда. Вторая важнее — схему на приемнике создают миграции
 * (`npm run migrate:deploy`), то есть она заведомо той же версии, что и код,
 * а не той, что была у источника на момент дампа.
 *
 * Порядок таблиц значения не имеет: на время переноса проверки внешних ключей
 * выключаются целиком (`session_replication_role = replica`). Иначе порядок
 * пришлось бы выстраивать вручную, а он местами циклический — у командира
 * есть синдикат, у синдиката лидер-командир, и вставить первым нельзя ни того,
 * ни другого.
 *
 * Приемник должен быть пуст: скрипт ничего не удаляет и не сливает. Повторный
 * запуск по непустой базе упрется в уникальные ключи, и это правильно —
 * молча дописывать половину строк в живую базу опаснее, чем упасть.
 *
 * Запуск:
 *   SOURCE_DATABASE_URL=... TARGET_DATABASE_URL=... npx tsx src/scripts/migrateDatabase.ts
 */
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

/**
 * Порядок все же осмысленный, хотя ключи и выключены: справочники раньше
 * зависимых таблиц дают читаемый лог и понятное место падения, если что-то
 * пойдет не так на середине.
 */
const MODELS = [
  'achievement', 'solarSystem', 'planet', 'tradeHub',
  'user', 'commander', 'bot', 'syndicate', 'syndicateBank',
  'syndicateTransaction', 'syndicateApplication', 'syndicateWar',
  'commanderAchievement', 'base', 'buildJob', 'research', 'researchJob',
  'ship', 'defense', 'defenseJob', 'shipJob', 'fleet', 'fleetTemplate',
  'planetScan', 'hubStorage', 'marketOrder', 'barterOffer', 'trade',
  'battleReport', 'expeditionReport', 'warDeclaration', 'message',
] as const;

/** Строки идут пачками: миллион записей одним `createMany` не проходит по памяти. */
const CHUNK = 500;

function client(url: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
}

const sourceUrl = process.env['SOURCE_DATABASE_URL'];
const targetUrl = process.env['TARGET_DATABASE_URL'];
if (!sourceUrl || !targetUrl) {
  console.error('Нужны SOURCE_DATABASE_URL и TARGET_DATABASE_URL');
  process.exit(1);
}
if (sourceUrl === targetUrl) {
  console.error('Источник и приемник совпадают — это почти наверняка ошибка');
  process.exit(1);
}

const source = client(sourceUrl);
const target = client(targetUrl);

// Проверки ключей выключаются на сессии приемника и только на ней.
await target.$executeRawUnsafe(`SET session_replication_role = 'replica'`);

let total = 0;
for (const model of MODELS) {
  /*
   * Делегаты выбираются по имени, поэтому типизировать их точно нечем:
   * у каждой модели свой тип строки, а скрипт по построению работает
   * со всеми сразу. Приведение через unknown — единственный честный способ
   * это записать; сохранность данных здесь проверяет не компилятор,
   * а сверка числа строк в конце.
   */
  const read = source[model] as unknown as { findMany: () => Promise<unknown[]> };
  const write = target[model] as unknown as {
    createMany: (args: { data: unknown[] }) => Promise<{ count: number }>;
  };

  const rows = await read.findMany();
  if (rows.length === 0) {
    console.log(`${model.padEnd(24)} пусто`);
    continue;
  }

  let written = 0;
  for (let at = 0; at < rows.length; at += CHUNK) {
    const result = await write.createMany({ data: rows.slice(at, at + CHUNK) });
    written += result.count;
  }
  total += written;
  console.log(`${model.padEnd(24)} ${String(written).padStart(7)} строк`);
}

await target.$executeRawUnsafe(`SET session_replication_role = 'origin'`);

console.log(`\nПеренесено строк: ${total}`);
console.log('Сверка по таблицам:');
let mismatch = 0;
for (const model of MODELS) {
  const count = (m: PrismaClient) =>
    (m[model] as unknown as { count: () => Promise<number> }).count();
  const [was, now] = await Promise.all([count(source), count(target)]);
  if (was !== now) {
    mismatch += 1;
    console.log(`  РАСХОЖДЕНИЕ ${model}: источник ${was}, приемник ${now}`);
  }
}
console.log(mismatch === 0 ? '  все таблицы сошлись' : `  таблиц с расхождением: ${mismatch}`);

await source.$disconnect();
await target.$disconnect();
process.exit(mismatch === 0 ? 0 : 1);
