/**
 * Аренда сети Брам: синдикат-владелец пускает в свои врата игрока или другой
 * синдикат на срок за плату вперед.
 *
 * Жизненный цикл — как у пактов: предложение → принятие с оплатой → срок →
 * история. Предлагает и расторгает со стороны владельца ранг с правом развития
 * Коша (Брамы — его модули); принимает игрок сам за себя или ранг с правом
 * дипломатии за свой синдикат, и платит тот, кто принял: игрок со своего счета,
 * синдикат из казны. Что аренда разрешает, решает вылет флота через
 * `gateAccessFor`; здесь только договор, деньги и письма.
 */
import type { Prisma } from '../generated/prisma/client.js';
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import {
  GATE_LEASE_PRICE_MAX,
  gateLeaseRefund,
  hasPermission,
  isGateLeaseHours,
} from '../game/syndicate.js';
import { deliver } from './mailService.js';
import { membershipOf, requirePermission } from './syndicateAccess.js';

export type LeaseResult = { ok: true; message: string } | { ok: false; error: string; status: number };

export interface GateLeaseView {
  id: string;
  owner: { syndicateId: string; tag: string; name: string };
  tenant: { kind: 'PLAYER'; commanderId: string; nickname: string } | { kind: 'SYNDICATE'; syndicateId: string; tag: string; name: string };
  price: number;
  hours: number;
  status: 'OFFERED' | 'ACTIVE' | 'ENDED';
  startsAt: number | null;
  endsAt: number | null;
  /** Систем со вратами владельца: столько точек сети открывает аренда. */
  gates: number;
  /** Может ли смотрящий принять, отклонить или расторгнуть этот договор. */
  canRespond: boolean;
  canCancel: boolean;
}

export interface GateLeaseOverview {
  /** Договоры, где смотрящий — сторона-владелец (участник синдиката-владельца). */
  given: GateLeaseView[];
  /** Договоры, где арендатор — сам смотрящий или его синдикат. */
  taken: GateLeaseView[];
  /** Может ли смотрящий сдавать врата своего синдиката. */
  canOffer: boolean;
}

class LeaseError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

const LEASE_INCLUDE = {
  owner: { select: { id: true, tag: true, name: true, _count: { select: { gates: true } } } },
  tenantCommander: { select: { id: true, nickname: true } },
  tenantSyndicate: { select: { id: true, tag: true, name: true } },
} as const;

type LeaseRow = Prisma.GateLeaseGetPayload<{ include: typeof LEASE_INCLUDE }>;

function statusOf(row: { startsAt: Date | null; endsAt: Date | null }, now: number): GateLeaseView['status'] {
  if (!row.startsAt) return 'OFFERED';
  return row.endsAt && row.endsAt.getTime() > now ? 'ACTIVE' : 'ENDED';
}

/** История хранится ради строки «чем кончилось», но не бесконечно: неделя. */
const HISTORY_MS = 7 * 24 * 60 * 60 * 1000;

