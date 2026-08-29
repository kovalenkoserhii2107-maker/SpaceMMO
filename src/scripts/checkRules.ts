/** Быстрая проверка формул Этапов 1-2 (sanity-check в консоли, не тест-раннер). */
import {
  buildSeconds,
  emptyLevels,
  systemModifiers,
  energyEfficiency,
  energyOutput,
  energyUsage,
  productionPerSecond,
  upgradeCost,
} from '../game/rules.js';
import { economyBonuses, emptyTechLevels, researchCost, researchSeconds } from '../game/techTree.js';
import { shipUnitSeconds, SHIP_TYPES, type ShipCounts } from '../game/ships.js';
import { fleetCapacity, planFlight } from '../game/fleets.js';
import { plunderAmount, resolveBattle } from '../game/combat.js';
import { expeditionSlots, resolveExpedition } from '../game/expeditions.js';
import { defenseUnitSeconds, emptyDefenseCounts, type DefenseCounts } from '../game/defenses.js';

const richness = { metal: 1.0, crystal: 1.0, deuterium: 1.0, energy: 1.0, antimatter: 1.0 };
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

console.log('\n--- Логистика (реактивный двигатель ур.1) ---');
{
  const drive = { ...emptyTechLevels(), COMBUSTION_DRIVE: 1 };
  const cases: Array<[string, ShipCounts]> = [
    ['1 зонд', { PROBE: 1, TRANSPORTER: 0, LIGHT_FIGHTER: 0 }],
    ['2 транспорта', { PROBE: 0, TRANSPORTER: 2, LIGHT_FIGHTER: 0 }],
    ['транспорт + 5 истребителей', { PROBE: 0, TRANSPORTER: 1, LIGHT_FIGHTER: 5 }],
  ];
  for (const [label, ships] of cases) {
    for (const distance of [1, 3]) {
      const home = { position: 1, system: { galaxyX: 5, galaxyY: 5 } };
      const plan = planFlight(ships, drive, home, { position: 1 + distance, system: home.system });
      console.log(
        `${label}, ${distance} орбит: ${plan.flightSeconds} с в одну сторону, ` +
          `трюмы ${plan.capacity}, топливо туда-обратно ${plan.fuel} De`,
      );
    }
  }
}

console.log('\n--- Бой (Этап 5) ---');
{
  const noDefense = emptyDefenseCounts();
  const cases: Array<[string, ShipCounts, ShipCounts, DefenseCounts]> = [
    [
      '6 истребителей + 4 транспорта против 6 ракетных',
      { PROBE: 0, TRANSPORTER: 4, LIGHT_FIGHTER: 6 },
      { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 0 },
      { ROCKET_LAUNCHER: 6, LASER_TURRET: 0 },
    ],
    [
      '1 транспорт против 4 ракетных',
      { PROBE: 0, TRANSPORTER: 1, LIGHT_FIGHTER: 0 },
      { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 0 },
      { ROCKET_LAUNCHER: 4, LASER_TURRET: 0 },
    ],
    [
      '10 истребителей против 3 лазеров и 2 истребителей',
      { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 10 },
      { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 2 },
      { ROCKET_LAUNCHER: 0, LASER_TURRET: 3 },
    ],
  ];

  for (const [label, attackerShips, defenderShips, defenderDefenses] of cases) {
    const outcome = resolveBattle(
      { ships: attackerShips, defenses: noDefense },
      { ships: defenderShips, defenses: defenderDefenses },
    );
    const capacity = fleetCapacity(outcome.attackerSurvivors);
    const loot = plunderAmount({ metal: 100000, crystal: 100000 }, capacity);
    console.log(
      `${label}: победа — ${outcome.winner === 'ATTACKER' ? 'атакующий' : 'защитник'}, ` +
        `мощь ${Math.round(outcome.attackerPower.strength)} против ${Math.round(outcome.defenderPower.strength)}, ` +
        `потери атакующего ${(outcome.attackerLossRatio * 100).toFixed(0)}%, ` +
        `защитника ${(outcome.defenderLossRatio * 100).toFixed(0)}%, ` +
        `вывезти можно ${loot.metal + loot.crystal}`,
    );
  }
}

console.log('\n--- Этап 6: антиматерия и аномалии ---');
{
  const levels = { ...emptyLevels(), SOLAR_PLANT: 12, ANTIMATTER_SYNTH: 3 };
  const rich = { ...richness, antimatter: 1.2 };
  for (const [label, anomaly] of [['обычная система', 'NONE'], ['черная дыра', 'BLACK_HOLE']] as const) {
    const mods = systemModifiers(anomaly);
    const production = productionPerSecond(levels, rich, economyBonuses(techs), 0, mods);
    console.log(
      `${label}: антиматерия ${production.antimatter.toFixed(4)}/с, ` +
        `стройка синтезатора ур.4 ${buildSeconds('ANTIMATTER_SYNTH', 4, mods)} с, ` +
        `гиперфизика ур.1 ${researchSeconds('HYPERSPACE_PHYSICS', 1, 3, techs, mods)} с`,
    );
  }
}

console.log('\n--- Этап 6: гиперпрыжки ---');
{
  const home = { position: 2, system: { galaxyX: 4, galaxyY: 4 } };
  const fleet: ShipCounts = { PROBE: 0, TRANSPORTER: 3, LIGHT_FIGHTER: 2 };
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

console.log('\n--- Этап 7: искажение времени на верфи ---');
{
  for (const [label, anomaly] of [['обычная система', 'NONE'], ['черная дыра', 'BLACK_HOLE']] as const) {
    const mods = systemModifiers(anomaly);
    console.log(
      `${label}: истребитель ${shipUnitSeconds('LIGHT_FIGHTER', 2, mods)} с, ` +
        `транспорт ${shipUnitSeconds('TRANSPORTER', 2, mods)} с, ` +
        `лазерное орудие ${defenseUnitSeconds('LASER_TURRET', 2, mods)} с`,
    );
  }
}

console.log('\n--- Этап 7: экспедиции ---');
{
  const fleet: ShipCounts = { PROBE: 0, TRANSPORTER: 4, LIGHT_FIGHTER: 6 };
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
      loot += result.loot.metal + result.loot.crystal;
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

console.log('\n--- Этап 7: все ветви событийного движка ---');
{
  const strong: ShipCounts = { PROBE: 0, TRANSPORTER: 3, LIGHT_FIGHTER: 12 };
  const weak: ShipCounts = { PROBE: 0, TRANSPORTER: 1, LIGHT_FIGHTER: 0 };
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
