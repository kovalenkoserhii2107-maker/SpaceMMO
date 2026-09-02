/**
 * План бота, написанный языковой моделью, и его проверка.
 *
 * Ответ модели — недоверенные данные ровно в том же смысле, в каком ими
 * являются снимки разведки и нагрузка писем (правила 8 и 9): он приходит
 * извне, переживает изменения игры и может содержать что угодно. Поэтому
 * наружу отсюда выходит не то, что написала модель, а то, что прошло проверку:
 * неизвестные названия отброшены, числа зажаты в диапазон, доли сведены
 * к единице.
 *
 * Модель не может выдумать себе ресурсы или уровни: она пишет только
 * приоритеты, а цены, сроки и бой остаются на сервере (правило 3). Худшее,
 * что может сделать испорченный план, — заставить бота играть глупо.
 */
import { DEFENSE_TYPES, type DefenseType } from '../defenses.js';
import { SHIP_TYPES, type ShipType } from '../ships.js';
import { TECHNOLOGY_TYPES, type TechnologyType } from '../techTree.js';
import { personality, type BotCharacter, type BotPersonality } from './personality.js';

/** Что модели позволено менять. Остальное в профиле характера неприкосновенно. */
export interface BotPlan {
  budget: BotPersonality['budget'];
  researchOrder: TechnologyType[];
  fleetMix: Partial<Record<ShipType, number>>;
  defenseMix: Partial<Record<DefenseType, number>>;
  colonyAmbition: number;
  raidAdvantage: number;
  /** Одна фраза о замысле — она уходит в пульт, чтобы было видно, чем бот занят. */
  note: string;
}

/** Сохраненный план с отметкой времени: по ней решается, пора ли обновлять. */
export interface StoredPlan {
  plan: BotPlan;
  madeAt: number;
}

/** Как часто бот переосмысливает стратегию. */
export const PLAN_TTL_MS = 6 * 3600_000;

function clamp(value: unknown, min: number, max: number, fallback: number): number {
  // Number() здесь не годится: он молча превращает null и пустую строку в ноль
  // (правило 13), а ноль в долях бюджета — это осмысленное значение, и отличить
  // «модель написала 0» от «модель не написала ничего» стало бы нечем.
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

/**
 * Доли бюджета: каждая зажата, затем все вместе сведены к единице.
 *
 * Нормировка обязательна. Доли сравниваются с портфелем вложенного, и сумма
 * больше единицы означала бы, что каждое направление считает себя
 * недофинансированным всегда, — бот тратил бы все подряд и не копил ни на что.
 */
function normalizeBudget(raw: unknown, fallback: BotPersonality['budget']): BotPersonality['budget'] {
  const source = (raw ?? {}) as Record<string, unknown>;
  const budget = {
    economy: clamp(source['economy'], 0.05, 0.8, fallback.economy),
    research: clamp(source['research'], 0.05, 0.5, fallback.research),
    fleet: clamp(source['fleet'], 0, 0.7, fallback.fleet),
    defense: clamp(source['defense'], 0, 0.5, fallback.defense),
  };

  const total = budget.economy + budget.research + budget.fleet + budget.defense;
  if (total <= 0) return fallback;

  return {
    economy: budget.economy / total,
    research: budget.research / total,
    fleet: budget.fleet / total,
    defense: budget.defense / total,
  };
}

/** Список названий: неизвестные отбрасываются, повторы схлопываются. */
function knownList<T extends string>(raw: unknown, allowed: readonly T[], fallback: T[]): T[] {
  if (!Array.isArray(raw)) return fallback;
  const seen = new Set<T>();
  for (const item of raw) {
    if (typeof item === 'string' && (allowed as readonly string[]).includes(item)) seen.add(item as T);
  }
  // Пустой список означал бы, что бот перестанет исследовать вовсе,
  // поэтому от плана без единого узнанного названия отказываемся целиком.
  return seen.size > 0 ? [...seen] : fallback;
}

/**
 * Состав по долям: только известные классы, только положительные веса.
 *
 * Нормировать здесь не нужно — `laggingShip` сравнивает доли между собой,
 * а не с единицей, — но пустой состав означал бы «не строить ничего»,
 * и от такого плана мы отказываемся.
 */
function knownMix<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  fallback: Partial<Record<T, number>>,
): Partial<Record<T, number>> {
  if (typeof raw !== 'object' || raw === null) return fallback;
  const source = raw as Record<string, unknown>;
  const mix: Partial<Record<T, number>> = {};

  for (const key of allowed) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) mix[key] = value;
  }

  return Object.keys(mix).length > 0 ? mix : fallback;
}

/**
 * Разобрать ответ модели в план. null — плану верить нельзя, играем по характеру.
 */
export function parsePlan(raw: unknown, character: BotCharacter): BotPlan | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const base = personality(character);

  const note = typeof source['note'] === 'string' ? source['note'].trim().slice(0, 200) : '';

  return {
    budget: normalizeBudget(source['budget'], base.budget),
    researchOrder: knownList(source['researchOrder'], TECHNOLOGY_TYPES, base.researchOrder),
    fleetMix: knownMix(source['fleetMix'], SHIP_TYPES, base.fleetMix),
    defenseMix: knownMix(source['defenseMix'], DEFENSE_TYPES, base.defenseMix),
    // Потолок амбиций жесткий: слоты колоний все равно ограничены астрофизикой,
    // но без него модель могла бы написать тысячу и заставить бота копить
    // колониальные корабли вместо развития.
    colonyAmbition: Math.round(clamp(source['colonyAmbition'], 0, 12, base.colonyAmbition)),
    // Перевес меньше единицы означает «лети на заведомо более сильного»:
    // это не смелость, а слив флота, который бот копил неделю.
    raidAdvantage: clamp(source['raidAdvantage'], 1, 10, base.raidAdvantage),
    note,
  };
}

/** Профиль характера, поверх которого наложен план. */
export function withPlan(character: BotCharacter, plan: BotPlan | null): BotPersonality {
  const base = personality(character);
  if (!plan) return base;

  return {
    ...base,
    budget: plan.budget,
    researchOrder: plan.researchOrder,
    fleetMix: plan.fleetMix,
    defenseMix: plan.defenseMix,
    colonyAmbition: plan.colonyAmbition,
    raidAdvantage: plan.raidAdvantage,
  };
}

/** Прочитать план из `Bot.memory`: он лежит в БД и переживает изменения игры. */
export function readStoredPlan(memory: unknown, character: BotCharacter): StoredPlan | null {
  if (typeof memory !== 'object' || memory === null) return null;
  const source = (memory as Record<string, unknown>)['plan'];
  const madeAt = (memory as Record<string, unknown>)['planMadeAt'];
  if (typeof madeAt !== 'number') return null;

  const plan = parsePlan(source, character);
  return plan ? { plan, madeAt } : null;
}
