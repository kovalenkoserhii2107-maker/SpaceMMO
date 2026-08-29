import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type Response } from 'express';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { gameLoop, roomForCommander } from './game/gameLoop.js';
import { authRouter } from './routes/auth.js';
import { gameRouter } from './routes/game.js';
import { marketRouter } from './routes/market.js';
import { warRouter } from './routes/war.js';
import { verifyToken } from './services/authService.js';
import { prisma } from './db/prisma.js';
import { ensureAchievements } from './services/achievementService.js';
import { warnIfInsecureSecret } from './config/auth.js';
import type { HealthResponse } from './types/api.js';
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

app.get('/api/health', (_req, res: Response<HealthResponse>) => {
  res.json({ ok: true, serverTime: Date.now() });
});
app.use('/api/auth', authRouter);
app.use('/api/market', marketRouter);
app.use('/api/war', warRouter);
app.use('/api', gameRouter);

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  { cors: { origin: true } },
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

  socket.data.commanderId = user.commander.id;
  socket.data.nickname = user.commander.nickname;
  next();
});

io.on('connection', (socket) => {
  const { commanderId, nickname } = socket.data;
  void socket.join(roomForCommander(commanderId));

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
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[server] получен ${signal}, останавливаюсь...`);
  await gameLoop.stop();
  io.close();
  httpServer.close();
  await disconnectPrisma();
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
