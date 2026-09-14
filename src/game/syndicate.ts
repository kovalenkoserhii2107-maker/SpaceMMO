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
 * Цена уровня Коша удваивается. Второй уровень — 25 тысяч: столько синдикат
 * из трех активных игроков собирает за вечер, и первое расширение не должно
 * быть стеной. Десятый уровень (двенадцать участников) — уже 6.4 миллиона,
 * заметная доля денежной массы сервера: большой синдикат оплачивает свой
 * размер, и это же работает стоком криптогривны.
 */
export const KISH_UPGRADE_BASE = 25_000;
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
export const WATCH_UPGRADE_BASE = 20_000;

export function watchRadius(level: number): number {
  if (level <= 0) return -1;
  return WATCH_RADIUS_STEP * (Math.floor(level) - 1);
}

export function isWatched(level: number, distanceFromKish: number): boolean {
  return level > 0 && distanceFromKish <= watchRadius(level);
}

/** Первый уровень — 20 тысяч, дальше удваивается, как у Коша. */
export function watchUpgradeCost(targetLevel: number): number {
  if (targetLevel <= 0) return 0;
  return Math.round(WATCH_UPGRADE_BASE * Math.pow(2, targetLevel - 1));
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
