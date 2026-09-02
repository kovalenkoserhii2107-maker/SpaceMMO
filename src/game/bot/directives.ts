/**
 * Директивы: разовые решения, которые принимает языковая модель.
 *
 * План задает курс — доли бюджета, порядок науки, приоритеты застройки.
 * Директива это поступок: лететь на эту цель, помириться с этим игроком,
 * выставить такую заявку, написать такое письмо. Рутину код ведет сам,
 * а сюда попадает то, где нужна оценка обстановки, а не расчет.
 *
 * Главное свойство проверки: **модель может распорядиться только тем, что ей
 * показали**. Планета, которой не было в сводке, игрок, которого не называли, —
 * отбрасываются. Это снимает целый класс проблем: выдуманная цель не доедет
 * до боя, потому что ее не с чем сопоставить.
 *
 * Директива — просьба, а не исполнение. Выполняет ее тот же Game Loop,
 * что обслуживает живого игрока, поэтому все правила остаются в силе: ресурсы
 * списываются, требования проверяются, бой считается движком. Худшее, что может
 * сделать модель, — принять плохое решение по правилам.
 */
import { STORED_RESOURCES } from '../rules.js';
import type { BotSnapshot } from './decide.js';

export type TradeResource = 'ORE' | 'POLYMERS';

export type BotDirective =
  /** Набег на разведанную цель. Состав собирает код — модель выбирает жертву. */
  | { kind: 'ATTACK'; planetId: string; why: string }
  /** Мир с игроком: войну объявляет и отменяет тоже она. */
  | { kind: 'PEACE'; commanderId: string; why: string }
  | { kind: 'SELL'; resource: TradeResource; amount: number; price: number; why: string }
  /**
   * Снять свои заявки по ресурсу.
   *
   * Без этого торговля упирается в потолок открытых заявок: на пустом рынке
   * ничего не исполняется, пять заявок висят, и цену уже не поменять.
   */
  | { kind: 'CANCEL'; resource: TradeResource; why: string }
  | { kind: 'BUY'; resource: TradeResource; amount: number; price: number; why: string }
  | { kind: 'COLONIZE'; planetId: string; why: string }
  /** Сбор поля обломков над планетой. */
  | { kind: 'HARVEST'; planetId: string; why: string }
  /** Письмо живому игроку по собственному почину. */
  | { kind: 'MESSAGE'; commanderId: string; subject: string; body: string; why: string };

/** Сколько поручений принимаем за один заход: список — не поток сознания. */
const MAX_DIRECTIVES = 4;

function text(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.trim().slice(0, limit) : '';
}

function positive(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.floor(value), max);
}

function resource(value: unknown): TradeResource | null {
  return value === 'ORE' || value === 'POLYMERS' ? value : null;
}

/**
 * Разобрать ответ модели в список поручений.
 *
 * Все, что не сходится со снимком, отбрасывается молча: модель могла
 * ошибиться в имени, а могла и выдумать его целиком — для нас это одно и то же.
 */
export function parseDirectives(raw: unknown, snapshot: BotSnapshot): BotDirective[] {
  if (!Array.isArray(raw)) return [];

  // Что боту вообще показывали — по этим спискам и сверяемся.
  const scouted = new Set(snapshot.raidTargets.map((target) => target.planetId));
  const free = new Set(snapshot.freePlanets.map((planet) => planet.planetId));
  const debris = new Set(snapshot.debrisFields.map((field) => field.planetId));
  const known = new Set(snapshot.raidTargets.map((target) => target.commanderId));

  const out: BotDirective[] = [];
  for (const item of raw) {
    if (out.length >= MAX_DIRECTIVES) break;
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    const why = text(row['why'], 120);

    switch (row['kind']) {
      case 'ATTACK': {
        const planetId = text(row['planetId'], 64);
        // Только разведанная цель: вслепую бот не летает и с директивой тоже.
        if (scouted.has(planetId)) out.push({ kind: 'ATTACK', planetId, why });
        break;
      }
      case 'PEACE': {
        const commanderId = text(row['commanderId'], 64);
        if (known.has(commanderId)) out.push({ kind: 'PEACE', commanderId, why });
        break;
      }
      case 'COLONIZE': {
        const planetId = text(row['planetId'], 64);
        if (free.has(planetId)) out.push({ kind: 'COLONIZE', planetId, why });
        break;
      }
      case 'HARVEST': {
        const planetId = text(row['planetId'], 64);
        if (debris.has(planetId)) out.push({ kind: 'HARVEST', planetId, why });
        break;
      }
      case 'SELL':
      case 'BUY': {
        const res = resource(row['resource']);
        const amount = positive(row['amount'], 10_000_000);
        const price = positive(row['price'], 100_000);
        if (res && amount > 0 && price > 0) {
          out.push({ kind: row['kind'] === 'SELL' ? 'SELL' : 'BUY', resource: res, amount, price, why });
        }
        break;
      }
      case 'CANCEL': {
        const res = resource(row['resource']);
        if (res) out.push({ kind: 'CANCEL', resource: res, why });
        break;
      }
      case 'MESSAGE': {
        const commanderId = text(row['commanderId'], 64);
        const subject = text(row['subject'], 80);
        const body = text(row['body'], 600);
        if (known.has(commanderId) && subject && body) {
          out.push({ kind: 'MESSAGE', commanderId, subject, body, why });
        }
        break;
      }
      default:
        break;
    }
  }

  return out;
}

/**
 * Безнадежен ли набег.
 *
 * Модели позволено рисковать — игрок тоже рискует, и бот, который никогда
 * не проигрывает, выглядит машиной. Но пол есть: лететь без флота или
 * на цель, которая сильнее в разы, — это не смелость, а подарок противнику.
 */
export const HOPELESS_RATIO = 3;

export function hopeless(ownFleetValue: number, targetStrength: number | null): boolean {
  if (ownFleetValue <= 0) return true;
  if (targetStrength === null) return true;
  return targetStrength > ownFleetValue * HOPELESS_RATIO;
}

/** Ресурсы, которыми торгует биржа. Плазма в стакан не попадает. */
export const TRADED: readonly TradeResource[] = ['ORE', 'POLYMERS'];
export { STORED_RESOURCES };
