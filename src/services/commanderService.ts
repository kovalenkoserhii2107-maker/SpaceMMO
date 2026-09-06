/**
 * Командир: создание профиля и выдача стартовой колонии.
 *
 * Пока у учетной записи нет командира, игровые роуты закрыты — это и есть
 * онбординг первого входа.
 */
import { prisma } from '../db/prisma.js';
import { grant, listAchievements, type AchievementView } from './achievementService.js';

/** Набор аватаров-заглушек до появления настоящей графики. */
export const AVATARS = [
  { id: 'nova', label: 'Нова', glyph: '✦' },
  { id: 'kobzar', label: 'Кобзарь', glyph: '✧' },
  { id: 'chumak', label: 'Чумак', glyph: '❂' },
  { id: 'strilets', label: 'Стрелец', glyph: '➶' },
] as const;

export function isKnownAvatar(value: unknown): value is string {
  return typeof value === 'string' && AVATARS.some((avatar) => avatar.id === value);
}

export function normalizeNickname(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const nickname = raw.trim();
  if (nickname.length < 3 || nickname.length > 24) return null;
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(nickname)) return null;
  return nickname;
}

export type CommanderResult =
  | { ok: true; commander: CommanderProfile }
  | { ok: false; error: string; status: number };

export interface CommanderProfile {
  id: string;
  nickname: string;
  avatarId: string;
  credits: number;
  battlesWon: number;
  battlesLost: number;
  createdAt: number;
  homePlanet: string | null;
  achievements: AchievementView[];
}

export async function getCommanderProfile(commanderId: string): Promise<CommanderProfile | null> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    include: { bases: { include: { planet: true }, orderBy: { createdAt: 'asc' }, take: 1 } },
  });
  if (!commander) return null;

  return {
    id: commander.id,
    nickname: commander.nickname,
    avatarId: commander.avatarId,
    credits: Math.round(commander.credits * 100) / 100,
    battlesWon: commander.battlesWon,
    battlesLost: commander.battlesLost,
    createdAt: commander.createdAt.getTime(),
    homePlanet: commander.bases[0]?.planet.name ?? null,
    achievements: await listAchievements(commander.id),
  };
}

/**
 * Стартовая планета — ближайшая свободная к уже обжитым местам.
 *
 * Раньше бралась первая свободная по возрастанию `galaxyX`, и это разбрасывало
 * новичков по галактике: сортировка не смотрит на `galaxyY` вовсе, поэтому
 * после заполнения системы на X=1 следующий игрок уезжал в другую систему
 * с тем же X и совершенно другим Y — на другой конец карты. Соседей нет,
 * торговать не с кем, лететь до кого-либо часами. Мир из одиночек
 * не мультиплеер, а набор одиночных игр на общем сервере.
 *
 * Якорь — середина уже заселенных систем. Скопление от этого растет наружу
 * кольцами: каждая следующая колония садится в ближайшую к центру систему,
 * где еще есть место. Привязываться к торговому хабу нельзя — он есть
 * в каждой системе и центром притяжения не является.
 *
 * Пока не заселено ничего, берется просто первая свободная: с нее
 * скопление и начнется.
 */
async function pickStartingPlanet(): Promise<{ id: string; name: string } | null> {
  const free = await prisma.planet.findMany({
    where: { base: null },
    select: { id: true, name: true, position: true, system: { select: { galaxyX: true, galaxyY: true } } },
  });
  if (free.length === 0) return null;

  const settled = await prisma.solarSystem.findMany({
    where: { planets: { some: { base: { isNot: null } } } },
    select: { galaxyX: true, galaxyY: true },
  });
  if (settled.length === 0) return free[0] ?? null;

  const anchorX = settled.reduce((sum, s) => sum + s.galaxyX, 0) / settled.length;
  const anchorY = settled.reduce((sum, s) => sum + s.galaxyY, 0) / settled.length;
  // Квадрат расстояния: корень ничего не меняет в порядке, а считать дешевле.
  const distance = (planet: (typeof free)[number]): number =>
    (planet.system.galaxyX - anchorX) ** 2 + (planet.system.galaxyY - anchorY) ** 2;

  let best = free[0]!;
  let bestDistance = distance(best);
  for (const planet of free) {
    const value = distance(planet);
    // При равном расстоянии — ближняя к звезде орбита: система заполняется
    // изнутри наружу, как и настоящая колонизация.
    if (value < bestDistance || (value === bestDistance && planet.position < best.position)) {
      best = planet;
      bestDistance = value;
    }
  }
  return best;
}

/**
 * Создание командира: уникальный позывной, аватар и стартовая планета.
 */
export async function createCommander(
  userId: string,
  nickname: string,
  avatarId: string,
): Promise<CommanderResult> {
  const existingProfile = await prisma.commander.findUnique({ where: { userId } });
  if (existingProfile) {
    return { ok: false, error: 'У этого аккаунта уже есть командир', status: 409 };
  }

  const taken = await prisma.commander.findUnique({ where: { nickname } });
  if (taken) return { ok: false, error: 'Позывной уже занят', status: 409 };

  const planet = await pickStartingPlanet();
  if (!planet) {
    return {
      ok: false,
      error: 'В галактике нет свободных планет. Запустите генерацию: npm run generate',
      status: 503,
    };
  }

  const commander = await prisma.commander.create({
    data: {
      userId,
      nickname,
      avatarId,
      bases: { create: { name: `Колония ${planet.name}`, planetId: planet.id } },
    },
  });

  await grant(commander.id, 'FIRST_STEP');

  const profile = await getCommanderProfile(commander.id);
  return profile
    ? { ok: true, commander: profile }
    : { ok: false, error: 'Не удалось создать командира', status: 500 };
}
