import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response } from 'express';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { disconnectPrisma, prisma } from './db/prisma.js';
import { gameLoop, roomForCommander } from './game/gameLoop.js';
import { botDirector } from './game/bot/director.js';
import { authRouter } from './routes/auth.js';
import { gameRouter } from './routes/game.js';
import { marketRouter } from './routes/market.js';
import { warRouter } from './routes/war.js';
import { syndicateRouter } from './routes/syndicate.js';
import { commanderRouter } from './routes/commander.js';
import { mailRouter } from './routes/mail.js';
import { adminRouter } from './routes/admin.js';
import { verifyToken } from './services/authService.js';
import { ensureAchievements } from './services/achievementService.js';
import { settleSyndicateBuilds } from './services/syndicateService.js';
import { runReserve } from './services/reserveService.js';
import { warnIfInsecureSecret } from './config/auth.js';
import type { HealthResponse, LivenessResponse } from './types/api.js';
import { healthStatus, startTickWatchdog } from './services/healthService.js';
import type {
  ClientToServerEvents,
  InterServerEvents,
  ServerToClientEvents,
  SocketData,
} from './types/socket.js';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const app = express();
app.use(express.json());
app.use(express.static(path.join(rootDir, 'public')));

/*
 * Две проверки, и у них разные читатели.
 *
 * `/api/health` — честное состояние: база и тик. Отвечает 503, если что-то
 * лежит, и годится для внешнего мониторинга, который должен будить человека.
 *
 * `/api/health/live` — для проверки Fly. Она решает, слать ли на машину
 * запросы, а машина у нас одна: снять ее с маршрута из-за секундного
 * обрыва базы значило бы заменить игроку понятное сообщение об ошибке
 * страницей прокси и заодно оборвать загрузку клиента. Поэтому здесь
 * только «процесс отвечает»; зависший тик лечит сторож в самом процессе.
 */
app.get('/api/health', async (_req, res: Response<HealthResponse>) => {
  const status = await healthStatus();
  res.status(status.ok ? 200 : 503).json(status);
});
app.get('/api/health/live', (_req, res: Response<LivenessResponse>) => {
  res.json({ ok: true, serverTime: Date.now(), tickAgeMs: gameLoop.tickAgeMs() });
});
app.use('/api/auth', authRouter);
app.use('/api/market', marketRouter);
app.use('/api/war', warRouter);
app.use('/api/syndicates', syndicateRouter);
app.use('/api/commander', commanderRouter);
app.use('/api/mail', mailRouter);
app.use('/api/admin', adminRouter);
app.use('/api', gameRouter);

const httpServer = createServer(app);

/*
 * Сжатие кадров сокета включено: снимок состояния весит около 34 КБ и уходит
 * каждому игроку раз в секунду — это сто с лишним мегабайт в час на телефоне.
 * Сжатый он втрое-впятеро меньше, а статику и так сжимает прокси Fly, но кадры
 * сокета он не трогает. Мелкие события сжимать незачем — отсюда порог.
 */
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  { cors: { origin: true }, perMessageDeflate: { threshold: 1024 } },
);

/**
 * Авторизация сокета тем же JWT, что и REST.
 * Игрок без командира до игрового канала не допускается: сокет отдает
 * состояние игры, а его у такого аккаунта еще нет.
 */
io.use(async (socket, next) => {
  const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const payload = typeof token === 'string' ? verifyToken(token) : null;
  if (!payload) {
    next(new Error('unauthorized'));
    return;
  }

  const user = await prisma.user.findUnique({
    where: { id: payload.sub },
    include: { commander: { select: { id: true, nickname: true } } },
  });
  if (!user?.commander) {
    next(new Error('commander required'));
    return;
  }
  // Блокировка закрывает и игровой канал: иначе заблокированный аккаунт
  // продолжал бы получать состояние мира, пока живет выданный токен.
  if (user.blockedAt) {
    next(new Error('blocked'));
    return;
  }

  socket.data.commanderId = user.commander.id;
  socket.data.nickname = user.commander.nickname;
  next();
});

io.on('connection', (socket) => {
  const { commanderId, nickname } = socket.data;
  void socket.join(roomForCommander(commanderId));

  /*
   * Счетчик непрочитанного — сразу при подключении, а не только при доставке.
   *
   * Письма приходят и офлайн-игрокам, а событие о них уходит в комнату,
   * которой в тот момент никого нет. На телефоне сокет рвется постоянно —
   * приложение ушло в фон, сеть моргнула, — и вернувшийся игрок узнавал
   * о письмах только полной перезагрузкой или заходом в почту.
   */
  gameLoop.pushUnread(commanderId);

  void gameLoop.attachCommander(commanderId).then(() => {
    socket.emit('session:ready', { commanderId, nickname });
    sendState();
  });

  socket.on('state:request', sendState);

  function sendState(): void {
    const payload = gameLoop.getSnapshot(commanderId);
    if (payload) socket.emit('state:update', payload);
  }

  socket.on('disconnect', () => {
    void gameLoop.detachCommander(commanderId);
  });
});

httpServer.listen(env.port, () => {
  console.log(`[server] http://localhost:${env.port} (${env.nodeEnv})`);
  warnIfInsecureSecret();
  // Каталог достижений синхронизируется с кодом при каждом старте.
  void ensureAchievements().catch((error: unknown) =>
    console.error('[achievements] не удалось синхронизировать каталог:', error),
  );
  gameLoop.start(io);
  startTickWatchdog();
  /*
   * Стройки в Коше закрываются по сроку и без открытого Коша: уровень модуля
   * решает предел состава, защиту казны и пропуск Брамы. Таймер живет здесь,
   * а не в игровом цикле: сервис синдиката сам импортирует цикл, и обратный
   * импорт замкнул бы модули в кольцо.
   */
  setInterval(() => {
    settleSyndicateBuilds().catch((error: unknown) => console.error('[syndicate] стройки в Коше', error));
  }, 30_000);
  // Резерв хаба держит коридор цен: раз в минуту переставляет свои заявки.
  void runReserve();
  setInterval(() => void runReserve(), 60_000);
  // Планировщик ботов идет следом за тиком: он ходит его же методами,
  // и без запущенного тика ему не с чем работать.
  botDirector.start();
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] получен ${signal}, останавливаюсь...`);
  botDirector.stop();
  await gameLoop.stop();
  io.close();
  httpServer.close();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
