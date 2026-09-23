import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import path from 'node:path';
import { createServer, type Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type { Services } from './services/index.js';
import { createAuth, type Auth } from './auth.js';
import { createApi } from './http/api.js';
import { attachRealtime, type Io, type Realtime, type RealtimeOptions } from './socket/realtime.js';

export interface AppOptions {
  services: Services;
  jwtSecret: string;
  allowMockAuth?: boolean;
  /** Built client to serve (single-origin deploys). */
  clientDist?: string;
  timing?: RealtimeOptions['timing'];
  random?: RealtimeOptions['random'];
  clock?: RealtimeOptions['clock'];
  verifyInstance?: RealtimeOptions['verifyInstance'];
}

export interface App {
  http: HttpServer;
  io: Io;
  auth: Auth;
  realtime: Realtime;
  close(): Promise<void>;
}

const ALLOWED_ORIGINS = [/\.discordsays\.com$/, /^https?:\/\/localhost(:\d+)?$/, /\.trycloudflare\.com$/];

/** Build the HTTP + Socket.io server around a set of services (no listening). */
export function createApp(opts: AppOptions): App {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.some((p) => p.test(origin))),
  }));
  app.use(express.json({ limit: '32kb' }));

  const http = createServer(app);
  const io: Io = new Server(http, { cors: { origin: ALLOWED_ORIGINS } });
  const auth = createAuth(opts.jwtSecret);
  const realtime = attachRealtime(io, {
    services: opts.services,
    auth,
    timing: opts.timing,
    random: opts.random,
    clock: opts.clock,
    verifyInstance: opts.verifyInstance,
  });

  app.use('/api', createApi({ services: opts.services, auth, realtime, allowMockAuth: opts.allowMockAuth }));

  if (opts.clientDist && fs.existsSync(opts.clientDist)) {
    const dist = opts.clientDist;
    app.use(express.static(dist, { index: false, maxAge: '1h' }));
    // SPA fallback for anything that isn't the API or Socket.io.
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    console.log(`[server] serving client from ${dist}`);
  }

  return {
    http,
    io,
    auth,
    realtime,
    async close() {
      realtime.dispose();
      await io.close();
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
