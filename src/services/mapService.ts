/**
 * Сборка карты солнечной системы для конкретного игрока.
 * Своя планета показывается по актуальному состоянию, чужая — только по данным разведки.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import {
  foreignPlanetView,
  normalizeDefenses,
  normalizeShips,
  ownPlanetView,
  scanFreshness,
  type PlanetView,
  type ScanFreshness,
  type ScanPayload,
} from '../game/fogOfWar.js';
import { emptyDefenseCounts, type DefenseCounts, type DefenseType } from '../game/defenses.js';
import { emptyShipCounts, type ShipCounts } from '../game/ships.js';
import { storageCapacity, storageUsed } from '../game/market.js';
import type { GalaxyMap, HubView, SystemMap } from '../types/socket.js';

/**
 * Карта одной системы для игрока.
 *
 * @param systemId система для просмотра; по умолчанию — родная система игрока.
 *   Чужие системы показываются с тем же туманом войны: планеты видно как объекты,
 *   а их содержимое — только после разведки зондом.
 */
export async function buildSystemMap(commanderId: string, systemId?: string): Promise<SystemMap | null> {
  const user = await gameLoop.getCommander(commanderId);
  const homeBase = user ? [...user.bases.values()][0] : null;
  if (!user || !homeBase) return null;

  const home = await prisma.planet.findUnique({
    where: { id: homeBase.planetId },
    include: { system: true },
  });
  if (!home) return null;

  const targetSystem = systemId
    ? await prisma.solarSystem.findUnique({ where: { id: systemId } })
    : home.system;
  if (!targetSystem) return null;

  const [planets, scans, hub] = await Promise.all([
    prisma.planet.findMany({
      where: { systemId: targetSystem.id },
      orderBy: { position: 'asc' },
      include: { base: { include: { commander: true, ships: true, defenses: true } } },
    }),
    prisma.planetScan.findMany({ where: { commanderId } }),
    prisma.tradeHub.findUnique({
      where: { systemId: targetSystem.id },
      include: { storages: { where: { commanderId } } },
    }),
  ]);

  const scanByPlanet = new Map(scans.map((scan) => [scan.planetId, scan]));
  const now = Date.now();

  const views: PlanetView[] = planets.map((planet) => {
    const facts = {
      planetId: planet.id,
      name: planet.name,
      position: planet.position,
      type: planet.type,
      size: planet.size,
      debris: {
        titanite: Math.floor(planet.debrisTitanite),
        silicate: Math.floor(planet.debrisSilicate),
      },
    };

    const ownBase = planet.base && planet.base.commanderId === commanderId ? planet.base : null;
    if (ownBase) {
      const live = user.bases.get(ownBase.id);
      const payload: ScanPayload = {
        owner: planet.base?.commander.nickname ?? null,
        colonized: true,
        richness: {
          titanite: planet.titaniteRichness,
          silicate: planet.silicateRichness,
          tritium: planet.tritiumRichness,
          energy: planet.energyRichness,
          eridium: planet.eridiumRichness,
        },
        buildings: live
          ? { ...live.levels }
          : {
              TITANITE_MINE: ownBase.titaniteMineLevel,
              SILICATE_MINE: ownBase.silicateMineLevel,
              TRITIUM_MINE: ownBase.tritiumMineLevel,
              SOLAR_PLANT: ownBase.solarPlantLevel,
              RESEARCH_LAB: ownBase.researchLabLevel,
              SHIPYARD: ownBase.shipyardLevel,
              ERIDIUM_SYNTH: ownBase.eridiumSynthLevel,
              STORAGE: ownBase.storageLevel,
            },
        resources: live
          ? {
              titanite: Math.round(live.resources.titanite),
              silicate: Math.round(live.resources.silicate),
              tritium: Math.round(live.resources.tritium),
              eridium: Math.round(live.resources.eridium),
            }
          : {
              titanite: Math.round(ownBase.titanite),
              silicate: Math.round(ownBase.silicate),
              tritium: Math.round(ownBase.tritium),
              eridium: Math.round(ownBase.eridium),
            },
        fleet: live ? { ...live.ships } : shipsFromRows(ownBase.ships),
        defenses: live ? { ...live.defenses } : defensesFromRows(ownBase.defenses),
      };
      return ownPlanetView(facts, payload);
    }

    const scan = scanByPlanet.get(planet.id);
    return foreignPlanetView(
      facts,
      // Снимок разведки пишет Game Loop, структура данных известна заранее.
      scan ? { data: scan.data as unknown as ScanPayload, scannedAt: scan.scannedAt } : null,
      now,
    );
  });

  const storage = hub?.storages[0] ?? null;
  const hubView: HubView | null = hub
    ? {
        hubId: hub.id,
        name: hub.name,
        position: hub.position,
        storage: storage
          ? {
              titanite: Math.round(storage.titanite),
              silicate: Math.round(storage.silicate),
              level: storage.level,
              capacity: storageCapacity(storage.level),
              free: Math.max(0, storageCapacity(storage.level) - storageUsed(storage)),
            }
          : null,
      }
    : null;

  return {
    systemId: targetSystem.id,
    systemName: targetSystem.name,
    starClass: targetSystem.starClass,
    anomaly: targetSystem.anomaly,
    galaxyX: targetSystem.galaxyX,
    galaxyY: targetSystem.galaxyY,
    isHome: targetSystem.id === home.systemId,
    planets: views,
    hub: hubView,
  };
}

