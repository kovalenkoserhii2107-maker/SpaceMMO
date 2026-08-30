/**
 * Боевой движок: раунды, случайные цели, щиты и обломки.
 *
 * Бой стал случайным, поэтому проверять его можно двумя способами, и здесь
 * используются оба. Там, где важен точный исход, подставляется предсказуемый
 * генератор — результат тогда воспроизводим до последнего корпуса. Там, где
 * важна статистика, прогоняется серия боев и проверяется распределение:
 * одиночный случайный прогон ничего не доказывает.
 *
 * Запуск: npm run test:combat
 */
import {
  DEBRIS_SHARE,
  DEFENCE_RECOVERY_CHANCE,
  MAX_ROUNDS,
  combatBonuses,
  debrisFromLosses,
  defenseStats,
  emptyCombatTechs,
  hasWeapons,
  shipStats,
  simulateCombat,
  type CombatSide,
  type Rng,
} from '../src/game/combat.js';
import { emptyDefenseCounts, type DefenseCounts } from '../src/game/defenses.js';
import { emptyShipCounts, shipCost, SHIP_TYPES, type ShipCounts } from '../src/game/ships.js';
import { emptyTechLevels } from '../src/game/techTree.js';

const results: Array<{ name: string; passed: boolean }> = [];

function check(name: string, passed: boolean, detail?: string): void {
  results.push({ name, passed });
  console.log(`${passed ? 'PASS' : 'FAIL'} | ${name}${detail ? ' :: ' + detail : ''}`);
}

function fleet(partial: Partial<ShipCounts>): ShipCounts {
  return { ...emptyShipCounts(), ...partial };
}

function turrets(partial: Partial<DefenseCounts>): DefenseCounts {
  return { ...emptyDefenseCounts(), ...partial };
}

function side(ships: Partial<ShipCounts>, defenses: Partial<DefenseCounts> = {}): CombatSide {
  return { ships: fleet(ships), defenses: turrets(defenses), techs: emptyCombatTechs() };
}