export async function getGateLeases(commanderId: string): Promise<GateLeaseOverview> {
  const now = Date.now();
  const access = await membershipOf(commanderId);
  const syndicateId = access.ok ? access.syndicateId : null;
  const canManage = access.ok && hasPermission(access, 'KISH');
  const canDiplomacy = access.ok && hasPermission(access, 'DIPLOMACY');

  const rows = await prisma.gateLease.findMany({
    where: {
      OR: [
        ...(syndicateId ? [{ ownerSyndicateId: syndicateId }, { tenantSyndicateId: syndicateId }] : []),
        { tenantCommanderId: commanderId },
      ],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: new Date(now - HISTORY_MS) } }] }],
    },
    include: LEASE_INCLUDE,
    orderBy: { createdAt: 'desc' },
  });

  const view = (row: LeaseRow, side: 'OWNER' | 'TENANT'): GateLeaseView => {
    const status = statusOf(row, now);
    const tenantIsMe = row.tenantCommanderId === commanderId;
    const tenantRights = tenantIsMe || (row.tenantSyndicateId !== null && canDiplomacy);
    return {
      id: row.id,
      owner: { syndicateId: row.owner.id, tag: row.owner.tag, name: row.owner.name },
      tenant: row.tenantCommander
        ? { kind: 'PLAYER', commanderId: row.tenantCommander.id, nickname: row.tenantCommander.nickname }
        : { kind: 'SYNDICATE', syndicateId: row.tenantSyndicate!.id, tag: row.tenantSyndicate!.tag, name: row.tenantSyndicate!.name },
      price: row.price,
      hours: row.hours,
      status,
      startsAt: row.startsAt?.getTime() ?? null,
      endsAt: row.endsAt?.getTime() ?? null,
      gates: row.owner._count.gates,
      canRespond: side === 'TENANT' && status === 'OFFERED' && tenantRights,
      canCancel: status !== 'ENDED' && (side === 'OWNER' ? canManage : tenantRights && status === 'ACTIVE'),
    };
  };

  return {
    given: rows.filter((row) => row.ownerSyndicateId === syndicateId).map((row) => view(row, 'OWNER')),
    taken: rows.filter((row) => row.ownerSyndicateId !== syndicateId).map((row) => view(row, 'TENANT')),
    canOffer: canManage,
  };
}

async function notify(recipientIds: string[], subject: string, body: string): Promise<void> {
  const unique = [...new Set(recipientIds)];
  const delivered = await deliver(
    unique.map((recipientId) => ({ recipientId, senderId: null, type: 'SYNDICATE' as const, subject, body })),
  );
  for (const id of delivered) gameLoop.pushUnread(id);
}

async function membersOf(syndicateId: string): Promise<string[]> {
  const rows = await prisma.commander.findMany({ where: { syndicateId }, select: { id: true } });
  return rows.map((row) => row.id);
}

/** Кому писать о договоре со стороны арендатора: игроку или всему его синдикату. */
async function tenantRecipients(lease: { tenantCommanderId: string | null; tenantSyndicateId: string | null }): Promise<string[]> {
  if (lease.tenantCommanderId) return [lease.tenantCommanderId];
  return lease.tenantSyndicateId ? membersOf(lease.tenantSyndicateId) : [];
}

function termText(hours: number): string {
  return hours % 24 === 0 ? `${hours / 24} сут.` : `${hours} ч`;
}

async function atSyndicateWar(first: string, second: string): Promise<boolean> {
  const war = await prisma.syndicateWar.findFirst({
    where: {
      OR: [
        { aggressorId: first, targetId: second },
        { aggressorId: second, targetId: first },
      ],
    },
    select: { id: true },
  });
  return war !== null;
}

export interface LeaseOfferInput {
  tenantKind: 'PLAYER' | 'SYNDICATE';
  /** Позывной игрока или тег синдиката. */
  tenant: string;
  hours: number;
  price: number;
}

