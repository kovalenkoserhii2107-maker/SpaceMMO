/**
 * Боевой модуль (Этап 5). Расчет мгновенный, без раундовой симуляции:
 * сравниваем боевую мощь сторон и списываем потери пропорционально.
 * Модуль чистый и детерминированный — один и тот же ввод всегда дает один и тот же бой.
 */
import { DEFENSE_TYPES, defenseLabel, type DefenseCounts, type DefenseType } from './defenses.js';
import { SHIP_TYPES, shipLabel, type ShipCounts, type ShipType } from './ships.js';

interface CombatProfile {
  /** Урон в единицу боя. */
  attack: number;
  /** Щит поглощает урон, корпус определяет живучесть. */
  shield: number;
  hull: number;
}

const SHIP_COMBAT: Record<ShipType, CombatProfile> = {
  PROBE: { attack: 0, shield: 0, hull: 8 },
  TRANSPORTER: { attack: 2, shield: 4, hull: 40 },
  LIGHT_FIGHTER: { attack: 15, shield: 5, hull: 40 },
};

const DEFENSE_COMBAT: Record<DefenseType, CombatProfile> = {
  ROCKET_LAUNCHER: { attack: 8, shield: 4, hull: 40 },
  LASER_TURRET: { attack: 20, shield: 10, hull: 60 },
};

/** Доля ресурсов со склада побежденного, которую можно вывезти. */
export const PLUNDER_SHARE = 0.5;

export interface SideForces {
  ships: ShipCounts;
  defenses: DefenseCounts;
}

export interface SidePower {
  /** Суммарный урон стороны. */
  firepower: number;
  /** Суммарная живучесть (корпус + щиты). */
  endurance: number;
  /** Итоговая боевая мощь: урон × живучесть. */
  strength: number;
}

export interface UnitLoss {
  key: string;
  label: string;
  lost: number;
  before: number;
}

export interface BattleOutcome {
  winner: 'ATTACKER' | 'DEFENDER';
  attackerPower: SidePower;
  defenderPower: SidePower;
  /** Доля уничтоженного у каждой стороны. */
  attackerLossRatio: number;
  defenderLossRatio: number;
  attackerSurvivors: ShipCounts;
  defenderSurvivorShips: ShipCounts;
  defenderSurvivorDefenses: DefenseCounts;
  attackerLosses: UnitLoss[];
  defenderLosses: UnitLoss[];
}

export function sidePower(forces: SideForces): SidePower {
  let firepower = 0;
  let endurance = 0;

  for (const type of SHIP_TYPES) {
    const count = forces.ships[type];
    if (count <= 0) continue;
    const profile = SHIP_COMBAT[type];
    firepower += count * profile.attack;
    endurance += count * (profile.hull + profile.shield);
  }

  for (const type of DEFENSE_TYPES) {
    const count = forces.defenses[type];
    if (count <= 0) continue;
    const profile = DEFENSE_COMBAT[type];
    firepower += count * profile.attack;
    endurance += count * (profile.hull + profile.shield);
  }

  return { firepower, endurance, strength: firepower * endurance };
}

/**
 * Бой. Побеждает сторона с большей мощью; проигравший теряет всё,
 * победитель — долю, равную отношению сил. Равенство трактуется в пользу защитника.
 */
export function resolveBattle(attacker: SideForces, defender: SideForces): BattleOutcome {
  const attackerPower = sidePower(attacker);
  const defenderPower = sidePower(defender);

  // Флот без единой пушки не может никого уничтожить — атака проваливается.
  const attackerWins =
    attackerPower.firepower > 0 && attackerPower.strength > defenderPower.strength;

  const attackerLossRatio = attackerWins
    ? safeRatio(defenderPower.strength, attackerPower.strength)
    : 1;
  const defenderLossRatio = attackerWins
    ? 1
    : safeRatio(attackerPower.strength, defenderPower.strength);

  const attackerSurvivors = applyShipLosses(attacker.ships, attackerLossRatio);
  const defenderSurvivorShips = applyShipLosses(defender.ships, defenderLossRatio);
  const defenderSurvivorDefenses = applyDefenseLosses(defender.defenses, defenderLossRatio);

  return {
    winner: attackerWins ? 'ATTACKER' : 'DEFENDER',
    attackerPower,
    defenderPower,
    attackerLossRatio: round3(attackerLossRatio),
    defenderLossRatio: round3(defenderLossRatio),
    attackerSurvivors,
    defenderSurvivorShips,
    defenderSurvivorDefenses,
    attackerLosses: shipLosses(attacker.ships, attackerSurvivors),
    defenderLosses: [
      ...shipLosses(defender.ships, defenderSurvivorShips),
      ...defenseLosses(defender.defenses, defenderSurvivorDefenses),
    ],
  };
}

/** Сколько ресурсов можно вывезти: половина склада, но не больше трюмов. */
export function plunderAmount(
  stock: { metal: number; crystal: number },
  capacity: number,
): { metal: number; crystal: number } {
  if (capacity <= 0) return { metal: 0, crystal: 0 };

  const availableMetal = Math.max(0, Math.floor(stock.metal * PLUNDER_SHARE));
  const availableCrystal = Math.max(0, Math.floor(stock.crystal * PLUNDER_SHARE));

  // Сначала грузим металл, остаток трюмов — под кристаллы.
  const metal = Math.min(availableMetal, capacity);
  const crystal = Math.min(availableCrystal, Math.max(0, capacity - metal));
  return { metal, crystal };
}

function safeRatio(part: number, whole: number): number {
  if (whole <= 0) return 1;
  return Math.min(1, part / whole);
}

function applyShipLosses(ships: ShipCounts, lossRatio: number): ShipCounts {
  const survivors = { PROBE: 0, TRANSPORTER: 0, LIGHT_FIGHTER: 0 } as ShipCounts;
  for (const type of SHIP_TYPES) {
    survivors[type] = survive(ships[type], lossRatio);
  }
  return survivors;
}

function applyDefenseLosses(defenses: DefenseCounts, lossRatio: number): DefenseCounts {
  const survivors = { ROCKET_LAUNCHER: 0, LASER_TURRET: 0 } as DefenseCounts;
  for (const type of DEFENSE_TYPES) {
    survivors[type] = survive(defenses[type], lossRatio);
  }
  return survivors;
}

/** Потери округляются вверх: половина корабля не выживает. */
function survive(count: number, lossRatio: number): number {
  if (count <= 0) return 0;
  if (lossRatio >= 1) return 0;
  return Math.max(0, count - Math.ceil(count * lossRatio));
}

function shipLosses(before: ShipCounts, after: ShipCounts): UnitLoss[] {
  return SHIP_TYPES.filter((type) => before[type] > 0).map((type) => ({
    key: type,
    label: shipLabel(type),
    before: before[type],
    lost: before[type] - after[type],
  }));
}

function defenseLosses(before: DefenseCounts, after: DefenseCounts): UnitLoss[] {
  return DEFENSE_TYPES.filter((type) => before[type] > 0).map((type) => ({
    key: type,
    label: defenseLabel(type),
    before: before[type],
    lost: before[type] - after[type],
  }));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
