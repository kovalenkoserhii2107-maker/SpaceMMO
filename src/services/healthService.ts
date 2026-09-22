import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import type { HealthResponse } from '../types/api.js';

/*
 * Состояние сервера — честное, а не «процесс отвечает».
 *
 * Прежняя проверка отдавала `ok: true` всегда и в базу не ходила. Ровно так
 * прошла авария с Neon: трафик кончился, база отказывала, мир стоял целиком,
 * а проверка бодро горела зеленым. Живы должны быть две вещи сразу: база,
 * куда тик пишет каждую секунду, и сам тик — зависший `await` в нем
 * останавливает мир, не роняя процесс.
 */

/** Сколько ждем ответа базы. Дольше — для игры это уже отказ. */
const DB_PROBE_TIMEOUT_MS = 2_000;

/**
 * Тик идет раз в секунду, но прогон флотов и сброс в базу иногда тянутся
 * дольше. Пятнадцать секунд без законченного тика — это уже не медленный
 * тик, а стоящий.
 */
export const TICK_STALE_MS = 15_000;

export async function probeDatabase(timeoutMs = DB_PROBE_TIMEOUT_MS): Promise<string | null> {
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      prisma.$queryRaw`SELECT 1`,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`нет ответа за ${timeoutMs} мс`)), timeoutMs);
      }),
    ]);
    return null;
  } catch (error) {
    return describeDbError(error);
  } finally {
    clearTimeout(timer);
  }
}

/*
 * Сообщение Prisma об отказе — многострочная простыня «Invalid invocation»
 * без сути внутри; суть лежит в коде ошибки (`ECONNREFUSED`, `P1001` и т. п.).
 */
function describeDbError(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error && typeof error.code === 'string') {
    return error.code;
  }
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/\s+/g, ' ').trim().slice(0, 200);
}

export async function healthStatus(): Promise<HealthResponse> {
  const now = Date.now();
  const tickAgeMs = gameLoop.tickAgeMs(now);
  const dbError = await probeDatabase();

  const problems: string[] = [];
  if (dbError) problems.push(`база: ${dbError}`);
  if (tickAgeMs === null) problems.push('игровой цикл не запущен');
  else if (tickAgeMs > TICK_STALE_MS) problems.push(`тик стоит ${Math.round(tickAgeMs / 1000)} с`);

  return {
    ok: problems.length === 0,
    serverTime: now,
    database: dbError ? 'down' : 'ok',
    tickAgeMs,
    ...(problems.length ? { problems } : {}),
  };
}

/*
 * Сторож тика: зависший цикл лечится перезапуском, и сделать его может
 * только сам процесс. Проверка Fly машину не перезапускает — она лишь
 * решает, слать ли на нее запросы, — а машина с зависшим тиком отвечает
 * на запросы исправно и выглядит живой.
 *
 * Перезапуск — только когда база доступна. Если лежит она, тик стоит
 * по ее вине, и новый процесс упрется в то же самое; хуже того, Fly
 * перезапускает упавшую машину ограниченное число раз, и долгая авария
 * базы исчерпала бы попытки впустую — машина осталась бы стоять и после
 * того, как база поднимется.
 *
 * Порог в пять минут — с запасом против долгого сброса: ложный
 * перезапуск стоит несохраненных секунд состояния из памяти, пропущенный
 * — мира, стоящего до ручного вмешательства.
 */
const WATCHDOG_INTERVAL_MS = 30_000;
const WATCHDOG_LIMIT_MS = 5 * 60_000;

export function startTickWatchdog(): NodeJS.Timeout {
  let warnedDbDown = false;
  return setInterval(() => {
    void (async () => {
      const age = gameLoop.tickAgeMs();
      if (age === null || age <= WATCHDOG_LIMIT_MS) {
        warnedDbDown = false;
        return;
      }
      const dbError = await probeDatabase();
      if (dbError) {
        if (!warnedDbDown) {
          console.error(`[watchdog] тик стоит ${Math.round(age / 1000)} с, но база недоступна (${dbError}) — перезапуск не поможет, ждем базу`);
          warnedDbDown = true;
        }
        return;
      }
      console.error(`[watchdog] тик стоит ${Math.round(age / 1000)} с при живой базе — перезапускаю процесс`);
      process.exit(1);
    })();
  }, WATCHDOG_INTERVAL_MS);
}
