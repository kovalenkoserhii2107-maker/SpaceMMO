/**
 * Генерация галактики (Этап 6): 10-15 систем на разных координатах,
 * 1-2 из них — с черной дырой в центре. Скрипт идемпотентен: уже созданные
 * системы не трогает, а только дополняет галактику до нужного размера
 * и заводит недостающие торговые хабы.
 *
 * Запуск: npm run generate
 */
import { prisma } from '../db/prisma.js';
import { PlanetType, StarClass, SystemAnomaly } from '../generated/prisma/enums.js';

const SYSTEM_NAMES = [
  'Сич', 'Тризуб', 'Хортиця', 'Славутич', 'Борисфен', 'Дніпро', 'Говерла',
  'Едельвейс', 'Кряж', 'Полин', 'Веселка', 'Курінь', 'Байрак', 'Лиман', 'Обрій',
  'Крига', 'Смерек', 'Ковила', 'Явір', 'Сокіл',
];

/** Названия для систем с черной дырой — их видно на макро-карте. */
const ANOMALY_NAMES = ['Провалля', 'Морок', 'Безодня', 'Виворіт'];

/** Сколько систем должно быть в галактике. */
const GALAXY_MIN_SYSTEMS = 10;
const GALAXY_MAX_SYSTEMS = 15;
/** Размер сетки галактики: координаты систем лежат в этом квадрате. */
const GALAXY_SIZE = 20;

const PLANET_PREFIXES = ['Аврора', 'Кобзар', 'Веста', 'Ярило', 'Сварог', 'Мокош', 'Стрибог', 'Перун', 'Лада', 'Хорс'];

/** Профили типов планет: диапазоны коэффициентов богатства. */
const PLANET_PROFILES: Record<PlanetType, {
  metal: [number, number];
  crystal: [number, number];
  deuterium: [number, number];
  energy: [number, number];
  antimatter: [number, number];
  size: [number, number];
}> = {
  ROCKY:     { metal: [1.1, 1.4], crystal: [0.8, 1.1], deuterium: [0.5, 0.8], energy: [0.9, 1.1], antimatter: [0.7, 1.0], size: [140, 210] },
  OCEANIC:   { metal: [0.7, 1.0], crystal: [0.9, 1.2], deuterium: [1.0, 1.3], energy: [0.8, 1.0], antimatter: [0.8, 1.1], size: [160, 230] },
  DESERT:    { metal: [0.9, 1.2], crystal: [0.7, 1.0], deuterium: [0.6, 0.9], energy: [1.2, 1.5], antimatter: [0.6, 0.9], size: [120, 190] },
  ICE:       { metal: [0.6, 0.9], crystal: [1.0, 1.3], deuterium: [1.3, 1.6], energy: [0.6, 0.8], antimatter: [1.0, 1.3], size: [110, 180] },
  GAS_GIANT: { metal: [0.4, 0.7], crystal: [0.6, 0.9], deuterium: [1.5, 1.9], energy: [0.7, 0.9], antimatter: [1.2, 1.6], size: [220, 300] },
  VOLCANIC:  { metal: [1.3, 1.7], crystal: [0.9, 1.2], deuterium: [0.4, 0.7], energy: [1.1, 1.4], antimatter: [0.9, 1.2], size: [100, 170] },
  TOXIC:     { metal: [1.0, 1.3], crystal: [1.1, 1.4], deuterium: [0.7, 1.0], energy: [0.7, 1.0], antimatter: [1.1, 1.4], size: [110, 175] },
};

/** Множитель инсоляции от класса звезды. */
const STAR_ENERGY_FACTOR: Record<StarClass, number> = {
  BLUE: 1.3,
  WHITE: 1.15,
  YELLOW: 1.0,
  ORANGE: 0.9,
  RED: 0.8,
};

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function randomInt(min: number, max: number): number {
  return Math.floor(randomBetween(min, max + 1));
}

