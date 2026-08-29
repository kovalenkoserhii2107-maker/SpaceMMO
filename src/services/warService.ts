/**
 * Базовая дипломатия и отчеты о боях (Этап 5).
 * Война нужна, чтобы вылет с миссией «Атака» вообще разрешался.
 */
import { prisma } from '../db/prisma.js';

export type WarResult = { ok: true; message: string } | { ok: false; error: string };

export interface DiplomacyView {
  /** Игроки, чьи колонии есть в системе игрока. */
  players: Array<{
    userId: string;
    username: string;
    planetName: string;
    atWar: boolean;
    /** Войну объявили мы. */
    declaredByMe: boolean;
    declaredAt: number | null;
  }>;
  battles: Array<{
    id: string;
    role: 'ATTACKER' | 'DEFENDER';
    winner: 'ATTACKER' | 'DEFENDER';
    victory: boolean;
    planetName: string;
    attackerName: string;
    defenderName: string;
    plunder: { metal: number; crystal: number };
    myLosses: Array<{ label: string; lost: number; before: number }>;
    enemyLosses: Array<{ label: string; lost: number; before: number }>;
    attackerPower: number;
    defenderPower: number;
    createdAt: number;
  }>;
}

interface BattleData {
  planetName: string;
  attackerName: string;
  defenderName: string;
  attackerPower: { strength: number };
  defenderPower: { strength: number };
  attackerLosses: Array<{ label: string; lost: number; before: number }>;
  defenderLosses: Array<{ label: string; lost: number; before: number }>;
  plunder: { metal: number; crystal: number };
}

export async function getDiplomacy(userId: string): Promise<DiplomacyView> {
  const home = await prisma.base.findFirst({
    where: { userId },
    include: { planet: true },
  });

  const [planets, wars, battles] = await Promise.all([
    home
      ? prisma.planet.findMany({
          where: { systemId: home.planet.systemId, base: { isNot: null } },
          include: { base: { include: { user: { select: { id: true, username: true } } } } },
          orderBy: { position: 'asc' },
        })
      : Promise.resolve([]),
    prisma.warDeclaration.findMany({
      where: { OR: [{ aggressorId: userId }, { targetId: userId }] },
    }),
    prisma.battleReport.findMany({
      where: { OR: [{ attackerId: userId }, { defenderId: userId }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
  ]);

  return {
    players: planets
      .filter((planet) => planet.base && planet.base.userId !== userId)
      .map((planet) => {
        const opponentId = planet.base!.userId;
        const war = wars.find(
          (item) =>
            (item.aggressorId === userId && item.targetId === opponentId) ||
            (item.aggressorId === opponentId && item.targetId === userId),
        );
        return {
          userId: opponentId,
          username: planet.base!.user.username,
          planetName: planet.name,
          atWar: Boolean(war),
          declaredByMe: war?.aggressorId === userId,
          declaredAt: war ? war.declaredAt.getTime() : null,
        };
      }),
    battles: battles.map((report) => {
      const data = report.data as unknown as BattleData;
      const role = report.attackerId === userId ? 'ATTACKER' : 'DEFENDER';
      return {
        id: report.id,
        role,
        winner: report.winner,
        victory: report.winner === role,
        planetName: data.planetName,
        attackerName: data.attackerName,
        defenderName: data.defenderName,
        plunder: { metal: report.plunderMetal, crystal: report.plunderCrystal },
        myLosses: role === 'ATTACKER' ? data.attackerLosses : data.defenderLosses,
        enemyLosses: role === 'ATTACKER' ? data.defenderLosses : data.attackerLosses,
        attackerPower: Math.round(data.attackerPower.strength),
        defenderPower: Math.round(data.defenderPower.strength),
        createdAt: report.createdAt.getTime(),
      };
    }),
  };
}

/** Объявление войны. Себе объявить нельзя, повтор ничего не ломает. */
export async function declareWar(userId: string, targetId: string): Promise<WarResult> {
  if (!targetId) return { ok: false, error: 'Не указан противник' };
  if (targetId === userId) return { ok: false, error: 'Нельзя объявить войну самому себе' };

  const target = await prisma.user.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false, error: 'Игрок не найден' };

  const existing = await prisma.warDeclaration.findFirst({
    where: {
      OR: [
        { aggressorId: userId, targetId },
        { aggressorId: targetId, targetId: userId },
      ],
    },
  });
  if (existing) return { ok: false, error: 'Война уже идет' };

  await prisma.warDeclaration.create({ data: { aggressorId: userId, targetId } });
  return { ok: true, message: `Война объявлена: ${target.username}` };
}

/** Мир: снимает объявление войны в любую сторону. */
export async function declarePeace(userId: string, targetId: string): Promise<WarResult> {
  const removed = await prisma.warDeclaration.deleteMany({
    where: {
      OR: [
        { aggressorId: userId, targetId },
        { aggressorId: targetId, targetId: userId },
      ],
    },
  });
  if (removed.count === 0) return { ok: false, error: 'Войны с этим игроком нет' };
  return { ok: true, message: 'Заключен мир' };
}
