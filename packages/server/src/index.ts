import './env.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from './db/client.js';
import { createServices } from './services/index.js';
import { createApp } from './app.js';
import { mockAuthAllowed, resolveSecret } from './auth.js';
import { isInActivityInstance } from './discord.js';

const handle = await openDatabase();
console.log(handle.kind === 'postgres'
  ? '[server] using Postgres (DATABASE_URL)'
  : `[server] DATABASE_URL not set — using embedded PGlite (${process.env.PGLITE_DATA_DIR ?? 'in memory'})`);

const services = createServices(handle.db);

// No table is live yet, so any seat still open belongs to a process that died:
// give those chips back before anyone can play.
const recovered = await services.bank.recoverOpenSeats();
if (recovered.seats > 0) {
  console.warn(`[bank] refunded ${recovered.chips} chips from ${recovered.seats} seats left open by a previous run`);
}

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

async function shutdown(signal: string) {
  console.log(`[server] ${signal} — shutting down`);
  await app.close();
  await handle.close();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));
