import './env.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@poker/shared';
import { authRouter } from './routes/auth.js';
import { registerSocketHandlers, noopStatsService, type ChipService, type StatsService } from './rooms/index.js';
import { InMemoryChipService } from './rooms/in-memory-chips.js';
import { adjustChips } from './db/index.js';
import { dbStatsService, dbStatsRepository, noopStatsRepository } from './db/stats.js';
import { createStatsRouter } from './routes/stats.js';

const app = express();
const httpServer = createServer(app);

const allowedOrigins = [
  /\.discordsays\.com$/,
  /localhost/,
  /\.trycloudflare\.com$/,
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    const allowed = allowedOrigins.some(pattern =>
      typeof pattern === 'string' ? pattern === origin : pattern.test(origin)
    );
    callback(null, allowed);
  },
  credentials: true,
}));

app.use(express.json());

app.get('/api/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.use('/api/auth', authRouter);

export const io = new Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>(httpServer, {
  cors: {
    origin: allowedOrigins,
    credentials: true,
  },
});

// With a database configured, chips + stats persist; without one (dev/mock mode)
// chips use an authoritative in-memory ledger and stats are a no-op, so the
// server can boot without Postgres.
const hasDb = !!process.env.DATABASE_URL;
const chips: ChipService = hasDb ? { adjust: adjustChips } : new InMemoryChipService();
const stats: StatsService = hasDb ? dbStatsService : noopStatsService;
if (!hasDb) {
  console.warn('[server] DATABASE_URL not set — running without persistence (dev/mock mode).');
}
registerSocketHandlers(io, { chips, stats });
app.use('/api/stats', createStatsRouter(hasDb ? dbStatsRepository : noopStatsRepository));

// Serve the built client for a single-origin deploy (e.g. Railway behind the
// Discord proxy). Compiled to packages/server/dist, so the client build sits at
// ../../client/dist. In local dev Vite serves the client, so the build won't
// exist here and this stays inert.
const clientDist = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'client',
  'dist',
);
if (fs.existsSync(clientDist)) {
  app.use(express.static(clientDist));
  // SPA fallback: hand any non-API, non-socket route to the client's index.html.
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    res.sendFile(path.join(clientDist, 'index.html'));
  });
  console.log(`[server] serving client from ${clientDist}`);
}

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
