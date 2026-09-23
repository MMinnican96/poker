import '../env.js';
import { openDatabase } from './client.js';

// `npm run db:migrate` — apply migrations to DATABASE_URL. The server also does
// this at boot; this is for running it by hand.
const handle = await openDatabase();
console.log(`[db] migrations applied (${handle.kind})`);
await handle.close();
