/**
 * Сборка карты солнечной системы для конкретного игрока (Этап 3).
 * Своя планета показывается по актуальному состоянию, чужая — только по данным разведки.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { foreignPlanetView, ownPlanetView, type PlanetView, type ScanPayload } from '../game/fogOfWar.js';
import { emptyShipCounts } from '../game/ships.js';
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
      include: { base: { include: { commander: true, ships: true } } },
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
    };

    const ownBase = planet.base && planet.base.commanderId === commanderId ? planet.base : null;
    if (ownBase) {
      const live = user.bases.get(ownBase.id);
      const payload: ScanPayload = {
        owner: planet.base?.commander.nickname ?? null,
        colonized: true,
        richness: {
          metal: planet.metalRichness,
          crystal: planet.crystalRichness,
          deuterium: planet.deuteriumRichness,
          energy: planet.energyRichness,
          antimatter: planet.antimatterRichness,
        },
        buildings: live
          ? { ...live.levels }
          : {
              METAL_MINE: ownBase.metalMineLevel,
              CRYSTAL_MINE: ownBase.crystalMineLevel,
              DEUTERIUM_MINE: ownBase.deuteriumMineLevel,
              SOLAR_PLANT: ownBase.solarPlantLevel,
              RESEARCH_LAB: ownBase.researchLabLevel,
              SHIPYARD: ownBase.shipyardLevel,
              ANTIMATTER_SYNTH: ownBase.antimatterSynthLevel,
            },
        resources: live
          ? {
              metal: Math.round(live.resources.metal),
              crystal: Math.round(live.resources.crystal),
              deuterium: Math.round(live.resources.deuterium),
              antimatter: Math.round(live.resources.antimatter),
            }
          : {
              metal: Math.round(ownBase.metal),
              crystal: Math.round(ownBase.crystal),
              deuterium: Math.round(ownBase.deuterium),
              antimatter: Math.round(ownBase.antimatter),
            },
        fleet: live ? { ...live.ships } : shipsFromRows(ownBase.ships),
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
              metal: Math.round(storage.metal),
              crystal: Math.round(storage.crystal),
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
