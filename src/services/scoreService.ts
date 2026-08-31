/**
 * Рейтинг командиров и синдикатов.
 *
 * Счет собирается из состояния в БД, а не из памяти тика. Ресурсы онлайновых
 * игроков там отстают максимум на PERSIST_EVERY_TICKS секунд — для таблицы,
 * где счет измеряется сотнями тысяч, это доли процента, и гонять сброс всех
 * игроков ради нее было бы дороже самой таблицы. Запросивший видит свою строку
 * точной: его состояние сбрасывается отдельно.
 *
 * Результат кешируется: запрос читает базы, флоты, оборону и исследования всех
 * игроков разом, и пересчитывать это на каждое открытие вкладки незачем —
 * счет за секунды заметно не меняется.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { emptyLevels, type BuildingLevels, type BuildingType } from '../game/rules.js';
import { emptyTechLevels, type TechLevels } from '../game/techTree.js';
import { emptyShipCounts, isShipType, type ShipCounts } from '../game/ships.js';
import { emptyDefenseCounts, isDefenseType, type DefenseCounts } from '../game/defenses.js';
import {
  heldResources,
  sealScore,
  spentOnBuildings,
  spentOnDefense,
  spentOnFleet,
  spentOnResearch,
  type ScoreBreakdown,
} from '../game/score.js';

export interface ScoreRow {
  rank: number;
  commanderId: string;
  nickname: string;
  syndicate: { name: string; tag: string } | null;
  colonies: number;
  score: ScoreBreakdown;
}

export interface SyndicateScoreRow {
  rank: number;
  syndicateId: string;
  name: string;
  tag: string;
  members: number;
  total: number;
  /** Средний счет участника: по нему видно, силен синдикат или просто велик. */
  average: number;
}

export interface LeaderboardView {
  players: ScoreRow[];
  syndicates: SyndicateScoreRow[];
  /** Строка запросившего — он может не попасть в показанную сотню. */
  me: ScoreRow | null;
  /** Когда таблица посчитана: она кешируется и живет несколько секунд. */
  computedAt: number;
}

/** Сколько строк отдаем. Больше сотни в таблице все равно не читают. */
const TOP_LIMIT = 100;
/** Сколько живет кеш. Счет за это время меняется на доли процента. */
const CACHE_TTL_MS = 30_000;

let cache: { at: number; players: ScoreRow[]; syndicates: SyndicateScoreRow[] } | null = null;

/** Колонки уровней зданий в БД. Держим рядом с чтением, а не в общем модуле. */
const BUILDING_COLUMNS: Record<BuildingType, string> = {
  ORE_MINE: 'oreMineLevel',
  POLYMER_PLANT: 'polymerPlantLevel',
  PLASMA_REACTOR: 'plasmaReactorLevel',
  POWER_PLANT: 'powerPlantLevel',
  SCIENCE_CENTER: 'scienceCenterLevel',
  SHIPYARD: 'shipyardLevel',
  ANTIMATTER_FACTORY: 'antimatterFactoryLevel',
  STORAGE: 'storageLevel',
};

function levelsOf(base: Record<string, unknown>): BuildingLevels {
  const levels = emptyLevels();
  for (const [type, column] of Object.entries(BUILDING_COLUMNS) as Array<[BuildingType, string]>) {
    levels[type] = Number(base[column]) || 0;
  }
  return levels;
}

