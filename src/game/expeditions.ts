/**
 * Экспедиции в глубокий космос (Этап 7).
 *
 * Модуль чистый: событие определяется броском кубика, но генератор случайных
 * чисел передается снаружи. Благодаря этому исход можно зафиксировать в тестах,
 * подсунув предсказуемый rng, а в игре используется обычный Math.random.
 */
import { emptyDefenseCounts } from './defenses.js';
import { resolveBattle, type BattleOutcome } from './combat.js';
import { emptyShipCounts, shipLabel, SHIP_TYPES, type ShipCounts } from './ships.js';
import type { TechLevels } from './techTree.js';

/** Абстрактная «16-я позиция» системы — точка выхода в глубокий космос. */
export const DEEP_SPACE_POSITION = 16;

export type ExpeditionOutcome = 'SILENCE' | 'RESOURCES' | 'PIRATES_WON' | 'PIRATES_LOST' | 'EVADED';

export type Rng = () => number;

/**
 * Сколько экспедиций игрок может держать в полете одновременно.
 * Классическая формула: 1 уровень — 1 экспедиция, 4 — 2, 9 — 3.
 */
export function expeditionSlots(techs: TechLevels): number {
  return Math.floor(Math.sqrt(Math.max(0, techs.ASTROPHYSICS)));
}

export function canExplore(techs: TechLevels): boolean {
  return expeditionSlots(techs) > 0;
}

export interface ExpeditionResult {
  outcome: ExpeditionOutcome;
  /** Найденные ресурсы; металл и кристаллы занимают трюмы. */
  loot: { metal: number; crystal: number; antimatter: number };
  /** Состав пиратов, если была засада. */
  pirates: ShipCounts | null;
  /** Результат боя с пиратами. */
  battle: BattleOutcome | null;
  /** Корабли, которые вернутся домой. */
  survivors: ShipCounts;
  /** Готовый текст отчета для игрока. */
  summary: string;
}

/** Веса событий. Астрофизика уменьшает пустые вылеты и снижает риск засады. */
function outcomeWeights(level: number): Array<[('SILENCE' | 'RESOURCES' | 'PIRATES'), number]> {
  return [
    ['SILENCE', Math.max(15, 40 - level * 2)],
    ['RESOURCES', 35 + level * 3],
    ['PIRATES', Math.max(12, 25 - level)],
  ];
}

function rollWeighted<T extends string>(entries: Array<[T, number]>, rng: Rng): T {
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;

  for (const [key, weight] of entries) {
    roll -= weight;
    if (roll <= 0) return key;
  }
  return entries[entries.length - 1]![0];
}

function randomBetween(min: number, max: number, rng: Rng): number {
  return min + rng() * (max - min);
}

/**
 * Главный бросок кубика. Возвращает и механический результат, и готовый текст,
 * чтобы отчет в интерфейсе и данные в БД не разъезжались.
 *
 * @param ships состав отправленного флота
 * @param capacity свободное место в трюмах — потолок находки
 * @param techs технологии игрока: астрофизика влияет на все исходы
 */
export function resolveExpedition(
  ships: ShipCounts,
  capacity: number,
  techs: TechLevels,
  rng: Rng = Math.random,
): ExpeditionResult {
  const level = Math.max(0, techs.ASTROPHYSICS);
  const event = rollWeighted(outcomeWeights(level), rng);

  if (event === 'SILENCE') {
    return {
      outcome: 'SILENCE',
      loot: { metal: 0, crystal: 0, antimatter: 0 },
      pirates: null,
      battle: null,
      survivors: { ...ships },
      summary: 'Мертвая тишина. Сканеры не зацепились ни за что — флот разворачивается домой.',
    };
  }

  if (event === 'RESOURCES') {
    return resolveFind(ships, capacity, level, rng);
  }

  return resolveAmbush(ships, capacity, level, rng);
}

