/**
 * Генерация стартовой солнечной системы с 3-5 уникальными планетами.
 * Запуск: npm run generate
 */
import { prisma } from '../db/prisma.js';
import { PlanetType, StarClass } from '../generated/prisma/enums.js';

const SYSTEM_NAMES = ['Сич', 'Тризуб', 'Хортиця', 'Славутич', 'Борисфен', 'Дніпро', 'Говерла'];

const PLANET_PREFIXES = ['Аврора', 'Кобзар', 'Веста', 'Ярило', 'Сварог', 'Мокош', 'Стрибог', 'Перун', 'Лада', 'Хорс'];

/** Профили типов планет: диапазоны коэффициентов богатства. */
const PLANET_PROFILES: Record<PlanetType, {
  metal: [number, number];
  crystal: [number, number];
  deuterium: [number, number];
  energy: [number, number];
  size: [number, number];
}> = {
  ROCKY:     { metal: [1.1, 1.4], crystal: [0.8, 1.1], deuterium: [0.5, 0.8], energy: [0.9, 1.1], size: [140, 210] },
  OCEANIC:   { metal: [0.7, 1.0], crystal: [0.9, 1.2], deuterium: [1.0, 1.3], energy: [0.8, 1.0], size: [160, 230] },
  DESERT:    { metal: [0.9, 1.2], crystal: [0.7, 1.0], deuterium: [0.6, 0.9], energy: [1.2, 1.5], size: [120, 190] },
  ICE:       { metal: [0.6, 0.9], crystal: [1.0, 1.3], deuterium: [1.3, 1.6], energy: [0.6, 0.8], size: [110, 180] },
  GAS_GIANT: { metal: [0.4, 0.7], crystal: [0.6, 0.9], deuterium: [1.5, 1.9], energy: [0.7, 0.9], size: [220, 300] },
  VOLCANIC:  { metal: [1.3, 1.7], crystal: [0.9, 1.2], deuterium: [0.4, 0.7], energy: [1.1, 1.4], size: [100, 170] },
  TOXIC:     { metal: [1.0, 1.3], crystal: [1.1, 1.4], deuterium: [0.7, 1.0], energy: [0.7, 1.0], size: [110, 175] },
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

async function main(): Promise<void> {
  const existing = await prisma.solarSystem.count();
  if (existing > 0) {
    console.log(`[generate] в галактике уже есть систем: ${existing}. Генерация пропущена.`);
    return;
  }

  const systemName = pick(SYSTEM_NAMES);
  const starClass = pick(Object.values(StarClass));
  const planetCount = randomInt(3, 5);

  const types = shuffle(Object.values(PlanetType)).slice(0, planetCount);
  const prefixes = shuffle(PLANET_PREFIXES).slice(0, planetCount);

  const system = await prisma.solarSystem.create({
    data: {
      name: systemName,
      galaxyX: 1,
      galaxyY: 1,
      starClass,
      planets: {
        create: types.map((type, index) => {
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
          };
        }),
      },
    },
    include: { planets: { orderBy: { position: 'asc' } } },
  });

  console.log(`[generate] система «${system.name}» (${system.starClass}), координаты ${system.galaxyX}:${system.galaxyY}`);
  for (const planet of system.planets) {
    console.log(
      `  ${planet.position}. ${planet.name} — ${planet.type}, слотов ${planet.size}, ` +
        `Me ${planet.metalRichness} / Cr ${planet.crystalRichness} / ` +
        `De ${planet.deuteriumRichness} / En ${planet.energyRichness}`,
    );
  }
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
