/**
 * Пульт гейм-мастера: чтение и принудительная правка состояния игроков.
 *
 * Каждая правка проходит через `gameLoop.applyAdminMutation`, иначе ближайший
 * сброс состояния из памяти затер бы выданное. Все изменения логируются:
 * God Mode обязан оставлять след, кто и что поменял.
 *
 * Значения не «прибавляются», а выставляются целиком: админ видит текущие числа
 * в форме и вводит нужные. Это исключает двойное применение при повторной
 * отправке формы — самый частый способ случайно выдать вдвое больше.
 */
import { randomBytes } from 'node:crypto';
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { authConfig } from '../config/auth.js';
import { deliver } from './mailService.js';
import { BUILDING_TYPES, isBuildingType, type BuildingType } from '../game/rules.js';
import { isTechnologyType, TECHNOLOGY_TYPES, type TechnologyType } from '../game/techTree.js';
import { isShipType, SHIP_TYPES, type ShipType } from '../game/ships.js';
import { DEFENSE_TYPES, isDefenseType, type DefenseType } from '../game/defenses.js';

export type AdminResult =
  | { ok: true; message: string }
  | { ok: false; error: string; status: number };

/** Сколько игроков отдаем в списке за раз. */
const LIST_LIMIT = 100;
/** Потолок на любое выдаваемое число: защита от опечатки в лишний ноль. */
const MAX_AMOUNT = 1_000_000_000;
const MAX_LEVEL = 100;

export interface CommanderSummary {
  commanderId: string;
  nickname: string;
  email: string;
  role: string;
  credits: number;
  bases: number;
  /** Родная колония — по ней игрока проще узнать в списке. */
  homePlanet: string | null;
  syndicate: { name: string; tag: string; role: string } | null;
  battlesWon: number;
  battlesLost: number;
  createdAt: number;
  lastSeenAt: number;
}

export async function listCommanders(search?: string): Promise<CommanderSummary[]> {
  const query = search?.trim();
  const rows = await prisma.commander.findMany({
    where: query ? { nickname: { contains: query, mode: 'insensitive' } } : {},
    include: {
      user: { select: { email: true, role: true } },
      syndicate: { select: { name: true, tag: true } },
      bases: { select: { planet: { select: { name: true } } } },
    },
    orderBy: { nickname: 'asc' },
    take: LIST_LIMIT,
  });

  return rows.map((row) => ({
    commanderId: row.id,
    nickname: row.nickname,
    email: row.user.email,
    role: row.user.role,
    credits: Math.round(row.credits),
    bases: row.bases.length,
    homePlanet: row.bases[0]?.planet.name ?? null,
    syndicate: row.syndicate
      ? { name: row.syndicate.name, tag: row.syndicate.tag, role: row.syndicateRole ?? 'MEMBER' }
      : null,
    battlesWon: row.battlesWon,
    battlesLost: row.battlesLost,
    createdAt: row.createdAt.getTime(),
    lastSeenAt: row.lastSeenAt.getTime(),
  }));
}

export interface AdminBaseView {
  baseId: string;
  name: string;
  planetName: string;
  systemName: string;
  resources: { ore: number; polymers: number; plasma: number; antimatter: number };
  buildings: Record<BuildingType, number>;
  ships: Record<ShipType, number>;
  defenses: Record<DefenseType, number>;
}

/** Учетная запись игрока: то, что не относится к игровому состоянию. */
export interface AdminAccountView {
  userId: string;
  email: string;
  role: string;
  /** Как игрок входит: пароль или внешний провайдер. */
  authProvider: string;
  createdAt: number;
  lastLoginAt: number | null;
  /** Когда заблокирован; null — доступ открыт. */
  blockedAt: number | null;
}

/** Сводка по серверу: то, ради чего пульт открывают первым делом. */
/* ------------------------- Действия над учетной записью ------------------------- */

/** Найти аккаунт по командиру: пульт оперирует командирами, права — аккаунтом. */
async function accountOf(
  commanderId: string,
): Promise<{ userId: string; nickname: string; role: string; email: string } | null> {
  const row = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { nickname: true, user: { select: { id: true, role: true, email: true } } },
  });
  return row ? { userId: row.user.id, nickname: row.nickname, role: row.user.role, email: row.user.email } : null;
}

/**
 * Выдать игроку код смены пароля.
 *
 * Пульт не задает пароль сам и не показывает старый: админ передает игроку
 * одноразовый код, а новый пароль игрок вводит себе сам. Так гейм-мастер
 * не начинает знать чужие пароли — а знать их он не должен даже технически.
 */
