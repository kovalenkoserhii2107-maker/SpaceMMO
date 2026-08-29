/**
 * Сборка карты солнечной системы для конкретного игрока (Этап 3).
 * Своя планета показывается по актуальному состоянию, чужая — только по данным разведки.
 */
import { prisma } from '../db/prisma.js';
import { gameLoop } from '../game/gameLoop.js';
import { foreignPlanetView, ownPlanetView, type PlanetView, type ScanPayload } from '../game/fogOfWar.js';
import { emptyShipCounts } from '../game/ships.js';
import { storageCapacity, storageUsed } from '../game/market.js';
import type { HubView, SystemMap } from '../types/socket.js';

export async function buildSystemMap(userId: string): Promise<SystemMap | null> {
  const user = await gameLoop.getUser(userId);
  const homeBase = user ? [...user.bases.values()][0] : null;
  if (!user || !homeBase) return null;

  const home = await prisma.planet.findUnique({
    where: { id: homeBase.planetId },
    include: { system: true },
  });
  if (!home) return null;

  const [planets, scans, hub] = await Promise.all([
    prisma.planet.findMany({
      where: { systemId: home.systemId },
      orderBy: { position: 'asc' },
      include: { base: { include: { user: true, ships: true } } },
    }),
    prisma.planetScan.findMany({ where: { userId } }),
    prisma.tradeHub.findUnique({
      where: { systemId: home.systemId },
      include: { storages: { where: { userId } } },
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

    const ownBase = planet.base && planet.base.userId === userId ? planet.base : null;
    if (ownBase) {
      const live = user.bases.get(ownBase.id);
      const payload: ScanPayload = {
        owner: planet.base?.user.username ?? null,
        colonized: true,
        richness: {
          metal: planet.metalRichness,
          crystal: planet.crystalRichness,
          deuterium: planet.deuteriumRichness,
          energy: planet.energyRichness,
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
            },
        resources: live
          ? {
              metal: Math.round(live.resources.metal),
              crystal: Math.round(live.resources.crystal),
              deuterium: Math.round(live.resources.deuterium),
            }
          : {
              metal: Math.round(ownBase.metal),
              crystal: Math.round(ownBase.crystal),
              deuterium: Math.round(ownBase.deuterium),
            },
        fleet: live ? { ...live.ships } : shipsFromRows(ownBase.ships),
      };
      return ownPlanetView(facts, payload);
    }

    const scan = scanByPlanet.get(planet.id);
    return foreignPlanetView(
      facts,
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
    systemId: home.system.id,
    systemName: home.system.name,
    starClass: home.system.starClass,
    planets: views,
    hub: hubView,
  };
}

function shipsFromRows(rows: Array<{ type: keyof ReturnType<typeof emptyShipCounts>; count: number }>) {
  const ships = emptyShipCounts();
  for (const row of rows) ships[row.type] = row.count;
  return ships;
}
