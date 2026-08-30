/**
 * Уборка одноразовых аккаунтов, которые создают тесты.
 *
 * Каждый прогон тестов регистрирует новых командиров, а вместе с ними навсегда
 * занимает стартовые планеты: галактика конечна, и рано или поздно онбординг
 * упирается в «нет свободных планет». Скрипт возвращает эти колонии в оборот.
 *
 * Операция необратимая, поэтому удаляем не «все тестовые на вид», а строго
 * то, что порождают скрипты из tests/: email вида `<префикс>-<суффикс>@spacemmo.local`
 * с известным префиксом. Постоянные аккаунты стенда (admiral@, pilot@) суффикса
 * не имеют и под шаблон не попадают — плюс защищены явным списком.
 *
 * Запуск: npm run test:cleanup
 */
import { prisma } from '../db/prisma.js';

/** Префиксы, которые генерируют скрипты из tests/. Держать в синхроне с ними. */
const THROWAWAY_PREFIXES = [
  'test', // auth.mjs
  'other', // auth.mjs
  'builder', // economy-build.mjs
  'commander', // commander.ts
  'stranger', // commander.ts
  'storage', // storage.ts
  'syn', // syndicates.mjs
] as const;

const TEST_DOMAIN = '@spacemmo.local';

/** Аккаунты стенда: их тесты переиспользуют, удалять нельзя ни при каких условиях. */
const PROTECTED_EMAILS = new Set(['admiral@spacemmo.local', 'pilot@spacemmo.local']);

/** Одноразовый ли это аккаунт: строгое совпадение с шаблоном тестового скрипта. */
export function isThrowawayAccount(email: string): boolean {
  const normalized = email.trim().toLowerCase();
  if (PROTECTED_EMAILS.has(normalized)) return false;
  if (!normalized.endsWith(TEST_DOMAIN)) return false;

  const local = normalized.slice(0, -TEST_DOMAIN.length);
  return THROWAWAY_PREFIXES.some((prefix) => new RegExp(`^${prefix}-[a-z0-9-]+$`).test(local));
}

export async function cleanupTestAccounts(): Promise<{ removed: number; freedPlanets: number }> {
  const candidates = await prisma.user.findMany({
    where: { email: { endsWith: TEST_DOMAIN } },
    select: { id: true, email: true, commander: { select: { bases: { select: { id: true } } } } },
  });

  const doomed = candidates.filter((user) => isThrowawayAccount(user.email));
  if (doomed.length === 0) return { removed: 0, freedPlanets: 0 };

  const freedPlanets = doomed.reduce((total, user) => total + (user.commander?.bases.length ?? 0), 0);

  // Каскад по внешним ключам сам уносит командира, базы, флоты, ордера и снимки.
  const { count } = await prisma.user.deleteMany({ where: { id: { in: doomed.map((u) => u.id) } } });
  return { removed: count, freedPlanets };
}

// Запуск напрямую: печатаем результат. При импорте из testStand — молча.
if (process.argv[1]?.endsWith('cleanupTestAccounts.ts')) {
  const { removed, freedPlanets } = await cleanupTestAccounts();
  const free = await prisma.planet.count({ where: { base: null } });
  console.log(
    `[cleanup] удалено одноразовых аккаунтов: ${removed}, освобождено колоний: ${freedPlanets}. ` +
      `Свободных планет в галактике: ${free}`,
  );
  await prisma.$disconnect();
}
