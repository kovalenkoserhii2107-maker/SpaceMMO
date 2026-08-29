/**
 * Боевой модуль: типы урона и слоистая защита.
 *
 * Расчет по-прежнему мгновенный и детерминированный — никакой раундовой
 * симуляции и никакого рандома: одинаковый состав сторон всегда дает
 * одинаковый бой, поэтому его можно объяснить игроку цифрами и проверить тестом.
 *
 * Модель:
 * 1. Каждый юнит несет урон одного типа (кинетический, лазерный, ионный)
 *    и защиту из трех слоев: щиты, броня, корпус.
 * 2. Урон проходит слои по порядку: сначала щиты, затем броня, остаток — по корпусу.
 * 3. Тип урона меняет эффективность против конкретного слоя (см. DAMAGE_MULTIPLIERS):
 *    ионный вдвое эффективнее против щитов и вдвое слабее против брони,
 *    кинетический — наоборот, лазерный ровен везде.
 * 4. Побеждает тот, кому нужно меньше времени, чтобы пробить корпус противника.
 *    Проигравший теряет всё, победитель — долю, равную отношению этих времен.
 *
 * Именно поэтому дорогой кинетический флот вязнет в дешевых ионных фрегатах:
 * его урон режется вдвое щитами, а щиты у фрегатов — основной слой защиты.
 */
import { DEFENSE_TYPES, defenseLabel, emptyDefenseCounts, type DefenseCounts, type DefenseType } from './defenses.js';
import { PROTECTED_STORAGE_SHARE } from './rules.js';
import { emptyShipCounts, SHIP_TYPES, shipLabel, type ShipCounts, type ShipType } from './ships.js';

export const DAMAGE_TYPES = ['KINETIC', 'LASER', 'ION'] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const DAMAGE_LABELS: Record<DamageType, string> = {
  KINETIC: 'кинетический',
  LASER: 'лазерный',
  ION: 'ионный',
};

/** Слои защиты в порядке поглощения урона. */
export const DEFENSE_LAYERS = ['shield', 'armor', 'hull'] as const;
export type DefenseLayer = (typeof DEFENSE_LAYERS)[number];

/**
 * Эффективность типа урона против слоя защиты.
 * Ионный разбирает щиты, но вязнет в броне; кинетический — ровно наоборот.
 */
export const DAMAGE_MULTIPLIERS: Record<DamageType, Record<DefenseLayer, number>> = {
  KINETIC: { shield: 0.5, armor: 2.0, hull: 1.0 },
  LASER: { shield: 1.0, armor: 1.0, hull: 1.0 },
  ION: { shield: 2.0, armor: 0.5, hull: 1.0 },
};

interface CombatProfile {
  /** Урон за единицу времени и его тип. Ноль — безоружный юнит. */
  damage: number;
  damageType: DamageType;
  shield: number;
  armor: number;
  hull: number;
}

const SHIP_COMBAT: Record<ShipType, CombatProfile> = {
  PROBE: { damage: 0, damageType: 'LASER', shield: 0, armor: 0, hull: 10 },
  TRANSPORTER: { damage: 0, damageType: 'LASER', shield: 0, armor: 0, hull: 80 },
  LIGHT_FIGHTER: { damage: 15, damageType: 'LASER', shield: 0, armor: 0, hull: 60 },
  HEAVY_CRUISER: { damage: 60, damageType: 'KINETIC', shield: 0, armor: 250, hull: 150 },
  ION_FRIGATE: { damage: 45, damageType: 'ION', shield: 220, armor: 0, hull: 90 },
};

const DEFENSE_COMBAT: Record<DefenseType, CombatProfile> = {
  ROCKET_LAUNCHER: { damage: 12, damageType: 'KINETIC', shield: 0, armor: 0, hull: 80 },
  LASER_TURRET: { damage: 25, damageType: 'LASER', shield: 80, armor: 0, hull: 70 },
};

/** Доля уязвимого излишка, которую победитель успевает вывезти. */
const RAID_SHARE = 0.9;

export interface SideForces {
  ships: ShipCounts;
  defenses: DefenseCounts;
}

