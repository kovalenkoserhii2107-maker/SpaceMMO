/**
 * Game Loop — изолированный серверный тик (1 раз в секунду).
 * Не блокирует API: состояние баз online-игроков держится в памяти,
 * запись в БД выполняется пачкой раз в PERSIST_EVERY_TICKS тиков.
 */
import type { Server } from 'socket.io';
import { prisma } from '../db/prisma.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from '../types/socket.js';
import { accrue, toSnapshot, type BaseRuntimeState } from './baseState.js';
import {
  energyOutput,
  energyUsage,
  hasEnoughResources,
  levelsAfterUpgrade,
  upgradeCost,
  type BuildingType,
} from './rules.js';

export const TICK_INTERVAL_MS = 1000;
const PERSIST_EVERY_TICKS = 10;
/** Максимальный догоняемый офлайн-период (сутки). */
const MAX_OFFLINE_SECONDS = 24 * 60 * 60;

type GameServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export type UpgradeResult =
  | { ok: true; type: BuildingType; level: number }
  | { ok: false; error: string };

class GameLoop {
  private io: GameServer | null = null;
  private timer: NodeJS.Timeout | null = null;
  private tickCount = 0;
  private persisting = false;
  /** Состояния баз online-игроков: baseId -> состояние. */
  private readonly bases = new Map<string, BaseRuntimeState>();
  /** Активные игроки: userId -> количество сокетов. */
  private readonly online = new Map<string, number>();

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
    await this.persistDirty();
    console.log('[game-loop] остановлен');
  }

  /** Регистрация подключения игрока: загружает его базы в память. */
  async attachUser(userId: string): Promise<void> {
    this.online.set(userId, (this.online.get(userId) ?? 0) + 1);
    await this.loadUserBases(userId);
  }

  /** Отключение игрока: сохраняет и выгружает базы из памяти. */
  async detachUser(userId: string): Promise<void> {
    const count = (this.online.get(userId) ?? 1) - 1;
    if (count > 0) {
      this.online.set(userId, count);
      return;
    }
    this.online.delete(userId);
    await this.persistDirty();
    for (const [baseId, state] of this.bases) {
      if (state.userId === userId) this.bases.delete(baseId);
    }
  }

  /** Загружает базы игрока из БД и догоняет добычу за офлайн-период. */
  async loadUserBases(userId: string): Promise<BaseRuntimeState[]> {
    const rows = await prisma.base.findMany({
      where: { userId },
      include: { planet: { include: { system: true } } },
      orderBy: { createdAt: 'asc' },
    });

    const now = Date.now();
    const loaded: BaseRuntimeState[] = [];

    for (const row of rows) {
      const existing = this.bases.get(row.id);
      if (existing) {
        loaded.push(existing);
        continue;
      }

      const state: BaseRuntimeState = {
        id: row.id,
        name: row.name,
        userId: row.userId,
        planetId: row.planetId,
        planetName: row.planet.name,
        planetType: row.planet.type,
        position: row.planet.position,
        size: row.planet.size,
        systemName: row.planet.system.name,
        richness: {
          metal: row.planet.metalRichness,
          crystal: row.planet.crystalRichness,
          deuterium: row.planet.deuteriumRichness,
          energy: row.planet.energyRichness,
        },
        resources: { metal: row.metal, crystal: row.crystal, deuterium: row.deuterium },
        levels: {
          METAL_MINE: row.metalMineLevel,
          CRYSTAL_MINE: row.crystalMineLevel,
          DEUTERIUM_MINE: row.deuteriumMineLevel,
          SOLAR_PLANT: row.solarPlantLevel,
        },
        lastTickAt: row.lastTickAt.getTime(),
        dirty: false,
      };

      const offlineSeconds = Math.min((now - state.lastTickAt) / 1000, MAX_OFFLINE_SECONDS);
      accrue(state, offlineSeconds);
      state.lastTickAt = now;

      this.bases.set(state.id, state);
      loaded.push(state);
    }

    return loaded;
  }

  getUserBases(userId: string): BaseRuntimeState[] {
    return [...this.bases.values()].filter((state) => state.userId === userId);
  }

  /**
   * Постройка/улучшение здания. Расчет и списание ресурсов — только здесь,
   * состояние в памяти правится синхронно, поэтому гонки с тиком нет.
   */
  async upgrade(userId: string, baseId: string, type: BuildingType): Promise<UpgradeResult> {
    let state = this.bases.get(baseId);
    if (!state) {
      await this.loadUserBases(userId);
      state = this.bases.get(baseId);
    }
    if (!state || state.userId !== userId) {
      return { ok: false, error: 'База не найдена' };
    }

    const targetLevel = state.levels[type] + 1;
    const cost = upgradeCost(type, targetLevel);

    if (!hasEnoughResources(state.resources, cost)) {
      return { ok: false, error: 'Недостаточно ресурсов' };
    }

    const nextLevels = levelsAfterUpgrade(state.levels, type);
    if (energyOutput(nextLevels, state.richness) < energyUsage(nextLevels)) {
      return { ok: false, error: 'Недостаточно энергии — постройте солнечную электростанцию' };
    }

    state.resources.metal -= cost.metal;
    state.resources.crystal -= cost.crystal;
    state.resources.deuterium -= cost.deuterium;
    state.levels = nextLevels;
    state.dirty = true;

    await this.persistBase(state);
    this.emitUser(userId);

    return { ok: true, type, level: targetLevel };
  }

  private async tick(): Promise<void> {
    const now = Date.now();

    for (const state of this.bases.values()) {
      const seconds = (now - state.lastTickAt) / 1000;
      if (seconds <= 0) continue;
      accrue(state, seconds);
      state.lastTickAt = now;
    }

    for (const userId of this.online.keys()) {
      this.emitUser(userId);
    }

    this.tickCount += 1;
    if (this.tickCount % PERSIST_EVERY_TICKS === 0) {
      await this.persistDirty();
    }
  }

  private emitUser(userId: string): void {
    if (!this.io) return;
    const bases = this.getUserBases(userId).map(toSnapshot);
    this.io.to(roomForUser(userId)).emit('state:update', { bases, serverTime: Date.now() });
  }

  private async persistBase(state: BaseRuntimeState): Promise<void> {
    state.dirty = false;
    await prisma.base.update({
      where: { id: state.id },
      data: this.baseUpdateData(state),
    });
  }

  /** Пакетная запись измененных баз. Ошибки не роняют тик. */
  private async persistDirty(): Promise<void> {
    if (this.persisting) return;
    const dirty = [...this.bases.values()].filter((state) => state.dirty);
    if (dirty.length === 0) return;

    this.persisting = true;
    try {
      for (const state of dirty) state.dirty = false;
      await prisma.$transaction(
        dirty.map((state) =>
          prisma.base.update({ where: { id: state.id }, data: this.baseUpdateData(state) }),
        ),
      );
    } catch (error) {
      console.error('[game-loop] ошибка сохранения баз:', error);
      for (const state of dirty) state.dirty = true;
    } finally {
      this.persisting = false;
    }
  }

  private baseUpdateData(state: BaseRuntimeState) {
    return {
      metal: state.resources.metal,
      crystal: state.resources.crystal,
      deuterium: state.resources.deuterium,
      metalMineLevel: state.levels.METAL_MINE,
      crystalMineLevel: state.levels.CRYSTAL_MINE,
      deuteriumMineLevel: state.levels.DEUTERIUM_MINE,
      solarPlantLevel: state.levels.SOLAR_PLANT,
      lastTickAt: new Date(state.lastTickAt),
    };
  }
}

export function roomForUser(userId: string): string {
  return `user:${userId}`;
}

export const gameLoop = new GameLoop();