export async function issuePasswordReset(
  commanderId: string,
): Promise<AdminResult & { token?: string; expiresAt?: number }> {
  const account = await accountOf(commanderId);
  if (!account) return { ok: false, error: 'Командир не найден', status: 404 };

  // Боту код смены пароля не нужен и опасен: он превратил бы служебную
  // учетную запись в обычную, вместе с ее колониями и флотом.
  if (account.role === 'BOT') {
    return { ok: false, error: 'Это бот: пароля и входа у него нет', status: 400 };
  }

  const token = randomBytes(24).toString('hex');
  const expiresAt = new Date(Date.now() + authConfig.resetTtlMinutes * 60 * 1000);
  await prisma.user.update({
    where: { id: account.userId },
    data: { passwordResetToken: token, passwordResetExpires: expiresAt },
  });

  console.log(`[admin] выдан код смены пароля: ${account.nickname} (${account.email})`);
  return {
    ok: true,
    message: `Код действует ${authConfig.resetTtlMinutes} минут. Передай его игроку.`,
    token,
    expiresAt: expiresAt.getTime(),
  };
}

/**
 * Заблокировать или разблокировать аккаунт.
 *
 * Блокировка не трогает игровое состояние: колонии, флоты и склады остаются
 * на месте, тик продолжает их считать. Это запрет на вход, а не удаление —
 * разблокированный игрок находит мир таким, каким его оставил.
 */
export async function setAccountBlocked(commanderId: string, blocked: boolean): Promise<AdminResult> {
  const account = await accountOf(commanderId);
  if (!account) return { ok: false, error: 'Командир не найден', status: 404 };
  // Заблокировать администратора нельзя: иначе один гейм-мастер запирает
  // другого, и разблокировать некому, кроме как руками в базе.
  if (account.role === 'ADMIN' && blocked) {
    return { ok: false, error: 'Нельзя заблокировать администратора', status: 409 };
  }

  await prisma.user.update({
    where: { id: account.userId },
    data: { blockedAt: blocked ? new Date() : null },
  });

  console.log(`[admin] ${blocked ? 'блокировка' : 'разблокировка'}: ${account.nickname} (${account.email})`);
  return { ok: true, message: blocked ? `${account.nickname} заблокирован` : `${account.nickname} разблокирован` };
}

/**
 * Удалить учетную запись вместе с командиром.
 *
 * Необратимо и задевает не только игрока: каскад унесет его колонии (планеты
 * освободятся), флоты и, если он был лидером, весь его синдикат. Поэтому
 * вызывающий обязан подтвердить операцию позывным — совпадение проверяется
 * здесь же, а не только в интерфейсе.
 */
export async function deleteAccount(commanderId: string, confirmNickname: string): Promise<AdminResult> {
  const account = await accountOf(commanderId);
  if (!account) return { ok: false, error: 'Командир не найден', status: 404 };
  if (account.role === 'ADMIN') {
    return { ok: false, error: 'Нельзя удалить администратора', status: 409 };
  }
  if (confirmNickname.trim() !== account.nickname) {
    return { ok: false, error: 'Позывной для подтверждения не совпадает', status: 400 };
  }

  // Игрок мог быть в памяти тика: без выгрузки ближайший сброс попытался бы
  // записать состояние уже удаленных баз.
  await gameLoop.applyAdminMutation(commanderId, async () => {
    await prisma.user.delete({ where: { id: account.userId } });
  });

  console.log(`[admin] удалена учетная запись: ${account.nickname} (${account.email})`);
  return { ok: true, message: `Учетная запись ${account.nickname} удалена` };
}

const MAX_SUBJECT = 120;
const MAX_BODY = 4000;

/**
 * Письмо игроку от гейм-мастера.
 *
 * Уходит с системным отправителем и типом `ADMIN`: это не автоотчет тика,
 * и игрок должен отличать обращение администрации от письма про добычу.
 */
export async function messagePlayer(
  commanderId: string,
  subject: string,
  body: string,
): Promise<AdminResult> {
  const account = await accountOf(commanderId);
  if (!account) return { ok: false, error: 'Командир не найден', status: 404 };

  const cleanSubject = subject.trim();
  const cleanBody = body.trim();
  if (!cleanSubject || !cleanBody) return { ok: false, error: 'Тема и текст обязательны', status: 400 };
  if (cleanSubject.length > MAX_SUBJECT || cleanBody.length > MAX_BODY) {
    return { ok: false, error: 'Слишком длинная тема или текст', status: 400 };
  }

  await deliver([
    { recipientId: commanderId, type: 'ADMIN', subject: cleanSubject, body: cleanBody },
  ]);

  console.log(`[admin] письмо игроку ${account.nickname}: ${cleanSubject}`);
  return { ok: true, message: `Письмо отправлено: ${account.nickname}` };
}