/** Слои защиты стороны в сумме по всем юнитам. */
export interface DefensePools {
  shield: number;
  armor: number;
  hull: number;
}

export interface SidePower {
  /** Суммарный урон по типам. */
  damage: Record<DamageType, number>;
  /** Общий урон в единицу времени. */
  firepower: number;
  pools: DefensePools;
  /** Живучесть с учетом типов урона противника — то, что реально надо пробить. */
  effectiveHp: number;
  /** Сколько времени нужно противнику, чтобы уничтожить эту сторону. */
  timeToDie: number;
}

export interface UnitLoss {
  key: string;
  label: string;
  lost: number;
  before: number;
}

/** Сколько урона осело в каждом слое — основа понятного отчета. */
export interface AbsorptionReport {
  shield: number;
  armor: number;
  hull: number;
  /** Тип урона, который наносила сторона, и его доля. */
  damageMix: Array<{ type: DamageType; label: string; amount: number }>;
}

export interface BattleOutcome {
  winner: 'ATTACKER' | 'DEFENDER';
  attackerPower: SidePower;
  defenderPower: SidePower;
  attackerLossRatio: number;
  defenderLossRatio: number;
  attackerSurvivors: ShipCounts;
  defenderSurvivorShips: ShipCounts;
  defenderSurvivorDefenses: DefenseCounts;
  attackerLosses: UnitLoss[];
  defenderLosses: UnitLoss[];
  /** Куда ушел урон атакующего (по защите обороняющегося) и наоборот. */
  attackerDamageReport: AbsorptionReport;
  defenderDamageReport: AbsorptionReport;
}

/** Есть ли во флоте хоть один вооруженный корабль. */
export function hasWeapons(ships: ShipCounts): boolean {
  return SHIP_TYPES.some((type) => ships[type] > 0 && SHIP_COMBAT[type].damage > 0);
}

/** Боевой профиль класса — для карточек в интерфейсе. */
export function shipCombatProfile(type: ShipType): {
  damage: number;
  damageType: DamageType;
  damageLabel: string;
  shield: number;
  armor: number;
  hull: number;
} {
  const profile = SHIP_COMBAT[type];
  return { ...profile, damageLabel: DAMAGE_LABELS[profile.damageType] };
}

/** Боевой профиль оборонительной установки. */
export function defenseCombatProfile(type: DefenseType): {
  damage: number;
  damageType: DamageType;
  damageLabel: string;
  shield: number;
  armor: number;
  hull: number;
} {
  const profile = DEFENSE_COMBAT[type];
  return { ...profile, damageLabel: DAMAGE_LABELS[profile.damageType] };
}

/* ------------------------- Сбор характеристик ------------------------- */

function collectDamage(forces: SideForces): Record<DamageType, number> {
  const damage: Record<DamageType, number> = { KINETIC: 0, LASER: 0, ION: 0 };

  for (const type of SHIP_TYPES) {
    const profile = SHIP_COMBAT[type];
    damage[profile.damageType] += forces.ships[type] * profile.damage;
  }
  for (const type of DEFENSE_TYPES) {
    const profile = DEFENSE_COMBAT[type];
    damage[profile.damageType] += forces.defenses[type] * profile.damage;
  }
  return damage;
}

function collectPools(forces: SideForces): DefensePools {
  const pools: DefensePools = { shield: 0, armor: 0, hull: 0 };

  for (const type of SHIP_TYPES) {
    const profile = SHIP_COMBAT[type];
    const count = forces.ships[type];
    pools.shield += count * profile.shield;
    pools.armor += count * profile.armor;
    pools.hull += count * profile.hull;
  }
  for (const type of DEFENSE_TYPES) {
    const profile = DEFENSE_COMBAT[type];
    const count = forces.defenses[type];
    pools.shield += count * profile.shield;
    pools.armor += count * profile.armor;
    pools.hull += count * profile.hull;
  }
  return pools;
}

/**
 * Средний множитель урона по слою для конкретного состава атакующего.
 * Если у стороны только ионные пушки, множитель против щитов равен 2.0,
 * а против брони — 0.5; смешанный флот получает взвешенное значение.
 */
