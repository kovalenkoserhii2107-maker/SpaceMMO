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
import type { AdminDashboard, CommanderDetail, CommanderSummary } from '../services/adminService.js';
import type { BotView } from '../services/botService.js';
import type { LeaderboardView } from '../services/scoreService.js';
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
  /** Права доступа: по ним клиент решает, показывать ли пульт гейм-мастера. */
  role?: string;
}

/** Ответ на регистрацию, вход и смену пароля. */
export interface AuthResponse {
  token: string;
  user: AccountView;
  commander: CommanderProfile | null;
  /** Есть ли у аккаунта командир — клиент решает, куда вести игрока. */
  hasCommander?: boolean;
}

/**
 * Публичные настройки входа: что клиенту нужно знать до авторизации.
 * Client ID Google не секрет — он по устройству протокола уезжает в браузер
 * и виден в каждом запросе к Google; секретом был бы client_secret, но
 * для проверки id_token он не нужен и на сервере его нет.
 */
export interface AuthConfigResponse {
  googleClientId: string | null;
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

/** Опознание планеты по координатам: то же, что видно на карте системы. */
export interface PlanetLookupResponse {
  planetId: string;
  planetName: string;
  systemId: string;
  systemName: string;
  position: number;
  galaxyX: number;
  galaxyY: number;
  owner: string | null;
  isOwn: boolean;
}
export type GalaxyResponse = GalaxyMap;
/**
 * Расчет маршрута плюс предупреждение о последствиях вылета.
 *
 * Предупреждение считает сервер: только он знает, идет ли война и состоит ли
 * цель в синдикате. Клиент этих данных не имеет и не должен — иначе пришлось
 * бы отдавать ему дипломатию всей галактики ради одной строки текста.
 */
export type FlightPreviewResponse = FlightPlan & {
  warning?: string | null;
};
export type MarketResponse = MarketView;
export type DiplomacyResponse = DiplomacyView;
export type LeaderboardResponse = LeaderboardView;

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

/** Пульт гейм-мастера. */
export interface AdminListResponse {
  commanders: CommanderSummary[];
}

export type AdminDetailResponse = CommanderDetail;

export type AdminDashboardResponse = AdminDashboard;

/** Список ботов и каталог характеров для формы создания. */
export interface AdminBotsResponse {
  bots: BotView[];
  characters: Array<{ id: string; label: string; description: string }>;
}

/** Код смены пароля, выданный пультом: админ передает его игроку сам. */
export interface AdminResetResponse {
  ok: true;
  message: string;
  token: string;
  expiresAt: number;
}
