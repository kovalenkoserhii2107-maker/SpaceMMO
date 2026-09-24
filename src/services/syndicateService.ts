/**
 * Синдикаты: объединения командиров с Кошем, казной, рангами, кодексом и налогом.
 *
 * Права живут в рангах, а проверка прав — в одном месте (`syndicateAccess.ts`):
 * каждое изменяющее действие начинается с `requirePermission` или
 * `requireLeader`, и открыть действие всем подряд случайно нельзя.
 * Формулы — предел состава, цена Коша, налог — в `game/syndicate.ts`.
 */
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { SyndicateRecruitment } from '../generated/prisma/enums.js';
import { deliver } from './mailService.js';
import { gameLoop } from '../game/gameLoop.js';
import { getLeaderboard } from './scoreService.js';
import { galaxyDistance } from '../game/fleets.js';
import { DEFENSE_TYPES, defenseCost, defenseLabel, type DefenseType } from '../game/defenses.js';
import {
  syndicateBuildSeconds,
  syndicateModuleCost,
  syndicateModuleLabel,
  modulePermission,
  syndicateModuleProjection,
  syndicateTechProjection,
  type SyndicateModule,
  type SyndicateProjection,
  DESCRIPTION_MAX_LENGTH,
  treasuryFlow,
  type TreasuryFlow,
  CODEX_MAX_LENGTH,
  DEFAULT_RANKS,
  LEAVE_COOLDOWN_MS,
  MAX_RANKS,
  MAX_TAX_RATE,
  PERMISSION_LABELS,
  SYNDICATE_PERMISSIONS,
  TAX_DELAY_MS,
  clampTaxRate,
  effectiveTaxRate,
  hasPermission,
  isWatched,
  kishUpgradeCost,
  memberCap,
  outranks,
  academyUpgradeCost,
  bramaThroughput,
  gateSiegeShield,
  bramaUpgradeCost,
  treasuryProtectedShare,
  treasuryUpgradeCost,
  kishMoveAvailableAt,
  kishMoveCost,
  SYNDICATE_TECHS,
  SYNDICATE_TECH_EFFECTS,
  SYNDICATE_TECH_LABELS,
  syndicateResearchSeconds,
  syndicateTechCost,
  type SyndicateTech,
  type TreasuryCost,
  watchRadius,
  watchUpgradeCost,
  withdrawAllowance,
  type SyndicatePermission,
  missingSyndicateRequirements,
  requirementViews,
  requirementsText,
  syndicateProgress,
  type SyndicateRequirementView,
} from '../game/syndicate.js';
import { alliedSyndicateIds,
  ensureSyndicateSetup,
  membershipOf,
  requireLeader,
  requirePermission,
  syndicateTechState,
  withdrawnToday,
  type Membership,
} from './syndicateAccess.js';

/** Стоимость основания синдиката в криптогривне. */
export const FOUNDING_COST = 5000;
/**
 * Предел одного взноса — от опечатки лишними нулями, а не от щедрости:
 * миллион за раз не давал внести в казну на Браму, которая стоит миллионы.
 */
export const MAX_DONATION = 1_000_000_000;
/** Предел вступительного взноса: взнос — порог, а не способ отобрать счет новичка. */
export const MAX_ENTRY_FEE = 1_000_000;

export type SyndicateResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number };

export interface SyndicateSummary {
  id: string;
  name: string;
  tag: string;
  description: string;
  leader: string;
  members: number;
  memberCap: number;
  kishLevel: number;
  recruitment: SyndicateRecruitment;
  minScore: number;
  entryFee: number;
  taxRate: number;
  hasCodex: boolean;
  createdAt: number;
  /** Заявка текущего командира в этот синдикат, если она есть. */
  applicationStatus: string | null;
}

export interface SyndicateMemberView {
  commanderId: string;
  nickname: string;
  avatarId: string;
  rankId: string | null;
  rankName: string;
  position: number;
  isLeader: boolean;
  merit: number;
  taxToday: number;
  joinedAt: number | null;
  battlesWon: number;
  battlesLost: number;
  /** Можно ли зрителю действовать на этого участника: ранг зрителя выше. */
  outrankedByMe: boolean;
}

export interface SyndicateRankView {
  id: string;
  name: string;
  position: number;
  permissions: SyndicatePermission[];
  dailyWithdrawLimit: number;
  members: number;
}

export interface SyndicateView {
  id: string;
  name: string;
  tag: string;
  description: string;
  /** Идущая стройка в Коше — одна на синдикат. */
  construction: {
    module: SyndicateModule;
    label: string;
    systemId: string | null;
    systemName: string | null;
    targetLevel: number;
    remainingSeconds: number;
    totalSeconds: number;
  } | null;
  /** Вклад участников за все время и движение казны за неделю. */
  stats: {
    contributions: Array<{ commanderId: string; nickname: string; merit: number; credits: number; tax: number; resources: number }>;
    week: { creditsIn: number; creditsOut: number; resourcesIn: number; resourcesOut: number };
  };
  createdAt: number;
  leaderId: string;
  me: {
    rankId: string;
    rankName: string;
    isLeader: boolean;
    /** Права зрителя с учетом того, что у главаря есть все. */
    permissions: SyndicatePermission[];
    /** Сколько еще можно выдать из казны за сутки; `null` — без предела. */
    withdrawLeft: number | null;
  };
  bank: number;
  /** Ресурсная казна Коша: привозят и вывозят ее флотом. */
  treasury: { ore: number; polymers: number; plasma: number; antimatter: number };
  gates: {
    list: Array<{
      systemId: string;
      systemName: string;
      level: number;
      throughput: number;
      /** Сколько кораблей прошло в текущем часовом окне. */
      windowShips: number;
      /** Щит врат против осады: такой залп уцелевшей эскадры их выключает. */
      siegeShield: number;
      /** Выключены осадой до (мс); `null` — работают. */
      disabledUntil: number | null;
      /** Неуязвимы после осады до (мс). */
      siegeImmuneUntil: number | null;
      nextLevelCost: TreasuryCost;
      nextLevelSeconds: number;
      /** Чего не хватает на следующий уровень — как у построек колонии. */
      nextLevelRequirements: SyndicateRequirementView[];
    }>;
    /** Системы с колониями участников, где Брамы еще нет. */
    candidates: Array<{ systemId: string; systemName: string }>;
    firstLevelCost: TreasuryCost;
    firstLevelSeconds: number;
    firstLevelRequirements: SyndicateRequirementView[];
  };
  kish: {
    level: number;
    systemId: string | null;
    systemName: string | null;
    memberCap: number;
    nextLevelCost: number;
    nextLevelSeconds: number;
    nextLevelRequirements: SyndicateRequirementView[];
    /** Когда Кіш снова можно перенести; `null` — хоть сейчас. */
    nextMoveAt: number | null;
    /** К Кошу летит налет: пока он в пути, переносить Кіш нельзя. */
    underRaid: boolean;
    treasuryLevel: number;
    /** Несгораемая доля казны при налете. */
    protectedShare: number;
    nextTreasuryCost: TreasuryCost;
    nextTreasurySeconds: number;
    nextTreasuryRequirements: SyndicateRequirementView[];
    defenses: Array<{ type: DefenseType; label: string; count: number; cost: { ore: number; polymers: number; plasma: number } }>;
    debris: { ore: number; polymers: number };
    /** Флоты участников на удержании у Коша. */
    guards: Array<{ nickname: string; ships: number; until: number | null }>;
    /** Системы со своими Брамами, куда Кіш можно перенести, и цена в антиматерии. */
    moveTargets: Array<{ systemId: string; systemName: string; distance: number; antimatter: number }>;
  };
  academy: {
    level: number;
    nextLevelCost: TreasuryCost;
    nextLevelSeconds: number;
    nextLevelRequirements: SyndicateRequirementView[];
    techs: Array<{
      tech: SyndicateTech;
      label: string;
      effect: string;
      level: number;
      nextCost: TreasuryCost;
      seconds: number;
      /** Чего не хватает на следующий уровень; Академия — одно из требований. */
      requirements: SyndicateRequirementView[];
      /** Можно ли изучать следующий уровень прямо сейчас: требования выполнены и Академия свободна. */
      available: boolean;
    }>;
    research: { tech: SyndicateTech; label: string; targetLevel: number; remainingSeconds: number; totalSeconds: number } | null;
  };
  watch: {
    level: number;
    /** Радиус наблюдения от Коша в единицах карты; −1 — Дозор не построен. */
    radius: number;
    nextLevelCost: number;
    nextLevelSeconds: number;
    nextLevelRequirements: SyndicateRequirementView[];
    incoming: WatchedFleet[];
  };
  rules: { recruitment: SyndicateRecruitment; minScore: number; entryFee: number };
  tax: { rate: number; pendingRate: number | null; effectiveAt: number | null; maxRate: number };
  codex: { id: string; text: string; updatedAt: number; author: string | null } | null;
  ranks: SyndicateRankView[];
  members: SyndicateMemberView[];
  /** Заявки видны только тем, кто может их разбирать. */
  applications: Array<{ id: string; nickname: string; createdAt: number }>;
  transactions: Array<{
    id: string;
    nickname: string | null;
    actor: string | null;
    kind: string;
    amount: number;
    ore: number;
    polymers: number;
    plasma: number;
    antimatter: number;
    comment: string | null;
    flow: TreasuryFlow;
    createdAt: number;
  }>;
  wars: Array<{ syndicateId: string; name: string; tag: string; declaredByUs: boolean; declaredAt: number }>;
}

export interface WatchedFleet {
  fleetId: string;
  attacker: string;
  attackerTag: string | null;
  /** Кого атакуют: позывной участника. */
  target: string;
  planetName: string;
  systemName: string;
  arrivesInSeconds: number;
  /** Сколько корпусов летит. Состав Дозор не различает — это дело разведки. */
  ships: number;
}

