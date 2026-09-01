/**
 * Управление ботами из пульта гейм-мастера.
 *
 * Бот — обычный командир: своя учетная запись, своя стартовая колония, свое
 * место в рейтинге. Отличий ровно два — за него ходит планировщик, и в его
 * учетную запись нельзя войти.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { runBotTurn } from '../game/bot/director.js';
import {
  BOT_CHARACTERS,
  BOT_PERSONALITIES,
  isBotCharacter,
  type BotCharacter,
} from '../game/bot/personality.js';
import { normalizeNickname } from './commanderService.js';
import { grant } from './achievementService.js';
import { getLeaderboard } from './scoreService.js';

export type BotResult =
  | { ok: true; message: string; bot?: BotView }
  | { ok: false; error: string; status: number };

export interface BotView {
  id: string;
  commanderId: string;
  nickname: string;
  character: BotCharacter;
  characterLabel: string;
  active: boolean;
  colonies: number;
  score: number;
  lastAction: string | null;
  lastActionAt: number | null;
  createdAt: number;
  nextDecisionAt: number;
}

/** Каталог характеров для интерфейса: описание живет в профиле, не в клиенте. */
export function botCharacterCatalog(): Array<{
  id: BotCharacter;
  label: string;
  description: string;
}> {
  return BOT_CHARACTERS.map((id) => ({
    id,
    label: BOT_PERSONALITIES[id].label,
    description: BOT_PERSONALITIES[id].description,
  }));
}

export async function listBots(): Promise<BotView[]> {
  const rows = await prisma.bot.findMany({
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      commanderId: true,
      character: true,
      active: true,
      lastAction: true,
      lastActionAt: true,
      createdAt: true,
      nextDecisionAt: true,
      commander: { select: { nickname: true, _count: { select: { bases: true } } } },
    },
  });

  // Счет берем из готовой таблицы рейтинга: она кешируется, и считать его
  // заново ради админского списка незачем — боты стоят в ней наравне со всеми.
  const leaderboard = await getLeaderboard(null);
  const byCommander = new Map(
    leaderboard.players.map((entry) => [entry.commanderId, entry.score.total] as const),
  );

  return rows.filter((row) => isBotCharacter(row.character)).map((row) => ({
    id: row.id,
    commanderId: row.commanderId,
    nickname: row.commander.nickname,
    character: row.character as BotCharacter,
    characterLabel: BOT_PERSONALITIES[row.character as BotCharacter].label,
    active: row.active,
    colonies: row.commander._count.bases,
    score: byCommander.get(row.commanderId) ?? 0,
    lastAction: row.lastAction,
    lastActionAt: row.lastActionAt?.getTime() ?? null,
    createdAt: row.createdAt.getTime(),
    nextDecisionAt: row.nextDecisionAt.getTime(),
  }));
}

/**
 * Завести бота.
 *
 * Учетная запись создается без пароля и с ролью BOT — войти в нее нельзя
 * ни паролем, ни через Google. Стартовая колония выдается тем же способом,
 * что и живому игроку: бот начинает с нуля и по тем же правилам.
 */
export async function createBot(rawNickname: unknown, rawCharacter: unknown): Promise<BotResult> {
  const nickname = normalizeNickname(rawNickname);
  if (!nickname) {
    return { ok: false, error: 'Позывной: 3–24 символа, буквы, цифры, пробел, дефис', status: 400 };
  }
  if (!isBotCharacter(rawCharacter)) {
    return { ok: false, error: 'Неизвестный характер бота', status: 400 };
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

  // Синтетический адрес в несуществующем домене: он нужен только затем, что
  // email у учетной записи уникален и обязателен. Писем на него никто не шлет.
  const email = `bot-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@bots.local`;

  const created = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email, role: 'BOT', passwordHash: null },
    });
    const commander = await tx.commander.create({
      data: {
        userId: user.id,
        nickname,
        avatarId: 'nova',
        bases: { create: { name: `Колония ${planet.name}`, planetId: planet.id } },
      },
    });
    await tx.bot.create({ data: { commanderId: commander.id, character: rawCharacter } });
    return commander;
  });

  await grant(created.id, 'FIRST_STEP');

  return {
    ok: true,
    message: `Бот «${nickname}» (${BOT_PERSONALITIES[rawCharacter].label}) вышел на связь`,
  };
}

export async function setBotActive(botId: string, active: boolean): Promise<BotResult> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { commander: { select: { nickname: true } } },
  });
  if (!bot) return { ok: false, error: 'Бот не найден', status: 404 };

  await prisma.bot.update({ where: { id: botId }, data: { active } });
  return {
    ok: true,
    message: active
      ? `«${bot.commander.nickname}» снова принимает решения`
      : `«${bot.commander.nickname}» встал на паузу и остается в мире`,
  };
}

/**
 * Удалить бота.
 *
 * Каскад от учетной записи уносит командира со всеми колониями, флотами
 * и письмами — как и удаление живого аккаунта из пульта. Сначала бот
 * выгружается из памяти тика: иначе ближайший сброс попытался бы записать
 * состояние уже удаленного командира.
 */
export async function deleteBot(botId: string): Promise<BotResult> {
  const bot = await prisma.bot.findUnique({
    where: { id: botId },
    select: { commanderId: true, commander: { select: { nickname: true, userId: true } } },
  });
  if (!bot) return { ok: false, error: 'Бот не найден', status: 404 };

  // Сначала пауза, потом выгрузка, потом удаление: иначе планировщик мог бы
  // взять бота на заход между выгрузкой и каскадом и вернуть его в память
  // тика уже после того, как строки в БД не стало.
  await prisma.bot.update({ where: { id: botId }, data: { active: false } });
  await gameLoop.detachCommander(bot.commanderId);
  await prisma.user.delete({ where: { id: bot.commander.userId } });

  return { ok: true, message: `Бот «${bot.commander.nickname}» удален` };
}

/** Разбудить бота вручную и вернуть, что он успел сделать. */
export async function nudgeBot(botId: string): Promise<BotResult> {
  const turn = await runBotTurn(botId);
  if (!turn) return { ok: false, error: 'Бот не найден или еще без колонии', status: 404 };

  return {
    ok: true,
    message: turn.actions.length
      ? `«${turn.nickname}»: ${turn.actions.join('; ')}`
      : `«${turn.nickname}» осмотрелся и решил копить`,
  };
}