async function computeAll(): Promise<{ players: ScoreRow[]; syndicates: SyndicateScoreRow[] }> {
  /** Синдикат каждого командира — чтобы не искать его потом перебором строк. */
  const syndicateOf = new Map<string, { id: string; name: string; tag: string }>();
  const commanders = await prisma.commander.findMany({
    include: {
      syndicate: { select: { id: true, name: true, tag: true } },
      researches: true,
      hubStorages: true,
      bases: { include: { ships: true, defenses: true } },
      fleets: true,
    },
  });

  const rows: ScoreRow[] = commanders.map((commander) => {
    if (commander.syndicate) syndicateOf.set(commander.id, commander.syndicate);

    const techs: TechLevels = emptyTechLevels();
    for (const research of commander.researches) techs[research.tech] = research.level;

    let resources = 0;
    let fleetValue = 0;
    let defenseValue = 0;
    let buildings = 0;

    for (const base of commander.bases) {
      resources += heldResources(base);
      buildings += spentOnBuildings(levelsOf(base as unknown as Record<string, unknown>));

      const ships: ShipCounts = emptyShipCounts();
      for (const row of base.ships) if (isShipType(row.type)) ships[row.type] = row.count;
      fleetValue += spentOnFleet(ships);

      const defenses: DefenseCounts = emptyDefenseCounts();
      for (const row of base.defenses) if (isDefenseType(row.type)) defenses[row.type] = row.count;
      defenseValue += spentOnDefense(defenses);
    }

    // Товар на складе хаба тоже принадлежит игроку: он его добыл и не потерял.
    for (const storage of commander.hubStorages) {
      resources += storage.ore + storage.polymers;
    }

    /*
     * Флот в полете считается наравне со стоящим на базе. Иначе счет падал бы
     * на время каждого рейса, и вершину рейтинга занимали бы те, кто никуда
     * не летает, — ровно противоположное тому, что рейтинг должен поощрять.
     */
    for (const fleet of commander.fleets) {
      const ships: ShipCounts = emptyShipCounts();
      ships.PROBE = fleet.probes;
      ships.TRANSPORTER = fleet.transporters;
      ships.LIGHT_FIGHTER = fleet.lightFighters;
      ships.HEAVY_CRUISER = fleet.heavyCruisers;
      ships.ION_FRIGATE = fleet.ionFrigates;
      ships.RECYCLER = fleet.recyclers;
      ships.COLONY_SHIP = fleet.colonyShips;
      fleetValue += spentOnFleet(ships);
      resources += fleet.cargoOre + fleet.cargoPolymers + fleet.cargoPlasma + fleet.cargoAntimatter;
    }

    return {
      rank: 0,
      commanderId: commander.id,
      nickname: commander.nickname,
      syndicate: commander.syndicate
        ? { name: commander.syndicate.name, tag: commander.syndicate.tag }
        : null,
      colonies: commander.bases.length,
      score: sealScore({
        resources,
        fleet: fleetValue,
        defense: defenseValue,
        buildings,
        research: spentOnResearch(techs),
      }),
    };
  });

  rows.sort((a, b) => b.score.total - a.score.total || a.nickname.localeCompare(b.nickname, 'ru'));
  rows.forEach((row, index) => {
    row.rank = index + 1;
  });

  // Синдикат стоит столько, сколько его состав: отдельного имущества у него нет,
  // кроме банка, а банк — криптогривна, которая в счет не входит вовсе.
  const bySyndicate = new Map<string, { name: string; tag: string; total: number; members: number }>();
  for (const row of rows) {
    const syndicate = syndicateOf.get(row.commanderId);
    if (!syndicate) continue;
    const entry = bySyndicate.get(syndicate.id) ?? {
      name: syndicate.name,
      tag: syndicate.tag,
      total: 0,
      members: 0,
    };
    entry.total += row.score.total;
    entry.members += 1;
    bySyndicate.set(syndicate.id, entry);
  }

  const syndicates: SyndicateScoreRow[] = [...bySyndicate.entries()]
    .map(([syndicateId, entry]) => ({
      rank: 0,
      syndicateId,
      name: entry.name,
      tag: entry.tag,
      members: entry.members,
      total: entry.total,
      average: entry.members > 0 ? Math.round(entry.total / entry.members) : 0,
    }))
    .sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'ru'));
  syndicates.forEach((row, index) => {
    row.rank = index + 1;
  });

  return { players: rows, syndicates };
}

export async function getLeaderboard(commanderId: string | null): Promise<LeaderboardView> {
  const now = Date.now();
  if (!cache || now - cache.at > CACHE_TTL_MS) {
    // Сбрасываем запросившего перед самим пересчетом: свою строку он сверит
    // со своим же складом и заметил бы расхождение сразу. Сбрасывать его
    // ради ответа из кеша бессмысленно — таблица от этого не изменится.
    if (commanderId) await gameLoop.flushCommander(commanderId);
    cache = { at: now, ...(await computeAll()) };
  }

  return {
    players: cache.players.slice(0, TOP_LIMIT),
    syndicates: cache.syndicates.slice(0, TOP_LIMIT),
    me: commanderId ? cache.players.find((row) => row.commanderId === commanderId) ?? null : null,
    computedAt: cache.at,
  };
}
