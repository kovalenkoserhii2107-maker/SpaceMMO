/**
 * Подробности постройки: что даст не следующий уровень, а десять вперед.
 *
 * Отдельным роутом, а не полем снимка: таблица нужна, только когда игрок
 * открыл карточку, а снимок уходит в сокет каждую секунду и всем сразу.
 * Восемьдесят строк проекции в каждом тике — это трафик и работа впустую.
 *
 * Приросты считаются от текущего уровня, а не от предыдущей строки таблицы:
 * игрок решает «стоит ли мне идти на три уровня вверх», и ему нужен итог
 * этого решения, а не разница между двумя гипотетическими будущими.
 */
import { gameLoop } from '../game/gameLoop.js';
import {
  BUILDING_DESCRIPTIONS,
  BUILDING_LABELS,
  buildSeconds,
  buildingEnergyUsage,
  energyOutput,
  productionPerSecond,
  storageCapacityForLevel,
  systemModifiers,
  upgradeCost,
  type BuildingLevels,
  type BuildingType,
} from '../game/rules.js';
import { buildSpeedup, economyBonuses, timeCompressionDrain } from '../game/techTree.js';
import { defenseEnergyUsage } from '../game/defenses.js';
import type { BuildingProjection, BuildingProjectionRow } from '../types/socket.js';

/** Сколько уровней показываем вперед. */
const HORIZON = 10;

/** Что именно производит здание — по этому подписывается колонка выработки. */
const OUTPUT_LABEL: Partial<Record<BuildingType, string>> = {
  ORE_MINE: 'руда в час',
  POLYMER_PLANT: 'полимеры в час',
  PLASMA_REACTOR: 'плазма в час',
  ANTIMATTER_FACTORY: 'антиматерия в час',
  POWER_PLANT: 'выработка энергии',
  STORAGE: 'вместимость склада',
};

export async function getBuildingProjection(
  commanderId: string,
  baseId: string,
  type: BuildingType,
): Promise<BuildingProjection | null> {
  // Снимок должен совпадать с тем, что игрок видит на карточке, поэтому
  // состояние сначала сбрасывается из памяти тика (правило 12).
  await gameLoop.flushCommander(commanderId);
  const commander = await gameLoop.getCommander(commanderId);
  const base = commander?.bases.get(baseId);
  if (!commander || !base) return null;

  const bonuses = economyBonuses(commander.techs);
  const modifiers = systemModifiers(base.anomaly);
  const drain = defenseEnergyUsage(base.defenses);
  const techDrain = timeCompressionDrain(commander.techs);
  const level = base.levels[type];

  /** Выработка здания на уровне — в тех единицах, в которых ее и показываем. */
  const outputAt = (target: number): number | null => {
    const levels: BuildingLevels = { ...base.levels, [type]: target };
    if (type === 'STORAGE') return storageCapacityForLevel(target);
    if (type === 'POWER_PLANT') return energyOutput(levels, base.richness, bonuses);

    const production = productionPerSecond(levels, base.richness, bonuses, drain, modifiers, techDrain);
    if (type === 'ORE_MINE') return production.ore * 3600;
    if (type === 'POLYMER_PLANT') return production.polymers * 3600;
    if (type === 'PLASMA_REACTOR') return production.plasma * 3600;
    if (type === 'ANTIMATTER_FACTORY') return production.antimatter * 3600;
    // Лаборатория и верфь не производят ресурс: их эффект — скорость,
    // и колонки выработки у них нет вовсе.
    return null;
  };

  const baseOutput = outputAt(level);
  const baseEnergy = buildingEnergyUsage(type, level);

  const rows: BuildingProjectionRow[] = [];
  for (let target = level + 1; target <= level + HORIZON; target += 1) {
    const output = outputAt(target);
    const energy = buildingEnergyUsage(type, target);

    rows.push({
      level: target,
      cost: upgradeCost(type, target),
      seconds: buildSeconds(type, target, modifiers, buildSpeedup(commander.techs)),
      output: output === null ? null : Math.round(output),
      outputGain:
        output === null || baseOutput === null ? null : Math.round(output - baseOutput),
      energy: Math.round(energy * 10) / 10,
      energyGain: Math.round((energy - baseEnergy) * 10) / 10,
    });
  }

  return {
    type,
    label: BUILDING_LABELS[type],
    description: BUILDING_DESCRIPTIONS[type],
    level,
    outputLabel: OUTPUT_LABEL[type] ?? null,
    rows,
  };
}
