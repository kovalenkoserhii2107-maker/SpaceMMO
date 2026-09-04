/**
 * Дерево технологий. Технологии общие для игрока, изучаются в лаборатории.
 * Модуль чистый: только определения и формулы.
 */
import {
  NEUTRAL_MODIFIERS,
  type BuildingLevels,
  type EconomyBonuses,
  type ResourceAmounts,
  type SystemModifiers,
} from './rules.js';

export const TECHNOLOGY_TYPES = [
  'ENERGY_TECH',
  'COMPUTING_TECH',
  'WEAPONS_TECH',
  'SHIELDS_TECH',
  'ARMOR_TECH',
  'MINING_TECH',
  'COMBUSTION_DRIVE',
  'HYPERSPACE_PHYSICS',
  'HYPERDRIVE',
  'ASTROPHYSICS',
  'ROBOTICS',
  'CRYPTO_TECH',
  'VAULT_TECH',
  'ESPIONAGE',
  'TIME_COMPRESSION',
] as const;

export type TechnologyType = (typeof TECHNOLOGY_TYPES)[number];

export type TechLevels = Record<TechnologyType, number>;

export function isTechnologyType(value: unknown): value is TechnologyType {
  return typeof value === 'string' && (TECHNOLOGY_TYPES as readonly string[]).includes(value);
}

export function emptyTechLevels(): TechLevels {
  return {
    ENERGY_TECH: 0,
    COMPUTING_TECH: 0,
    WEAPONS_TECH: 0,
    SHIELDS_TECH: 0,
    ARMOR_TECH: 0,
    MINING_TECH: 0,
    COMBUSTION_DRIVE: 0,
    HYPERSPACE_PHYSICS: 0,
    HYPERDRIVE: 0,
    ASTROPHYSICS: 0,
    ROBOTICS: 0,
    CRYPTO_TECH: 0,
    VAULT_TECH: 0,
    ESPIONAGE: 0,
    TIME_COMPRESSION: 0,
  };
}

interface TechDefinition {
  label: string;
  description: string;
  /** Стоимость 1 уровня и множитель роста. */
  cost: ResourceAmounts & { factor: number };
  /** Базовая длительность изучения 1 уровня в секундах и множитель роста. */
  baseSeconds: number;
  timeFactor: number;
  /** Минимальный уровень лаборатории. */
  labLevel: number;
  /** Требования по другим технологиям. */
  requires: Partial<Record<TechnologyType, number>>;
}

