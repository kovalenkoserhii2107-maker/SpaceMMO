/**
 * Центр связи: личная переписка и доставка системных отчетов.
 *
 * Ящик всегда адресный — письмо принадлежит получателю, и любая выборка идет
 * по `recipientId`. Поэтому «чужое письмо» невозможно получить даже по прямому
 * идентификатору: ни один запрос не ищет сообщение без владельца в условии.
 *
 * Отправитель `null` означает системное письмо: боевой отчет, разведка,
 * экспедиция. Игрок такое письмо не подделает — тип и отправителя проставляет
 * сервер, а не тело запроса.
 */
import { prisma } from '../db/prisma.js';
import type { MessageType } from '../generated/prisma/enums.js';
import type { Prisma } from '../generated/prisma/client.js';

export type MailResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number };

export interface MessageView {
  id: string;
  type: MessageType;
  subject: string;
  body: string;
  /** Позывной отправителя; null — письмо от «Центра связи». */
  from: string | null;
  isRead: boolean;
  createdAt: number;
  /** Структура отчета, если письмо системное. */
  payload: unknown;
}

export interface MailboxView {
  messages: MessageView[];
  unread: number;
  /** Непрочитанные по типам — для счетчиков на вкладках фильтров. */
  unreadByType: Record<MessageType, number>;
  total: number;
}

export const MESSAGE_TYPES: readonly MessageType[] = [
  'PLAYER',
  'SYNDICATE',
  'BATTLE_REPORT',
  'SPY_REPORT',
  'EXPEDITION',
];

export function isMessageType(value: unknown): value is MessageType {
  return typeof value === 'string' && (MESSAGE_TYPES as readonly string[]).includes(value);
}

const SUBJECT_MAX = 120;
const BODY_MAX = 4000;
/** Сколько писем отдаем за раз: ящик листается, а не грузится целиком. */
const PAGE_SIZE = 50;

export function validateSubject(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const subject = value.trim();
  if (subject.length < 1 || subject.length > SUBJECT_MAX) return null;
  return subject;
}

export function validateBody(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const body = value.trim();
  if (body.length < 1 || body.length > BODY_MAX) return null;
  return body;
}

/* ------------------------- Доставка ------------------------- */

export interface OutgoingMessage {
  recipientId: string;
  type: MessageType;
  subject: string;
  body: string;
  senderId?: string | null;
  /**
   * Структура отчета. Тип намеренно широкий: Prisma.InputJsonValue не принимает
   * обычные интерфейсы, а приведение делается один раз здесь, на границе записи,
   * вместо касты в каждом месте, где отчет собирается.
   */
  payload?: object;
}

/**
 * Кладет письма в ящики и возвращает получателей, которым нужно обновить бейдж.
 *
 * Пишем пачкой: боевой отчет уходит сразу двум сторонам, рассылка синдиката —
 * всему составу, и делать это по одному письму за запрос незачем.
 */
export async function deliver(messages: OutgoingMessage[]): Promise<string[]> {
  if (messages.length === 0) return [];

  await prisma.message.createMany({
    data: messages.map((message) => ({
      recipientId: message.recipientId,
      senderId: message.senderId ?? null,
      type: message.type,
      subject: message.subject.slice(0, SUBJECT_MAX),
      body: message.body.slice(0, BODY_MAX),
      ...(message.payload === undefined
        ? {}
        : { payload: message.payload as unknown as Prisma.InputJsonObject }),
    })),
  });

  return [...new Set(messages.map((message) => message.recipientId))];
}

/* ------------------------- Чтение ящика ------------------------- */

export async function getMailbox(
  commanderId: string,
  filter?: MessageType,
): Promise<MailboxView> {
  const where = { recipientId: commanderId, ...(filter ? { type: filter } : {}) };

  const [rows, unreadGroups, total] = await Promise.all([
    prisma.message.findMany({
      where,
      include: { sender: { select: { nickname: true } } },
      orderBy: { createdAt: 'desc' },
      take: PAGE_SIZE,
    }),
    prisma.message.groupBy({
      by: ['type'],
      where: { recipientId: commanderId, isRead: false },
      _count: { _all: true },
    }),
    prisma.message.count({ where }),
  ]);

  const unreadByType = Object.fromEntries(
    MESSAGE_TYPES.map((type) => [type, 0]),
  ) as Record<MessageType, number>;
  for (const group of unreadGroups) unreadByType[group.type] = group._count._all;

  return {
    messages: rows.map((row) => ({
      id: row.id,
      type: row.type,
      subject: row.subject,
      body: row.body,
      from: row.sender?.nickname ?? null,
      isRead: row.isRead,
      createdAt: row.createdAt.getTime(),
      payload: row.payload ?? null,
    })),
    unread: MESSAGE_TYPES.reduce((sum, type) => sum + unreadByType[type], 0),
    unreadByType,
    total,
  };
}

export async function countUnread(commanderId: string): Promise<number> {
  return prisma.message.count({ where: { recipientId: commanderId, isRead: false } });
}

/**
 * Отметка «прочитано».
 *
 * Владелец стоит в самом условии обновления, а не в отдельной проверке:
 * чужое письмо просто не попадает под `updateMany` и счетчик остается нулевым.
 */
export async function markRead(commanderId: string, messageId: string): Promise<MailResult> {
  const { count } = await prisma.message.updateMany({
    where: { id: messageId, recipientId: commanderId },
    data: { isRead: true },
  });
  if (count === 0) return { ok: false, error: 'Письмо не найдено', status: 404 };
  return { ok: true, message: 'Письмо прочитано' };
}

export async function markAllRead(commanderId: string): Promise<MailResult> {
  const { count } = await prisma.message.updateMany({
    where: { recipientId: commanderId, isRead: false },
    data: { isRead: true },
  });
  return { ok: true, message: count > 0 ? `Прочитано писем: ${count}` : 'Непрочитанных нет' };
}

export async function deleteMessage(commanderId: string, messageId: string): Promise<MailResult> {
  const { count } = await prisma.message.deleteMany({
    where: { id: messageId, recipientId: commanderId },
  });
  if (count === 0) return { ok: false, error: 'Письмо не найдено', status: 404 };
  return { ok: true, message: 'Письмо удалено' };
}

/* ------------------------- Личная переписка ------------------------- */

/** Личное письмо по позывному. Возвращает получателя, чтобы обновить его бейдж. */
export async function sendToNickname(
  senderId: string,
  nickname: string,
  subject: string,
  body: string,
): Promise<MailResult & { recipientId?: string }> {
  const recipient = await prisma.commander.findUnique({
    where: { nickname },
    select: { id: true, nickname: true },
  });
  if (!recipient) return { ok: false, error: 'Командир с таким позывным не найден', status: 404 };
  if (recipient.id === senderId) {
    return { ok: false, error: 'Нельзя написать самому себе', status: 400 };
  }

  await deliver([{ recipientId: recipient.id, senderId, type: 'PLAYER', subject, body }]);
  return { ok: true, message: `Письмо отправлено: ${recipient.nickname}`, recipientId: recipient.id };
}
