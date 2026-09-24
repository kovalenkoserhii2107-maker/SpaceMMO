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

/* ------------------------- Академия и технологии ------------------------- */

export const SYNDICATE_TECHS = ['MINING', 'CONSTRUCTION', 'CARGO', 'TRADE', 'VAULT', 'COUNTERINTEL', 'ENGINEERING'] as const;
export type SyndicateTech = (typeof SYNDICATE_TECHS)[number];
export type SyndicateTechLevels = Record<SyndicateTech, number>;

export const SYNDICATE_TECH_LABELS: Record<SyndicateTech, string> = {
  MINING: 'Общая разработка недр',
  CONSTRUCTION: 'Строительная артель',
  CARGO: 'Обозные трюмы',
  TRADE: 'Торговые связи',
  VAULT: 'Тайники',
  COUNTERINTEL: 'Контрразведка',
  ENGINEERING: 'Инженерный корпус',
};

export const SYNDICATE_TECH_EFFECTS: Record<SyndicateTech, string> = {
  MINING: '+3% добычи за уровень',
  CONSTRUCTION: 'стройка и сборка на 3% быстрее за уровень',
  CARGO: '+3% вместимости трюмов за уровень',
  TRADE: 'комиссия биржи на 3% ниже за уровень',
  VAULT: 'несгораемая доля склада +3% за уровень',
  COUNTERINTEL: '+1 к «Шпионажу» в обороне за каждые 3 уровня',
  ENGINEERING: 'стройка в Коше и изучение технологий синдиката на 10% быстрее за уровень',
};

export function isSyndicateTech(value: unknown): value is SyndicateTech {
  return typeof value === 'string' && (SYNDICATE_TECHS as readonly string[]).includes(value);
}

