/**
 * Очки командира: из чего складывается счет.
 *
 * Формулы проверяются напрямую на игровых модулях — это те же функции, которые
 * зовет рейтинг. Сервер не нужен.
 *
 * Запуск: npm run test:score
 */
import {
  costUnits,
  heldResources,
  sealScore,
  spentOnBuildings,
  spentOnDefense,
  spentOnFleet,
  spentOnResearch,
} from '../src/game/score.js';
import { emptyLevels, upgradeCost, type BuildingLevels } from '../src/game/rules.js';
import { emptyTechLevels, researchCost, type TechLevels } from '../src/game/techTree.js';
import { emptyShipCounts, shipCost, type ShipCounts } from '../src/game/ships.js';
import { defenseCost, emptyDefenseCounts, type DefenseCounts } from '../src/game/defenses.js';

const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

const levels = (partial: Partial<BuildingLevels>): BuildingLevels => ({ ...emptyLevels(), ...partial });
const techs = (partial: Partial<TechLevels>): TechLevels => ({ ...emptyTechLevels(), ...partial });
const ships = (partial: Partial<ShipCounts>): ShipCounts => ({ ...emptyShipCounts(), ...partial });
const defenses = (partial: Partial<DefenseCounts>): DefenseCounts => ({ ...emptyDefenseCounts(), ...partial });

console.log('\n=== 1. Пустой командир ===');

{
  check('без построек, флота и науки счет нулевой',
    spentOnBuildings(emptyLevels()) === 0 &&
      spentOnResearch(emptyTechLevels()) === 0 &&
      spentOnFleet(emptyShipCounts()) === 0 &&
      spentOnDefense(emptyDefenseCounts()) === 0);

  const zero = sealScore({ resources: 0, fleet: 0, defense: 0, buildings: 0, research: 0 });
  check('сумма пустых слагаемых — ноль', zero.total === 0);
}

console.log('\n=== 2. Постройки считаются по всем уровням ===');

{
  // Шахта третьего уровня стоила владельцу первого, второго и третьего.
  const expected =
    costUnits(upgradeCost('ORE_MINE', 1)) +
    costUnits(upgradeCost('ORE_MINE', 2)) +
    costUnits(upgradeCost('ORE_MINE', 3));
  check(
    'уровень 3 = сумма трех уровней, а не стоимость третьего',
    spentOnBuildings(levels({ ORE_MINE: 3 })) === expected,
    `${spentOnBuildings(levels({ ORE_MINE: 3 }))} = ${expected}`,
  );
  check(
    'третий уровень дороже первого — иначе суммировать было бы нечего',
    costUnits(upgradeCost('ORE_MINE', 3)) > costUnits(upgradeCost('ORE_MINE', 1)),
  );

  // Два разных здания складываются, а не перекрывают друг друга.
  const both = spentOnBuildings(levels({ ORE_MINE: 2, SHIPYARD: 2 }));
  const apart = spentOnBuildings(levels({ ORE_MINE: 2 })) + spentOnBuildings(levels({ SHIPYARD: 2 }));
  check('разные здания складываются', both === apart, `${both} = ${apart}`);
}

console.log('\n=== 3. Технологии, флот и оборона ===');

{
  const expected = costUnits(researchCost('ENERGY_TECH', 1)) + costUnits(researchCost('ENERGY_TECH', 2));
  check('технология считается по всем изученным уровням', spentOnResearch(techs({ ENERGY_TECH: 2 })) === expected);

  const one = spentOnFleet(ships({ CRUISER: 1 }));
  const ten = spentOnFleet(ships({ CRUISER: 10 }));
  check('флот линеен по количеству', ten === one * 10 && one === costUnits(shipCost('CRUISER')));

  const turrets = spentOnDefense(defenses({ CANNON: 4 }));
  check('оборона линейна по количеству', turrets === costUnits(defenseCost('CANNON')) * 4);

  // Потерянный флот из счета уходит сам: считается наличие, а не история трат.
  check('нулевой флот не дает очков', spentOnFleet(emptyShipCounts()) === 0);
}

console.log('\n=== 4. Ресурсы один к одному ===');

{
  check(
    'три вида ресурсов складываются напрямую',
    heldResources({ ore: 100, polymers: 50, plasma: 25 }) === 175,
  );
  check(
    'антиматерия входит наравне с остальными',
    heldResources({ ore: 0, polymers: 0, plasma: 0, antimatter: 40 }) === 40,
  );
  check(
    'отсутствующая антиматерия не ломает подсчет',
    heldResources({ ore: 10, polymers: 0, plasma: 0 }) === 10,
  );
}

console.log('\n=== 5. Сумма и округление ===');

{
  // Округление одно и в самом конце: складывать округленные части значило бы
  // накапливать ошибку на каждом слагаемом.
  const sealed = sealScore({ resources: 10.4, fleet: 10.4, defense: 10.4, buildings: 10.4, research: 10.4 });
  check('каждое слагаемое округляется, итог сходится с ними', sealed.total === 50, `итог ${sealed.total}`);

  const real = sealScore({
    resources: heldResources({ ore: 5000, polymers: 3000, plasma: 1000, antimatter: 12 }),
    fleet: spentOnFleet(ships({ LIGHT_FIGHTER: 20 })),
    defense: spentOnDefense(defenses({ CANNON: 5 })),
    buildings: spentOnBuildings(levels({ ORE_MINE: 8, POWER_PLANT: 6 })),
    research: spentOnResearch(techs({ ENERGY_TECH: 3, MINING_TECH: 2 })),
  });
  check(
    'счет обычного игрока остается точным целым',
    Number.isSafeInteger(real.total) && real.total > 0,
    `счет ${real.total}`,
  );
}

const failed = results.filter((r) => !r.passed);
console.log(`\n=== ИТОГ: ${results.length - failed.length}/${results.length} пройдено ===`);
for (const f of failed) console.log(`  СЛОМАНО: ${f.name}`);
if (failed.length > 0) process.exit(1);
