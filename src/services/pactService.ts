/**
 * Пакты между синдикатами: ненападение, союз и торговое соглашение.
 *
 * Предлагает и принимает пакт ранг с правом дипломатии, расторгает любая
 * сторона — с отсрочкой в сутки. Что пакт разрешает и запрещает, решают
 * вылет флота, война и биржа через `pactsInForce`; здесь только жизненный
 * цикл пакта и письма о нем.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { PACT_LABELS, PACT_NOTICE_MS, pactPair, type PactKind } from '../game/syndicate.js';
import { deliver } from './mailService.js';
import { requirePermission } from './syndicateAccess.js';

export type PactResult = { ok: true; message: string } | { ok: false; error: string };

async function diplomat(commanderId: string): Promise<{ ok: true; syndicateId: string } | { ok: false; error: string }> {
  const access = await requirePermission(commanderId, 'DIPLOMACY');
  if (!access.ok) {
    return {
      ok: false,
      error: access.status === 403 ? 'Пакты от лица синдиката заключают ранги с правом дипломатии' : access.error,
    };
  }
  return { ok: true, syndicateId: access.syndicateId };
}

async function atWar(first: string, second: string): Promise<boolean> {
  const war = await prisma.syndicateWar.findFirst({
    where: {
      OR: [
        { aggressorId: first, targetId: second },
        { aggressorId: second, targetId: first },
      ],
    },
  });
  return war !== null;
}

/** Пакт касается всего состава, поэтому письмо получает каждый участник. */
async function notifySyndicates(syndicateIds: string[], subject: string, body: string): Promise<void> {
  const members = await prisma.commander.findMany({
    where: { syndicateId: { in: syndicateIds } },
    select: { id: true },
  });
  const recipients = await deliver(
    members.map((member) => ({ recipientId: member.id, senderId: null, type: 'SYNDICATE' as const, subject, body })),
  );
  for (const id of recipients) gameLoop.pushUnread(id);
}

async function syndicateName(id: string): Promise<string> {
  const row = await prisma.syndicate.findUnique({ where: { id }, select: { name: true, tag: true } });
  return row ? `[${row.tag}] ${row.name}` : 'синдикат';
}

export async function proposePact(commanderId: string, targetSyndicateId: string, type: PactKind): Promise<PactResult> {
  const rights = await diplomat(commanderId);
  if (!rights.ok) return rights;
  if (rights.syndicateId === targetSyndicateId) return { ok: false, error: 'Пакт со своим синдикатом не заключают' };
  const target = await prisma.syndicate.findUnique({ where: { id: targetSyndicateId }, select: { id: true } });
  if (!target) return { ok: false, error: 'Синдикат не найден' };
  // Торговать можно и с врагом, а мириться пактом, не кончив войну, нельзя.
  if (type !== 'TRADE' && (await atWar(rights.syndicateId, targetSyndicateId))) {
    return { ok: false, error: 'Между синдикатами идет война — сначала заключите мир' };
  }

  const [first, second] = pactPair(rights.syndicateId, targetSyndicateId);
  const existing = await prisma.syndicatePact.findUnique({
    where: { firstSyndicateId_secondSyndicateId_type: { firstSyndicateId: first, secondSyndicateId: second, type } },
  });
  if (existing) {
    const expired = existing.status === 'ACTIVE' && existing.endsAt !== null && existing.endsAt.getTime() <= Date.now();
    if (!expired) {
      return {
        ok: false,
        error: existing.status === 'ACTIVE' ? 'Такой пакт уже действует' : 'Такой пакт уже предложен и ждет ответа',
      };
    }
    await prisma.syndicatePact.deleteMany({ where: { id: existing.id, status: 'ACTIVE' } });
  }

  try {
    await prisma.syndicatePact.create({
      data: {
        firstSyndicateId: first,
        secondSyndicateId: second,
        type,
        proposerSyndicateId: rights.syndicateId,
        proposedById: commanderId,
      },
    });
  } catch {
    // Уникальный индекс: вторая сторона успела предложить то же самое одновременно.
    return { ok: false, error: 'Такой пакт уже предложен и ждет ответа' };
  }

  const proposer = await syndicateName(rights.syndicateId);
  await notifySyndicates(
    [targetSyndicateId],
    `Предложение пакта: ${PACT_LABELS[type]}`,
    `Синдикат ${proposer} предлагает пакт «${PACT_LABELS[type]}». Принять или отклонить его может ранг ` +
      'с правом дипломатии в разделе войн и дипломатии.',
  );
  return { ok: true, message: `Предложение пакта «${PACT_LABELS[type]}» отправлено` };
}

