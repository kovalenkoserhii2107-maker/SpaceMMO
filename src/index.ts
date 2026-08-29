import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { Server } from 'socket.io';
import { env } from './config/env.js';
import { disconnectPrisma } from './db/prisma.js';
import { gameLoop, roomForUser } from './game/gameLoop.js';
import { authRouter } from './routes/auth.js';
import { gameRouter } from './routes/game.js';
import { findUserByToken } from './services/userService.js';
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

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, serverTime: Date.now() });
});
app.use('/api/auth', authRouter);
app.use('/api', gameRouter);

const httpServer = createServer(app);

const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  { cors: { origin: true } },
);

/** Авторизация сокета тем же opaque-токеном, что и REST. */
io.use(async (socket, next) => {
  const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
  const user = typeof token === 'string' ? await findUserByToken(token) : null;
  if (!user) {
    next(new Error('unauthorized'));
    return;
  }
  socket.data.userId = user.id;
  socket.data.username = user.username;
  next();
});

io.on('connection', (socket) => {
  const { userId, username } = socket.data;
  void socket.join(roomForUser(userId));

  void gameLoop.attachUser(userId).then(() => {
    socket.emit('session:ready', { userId, username });
    sendState();
  });

  socket.on('state:request', sendState);

  function sendState(): void {
    const payload = gameLoop.getSnapshot(userId);
    if (payload) socket.emit('state:update', payload);
  }

  socket.on('disconnect', () => {
    void gameLoop.detachUser(userId);
  });
});

httpServer.listen(env.port, () => {
  console.log(`[server] http://localhost:${env.port} (${env.nodeEnv})`);
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
