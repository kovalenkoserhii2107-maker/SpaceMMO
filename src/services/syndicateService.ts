/**
 * Синдикаты (Этап 9): объединения командиров с общим банком и дипломатией.
 *
 * Права разложены по ролям: заявки разбирают лидер и офицеры, а состав,
 * назначения и роспуск — только лидер. Проверка прав живет в одном месте
 * (`requireRole`), чтобы нельзя было случайно открыть действие всем подряд.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import type { SyndicateRole } from '../generated/prisma/enums.js';

/** Стоимость основания синдиката в криптогривне. */
export const FOUNDING_COST = 5000;
export const MAX_DONATION = 1_000_000;

export type SyndicateResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number };

export interface SyndicateSummary {
  id: string;
  name: string;
  tag: string;
  leader: string;
  members: number;
  createdAt: number;
  /** Заявка текущего командира в этот синдикат, если она есть. */
  applicationStatus: string | null;
}

export interface SyndicateMemberView {
  commanderId: string;
  nickname: string;
  role: SyndicateRole;
  avatarId: string;
  battlesWon: number;
  battlesLost: number;
}

export interface SyndicateView {
  id: string;
  name: string;
  tag: string;
  createdAt: number;
  role: SyndicateRole;
  bank: number;
  members: SyndicateMemberView[];
  /** Заявки видны только тем, кто может их разбирать. */
  applications: Array<{ id: string; nickname: string; createdAt: number }>;
  transactions: Array<{ id: string; nickname: string | null; kind: string; amount: number; createdAt: number }>;
  wars: Array<{ syndicateId: string; name: string; tag: string; declaredByUs: boolean; declaredAt: number }>;
}

export interface SyndicateOverview {
  foundingCost: number;
  /** Личный баланс командира — из него платятся взнос и пожертвования. */
  credits: number;
  mine: SyndicateView | null;
  list: SyndicateSummary[];
  /** Куда командир уже подал заявку. */
  myApplication: { syndicateId: string; name: string } | null;
}

/** Может ли роль разбирать заявки. */
function canReviewApplications(role: SyndicateRole): boolean {
  return role === 'LEADER' || role === 'OFFICER';
}

/**
 * Единая проверка прав: возвращает членство командира или причину отказа.
 * Все изменяющие операции проходят через нее.
 */
async function requireRole(
  commanderId: string,
  allowed: SyndicateRole[],
): Promise<
  { ok: true; syndicateId: string; role: SyndicateRole } | { ok: false; error: string; status: number }
> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { syndicateId: true, syndicateRole: true },
  });

  if (!commander?.syndicateId || !commander.syndicateRole) {
    return { ok: false, error: 'Ты не состоишь в синдикате', status: 409 };
  }
  if (!allowed.includes(commander.syndicateRole)) {
    return { ok: false, error: 'Недостаточно прав в синдикате', status: 403 };
  }
  return { ok: true, syndicateId: commander.syndicateId, role: commander.syndicateRole };
}

export function normalizeName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim();
  if (name.length < 3 || name.length > 32) return null;
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(name)) return null;
  return name;
}

export function normalizeTag(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const tag = raw.trim().toUpperCase();
  if (tag.length < 2 || tag.length > 5) return null;
  if (!/^[\p{L}\p{N}]+$/u.test(tag)) return null;
  return tag;
}

/* ------------------------- Чтение ------------------------- */

