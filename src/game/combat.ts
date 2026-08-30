/**
 * Боевой движок: раундовая симуляция со случайным выбором целей.
 *
 * Модель:
 * 1. У юнита три характеристики — атака, щит и корпус. Щит поглощает урон первым
 *    и полностью восстанавливается в начале каждого раунда, корпус не лечится.
 *    Юнит гибнет, когда корпус уходит в ноль.
 * 2. Каждый живой юнит один раз за раунд стреляет по случайной цели противника.
 *    Промахнуться нельзя, но выстрел может целиком уйти в щит и не оставить следа —
 *    именно поэтому рой дешевых истребителей бессилен против одного крейсера.
 * 3. Бой идет до шести раундов. Побеждает тот, у кого противник кончился;
 *    если после шестого раунда живы обе стороны — ничья, поле остается
 *    за защитником.
 *
 * Случайность вынесена в параметр `rng`. Реальный бой бросает настоящие кости,
 * а тесты и предпросмотр подставляют предсказуемый генератор и получают
 * воспроизводимый результат — иначе ни проверить движок, ни планировать атаку.
 */
import {
  DEFENSE_TYPES,
  defenseLabel,
  emptyDefenseCounts,
  type DefenseCounts,
  type DefenseType,
} from './defenses.js';
import { PROTECTED_STORAGE_SHARE } from './rules.js';
import {
  emptyShipCounts,
  SHIP_TYPES,
  shipCost,
  shipLabel,
  type ShipCounts,
  type ShipType,
} from './ships.js';
import { emptyTechLevels, type TechLevels } from './techTree.js';

export type Rng = () => number;

/** Сколько раундов длится бой. */
export const MAX_ROUNDS = 6;

/**
 * Какая часть стоимости уничтоженных кораблей остается на орбите обломками.
 * Оборона в обломки не идет: разбитые турели остаются на поверхности планеты.
 */
export const DEBRIS_SHARE = 0.3;

/** Шанс, что разбитая оборона будет восстановлена после боя. */
export const DEFENCE_RECOVERY_CHANCE = 0.7;

/**
 * Скорострел: сколько выстрелов юнит успевает сделать по мелкой цели.
 *
 * Без него тяжелый корабль математически невыгоден: он бьет раз в раунд по одной
 * цели, поэтому рой дешевых истребителей всегда эффективнее по стоимости.
 * Скорострел это чинит — после каждого попадания стрелок продолжает огонь
 * с вероятностью (N−1)/N, то есть в среднем делает N выстрелов по такой цели.
 *
 * Матрица односторонняя: крейсер выкашивает истребителей, но истребитель
 * по крейсеру стреляет ровно раз.
 */
const RAPID_FIRE: Partial<Record<string, Partial<Record<string, number>>>> = {
  HEAVY_CRUISER: { LIGHT_FIGHTER: 10, PROBE: 5, TRANSPORTER: 5 },
  ION_FRIGATE: { LASER_TURRET: 8, PROBE: 5, TRANSPORTER: 5 },
  LIGHT_FIGHTER: { CANNON_TURRET: 3 },
};

/**
 * Предохранитель на серию выстрелов. При N = 10 средняя очередь — десять
 * выстрелов, но теоретически она не ограничена: обрываем заведомо недостижимой
 * для нормального боя длиной, чтобы неудачная серия бросков не подвесила тик.
 */
const MAX_RAPID_FIRE_SHOTS = 100;

export function rapidFireAgainst(shooter: string, target: string): number {
  return RAPID_FIRE[shooter]?.[target] ?? 1;
}

/**
 * Боевой профиль юнита.
 *
 * `shieldPiercing` — множитель урона по щиту. У ионного фрегата он больше единицы:
 * фрегат слаб по корпусу, но снимает щиты вдвое быстрее, и его роль — вскрывать
 * защиту тяжелых кораблей, а не убивать их самому.
 */
export interface UnitStats {
  attack: number;
  shield: number;
  hull: number;
  shieldPiercing: number;
}

