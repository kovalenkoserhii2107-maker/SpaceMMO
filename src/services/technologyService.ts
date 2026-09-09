/**
 * Подробности технологии: десять уровней вперед, как у построек.
 *
 * Отдельным роутом по той же причине — таблица нужна, только когда карточка
 * открыта, а снимок уходит в сокет каждую секунду и всем сразу.
 *
 * Строка таблицы — та же `BuildingProjectionRow`: у технологии тоже есть
 * уровень, цена, срок и величина эффекта, а рисует их один и тот же компонент.
 * Заводить второй ради другого слова в заголовке значило бы держать две
 * верстки, расходящиеся при первой правке.
 */
import { gameLoop } from '../game/gameLoop.js';
import {
  researchCost,
  researchSeconds,
  techDescription,
  techLabel,
  timeCompressionDrain,
  type TechLevels,
  type TechnologyType,
} from '../game/techTree.js';
import { systemModifiers } from '../game/rules.js';
import type { BuildingProjectionRow, TechnologyProjection } from '../types/socket.js';

/** Сколько уровней показываем вперед. */
const HORIZON = 10;

/**
 * Чем измеряется польза технологии и сколько ее на уровне.
 *
 * Величины разнородны намеренно: у боевых это множитель характеристики,
 * у астрофизики — штуки колоний, у шпионажа — сама ступень лестницы.
 * Сводить их к одной шкале нечем, да и незачем: игрок сравнивает уровни
 * одной технологии между собой, а не разные технологии друг с другом.
 */
const EFFECT: Record<TechnologyType, { label: string; at: (level: number) => number } | null> = {
  ENERGY_TECH: { label: 'выработка энергии, %', at: (l) => Math.round((1 + l * 0.02) * 100) },
  MINING_TECH: { label: 'добыча руды и полимеров, %', at: (l) => Math.round((1 + l * 0.02) * 100) },
  WEAPONS_TECH: { label: 'атака флота и обороны, %', at: (l) => Math.round((1 + l * 0.1) * 100) },
  SHIELDS_TECH: { label: 'щит флота и обороны, %', at: (l) => Math.round((1 + l * 0.1) * 100) },
  ARMOR_TECH: { label: 'корпус флота и обороны, %', at: (l) => Math.round((1 + l * 0.1) * 100) },
  ROBOTICS: { label: 'скорость стройки и сборки, %', at: (l) => Math.round((1 + l * 0.08) * 100) },
  CRYPTO_TECH: { label: 'добыча криптогривны, %', at: (l) => Math.round((1 + l * 0.15) * 100) },
  VAULT_TECH: { label: 'несгораемая доля склада, %', at: (l) => Math.round((0.2 + l * 0.02) * 100) },
  ASTROPHYSICS: { label: 'слотов под колонии', at: (l) => 1 + Math.floor(l / 2) },
  TIME_COMPRESSION: { label: 'все сроки короче в N раз', at: (l) => Math.pow(2, l) },
  ESPIONAGE: { label: 'ступень разведки', at: (l) => l },
  // У этих польза не выражается числом: они открывают классы кораблей
  // и ветки дерева, и колонка величины у них пуста, а не занята нулем.
  COMPUTING_TECH: null,
  COMBUSTION_DRIVE: null,
  HYPERSPACE_PHYSICS: null,
  HYPERDRIVE: null,
};

export async function getTechnologyProjection(
  commanderId: string,
  baseId: string,
  tech: TechnologyType,
): Promise<TechnologyProjection | null> {
  // Тот же порядок, что у построек: сначала сброс состояния из памяти тика,
  // иначе карточка покажет числа, устаревшие на несколько секунд (правило 12).
  await gameLoop.flushCommander(commanderId);
  const commander = await gameLoop.getCommander(commanderId);
  const base = commander?.bases.get(baseId);
  if (!commander || !base) return null;

  const level = commander.techs[tech];
  const modifiers = systemModifiers(base.anomaly);
  const effect = EFFECT[tech];
  const baseValue = effect ? effect.at(level) : null;

  const rows: BuildingProjectionRow[] = [];
  for (let target = level; target <= level + HORIZON; target += 1) {
    const current = target === level;
    const value = effect ? effect.at(target) : null;

    /*
     * Срок считается по лаборатории той базы, с которой открыта карточка,
     * и по нынешним технологиям — включая ту, чью таблицу мы строим.
     * «Сжатие времени» тут показательно: его собственный следующий уровень
     * ускоряет и само исследование, поэтому уровни в таблице дешевеют
     * по времени, а не только дорожают.
     */
    const techsAt: TechLevels = { ...commander.techs, [tech]: target - 1 };

    rows.push({
      level: target,
      current,
      cost: current ? null : researchCost(tech, target),
      seconds: current
        ? null
        : researchSeconds(tech, target, base.levels.SCIENCE_CENTER, techsAt, modifiers),
      output: value,
      outputGain: value === null || baseValue === null ? null : value - baseValue,
      // Своего расхода у технологий нет, кроме «Сжатия времени»: оно держит
      // постоянную нагрузку, удваивающуюся с уровнем.
      energy: Math.round(timeCompressionDrain({ ...commander.techs, [tech]: target }) * 10) / 10,
      energyGain:
        Math.round(
          (timeCompressionDrain({ ...commander.techs, [tech]: target }) -
            timeCompressionDrain(commander.techs)) * 10,
        ) / 10,
    });
  }

  return {
    tech,
    label: techLabel(tech),
    description: techDescription(tech),
    level,
    outputLabel: effect ? effect.label : null,
    rows,
  };
}