export async function respondPact(commanderId: string, pactId: string, accept: boolean): Promise<PactResult> {
  const rights = await diplomat(commanderId);
  if (!rights.ok) return rights;
  const pact = await prisma.syndicatePact.findUnique({ where: { id: pactId } });
  const involved = pact && (pact.firstSyndicateId === rights.syndicateId || pact.secondSyndicateId === rights.syndicateId);
  if (!pact || !involved || pact.status !== 'PROPOSED') return { ok: false, error: 'Предложение не найдено' };
  if (pact.proposerSyndicateId === rights.syndicateId) {
    return { ok: false, error: 'Свое предложение принимает другая сторона — его можно только отозвать' };
  }
  const label = PACT_LABELS[pact.type];
  const other = pact.proposerSyndicateId;
  const us = await syndicateName(rights.syndicateId);

  if (!accept) {
    const removed = await prisma.syndicatePact.deleteMany({ where: { id: pact.id, status: 'PROPOSED' } });
    if (removed.count === 0) return { ok: false, error: 'Предложение уже рассмотрено' };
    await notifySyndicates([other], `Пакт отклонен: ${label}`, `Синдикат ${us} отклонил предложение пакта «${label}».`);
    return { ok: true, message: `Предложение пакта «${label}» отклонено` };
  }

  if (pact.type !== 'TRADE' && (await atWar(pact.firstSyndicateId, pact.secondSyndicateId))) {
    return { ok: false, error: 'Между синдикатами идет война — сначала заключите мир' };
  }
  const accepted = await prisma.syndicatePact.updateMany({
    where: { id: pact.id, status: 'PROPOSED' },
    data: { status: 'ACTIVE', activatedAt: new Date() },
  });
  if (accepted.count === 0) return { ok: false, error: 'Предложение уже рассмотрено' };
  const them = await syndicateName(other);
  await notifySyndicates(
    [pact.firstSyndicateId, pact.secondSyndicateId],
    `Пакт заключен: ${label}`,
    `Синдикаты ${them} и ${us} заключили пакт «${label}».`,
  );
  return { ok: true, message: `Пакт «${label}» заключен` };
}

/**
 * Отзыв своего предложения или расторжение действующего пакта.
 * Расторгнутый пакт действует еще сутки, и об этом узнают обе стороны.
 */
export async function cancelPact(commanderId: string, pactId: string): Promise<PactResult> {
  const rights = await diplomat(commanderId);
  if (!rights.ok) return rights;
  const pact = await prisma.syndicatePact.findUnique({ where: { id: pactId } });
  const involved = pact && (pact.firstSyndicateId === rights.syndicateId || pact.secondSyndicateId === rights.syndicateId);
  if (!pact || !involved) return { ok: false, error: 'Пакт не найден' };
  const label = PACT_LABELS[pact.type];

  if (pact.status === 'PROPOSED') {
    if (pact.proposerSyndicateId !== rights.syndicateId) {
      return { ok: false, error: 'Чужое предложение не отзывают — его отклоняют' };
    }
    await prisma.syndicatePact.deleteMany({ where: { id: pact.id, status: 'PROPOSED' } });
    return { ok: true, message: `Предложение пакта «${label}» отозвано` };
  }

  if (pact.endsAt) return { ok: false, error: 'Пакт уже расторгается' };
  const endsAt = new Date(Date.now() + PACT_NOTICE_MS);
  const cancelled = await prisma.syndicatePact.updateMany({
    where: { id: pact.id, status: 'ACTIVE', endsAt: null },
    data: { endsAt },
  });
  if (cancelled.count === 0) return { ok: false, error: 'Пакт уже расторгается' };
  const us = await syndicateName(rights.syndicateId);
  await notifySyndicates(
    [pact.firstSyndicateId, pact.secondSyndicateId],
    `Пакт расторгается: ${label}`,
    `Синдикат ${us} расторг пакт «${label}». Пакт действует еще сутки, до ` +
      `${endsAt.toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC.`,
  );
  return { ok: true, message: `Пакт «${label}» расторгнут: действует еще сутки` };
}