export async function getOverview(commanderId: string): Promise<SyndicateOverview> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { credits: true, syndicateId: true, syndicateRole: true },
  });

  const [syndicates, myApplication] = await Promise.all([
    prisma.syndicate.findMany({
      include: { leader: { select: { nickname: true } }, _count: { select: { members: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.syndicateApplication.findFirst({
      where: { commanderId, status: 'PENDING' },
      include: { syndicate: { select: { id: true, name: true } } },
    }),
  ]);

  return {
    foundingCost: FOUNDING_COST,
    credits: Math.round((commander?.credits ?? 0) * 100) / 100,
    mine: commander?.syndicateId ? await getSyndicateView(commander.syndicateId, commanderId) : null,
    list: syndicates.map((syndicate) => ({
      id: syndicate.id,
      name: syndicate.name,
      tag: syndicate.tag,
      leader: syndicate.leader.nickname,
      members: syndicate._count.members,
      createdAt: syndicate.createdAt.getTime(),
      applicationStatus:
        myApplication && myApplication.syndicateId === syndicate.id ? myApplication.status : null,
    })),
    myApplication: myApplication
      ? { syndicateId: myApplication.syndicate.id, name: myApplication.syndicate.name }
      : null,
  };
}

async function getSyndicateView(syndicateId: string, viewerId: string): Promise<SyndicateView | null> {
  const syndicate = await prisma.syndicate.findUnique({
    where: { id: syndicateId },
    include: {
      bank: true,
      members: { orderBy: { createdAt: 'asc' } },
      applications: {
        where: { status: 'PENDING' },
        include: { commander: { select: { nickname: true } } },
        orderBy: { createdAt: 'asc' },
      },
      transactions: {
        include: { commander: { select: { nickname: true } } },
        orderBy: { createdAt: 'desc' },
        take: 20,
      },
      warsStarted: { include: { target: true } },
      warsAgainst: { include: { aggressor: true } },
    },
  });
  if (!syndicate) return null;

  const viewer = syndicate.members.find((member) => member.id === viewerId);
  if (!viewer?.syndicateRole) return null;

  return {
    id: syndicate.id,
    name: syndicate.name,
    tag: syndicate.tag,
    createdAt: syndicate.createdAt.getTime(),
    role: viewer.syndicateRole,
    bank: Math.round((syndicate.bank?.credits ?? 0) * 100) / 100,
    members: syndicate.members.map((member) => ({
      commanderId: member.id,
      nickname: member.nickname,
      role: member.syndicateRole ?? 'MEMBER',
      avatarId: member.avatarId,
      battlesWon: member.battlesWon,
      battlesLost: member.battlesLost,
    })),
    // Заявки показываем только тем, кто вправе их разбирать.
    applications: canReviewApplications(viewer.syndicateRole)
      ? syndicate.applications.map((application) => ({
          id: application.id,
          nickname: application.commander.nickname,
          createdAt: application.createdAt.getTime(),
        }))
      : [],
    transactions: syndicate.transactions.map((tx) => ({
      id: tx.id,
      nickname: tx.commander?.nickname ?? null,
      kind: tx.kind,
      amount: tx.amount,
      createdAt: tx.createdAt.getTime(),
    })),
    wars: [
      ...syndicate.warsStarted.map((war) => ({
        syndicateId: war.targetId,
        name: war.target.name,
        tag: war.target.tag,
        declaredByUs: true,
        declaredAt: war.declaredAt.getTime(),
      })),
      ...syndicate.warsAgainst.map((war) => ({
        syndicateId: war.aggressorId,
        name: war.aggressor.name,
        tag: war.aggressor.tag,
        declaredByUs: false,
        declaredAt: war.declaredAt.getTime(),
      })),
    ],
  };
}

/* ------------------------- Создание и членство ------------------------- */

/** Основание синдиката: взнос списывается условным UPDATE, как и на бирже. */
export async function createSyndicate(
  commanderId: string,
  name: string,
  tag: string,
): Promise<SyndicateResult> {
  const commander = await prisma.commander.findUnique({ where: { id: commanderId } });
  if (!commander) return { ok: false, error: 'Командир не найден', status: 404 };
  if (commander.syndicateId) return { ok: false, error: 'Сначала покинь текущий синдикат', status: 409 };

  const clash = await prisma.syndicate.findFirst({ where: { OR: [{ name }, { tag }] } });
  if (clash) return { ok: false, error: 'Название или тег уже заняты', status: 409 };

  try {
    await prisma.$transaction(async (tx) => {
      const paid = await tx.commander.updateMany({
        where: { id: commanderId, credits: { gte: FOUNDING_COST }, syndicateId: null },
        data: { credits: { decrement: FOUNDING_COST } },
      });
      if (paid.count === 0) {
        throw new SyndicateError(`Нужно ${FOUNDING_COST} ₴ на счету командира`, 409);
      }

      const syndicate = await tx.syndicate.create({
        data: { name, tag, leaderId: commanderId, bank: { create: {} } },
      });
      await tx.commander.update({
        where: { id: commanderId },
        data: { syndicateId: syndicate.id, syndicateRole: 'LEADER' },
      });
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: syndicate.id,
          commanderId,
          kind: 'FOUNDING',
          amount: FOUNDING_COST,
          comment: 'Основание синдиката',
        },
      });
    });
  } catch (error) {
    return toError(error, 'Не удалось создать синдикат');
  }

  await syncCredits(commanderId);
  return { ok: true, message: `Синдикат «${name}» [${tag}] основан` };
}

export async function applyToSyndicate(commanderId: string, syndicateId: string): Promise<SyndicateResult> {
  const commander = await prisma.commander.findUnique({ where: { id: commanderId } });
  if (!commander) return { ok: false, error: 'Командир не найден', status: 404 };
  if (commander.syndicateId) return { ok: false, error: 'Ты уже состоишь в синдикате', status: 409 };

  const syndicate = await prisma.syndicate.findUnique({ where: { id: syndicateId } });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };

  const existing = await prisma.syndicateApplication.findUnique({
    where: { syndicateId_commanderId: { syndicateId, commanderId } },
  });
  if (existing?.status === 'PENDING') {
    return { ok: false, error: 'Заявка уже отправлена', status: 409 };
  }

  await prisma.syndicateApplication.upsert({
    where: { syndicateId_commanderId: { syndicateId, commanderId } },
    create: { syndicateId, commanderId },
    update: { status: 'PENDING', resolvedAt: null, resolvedById: null, createdAt: new Date() },
  });
  return { ok: true, message: `Заявка в «${syndicate.name}» отправлена` };
}

