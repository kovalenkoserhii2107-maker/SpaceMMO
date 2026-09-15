/**
 * Членство и права в синдикате — отдельно от сервиса синдиката.
 *
 * Права нужны не только ему: войну от лица синдиката объявляет сервис войн,
 * а он импортируется игровым циклом. Держи проверку в сервисе синдиката —
 * и цепочка импортов замкнулась бы в кольцо через игровой цикл. Здесь
 * зависимостей две: база и чистые правила.
 */
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  DEFAULT_RANKS,
  NEUTRAL_SYNDICATE_BUFFS,
  pactPair,
  type PactKind,
  effectiveSyndicateTechs,
  emptySyndicateTechLevels,
  hasPermission,
  legacyRankPosition,
  syndicateBuffs,
  type MemberAuthority,
  type SyndicateBuffs,
  type SyndicatePermission,
  type SyndicateTech,
  type SyndicateTechLevels,
} from '../game/syndicate.js';

export interface Membership extends MemberAuthority {
  commanderId: string;
  syndicateId: string;
  rankId: string;
  rankName: string;
  dailyWithdrawLimit: number;
}

export type AccessResult =
  | ({ ok: true } & Membership)
  | { ok: false; error: string; status: number };

type Tx = Prisma.TransactionClient;

/**
 * Досоздает то, чего нет у синдикатов, основанных до рангов и Коша.
 *
 * Делается при первом обращении, а не миграцией данных: схему меняют
 * миграции Prisma, а раскладывать людей по рангам — дело кода, который
 * знает, какой прежней роли какой ранг соответствует. Повторный вызов
 * ничего не меняет, поэтому звать его можно перед любой операцией.
 */
export async function ensureSyndicateSetup(syndicateId: string, client: Tx | typeof prisma = prisma): Promise<void> {
  const syndicate = await client.syndicate.findUnique({
    where: { id: syndicateId },
    select: {
      kishSystemId: true,
      leaderId: true,
      ranks: { select: { id: true, position: true }, orderBy: { position: 'asc' } },
      members: { select: { id: true, syndicateRole: true, syndicateRankId: true, syndicateJoinedAt: true } },
    },
  });
  if (!syndicate) return;

  let ranks = syndicate.ranks;
  if (ranks.length === 0) {
    try {
      await client.syndicateRank.createMany({
        data: DEFAULT_RANKS.map((rank) => ({
          syndicateId,
          name: rank.name,
          position: rank.position,
          permissions: rank.permissions,
          dailyWithdrawLimit: rank.dailyWithdrawLimit,
        })),
        skipDuplicates: true,
      });
    } catch {
      // Параллельный запрос успел создать ранги первым — это ровно то, что нужно.
    }
    ranks = await client.syndicateRank.findMany({
      where: { syndicateId },
      select: { id: true, position: true },
      orderBy: { position: 'asc' },
    });
  }

  const top = ranks[0];
  const lowest = ranks[ranks.length - 1];
  if (!top || !lowest) return;

  for (const member of syndicate.members) {
    if (member.syndicateRankId && member.syndicateJoinedAt) continue;
    let rankId = member.syndicateRankId;
    if (!rankId) {
      const position = member.id === syndicate.leaderId ? 0 : legacyRankPosition(member.syndicateRole);
      rankId = (ranks.find((rank) => rank.position === position) ?? lowest).id;
    }
    await client.commander.update({
      where: { id: member.id },
      data: { syndicateRankId: rankId, syndicateJoinedAt: member.syndicateJoinedAt ?? new Date() },
    });
  }

  if (!syndicate.kishSystemId) {
    const capital = await client.base.findFirst({
      where: { commanderId: syndicate.leaderId },
      orderBy: { createdAt: 'asc' },
      select: { planet: { select: { systemId: true } } },
    });
    if (capital) {
      await client.syndicate.update({ where: { id: syndicateId }, data: { kishSystemId: capital.planet.systemId } });
    }
  }
}

/** Членство командира с его рангом и правами, либо причина отказа. */
export async function membershipOf(commanderId: string): Promise<AccessResult> {
  const probe = await prisma.commander.findUnique({ where: { id: commanderId }, select: { syndicateId: true } });
  if (!probe?.syndicateId) return { ok: false, error: 'Ты не состоишь в синдикате', status: 409 };

  await ensureSyndicateSetup(probe.syndicateId);

  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: {
      syndicateId: true,
      syndicate: { select: { leaderId: true } },
      syndicateRank: true,
    },
  });
  if (!commander?.syndicateId || !commander.syndicate || !commander.syndicateRank) {
    return { ok: false, error: 'Ты не состоишь в синдикате', status: 409 };
  }

  const isLeader = commander.syndicate.leaderId === commanderId;
  return {
    ok: true,
    commanderId,
    syndicateId: commander.syndicateId,
    rankId: commander.syndicateRank.id,
    rankName: commander.syndicateRank.name,
    // Главарь стоит на вершине, какой бы ранг ни был записан: иначе ошибка
    // в правке рангов могла бы запереть его под собственными офицерами.
    position: isLeader ? 0 : Math.max(1, commander.syndicateRank.position),
    permissions: commander.syndicateRank.permissions,
    dailyWithdrawLimit: commander.syndicateRank.dailyWithdrawLimit,
    isLeader,
  };
}

export async function requirePermission(commanderId: string, permission: SyndicatePermission): Promise<AccessResult> {
  const access = await membershipOf(commanderId);
  if (!access.ok) return access;
  if (!hasPermission(access, permission)) {
    return { ok: false, error: 'Недостаточно прав в синдикате', status: 403 };
  }
  return access;
}

