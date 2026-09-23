import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { Db, DbOrTx } from '../db/client.js';
import { chipTransactions, players, tableSeats } from '../db/schema.js';

export const STARTING_CHIPS = 10_000;

export type LedgerType =
  | 'buy-in' | 'top-up' | 'cash-out' | 'recovery'
  | 'daily-bonus' | 'level-up' | 'challenge' | 'purchase' | 'grant';

export type BankResult<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/**
 * The chip bank. Chips live in exactly one place at a time: a player's bankroll
 * (`players.chip_balance`) or a table seat in escrow (`table_seats.stack`). Every
 * movement is a single transaction that also writes a ledger row, so the two can
 * never disagree, and nothing here can drive a balance negative.
 */
export class Bank {
  constructor(private readonly db: Db) {}

  /** Create the player on first sight (with starting chips); refresh name/avatar after. */
  async ensurePlayer(input: { id: string; name: string; avatarUrl: string | null }) {
    const [row] = await this.db
      .insert(players)
      .values({ discordUserId: input.id, displayName: input.name, avatarUrl: input.avatarUrl, chipBalance: STARTING_CHIPS })
      .onConflictDoUpdate({
        target: players.discordUserId,
        set: { displayName: input.name, avatarUrl: input.avatarUrl, lastSeenAt: new Date() },
      })
      .returning();
    return row;
  }

  async balance(playerId: string): Promise<number> {
    const [row] = await this.db.select({ b: players.chipBalance }).from(players).where(eq(players.discordUserId, playerId));
    return row?.b ?? 0;
  }

  /** Move chips from the bankroll into a new open seat at `tableId`. */
  async buyIn(input: { tableId: string; playerId: string; amount: number }): Promise<BankResult<{ balance: number; seatId: string }>> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: 'Buy-in must be a positive whole number.' };
    return this.db.transaction(async (tx) => {
      const balance = await lockBalance(tx, input.playerId);
      if (balance === null) return { ok: false, error: 'Unknown player.' };
      if (balance < input.amount) return { ok: false, error: "You don't have enough chips for that buy-in." };
      const [existing] = await tx.select({ id: tableSeats.id }).from(tableSeats)
        .where(and(eq(tableSeats.tableId, input.tableId), eq(tableSeats.playerId, input.playerId), eq(tableSeats.status, 'open')));
      if (existing) return { ok: false, error: 'You already have chips on this table.' };
      const seatId = randomUUID();
      await tx.insert(tableSeats).values({
        id: seatId, tableId: input.tableId, playerId: input.playerId, stack: input.amount, boughtIn: input.amount,
      });
      const next = await move(tx, input.playerId, -input.amount, 'buy-in', `buyin:${seatId}`);
      return { ok: true, balance: next, seatId };
    });
  }

  /** Add chips from the bankroll to an open seat. */
  async topUp(input: { tableId: string; playerId: string; amount: number }): Promise<BankResult<{ balance: number; stack: number }>> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) return { ok: false, error: 'Top-up must be a positive whole number.' };
    return this.db.transaction(async (tx) => {
      const balance = await lockBalance(tx, input.playerId);
      if (balance === null) return { ok: false, error: 'Unknown player.' };
      if (balance < input.amount) return { ok: false, error: "You don't have enough chips to add that many." };
      const [seat] = await tx.select().from(tableSeats)
        .where(and(eq(tableSeats.tableId, input.tableId), eq(tableSeats.playerId, input.playerId), eq(tableSeats.status, 'open')))
        .for('update');
      if (!seat) return { ok: false, error: 'You have no seat at this table.' };
      const [updated] = await tx.update(tableSeats)
        .set({ stack: seat.stack + input.amount, boughtIn: seat.boughtIn + input.amount })
        .where(eq(tableSeats.id, seat.id))
        .returning({ stack: tableSeats.stack });
      const next = await move(tx, input.playerId, -input.amount, 'top-up', `topup:${seat.id}:${randomUUID()}`);
      return { ok: true, balance: next, stack: updated.stack };
    });
  }

  /**
   * Record every open seat's stack after a hand. Absolute values, so a failed
   * checkpoint is repaired by the next one.
   */
  async checkpoint(tableId: string, handNumber: number, stacks: { playerId: string; stack: number }[]): Promise<void> {
    if (stacks.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const s of stacks) {
        await tx.update(tableSeats)
          .set({ stack: s.stack, lastHand: handNumber })
          .where(and(eq(tableSeats.tableId, tableId), eq(tableSeats.playerId, s.playerId), eq(tableSeats.status, 'open')));
      }
    });
  }

  /**
   * Close the player's open seat and credit `stack` to their bankroll. Safe to
   * call twice: the second call finds no open seat and changes nothing.
   */
  async cashOut(input: { tableId: string; playerId: string; stack: number }): Promise<BankResult<{ balance: number; amount: number }>> {
    return this.db.transaction(async (tx) => {
      const [seat] = await tx.select().from(tableSeats)
        .where(and(eq(tableSeats.tableId, input.tableId), eq(tableSeats.playerId, input.playerId), eq(tableSeats.status, 'open')))
        .for('update');
      if (!seat) return { ok: false, error: 'No open seat.' };
      await lockBalance(tx, input.playerId);
      const amount = Math.max(0, input.stack);
      await tx.update(tableSeats)
        .set({ status: 'closed', stack: amount, closedAt: new Date() })
        .where(eq(tableSeats.id, seat.id));
      const balance = amount > 0
        ? await move(tx, input.playerId, amount, 'cash-out', `cashout:${seat.id}`)
        : await currentBalance(tx, input.playerId);
      return { ok: true, balance, amount };
    });
  }

  /**
   * Refund every seat still open — called at boot, when no table is live, so any
   * open seat belongs to a process that died. Refunds the last checkpoint (the
   * interrupted hand is voided).
   */
  async recoverOpenSeats(): Promise<{ seats: number; chips: number }> {
    const open = await this.db.select().from(tableSeats).where(eq(tableSeats.status, 'open'));
    let chips = 0;
    for (const seat of open) {
      await this.db.transaction(async (tx) => {
        const [locked] = await tx.select().from(tableSeats).where(eq(tableSeats.id, seat.id)).for('update');
        if (!locked || locked.status !== 'open') return;
        await lockBalance(tx, seat.playerId);
        await tx.update(tableSeats).set({ status: 'closed', closedAt: new Date() }).where(eq(tableSeats.id, seat.id));
        if (locked.stack > 0) await move(tx, seat.playerId, locked.stack, 'recovery', `recovery:${seat.id}`);
        chips += locked.stack;
      });
    }
    return { seats: open.length, chips };
  }

  /** Credit chips once per idempotency key (rewards, grants). */
  async credit(input: { playerId: string; amount: number; type: LedgerType; key: string }): Promise<{ applied: boolean; balance: number }> {
    return this.db.transaction((tx) => creditIn(tx, input));
  }

  /** Chips in escrow for a player across all open seats. */
  async escrowed(playerId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: sql<number>`coalesce(sum(${tableSeats.stack}), 0)::int` })
      .from(tableSeats)
      .where(and(eq(tableSeats.playerId, playerId), eq(tableSeats.status, 'open')));
    return Number(row?.total ?? 0);
  }
}

