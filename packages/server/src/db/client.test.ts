import { describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { assertDatabaseConfigured, DB_STATEMENT_TIMEOUT_MS, poolConfig, watchPool } from './client.js';

describe('Postgres pool', () => {
  it('bounds connecting and every statement, so a hung query cannot stall a table forever', () => {
    const cfg = poolConfig('postgresql://x@localhost/db');
    expect(cfg.connectionTimeoutMillis).toBeGreaterThan(0);
    expect(cfg.statement_timeout).toBe(DB_STATEMENT_TIMEOUT_MS);
    expect(cfg.query_timeout).toBeGreaterThan(DB_STATEMENT_TIMEOUT_MS);
    expect(cfg.idle_in_transaction_session_timeout).toBeGreaterThan(0);
  });

  it('logs an idle client error instead of crashing the process', () => {
    const pool = new pg.Pool({ connectionString: 'postgresql://x@127.0.0.1:1/none' });
    const log = vi.fn();
    watchPool(pool, log);
    // Without a listener, EventEmitter throws on an 'error' event.
    expect(() => pool.emit('error', new Error('terminating connection due to administrator command'))).not.toThrow();
    expect(log).toHaveBeenCalledWith('[db] idle client error', expect.any(Error));
    void pool.end();
  });

  it.runIf(!!process.env.TEST_DATABASE_URL)('applies the statement timeout on real Postgres', async () => {
    const pool = new pg.Pool(poolConfig(process.env.TEST_DATABASE_URL!));
    watchPool(pool, () => undefined);
    try {
      const { rows } = await pool.query('show statement_timeout');
      expect(rows[0].statement_timeout).toBe(`${DB_STATEMENT_TIMEOUT_MS / 1000}s`);
    } finally {
      await pool.end();
    }
  });
});

describe('assertDatabaseConfigured', () => {
  it('refuses to run production on a throwaway in-memory database', () => {
    expect(() => assertDatabaseConfigured({}, true)).toThrow(/DATABASE_URL is not set/);
    expect(() => assertDatabaseConfigured({ DATABASE_URL: '' }, true)).toThrow(/DATABASE_URL/);
  });

  it('allows a configured database, an explicit on-disk PGlite, or any non-production setup', () => {
    expect(() => assertDatabaseConfigured({ DATABASE_URL: 'postgresql://x@h/db' }, true)).not.toThrow();
    expect(() => assertDatabaseConfigured({ PGLITE_DATA_DIR: './data' }, true)).not.toThrow();
    expect(() => assertDatabaseConfigured({}, false)).not.toThrow();
  });
});