export interface SyndicateOverview {
  foundingCost: number;
  /** Личный баланс командира — из него платятся взнос и пожертвования. */
  credits: number;
  mine: SyndicateView | null;
  list: SyndicateSummary[];
  /** Куда командир уже подал заявку. */
  myApplication: { syndicateId: string; name: string } | null;
  /** До какого момента нельзя вступить после добровольного выхода. */
  cooldownUntil: number | null;
  limits: { maxRanks: number; codexMaxLength: number; descriptionMaxLength: number; maxTaxRate: number; maxEntryFee: number };
  /** Каталог прав с подписями: форма рангов строится по нему, а не по списку в клиенте. */
  permissionCatalog: Array<{ key: SyndicatePermission; label: string }>;
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
    select: { credits: true, syndicateId: true, syndicateLeftAt: true },
  });

  const [syndicates, myApplication] = await Promise.all([
    prisma.syndicate.findMany({
      include: {
        leader: { select: { nickname: true } },
        _count: { select: { members: true, codex: true } },
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.syndicateApplication.findFirst({
      where: { commanderId, status: 'PENDING' },
      include: { syndicate: { select: { id: true, name: true } } },
    }),
  ]);

  const now = Date.now();
  const cooldownUntil = commander?.syndicateLeftAt
    ? commander.syndicateLeftAt.getTime() + LEAVE_COOLDOWN_MS
    : null;

  return {
    foundingCost: FOUNDING_COST,
    credits: Math.round((commander?.credits ?? 0) * 100) / 100,
    mine: commander?.syndicateId ? await getSyndicateView(commander.syndicateId, commanderId) : null,
    list: syndicates.map((syndicate) => ({
      id: syndicate.id,
      name: syndicate.name,
      tag: syndicate.tag,
      description: syndicate.description,
      leader: syndicate.leader.nickname,
      members: syndicate._count.members,
      memberCap: memberCap(syndicate.kishLevel),
      kishLevel: syndicate.kishLevel,
      recruitment: syndicate.recruitment,
      minScore: syndicate.minScore,
      entryFee: syndicate.entryFee,
      taxRate: effectiveTaxRate(scheduleOf(syndicate), now),
      hasCodex: syndicate._count.codex > 0,
      createdAt: syndicate.createdAt.getTime(),
      applicationStatus:
        myApplication && myApplication.syndicateId === syndicate.id ? myApplication.status : null,
    })),
    myApplication: myApplication
      ? { syndicateId: myApplication.syndicate.id, name: myApplication.syndicate.name }
      : null,
    cooldownUntil: cooldownUntil && cooldownUntil > now ? cooldownUntil : null,
    limits: {
      maxRanks: MAX_RANKS,
      codexMaxLength: CODEX_MAX_LENGTH, descriptionMaxLength: DESCRIPTION_MAX_LENGTH,
      maxTaxRate: MAX_TAX_RATE,
      maxEntryFee: MAX_ENTRY_FEE,
    },
    permissionCatalog: SYNDICATE_PERMISSIONS.map((key) => ({ key, label: PERMISSION_LABELS[key] })),
  };
}

/** Текущий кодекс синдиката — его читает кандидат до подачи заявки. */
export async function getCodex(
  syndicateId: string,
): Promise<{ id: string; text: string; updatedAt: number } | null> {
  const version = await latestCodex(syndicateId);
  if (!version || version.text === '') return null;
  return { id: version.id, text: version.text, updatedAt: version.createdAt.getTime() };
}

async function getSyndicateView(syndicateId: string, viewerId: string): Promise<SyndicateView | null> {
  await ensureSyndicateSetup(syndicateId);
  await settleSyndicateResearch(syndicateId);
  await settleSyndicateBuilds(syndicateId);
  const access = await membershipOf(viewerId);
  if (!access.ok || access.syndicateId !== syndicateId) return null;

  const today = utcDay(new Date());
  const [syndicate, codex, spentToday, taxRows] = await Promise.all([
    prisma.syndicate.findUnique({
      where: { id: syndicateId },
      include: {
        bank: true,
        kishSystem: { select: { id: true, name: true, galaxyX: true, galaxyY: true } },
        ranks: { orderBy: [{ position: 'asc' }, { createdAt: 'asc' }], include: { _count: { select: { members: true } } } },
        members: { orderBy: { createdAt: 'asc' }, include: { syndicateRank: true } },
        applications: {
          where: { status: 'PENDING' },
          include: { commander: { select: { nickname: true } } },
          orderBy: { createdAt: 'asc' },
        },
        transactions: {
          include: { commander: { select: { nickname: true } }, actor: { select: { nickname: true } } },
          orderBy: { createdAt: 'desc' },
          take: 50,
        },
        warsStarted: { include: { target: true } },
        warsAgainst: { include: { aggressor: true } },
        construction: true,
      },
    }),
    latestCodex(syndicateId, true),
    withdrawnToday(syndicateId, viewerId),
    prisma.syndicateTaxLedger.findMany({ where: { syndicateId, day: today } }),
  ]);
  if (!syndicate) return null;

  const taxByMember = new Map(taxRows.map((row) => [row.commanderId, row.amount]));
  const now = Date.now();

  /*
   * Статистика казны считается агрегатами базы, а не по странице журнала:
   * журнал показывает последние полсотни строк, а вклад — за все время.
   * Налог в журнал не пишется построчно, его источник — дневная книга налога.
   */
  const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);
  const [contributionRows, taxTotals, weekRows, weekTax] = await Promise.all([
    prisma.syndicateTransaction.groupBy({
      by: ['commanderId', 'kind'],
      where: { syndicateId, kind: { in: ['DONATION', 'ENTRY_FEE', 'RESOURCE_DELIVERY'] } },
      _sum: { amount: true, ore: true, polymers: true, plasma: true, antimatter: true },
    }),
    prisma.syndicateTaxLedger.groupBy({ by: ['commanderId'], where: { syndicateId }, _sum: { amount: true } }),
    prisma.syndicateTransaction.groupBy({
      by: ['kind'],
      where: { syndicateId, createdAt: { gte: weekAgo } },
      _sum: { amount: true, ore: true, polymers: true, plasma: true, antimatter: true },
    }),
    prisma.syndicateTaxLedger.aggregate({ where: { syndicateId, day: { gte: utcDay(weekAgo) } }, _sum: { amount: true } }),
  ]);
  const unitsOf = (sum: { ore: number | null; polymers: number | null; plasma: number | null; antimatter: number | null }) =>
    (sum.ore ?? 0) + (sum.polymers ?? 0) + (sum.plasma ?? 0) + (sum.antimatter ?? 0);
  // У ресурсных операций `amount` — сумма единиц для лимита выдачи, а не гривна.
  const resourceKinds = new Set(['RESOURCE_DELIVERY', 'RESOURCE_PICKUP']);
  const week = { creditsIn: weekTax._sum.amount ?? 0, creditsOut: 0, resourcesIn: 0, resourcesOut: 0 };
  for (const row of weekRows) {
    const flow = treasuryFlow(row.kind);
    if (flow === 'NEUTRAL' || row.kind === 'TAX') continue;
    const credits = resourceKinds.has(row.kind) ? 0 : row._sum.amount ?? 0;
    const units = unitsOf(row._sum);
    if (flow === 'IN') {
      week.creditsIn += credits;
      week.resourcesIn += units;
    } else {
      week.creditsOut += credits;
      week.resourcesOut += units;
    }
  }
  const contributionOf = (commanderId: string) => {
    const rows = contributionRows.filter((row) => row.commanderId === commanderId);
    return {
      credits: Math.round(rows.filter((row) => row.kind !== 'RESOURCE_DELIVERY').reduce((sum, row) => sum + (row._sum.amount ?? 0), 0)),
      resources: Math.floor(rows.filter((row) => row.kind === 'RESOURCE_DELIVERY').reduce((sum, row) => sum + unitsOf(row._sum), 0)),
      tax: Math.round(taxTotals.find((row) => row.commanderId === commanderId)?._sum.amount ?? 0),
    };
  };
  const incoming = await watchIncoming(syndicateId, syndicate.watchLevel, syndicate.kishSystem);
  const [gateRows, colonySystems, kishDefenses, guards, raidsInbound] = await Promise.all([
    prisma.syndicateGate.findMany({
      where: { syndicateId },
      include: { system: { select: { id: true, name: true, galaxyX: true, galaxyY: true } } },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.base.findMany({
      where: { commander: { syndicateId } },
      select: { planet: { select: { system: { select: { id: true, name: true } } } } },
    }),
    prisma.syndicateDefense.findMany({ where: { syndicateId } }),
    prisma.fleet.findMany({
      where: { targetSyndicateId: syndicateId, mission: 'HOLD', status: 'HOLDING' },
      include: { commander: { select: { nickname: true } } },
    }),
    prisma.fleet.count({ where: { targetSyndicateId: syndicateId, mission: 'KISH_RAID', status: 'OUTBOUND' } }),
  ]);
  const techState = await syndicateTechState(syndicateId);
  const engineering = techState.levels.ENGINEERING;
  const progress = syndicateProgress(syndicate, techState.levels);
  const needs = (target: SyndicateModule | SyndicateTech, level: number) =>
    requirementViews(missingSyndicateRequirements(target, level, progress));
  const schedule = commitSchedule(syndicate);
  const allowance = withdrawAllowance(access, access.dailyWithdrawLimit, spentToday);

  return {
    id: syndicate.id,
    name: syndicate.name,
    tag: syndicate.tag,
    description: syndicate.description,
    construction: syndicate.construction
      ? {
          module: syndicate.construction.module,
          label: syndicateModuleLabel(syndicate.construction.module),
          systemId: syndicate.construction.systemId,
          systemName: syndicate.construction.systemId
            ? (colonySystems.find((row) => row.planet.system.id === syndicate.construction!.systemId)?.planet.system.name
              ?? gateRows.find((gate) => gate.systemId === syndicate.construction!.systemId)?.system.name
              ?? null)
            : null,
          targetLevel: syndicate.construction.targetLevel,
          remainingSeconds: Math.max(0, Math.ceil((syndicate.construction.finishesAt.getTime() - now) / 1000)),
          totalSeconds: Math.max(1, Math.round((syndicate.construction.finishesAt.getTime() - syndicate.construction.startedAt.getTime()) / 1000)),
        }
      : null,
    stats: {
      contributions: [...syndicate.members]
        .sort((a, b) => b.syndicateMerit - a.syndicateMerit)
        .map((member) => ({
          commanderId: member.id,
          nickname: member.nickname,
          merit: Math.floor(member.syndicateMerit),
          ...contributionOf(member.id),
        })),
      week: {
        creditsIn: Math.round(week.creditsIn),
        creditsOut: Math.round(week.creditsOut),
        resourcesIn: Math.floor(week.resourcesIn),
        resourcesOut: Math.floor(week.resourcesOut),
      },
    },
    createdAt: syndicate.createdAt.getTime(),
    leaderId: syndicate.leaderId,
    me: {
      rankId: access.rankId,
      rankName: access.rankName,
      isLeader: access.isLeader,
      permissions: effectivePermissions(access),
      withdrawLeft: Number.isFinite(allowance) ? allowance : null,
    },
    bank: Math.round((syndicate.bank?.credits ?? 0) * 100) / 100,
    treasury: {
      ore: Math.floor(syndicate.bank?.ore ?? 0),
      polymers: Math.floor(syndicate.bank?.polymers ?? 0),
      plasma: Math.floor(syndicate.bank?.plasma ?? 0),
      antimatter: Math.floor(syndicate.bank?.antimatter ?? 0),
    },
    gates: {
      list: gateRows.map((gate) => ({
        systemId: gate.systemId,
        systemName: gate.system.name,
        level: gate.level,
        throughput: bramaThroughput(gate.level),
        windowShips: now - gate.windowStartedAt.getTime() < 3_600_000 ? gate.windowShips : 0,
        siegeShield: gateSiegeShield(gate.level),
        disabledUntil: gate.disabledUntil && gate.disabledUntil.getTime() > now ? gate.disabledUntil.getTime() : null,
        siegeImmuneUntil: gate.siegeImmuneUntil && gate.siegeImmuneUntil.getTime() > now ? gate.siegeImmuneUntil.getTime() : null,
        nextLevelCost: bramaUpgradeCost(gate.level + 1),
        nextLevelSeconds: syndicateBuildSeconds('BRAMA', gate.level + 1, engineering),
        nextLevelRequirements: needs('BRAMA', gate.level + 1),
      })),
      candidates: [
        ...new Map(
          colonySystems
            .map((row) => row.planet.system)
            .filter((system) => !gateRows.some((gate) => gate.systemId === system.id))
            .map((system) => [system.id, { systemId: system.id, systemName: system.name }]),
        ).values(),
      ],
      firstLevelCost: bramaUpgradeCost(1),
      firstLevelSeconds: syndicateBuildSeconds('BRAMA', 1, engineering),
      firstLevelRequirements: needs('BRAMA', 1),
    },
    kish: {
      level: syndicate.kishLevel,
      systemId: syndicate.kishSystem?.id ?? null,
      systemName: syndicate.kishSystem?.name ?? null,
      memberCap: memberCap(syndicate.kishLevel),
      nextLevelCost: kishUpgradeCost(syndicate.kishLevel + 1),
      nextLevelSeconds: syndicateBuildSeconds('KISH', syndicate.kishLevel + 1, engineering),
      nextLevelRequirements: needs('KISH', syndicate.kishLevel + 1),
      nextMoveAt: kishMoveAvailableAt(syndicate.kishMovedAt?.getTime() ?? null) > now
        ? kishMoveAvailableAt(syndicate.kishMovedAt?.getTime() ?? null)
        : null,
      underRaid: raidsInbound > 0,
      treasuryLevel: syndicate.treasuryLevel,
      protectedShare: treasuryProtectedShare(syndicate.treasuryLevel),
      nextTreasuryCost: treasuryUpgradeCost(syndicate.treasuryLevel + 1),
      nextTreasurySeconds: syndicateBuildSeconds('SKARBNYTSIA', syndicate.treasuryLevel + 1, engineering),
      nextTreasuryRequirements: needs('SKARBNYTSIA', syndicate.treasuryLevel + 1),
      defenses: DEFENSE_TYPES.map((type) => ({
        type,
        label: defenseLabel(type),
        count: kishDefenses.find((row) => row.type === type)?.count ?? 0,
        cost: defenseCost(type),
      })),
      debris: { ore: Math.floor(syndicate.debrisOre), polymers: Math.floor(syndicate.debrisPolymers) },
      guards: guards.map((fleet) => ({
        nickname: fleet.commander.nickname,
        ships: FLEET_SHIP_COLUMNS.reduce((sum, column) => sum + fleet[column], 0),
        until: fleet.holdUntil?.getTime() ?? null,
      })),
      moveTargets: syndicate.kishSystem
        ? gateRows
            .filter((gate) => gate.systemId !== syndicate.kishSystem!.id)
            .map((gate) => {
              const distance = galaxyDistance(syndicate.kishSystem!, gate.system);
              return { systemId: gate.systemId, systemName: gate.system.name, distance, antimatter: kishMoveCost(distance) };
            })
        : [],
    },
    academy: {
      level: syndicate.academyLevel,
      nextLevelCost: academyUpgradeCost(syndicate.academyLevel + 1),
      nextLevelSeconds: syndicateBuildSeconds('AKADEMIIA', syndicate.academyLevel + 1, engineering),
      nextLevelRequirements: needs('AKADEMIIA', syndicate.academyLevel + 1),
      techs: SYNDICATE_TECHS.map((tech) => {
        const level = techState.levels[tech];
        const requirements = needs(tech, level + 1);
        return {
          tech,
          label: SYNDICATE_TECH_LABELS[tech],
          effect: SYNDICATE_TECH_EFFECTS[tech],
          level,
          nextCost: syndicateTechCost(level + 1),
          seconds: syndicateResearchSeconds(level + 1, syndicate.academyLevel, engineering),
          requirements,
          available: !techState.research && requirements.length === 0,
        };
      }),
      research: techState.research
        ? {
            tech: techState.research.tech,
            label: SYNDICATE_TECH_LABELS[techState.research.tech],
            targetLevel: techState.research.targetLevel,
            remainingSeconds: Math.max(0, Math.ceil((techState.research.finishesAt - now) / 1000)),
            totalSeconds: syndicateResearchSeconds(techState.research.targetLevel, syndicate.academyLevel, engineering),
          }
        : null,
    },
    watch: {
      level: syndicate.watchLevel,
      radius: watchRadius(syndicate.watchLevel),
      nextLevelCost: watchUpgradeCost(syndicate.watchLevel + 1),
      nextLevelSeconds: syndicateBuildSeconds('DOZOR', syndicate.watchLevel + 1, engineering),
      nextLevelRequirements: needs('DOZOR', syndicate.watchLevel + 1),
      incoming,
    },
    rules: { recruitment: syndicate.recruitment, minScore: syndicate.minScore, entryFee: syndicate.entryFee },
    tax: {
      rate: schedule.taxRate,
      pendingRate: schedule.pendingTaxRate,
      effectiveAt: schedule.taxEffectiveAt,
      maxRate: MAX_TAX_RATE,
    },
    codex:
      codex && codex.text !== ''
        ? {
            id: codex.id,
            text: codex.text,
            updatedAt: codex.createdAt.getTime(),
            author: codex.author?.nickname ?? null,
          }
        : null,
    ranks: syndicate.ranks.map((rank) => ({
      id: rank.id,
      name: rank.name,
      position: rank.position,
      permissions: rank.permissions,
      dailyWithdrawLimit: rank.dailyWithdrawLimit,
      members: rank._count.members,
    })),
    members: syndicate.members.map((member) => {
      const isLeader = member.id === syndicate.leaderId;
      const authority = {
        isLeader,
        position: isLeader ? 0 : Math.max(1, member.syndicateRank?.position ?? 99),
        permissions: member.syndicateRank?.permissions ?? [],
      };
      return {
        commanderId: member.id,
        nickname: member.nickname,
        avatarId: member.avatarId,
        rankId: member.syndicateRankId,
        rankName: member.syndicateRank?.name ?? '—',
        position: authority.position,
        isLeader,
        merit: member.syndicateMerit,
        taxToday: taxByMember.get(member.id) ?? 0,
        joinedAt: member.syndicateJoinedAt?.getTime() ?? null,
        battlesWon: member.battlesWon,
        battlesLost: member.battlesLost,
        outrankedByMe: member.id !== viewerId && outranks(access, authority),
      };
    }),
    // Заявки показываем только тем, кто вправе их разбирать.
    applications: hasPermission(access, 'APPLICATIONS')
      ? syndicate.applications.map((application) => ({
          id: application.id,
          nickname: application.commander.nickname,
          createdAt: application.createdAt.getTime(),
        }))
      : [],
    transactions: syndicate.transactions.map((tx) => ({
      id: tx.id,
      nickname: tx.commander?.nickname ?? null,
      actor: tx.actor?.nickname ?? null,
      kind: tx.kind,
      amount: tx.amount,
      ore: Math.floor(tx.ore),
      polymers: Math.floor(tx.polymers),
      plasma: Math.floor(tx.plasma),
      antimatter: Math.floor(tx.antimatter),
      comment: tx.comment,
      flow: treasuryFlow(tx.kind),
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
  const cooldown = cooldownError(commander.syndicateLeftAt);
  if (cooldown) return { ok: false, error: cooldown, status: 409 };

  const clash = await prisma.syndicate.findFirst({ where: { OR: [{ name }, { tag }] } });
  if (clash) return { ok: false, error: 'Название или тег уже заняты', status: 409 };

  // Кіш встает в главной системе основателя — там, где его столица.
  const capital = await prisma.base.findFirst({
    where: { commanderId },
    orderBy: { createdAt: 'asc' },
    select: { planet: { select: { systemId: true } } },
  });

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
        data: {
          name,
          tag,
          leaderId: commanderId,
          kishSystemId: capital?.planet.systemId ?? null,
          bank: { create: {} },
          ranks: {
            create: DEFAULT_RANKS.map((rank) => ({
              name: rank.name,
              position: rank.position,
              permissions: rank.permissions,
              dailyWithdrawLimit: rank.dailyWithdrawLimit,
            })),
          },
        },
        include: { ranks: { where: { position: 0 } } },
      });
      await tx.commander.update({
        where: { id: commanderId },
        data: {
          syndicateId: syndicate.id,
          syndicateRole: 'LEADER',
          syndicateRankId: syndicate.ranks[0]!.id,
          syndicateJoinedAt: new Date(),
          syndicateMerit: 0,
          syndicateLeftAt: null,
        },
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
  await syncMembership(commanderId);
  return { ok: true, message: `Синдикат «${name}» [${tag}] основан` };
}

/**
 * Вступление.
 *
 * Открытый набор принимает сразу, по заявке — ставит в очередь, закрытый
 * не принимает вовсе. Кодекс, если он есть, кандидат обязан принять
 * в той версии, которую видел: изменился, пока читал, — прочитай заново.
 */
export async function applyToSyndicate(
  commanderId: string,
  syndicateId: string,
  acceptedCodexId: string | null,
): Promise<SyndicateResult> {
  const commander = await prisma.commander.findUnique({ where: { id: commanderId } });
  if (!commander) return { ok: false, error: 'Командир не найден', status: 404 };
  if (commander.syndicateId) return { ok: false, error: 'Ты уже состоишь в синдикате', status: 409 };
  const cooldown = cooldownError(commander.syndicateLeftAt);
  if (cooldown) return { ok: false, error: cooldown, status: 409 };

  const syndicate = await prisma.syndicate.findUnique({
    where: { id: syndicateId },
    include: { _count: { select: { members: true } } },
  });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };
  await ensureSyndicateSetup(syndicateId);

  if (syndicate.recruitment === 'CLOSED') {
    return { ok: false, error: 'Набор в этот синдикат закрыт', status: 409 };
  }
  if (syndicate._count.members >= memberCap(syndicate.kishLevel)) {
    return { ok: false, error: 'В синдикате нет мест: Кіш не вмещает больше участников', status: 409 };
  }

  if (syndicate.minScore > 0) {
    const board = await getLeaderboard(commanderId);
    const score = board.me?.score.total ?? 0;
    if (score < syndicate.minScore) {
      return {
        ok: false,
        error: `Нужен рейтинг от ${syndicate.minScore}, у тебя ${Math.floor(score)}`,
        status: 409,
      };
    }
  }

  const codex = await getCodex(syndicateId);
  if (codex && acceptedCodexId !== codex.id) {
    return {
      ok: false,
      error: acceptedCodexId
        ? 'Кодекс изменился, пока ты его читал: прочитай новую версию'
        : 'Сначала прочитай и прими кодекс синдиката',
      status: 409,
    };
  }

  if (syndicate.entryFee > 0 && commander.credits < syndicate.entryFee) {
    return { ok: false, error: `Вступительный взнос ${syndicate.entryFee} ₴, на счету меньше`, status: 409 };
  }

  if (syndicate.recruitment === 'OPEN') {
    try {
      await prisma.$transaction((tx) => joinSyndicate(tx, syndicateId, commanderId));
    } catch (error) {
      return toError(error, 'Не удалось вступить в синдикат');
    }
    await syncCredits(commanderId);
    await syncMembership(commanderId);
    return { ok: true, message: `Ты вступил в «${syndicate.name}»` };
  }

  const existing = await prisma.syndicateApplication.findUnique({
    where: { syndicateId_commanderId: { syndicateId, commanderId } },
  });
  if (existing?.status === 'PENDING') {
    return { ok: false, error: 'Заявка уже отправлена', status: 409 };
  }

  await prisma.syndicateApplication.upsert({
    where: { syndicateId_commanderId: { syndicateId, commanderId } },
    create: { syndicateId, commanderId, codexVersionId: codex?.id ?? null },
    update: {
      status: 'PENDING',
      resolvedAt: null,
      resolvedById: null,
      createdAt: new Date(),
      codexVersionId: codex?.id ?? null,
    },
  });
  return { ok: true, message: `Заявка в «${syndicate.name}» отправлена` };
}

/** Одобрение заявки: право разбирать заявки. Взнос списывается в момент принятия. */
export async function reviewApplication(
  commanderId: string,
  applicationId: string,
  accept: boolean,
): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'APPLICATIONS');
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
      if (accept) await joinSyndicate(tx, access.syndicateId, application.commanderId);
    });
  } catch (error) {
    return toError(error, 'Не удалось обработать заявку');
  }

  if (accept) {
    await syncCredits(application.commanderId);
    await syncMembership(application.commanderId);
  }
  return {
    ok: true,
    message: accept
      ? `${application.commander.nickname} принят в синдикат`
      : `Заявка ${application.commander.nickname} отклонена`,
  };
}

/**
 * Зачисление в состав внутри транзакции.
 *
 * Предел состава проверяется под блокировкой синдиката: две одновременно
 * одобренные заявки иначе обе увидели бы свободное место и переполнили Кіш.
 */
async function joinSyndicate(tx: Prisma.TransactionClient, syndicateId: string, commanderId: string): Promise<void> {
  await lockSyndicate(tx, syndicateId);

  const syndicate = await tx.syndicate.findUnique({
    where: { id: syndicateId },
    include: {
      _count: { select: { members: true } },
      ranks: { orderBy: { position: 'desc' }, take: 1 },
    },
  });
  if (!syndicate) throw new SyndicateError('Синдикат не найден', 404);
  if (syndicate._count.members >= memberCap(syndicate.kishLevel)) {
    throw new SyndicateError('В синдикате нет мест: Кіш не вмещает больше участников', 409);
  }
  const lowest = syndicate.ranks[0];
  if (!lowest) throw new SyndicateError('У синдиката нет рангов', 500);

  const fee = syndicate.entryFee;
  const joined = await tx.commander.updateMany({
    where: { id: commanderId, syndicateId: null, ...(fee > 0 ? { credits: { gte: fee } } : {}) },
    data: {
      syndicateId,
      syndicateRole: 'MEMBER',
      syndicateRankId: lowest.id,
      syndicateJoinedAt: new Date(),
      syndicateLeftAt: null,
      syndicateMerit: fee,
      ...(fee > 0 ? { credits: { decrement: fee } } : {}),
    },
  });
  if (joined.count === 0) {
    throw new SyndicateError(
      fee > 0
        ? `Командир уже в синдикате или ему не хватает на взнос ${fee} ₴`
        : 'Командир уже вступил в другой синдикат',
      409,
    );
  }

  if (fee > 0) {
    await tx.syndicateBank.update({ where: { syndicateId }, data: { credits: { increment: fee } } });
    await tx.syndicate.update({ where: { id: syndicateId }, data: { contributedValue: { increment: fee } } });
    await tx.syndicateTransaction.create({
      data: { syndicateId, commanderId, kind: 'ENTRY_FEE', amount: fee, comment: 'Вступительный взнос' },
    });
  }
}

/** Исключение: право исключать и ранг строго выше исключаемого. */
export async function kickMember(commanderId: string, targetId: string): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'KICK');
  if (!access.ok) return access;
  if (targetId === commanderId) return { ok: false, error: 'Нельзя исключить самого себя', status: 409 };

  const target = await membershipOf(targetId);
  if (!target.ok || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Этот командир не в твоем синдикате', status: 404 };
  }
  if (!outranks(access, target)) {
    return { ok: false, error: 'Исключать можно только тех, чей ранг ниже твоего', status: 403 };
  }

  const nickname = await nicknameOf(targetId);
  // Исключенному паузы нет: его выгнали, а не он перебегает за чужими бонусами.
  await prisma.commander.update({ where: { id: targetId }, data: leftSyndicate(null) });
  await syncMembership(targetId);
  return { ok: true, message: `${nickname} исключен из синдиката` };
}