function averageMultiplier(damage: Record<DamageType, number>, layer: DefenseLayer): number {
  const total = DAMAGE_TYPES.reduce((sum, type) => sum + damage[type], 0);
  if (total <= 0) return 1;

  const weighted = DAMAGE_TYPES.reduce(
    (sum, type) => sum + damage[type] * DAMAGE_MULTIPLIERS[type][layer],
    0,
  );
  return weighted / total;
}

/**
 * Живучесть стороны против конкретного состава урона.
 * Слой, по которому урон бьет слабо, стоит противнику вдвое дороже —
 * поэтому щиты против кинетики «весят» вдвое больше своего номинала.
 */
function effectiveHp(pools: DefensePools, incoming: Record<DamageType, number>): number {
  return (
    pools.shield / averageMultiplier(incoming, 'shield') +
    pools.armor / averageMultiplier(incoming, 'armor') +
    pools.hull / averageMultiplier(incoming, 'hull')
  );
}

/**
 * Распределение нанесенного урона по слоям защиты.
 * Считается для отчета: игрок видит, что его залп целиком осел в щитах.
 */
function absorb(
  pools: DefensePools,
  damage: Record<DamageType, number>,
  rawDamageDealt: number,
): AbsorptionReport {
  let remaining = rawDamageDealt;
  const report: AbsorptionReport = {
    shield: 0,
    armor: 0,
    hull: 0,
    damageMix: DAMAGE_TYPES.filter((type) => damage[type] > 0).map((type) => ({
      type,
      label: DAMAGE_LABELS[type],
      amount: Math.round(damage[type]),
    })),
  };

  for (const layer of DEFENSE_LAYERS) {
    if (remaining <= 0) break;

    const multiplier = averageMultiplier(damage, layer);
    const effective = remaining * multiplier;

    if (layer === 'hull') {
      report.hull = Math.round(Math.min(effective, pools.hull));
      break;
    }

    const absorbed = Math.min(effective, pools[layer]);
    report[layer] = Math.round(absorbed);
    // Возвращаем непоглощенный урон в «сырые» единицы для следующего слоя.
    remaining -= absorbed / multiplier;
  }

  return report;
}

export function sidePower(forces: SideForces, incoming: Record<DamageType, number>): SidePower {
  const damage = collectDamage(forces);
  const pools = collectPools(forces);
  const firepower = DAMAGE_TYPES.reduce((sum, type) => sum + damage[type], 0);
  const hp = effectiveHp(pools, incoming);
  const incomingTotal = DAMAGE_TYPES.reduce((sum, type) => sum + incoming[type], 0);

  return {
    damage,
    firepower,
    pools,
    effectiveHp: Math.round(hp),
    timeToDie: incomingTotal > 0 ? hp / incomingTotal : Number.POSITIVE_INFINITY,
  };
}

/* ------------------------- Бой ------------------------- */

/**
 * Расчет боя. Побеждает сторона, которой нужно меньше времени, чтобы пробить
 * корпус противника; при равенстве держится защитник. Проигравший теряет всё,
 * победитель — долю, равную отношению времен: чем убедительнее перевес,
 * тем дешевле победа.
 */
export function resolveBattle(attacker: SideForces, defender: SideForces): BattleOutcome {
  const attackerDamage = collectDamage(attacker);
  const defenderDamage = collectDamage(defender);

  const attackerPower = sidePower(attacker, defenderDamage);
  const defenderPower = sidePower(defender, attackerDamage);

  // Время до уничтожения противника: сколько нужно стрелять, чтобы снять его защиту.
  const attackerTime = defenderPower.timeToDie;
  const defenderTime = attackerPower.timeToDie;

  const attackerWins =
    attackerPower.firepower > 0 && Number.isFinite(attackerTime) && attackerTime < defenderTime;

  const attackerLossRatio = attackerWins ? safeRatio(attackerTime, defenderTime) : 1;
  const defenderLossRatio = attackerWins ? 1 : safeRatio(defenderTime, attackerTime);

  const attackerSurvivors = applyShipLosses(attacker.ships, attackerLossRatio);
  const defenderSurvivorShips = applyShipLosses(defender.ships, defenderLossRatio);
  const defenderSurvivorDefenses = applyDefenseLosses(defender.defenses, defenderLossRatio);

  // Длительность боя — время победителя; за него обе стороны успевают отстреляться.
  const battleTime = Math.min(attackerTime, defenderTime);
  const finiteTime = Number.isFinite(battleTime) ? battleTime : 0;

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
    attackerDamageReport: absorb(defenderPower.pools, attackerDamage, attackerPower.firepower * finiteTime),
    defenderDamageReport: absorb(attackerPower.pools, defenderDamage, defenderPower.firepower * finiteTime),
  };
}

