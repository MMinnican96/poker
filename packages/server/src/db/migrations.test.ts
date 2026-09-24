import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { useTestDb } from '../test/db.js';

const t = useTestDb();
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

function statements(file: string): string[] {
  return fs.readFileSync(path.join(DIR, file), 'utf8')
    .split('--> statement-breakpoint')
    .map((s) => s.trim())
    .filter((s) => s.replace(/--.*$/gm, '').trim().length > 0);
}

describe('migrations', () => {
  it('are listed in the journal', () => {
    const journal = JSON.parse(fs.readFileSync(path.join(DIR, 'meta/_journal.json'), 'utf8')) as { entries: { tag: string }[] };
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).map((f) => f.replace(/\.sql$/, '')).sort();
    expect(journal.entries.map((e) => e.tag)).toEqual(files);
  });

  // Boot applies migrations to databases that may already have (some of) them,
  // e.g. the pre-overhaul db:push schema; every statement must be re-runnable.
  it('apply again cleanly over a migrated database', async () => {
    const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      for (const stmt of statements(file)) await t.db.execute(sql.raw(stmt));
    }
    const cols = await t.db.execute(sql`select column_name from information_schema.columns where table_name = 'players' and column_name = 'showcase'`);
    expect((cols as unknown as { rows: unknown[] }).rows ?? cols).toHaveLength(1);
  });
});