/**
 * Назначение ранга. Нужно право назначать, ранг цели ниже своего,
 * и выдаваемый ранг тоже ниже своего: иначе офицер сделал бы соседа
 * равным себе, а тот — его самого рядовым.
 */
export async function assignRank(commanderId: string, targetId: string, rankId: string): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'PROMOTE');
  if (!access.ok) return access;
  if (targetId === commanderId) return { ok: false, error: 'Свой ранг себе не меняют', status: 409 };

  const target = await membershipOf(targetId);
  if (!target.ok || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Этот командир не в твоем синдикате', status: 404 };
  }
  if (!outranks(access, target)) {
    return { ok: false, error: 'Менять ранг можно только тем, кто ниже тебя', status: 403 };
  }

  const rank = await prisma.syndicateRank.findUnique({ where: { id: rankId } });
  if (!rank || rank.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Ранг не найден', status: 404 };
  }
  if (rank.position === 0) {
    return { ok: false, error: 'Высший ранг получает только новый главарь — передай лидерство', status: 409 };
  }
  if (!access.isLeader && rank.position <= access.position) {
    return { ok: false, error: 'Выдавать можно только ранги ниже своего', status: 403 };
  }

  await prisma.commander.update({ where: { id: targetId }, data: { syndicateRankId: rank.id } });
  return { ok: true, message: `${await nicknameOf(targetId)} теперь «${rank.name}»` };
}

