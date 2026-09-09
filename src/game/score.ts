/**
 * Очки командира.
 *
 * Счет — это все, во что вложены ресурсы и что не потеряно: остатки на складах
 * плюс стоимость постройки того, что стоит и летает прямо сейчас. Потерянный
 * в бою флот из счета уходит сам, потому что считается наличие, а не история
 * трат: иначе рейтинг превратился бы в список тех, кто дольше играет.
 *
 * Все ресурсы считаются один к одному по единицам. Любой другой вес требует
 * источника правды об их относительной ценности, а его нет: биржа торгует
 * только рудой и полимерами, и курс там задают сами игроки. Единый вес
 * предсказуем и не дает перекоса в пользу того, у кого удачнее сложился рынок.
 *
 * Модуль чистый: только формулы, без обращения к БД.
 */
import { BUILDING_TYPES, upgradeCost, type BuildingLevels, type BuildingType, type ResourceAmounts } from './rules.js';
import { researchCost, TECHNOLOGY_TYPES, type TechLevels, type TechnologyType } from './techTree.js';
import { shipCost, SHIP_TYPES, type ShipCounts, type ShipType } from './ships.js';
import { defenseCost, DEFENSE_TYPES, type DefenseCounts, type DefenseType } from './defenses.js';

/** Стоимость в единицах ресурсов: три вида складываются напрямую. */
export function costUnits(cost: ResourceAmounts): number {
  return cost.ore + cost.polymers + cost.plasma;
}

/**
 * Во что обошлись уровни с первого по текущий.
 *
 * Считается суммой по уровням, а не по последнему: здание десятого уровня
 * стоило владельцу всех девяти предыдущих, и учитывать только последний
 * означало бы недооценить его в разы.
 */
export function spentOnBuildings(levels: BuildingLevels): number {
  let total = 0;
  for (const type of BUILDING_TYPES) {
    for (let level = 1; level <= levels[type]; level += 1) {
      total += costUnits(upgradeCost(type, level));
    }
  }
  return total;
}

export function spentOnResearch(techs: TechLevels): number {
  let total = 0;
  for (const tech of TECHNOLOGY_TYPES) {
    for (let level = 1; level <= techs[tech]; level += 1) {
      total += costUnits(researchCost(tech, level));
    }
  }
  return total;
}

export function spentOnFleet(ships: ShipCounts): number {
  return SHIP_TYPES.reduce((total, type) => total + costUnits(shipCost(type)) * ships[type], 0);
}

export function spentOnDefense(defenses: DefenseCounts): number {
  return DEFENSE_TYPES.reduce((total, type) => total + costUnits(defenseCost(type)) * defenses[type], 0);
}

/*
 * Оплаченное, но еще не готовое.
 *
 * Ресурсы за стройку, науку и заказ верфи списываются в момент заказа,
 * а в счет попадают только после завершения — и все это время они исчезали
 * из рейтинга вовсе. Игрок, поставивший в очередь линкора на неделю, платил
 * за это местом в таблице, хотя не потерял ничего: заказ никуда не делся,
 * он строится.
 *
 * Считается наравне с готовым и в той же графе, в которую превратится:
 * корпуса на стапеле — это флот, начатый уровень шахты — это постройки.
 */
export function spentOnUpgrade(building: BuildingType, targetLevel: number): number {
  return costUnits(upgradeCost(building, targetLevel));
}

export function spentOnResearchJob(tech: TechnologyType, targetLevel: number): number {
  return costUnits(researchCost(tech, targetLevel));
}

export function spentOnShipQueue(jobs: Array<{ type: ShipType; remaining: number }>): number {
  return jobs.reduce((total, job) => total + costUnits(shipCost(job.type)) * job.remaining, 0);
}

export function spentOnDefenseQueue(jobs: Array<{ type: DefenseType; remaining: number }>): number {
  return jobs.reduce((total, job) => total + costUnits(defenseCost(job.type)) * job.remaining, 0);
}

/**
 * Ресурсы на руках. Антиматерия входит наравне с остальными: она такой же
 * запас, просто редкий, и держать ее вне счета значило бы обнулять вложения
 * тех, кто копит на прыжки.
 */
export function heldResources(stock: {
  ore: number;
  polymers: number;
  plasma: number;
  antimatter?: number;
}): number {
  return stock.ore + stock.polymers + stock.plasma + (stock.antimatter ?? 0);
}

/** Слагаемые счета: по ним видно, чем игрок силен. */
export interface ScoreBreakdown {
  resources: number;
  fleet: number;
  defense: number;
  buildings: number;
  research: number;
  total: number;
}

export function emptyScore(): ScoreBreakdown {
  return { resources: 0, fleet: 0, defense: 0, buildings: 0, research: 0, total: 0 };
}

/** Сумма слагаемых. Округление одно и в самом конце, а не по частям. */
export function sealScore(parts: Omit<ScoreBreakdown, 'total'>): ScoreBreakdown {
  const rounded = {
    resources: Math.round(parts.resources),
    fleet: Math.round(parts.fleet),
    defense: Math.round(parts.defense),
    buildings: Math.round(parts.buildings),
    research: Math.round(parts.research),
  };
  return {
    ...rounded,
    total: rounded.resources + rounded.fleet + rounded.defense + rounded.buildings + rounded.research,
  };
}
