/**
 * Game Loop — изолированный серверный тик (1 раз в секунду).
 * Не блокирует API: состояние online-игроков держится в памяти,
 * ресурсы пишутся пачкой раз в PERSIST_EVERY_TICKS тиков, а завершение
 * стройки/исследования/постройки кораблей сохраняется сразу.
 *
 * Все таймеры считаются от абсолютных меток времени (finishesAt/nextUnitAt),
 * поэтому очереди доигрываются и после выхода игрока из игры.
 */
import { randomUUID } from 'node:crypto';
import type { Server } from 'socket.io';
import { prisma } from '../db/prisma.js';
import type { Prisma } from '../generated/prisma/client.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
  StateUpdatePayload,
} from '../types/socket.js';
import {
  accrue,
  type DefenseJobState,
  fleetSnapshots,
  researchSnapshot,
  toSnapshot,
  type BaseRuntimeState,
  type FleetRuntimeState,
  type ShipJobState,
  type UserRuntimeState,
} from './baseState.js';
import {
  canJump,
  fleetCapacity,
  fleetSize,
  isHubMission,
  planFlight,
  validateCargo,
  validateComposition,
  type FleetMission,
} from './fleets.js';
import {
  canExplore,
  DEEP_SPACE_POSITION,
  expeditionSlots,
  resolveExpedition,
} from './expeditions.js';
import { storageCapacity, storageUsed } from './market.js';
import type { ScanPayload } from './fogOfWar.js';
import {
  DEFENSE_TYPES,
  defenseCost,
  defenseUnitSeconds,
  emptyDefenseCounts,
  MAX_DEFENSE_ORDER,
  missingDefenseRequirements,
  type DefenseType,
} from './defenses.js';
import { plunderAmount, resolveBattle, type SideForces } from './combat.js';
import {
  buildSeconds,
  emptyLevels,
  systemModifiers,
  hasEnoughResources,
  missingBuildingRequirements,
  multiplyResources,
  subtractResources,
  upgradeCost,
  type BuildingType,
} from './rules.js';
import {
  emptyTechLevels,
  missingTechRequirements,
  researchCost,
  researchSeconds,
  type TechnologyType,
} from './techTree.js';
import {
  emptyShipCounts,
  MAX_SHIP_ORDER,
  missingShipRequirements,
  shipCost,
  shipUnitSeconds,
  SHIP_TYPES,
  type ShipCounts,
  type ShipType,
} from './ships.js';

const TICK_INTERVAL_MS = 1000;
const PERSIST_EVERY_TICKS = 10;
/** Максимальный догоняемый офлайн-период (сутки). */
const MAX_OFFLINE_SECONDS = 24 * 60 * 60;
/** Предохранитель от бесконечного цикла при разборе очереди верфи. */
const MAX_QUEUE_STEPS = 10_000;
/** Через сколько простоя выгружать из памяти игрока без активных сокетов. */
const IDLE_EVICT_MS = 60_000;
/** Как часто проверять прилеты флотов (в тиках). */
const FLEET_SWEEP_EVERY_TICKS = 2;

type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

class GameLoop {
  private io: GameServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private ticking = false;
  /** Состояния online-игроков: userId -> состояние. */
  private readonly users = new Map<string, UserRuntimeState>();
  /** Количество сокетов игрока. */
  private readonly connections = new Map<string, number>();