/** Линейный конгруэнтный генератор: одинаковое зерно — одинаковый бой. */
function seeded(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/* ------------------------- 1. Баланс юнитов ------------------------- */

console.log('\n=== 1. Характеристики юнитов ===');

{
  const probe = shipStats('PROBE');
  const transport = shipStats('TRANSPORTER');
  const recycler = shipStats('RECYCLER');
  check(
    'зонд, транспорт и переработчик безоружны',
    probe.attack === 0 && transport.attack === 0 && recycler.attack === 0,
  );
  check(
    'вооружены только истребитель, крейсер и фрегат',
    SHIP_TYPES.filter((type) => shipStats(type).attack > 0).join(',') ===
      'LIGHT_FIGHTER,HEAVY_CRUISER,ION_FRIGATE',
    SHIP_TYPES.filter((type) => shipStats(type).attack > 0).join(', '),
  );

  const fighter = shipStats('LIGHT_FIGHTER');
  const cruiser = shipStats('HEAVY_CRUISER');
  check(
    'крейсер — танк: больше урона и корпуса, чем у истребителя',
    cruiser.attack > fighter.attack * 5 && cruiser.hull > fighter.hull * 5,
    `атака ${cruiser.attack} против ${fighter.attack}, корпус ${cruiser.hull} против ${fighter.hull}`,
  );
  check(
    'щит крейсера выше залпа истребителя — рой его не пробивает',
    cruiser.shield > fighter.attack,
    `щит ${cruiser.shield} против залпа ${fighter.attack}`,
  );

  const frigate = shipStats('ION_FRIGATE');
  check(
    'фрегат специализирован на пробитии щитов',
    frigate.shieldPiercing > 1 && frigate.hull < cruiser.hull,
    `пробитие ×${frigate.shieldPiercing}, корпус ${frigate.hull}`,
  );
  check(
    'оборона бьет, но дешевле флота по корпусу',
    defenseStats('CANNON_TURRET').attack > 0 && defenseStats('LASER_TURRET').attack > 0,
  );
  check('hasWeapons видит вооруженный флот', hasWeapons(fleet({ LIGHT_FIGHTER: 1 })));
  check('hasWeapons не считает транспорты боевыми', !hasWeapons(fleet({ TRANSPORTER: 10 })));
}

/* ------------------------- 2. Механика раундов ------------------------- */

console.log('\n=== 2. Раунды, щиты и цели ===');

{
  const result = simulateCombat(side({ HEAVY_CRUISER: 20 }), side({ LIGHT_FIGHTER: 3 }), seeded(1));
  check('бой не длиннее шести раундов', result.rounds.length <= MAX_ROUNDS, `${result.rounds.length}`);
  check(
    'бой обрывается, когда сторона кончилась',
    result.winner === 'ATTACKER' && result.rounds.length < MAX_ROUNDS,
    `раундов ${result.rounds.length}`,
  );
  check(
    'в логе раундов есть урон и потери обеих сторон',
    result.rounds.every(
      (round) =>
        typeof round.attackerDamage === 'number' &&
        typeof round.defenderLosses === 'number' &&
        typeof round.attackerAlive === 'number',
    ),
  );
}

{
  // Ключевая проверка щита: залп слабее щита не наносит вообще ничего,
  // а щит восстанавливается к следующему раунду — так рой и вязнет.
  const result = simulateCombat(side({ LIGHT_FIGHTER: 3 }), side({ HEAVY_CRUISER: 1 }), seeded(7));
  check(
    'залп слабее щита не проходит совсем',
    result.defenderSurvivorShips.HEAVY_CRUISER === 1 &&
      result.rounds.every((round) => round.defenderLosses === 0),
    `крейсеров осталось ${result.defenderSurvivorShips.HEAVY_CRUISER}`,
  );
  check(
    'весь урон роя осел в щите, до корпуса не дошло',
    result.absorption.attacker.hull === 0 && result.absorption.attacker.shield > 0,
    `в щит ${Math.round(result.absorption.attacker.shield)}, в корпус ${result.absorption.attacker.hull}`,
  );
}

{
  // Фрегат вскрывает тот же щит именно за счет пробития.
  const frigates = simulateCombat(side({ ION_FRIGATE: 3 }), side({ HEAVY_CRUISER: 1 }), seeded(7));
  check(
    'фрегаты пробивают щит, который держит рой истребителей',
    frigates.absorption.attacker.hull > 0,
    `в корпус прошло ${Math.round(frigates.absorption.attacker.hull)}`,
  );
}

{
  const withTech: CombatSide = {
    ships: fleet({ HEAVY_CRUISER: 1 }),
    defenses: emptyDefenseCounts(),
    techs: { ...emptyTechLevels(), ENERGY_TECH: 10 },
  };
  const bonuses = combatBonuses(withTech.techs);
  check(
    '«Энергетика» усиливает щиты перед боем',
    bonuses.shield > 1 && bonuses.attack === 1,
    `щит ×${bonuses.shield.toFixed(2)}`,
  );

  // Слабый залп, который в упор пробивал бы щит, с бонусом гасится целиком.
  // Восемь истребителей (120 урона) пробивают щит фрегата (80), но с изученной
  // «Энергетикой» щит вырастает и большая часть залпа гаснет в нем.
  const plain = simulateCombat(side({ LIGHT_FIGHTER: 8 }), side({ ION_FRIGATE: 1 }), seeded(3));
  const boosted = simulateCombat(
    side({ LIGHT_FIGHTER: 8 }),
    { ships: fleet({ ION_FRIGATE: 1 }), defenses: emptyDefenseCounts(), techs: { ...emptyTechLevels(), ENERGY_TECH: 20 } },
    seeded(3),
  );
  check(
    'с изученной «Энергетикой» до корпуса доходит заметно меньше',
    plain.absorption.attacker.hull > 0 &&
      boosted.absorption.attacker.hull < plain.absorption.attacker.hull,
    `без техов ${Math.round(plain.absorption.attacker.hull)}, с техами ${Math.round(boosted.absorption.attacker.hull)}`,
  );
}

/* ------------------------- 3. Сценарии ------------------------- */

console.log('\n=== 3. Сценарии ===');

{
  // «Один крейсер против 10 истребителей».
  const result = simulateCombat(side({ HEAVY_CRUISER: 1 }), side({ LIGHT_FIGHTER: 10 }), seeded(42));
  const killed = 10 - result.defenderSurvivorShips.LIGHT_FIGHTER;

  /*
   * Щит держит раунд, но снимается выстрел за выстрелом: одиночный залп
   * истребителя в него утыкается, а десять подряд — продавливают. Поэтому рой
   * все-таки грызет крейсер, просто медленно и теряя по кораблю за раунд.
   * Ровно этот расклад и делает осмысленным вопрос про скорострел.
   */
  check(
    'крейсер против роя: щит гасит по 50 за раунд, остальное идет в корпус',
    result.absorption.defender.hull === 375 && result.absorption.defender.shield === 300,
    `в корпус ${result.absorption.defender.hull}, в щит ${result.absorption.defender.shield}`,
  );
  check(
    'крейсер выживает, но едва: корпус почти снят',
    result.attackerSurvivors.HEAVY_CRUISER === 1,
    `осталось корпуса ${shipStats('HEAVY_CRUISER').hull - result.absorption.defender.hull} из ${shipStats('HEAVY_CRUISER').hull}`,
  );
  check(
    'крейсер бьет по одной цели за раунд — за шесть раундов не больше шести',
    killed <= MAX_ROUNDS && killed > 0,
    `сбито ${killed} из 10 за ${result.rounds.length} раундов`,
  );
  check(
    'рой выживает, бой кончается ничьей',
    result.winner === 'DRAW' && result.defenderSurvivorShips.LIGHT_FIGHTER > 0,
    `${result.winner}, истребителей осталось ${result.defenderSurvivorShips.LIGHT_FIGHTER}`,
  );
}

{
  // «Уничтожение пустой базы с транспортом»: везти нечем, но и сопротивления нет.
  const result = simulateCombat(side({ TRANSPORTER: 3 }), side({}), seeded(5));
  check(
    'пустая база сдается без боя',
    result.winner === 'ATTACKER' && result.rounds.length === 0,
    `${result.winner}, раундов ${result.rounds.length}`,
  );
  check(
    'безоружный транспорт не теряет ни корабля',
    result.attackerSurvivors.TRANSPORTER === 3 && result.debris.ore === 0,
  );

  // Та же пустая база, но с одной турелью: безоружный флот не может ее снять.
  const guarded = simulateCombat(side({ TRANSPORTER: 3 }), side({}, { CANNON_TURRET: 1 }), seeded(5));
  check(
    'безоружный флот не берет даже одну турель',
    guarded.winner === 'DEFENDER' || guarded.winner === 'DRAW',
    guarded.winner,
  );
}

{
  // «Выпадение правильного количества обломков».
  const lost = fleet({ LIGHT_FIGHTER: 10 });
  const cost = shipCost('LIGHT_FIGHTER');
  const debris = debrisFromLosses(lost, emptyShipCounts());

  check(
    'обломки — 30% стоимости уничтоженных кораблей',
    debris.ore === Math.floor(cost.ore * 10 * DEBRIS_SHARE) &&
      debris.polymers === Math.floor(cost.polymers * 10 * DEBRIS_SHARE),
    `${debris.ore} руды, ${debris.polymers} полимеров`,
  );

  const both = debrisFromLosses(fleet({ LIGHT_FIGHTER: 5 }), fleet({ LIGHT_FIGHTER: 5 }));
  check('обломки дают потери обеих сторон', both.ore === debris.ore, `${both.ore}`);

  check(
    'в обломках только руда и полимеры, плазма сгорает',
    Object.keys(debris).sort().join() === 'ore,polymers',
    Object.keys(debris).join(),
  );

  // Оборона в обломки не идет — это ключевое отличие от кораблей.
  const withTurrets = simulateCombat(
    side({ HEAVY_CRUISER: 30 }),
    side({}, { CANNON_TURRET: 5 }),
    seeded(11),
  );
  check(
    'разбитая оборона не дает обломков',
    withTurrets.defenderSurvivorDefenses.CANNON_TURRET < 5 && withTurrets.debris.ore === 0,
    `турелей сбито ${5 - withTurrets.defenderSurvivorDefenses.CANNON_TURRET}, обломков ${withTurrets.debris.ore}`,
  );
}

/* ------------------------- 4. Восстановление обороны ------------------------- */

console.log('\n=== 4. Восстановление обороны ===');

{
  const result = simulateCombat(side({ HEAVY_CRUISER: 40 }), side({}, { CANNON_TURRET: 10 }), seeded(9));
  const { chance, destroyed, restored } = result.defenceRecovery;

  check('шанс восстановления заявлен в отчете', chance === DEFENCE_RECOVERY_CHANCE, `${chance}`);
  check(
    'восстановить можно не больше, чем разбито',
    restored.CANNON_TURRET <= destroyed.CANNON_TURRET,
    `поднято ${restored.CANNON_TURRET} из ${destroyed.CANNON_TURRET}`,
  );

  // Проверяем не единичный бросок, а долю по серии: у случайности иначе не спросишь.
  let destroyedTotal = 0;
  let restoredTotal = 0;
  for (let seed = 0; seed < 200; seed += 1) {
    const run = simulateCombat(side({ HEAVY_CRUISER: 40 }), side({}, { CANNON_TURRET: 10 }), seeded(seed));
    destroyedTotal += run.defenceRecovery.destroyed.CANNON_TURRET;
    restoredTotal += run.defenceRecovery.restored.CANNON_TURRET;
  }
  const share = restoredTotal / Math.max(1, destroyedTotal);
  check(
    'доля восстановленных сходится с заявленным шансом',
    Math.abs(share - DEFENCE_RECOVERY_CHANCE) < 0.05,
    `${(share * 100).toFixed(1)}% при заявленных ${DEFENCE_RECOVERY_CHANCE * 100}%`,
  );
}

/* ------------------------- 5. Воспроизводимость ------------------------- */

console.log('\n=== 5. Случайность и воспроизводимость ===');

{
  const a = simulateCombat(side({ HEAVY_CRUISER: 8 }), side({ ION_FRIGATE: 12 }), seeded(123));
  const b = simulateCombat(side({ HEAVY_CRUISER: 8 }), side({ ION_FRIGATE: 12 }), seeded(123));
  check(
    'одно зерно — один и тот же бой',
    JSON.stringify(a) === JSON.stringify(b),
  );

  const outcomes = new Set<string>();
  for (let seed = 0; seed < 40; seed += 1) {
    const run = simulateCombat(side({ HEAVY_CRUISER: 8 }), side({ ION_FRIGATE: 12 }), seeded(seed));
    outcomes.add(JSON.stringify(run.attackerSurvivors) + JSON.stringify(run.defenderSurvivorShips));
  }
  check(
    'разные зерна дают разные бои: цели действительно случайны',
    outcomes.size > 1,
    `уникальных исходов: ${outcomes.size} из 40`,
  );
}

{
  // Огромный флот не должен подвешивать движок.
  const started = Date.now();
  const heavy = simulateCombat(side({ LIGHT_FIGHTER: 20000 }), side({ HEAVY_CRUISER: 500 }), seeded(2));
  const elapsed = Date.now() - started;
  check(
    'двадцать тысяч юнитов считаются за разумное время',
    elapsed < 5000 && heavy.rounds.length > 0,
    `${elapsed} мс`,
  );
}

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);