/*
 * Баланс.
 *
 * Истребитель — расходник: дешев, бьет слабо, гибнет от любого серьезного залпа.
 * Крейсер — танк: щит выше, чем залп истребителя, поэтому рой его не берет,
 * зато он дорог и медлителен. Фрегат — вскрыватель щитов, по корпусу посредственен.
 * Зонд, транспорт и переработчик безоружны; у переработчика толстый корпус,
 * потому что он лезет на поле боя за обломками.
 */
const SHIP_COMBAT: Record<ShipType, UnitStats> = {
  PROBE: { attack: 0, shield: 0, hull: 10, shieldPiercing: 1 },
  TRANSPORTER: { attack: 0, shield: 10, hull: 80, shieldPiercing: 1 },
  LIGHT_FIGHTER: { attack: 15, shield: 10, hull: 60, shieldPiercing: 1 },
  HEAVY_CRUISER: { attack: 100, shield: 50, hull: 400, shieldPiercing: 1 },
  ION_FRIGATE: { attack: 45, shield: 80, hull: 120, shieldPiercing: 2 },
  RECYCLER: { attack: 0, shield: 10, hull: 400, shieldPiercing: 1 },
};

/*
 * Оборона дешевле флота за единицу боевой мощи, но не летает и не дает обломков.
 * Пушечная турель — массовый заслон, лазерная — дорогая и с хорошим щитом.
 */
const DEFENSE_COMBAT: Record<DefenseType, UnitStats> = {
  CANNON_TURRET: { attack: 40, shield: 20, hull: 200, shieldPiercing: 1 },
  LASER_TURRET: { attack: 70, shield: 50, hull: 250, shieldPiercing: 1 },
};

export function shipStats(type: ShipType): UnitStats {
  return { ...SHIP_COMBAT[type] };
}

export function defenseStats(type: DefenseType): UnitStats {
  return { ...DEFENSE_COMBAT[type] };
}

/* ------------------------- Технологии ------------------------- */

/**
 * Множители характеристик от изученных технологий.
 *
 * Каждая боевая ветка дает +10% к своей характеристике за уровень и применяется
 * ко всему, что стоит на стороне: и к кораблям, и к обороне. «Энергетика» на бой
 * не влияет — за щиты отвечает щитовая технология, и дублировать роли незачем.
 */
export interface CombatBonuses {
  attack: number;
  shield: number;
  hull: number;
}

/** Прирост характеристики за уровень боевой технологии. */
export const COMBAT_TECH_BONUS_PER_LEVEL = 0.1;

export function combatBonuses(techs: TechLevels): CombatBonuses {
  const step = COMBAT_TECH_BONUS_PER_LEVEL;
  return {
    attack: 1 + Math.max(0, techs.WEAPONS_TECH) * step,
    shield: 1 + Math.max(0, techs.SHIELDS_TECH) * step,
    hull: 1 + Math.max(0, techs.ARMOR_TECH) * step,
  };
}

/* ------------------------- Состав сторон ------------------------- */

export interface SideForces {
  ships: ShipCounts;
  defenses: DefenseCounts;
}

export interface CombatSide extends SideForces {
  techs: TechLevels;
}

export interface UnitLoss {
  key: string;
  label: string;
  before: number;
  lost: number;
}

export interface RoundLog {
  round: number;
  /** Урон, нанесенный стороной за раунд. */
  attackerDamage: number;
  defenderDamage: number;
  /** Сколько юнитов потеряла каждая сторона именно в этом раунде. */
  attackerLosses: number;
  defenderLosses: number;
  /** Сколько юнитов осталось в строю после раунда. */
  attackerAlive: number;
  defenderAlive: number;
}

export interface DebrisAmount {
  ore: number;
  polymers: number;
}

