/**
 * Движок достижений.
 *
 * Каталог хранится в БД, но источником правды остается код: при старте сервера
 * список синхронизируется, поэтому добавить награду — значит дописать сюда строку.
 * Выдача идемпотентна: повторная проверка не создает дубликат и не шлет событие
 * второй раз, поэтому условия можно спокойно перепроверять на каждом тике.
 */
import { prisma } from '../db/prisma.js';
import { BUILDING_TYPES } from '../game/rules.js';

export const ACHIEVEMENTS = [
  {
    code: 'FIRST_STEP',
    title: 'Первый шаг',
    description: 'Создать командира и получить стартовую колонию.',
    icon: '🚀',
  },
  {
    code: 'ARCHITECT',
    title: 'Архитектор',
    description: 'Построить пять разных зданий на одной планете.',
    icon: '🏗',
  },
  {
    code: 'PIRATE_BANE',
    title: 'Гроза пиратов',
    description: 'Выиграть первый бой с пиратами в экспедиции.',
    icon: '☠',
  },
] as const;

export type AchievementCode = (typeof ACHIEVEMENTS)[number]['code'];

/** Сколько разных зданий нужно для «Архитектора». */
const ARCHITECT_BUILDINGS = 5;

/** Синхронизация каталога при старте сервера. */
export async function ensureAchievements(): Promise<void> {
  for (const achievement of ACHIEVEMENTS) {
    await prisma.achievement.upsert({
      where: { code: achievement.code },
      create: { ...achievement },
      update: { title: achievement.title, description: achievement.description, icon: achievement.icon },
    });
  }
}

/**
 * Выдача достижения. Возвращает true только при первой выдаче —
 * по этому признаку вызывающий код решает, показывать ли уведомление.
 */
export async function grant(commanderId: string, code: AchievementCode): Promise<boolean> {
  const achievement = await prisma.achievement.findUnique({ where: { code } });
  if (!achievement) return false;

  const existing = await prisma.commanderAchievement.findUnique({
    where: { commanderId_achievementId: { commanderId, achievementId: achievement.id } },
  });
  if (existing) return false;

  await prisma.commanderAchievement.create({
    data: { commanderId, achievementId: achievement.id },
  });
  return true;
}

/**
 * Проверка «Архитектора»: пять разных зданий первого уровня и выше
 * на одной планете. Вызывается после завершения стройки.
 */
export async function checkArchitect(commanderId: string, baseId: string): Promise<boolean> {
  const base = await prisma.base.findUnique({ where: { id: baseId } });
  if (!base || base.commanderId !== commanderId) return false;

  const levels: Record<string, number> = {
    METAL_MINE: base.metalMineLevel,
    CRYSTAL_MINE: base.crystalMineLevel,
    DEUTERIUM_MINE: base.deuteriumMineLevel,
    SOLAR_PLANT: base.solarPlantLevel,
    RESEARCH_LAB: base.researchLabLevel,
    SHIPYARD: base.shipyardLevel,
    ANTIMATTER_SYNTH: base.antimatterSynthLevel,
    STORAGE: base.storageLevel,
  };

  const built = BUILDING_TYPES.filter((type) => (levels[type] ?? 0) > 0).length;
  if (built < ARCHITECT_BUILDINGS) return false;

  return grant(commanderId, 'ARCHITECT');
}

/** Проверка «Грозы пиратов»: победа в PvE-бою экспедиции. */
export async function checkPirateBane(commanderId: string, outcome: string): Promise<boolean> {
  if (outcome !== 'PIRATES_WON') return false;
  return grant(commanderId, 'PIRATE_BANE');
}

export interface AchievementView {
  code: string;
  title: string;
  description: string;
  icon: string;
  unlockedAt: number | null;
}

/** Все достижения командира: полученные и еще закрытые. */
export async function listAchievements(commanderId: string): Promise<AchievementView[]> {
  const [catalog, unlocked] = await Promise.all([
    prisma.achievement.findMany(),
    prisma.commanderAchievement.findMany({ where: { commanderId }, include: { achievement: true } }),
  ]);

  const unlockedByCode = new Map(unlocked.map((item) => [item.achievement.code, item.unlockedAt]));

  return ACHIEVEMENTS.map((achievement) => {
    const stored = catalog.find((item) => item.code === achievement.code);
    const when = unlockedByCode.get(achievement.code);
    return {
      code: achievement.code,
      title: stored?.title ?? achievement.title,
      description: stored?.description ?? achievement.description,
      icon: stored?.icon ?? achievement.icon,
      unlockedAt: when ? when.getTime() : null,
    };
  });
}