/**
 * Передача лидерства: синдикат не должен умирать вместе с уходом главаря.
 * Новый получает высший ранг, прежний — следующий за ним, одной транзакцией,
 * чтобы синдикат ни на мгновение не остался без главаря.
 */
export async function transferLeadership(commanderId: string, targetId: string): Promise<SyndicateResult> {
  const access = await requireLeader(commanderId);
  if (!access.ok) return access;
  if (targetId === commanderId) return { ok: false, error: 'Ты и так главарь', status: 409 };

  const target = await membershipOf(targetId);
  if (!target.ok || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Этот командир не в твоем синдикате', status: 404 };
  }

  const ranks = await prisma.syndicateRank.findMany({
    where: { syndicateId: access.syndicateId },
    orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
  });
  const top = ranks[0];
  const next = ranks[1] ?? ranks[ranks.length - 1];
  if (!top || !next) return { ok: false, error: 'У синдиката нет рангов', status: 500 };

  try {
    await prisma.$transaction([
      prisma.syndicate.update({ where: { id: access.syndicateId }, data: { leaderId: targetId } }),
      prisma.commander.update({
        where: { id: targetId },
        data: { syndicateRole: 'LEADER', syndicateRankId: top.id },
      }),
      prisma.commander.update({
        where: { id: commanderId },
        data: { syndicateRole: 'OFFICER', syndicateRankId: next.id },
      }),
    ]);
  } catch (error) {
    return toError(error, 'Не удалось передать лидерство');
  }

  return { ok: true, message: `${await nicknameOf(targetId)} теперь главарь синдиката` };
}

export async function leaveSyndicate(commanderId: string): Promise<SyndicateResult> {
  const access = await membershipOf(commanderId);
  if (!access.ok) return access;
  if (access.isLeader) {
    return {
      ok: false,
      error: 'Главарь не может выйти: передай лидерство участнику или распусти синдикат',
      status: 409,
    };
  }

  await prisma.commander.update({ where: { id: commanderId }, data: leftSyndicate(new Date()) });
  await syncMembership(commanderId);
  return { ok: true, message: 'Ты покинул синдикат. Вступить в другой можно через сутки' };
}

/**
 * Роспуск: казна сгорает.
 *
 * Раньше остаток уходил лидеру, и роспуск был способом забрать общие деньги
 * себе одной кнопкой. Сгорая, казна работает стоком криптогривны, а распускать
 * синдикат ради выгоды становится незачем.
 */
