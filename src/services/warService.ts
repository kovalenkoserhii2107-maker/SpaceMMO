/**
 * Базовая дипломатия и отчеты о боях (Этап 5).
 * Война нужна, чтобы вылет с миссией «Атака» вообще разрешался.
 */
import { prisma } from '../db/prisma.js';
import { expeditionSlots } from '../game/expeditions.js';
import { emptyTechLevels } from '../game/techTree.js';

export type WarResult = { ok: true; message: string } | { ok: false; error: string };

export interface ExpeditionReportView {
  id: string;
  outcome: string;
  systemName: string;
  summary: string;
  loot: { metal: number; crystal: number; antimatter: number };
  losses: Array<{ label: string; lost: number; before: number }>;
  pirates: { LIGHT_FIGHTER: number; TRANSPORTER: number } | null;
  createdAt: number;
}

export interface DiplomacyView {
  /** Игроки, чьи колонии есть в системе игрока. */
  players: Array<{
    commanderId: string;
    nickname: string;
    planetName: string;
    atWar: boolean;
    /** Войну объявили мы. */
    declaredByMe: boolean;
    declaredAt: number | null;
  }>;
  /** Сколько экспедиций игрок может держать в полете и сколько уже летит. */
  expeditionSlots: { total: number; used: number };
  expeditions: ExpeditionReportView[];
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

export async function getDiplomacy(commanderId: string): Promise<DiplomacyView> {
  const home = await prisma.base.findFirst({
    where: { commanderId },
    include: { planet: true },
  });

  const [planets, wars, battles, expeditions, activeExpeditions, techs] = await Promise.all([
    home
      ? prisma.planet.findMany({
          where: { systemId: home.planet.systemId, base: { isNot: null } },
          include: { base: { include: { commander: { select: { id: true, nickname: true } } } } },
          orderBy: { position: 'asc' },
        })
      : Promise.resolve([]),
    prisma.warDeclaration.findMany({
      where: { OR: [{ aggressorId: commanderId }, { targetId: commanderId }] },
    }),
    prisma.battleReport.findMany({
      where: { OR: [{ attackerId: commanderId }, { defenderId: commanderId }] },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.expeditionReport.findMany({
      where: { commanderId },
      include: { system: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.fleet.count({ where: { commanderId, mission: 'EXPEDITION' } }),
    prisma.research.findMany({ where: { commanderId } }),
  ]);

  const techLevels = emptyTechLevels();
  for (const research of techs) techLevels[research.tech] = research.level;

  return {
    expeditionSlots: { total: expeditionSlots(techLevels), used: activeExpeditions },
    expeditions: expeditions.map((report) => {
      const data = report.data as unknown as {
        pirates: { LIGHT_FIGHTER: number; TRANSPORTER: number } | null;
        losses: Array<{ label: string; lost: number; before: number }>;
      };
      return {
        id: report.id,
        outcome: report.outcome,
        systemName: report.system.name,
        summary: report.summary,
        loot: {
          metal: report.lootMetal,
          crystal: report.lootCrystal,
          antimatter: report.lootAntimatter,
        },
        losses: (data.losses ?? []).filter((item) => item.lost > 0),
        pirates: data.pirates ?? null,
        createdAt: report.createdAt.getTime(),
      };
    }),
    players: planets
      .filter((planet) => planet.base && planet.base.commanderId !== commanderId)
      .map((planet) => {
        const opponentId = planet.base!.commanderId;
        const war = wars.find(
          (item) =>
            (item.aggressorId === commanderId && item.targetId === opponentId) ||
            (item.aggressorId === opponentId && item.targetId === commanderId),
        );
        return {
          commanderId: opponentId,
          nickname: planet.base!.commander.nickname,
          planetName: planet.name,
          atWar: Boolean(war),
          declaredByMe: war?.aggressorId === commanderId,
          declaredAt: war ? war.declaredAt.getTime() : null,
        };
      }),
    battles: battles.map((report) => {
      // Json пишет только боевой модуль, поэтому форма данных известна заранее.
      const data = report.data as unknown as BattleData;
      const role = report.attackerId === commanderId ? 'ATTACKER' : 'DEFENDER';
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
export async function declareWar(commanderId: string, targetId: string): Promise<WarResult> {
  if (!targetId) return { ok: false, error: 'Не указан противник' };
  if (targetId === commanderId) return { ok: false, error: 'Нельзя объявить войну самому себе' };

  const target = await prisma.commander.findUnique({ where: { id: targetId } });
  if (!target) return { ok: false, error: 'Командир не найден' };

  const existing = await prisma.warDeclaration.findFirst({
    where: {
      OR: [
        { aggressorId: commanderId, targetId },
        { aggressorId: targetId, targetId: commanderId },
      ],
    },
  });
  if (existing) return { ok: false, error: 'Война уже идет' };

  await prisma.warDeclaration.create({ data: { aggressorId: commanderId, targetId } });
  return { ok: true, message: `Война объявлена: ${target.nickname}` };
}

/** Мир: снимает объявление войны в любую сторону. */
export async function declarePeace(commanderId: string, targetId: string): Promise<WarResult> {
  const removed = await prisma.warDeclaration.deleteMany({
    where: {
      OR: [
        { aggressorId: commanderId, targetId },
        { aggressorId: targetId, targetId: commanderId },
      ],
    },
  });
  if (removed.count === 0) return { ok: false, error: 'Войны с этим игроком нет' };
  return { ok: true, message: 'Заключен мир' };
}