const TECHNOLOGIES: Record<TechnologyType, TechDefinition> = {
  ENERGY_TECH: {
    label: 'Энергетика',
    description:
      '+2% к выработке энергии базы за уровень. Открывает путь к остальным технологиям. ' +
      'На бой не влияет: щиты усиливает щитовая технология.',
    cost: { ore: 0, polymers: 380, plasma: 100, factor: 2.0 },
    baseSeconds: 90,
    timeFactor: 2.15,
    labLevel: 1,
    requires: {},
  },
  COMPUTING_TECH: {
    label: 'Вычислительная техника',
    description: '-3% к времени исследований за уровень. Нужна для постройки зондов.',
    cost: { ore: 0, polymers: 190, plasma: 75, factor: 2.0 },
    baseSeconds: 60,
    timeFactor: 2.15,
    labLevel: 1,
    requires: {},
  },
  WEAPONS_TECH: {
    label: 'Оружейная технология',
    description: '+10% к атаке всех кораблей и обороны за уровень.',
    cost: { ore: 800, polymers: 380, plasma: 0, factor: 2.0 },
    baseSeconds: 120,
    timeFactor: 2.15,
    labLevel: 2,
    requires: { ENERGY_TECH: 1 },
  },
  SHIELDS_TECH: {
    label: 'Щитовая технология',
    description: '+10% к щитам всех кораблей и обороны за уровень.',
    cost: { ore: 200, polymers: 1140, plasma: 0, factor: 2.0 },
    baseSeconds: 150,
    timeFactor: 2.15,
    labLevel: 3,
    requires: { ENERGY_TECH: 3 },
  },
  ARMOR_TECH: {
    label: 'Бронебойная технология',
    description: '+10% к корпусу всех кораблей и обороны за уровень.',
    cost: { ore: 1000, polymers: 0, plasma: 0, factor: 2.0 },
    baseSeconds: 100,
    timeFactor: 2.15,
    labLevel: 2,
    requires: { ENERGY_TECH: 2 },
  },
  CRYPTO_TECH: {
    label: 'Криптоинженерия',
    description: '+15% к добыче криптогривны на фермах за уровень.',
    cost: { ore: 400, polymers: 1140, plasma: 100, factor: 1.9 },
    baseSeconds: 120,
    timeFactor: 2.15,
    labLevel: 4,
    requires: { COMPUTING_TECH: 2 },
  },
  VAULT_TECH: {
    label: 'Бункерование',
    description:
      '+2% к несгораемой доле склада за уровень. Базовая защита — 20% вместимости; ' +
      'после 50% каждый следующий уровень обходится втрое дороже предыдущего.',
    cost: { ore: 800, polymers: 950, plasma: 150, factor: 1.7 },
    baseSeconds: 150,
    timeFactor: 2.15,
    labLevel: 3,
    requires: { COMPUTING_TECH: 1 },
  },
  ESPIONAGE: {
    label: 'Шпионаж',
    description:
      'Глаза и веки разом. Решает не уровень, а разница с уровнем противника: ' +
      'чем выше перевес, тем глубже заглядывает твой зонд и тем меньше видно ' +
      'чужой. Без нее не собрать даже зонд.',
    cost: { ore: 500, polymers: 1330, plasma: 80, factor: 1.8 },
    baseSeconds: 100,
    timeFactor: 2.15,
    labLevel: 3,
    requires: { COMPUTING_TECH: 2 },
  },
  MINING_TECH: {
    label: 'Горное дело',
    description: '+2% к добыче всех шахт за уровень.',
    cost: { ore: 200, polymers: 190, plasma: 0, factor: 1.8 },
    baseSeconds: 75,
    timeFactor: 2.15,
    labLevel: 2,
    requires: { ENERGY_TECH: 1 },
  },
  COMBUSTION_DRIVE: {
    label: 'Реактивный двигатель',
    description: 'Открывает постройку транспортников и легких истребителей.',
    cost: { ore: 100, polymers: 0, plasma: 60, factor: 1.9 },
    baseSeconds: 80,
    timeFactor: 2.15,
    labLevel: 2,
    requires: { ENERGY_TECH: 1 },
  },
  HYPERSPACE_PHYSICS: {
    label: 'Гиперпространственная физика',
    description: 'Открывает постройку синтезатора антиматерии.',
    cost: { ore: 800, polymers: 2280, plasma: 600, factor: 2.1 },
    baseSeconds: 240,
    timeFactor: 2.15,
    labLevel: 3,
    requires: { ENERGY_TECH: 2, COMPUTING_TECH: 1 },
  },
  ASTROPHYSICS: {
    label: 'Астрофизика',
    description:
      'Наука о чужих звездах. Открывает экспедиции в глубокий космос — число ' +
      'одновременных задает уровень (1 → 1, 4 → 2, 9 → 3), он же увеличивает находки ' +
      'и помогает уходить от засад. Каждые два уровня добавляют слот под колонию ' +
      '(0 → 1 база, 2 → 2, 4 → 3) и открывают постройку колониального транспорта.',
    cost: { ore: 400, polymers: 1520, plasma: 400, factor: 1.9 },
    baseSeconds: 180,
    timeFactor: 2.15,
    labLevel: 2,
    requires: { COMPUTING_TECH: 1 },
  },
  HYPERDRIVE: {
    label: 'Гипердвигатель',
    description:
      'Открывает межзвездные прыжки на антиматерии. Каждый уровень ускоряет прыжок ' +
      'и снижает расход топлива.',
    cost: { ore: 1500, polymers: 1900, plasma: 900, factor: 2.0 },
    baseSeconds: 300,
    timeFactor: 2.15,
    labLevel: 3,
    requires: { HYPERSPACE_PHYSICS: 1 },
  },
  ROBOTICS: {
    label: 'Робототехника',
    description:
      'Строительные автоматы. Каждый уровень ускоряет постройку зданий и сборку ' +
      'кораблей с обороной. На исследования не влияет — там работает лаборатория.',
    cost: { ore: 400, polymers: 380, plasma: 100, factor: 1.9 },
    baseSeconds: 120,
    timeFactor: 2.15,
    labLevel: 2,
    requires: { COMPUTING_TECH: 2 },
  },
  TIME_COMPRESSION: {
    label: 'Сжатие времени',
    description:
      'Локальное искажение хода времени над колонией. Каждый уровень вдвое сокращает ' +
      'вообще все сроки: стройку, верфь, оборону и исследования. Плата — энергия: ' +
      'каждый следующий уровень потребляет вдвое больше предыдущего, и дефицит ' +
      'бьет по добыче всей базы.',
    cost: { ore: 20000, polymers: 28500, plasma: 12000, factor: 2.4 },
    baseSeconds: 3600,
    timeFactor: 2.0,
    labLevel: 10,
    requires: { COMPUTING_TECH: 10, ENERGY_TECH: 10, HYPERSPACE_PHYSICS: 5 },
  },
};

