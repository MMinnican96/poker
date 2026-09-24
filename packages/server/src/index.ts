import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertDatabaseConfigured, openDatabase } from './db/client.js';
import { createServices } from './services/index.js';
import { backfillAchievementsOnce } from './services/achievements-backfill.js';
import { LEASE_RECOVERY_MS, ServerLease } from './services/leases.js';
import { createApp, SHUTDOWN_CASHOUT_MS } from './app.js';
import { isProduction, mockAuthAllowed, resolveSecret } from './auth.js';
import { isInActivityInstance } from './discord.js';
import { guardTablesWithLease } from './rooms/lease-guard.js';

/**
 * Longest a stop may take before the process exits regardless. Railway sends
 * SIGKILL `drainingSeconds` (20, in railway.json) after SIGTERM; this stays
 * under it so the exit is ours, logged, after the cash-outs had their budget.
 */
const SHUTDOWN_HARD_MS = 18_000;

// Fails fast (before touching anything) rather than running production on a throwaway database.
assertDatabaseConfigured(process.env, isProduction());

const handle = await openDatabase();
console.log(handle.kind === 'postgres'
  ? '[server] using Postgres (DATABASE_URL)'
  : `[server] DATABASE_URL not set — using embedded PGlite (${process.env.PGLITE_DATA_DIR || 'in memory'})`);

// This process's lease: seats it opens carry it, and other processes' recovery
// leaves them alone while it keeps heartbeating (e.g. during a rolling deploy).
const lease = new ServerLease(handle.db);
await lease.register();

const services = createServices(handle.db, undefined, { leaseId: lease.id });

// Refund seats whose process is gone (stale or missing lease, or pre-lease rows)
// — at boot, and periodically for processes that die while this one runs.
async function recover(when: string) {
  const recovered = await services.bank.recoverOpenSeats();
  if (recovered.seats > 0) {
    console.warn(`[bank] ${when}: refunded ${recovered.chips} chips from ${recovered.seats} seats left open by a stopped server`);
  }
}
await recover('boot');
const recoveryTimer = setInterval(() => {
  recover('recovery').catch((err) => console.error('[bank] recovery failed', err));
}, LEASE_RECOVERY_MS);
recoveryTimer.unref();

const verify = process.env.VERIFY_ACTIVITY_INSTANCE === '1';
const app = createApp({
  services,
  jwtSecret: resolveSecret(),
  allowMockAuth: mockAuthAllowed(),
  clientDist: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist'),
  verifyInstance: verify
    ? (playerId, instanceId) => isInActivityInstance(instanceId, playerId).catch((err) => {
        console.error('[discord] instance check failed', err);
        return false;
      })
    : undefined,
});

// Losing the lease is fatal for this process's tables (see ServerLease); wired
// before the heartbeat starts so a loss is never missed.
guardTablesWithLease(lease, services.bank, app.realtime.rooms);
lease.start();

// One-time: credit past play to career challenges and feats (guarded by an
// app_meta marker; a failure is logged and retried at the next boot). After the
// heartbeat starts, so a long backfill can't let the lease go stale, and before
// listen, so no hand is recorded live on this process while it folds history.
await backfillAchievementsOnce(handle.db);

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
app.http.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}${mockAuthAllowed() ? ' (mock sign-in enabled)' : ''}`);
});

/** Wait for `work` at most `ms`; true if it finished in time. Errors are logged, not thrown. */
async function within(work: Promise<unknown>, ms: number, label: string): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const done = await Promise.race([
    work.then(() => true, (err) => {
      console.error(`[server] ${label} failed`, err);
      return true;
    }),
    new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(false), Math.max(0, ms)); }),
  ]);
  clearTimeout(timer);
  if (!done) console.error(`[server] ${label} did not finish in time`);
  return done;
}

let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} — shutting down`);
  const started = Date.now();
  // Whatever hangs (a stuck query, a socket that won't close), the process exits
  // before the platform's SIGKILL.
  const hardExit = setTimeout(() => {
    console.error(`[server] shutdown took over ${SHUTDOWN_HARD_MS / 1000}s — exiting now; recovery will refund any open seats`);
    process.exit(1);
  }, SHUTDOWN_HARD_MS);
  const left = () => SHUTDOWN_HARD_MS - (Date.now() - started) - 250;
  clearInterval(recoveryTimer);
  // Cash everyone out (voiding hands in progress) while sockets can still be
  // told. New tables, seats and top-ups are refused from here on.
  const cashedOut = await within(app.realtime.rooms.shutdown(), SHUTDOWN_CASHOUT_MS, 'cashing out tables');
  if (!cashedOut) console.error('[server] recovery will refund the tables that did not cash out');
  // Dropping the lease makes any seat still open recoverable by the next process at once.
  await within(lease.release(), Math.min(3_000, left()), 'releasing the lease');
  // Tables are already closed; this only closes sockets and the HTTP server.
  await within(app.close({ cashoutTimeoutMs: 0 }), Math.min(3_000, left()), 'closing sockets');
  await within(handle.close(), Math.min(3_000, left()), 'closing the database');
  clearTimeout(hardExit);
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
