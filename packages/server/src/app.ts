import express, { type NextFunction, type Request, type Response } from 'express';
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

/** Default longest `close()` waits for tables to cash out before closing anyway. */
export const SHUTDOWN_CASHOUT_MS = 15_000;

export interface App {
  http: HttpServer;
  io: Io;
  auth: Auth;
  realtime: Realtime;
  /**
   * Graceful stop: close every table (cashing everyone out while their sockets
   * can still be told), then close sockets and the HTTP server. Waits at most
   * `cashoutTimeoutMs` for the cash-outs; anything unfinished is refunded by
   * boot recovery. Safe to call more than once.
   */
  close(opts?: { cashoutTimeoutMs?: number }): Promise<void>;
}

/**
 * Malformed or oversized JSON bodies get a JSON error. Without this they fall
 * through to Express's default HTML page, which includes a stack trace unless
 * NODE_ENV is 'production' (not guaranteed on Railway).
 */
function bodyErrors(err: unknown, _req: Request, res: Response, next: NextFunction): void {
  const status = (err as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && status >= 400 && status < 500) {
    res.status(status).json({ error: status === 413 ? 'Request too large.' : 'Malformed request body.' });
    return;
  }
  next(err);
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
  app.use(bodyErrors);

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
    // A missing build asset is a 404, never the app shell: a client still running
    // an older build then fails its chunk import cleanly (and can offer a reload)
    // instead of trying to run index.html as JavaScript.
    app.use('/assets', (_req, res) => {
      res.status(404).type('text/plain').send('Not found');
    });
    // SPA fallback for anything that isn't the API or Socket.io.
    app.get(/^(?!\/api|\/socket\.io).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
    console.log(`[server] serving client from ${dist}`);
  }

  return {
    http,
    io,
    auth,
    realtime,
    async close({ cashoutTimeoutMs = SHUTDOWN_CASHOUT_MS } = {}) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timedOut = await Promise.race([
        realtime.rooms.shutdown().then(() => false, (err) => {
          console.error('[server] closing tables failed', err);
          return false;
        }),
        new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), cashoutTimeoutMs); }),
      ]);
      clearTimeout(timer);
      if (timedOut) console.error('[server] tables did not finish cashing out in time; recovery will refund them');
      realtime.dispose();
      await io.close();
      if (http.listening) await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}