// ---------------------------------------------------------------------------
// Transaction-level helpers shared with other services (shop, rewards).
// ---------------------------------------------------------------------------

/** Lock the player row for the rest of the transaction; null if unknown. */
export async function lockBalance(tx: DbOrTx, playerId: string): Promise<number | null> {
  const [row] = await tx.select({ b: players.chipBalance }).from(players)
    .where(eq(players.discordUserId, playerId)).for('update');
  return row ? row.b : null;
}

async function currentBalance(tx: DbOrTx, playerId: string): Promise<number> {
  const [row] = await tx.select({ b: players.chipBalance }).from(players).where(eq(players.discordUserId, playerId));
  return row?.b ?? 0;
}

/**
 * Apply `amount` to the bankroll with a ledger row. The caller holds the row
 * lock and has checked funds; the ledger key must be unique (throws otherwise).
 */
export async function move(tx: DbOrTx, playerId: string, amount: number, type: LedgerType, key: string): Promise<number> {
  await tx.insert(chipTransactions).values({ playerId, amount, type, idempotencyKey: key });
  const [row] = await tx.update(players)
    .set({ chipBalance: sql`${players.chipBalance} + ${amount}` })
    .where(eq(players.discordUserId, playerId))
    .returning({ b: players.chipBalance });
  if (row.b < 0) throw new Error(`Balance would go negative for ${playerId}`);
  return row.b;
}

/** Idempotent credit inside an existing transaction. */
export async function creditIn(
  tx: DbOrTx,
  input: { playerId: string; amount: number; type: LedgerType; key: string },
): Promise<{ applied: boolean; balance: number }> {
  const current = await lockBalance(tx, input.playerId);
  if (current === null) return { applied: false, balance: 0 };
  const inserted = await tx.insert(chipTransactions)
    .values({ playerId: input.playerId, amount: input.amount, type: input.type, idempotencyKey: input.key })
    .onConflictDoNothing({ target: chipTransactions.idempotencyKey })
    .returning({ id: chipTransactions.id });
  if (inserted.length === 0) return { applied: false, balance: current };
  const [row] = await tx.update(players)
    .set({ chipBalance: sql`${players.chipBalance} + ${input.amount}` })
    .where(eq(players.discordUserId, input.playerId))
    .returning({ b: players.chipBalance });
  return { applied: true, balance: row.b };
}
