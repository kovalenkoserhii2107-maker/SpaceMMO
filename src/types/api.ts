/**
 * Типы ответов REST API. Роуты аннотируются `Response<...>`,
 * поэтому расхождение между сервером и клиентом ловится компилятором,
 * а не в рантайме.
 */
import type { FlightPlan } from '../game/fleets.js';
import type { MarketView } from '../services/marketService.js';
import type { DiplomacyView } from '../services/warService.js';
import type { StateUpdatePayload, SystemMap } from './socket.js';

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

export interface LoginResponse {
  token: string;
  user: { id: string; username: string };
}

/** Полное состояние игрока: то же, что уходит по WebSocket, плюс сам игрок. */
export type StateResponse = StateUpdatePayload & {
  user: { id: string; username: string | undefined };
};

export type MapResponse = SystemMap;
export type FlightPreviewResponse = FlightPlan;
export type MarketResponse = MarketView;
export type DiplomacyResponse = DiplomacyView;