  start(io: GameServer): void {
    if (this.timer) return;
    this.io = io;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_INTERVAL_MS);
    console.log(`[game-loop] запущен, интервал ${TICK_INTERVAL_MS} мс`);
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const user of this.users.values()) {
      await this.persistUser(user);
    }
    console.log('[game-loop] остановлен');
  }

  async attachUser(userId: string): Promise<void> {
    this.connections.set(userId, (this.connections.get(userId) ?? 0) + 1);
    await this.getUser(userId);
  }

  async detachUser(userId: string): Promise<void> {
    const count = (this.connections.get(userId) ?? 1) - 1;
    if (count > 0) {
      this.connections.set(userId, count);
      return;
    }
    this.connections.delete(userId);

    const user = this.users.get(userId);
    if (user) {
      await this.persistUser(user);
      this.users.delete(userId);
    }
  }

  /** Состояние игрока: из памяти или из БД с догоном всех таймеров. */
  async getUser(userId: string): Promise<UserRuntimeState | null> {
    const cached = this.users.get(userId);
    if (cached) {
      cached.lastAccessAt = Date.now();
      return cached;
    }

    const row = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        researches: true,
        researchJob: true,
        fleets: {
          orderBy: { arrivesAt: 'asc' },
          include: { originPlanet: true, targetPlanet: true, targetHub: true, targetSystem: true },
        },
        bases: {
          orderBy: { createdAt: 'asc' },
          include: {
            planet: { include: { system: true } },
            buildJob: true,
            shipJobs: { orderBy: { createdAt: 'asc' } },
            ships: true,
            defenseJobs: { orderBy: { createdAt: 'asc' } },
            defenses: true,
          },
        },
      },
    });
    if (!row) return null;

    const now = Date.now();
    const user: UserRuntimeState = {
      userId: row.id,
      credits: row.credits,
      lastAccessAt: now,
      techs: emptyTechLevels(),
      research: null,
      researchDirty: false,
      bases: new Map(),
      fleets: row.fleets.map(toFleetRuntime),
    };

    for (const research of row.researches) {
      user.techs[research.tech] = research.level;
    }
    if (row.researchJob) {
      user.research = {
        tech: row.researchJob.tech,
        targetLevel: row.researchJob.targetLevel,
        baseId: row.researchJob.baseId,
        startedAt: row.researchJob.startedAt.getTime(),
        finishesAt: row.researchJob.finishesAt.getTime(),
      };
    }

    for (const base of row.bases) {
      const ships = emptyShipCounts();
      for (const ship of base.ships) ships[ship.type] = ship.count;

      const defenses = emptyDefenseCounts();
      for (const item of base.defenses) defenses[item.type] = item.count;

      const levels = emptyLevels();
      levels.METAL_MINE = base.metalMineLevel;
      levels.CRYSTAL_MINE = base.crystalMineLevel;
      levels.DEUTERIUM_MINE = base.deuteriumMineLevel;
      levels.SOLAR_PLANT = base.solarPlantLevel;
      levels.RESEARCH_LAB = base.researchLabLevel;
      levels.SHIPYARD = base.shipyardLevel;
      levels.ANTIMATTER_SYNTH = base.antimatterSynthLevel;

      user.bases.set(base.id, {
        id: base.id,
        name: base.name,
        userId: base.userId,
        planetId: base.planetId,
        planetName: base.planet.name,
        planetType: base.planet.type,
        position: base.planet.position,
        size: base.planet.size,
        systemName: base.planet.system.name,
        systemId: base.planet.systemId,
        galaxy: { galaxyX: base.planet.system.galaxyX, galaxyY: base.planet.system.galaxyY },
        anomaly: base.planet.system.anomaly,
        richness: {
          metal: base.planet.metalRichness,
          crystal: base.planet.crystalRichness,
          deuterium: base.planet.deuteriumRichness,
          energy: base.planet.energyRichness,
          antimatter: base.planet.antimatterRichness,
        },
        resources: {
          metal: safeAmount(base.metal),
          crystal: safeAmount(base.crystal),
          deuterium: safeAmount(base.deuterium),
          antimatter: safeAmount(base.antimatter),
        },
        levels,
        buildJob: base.buildJob
          ? {
              building: base.buildJob.building,
              targetLevel: base.buildJob.targetLevel,
              startedAt: base.buildJob.startedAt.getTime(),
              finishesAt: base.buildJob.finishesAt.getTime(),
            }
          : null,
        shipJobs: base.shipJobs.map<ShipJobState>((job) => ({
          id: job.id,
          type: job.type,
          quantity: job.quantity,
          remaining: job.remaining,
          unitSeconds: job.unitSeconds,
          nextUnitAt: job.nextUnitAt.getTime(),
          createdAt: job.createdAt.getTime(),
        })),
        ships,
        defenseJobs: base.defenseJobs.map<DefenseJobState>((job) => ({
          id: job.id,
          type: job.type,
          quantity: job.quantity,
          remaining: job.remaining,
          unitSeconds: job.unitSeconds,
          nextUnitAt: job.nextUnitAt.getTime(),
          createdAt: job.createdAt.getTime(),
        })),
        defenses,
        // Догоняем не больше суток простоя.
        lastTickAt: Math.max(base.lastTickAt.getTime(), now - MAX_OFFLINE_SECONDS * 1000),
        dirty: false,
        jobsDirty: false,
      });
    }

    this.users.set(user.userId, user);

    // Доигрываем все, что произошло, пока игрока не было в сети.
    if (this.settleUser(user, now)) {
      await this.persistUser(user);
    }
    return user;
  }

  getSnapshot(userId: string, now = Date.now()): StateUpdatePayload | null {
    const user = this.users.get(userId);
    if (!user) return null;
    user.lastAccessAt = now;
    return {
      bases: [...user.bases.values()].map((base) => toSnapshot(base, user, now)),
      research: researchSnapshot(user, now),
      fleets: fleetSnapshots(user, now),
      credits: user.credits,
      serverTime: now,
    };
  }

  /* ------------------------- Действия игрока ------------------------- */

  /** Постановка здания в стройку. Проверки и списание — только на сервере. */
  async startBuild(userId: string, baseId: string, type: BuildingType): Promise<ActionResult> {
    const base = await this.resolveBase(userId, baseId);
    if (!base) return { ok: false, error: 'База не найдена' };

    const missing = missingBuildingRequirements(type, base.levels);
    if (missing.length > 0) {
      return { ok: false, error: 'Не выполнены требования по постройкам' };
    }
    if (base.buildJob) return { ok: false, error: 'На базе уже идет стройка' };

    const targetLevel = base.levels[type] + 1;
    const cost = upgradeCost(type, targetLevel);
    if (!hasEnoughResources(base.resources, cost)) {
      return { ok: false, error: 'Недостаточно ресурсов' };
    }

    const now = Date.now();
    const seconds = buildSeconds(type, targetLevel, systemModifiers(base.anomaly));
    subtractResources(base.resources, cost);
    base.buildJob = { building: type, targetLevel, startedAt: now, finishesAt: now + seconds * 1000 };
    base.dirty = true;
    base.jobsDirty = true;

    await this.persistAndEmit(userId);
    return { ok: true, message: `Стройка начата, ${seconds} с до завершения` };
  }

  /** Запуск исследования. Одновременно у игрока идет только одно. */
  async startResearch(userId: string, baseId: string, tech: TechnologyType): Promise<ActionResult> {
    const user = await this.getUser(userId);
    const base = user?.bases.get(baseId);
    if (!user || !base) return { ok: false, error: 'База не найдена' };

    const missing = missingTechRequirements(tech, base.levels, user.techs);
    if (missing.length > 0) {
      return { ok: false, error: 'Не выполнены требования для исследования' };
    }
    if (user.research) return { ok: false, error: 'Лаборатория уже занята другим исследованием' };

    const targetLevel = user.techs[tech] + 1;
    const cost = researchCost(tech, targetLevel);
    if (!hasEnoughResources(base.resources, cost)) {
      return { ok: false, error: 'Недостаточно ресурсов' };
    }

    const now = Date.now();
    const seconds = researchSeconds(
      tech,
      targetLevel,
      base.levels.RESEARCH_LAB,
      user.techs,
      systemModifiers(base.anomaly),
    );
    subtractResources(base.resources, cost);
    user.research = { tech, targetLevel, baseId, startedAt: now, finishesAt: now + seconds * 1000 };
    user.researchDirty = true;
    base.dirty = true;

    await this.persistAndEmit(userId);
    return { ok: true, message: `Исследование начато, ${seconds} с до завершения` };
  }

  /** Заказ кораблей на верфи. Заказы выполняются очередью, корабли выходят поштучно. */
  async orderShips(
    userId: string,
    baseId: string,
    type: ShipType,
    quantity: number,
  ): Promise<ActionResult> {
    const user = await this.getUser(userId);
    const base = user?.bases.get(baseId);
    if (!user || !base) return { ok: false, error: 'База не найдена' };

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SHIP_ORDER) {
      return { ok: false, error: `Количество должно быть от 1 до ${MAX_SHIP_ORDER}` };
    }

    const missing = missingShipRequirements(type, base.levels, user.techs);
    if (missing.length > 0) {
      return { ok: false, error: 'Не выполнены требования для постройки корабля' };
    }

    const cost = multiplyResources(shipCost(type), quantity);
    if (!hasEnoughResources(base.resources, cost)) {
      return { ok: false, error: 'Недостаточно ресурсов' };
    }

    const now = Date.now();
    const unitSeconds = shipUnitSeconds(type, base.levels.SHIPYARD, systemModifiers(base.anomaly));
    subtractResources(base.resources, cost);
    base.shipJobs.push({
      id: randomUUID(),
      type,
      quantity,
      remaining: quantity,
      unitSeconds,
      nextUnitAt: this.queueEndsAt(base.shipJobs, now) + unitSeconds * 1000,
      createdAt: now,
    });
    base.dirty = true;
    base.jobsDirty = true;

    await this.persistAndEmit(userId);
    return { ok: true, message: `Заказ принят: ${quantity} шт., по ${unitSeconds} с за корабль` };
  }

  /**
   * Отправка флота. Проверки состава, груза и топлива — только здесь;
   * корабли, груз и дейтерий списываются с базы отправления сразу.
   */
  async sendFleet(
    userId: string,
    baseId: string,
    target: { planetId?: string; hubId?: string; systemId?: string },
    mission: FleetMission,
    ships: ShipCounts,
    cargo: { metal: number; crystal: number },
    pickup: { metal: number; crystal: number } = { metal: 0, crystal: 0 },
  ): Promise<ActionResult> {
    const user = await this.getUser(userId);
    const base = user?.bases.get(baseId);
    if (!user || !base) return { ok: false, error: 'База не найдена' };

    const compositionError = validateComposition(mission, ships);
    if (compositionError) return { ok: false, error: compositionError };

    // Доступность самой миссии проверяем раньше наличия кораблей:
    // «экспедиции недоступны» — более фундаментальный отказ, чем «не хватает кораблей».
    if (mission === 'EXPEDITION') {
      if (!canExplore(user.techs)) {
        return { ok: false, error: 'Для экспедиций нужна технология «Астрофизика»' };
      }
      const slots = expeditionSlots(user.techs);
      const active = user.fleets.filter((fleet) => fleet.mission === 'EXPEDITION').length;
      if (active >= slots) {
        return {
          ok: false,
          error: `Астрофизика позволяет держать в полете ${slots} экспедиц${slots === 1 ? 'ию' : 'ии'}`,
        };
      }
    }

    for (const type of SHIP_TYPES) {
      const count = ships[type];
      if (!Number.isInteger(count) || count < 0) return { ok: false, error: 'Некорректный состав флота' };
      if (count > base.ships[type]) return { ok: false, error: 'На базе нет столько кораблей' };
    }

    // Куда летим: к планете, к хабу или в глубокий космос — в своей системе или чужой.
    let target_: { position: number; system: { galaxyX: number; galaxyY: number } };
    let targetPlanetId: string | null = null;
    let targetHubId: string | null = null;
    let targetSystemId: string | null = null;

    if (mission === 'EXPEDITION') {
      const system = target.systemId
        ? await prisma.solarSystem.findUnique({ where: { id: target.systemId } })
        : await prisma.solarSystem.findFirst({ where: { planets: { some: { id: base.planetId } } } });
      if (!system) return { ok: false, error: 'Система не найдена' };

      targetSystemId = system.id;
      target_ = { position: DEEP_SPACE_POSITION, system };
    } else if (isHubMission(mission)) {
      const hub = target.hubId
        ? await prisma.tradeHub.findUnique({ where: { id: target.hubId }, include: { system: true } })
        : await prisma.tradeHub.findFirst({
            where: { system: { planets: { some: { id: base.planetId } } } },
            include: { system: true },
          });
      if (!hub) return { ok: false, error: 'Торговый хаб не найден' };
      targetHubId = hub.id;
      target_ = { position: hub.position, system: hub.system };
    } else {
      if (!target.planetId) return { ok: false, error: 'Не указана планета назначения' };
      if (base.planetId === target.planetId) {
        return { ok: false, error: 'Флот уже находится на этой планете' };
      }
      const planet = await prisma.planet.findUnique({
        where: { id: target.planetId },
        include: { base: true, system: true },
      });
      if (!planet) return { ok: false, error: 'Планета не найдена' };
      if (mission === 'TRANSPORT' && !planet.base) {
        return { ok: false, error: 'На планете нет колонии — груз выгружать некуда' };
      }

      if (mission === 'ATTACK') {
        if (!planet.base) return { ok: false, error: 'Атаковать необитаемую планету бессмысленно' };
        if (planet.base.userId === userId) {
          return { ok: false, error: 'Нельзя атаковать собственную колонию' };
        }
        const war = await prisma.warDeclaration.findFirst({
          where: {
            OR: [
              { aggressorId: userId, targetId: planet.base.userId },
              { aggressorId: planet.base.userId, targetId: userId },
            ],
          },
        });
        if (!war) {
          return { ok: false, error: 'Сначала объяви войну этому игроку' };
        }
      }

      targetPlanetId = planet.id;
      target_ = { position: planet.position, system: planet.system };
    }

    // Груз берем только для рейсов, которые что-то везут туда.
    const outboundCargo = mission === 'HUB_PICKUP' ? { metal: 0, crystal: 0 } : cargo;
    const cargoError = validateCargo(ships, outboundCargo);
    if (cargoError) return { ok: false, error: cargoError };
    if (outboundCargo.metal > base.resources.metal || outboundCargo.crystal > base.resources.crystal) {
      return { ok: false, error: 'Недостаточно ресурсов для загрузки' };
    }

    const request = mission === 'HUB_PICKUP' ? pickup : { metal: 0, crystal: 0 };
    if (mission === 'HUB_PICKUP') {
      const requested = request.metal + request.crystal;
      if (requested <= 0) return { ok: false, error: 'Укажи, сколько товара вывезти с хаба' };
      if (requested > fleetCapacity(ships)) {
        return { ok: false, error: `Трюмы вмещают ${fleetCapacity(ships)}, а запрошено ${requested}` };
      }
    }

    const plan = planFlight(
      ships,
      user.techs,
      { position: base.position, system: base.galaxy },
      target_,
    );

    // Межзвездный прыжок возможен только с гипердвигателем и идет на антиматерии.
    if (plan.kind === 'INTERSTELLAR') {
      if (!canJump(user.techs)) {
        return { ok: false, error: 'Для межзвездного прыжка нужен «Гипердвигатель»' };
      }
      if (base.resources.antimatter < plan.antimatter) {
        return {
          ok: false,
          error: `Не хватает антиматерии: нужно ${plan.antimatter}, на базе ${Math.floor(base.resources.antimatter)}`,
        };
      }
    } else if (base.resources.deuterium < plan.fuel) {
      return { ok: false, error: `Не хватает дейтерия: нужно ${plan.fuel}` };
    }

    const now = Date.now();
    const arrivesAt = now + plan.flightSeconds * 1000;
    const returnsAt = arrivesAt + plan.flightSeconds * 1000;

    base.resources.metal -= outboundCargo.metal;
    base.resources.crystal -= outboundCargo.crystal;
    base.resources.deuterium -= plan.fuel;
    base.resources.antimatter -= plan.antimatter;
    for (const type of SHIP_TYPES) base.ships[type] -= ships[type];
    base.dirty = true;
    base.jobsDirty = true;

    const created = await prisma.fleet.create({
      data: {
        userId,
        originBaseId: base.id,
        originPlanetId: base.planetId,
        targetPlanetId,
        targetHubId,
        targetSystemId,
        mission,
        status: 'OUTBOUND',
        probes: ships.PROBE,
        transporters: ships.TRANSPORTER,
        lightFighters: ships.LIGHT_FIGHTER,
        cargoMetal: outboundCargo.metal,
        cargoCrystal: outboundCargo.crystal,
        pickupMetal: request.metal,
        pickupCrystal: request.crystal,
        fuelSpent: plan.fuel,
        antimatterSpent: plan.antimatter,
        interstellar: plan.kind === 'INTERSTELLAR',
        distance: plan.distance,
        speed: plan.speed,
        departedAt: new Date(now),
        arrivesAt: new Date(arrivesAt),
        returnsAt: new Date(returnsAt),
      },
      include: { originPlanet: true, targetPlanet: true, targetHub: true, targetSystem: true },
    });

    user.fleets.push(toFleetRuntime(created));
    await this.persistAndEmit(userId);

    return {
      ok: true,
      message:
        mission === 'EXPEDITION'
          ? `Экспедиция стартовала: ${fleetSize(ships)} кораблей, до точки ${plan.flightSeconds} с`
          : plan.kind === 'INTERSTELLAR'
          ? `Гиперпрыжок: ${fleetSize(ships)} кораблей, в пути ${plan.flightSeconds} с, ` +
            `сожжено ${plan.antimatter} антиматерии`
          : `Флот вылетел: ${fleetSize(ships)} кораблей, в пути ${plan.flightSeconds} с, ` +
            `сожжено ${plan.fuel} дейтерия`,
    };
  }

  /**
   * Обновление баланса криптогривны в памяти после биржевой операции.
   * Источник правды по балансу — БД: тик его не пишет, поэтому конфликта нет.
   */
  syncCredits(userId: string, credits: number): void {
    const user = this.users.get(userId);
    if (!user) return;
    user.credits = credits;
    this.emitUser(userId);
  }

  /** Орбита и координаты системы цели — нужны для предрасчета маршрута. */
  async getTargetLocation(
    target: { planetId?: string; hubId?: string; systemId?: string },
  ): Promise<{ position: number; system: { galaxyX: number; galaxyY: number } } | null> {
    if (target.systemId) {
      const system = await prisma.solarSystem.findUnique({ where: { id: target.systemId } });
      return system ? { position: DEEP_SPACE_POSITION, system } : null;
    }
    if (target.hubId) {
      const hub = await prisma.tradeHub.findUnique({
        where: { id: target.hubId },
        include: { system: true },
      });
      return hub ? { position: hub.position, system: hub.system } : null;
    }
    if (!target.planetId) return null;
    const planet = await prisma.planet.findUnique({
      where: { id: target.planetId },
      include: { system: true },
    });
    return planet ? { position: planet.position, system: planet.system } : null;
  }

  /** Заказ стационарной обороны. Очередь своя, но правила те же, что у кораблей. */
  async orderDefenses(
    userId: string,
    baseId: string,
    type: DefenseType,
    quantity: number,
  ): Promise<ActionResult> {
    const user = await this.getUser(userId);
    const base = user?.bases.get(baseId);
    if (!user || !base) return { ok: false, error: 'База не найдена' };

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_DEFENSE_ORDER) {
      return { ok: false, error: `Количество должно быть от 1 до ${MAX_DEFENSE_ORDER}` };
    }

    const missing = missingDefenseRequirements(type, base.levels, user.techs);
    if (missing.length > 0) {
      return { ok: false, error: 'Не выполнены требования для постройки обороны' };
    }

    const cost = multiplyResources(defenseCost(type), quantity);
    if (!hasEnoughResources(base.resources, cost)) {
      return { ok: false, error: 'Недостаточно ресурсов' };
    }

    const now = Date.now();
    const unitSeconds = defenseUnitSeconds(type, base.levels.SHIPYARD, systemModifiers(base.anomaly));
    subtractResources(base.resources, cost);
    base.defenseJobs.push({
      id: randomUUID(),
      type,
      quantity,
      remaining: quantity,
      unitSeconds,
      nextUnitAt: this.queueEndsAt(base.defenseJobs, now) + unitSeconds * 1000,
      createdAt: now,
    });
    base.dirty = true;
    base.jobsDirty = true;

    await this.persistAndEmit(userId);
    return { ok: true, message: `Заказ принят: ${quantity} шт., по ${unitSeconds} с за установку` };
  }

  /**
   * Момент, когда очередь верфи освободится от уже стоящих заказов.
   * Считается одинаково для кораблей и обороны: очереди независимы,
   * но устроены по одному принципу — тикает только первый заказ.
   */
  private queueEndsAt(jobs: readonly QueueJob[], now: number): number {
    const head = jobs[0];
    if (!head) return now;

    let end = Math.max(head.nextUnitAt, now) + (head.remaining - 1) * head.unitSeconds * 1000;
    for (const job of jobs.slice(1)) {
      end += job.remaining * job.unitSeconds * 1000;
    }
    return end;
  }

  private async resolveBase(userId: string, baseId: string): Promise<BaseRuntimeState | null> {
    const user = await this.getUser(userId);
    return user?.bases.get(baseId) ?? null;
  }

  /* ------------------------- Тик и таймеры ------------------------- */

  /**
   * Один тик игрового мира. Порядок шагов важен:
   *
   * 1. неактивные игроки выгружаются из памяти (их таймеры абсолютны и не теряются);
   * 2. `settleUser` начисляет ресурсы и закрывает истекшие таймеры;
   * 3. состояние рассылается подключенным сокетам;
   * 4. раз в FLEET_SWEEP_EVERY_TICKS проверяются прилеты флотов — глобально,
   *    независимо от того, кто сейчас в сети;
   * 5. раз в PERSIST_EVERY_TICKS ресурсы пачкой уходят в БД.
   *
   * Тик защищен флагом `ticking`: если запись в БД затянулась, следующий
   * интервал не запускает второй проход по тем же данным.
   */
  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;

    try {
      const now = Date.now();
      for (const user of this.users.values()) {
        const connected = (this.connections.get(user.userId) ?? 0) > 0;

        // Игрок без сокетов держится в памяти недолго: таймеры считаются
        // от абсолютных меток времени, поэтому выгрузка ничего не теряет.
        if (!connected && now - user.lastAccessAt > IDLE_EVICT_MS) {
          this.settleUser(user, now);
          await this.persistUser(user);
          this.users.delete(user.userId);
          continue;
        }

        const structural = this.settleUser(user, now);
        if (structural) {
          await this.persistUser(user);
        }
        if (connected) this.emitUser(user.userId, now);
      }

      this.tickCount += 1;
      if (this.tickCount % FLEET_SWEEP_EVERY_TICKS === 0) {
        await this.sweepFleets(now);
      }
      if (this.tickCount % PERSIST_EVERY_TICKS === 0) {
        for (const user of this.users.values()) {
          await this.persistUser(user);
        }
      }
    } catch (error) {
      console.error('[game-loop] ошибка тика:', error);
    } finally {
      this.ticking = false;
    }
  }

