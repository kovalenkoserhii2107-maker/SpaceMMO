/**
 * Характеры ботов: чем один бот отличается от другого.
 *
 * Профиль — это только числа и списки приоритетов. Решения по ним принимает
 * `decide.ts`, а исполняет `director.ts`. Разделение нужно, чтобы добавление
 * нового характера («промышленник», «пират») было правкой одной таблицы,
 * а не новой веткой в логике решений.
 *
 * Ни одного игрового правила здесь нет: цены, время и требования бот берет
 * из тех же модулей, что и живой игрок.
 */
import type { BuildingType } from '../rules.js';
import type { DefenseType } from '../defenses.js';
import type { ShipType } from '../ships.js';
import type { TechnologyType } from '../techTree.js';

export const BOT_CHARACTERS = ['AGGRESSOR', 'TRADER'] as const;
export type BotCharacter = (typeof BOT_CHARACTERS)[number];

export function isBotCharacter(value: unknown): value is BotCharacter {
  return typeof value === 'string' && (BOT_CHARACTERS as readonly string[]).includes(value);
}

export interface BotPersonality {
  label: string;
  description: string;

  /**
   * Доли дохода по направлениям. Сумма единица — это не бюджет в ресурсах,
   * а приоритет: бот сравнивает, чего он недобрал относительно этих долей,
   * и тратит на самое отстающее направление.
   */
  budget: {
    economy: number;
    research: number;
    fleet: number;
    defense: number;
  };

  /**
   * Порядок веток науки. Бот берет первую доступную технологию из списка,
   * а не самую дешевую: иначе он вечно качал бы дешевую энергетику и никогда
   * не доходил до ворот, за которыми стоят корабли.
   */
  researchOrder: TechnologyType[];

  /** Какие здания бот тянет выше прочих сверх общей экономической базы. */
  buildingFocus: BuildingType[];

  /**
   * Состав ударного кулака: доли по классам. Бот строит недостающее
   * относительно этих долей, поэтому эскадра растет пропорционально,
   * а не одним классом до упора.
   */
  fleetMix: Partial<Record<ShipType, number>>;

  /** Состав обороны, теми же долями. */
  defenseMix: Partial<Record<DefenseType, number>>;

  /** Сколько колоний бот стремится держать сверх столицы. */
  colonyAmbition: number;

  /** Атакует ли бот по своей инициативе. Ответ на агрессию есть у всех. */
  raids: boolean;

  /**
   * Во сколько раз оценка своего флота должна превосходить оценку целей,
   * чтобы бот полетел. Меньше — рискованнее.
   */
  raidAdvantage: number;

  /** Торгует ли бот на бирже и насколько активно (доля свободного склада). */
  trade: {
    active: boolean;
    /** Какую долю запаса сверх собственных нужд бот выставляет на продажу. */
    sellShare: number;
    /**
     * Насколько бот отступает от справочной цены. Продает дороже,
     * покупает дешевле — на эту долю.
     */
    margin: number;
  };
}

/**
 * Профили характеров.
 *
 * Числа подобраны так, чтобы боты не были копиями друг друга: агрессор
 * почти не строит оборону и вкладывает две трети дохода во флот, торговец
 * наоборот копит экономику и обороняется, а флот держит сдерживающий.
 */
