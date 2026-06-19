import { config } from 'dotenv';
import path from 'node:path';
import { defineConfig } from 'drizzle-kit';

// Load the repo-root .env (single source of truth) regardless of workspace cwd.
config({ path: path.resolve(process.cwd(), '../../.env') });
config();

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgresql://poker:poker@localhost:5432/poker',
  },
});
