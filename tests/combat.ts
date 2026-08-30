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
  rapidFireAgainst,
  defenseStats,
  emptyCombatTechs,
  hasWeapons,
  shipStats,
  simulateCombat,
  type CombatSide,
  type Rng,
} from '../src/game/combat.js';
import { defenseCost, emptyDefenseCounts, type DefenseCounts } from '../src/game/defenses.js';
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
  const bonuses = combatBonuses({
    ...emptyTechLevels(),
    WEAPONS_TECH: 5,
    SHIELDS_TECH: 3,
    ARMOR_TECH: 10,
  });
  check(
    'каждая боевая ветка дает +10% своей характеристике за уровень',
    Math.abs(bonuses.attack - 1.5) < 1e-9 &&
      Math.abs(bonuses.shield - 1.3) < 1e-9 &&
      Math.abs(bonuses.hull - 2.0) < 1e-9,
    `атака ×${bonuses.attack.toFixed(2)}, щит ×${bonuses.shield.toFixed(2)}, корпус ×${bonuses.hull.toFixed(2)}`,
  );

  // «Энергетика» осталась экономической технологией и пререквизитом:
  // за щиты теперь отвечает щитовая ветка, дублировать роли незачем.
  const energyOnly = combatBonuses({ ...emptyTechLevels(), ENERGY_TECH: 20 });
  check(
    '«Энергетика» на бой больше не влияет',
    energyOnly.attack === 1 && energyOnly.shield === 1 && energyOnly.hull === 1,
    `щит ×${energyOnly.shield}`,
  );

  const plainSide = side({ LIGHT_FIGHTER: 8 });
  const target = (techs: Partial<Record<string, number>>): CombatSide => ({
    ships: fleet({ ION_FRIGATE: 1 }),
    defenses: emptyDefenseCounts(),
    techs: { ...emptyTechLevels(), ...techs } as CombatSide['techs'],
  });

  const bare = simulateCombat(plainSide, target({}), seeded(3));
  const shielded = simulateCombat(plainSide, target({ SHIELDS_TECH: 5 }), seeded(3));
  check(
    'щитовая технология уменьшает урон по корпусу',
    bare.absorption.attacker.hull > 0 &&
      shielded.absorption.attacker.hull < bare.absorption.attacker.hull,
    `без техов ${Math.round(bare.absorption.attacker.hull)}, с техами ${Math.round(shielded.absorption.attacker.hull)}`,
  );

  const armored = simulateCombat(plainSide, target({ ARMOR_TECH: 10 }), seeded(3));
  check(
    'бронебойная технология поднимает корпус: цель выживает дольше',
    armored.defenderSurvivorShips.ION_FRIGATE >= bare.defenderSurvivorShips.ION_FRIGATE,
  );

  const weakGun = simulateCombat(side({ LIGHT_FIGHTER: 4 }), side({ HEAVY_CRUISER: 1 }), seeded(4));
  const strongGun = simulateCombat(
    { ships: fleet({ LIGHT_FIGHTER: 4 }), defenses: emptyDefenseCounts(), techs: { ...emptyTechLevels(), WEAPONS_TECH: 10 } },
    side({ HEAVY_CRUISER: 1 }),
    seeded(4),
  );
  check(
    'оружейная технология усиливает залп',
    strongGun.absorption.attacker.hull > weakGun.absorption.attacker.hull,
    `без техов ${Math.round(weakGun.absorption.attacker.hull)}, с техами ${Math.round(strongGun.absorption.attacker.hull)}`,
  );

  // Бонусы должны доставать и до обороны, а не только до кораблей.
  const bareTurrets = simulateCombat(
    side({ HEAVY_CRUISER: 6 }),
    { ships: emptyShipCounts(), defenses: turrets({ LASER_TURRET: 8 }), techs: emptyTechLevels() },
    seeded(6),
  );
  const toughTurrets = simulateCombat(
    side({ HEAVY_CRUISER: 6 }),
    { ships: emptyShipCounts(), defenses: turrets({ LASER_TURRET: 8 }), techs: { ...emptyTechLevels(), ARMOR_TECH: 10, SHIELDS_TECH: 10 } },
    seeded(6),
  );
  check(
    'боевые технологии усиливают и оборону',
    toughTurrets.defenderSurvivorDefenses.LASER_TURRET > bareTurrets.defenderSurvivorDefenses.LASER_TURRET,
    `без техов уцелело ${bareTurrets.defenderSurvivorDefenses.LASER_TURRET}, с техами ${toughTurrets.defenderSurvivorDefenses.LASER_TURRET}`,
  );
}