export async function disbandSyndicate(commanderId: string): Promise<SyndicateResult> {
  const access = await requireLeader(commanderId);
  if (!access.ok) return access;

  const members = await prisma.commander.findMany({
    where: { syndicateId: access.syndicateId },
    select: { id: true },
  });

  try {
    await prisma.$transaction(async (tx) => {
      await tx.commander.updateMany({ where: { syndicateId: access.syndicateId }, data: leftSyndicate(null) });
      await tx.syndicateTaxLedger.deleteMany({ where: { syndicateId: access.syndicateId } });
      await tx.syndicate.delete({ where: { id: access.syndicateId } });
    });
  } catch (error) {
    return toError(error, 'Не удалось распустить синдикат');
  }

  for (const member of members) await syncMembership(member.id);
  return { ok: true, message: 'Синдикат распущен, казна сгорела' };
}

/* ------------------------- Ранги ------------------------- */

export interface RankInput {
  name: string;
  position: number;
  permissions: SyndicatePermission[];
  dailyWithdrawLimit: number;
}

/** Ранги правит только главарь: права — это то, что раздает вершина. */
export async function createRank(commanderId: string, input: RankInput): Promise<SyndicateResult> {
  const access = await requireLeader(commanderId);
  if (!access.ok) return access;

  const count = await prisma.syndicateRank.count({ where: { syndicateId: access.syndicateId } });
  if (count >= MAX_RANKS) return { ok: false, error: `Рангов не больше ${MAX_RANKS}`, status: 409 };

  try {
    await prisma.syndicateRank.create({
      data: {
        syndicateId: access.syndicateId,
        name: input.name,
        // Вершина занята главарем: новый ранг всегда ниже.
        position: Math.max(1, input.position),
        permissions: input.permissions,
        dailyWithdrawLimit: input.dailyWithdrawLimit,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Ранг с таким названием уже есть', status: 409 };
    return toError(error, 'Не удалось создать ранг');
  }
  return { ok: true, message: `Ранг «${input.name}» создан` };
}

export async function updateRank(commanderId: string, rankId: string, input: RankInput): Promise<SyndicateResult> {
  const access = await requireLeader(commanderId);
  if (!access.ok) return access;

  const rank = await prisma.syndicateRank.findUnique({ where: { id: rankId } });
  if (!rank || rank.syndicateId !== access.syndicateId) return { ok: false, error: 'Ранг не найден', status: 404 };

  // Высший ранг — ранг главаря: переименовать можно, урезать права и сдвинуть нельзя.
  const isTop = rank.position === 0;
  try {
    await prisma.syndicateRank.update({
      where: { id: rankId },
      data: {
        name: input.name,
        position: isTop ? 0 : Math.max(1, input.position),
        permissions: isTop ? rank.permissions : input.permissions,
        dailyWithdrawLimit: isTop ? rank.dailyWithdrawLimit : input.dailyWithdrawLimit,
      },
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Ранг с таким названием уже есть', status: 409 };
    return toError(error, 'Не удалось изменить ранг');
  }
  return { ok: true, message: `Ранг «${input.name}» обновлен` };
}

/** Удаление ранга: его обладатели опускаются на самый нижний из оставшихся. */
export async function deleteRank(commanderId: string, rankId: string): Promise<SyndicateResult> {
  const access = await requireLeader(commanderId);
  if (!access.ok) return access;

  const ranks = await prisma.syndicateRank.findMany({
    where: { syndicateId: access.syndicateId },
    orderBy: [{ position: 'desc' }, { createdAt: 'desc' }],
  });
  const rank = ranks.find((row) => row.id === rankId);
  if (!rank) return { ok: false, error: 'Ранг не найден', status: 404 };
  if (rank.position === 0) return { ok: false, error: 'Ранг главаря удалить нельзя', status: 409 };
  const fallback = ranks.find((row) => row.id !== rankId && row.position !== 0);
  if (!fallback) return { ok: false, error: 'Нужен хотя бы один ранг кроме главаря', status: 409 };

  await prisma.$transaction([
    prisma.commander.updateMany({ where: { syndicateRankId: rankId }, data: { syndicateRankId: fallback.id } }),
    prisma.syndicateRank.delete({ where: { id: rankId } }),
  ]);
  return { ok: true, message: `Ранг «${rank.name}» удален, его участники теперь «${fallback.name}»` };
}

/* ------------------------- Правила, налог, кодекс ------------------------- */

export async function updateRules(
  commanderId: string,
  rules: { recruitment: SyndicateRecruitment; minScore: number; entryFee: number },
): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'RULES');
  if (!access.ok) return access;

  await prisma.syndicate.update({
    where: { id: access.syndicateId },
    data: { recruitment: rules.recruitment, minScore: rules.minScore, entryFee: rules.entryFee },
  });
  return { ok: true, message: 'Правила набора обновлены' };
}

/**
 * Подробности модуля Коша или технологии синдиката: уровни вперед по формулам
 * казны. Смотреть может любой участник — решать могут не все, а знать, сколько
 * копить, нужно всем.
 */
export async function getSyndicateProjection(
  commanderId: string,
  target: { module: SyndicateModule; systemId: string | null } | { tech: SyndicateTech },
): Promise<{ ok: true; projection: SyndicateProjection } | { ok: false; error: string; status: number }> {
  const access = await membershipOf(commanderId);
  if (!access.ok) return access;
  await settleSyndicateBuilds(access.syndicateId);
  const syndicate = await prisma.syndicate.findUnique({ where: { id: access.syndicateId } });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };
  const techState = await syndicateTechState(access.syndicateId);
  const engineering = techState.levels.ENGINEERING;
  const progress = syndicateProgress(syndicate, techState.levels);

  if ('tech' in target) {
    return {
      ok: true,
      projection: syndicateTechProjection(target.tech, techState.levels[target.tech], syndicate.academyLevel, engineering, progress),
    };
  }
  const levels: Record<Exclude<SyndicateModule, 'BRAMA'>, number> = {
    KISH: syndicate.kishLevel,
    SKARBNYTSIA: syndicate.treasuryLevel,
    AKADEMIIA: syndicate.academyLevel,
    DOZOR: syndicate.watchLevel,
  };
  let level = 0;
  if (target.module === 'BRAMA') {
    const gate = target.systemId
      ? await prisma.syndicateGate.findUnique({
          where: { syndicateId_systemId: { syndicateId: access.syndicateId, systemId: target.systemId } },
        })
      : null;
    level = gate?.level ?? 0;
  } else {
    level = levels[target.module];
  }
  return { ok: true, projection: syndicateModuleProjection(target.module, level, engineering, progress) };
}

/** Описание синдиката пишет тот же ранг, что и правила набора: оба текста — лицо синдиката для кандидатов. */
export async function updateDescription(commanderId: string, text: string): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'RULES');
  if (!access.ok) return access;
  await prisma.syndicate.update({ where: { id: access.syndicateId }, data: { description: text } });
  return { ok: true, message: text ? 'Описание обновлено' : 'Описание снято' };
}

/**
 * Налог с крипто-фермы.
 *
 * Повышение вступает в силу через сутки, и об этом приходит письмо: участник
 * должен успеть решить, остается ли он на новых условиях. Снижение действует
 * сразу — ждать того, что только облегчает жизнь, незачем.
 */
export async function setTaxRate(commanderId: string, rawRate: number): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'TAX');
  if (!access.ok) return access;

  const rate = clampTaxRate(rawRate);
  const syndicate = await prisma.syndicate.findUnique({ where: { id: access.syndicateId } });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };

  const now = Date.now();
  const current = effectiveTaxRate(scheduleOf(syndicate), now);
  const raising = rate > current;
  const effectiveAt = raising ? new Date(now + TAX_DELAY_MS) : null;

  const updated = await prisma.syndicate.update({
    where: { id: access.syndicateId },
    data: raising
      ? { taxRate: current, pendingTaxRate: rate, taxEffectiveAt: effectiveAt }
      : { taxRate: rate, pendingTaxRate: null, taxEffectiveAt: null },
  });
  gameLoop.syncSyndicateTax(access.syndicateId, scheduleOf(updated));

  const when = raising
    ? `с ${effectiveAt!.toLocaleString('ru-RU', { timeZone: 'UTC' })} UTC`
    : 'сразу';
  await notifyMembers(
    access.syndicateId,
    `Налог синдиката: ${rate}%`,
    `Ставка налога с крипто-фермы меняется с ${current}% на ${rate}% — ${when}.\n\n` +
      `Изменил: ${await nicknameOf(commanderId)}.`,
  );
  return {
    ok: true,
    message: raising ? `Налог ${rate}% вступит в силу через сутки` : `Налог теперь ${rate}%`,
  };
}

export async function updateCodex(commanderId: string, text: string): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'CODEX');
  if (!access.ok) return access;

  const current = await latestCodex(access.syndicateId);
  if ((current?.text ?? '') === text) return { ok: false, error: 'Кодекс не изменился', status: 409 };

  await prisma.syndicateCodexVersion.create({
    data: { syndicateId: access.syndicateId, text, authorId: commanderId },
  });
  await notifyMembers(
    access.syndicateId,
    text === '' ? 'Кодекс синдиката снят' : 'Кодекс синдиката изменен',
    text === ''
      ? `${await nicknameOf(commanderId)} снял кодекс синдиката.`
      : `${await nicknameOf(commanderId)} изменил кодекс синдиката. Новая редакция:\n\n${text}`,
  );
  return { ok: true, message: text === '' ? 'Кодекс снят' : 'Кодекс обновлен' };
}

/* ------------------------- Кіш ------------------------- */

/** Повышение Коша из казны. Условный UPDATE по уровню защищает от двойного платежа. */
export async function upgradeKish(commanderId: string): Promise<SyndicateResult> {
  return startConstruction(commanderId, 'KISH', null);
}

/* ------------------------- Брама и перенос Коша ------------------------- */

/**
 * Постройка или повышение Брамы в системе. Ставится только там, где есть
 * колония хотя бы одного участника: иначе врата росли бы в пустых секторах
 * ради одного лишь переноса Коша.
 */
export async function buildGate(commanderId: string, systemId: string): Promise<SyndicateResult> {
  return startConstruction(commanderId, 'BRAMA', systemId);
}

/**
 * Перенос Коша в систему со своей Брамой — за антиматерию казны, не чаще раза
 * в сутки. Обе проверки делаются условным UPDATE по прежнему месту и времени
 * переноса: два одновременных переноса не пройдут оба.
 */