export interface CombatResult {
  winner: 'ATTACKER' | 'DEFENDER' | 'DRAW';
  rounds: RoundLog[];
  attackerSurvivors: ShipCounts;
  defenderSurvivorShips: ShipCounts;
  defenderSurvivorDefenses: DefenseCounts;
  attackerLosses: UnitLoss[];
  defenderLosses: UnitLoss[];
  /** Обломки от уничтоженных кораблей обеих сторон. */
  debris: DebrisAmount;
  /** Восстановление обороны: шанс на единицу и что реально поднялось. */
  defenceRecovery: {
    chance: number;
    destroyed: DefenseCounts;
    restored: DefenseCounts;
  };
  /** Куда ушел урон каждой стороны: в щиты противника и в его корпуса. */
  absorption: { attacker: Absorption; defender: Absorption };
  /** Суммарный залп сторон на начало боя. */
  firepower: { attacker: number; defender: number };
}

/* ------------------------- Симуляция ------------------------- */

/** Юнит на поле боя. Щит держим отдельно от максимума — он чинится каждый раунд. */
interface Combatant {
  kind: 'SHIP' | 'DEFENSE';
  type: string;
  attack: number;
  shieldMax: number;
  shield: number;
  hull: number;
  shieldPiercing: number;
}

/**
 * Предохранитель от неподъемной симуляции: в игре флоты такого размера
 * не собираются, а зацикливаться на миллионе юнитов движок не должен.
 */
const MAX_UNITS_PER_SIDE = 100_000;

function buildSide(forces: SideForces, bonuses: CombatBonuses): Combatant[] {
  const units: Combatant[] = [];

  const push = (kind: Combatant['kind'], type: string, stats: UnitStats, count: number): void => {
    const capped = Math.min(count, MAX_UNITS_PER_SIDE - units.length);
    for (let i = 0; i < capped; i += 1) {
      const shield = stats.shield * bonuses.shield;
      units.push({
        kind,
        type,
        attack: stats.attack * bonuses.attack,
        shieldMax: shield,
        shield,
        hull: stats.hull * bonuses.hull,
        shieldPiercing: stats.shieldPiercing,
      });
    }
  };

  for (const type of SHIP_TYPES) push('SHIP', type, SHIP_COMBAT[type], forces.ships[type]);
  for (const type of DEFENSE_TYPES) {
    push('DEFENSE', type, DEFENSE_COMBAT[type], forces.defenses[type]);
  }
  return units;
}

/**
 * Один залп по случайной цели.
 *
 * Урон сначала срезает щит (с учетом пробития), и только остаток идет в корпус.
 * Если выстрел слабее щита, он гасится целиком — цель не получает ни царапины,
 * а щит все равно восстановится к следующему раунду.
 */
function fire(shooter: Combatant, target: Combatant, tally: Absorption): void {
  if (shooter.attack <= 0) return;

  const versusShield = shooter.attack * shooter.shieldPiercing;
  if (versusShield <= target.shield) {
    target.shield -= versusShield;
    tally.shield += shooter.attack;
    return;
  }

  // Щит пробит: в корпус уходит остаток, пересчитанный обратно в обычный урон.
  const spentOnShield = target.shield / shooter.shieldPiercing;
  const toHull = shooter.attack - spentOnShield;
  target.shield = 0;
  target.hull -= toHull;

  tally.shield += spentOnShield;
  tally.hull += toHull;
}

/** Сколько урона осело в щитах и в корпусах — основа понятного отчета. */
export interface Absorption {
  shield: number;
  hull: number;
}

/**
 * Залп одной стороны за раунд.
 *
 * Цели берутся из состава на начало раунда и в течение раунда из пула не
 * убираются: обе стороны стреляют одновременно, и подбитый юнит еще успевает
 * ответить. Побочный эффект — выстрел может уйти в уже уничтоженную цель.
 * Это не баг, а естественный ограничитель скорострела: длинная очередь по рою
 * частично тратится впустую, и тяжелый корабль не выкашивает флот подчистую.
 */