/**
 * Макро-карта галактики: все известные системы с координатами.
 *
 * Сами звезды видно всегда — это астрономия, а не разведка. Скрыто другое:
 * кто живет в системе и что там на планетах. Поэтому в списке отмечаются
 * только свои колонии и системы, где у игрока есть данные разведки.
 */
export async function buildGalaxyMap(commanderId: string): Promise<GalaxyMap | null> {
  const user = await gameLoop.getCommander(commanderId);
  const homeBase = user ? [...user.bases.values()][0] : null;
  if (!user || !homeBase) return null;

  const home = await prisma.planet.findUnique({
    where: { id: homeBase.planetId },
    select: { systemId: true },
  });
  if (!home) return null;

  const [systems, scans] = await Promise.all([
    prisma.solarSystem.findMany({
      orderBy: [{ galaxyX: 'asc' }, { galaxyY: 'asc' }],
      include: {
        planets: { select: { id: true, base: { select: { commanderId: true } } } },
      },
    }),
    prisma.planetScan.findMany({ where: { commanderId }, select: { planetId: true } }),
  ]);

  const scanned = new Set(scans.map((scan) => scan.planetId));

  return {
    homeSystemId: home.systemId,
    systems: systems.map((system) => ({
      systemId: system.id,
      name: system.name,
      galaxyX: system.galaxyX,
      galaxyY: system.galaxyY,
      starClass: system.starClass,
      anomaly: system.anomaly,
      planetCount: system.planets.length,
      isHome: system.id === home.systemId,
      hasOwnColony: system.planets.some((planet) => planet.base?.commanderId === commanderId),
      colonized: system.planets.some((planet) => planet.base !== null),
      scannedPlanets: system.planets.filter((planet) => scanned.has(planet.id)).length,
    })),
  };
}

function shipsFromRows(rows: Array<{ type: keyof ReturnType<typeof emptyShipCounts>; count: number }>) {
  const ships = emptyShipCounts();
  for (const row of rows) ships[row.type] = row.count;
  return ships;
}

/**
 * Разведанные чужие колонии — источник для боевого симулятора.
 *
 * Отдаем только снимки, которые еще не устарели: у устаревших флот и оборона
 * скрыты туманом войны, и подставлять в симулятор нечего.
 */
export async function listEspionageTargets(commanderId: string): Promise<EspionageTarget[]> {
  const scans = await prisma.planetScan.findMany({
    where: { commanderId },
    include: { planet: { include: { system: { select: { name: true } } } } },
    orderBy: { scannedAt: 'desc' },
    take: 30,
  });

  const now = Date.now();
  const targets: EspionageTarget[] = [];

  for (const scan of scans) {
    const data = scan.data as unknown as ScanPayload;
    if (!data.colonized) continue;

    const ageSeconds = Math.max(0, Math.round((now - scan.scannedAt.getTime()) / 1000));
    if (scanFreshness(ageSeconds) === 'OUTDATED') continue;

    targets.push({
      planetId: scan.planetId,
      planetName: scan.planet.name,
      systemName: scan.planet.system.name,
      owner: data.owner,
      ageSeconds,
      freshness: scanFreshness(ageSeconds),
      // Старые снимки писались, когда классов и обороны было меньше, поэтому
      // состав нормализуем: недостающие ключи должны быть нулями, а не undefined.
      ships: normalizeShips(data.fleet),
      defenses: normalizeDefenses(data.defenses),
      hasDefenseData: Boolean(data.defenses),
      stock: {
        titanite: data.resources?.titanite ?? 0,
        silicate: data.resources?.silicate ?? 0,
        tritium: data.resources?.tritium ?? 0,
        storageLevel: data.buildings?.STORAGE ?? 0,
      },
    });
  }

  return targets;
}

export interface EspionageTarget {
  planetId: string;
  planetName: string;
  systemName: string;
  owner: string | null;
  ageSeconds: number;
  freshness: ScanFreshness;
  ships: ShipCounts;
  defenses: DefenseCounts;
  /** У старых снимков обороны нет — интерфейс об этом предупреждает. */
  hasDefenseData: boolean;
  stock: { titanite: number; silicate: number; tritium: number; storageLevel: number };
}

function defensesFromRows(rows: Array<{ type: DefenseType; count: number }>): DefenseCounts {
  const defenses = emptyDefenseCounts();
  for (const row of rows) defenses[row.type] = row.count;
  return defenses;
}