/** Заброшенный груз: объем находки ограничен трюмами и растет от астрофизики. */
function resolveFind(ships: ShipCounts, capacity: number, level: number, rng: Rng): ExpeditionResult {
  const kind = rollWeighted(
    [
      ['METAL', 50],
      ['CRYSTAL', 35],
      ['ANTIMATTER', 15 + level],
    ] as Array<['METAL' | 'CRYSTAL' | 'ANTIMATTER', number]>,
    rng,
  );

  const loot = { metal: 0, crystal: 0, antimatter: 0 };
  const share = randomBetween(0.15, 0.45, rng) * (1 + level * 0.05);

  if (kind === 'ANTIMATTER') {
    // Антиматерия едет в баках: находка мелкая, но ценная.
    loot.antimatter = Math.max(1, Math.floor(capacity * 0.01 * (1 + level * 0.1)));
    return {
      outcome: 'RESOURCES',
      loot,
      pirates: null,
      battle: null,
      survivors: { ...ships },
      summary: `В обломках неизвестного корабля нашли контейнер с антиматерией: ${loot.antimatter}.`,
    };
  }

  const amount = Math.floor(Math.min(capacity, capacity * share));
  if (kind === 'METAL') loot.metal = amount;
  else loot.crystal = amount;

  return {
    outcome: 'RESOURCES',
    loot,
    pirates: null,
    battle: null,
    survivors: { ...ships },
    summary:
      amount > 0
        ? `Заброшенный груз: подняли на борт ${amount} ${kind === 'METAL' ? 'металла' : 'кристаллов'}.`
        : 'Нашли брошенный контейнер, но трюмы забиты — взять нечего.',
  };
}

/** Засада пиратов: сначала шанс уйти, затем бой уже написанным боевым модулем. */
function resolveAmbush(ships: ShipCounts, capacity: number, level: number, rng: Rng): ExpeditionResult {
  // Астрофизика дает шанс заметить засаду заранее и уйти.
  const evadeChance = Math.min(0.5, level * 0.05);
  if (rng() < evadeChance) {
    return {
      outcome: 'EVADED',
      loot: { metal: 0, crystal: 0, antimatter: 0 },
      pirates: null,
      battle: null,
      survivors: { ...ships },
      summary: 'Датчики засекли засаду заранее — флот обошел пиратов стороной и возвращается.',
    };
  }

  const pirates = generatePirates(ships, level, rng);
  const battle = resolveBattle(
    { ships, defenses: emptyDefenseCounts() },
    { ships: pirates, defenses: emptyDefenseCounts() },
  );

  if (battle.winner === 'DEFENDER') {
    return {
      outcome: 'PIRATES_LOST',
      loot: { metal: 0, crystal: 0, antimatter: 0 },
      pirates,
      battle,
      survivors: emptyShipCounts(),
      summary:
        `Засада пиратов (${describePirates(pirates)}). ` +
        'Флот уничтожен полностью — связь потеряна.',
    };
  }

  // Победа: трофеи из пиратских трюмов, но не больше свободного места.
  const trophy = Math.floor(Math.min(capacity * 0.2, capacity));
  return {
    outcome: 'PIRATES_WON',
    loot: { metal: trophy, crystal: 0, antimatter: 0 },
    pirates,
    battle,
    survivors: { ...battle.attackerSurvivors },
    summary:
      `Засада пиратов отбита (${describePirates(pirates)}). ` +
      `Из трюмов противника подняли ${trophy} металла.`,
  };
}

/**
 * Пираты подбираются под силу игрока, иначе экспедиции были бы либо
 * бессмысленно опасными на старте, либо бесплатными в конце игры.
 * Астрофизика снижает силу засады: опытный штурман выбирает маршруты безопаснее.
 */
function generatePirates(ships: ShipCounts, level: number, rng: Rng): ShipCounts {
  const playerFighters =
    ships.LIGHT_FIGHTER +
    Math.floor(ships.TRANSPORTER / 2) +
    ships.HEAVY_CRUISER * 3 +
    ships.ION_FRIGATE * 2;
  const scale = randomBetween(0.4, 1.1, rng) * Math.max(0.4, 1 - level * 0.05);

  const pirates = emptyShipCounts();
  pirates.LIGHT_FIGHTER = Math.max(1, Math.round(playerFighters * scale));
  pirates.TRANSPORTER = Math.floor(pirates.LIGHT_FIGHTER * randomBetween(0, 0.4, rng));
  // Серьезный флот встречает и серьезную засаду: у пиратов появляются крейсера.
  if (playerFighters > 12) {
    pirates.HEAVY_CRUISER = Math.max(1, Math.round(playerFighters * scale * 0.15));
  }
  return pirates;
}

function describePirates(pirates: ShipCounts): string {
  return SHIP_TYPES.filter((type) => pirates[type] > 0)
    .map((type) => `${shipLabel(type)}: ${pirates[type]}`)
    .join(', ');
}

export function fleetIsEmpty(ships: ShipCounts): boolean {
  return SHIP_TYPES.every((type) => ships[type] <= 0);
}