/** Одобрение заявки: доступно лидеру и офицерам. */
export async function reviewApplication(
  commanderId: string,
  applicationId: string,
  accept: boolean,
): Promise<SyndicateResult> {
  const access = await requireRole(commanderId, ['LEADER', 'OFFICER']);
  if (!access.ok) return access;

  const application = await prisma.syndicateApplication.findUnique({
    where: { id: applicationId },
    include: { commander: true },
  });
  if (!application || application.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Заявка не найдена', status: 404 };
  }
  if (application.status !== 'PENDING') {
    return { ok: false, error: 'Заявка уже рассмотрена', status: 409 };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const resolved = await tx.syndicateApplication.updateMany({
        where: { id: applicationId, status: 'PENDING' },
        data: {
          status: accept ? 'ACCEPTED' : 'REJECTED',
          resolvedAt: new Date(),
          resolvedById: commanderId,
        },
      });
      if (resolved.count === 0) throw new SyndicateError('Заявку уже рассмотрели', 409);

      if (accept) {
        const joined = await tx.commander.updateMany({
          where: { id: application.commanderId, syndicateId: null },
          data: { syndicateId: access.syndicateId, syndicateRole: 'MEMBER' },
        });
        if (joined.count === 0) {
          throw new SyndicateError('Командир уже вступил в другой синдикат', 409);
        }
      }
    });
  } catch (error) {
    return toError(error, 'Не удалось обработать заявку');
  }

  return {
    ok: true,
    message: accept
      ? `${application.commander.nickname} принят в синдикат`
      : `Заявка ${application.commander.nickname} отклонена`,
  };
}

/**
 * Исключение участника.
 * Лидер исключает кого угодно, офицер — только рядовых: иначе офицеры могли бы
 * вычистить друг друга и самого лидера.
 */
export async function kickMember(commanderId: string, targetId: string): Promise<SyndicateResult> {
  const access = await requireRole(commanderId, ['LEADER', 'OFFICER']);
  if (!access.ok) return access;
  if (targetId === commanderId) return { ok: false, error: 'Нельзя исключить самого себя', status: 409 };

  const target = await prisma.commander.findUnique({ where: { id: targetId } });
  if (!target || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Этот командир не в твоем синдикате', status: 404 };
  }
  if (access.role === 'OFFICER' && target.syndicateRole !== 'MEMBER') {
    return { ok: false, error: 'Офицер может исключать только рядовых участников', status: 403 };
  }

  await prisma.commander.update({
    where: { id: targetId },
    data: { syndicateId: null, syndicateRole: null },
  });
  return { ok: true, message: `${target.nickname} исключен из синдиката` };
}

/** Назначение офицера и понижение — право лидера. */
export async function setRole(
  commanderId: string,
  targetId: string,
  role: SyndicateRole,
): Promise<SyndicateResult> {
  if (role === 'LEADER') return transferLeadership(commanderId, targetId);

  const access = await requireRole(commanderId, ['LEADER']);
  if (!access.ok) return access;
  if (targetId === commanderId) return { ok: false, error: 'Лидер не меняет собственную роль', status: 409 };

  const target = await prisma.commander.findUnique({ where: { id: targetId } });
  if (!target || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Этот командир не в твоем синдикате', status: 404 };
  }

  await prisma.commander.update({ where: { id: targetId }, data: { syndicateRole: role } });
  return {
    ok: true,
    message: role === 'OFFICER' ? `${target.nickname} назначен офицером` : `${target.nickname} снова участник`,
  };
}

/**
 * Передача лидерства: синдикат не должен умирать вместе с уходом лидера.
 * Старый лидер становится офицером, новый получает все права — одной транзакцией,
 * чтобы синдикат ни на мгновение не остался без лидера.
 */
