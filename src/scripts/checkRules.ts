/** Быстрая проверка формул Этапов 1-2 (sanity-check в консоли, не тест-раннер). */
import {
  buildSeconds,
  emptyLevels,
  energyEfficiency,
  energyOutput,
  energyUsage,
  productionPerSecond,
  upgradeCost,
} from '../game/rules.js';
import { economyBonuses, emptyTechLevels, researchCost, researchSeconds } from '../game/techTree.js';
import { shipUnitSeconds, SHIP_TYPES } from '../game/ships.js';

const richness = { metal: 1.0, crystal: 1.0, deuterium: 1.0, energy: 1.0 };
const techs = emptyTechLevels();
const bonuses = economyBonuses(techs);

console.log('--- Шахта металла без солнечной станции (дефицит энергии режет добычу) ---');
for (const level of [1, 5, 8, 9, 12]) {
  const levels = { ...emptyLevels(), METAL_MINE: level };
  const efficiency = energyEfficiency(levels, richness, bonuses);
  console.log(
    `ур.${level}: добыча ${productionPerSecond(levels, richness, bonuses).metal.toFixed(2)}/с, ` +
      `энергия ${energyUsage(levels).toFixed(1)}/${energyOutput(levels, richness, bonuses).toFixed(1)}, ` +
      `эффективность ${(efficiency * 100).toFixed(0)}%, ` +
      `цена след. ур. ${upgradeCost('METAL_MINE', level + 1).metal} Me / ${buildSeconds('METAL_MINE', level + 1)} с`,
  );
}

console.log('\n--- Влияние технологий (шахта ур.8) ---');
for (const [mining, energy] of [[0, 0], [5, 0], [5, 10]] as Array<[number, number]>) {
  const withTech = { ...emptyTechLevels(), MINING_TECH: mining, ENERGY_TECH: energy };
  const levels = { ...emptyLevels(), METAL_MINE: 8 };
  const b = economyBonuses(withTech);
  console.log(
    `горное дело ${mining}, энергетика ${energy}: ` +
      `добыча ${productionPerSecond(levels, richness, b).metal.toFixed(2)}/с, ` +
      `эффективность ${(energyEfficiency(levels, richness, b) * 100).toFixed(0)}%`,
  );
}

console.log('\n--- Исследования (лаборатория ур.1) ---');
for (const tech of ['ENERGY_TECH', 'COMPUTING_TECH', 'MINING_TECH', 'COMBUSTION_DRIVE'] as const) {
  const cost = researchCost(tech, 1);
  console.log(
    `${tech}: ${cost.metal} Me / ${cost.crystal} Cr / ${cost.deuterium} De, ` +
      `${researchSeconds(tech, 1, 1, techs)} с`,
  );
}

console.log('\n--- Верфь ---');
for (const ship of SHIP_TYPES) {
  console.log(`${ship}: верфь ур.1 — ${shipUnitSeconds(ship, 1)} с, ур.3 — ${shipUnitSeconds(ship, 3)} с`);
}
