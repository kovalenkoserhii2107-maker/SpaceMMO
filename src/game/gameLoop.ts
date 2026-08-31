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
  type CommanderRuntimeState,
} from './baseState.js';
import {
  canJump,
  fleetCapacity,
  fleetSize,
  isHubMission,
  MISSION_LABELS,
  planFlight,
  validateCargo,
  resolveOneWay,
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
import { plunderAmount, resolveBattle, type SideForces, type UnitLoss } from './combat.js';
import { checkArchitect, checkPirateBane } from '../services/achievementService.js';
import { canAttack, declareWar } from '../services/warService.js';
import { countUnread, deliver, type OutgoingMessage } from '../services/mailService.js';
import {
  buildBattleMail,
  buildColonyFailedMail,
  buildColonyMail,
  buildDeployMail,
  buildExpeditionMail,
  buildHarvestMail,
  buildReturnMail,
  buildSpyMail,
  buildTransportMail,
} from '../services/reportMail.js';
import {
  buildSeconds,
  emptyLevels,
  systemModifiers,
  hasEnoughResources,
  missingBuildingRequirements,
  multiplyResources,
  storageCapacityForLevel,
  subtractResources,
  upgradeCost,
  type BuildingType,
} from './rules.js';
import {
  colonySlots,
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
  shipLabel,
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
/** Сколько раз переработчик пробует забрать поле, если его увели в момент списания. */
const HARVEST_RETRIES = 3;
/** Через сколько простоя выгружать из памяти игрока без активных сокетов. */
const IDLE_EVICT_MS = 60_000;
/** Как часто проверять прилеты флотов (в тиках). */
const FLEET_SWEEP_EVERY_TICKS = 2;

type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };


/**
 * Куда прилетел флот: имя планеты и системы.
 *
 * У записи полета подгружена планета, но не ее система, а письмам логистики
 * нужно и то и другое: «Кобзар II» без системы не говорит ничего. Запрос идет
 * один раз на прилет, а не на каждый тик.
 */
async function arrivalPlace(fleet: FleetRow): Promise<{ planetName: string; systemName: string }> {
  if (fleet.targetSystem) {
    return { planetName: fleet.targetPlanet?.name ?? 'глубокий космос', systemName: fleet.targetSystem.name };
  }
  if (!fleet.targetPlanetId) {
    return { planetName: fleet.targetPlanet?.name ?? 'цель', systemName: 'неизвестная система' };
  }

  const planet = await prisma.planet.findUnique({
    where: { id: fleet.targetPlanetId },
    select: { name: true, system: { select: { name: true } } },
  });
  return {
    planetName: planet?.name ?? fleet.targetPlanet?.name ?? 'цель',
    systemName: planet?.system.name ?? 'неизвестная система',
  };
}

/**
 * Состав флота в форме, которую понимают письма: у каждого класса свое имя
 * и число кораблей. Потерь тут нет — это логистика, а не бой.
 */
function fleetRoster(ships: ShipCounts): UnitLoss[] {
  return SHIP_TYPES.filter((type) => ships[type] > 0).map((type) => ({
    key: type,
    label: shipLabel(type),
    before: ships[type],
    lost: 0,
  }));
}


class GameLoop {
  private io: GameServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private ticking = false;
  /** Состояния online-командиров: commanderId -> состояние. */
  private readonly commanders = new Map<string, CommanderRuntimeState>();
  /** Базы, где достроилось здание: после сохранения проверим «Архитектора». */
  private readonly pendingArchitectChecks = new Set<string>();

  /** Количество сокетов командира. */
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
    for (const commander of this.commanders.values()) {
      await this.persistCommander(commander);
    }
    console.log('[game-loop] остановлен');
  }

  async attachCommander(commanderId: string): Promise<void> {
    this.connections.set(commanderId, (this.connections.get(commanderId) ?? 0) + 1);
    await this.getCommander(commanderId);
  }

  async detachCommander(commanderId: string): Promise<void> {
    const count = (this.connections.get(commanderId) ?? 1) - 1;
    if (count > 0) {
      this.connections.set(commanderId, count);
      return;
    }
    this.connections.delete(commanderId);

    const commander = this.commanders.get(commanderId);
    if (commander) {
      await this.persistCommander(commander);
      this.commanders.delete(commanderId);
    }
  }

  /** Состояние командира: из памяти или из БД с догоном всех таймеров. */
  async getCommander(commanderId: string): Promise<CommanderRuntimeState | null> {
    const cached = this.commanders.get(commanderId);
    if (cached) {
      cached.lastAccessAt = Date.now();
      return cached;
    }

    const row = await prisma.commander.findUnique({
      where: { id: commanderId },
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
    const commander: CommanderRuntimeState = {
      commanderId: row.id,
      credits: row.credits,
      lastAccessAt: now,
      techs: emptyTechLevels(),
      research: null,
      researchDirty: false,
      bases: new Map(),
      fleets: row.fleets.map(toFleetRuntime),
    };

    for (const research of row.researches) {
      commander.techs[research.tech] = research.level;
    }
    if (row.researchJob) {
      commander.research = {
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
      levels.ORE_MINE = base.oreMineLevel;
      levels.POLYMER_PLANT = base.polymerPlantLevel;
      levels.PLASMA_REACTOR = base.plasmaReactorLevel;
      levels.POWER_PLANT = base.powerPlantLevel;
      levels.SCIENCE_CENTER = base.scienceCenterLevel;
      levels.SHIPYARD = base.shipyardLevel;
      levels.ANTIMATTER_FACTORY = base.antimatterFactoryLevel;
      levels.STORAGE = base.storageLevel;

      commander.bases.set(base.id, {
        id: base.id,
        name: base.name,
        commanderId: base.commanderId,
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
          ore: base.planet.oreRichness,
          polymers: base.planet.polymersRichness,
          plasma: base.planet.plasmaRichness,
          energy: base.planet.energyRichness,
          antimatter: base.planet.antimatterRichness,
        },
        resources: {
          ore: safeAmount(base.ore),
          polymers: safeAmount(base.polymers),
          plasma: safeAmount(base.plasma),
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

    this.commanders.set(commander.commanderId, commander);

    // Доигрываем все, что произошло, пока игрока не было в сети.
    if (this.settleCommander(commander, now)) {
      await this.persistCommander(commander);
    }
    return commander;
  }

  getSnapshot(commanderId: string, now = Date.now()): StateUpdatePayload | null {
    const commander = this.commanders.get(commanderId);
    if (!commander) return null;
    commander.lastAccessAt = now;
    return {
      bases: [...commander.bases.values()].map((base) => toSnapshot(base, commander, now)),
      research: researchSnapshot(commander, now),
      fleets: fleetSnapshots(commander, now),
      credits: commander.credits,
      colonies: { used: commander.bases.size, slots: colonySlots(commander.techs) },
      serverTime: now,
    };
  }

  /* ------------------------- Действия игрока ------------------------- */

  /** Постановка здания в стройку. Проверки и списание — только на сервере. */
  async startBuild(commanderId: string, baseId: string, type: BuildingType): Promise<ActionResult> {
    const base = await this.resolveBase(commanderId, baseId);
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

    await this.persistAndEmit(commanderId);
    return { ok: true, message: `Стройка начата, ${seconds} с до завершения` };
  }

  /** Запуск исследования. Одновременно у игрока идет только одно. */
  async startResearch(commanderId: string, baseId: string, tech: TechnologyType): Promise<ActionResult> {
    const commander = await this.getCommander(commanderId);
    const base = commander?.bases.get(baseId);
    if (!commander || !base) return { ok: false, error: 'База не найдена' };

    const missing = missingTechRequirements(tech, base.levels, commander.techs);
    if (missing.length > 0) {
      return { ok: false, error: 'Не выполнены требования для исследования' };
    }
    if (commander.research) return { ok: false, error: 'Лаборатория уже занята другим исследованием' };

    const targetLevel = commander.techs[tech] + 1;
    const cost = researchCost(tech, targetLevel);
    if (!hasEnoughResources(base.resources, cost)) {
      return { ok: false, error: 'Недостаточно ресурсов' };
    }

    const now = Date.now();
    const seconds = researchSeconds(
      tech,
      targetLevel,
      base.levels.SCIENCE_CENTER,
      commander.techs,
      systemModifiers(base.anomaly),
    );
    subtractResources(base.resources, cost);
    commander.research = { tech, targetLevel, baseId, startedAt: now, finishesAt: now + seconds * 1000 };
    commander.researchDirty = true;
    base.dirty = true;

    await this.persistAndEmit(commanderId);
    return { ok: true, message: `Исследование начато, ${seconds} с до завершения` };
  }

  /** Заказ кораблей на верфи. Заказы выполняются очередью, корабли выходят поштучно. */
  async orderShips(
    commanderId: string,
    baseId: string,
    type: ShipType,
    quantity: number,
  ): Promise<ActionResult> {
    const commander = await this.getCommander(commanderId);
    const base = commander?.bases.get(baseId);
    if (!commander || !base) return { ok: false, error: 'База не найдена' };

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_SHIP_ORDER) {
      return { ok: false, error: `Количество должно быть от 1 до ${MAX_SHIP_ORDER}` };
    }

    const missing = missingShipRequirements(type, base.levels, commander.techs);
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

    await this.persistAndEmit(commanderId);
    return { ok: true, message: `Заказ принят: ${quantity} шт., по ${unitSeconds} с за корабль` };
  }

  /**
   * Отправка флота. Проверки состава, груза и топлива — только здесь;
   * корабли, груз и плазма списываются с базы отправления сразу.
   */
  async sendFleet(
    commanderId: string,
    baseId: string,
    target: { planetId?: string; hubId?: string; systemId?: string },
    mission: FleetMission,
    ships: ShipCounts,
    cargo: { ore: number; polymers: number; plasma: number },
    pickup: { ore: number; polymers: number } = { ore: 0, polymers: 0 },
    /** Оставить флот в точке назначения. Учитывается только там, где есть выбор. */
    requestedOneWay = false,
  ): Promise<ActionResult> {
    const commander = await this.getCommander(commanderId);
    const base = commander?.bases.get(baseId);
    if (!commander || !base) return { ok: false, error: 'База не найдена' };

    const oneWay = resolveOneWay(mission, requestedOneWay);

    const compositionError = validateComposition(mission, ships);
    if (compositionError) return { ok: false, error: compositionError };

    // Доступность самой миссии проверяем раньше наличия кораблей:
    // «экспедиции недоступны» — более фундаментальный отказ, чем «не хватает кораблей».
    if (mission === 'EXPEDITION') {
      if (!canExplore(commander.techs)) {
        return { ok: false, error: 'Для экспедиций нужна технология «Астрофизика»' };
      }
      const slots = expeditionSlots(commander.techs);
      const active = commander.fleets.filter(
      (fleet: FleetRuntimeState) => fleet.mission === 'EXPEDITION',
    ).length;
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

      // Обломки висят на орбите сами по себе: колония и дипломатия не важны,
      // собирать можно и над чужой планетой, и над пустой.
      if (mission === 'HARVEST' && planet.debrisOre <= 0 && planet.debrisPolymers <= 0) {
        return { ok: false, error: 'На этой орбите нет поля обломков' };
      }

      if (mission === 'DEPLOY') {
        if (!planet.base || planet.base.commanderId !== commanderId) {
          return { ok: false, error: 'Дислокация возможна только на собственную колонию' };
        }
      }

      if (mission === 'COLONIZE') {
        if (planet.base) {
          return { ok: false, error: 'Планета уже заселена — колонию основать негде' };
        }
        // Слот проверяется и здесь, и на прилете: за время полета игрок мог
        // основать колонию другим кораблем, и лимит к посадке уже исчерпан.
        const slots = colonySlots(commander.techs);
        const owned = await prisma.base.count({ where: { commanderId } });
        if (owned >= slots) {
          return {
            ok: false,
            error:
              `Занято колоний: ${owned} из ${slots}. Подними уровень астрофизики — ` +
              'каждые два уровня открывают новый слот',
          };
        }
      }

      if (mission === 'ATTACK') {
        if (!planet.base) return { ok: false, error: 'Атаковать необитаемую планету бессмысленно' };
        if (planet.base.commanderId === commanderId) {
          return { ok: false, error: 'Нельзя атаковать собственную колонию' };
        }
        /*
         * Войну объявляет сама атака. Раньше вылет отклонялся, пока игрок
         * не сходит в раздел дипломатии и не объявит войну руками — лишний
         * шаг, который к тому же ничего не защищал: объявить ее мог кто угодно.
         * Теперь состояние войны просто возникает вместе с первым вылетом,
         * а о последствиях предупреждает предпросмотр маршрута.
         *
         * Если война уже идет — личная или синдикатная, — объявление не нужно.
         */
        if (!(await canAttack(commanderId, planet.base.commanderId))) {
          const declared = await declareWar(commanderId, planet.base.commanderId);
          // Отказ здесь означает, что воевать с этой целью нельзя в принципе
          // (например, ее уже нет): в бой такой флот отправлять незачем.
          if (!declared.ok) return { ok: false, error: declared.error };
        }
      }

      targetPlanetId = planet.id;
      target_ = { position: planet.position, system: planet.system };
    }

    // Груз берем только для рейсов, которые что-то везут туда.
    // Хаб торгует лишь рудой и полимерами, поэтому плазму туда не грузим.
    const empty = { ore: 0, polymers: 0, plasma: 0 };
    const outboundCargo =
      mission === 'HUB_PICKUP'
        ? empty
        : mission === 'HUB_DELIVERY'
        ? { ...cargo, plasma: 0 }
        : cargo;
    const cargoError = validateCargo(ships, outboundCargo);
    if (cargoError) return { ok: false, error: cargoError };
    if (outboundCargo.ore > base.resources.ore || outboundCargo.polymers > base.resources.polymers) {
      return { ok: false, error: 'Недостаточно ресурсов для загрузки' };
    }

    const request = mission === 'HUB_PICKUP' ? pickup : { ore: 0, polymers: 0 };
    if (mission === 'HUB_PICKUP') {
      const requested = request.ore + request.polymers;
      if (requested <= 0) return { ok: false, error: 'Укажи, сколько товара вывезти с хаба' };
      if (requested > fleetCapacity(ships)) {
        return { ok: false, error: `Трюмы вмещают ${fleetCapacity(ships)}, а запрошено ${requested}` };
      }
    }

    const plan = planFlight(
      ships,
      commander.techs,
      { position: base.position, system: base.galaxy },
      target_,
      { oneWay },
    );

    // Межзвездный прыжок возможен только с гипердвигателем и идет на антиматерии.
    if (plan.kind === 'INTERSTELLAR') {
      if (!canJump(commander.techs)) {
        return { ok: false, error: 'Для межзвездного прыжка нужен «Гипердвигатель»' };
      }
      if (base.resources.antimatter < plan.antimatter) {
        return {
          ok: false,
          error: `Не хватает антиматерии: нужно ${plan.antimatter}, на базе ${Math.floor(base.resources.antimatter)}`,
        };
      }
    }

    // Плазма уходит и в баки, и в трюмы — проверяем сумму, иначе флот
    // улетал бы на топливе, которое сам же и увез грузом.
    const plasmaNeeded = (plan.kind === 'INTERSTELLAR' ? 0 : plan.fuel) + outboundCargo.plasma;
    if (base.resources.plasma < plasmaNeeded) {
      return {
        ok: false,
        error:
          `Не хватает плазмы: нужно ${plasmaNeeded}` +
          (outboundCargo.plasma > 0 ? ` (топливо ${plan.fuel} + груз ${outboundCargo.plasma})` : ''),
      };
    }

    const now = Date.now();
    const arrivesAt = now + plan.flightSeconds * 1000;
    const returnsAt = arrivesAt + plan.flightSeconds * 1000;

    base.resources.ore -= outboundCargo.ore;
    base.resources.polymers -= outboundCargo.polymers;
    base.resources.plasma -= plan.fuel + outboundCargo.plasma;
    base.resources.antimatter -= plan.antimatter;
    for (const type of SHIP_TYPES) base.ships[type] -= ships[type];
    base.dirty = true;
    base.jobsDirty = true;

    const created = await prisma.fleet.create({
      data: {
        commanderId,
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
        heavyCruisers: ships.HEAVY_CRUISER,
        ionFrigates: ships.ION_FRIGATE,
        recyclers: ships.RECYCLER,
        colonyShips: ships.COLONY_SHIP,
        oneWay,
        cargoOre: outboundCargo.ore,
        cargoPolymers: outboundCargo.polymers,
        cargoPlasma: outboundCargo.plasma,
        pickupOre: request.ore,
        pickupPolymers: request.polymers,
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

    commander.fleets.push(toFleetRuntime(created));
    await this.persistAndEmit(commanderId);

    return {
      ok: true,
      message:
        mission === 'EXPEDITION'
          ? `Экспедиция стартовала: ${fleetSize(ships)} кораблей, до точки ${plan.flightSeconds} с`
          : plan.kind === 'INTERSTELLAR'
          ? `Гиперпрыжок: ${fleetSize(ships)} кораблей, в пути ${plan.flightSeconds} с, ` +
            `сожжено ${plan.antimatter} антиматерии`
          : `Флот вылетел: ${fleetSize(ships)} кораблей, в пути ${plan.flightSeconds} с, ` +
            `сожжено ${plan.fuel} плазмы`,
    };
  }

  /**
   * Обновление баланса криптогривны в памяти после биржевой операции.
   * Источник правды по балансу — БД: тик его не пишет, поэтому конфликта нет.
   */
  syncCredits(commanderId: string, credits: number): void {
    const commander = this.commanders.get(commanderId);
    if (!commander) return;
    commander.credits = credits;
    this.emitUser(commanderId);
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
    commanderId: string,
    baseId: string,
    type: DefenseType,
    quantity: number,
  ): Promise<ActionResult> {
    const commander = await this.getCommander(commanderId);
    const base = commander?.bases.get(baseId);
    if (!commander || !base) return { ok: false, error: 'База не найдена' };

    if (!Number.isInteger(quantity) || quantity < 1 || quantity > MAX_DEFENSE_ORDER) {
      return { ok: false, error: `Количество должно быть от 1 до ${MAX_DEFENSE_ORDER}` };
    }

    const missing = missingDefenseRequirements(type, base.levels, commander.techs);
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

    await this.persistAndEmit(commanderId);
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

  private async resolveBase(commanderId: string, baseId: string): Promise<BaseRuntimeState | null> {
    const commander = await this.getCommander(commanderId);
    return commander?.bases.get(baseId) ?? null;
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
      for (const commander of this.commanders.values()) {
        const connected = (this.connections.get(commander.commanderId) ?? 0) > 0;

        // Игрок без сокетов держится в памяти недолго: таймеры считаются
        // от абсолютных меток времени, поэтому выгрузка ничего не теряет.
        if (!connected && now - commander.lastAccessAt > IDLE_EVICT_MS) {
          this.settleCommander(commander, now);
          await this.persistCommander(commander);
          this.commanders.delete(commander.commanderId);
          continue;
        }

        const structural = this.settleCommander(commander, now);
        if (structural) {
          await this.persistCommander(commander);
          await this.flushAchievementChecks();
        }
        if (connected) this.emitUser(commander.commanderId, now);
      }

      this.tickCount += 1;
      if (this.tickCount % FLEET_SWEEP_EVERY_TICKS === 0) {
        await this.sweepFleets(now);
      }
      if (this.tickCount % PERSIST_EVERY_TICKS === 0) {
        for (const commander of this.commanders.values()) {
          await this.persistCommander(commander);
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
  private settleCommander(commander: CommanderRuntimeState, now: number): boolean {
    let structural = false;

    const events: Array<{ time: number; apply: () => void }> = [];

    if (commander.research && commander.research.finishesAt <= now) {
      const research = commander.research;
      events.push({
        time: research.finishesAt,
        apply: () => {
          commander.techs[research.tech] = research.targetLevel;
          commander.research = null;
          commander.researchDirty = true;
        },
      });
    }

    for (const base of commander.bases.values()) {
      const job = base.buildJob;
      if (job && job.finishesAt <= now) {
        events.push({
          time: job.finishesAt,
          apply: () => {
            base.levels[job.building] = job.targetLevel;
            base.buildJob = null;
            base.dirty = true;
            base.jobsDirty = true;
            // Достижения проверяем после сохранения состояния, поэтому только помечаем базу.
            this.pendingArchitectChecks.add(`${commander.commanderId}:${base.id}`);
          },
        });
      }
    }

    events.sort((a, b) => a.time - b.time);

    for (const event of events) {
      for (const base of commander.bases.values()) {
        this.accrueTo(base, commander, event.time);
      }
      event.apply();
      structural = true;
    }

    for (const base of commander.bases.values()) {
      this.accrueTo(base, commander, now);
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

  private accrueTo(base: BaseRuntimeState, commander: CommanderRuntimeState, time: number): void {
    const seconds = (time - base.lastTickAt) / 1000;
    if (seconds <= 0) return;
    accrue(base, commander.techs, seconds);
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

  /**
   * Проверка достижений после того, как состояние уже записано в БД.
   * Движок читает данные из базы, поэтому запускать его до сохранения нельзя —
   * он увидел бы старые уровни построек.
   */
  private async flushAchievementChecks(): Promise<void> {
    if (this.pendingArchitectChecks.size === 0) return;

    const checks = [...this.pendingArchitectChecks];
    this.pendingArchitectChecks.clear();

    for (const entry of checks) {
      const [commanderId, baseId] = entry.split(':');
      if (!commanderId || !baseId) continue;
      try {
        await checkArchitect(commanderId, baseId);
      } catch (error) {
        console.error('[achievements] проверка «Архитектора» не удалась:', error);
      }
    }
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
        affectedUsers.add(fleet.commanderId);
      } catch (error) {
        console.error(`[game-loop] ошибка обработки флота ${fleet.id}:`, error);
      }
    }

    // Обновляем кэш флотов у тех, кто сейчас в сети.
    for (const commanderId of affectedUsers) {
      const commander = this.commanders.get(commanderId);
      if (!commander) continue;
      const rows = await prisma.fleet.findMany({
        where: { commanderId },
        include: { originPlanet: true, targetPlanet: true, targetHub: true, targetSystem: true },
        orderBy: { arrivesAt: 'asc' },
      });
      commander.fleets = rows.map(toFleetRuntime);
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

      /*
       * Рейс в один конец отдает получателю не только груз, но и сами корабли —
       * именно так передают флот союзнику. Садится он тем же `landFleet`,
       * которым садится дислокация: разница лишь в том, чья это база.
       */
      if (fleet.oneWay) {
        const roster = fleetRoster(fleetShips(fleet));
        const cargo = {
          ore: fleet.cargoOre,
          polymers: fleet.cargoPolymers,
          plasma: fleet.cargoPlasma,
        };
        // Место читаем до посадки: она удаляет запись полета.
        const [sender, place] = await Promise.all([
          prisma.commander.findUnique({
            where: { id: fleet.commanderId },
            select: { nickname: true },
          }),
          arrivalPlace(fleet),
        ]);

        await this.landFleet(fleet, targetBase.id);

        await this.notify(
          buildTransportMail({
            senderId: fleet.commanderId,
            recipientId: targetBase.commanderId,
            senderName: sender?.nickname ?? 'неизвестный командир',
            planetName: place.planetName,
            systemName: place.systemName,
            fleet: roster,
            cargo,
            handedOver: true,
          }),
        );
        return;
      }

      await this.flushBaseOwner(targetBase.id);
      await prisma.$transaction([
        prisma.base.update({
          where: { id: targetBase.id },
          data: {
            ore: { increment: fleet.cargoOre },
            polymers: { increment: fleet.cargoPolymers },
            plasma: { increment: fleet.cargoPlasma },
          },
        }),
        prisma.fleet.update({
          where: { id: fleet.id },
          data: { status: 'RETURNING', cargoOre: 0, cargoPolymers: 0, cargoPlasma: 0 },
        }),
      ]);
      this.applyMemoryResources(targetBase.id, {
        ore: fleet.cargoOre,
        polymers: fleet.cargoPolymers,
        plasma: fleet.cargoPlasma,
      });

      const [sender, place] = await Promise.all([
        prisma.commander.findUnique({
          where: { id: fleet.commanderId },
          select: { nickname: true },
        }),
        arrivalPlace(fleet),
      ]);
      await this.notify(
        buildTransportMail({
          senderId: fleet.commanderId,
          recipientId: targetBase.commanderId,
          senderName: sender?.nickname ?? 'неизвестный командир',
          planetName: place.planetName,
          systemName: place.systemName,
          fleet: fleetRoster(fleetShips(fleet)),
          cargo: {
            ore: fleet.cargoOre,
            polymers: fleet.cargoPolymers,
            plasma: fleet.cargoPlasma,
          },
        }),
      );
      return;
    }

    if (fleet.mission === 'DEPLOY' && fleet.targetPlanetId) {
      const targetBase = await prisma.base.findUnique({ where: { planetId: fleet.targetPlanetId } });
      // Колонию могли потерять или отдать, пока флот летел: садиться некуда,
      // и флот разворачивается домой. Топливо за обратный путь при вылете
      // не бралось — возвращаем даром, это лучше, чем бросить флот на орбите.
      if (!targetBase || targetBase.commanderId !== fleet.commanderId) {
        await prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
        return;
      }

      const roster = fleetRoster(fleetShips(fleet));
      const cargo = {
        ore: fleet.cargoOre,
        polymers: fleet.cargoPolymers,
        plasma: fleet.cargoPlasma,
        antimatter: fleet.cargoAntimatter,
      };
      // Место читаем до посадки: она удаляет запись полета.
      const place = await arrivalPlace(fleet);

      await this.landFleet(fleet, targetBase.id);

      await this.notify(
        buildDeployMail({
          commanderId: fleet.commanderId,
          baseName: targetBase.name,
          planetName: place.planetName,
          systemName: place.systemName,
          fleet: roster,
          cargo,
        }),
      );
      return;
    }

    if (fleet.mission === 'COLONIZE' && fleet.targetPlanetId) {
      await this.resolveColonizeArrival(fleet, fleet.targetPlanetId);
      return;
    }

    if (fleet.mission === 'SCAN' && fleet.targetPlanetId) {
      const payload = await this.buildScanPayload(fleet.targetPlanetId);
      const planetId = fleet.targetPlanetId;
      await prisma.$transaction([
        ...(payload
          ? [
              prisma.planetScan.upsert({
                where: { commanderId_planetId: { commanderId: fleet.commanderId, planetId } },
                create: { commanderId: fleet.commanderId, planetId, scannedAt: new Date(now), data: toJson(payload) },
                update: { scannedAt: new Date(now), data: toJson(payload) },
              }),
            ]
          : []),
        prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } }),
      ]);

      // Снимок на карте стареет и через сутки прячет цифры, а письмо остается
      // как зафиксированный момент — по нему видно, что было на планете тогда.
      if (payload) {
        const planet = await prisma.planet.findUnique({
          where: { id: planetId },
          select: { name: true, system: { select: { name: true } } },
        });
        await this.notify(
          buildSpyMail({
            commanderId: fleet.commanderId,
            planetName: planet?.name ?? 'неизвестной планеты',
            systemName: planet?.system.name ?? '—',
            payload,
          }),
        );
      }
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

    if (fleet.mission === 'HARVEST' && fleet.targetPlanetId) {
      await this.harvestDebris(fleet, fleet.targetPlanetId);
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
   * Сборка поля обломков.
   *
   * Гонка здесь реальная: два переработчика могут прилететь в один тик, и оба
   * увидят одно и то же поле. Поэтому списание идет условным `updateMany` —
   * поле уменьшается, только если в нем еще лежит столько, сколько мы забираем.
   * Проигравший гонку получает count = 0, перечитывает остаток и берет то,
   * что осталось. Дюпнуть обломки нельзя: БД разрешит списать их ровно один раз.
   */
  private async harvestDebris(fleet: FleetRow, planetId: string): Promise<void> {
    const capacity = fleetCapacity(fleetShips(fleet));
    let takenOre = 0;
    let takenPolymers = 0;

    for (let attempt = 0; attempt < HARVEST_RETRIES; attempt += 1) {
      const planet = await prisma.planet.findUnique({
        where: { id: planetId },
        select: { debrisOre: true, debrisPolymers: true },
      });
      if (!planet) break;

      // Трюмы делятся между рудой и полимерыом: сперва руда, остаток — полимеры.
      const ore = Math.floor(Math.min(planet.debrisOre, capacity));
      const polymers = Math.floor(Math.min(planet.debrisPolymers, Math.max(0, capacity - ore)));
      if (ore <= 0 && polymers <= 0) break;

      const { count } = await prisma.planet.updateMany({
        where: {
          id: planetId,
          debrisOre: { gte: ore },
          debrisPolymers: { gte: polymers },
        },
        data: {
          debrisOre: { decrement: ore },
          debrisPolymers: { decrement: polymers },
        },
      });

      if (count > 0) {
        takenOre = ore;
        takenPolymers = polymers;
        break;
      }
      // Поле увели из-под носа между чтением и списанием — пробуем по остатку.
    }

    await prisma.fleet.update({
      where: { id: fleet.id },
      data: {
        status: 'RETURNING',
        cargoOre: { increment: takenOre },
        cargoPolymers: { increment: takenPolymers },
      },
    });

    const planet = await prisma.planet.findUnique({
      where: { id: planetId },
      select: { name: true, system: { select: { name: true } } },
    });
    await this.notify(
      buildHarvestMail({
        commanderId: fleet.commanderId,
        planetName: planet?.name ?? 'неизвестной планеты',
        systemName: planet?.system.name ?? '—',
        capacity,
        ore: takenOre,
        polymers: takenPolymers,
      }),
    );
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
  /**
   * Прилет колонизатора. Планета могла быть занята, а слот — израсходован
   * другим рейсом, пока флот летел, поэтому обе проверки повторяются здесь:
   * та, что была при вылете, говорила о состоянии дел получасовой давности.
   *
   * Сорвавшийся рейс не наказывается: топливо на обратный путь при вылете
   * не бралось (рейс односторонний), и флот возвращается даром — бросить его
   * на чужой орбите было бы хуже.
   */
  private async resolveColonizeArrival(fleet: FleetRow, planetId: string): Promise<void> {
    const ships = fleetShips(fleet);
    const planet = await prisma.planet.findUnique({
      where: { id: planetId },
      include: { base: true, system: true },
    });

    const commander = await this.getCommander(fleet.commanderId);
    const techs = commander ? commander.techs : emptyTechLevels();
    const slots = colonySlots(techs);
    const owned = await prisma.base.count({ where: { commanderId: fleet.commanderId } });

    const reason = !planet
      ? 'планета не найдена'
      : planet.base
        ? 'ее успели заселить до нас'
        : owned >= slots
          ? `свободных слотов под колонию не осталось (занято ${owned} из ${slots})`
          : ships.COLONY_SHIP <= 0
            ? 'колониальный транспорт не дошел до цели'
            : null;

    if (reason) {
      await prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
      const place = await arrivalPlace(fleet);
      await this.notify(
        buildColonyFailedMail({
          commanderId: fleet.commanderId,
          planetName: place.planetName,
          systemName: place.systemName,
          reason,
          fleet: fleetRoster(ships),
        }),
      );
      return;
    }

    // Дальше planet точно есть и свободна — проверки выше это гарантируют.
    const target = planet as NonNullable<typeof planet>;

    // Основатель разбирается на первую инфраструктуру: из состава он уходит,
    // остальной флот переходит новой колонии — тем же `landFleet`, которым
    // садится дислокация. Лишние колонизаторы остаются на борту как груз.
    const landing = { ...ships, COLONY_SHIP: ships.COLONY_SHIP - 1 };
    const cargo = {
      ore: fleet.cargoOre,
      polymers: fleet.cargoPolymers,
      plasma: fleet.cargoPlasma,
      antimatter: fleet.cargoAntimatter,
    };
    const baseName = `Колония ${target.name}`;

    await this.withCommanderReloaded(fleet.commanderId, async () => {
      // Уникальный индекс на Base.planetId — последний рубеж от гонки двух
      // рейсов к одной планете: проверка выше и вставка идут не атомарно.
      // Проигравший упрется в него, ошибка попадет в лог тика, а флот
      // останется OUTBOUND и разберется следующим тиком — тогда планета уже
      // занята, и он честно уйдет домой по ветке отказа.
      const base = await prisma.base.create({
        data: { name: baseName, commanderId: fleet.commanderId, planetId: target.id },
      });
      await this.landFleet(fleet, base.id, landing);
    });

    await this.notify(
      buildColonyMail({
        commanderId: fleet.commanderId,
        baseName,
        planetName: target.name,
        systemName: target.system.name,
        galaxyX: target.system.galaxyX,
        galaxyY: target.system.galaxyY,
        position: target.position,
        fleet: fleetRoster(landing),
        cargo,
        used: owned + 1,
        slots,
      }),
    );
  }

  private async resolveExpeditionArrival(fleet: FleetRow, systemId: string): Promise<void> {
    const ships = fleetShips(fleet);

    const commander = await this.getCommander(fleet.commanderId);
    const techs = commander ? commander.techs : emptyTechLevels();
    const result = resolveExpedition(ships, fleetCapacity(ships), techs);

    const survivorCount = SHIP_TYPES.reduce((total, type) => total + result.survivors[type], 0);
    // Руда и полимеры занимают трюмы, антиматерия едет в баках.
    const holdLimit = fleetCapacity(result.survivors);
    const ore = Math.min(result.loot.ore, holdLimit);
    const polymers = Math.min(result.loot.polymers, Math.max(0, holdLimit - ore));

    await prisma.$transaction(async (tx) => {
      if (survivorCount > 0) {
        await tx.fleet.update({
          where: { id: fleet.id },
          data: {
            status: 'RETURNING',
            probes: result.survivors.PROBE,
            transporters: result.survivors.TRANSPORTER,
            lightFighters: result.survivors.LIGHT_FIGHTER,
            heavyCruisers: result.survivors.HEAVY_CRUISER,
            ionFrigates: result.survivors.ION_FRIGATE,
            recyclers: result.survivors.RECYCLER,
            colonyShips: result.survivors.COLONY_SHIP,
            cargoOre: ore,
            cargoPolymers: polymers,
            cargoAntimatter: result.loot.antimatter,
          },
        });
      } else {
        await tx.fleet.delete({ where: { id: fleet.id } });
      }

      await tx.expeditionReport.create({
        data: {
          commanderId: fleet.commanderId,
          systemId,
          outcome: result.outcome,
          lootOre: ore,
          lootPolymers: polymers,
          lootAntimatter: result.loot.antimatter,
          summary: result.summary,
          data: toJson({
            sent: ships,
            survivors: result.survivors,
            pirates: result.pirates,
            losses: result.battle ? result.battle.attackerLosses : [],
            attackerPower: result.battle ? result.battle.attackerPower.effectiveHp : 0,
            piratePower: result.battle ? result.battle.defenderPower.effectiveHp : 0,
            damageReport: result.battle ? result.battle.attackerDamageReport : null,
          }),
        },
      });
    });

    await checkPirateBane(fleet.commanderId, result.outcome).catch((error: unknown) =>
      console.error('[achievements] проверка «Грозы пиратов» не удалась:', error),
    );

    const system = await prisma.solarSystem.findUnique({
      where: { id: systemId },
      select: { name: true },
    });
    await this.notify(
      buildExpeditionMail({
        commanderId: fleet.commanderId,
        systemName: system?.name ?? 'неизвестной системы',
        result,
      }),
    );
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
      include: { base: true, system: true },
    });

    if (!planet?.base) {
      // Колонию успели покинуть — атаковать некого, флот разворачивается.
      await prisma.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
      return;
    }

    const defenderBaseId = planet.base.id;
    const defenderId = planet.base.commanderId;

    // Сначала сбрасываем состояние защитника в БД, чтобы бой считался по актуальным силам.
    await this.flushBaseOwner(defenderBaseId);

    const attackerShips = fleetShips(fleet);

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

      // Грабеж: только победивший атакующий, только уязвимый излишек склада
      // и только в пределах трюмов уцелевших кораблей.
      const plunder = plunderAmount(
        { ore: base.ore, polymers: base.polymers, plasma: base.plasma },
        storageCapacityForLevel(base.storageLevel),
        outcome.winner === 'ATTACKER' ? fleetCapacity(outcome.attackerSurvivors) : 0,
      );

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

      // Обломки оседают в той же транзакции, что и потери: поле обломков —
      // прямое следствие боя, и половинчатого результата тут быть не должно.
      if (outcome.debris.ore > 0 || outcome.debris.polymers > 0) {
        await tx.planet.update({
          where: { id: planetId },
          data: {
            debrisOre: { increment: outcome.debris.ore },
            debrisPolymers: { increment: outcome.debris.polymers },
          },
        });
      }

      if (plunder.ore > 0 || plunder.polymers > 0 || plunder.plasma > 0) {
        await tx.base.update({
          where: { id: defenderBaseId },
          data: {
            ore: { decrement: plunder.ore },
            polymers: { decrement: plunder.polymers },
            plasma: { decrement: plunder.plasma },
          },
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
            heavyCruisers: outcome.attackerSurvivors.HEAVY_CRUISER,
            ionFrigates: outcome.attackerSurvivors.ION_FRIGATE,
            recyclers: outcome.attackerSurvivors.RECYCLER,
            colonyShips: outcome.attackerSurvivors.COLONY_SHIP,
            cargoOre: plunder.ore,
            cargoPolymers: plunder.polymers,
            cargoPlasma: plunder.plasma,
          },
        });
      } else {
        // Флот уничтожен полностью — возвращаться некому.
        await tx.fleet.delete({ where: { id: fleet.id } });
      }

      const [attackerProfile, defenderProfile] = await Promise.all([
        tx.commander.findUniqueOrThrow({ where: { id: fleet.commanderId }, select: { nickname: true } }),
        tx.commander.findUniqueOrThrow({ where: { id: defenderId }, select: { nickname: true } }),
      ]);

      // Счетчики боев в профиле командира.
      await tx.commander.update({
        where: { id: fleet.commanderId },
        data:
          outcome.winner === 'ATTACKER'
            ? { battlesWon: { increment: 1 } }
            : { battlesLost: { increment: 1 } },
      });
      await tx.commander.update({
        where: { id: defenderId },
        data:
          outcome.winner === 'DEFENDER'
            ? { battlesWon: { increment: 1 } }
            : { battlesLost: { increment: 1 } },
      });

      await tx.battleReport.create({
        data: {
          attackerId: fleet.commanderId,
          defenderId,
          planetId,
          winner: outcome.winner,
          plunderOre: plunder.ore,
          plunderPolymers: plunder.polymers,
          plunderPlasma: plunder.plasma,
          data: toJson({
            planetName: planet.name,
            attackerName: attackerProfile.nickname,
            defenderName: defenderProfile.nickname,
            attackerForces: attackerShips,
            defenderForces: { ships: defenderShips, defenses: defenderDefenses },
            attackerPower: outcome.attackerPower,
            defenderPower: outcome.defenderPower,
            attackerDamageReport: outcome.attackerDamageReport,
            defenderDamageReport: outcome.defenderDamageReport,
            attackerLosses: outcome.attackerLosses,
            defenderLosses: outcome.defenderLosses,
            attackerSurvivors: outcome.attackerSurvivors,
            debris: outcome.debris,
            plunder,
            storageDefense: {
              capacity: Math.round(plunder.storageCapacity),
              stored: Math.round(plunder.stored),
              protectedAmount: Math.round(plunder.protectedAmount),
              surplus: Math.round(plunder.surplus),
              takeable: plunder.takeable,
              cargoLimited: plunder.cargoLimited,
            },
            foughtAt: now,
          }),
        },
      });

      return {
        outcome,
        plunder,
        defenderBaseId,
        attackerName: attackerProfile.nickname,
        defenderName: defenderProfile.nickname,
      };
    });

    // Приводим состояние защитника в памяти к тому, что записал бой.
    this.applyBattleToMemory(result.defenderBaseId, result.outcome, result.plunder);

    // Обе стороны получают свой экземпляр отчета: один и тот же бой, но с их
    // точки зрения — иначе защитник читал бы письмо про «свои» трофеи.
    await this.notify(
      buildBattleMail({
        attackerId: fleet.commanderId,
        defenderId,
        attackerName: result.attackerName,
        defenderName: result.defenderName,
        location: {
          planetName: planet.name,
          systemName: planet.system.name,
          position: planet.position,
          galaxyX: planet.system.galaxyX,
          galaxyY: planet.system.galaxyY,
        },
        outcome: result.outcome,
        plunder: result.plunder,
      }),
    );
  }

  /**
   * Сброс состояния игрока из памяти в БД без выгрузки.
   * Нужен всем, кто читает игрока напрямую из базы: иначе видны числа,
   * устаревшие на несколько секунд тика.
   */
  async flushCommander(commanderId: string): Promise<void> {
    const commander = this.commanders.get(commanderId);
    if (commander) await this.persistCommander(commander);
  }

  /**
   * Правка состояния игрока в обход обычных правил (пульт гейм-мастера).
   *
   * Главная сложность — тик держит состояние загруженных игроков в памяти и
   * периодически пишет его в БД. Если админ поправит базу напрямую, ближайший
   * сброс из памяти затрет правку. Поэтому порядок такой:
   *
   * 1. сбрасываем актуальное состояние игрока в БД и убираем его из памяти —
   *    после этого тик про него не знает и ничего не перезапишет;
   * 2. выполняем правку по свежим данным;
   * 3. при следующем обращении игрок загрузится из БД уже с новыми числами,
   *    а подключенному клиенту сразу уходит обновленное состояние.
   *
   * Выгрузка не рвет сокет: `connections` не трогаем, а `getCommander`
   * поднимет игрока обратно из БД по первому же запросу.
   */
  /** Сколько игроков сейчас в сети. Живые сокеты, а не время последнего входа. */
  onlineCount(): number {
    return this.connections.size;
  }

  /**
   * Владелец планеты по цели полета — для предупреждений предпросмотра.
   * Цель хаба или глубокого космоса владельца не имеет, и это не ошибка.
   */
  async planetOwner(target: { planetId?: string }): Promise<string | null> {
    if (!target.planetId) return null;
    const base = await prisma.base.findUnique({
      where: { planetId: target.planetId },
      select: { commanderId: true },
    });
    return base?.commanderId ?? null;
  }

  async applyAdminMutation<T>(commanderId: string, mutate: () => Promise<T>): Promise<T> {
    return this.withCommanderReloaded(commanderId, mutate);
  }

  /**
   * Выполнить операцию, меняющую состав баз или ресурсы игрока в обход тика.
   *
   * Тик держит игроков в памяти и периодически пишет их в БД, поэтому прямая
   * запись живет только до ближайшего сброса — а новую базу тик и вовсе
   * не увидит, пока не перечитает игрока. Поэтому игрок сначала сбрасывается
   * и выгружается, а после операции подгружается заново уже с изменениями.
   */
  private async withCommanderReloaded<T>(commanderId: string, mutate: () => Promise<T>): Promise<T> {
    const commander = this.commanders.get(commanderId);
    if (commander) {
      await this.persistCommander(commander);
      this.commanders.delete(commanderId);
    }

    const result = await mutate();

    // Если игрок онлайн, показываем ему новое состояние немедленно.
    if (this.connections.has(commanderId)) {
      await this.getCommander(commanderId);
      this.emitUser(commanderId);
    }
    return result;
  }

  /** Обновить бейдж непрочитанного у конкретного командира. */
  pushUnread(commanderId: string): void {
    if (!this.io) return;
    void countUnread(commanderId)
      .then((unread) => this.io?.to(roomForCommander(commanderId)).emit('mail:unread', { unread }))
      .catch((error: unknown) => console.error('[mail] не удалось обновить счетчик', error));
  }

  /**
   * Доставка писем и обновление счетчика в шапке.
   *
   * Бейдж шлем отдельным событием, а не в общем снимке состояния: письма приходят
   * и офлайн-игрокам, а `state:update` уходит только тем, кто держит сокет.
   * Сбой доставки не должен ронять тик, поэтому ошибки логируются, а не всплывают.
   */
  private async notify(messages: OutgoingMessage[]): Promise<void> {
    if (messages.length === 0) return;

    try {
      const recipients = await deliver(messages);
      if (!this.io) return;

      for (const commanderId of recipients) {
        const unread = await countUnread(commanderId);
        this.io.to(roomForCommander(commanderId)).emit('mail:unread', { unread });
      }
    } catch (error: unknown) {
      console.error('[mail] не удалось доставить письма', error);
    }
  }

  /** Синхронизация памяти защитника после боя: потери и грабеж уже в БД. */
  private applyBattleToMemory(
    baseId: string,
    outcome: ReturnType<typeof resolveBattle>,
    plunder: { ore: number; polymers: number; plasma: number },
  ): void {
    const base = this.findLoadedBase(baseId);
    if (!base) return;

    for (const type of SHIP_TYPES) base.ships[type] = outcome.defenderSurvivorShips[type];
    for (const type of DEFENSE_TYPES) base.defenses[type] = outcome.defenderSurvivorDefenses[type];
    base.resources.ore = Math.max(0, base.resources.ore - plunder.ore);
    base.resources.polymers = Math.max(0, base.resources.polymers - plunder.polymers);
    base.resources.plasma = Math.max(0, base.resources.plasma - plunder.plasma);
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
        where: { commanderId_hubId: { commanderId: fleet.commanderId, hubId } },
        create: { commanderId: fleet.commanderId, hubId },
        update: {},
      });

      const capacity = storageCapacity(storage.level);
      const free = Math.max(0, capacity - storageUsed(storage));
      const ore = Math.min(fleet.cargoOre, free);
      const polymers = Math.min(fleet.cargoPolymers, Math.max(0, free - ore));

      if (ore > 0 || polymers > 0) {
        await tx.hubStorage.update({
          where: { id: storage.id },
          data: { ore: { increment: ore }, polymers: { increment: polymers } },
        });
      }

      await tx.fleet.update({
        where: { id: fleet.id },
        data: {
          status: 'RETURNING',
          cargoOre: fleet.cargoOre - ore,
          cargoPolymers: fleet.cargoPolymers - polymers,
        },
      });
    });
  }

  /** Погрузка товара со склада хаба в трюмы — обратно повезем домой. */
  private async loadFromHub(fleet: FleetRow, hubId: string): Promise<void> {
    const capacity = fleetCapacity(fleetShips(fleet));

    await prisma.$transaction(async (tx) => {
      const storage = await tx.hubStorage.findUnique({
        where: { commanderId_hubId: { commanderId: fleet.commanderId, hubId } },
      });

      const ore = storage ? Math.min(fleet.pickupOre, storage.ore, capacity) : 0;
      const polymers = storage
        ? Math.min(fleet.pickupPolymers, storage.polymers, Math.max(0, capacity - ore))
        : 0;

      if (storage && (ore > 0 || polymers > 0)) {
        // Условное списание: параллельная сделка на бирже могла увести товар.
        const taken = await tx.hubStorage.updateMany({
          where: { id: storage.id, ore: { gte: ore }, polymers: { gte: polymers } },
          data: { ore: { decrement: ore }, polymers: { decrement: polymers } },
        });
        if (taken.count === 0) {
          await tx.fleet.update({ where: { id: fleet.id }, data: { status: 'RETURNING' } });
          return;
        }
      }

      await tx.fleet.update({
        where: { id: fleet.id },
        data: { status: 'RETURNING', cargoOre: ore, cargoPolymers: polymers },
      });
    });
  }

  /**
   * Возврат: корабли и невыгруженный груз возвращаются на базу отправления.
   * Зачисление и удаление флота — одной транзакцией, иначе перезапуск
   * посреди операции либо задвоил бы корабли, либо потерял их.
   */
  private async handleReturn(fleet: FleetRow): Promise<void> {
    // Состав и груз читаем до посадки: она удаляет запись полета.
    const roster = fleetRoster(fleetShips(fleet));
    const cargo = {
      ore: fleet.cargoOre,
      polymers: fleet.cargoPolymers,
      plasma: fleet.cargoPlasma,
      antimatter: fleet.cargoAntimatter,
    };

    const base = await prisma.base.findUnique({
      where: { id: fleet.originBaseId },
      select: { name: true },
    });

    await this.landFleet(fleet, fleet.originBaseId);

    await this.notify(
      buildReturnMail({
        commanderId: fleet.commanderId,
        baseName: base?.name ?? 'базу',
        planetName: fleet.originPlanet.name,
        missionLabel: MISSION_LABELS[fleet.mission],
        fleet: roster,
        cargo,
      }),
    );
  }

  /**
   * Посадка флота на базу: корабли и груз переходят колонии, запись полета
   * удаляется. Возврат домой, дислокация и колонизация отличаются только тем,
   * на какую базу садится флот и в каком составе, поэтому операция одна.
   */
  private async landFleet(fleet: FleetRow, baseId: string, override?: ShipCounts): Promise<void> {
    // Состав можно подменить: колонизация сажает флот без корабля-основателя,
    // он остается на планете первой инфраструктурой, а не пополняет ангар.
    const ships = override ?? fleetShips(fleet);

    await this.flushBaseOwner(baseId);

    const operations: Array<Prisma.PrismaPromise<unknown>> = [];
    for (const type of SHIP_TYPES) {
      if (ships[type] <= 0) continue;
      operations.push(
        prisma.ship.upsert({
          where: { baseId_type: { baseId: baseId, type } },
          create: { baseId: baseId, type, count: ships[type] },
          update: { count: { increment: ships[type] } },
        }),
      );
    }
    if (
      fleet.cargoOre > 0 ||
      fleet.cargoPolymers > 0 ||
      fleet.cargoPlasma > 0 ||
      fleet.cargoAntimatter > 0
    ) {
      operations.push(
        prisma.base.update({
          where: { id: baseId },
          data: {
            ore: { increment: fleet.cargoOre },
            polymers: { increment: fleet.cargoPolymers },
            plasma: { increment: fleet.cargoPlasma },
            antimatter: { increment: fleet.cargoAntimatter },
          },
        }),
      );
    }
    operations.push(prisma.fleet.delete({ where: { id: fleet.id } }));

    await prisma.$transaction(operations);

    this.applyMemoryResources(baseId, {
      ore: fleet.cargoOre,
      polymers: fleet.cargoPolymers,
      plasma: fleet.cargoPlasma,
      antimatter: fleet.cargoAntimatter,
    });
    this.applyMemoryShips(baseId, ships);
  }

  /** Сбрасывает состояние владельца базы в БД, чтобы транзакция считала от актуальных чисел. */
  private async flushBaseOwner(baseId: string): Promise<void> {
    for (const commander of this.commanders.values()) {
      if (commander.bases.has(baseId)) {
        await this.persistCommander(commander);
        return;
      }
    }
  }

  /** Отражает уже зачисленный в БД приход в состоянии базы, если она в памяти. */
  private applyMemoryResources(
    baseId: string,
    amounts: { ore?: number; polymers?: number; plasma?: number; antimatter?: number },
  ): void {
    const ore = amounts.ore ?? 0;
    const polymers = amounts.polymers ?? 0;
    const plasma = amounts.plasma ?? 0;
    const antimatter = amounts.antimatter ?? 0;
    if (ore <= 0 && polymers <= 0 && plasma <= 0 && antimatter <= 0) return;

    const base = this.findLoadedBase(baseId);
    if (!base) return;
    base.resources.ore += ore;
    base.resources.polymers += polymers;
    base.resources.plasma += plasma;
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
    for (const commander of this.commanders.values()) {
      const base = commander.bases.get(baseId);
      if (base) return base;
    }
    return null;
  }

  /** Снимок планеты для тумана войны: свежие данные берем из памяти, если владелец онлайн. */
  private async buildScanPayload(planetId: string): Promise<ScanPayload | null> {
    const planet = await prisma.planet.findUnique({
      where: { id: planetId },
      include: { base: { include: { commander: true, ships: true, defenses: true } } },
    });
    if (!planet) return null;

    const richness = {
      ore: planet.oreRichness,
      polymers: planet.polymersRichness,
      plasma: planet.plasmaRichness,
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
      defenses: null,
    };

    if (planet.base) {
      const live = this.findLoadedBase(planet.base.id);
      const levels = live
        ? { ...live.levels }
        : {
            ORE_MINE: planet.base.oreMineLevel,
            POLYMER_PLANT: planet.base.polymerPlantLevel,
            PLASMA_REACTOR: planet.base.plasmaReactorLevel,
            POWER_PLANT: planet.base.powerPlantLevel,
            SCIENCE_CENTER: planet.base.scienceCenterLevel,
            SHIPYARD: planet.base.shipyardLevel,
            ANTIMATTER_FACTORY: planet.base.antimatterFactoryLevel,
            STORAGE: planet.base.storageLevel,
          };
      const resources = live
        ? { ...live.resources }
        : {
            ore: planet.base.ore,
            polymers: planet.base.polymers,
            plasma: planet.base.plasma,
            antimatter: planet.base.antimatter,
          };
      const fleet = live ? { ...live.ships } : emptyShipCounts();
      if (!live) {
        for (const ship of planet.base.ships) fleet[ship.type] = ship.count;
      }

      // Оборона входит в разведданные: без нее симулятор боя считал бы
      // по половине сил противника и обещал победу там, где ее нет.
      const defenses = live ? { ...live.defenses } : emptyDefenseCounts();
      if (!live) {
        for (const item of planet.base.defenses) defenses[item.type] = item.count;
      }

      payload = {
        owner: planet.base.commander.nickname,
        colonized: true,
        richness,
        buildings: levels,
        resources: {
          ore: Math.round(resources.ore),
          polymers: Math.round(resources.polymers),
          plasma: Math.round(resources.plasma),
          antimatter: Math.round(resources.antimatter),
        },
        fleet,
        defenses,
      };
    }

    return payload;
  }

  /* ------------------------- Сохранение и рассылка ------------------------- */

  private emitUser(commanderId: string, now = Date.now()): void {
    if (!this.io) return;
    const payload = this.getSnapshot(commanderId, now);
    if (payload) this.io.to(roomForCommander(commanderId)).emit('state:update', payload);
  }

  private async persistAndEmit(commanderId: string): Promise<void> {
    const commander = this.commanders.get(commanderId);
    if (commander) await this.persistCommander(commander);
    this.emitUser(commanderId);
  }

  /**
   * Пакетная запись всего изменившегося состояния игрока одной транзакцией.
   *
   * Флаги `dirty` (ресурсы и уровни) и `jobsDirty` (очереди, флот, оборона)
   * снимаются ДО запроса: иначе параллельное изменение состояния во время
   * записи потерялось бы. Если транзакция упала, флаги возвращаются обратно,
   * и данные уедут в БД на следующем проходе — тик при этом не падает.
   */
  private async persistCommander(commander: CommanderRuntimeState): Promise<void> {
    const operations: Array<Prisma.PrismaPromise<unknown>> = [];
    const touched: BaseRuntimeState[] = [];

    for (const base of commander.bases.values()) {
      if (!base.dirty && !base.jobsDirty) continue;
      touched.push(base);

      operations.push(
        prisma.base.update({
          where: { id: base.id },
          data: {
            ore: base.resources.ore,
            polymers: base.resources.polymers,
            plasma: base.resources.plasma,
            antimatter: base.resources.antimatter,
            oreMineLevel: base.levels.ORE_MINE,
            polymerPlantLevel: base.levels.POLYMER_PLANT,
            plasmaReactorLevel: base.levels.PLASMA_REACTOR,
            powerPlantLevel: base.levels.POWER_PLANT,
            scienceCenterLevel: base.levels.SCIENCE_CENTER,
            shipyardLevel: base.levels.SHIPYARD,
            antimatterFactoryLevel: base.levels.ANTIMATTER_FACTORY,
            storageLevel: base.levels.STORAGE,
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

    if (commander.researchDirty) {
      for (const [tech, level] of Object.entries(commander.techs) as Array<[TechnologyType, number]>) {
        operations.push(
          prisma.research.upsert({
            where: { commanderId_tech: { commanderId: commander.commanderId, tech } },
            create: { commanderId: commander.commanderId, tech, level },
            update: { level },
          }),
        );
      }
      operations.push(prisma.researchJob.deleteMany({ where: { commanderId: commander.commanderId } }));
      if (commander.research) {
        operations.push(
          prisma.researchJob.create({
            data: {
              commanderId: commander.commanderId,
              baseId: commander.research.baseId,
              tech: commander.research.tech,
              targetLevel: commander.research.targetLevel,
              startedAt: new Date(commander.research.startedAt),
              finishesAt: new Date(commander.research.finishesAt),
            },
          }),
        );
      }
    }

    if (operations.length === 0) return;

    const researchWasDirty = commander.researchDirty;
    for (const base of touched) {
      base.dirty = false;
      base.jobsDirty = false;
    }
    commander.researchDirty = false;

    try {
      await prisma.$transaction(operations);
    } catch (error) {
      console.error('[game-loop] ошибка сохранения состояния:', error);
      for (const base of touched) {
        base.dirty = true;
        base.jobsDirty = true;
      }
      commander.researchDirty = researchWasDirty;
    }
  }
}

/** Prisma требует индексируемый тип для Json-полей, обычные объекты не подходят. */
function toJson(payload: object): Prisma.InputJsonObject {
  return payload as unknown as Prisma.InputJsonObject;
}

/** Состав флота из строки БД: колонки хранят только базовые классы, остальные — ноль. */
function fleetShips(fleet: FleetRow): ShipCounts {
  const ships = emptyShipCounts();
  ships.PROBE = fleet.probes;
  ships.TRANSPORTER = fleet.transporters;
  ships.LIGHT_FIGHTER = fleet.lightFighters;
  ships.HEAVY_CRUISER = fleet.heavyCruisers;
  ships.ION_FRIGATE = fleet.ionFrigates;
  ships.RECYCLER = fleet.recyclers;
  ships.COLONY_SHIP = fleet.colonyShips;
  return ships;
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
      HEAVY_CRUISER: row.heavyCruisers,
      ION_FRIGATE: row.ionFrigates,
      RECYCLER: row.recyclers,
      COLONY_SHIP: row.colonyShips,
    },
    cargo: {
      ore: row.cargoOre,
      polymers: row.cargoPolymers,
      plasma: row.cargoPlasma,
      antimatter: row.cargoAntimatter,
    },
    pickup: { ore: row.pickupOre, polymers: row.pickupPolymers },
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

export function roomForCommander(commanderId: string): string {
  return `commander:${commanderId}`;
}

export const gameLoop = new GameLoop();