export async function transferLeadership(
  commanderId: string,
  targetId: string,
): Promise<SyndicateResult> {
  const access = await requireRole(commanderId, ['LEADER']);
  if (!access.ok) return access;
  if (targetId === commanderId) return { ok: false, error: 'Ты и так лидер', status: 409 };

  const target = await prisma.commander.findUnique({ where: { id: targetId } });
  if (!target || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Этот командир не в твоем синдикате', status: 404 };
  }

  try {
    await prisma.$transaction([
      prisma.syndicate.update({ where: { id: access.syndicateId }, data: { leaderId: targetId } }),
      prisma.commander.update({ where: { id: targetId }, data: { syndicateRole: 'LEADER' } }),
      prisma.commander.update({ where: { id: commanderId }, data: { syndicateRole: 'OFFICER' } }),
    ]);
  } catch (error) {
    return toError(error, 'Не удалось передать лидерство');
  }

  return { ok: true, message: `${target.nickname} теперь лидер синдиката` };
}

export async function leaveSyndicate(commanderId: string): Promise<SyndicateResult> {
  const access = await requireRole(commanderId, ['LEADER', 'OFFICER', 'MEMBER']);
  if (!access.ok) return access;
  if (access.role === 'LEADER') {
    return {
      ok: false,
      error: 'Лидер не может выйти: передай лидерство участнику или распусти синдикат',
      status: 409,
    };
  }

  await prisma.commander.update({
    where: { id: commanderId },
    data: { syndicateId: null, syndicateRole: null },
  });
  return { ok: true, message: 'Ты покинул синдикат' };
}

/** Роспуск: остаток банка возвращается лидеру, участники освобождаются. */
export async function disbandSyndicate(commanderId: string): Promise<SyndicateResult> {
  const access = await requireRole(commanderId, ['LEADER']);
  if (!access.ok) return access;

  try {
    await prisma.$transaction(async (tx) => {
      const bank = await tx.syndicateBank.findUnique({ where: { syndicateId: access.syndicateId } });
      const rest = bank?.credits ?? 0;

      if (rest > 0) {
        await tx.commander.update({
          where: { id: commanderId },
          data: { credits: { increment: rest } },
        });
      }
      await tx.commander.updateMany({
        where: { syndicateId: access.syndicateId },
        data: { syndicateId: null, syndicateRole: null },
      });
      await tx.syndicate.delete({ where: { id: access.syndicateId } });
    });
  } catch (error) {
    return toError(error, 'Не удалось распустить синдикат');
  }

  await syncCredits(commanderId);
  return { ok: true, message: 'Синдикат распущен, остаток банка вернулся лидеру' };
}

/* ------------------------- Банк ------------------------- */

/**
 * Пожертвование в банк синдиката.
 *
 * Списание с личного счета — условный UPDATE: параллельные пожертвования
 * не могут увести баланс в минус, как это было бы при чтении с последующей записью.
 */
export async function donate(commanderId: string, amount: number): Promise<SyndicateResult> {
  const access = await requireRole(commanderId, ['LEADER', 'OFFICER', 'MEMBER']);
  if (!access.ok) return access;

  if (!Number.isFinite(amount) || amount <= 0) {
    return { ok: false, error: 'Сумма должна быть больше нуля', status: 400 };
  }
  if (amount > MAX_DONATION) {
    return { ok: false, error: `Максимум ${MAX_DONATION} ₴ за раз`, status: 400 };
  }

  try {
    await prisma.$transaction(async (tx) => {
      const paid = await tx.commander.updateMany({
        where: { id: commanderId, credits: { gte: amount } },
        data: { credits: { decrement: amount } },
      });
      if (paid.count === 0) throw new SyndicateError('На счету недостаточно криптогривны', 409);

      await tx.syndicateBank.update({
        where: { syndicateId: access.syndicateId },
        data: { credits: { increment: amount } },
      });
      await tx.syndicateTransaction.create({
        data: { syndicateId: access.syndicateId, commanderId, kind: 'DONATION', amount },
      });
    });
  } catch (error) {
    return toError(error, 'Пожертвование не прошло');
  }

  await syncCredits(commanderId);
  return { ok: true, message: `В банк синдиката внесено ${amount} ₴` };
}

/* ------------------------- Служебное ------------------------- */

class SyndicateError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

function toError(error: unknown, fallback: string): SyndicateResult {
  if (error instanceof SyndicateError) return { ok: false, error: error.message, status: error.status };
  console.error('[syndicate] ошибка операции:', error);
  return { ok: false, error: fallback, status: 500 };
}

async function syncCredits(commanderId: string): Promise<void> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { credits: true },
  });
  if (commander) gameLoop.syncCredits(commanderId, commander.credits);
}
