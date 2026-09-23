import { afterAll, beforeAll } from 'vitest';
import { openDatabase, openPglite, type Db, type DbHandle } from '../db/client.js';
import { Bank } from '../services/bank.js';

/**
 * A fresh in-memory Postgres (PGlite) with the schema applied, shared by the
 * tests in one file. Use unique player ids per test to keep them independent.
 *
 * Set TEST_DATABASE_URL to run against a real Postgres instead (migrated on
 * open; run with --no-file-parallelism since files then share one database).
 */
export function useTestDb(): { get db(): Db } {
  let handle: DbHandle;
  beforeAll(async () => {
    const url = process.env.TEST_DATABASE_URL;
    handle = url ? await openDatabase({ url }) : await openPglite();
  }, 60_000);
  afterAll(async () => {
    await handle?.close();
  });
  return {
    get db() {
      return handle.db;
    },
  };
}

let counter = 0;
/** A unique player id for this test run. */
export function pid(prefix = 'p'): string {
  counter += 1;
  return `${prefix}-${counter}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Create a player with the starting bankroll and return their id. */
export async function makePlayer(db: Db, prefix = 'p'): Promise<string> {
  const id = pid(prefix);
  await new Bank(db).ensurePlayer({ id, name: id, avatarUrl: null });
  return id;
}