export async function requireLeader(commanderId: string): Promise<AccessResult> {
  const access = await membershipOf(commanderId);
  if (!access.ok) return access;
  if (!access.isLeader) return { ok: false, error: 'Это решает только главарь синдиката', status: 403 };
  return access;
}

/** Состоят ли двое в одном синдикате. Своих не атакуют ни при какой войне. */
export async function sameSyndicate(firstId: string, secondId: string): Promise<boolean> {
  const rows = await prisma.commander.findMany({
    where: { id: { in: [firstId, secondId] } },
    select: { syndicateId: true },
  });
  return rows.length === 2 && rows[0]!.syndicateId !== null && rows[0]!.syndicateId === rows[1]!.syndicateId;
}

/**
 * Сколько выдал из казны сам выдающий за скользящие сутки.
 *
 * Гривна и ресурсы идут в один лимит единица за единицу: деление на два
 * лимита позволило бы вывести и то и другое, а защищает лимит от одного —
 * от офицера, который выносит казну и уходит.
 */
export async function withdrawnToday(
  syndicateId: string,
  actorId: string,
  client: Tx | typeof prisma = prisma,
): Promise<number> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const sum = await client.syndicateTransaction.aggregate({
    where: { syndicateId, actorId, kind: { in: ['PAYOUT', 'RESOURCE_PICKUP'] }, createdAt: { gte: since } },
    _sum: { amount: true },
  });
  return sum._sum.amount ?? 0;
}

export interface SyndicateTechState {
  levels: SyndicateTechLevels;
  research: { tech: SyndicateTech; targetLevel: number; finishesAt: number } | null;
}

/** Уровни технологий синдиката и идущее изучение — как они лежат в базе. */
export async function syndicateTechState(
  syndicateId: string,
  client: Tx | typeof prisma = prisma,
): Promise<SyndicateTechState> {
  const [technologies, research] = await Promise.all([
    client.syndicateTechnology.findMany({ where: { syndicateId }, select: { tech: true, level: true } }),
    client.syndicateResearch.findUnique({ where: { syndicateId } }),
  ]);
  const levels = emptySyndicateTechLevels();
  for (const row of technologies) levels[row.tech] = row.level;
  return {
    levels,
    research: research
      ? { tech: research.tech, targetLevel: research.targetLevel, finishesAt: research.finishesAt.getTime() }
      : null,
  };
}

/**
 * Бонусы синдиката для командира, которого может не быть в памяти тика.
 *
 * Прилет флота, грабеж и сделка на бирже случаются и у офлайновых
 * игроков, поэтому бонусы читаются из базы, а не из кеша тика.
 */
export async function syndicateBuffsFor(commanderId: string, now = Date.now()): Promise<SyndicateBuffs> {
  const row = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { syndicateId: true, syndicateJoinedAt: true },
  });
  if (!row?.syndicateId) return NEUTRAL_SYNDICATE_BUFFS;
  const state = await syndicateTechState(row.syndicateId);
  return syndicateBuffs(
    effectiveSyndicateTechs(state.levels, state.research, now),
    row.syndicateJoinedAt?.getTime() ?? null,
    now,
  );
}

/**
 * Пакты, действующие между двумя синдикатами прямо сейчас.
 *
 * Лежат здесь, а не в сервисе пактов: их спрашивают вылет флота, война
 * и биржа, а сервис пактов рассылает письма и тянет за собой игровой цикл.
 */
export async function pactsInForce(
  firstSyndicateId: string | null,
  secondSyndicateId: string | null,
  client: Tx | typeof prisma = prisma,
  now = Date.now(),
): Promise<PactKind[]> {
  if (!firstSyndicateId || !secondSyndicateId || firstSyndicateId === secondSyndicateId) return [];
  const [first, second] = pactPair(firstSyndicateId, secondSyndicateId);
  const rows = await client.syndicatePact.findMany({
    where: {
      firstSyndicateId: first,
      secondSyndicateId: second,
      status: 'ACTIVE',
      OR: [{ endsAt: null }, { endsAt: { gt: new Date(now) } }],
    },
    select: { type: true },
  });
  return rows.map((row) => row.type);
}

/** Пакты между синдикатами двух командиров; у одиночки пактов нет. */
export async function commanderPacts(firstCommanderId: string, secondCommanderId: string): Promise<PactKind[]> {
  const rows = await prisma.commander.findMany({
    where: { id: { in: [firstCommanderId, secondCommanderId] } },
    select: { id: true, syndicateId: true },
  });
  const first = rows.find((row) => row.id === firstCommanderId)?.syndicateId ?? null;
  const second = rows.find((row) => row.id === secondCommanderId)?.syndicateId ?? null;
  return pactsInForce(first, second);
}

/** Синдикаты, с которыми у этого действует союз. */
export async function alliedSyndicateIds(syndicateId: string, now = Date.now()): Promise<string[]> {
  const rows = await prisma.syndicatePact.findMany({
    where: {
      type: 'ALLIANCE',
      status: 'ACTIVE',
      OR: [{ firstSyndicateId: syndicateId }, { secondSyndicateId: syndicateId }],
      AND: [{ OR: [{ endsAt: null }, { endsAt: { gt: new Date(now) } }] }],
    },
    select: { firstSyndicateId: true, secondSyndicateId: true },
  });
  return rows.map((row) => (row.firstSyndicateId === syndicateId ? row.secondSyndicateId : row.firstSyndicateId));
}