export interface AdminDashboard {
  /** Учетных записей всего и сколько из них заблокировано. */
  accounts: number;
  blocked: number;
  /** Командиров: аккаунт без командира в игре не участвует. */
  commanders: number;
  /** Сейчас в сети — по живым сокетам, а не по времени последнего входа. */
  online: number;
  /** Заходили с начала сегодняшних суток и за последнюю неделю. */
  activeToday: number;
  activeWeek: number;
  /** Новые за сегодня — по ним видно приток. */
  registeredToday: number;
  colonies: number;
  fleetsInFlight: number;
  syndicates: number;
}

/** Начало текущих суток по времени сервера. */
function startOfToday(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

export async function getDashboard(): Promise<AdminDashboard> {
  const today = startOfToday();
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [accounts, blocked, commanders, activeToday, activeWeek, registeredToday, colonies, fleetsInFlight, syndicates] =
    await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { blockedAt: { not: null } } }),
      prisma.commander.count(),
      prisma.user.count({ where: { lastLoginAt: { gte: today } } }),
      prisma.user.count({ where: { lastLoginAt: { gte: weekAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: today } } }),
      prisma.base.count(),
      prisma.fleet.count(),
      prisma.syndicate.count(),
    ]);

  return {
    accounts,
    blocked,
    commanders,
    // Онлайн знает только тик: в БД этого нет, там лишь время последнего входа.
    online: gameLoop.onlineCount(),
    activeToday,
    activeWeek,
    registeredToday,
    colonies,
    fleetsInFlight,
    syndicates,
  };
}

export interface CommanderDetail {
  commanderId: string;
  nickname: string;
  email: string;
  role: string;
  account: AdminAccountView;
  credits: number;
  technologies: Record<TechnologyType, number>;
  bases: AdminBaseView[];
  hubStorages: Array<{ hubId: string; hubName: string; ore: number; polymers: number; level: number }>;
  fleetsInFlight: number;
}

/**
 * Полный стейт игрока. Читаем из БД, предварительно сбросив память тика —
 * иначе админ увидел бы устаревшие числа и «сохранил» их поверх свежих.
 */
export async function getCommanderDetail(commanderId: string): Promise<CommanderDetail | null> {
  await gameLoop.flushCommander(commanderId);

  const row = await prisma.commander.findUnique({
    where: { id: commanderId },
    include: {
      user: true,
      researches: true,
      hubStorages: { include: { hub: { select: { name: true } } } },
      bases: {
        include: {
          planet: { select: { name: true, system: { select: { name: true } } } },
          ships: true,
          defenses: true,
        },
      },
      _count: { select: { fleets: true } },
    },
  });
  if (!row) return null;

  const technologies = Object.fromEntries(
    TECHNOLOGY_TYPES.map((tech) => [tech, 0]),
  ) as Record<TechnologyType, number>;
  for (const research of row.researches) technologies[research.tech] = research.level;

  return {
    commanderId: row.id,
    nickname: row.nickname,
    email: row.user.email,
    role: row.user.role,
    account: {
      userId: row.user.id,
      email: row.user.email,
      role: row.user.role,
      authProvider: row.user.authProvider,
      createdAt: row.user.createdAt.getTime(),
      lastLoginAt: row.user.lastLoginAt?.getTime() ?? null,
      blockedAt: row.user.blockedAt?.getTime() ?? null,
    },
    credits: row.credits,
    technologies,
    fleetsInFlight: row._count.fleets,
    hubStorages: row.hubStorages.map((storage) => ({
      hubId: storage.hubId,
      hubName: storage.hub.name,
      ore: storage.ore,
      polymers: storage.polymers,
      level: storage.level,
    })),
    bases: row.bases.map((base) => {
      const ships = Object.fromEntries(SHIP_TYPES.map((type) => [type, 0])) as Record<ShipType, number>;
      for (const ship of base.ships) ships[ship.type] = ship.count;

      const defenses = Object.fromEntries(
        DEFENSE_TYPES.map((type) => [type, 0]),
      ) as Record<DefenseType, number>;
      for (const item of base.defenses) defenses[item.type] = item.count;

      return {
        baseId: base.id,
        name: base.name,
        planetName: base.planet.name,
        systemName: base.planet.system.name,
        resources: {
          ore: base.ore,
          polymers: base.polymers,
          plasma: base.plasma,
          antimatter: base.antimatter,
        },
        buildings: {
          ORE_MINE: base.oreMineLevel,
          POLYMER_PLANT: base.polymerPlantLevel,
          PLASMA_REACTOR: base.plasmaReactorLevel,
          POWER_PLANT: base.powerPlantLevel,
          SCIENCE_CENTER: base.scienceCenterLevel,
          SHIPYARD: base.shipyardLevel,
          ANTIMATTER_FACTORY: base.antimatterFactoryLevel,
          CRYPTO_FARM: base.cryptoFarmLevel,
          ORE_STORAGE: base.oreStorageLevel,
          POLYMER_STORAGE: base.polymerStorageLevel,
          PLASMA_STORAGE: base.plasmaStorageLevel,
        },
        ships,
        defenses,
      };
    }),
  };
}