function pick<T>(items: readonly T[]): T {
  const item = items[randomInt(0, items.length - 1)];
  if (item === undefined) throw new Error('Пустой список для выбора');
  return item;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'];

const HUB_NAMES = ['Орбитальный хаб «Базар»', 'Станция «Перекресток»', 'Торговый узел «Ярмарка»'];

/** Хаб создается для каждой системы, где его еще нет — вызов идемпотентен. */
async function ensureHubs(): Promise<void> {
  const systems = await prisma.solarSystem.findMany({ include: { hub: true } });
  let created = 0;

  for (const system of systems) {
    if (system.hub) continue;
    await prisma.tradeHub.create({
      data: { systemId: system.id, name: pick(HUB_NAMES), position: 0 },
    });
    created += 1;
  }

  if (created > 0) console.log(`[generate] открыто торговых хабов: ${created}`);
}

/** Свободные координаты на сетке галактики. */
function freeCoordinates(taken: Set<string>): { x: number; y: number } {
  for (let attempt = 0; attempt < 500; attempt += 1) {
    const x = randomInt(1, GALAXY_SIZE);
    const y = randomInt(1, GALAXY_SIZE);
    if (!taken.has(`${x}:${y}`)) return { x, y };
  }
  throw new Error('Не удалось подобрать свободные координаты в галактике');
}

/** Планеты системы: тип, размер и коэффициенты богатства зависят от орбиты и звезды. */
function buildPlanets(starClass: StarClass, planetCount: number) {
  const types = shuffle(Object.values(PlanetType)).slice(0, planetCount);
  const prefixes = shuffle(PLANET_PREFIXES).slice(0, planetCount);

  return types.map((type, index) => {
    const profile = PLANET_PROFILES[type];
    const position = index + 1;
    /** Ближе к звезде — больше энергии, дальше — больше дейтерия. */
    const orbitEnergy = 1.15 - (position - 1) * 0.08;
    const orbitDeuterium = 0.85 + (position - 1) * 0.09;

    return {
      name: `${prefixes[index]} ${ROMAN[index]}`,
      position,
      type,
      size: randomInt(profile.size[0], profile.size[1]),
      metalRichness: round2(randomBetween(profile.metal[0], profile.metal[1])),
      crystalRichness: round2(randomBetween(profile.crystal[0], profile.crystal[1])),
      deuteriumRichness: round2(randomBetween(profile.deuterium[0], profile.deuterium[1]) * orbitDeuterium),
      energyRichness: round2(
        randomBetween(profile.energy[0], profile.energy[1]) * orbitEnergy * STAR_ENERGY_FACTOR[starClass],
      ),
      antimatterRichness: round2(randomBetween(profile.antimatter[0], profile.antimatter[1])),
    };
  });
}

/** Создает одну систему на свободных координатах. */
async function createSystem(
  name: string,
  taken: Set<string>,
  usedNames: Set<string>,
  anomaly: SystemAnomaly,
) {
  const { x, y } = freeCoordinates(taken);
  taken.add(`${x}:${y}`);
  usedNames.add(name);

  // У черной дыры нет обычной звезды: планеты греет аккреционный диск.
  const starClass = anomaly === SystemAnomaly.BLACK_HOLE ? StarClass.BLUE : pick(Object.values(StarClass));
  const planetCount = randomInt(3, 5);

  const system = await prisma.solarSystem.create({
    data: {
      name,
      galaxyX: x,
      galaxyY: y,
      starClass,
      anomaly,
      planets: { create: buildPlanets(starClass, planetCount) },
    },
    include: { planets: { orderBy: { position: 'asc' } } },
  });

  console.log(
    `[generate] ${anomaly === SystemAnomaly.BLACK_HOLE ? '🕳  ' : '   '}` +
      `«${system.name}» (${system.starClass}${anomaly === SystemAnomaly.BLACK_HOLE ? ', ЧЕРНАЯ ДЫРА' : ''}) ` +
      `на ${system.galaxyX}:${system.galaxyY}, планет ${system.planets.length}`,
  );
  return system;
}

async function main(): Promise<void> {
  const existing = await prisma.solarSystem.findMany();
  const taken = new Set(existing.map((system) => `${system.galaxyX}:${system.galaxyY}`));
  const usedNames = new Set(existing.map((system) => system.name));
  const blackHoles = existing.filter((system) => system.anomaly === SystemAnomaly.BLACK_HOLE).length;

  const target = randomInt(GALAXY_MIN_SYSTEMS, GALAXY_MAX_SYSTEMS);
  const toCreate = Math.max(0, target - existing.length);

  if (existing.length > 0) {
    console.log(`[generate] в галактике уже есть систем: ${existing.length}, добавляю еще ${toCreate}`);
  }

  // Черных дыр в галактике должно быть 1-2.
  const anomaliesNeeded = Math.max(0, randomInt(1, 2) - blackHoles);
  const anomalySlots = new Set<number>();
  while (anomalySlots.size < Math.min(anomaliesNeeded, toCreate)) {
    anomalySlots.add(randomInt(0, toCreate - 1));
  }

  for (let index = 0; index < toCreate; index += 1) {
    const isAnomaly = anomalySlots.has(index);
    const pool = (isAnomaly ? ANOMALY_NAMES : SYSTEM_NAMES).filter((name) => !usedNames.has(name));
    const name = pool.length > 0 ? pick(pool) : `Сектор ${randomInt(100, 999)}`;
    await createSystem(name, taken, usedNames, isAnomaly ? SystemAnomaly.BLACK_HOLE : SystemAnomaly.NONE);
  }

  await ensureHubs();

  const total = await prisma.solarSystem.count();
  const holes = await prisma.solarSystem.count({ where: { anomaly: SystemAnomaly.BLACK_HOLE } });
  const planets = await prisma.planet.count();
  console.log(`[generate] галактика: систем ${total} (черных дыр ${holes}), планет ${planets}`);
}

function shuffle<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    const a = copy[i] as T;
    const b = copy[j] as T;
    copy[i] = b;
    copy[j] = a;
  }
  return copy;
}

main()
  .catch((error: unknown) => {
    console.error('[generate] ошибка генерации:', error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