/** Что удалось вывезти и почему именно столько — основа отчета для агрессора. */
export interface PlunderResult {
  metal: number;
  crystal: number;
  /** Вместимость хранилища защитника. */
  storageCapacity: number;
  /** Сколько всего лежало на складе (металл + кристаллы + дейтерий). */
  stored: number;
  /** Несгораемый объем: 90% вместимости, но не больше того, что реально лежит. */
  protectedAmount: number;
  /** Излишек сверх несгораемого объема — только он и уязвим. */
  surplus: number;
  /** Сколько вывозимого добра дал бы излишек при бесконечных трюмах. */
  takeable: number;
  /** Трюмы уцелевших не вместили всё, что можно было взять. */
  cargoLimited: boolean;
}

/**
 * Сколько ресурсов увезет победитель — механика «сейфа».
 *
 * Хранилище прячет ресурсы в объеме до 90% своей вместимости. Всё сверх этого
 * порога — уязвимый излишек: и последние 10% вместимости, и то, что занесли
 * сверх лимита возвратные рейсы, экспедиции или отмена биржевых ордеров.
 * Агрессор забирает 90% излишка, пропорционально каждому типу ресурса,
 * а итог все так же режется трюмами уцелевших кораблей.
 *
 * Половина склада больше не выносится: полупустая база не теряет ничего,
 * и заполненность склада становится осмысленным риском.
 *
 * Дейтерий занимает место в хранилище и потому выталкивает металл с кристаллами
 * в излишек, но сам не вывозится: транспортных танкеров в игре пока нет.
 */
export function plunderAmount(
  stock: { metal: number; crystal: number; deuterium: number },
  storageCapacity: number,
  cargoCapacity: number,
): PlunderResult {
  const metal = Math.max(0, stock.metal);
  const crystal = Math.max(0, stock.crystal);
  const stored = metal + crystal + Math.max(0, stock.deuterium);

  const protectedAmount = Math.min(stored, Math.max(0, storageCapacity) * PROTECTED_STORAGE_SHARE);
  const surplus = Math.max(0, stored - protectedAmount);

  // Доля каждого ресурса, которая уходит агрессору: излишек «размазан» по складу
  // пропорционально, поэтому пропорцию считаем один раз и применяем ко всем типам.
  const share = stored > 0 ? (RAID_SHARE * surplus) / stored : 0;
  const availableMetal = Math.floor(metal * share);
  const availableCrystal = Math.floor(crystal * share);
  const takeable = availableMetal + availableCrystal;

  const room = Math.max(0, cargoCapacity);
  const takenMetal = Math.min(availableMetal, room);
  const takenCrystal = Math.min(availableCrystal, room - takenMetal);

  return {
    metal: takenMetal,
    crystal: takenCrystal,
    storageCapacity,
    stored,
    protectedAmount,
    surplus,
    takeable,
    cargoLimited: takenMetal + takenCrystal < takeable,
  };
}

function safeRatio(part: number, whole: number): number {
  if (!Number.isFinite(whole) || whole <= 0) return 0;
  if (!Number.isFinite(part)) return 1;
  return Math.min(1, part / whole);
}

function applyShipLosses(ships: ShipCounts, lossRatio: number): ShipCounts {
  const survivors = emptyShipCounts();
  for (const type of SHIP_TYPES) survivors[type] = survive(ships[type], lossRatio);
  return survivors;
}

function applyDefenseLosses(defenses: DefenseCounts, lossRatio: number): DefenseCounts {
  const survivors = emptyDefenseCounts();
  for (const type of DEFENSE_TYPES) survivors[type] = survive(defenses[type], lossRatio);
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
