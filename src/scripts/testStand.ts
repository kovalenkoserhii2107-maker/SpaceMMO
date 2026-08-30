/**
 * Подготовка стенда для стресс-тестов и тестов синдикатов.
 *
 * Тесты гоняются по живому API, поэтому им нужны два подготовленных командира:
 * с криптогривной, товаром на складе хаба и вне синдикатов. Скрипт приводит
 * стенд в известное состояние и печатает конфигурацию для тестов.
 *
 * Перед подготовкой стенд удаляет одноразовые аккаунты прошлых прогонов —
 * иначе занятые ими колонии копятся и галактика заканчивается.
 *
 * Запуск: npm run --silent test:stand > stand.json
 */
import { prisma } from '../db/prisma.js';
import { cleanupTestAccounts } from './cleanupTestAccounts.js';

// Одноразовые аккаунты прошлых прогонов держат колонии и выедают галактику,
// поэтому стенд начинается с уборки: иначе онбординг однажды упрется
// в «нет свободных планет».
const cleaned = await cleanupTestAccounts();
if (cleaned.removed > 0) {
  console.error(
    `[stand] убрано одноразовых аккаунтов: ${cleaned.removed}, ` +
      `освобождено колоний: ${cleaned.freedPlanets}`,
  );
}

const ADMIRAL_PASSWORD = 'admiral-pass-123';
const PILOT_PASSWORD = 'pilot-pass-123';

const admiral = await prisma.commander.findUniqueOrThrow({
  where: { nickname: 'Адмирал' },
  include: { bases: true, user: true },
});
const pilot = await prisma.commander.findUniqueOrThrow({
  where: { nickname: 'Тестовый Пилот' },
  include: { bases: true, user: true },
});
const hub = await prisma.tradeHub.findFirstOrThrow({
  where: { system: { planets: { some: { base: { commanderId: admiral.id } } } } },
});

// Биржа и синдикаты: тесты рассчитывают на чистое состояние.
await prisma.marketOrder.deleteMany({});
for (const commander of [admiral, pilot]) {
  const leading = await prisma.syndicate.findUnique({ where: { leaderId: commander.id } });
  if (leading) await prisma.syndicate.delete({ where: { id: leading.id } });
}
await prisma.commander.updateMany({
  where: { id: { in: [admiral.id, pilot.id] } },
  data: { credits: 10000, syndicateId: null, syndicateRole: null },
});

for (const commander of [admiral, pilot]) {
  await prisma.hubStorage.upsert({
    where: { commanderId_hubId: { commanderId: commander.id, hubId: hub.id } },
    create: { commanderId: commander.id, hubId: hub.id, titanite: 20000, silicate: 20000, level: 8 },
    update: { titanite: 20000, silicate: 20000, level: 8 },
  });
}

console.log(
  JSON.stringify(
    {
      admiralEmail: admiral.user.email,
      admiralPassword: ADMIRAL_PASSWORD,
      admiralBase: admiral.bases[0]!.id,
      pilotEmail: pilot.user.email,
      pilotPassword: PILOT_PASSWORD,
      pilotBase: pilot.bases[0]!.id,
      hubId: hub.id,
    },
    null,
    2,
  ),
);

await prisma.$disconnect();