function openFire(
  shooters: Combatant[],
  targets: Combatant[],
  tally: Absorption,
  rng: Rng,
): number {
  if (targets.length === 0) return 0;
  let damage = 0;

  for (const shooter of shooters) {
    if (shooter.attack <= 0) continue;

    for (let shot = 0; shot < MAX_RAPID_FIRE_SHOTS; shot += 1) {
      const target = targets[Math.floor(rng() * targets.length)];
      if (!target) break;

      fire(shooter, target, tally);
      damage += shooter.attack;

      // Продолжение очереди зависит от того, по кому пришелся выстрел:
      // очередь по истребителям длинная, по крейсеру — один выстрел.
      const rapid = rapidFireAgainst(shooter.type, target.type);
      if (rapid <= 1 || rng() >= (rapid - 1) / rapid) break;
    }
  }

  return damage;
}

function alive(units: Combatant[]): Combatant[] {
  return units.filter((unit) => unit.hull > 0);
}

function countByType(units: Combatant[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const unit of units) counts.set(unit.type, (counts.get(unit.type) ?? 0) + 1);
  return counts;
}

/**
 * Полный расчет боя.
 *
 * @param rng генератор случайных чисел в [0, 1). Подставляется снаружи,
 *   чтобы бой можно было воспроизвести в тестах и в предпросмотре.
 */
export function simulateCombat(
  attacker: CombatSide,
  defender: CombatSide,
  rng: Rng = Math.random,
): CombatResult {
  const attackerBonuses = combatBonuses(attacker.techs);
  const defenderBonuses = combatBonuses(defender.techs);

  let attackerUnits = buildSide({ ships: attacker.ships, defenses: emptyDefenseCounts() }, attackerBonuses);
  let defenderUnits = buildSide(defender, defenderBonuses);

  const rounds: RoundLog[] = [];
  const attackerAbsorption: Absorption = { shield: 0, hull: 0 };
  const defenderAbsorption: Absorption = { shield: 0, hull: 0 };

  for (let round = 1; round <= MAX_ROUNDS; round += 1) {
    if (attackerUnits.length === 0 || defenderUnits.length === 0) break;

    // Щиты держатся раунд и восстанавливаются к следующему.
    for (const unit of attackerUnits) unit.shield = unit.shieldMax;
    for (const unit of defenderUnits) unit.shield = unit.shieldMax;

    const attackerBefore = attackerUnits.length;
    const defenderBefore = defenderUnits.length;

    // Обе стороны стреляют по составу на начало раунда: подбитый в этом же
    // раунде юнит успевает ответить, иначе порядок обхода решал бы исход.
    const attackerSalvo = [...attackerUnits];
    const defenderSalvo = [...defenderUnits];

    const attackerDamage = openFire(attackerSalvo, defenderUnits, attackerAbsorption, rng);
    const defenderDamage = openFire(defenderSalvo, attackerUnits, defenderAbsorption, rng);

    attackerUnits = alive(attackerUnits);
    defenderUnits = alive(defenderUnits);

    rounds.push({
      round,
      attackerDamage: Math.round(attackerDamage),
      defenderDamage: Math.round(defenderDamage),
      attackerLosses: attackerBefore - attackerUnits.length,
      defenderLosses: defenderBefore - defenderUnits.length,
      attackerAlive: attackerUnits.length,
      defenderAlive: defenderUnits.length,
    });
  }

  return buildResult(attacker, defender, attackerUnits, defenderUnits, rounds, rng, {
    attacker: attackerAbsorption,
    defender: defenderAbsorption,
  });
}

