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
import type { GalaxyMap, GateView, HubView, KishView, SystemMap } from '../types/socket.js';
import { gateAccessFor, membershipOf, type GateAccessKind } from './syndicateAccess.js';
import { hubStockUsage } from './hubStock.js';
import { GATE_POSITION, hasPermission, KISH_POSITION } from '../game/syndicate.js';

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

  const [planets, scans, hub, kishes, viewer, gateRows, gateAccess] = await Promise.all([
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
    prisma.syndicate.findMany({ where: { kishSystemId: targetSystem.id }, include: { bank: true } }),
    prisma.commander.findUnique({ where: { id: commanderId }, select: { syndicateId: true } }),
    prisma.syndicateGate.findMany({
      where: { systemId: targetSystem.id },
      include: { syndicate: { select: { tag: true, gateToll: true } } },
      orderBy: { level: 'desc' },
    }),
    gateAccessFor(commanderId),
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
        ore: Math.floor(planet.debrisOre),
        polymers: Math.floor(planet.debrisPolymers),
      },
    };

    const ownBase = planet.base && planet.base.commanderId === commanderId ? planet.base : null;
    if (ownBase) {
      const live = user.bases.get(ownBase.id);
      const payload: ScanPayload = {
        owner: planet.base?.commander.nickname ?? null,
        colonized: true,
        richness: {
          ore: planet.oreRichness,
          polymers: planet.polymersRichness,
          plasma: planet.plasmaRichness,
          energy: planet.energyRichness,
          antimatter: planet.antimatterRichness,
        },
        buildings: live
          ? { ...live.levels }
          : {
              ORE_MINE: ownBase.oreMineLevel,
              POLYMER_PLANT: ownBase.polymerPlantLevel,
              PLASMA_REACTOR: ownBase.plasmaReactorLevel,
              POWER_PLANT: ownBase.powerPlantLevel,
              SCIENCE_CENTER: ownBase.scienceCenterLevel,
              SHIPYARD: ownBase.shipyardLevel,
              ANTIMATTER_FACTORY: ownBase.antimatterFactoryLevel,
              CRYPTO_FARM: ownBase.cryptoFarmLevel,
              ORE_STORAGE: ownBase.oreStorageLevel,
              POLYMER_STORAGE: ownBase.polymerStorageLevel,
              PLASMA_STORAGE: ownBase.plasmaStorageLevel,
            },
        resources: live
          ? {
              ore: Math.round(live.resources.ore),
              polymers: Math.round(live.resources.polymers),
              plasma: Math.round(live.resources.plasma),
              antimatter: Math.round(live.resources.antimatter),
            }
          : {
              ore: Math.round(ownBase.ore),
              polymers: Math.round(ownBase.polymers),
              plasma: Math.round(ownBase.plasma),
              antimatter: Math.round(ownBase.antimatter),
            },
        fleet: live ? { ...live.ships } : shipsFromRows(ownBase.ships),
        defenses: live ? { ...live.defenses } : defensesFromRows(ownBase.defenses),
      };
      return ownPlanetView(facts, payload);
    }

    const scan = scanByPlanet.get(planet.id);
    const view = foreignPlanetView(
      facts,
      // Снимок разведки пишет Game Loop, структура данных известна заранее.
      scan ? { data: scan.data as unknown as ScanPayload, scannedAt: scan.scannedAt } : null,
      now,
    );
    // Членство в синдикате публично: его видно и в составе синдиката, и в рейтинге.
    return {
      ...view,
      ally: Boolean(viewer?.syndicateId && planet.base && planet.base.commander.syndicateId === viewer.syndicateId),
    };
  });

  const storage = hub?.storages[0] ?? null;
  // На хабе доступны его склад и общий склад купленного; размер один на все хабы.
  const stock = hub ? await hubStockUsage(prisma, commanderId) : null;
  const hubView: HubView | null = hub && stock
    ? {
        hubId: hub.id,
        name: hub.name,
        position: hub.position,
        storage: {
          ore: Math.round((storage?.ore ?? 0) + stock.global.ore),
          polymers: Math.round((storage?.polymers ?? 0) + stock.global.polymers),
          level: stock.level,
          capacity: stock.capacity,
          free: Math.round(stock.free),
        },
      }
    : null;

  const ownKish = kishes.some((row) => row.id === viewer?.syndicateId);
  const access = ownKish ? await membershipOf(commanderId) : null;
  const kishViews: KishView[] = kishes.map((row) => {
    const own = row.id === viewer?.syndicateId;
    return {
      syndicateId: row.id,
      name: `Кіш [${row.tag}]`,
      tag: row.tag,
      level: row.kishLevel,
      position: KISH_POSITION,
      own,
      treasury:
        own && row.bank
          ? { ore: Math.floor(row.bank.ore), polymers: Math.floor(row.bank.polymers), plasma: Math.floor(row.bank.plasma) }
          : null,
      canPickup: Boolean(own && access?.ok && hasPermission(access, 'WITHDRAW')),
      debris: { ore: Math.floor(row.debrisOre), polymers: Math.floor(row.debrisPolymers) },
    };
  });

  // Брамы видны всем, как станции: постройка у звезды — не тайна разведки.
  const gateViews: GateView[] = gateRows.map((row) => ({
    syndicateId: row.syndicateId,
    tag: row.syndicate.tag,
    level: row.level,
    position: GATE_POSITION,
    access: gateAccess.get(row.syndicateId) ?? null,
    // Цена прохода объявлена открыто: игрок решает, лететь ли, до вылета.
    toll: row.syndicate.gateToll,
    disabledUntil: row.disabledUntil && row.disabledUntil.getTime() > now ? row.disabledUntil.getTime() : null,
    siegeImmuneUntil: row.siegeImmuneUntil && row.siegeImmuneUntil.getTime() > now ? row.siegeImmuneUntil.getTime() : null,
  }));

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
    kishes: kishViews,
    gates: gateViews,
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

  const [systems, scans, member, access] = await Promise.all([
    prisma.solarSystem.findMany({
      orderBy: [{ galaxyX: 'asc' }, { galaxyY: 'asc' }],
      include: {
        planets: { select: { id: true, base: { select: { commanderId: true } } } },
      },
    }),
    prisma.planetScan.findMany({ where: { commanderId }, select: { planetId: true } }),
    prisma.commander.findUnique({
      where: { id: commanderId },
      select: { syndicate: { select: { kishSystemId: true } } },
    }),
    gateAccessFor(commanderId),
  ]);
  /*
   * Сеть доступных Брам на карте галактики: свои, союзника и арендованные.
   * По ним видно, куда можно прыгнуть мгновенно; в системе берется лучшая
   * по основанию доступа, как и при вылете.
   */
  const gateRows = access.size
    ? await prisma.syndicateGate.findMany({
        where: {
          syndicateId: { in: [...access.keys()] },
          // Выведенные осадой врата не пропускают — и на карте сети их нет.
          OR: [{ disabledUntil: null }, { disabledUntil: { lt: new Date() } }],
        },
        select: { systemId: true, level: true, syndicateId: true },
      })
    : [];
  const accessRank = { OWN: 0, ALLY: 1, LEASED: 2, TOLL: 3 } as const;
  const gateBySystem = new Map<string, { level: number; access: GateAccessKind }>();
  for (const row of gateRows) {
    const kind = access.get(row.syndicateId)!;
    const current = gateBySystem.get(row.systemId);
    if (!current || accessRank[kind] < accessRank[current.access]) gateBySystem.set(row.systemId, { level: row.level, access: kind });
  }

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
      syndicateGate: gateBySystem.get(system.id)?.level ?? null,
      gateAccess: gateBySystem.get(system.id)?.access ?? null,
      ownKish: member?.syndicate?.kishSystemId === system.id,
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
        ore: data.resources?.ore ?? 0,
        polymers: data.resources?.polymers ?? 0,
        plasma: data.resources?.plasma ?? 0,
        /*
         * Снимок разведки переживает изменения игры (правило 8): до разделения
         * складов в нем лежал один STORAGE, теперь три. Берем рудный, а если
         * снимок старый — прежнее общее поле.
         */
        storageLevel:
          data.buildings?.ORE_STORAGE ??
          (data.buildings as { STORAGE?: number } | undefined)?.STORAGE ??
          0,
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
  stock: { ore: number; polymers: number; plasma: number; storageLevel: number };
}

function defensesFromRows(rows: Array<{ type: DefenseType; count: number }>): DefenseCounts {
  const defenses = emptyDefenseCounts();
  for (const row of rows) defenses[row.type] = row.count;
  return defenses;
}
