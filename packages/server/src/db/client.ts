import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
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

/**
 * Connect to Postgres when `DATABASE_URL` is set; otherwise start an embedded
 * PGlite database (in memory, or on disk at `PGLITE_DATA_DIR`) and apply the
 * generated migrations. Both expose the same Drizzle API, so every service has a
 * single implementation.
 */
export async function openDatabase(opts: { url?: string; pgliteDir?: string } = {}): Promise<DbHandle> {
  const url = opts.url ?? process.env.DATABASE_URL;
  if (url) {
    const pool = new pg.Pool({ connectionString: url });
    const db = drizzlePg(pool, { schema }) as unknown as Db;
    return { db, kind: 'postgres', close: () => pool.end() };
  }
  return openPglite(opts.pgliteDir ?? process.env.PGLITE_DATA_DIR);
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