function buildResult(
  attacker: CombatSide,
  defender: CombatSide,
  attackerUnits: Combatant[],
  defenderUnits: Combatant[],
  rounds: RoundLog[],
  rng: Rng,
  absorption: { attacker: Absorption; defender: Absorption },
): CombatResult {
  const attackerAlive = countByType(attackerUnits);
  const defenderAlive = countByType(defenderUnits);

  const attackerSurvivors = emptyShipCounts();
  for (const type of SHIP_TYPES) attackerSurvivors[type] = attackerAlive.get(type) ?? 0;

  const defenderSurvivorShips = emptyShipCounts();
  for (const type of SHIP_TYPES) defenderSurvivorShips[type] = defenderAlive.get(type) ?? 0;

  const defenderSurvivorDefenses = emptyDefenseCounts();
  for (const type of DEFENSE_TYPES) defenderSurvivorDefenses[type] = defenderAlive.get(type) ?? 0;

  const attackerShipLosses = lossCounts(attacker.ships, attackerSurvivors, SHIP_TYPES);
  const defenderShipLosses = lossCounts(defender.ships, defenderSurvivorShips, SHIP_TYPES);
  const defenseLosses = lossCounts(defender.defenses, defenderSurvivorDefenses, DEFENSE_TYPES);

  // Ничья остается за защитником: атакующий не занял поле.
  const attackerWiped = attackerUnits.length === 0;
  const defenderWiped = defenderUnits.length === 0;
  const winner: CombatResult['winner'] = defenderWiped
    ? 'ATTACKER'
    : attackerWiped
      ? 'DEFENDER'
      : 'DRAW';

  return {
    winner,
    rounds,
    attackerSurvivors,
    defenderSurvivorShips,
    defenderSurvivorDefenses,
    attackerLosses: shipLossList(attacker.ships, attackerSurvivors),
    defenderLosses: [
      ...shipLossList(defender.ships, defenderSurvivorShips),
      ...defenseLossList(defender.defenses, defenderSurvivorDefenses),
    ],
    debris: debrisFromLosses(attackerShipLosses, defenderShipLosses),
    defenceRecovery: rollDefenceRecovery(defenseLosses, rng),
    absorption,
    firepower: {
      attacker: totalAttack(attacker, combatBonuses(attacker.techs)),
      defender: totalAttack(defender, combatBonuses(defender.techs)),
    },
  };
}

/** Суммарный залп стороны в начале боя — по нему сравнивают силы в отчете. */
function totalAttack(side: CombatSide, bonuses: CombatBonuses): number {
  let total = 0;
  for (const type of SHIP_TYPES) total += side.ships[type] * SHIP_COMBAT[type].attack;
  for (const type of DEFENSE_TYPES) total += side.defenses[type] * DEFENSE_COMBAT[type].attack;
  return Math.round(total * bonuses.attack);
}

function lossCounts<T extends string>(
  before: Record<T, number>,
  after: Record<T, number>,
  types: readonly T[],
): Record<T, number> {
  const lost = {} as Record<T, number>;
  for (const type of types) lost[type] = Math.max(0, before[type] - after[type]);
  return lost;
}

/**
 * Обломки от уничтоженных кораблей обеих сторон.
 *
 * Считается по стоимости постройки: игрок понимает, во что ему обошелся корабль,
 * и прикидывает объем поля на глаз. Оборона не учитывается — ее обломки остаются
 * на поверхности планеты, а не выходят на орбиту.
 */
export function debrisFromLosses(
  attackerShipLosses: ShipCounts,
  defenderShipLosses: ShipCounts,
): DebrisAmount {
  let ore = 0;
  let polymers = 0;

  for (const type of SHIP_TYPES) {
    const lost = attackerShipLosses[type] + defenderShipLosses[type];
    if (lost <= 0) continue;
    const cost = shipCost(type);
    ore += cost.ore * lost;
    polymers += cost.polymers * lost;
  }

  return {
    ore: Math.floor(ore * DEBRIS_SHARE),
    polymers: Math.floor(polymers * DEBRIS_SHARE),
  };
}

/** Каждая разбитая турель поднимается обратно с фиксированным шансом. */
function rollDefenceRecovery(
  destroyed: DefenseCounts,
  rng: Rng,
): CombatResult['defenceRecovery'] {
  const restored = emptyDefenseCounts();

  for (const type of DEFENSE_TYPES) {
    for (let i = 0; i < destroyed[type]; i += 1) {
      if (rng() < DEFENCE_RECOVERY_CHANCE) restored[type] += 1;
    }
  }

  return { chance: DEFENCE_RECOVERY_CHANCE, destroyed: { ...destroyed }, restored };
}

