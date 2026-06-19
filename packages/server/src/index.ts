import './env.js';
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import type {
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from '@poker/shared';
import { authRouter } from './routes/auth.js';
import { registerSocketHandlers, noopChipService, type ChipService } from './rooms/index.js';
import { adjustChips } from './db/index.js';

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

// With a database configured, chips persist; without one the server runs in
// dev/mock mode using an in-memory (no-op) ledger so it can boot without Postgres.
const hasDb = !!process.env.DATABASE_URL;
const chips: ChipService = hasDb ? { adjust: adjustChips } : noopChipService;
if (!hasDb) {
  console.warn('[server] DATABASE_URL not set — running without persistence (dev/mock mode).');
}
registerSocketHandlers(io, { chips });

const PORT = process.env.PORT ? parseInt(process.env.PORT) : 3001;
httpServer.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
});
