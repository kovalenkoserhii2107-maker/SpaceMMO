/**
 * Правила синдиката: предел состава, цена Коша, налог, ранги и права.
 * Модуль чистый — только числа и решения, без базы, — поэтому проверяется
 * тестами напрямую, а сервис синдиката и тик пользуются одними и теми же
 * формулами.
 */

export const SYNDICATE_PERMISSIONS = [
  'APPLICATIONS',
  'KICK',
  'PROMOTE',
  'BROADCAST',
  'WITHDRAW',
  'TAX',
  'CODEX',
  'RULES',
  'DIPLOMACY',
  'KISH',
  'ACADEMY',
] as const;

export type SyndicatePermission = (typeof SYNDICATE_PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<SyndicatePermission, string> = {
  APPLICATIONS: 'разбирать заявки',
  KICK: 'исключать',
  PROMOTE: 'назначать ранги',
  BROADCAST: 'рассылка',
  WITHDRAW: 'выдача из казны',
  TAX: 'налог',
  CODEX: 'кодекс',
  RULES: 'правила набора',
  DIPLOMACY: 'дипломатия',
  KISH: 'развитие Коша',
  ACADEMY: 'наука синдиката',
};

export function isSyndicatePermission(value: unknown): value is SyndicatePermission {
  return typeof value === 'string' && (SYNDICATE_PERMISSIONS as readonly string[]).includes(value);
}

/* ------------------------- Кіш и состав ------------------------- */

/*
 * Предел состава растет с Кошем: три на первом уровне и по одному за каждый
 * следующий. Без предела один синдикат поглотил бы сервер, а с пределом
 * рост состава становится общим делом — Кіш поднимают из казны.
 */
export const KISH_BASE_MEMBERS = 3;

export function memberCap(kishLevel: number): number {
  return KISH_BASE_MEMBERS + Math.max(0, Math.floor(kishLevel) - 1);
}

/*
 * Цена уровня Коша удваивается. Постройки синдиката — дорогая общая цель,
 * на которую копят вместе: второй уровень стоит 250 тысяч, десятый
 * (двенадцать участников) — 64 миллиона. Большой синдикат оплачивает свой
 * размер, и это же работает стоком криптогривны.
 */
export const KISH_UPGRADE_BASE = 250_000;
export const KISH_UPGRADE_FACTOR = 2;

export function kishUpgradeCost(targetLevel: number): number {
  if (targetLevel <= 1) return 0;
  return Math.round(KISH_UPGRADE_BASE * Math.pow(KISH_UPGRADE_FACTOR, targetLevel - 2));
}

/** Орбита Коша в системе: станция стоит у звезды, как торговый хаб. */
export const KISH_POSITION = 0;

/* ------------------------- Дозор ------------------------- */

/*
 * Дозор видит вооруженные флоты, летящие к участникам, в пределах радиуса
 * от Коша. Первый уровень смотрит только за системой самого Коша, каждый
 * следующий расширяет круг на три единицы карты: галактика двадцать на
 * двадцать, и седьмой уровень накрывает ее почти целиком из любого угла.
 *
 * Только атаки, без разведки: пролет зонда решает лестница шпионажа,
 * и купленная за гривну постройка не должна ее обходить.
 */
export const WATCH_RADIUS_STEP = 3;
export const WATCH_UPGRADE_BASE = 200_000;

export function watchRadius(level: number): number {
  if (level <= 0) return -1;
  return WATCH_RADIUS_STEP * (Math.floor(level) - 1);
}

export function isWatched(level: number, distanceFromKish: number): boolean {
  return level > 0 && distanceFromKish <= watchRadius(level);
}

/** Первый уровень — 200 тысяч, дальше удваивается, как у Коша. */
export function watchUpgradeCost(targetLevel: number): number {
  if (targetLevel <= 0) return 0;
  return Math.round(WATCH_UPGRADE_BASE * Math.pow(2, targetLevel - 1));
}

/* ------------------------- Академія и технологии ------------------------- */

export const SYNDICATE_TECHS = ['MINING', 'CONSTRUCTION', 'CARGO', 'TRADE', 'VAULT', 'COUNTERINTEL'] as const;
export type SyndicateTech = (typeof SYNDICATE_TECHS)[number];
export type SyndicateTechLevels = Record<SyndicateTech, number>;

export const SYNDICATE_TECH_LABELS: Record<SyndicateTech, string> = {
  MINING: 'Общая разработка недр',
  CONSTRUCTION: 'Строительная артель',
  CARGO: 'Обозные трюмы',
  TRADE: 'Торговые связи',
  VAULT: 'Тайники',
  COUNTERINTEL: 'Контрразведка',
};

export const SYNDICATE_TECH_EFFECTS: Record<SyndicateTech, string> = {
  MINING: '+3% добычи за уровень',
  CONSTRUCTION: 'стройка и сборка на 3% быстрее за уровень',
  CARGO: '+3% вместимости трюмов за уровень',
  TRADE: 'комиссия биржи на 3% ниже за уровень',
  VAULT: 'несгораемая доля склада +3% за уровень',
  COUNTERINTEL: '+1 к «Шпионажу» в обороне за каждые 3 уровня',
};

export function isSyndicateTech(value: unknown): value is SyndicateTech {
  return typeof value === 'string' && (SYNDICATE_TECHS as readonly string[]).includes(value);
}

export function emptySyndicateTechLevels(): SyndicateTechLevels {
  return { MINING: 0, CONSTRUCTION: 0, CARGO: 0, TRADE: 0, VAULT: 0, COUNTERINTEL: 0 };
}

/*
 * Потолка у технологий синдиката нет: его заменяет цена. Каждый уровень
 * втрое дороже предыдущего, и +21% на седьмом уровне стоит уже 729 базовых
 * цен — дело большого синдиката, а не вечера. Шаг +3% за уровень держит
 * одиночку жизнеспособным: синдикат дает преимущество, но не замещает
 * собственное развитие.
 */
export const SYNDICATE_TECH_STEP = 0.03;
export const SYNDICATE_TECH_FACTOR = 3;
export const SYNDICATE_TECH_BASE = { credits: 10_000, ore: 10_000, polymers: 10_000 } as const;

export interface TreasuryCost {
  credits: number;
  ore: number;
  polymers: number;
}

export function syndicateTechCost(targetLevel: number): TreasuryCost {
  const scale = Math.pow(SYNDICATE_TECH_FACTOR, Math.max(0, targetLevel - 1));
  return {
    credits: Math.round(SYNDICATE_TECH_BASE.credits * scale),
    ore: Math.round(SYNDICATE_TECH_BASE.ore * scale),
    polymers: Math.round(SYNDICATE_TECH_BASE.polymers * scale),
  };
}

/*
 * Академія — модуль Коша, и ее уровень — потолок уровня любой технологии.
 * Сверх потолка она ускоряет изучение: каждый лишний уровень Академії
 * над изучаемым сокращает срок на четверть, так же как лаборатория
 * ускоряет собственную науку командира.
 */
export function academyUpgradeCost(targetLevel: number): TreasuryCost {
  const scale = Math.pow(2, Math.max(0, targetLevel - 1));
  return {
    credits: Math.round(300_000 * scale),
    ore: Math.round(200_000 * scale),
    polymers: Math.round(200_000 * scale),
  };
}

export const SYNDICATE_RESEARCH_BASE_SECONDS = 3600;

export function syndicateResearchSeconds(targetLevel: number, academyLevel: number): number {
  const raw = SYNDICATE_RESEARCH_BASE_SECONDS * Math.pow(2, Math.max(0, targetLevel - 1));
  const surplus = Math.max(0, academyLevel - targetLevel);
  return Math.max(60, Math.round(raw / (1 + surplus * 0.25)));
}

/** Изучение, чей срок прошел, уже действует — даже если его еще никто не записал. */
export function effectiveSyndicateTechs(
  levels: SyndicateTechLevels,
  research: { tech: SyndicateTech; targetLevel: number; finishesAt: number } | null,
  now: number,
): SyndicateTechLevels {
  if (!research || research.finishesAt > now) return levels;
  return { ...levels, [research.tech]: Math.max(levels[research.tech], research.targetLevel) };
}

/*
 * Бонусы получает участник, пробывший в синдикате двое суток. Без паузы
 * бонусы можно было бы «арендовать»: вступить ради большой стройки, выйти,
 * вступить в соседний ради торговли.
 */
export const BUFF_TENURE_MS = 48 * 60 * 60 * 1000;

export interface SyndicateBuffs {
  /** Множитель добычи. */
  mining: number;
  /** Во сколько раз быстрее стройка и сборка. */
  construction: number;
  /** Множитель вместимости трюмов. */
  cargo: number;
  /** Множитель комиссии биржи: 1 — без скидки. */
  tradeFee: number;
  /** Множитель несгораемой доли склада. */
  vault: number;
  /** Сколько уровней «Шпионажа» прибавляется в обороне. */
  counterIntel: number;
}

export const NEUTRAL_SYNDICATE_BUFFS: SyndicateBuffs = {
  mining: 1,
  construction: 1,
  cargo: 1,
  tradeFee: 1,
  vault: 1,
  counterIntel: 0,
};

export function syndicateBuffs(levels: SyndicateTechLevels, joinedAt: number | null, now: number): SyndicateBuffs {
  if (joinedAt === null || now - joinedAt < BUFF_TENURE_MS) return NEUTRAL_SYNDICATE_BUFFS;
  const step = (tech: SyndicateTech) => SYNDICATE_TECH_STEP * Math.max(0, levels[tech]);
  return {
    mining: 1 + step('MINING'),
    construction: 1 + step('CONSTRUCTION'),
    cargo: 1 + step('CARGO'),
    tradeFee: Math.max(0, 1 - step('TRADE')),
    vault: 1 + step('VAULT'),
    counterIntel: Math.floor(Math.max(0, levels.COUNTERINTEL) / 3),
  };
}

/* ------------------------- Брама и перенос Коша ------------------------- */

/*
 * Брама — врата синдиката в отдельной системе. Флоты участников прыгают
 * между любыми двумя системами, где стоят Брамы их синдиката, без
 * «Гипердвигателя», за треть антиматерии обычного прыжка и за две минуты
 * самого прыжка — к нему прибавляется только полет по орбитам до врат
 * и от них. Пропускная способность ограничена: иначе врата заменили бы
 * гипердвигатель целиком, и расстояния в галактике перестали бы значить.
 */
/*
 * Брама — самая дорогая постройка синдиката: услуга, на которую копят.
 * Дешевые врата заменили бы гипердвигатель каждому, а дорогие остаются
 * решением синдиката, где их ставить.
 */
export const BRAMA_BASE = { credits: 500_000, ore: 500_000, polymers: 500_000 } as const;
export const BRAMA_THROUGHPUT_PER_LEVEL = 200;
export const GATE_ANTIMATTER_SHARE = 0.3;
export const GATE_JUMP_SECONDS = 120;
/** Врата стоят у звезды, как хаб и Кіш. */
export const GATE_POSITION = 0;

export function bramaUpgradeCost(targetLevel: number): TreasuryCost {
  const scale = Math.pow(2, Math.max(0, targetLevel - 1));
  return {
    credits: Math.round(BRAMA_BASE.credits * scale),
    ore: Math.round(BRAMA_BASE.ore * scale),
    polymers: Math.round(BRAMA_BASE.polymers * scale),
  };
}

/** Сколько кораблей Брама пропускает за час. */
export function bramaThroughput(level: number): number {
  return BRAMA_THROUGHPUT_PER_LEVEL * Math.max(0, Math.floor(level));
}

/*
 * Перенос Коша — только в систему со своей Брамой и только за антиматерию
 * из казны, пропорционально расстоянию. Не чаще раза в сутки: иначе от любого
 * набега уходили бы одной кнопкой.
 */
export const KISH_MOVE_ANTIMATTER_PER_DISTANCE = 500;
export const KISH_MOVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export function kishMoveCost(distance: number): number {
  return Math.max(1, Math.ceil(Math.max(0, distance) * KISH_MOVE_ANTIMATTER_PER_DISTANCE));
}

export function kishMoveAvailableAt(movedAt: number | null): number {
  return movedAt === null ? 0 : movedAt + KISH_MOVE_COOLDOWN_MS;
}

/* ------------------------- Скарбниця и налет на Кіш ------------------------- */

/*
 * Скарбниця прячет часть казны от налета: пятая часть несгораема всегда,
 * и каждый уровень добавляет еще по пять процентов, но не больше четырех
 * пятых. Полная неуязвимость убила бы налеты, а с ними и смысл обороны Коша.
 */
export const TREASURY_BASE_SHARE = 0.2;
export const TREASURY_SHARE_PER_LEVEL = 0.05;
export const TREASURY_MAX_SHARE = 0.8;
export const TREASURY_BASE = { credits: 200_000, ore: 200_000, polymers: 200_000 } as const;
/** Налетчик уносит девять десятых уязвимой части — как и с колонии. */
export const KISH_RAID_SHARE = 0.9;

export function treasuryProtectedShare(level: number): number {
  return Math.min(TREASURY_MAX_SHARE, TREASURY_BASE_SHARE + TREASURY_SHARE_PER_LEVEL * Math.max(0, Math.floor(level)));
}

export function treasuryUpgradeCost(targetLevel: number): TreasuryCost {
  const scale = Math.pow(2, Math.max(0, targetLevel - 1));
  return {
    credits: Math.round(TREASURY_BASE.credits * scale),
    ore: Math.round(TREASURY_BASE.ore * scale),
    polymers: Math.round(TREASURY_BASE.polymers * scale),
  };
}

export interface TreasuryPlunder {
  ore: number;
  polymers: number;
  plasma: number;
  /** Сколько казны спрятала Скарбниця. */
  protectedAmount: number;
  /** Сколько можно было бы унести при бездонных трюмах. */
  takeable: number;
  cargoLimited: boolean;
}

/**
 * Добыча налета на Кіш. Гривна не грабится — ее нет на складе, это счет.
 * Трюмы заполняются рудой, затем полимерами, затем плазмой.
 */
export function plunderTreasury(
  stock: { ore: number; polymers: number; plasma: number },
  protectedShare: number,
  cargoCapacity: number,
): TreasuryPlunder {
  const share = Math.min(1, Math.max(0, protectedShare));
  let room = Math.max(0, Math.floor(cargoCapacity));
  const result = { ore: 0, polymers: 0, plasma: 0 };
  let protectedAmount = 0;
  let takeable = 0;
  for (const resource of ['ore', 'polymers', 'plasma'] as const) {
    const held = Math.max(0, stock[resource]);
    protectedAmount += held * share;
    const vulnerable = Math.floor(held * (1 - share) * KISH_RAID_SHARE);
    takeable += vulnerable;
    const taken = Math.min(vulnerable, room);
    result[resource] = taken;
    room -= taken;
  }
  const carried = result.ore + result.polymers + result.plasma;
  return { ...result, protectedAmount: Math.round(protectedAmount), takeable, cargoLimited: carried < takeable };
}

/* ------------------------- Налог ------------------------- */

export const MAX_TAX_RATE = 30;
/** Новая ставка вступает в силу через сутки: о повышении узнают до того, как оно ударит. */
export const TAX_DELAY_MS = 24 * 60 * 60 * 1000;

export interface TaxSchedule {
  taxRate: number;
  pendingTaxRate: number | null;
  taxEffectiveAt: number | null;
}

export function effectiveTaxRate(schedule: TaxSchedule, now: number): number {
  if (schedule.pendingTaxRate !== null && schedule.taxEffectiveAt !== null && now >= schedule.taxEffectiveAt) {
    return clampTaxRate(schedule.pendingTaxRate);
  }
  return clampTaxRate(schedule.taxRate);
}

export function clampTaxRate(rate: number): number {
  if (!Number.isFinite(rate)) return 0;
  return Math.min(MAX_TAX_RATE, Math.max(0, Math.round(rate)));
}

/**
 * Делит намытое на налог и остаток. Налог округляется вниз: целые гривны
 * уходят в казну, дробная часть остается участнику, а не копится долгом.
 */
export function splitTax(mined: number, ratePercent: number): { tax: number; kept: number } {
  const whole = Math.max(0, Math.floor(mined));
  const tax = Math.floor((whole * clampTaxRate(ratePercent)) / 100);
  return { tax, kept: whole - tax };
}

/* ------------------------- Ранги и права ------------------------- */

export const MAX_RANKS = 8;
export const RANK_NAME_MAX = 24;
export const CODEX_MAX_LENGTH = 5000;
/** Пауза после добровольного выхода: иначе перебегать за чужими бонусами ничего не стоит. */
export const LEAVE_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface RankTemplate {
  name: string;
  position: number;
  permissions: SyndicatePermission[];
  dailyWithdrawLimit: number;
}

/*
 * Стартовые ранги повторяют прежние три роли с их же правами: переход
 * на ранги не должен ни у кого ничего отнять и ничего добавить. Офицер
 * разбирал заявки, исключал рядовых, делал рассылку и объявлял войну.
 */
export const DEFAULT_RANKS: readonly RankTemplate[] = [
  { name: 'Главарь', position: 0, permissions: [...SYNDICATE_PERMISSIONS], dailyWithdrawLimit: 0 },
  {
    name: 'Офицер',
    position: 1,
    permissions: ['APPLICATIONS', 'KICK', 'BROADCAST', 'DIPLOMACY'],
    dailyWithdrawLimit: 0,
  },
  { name: 'Участник', position: 2, permissions: [], dailyWithdrawLimit: 0 },
];

/** Прежняя роль — в место стартового ранга. */
export function legacyRankPosition(role: string | null | undefined): number {
  if (role === 'LEADER') return 0;
  if (role === 'OFFICER') return 1;
  return 2;
}

export interface MemberAuthority {
  isLeader: boolean;
  position: number;
  permissions: readonly string[];
}

/** У главаря все права всегда: снять их с него нельзя ни одной правкой рангов. */
export function hasPermission(member: MemberAuthority, permission: SyndicatePermission): boolean {
  return member.isLeader || member.permissions.includes(permission);
}

/**
 * Действовать на участника — исключать, менять ему ранг — можно только
 * при ранге строго выше. Иначе офицеры вычистили бы друг друга, а заодно
 * и главаря.
 */
export function outranks(actor: MemberAuthority, target: MemberAuthority): boolean {
  if (target.isLeader) return false;
  if (actor.isLeader) return true;
  return actor.position < target.position;
}

/** Сколько еще можно выдать из казны сегодня. У главаря предела нет. */
export function withdrawAllowance(member: MemberAuthority, dailyLimit: number, spentToday: number): number {
  if (member.isLeader) return Number.POSITIVE_INFINITY;
  if (!member.permissions.includes('WITHDRAW')) return 0;
  return Math.max(0, Math.floor(dailyLimit) - Math.max(0, spentToday));
}

/* ------------------------- Тексты ------------------------- */

/**
 * Кодекс — свободный текст, и рисуется он текстом, а не разметкой.
 * Здесь отрезаются только управляющие символы и лишняя длина: правило
 * «не больше пяти тысяч знаков» проверяет сервер, а не форма.
 */
export function normalizeCodex(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/\r\n/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  if (text.length > CODEX_MAX_LENGTH) return null;
  return text;
}

export function normalizeRankName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > RANK_NAME_MAX) return null;
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(name)) return null;
  return name;
}