/* ------------------------- Скорость: стройка и наука ------------------------- */

/** Прирост скорости стройки за уровень робототехники. */
const ROBOTICS_SPEED_PER_LEVEL = 0.08;

/**
 * Энергия под «Сжатие времени» на первом уровне. Дальше удваивается вместе
 * с эффектом: и выигрыш, и плата растут одинаково, поэтому уровень выше
 * окупается только тому, кто вложился в энергетику.
 */
const TIME_COMPRESSION_BASE_DRAIN = 120;

/**
 * Ускорение от робототехники. Линейное по уровню, а не степенное: степень
 * здесь сложилась бы со «Сжатием времени» и обнулила бы сроки вовсе.
 */
export function roboticsSpeedup(techs: TechLevels): number {
  return 1 + Math.max(0, techs.ROBOTICS) * ROBOTICS_SPEED_PER_LEVEL;
}

/** Во сколько раз «Сжатие времени» сокращает любой срок: каждый уровень вдвое. */
export function timeCompressionSpeedup(techs: TechLevels): number {
  return Math.pow(2, Math.max(0, techs.TIME_COMPRESSION));
}

/** Сколько энергии постоянно ест «Сжатие времени». Удваивается с уровнем. */
export function timeCompressionDrain(techs: TechLevels): number {
  const level = Math.max(0, techs.TIME_COMPRESSION);
  return level <= 0 ? 0 : TIME_COMPRESSION_BASE_DRAIN * Math.pow(2, level - 1);
}

/**
 * Общее ускорение стройки зданий, кораблей и обороны.
 * Отдельная функция, потому что зовут ее из четырех мест, и разъехавшиеся
 * формулы дали бы разное время в карточке и в очереди.
 */
export function buildSpeedup(techs: TechLevels): number {
  return roboticsSpeedup(techs) * timeCompressionSpeedup(techs);
}

export function techLabel(tech: TechnologyType): string {
  return TECHNOLOGIES[tech].label;
}

export function techDescription(tech: TechnologyType): string {
  return TECHNOLOGIES[tech].description;
}

/**
 * Уровень «Бункерования», за которым защита начинает стоить непомерно.
 *
 * Пятнадцатый: базовые 20% плюс пятнадцать раз по два дают ровно половину
 * вместимости. До этой отметки защита — обычная ветка развития, дальше
 * каждый уровень втрое дороже предыдущего сверх обычного роста. Смысл в том,
 * что склад не должен становиться абсолютной броней: полная неуязвимость
 * убивает грабеж, а с ним и повод держать флот.
 */
export const VAULT_SOFT_CAP = 15;

/** Во сколько раз дорожает каждый уровень «Бункерования» сверх мягкого предела. */
const VAULT_OVERRUN_FACTOR = 3;

