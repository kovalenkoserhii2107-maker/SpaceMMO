import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { env } from '../config/env.js';

/*
 * Пул создается здесь, а не внутри адаптера, ради одной строки — обработчика
 * `error`.
 *
 * Без него оборванное соединение роняет процесс целиком: `pg` кидает ошибку
 * на простаивающем клиенте, слушателя у события нет, и Node заканчивает
 * работу с кодом 1. На управляемой базе за пулером это почти не проявлялось,
 * на своей вылезло сразу — сервер перезапустился дважды за минуту после
 * первого же обрыва, унося с собой состояние командиров из памяти.
 *
 * Обрыв не авария: база на соседней машине, соединение может закрыться
 * по таймауту или при ее перезапуске, а пул откроет новое сам. Наше дело —
 * пережить это, а не умереть.
 */
const pool = new Pool({ connectionString: env.databaseUrl });

pool.on('error', (error: Error) => {
  console.error('[db] соединение оборвалось, пул откроет новое:', error.message);
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({ adapter });

export async function disconnectPrisma(): Promise<void> {
  await prisma.$disconnect();
  await pool.end();
}
