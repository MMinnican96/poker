import 'dotenv/config';
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { eq, sql } from 'drizzle-orm';
import * as schema from './schema.js';

const { Pool } = pg;

type Db = ReturnType<typeof drizzle<typeof schema>>;

let _db: Db | null = null;

/**
 * Lazily create the connection pool on first use. Importing this module no
 * longer requires DATABASE_URL, so the server can boot in dev/mock mode without
 * Postgres; the error only surfaces if a DB-backed route is actually hit.
 */
export function getDb(): Db {
  if (!_db) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set. Copy .env.example to .env and configure it.');
    }
    _db = drizzle(new Pool({ connectionString }), { schema });
  }
  return _db;
}

const STARTING_CHIPS = 10_000;

/**
 * Fetch a player, creating them with a starting balance on first login.
 * Display name / avatar are refreshed from the (server-validated) identity.
 */
export async function upsertPlayer(input: {
  discordUserId: string;
  displayName: string;
  avatarUrl: string | null;
}): Promise<schema.Player> {
  const [player] = await getDb()
    .insert(schema.players)
    .values({
      discordUserId: input.discordUserId,
      displayName: input.displayName,
      avatarUrl: input.avatarUrl,
      chipBalance: STARTING_CHIPS,
    })
    .onConflictDoUpdate({
      target: schema.players.discordUserId,
      set: { displayName: input.displayName, avatarUrl: input.avatarUrl },
    })
    .returning();
  return player;
}

/**
 * Move `amount` chips into (positive) or out of (negative) a player's persistent
 * balance, recording a ledger row. Idempotent: if a row with `idempotencyKey`
 * already exists the call is a no-op and returns the current balance. Runs in a
 * single transaction so the balance update and ledger insert are atomic.
 */
export async function adjustChips(input: {
  playerId: string;
  amount: number;
  type: string;
  idempotencyKey: string;
}): Promise<{ applied: boolean; balance: number }> {
  return getDb().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.chipTransactions)
      .values({
        playerId: input.playerId,
        amount: input.amount,
        type: input.type,
        idempotencyKey: input.idempotencyKey,
      })
      .onConflictDoNothing({ target: schema.chipTransactions.idempotencyKey })
      .returning({ id: schema.chipTransactions.id });

    if (inserted.length === 0) {
      // Already applied — return current balance unchanged.
      const [row] = await tx
        .select({ balance: schema.players.chipBalance })
        .from(schema.players)
        .where(eq(schema.players.discordUserId, input.playerId));
      return { applied: false, balance: row?.balance ?? 0 };
    }

    const [updated] = await tx
      .update(schema.players)
      .set({ chipBalance: sql`${schema.players.chipBalance} + ${input.amount}` })
      .where(eq(schema.players.discordUserId, input.playerId))
      .returning({ balance: schema.players.chipBalance });

    return { applied: true, balance: updated.balance };
  });
}

export { schema };
