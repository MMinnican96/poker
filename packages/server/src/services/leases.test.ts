import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { serverLeases, tableSeats } from '../db/schema.js';
import { makePlayer, useTestDb } from '../test/db.js';
import { Bank, LEASE_STALE_MS } from './bank.js';
import { LEASE_LOST_AFTER_MS, ServerLease, type LeaseLoss } from './leases.js';

const t = useTestDb();

/** A db whose writes throw while `down` is set (the database is unreachable). */
function flaky(db: Db): { db: Db; down: boolean } {
  const state = { down: false, db: db };
  state.db = new Proxy(db, {
    get(target, key, receiver) {
      if (state.down && (key === 'insert' || key === 'update' || key === 'delete')) {
        return () => { throw new Error('connection refused'); };
      }
      return Reflect.get(target, key, receiver);
    },
  });
  return state;
}

/** A lease with a controllable clock that records what it reports. */
async function makeLease(db: Db = t.db) {
  let now = 1_000_000;
  const events: string[] = [];
  const losses: LeaseLoss[] = [];
  const lease = new ServerLease(db, { clock: () => now, log: () => undefined });
  lease.onLost = async (loss) => {
    events.push(`lost:${loss.reason}`);
    losses.push(loss);
  };
  lease.onRenewed = (id) => events.push(`renewed:${id}`);
  await lease.register();
  return { lease, events, losses, advance: (ms: number) => { now += ms; } };
}

async function leaseRow(id: string) {
  const [row] = await t.db.select().from(serverLeases).where(eq(serverLeases.id, id));
  return row;
}

describe('ServerLease loss detection', () => {
  it('gives up its lease well before anyone else may recover its seats', () => {
    expect(LEASE_LOST_AFTER_MS).toBe(LEASE_STALE_MS / 2);
  });

  it('keeps the same lease while heartbeats succeed', async () => {
    const { lease, events, advance } = await makeLease();
    const id = lease.id;
    for (let i = 0; i < 3; i++) {
      advance(LEASE_LOST_AFTER_MS / 3);
      await lease.heartbeat();
    }
    expect(lease.id).toBe(id);
    expect(lease.isHeld).toBe(true);
    expect(events).toEqual([]);
    await lease.release();
  });

  it('treats a deleted lease as lost (never silently re-creating it), then takes a fresh one', async () => {
    const { lease, events, losses } = await makeLease();
    const old = lease.id;
    // Another process's recovery refunded our seats and forgot our lease.
    await t.db.delete(serverLeases).where(eq(serverLeases.id, old));
    await lease.heartbeat();
    expect(losses).toEqual([{ leaseId: old, reason: 'deleted' }]);
    expect(lease.id).not.toBe(old);
    expect(lease.isHeld).toBe(true);
    // onLost finished before the fresh lease was announced.
    expect(events).toEqual(['lost:deleted', `renewed:${lease.id}`]);
    expect(await leaseRow(old)).toBeUndefined();
    expect(await leaseRow(lease.id)).toBeDefined();
    await lease.release();
  });

  it('treats a lease that already went stale as lost, even though its row still exists', async () => {
    const { lease, losses } = await makeLease();
    const old = lease.id;
    await t.db.update(serverLeases).set({ heartbeatAt: new Date(Date.now() - LEASE_STALE_MS - 5_000) })
      .where(eq(serverLeases.id, old));
    await lease.heartbeat();
    expect(losses).toEqual([{ leaseId: old, reason: 'deleted' }]);
    // The stale row is dropped so recovery refunds its seats at once.
    expect(await leaseRow(old)).toBeUndefined();
    await lease.release();
  });

  it('gives the lease up after LEASE_LOST_AFTER_MS without a successful heartbeat, and its seats become recoverable', async () => {
    const conn = flaky(t.db);
    const { lease, events, losses, advance } = await makeLease(conn.db);
    const old = lease.id;
    const player = await makePlayer(t.db);
    const buy = await new Bank(t.db, old).buyIn({ tableId: randomUUID(), playerId: player, amount: 1500 });
    if (!buy.ok) throw new Error(buy.error);

    conn.down = true;
    advance(LEASE_LOST_AFTER_MS / 2);
    await expect(lease.heartbeat()).rejects.toThrow('connection refused');
    expect(losses).toEqual([]);
    advance(LEASE_LOST_AFTER_MS / 2);
    await lease.heartbeat();
    expect(losses).toEqual([{ leaseId: old, reason: 'unreachable' }]);
    // Can't register a fresh lease while the database is down; keeps trying.
    expect(lease.isHeld).toBe(false);
    await lease.heartbeat().catch(() => undefined);
    expect(lease.isHeld).toBe(false);
    expect(events).toEqual(['lost:unreachable']);

    conn.down = false;
    await lease.heartbeat();
    expect(lease.isHeld).toBe(true);
    expect(lease.id).not.toBe(old);
    expect(events).toEqual(['lost:unreachable', `renewed:${lease.id}`]);
    // The abandoned lease row is gone, so any process's recovery refunds its seat now.
    expect(await leaseRow(old)).toBeUndefined();
    await new Bank(t.db, randomUUID()).recoverOpenSeats();
    const [seat] = await t.db.select().from(tableSeats).where(eq(tableSeats.id, buy.seatId));
    expect(seat.status).toBe('closed');
    expect(await new Bank(t.db).balance(player)).toBe(10_000);
    await lease.release();
  });

  it('still takes a fresh lease if abandoning the tables fails', async () => {
    const { lease } = await makeLease();
    const old = lease.id;
    lease.onLost = async () => { throw new Error('boom'); };
    await t.db.delete(serverLeases).where(eq(serverLeases.id, old));
    await lease.heartbeat();
    expect(lease.isHeld).toBe(true);
    expect(lease.id).not.toBe(old);
    await lease.release();
  });
});