export async function offerGateLease(commanderId: string, input: LeaseOfferInput): Promise<LeaseResult> {
  const access = await requirePermission(commanderId, 'KISH');
  if (!access.ok) {
    return {
      ok: false,
      error: access.status === 403 ? 'Сдавать Брамы может ранг с правом развития Коша' : access.error,
      status: access.status,
    };
  }
  if (!isGateLeaseHours(input.hours)) return { ok: false, error: 'Срок аренды: сутки, трое суток, неделя или месяц', status: 400 };
  if (!Number.isSafeInteger(input.price) || input.price < 0 || input.price > GATE_LEASE_PRICE_MAX) {
    return { ok: false, error: `Плата — целое число от 0 до ${GATE_LEASE_PRICE_MAX} ₴`, status: 400 };
  }
  const gates = await prisma.syndicateGate.count({ where: { syndicateId: access.syndicateId } });
  if (gates === 0) return { ok: false, error: 'Сдавать нечего: у синдиката нет ни одной Брамы', status: 409 };

  const name = input.tenant.trim();
  let tenantCommanderId: string | null = null;
  let tenantSyndicateId: string | null = null;
  if (input.tenantKind === 'PLAYER') {
    const player = await prisma.commander.findFirst({
      where: { nickname: { equals: name, mode: 'insensitive' } },
      select: { id: true, syndicateId: true },
    });
    if (!player) return { ok: false, error: 'Игрок с таким позывным не найден', status: 404 };
    if (player.syndicateId === access.syndicateId) {
      return { ok: false, error: 'Участник синдиката и так прыгает через его Брамы', status: 409 };
    }
    tenantCommanderId = player.id;
  } else {
    const tag = name.replace(/^\[|\]$/g, '');
    const syndicate = await prisma.syndicate.findFirst({
      where: { tag: { equals: tag, mode: 'insensitive' } },
      select: { id: true },
    });
    if (!syndicate) return { ok: false, error: 'Синдикат с таким тегом не найден', status: 404 };
    if (syndicate.id === access.syndicateId) return { ok: false, error: 'Свой синдикат и так прыгает через свои Брамы', status: 409 };
    if (await atSyndicateWar(access.syndicateId, syndicate.id)) {
      return { ok: false, error: 'С этим синдикатом идет война — сначала мир', status: 409 };
    }
    tenantSyndicateId = syndicate.id;
  }

  const now = new Date();
  const open = await prisma.gateLease.findFirst({
    where: {
      ownerSyndicateId: access.syndicateId,
      ...(tenantCommanderId ? { tenantCommanderId } : { tenantSyndicateId }),
      OR: [{ startsAt: null }, { endsAt: { gt: now } }],
    },
    select: { startsAt: true },
  });
  if (open) {
    return {
      ok: false,
      error: open.startsAt ? 'Аренда с ним уже действует' : 'Предложение ему уже отправлено и ждет ответа',
      status: 409,
    };
  }

  await prisma.gateLease.create({
    data: {
      ownerSyndicateId: access.syndicateId,
      tenantCommanderId,
      tenantSyndicateId,
      price: input.price,
      hours: input.hours,
      offeredById: commanderId,
    },
  });

  const owner = await prisma.syndicate.findUnique({ where: { id: access.syndicateId }, select: { tag: true, name: true } });
  await notify(
    await tenantRecipients({ tenantCommanderId, tenantSyndicateId }),
    'Предложение аренды Брам',
    `Синдикат [${owner?.tag}] ${owner?.name} предлагает доступ к своей сети Брам (${gates} ` +
      `${gates === 1 ? 'система' : 'систем'}) на ${termText(input.hours)} за ${input.price} ₴. ` +
      'Принять или отклонить — в разделе «Экспедиции и войны», вкладка «Дипломатия».' +
      (tenantSyndicateId ? ' За синдикат отвечает ранг с правом дипломатии, плата — из казны.' : ''),
  );
  return { ok: true, message: 'Предложение аренды отправлено' };
}