/* ------------------------- Мутации ------------------------- */

export interface AdminPatch {
  credits?: number;
  technologies?: Partial<Record<TechnologyType, number>>;
  bases?: Array<{
    baseId: string;
    resources?: Partial<Record<'ore' | 'polymers' | 'plasma' | 'antimatter', number>>;
    buildings?: Partial<Record<BuildingType, number>>;
    ships?: Partial<Record<ShipType, number>>;
    defenses?: Partial<Record<DefenseType, number>>;
  }>;
}

const BUILDING_COLUMNS: Record<BuildingType, string> = {
  ORE_MINE: 'oreMineLevel',
  POLYMER_PLANT: 'polymerPlantLevel',
  PLASMA_REACTOR: 'plasmaReactorLevel',
  POWER_PLANT: 'powerPlantLevel',
  SCIENCE_CENTER: 'scienceCenterLevel',
  SHIPYARD: 'shipyardLevel',
  ANTIMATTER_FACTORY: 'antimatterFactoryLevel',
  CRYPTO_FARM: 'cryptoFarmLevel',
  ORE_STORAGE: 'oreStorageLevel',
  POLYMER_STORAGE: 'polymerStorageLevel',
  PLASMA_STORAGE: 'plasmaStorageLevel',
};

/** Разбор патча из тела запроса: чужие ключи и мусорные числа не проходят. */
export function parsePatch(input: unknown): AdminPatch | null {
  if (!input || typeof input !== 'object') return null;
  const source = input as Record<string, unknown>;
  const patch: AdminPatch = {};

  if (source['credits'] !== undefined) {
    const credits = amount(source['credits']);
    if (credits === null) return null;
    patch.credits = credits;
  }

  if (source['technologies'] !== undefined) {
    const techs = readLevels(source['technologies'], isTechnologyType);
    if (!techs) return null;
    patch.technologies = techs as Partial<Record<TechnologyType, number>>;
  }

  if (source['bases'] !== undefined) {
    if (!Array.isArray(source['bases'])) return null;
    const bases: NonNullable<AdminPatch['bases']> = [];

    for (const raw of source['bases']) {
      if (!raw || typeof raw !== 'object') return null;
      const entry = raw as Record<string, unknown>;
      if (typeof entry['baseId'] !== 'string' || !entry['baseId']) return null;

      const base: NonNullable<AdminPatch['bases']>[number] = { baseId: entry['baseId'] };

      if (entry['resources'] !== undefined) {
        const resources = readAmounts(entry['resources'], (key) =>
          ['ore', 'polymers', 'plasma', 'antimatter'].includes(key),
        );
        if (!resources) return null;
        base.resources = resources as Partial<Record<'ore' | 'polymers' | 'plasma' | 'antimatter', number>>;
      }
      if (entry['buildings'] !== undefined) {
        const buildings = readLevels(entry['buildings'], isBuildingType);
        if (!buildings) return null;
        base.buildings = buildings as Partial<Record<BuildingType, number>>;
      }
      if (entry['ships'] !== undefined) {
        const ships = readCounts(entry['ships'], isShipType);
        if (!ships) return null;
        base.ships = ships as Partial<Record<ShipType, number>>;
      }
      if (entry['defenses'] !== undefined) {
        const defenses = readCounts(entry['defenses'], isDefenseType);
        if (!defenses) return null;
        base.defenses = defenses as Partial<Record<DefenseType, number>>;
      }

      bases.push(base);
    }
    patch.bases = bases;
  }

  return patch;
}

/**
 * Приведение к числу для God Mode.
 *
 * Отдельная функция нужна из-за `Number()`: он молча превращает null, пустую
 * строку и пустой массив в ноль. Для пульта это худший из возможных исходов —
 * `{"credits": null}` (а именно так JSON сериализует Infinity) обнулил бы счет
 * игрока вместо отказа. Поэтому принимаем только число или непустую числовую строку.
 */