export async function moveKish(commanderId: string, systemId: string): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'KISH');
  if (!access.ok) return access;

  const syndicate = await prisma.syndicate.findUnique({
    where: { id: access.syndicateId },
    include: { kishSystem: true },
  });
  if (!syndicate?.kishSystem) return { ok: false, error: 'У синдиката еще не определен Кіш', status: 409 };
  if (syndicate.kishSystemId === systemId) return { ok: false, error: 'Кіш уже в этой системе', status: 409 };

  // Пока к Кошу летит налет, уйти от него переносом нельзя.
  const raids = await prisma.fleet.count({
    where: { targetSyndicateId: access.syndicateId, mission: 'KISH_RAID', status: 'OUTBOUND' },
  });
  if (raids > 0) return { ok: false, error: 'К Кошу летит вражеский налет — переносить Кіш сейчас нельзя', status: 409 };

  const gate = await prisma.syndicateGate.findUnique({
    where: { syndicateId_systemId: { syndicateId: access.syndicateId, systemId } },
    include: { system: true },
  });
  if (!gate) return { ok: false, error: 'Кіш переносится только в систему со своей Брамой', status: 409 };
  if (gate.disabledUntil && gate.disabledUntil.getTime() > Date.now()) {
    return { ok: false, error: 'Брама в этой системе выведена из строя осадой', status: 409 };
  }

  const availableAt = kishMoveAvailableAt(syndicate.kishMovedAt?.getTime() ?? null);
  if (availableAt > Date.now()) {
    const hours = Math.ceil((availableAt - Date.now()) / 3_600_000);
    return { ok: false, error: `Кіш переносили недавно: снова можно через ${hours} ч`, status: 409 };
  }

  const distance = galaxyDistance(syndicate.kishSystem, gate.system);
  const cost = kishMoveCost(distance);
  try {
    await prisma.$transaction(async (tx) => {
      const paid = await tx.syndicateBank.updateMany({
        where: { syndicateId: access.syndicateId, antimatter: { gte: cost } },
        data: { antimatter: { decrement: cost } },
      });
      if (paid.count === 0) throw new SyndicateError(`В казне нужно ${cost} антиматерии`, 409);
      const moved = await tx.syndicate.updateMany({
        where: { id: access.syndicateId, kishSystemId: syndicate.kishSystemId, kishMovedAt: syndicate.kishMovedAt },
        data: { kishSystemId: systemId, kishMovedAt: new Date() },
      });
      if (moved.count === 0) throw new SyndicateError('Кіш уже переносят', 409);
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: access.syndicateId,
          actorId: commanderId,
          kind: 'KISH_MOVE',
          amount: 0,
          antimatter: cost,
          comment: `${syndicate.kishSystem!.name} → ${gate.system.name}`,
        },
      });
    });
  } catch (error) {
    return toError(error, 'Не удалось перенести Кіш');
  }

  await notifyMembers(
    access.syndicateId,
    `Кіш перенесен: ${gate.system.name}`,
    `Кіш синдиката перенесен из системы ${syndicate.kishSystem.name} в систему ${gate.system.name}. ` +
      `Рейсы в казну теперь идут туда.\n\nПеренес: ${await nicknameOf(commanderId)}.`,
  );
  return { ok: true, message: `Кіш перенесен в систему ${gate.system.name} за ${cost} антиматерии` };
}

/* ------------------------- Скарбниця и оборона Коша ------------------------- */

/** Повышение Скарбниці: больше казны не унести налетом. */
export async function upgradeTreasury(commanderId: string): Promise<SyndicateResult> {
  return startConstruction(commanderId, 'SKARBNYTSIA', null);
}

export const MAX_KISH_DEFENSE_ORDER = 100;

/**
 * Оборона Коша из казны — по ценам обычной обороны. Ставится сразу:
 * у Коша нет верфи, а долгая стройка сделала бы оборону бесполезной
 * против налета, который уже летит.
 */
export async function buyKishDefense(commanderId: string, type: DefenseType, quantity: number): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'KISH');
  if (!access.ok) return access;
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_KISH_DEFENSE_ORDER) {
    return { ok: false, error: `Количество: от 1 до ${MAX_KISH_DEFENSE_ORDER}`, status: 400 };
  }
  const unit = defenseCost(type);
  const cost = { ore: unit.ore * quantity, polymers: unit.polymers * quantity, plasma: unit.plasma * quantity };
  try {
    await prisma.$transaction(async (tx) => {
      const paid = await tx.syndicateBank.updateMany({
        where: {
          syndicateId: access.syndicateId,
          ore: { gte: cost.ore },
          polymers: { gte: cost.polymers },
          plasma: { gte: cost.plasma },
        },
        data: { ore: { decrement: cost.ore }, polymers: { decrement: cost.polymers }, plasma: { decrement: cost.plasma } },
      });
      if (paid.count === 0) {
        throw new SyndicateError(
          `В казне нужно ${cost.ore} руды, ${cost.polymers} полимеров и ${cost.plasma} плазмы`,
          409,
        );
      }
      await tx.syndicateDefense.upsert({
        where: { syndicateId_type: { syndicateId: access.syndicateId, type } },
        create: { syndicateId: access.syndicateId, type, count: quantity },
        update: { count: { increment: quantity } },
      });
      await tx.syndicate.update({
        where: { id: access.syndicateId },
        data: { investedValue: { increment: cost.ore + cost.polymers + cost.plasma } },
      });
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: access.syndicateId,
          actorId: commanderId,
          kind: 'KISH_DEFENSE',
          amount: 0,
          ore: cost.ore,
          polymers: cost.polymers,
          plasma: cost.plasma,
          comment: `${defenseLabel(type)} ×${quantity}`,
        },
      });
    });
  } catch (error) {
    return toError(error, 'Не удалось поставить оборону');
  }
  return { ok: true, message: `У Коша поставлено: ${defenseLabel(type)} ×${quantity}` };
}

/* ------------------------- Академия ------------------------- */

/** Списание цены из казны одним условным UPDATE: гривна и ресурсы — все или ничего. */
async function payFromTreasury(tx: Prisma.TransactionClient, syndicateId: string, cost: TreasuryCost): Promise<void> {
  const paid = await tx.syndicateBank.updateMany({
    where: {
      syndicateId,
      credits: { gte: cost.credits },
      ore: { gte: cost.ore },
      polymers: { gte: cost.polymers },
    },
    data: {
      credits: { decrement: cost.credits },
      ore: { decrement: cost.ore },
      polymers: { decrement: cost.polymers },
    },
  });
  if (paid.count === 0) {
    throw new SyndicateError(
      `В казне нужно ${cost.credits} ₴, ${cost.ore} руды и ${cost.polymers} полимеров`,
      409,
    );
  }
}

/** Вложено в единицах, один к одному, как и во всем рейтинге. */
function costUnits(cost: TreasuryCost): number {
  return cost.credits + cost.ore + cost.polymers;
}

/* ------------------------- Стройка в Коше ------------------------- */

const MODULE_TX_KIND = {
  KISH: 'KISH_UPGRADE',
  SKARBNYTSIA: 'TREASURY_UPGRADE',
  AKADEMIIA: 'ACADEMY_UPGRADE',
  DOZOR: 'WATCH_UPGRADE',
  BRAMA: 'GATE_BUILD',
} as const satisfies Record<SyndicateModule, string>;

function durationText(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.ceil((seconds % 3600) / 60);
  if (hours && minutes) return `${hours} ч ${minutes} мин`;
  return hours ? `${hours} ч` : `${minutes} мин`;
}

/**
 * Запуск стройки модуля Коша.
 *
 * Модули строятся по времени, как постройки колонии, и стройка в Коше одна
 * на синдикат: цена списывается сразу и хранится в самой стройке, чтобы
 * отмена вернула ее целиком. Уровень меняется только по завершении — до
 * этого Кіш работает на прежнем уровне. Брама строится лишь там, где есть
 * колония участника: иначе врата росли бы в пустых секторах.
 */
async function startConstruction(commanderId: string, module: SyndicateModule, systemId: string | null): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, modulePermission(module));
  if (!access.ok) return access;
  await settleSyndicateBuilds(access.syndicateId);

  const syndicate = await prisma.syndicate.findUnique({ where: { id: access.syndicateId }, include: { construction: true } });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };
  if (syndicate.construction) {
    return {
      ok: false,
      error: `В Коше уже идет стройка: ${syndicateModuleLabel(syndicate.construction.module)} → ур. ${syndicate.construction.targetLevel}`,
      status: 409,
    };
  }

  let current: number;
  let place = '';
  if (module === 'BRAMA') {
    if (!systemId) return { ok: false, error: 'Не указана система Брамы', status: 400 };
    const [system, colony, gate] = await Promise.all([
      prisma.solarSystem.findUnique({ where: { id: systemId }, select: { name: true } }),
      prisma.base.findFirst({ where: { planet: { systemId }, commander: { syndicateId: access.syndicateId } }, select: { id: true } }),
      prisma.syndicateGate.findUnique({ where: { syndicateId_systemId: { syndicateId: access.syndicateId, systemId } } }),
    ]);
    if (!system) return { ok: false, error: 'Система не найдена', status: 404 };
    if (!colony) return { ok: false, error: 'Брама ставится только в системе, где есть колония участника', status: 409 };
    current = gate?.level ?? 0;
    place = ` · ${system.name}`;
  } else {
    current = { KISH: syndicate.kishLevel, SKARBNYTSIA: syndicate.treasuryLevel, AKADEMIIA: syndicate.academyLevel, DOZOR: syndicate.watchLevel }[module];
  }

  const target = current + 1;
  const cost = syndicateModuleCost(module, target);
  const techState = await syndicateTechState(access.syndicateId);
  // Требования проверяются до списания: отказ после оплаты вернул бы казну только отменой.
  const missing = missingSyndicateRequirements(module, target, syndicateProgress(syndicate, techState.levels));
  if (missing.length > 0) {
    return { ok: false, error: `Для ${syndicateModuleLabel(module)} ур. ${target} нужно: ${requirementsText(missing)}`, status: 409 };
  }
  const seconds = syndicateBuildSeconds(module, target, techState.levels.ENGINEERING);
  const label = syndicateModuleLabel(module);

  try {
    await prisma.$transaction(async (tx) => {
      await payFromTreasury(tx, access.syndicateId, cost);
      await tx.syndicateConstruction.create({
        data: {
          syndicateId: access.syndicateId,
          module,
          systemId: module === 'BRAMA' ? systemId : null,
          targetLevel: target,
          finishesAt: new Date(Date.now() + seconds * 1000),
          credits: cost.credits,
          ore: cost.ore,
          polymers: cost.polymers,
          actorId: commanderId,
        },
      });
      await tx.syndicate.update({
        where: { id: access.syndicateId },
        data: { investedValue: { increment: costUnits(cost) } },
      });
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: access.syndicateId,
          actorId: commanderId,
          kind: MODULE_TX_KIND[module],
          amount: cost.credits,
          ore: cost.ore,
          polymers: cost.polymers,
          comment: `${label}${place} → ур. ${target}`,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'В Коше уже идет стройка', status: 409 };
    return toError(error, 'Не удалось начать стройку');
  }
  return { ok: true, message: `Стройка начата: ${label}${place} → ур. ${target}, готово через ${durationText(seconds)}` };
}