function shipLossList(before: ShipCounts, after: ShipCounts): UnitLoss[] {
  return SHIP_TYPES.filter((type) => before[type] > 0).map((type) => ({
    key: type,
    label: shipLabel(type),
    before: before[type],
    lost: before[type] - after[type],
  }));
}

function defenseLossList(before: DefenseCounts, after: DefenseCounts): UnitLoss[] {
  return DEFENSE_TYPES.filter((type) => before[type] > 0).map((type) => ({
    key: type,
    label: defenseLabel(type),
    before: before[type],
    lost: before[type] - after[type],
  }));
}

/* ------------------------- Справки для интерфейса ------------------------- */

/** Есть ли во флоте хоть один вооруженный корабль. */
export function hasWeapons(ships: ShipCounts): boolean {
  return SHIP_TYPES.some((type) => ships[type] > 0 && SHIP_COMBAT[type].attack > 0);
}

export interface CombatProfileView extends UnitStats {
  /** Подпись про пробитие щитов — по ней собирают контр-флот. */
  note: string | null;
}

export function shipCombatProfile(type: ShipType): CombatProfileView {
  return withNote(SHIP_COMBAT[type]);
}

export function defenseCombatProfile(type: DefenseType): CombatProfileView {
  return withNote(DEFENSE_COMBAT[type]);
}

function withNote(stats: UnitStats): CombatProfileView {
  return {
    ...stats,
    note: stats.shieldPiercing > 1 ? `пробитие щитов ×${stats.shieldPiercing}` : null,
  };
}

/* ------------------------- Грабеж ------------------------- */