export function emptySyndicateTechLevels(): SyndicateTechLevels {
  return { MINING: 0, CONSTRUCTION: 0, CARGO: 0, TRADE: 0, VAULT: 0, COUNTERINTEL: 0, ENGINEERING: 0 };
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
 * Академия — модуль Коша, и ее уровень — потолок уровня любой технологии.
 * Сверх потолка она ускоряет изучение: каждый лишний уровень Академии
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

/*
 * «Инженерный корпус» ускоряет все работы самого Коша — стройку модулей
 * и изучение технологий, — по десять процентов за уровень. На бонусы
 * участников он не влияет: это наука о Коше, а не о колониях.
 */
export const ENGINEERING_STEP = 0.1;

export function kishSpeedup(engineeringLevel: number): number {
  return 1 + ENGINEERING_STEP * Math.max(0, Math.floor(engineeringLevel));
}

export function syndicateResearchSeconds(targetLevel: number, academyLevel: number, engineeringLevel = 0): number {
  const raw = SYNDICATE_RESEARCH_BASE_SECONDS * Math.pow(2, Math.max(0, targetLevel - 1));
  const surplus = Math.max(0, academyLevel - targetLevel);
  return Math.max(60, Math.round(raw / (1 + surplus * 0.25) / kishSpeedup(engineeringLevel)));
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
 * решением синдиката, где их ставить. Гривна вдвое с половиной тяжелее
 * ресурсов: ресурсы синдикат добывает сам, а гривну только копит.
 */
export const BRAMA_BASE = { credits: 5_000_000, ore: 2_000_000, polymers: 2_000_000 } as const;
export const BRAMA_THROUGHPUT_PER_LEVEL = 200;
export const GATE_ANTIMATTER_SHARE = 0.3;
/**
 * Прыжок через Браму мгновенный: время рейса — только путь по орбитам
 * до врат и от врат. В этом и смысл врат при недельных перелетах через
 * галактику — расстояние между системами для них перестает существовать.
 */
export const GATE_JUMP_SECONDS = 0;
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
 * Аренда сети Брам.
 *
 * Синдикат-владелец пускает в свои врата игрока или другой синдикат на срок
 * за плату вперед. Сроки — фиксированный набор: договор читается одной
 * строкой («неделя за миллион»), а произвольные часы превратили бы список
 * предложений в таблицу, которую надо считать. Плата уходит в казну
 * владельца — это перевод, а не сток: деньги мира не исчезают.
 */
export const GATE_LEASE_HOURS = [24, 72, 168, 720] as const;
export type GateLeaseHours = (typeof GATE_LEASE_HOURS)[number];
/** Потолок платы — защита от лишних нулей, как у взноса в казну. */
export const GATE_LEASE_PRICE_MAX = 1_000_000_000;

export function isGateLeaseHours(value: unknown): value is GateLeaseHours {
  return typeof value === 'number' && (GATE_LEASE_HOURS as readonly number[]).includes(value);
}

/**
 * Возврат за неиспользованный срок, когда владелец расторгает аренду сам.
 *
 * Пропорционально остатку и вниз до целого: арендатор заплатил за срок,
 * и отнять его досрочно, оставив деньги себе, значило бы продать один
 * и тот же доступ дважды. Если расторгает арендатор — возврата нет,
 * это его решение.
 */
export function gateLeaseRefund(price: number, startsAt: number, endsAt: number, now: number): number {
  const total = endsAt - startsAt;
  if (total <= 0 || now >= endsAt) return 0;
  const left = Math.min(total, endsAt - Math.max(startsAt, now));
  return Math.max(0, Math.floor((price * left) / total));
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
export const CODEX_MAX_LENGTH = 15_000;
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

/** Описание синдиката — одна-две фразы под названием, видны и кандидатам. */
export const DESCRIPTION_MAX_LENGTH = 600;

/** Описание в одну строку: переводы строк и управляющие символы сворачиваются в пробел. */
export function normalizeDescription(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = raw.replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
  return text.length > DESCRIPTION_MAX_LENGTH ? null : text;
}

/** Направление операции казны — для журнала и сводки поступлений и расходов. */
export type TreasuryFlow = 'IN' | 'OUT' | 'NEUTRAL';

const INCOMING_TREASURY_KINDS: readonly string[] = [
  'DONATION', 'TAX', 'ENTRY_FEE', 'RESOURCE_DELIVERY', 'BUILD_REFUND', 'GATE_LEASE_INCOME',
];

/**
 * Основание — не поступление и не расход: цена основания сгорает, в казну
 * она не ложится. Налет на Кіш — расход: казна уменьшилась, хоть и не по воле синдиката.
 */
export function treasuryFlow(kind: string): TreasuryFlow {
  if (INCOMING_TREASURY_KINDS.includes(kind)) return 'IN';
  return kind === 'FOUNDING' ? 'NEUTRAL' : 'OUT';
}

export function normalizeRankName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > RANK_NAME_MAX) return null;
  if (!/^[\p{L}\p{N}_\- ]+$/u.test(name)) return null;
  return name;
}

/* ------------------------- Пакты ------------------------- */

export const PACT_TYPES = ['NON_AGGRESSION', 'ALLIANCE', 'TRADE'] as const;
export type PactKind = (typeof PACT_TYPES)[number];

export const PACT_LABELS: Record<PactKind, string> = {
  NON_AGGRESSION: 'Ненападение',
  ALLIANCE: 'Союз',
  TRADE: 'Торговое соглашение',
};

/**
 * Расторгнутый пакт действует еще сутки. Без срока пакт о ненападении
 * ничего не стоил бы: расторгнуть и напасть можно было бы одной минутой.
 */
export const PACT_NOTICE_MS = 24 * 60 * 60 * 1000;

/** Торговое соглашение вдвое снижает комиссию биржи в сделках между сторонами. */
export const TRADE_PACT_FEE_MULTIPLIER = 0.5;

export function isPactKind(value: unknown): value is PactKind {
  return typeof value === 'string' && (PACT_TYPES as readonly string[]).includes(value);
}

/** Пара синдикатов упорядочена по id: один пакт одного вида на пару. */
export function pactPair(first: string, second: string): [string, string] {
  return first < second ? [first, second] : [second, first];
}

/** Действует ли пакт сейчас: принят и срок расторжения не вышел. */
export function pactInForce(pact: { status: string; endsAt: number | null }, now: number): boolean {
  return pact.status === 'ACTIVE' && (pact.endsAt === null || pact.endsAt > now);
}

/** Союз включает ненападение: союзники друг друга не атакуют. */
export function pactsForbidAttack(kinds: readonly PactKind[]): boolean {
  return kinds.includes('NON_AGGRESSION') || kinds.includes('ALLIANCE');
}

/* ------------------------- Подробности модулей и технологий ------------------------- */

/*
 * Карточка модуля Коша или технологии синдиката раскрывается таблицей
 * уровней вперед — как постройка колонии: эффект, цена и срок. Считается
 * здесь, на тех же формулах, по которым списывается казна, иначе таблица
 * разошлась бы с ценой на кнопке при первой правке баланса.
 */
export const SYNDICATE_MODULES = ['KISH', 'SKARBNYTSIA', 'AKADEMIIA', 'DOZOR', 'BRAMA'] as const;
export type SyndicateModule = (typeof SYNDICATE_MODULES)[number];

export function isSyndicateModule(value: unknown): value is SyndicateModule {
  return typeof value === 'string' && (SYNDICATE_MODULES as readonly string[]).includes(value);
}

export const PROJECTION_DEPTH = 10;

/*
 * Модули Коша строятся по времени, как постройки колонии. Одна стройка
 * на синдикат: Кіш — общая мастерская, и очередь в ней общая. Срок удваивается
 * с уровнем; Брама и Академия строятся дольше остальных — это самые
 * сильные постройки. «Инженерный корпус» делит срок так же, как изучение.
 */
export const SYNDICATE_BUILD_BASE_SECONDS: Record<SyndicateModule, number> = {
  KISH: 1800,
  SKARBNYTSIA: 1800,
  AKADEMIIA: 3600,
  DOZOR: 1800,
  BRAMA: 7200,
};

export function syndicateBuildSeconds(module: SyndicateModule, targetLevel: number, engineeringLevel = 0): number {
  const raw = SYNDICATE_BUILD_BASE_SECONDS[module] * Math.pow(2, Math.max(0, targetLevel - 1));
  return Math.max(60, Math.round(raw / kishSpeedup(engineeringLevel)));
}

/** Какое право нужно, чтобы строить или отменять стройку модуля. */
export function modulePermission(module: SyndicateModule): SyndicatePermission {
  return module === 'AKADEMIIA' ? 'ACADEMY' : 'KISH';
}

export function syndicateModuleCost(module: SyndicateModule, targetLevel: number): TreasuryCost {
  return MODULE_INFO[module].cost(targetLevel);
}

export function syndicateModuleLabel(module: SyndicateModule): string {
  return MODULE_INFO[module].label;
}

export interface SyndicateProjectionRow {
  level: number;
  /** Текущий уровень идет первой строкой: у него нет цены, он уже оплачен. */
  current: boolean;
  cost: TreasuryCost | null;
  /** Срок есть только у технологий: модули ставятся сразу. */
  seconds: number | null;
  effect: string;
  /** Чего не хватает, чтобы этот уровень взять, — например, уровня Академии. */
  note: string | null;
}

export interface SyndicateProjection {
  key: string;
  label: string;
  description: string;
  level: number;
  effectLabel: string;
  rows: SyndicateProjectionRow[];
}

const MODULE_INFO: Record<SyndicateModule, {
  label: string;
  description: string;
  effectLabel: string;
  effect: (level: number) => string;
  cost: (targetLevel: number) => TreasuryCost;
}> = {
  KISH: {
    label: 'Кіш',
    description: 'Хаб синдиката. Каждый уровень добавляет одно место в составе.',
    effectLabel: 'мест в составе',
    effect: (level) => `${memberCap(Math.max(1, level))}`,
    cost: (target) => ({ credits: kishUpgradeCost(target), ore: 0, polymers: 0 }),
  },
  SKARBNYTSIA: {
    label: 'Скарбниця',
    description: 'Бережет часть ресурсной казны при налете на Кіш. Гривну не грабят вовсе.',
    effectLabel: 'несгораемо',
    effect: (level) => `${Math.round(treasuryProtectedShare(level) * 100)}% казны`,
    cost: treasuryUpgradeCost,
  },
  AKADEMIIA: {
    label: 'Академия',
    description: 'Открывает технологии синдиката. Ее уровень — потолок уровня любой технологии, а лишние уровни ускоряют изучение.',
    effectLabel: 'технологии',
    effect: (level) => (level > 0 ? `до ур. ${level}` : 'закрыты'),
    cost: academyUpgradeCost,
  },
  DOZOR: {
    label: 'Дозор',
    description: 'Показывает всем участникам вражеские атаки на колонии в радиусе от Коша.',
    effectLabel: 'наблюдение',
    effect: (level) => (level <= 0 ? 'нет' : watchRadius(level) === 0 ? 'система Коша' : `радиус ${watchRadius(level)}`),
    cost: (target) => ({ credits: watchUpgradeCost(target), ore: 0, polymers: 0 }),
  },
  BRAMA: {
    label: 'Брама',
    description: 'Прыжок между системами со своими Брамами без «Гипердвигателя» и за треть антиматерии.',
    effectLabel: 'пропускает в час',
    effect: (level) => `${bramaThroughput(level)} кораблей`,
    cost: bramaUpgradeCost,
  },
};

export function syndicateModuleProjection(
  module: SyndicateModule,
  level: number,
  engineeringLevel = 0,
  /** Что уже есть в синдикате: без него в таблице нет строки требований. */
  progress: SyndicateProgress | null = null,
): SyndicateProjection {
  const info = MODULE_INFO[module];
  const current = Math.max(0, Math.floor(level));
  const rows: SyndicateProjectionRow[] = [{ level: current, current: true, cost: null, seconds: null, effect: info.effect(current), note: null }];
  for (let target = current + 1; target <= current + PROJECTION_DEPTH; target += 1) {
    const missing = progress ? missingSyndicateRequirements(module, target, progress) : [];
    rows.push({
      level: target,
      current: false,
      cost: info.cost(target),
      seconds: syndicateBuildSeconds(module, target, engineeringLevel),
      effect: info.effect(target),
      note: missing.length > 0 ? `нужно: ${requirementsText(missing)}` : null,
    });
  }
  return { key: module, label: info.label, description: info.description, level: current, effectLabel: info.effectLabel, rows };
}

export function syndicateTechEffect(tech: SyndicateTech, level: number): string {
  const percent = Math.round(SYNDICATE_TECH_STEP * Math.max(0, level) * 100);
  switch (tech) {
    case 'MINING': return `+${percent}% добычи`;
    case 'CONSTRUCTION': return `+${percent}% к скорости стройки`;
    case 'CARGO': return `+${percent}% трюмов`;
    case 'TRADE': return `−${percent}% комиссии`;
    case 'VAULT': return `+${percent}% несгораемой доли`;
    case 'COUNTERINTEL': return `+${Math.floor(Math.max(0, level) / 3)} к «Шпионажу»`;
    case 'ENGINEERING': return `+${Math.round(ENGINEERING_STEP * Math.max(0, level) * 100)}% скорости работ Коша`;
  }
}

export function syndicateTechProjection(
  tech: SyndicateTech,
  level: number,
  academyLevel: number,
  engineeringLevel = 0,
  progress: SyndicateProgress | null = null,
): SyndicateProjection {
  const current = Math.max(0, Math.floor(level));
  const rows: SyndicateProjectionRow[] = [{
    level: current, current: true, cost: null, seconds: null, effect: syndicateTechEffect(tech, current), note: null,
  }];
  for (let target = current + 1; target <= current + PROJECTION_DEPTH; target += 1) {
    rows.push({
      level: target,
      current: false,
      cost: syndicateTechCost(target),
      seconds: syndicateResearchSeconds(target, academyLevel, engineeringLevel),
      effect: syndicateTechEffect(tech, target),
      note: (() => {
        // Без картины синдиката остается одно требование, известное по параметрам, — Академия.
        const missing = progress
          ? missingSyndicateRequirements(tech, target, progress)
          : academyLevel < target
            ? [{ key: 'AKADEMIIA' as const, level: target }]
            : [];
        return missing.length > 0 ? `нужно: ${requirementsText(missing)}` : null;
      })(),
    });
  }
  return {
    key: tech,
    label: SYNDICATE_TECH_LABELS[tech],
    description: SYNDICATE_TECH_EFFECTS[tech],
    level: current,
    effectLabel: 'эффект',
    rows,
  };
}

/* ------------------------- Требования ------------------------- */

/**
 * Что уже построено и изучено в синдикате — по этому решаются требования.
 *
 * Уровней Брам здесь нет: врата у каждой системы свои, и требования на них
 * ставятся по Кошу и технологиям, а не по соседним вратам.
 */
export interface SyndicateProgress {
  kish: number;
  treasury: number;
  academy: number;
  watch: number;
  techs: SyndicateTechLevels;
}

export type SyndicateUnlock = SyndicateModule | SyndicateTech;

export interface SyndicateRequirement {
  key: Exclude<SyndicateUnlock, 'BRAMA'>;
  level: number;
}

/**
 * Что нужно, чтобы взять уровень модуля или технологии.
 *
 * Цепь сходится к Браме — самой сильной постройке синдиката: без нее
 * расстояния значат столько, сколько задумано, а с ней флот ходит между
 * системами без «Гипердвигателя». Поэтому врата стоят на вершине дерева
 * и требуют почти всего остального: большого Коша с защищенной казной,
 * Академии третьего уровня, Дозора, который увидит поток кораблей,
 * «Обозных трюмов» под логистику и «Инженерного корпуса», которым врата
 * и строятся, — а он сам тянет за собой артель и добычу.
 *
 * Остальные связи — по смыслу, а не для счета:
 *   - Кіш растет вместе со Скарбницей: больше состав — больше казна,
 *     и держать ее без защиты значит звать налетчиков;
 *   - Скарбниця и Академия растут вместе с Кошем, на половину его шага;
 *   - Дозор выше первого уровня стоит на «Контрразведке», а та — на Дозоре:
 *     наблюдение и его защита растут парой, по полшага друг за другом;
 *   - «Тайники» — ремесло Скарбници, артель выходит из разработки недр,
 *     инженеры — из артели, трюмы — из торговых связей.
 *
 * Академия остается потолком любой технологии: это требование того же вида,
 * что и прочие, и отдельной проверки у изучения больше нет.
 *
 * Циклов в цепи нет, и это проверяется тестом: каждое требование ведет
 * к уровню ниже или к модулю, который сам от требующего не зависит.
 * Уже взятые уровни требованиями не отнимаются — действуют они на стройку
 * следующего, а не на то, что синдикат успел построить до цепи.
 */
export function syndicateRequirements(target: SyndicateUnlock, level: number): SyndicateRequirement[] {
  const n = Math.max(1, Math.floor(level));
  const need = (key: SyndicateRequirement['key'], required: number): SyndicateRequirement[] =>
    required > 0 ? [{ key, level: required }] : [];

  switch (target) {
    case 'KISH':
      return need('SKARBNYTSIA', n - 2);
    case 'SKARBNYTSIA':
    case 'AKADEMIIA':
      return need('KISH', Math.ceil(n / 2) + 1);
    case 'DOZOR':
      return [...need('KISH', 2), ...need('COUNTERINTEL', n - 1)];
    case 'BRAMA':
      return [
        ...need('KISH', 4),
        ...need('AKADEMIIA', 3),
        ...need('SKARBNYTSIA', 2),
        ...need('DOZOR', n),
        ...need('CARGO', 2),
        ...need('ENGINEERING', n + 2),
      ];
    case 'MINING':
    case 'TRADE':
      return need('AKADEMIIA', n);
    case 'CARGO':
      return [...need('AKADEMIIA', n), ...need('TRADE', n - 1)];
    case 'CONSTRUCTION':
      return [...need('AKADEMIIA', n), ...need('MINING', n)];
    case 'ENGINEERING':
      return [...need('AKADEMIIA', n), ...need('CONSTRUCTION', n)];
    case 'VAULT':
      return [...need('AKADEMIIA', n), ...need('SKARBNYTSIA', n)];
    case 'COUNTERINTEL':
      return [...need('AKADEMIIA', n), ...need('DOZOR', Math.ceil(n / 2))];
  }
}

export function progressLevel(progress: SyndicateProgress, key: SyndicateRequirement['key']): number {
  switch (key) {
    case 'KISH':
      return progress.kish;
    case 'SKARBNYTSIA':
      return progress.treasury;
    case 'AKADEMIIA':
      return progress.academy;
    case 'DOZOR':
      return progress.watch;
    default:
      return progress.techs[key];
  }
}

/** Чего не хватает прямо сейчас, чтобы взять уровень. Пусто — можно брать. */
export function missingSyndicateRequirements(
  target: SyndicateUnlock,
  level: number,
  progress: SyndicateProgress,
): SyndicateRequirement[] {
  return syndicateRequirements(target, level).filter((req) => progressLevel(progress, req.key) < req.level);
}

export function syndicateUnlockLabel(key: SyndicateUnlock): string {
  return isSyndicateTech(key) ? SYNDICATE_TECH_LABELS[key] : syndicateModuleLabel(key);
}

/** «Кіш ур. 4, Академия ур. 3» — одна строка на карточку и в отказ сервера. */
export function requirementsText(list: readonly SyndicateRequirement[]): string | null {
  return list.length > 0 ? list.map((req) => `${syndicateUnlockLabel(req.key)} ур. ${req.level}`).join(', ') : null;
}

/**
 * Требование в том виде, в каком его показывает карточка: так же, как у построек
 * и технологий колонии, — ключ, подпись и уровень. Карточка рисует их одним
 * и тем же компонентом, и синдикатное дерево читается ровно как колониальное.
 */
export interface SyndicateRequirementView {
  key: SyndicateRequirement['key'];
  label: string;
  level: number;
}

export function requirementViews(list: readonly SyndicateRequirement[]): SyndicateRequirementView[] {
  return list.map((req) => ({ key: req.key, label: syndicateUnlockLabel(req.key), level: req.level }));
}

/** Картина синдиката для требований — из строки синдиката и уровней технологий. */
export function syndicateProgress(
  row: { kishLevel: number; treasuryLevel: number; academyLevel: number; watchLevel: number },
  techs: SyndicateTechLevels,
): SyndicateProgress {
  return { kish: row.kishLevel, treasury: row.treasuryLevel, academy: row.academyLevel, watch: row.watchLevel, techs };
}