/**
 * Завершение строек по сроку. Зовется таймером сервера по всем синдикатам
 * и лениво — перед чтением синдиката: уровень модуля решает предел состава,
 * защиту казны и пропуск Брамы, и ждать, пока кто-то откроет Кіш, нельзя.
 * Удаление стройки условное, поэтому два вызова одну стройку не закроют дважды.
 */
export async function settleSyndicateBuilds(syndicateId?: string): Promise<number> {
  const due = await prisma.syndicateConstruction.findMany({
    where: { finishesAt: { lte: new Date() }, ...(syndicateId ? { syndicateId } : {}) },
  });
  let done = 0;
  for (const job of due) {
    const finished = await prisma.$transaction(async (tx) => {
      const removed = await tx.syndicateConstruction.deleteMany({ where: { id: job.id } });
      if (removed.count === 0) return false;
      const level = job.targetLevel;
      switch (job.module) {
        case 'KISH':
          await tx.syndicate.update({ where: { id: job.syndicateId }, data: { kishLevel: level } });
          break;
        case 'SKARBNYTSIA':
          await tx.syndicate.update({ where: { id: job.syndicateId }, data: { treasuryLevel: level } });
          break;
        case 'AKADEMIIA':
          await tx.syndicate.update({ where: { id: job.syndicateId }, data: { academyLevel: level } });
          break;
        case 'DOZOR':
          await tx.syndicate.update({ where: { id: job.syndicateId }, data: { watchLevel: level } });
          break;
        case 'BRAMA':
          if (job.systemId) {
            await tx.syndicateGate.upsert({
              where: { syndicateId_systemId: { syndicateId: job.syndicateId, systemId: job.systemId } },
              create: { syndicateId: job.syndicateId, systemId: job.systemId, level },
              update: { level },
            });
          }
          break;
      }
      return true;
    });
    if (!finished) continue;
    done += 1;
    try {
      await notifyMembers(job.syndicateId, 'Стройка в Коше завершена',
        `${syndicateModuleLabel(job.module)} теперь ${job.targetLevel} уровня.`);
    } catch (error) {
      console.error('[syndicate] письмо о стройке не ушло', error);
    }
  }
  return done;
}

/** Отмена стройки: казна получает назад ровно то, что за нее заплатила. */
export async function cancelConstruction(commanderId: string): Promise<SyndicateResult> {
  const access = await membershipOf(commanderId);
  if (!access.ok) return access;
  const job = await prisma.syndicateConstruction.findUnique({ where: { syndicateId: access.syndicateId } });
  if (!job) return { ok: false, error: 'В Коше ничего не строится', status: 404 };
  if (!hasPermission(access, modulePermission(job.module))) {
    return { ok: false, error: 'Недостаточно прав в синдикате', status: 403 };
  }
  if (job.finishesAt.getTime() <= Date.now()) {
    await settleSyndicateBuilds(access.syndicateId);
    return { ok: false, error: 'Стройка уже завершена', status: 409 };
  }
  const label = syndicateModuleLabel(job.module);
  try {
    await prisma.$transaction(async (tx) => {
      const removed = await tx.syndicateConstruction.deleteMany({ where: { id: job.id } });
      if (removed.count === 0) throw new SyndicateError('Стройку уже отменили или завершили', 409);
      await tx.syndicateBank.update({
        where: { syndicateId: access.syndicateId },
        data: { credits: { increment: job.credits }, ore: { increment: job.ore }, polymers: { increment: job.polymers } },
      });
      await tx.syndicate.update({
        where: { id: access.syndicateId },
        data: { investedValue: { decrement: job.credits + job.ore + job.polymers } },
      });
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: access.syndicateId,
          actorId: commanderId,
          kind: 'BUILD_REFUND',
          amount: job.credits,
          ore: job.ore,
          polymers: job.polymers,
          comment: `Отмена: ${label} → ур. ${job.targetLevel}`,
        },
      });
    });
  } catch (error) {
    return toError(error, 'Не удалось отменить стройку');
  }
  return { ok: true, message: `Стройка отменена: ${label}, казне возвращено все` };
}

/**
 * Завершение изучения по сроку.
 *
 * Тик синдикаты в памяти не держит, поэтому изучение закрывается лениво —
 * при первом обращении после срока. Бонусы до этого момента все равно
 * действуют: и тик, и чтение из базы считают уровень по сроку, а не по записи.
 */
async function settleSyndicateResearch(syndicateId: string): Promise<void> {
  const job = await prisma.syndicateResearch.findUnique({ where: { syndicateId } });
  if (!job || job.finishesAt.getTime() > Date.now()) return;
  await prisma.$transaction(async (tx) => {
    const removed = await tx.syndicateResearch.deleteMany({ where: { id: job.id } });
    if (removed.count === 0) return;
    await tx.syndicateTechnology.upsert({
      where: { syndicateId_tech: { syndicateId, tech: job.tech } },
      create: { syndicateId, tech: job.tech, level: job.targetLevel },
      update: { level: job.targetLevel },
    });
  });
}

/** Постройка и повышение Академии из казны: гривна, руда и полимеры. */
export async function upgradeAcademy(commanderId: string): Promise<SyndicateResult> {
  return startConstruction(commanderId, 'AKADEMIIA', null);
}

/**
 * Запуск изучения технологии синдиката.
 *
 * Изучение одно за раз, уровень не выше уровня Академии, цена — из казны.
 * Бонусы получают участники, пробывшие в синдикате двое суток.
 */
export async function startSyndicateResearch(commanderId: string, tech: SyndicateTech): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'ACADEMY');
  if (!access.ok) return access;
  await settleSyndicateResearch(access.syndicateId);

  const syndicate = await prisma.syndicate.findUnique({ where: { id: access.syndicateId } });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };
  const state = await syndicateTechState(access.syndicateId);
  if (state.research) return { ok: false, error: 'Академия уже занята изучением', status: 409 };

  const target = state.levels[tech] + 1;
  // Академия — одно из требований цепи, отдельной проверки у нее больше нет.
  const missing = missingSyndicateRequirements(tech, target, syndicateProgress(syndicate, state.levels));
  if (missing.length > 0) {
    return { ok: false, error: `Для ${SYNDICATE_TECH_LABELS[tech]} ур. ${target} нужно: ${requirementsText(missing)}`, status: 409 };
  }
  const cost = syndicateTechCost(target);
  const seconds = syndicateResearchSeconds(target, syndicate.academyLevel, state.levels.ENGINEERING);

  try {
    await prisma.$transaction(async (tx) => {
      await payFromTreasury(tx, access.syndicateId, cost);
      await tx.syndicateResearch.create({
        data: {
          syndicateId: access.syndicateId,
          tech,
          targetLevel: target,
          finishesAt: new Date(Date.now() + seconds * 1000),
        },
      });
      await tx.syndicate.update({
        where: { id: access.syndicateId },
        data: { investedValue: { increment: costUnits(cost) } },
      });
      await tx.syndicateTransaction.create({
        data: {
          syndicateId: access.syndicateId,
          actorId: commanderId,
          kind: 'SYNDICATE_RESEARCH',
          amount: cost.credits,
          ore: cost.ore,
          polymers: cost.polymers,
          comment: `${SYNDICATE_TECH_LABELS[tech]} → ур. ${target}`,
        },
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) return { ok: false, error: 'Академия уже занята изучением', status: 409 };
    return toError(error, 'Не удалось начать изучение');
  }

  gameLoop.syncSyndicateTechs(access.syndicateId, await syndicateTechState(access.syndicateId));
  const hours = Math.round((seconds / 3600) * 10) / 10;
  return { ok: true, message: `${SYNDICATE_TECH_LABELS[tech]} → ур. ${target}: изучение ${hours} ч` };
}

/** Постройка и повышение Дозора из казны — то же право, что развитие Коша. */
export async function upgradeWatch(commanderId: string): Promise<SyndicateResult> {
  return startConstruction(commanderId, 'DOZOR', null);
}

/**
 * Вооруженные флоты, летящие к участникам, в радиусе Дозора.
 *
 * Только атаки: разведку решает лестница шпионажа, и постройка за гривну
 * не должна ее обходить. И только чужие флоты — свой синдикат своих
 * атаковать не может. Состав не раскрывается, только число корпусов:
 * «кто, куда, когда и сколько» — это предупреждение, а «чем именно» —
 * уже работа разведки.
 */
const FLEET_SHIP_COLUMNS = [
  'probes', 'smallCargo', 'largeCargo', 'lightFighters', 'heavyFighters', 'cruisers',
  'frigates', 'bombers', 'battleships', 'carriers', 'recyclers', 'colonyShips',
] as const;

async function watchIncoming(
  syndicateId: string,
  watchLevel: number,
  kish: { galaxyX: number; galaxyY: number } | null,
): Promise<WatchedFleet[]> {
  const now = Date.now();
  const raids = await prisma.fleet.findMany({
    where: { targetSyndicateId: syndicateId, mission: { in: ['KISH_RAID', 'GATE_SIEGE'] }, status: 'OUTBOUND' },
    include: {
      commander: { select: { nickname: true, syndicate: { select: { tag: true } } } },
      targetSystem: { select: { name: true } },
    },
    orderBy: { arrivesAt: 'asc' },
  });
  // Налет на сам Кіш и осаду своих врат Дозор видит всегда: это свое имущество,
  // и о нападении на него знают все, кто может его защитить.
  const raidRows: WatchedFleet[] = raids.map((fleet) => ({
    fleetId: fleet.id,
    attacker: fleet.commander.nickname,
    attackerTag: fleet.commander.syndicate?.tag ?? null,
    target: fleet.mission === 'GATE_SIEGE' ? 'Брама' : 'Кіш',
    planetName: fleet.mission === 'GATE_SIEGE' ? 'Брама' : 'Кіш',
    systemName: fleet.mission === 'GATE_SIEGE' ? (fleet.targetSystem?.name ?? '') : '',
    arrivesInSeconds: Math.max(0, Math.ceil((fleet.arrivesAt.getTime() - now) / 1000)),
    ships: FLEET_SHIP_COLUMNS.reduce((sum, column) => sum + fleet[column], 0),
  }));

  // Круг наблюдения за колониями дает только построенный Дозор.
  if (watchLevel <= 0 || !kish) return raidRows;
  // Союз по пакту делит Дозор: колонии союзников в круге видны так же, как свои.
  const watched = [syndicateId, ...(await alliedSyndicateIds(syndicateId))];
  const fleets = await prisma.fleet.findMany({
    where: {
      mission: 'ATTACK',
      status: 'OUTBOUND',
      targetPlanet: { base: { commander: { syndicateId: { in: watched } } } },
      commander: { OR: [{ syndicateId: null }, { syndicateId: { notIn: watched } }] },
    },
    include: {
      commander: { select: { nickname: true, syndicate: { select: { tag: true } } } },
      targetPlanet: {
        select: {
          name: true,
          system: { select: { name: true, galaxyX: true, galaxyY: true } },
          base: { select: { commander: { select: { nickname: true } } } },
        },
      },
    },
    orderBy: { arrivesAt: 'asc' },
  });

  return raidRows.concat(fleets.flatMap((fleet) => {
    const planet = fleet.targetPlanet;
    if (!planet || !isWatched(watchLevel, galaxyDistance(kish, planet.system))) return [];
    return [{
      fleetId: fleet.id,
      attacker: fleet.commander.nickname,
      attackerTag: fleet.commander.syndicate?.tag ?? null,
      target: planet.base?.commander.nickname ?? '—',
      planetName: planet.name,
      systemName: planet.system.name,
      arrivesInSeconds: Math.max(0, Math.ceil((fleet.arrivesAt.getTime() - now) / 1000)),
      ships: FLEET_SHIP_COLUMNS.reduce((sum, column) => sum + fleet[column], 0),
    }];
  }));
}

/* ------------------------- Казна ------------------------- */

/**
 * Пожертвование в казну.
 *
 * Списание с личного счета — условный UPDATE: параллельные пожертвования
 * не могут увести баланс в минус, как это было бы при чтении с последующей записью.
 */
export async function donate(commanderId: string, amount: number): Promise<SyndicateResult> {
  const access = await membershipOf(commanderId);
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
        data: { credits: { decrement: amount }, syndicateMerit: { increment: Math.floor(amount) } },
      });
      if (paid.count === 0) throw new SyndicateError('На счету недостаточно криптогривны', 409);

      await tx.syndicateBank.update({
        where: { syndicateId: access.syndicateId },
        data: { credits: { increment: amount } },
      });
      await tx.syndicate.update({
        where: { id: access.syndicateId },
        data: { contributedValue: { increment: amount } },
      });
      await tx.syndicateTransaction.create({
        data: { syndicateId: access.syndicateId, commanderId, kind: 'DONATION', amount },
      });
    });
  } catch (error) {
    return toError(error, 'Пожертвование не прошло');
  }

  await syncCredits(commanderId);
  return { ok: true, message: `В казну синдиката внесено ${amount} ₴` };
}

