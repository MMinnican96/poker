import '../env.js';
import { openDatabase } from './client.js';

// `npm run db:migrate` — apply migrations to DATABASE_URL (or PGLITE_DATA_DIR).
// The server also does this at boot; this is for running it by hand.
if (!process.env.DATABASE_URL && !process.env.PGLITE_DATA_DIR) {
  console.error('[db] set DATABASE_URL (or PGLITE_DATA_DIR) — without one there is nothing to migrate');
  process.exit(1);
}
const handle = await openDatabase();
console.log(`[db] migrations applied (${handle.kind})`);
await handle.close();
