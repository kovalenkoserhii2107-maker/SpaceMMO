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
  metal: number;
  crystal: number;
  deuterium: number;
  storageLevel: number;
}

export interface SimulationResult {
  winner: 'ATTACKER' | 'DEFENDER';
  attackerWins: boolean;
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
    metal: number;
    crystal: number;
    deuterium: number;
    protectedAmount: number;
    surplus: number;
    takeable: number;
    cargoLimited: boolean;
  } | null;
  /** Грузоподъемность уцелевшей части флота. */
  survivingCapacity: number;
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
  const outcome = resolveBattle(attacker, defender);

  const survivingCapacity = fleetCapacity(outcome.attackerSurvivors);
  const plunder =
    stock && outcome.winner === 'ATTACKER'
      ? plunderAmount(stock, storageCapacityForLevel(stock.storageLevel), survivingCapacity)
      : null;

  return {
    winner: outcome.winner,
    attackerWins: outcome.winner === 'ATTACKER',
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
          metal: plunder.metal,
          crystal: plunder.crystal,
          deuterium: plunder.deuterium,
          protectedAmount: Math.round(plunder.protectedAmount),
          surplus: Math.round(plunder.surplus),
          takeable: plunder.takeable,
          cargoLimited: plunder.cargoLimited,
        }
      : null,
    survivingCapacity,
  };
}
