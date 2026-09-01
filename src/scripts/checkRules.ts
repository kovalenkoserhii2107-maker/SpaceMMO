/** Быстрая проверка игровых формул (sanity-check в консоли, не тест-раннер). */
import {
  buildSeconds,
  emptyLevels,
  systemModifiers,
  energyEfficiency,
  energyOutput,
  energyUsage,
  productionPerSecond,
  storageCapacityForLevel,
  storageState,
  upgradeCost,
} from '../game/rules.js';
import { economyBonuses, emptyTechLevels, researchCost, researchSeconds } from '../game/techTree.js';
import { emptyShipCounts, shipUnitSeconds, SHIP_TYPES, type ShipCounts } from '../game/ships.js';
import { fleetCapacity, planFlight } from '../game/fleets.js';
import { emptyCombatTechs, plunderAmount, simulateCombat } from '../game/combat.js';
import { expeditionSlots, resolveExpedition } from '../game/expeditions.js';
import { defenseUnitSeconds, emptyDefenseCounts, type DefenseCounts } from '../game/defenses.js';

const richness = { ore: 1.0, polymers: 1.0, plasma: 1.0, energy: 1.0, antimatter: 1.0 };
const techs = emptyTechLevels();
const bonuses = economyBonuses(techs);

console.log('--- Шахта руды без солнечной станции (дефицит энергии режет добычу) ---');
for (const level of [1, 5, 8, 9, 12]) {
  const levels = { ...emptyLevels(), ORE_MINE: level };
  const efficiency = energyEfficiency(levels, richness, bonuses);
  console.log(
    `ур.${level}: добыча ${productionPerSecond(levels, richness, bonuses).ore.toFixed(2)}/с, ` +
      `энергия ${energyUsage(levels).toFixed(1)}/${energyOutput(levels, richness, bonuses).toFixed(1)}, ` +
      `эффективность ${(efficiency * 100).toFixed(0)}%, ` +
      `цена след. ур. ${upgradeCost('ORE_MINE', level + 1).ore} Ti / ${buildSeconds('ORE_MINE', level + 1)} с`,
  );
}

console.log('\n--- Влияние технологий (шахта ур.8) ---');
for (const [mining, energy] of [[0, 0], [5, 0], [5, 10]] as Array<[number, number]>) {
  const withTech = { ...emptyTechLevels(), MINING_TECH: mining, ENERGY_TECH: energy };
  const levels = { ...emptyLevels(), ORE_MINE: 8 };
  const b = economyBonuses(withTech);
  console.log(
    `горное дело ${mining}, энергетика ${energy}: ` +
      `добыча ${productionPerSecond(levels, richness, b).ore.toFixed(2)}/с, ` +
      `эффективность ${(energyEfficiency(levels, richness, b) * 100).toFixed(0)}%`,
  );
}

console.log('\n--- Исследования (лаборатория ур.1) ---');
for (const tech of ['ENERGY_TECH', 'COMPUTING_TECH', 'MINING_TECH', 'COMBUSTION_DRIVE'] as const) {
  const cost = researchCost(tech, 1);
  console.log(
    `${tech}: ${cost.ore} Ti / ${cost.polymers} Si / ${cost.plasma} Tr, ` +
      `${researchSeconds(tech, 1, 1, techs)} с`,
  );
}

console.log('\n--- Верфь ---');
for (const ship of SHIP_TYPES) {
  console.log(`${ship}: верфь ур.1 — ${shipUnitSeconds(ship, 1)} с, ур.3 — ${shipUnitSeconds(ship, 3)} с`);
}

console.log('\n--- Логистика (реактивный двигатель ур.1) ---');
{
  const drive = { ...emptyTechLevels(), COMBUSTION_DRIVE: 1 };
  const cases: Array<[string, ShipCounts]> = [
    ['1 зонд', { ...emptyShipCounts(), PROBE: 1, SMALL_CARGO: 0, LIGHT_FIGHTER: 0 }],
    ['2 транспорта', { ...emptyShipCounts(), PROBE: 0, SMALL_CARGO: 2, LIGHT_FIGHTER: 0 }],
    ['транспорт + 5 истребителей', { ...emptyShipCounts(), PROBE: 0, SMALL_CARGO: 1, LIGHT_FIGHTER: 5 }],
  ];
  for (const [label, ships] of cases) {
    for (const distance of [1, 3]) {
      const home = { position: 1, system: { galaxyX: 5, galaxyY: 5 } };
      const plan = planFlight(ships, drive, home, { position: 1 + distance, system: home.system });
      console.log(
        `${label}, ${distance} орбит: ${plan.flightSeconds} с в одну сторону, ` +
          `трюмы ${plan.capacity}, топливо туда-обратно ${plan.fuel} Tr`,
      );
    }
  }
}