export function researchCost(tech: TechnologyType, targetLevel: number): ResourceAmounts {
  const { cost } = TECHNOLOGIES[tech];
  let scale = Math.pow(cost.factor, targetLevel - 1);
  if (tech === 'VAULT_TECH' && targetLevel > VAULT_SOFT_CAP) {
    scale *= Math.pow(VAULT_OVERRUN_FACTOR, targetLevel - VAULT_SOFT_CAP);
  }
  return {
    ore: Math.floor(cost.ore * scale),
    polymers: Math.floor(cost.polymers * scale),
    plasma: Math.floor(cost.plasma * scale),
  };
}

/**
 * Длительность изучения: ускоряется уровнем лаборатории и «Вычислительной техникой»,
 * замедляется модификаторами системы (искажение времени у черной дыры).
 */
export function researchSeconds(
  tech: TechnologyType,
  targetLevel: number,
  labLevel: number,
  techs: TechLevels,
  modifiers: SystemModifiers = NEUTRAL_MODIFIERS,
): number {
  const definition = TECHNOLOGIES[tech];
  const raw = definition.baseSeconds * Math.pow(definition.timeFactor, targetLevel - 1);
  /*
   * Ускорение лаборатории ослаблено вдвое (было 0.5 за уровень). При прежнем
   * коэффициенте лаборатория восьмого давала пятикратное ускорение, и самая
   * дорогая технология десятого уровня изучалась меньше трех часов — наука
   * переставала быть воротами вовсе.
   */
  const labSpeedup = 1 + Math.max(0, labLevel) * 0.25;
  const computingSpeedup = Math.max(0.5, 1 - techs.COMPUTING_TECH * 0.03);
  // Науку ускоряет лаборатория, а не робототехника: автоматы собирают корпуса,
  // а не ставят опыты. «Сжатие времени» действует и здесь — оно гнет само время.
  return Math.max(
    5,
    Math.round(
      ((raw / labSpeedup) * computingSpeedup * modifiers.researchTimeMultiplier) /
        timeCompressionSpeedup(techs),
    ),
  );
}

export interface Requirement {
  kind: 'building' | 'tech';
  key: string;
  label: string;
  level: number;
}

/** Невыполненные требования для изучения следующего уровня технологии. */
export function missingTechRequirements(
  tech: TechnologyType,
  levels: BuildingLevels,
  techs: TechLevels,
): Requirement[] {
  const definition = TECHNOLOGIES[tech];
  const missing: Requirement[] = [];

  if (levels.SCIENCE_CENTER < definition.labLevel) {
    missing.push({
      kind: 'building',
      key: 'SCIENCE_CENTER',
      label: 'Научный центр',
      level: definition.labLevel,
    });
  }

  for (const [required, level] of Object.entries(definition.requires) as Array<[TechnologyType, number]>) {
    if (techs[required] < level) {
      missing.push({ kind: 'tech', key: required, label: TECHNOLOGIES[required].label, level });
    }
  }

  return missing;
}

/** Экономические бонусы от изученных технологий. */
/**
 * Сколько колоний командир вправе держать.
 *
 * Стартовая база есть всегда, дальше по слоту за каждые два уровня астрофизики.
 * Шаг именно в два уровня, а не квадратичный как у экспедиций: экспедиция —
 * разовый вылет, и ее слоты можно раздавать скупо, а колония остается навсегда
 * и определяет всю дальнейшую игру. Расти этот предел должен предсказуемо.
 */
export function colonySlots(techs: TechLevels): number {
  return 1 + Math.floor(Math.max(0, techs.ASTROPHYSICS) / 2);
}

/** Множитель добычи криптогривны от криптоинженерии: +15% за уровень. */
export function cryptoBonus(techs: TechLevels): number {
  return 1 + Math.max(0, techs.CRYPTO_TECH) * 0.15;
}

/**
 * Надбавка «Бункерования» к несгораемой доле склада.
 *
 * Наружу отдается числом: правила о дереве не знают, `rules.ts` его
 * не импортирует, и обратная зависимость замкнула бы модули в кольцо.
 */
export function vaultBonus(techs: TechLevels): number {
  return Math.max(0, techs.VAULT_TECH) * 0.02;
}

export function economyBonuses(techs: TechLevels): EconomyBonuses {
  return {
    mining: 1 + techs.MINING_TECH * 0.02,
    energy: 1 + techs.ENERGY_TECH * 0.02,
  };
}