/**
 * Выдача из казны участнику.
 *
 * Дневной лимит считается скользящими сутками по тому, что выдал сам
 * выдающий. Он защищает от главной беды синдикатов: офицер выводит казну
 * и уходит. Главарю предела нет — он и так может распустить синдикат.
 */
export async function payout(commanderId: string, targetId: string, amount: number): Promise<SyndicateResult> {
  const access = await requirePermission(commanderId, 'WITHDRAW');
  if (!access.ok) return access;
  if (!Number.isInteger(amount) || amount <= 0) {
    return { ok: false, error: 'Сумма должна быть целым числом больше нуля', status: 400 };
  }

  const target = await prisma.commander.findUnique({ where: { id: targetId }, select: { syndicateId: true, nickname: true } });
  if (!target || target.syndicateId !== access.syndicateId) {
    return { ok: false, error: 'Выдавать можно только участнику своего синдиката', status: 404 };
  }

  try {
    await prisma.$transaction(async (tx) => {
      await lockSyndicate(tx, access.syndicateId);
      const spent = await withdrawnToday(access.syndicateId, commanderId, tx);
      const allowance = withdrawAllowance(access, access.dailyWithdrawLimit, spent);
      if (amount > allowance) {
        throw new SyndicateError(`Твой лимит выдачи на сутки: осталось ${Math.floor(allowance)} ₴`, 403);
      }
      const paid = await tx.syndicateBank.updateMany({
        where: { syndicateId: access.syndicateId, credits: { gte: amount } },
        data: { credits: { decrement: amount } },
      });
      if (paid.count === 0) throw new SyndicateError('В казне недостаточно криптогривны', 409);
      await tx.commander.update({ where: { id: targetId }, data: { credits: { increment: amount } } });
      await tx.syndicateTransaction.create({
        data: { syndicateId: access.syndicateId, commanderId: targetId, actorId: commanderId, kind: 'PAYOUT', amount },
      });
    });
  } catch (error) {
    return toError(error, 'Выдача не прошла');
  }

  await syncCredits(targetId);
  return { ok: true, message: `${target.nickname} получил из казны ${amount} ₴` };
}

/* ------------------------- Рассылка ------------------------- */

/** Рассылка по синдикату. Автор получает копию: в ящике остается история отправленного. */
export async function broadcast(
  commanderId: string,
  subject: string,
  body: string,
): Promise<{ ok: true; message: string; recipients: string[] } | { ok: false; error: string; status: number }> {
  const access = await requirePermission(commanderId, 'BROADCAST');
  if (!access.ok) return access;

  const syndicate = await prisma.syndicate.findUnique({
    where: { id: access.syndicateId },
    select: { name: true, tag: true, members: { select: { id: true } } },
  });
  if (!syndicate) return { ok: false, error: 'Синдикат не найден', status: 404 };

  const author = await nicknameOf(commanderId);
  const recipients = await deliver(
    syndicate.members.map((member) => ({
      recipientId: member.id,
      senderId: commanderId,
      type: 'SYNDICATE' as const,
      subject: `[${syndicate.tag}] ${subject}`,
      body: `${body}\n\n— ${author}, синдикат «${syndicate.name}»`,
    })),
  );

  return { ok: true, message: `Рассылка ушла участникам: ${syndicate.members.length}`, recipients };
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

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
}

/** Поля, которые сбрасываются у вышедшего. Пауза ставится только при добровольном выходе. */
function leftSyndicate(leftAt: Date | null): Prisma.CommanderUncheckedUpdateManyInput {
  return {
    syndicateId: null,
    syndicateRole: null,
    syndicateRankId: null,
    syndicateJoinedAt: null,
    syndicateMerit: 0,
    ...(leftAt ? { syndicateLeftAt: leftAt } : {}),
  };
}

function cooldownError(leftAt: Date | null): string | null {
  if (!leftAt) return null;
  const until = leftAt.getTime() + LEAVE_COOLDOWN_MS;
  const left = until - Date.now();
  if (left <= 0) return null;
  const hours = Math.ceil(left / 3_600_000);
  return `После выхода из синдиката вступить в новый можно через ${hours} ч`;
}

function effectivePermissions(access: Membership): SyndicatePermission[] {
  return access.isLeader ? [...SYNDICATE_PERMISSIONS] : (access.permissions as SyndicatePermission[]);
}

function scheduleOf(syndicate: { taxRate: number; pendingTaxRate: number | null; taxEffectiveAt: Date | null }) {
  return {
    taxRate: syndicate.taxRate,
    pendingTaxRate: syndicate.pendingTaxRate,
    taxEffectiveAt: syndicate.taxEffectiveAt?.getTime() ?? null,
  };
}

/** Отложенная ставка, чей срок прошел, показывается уже как текущая. */
function commitSchedule(syndicate: { taxRate: number; pendingTaxRate: number | null; taxEffectiveAt: Date | null }) {
  const schedule = scheduleOf(syndicate);
  if (schedule.pendingTaxRate !== null && schedule.taxEffectiveAt !== null && Date.now() >= schedule.taxEffectiveAt) {
    return { taxRate: schedule.pendingTaxRate, pendingTaxRate: null, taxEffectiveAt: null };
  }
  return schedule;
}

async function latestCodex(syndicateId: string, withAuthor = false) {
  return prisma.syndicateCodexVersion.findFirst({
    where: { syndicateId },
    orderBy: { createdAt: 'desc' },
    include: { author: withAuthor ? { select: { nickname: true } } : false },
  });
}


/** Сериализует операции над одним синдикатом до конца транзакции. */
async function lockSyndicate(tx: Prisma.TransactionClient, syndicateId: string): Promise<void> {
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${syndicateId}))::text AS locked`;
}

export function utcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

async function nicknameOf(commanderId: string): Promise<string> {
  const row = await prisma.commander.findUnique({ where: { id: commanderId }, select: { nickname: true } });
  return row?.nickname ?? 'командир';
}

async function notifyMembers(syndicateId: string, subject: string, body: string): Promise<void> {
  const members = await prisma.commander.findMany({ where: { syndicateId }, select: { id: true } });
  const recipients = await deliver(
    members.map((member) => ({ recipientId: member.id, senderId: null, type: 'SYNDICATE' as const, subject, body })),
  );
  for (const id of recipients) gameLoop.pushUnread(id);
}

async function syncCredits(commanderId: string): Promise<void> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { credits: true },
  });
  if (commander) gameLoop.syncCredits(commanderId, commander.credits);
}

/**
 * Тик держит синдикат командира в памяти — налог, срок вступления и технологии.
 * После смены членства их надо обновить: иначе налог ушел бы в прежнюю казну,
 * а бонусы остались бы у того, кто из синдиката уже вышел.
 */
async function syncMembership(commanderId: string): Promise<void> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: {
      syndicateJoinedAt: true,
      syndicate: { select: { id: true, taxRate: true, pendingTaxRate: true, taxEffectiveAt: true } },
    },
  });
  if (!commander?.syndicate) {
    gameLoop.syncSyndicate(commanderId, null);
    return;
  }
  const state = await syndicateTechState(commander.syndicate.id);
  gameLoop.syncSyndicate(commanderId, {
    id: commander.syndicate.id,
    tax: scheduleOf(commander.syndicate),
    joinedAt: commander.syndicateJoinedAt?.getTime() ?? null,
    techs: state.levels,
    research: state.research,
  });
}