console.log('\n--- Бой: раунды, щиты и разброс исходов ---');
{
  const fleet = (partial: Partial<ShipCounts>): ShipCounts => ({ ...emptyShipCounts(), ...partial });
  const defense = (partial: Partial<DefenseCounts>): DefenseCounts => ({ ...emptyDefenseCounts(), ...partial });
  const noDefense = emptyDefenseCounts();

  const cases: Array<[string, ShipCounts, ShipCounts, DefenseCounts]> = [
    ['крейсера против ионных фрегатов (равная цена)', fleet({ CRUISER: 10 }), fleet({ FRIGATE: 13 }), emptyDefenseCounts()],
    ['фрегаты против крейсеров (тот же бой наоборот)', fleet({ FRIGATE: 13 }), fleet({ CRUISER: 10 }), emptyDefenseCounts()],
    ['крейсера против лазерных турелей', fleet({ CRUISER: 6 }), fleet({}), defense({ CANNON: 0, LASER: 12 })],
    ['фрегаты против тех же турелей', fleet({ FRIGATE: 8 }), fleet({}), defense({ CANNON: 0, LASER: 12 })],
    ['рой истребителей против пушечных турелей', fleet({ LIGHT_FIGHTER: 20 }), fleet({}), defense({ CANNON: 10, LASER: 0 })],
    ['одинокий крейсер против роя истребителей', fleet({ CRUISER: 1 }), fleet({ LIGHT_FIGHTER: 10 }), emptyDefenseCounts()],
  ];

  // Бой стал случайным, поэтому один прогон ничего не показывает: гоняем серию
  // и печатаем долю побед и средние потери — по ним и виден баланс.
  const RUNS = 200;
  for (const [label, attackerShips, defenderShips, defenderDefenses] of cases) {
    let attackerWins = 0;
    let draws = 0;
    let attackerLoss = 0;
    let defenderLoss = 0;
    let debris = 0;

    for (let i = 0; i < RUNS; i += 1) {
      const outcome = simulateCombat(
        { ships: attackerShips, defenses: noDefense, techs: emptyCombatTechs() },
        { ships: defenderShips, defenses: defenderDefenses, techs: emptyCombatTechs() },
      );
      if (outcome.winner === 'ATTACKER') attackerWins += 1;
      if (outcome.winner === 'DRAW') draws += 1;
      attackerLoss += countLost(outcome.attackerLosses);
      defenderLoss += countLost(outcome.defenderLosses);
      debris += outcome.debris.ore + outcome.debris.polymers;
    }

    console.log(
      `${label}:\n` +
        `    побед атакующего ${((attackerWins / RUNS) * 100).toFixed(0)}%, ` +
        `ничьих ${((draws / RUNS) * 100).toFixed(0)}%\n` +
        `    средние потери: атакующий ${(attackerLoss / RUNS).toFixed(1)} юнитов, ` +
        `защитник ${(defenderLoss / RUNS).toFixed(1)}; обломков ${Math.round(debris / RUNS)}`,
    );
  }
}

function countLost(losses: Array<{ lost: number }>): number {
  return losses.reduce((sum, item) => sum + item.lost, 0);
}

console.log('\n--- Воспроизводимость при заданном зерне ---');
{
  const seeded = (seed: number) => {
    let state = seed >>> 0;
    return () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 0x100000000;
    };
  };

  const attacker = { ships: { ...emptyShipCounts(), CRUISER: 7, LIGHT_FIGHTER: 12 }, defenses: emptyDefenseCounts(), techs: emptyCombatTechs() };
  const defender = { ships: { ...emptyShipCounts(), FRIGATE: 9 }, defenses: { ...emptyDefenseCounts(), CANNON: 5, LASER: 4 }, techs: emptyCombatTechs() };

  const sameSeed = new Set(
    Array.from({ length: 20 }, () => JSON.stringify(simulateCombat(attacker, defender, seeded(2024)).attackerLosses)),
  );
  const freeRoll = new Set(
    Array.from({ length: 20 }, () => JSON.stringify(simulateCombat(attacker, defender).attackerLosses)),
  );

  console.log(`одно зерно, 20 прогонов: уникальных исходов ${sameSeed.size}`);
  console.log(`живые кости, 20 прогонов: уникальных исходов ${freeRoll.size}`);
}