export interface PlunderResult {
  ore: number;
  polymers: number;
  plasma: number;
  storageCapacity: number;
  stored: number;
  protectedAmount: number;
  surplus: number;
  takeable: number;
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
 */
export function plunderAmount(
  stock: { ore: number; polymers: number; plasma: number },
  storageCapacity: number,
  cargoCapacity: number,
): PlunderResult {
  const ore = Math.max(0, stock.ore);
  const polymers = Math.max(0, stock.polymers);
  const plasma = Math.max(0, stock.plasma);
  const stored = ore + polymers + plasma;

  const protectedAmount = Math.min(stored, Math.max(0, storageCapacity) * PROTECTED_STORAGE_SHARE);
  const surplus = Math.max(0, stored - protectedAmount);

  const share = stored > 0 ? (RAID_SHARE * surplus) / stored : 0;
  const availableOre = Math.floor(ore * share);
  const availablePolymers = Math.floor(polymers * share);
  const availablePlasma = Math.floor(plasma * share);
  const takeable = availableOre + availablePolymers + availablePlasma;

  // Трюмы забиваются по порядку: сперва руда, затем полимеры, потом плазма.
  let room = Math.max(0, cargoCapacity);
  const takenOre = Math.min(availableOre, room);
  room -= takenOre;
  const takenPolymers = Math.min(availablePolymers, room);
  room -= takenPolymers;
  const takenPlasma = Math.min(availablePlasma, room);

  return {
    ore: takenOre,
    polymers: takenPolymers,
    plasma: takenPlasma,
    storageCapacity,
    stored,
    protectedAmount,
    surplus,
    takeable,
    cargoLimited: takenOre + takenPolymers + takenPlasma < takeable,
  };
}

/** Доля уязвимого излишка, которую победитель успевает вывезти. */
const RAID_SHARE = 0.9;

/* ------------------------- Совместимость ------------------------- */

/**
 * Прежний интерфейс расчета боя.
 *
 * Оставлен как переходник: на нем держатся Game Loop, экспедиции и симулятор,
 * а подключать новый отчет к интерфейсу — отдельная задача. Внутри тот же
 * движок, снаружи — форма, которую ожидают существующие потребители.
 *
 * Ничья отдается защитнику: атакующий не занял поле, а значит и не грабит.
 */
export interface AbsorptionReport {
  shield: number;
  armor: number;
  hull: number;
  damageMix: Array<{ type: string; label: string; amount: number }>;
}

export interface SidePower {
  firepower: number;
  effectiveHp: number;
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
  attackerDamageReport: AbsorptionReport;
  defenderDamageReport: AbsorptionReport;
  debris: DebrisAmount;
  /** Полный результат нового движка: раунды, восстановление обороны, ничья. */
  combat: CombatResult;
}

export function resolveBattle(
  attacker: SideForces,
  defender: SideForces,
  options: { attackerTechs?: TechLevels; defenderTechs?: TechLevels; rng?: Rng } = {},
): BattleOutcome {
  const techs = options.attackerTechs ?? emptyCombatTechs();
  const defenderTechs = options.defenderTechs ?? emptyCombatTechs();

  const result = simulateCombat(
    { ...attacker, techs },
    { ...defender, techs: defenderTechs },
    options.rng ?? Math.random,
  );

  const attackerBefore = totalUnits(attacker);
  const defenderBefore = totalUnits(defender);
  const attackerAfter = countShips(result.attackerSurvivors);
  const defenderAfter =
    countShips(result.defenderSurvivorShips) + countDefenses(result.defenderSurvivorDefenses);

  return {
    winner: result.winner === 'ATTACKER' ? 'ATTACKER' : 'DEFENDER',
    attackerPower: {
      firepower: result.firepower.attacker,
      effectiveHp: sideHitPoints(attacker),
    },
    defenderPower: {
      firepower: result.firepower.defender,
      effectiveHp: sideHitPoints(defender),
    },
    attackerLossRatio: ratio(attackerBefore - attackerAfter, attackerBefore),
    defenderLossRatio: ratio(defenderBefore - defenderAfter, defenderBefore),
    attackerSurvivors: result.attackerSurvivors,
    defenderSurvivorShips: result.defenderSurvivorShips,
    defenderSurvivorDefenses: result.defenderSurvivorDefenses,
    attackerLosses: result.attackerLosses,
    defenderLosses: result.defenderLosses,
    attackerDamageReport: toReport(result.absorption.attacker, result.firepower.attacker),
    defenderDamageReport: toReport(result.absorption.defender, result.firepower.defender),
    debris: result.debris,
    combat: result,
  };
}

/**
 * Нулевые технологии: у пиратов и в предпросмотре бонусов нет.
 * Список берем из дерева, чтобы новая технология не забылась здесь.
 */
export function emptyCombatTechs(): TechLevels {
  return emptyTechLevels();
}

function toReport(absorption: Absorption, firepower: number): AbsorptionReport {
  return {
    shield: Math.round(absorption.shield),
    // Слоя брони в новой модели нет: щит и корпус, поле оставлено для формы отчета.
    armor: 0,
    hull: Math.round(absorption.hull),
    damageMix: firepower > 0 ? [{ type: 'ATTACK', label: 'залп', amount: firepower }] : [],
  };
}

function sideHitPoints(forces: SideForces): number {
  let total = 0;
  for (const type of SHIP_TYPES) {
    total += forces.ships[type] * (SHIP_COMBAT[type].shield + SHIP_COMBAT[type].hull);
  }
  for (const type of DEFENSE_TYPES) {
    total += forces.defenses[type] * (DEFENSE_COMBAT[type].shield + DEFENSE_COMBAT[type].hull);
  }
  return Math.round(total);
}

function countShips(ships: ShipCounts): number {
  return SHIP_TYPES.reduce((sum, type) => sum + ships[type], 0);
}

function countDefenses(defenses: DefenseCounts): number {
  return DEFENSE_TYPES.reduce((sum, type) => sum + defenses[type], 0);
}

function totalUnits(forces: SideForces): number {
  return countShips(forces.ships) + countDefenses(forces.defenses);
}

function ratio(part: number, whole: number): number {
  if (whole <= 0) return 0;
  return Math.round((part / whole) * 1000) / 1000;
}
