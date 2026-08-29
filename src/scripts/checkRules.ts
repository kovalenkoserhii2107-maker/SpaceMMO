/** Быстрая проверка формул Этапа 1 (не тест-раннер, а sanity-check в консоли). */
import { energyOutput, energyUsage, productionPerSecond, upgradeCost } from '../game/rules.js';

const richness = { metal: 1.0, crystal: 1.0, deuterium: 1.0, energy: 1.0 };
for (const level of [1, 3, 5, 8, 9, 10]) {
  const levels = { METAL_MINE: level, CRYSTAL_MINE: 0, DEUTERIUM_MINE: 0, SOLAR_PLANT: 0 };
  const out = energyOutput(levels, richness);
  const use = energyUsage(levels);
  console.log(
    `шахта металла ур.${level}: добыча ${productionPerSecond(levels, richness).metal.toFixed(2)}/с, ` +
      `цена след. ур. ${upgradeCost('METAL_MINE', level + 1).metal} Me, ` +
      `энергия ${use.toFixed(1)}/${out.toFixed(1)} ${use > out ? '=> ЗАБЛОКИРОВАНО' : 'ok'}`,
  );
}
