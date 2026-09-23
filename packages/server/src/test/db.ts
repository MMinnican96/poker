import { afterAll, beforeAll } from 'vitest';
import { openPglite, type Db, type DbHandle } from '../db/client.js';
import { Bank } from '../services/bank.js';

/**
 * A fresh in-memory Postgres (PGlite) with the schema applied, shared by the
 * tests in one file. Use unique player ids per test to keep them independent.
 */
export function useTestDb(): { get db(): Db } {
  let handle: DbHandle;
  beforeAll(async () => {
    handle = await openPglite();
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
