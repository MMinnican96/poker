import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/client.js';
import { createServices } from './services/index.js';
import { LEASE_RECOVERY_MS, ServerLease } from './services/leases.js';
import { createApp } from './app.js';
import { mockAuthAllowed, resolveSecret } from './auth.js';
import { isInActivityInstance } from './discord.js';

const handle = await openDatabase();
console.log(handle.kind === 'postgres'
  ? '[server] using Postgres (DATABASE_URL)'
  : `[server] DATABASE_URL not set — using embedded PGlite (${process.env.PGLITE_DATA_DIR ?? 'in memory'})`);

// This process's lease: seats it opens carry it, and other processes' recovery
// leaves them alone while it keeps heartbeating (e.g. during a rolling deploy).
const lease = new ServerLease(handle.db);
await lease.register();
lease.start();

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

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3001;
app.http.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}${mockAuthAllowed() ? ' (mock sign-in enabled)' : ''}`);
});

/** Longest we wait for tables to cash out before exiting anyway. */
const SHUTDOWN_CASHOUT_MS = 15_000;
let shuttingDown = false;

async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[server] ${signal} — shutting down`);
  clearInterval(recoveryTimer);
  try {
    // Cash everyone out (voiding hands in progress) while sockets can still be told.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = await Promise.race([
      app.realtime.rooms.shutdown().then(() => false),
      new Promise<boolean>((resolve) => { timer = setTimeout(() => resolve(true), SHUTDOWN_CASHOUT_MS); }),
    ]);
    clearTimeout(timer);
    if (timedOut) console.error('[server] tables did not finish cashing out in time; recovery will refund them');
  } catch (err) {
    console.error('[server] closing tables failed', err);
  }
  // Dropping the lease makes any seat still open recoverable by the next process at once.
  await lease.release().catch((err) => console.error('[lease] release failed', err));
  await app.close();
  await handle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