console.log('\n--- Антиматерия и аномалии ---');
{
  const levels = { ...emptyLevels(), POWER_PLANT: 12, ANTIMATTER_FACTORY: 3 };
  const rich = { ...richness, antimatter: 1.2 };
  for (const [label, anomaly] of [['обычная система', 'NONE'], ['черная дыра', 'BLACK_HOLE']] as const) {
    const mods = systemModifiers(anomaly);
    const production = productionPerSecond(levels, rich, economyBonuses(techs), 0, mods);
    console.log(
      `${label}: антиматерия ${production.antimatter.toFixed(4)}/с, ` +
        `стройка синтезатора ур.4 ${buildSeconds('ANTIMATTER_FACTORY', 4, mods)} с, ` +
        `гиперфизика ур.1 ${researchSeconds('HYPERSPACE_PHYSICS', 1, 3, techs, mods)} с`,
    );
  }
}

console.log('\n--- Гиперпрыжки ---');
{
  const home = { position: 2, system: { galaxyX: 4, galaxyY: 4 } };
  const fleet: ShipCounts = { ...emptyShipCounts(), PROBE: 0, SMALL_CARGO: 3, LIGHT_FIGHTER: 2 };
  for (const [label, drive] of [['гипердвигатель ур.1', 1], ['гипердвигатель ур.4', 4]] as const) {
    const withDrive = { ...emptyTechLevels(), COMBUSTION_DRIVE: 1, HYPERDRIVE: drive };
    for (const target of [{ galaxyX: 7, galaxyY: 8 }, { galaxyX: 15, galaxyY: 16 }]) {
      const plan = planFlight(fleet, withDrive, home, { position: 1, system: target });
      console.log(
        `${label}, дистанция ${plan.distance}: ${plan.flightSeconds} с в одну сторону, ` +
          `антиматерии туда-обратно ${plan.antimatter}`,
      );
    }
  }
}

console.log('\n--- Искажение времени на верфи ---');
{
  for (const [label, anomaly] of [['обычная система', 'NONE'], ['черная дыра', 'BLACK_HOLE']] as const) {
    const mods = systemModifiers(anomaly);
    console.log(
      `${label}: истребитель ${shipUnitSeconds('LIGHT_FIGHTER', 2, mods)} с, ` +
        `транспорт ${shipUnitSeconds('SMALL_CARGO', 2, mods)} с, ` +
        `лазерное орудие ${defenseUnitSeconds('LASER', 2, mods)} с`,
    );
  }
}

console.log('\n--- Экспедиции ---');
{
  const fleet: ShipCounts = { ...emptyShipCounts(), PROBE: 0, SMALL_CARGO: 4, LIGHT_FIGHTER: 6 };
  const capacity = fleetCapacity(fleet);

  for (const level of [1, 4, 9]) {
    const withAstro = { ...emptyTechLevels(), ASTROPHYSICS: level };
    const tally: Record<string, number> = {};
    let loot = 0;
    const runs = 2000;

    // Детерминированный генератор: одинаковая статистика при каждом прогоне.
    let seed = 12345 + level;
    const rng = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let i = 0; i < runs; i += 1) {
      const result = resolveExpedition(fleet, capacity, withAstro, rng);
      tally[result.outcome] = (tally[result.outcome] ?? 0) + 1;
      loot += result.loot.ore + result.loot.polymers;
    }

    const percent = (key: string) => (((tally[key] ?? 0) / runs) * 100).toFixed(1) + '%';
    console.log(
      `астрофизика ур.${level} (слотов ${expeditionSlots(withAstro)}): ` +
        `тишина ${percent('SILENCE')}, находка ${percent('RESOURCES')}, ` +
        `бой выигран ${percent('PIRATES_WON')}, флот потерян ${percent('PIRATES_LOST')}, ` +
        `уклонение ${percent('EVADED')}, средняя добыча ${Math.round(loot / runs)}`,
    );
  }
}