export const BOT_PERSONALITIES: Record<BotCharacter, BotPersonality> = {
  AGGRESSOR: {
    label: 'Агрессор',
    description:
      'Цель — власть над пространством, а не набеги ради набегов. Расширяется, ' +
      'колонизирует свободное, держит сильный флот и пускает его в дело — но ' +
      'война для него средство, а не занятие. Умеет остановиться, замириться ' +
      'и копить силы, когда драка перестала окупаться.',
    /*
     * Половина дохода во флот выглядела логично для агрессора, но съедала его
     * же экономику: с долей 0.5 бот за неделю доходил до двенадцатого уровня
     * шахт вместо восемнадцатого и вставал. Треть — тот предел, за которым
     * флот начинает мешать его собственному росту.
     */
    /*
     * Оборона поднята с 0.05, экономика с 0.4.
     *
     * Живой агрессор вел войну шестьюдесятью одним набегом подряд, сжег весь
     * ударный флот — пятьдесят три истребителя из пятидесяти трех — и остался
     * с двадцатью пушками при двух с лишним сотнях тысяч на счету. Флот,
     * который не на что восстановить, и база, которую нечем прикрыть, — это
     * не агрессия, а разгон до первого встречного.
     */
    budget: { economy: 0.42, research: 0.2, fleet: 0.28, defense: 0.1 },
    // Ворота под корабли и под слоты колоний: без астрофизики экспансия встанет,
    // без двигателей и оружия флот не полетит и не выстрелит.
    researchOrder: [
      'ENERGY_TECH',
      'COMBUSTION_DRIVE',
      'WEAPONS_TECH',
      // Без «Шпионажа» разведка не показывает чужой флот, и агрессор
      // выбирает цель вслепую — по одной обороне.
      'ESPIONAGE',
      'ASTROPHYSICS',
      'SHIELDS_TECH',
      'ARMOR_TECH',
      'HYPERSPACE_PHYSICS',
      'COMPUTING_TECH',
      'HYPERDRIVE',
      'ROBOTICS',
      'MINING_TECH',
    ],
    buildingFocus: ['SHIPYARD', 'SCIENCE_CENTER'],
    fleetMix: {
      LIGHT_FIGHTER: 0.3,
      HEAVY_FIGHTER: 0.2,
      CRUISER: 0.25,
      FRIGATE: 0.1,
      BOMBER: 0.08,
      BATTLESHIP: 0.05,
      LARGE_CARGO: 0.02,
    },
    defenseMix: { CANNON: 0.7, LASER: 0.3 },
    colonyAmbition: 6,
    raids: true,
    raidAdvantage: 1.6,
    trade: { active: true, sellShare: 0.3, margin: 0.12 },
  },

  TRADER: {
    label: 'Торговец',
    description:
      'Цель — капитал и неприступность. Держит обе стороны стакана, тянет добычу ' +
      'и склад, строит плотную оборону и сдерживающий флот. Первым не нападает.',
    budget: { economy: 0.45, research: 0.2, fleet: 0.15, defense: 0.2 },
    // Экономические ветки вперед: у торговца доход и есть основное оружие.
    researchOrder: [
      'ENERGY_TECH',
      'MINING_TECH',
      'COMPUTING_TECH',
      'ROBOTICS',
      'COMBUSTION_DRIVE',
      'SHIELDS_TECH',
      'ARMOR_TECH',
      // Торговцу «Шпионаж» нужен как контрразведка: разницу уровней читают
      // с обеих сторон, и отставший показывает соседям свой склад целиком.
      'ESPIONAGE',
      'WEAPONS_TECH',
      'ASTROPHYSICS',
      'HYPERSPACE_PHYSICS',
      'HYPERDRIVE',
    ],
    /*
     * Складов в списке нет нарочно: их ведут отдельные правила, по факту
     * заполнения и по отставанию от добычи. Продублированные здесь, они
     * лезли вперед лаборатории и верфи в первые же часы — прогон месяца
     * показал первый истребитель на шестом часу вместо первого.
     *
     * Отличие торговца от агрессора живет не в списке зданий, а в долях
     * бюджета, составе обороны и запрете нападать первым.
     */
    buildingFocus: ['SCIENCE_CENTER', 'SHIPYARD'],
    fleetMix: {
      LARGE_CARGO: 0.3,
      SMALL_CARGO: 0.1,
      HEAVY_FIGHTER: 0.2,
      CRUISER: 0.25,
      FRIGATE: 0.15,
    },
    defenseMix: { CANNON: 0.4, LASER: 0.35, GAUSS: 0.25 },
    colonyAmbition: 2,
    raids: false,
    raidAdvantage: 2.5,
    trade: { active: true, sellShare: 0.6, margin: 0.06 },
  },
};

export function personality(character: BotCharacter): BotPersonality {
  return BOT_PERSONALITIES[character];
}

export function botCharacterLabel(character: BotCharacter): string {
  return BOT_PERSONALITIES[character].label;
}

/**
 * Щит новичка: бот не трогает командиров младше этого срока.
 *
 * Бот ищет цели со скоростью машины и разграбил бы новичка в первые же сутки —
 * ровно тогда, когда игрок еще не понял правил и терять ему обиднее всего.
 */
export const NEWBIE_SHIELD_DAYS = 3;

/**
 * Пауза между решениями одного бота.
 *
 * Раз в тик боту думать незачем: его действия — стройка, наука и полеты —
 * меряются минутами и часами. Разброс нужен, чтобы боты не ходили строем
 * и не создавали пик нагрузки в одну секунду.
 */
export const DECISION_INTERVAL_MS = 45_000;
export const DECISION_JITTER_MS = 20_000;
