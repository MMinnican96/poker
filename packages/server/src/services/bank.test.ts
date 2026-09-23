import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { Bank, STARTING_CHIPS } from './bank.js';
import { chipTransactions, players, tableSeats } from '../db/schema.js';
import { makePlayer, useTestDb } from '../test/db.js';

const t = useTestDb();

/** Bankroll + escrow for everyone — must equal what the ledger says was ever minted. */
async function totalChips(): Promise<number> {
  const [b] = await t.db.select({ s: sql<number>`coalesce(sum(chip_balance),0)::int` }).from(players);
  const [e] = await t.db.select({ s: sql<number>`coalesce(sum(stack),0)::int` }).from(tableSeats).where(eq(tableSeats.status, 'open'));
  return Number(b.s) + Number(e.s);
}

describe('Bank', () => {
  it('creates players with the starting bankroll and keeps it on re-login', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    expect(await bank.balance(id)).toBe(STARTING_CHIPS);
    await bank.ensurePlayer({ id, name: 'Renamed', avatarUrl: 'x' });
    expect(await bank.balance(id)).toBe(STARTING_CHIPS);
  });

  it('moves a buy-in into escrow and back on cash-out', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const table = randomUUID();
    const before = await totalChips();

    const bought = await bank.buyIn({ tableId: table, playerId: id, amount: 3000 });
    expect(bought).toMatchObject({ ok: true, balance: 7000 });
    expect(await bank.escrowed(id)).toBe(3000);
    expect(await totalChips()).toBe(before);

    await bank.checkpoint(table, 1, [{ playerId: id, stack: 4500 }]);
    const out = await bank.cashOut({ tableId: table, playerId: id, stack: 4500 });
    expect(out).toMatchObject({ ok: true, balance: 11_500, amount: 4500 });
    expect(await bank.escrowed(id)).toBe(0);

    // A second cash-out is a no-op, never a double credit.
    expect(await bank.cashOut({ tableId: table, playerId: id, stack: 4500 })).toMatchObject({ ok: false });
    expect(await bank.balance(id)).toBe(11_500);
  });

  it('refuses a buy-in the bankroll cannot cover, changing nothing', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const r = await bank.buyIn({ tableId: randomUUID(), playerId: id, amount: STARTING_CHIPS + 1 });
    expect(r).toEqual({ ok: false, error: "You don't have enough chips for that buy-in." });
    expect(await bank.balance(id)).toBe(STARTING_CHIPS);
    expect(await bank.escrowed(id)).toBe(0);
  });

  it('allows only one open seat per player per table', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const table = randomUUID();
    await bank.buyIn({ tableId: table, playerId: id, amount: 1000 });
    expect(await bank.buyIn({ tableId: table, playerId: id, amount: 1000 })).toMatchObject({ ok: false });
    expect(await bank.balance(id)).toBe(9000);
  });

  it('serialises concurrent buy-ins so the bankroll never overdraws', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const results = await Promise.all(
      Array.from({ length: 5 }, () => bank.buyIn({ tableId: randomUUID(), playerId: id, amount: 3000 })),
    );
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await bank.balance(id)).toBe(1000);
    expect(await bank.escrowed(id)).toBe(9000);
  });

  it('tops up an open seat', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const table = randomUUID();
    await bank.buyIn({ tableId: table, playerId: id, amount: 1000 });
    expect(await bank.topUp({ tableId: table, playerId: id, amount: 500 })).toMatchObject({ ok: true, stack: 1500, balance: 8500 });
    expect(await bank.topUp({ tableId: table, playerId: id, amount: 9000 })).toMatchObject({ ok: false });
    expect(await bank.topUp({ tableId: randomUUID(), playerId: id, amount: 10 })).toMatchObject({ ok: false });
  });

  it('refunds open seats at their last checkpoint after a crash', async () => {
    const bank = new Bank(t.db);
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    const table = randomUUID();
    await bank.buyIn({ tableId: table, playerId: a, amount: 2000 });
    await bank.buyIn({ tableId: table, playerId: b, amount: 2000 });
    await bank.checkpoint(table, 7, [{ playerId: a, stack: 2600 }, { playerId: b, stack: 1400 }]);
    // (process dies mid-hand 8 here)
    const recovered = await new Bank(t.db).recoverOpenSeats();
    expect(recovered.seats).toBeGreaterThanOrEqual(2);
    expect(await bank.balance(a)).toBe(10_600);
    expect(await bank.balance(b)).toBe(9_400);
    const again = await bank.recoverOpenSeats();
    expect(again.seats).toBe(0);
  });

  it('credits rewards once per key', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const key = `test:${id}`;
    expect(await bank.credit({ playerId: id, amount: 250, type: 'grant', key })).toEqual({ applied: true, balance: 10_250 });
    expect(await bank.credit({ playerId: id, amount: 250, type: 'grant', key })).toEqual({ applied: false, balance: 10_250 });
  });

  it('writes a ledger row for every movement that nets to the balance change', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const table = randomUUID();
    await bank.buyIn({ tableId: table, playerId: id, amount: 1000 });
    await bank.topUp({ tableId: table, playerId: id, amount: 250 });
    await bank.cashOut({ tableId: table, playerId: id, stack: 2000 });
    const rows = await t.db.select().from(chipTransactions).where(eq(chipTransactions.playerId, id));
    expect(rows.map((r) => r.type).sort()).toEqual(['buy-in', 'cash-out', 'top-up']);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe((await bank.balance(id)) - STARTING_CHIPS);
  });

  it('rejects a negative balance at the database level too', async () => {
    const id = await makePlayer(t.db);
    await expect(
      t.db.update(players).set({ chipBalance: -1 }).where(eq(players.discordUserId, id)),
    ).rejects.toThrow();
  });
});