/**
   * Начисляет ресурсы и закрывает завершенные таймеры игрока.
   *
   * Ключевая тонкость — догон офлайна. Нельзя просто умножить текущую добычу
   * на время простоя: за это время могла достроиться шахта или закрыться
   * исследование, поднявшее добычу. Поэтому период разбивается на отрезки по
   * моментам завершения стройки и исследования, и на каждом отрезке действует
   * та добыча, которая была актуальна именно тогда.
   *
   * Очереди верфи и обороны разбираются после начисления: выпуск кораблей
   * и пушек на добычу не влияет, поэтому дробить период под них не нужно.
   *
   * @returns true, если что-то завершилось и состояние нужно немедленно сохранить.
   */
  private settleUser(user: UserRuntimeState, now: number): boolean {
    let structural = false;

    const events: Array<{ time: number; apply: () => void }> = [];

    if (user.research && user.research.finishesAt <= now) {
      const research = user.research;
      events.push({
        time: research.finishesAt,
        apply: () => {
          user.techs[research.tech] = research.targetLevel;
          user.research = null;
          user.researchDirty = true;
        },
      });
    }

    for (const base of user.bases.values()) {
      const job = base.buildJob;
      if (job && job.finishesAt <= now) {
        events.push({
          time: job.finishesAt,
          apply: () => {
            base.levels[job.building] = job.targetLevel;
            base.buildJob = null;
            base.dirty = true;
            base.jobsDirty = true;
          },
        });
      }
    }

    events.sort((a, b) => a.time - b.time);

    for (const event of events) {
      for (const base of user.bases.values()) {
        this.accrueTo(base, user, event.time);
      }
      event.apply();
      structural = true;
    }

    for (const base of user.bases.values()) {
      this.accrueTo(base, user, now);
      if (this.settleQueue(base.shipJobs, base.ships, now)) {
        base.jobsDirty = true;
        structural = true;
      }
      if (this.settleQueue(base.defenseJobs, base.defenses, now)) {
        base.jobsDirty = true;
        structural = true;
      }
    }

    return structural;
  }

  private accrueTo(base: BaseRuntimeState, user: UserRuntimeState, time: number): void {
    const seconds = (time - base.lastTickAt) / 1000;
    if (seconds <= 0) return;
    accrue(base, user.techs, seconds);
    base.lastTickAt = time;
  }

  /**
   * Выпускает готовые единицы из очереди верфи.
   *
   * Общий код для кораблей и обороны: очереди хранятся отдельно, но правила
   * одинаковые — заказы идут строго по порядку, единицы выходят поштучно,
   * а следующий заказ стартует ровно в момент завершения предыдущего.
   * Счетчик шагов страхует от зависания на большом офлайн-периоде.
   *
   * @param jobs очередь заказов; исчерпанные заказы удаляются из нее
   * @param counts ангар или позиции обороны, куда попадают готовые единицы
   */
  private settleQueue<T extends string>(
    jobs: QueueJob<T>[],
    counts: Record<T, number>,
    now: number,
  ): boolean {
    let changed = false;
    let steps = 0;

    while (jobs.length > 0 && steps < MAX_QUEUE_STEPS) {
      steps += 1;
      const job = jobs[0];
      if (!job || job.nextUnitAt > now) break;

      counts[job.type] += 1;
      job.remaining -= 1;
      changed = true;

      if (job.remaining <= 0) {
        const finishedAt = job.nextUnitAt;
        jobs.shift();
        const next = jobs[0];
        if (next) next.nextUnitAt = finishedAt + next.unitSeconds * 1000;
      } else {
        job.nextUnitAt += job.unitSeconds * 1000;
      }
    }

    return changed;
  }

  /* ------------------------- Флоты в полете ------------------------- */

  /**
   * Прилеты и возвраты флотов.
   *
   * Обрабатываются глобальным запросом к БД, а не через состояние игрока
   * в памяти: груз должен долетать до получателя и корабли должны
   * возвращаться домой, даже когда обе стороны офлайн.
   *
   * Каждый флот обрабатывается независимо и в своей транзакции — ошибка на
   * одном не мешает остальным. После разбора кэш флотов обновляется только
   * тем игрокам, кто сейчас в сети и увидит изменения в интерфейсе.
   */
  private async sweepFleets(now: number): Promise<void> {
    const timestamp = new Date(now);
    const due = await prisma.fleet.findMany({
      where: {
        OR: [
          { status: 'OUTBOUND', arrivesAt: { lte: timestamp } },
          { status: 'RETURNING', returnsAt: { lte: timestamp } },
        ],
      },
      include: { originPlanet: true, targetPlanet: true, targetHub: true, targetSystem: true },
      orderBy: { arrivesAt: 'asc' },
      take: 200,
    });
    if (due.length === 0) return;

    const affectedUsers = new Set<string>();

    for (const fleet of due) {
      try {
        if (fleet.status === 'OUTBOUND') {
          await this.handleArrival(fleet, now);
        } else {
          await this.handleReturn(fleet);
        }
        affectedUsers.add(fleet.userId);
      } catch (error) {
        console.error(`[game-loop] ошибка обработки флота ${fleet.id}:`, error);
      }
    }

    // Обновляем кэш флотов у тех, кто сейчас в сети.
    for (const userId of affectedUsers) {
      const user = this.users.get(userId);
      if (!user) continue;
      const rows = await prisma.fleet.findMany({
        where: { userId },
        include: { originPlanet: true, targetPlanet: true, targetHub: true, targetSystem: true },
        orderBy: { arrivesAt: 'asc' },
      });
      user.fleets = rows.map(toFleetRuntime);
    }
  }

  /**
   * Прилет: выгрузка груза, сканирование или операция на торговом хабе.
   *
   * Эффект и смена статуса флота идут одной транзакцией: если процесс умрет
   * между ними, при следующем запуске флот снова считался бы прилетевшим
   * и груз зачислился бы дважды.
   */
  private async handleArrival(fleet: FleetRow, now: number): Promise<void> {
    if (fleet.mission === 'TRANSPORT' && fleet.targetPlanetId) {
      const targetBase = await prisma.base.findUnique({ where: { planetId: fleet.targetPlanetId } });
      if (!targetBase) {
        // Колонии больше нет — груз остается в трюмах и вернется домой.
        await prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
        return;
      }

      await this.flushBaseOwner(targetBase.id);
      await prisma.$transaction([
        prisma.base.update({
          where: { id: targetBase.id },
          data: { metal: { increment: fleet.cargoMetal }, crystal: { increment: fleet.cargoCrystal } },
        }),
        prisma.fleet.update({
          where: { id: fleet.id },
          data: { status: 'RETURNING', cargoMetal: 0, cargoCrystal: 0 },
        }),
      ]);
      this.applyMemoryResources(targetBase.id, fleet.cargoMetal, fleet.cargoCrystal);
      return;
    }

    if (fleet.mission === 'SCAN' && fleet.targetPlanetId) {
      const payload = await this.buildScanPayload(fleet.targetPlanetId);
      const planetId = fleet.targetPlanetId;
      await prisma.$transaction([
        ...(payload
          ? [
              prisma.planetScan.upsert({
                where: { userId_planetId: { userId: fleet.userId, planetId } },
                create: { userId: fleet.userId, planetId, scannedAt: new Date(now), data: toJson(payload) },
                update: { scannedAt: new Date(now), data: toJson(payload) },
              }),
            ]
          : []),
        prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } }),
      ]);
      return;
    }

    if (fleet.mission === 'EXPEDITION' && fleet.targetSystemId) {
      await this.resolveExpeditionArrival(fleet, fleet.targetSystemId);
      return;
    }

    if (fleet.mission === 'ATTACK' && fleet.targetPlanetId) {
      await this.resolveAttack(fleet, fleet.targetPlanetId, now);
      return;
    }

    if (fleet.mission === 'HUB_DELIVERY' && fleet.targetHubId) {
      await this.unloadToHub(fleet, fleet.targetHubId);
      return;
    }

    if (fleet.mission === 'HUB_PICKUP' && fleet.targetHubId) {
      await this.loadFromHub(fleet, fleet.targetHubId);
      return;
    }

    await prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
  }

  /**
   * Прибытие экспедиции в глубокий космос.
   *
   * Бросок кубика, возможный бой с пиратами, добыча и отчет пишутся одной
   * транзакцией вместе с судьбой флота. Если процесс упадет между событием
   * и записью флота, при следующем запуске экспедиция сыграла бы заново —
   * с другим случайным исходом и повторной добычей.
   *
   * Найденное едет домой в трюмах: на базу оно попадет обычным возвратным
   * рейсом, через ту же логику, что и торговый груз.
   */
  private async resolveExpeditionArrival(fleet: FleetRow, systemId: string): Promise<void> {
    const ships: ShipCounts = {
      PROBE: fleet.probes,
      TRANSPORTER: fleet.transporters,
      LIGHT_FIGHTER: fleet.lightFighters,
    };

    const user = await this.getUser(fleet.userId);
    const techs = user ? user.techs : emptyTechLevels();
    const result = resolveExpedition(ships, fleetCapacity(ships), techs);

    const survivorCount = SHIP_TYPES.reduce((total, type) => total + result.survivors[type], 0);
    // Металл и кристаллы занимают трюмы, антиматерия едет в баках.
    const holdLimit = fleetCapacity(result.survivors);
    const metal = Math.min(result.loot.metal, holdLimit);
    const crystal = Math.min(result.loot.crystal, Math.max(0, holdLimit - metal));

    await prisma.$transaction(async (tx) => {
      if (survivorCount > 0) {
        await tx.fleet.update({
          where: { id: fleet.id },
          data: {
            status: 'RETURNING',
            probes: result.survivors.PROBE,
            transporters: result.survivors.TRANSPORTER,
            lightFighters: result.survivors.LIGHT_FIGHTER,
            cargoMetal: metal,
            cargoCrystal: crystal,
            cargoAntimatter: result.loot.antimatter,
          },
        });
      } else {
        await tx.fleet.delete({ where: { id: fleet.id } });
      }

      await tx.expeditionReport.create({
        data: {
          userId: fleet.userId,
          systemId,
          outcome: result.outcome,
          lootMetal: metal,
          lootCrystal: crystal,
          lootAntimatter: result.loot.antimatter,
          summary: result.summary,
          data: toJson({
            sent: ships,
            survivors: result.survivors,
            pirates: result.pirates,
            losses: result.battle ? result.battle.attackerLosses : [],
            attackerPower: result.battle ? result.battle.attackerPower.strength : 0,
            piratePower: result.battle ? result.battle.defenderPower.strength : 0,
          }),
        },
      });
    });
  }

  /**
   * Бой при прилете атакующего флота.
   *
   * Последовательность:
   * 1. состояние защитника сбрасывается из памяти в БД, чтобы бой считался
   *    по актуальным силам, а не по данным десятисекундной давности;
   * 2. в одной транзакции: чтение сил защитника → расчет боя → списание
   *    уничтоженных кораблей и пушек → грабеж склада → судьба флота
   *    (разворот с добычей или полное уничтожение) → запись отчета;
   * 3. память защитника приводится к результату боя.
   *
   * Всё внутри одной транзакции сознательно: частично примененный бой после
   * жесткого перезапуска означал бы задвоенные потери, воскресшие корабли
   * или груз, списанный у защитника, но не доехавший до атакующего.
   */
  private async resolveAttack(fleet: FleetRow, planetId: string, now: number): Promise<void> {
    const planet = await prisma.planet.findUnique({
      where: { id: planetId },
      include: { base: true },
    });

    if (!planet?.base) {
      // Колонию успели покинуть — атаковать некого, флот разворачивается.
      await prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
      return;
    }

    const defenderBaseId = planet.base.id;
    const defenderId = planet.base.userId;

    // Сначала сбрасываем состояние защитника в БД, чтобы бой считался по актуальным силам.
    await this.flushBaseOwner(defenderBaseId);

    const attackerShips: ShipCounts = {
      PROBE: fleet.probes,
      TRANSPORTER: fleet.transporters,
      LIGHT_FIGHTER: fleet.lightFighters,
    };

    const result = await prisma.$transaction(async (tx) => {
      const base = await tx.base.findUniqueOrThrow({
        where: { id: defenderBaseId },
        include: { ships: true, defenses: true },
      });

      const defenderShips = emptyShipCounts();
      for (const ship of base.ships) defenderShips[ship.type] = ship.count;
      const defenderDefenses = emptyDefenseCounts();
      for (const item of base.defenses) defenderDefenses[item.type] = item.count;

      const attacker: SideForces = { ships: attackerShips, defenses: emptyDefenseCounts() };
      const defender: SideForces = { ships: defenderShips, defenses: defenderDefenses };
      const outcome = resolveBattle(attacker, defender);

      // Грабеж: только победивший атакующий и только в пределах уцелевших трюмов.
      const plunder =
        outcome.winner === 'ATTACKER'
          ? plunderAmount(
              { metal: base.metal, crystal: base.crystal },
              fleetCapacity(outcome.attackerSurvivors),
            )
          : { metal: 0, crystal: 0 };

      // Потери защитника: корабли и оборона списываются безвозвратно.
      for (const type of SHIP_TYPES) {
        await tx.ship.upsert({
          where: { baseId_type: { baseId: defenderBaseId, type } },
          create: { baseId: defenderBaseId, type, count: outcome.defenderSurvivorShips[type] },
          update: { count: outcome.defenderSurvivorShips[type] },
        });
      }
      for (const type of DEFENSE_TYPES) {
        await tx.defense.upsert({
          where: { baseId_type: { baseId: defenderBaseId, type } },
          create: { baseId: defenderBaseId, type, count: outcome.defenderSurvivorDefenses[type] },
          update: { count: outcome.defenderSurvivorDefenses[type] },
        });
      }

      if (plunder.metal > 0 || plunder.crystal > 0) {
        await tx.base.update({
          where: { id: defenderBaseId },
          data: { metal: { decrement: plunder.metal }, crystal: { decrement: plunder.crystal } },
        });
      }

      const survivorCount =
        outcome.attackerSurvivors.PROBE +
        outcome.attackerSurvivors.TRANSPORTER +
        outcome.attackerSurvivors.LIGHT_FIGHTER;

      if (survivorCount > 0) {
        await tx.fleet.update({
          where: { id: fleet.id },
          data: {
            status: 'RETURNING',
            probes: outcome.attackerSurvivors.PROBE,
            transporters: outcome.attackerSurvivors.TRANSPORTER,
            lightFighters: outcome.attackerSurvivors.LIGHT_FIGHTER,
            cargoMetal: plunder.metal,
            cargoCrystal: plunder.crystal,
          },
        });
      } else {
        // Флот уничтожен полностью — возвращаться некому.
        await tx.fleet.delete({ where: { id: fleet.id } });
      }

      const [attackerUser, defenderUser] = await Promise.all([
        tx.user.findUniqueOrThrow({ where: { id: fleet.userId }, select: { username: true } }),
        tx.user.findUniqueOrThrow({ where: { id: defenderId }, select: { username: true } }),
      ]);

      await tx.battleReport.create({
        data: {
          attackerId: fleet.userId,
          defenderId,
          planetId,
          winner: outcome.winner,
          plunderMetal: plunder.metal,
          plunderCrystal: plunder.crystal,
          data: toJson({
            planetName: planet.name,
            attackerName: attackerUser.username,
            defenderName: defenderUser.username,
            attackerForces: attackerShips,
            defenderForces: { ships: defenderShips, defenses: defenderDefenses },
            attackerPower: outcome.attackerPower,
            defenderPower: outcome.defenderPower,
            attackerLosses: outcome.attackerLosses,
            defenderLosses: outcome.defenderLosses,
            attackerSurvivors: outcome.attackerSurvivors,
            plunder,
            foughtAt: now,
          }),
        },
      });

      return { outcome, plunder, defenderBaseId };
    });

    // Приводим состояние защитника в памяти к тому, что записал бой.
    this.applyBattleToMemory(result.defenderBaseId, result.outcome, result.plunder);
  }

  /** Синхронизация памяти защитника после боя: потери и грабеж уже в БД. */
  private applyBattleToMemory(
    baseId: string,
    outcome: ReturnType<typeof resolveBattle>,
    plunder: { metal: number; crystal: number },
  ): void {
    const base = this.findLoadedBase(baseId);
    if (!base) return;

    for (const type of SHIP_TYPES) base.ships[type] = outcome.defenderSurvivorShips[type];
    for (const type of DEFENSE_TYPES) base.defenses[type] = outcome.defenderSurvivorDefenses[type];
    base.resources.metal = Math.max(0, base.resources.metal - plunder.metal);
    base.resources.crystal = Math.max(0, base.resources.crystal - plunder.crystal);
    base.dirty = true;
    base.jobsDirty = true;
  }

  /**
   * Разгрузка на торговый склад хаба. Что не влезло — остается в трюме
   * и возвращается домой, поэтому расширение склада имеет смысл.
   */
  private async unloadToHub(fleet: FleetRow, hubId: string): Promise<void> {
    await prisma.$transaction(async (tx) => {
      const storage = await tx.hubStorage.upsert({
        where: { userId_hubId: { userId: fleet.userId, hubId } },
        create: { userId: fleet.userId, hubId },
        update: {},
      });

      const capacity = storageCapacity(storage.level);
      const free = Math.max(0, capacity - storageUsed(storage));
      const metal = Math.min(fleet.cargoMetal, free);
      const crystal = Math.min(fleet.cargoCrystal, Math.max(0, free - metal));

      if (metal > 0 || crystal > 0) {
        await tx.hubStorage.update({
          where: { id: storage.id },
          data: { metal: { increment: metal }, crystal: { increment: crystal } },
        });
      }

      await tx.fleet.update({
        where: { id: fleet.id },
        data: {
          status: 'RETURNING',
          cargoMetal: fleet.cargoMetal - metal,
          cargoCrystal: fleet.cargoCrystal - crystal,
        },
      });
    });
  }

  /** Погрузка товара со склада хаба в трюмы — обратно повезем домой. */
  private async loadFromHub(fleet: FleetRow, hubId: string): Promise<void> {
    const capacity = fleetCapacity({
      PROBE: fleet.probes,
      TRANSPORTER: fleet.transporters,
      LIGHT_FIGHTER: fleet.lightFighters,
    });

    await prisma.$transaction(async (tx) => {
      const storage = await tx.hubStorage.findUnique({
        where: { userId_hubId: { userId: fleet.userId, hubId } },
      });

      const metal = storage ? Math.min(fleet.pickupMetal, storage.metal, capacity) : 0;
      const crystal = storage
        ? Math.min(fleet.pickupCrystal, storage.crystal, Math.max(0, capacity - metal))
        : 0;

      if (storage && (metal > 0 || crystal > 0)) {
        // Условное списание: параллельная сделка на бирже могла увести товар.
        const taken = await tx.hubStorage.updateMany({
          where: { id: storage.id, metal: { gte: metal }, crystal: { gte: crystal } },
          data: { metal: { decrement: metal }, crystal: { decrement: crystal } },
        });
        if (taken.count === 0) {
          await tx.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
          return;
        }
      }

      await tx.fleet.update({
        where: { id: fleet.id },
        data: { status: 'RETURNING', cargoMetal: metal, cargoCrystal: crystal },
      });
    });
  }

  /**
   * Возврат: корабли и невыгруженный груз возвращаются на базу отправления.
   * Зачисление и удаление флота — одной транзакцией, иначе перезапуск
   * посреди операции либо задвоил бы корабли, либо потерял их.
   */
  private async handleReturn(fleet: FleetRow): Promise<void> {
    const ships: ShipCounts = {
      PROBE: fleet.probes,
      TRANSPORTER: fleet.transporters,
      LIGHT_FIGHTER: fleet.lightFighters,
    };

    await this.flushBaseOwner(fleet.originBaseId);

    const operations: Array<Prisma.PrismaPromise<unknown>> = [];
    for (const type of SHIP_TYPES) {
      if (ships[type] <= 0) continue;
      operations.push(
        prisma.ship.upsert({
          where: { baseId_type: { baseId: fleet.originBaseId, type } },
          create: { baseId: fleet.originBaseId, type, count: ships[type] },
          update: { count: { increment: ships[type] } },
        }),
      );
    }
    if (fleet.cargoMetal > 0 || fleet.cargoCrystal > 0 || fleet.cargoAntimatter > 0) {
      operations.push(
        prisma.base.update({
          where: { id: fleet.originBaseId },
          data: {
            metal: { increment: fleet.cargoMetal },
            crystal: { increment: fleet.cargoCrystal },
            antimatter: { increment: fleet.cargoAntimatter },
          },
        }),
      );
    }
    operations.push(prisma.fleet.delete({ where: { id: fleet.id } }));

    await prisma.$transaction(operations);

    this.applyMemoryResources(
      fleet.originBaseId,
      fleet.cargoMetal,
      fleet.cargoCrystal,
      fleet.cargoAntimatter,
    );
    this.applyMemoryShips(fleet.originBaseId, ships);
  }

  /** Сбрасывает состояние владельца базы в БД, чтобы транзакция считала от актуальных чисел. */
  private async flushBaseOwner(baseId: string): Promise<void> {
    for (const user of this.users.values()) {
      if (user.bases.has(baseId)) {
        await this.persistUser(user);
        return;
      }
    }
  }

  /** Отражает уже зачисленный в БД приход в состоянии базы, если она в памяти. */
  private applyMemoryResources(
    baseId: string,
    metal: number,
    crystal: number,
    antimatter = 0,
  ): void {
    if (metal <= 0 && crystal <= 0 && antimatter <= 0) return;
    const base = this.findLoadedBase(baseId);
    if (!base) return;
    base.resources.metal += metal;
    base.resources.crystal += crystal;
    base.resources.antimatter += antimatter;
    base.dirty = true;
  }

  private applyMemoryShips(baseId: string, ships: ShipCounts): void {
    const base = this.findLoadedBase(baseId);
    if (!base) return;
    for (const type of SHIP_TYPES) base.ships[type] += ships[type];
    base.jobsDirty = true;
  }

  private findLoadedBase(baseId: string): BaseRuntimeState | null {
    for (const user of this.users.values()) {
      const base = user.bases.get(baseId);
      if (base) return base;
    }
    return null;
  }

  /** Снимок планеты для тумана войны: свежие данные берем из памяти, если владелец онлайн. */
  private async buildScanPayload(planetId: string): Promise<ScanPayload | null> {
    const planet = await prisma.planet.findUnique({
      where: { id: planetId },
      include: { base: { include: { user: true, ships: true } } },
    });
    if (!planet) return null;

    const richness = {
      metal: planet.metalRichness,
      crystal: planet.crystalRichness,
      deuterium: planet.deuteriumRichness,
      energy: planet.energyRichness,
      antimatter: planet.antimatterRichness,
    };

    let payload: ScanPayload = {
      owner: null,
      colonized: false,
      richness,
      buildings: null,
      resources: null,
      fleet: null,
    };

    if (planet.base) {
      const live = this.findLoadedBase(planet.base.id);
      const levels = live
        ? { ...live.levels }
        : {
            METAL_MINE: planet.base.metalMineLevel,
            CRYSTAL_MINE: planet.base.crystalMineLevel,
            DEUTERIUM_MINE: planet.base.deuteriumMineLevel,
            SOLAR_PLANT: planet.base.solarPlantLevel,
            RESEARCH_LAB: planet.base.researchLabLevel,
            SHIPYARD: planet.base.shipyardLevel,
            ANTIMATTER_SYNTH: planet.base.antimatterSynthLevel,
          };
      const resources = live
        ? { ...live.resources }
        : {
            metal: planet.base.metal,
            crystal: planet.base.crystal,
            deuterium: planet.base.deuterium,
            antimatter: planet.base.antimatter,
          };
      const fleet = live ? { ...live.ships } : emptyShipCounts();
      if (!live) {
        for (const ship of planet.base.ships) fleet[ship.type] = ship.count;
      }

      payload = {
        owner: planet.base.user.username,
        colonized: true,
        richness,
        buildings: levels,
        resources: {
          metal: Math.round(resources.metal),
          crystal: Math.round(resources.crystal),
          deuterium: Math.round(resources.deuterium),
          antimatter: Math.round(resources.antimatter),
        },
        fleet,
      };
    }

    return payload;
  }

  /* ------------------------- Сохранение и рассылка ------------------------- */

  private emitUser(userId: string, now = Date.now()): void {
    if (!this.io) return;
    const payload = this.getSnapshot(userId, now);
    if (payload) this.io.to(roomForUser(userId)).emit('state:update', payload);
  }

  private async persistAndEmit(userId: string): Promise<void> {
    const user = this.users.get(userId);
    if (user) await this.persistUser(user);
    this.emitUser(userId);
  }

  /**
   * Пакетная запись всего изменившегося состояния игрока одной транзакцией.
   *
   * Флаги `dirty` (ресурсы и уровни) и `jobsDirty` (очереди, флот, оборона)
   * снимаются ДО запроса: иначе параллельное изменение состояния во время
   * записи потерялось бы. Если транзакция упала, флаги возвращаются обратно,
   * и данные уедут в БД на следующем проходе — тик при этом не падает.
   */
  private async persistUser(user: UserRuntimeState): Promise<void> {
    const operations: Array<Prisma.PrismaPromise<unknown>> = [];
    const touched: BaseRuntimeState[] = [];

    for (const base of user.bases.values()) {
      if (!base.dirty && !base.jobsDirty) continue;
      touched.push(base);

      operations.push(
        prisma.base.update({
          where: { id: base.id },
          data: {
            metal: base.resources.metal,
            crystal: base.resources.crystal,
            deuterium: base.resources.deuterium,
            antimatter: base.resources.antimatter,
            metalMineLevel: base.levels.METAL_MINE,
            crystalMineLevel: base.levels.CRYSTAL_MINE,
            deuteriumMineLevel: base.levels.DEUTERIUM_MINE,
            solarPlantLevel: base.levels.SOLAR_PLANT,
            researchLabLevel: base.levels.RESEARCH_LAB,
            shipyardLevel: base.levels.SHIPYARD,
            antimatterSynthLevel: base.levels.ANTIMATTER_SYNTH,
            lastTickAt: new Date(base.lastTickAt),
          },
        }),
      );

      if (base.jobsDirty) {
        operations.push(prisma.buildJob.deleteMany({ where: { baseId: base.id } }));
        if (base.buildJob) {
          operations.push(
            prisma.buildJob.create({
              data: {
                baseId: base.id,
                building: base.buildJob.building,
                targetLevel: base.buildJob.targetLevel,
                startedAt: new Date(base.buildJob.startedAt),
                finishesAt: new Date(base.buildJob.finishesAt),
              },
            }),
          );
        }

        operations.push(
          prisma.shipJob.deleteMany({
            where: { baseId: base.id, id: { notIn: base.shipJobs.map((job) => job.id) } },
          }),
        );
        for (const job of base.shipJobs) {
          operations.push(
            prisma.shipJob.upsert({
              where: { id: job.id },
              create: {
                id: job.id,
                baseId: base.id,
                type: job.type,
                quantity: job.quantity,
                remaining: job.remaining,
                unitSeconds: job.unitSeconds,
                nextUnitAt: new Date(job.nextUnitAt),
                createdAt: new Date(job.createdAt),
              },
              update: { remaining: job.remaining, nextUnitAt: new Date(job.nextUnitAt) },
            }),
          );
        }

        for (const type of SHIP_TYPES) {
          operations.push(
            prisma.ship.upsert({
              where: { baseId_type: { baseId: base.id, type } },
              create: { baseId: base.id, type, count: base.ships[type] },
              update: { count: base.ships[type] },
            }),
          );
        }

        operations.push(
          prisma.defenseJob.deleteMany({
            where: { baseId: base.id, id: { notIn: base.defenseJobs.map((job) => job.id) } },
          }),
        );
        for (const job of base.defenseJobs) {
          operations.push(
            prisma.defenseJob.upsert({
              where: { id: job.id },
              create: {
                id: job.id,
                baseId: base.id,
                type: job.type,
                quantity: job.quantity,
                remaining: job.remaining,
                unitSeconds: job.unitSeconds,
                nextUnitAt: new Date(job.nextUnitAt),
                createdAt: new Date(job.createdAt),
              },
              update: { remaining: job.remaining, nextUnitAt: new Date(job.nextUnitAt) },
            }),
          );
        }

        for (const type of DEFENSE_TYPES) {
          operations.push(
            prisma.defense.upsert({
              where: { baseId_type: { baseId: base.id, type } },
              create: { baseId: base.id, type, count: base.defenses[type] },
              update: { count: base.defenses[type] },
            }),
          );
        }
      }
    }

    if (user.researchDirty) {
      for (const [tech, level] of Object.entries(user.techs) as Array<[TechnologyType, number]>) {
        operations.push(
          prisma.research.upsert({
            where: { userId_tech: { userId: user.userId, tech } },
            create: { userId: user.userId, tech, level },
            update: { level },
          }),
        );
      }
      operations.push(prisma.researchJob.deleteMany({ where: { userId: user.userId } }));
      if (user.research) {
        operations.push(
          prisma.researchJob.create({
            data: {
              userId: user.userId,
              baseId: user.research.baseId,
              tech: user.research.tech,
              targetLevel: user.research.targetLevel,
              startedAt: new Date(user.research.startedAt),
              finishesAt: new Date(user.research.finishesAt),
            },
          }),
        );
      }
    }

    if (operations.length === 0) return;

    const researchWasDirty = user.researchDirty;
    for (const base of touched) {
      base.dirty = false;
      base.jobsDirty = false;
    }
    user.researchDirty = false;

    try {
      await prisma.$transaction(operations);
    } catch (error) {
      console.error('[game-loop] ошибка сохранения состояния:', error);
      for (const base of touched) {
        base.dirty = true;
        base.jobsDirty = true;
      }
      user.researchDirty = researchWasDirty;
    }
  }
}

