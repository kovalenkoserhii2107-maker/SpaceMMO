/**
 * Технологии скорости: «Робототехника» и «Сжатие времени».
 *
 * Формулы проверяются напрямую на игровых модулях — сервер не нужен.
 *
 * Запуск: npm run test:speed
 */
import { buildSeconds, energyUsage, energyEfficiency, emptyLevels, productionPerSecond, type BuildingLevels, type PlanetRichness } from '../src/game/rules.js';
import {
  buildSpeedup, emptyTechLevels, researchSeconds, roboticsSpeedup,
  timeCompressionDrain, timeCompressionSpeedup, type TechLevels,
} from '../src/game/techTree.js';
import { shipUnitSeconds } from '../src/game/ships.js';
import { defenseUnitSeconds } from '../src/game/defenses.js';

const results: Array<{ name: string; passed: boolean }> = [];
function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}
const techs = (p: Partial<TechLevels> = {}): TechLevels => ({ ...emptyTechLevels(), ...p });
const levels = (p: Partial<BuildingLevels> = {}): BuildingLevels => ({ ...emptyLevels(), ...p });
const RICH: PlanetRichness = { ore: 1, polymers: 1, plasma: 1, energy: 1, antimatter: 1 };

console.log('\n=== 1. Робототехника ускоряет стройку ===');
{
  const none = buildSeconds('ORE_MINE', 10, undefined, buildSpeedup(techs()));
  const five = buildSeconds('ORE_MINE', 10, undefined, buildSpeedup(techs({ ROBOTICS: 5 })));
  check('стройка ускоряется уровнем робототехники', five < none, `${none} с → ${five} с`);
  check('ускорение линейно: 5 уровней дают ×1.4', Math.abs(roboticsSpeedup(techs({ ROBOTICS: 5 })) - 1.4) < 1e-9);

  const ship = shipUnitSeconds('CRUISER', 4, undefined, buildSpeedup(techs()));
  const shipFast = shipUnitSeconds('CRUISER', 4, undefined, buildSpeedup(techs({ ROBOTICS: 5 })));
  check('корабли собираются быстрее и от верфи, и от робототехники', shipFast < ship, `${ship} с → ${shipFast} с`);
  check('верфь по-прежнему ускоряет сама по себе',
    shipUnitSeconds('CRUISER', 8, undefined, 1) < shipUnitSeconds('CRUISER', 2, undefined, 1));

  const def = defenseUnitSeconds('GAUSS', 4, undefined, buildSpeedup(techs({ ROBOTICS: 5 })));
  check('оборона тоже ускоряется', def < defenseUnitSeconds('GAUSS', 4, undefined, 1));

  // Науку робототехника не трогает: автоматы собирают корпуса, а не ставят опыты.
  const r0 = researchSeconds('ENERGY_TECH', 5, 5, techs());
  const r5 = researchSeconds('ENERGY_TECH', 5, 5, techs({ ROBOTICS: 5 }));
  check('на исследования робототехника не влияет', r0 === r5, `${r0} с = ${r5} с`);
}

console.log('\n=== 2. Сжатие времени режет сроки вдвое за уровень ===');
{
  check('множитель — степень двойки',
    timeCompressionSpeedup(techs({ TIME_COMPRESSION: 0 })) === 1 &&
      timeCompressionSpeedup(techs({ TIME_COMPRESSION: 1 })) === 2 &&
      timeCompressionSpeedup(techs({ TIME_COMPRESSION: 3 })) === 8);

  const base = buildSeconds('SHIPYARD', 8, undefined, 1);
  const one = buildSeconds('SHIPYARD', 8, undefined, buildSpeedup(techs({ TIME_COMPRESSION: 1 })));
  const two = buildSeconds('SHIPYARD', 8, undefined, buildSpeedup(techs({ TIME_COMPRESSION: 2 })));
  check('стройка: каждый уровень вдвое', Math.abs(one * 2 - base) <= 1 && Math.abs(two * 4 - base) <= 2,
    `${base} → ${one} → ${two} с`);

  const sBase = shipUnitSeconds('BATTLESHIP', 8, undefined, 1);
  const sFast = shipUnitSeconds('BATTLESHIP', 8, undefined, buildSpeedup(techs({ TIME_COMPRESSION: 2 })));
  check('верфь: тоже вчетверо на втором уровне', Math.abs(sFast * 4 - sBase) <= 2, `${sBase} → ${sFast} с`);

  // В отличие от робототехники, здесь наука ускоряется наравне со стройкой.
  const rBase = researchSeconds('HYPERDRIVE', 8, 8, techs());
  const rFast = researchSeconds('HYPERDRIVE', 8, 8, techs({ TIME_COMPRESSION: 2 }));
  check('исследования тоже вчетверо', Math.abs(rFast * 4 - rBase) <= 4, `${rBase} → ${rFast} с`);
}

console.log('\n=== 3. Плата за сжатие — энергия ===');
{
  check('расход удваивается с уровнем',
    timeCompressionDrain(techs()) === 0 &&
      timeCompressionDrain(techs({ TIME_COMPRESSION: 1 })) === 120 &&
      timeCompressionDrain(techs({ TIME_COMPRESSION: 2 })) === 240 &&
      timeCompressionDrain(techs({ TIME_COMPRESSION: 4 })) === 960,
    `уровни 1..4: ${[1,2,3,4].map((l) => timeCompressionDrain(techs({ TIME_COMPRESSION: l }))).join(', ')}`);

  const base = levels({ ORE_MINE: 12, POLYMER_PLANT: 12, PLASMA_REACTOR: 12, POWER_PLANT: 12 });
  const drain = timeCompressionDrain(techs({ TIME_COMPRESSION: 2 }));
  check('расход попадает в общий баланс энергии',
    energyUsage(base, 0, drain) === energyUsage(base) + drain);

  const effBefore = energyEfficiency(base, RICH);
  const effAfter = energyEfficiency(base, RICH, undefined, 0, drain);
  check('дефицит бьет по КПД базы', effAfter < effBefore,
    `${(effBefore * 100).toFixed(0)}% → ${(effAfter * 100).toFixed(0)}%`);

  /*
   * Главный смысл механики: ускорение не бесплатно. На той же энергетике
   * включенное сжатие роняет добычу, и уровень выше окупается только тому,
   * кто заранее вложился в станции.
   */
  const pBefore = productionPerSecond(base, RICH);
  const pAfter = productionPerSecond(base, RICH, undefined, 0, undefined, drain);
  check('добыча падает вместе с КПД',
    pAfter.ore + pAfter.polymers + pAfter.plasma < pBefore.ore + pBefore.polymers + pBefore.plasma,
    `${((pBefore.ore + pBefore.polymers + pBefore.plasma) * 3600).toFixed(0)}/ч → ` +
      `${((pAfter.ore + pAfter.polymers + pAfter.plasma) * 3600).toFixed(0)}/ч`);

  // Мощная энергетика окупает ту же установку без потерь.
  const strong = levels({ ORE_MINE: 12, POLYMER_PLANT: 12, PLASMA_REACTOR: 12, POWER_PLANT: 22 });
  check('с развитой энергетикой сжатие ничего не отнимает',
    energyEfficiency(strong, RICH, undefined, 0, drain) === 1,
    `КПД ${(energyEfficiency(strong, RICH, undefined, 0, drain) * 100).toFixed(0)}%`);
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);
