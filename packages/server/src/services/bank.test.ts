import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import { Bank, STARTING_CHIPS } from './bank.js';
import { chipTransactions, players, serverLeases, tableSeats } from '../db/schema.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { ServerLease } from './leases.js';

const t = useTestDb();

async function buy(bank: Bank, tableId: string, playerId: string, amount: number): Promise<{ seatId: string }> {
  const r = await bank.buyIn({ tableId, playerId, amount });
  if (!r.ok) throw new Error(r.error);
  return r;
}

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
    const seatId = (bought as { seatId: string }).seatId;
    expect(await bank.escrowed(id)).toBe(3000);
    expect(await totalChips()).toBe(before);

    await bank.checkpoint(1, [{ seatId, stack: 4500 }]);
    const out = await bank.cashOut({ seatId, playerId: id, stack: 4500 });
    expect(out).toMatchObject({ ok: true, balance: 11_500, amount: 4500 });
    expect(await bank.escrowed(id)).toBe(0);

    // A second cash-out is a no-op, never a double credit.
    expect(await bank.cashOut({ seatId, playerId: id, stack: 4500 })).toMatchObject({ ok: false });
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
    const { seatId } = await buy(bank, table, id, 1000);
    expect(await bank.topUp({ seatId, playerId: id, amount: 500 })).toMatchObject({ ok: true, stack: 1500, balance: 8500 });
    expect(await bank.topUp({ seatId, playerId: id, amount: 9000 })).toMatchObject({ ok: false });
    expect(await bank.topUp({ seatId: randomUUID(), playerId: id, amount: 10 })).toMatchObject({ ok: false });
    // Someone else's seat is not yours to top up.
    const other = await makePlayer(t.db);
    expect(await bank.topUp({ seatId, playerId: other, amount: 10 })).toMatchObject({ ok: false });
  });

  it('refunds open seats at their last checkpoint after a crash', async () => {
    const bank = new Bank(t.db);
    const a = await makePlayer(t.db);
    const b = await makePlayer(t.db);
    const table = randomUUID();
    const sa = await buy(bank, table, a, 2000);
    const sb = await buy(bank, table, b, 2000);
    await bank.checkpoint(7, [{ seatId: sa.seatId, stack: 2600 }, { seatId: sb.seatId, stack: 1400 }]);
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
    const { seatId } = await buy(bank, table, id, 1000);
    await bank.topUp({ seatId, playerId: id, amount: 250 });
    await bank.cashOut({ seatId, playerId: id, stack: 2000 });
    const rows = await t.db.select().from(chipTransactions).where(eq(chipTransactions.playerId, id));
    expect(rows.map((r) => r.type).sort()).toEqual(['buy-in', 'cash-out', 'top-up']);
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe((await bank.balance(id)) - STARTING_CHIPS);
  });

  it('retrying a cash-out never closes a newer seat at the same table', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const table = randomUUID();
    const first = await buy(bank, table, id, 2000);
    // The first cash-out commits, but the caller saw an error and queued a retry.
    await bank.cashOut({ seatId: first.seatId, playerId: id, stack: 2000 });
    const second = await buy(bank, table, id, 3000);
    expect(await bank.cashOut({ seatId: first.seatId, playerId: id, stack: 2000 })).toMatchObject({ ok: false });
    expect(await bank.escrowed(id)).toBe(3000);
    expect(await bank.balance(id)).toBe(STARTING_CHIPS - 3000);
    expect(await bank.cashOut({ seatId: second.seatId, playerId: id, stack: 3000 })).toMatchObject({ ok: true, balance: STARTING_CHIPS });
  });

  it('never deadlocks when top-ups and cash-outs for a player overlap', async () => {
    const bank = new Bank(t.db);
    const id = await makePlayer(t.db);
    const seats = await Promise.all([1, 2, 3].map(() => buy(bank, randomUUID(), id, 1000)));
    const ops = seats.flatMap(({ seatId }) => [
      bank.topUp({ seatId, playerId: id, amount: 100 }),
      bank.cashOut({ seatId, playerId: id, stack: 1000 }),
      bank.topUp({ seatId, playerId: id, amount: 100 }),
    ]);
    await Promise.all(ops);
    expect(await bank.escrowed(id)).toBe(0);
    const rows = await t.db.select().from(chipTransactions).where(eq(chipTransactions.playerId, id));
    expect(rows.reduce((s, r) => s + r.amount, 0)).toBe((await bank.balance(id)) - STARTING_CHIPS);
  });

  describe('server leases', () => {
    it('stamps new seats with the lease and never recovers seats of a live process', async () => {
      const lease = new ServerLease(t.db);
      await lease.register();
      const live = new Bank(t.db, lease.id);
      const id = await makePlayer(t.db);
      const { seatId } = await buy(live, randomUUID(), id, 2000);
      const [row] = await t.db.select().from(tableSeats).where(eq(tableSeats.id, seatId));
      expect(row.leaseId).toBe(lease.id);

      // Another process booting (rolling deploy) and this process's own sweep both leave it alone.
      await new Bank(t.db, randomUUID()).recoverOpenSeats();
      await live.recoverOpenSeats();
      expect(await live.escrowed(id)).toBe(2000);
      await lease.release();
    });

    it('recovers seats whose lease went stale or disappeared, and legacy seats without one', async () => {
      const stale = new ServerLease(t.db);
      await stale.register();
      await t.db.update(serverLeases).set({ heartbeatAt: new Date(Date.now() - 5 * 60_000) }).where(eq(serverLeases.id, stale.id));
      const gone = randomUUID(); // a process whose lease row was released
      const a = await makePlayer(t.db);
      const b = await makePlayer(t.db);
      const c = await makePlayer(t.db);
      await buy(new Bank(t.db, stale.id), randomUUID(), a, 1000);
      await buy(new Bank(t.db, gone), randomUUID(), b, 1500);
      await buy(new Bank(t.db), randomUUID(), c, 2500);

      const me = new ServerLease(t.db);
      await me.register();
      const r = await new Bank(t.db, me.id).recoverOpenSeats();
      expect(r.seats).toBeGreaterThanOrEqual(3);
      for (const id of [a, b, c]) {
        expect(await new Bank(t.db).escrowed(id)).toBe(0);
        expect(await new Bank(t.db).balance(id)).toBe(STARTING_CHIPS);
      }
      // The dead lease is forgotten once it owns no open seat; the live one stays.
      const leases = await t.db.select().from(serverLeases);
      expect(leases.some((l) => l.id === stale.id)).toBe(false);
      expect(leases.some((l) => l.id === me.id)).toBe(true);
      await me.release();
    });

    it('a heartbeat keeps a lease alive; releasing it makes its seats recoverable at once', async () => {
      const lease = new ServerLease(t.db);
      await lease.register();
      const id = await makePlayer(t.db);
      await buy(new Bank(t.db, lease.id), randomUUID(), id, 1000);
      // Old, but not yet stale: a heartbeat refreshes it and recovery leaves it be.
      await t.db.update(serverLeases).set({ heartbeatAt: new Date(Date.now() - 20_000) }).where(eq(serverLeases.id, lease.id));
      await lease.heartbeat();
      expect(lease.isHeld).toBe(true);
      await new Bank(t.db, randomUUID()).recoverOpenSeats();
      expect(await new Bank(t.db).escrowed(id)).toBe(1000);
      await lease.release();
      await new Bank(t.db, randomUUID()).recoverOpenSeats();
      expect(await new Bank(t.db).escrowed(id)).toBe(0);
    });
  });

  it('rejects a negative balance at the database level too', async () => {
    const id = await makePlayer(t.db);
    await expect(
      t.db.update(players).set({ chipBalance: -1 }).where(eq(players.discordUserId, id)),
    ).rejects.toThrow();
  });
});
