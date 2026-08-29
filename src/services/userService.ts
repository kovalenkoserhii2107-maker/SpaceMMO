/**
 * Учетные записи и выдача стартовой планеты.
 * Этап 1: авторизация упрощенная — логин по нику, без пароля (заглушка).
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import type { User } from '../generated/prisma/client.js';

export class NoFreePlanetError extends Error {
  constructor() {
    super('В галактике нет свободных планет. Запустите генерацию: npm run generate');
    this.name = 'NoFreePlanetError';
  }
}

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const username = raw.trim();
  if (username.length < 3 || username.length > 24) return null;
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(username)) return null;
  return username;
}

/** Вход или регистрация. Новому игроку выдается свободная планета и база на ней. */
export async function loginOrRegister(username: string): Promise<User> {
  const existing = await prisma.user.findUnique({ where: { username } });
  if (existing) {
    return prisma.user.update({
      where: { id: existing.id },
      data: { lastSeenAt: new Date() },
    });
  }

  const planet = await prisma.planet.findFirst({
    where: { base: null },
    orderBy: [{ system: { galaxyX: 'asc' } }, { position: 'asc' }],
  });
  if (!planet) throw new NoFreePlanetError();

  return prisma.user.create({
    data: {
      username,
      sessionToken: randomBytes(24).toString('hex'),
      bases: {
        create: {
          name: `Колония ${planet.name}`,
          planetId: planet.id,
        },
      },
    },
  });
}

export async function findUserByToken(token: string): Promise<User | null> {
  if (!token) return null;
  return prisma.user.findUnique({ where: { sessionToken: token } });
}
