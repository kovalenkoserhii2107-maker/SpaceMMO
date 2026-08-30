/**
 * Типы ответов REST API. Роуты аннотируются `Response<...>`,
 * поэтому расхождение между сервером и клиентом ловится компилятором,
 * а не в рантайме.
 */
import type { FlightPlan } from '../game/fleets.js';
import type { EspionageTarget } from '../services/mapService.js';
import type { FleetTemplateView } from '../services/fleetTemplateService.js';
import type { SimulationResult } from '../services/simulationService.js';
import type { MailboxView } from '../services/mailService.js';
import type { CommanderProfile } from '../services/commanderService.js';
import type { MarketView } from '../services/marketService.js';
import type { DiplomacyView } from '../services/warService.js';
import type { GalaxyMap, StateUpdatePayload, SystemMap } from './socket.js';

/** Единый формат ошибки: клиент показывает `error` пользователю. */
export interface ErrorResponse {
  error: string;
}

/** Результат действия игрока: постройка, исследование, вылет, сделка. */
export type ActionResponse =
  | { ok: true; message: string }
  | { ok: false; error: string };

export interface HealthResponse {
  ok: true;
  serverTime: number;
}

export interface AccountView {
  id: string;
  email: string;
}

/** Ответ на регистрацию, вход и смену пароля. */
export interface AuthResponse {
  token: string;
  user: AccountView;
  commander: CommanderProfile | null;
  /** Есть ли у аккаунта командир — клиент решает, куда вести игрока. */
  hasCommander?: boolean;
}

/** Текущая сессия: аккаунт, командир и доступные аватары. */
export interface SessionResponse {
  user: AccountView;
  commander: CommanderProfile | null;
  avatars: Array<{ id: string; label: string; glyph: string }>;
}

/** Полное состояние игрока: то же, что уходит по WebSocket, плюс сам игрок. */
export type StateResponse = StateUpdatePayload & {
  commander: { id: string; nickname: string };
};

export type MapResponse = SystemMap;
export type GalaxyResponse = GalaxyMap;
export type FlightPreviewResponse = FlightPlan;
export type MarketResponse = MarketView;
export type DiplomacyResponse = DiplomacyView;

/** Инструменты командира: симулятор, шаблоны флотов и разведданные. */
export type SimulationResponse = SimulationResult;

export interface FleetTemplatesResponse {
  templates: FleetTemplateView[];
}

export interface EspionageResponse {
  targets: EspionageTarget[];
}

/** Почтовый ящик командира. */
export type MailboxResponse = MailboxView;