/** Prisma требует индексируемый тип для Json-полей, обычные объекты не подходят. */
function toJson(payload: object): Prisma.InputJsonObject {
  return payload as unknown as Prisma.InputJsonObject;
}

/** Заказ в очереди верфи: одинаково устроен для кораблей и обороны. */
interface QueueJob<T extends string = string> {
  type: T;
  remaining: number;
  unitSeconds: number;
  nextUnitAt: number;
}

type FleetRow = Prisma.FleetModel & {
  originPlanet: Prisma.PlanetModel;
  targetPlanet: Prisma.PlanetModel | null;
  targetHub: Prisma.TradeHubModel | null;
  targetSystem: Prisma.SolarSystemModel | null;
};

function toFleetRuntime(row: FleetRow): FleetRuntimeState {
  return {
    id: row.id,
    mission: row.mission,
    status: row.status,
    originBaseId: row.originBaseId,
    originPlanetId: row.originPlanetId,
    originPlanetName: row.originPlanet.name,
    targetKind: row.targetSystemId ? 'DEEP_SPACE' : row.targetHubId ? 'HUB' : 'PLANET',
    targetPlanetId: row.targetPlanetId,
    targetHubId: row.targetHubId,
    targetName:
      row.targetHub?.name ??
      row.targetPlanet?.name ??
      (row.targetSystem ? `глубокий космос · ${row.targetSystem.name}` : 'неизвестно'),
    ships: {
      PROBE: row.probes,
      TRANSPORTER: row.transporters,
      LIGHT_FIGHTER: row.lightFighters,
    },
    cargo: {
      metal: row.cargoMetal,
      crystal: row.cargoCrystal,
      antimatter: row.cargoAntimatter,
    },
    pickup: { metal: row.pickupMetal, crystal: row.pickupCrystal },
    fuelSpent: row.fuelSpent,
    distance: row.distance,
    speed: row.speed,
    departedAt: row.departedAt.getTime(),
    arrivesAt: row.arrivesAt.getTime(),
    returnsAt: row.returnsAt.getTime(),
  };
}

/** Защита от испорченных значений в БД: нечисловой остаток считаем нулевым. */
function safeAmount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function roomForUser(userId: string): string {
  return `user:${userId}`;
}

export const gameLoop = new GameLoop();
