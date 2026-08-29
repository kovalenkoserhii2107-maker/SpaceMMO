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
  researchSnapshot,
  toSnapshot,
  type BaseRuntimeState,
  type ShipJobState,
  type UserRuntimeState,
} from './baseState.js';
import {
  buildSeconds,
  emptyLevels,
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
  type ShipType,
} from './ships.js';

export const TICK_INTERVAL_MS = 1000;
const PERSIST_EVERY_TICKS = 10;
/** Максимальный догоняемый офлайн-период (сутки). */
const MAX_OFFLINE_SECONDS = 24 * 60 * 60;
/** Предохранитель от бесконечного цикла при разборе очереди верфи. */
const MAX_QUEUE_STEPS = 10_000;
/** Через сколько простоя выгружать из памяти игрока без активных сокетов. */
const IDLE_EVICT_MS = 60_000;

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
        bases: {
          orderBy: { createdAt: 'asc' },
          include: {
            planet: { include: { system: true } },
            buildJob: true,
            shipJobs: { orderBy: { createdAt: 'asc' } },
            ships: true,
          },
        },
      },
    });
    if (!row) return null;

    const now = Date.now();
    const user: UserRuntimeState = {
      userId: row.id,
      lastAccessAt: now,
      techs: emptyTechLevels(),
      research: null,
      researchDirty: false,
      bases: new Map(),
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

      const levels = emptyLevels();
      levels.METAL_MINE = base.metalMineLevel;
      levels.CRYSTAL_MINE = base.crystalMineLevel;
      levels.DEUTERIUM_MINE = base.deuteriumMineLevel;
      levels.SOLAR_PLANT = base.solarPlantLevel;
      levels.RESEARCH_LAB = base.researchLabLevel;
      levels.SHIPYARD = base.shipyardLevel;

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
        richness: {
          metal: base.planet.metalRichness,
          crystal: base.planet.crystalRichness,
          deuterium: base.planet.deuteriumRichness,
          energy: base.planet.energyRichness,
        },
        resources: {
          metal: safeAmount(base.metal),
          crystal: safeAmount(base.crystal),
          deuterium: safeAmount(base.deuterium),
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
    const seconds = buildSeconds(type, targetLevel);
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
    const seconds = researchSeconds(tech, targetLevel, base.levels.RESEARCH_LAB, user.techs);
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
    const unitSeconds = shipUnitSeconds(type, base.levels.SHIPYARD);
    subtractResources(base.resources, cost);
    base.shipJobs.push({
      id: randomUUID(),
      type,
      quantity,
      remaining: quantity,
      unitSeconds,
      nextUnitAt: this.queueEndsAt(base, now) + unitSeconds * 1000,
      createdAt: now,
    });
    base.dirty = true;
    base.jobsDirty = true;

    await this.persistAndEmit(userId);
    return { ok: true, message: `Заказ принят: ${quantity} шт., по ${unitSeconds} с за корабль` };
  }

  /** Момент, когда верфь освободится от уже стоящих в очереди заказов. */
  private queueEndsAt(base: BaseRuntimeState, now: number): number {
    const head = base.shipJobs[0];
    if (!head) return now;

    let end = Math.max(head.nextUnitAt, now) + (head.remaining - 1) * head.unitSeconds * 1000;
    for (const job of base.shipJobs.slice(1)) {
      end += job.remaining * job.unitSeconds * 1000;
    }
    return end;
  }

  private async resolveBase(userId: string, baseId: string): Promise<BaseRuntimeState | null> {
    const user = await this.getUser(userId);
    return user?.bases.get(baseId) ?? null;
  }

  /* ------------------------- Тик и таймеры ------------------------- */

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
   * Начисляет ресурсы и закрывает завершенные таймеры.
   * Период разбивается на отрезки по моментам завершения стройки и исследования,
   * поэтому добыча за офлайн считается с учетом уровней, действовавших в каждый момент.
   * Возвращает true, если что-то завершилось и это нужно сохранить.
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
      if (this.settleShipJobs(base, now)) structural = true;
    }

    return structural;
  }

  private accrueTo(base: BaseRuntimeState, user: UserRuntimeState, time: number): void {
    const seconds = (time - base.lastTickAt) / 1000;
    if (seconds <= 0) return;
    accrue(base, user.techs, seconds);
    base.lastTickAt = time;
  }

  /** Выпускает корабли, у которых наступило время выхода. */
  private settleShipJobs(base: BaseRuntimeState, now: number): boolean {
    let changed = false;
    let steps = 0;

    while (base.shipJobs.length > 0 && steps < MAX_QUEUE_STEPS) {
      steps += 1;
      const job = base.shipJobs[0];
      if (!job || job.nextUnitAt > now) break;

      base.ships[job.type] += 1;
      job.remaining -= 1;
      changed = true;

      if (job.remaining <= 0) {
        const finishedAt = job.nextUnitAt;
        base.shipJobs.shift();
        const next = base.shipJobs[0];
        if (next) next.nextUnitAt = finishedAt + next.unitSeconds * 1000;
      } else {
        job.nextUnitAt += job.unitSeconds * 1000;
      }
    }

    if (changed) base.jobsDirty = true;
    return changed;
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

  /** Пакетная запись изменений игрока. Ошибка не роняет тик — флаги возвращаются. */
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
            metalMineLevel: base.levels.METAL_MINE,
            crystalMineLevel: base.levels.CRYSTAL_MINE,
            deuteriumMineLevel: base.levels.DEUTERIUM_MINE,
            solarPlantLevel: base.levels.SOLAR_PLANT,
            researchLabLevel: base.levels.RESEARCH_LAB,
            shipyardLevel: base.levels.SHIPYARD,
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

/** Защита от испорченных значений в БД: нечисловой остаток считаем нулевым. */
function safeAmount(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

export function roomForUser(userId: string): string {
  return `user:${userId}`;
}

export const gameLoop = new GameLoop();
