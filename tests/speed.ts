/**
 * Технологии скорости: «Робототехника» и «Сжатие времени».
 *
 * Формулы проверяются напрямую на игровых модулях — сервер не нужен.
 *
 * Запуск: npm run test:speed
 */
import { buildSeconds, energyUsage, energyEfficiency, emptyLevels, productionPerSecond, type BuildingLevels, type PlanetRichness } from '../src/game/rules.js';
import {
  buildSpeedup, emptyTechLevels, helperShare, researchCost, researchJoinQuote,
  researchSeconds, roboticsSpeedup,
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

console.log('\n=== Лаборатории колоний присоединяются к общему исследованию ===');
{
  check('помощница того же уровня берет половину', helperShare(12, 12) === 0.5);
  check('помощница выше ведущей все равно берет не больше половины', helperShare(12, 20) === 0.5);
  check('шестой уровень при ведущей двенадцатого берет четверть', helperShare(12, 6) === 0.25);
  check('база без лаборатории не берет ничего', helperShare(12, 0) === 0);

  const total = researchSeconds('ASTROPHYSICS', 9, 12, techs());
  const cost = researchCost('ASTROPHYSICS', 9);
  const job = { tech: 'ASTROPHYSICS' as const, targetLevel: 9, leadLevel: 12, totalSeconds: total };
  // Срезанное время — целые секунды, поэтому цена может разойтись с «ровной
  // долей» не больше чем на стоимость одной секунды исследования.
  const perSecond = cost.polymers / total + 1;

  const half = researchJoinQuote({ ...job, joiningLevel: 12, remainingSeconds: total });
  check('равная лаборатория на старте срезает половину всего срока',
    half.savedSeconds === Math.floor(total / 2), `${total} с → ${half.remainingSeconds} с`);
  check('и доплачивает половину всей цены',
    Math.abs(half.price.polymers - Math.ceil(cost.polymers * half.share)) <= 1 &&
      Math.abs(half.price.polymers - cost.polymers / 2) <= perSecond,
    `полимеры ${half.price.polymers} из ${cost.polymers}`);

  const quarter = researchJoinQuote({ ...job, joiningLevel: 6, remainingSeconds: total * 0.8 });
  check('шестой уровень срезает четверть всего срока, а не остатка',
    quarter.savedSeconds === Math.floor(total * 0.25), `срезано ${quarter.savedSeconds} с из ${total}`);
  check('и платит четверть всей цены',
    Math.abs(quarter.price.polymers - cost.polymers / 4) <= perSecond, `полимеры ${quarter.price.polymers}`);

  const late = researchJoinQuote({ ...job, joiningLevel: 12, remainingSeconds: total * 0.1 });
  check('опоздавшая срезает только остаток', late.remainingSeconds === total * 0.1 - late.savedSeconds && late.remainingSeconds < 1);
  check('и платит только за остаток, а не за половину',
    Math.abs(late.price.polymers - cost.polymers * 0.1) <= perSecond, `полимеры ${late.price.polymers}`);

  const none = researchJoinQuote({ ...job, joiningLevel: 0, remainingSeconds: total });
  check('без лаборатории ничего не срезается и не платится', none.savedSeconds === 0 && none.price.polymers === 0);
}

const passed = results.filter((r) => r.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);
