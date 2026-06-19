import { config } from 'dotenv';
import path from 'node:path';

/**
 * Load environment variables from the **repo-root `.env`** (single source of
 * truth). All npm workspace scripts (`dev`, `db:push`, `start`) run with the
 * package directory as cwd, so the root file is two levels up. As a fallback we
 * also load `<cwd>/.env`, which covers both a local package `.env` and the case
 * where the process is launched from the repo root. `dotenv` does not override
 * already-set variables, so the first match wins.
 */
config({ path: path.resolve(process.cwd(), '../../.env') });
config();
