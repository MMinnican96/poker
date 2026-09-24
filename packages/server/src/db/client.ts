import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import { migrate as migratePg } from 'drizzle-orm/node-postgres/migrator';
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { ExtractTablesWithRelations } from 'drizzle-orm';
import * as schema from './schema.js';

export type Schema = typeof schema;

/** Common supertype of the node-postgres and PGlite Drizzle databases. */
export type Db = PgDatabase<PgQueryResultHKT, Schema, ExtractTablesWithRelations<Schema>>;
/** A transaction handle (same query API as `Db`). */
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];
export type DbOrTx = Db | Tx;

export interface DbHandle {
  db: Db;
  kind: 'postgres' | 'pglite';
  close(): Promise<void>;
}

const MIGRATIONS = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

/** Longest a new connection may take to open before the query using it fails. */
export const DB_CONNECT_TIMEOUT_MS = 10_000;
/**
 * Longest any one statement may run. Postgres cancels it server-side
 * (`statement_timeout`) and the client gives up shortly after (`query_timeout`),
 * so a hung query can't hold a table's serial queue forever. Migrations run
 * with the same limit, which comfortably covers this schema's.
 */
export const DB_STATEMENT_TIMEOUT_MS = 10_000;

/** Pool settings for a server process (exported for tests). */
export function poolConfig(url: string): pg.PoolConfig {
  return {
    connectionString: url,
    connectionTimeoutMillis: DB_CONNECT_TIMEOUT_MS,
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
    // A little longer than the server-side limit, so Postgres normally cancels first.
    query_timeout: DB_STATEMENT_TIMEOUT_MS + 2_000,
    // Transactions left open by a crashed request would otherwise hold row locks.
    idle_in_transaction_session_timeout: DB_STATEMENT_TIMEOUT_MS * 3,
  };
}

/**
 * An idle pooled client can error at any time (the server restarted, the
 * network dropped). Without a listener the Pool re-emits it as an unhandled
 * 'error' event, which crashes the process; the pool already discards the
 * broken client, so logging is all that's needed.
 */
export function watchPool(pool: pg.Pool, log: (message: string, err: unknown) => void = (m, e) => console.error(m, e)): void {
  pool.on('error', (err) => log('[db] idle client error', err));
}

/**
 * Connect to Postgres when `DATABASE_URL` is set; otherwise start an embedded
 * PGlite database (in memory, or on disk at `PGLITE_DATA_DIR`). Either way the
 * migrations in `drizzle/` are applied first, so a deploy upgrades its own
 * database. Both expose the same Drizzle API, so every service has a single
 * implementation.
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string } = {}): Promise<DbHandle> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool(poolConfig(url));
    watchPool(pool);
    const db = drizzlePg(pool, { schema });
    await migratePg(db, { migrationsFolder: MIGRATIONS });
    return { db: db as unknown as Db, kind: 'postgres', close: () => pool.end() };
  }
  return openPglite(opts.pgliteDir ?? process.env.PGLITE_DATA_DIR);
}

/**
 * A production server must never quietly fall back to a throwaway in-memory
 * database: every bankroll would vanish on the next restart. Throws unless
 * `DATABASE_URL` is set (or `PGLITE_DATA_DIR` explicitly asks for an on-disk
 * embedded database).
 */
export function assertDatabaseConfigured(env: NodeJS.ProcessEnv, production: boolean): void {
  if (!production || env.DATABASE_URL || env.PGLITE_DATA_DIR) return;
  throw new Error(
    'DATABASE_URL is not set. Refusing to start in production on a temporary in-memory database '
    + '(all chips would be lost on restart). Set DATABASE_URL — on Railway, the reference ${{Postgres.DATABASE_URL}} — '
    + 'or set PGLITE_DATA_DIR to use an on-disk embedded database deliberately.',
  );
}

/** An embedded database with the schema applied. In memory unless `dataDir` is given. */
export async function openPglite(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import('@electric-sql/pglite');
  const { drizzle } = await import('drizzle-orm/pglite');
  const { migrate } = await import('drizzle-orm/pglite/migrator');
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS });
  return { db: db as unknown as Db, kind: 'pglite', close: () => client.close() };
}