function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string') return null;

  const trimmed = value.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function amount(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || parsed < 0 || parsed > MAX_AMOUNT) return null;
  return Math.round(parsed * 100) / 100;
}

function count(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > MAX_AMOUNT) return null;
  return parsed;
}

function level(value: unknown): number | null {
  const parsed = toNumber(value);
  if (parsed === null || !Number.isInteger(parsed) || parsed < 0 || parsed > MAX_LEVEL) return null;
  return parsed;
}

function readMap(
  input: unknown,
  isKey: (key: string) => boolean,
  parse: (value: unknown) => number | null,
): Record<string, number> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, number> = {};

  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (!isKey(key)) return null;
    const parsed = parse(value);
    if (parsed === null) return null;
    out[key] = parsed;
  }
  return out;
}

const readAmounts = (input: unknown, isKey: (key: string) => boolean) => readMap(input, isKey, amount);
const readCounts = (input: unknown, isKey: (key: string) => boolean) => readMap(input, isKey, count);
const readLevels = (input: unknown, isKey: (key: string) => boolean) => readMap(input, isKey, level);

/**
 * Применение патча.
 *
 * Вся правка идет одной транзакцией внутри `applyAdminMutation`: игрок к этому
 * моменту выгружен из памяти тика, поэтому записанное уже никто не перезапишет.
 */
export async function applyPatch(
  adminEmail: string,
  commanderId: string,
  patch: AdminPatch,
): Promise<AdminResult> {
  const commander = await prisma.commander.findUnique({
    where: { id: commanderId },
    select: { nickname: true, bases: { select: { id: true } } },
  });
  if (!commander) return { ok: false, error: 'Командир не найден', status: 404 };

  const ownBases = new Set(commander.bases.map((base) => base.id));
  for (const base of patch.bases ?? []) {
    if (!ownBases.has(base.baseId)) {
      return { ok: false, error: 'База не принадлежит этому командиру', status: 400 };
    }
  }

  const changes: string[] = [];

  await gameLoop.applyAdminMutation(commanderId, async () => {
    await prisma.$transaction(async (tx) => {
      if (patch.credits !== undefined) {
        await tx.commander.update({ where: { id: commanderId }, data: { credits: patch.credits } });
        changes.push(`криптогривна=${patch.credits}`);
      }

      for (const [tech, value] of Object.entries(patch.technologies ?? {})) {
        await tx.research.upsert({
          where: { commanderId_tech: { commanderId, tech: tech as TechnologyType } },
          create: { commanderId, tech: tech as TechnologyType, level: value },
          update: { level: value },
        });
        changes.push(`${tech}=${value}`);
      }

      for (const base of patch.bases ?? []) {
        const data: Record<string, number> = {};
        for (const [key, value] of Object.entries(base.resources ?? {})) {
          data[key] = value;
          changes.push(`${key}=${value}`);
        }
        for (const [type, value] of Object.entries(base.buildings ?? {})) {
          data[BUILDING_COLUMNS[type as BuildingType]] = value;
          changes.push(`${type}=${value}`);
        }
        if (Object.keys(data).length > 0) {
          await tx.base.update({ where: { id: base.baseId }, data });
        }

        for (const [type, value] of Object.entries(base.ships ?? {})) {
          await tx.ship.upsert({
            where: { baseId_type: { baseId: base.baseId, type: type as ShipType } },
            create: { baseId: base.baseId, type: type as ShipType, count: value },
            update: { count: value },
          });
          changes.push(`${type}=${value}`);
        }
        for (const [type, value] of Object.entries(base.defenses ?? {})) {
          await tx.defense.upsert({
            where: { baseId_type: { baseId: base.baseId, type: type as DefenseType } },
            create: { baseId: base.baseId, type: type as DefenseType, count: value },
            update: { count: value },
          });
          changes.push(`${type}=${value}`);
        }
      }
    });
  });

  if (changes.length === 0) return { ok: false, error: 'Нечего менять', status: 400 };

  // God Mode обязан оставлять след: кто, кому и что поменял.
  console.error(
    `[admin] ${adminEmail} правит «${commander.nickname}» (${commanderId}): ${changes.join(', ')}`,
  );
  return { ok: true, message: `Изменения применены: ${changes.length}` };
}

/** Полный список ключей для формы админки — чтобы клиент не хардкодил перечисления. */
export function adminSchema() {
  return {
    buildings: BUILDING_TYPES,
    technologies: TECHNOLOGY_TYPES,
    ships: SHIP_TYPES,
    defenses: DEFENSE_TYPES,
    resources: ['ore', 'polymers', 'plasma', 'antimatter'] as const,
  };
}