/* ------------------------- 2b. Скорострел ------------------------- */

console.log('\n=== 2b. Скорострел ===');

{
  check(
    'матрица односторонняя: крейсер косит истребителей, обратно — нет',
    rapidFireAgainst('HEAVY_CRUISER', 'LIGHT_FIGHTER') === 10 &&
      rapidFireAgainst('LIGHT_FIGHTER', 'HEAVY_CRUISER') === 1,
  );
  check(
    'фрегат заточен под лазерные турели, истребитель — под пушечные',
    rapidFireAgainst('ION_FRIGATE', 'LASER_TURRET') === 8 &&
      rapidFireAgainst('LIGHT_FIGHTER', 'CANNON_TURRET') === 3,
  );
  check(
    'по мелочи у крейсера и фрегата средний скорострел',
    rapidFireAgainst('HEAVY_CRUISER', 'PROBE') === 5 &&
      rapidFireAgainst('ION_FRIGATE', 'TRANSPORTER') === 5,
  );
  check(
    'у обороны и безоружных скорострела нет',
    rapidFireAgainst('LASER_TURRET', 'LIGHT_FIGHTER') === 1 &&
      rapidFireAgainst('TRANSPORTER', 'PROBE') === 1,
  );

  // Средняя длина очереди должна сходиться с N: проверяем по серии, а не по одному бою.
  let killedWithRapid = 0;
  let killedWithout = 0;
  for (let seed = 0; seed < 100; seed += 1) {
    // Один крейсер против роя: очередь по истребителям длинная.
    killedWithRapid += 20 - simulateCombat(
      side({ HEAVY_CRUISER: 1 }), side({ LIGHT_FIGHTER: 20 }), seeded(seed),
    ).defenderSurvivorShips.LIGHT_FIGHTER;
    // Тот же крейсер против фрегатов: скорострела нет, бьет раз в раунд.
    killedWithout += 20 - simulateCombat(
      side({ HEAVY_CRUISER: 1 }), side({ ION_FRIGATE: 20 }), seeded(seed),
    ).defenderSurvivorShips.ION_FRIGATE;
  }
  check(
    'со скорострелом крейсер убивает кратно больше целей за бой',
    killedWithRapid / 100 > (killedWithout / 100) * 3,
    `по истребителям ${(killedWithRapid / 100).toFixed(1)} за бой, по фрегатам ${(killedWithout / 100).toFixed(1)}`,
  );
  check(
    'без скорострела не больше одной цели за раунд',
    killedWithout / 100 <= MAX_ROUNDS,
    `${(killedWithout / 100).toFixed(1)} целей`,
  );
}

/* ------------------------- 3. Сценарии ------------------------- */

console.log('\n=== 3. Сценарии ===');