export async function respondGateLease(commanderId: string, leaseId: string, accept: boolean): Promise<LeaseResult> {
  const lease = await prisma.gateLease.findUnique({ where: { id: leaseId } });
  if (!lease || lease.startsAt) return { ok: false, error: 'Предложение не найдено', status: 404 };

  let payer: { kind: 'PLAYER' | 'SYNDICATE'; id: string };
  if (lease.tenantCommanderId) {
    if (lease.tenantCommanderId !== commanderId) return { ok: false, error: 'Предложение не найдено', status: 404 };
    payer = { kind: 'PLAYER', id: commanderId };
  } else {
    const access = await requirePermission(commanderId, 'DIPLOMACY');
    if (!access.ok || access.syndicateId !== lease.tenantSyndicateId) {
      return { ok: false, error: 'За синдикат аренду принимает ранг с правом дипломатии', status: 403 };
    }
    payer = { kind: 'SYNDICATE', id: access.syndicateId };
  }

  const owner = await prisma.syndicate.findUnique({ where: { id: lease.ownerSyndicateId }, select: { tag: true, name: true } });
  const me = await prisma.commander.findUnique({ where: { id: commanderId }, select: { nickname: true } });
  const ownerRecipients = await membersOf(lease.ownerSyndicateId);

  if (!accept) {
    const removed = await prisma.gateLease.deleteMany({ where: { id: lease.id, startsAt: null } });
    if (removed.count === 0) return { ok: false, error: 'Предложение уже рассмотрено', status: 409 };
    await notify(ownerRecipients, 'Аренда Брам отклонена', `${me?.nickname ?? 'Арендатор'} отклонил предложение аренды Брам.`);
    return { ok: true, message: 'Предложение отклонено' };
  }

  if (payer.kind === 'SYNDICATE' && (await atSyndicateWar(lease.ownerSyndicateId, payer.id))) {
    return { ok: false, error: 'С этим синдикатом идет война — сначала мир', status: 409 };
  }

  const startsAt = new Date();
  const endsAt = new Date(startsAt.getTime() + lease.hours * 3600 * 1000);
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lease.ownerSyndicateId}))::text AS locked`;
      const started = await tx.gateLease.updateMany({
        where: { id: lease.id, startsAt: null },
        data: { startsAt, endsAt, paidById: payer.kind === 'PLAYER' ? commanderId : null },
      });
      if (started.count === 0) throw new LeaseError('Предложение уже рассмотрено', 409);
      if (lease.price <= 0) return;

      if (payer.kind === 'PLAYER') {
        const paid = await tx.commander.updateMany({
          where: { id: commanderId, credits: { gte: lease.price } },
          data: { credits: { decrement: lease.price } },
        });
        if (paid.count === 0) throw new LeaseError('На счету недостаточно криптогривны', 409);
      } else {
        const paid = await tx.syndicateBank.updateMany({
          where: { syndicateId: payer.id, credits: { gte: lease.price } },
          data: { credits: { decrement: lease.price } },
        });
        if (paid.count === 0) throw new LeaseError('В казне недостаточно криптогривны', 409);
        await tx.syndicateTransaction.create({
          data: {
            syndicateId: payer.id,
            actorId: commanderId,
            kind: 'GATE_LEASE_PAYMENT',
            amount: lease.price,
            comment: `аренда Брам [${owner?.tag}]`,
          },
        });
      }
      await tx.syndicateBank.update({
        where: { syndicateId: lease.ownerSyndicateId },
        data: { credits: { increment: lease.price } },
      });
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: lease.ownerSyndicateId,
          actorId: commanderId,
          kind: 'GATE_LEASE_INCOME',
          amount: lease.price,
          comment: `аренда Брам: ${me?.nickname ?? 'арендатор'}`,
        },
      });
    });
  } catch (error) {
    if (error instanceof LeaseError) return { ok: false, error: error.message, status: error.status };
    console.error('[gates] аренда не прошла:', error);
    return { ok: false, error: 'Аренда не прошла', status: 500 };
  }

  if (payer.kind === 'PLAYER') await syncCredits(commanderId);
  await notify(
    ownerRecipients,
    'Аренда Брам принята',
    `${me?.nickname ?? 'Арендатор'} принял аренду Брам на ${termText(lease.hours)}: в казну поступило ${lease.price} ₴.`,
  );
  return { ok: true, message: `Аренда Брам [${owner?.tag}] действует ${termText(lease.hours)}` };
}

/**
 * Отзыв предложения или расторжение действующей аренды.
 *
 * Владелец может отозвать предложение и расторгнуть аренду — с возвратом
 * за неиспользованный срок из своей казны. Арендатор может выйти из аренды
 * досрочно, но без возврата: это его решение.
 */
export async function cancelGateLease(commanderId: string, leaseId: string): Promise<LeaseResult> {
  const lease = await prisma.gateLease.findUnique({ where: { id: leaseId } });
  if (!lease) return { ok: false, error: 'Договор не найден', status: 404 };
  const now = Date.now();
  const status = statusOf(lease, now);
  if (status === 'ENDED') return { ok: false, error: 'Аренда уже закончилась', status: 409 };

  const access = await membershipOf(commanderId);
  const ownerSide = access.ok && access.syndicateId === lease.ownerSyndicateId;
  if (ownerSide) {
    if (!hasPermission(access, 'KISH')) return { ok: false, error: 'Расторгать аренду может ранг с правом развития Коша', status: 403 };
  } else {
    const tenantSelf = lease.tenantCommanderId === commanderId;
    const tenantRank = access.ok && lease.tenantSyndicateId === access.syndicateId && hasPermission(access, 'DIPLOMACY');
    if (!tenantSelf && !tenantRank) return { ok: false, error: 'Договор не найден', status: 404 };
    if (status === 'OFFERED') return respondGateLease(commanderId, leaseId, false);
  }

  if (status === 'OFFERED') {
    const removed = await prisma.gateLease.deleteMany({ where: { id: lease.id, startsAt: null } });
    if (removed.count === 0) return { ok: false, error: 'Предложение уже рассмотрено', status: 409 };
    return { ok: true, message: 'Предложение аренды отозвано' };
  }

  const refund = ownerSide ? gateLeaseRefund(lease.price, lease.startsAt!.getTime(), lease.endsAt!.getTime(), now) : 0;
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lease.ownerSyndicateId}))::text AS locked`;
      const ended = await tx.gateLease.updateMany({
        where: { id: lease.id, endsAt: { gt: new Date(now) } },
        data: { endsAt: new Date(now) },
      });
      if (ended.count === 0) throw new LeaseError('Аренда уже закончилась', 409);
      if (refund <= 0) return;
      const paid = await tx.syndicateBank.updateMany({
        where: { syndicateId: lease.ownerSyndicateId, credits: { gte: refund } },
        data: { credits: { decrement: refund } },
      });
      if (paid.count === 0) throw new LeaseError(`В казне нет ${refund} ₴ на возврат за неиспользованный срок`, 409);
      await tx.syndicateTransaction.create({
        data: { syndicateId: lease.ownerSyndicateId, actorId: commanderId, kind: 'GATE_LEASE_REFUND', amount: refund, comment: 'возврат за аренду Брам' },
      });
      if (lease.tenantCommanderId) {
        await tx.commander.update({ where: { id: lease.tenantCommanderId }, data: { credits: { increment: refund } } });
      } else if (lease.tenantSyndicateId) {
        await tx.syndicateBank.update({ where: { syndicateId: lease.tenantSyndicateId }, data: { credits: { increment: refund } } });
        // Для казны арендатора возврат — поступление, отсюда вид «доход от аренды».
        await tx.syndicateTransaction.create({
          data: { syndicateId: lease.tenantSyndicateId, actorId: commanderId, kind: 'GATE_LEASE_INCOME', amount: refund, comment: 'возврат за аренду Брам' },
        });
      }
    });
  } catch (error) {
    if (error instanceof LeaseError) return { ok: false, error: error.message, status: error.status };
    console.error('[gates] расторжение не прошло:', error);
    return { ok: false, error: 'Расторжение не прошло', status: 500 };
  }

  if (lease.tenantCommanderId && refund > 0) await syncCredits(lease.tenantCommanderId);
  const others = ownerSide ? await tenantRecipients(lease) : await membersOf(lease.ownerSyndicateId);
  await notify(
    others,
    'Аренда Брам расторгнута',
    ownerSide
      ? `Владелец расторг аренду Брам досрочно${refund > 0 ? `, возврат за неиспользованный срок — ${refund} ₴` : ''}.`
      : 'Арендатор досрочно вышел из аренды Брам.',
  );
  return { ok: true, message: refund > 0 ? `Аренда расторгнута, возвращено ${refund} ₴` : 'Аренда расторгнута' };
}

async function syncCredits(commanderId: string): Promise<void> {
  const commander = await prisma.commander.findUnique({ where: { id: commanderId }, select: { credits: true } });
  if (commander) gameLoop.syncCredits(commanderId, commander.credits);
}
