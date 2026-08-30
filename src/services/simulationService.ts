/**
 * Боевой симулятор: тот же расчет, что и в бою, но без последствий.
 *
 * Модуль намеренно тонкий — он не повторяет боевую математику, а зовет
 * `resolveBattle`. Иначе симулятор и реальный бой разошлись бы при первом же
 * изменении баланса, и игрок планировал бы атаку по неверным цифрам.
 * Ни одной записи в БД здесь нет: считаем и отдаем отчет.
 */
import {
  plunderAmount,
  resolveBattle,
  type AbsorptionReport,
  type SideForces,
  type UnitLoss,
} from '../game/combat.js';
import { emptyDefenseCounts, type DefenseCounts } from '../game/defenses.js';
import { fleetCapacity } from '../game/fleets.js';
import { storageCapacityForLevel } from '../game/rules.js';
import type { ShipCounts } from '../game/ships.js';

/** Склад защитника: без него нельзя оценить, ради чего вообще лететь. */
export interface SimulationStock {
  ore: number;
  polymers: number;
  plasma: number;
  storageLevel: number;
}

export interface SimulationResult {
  winner: 'ATTACKER' | 'DEFENDER';
  /**
   * Настоящий исход движка, включая ничью.
   *
   * `winner` ничьей не знает: переходник отдает поле защитнику, потому что
   * атакующий его не занял. Отчету этого мало — «ничья» и «поражение» читаются
   * игроком по-разному, поэтому исход едет отдельным полем.
   */
  result: 'ATTACKER' | 'DEFENDER' | 'DRAW';
  attackerWins: boolean;
  /** Сколько раундов реально отстрелялись: бой мог кончиться раньше шестого. */
  rounds: number;
  attackerPower: number;
  defenderPower: number;
  attackerLossRatio: number;
  defenderLossRatio: number;
  attackerLosses: UnitLoss[];
  defenderLosses: UnitLoss[];
  attackerSurvivors: ShipCounts;
  attackerDamageReport: AbsorptionReport;
  defenderDamageReport: AbsorptionReport;
  /** Сколько увезут уцелевшие трюмы, если склад защитника задан. */
  plunder: {
    ore: number;
    polymers: number;
    plasma: number;
    protectedAmount: number;
    surplus: number;
    takeable: number;
    cargoLimited: boolean;
  } | null;
  /** Грузоподъемность уцелевшей части флота. */
  survivingCapacity: number;
  /**
   * Обломки, которые осядут на орбите после боя.
   * Часть из них — потери самого атакующего, поэтому цифра полезна обеим
   * сторонам: она показывает, что оставит после себя вылет.
   */
  debris: { ore: number; polymers: number };
}

/**
 * Зерно из самого состава боя.
 *
 * Бой стал случайным, но предпросмотр обязан быть устойчивым: если один и тот же
 * состав каждый раз дает новый ответ, планировать по нему нельзя. Зерно выводится
 * из введенных чисел, поэтому повторный запрос повторяет прогон, а любое изменение
 * состава дает новый бросок.
 */
function seedFrom(parts: number[]): () => number {
  let state = 2166136261 >>> 0;
  for (const value of parts) {
    state ^= Math.trunc(value) >>> 0;
    state = Math.imul(state, 16777619) >>> 0;
  }
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function simulateBattle(
  attackerShips: ShipCounts,
  defenderShips: ShipCounts,
  defenderDefenses: DefenseCounts,
  stock: SimulationStock | null,
): SimulationResult {
  // Стационарная оборона не летает, поэтому у атакующего ее нет по определению.
  const attacker: SideForces = { ships: attackerShips, defenses: emptyDefenseCounts() };
  const defender: SideForces = { ships: defenderShips, defenses: defenderDefenses };

  const rng = seedFrom([
    ...Object.values(attackerShips),
    ...Object.values(defenderShips),
    ...Object.values(defenderDefenses),
  ]);
  const outcome = resolveBattle(attacker, defender, { rng });

  const survivingCapacity = fleetCapacity(outcome.attackerSurvivors);
  const plunder =
    stock && outcome.winner === 'ATTACKER'
      ? plunderAmount(stock, storageCapacityForLevel(stock.storageLevel), survivingCapacity)
      : null;

  return {
    winner: outcome.winner,
    result: outcome.combat.winner,
    attackerWins: outcome.winner === 'ATTACKER',
    rounds: outcome.combat.rounds.length,
    attackerPower: Math.round(outcome.attackerPower.firepower),
    defenderPower: Math.round(outcome.defenderPower.firepower),
    attackerLossRatio: outcome.attackerLossRatio,
    defenderLossRatio: outcome.defenderLossRatio,
    attackerLosses: outcome.attackerLosses,
    defenderLosses: outcome.defenderLosses,
    attackerSurvivors: outcome.attackerSurvivors,
    attackerDamageReport: outcome.attackerDamageReport,
    defenderDamageReport: outcome.defenderDamageReport,
    plunder: plunder
      ? {
          ore: plunder.ore,
          polymers: plunder.polymers,
          plasma: plunder.plasma,
          protectedAmount: Math.round(plunder.protectedAmount),
          surplus: Math.round(plunder.surplus),
          takeable: plunder.takeable,
          cargoLimited: plunder.cargoLimited,
        }
      : null,
    survivingCapacity,
    debris: outcome.debris,
  };
}
