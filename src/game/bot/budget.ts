/**
 * Учет обращений к языковой модели.
 *
 * Лимит бесплатного тарифа считается запросами в сутки на весь проект,
 * а не на бота: пятьсот на всех. Поэтому бюджет здесь общий, и каждый бот
 * перед вызовом спрашивает, остался ли он, — иначе три бота с частым тактом
 * выбирают дневную норму к обеду, и вечером мир замирает.
 *
 * Учет ведется по попыткам, а не по удачам. Отказ сервиса, таймаут и мусор
 * вместо JSON стоят ровно столько же, сколько удачный ответ: запрос ушел
 * и в счетчике провайдера отметился. Считать только удачи значило бы вести
 * учет не тех событий, которые лимитируются.
 *
 * Счетчик живет в памяти ботов (`Bot.memory`), а не в модуле: сервер
 * перезапускается — на стенде это происходит при каждой правке файла, —
 * и счетчик в памяти процесса обнулялся бы вместе с ним, снимая всякую
 * защиту ровно тогда, когда она нужна.
 */
import { prisma } from '../../db/prisma.js';

/**
 * Дневная норма запросов на всех ботов.
 *
 * Четыреста при лимите в пятьсот: запас на письма живым игрокам, которые
 * приходят когда придут и ждать до завтра не должны, и на то, что счетчик
 * провайдера считает по своим часовым поясам, а не по нашим.
 */
export const DAILY_BUDGET = 400;

/**
 * Наименьший промежуток между обращениями одного бота.
 *
 * Защита от холостого цикла: при недоступном API повод для вызова никуда
 * не девается — план не сохранился, значит он просрочен и на следующем
 * заходе, — и бот ломился бы к модели каждые сорок пять секунд, выбирая
 * дневную норму за полчаса на одних отказах.
 */
export const ATTEMPT_GAP_MS = 5 * 60_000;

/** Сколько писем в сутки бот пишет по собственному почину и в ответ. */
export const DAILY_LETTERS = 6;

/** Сколько писем в сутки одному и тому же игроку. */
export const DAILY_LETTERS_PER_PLAYER = 2;

/** Сутки по UTC: часовой пояс сервера не должен двигать границу нормы. */
export function today(now = Date.now()): string {
  return new Date(now).toISOString().slice(0, 10);
}

/** Счетчик за сутки, как он лежит в `Bot.memory`. */
export interface BotSpend {
  day: string;
  /** Обращения к модели — любые, удачные и нет. */
  calls: number;
  /** Отправленные письма, всего и по адресатам. */
  letters: number;
  toPlayer: Record<string, number>;
  /** Когда бот обращался к модели в последний раз. */
  lastAttempt: number;
}

const EMPTY: BotSpend = { day: '', calls: 0, letters: 0, toPlayer: {}, lastAttempt: 0 };

/**
 * Прочитать счетчик из памяти бота.
 *
 * `Bot.memory` — это JSON в базе, переживающий изменения игры ровно так же,
 * как снимки разведки и нагрузка писем (правила 8 и 9), поэтому каждое поле
 * проверяется по отдельности. Счетчик за прошлые сутки не чинится, а
 * обнуляется: он больше ничего не значит.
 */
export function readSpend(memory: unknown, now = Date.now()): BotSpend {
  const day = today(now);
  if (typeof memory !== 'object' || memory === null) return { ...EMPTY, day };

  const raw = (memory as Record<string, unknown>)['spend'];
  if (typeof raw !== 'object' || raw === null) return { ...EMPTY, day };

  const row = raw as Record<string, unknown>;
  if (row['day'] !== day) return { ...EMPTY, day };

  const count = (value: unknown): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;

  const toPlayer: Record<string, number> = {};
  const perPlayer = row['toPlayer'];
  if (typeof perPlayer === 'object' && perPlayer !== null) {
    for (const [id, value] of Object.entries(perPlayer as Record<string, unknown>)) {
      const n = count(value);
      if (n > 0) toPlayer[id] = n;
    }
  }

  return {
    day,
    calls: count(row['calls']),
    letters: count(row['letters']),
    toPlayer,
    lastAttempt: count(row['lastAttempt']),
  };
}

/**
 * Сколько обращений к модели уже сделано всеми ботами за сегодня.
 *
 * Читается по всем ботам, а не по одному: лимит общий, и бот, который знает
 * только свой расход, разделил бы норму поровну — а бот в осаде должен иметь
 * возможность занять долю спокойного соседа.
 */
export async function spentToday(now = Date.now()): Promise<number> {
  const bots = await prisma.bot.findMany({ select: { memory: true } });
  return bots.reduce((sum, bot) => sum + readSpend(bot.memory, now).calls, 0);
}

/** Осталось ли место в общей норме и прошла ли пауза после прошлой попытки. */
export function mayAsk(spend: BotSpend, spentAll: number, now = Date.now()): boolean {
  if (spentAll >= DAILY_BUDGET) return false;
  return now - spend.lastAttempt >= ATTEMPT_GAP_MS;
}

/** Может ли бот написать этому игроку: оба потолка сразу. */
export function mayWrite(spend: BotSpend, recipientId: string): boolean {
  if (spend.letters >= DAILY_LETTERS) return false;
  return (spend.toPlayer[recipientId] ?? 0) < DAILY_LETTERS_PER_PLAYER;
}

/** Отметить обращение к модели — независимо от того, чем оно кончилось. */
export function withAttempt(spend: BotSpend, now = Date.now()): BotSpend {
  return { ...spend, calls: spend.calls + 1, lastAttempt: now };
}

/** Отметить отправленное письмо. */
export function withLetter(spend: BotSpend, recipientId: string): BotSpend {
  return {
    ...spend,
    letters: spend.letters + 1,
    toPlayer: { ...spend.toPlayer, [recipientId]: (spend.toPlayer[recipientId] ?? 0) + 1 },
  };
}