console.log('\n--- Все ветви событийного движка экспедиций ---');
{
  const strong: ShipCounts = { ...emptyShipCounts(), PROBE: 0, SMALL_CARGO: 3, LIGHT_FIGHTER: 12 };
  const weak: ShipCounts = { ...emptyShipCounts(), PROBE: 0, SMALL_CARGO: 1, LIGHT_FIGHTER: 0 };
  const techs1 = { ...emptyTechLevels(), ASTROPHYSICS: 1 };

  /** Подсовываем заранее заданную последовательность бросков. */
  const scripted = (values: number[]): (() => number) => {
    let index = 0;
    return () => values[Math.min(index++, values.length - 1)]!;
  };

  const cases: Array<[string, ShipCounts, number[]]> = [
    ['мертвая тишина', strong, [0.01]],
    ['находка ресурсов', strong, [0.6, 0.1, 0.5]],
    ['находка антиматерии', strong, [0.6, 0.99, 0.5]],
    ['пираты отбиты', strong, [0.99, 0.99, 0.1, 0.1]],
    ['флот потерян', weak, [0.99, 0.99, 0.99, 0.9]],
  ];

  for (const [label, fleet, rolls] of cases) {
    const result = resolveExpedition(fleet, fleetCapacity(fleet), techs1, scripted(rolls));
    const survivors = SHIP_TYPES.reduce((total, type) => total + result.survivors[type], 0);
    console.log(`${label} → ${result.outcome}, уцелело кораблей ${survivors}`);
    console.log(`    «${result.summary}»`);
  }
}

console.log('\n--- Хранилище: вместимость и остановка добычи ---');
{
  for (const level of [0, 1, 2, 3, 5, 8]) {
    console.log(`ур.${level}: вместимость ${storageCapacityForLevel(level)}`);
  }

  // Догон офлайна: шахты качают неделю, но склад держит потолок.
  const levels = { ...emptyLevels(), ORE_MINE: 10, POLYMER_PLANT: 10, PLASMA_REACTOR: 8, POWER_PLANT: 14, STORAGE: 1 };
  const perSecond = productionPerSecond(levels, richness, bonuses);
  const capacity = storageCapacityForLevel(levels.STORAGE);
  const week = 7 * 24 * 3600;

  const stock = { ore: 500, polymers: 300, plasma: 100, antimatter: 0 };
  const mined = (perSecond.ore + perSecond.polymers + perSecond.plasma) * week;
  const used = stock.ore + stock.polymers + stock.plasma;
  const free = Math.max(0, capacity - used);
  const fit = mined > free ? free / mined : 1;

  console.log(
    `неделя офлайна: добыто было бы ${Math.round(mined)}, ` +
      `свободно ${Math.round(free)}, начислено ${Math.round(mined * fit)} (вместимость ${capacity})`,
  );
}

console.log('\n--- Грабеж: механика сейфа ---');
{
  const capacity = storageCapacityForLevel(1);
  const cases: Array<[string, { ore: number; polymers: number; plasma: number }, number]> = [
    ['склад наполовину пуст — защищено всё', { ore: 3000, polymers: 2000, plasma: 0 }, 100000],
    ['склад ровно полон — уязвимы последние 10%', { ore: 6000, polymers: 4000, plasma: 0 }, 100000],
    ['склад переполнен вдвое', { ore: 12000, polymers: 8000, plasma: 0 }, 100000],
    ['плазма вывозится наравне с рудой', { ore: 5000, polymers: 0, plasma: 5000 }, 100000],
    ['трюмов не хватает', { ore: 12000, polymers: 8000, plasma: 0 }, 1000],
  ];

  for (const [label, stock, cargo] of cases) {
    const loot = plunderAmount(stock, capacity, cargo);
    const state = storageState(stock, capacity);
    console.log(
      `${label}: лежало ${Math.round(loot.stored)}, защищено ${Math.round(loot.protectedAmount)}, ` +
        `излишек ${Math.round(loot.surplus)} → увезли ${loot.ore} Ti + ${loot.polymers} Si + ${loot.plasma} Tr` +
        `${loot.cargoLimited ? ' (обрезали трюмы)' : ''}, уязвимо по снимку ${Math.round(state.vulnerable)}`,
    );
  }
}
