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
 * Создание командира: уникальный позывной, аватар и стартовая планета.
 * Планета берется из уже сгенерированной галактики — первая свободная.
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

  const planet = await prisma.planet.findFirst({
    where: { base: null },
    orderBy: [{ system: { galaxyX: 'asc' } }, { position: 'asc' }],
  });
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