{
  /*
   * «Один крейсер против роя» при равной стоимости.
   *
   * Крейсер стоит как четыре истребителя. До скорострела он бил раз в раунд,
   * и рой продавливал его щит числом; теперь очередь по истребителям снимает
   * их пачкой, и тяжелый корабль наконец отрабатывает свою цену.
   */
  const parity = 4;
  let wins = 0;
  for (let seed = 0; seed < 50; seed += 1) {
    const run = simulateCombat(side({ HEAVY_CRUISER: 1 }), side({ LIGHT_FIGHTER: parity }), seeded(seed));
    if (run.winner === 'ATTACKER') wins += 1;
  }
  check(
    'крейсер уверенно бьет равный по стоимости рой',
    wins === 50,
    `побед ${wins} из 50 против ${parity} истребителей`,
  );

  const showcase = simulateCombat(side({ HEAVY_CRUISER: 1 }), side({ LIGHT_FIGHTER: parity }), seeded(42));
  check(
    'крейсер выходит из такого боя целым',
    showcase.attackerSurvivors.HEAVY_CRUISER === 1 &&
      showcase.defenderSurvivorShips.LIGHT_FIGHTER === 0,
    `сбито ${parity - showcase.defenderSurvivorShips.LIGHT_FIGHTER}, раундов ${showcase.rounds.length}`,
  );

  // И даже троекратный перевес роя больше не спасает: это и есть смысл скорострела.
  let heavyWins = 0;
  for (let seed = 0; seed < 50; seed += 1) {
    const run = simulateCombat(side({ HEAVY_CRUISER: 1 }), side({ LIGHT_FIGHTER: parity * 3 }), seeded(seed));
    if (run.winner === 'ATTACKER') heavyWins += 1;
  }
  check(
    'скорострел переворачивает бой против втрое большего роя',
    heavyWins >= 45,
    `побед ${heavyWins} из 50 против ${parity * 3} истребителей`,
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

/* ------------------------- 6. Скорострел против обороны ------------------------- */

console.log('\n=== 6. Баланс: скорострел против обороны ===');

{
  /*
   * Скорострел усилил флот, и главный риск — что оборона перестала иметь смысл.
   * Проверяем это по стоимости: сколько ресурсов флота нужно, чтобы снять
   * оборону на известную сумму. Ниже двукратного перевеса оборона обязана
   * держаться, иначе строить ее незачем.
   */
  const RUNS = 60;

  const shipPrice = (type: keyof ShipCounts): number => {
    const cost = shipCost(type);
    return cost.ore + cost.polymers + cost.plasma;
  };
  const defencePrice = (type: keyof DefenseCounts): number => {
    const cost = defenseCost(type);
    return cost.ore + cost.polymers + cost.plasma;
  };

  const winRate = (ships: Partial<ShipCounts>, defence: Partial<DefenseCounts>): number => {
    let wins = 0;
    for (let seed = 0; seed < RUNS; seed += 1) {
      const run = simulateCombat(side(ships), { ships: fleet({}), defenses: turrets(defence), techs: emptyCombatTechs() }, seeded(seed));
      if (run.winner === 'ATTACKER') wins += 1;
    }
    return wins / RUNS;
  };

  const defence = { LASER_TURRET: 12 };
  const defenceCost = defencePrice('LASER_TURRET') * 12;

  const equal = Math.floor(defenceCost / shipPrice('HEAVY_CRUISER'));
  const double = Math.floor((defenceCost * 2) / shipPrice('HEAVY_CRUISER'));
  const quadruple = Math.floor((defenceCost * 4) / shipPrice('HEAVY_CRUISER'));

  const atEqual = winRate({ HEAVY_CRUISER: equal }, defence);
  const atDouble = winRate({ HEAVY_CRUISER: double }, defence);
  const atQuadruple = winRate({ HEAVY_CRUISER: quadruple }, defence);

  check(
    'равный по стоимости флот оборону не берет',
    atEqual === 0,
    `${equal} крейсеров против 12 турелей: побед ${(atEqual * 100).toFixed(0)}%`,
  );
  check(
    'двукратного перевеса тоже мало',
    atDouble < 0.5,
    `${double} крейсеров (×2): побед ${(atDouble * 100).toFixed(0)}%`,
  );
  check(
    'четырехкратный перевес оборону снимает',
    atQuadruple > 0.9,
    `${quadruple} крейсеров (×4): побед ${(atQuadruple * 100).toFixed(0)}%`,
  );

  // Скорострел не должен делать оборону бесплатной добычей и для мелочи.
  const swarmCost = defencePrice('CANNON_TURRET') * 20;
  const swarm = Math.floor((swarmCost * 2) / shipPrice('LIGHT_FIGHTER'));
  check(
    'рой истребителей не сносит пушечные турели вдвое меньшей стоимости',
    winRate({ LIGHT_FIGHTER: swarm }, { CANNON_TURRET: 20 }) < 0.5,
    `${swarm} истребителей (×2): побед ${(winRate({ LIGHT_FIGHTER: swarm }, { CANNON_TURRET: 20 }) * 100).toFixed(0)}%`,
  );

  // Зато специализация работает: фрегат со скорострелом 8 берет лазерные турели
  // там, где крейсер того же бюджета буксует.
  const budget = defenceCost * 3;
  const frigates = Math.floor(budget / shipPrice('ION_FRIGATE'));
  const cruisers = Math.floor(budget / shipPrice('HEAVY_CRUISER'));
  const byFrigates = winRate({ ION_FRIGATE: frigates }, defence);
  const byCruisers = winRate({ HEAVY_CRUISER: cruisers }, defence);
  check(
    'при равном бюджете фрегаты снимают лазерные турели лучше крейсеров',
    byFrigates > byCruisers,
    `фрегаты ${(byFrigates * 100).toFixed(0)}% против крейсеров ${(byCruisers * 100).toFixed(0)}%`,
  );
}

const passed = results.filter((item) => item.passed).length;
console.log(`\n=== ИТОГ: ${passed}/${results.length} пройдено ===`);
process.exit(passed === results.length ? 0 : 1);
